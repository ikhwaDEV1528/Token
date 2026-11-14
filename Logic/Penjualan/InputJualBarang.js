import { db } from '../../db.js';
import JualBarang from "../../Endpoint/JualBarang/JualBarang.js";
import { kode_faktur } from "./kode_faktur.js";



/**
 * =========================================================================
 * MIGRATION — Jalankan SEKALI di database (bukan tiap request)
 * =========================================================================
 *
 * -- Buat FULLTEXT index dengan ngram parser di kolom nama_barang
 * ALTER TABLE barang
 *   ADD FULLTEXT INDEX ft_nama_barang (nama_barang) WITH PARSER ngram;
 *
 * -- Pastikan kolom JOIN punya index biasa (kalau belum ada), biar JOIN ke
 * -- barang_satuan tetap cepat walau subquery sudah dibatasi LIMIT 20
 * CREATE INDEX idx_kode_barang_satuan ON barang_satuan(kode_barang);
 *
 * -- Cek ngram_token_size (harus 2, biasanya default sudah 2):
 * SHOW VARIABLES LIKE 'ngram_token_size';
 * =========================================================================
 */

/**
 * Escape karakter khusus MySQL Boolean Full-Text Search mode.
 */
function escapeBooleanFTS(str) {
  return str.replace(/[+\-><()~*"@]/g, ' ').trim();
}

/**
 * Escape wildcard LIKE (%, _) untuk fallback query.
 */
function escapeLikeWildcard(str) {
  return str.replace(/[%_\\]/g, '\\$&');
}

export async function InputJualBarang(req, res) {
  const { input = '' } = req.query;

  try {
    // Validasi input
    const keyword = input.trim();

    if (!keyword) {
      return res.status(200).json({
        message: 'Input kosong',
        Search: []
      });
    }

    // Pecah input menjadi beberapa kata
    const words = keyword.toLowerCase().split(/\s+/).filter(Boolean);

    // Query dasar yang dipakai berulang (FULLTEXT & fallback LIKE),
    // struktur subquery + JOIN + GROUP BY PERSIS seperti versi asli,
    // hanya bagian ${whereClause} yang berubah tergantung mode pencarian.
    const buildSql = (whereClause) => `
      SELECT
        b.kode_barang,
        b.nama_barang,
        b.stok_pcs,
        b.harga_dasar,
        b.margin,
        b.harga_jual_produk_ke_pelanggan,
        b.persentase_diskon_distributor,
        b.persentase_fee_harga_jual,
        b.ada_fitur_bonus, -- <-- TAMBAHKAN INI
        b.is_active,

        IF(
          COUNT(bs.id) = 0,
          JSON_ARRAY(),
          JSON_ARRAYAGG(
            JSON_OBJECT(
              'id_satuan', bs.id,
              'nama_satuan', bs.nama_satuan,
              'harga_jual', bs.harga_jual,
              'rasio_ke_pcs', bs.rasio_ke_pcs,
              'level', bs.level,
              'is_active_satuan', bs.is_active_satuan
            )
          )
        ) AS list_satuan

      FROM (
        SELECT
          kode_barang,
          nama_barang,
          stok_pcs,
          harga_dasar,
          margin,
          harga_jual_produk_ke_pelanggan,
          persentase_diskon_distributor,
          persentase_fee_harga_jual,
          COALESCE(ada_fitur_bonus, 0) AS ada_fitur_bonus, -- <-- TAMBAHKAN INI
          COALESCE(is_active, 1) AS is_active
        FROM barang b
        WHERE ${whereClause}
        ORDER BY nama_barang ASC
        LIMIT 20
      ) b

      LEFT JOIN barang_satuan bs
        ON b.kode_barang = bs.kode_barang

      GROUP BY
        b.kode_barang,
        b.nama_barang,
        b.stok_pcs,
        b.harga_dasar,
        b.margin,
        b.harga_jual_produk_ke_pelanggan,
        b.persentase_diskon_distributor,
        b.persentase_fee_harga_jual,
        b.ada_fitur_bonus, -- <-- TAMBAHKAN INI
        b.is_active
    `;

    let resultSearch;

    // Ngram butuh minimal 2 karakter per token. Kalau ada kata yang cuma
    // 1 huruf (misal user baru mulai ngetik), FULLTEXT gak akan efektif,
    // jadi langsung pakai LIKE bertumpuk (fallback) untuk seluruh keyword.
    const hasShortWord = words.some((w) => w.length < 2);

    if (!hasShortWord) {
      // ── MODE UTAMA: FULLTEXT ngram (pakai index, cepat) ──
      const booleanQuery = words
        .map((word) => `+${escapeBooleanFTS(word)}*`)
        .join(' ');

      const ftSql = buildSql('MATCH(b.nama_barang) AGAINST(? IN BOOLEAN MODE)');
      [resultSearch] = await db.query(ftSql, [booleanQuery]);

      // Fallback: kalau FULLTEXT nol hasil (misal ngram gak match sempurna),
      // coba LIKE bertumpuk seperti versi original sebagai jaring pengaman.
      // Ini hanya jalan saat FULLTEXT kosong, jadi tidak membebani kasus normal.
      if (resultSearch.length === 0) {
        const whereConditions = words
          .map(() => 'b.nama_barang LIKE ?')
          .join(' AND ');
        const queryParams = words.map((word) => `%${escapeLikeWildcard(word)}%`);

        const likeSql = buildSql(whereConditions);
        [resultSearch] = await db.query(likeSql, queryParams);
      }
    } else {
      // ── MODE FALLBACK LANGSUNG: ada kata pendek < 2 karakter ──
      // (persis logika original: semua kata harus ditemukan via LIKE)
      const whereConditions = words
        .map(() => 'b.nama_barang LIKE ?')
        .join(' AND ');
      const queryParams = words.map((word) => `%${escapeLikeWildcard(word)}%`);

      const likeSql = buildSql(whereConditions);
      [resultSearch] = await db.query(likeSql, queryParams);
    }

    // Format JSON + urutkan satuan berdasarkan level terbesar → terkecil
    // (PERSIS seperti versi original, tidak ada yang diubah)
    const formattedResult = resultSearch.map((item) => {
      const listSatuan =
        typeof item.list_satuan === 'string'
          ? JSON.parse(item.list_satuan)
          : (item.list_satuan || []);

      listSatuan.sort((a, b) => (b.level ?? 0) - (a.level ?? 0));

      return {
        ...item,
        list_satuan: listSatuan
      };
    });

    return res.status(200).json({
      message: 'Berhasil cari data',
      Search: formattedResult
    });

  } catch (err) {
    console.error('InputJualBarang Error:', err);

    return res.status(500).json({
      message: 'Kesalahan server, Silahkan coba lagi!'
    });
  }
}











// QUERY PROSES PESANAN VERSI 2 (OPTIMASI) //

// NOTE : NANTI GW MAU NAMBAHIN BLOCK KALO USER ITU STATUS BLOCK SEMOGA INGET //
export async function ProsesPesanan(req, res) {
  try {
    const {
      dataListBarang,
      nama_pelanggan,
      tenggat_hutang,
      tanggal_pengiriman: input_tgl_kirim, // Menerima tanggal pengiriman
      diskon_global: input_diskon_global, // Menerima Diskon Global (Faktur)
      ppn, // field baru ppn
      total_dibayarkan_pelanggan,
      kode_pelanggan,
      id,
      nama_sales
    } = req.body || {};

    const id_admin = req.id_admin;

    if (!id_admin || id_admin == "" || id_admin == null) {
      return res.status(404).json({
        message: 'id admin tidak ditemukan!'
      })
    }

    if (!id || !nama_sales || nama_sales == "") {
      console.log({ nama: nama_sales, id_sales: id })
      return res.status(404).json({
        message: 'Data Seles tidak lengkap mohon isi!'
      })
    }

    if (!kode_pelanggan || kode_pelanggan == "" || kode_pelanggan == null) {
      console.log({ nama: nama_sales, id_sales: id })
      return res.status(404).json({
        message: 'Kode pelanggan tidak lengkap mohon isi!'
      })
    }

    // 1. Validasi Input
    if (!dataListBarang || dataListBarang.length === 0 || !kode_pelanggan) {
      return res.status(400).json({
        message: 'Data barang dan pelanggan wajib diisi!',
        status: 400
      });
    }

    const level_satuan = { KARTON: 3, BAL: 3, BALL: 3, PACK: 2, PCS: 1 };

    for (const item of dataListBarang) {

      if (!item || item == null) {
        return res.status(400).json({
          status: "error",
          message: 'item pada datalist barang kosong!'
        });
      }

      const jumlah = Number(item?.jumlah);
      const rasio = Number(item?.rasio_ke_pcs);
      const harga = Number(item?.harga_satuan);
      const qtyBonus = Number(item?.qty_bonus || 0); // Ambil qty_bonus

      // OPTIMASI TAMBAHAN VALIDASI DARI IKHWAN //

      const namaSatuanInput = String(item.nama_satuan || '').trim().toUpperCase();
      const levelSatuanBarang = level_satuan[namaSatuanInput];

      if (!levelSatuanBarang || levelSatuanBarang == undefined || levelSatuanBarang == null) {
        return res.status(400).json({
          message: 'Nama Satuan tidak valid / Tidak ada!'
        })
      }

      // OPTIMASI TAMBAHAN VALIDASI DARI IKHWAN //

      if (!item?.kode_barang || String(item.kode_barang).trim() === '') {
        return res.status(400).json({
          status: "error",
          message: 'Ada barang dengan kode_barang kosong/tidak valid!'
        });
      }

      // PENYESUAIAN 1: Boleh jumlah = 0 asal ada qty_bonus > 0
      if (!Number.isFinite(jumlah) || jumlah < 0 || (jumlah === 0 && qtyBonus <= 0)) {
        return res.status(400).json({
          status: "error",
          message: `Jumlah pembelian/bonus untuk '${item.kode_barang}' tidak valid`
        });
      }

      const rawJumlah = String(item?.jumlah ?? '').trim();
      if (!/^\d+$/.test(rawJumlah) || !Number.isFinite(jumlah) || jumlah < 0 || (jumlah === 0 && qtyBonus <= 0)) {
        return res.status(400).json({
          status: "error",
          message: `Jumlah pembelian untuk '${item.kode_barang}' tidak valid (harus angka murni)`
        });
      }

      if (!Number.isFinite(rasio) || rasio <= 0) {
        return res.status(400).json({
          status: "error",
          message: `Rasio satuan untuk '${item.kode_barang}' tidak valid (harus angka lebih dari 0)`
        });
      }

      // PENYESUAIAN 2: Boleh harga = 0 (untuk baris bonus/gratisan)
      if (!Number.isFinite(harga) || harga < 0) {
        return res.status(400).json({
          status: "error",
          message: `Harga satuan untuk '${item.kode_barang}' tidak valid`
        });
      }

      const rawharga = String(item?.harga_satuan ?? '').trim();
      if (!/^\d+$/.test(rawharga) || !Number.isFinite(harga) || harga < 0) {
        return res.status(400).json({
          status: "error",
          message: `Harga pembelian untuk '${item.kode_barang}' tidak valid (harus angka murni 0 atau lebih)`
        });
      }
    }


    const [getBlockPelanggan] = await db.query(`SELECT block FROM pelanggan WHERE nama_pelanggan = ? AND kode_pelanggan = ?`, [nama_pelanggan, kode_pelanggan]);

    if (getBlockPelanggan.length == 0) {
      return res.status(400).json({
        message: 'Tidak dapat menemukan Pelanggan'
      })
    }

    const isBlock = getBlockPelanggan[0]?.block;

    if (isBlock == 1) {
      return res.status(400).json({
        message: `Pelanggan atas nama ${nama_pelanggan} di BLOCK! , tidak bisa melakukan transaksi!`
      })
    }


    //// VALIDASI HARGA & RASIO DARI DB (barang_satuan) ////
    const kodeListPesanan = [...new Set(dataListBarang.map(i => String(i.kode_barang).trim()))];

    const [satuanRows] = await db.query(
      `SELECT kode_barang, nama_satuan, rasio_ke_pcs, harga_jual, is_active_satuan
     FROM barang_satuan
     WHERE kode_barang IN (?)`,
      [kodeListPesanan]
    );

    const satuanMap = new Map(
      satuanRows.map(r => [
        `${String(r.kode_barang).trim()}|${String(r.nama_satuan).trim().toUpperCase()}`,
        r
      ])
    );

    for (const item of dataListBarang) {
      const kode = String(item.kode_barang).trim();
      const namaSatuan = String(item.nama_satuan).trim().toUpperCase();
      const satuanDB = satuanMap.get(`${kode}|${namaSatuan}`);

      if (!satuanDB) {
        return res.status(400).json({
          status: "error",
          message: `Satuan '${namaSatuan}' tidak tersedia untuk barang '${kode}'`
        });
      }

      // Tolak jika satuan sudah dinonaktifkan
      if (Number(satuanDB.is_active_satuan) === 0) {
        return res.status(400).json({
          status: "error",
          message: `Satuan '${namaSatuan}' untuk barang '${kode}' sudah NON-AKTIF, tidak bisa diproses!`
        });
      }

      const hargaDB = Number(satuanDB.harga_jual);
      const rasioDB = Number(satuanDB.rasio_ke_pcs);
      const jumlah = Number(item.jumlah) || 0;

      // Harga wajib sama dengan DB (baris bonus murni jumlah = 0 dilewati)
      if (jumlah > 0 && Number(item.harga_satuan) !== hargaDB) {
        return res.status(400).json({
          status: "error",
          message: `Harga '${kode}' (${namaSatuan}) tidak sesuai harga sistem (Sistem: ${hargaDB}, Dikirim: ${item.harga_satuan})`
        });
      }

      // Timpa nilai dari FE dengan nilai DB
      // item.rasio_ke_pcs = rasioDB;
      // item.harga_satuan = hargaDB;
      // item.nama_satuan = satuanDB.nama_satuan;

      // Timpa nilai dari FE dengan nilai DB
      item.rasio_ke_pcs = rasioDB;
      item.harga_satuan = jumlah > 0 ? hargaDB : 0;   // baris bonus murni tetap harga 0
      item.nama_satuan = satuanDB.nama_satuan;
    }
    //// END VALIDASI HARGA & RASIO ////


    //// MERGE BARANG DUPLIKAT ////
    const mergedStokMap = new Map();
    for (const item of dataListBarang) {
      const kode = item?.kode_barang;
      const rasio = Number(item?.rasio_ke_pcs) || 1;
      const jumlahBeli = Number(item?.jumlah) || 0;
      const jumlahBonus = Number(item?.qty_bonus) || 0;
      const jumlahPcs = (jumlahBeli + jumlahBonus) * rasio;

      if (mergedStokMap.has(kode)) {
        mergedStokMap.get(kode).jumlah_pembelian += jumlahPcs;
      } else {
        mergedStokMap.set(kode, { kode_barang: kode, jumlah_pembelian: jumlahPcs });
      }
    }
    const ListStokBarang = Array.from(mergedStokMap.values());
    //// END MERGE BARANG DUPLIKAT ////

    //// VALIDASI STOK ////

    // 2. Ambil data stok terkini dari DB
    const [stokBarang] = await db.query(
      `SELECT kode_barang, nama_barang, stok_pcs, harga_dasar, ada_fitur_bonus, is_active FROM barang WHERE kode_barang IN (?)`,
      [ListStokBarang.map(item => item.kode_barang)]
    );

    // 3. Looping pengecekan stok (loop dari ListStokBarang yang sudah di-merge)
    for (let barangDipesan of ListStokBarang) {
      const item = stokBarang.find(i => i.kode_barang === barangDipesan.kode_barang);

      // Barang tidak ditemukan di database (kode salah / sudah dihapus)
      if (!item) {
        return res.status(404).json({
          status: "error",
          message: `Barang dengan kode '${barangDipesan.kode_barang}' tidak ditemukan`
        });
      }

      if (Number(item.is_active) === 0) {
        return res.status(400).json({
          status: "error",
          message: `Barang '${item.nama_barang}' (${item.kode_barang}) sudah NON-AKTIF, tidak bisa diproses!`
        });
      }

      const jumlahBeli = Number(barangDipesan.jumlah_pembelian) || 0;
      const stokTersedia = Number(item.stok_pcs) || 0;

      // Cek apakah stok yang tersedia (total, kalau kode sama dipesan 2x) kurang dari jumlah yang diminta
      if (stokTersedia < jumlahBeli) {
        console.log(`Stok untuk ${item.nama_barang} kurang/habis!`);

        return res.status(409).json({
          status: "error",
          message: `Stok produk '${item.nama_barang}' tidak mencukupi (Tersedia: ${stokTersedia}, Diminta: ${jumlahBeli})`
        });
      }
    }


    const barangMap = new Map(stokBarang.map(b => [String(b.kode_barang).trim(), b]));

    // (a) Tolak bonus untuk barang yang tidak punya fitur bonus
    for (const item of dataListBarang) {
      const kode = String(item.kode_barang).trim();
      const barang = barangMap.get(kode);
      if (Number(item.qty_bonus) > 0 && Number(barang?.ada_fitur_bonus) !== 1) {
        return res.status(400).json({
          status: "error",
          message: `Barang '${barang?.nama_barang || kode}' tidak memiliki fitur bonus`
        });
      }
    }

    // (b) HPP dari DB, bukan dari FE
    const rasioAcuanMap = new Map();
    for (const r of satuanRows) {
      const k = String(r.kode_barang).trim();
      const rasio = Number(r.rasio_ke_pcs);
      if (!rasioAcuanMap.has(k) || rasio > rasioAcuanMap.get(k)) rasioAcuanMap.set(k, rasio);
    }
    for (const item of dataListBarang) {
      const kode = String(item.kode_barang).trim();
      const hargaDasar = Number(barangMap.get(kode)?.harga_dasar) || 0;
      const rasioAcuan = rasioAcuanMap.get(kode) || 1;
      item.hpp_per_unit = (hargaDasar / rasioAcuan) * Number(item.rasio_ke_pcs);
    }

    //// END VALIDASI STOK ////

    // Generate No Faktur & Tanggal Format YYYY-MM-DD (Waktu Lokal)
    const now = new Date();
    const kodeFaktur = kode_faktur();

    const tglFakturFormatted = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(now);

    // ============================================================
    // LOGIKA TANGGAL PENGIRIMAN & TEMPO NET 12 (OTOMATIS)
    // ============================================================
    const tglPengirimanFormatted = input_tgl_kirim || tenggat_hutang || tglFakturFormatted;

    const dateKirim = new Date(tglPengirimanFormatted);
    dateKirim.setDate(dateKirim.getDate() + 12);
    const tglJatuhTempo = dateKirim.toISOString().split('T')[0];



    for (const item of dataListBarang) {
      const sub = (Number(item.jumlah) || 0) * (Number(item.harga_satuan) || 0);
      const d = Number(item.diskon) || 0;
      if (d < 0 || d > sub) {
        return res.status(400).json({ status: "error", message: `Diskon '${item.kode_barang}' tidak valid` });
      }
    }

    // ============================================================
    // LOGIKA HITUNG DISKON BARANG, PPN & GRAND TOTAL
    // ============================================================
    const total_kotor = dataListBarang.reduce((acc, item) => {
      const jumlah = Number(item.jumlah) || 0;
      const harga = Number(item.harga_satuan) || 0;
      const diskonItem = Number(item.diskon) || 0;
      return acc + ((jumlah * harga) - diskonItem);
    }, 0);

    const diskonGlobal = Number(input_diskon_global) || 0;

    const dpp_total = Math.max(0, total_kotor - diskonGlobal);
    const total_harga = dpp_total;

    const ppn_persen = Number(ppn) || 0;
    const ppn_nominal = Math.round((dpp_total * ppn_persen) / 100);

    const grand_total = dpp_total + ppn_nominal;

    const bayar = Number(total_dibayarkan_pelanggan) || 0;

    if (diskonGlobal < 0 || diskonGlobal > total_kotor) {
      return res.status(400).json({ message: 'Diskon global tidak valid' });
    }

    if (bayar < 0) {
      return res.status(400).json({ message: 'Jumlah pembayaran tidak valid' });
    }

    if (grand_total < 0) {
      return res.status(400).json({ message: 'Jumlah grand total tidak valid!' })
    }

    if (bayar > grand_total) {
      return res.status(400).json({
        message: `Jumlah pembayaran (${bayar}) melebihi total tagihan (${grand_total})`
      });
    }

    const sisaHutang = Math.max(grand_total - bayar, 0);

    const status_lunas = sisaHutang === 0 ? 'Lunas' : 'Belum lunas';
    const syarat_pembayaran = sisaHutang === 0 ? 'CASH' : 'NET 12'

    // 3. Prepare Data Detail untuk Bulk Insert
    const valuesPenjualanDetail = dataListBarang.map(item => {
      const jumlah = Number(item.jumlah) || 0;
      const harga = Number(item.harga_satuan) || 0;
      const diskonItem = Number(item.diskon) || 0;
      const subtotal = (jumlah * harga) - diskonItem;
      return [
        kodeFaktur,
        item.kode_barang,
        item.nama_satuan,
        jumlah,
        Number(item.qty_bonus || 0),
        harga,
        diskonItem,
        subtotal,
        // Number(item.hpp_per_unit || item.harga_dasar || 0)
        Number(item.hpp_per_unit) || 0
      ];
    });

    // 4. Batch Update Stok — PAKAI ListStokBarang yang sudah di-merge
    const caseParams = [];
    const caseStatements = ListStokBarang.map(item => {
      caseParams.push(item.kode_barang, item.jumlah_pembelian);
      return `WHEN ? THEN stok_pcs - ?`;
    }).join(' ');

    const kodeBarangList = ListStokBarang.map(item => item.kode_barang);

    const guardParams = [];
    const guardStatements = ListStokBarang.map(item => {
      guardParams.push(item.kode_barang, item.jumlah_pembelian);
      return `WHEN ? THEN stok_pcs >= ?`;
    }).join(' ');

    const sqlUpdateStokBatch = `
    UPDATE barang 
    SET stok_pcs = CASE kode_barang 
      ${caseStatements}
    END
    WHERE kode_barang IN (${kodeBarangList.map(() => '?').join(',')})
      AND (CASE kode_barang ${guardStatements} ELSE 0 END) = 1
  `;

    const updateQueryParams = [...caseParams, ...kodeBarangList, ...guardParams];

    // DB Transaction
    let connection;
    try {
      connection = await db.getConnection();
      await connection.beginTransaction();

      await connection.query(
        `INSERT INTO penjualan_header 
       (no_faktur, tgl_faktur, tanggal_pengiriman, jatuhtempo_faktur, id_admin, kode_pelanggan, dpp_total, ppn_persen, ppn_nominal, total_harga, grand_total, diskon_global, pembayaran, sisa_piutang, status, keterangan, sales, syarat_pembayaran) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? , ?)`,
        [
          kodeFaktur,
          tglFakturFormatted,
          tglPengirimanFormatted,
          tglJatuhTempo,
          id_admin,
          kode_pelanggan,
          dpp_total,
          ppn_persen,
          ppn_nominal,
          total_harga,
          grand_total,
          diskonGlobal,
          bayar,
          sisaHutang,
          status_lunas,
          'Belum ada keterangan',
          nama_sales,
          syarat_pembayaran
        ]
      );

      await connection.query(
        `INSERT INTO penjualan_detail 
       (no_faktur, kode_barang, satuan, jumlah_keluar, qty_bonus, harga_jual, diskon, total_harga, hpp_per_unit) 
      VALUES ?`,
        [valuesPenjualanDetail]
      );

      const [stokAwalRows] = await connection.query(
        `SELECT kode_barang, stok_pcs FROM barang WHERE kode_barang IN (?) FOR UPDATE`,
        [kodeBarangList]
      );
      const saldo = new Map(stokAwalRows.map(r => [r.kode_barang, Number(r.stok_pcs) || 0]));

      const [resultUpdateStok] = await connection.query(sqlUpdateStokBatch, updateQueryParams);

      if (resultUpdateStok.affectedRows !== kodeBarangList.length) {
        throw new Error('Stok berubah saat transaksi diproses (kemungkinan dibeli bersamaan oleh pembeli lain), silakan coba lagi');
      }

      const tglLog = new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
      }).format(now);

      const valuesStokLog = dataListBarang.map(item => {
        const kode = item.kode_barang;
        const rasio = Number(item.rasio_ke_pcs) || 1;

        const qtyInput = Number(item.jumlah) || 0;
        const bonusInput = Number(item.qty_bonus) || 0;
        const qtyPcs = (qtyInput + bonusInput) * rasio;

        const stokAwalNow = saldo.get(kode) ?? 0;
        const stokAkhirNow = stokAwalNow - qtyPcs;
        saldo.set(kode, stokAkhirNow);

        // const hppPerUnit = Number(item.hpp_per_unit || item.harga_dasar || 0);
        const hppPerUnit = Number(item.hpp_per_unit) || 0;
        const hppPerPcs = hppPerUnit / rasio;

        return [
          tglLog,
          kode,
          stokAwalNow,
          0,
          qtyPcs,
          stokAkhirNow,
          'PENJUALAN',
          'BAGUS',
          qtyPcs,
          -qtyPcs,
          String(item.nama_satuan || 'PCS').toUpperCase(),
          qtyInput > 0 ? qtyInput : bonusInput,
          'PENJUALAN',
          kodeFaktur,
          hppPerPcs,
          `Penjualan Kasir Faktur ${kodeFaktur}`,
          String(id_admin)
        ];
      });

      await connection.query(
        `INSERT INTO stok_log (
    tanggal, kode_barang, stok_awal, pembelian, penjualan, stok_akhir,
    jenis_transaksi, kondisi, jumlah, qty_perubahan,
    satuan_input, qty_input, referensi_tipe, referensi_no,
    hpp_per_pcs, keterangan, dibuat_oleh
  ) VALUES ?`,
        [valuesStokLog]
      );

      await connection.commit();

      return res.status(200).json({
        message: 'Transaksi berhasil diproses!',
        no_faktur: kodeFaktur,
        status: 200
      });

    } catch (err) {
      if (connection) {
        await connection.rollback();
      }

      console.error('Error ProsesPesanan:', err);
      return res.status(500).json({
        message: 'Gagal memproses pesanan',
        status: 500
      });
    } finally {
      if (connection) {
        connection.release();
      }
    }
  } catch (err) {
    console.error('Error ProsesPesanan (di luar transaksi):', err);
    if (!res.headersSent) {
      return res.status(500).json({
        message: 'Terjadi kesalahan pada server',
        status: 500
      });
    }
  }
}








// QUERY AMBIL FAKTUR PENJUALAN VERSI 2 (OPTIMASI) BACKEND //
export async function AMBIL_FAKTUR_PENJUALAN(req, res) {
  try {
    const { tanggalMulai, tanggalSelesai, page } = req.query;

    if (!tanggalMulai || !tanggalSelesai) {
      return res.status(400).json({
        success: false,
        message: "Parameter tanggalMulai dan tanggalSelesai wajib diisi!"
      });
    }

    const limit = 10;
    const currentPage = Math.max(1, parseInt(page, 10) || 1);
    const offset = (currentPage - 1) * limit;

    // ─────────────────────────────────────────────────────────────
    // Query 1: Hitung TOTAL keseluruhan faktur yang match filter tanggal.
    // ─────────────────────────────────────────────────────────────
    const countQuery = `
      SELECT COUNT(*) AS total
      FROM penjualan_header
      WHERE tanggal_pengiriman BETWEEN ? AND ?
    `;
    const [countRows] = await db.query(countQuery, [tanggalMulai, tanggalSelesai]);
    const totalData = countRows[0]?.total || 0;
    const totalPages = totalData > 0 ? Math.ceil(totalData / limit) : 0;

    // ─────────────────────────────────────────────────────────────
    // Query 2: Data faktur + detail item
    // Penyesuaian nama kolom:
    // - pj.diskon_global AS diskon (di-alias jadi 'diskon' agar cocok dengan frontend)
    // - pj.tanggal_pengiriman AS tgl_pengiriman
    // ─────────────────────────────────────────────────────────────
    const query = `
      SELECT 
        pj.no_faktur,
        pj.tgl_faktur,
        pj.jatuhtempo_faktur,
        pj.tanggal_pengiriman AS tgl_pengiriman,
        pj.pembayaran,
        pj.sisa_piutang,
        pj.status,
        pj.keterangan,
        pj.id_admin,
        COALESCE(adm.username, 'Admin Tidak Ditemukan') AS nama_admin,
        pj.kode_pelanggan,
        COALESCE(pel.nama_pelanggan, 'Pelanggan Umum') AS nama_pelanggan,
        COALESCE(pel.alamat, '-') AS alamat_pelanggan, 
        pj.sales,
        pj.syarat_pembayaran,
        pj.diskon_global AS diskon,
        COALESCE(pj.ppn_persen, 0) AS ppn, -- <-- TAMBAHKAN DI SINI
        IF(
          COUNT(pd.id_detail) = 0,
          JSON_ARRAY(),
          JSON_ARRAYAGG(
            JSON_OBJECT(
              'id_detail', pd.id_detail,
              'kode_barang', pd.kode_barang,
              'nama_barang', COALESCE(b.nama_barang, 'Barang Tidak Ditemukan'),
              'satuan', pd.satuan,
              'jumlah_keluar', pd.jumlah_keluar,
              'qty_bonus', COALESCE(pd.qty_bonus, 0),
              'harga_jual', pd.harga_jual,
              'diskon', pd.diskon,
              'total_harga', pd.total_harga,
              'hpp_per_unit', pd.hpp_per_unit,
              'stok_pcs', COALESCE(b.stok_pcs, 0)
            )
          )
        ) AS items
      FROM (
      SELECT * 
         FROM penjualan_header
         WHERE tanggal_pengiriman BETWEEN ? AND ?
         ORDER BY tanggal_pengiriman DESC, no_faktur DESC
         LIMIT ? OFFSET ?
      ) pj
      LEFT JOIN penjualan_detail pd ON pj.no_faktur = pd.no_faktur
      LEFT JOIN admin adm ON pj.id_admin = adm.id_admin
      LEFT JOIN pelanggan pel ON pj.kode_pelanggan = pel.kode_pelanggan
      LEFT JOIN barang b ON pd.kode_barang = b.kode_barang
      GROUP BY 
        pj.no_faktur,
        pj.tgl_faktur,
        pj.jatuhtempo_faktur,
        pj.tanggal_pengiriman,
        pj.pembayaran,
        pj.sisa_piutang,
        pj.status,
        pj.keterangan,
        pj.id_admin,
        adm.username,
        pj.kode_pelanggan,
        pel.nama_pelanggan,
        pel.alamat,
        pj.sales,
        pj.syarat_pembayaran,
        pj.diskon_global,
        pj.ppn_persen -- <-- TAMBAHKAN DI SINI
     ORDER BY pj.tanggal_pengiriman DESC, pj.no_faktur DESC;
    `;

    const [rows] = await db.query(query, [
      tanggalMulai,
      tanggalSelesai,
      Number(limit),
      Number(offset)
    ]);

    const formattedRows = rows.map((row) => ({
      ...row,
      items: typeof row.items === 'string' ? JSON.parse(row.items) : (row.items || [])
    }));

    // ── STATUS RETUR per faktur: null | 'SEBAGIAN' | 'HABIS' ──
    if (formattedRows.length > 0) {
      const daftarFaktur = formattedRows.map((r) => r.no_faktur);

      const [returInfo] = await db.query(
        `SELECT pd.no_faktur,
            pd.jumlah_keluar,
            COALESCE(bs.rasio_ke_pcs, 1) AS rasio,
            COALESCE(r.pcs, 0) AS retur_pcs
       FROM penjualan_detail pd
       LEFT JOIN barang_satuan bs
              ON bs.kode_barang = pd.kode_barang AND bs.nama_satuan = pd.satuan
       LEFT JOIN (
            SELECT rd.id_detail_penjualan, SUM(rd.qty_total_pcs) AS pcs
              FROM retur_detail rd
              JOIN penjualan_detail p2 ON p2.id_detail = rd.id_detail_penjualan
             WHERE p2.no_faktur IN (?)
             GROUP BY rd.id_detail_penjualan
       ) r ON r.id_detail_penjualan = pd.id_detail
      WHERE pd.no_faktur IN (?)`,
        [daftarFaktur, daftarFaktur]
      );

      const statusMap = new Map(); // no_faktur -> { pernah, semuaHabis, adaItem }
      for (const row of returInfo) {
        const jumlah = Number(row.jumlah_keluar) || 0;
        if (jumlah <= 0) continue; // baris bonus murni tidak bisa diretur, jangan dihitung
        const s = statusMap.get(row.no_faktur) || { pernah: false, semuaHabis: true, adaItem: false };
        const totalPcs = jumlah * (Number(row.rasio) || 1);
        const returPcs = Number(row.retur_pcs) || 0;
        s.adaItem = true;
        if (returPcs > 0) s.pernah = true;
        if (returPcs < totalPcs) s.semuaHabis = false;
        statusMap.set(row.no_faktur, s);
      }

      for (const f of formattedRows) {
        const s = statusMap.get(f.no_faktur);
        f.status_retur = !s || !s.pernah ? null : (s.adaItem && s.semuaHabis ? 'HABIS' : 'SEBAGIAN');
      }
    }

    return res.status(200).json({
      success: true,
      message: "Berhasil mengambil data faktur penjualan",
      pagination: {
        page: currentPage,
        limit: limit,
        total_data_page: formattedRows.length,
        total_data: totalData,
        total_pages: totalPages
      },
      data: formattedRows
    });

  } catch (error) {
    console.error("Error AMBIL_FAKTUR_PENJUALAN:", error);
    return res.status(500).json({
      success: false,
      message: "Terjadi kesalahan internal server",
      error: error.message
    });
  }
}