import { db } from '../../db.js';
import { generateKodeBarang } from "../Barang/Buat_kode_barang.js";



class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

export async function FunBelanjaBarang(req, res) {
  const { faktur, ListPesanan } = req.body;

  // 1. Destructuring data faktur
  const no_faktur = faktur?.no_faktur;
  const supplier_id = faktur?.dataSupplier?.id_supplier;
  const nama_supplier = faktur?.dataSupplier?.nama_supplier;
  const tanggal_belanja = faktur?.tanggal_belanja;
  const diskon_faktur = Number(faktur?.diskon_faktur) || 0;

  // PPN Persen (default 0 jika tidak dikirim)
  const ppn_persen = Number(faktur?.ppn ?? 0) || 0;

  // 2. Validasi input faktur
  if (!no_faktur || !supplier_id || !nama_supplier || !tanggal_belanja) {
    return res.status(400).json({ message: "Data Faktur ada yang belum terisi!" });
  }

  // GUARD: cegah object/array masuk ke query
  if ([no_faktur, supplier_id, nama_supplier, tanggal_belanja].some((v) => typeof v === 'object')) {
    return res.status(400).json({ message: "Format data faktur tidak valid!" });
  }
  if (!/^\d+$/.test(String(supplier_id))) {
    return res.status(400).json({ message: "ID supplier tidak valid!" });
  }

  // GUARD: tanggal belanja harus tanggal yang benar (YYYY-MM-DD)
  const mTgl = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(tanggal_belanja).slice(0, 10));
  const dTgl = mTgl ? new Date(Date.UTC(+mTgl[1], +mTgl[2] - 1, +mTgl[3])) : null;
  if (
    !dTgl ||
    dTgl.getUTCFullYear() !== +mTgl[1] ||
    dTgl.getUTCMonth() !== +mTgl[2] - 1 ||
    dTgl.getUTCDate() !== +mTgl[3] ||
    +mTgl[1] < 2000 || +mTgl[1] > 2100
  ) {
    return res.status(400).json({ message: "Tanggal belanja tidak valid!" });
  }


  const rawDiskonFaktur = String(faktur?.diskon_faktur ?? '0').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(rawDiskonFaktur)) {
    return res.status(400).json({
      message: "Diskon faktur harus berupa angka murni 0-100 (tanpa %, koma, minus, atau huruf)!"
    });
  }

  if (diskon_faktur < 0) {
    return res.status(400).json({ message: "Diskon faktur tidak boleh negatif!" });
  }

  if (ppn_persen < 0 || ppn_persen > 100) {
    return res.status(400).json({ message: "Persentase PPN harus antara 0 - 100%!" });
  }

  // 3. Validasi list pesanan
  if (!Array.isArray(ListPesanan) || ListPesanan.length === 0) {
    return res.status(400).json({ message: "List pesanan kosong atau tidak valid!" });
  }

  if (ListPesanan.length > 100) {
    return res.status(400).json({ message: "Jumlah item dalam satu faktur terlalu banyak!" });
  }

  for (const item of ListPesanan) {
    const jumlah = Number(item.jumlah) || 0;
    const harga = Number(item.harga_satuan ?? item.harga_dasar) || 0;
    const qty_bonus = Number(item.qty_bonus) || 0;

    // === ADJUSTMENT 1: Tolak HANYA JIKA jumlah <= 0 DAN qty_bonus JUGA <= 0 ===
    if (jumlah <= 0 && qty_bonus <= 0) {
      return res.status(400).json({
        message: `Jumlah beli/bonus untuk "${item.nama_barang || item.kode_barang || 'item'}" harus lebih dari 0!`
      });
    }

    const rawJumlah = String(item?.jumlah ?? '').trim();
    if (!/^\d+$/.test(rawJumlah) || !Number.isFinite(jumlah) || jumlah < 0) {
      return res.status(400).json({
        status: "error",
        message: `Jumlah pembelian untuk '${item.kode_barang}' tidak valid!`
      });
    }

    // Validasi qty_bonus (kosong dianggap 0, harus angka bulat >= 0)
    const rawQtyBonus = String(item?.qty_bonus ?? '').trim() || '0';
    if (!/^\d{1,9}$/.test(rawQtyBonus)) {
      return res.status(400).json({
        message: `Bonus untuk "${item.nama_barang || item.kode_barang || 'item'}" harus angka bulat 0 atau lebih (tanpa titik, koma, minus, atau huruf)!`
      });
    }

    if (isNaN(harga) || harga < 0) {
      return res.status(400).json({
        message: `Harga satuan untuk "${item.nama_barang || item.kode_barang || 'item'}" tidak valid!`
      });
    }

    if (item.status !== 'BARANG BARU' && !item.kode_barang) {
      return res.status(400).json({
        message: `Kode barang wajib diisi untuk item "${item.nama_barang || 'item'}"!`
      });
    }

    // GUARD: item harus object, field teks harus string
    if (!item || typeof item !== 'object') {
      return res.status(400).json({ message: "Data item tidak valid!" });
    }
    for (const f of ['kode_barang', 'nama_barang', 'nama_satuan', 'satuan', 'nama_satuan_bonus', 'status']) {
      if (item[f] !== undefined && item[f] !== null && typeof item[f] !== 'string') {
        return res.status(400).json({ message: `Field ${f} tidak valid!` });
      }
    }

    // GUARD: batas wajar angka
    const rasioIn = Number(item.rasio_ke_pcs) || 0;
    const rasioBonusIn = Number(item.rasio_bonus_ke_pcs) || 0;
    if (jumlah > 999999999 || qty_bonus > 999999999 || harga > 9999999999 || rasioIn > 1000000 || rasioBonusIn > 1000000) {
      return res.status(400).json({
        message: `Nilai angka untuk "${item.nama_barang || item.kode_barang || 'item'}" melebihi batas wajar!`
      });
    }

    // GUARD: persentase (hanya jika dikirim FE)
    for (const [f, max] of [['persentase_diskon_distributor', 100], ['persentase_fee_harga_jual', 1000]]) {
      const raw = item[f];
      if (raw !== undefined && raw !== null && raw !== '') {
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0 || n > max) {
          return res.status(400).json({
            message: `${f} untuk "${item.nama_barang || item.kode_barang || 'item'}" harus 0 - ${max}!`
          });
        }
      }
    }

    // GUARD: khusus BARANG BARU (datanya 100% dari FE, jadi dibatasi ketat)
    if (item.status === 'BARANG BARU') {
      if (!String(item.nama_barang ?? '').trim()) {
        return res.status(400).json({ message: "Nama barang baru wajib diisi!" });
      }
      if (jumlah <= 0) {
        return res.status(400).json({ message: `Barang baru "${item.nama_barang}" harus dibeli lebih dari 0!` });
      }
      if (jumlah > 0 && harga <= 0) {
        return res.status(400).json({ message: `Harga beli barang baru "${item.nama_barang}" wajib lebih dari 0!` });
      }
      const namaUtama = (item.nama_satuan || 'KARTON').toUpperCase();
      if (!['KARTON', 'BALL'].includes(namaUtama)) {
        return res.status(400).json({ message: `Satuan beli "${item.nama_barang}" harus KARTON atau BALL!` });
      }
      if (Array.isArray(item.list_satuan)) {
        const sudahAda = new Set([namaUtama]);
        for (const s of item.list_satuan) {
          const nm = String(s?.nama_satuan || '').toUpperCase();
          if (nm === namaUtama) continue;
          if ((Number(s?.rasio_ke_pcs) || 0) <= 0 || (Number(s?.harga_jual) || 0) <= 0) continue;
          const lvl = Number(s?.level) || 1;
          if (lvl !== 1 && lvl !== 2) {
            return res.status(400).json({ message: `Level satuan "${nm}" harus 1 atau 2!` });
          }
          if (sudahAda.has(nm)) {
            return res.status(400).json({ message: `Satuan "${nm}" duplikat!` });
          }
          sudahAda.add(nm);
        }
      }
    }

    // GUARD: baris bonus murni (qty beli 0) tidak boleh membawa harga
    if (jumlah <= 0 && harga > 0) {
      return res.status(400).json({
        message: `Barang "${item.nama_barang || item.kode_barang || 'item'}" tanpa qty beli tidak boleh punya harga!`
      });
    }
  }

  // 4. Hitung total harga & diskon faktur
  // (Bonus TIDAK ikut dihitung: barang gratis tidak menambah tagihan / hutang)
  const total_harga = ListPesanan.reduce((acc, item) => {
    const harga_satuan = Number(item.harga_satuan ?? item.harga_dasar) || 0;
    const diskon_dist = Number(item.persentase_diskon_distributor) || 0;
    const modal_bersih = Math.max(0, harga_satuan - Math.round((harga_satuan * diskon_dist) / 100));
    const jumlah = Number(item.jumlah) || 0;

    return acc + (modal_bersih * jumlah);
  }, 0);

  // GUARD: diskon faktur tidak boleh lebih besar dari total harga
  if (diskon_faktur > total_harga) {
    return res.status(400).json({ message: "Diskon faktur tidak boleh melebihi total harga barang!" });
  }

  // Rasio Diskon Faktur Murni
  const total_harga_setelah_diskon = Math.max(0, total_harga - diskon_faktur);
  const rasioFaktur = total_harga > 0 ? (total_harga_setelah_diskon / total_harga) : 1;

  // Hitung DPP & PPN Faktur
  const dpp_total = total_harga_setelah_diskon;
  const ppn_nominal = Math.round((dpp_total * ppn_persen) / 100);
  const grand_total = dpp_total + ppn_nominal;


  // GUARD: batas wajar total belanja (kolom total_harga bertipe int, maks ~2,1 miliar)
  if (grand_total > 2000000000 || total_harga > 2000000000) {
    return res.status(400).json({ message: "Total belanja melebihi batas wajar!" });
  }

  // [HUTANG SUPPLIER] Validasi pembayaran toko
  const rawDibayar = String(faktur?.dibayar ?? '').trim() || '0';
  if (!/^\d{1,13}$/.test(rawDibayar)) {
    return res.status(400).json({
      message: "Nominal dibayar harus berupa angka bulat murni (tanpa titik, koma, minus, atau huruf)!"
    });
  }
  const dibayar = Number(rawDibayar);
  if (dibayar > grand_total) {
    return res.status(400).json({
      message: `Nominal dibayar (Rp ${dibayar.toLocaleString('id-ID')}) tidak boleh melebihi grand total belanja (Rp ${grand_total.toLocaleString('id-ID')})!`
    });
  }

  const sisa_hutang = grand_total - dibayar;
  const status_bayar = sisa_hutang > 0 ? 'HUTANG' : 'LUNAS';

  let jatuh_tempo = null;
  const rawJatuhTempo = String(faktur?.jatuh_tempo ?? '').trim();
  if (sisa_hutang > 0 && rawJatuhTempo !== '') {
    const cocok = /^(\d{4})-(\d{2})-(\d{2})$/.exec(rawJatuhTempo);
    const tgl = cocok ? new Date(Date.UTC(+cocok[1], +cocok[2] - 1, +cocok[3])) : null;
    const tanggalValid = tgl
      && tgl.getUTCFullYear() === +cocok[1]
      && tgl.getUTCMonth() === +cocok[2] - 1
      && tgl.getUTCDate() === +cocok[3];
    if (!tanggalValid) {
      return res.status(400).json({ message: "Format jatuh tempo tidak valid (harus YYYY-MM-DD)!" });
    }
    const tglBelanja10 = String(tanggal_belanja).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(tglBelanja10) && rawJatuhTempo < tglBelanja10) {
      return res.status(400).json({ message: "Jatuh tempo tidak boleh sebelum tanggal belanja!" });
    }
    jatuh_tempo = rawJatuhTempo;
  }

  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    // A. GENERATE KODE BARANG UNTUK 'BARANG BARU'
    for (let item of ListPesanan) {
      if (item.status === 'BARANG BARU' && (!item.kode_barang || item.kode_barang === 'AUTO' || item.kode_barang === '')) {
        item.kode_barang = generateKodeBarang();
      }
    }

    // A2. BATCH PRE-FETCH
    const kodeBarangRestok = [
      ...new Set(
        ListPesanan
          .filter((it) => it.status !== 'BARANG BARU')
          .map((it) => it.kode_barang)
      )
    ];

    const satuanMap = new Map();
    const persentaseExistingMap = new Map();
    const barangDbMap = new Map();

    if (kodeBarangRestok.length > 0) {
      const [satuanRowsAll] = await connection.query(
        `SELECT id, kode_barang, nama_satuan, rasio_ke_pcs, is_active_satuan FROM barang_satuan WHERE kode_barang IN (?)`,
        [kodeBarangRestok]
      );
      for (const row of satuanRowsAll) {
        if (!satuanMap.has(row.kode_barang)) satuanMap.set(row.kode_barang, []);
        satuanMap.get(row.kode_barang).push(row);
      }

      const [barangRowsAll] = await connection.query(
        `SELECT kode_barang, nama_barang, is_active, persentase_diskon_distributor, persentase_fee_harga_jual 
         FROM barang WHERE kode_barang IN (?)`,
        [kodeBarangRestok]
      );
      for (const row of barangRowsAll) {
        barangDbMap.set(row.kode_barang, { nama: row.nama_barang, aktif: Number(row.is_active) === 1 });
        persentaseExistingMap.set(row.kode_barang, {
          diskon: Number(row.persentase_diskon_distributor) || 0,
          fee: Number(row.persentase_fee_harga_jual) || 0
        });
      }
    }

    // GUARD: supplier harus ada di DB & namanya cocok
    const [supRows] = await connection.query(
      `SELECT id_supplier, nama_supplier FROM supplier WHERE id_supplier = ?`,
      [Number(supplier_id)]
    );
    if (supRows.length === 0) {
      throw new ValidationError("Supplier tidak ditemukan di database!");
    }
    if (String(supRows[0].nama_supplier).trim().toUpperCase() !== String(nama_supplier).trim().toUpperCase()) {
      throw new ValidationError("Nama supplier tidak sesuai database, muat ulang data supplier!");
    }

    // GUARD: barang restok wajib ada & aktif di DB
    for (const kode of kodeBarangRestok) {
      const info = barangDbMap.get(kode);
      if (!info) {
        throw new ValidationError(`Barang dengan kode "${kode}" tidak ditemukan di database!`);
      }
      if (!info.aktif) {
        throw new ValidationError(`Barang "${info.nama}" sedang nonaktif, tidak bisa dibeli!`);
      }
    }

    // GUARD: 'BARANG BARU' tidak boleh memakai kode yang sudah ada di DB
    const kodeBarangBaruList = [
      ...new Set(ListPesanan.filter((it) => it.status === 'BARANG BARU').map((it) => it.kode_barang))
    ];
    if (kodeBarangBaruList.length > 0) {
      const [kodeBentrok] = await connection.query(
        `SELECT kode_barang FROM barang WHERE kode_barang IN (?)`,
        [kodeBarangBaruList]
      );
      if (kodeBentrok.length > 0) {
        throw new ValidationError(`Kode barang "${kodeBentrok[0].kode_barang}" sudah terdaftar, tidak bisa diinput sebagai barang baru!`);
      }
    }

    // GUARD: faktur yang sama dari supplier yang sama tidak boleh diinput dua kali
    const [fakturAda] = await connection.query(
      `SELECT 1 FROM pembelian_header WHERE no_faktur = ? AND supplier_id = ? LIMIT 1`,
      [no_faktur, Number(supplier_id)]
    );
    if (fakturAda.length > 0) {
      throw new ValidationError("No faktur ini sudah pernah diinput untuk supplier tersebut!");
    }

    // B. INSERT PEMBELIAN HEADER
    const [rowsHeader] = await connection.query(
      `INSERT INTO pembelian_header (
        no_faktur, supplier_id, nama_supplier, tanggal_belanja, 
        subtotal, diskon, dpp_total, ppn_persen, ppn_nominal, grand_total, total_harga, 
        created_at, dibayar, sisa_hutang, jatuh_tempo, status_bayar
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        no_faktur,
        supplier_id,
        nama_supplier,
        tanggal_belanja,
        total_harga,
        diskon_faktur,
        dpp_total,
        ppn_persen,
        ppn_nominal,
        grand_total,
        grand_total,
        new Date(),
        dibayar,
        sisa_hutang,
        jatuh_tempo,
        status_bayar
      ]
    );

    const id_pembelian = rowsHeader.insertId;

    // C. MAPPING DATA PEMBELIAN DETAIL & UPDATE MASTER BARANG
    const values_pembelian_detail = [];
    const logItems = [];
    const aggregatedBarang = new Map();
    const values_insert_satuan = [];
    const kodeBarangBaruSudahDiproses = new Set();

    for (let item of ListPesanan) {
      const harga_satuan = Number(item.harga_satuan ?? item.harga_dasar) || 0;
      const jumlah_beli = Number(item.jumlah) || 0;
      const status_item = item.status || "RESTOK";
      const qty_bonus = Number(item.qty_bonus) || 0;

      // Rasio Satuan Utama
      let rasio = Number(item.rasio_ke_pcs);

      if (!rasio || isNaN(rasio) || rasio <= 0) {
        if (item.status === 'BARANG BARU') {
          throw new ValidationError(
            `Rasio (isi per satuan) untuk barang baru "${item.nama_barang || item.kode_barang}" wajib diisi!`
          );
        }

        const kandidatSatuan = satuanMap.get(item.kode_barang) || [];
        let baris = null;

        if (item.id || item.id_satuan) {
          const searchId = String(item.id_satuan || item.id);
          baris = kandidatSatuan.find((r) => String(r.id) === searchId) || null;
        } else if (item.nama_satuan) {
          baris = kandidatSatuan.find(
            (r) => (r.nama_satuan || '').toUpperCase() === item.nama_satuan.toUpperCase()
          ) || null;
        } else {
          throw new ValidationError(
            `Satuan pembelian untuk "${item.nama_barang || item.kode_barang}" tidak jelas!`
          );
        }

        if (baris && Number(baris.rasio_ke_pcs) > 0) {
          rasio = Number(baris.rasio_ke_pcs);
        } else {
          throw new ValidationError(
            `Data satuan untuk "${item.nama_barang || item.kode_barang}" tidak ditemukan di database!`
          );
        }
      }

      // === ADJUSTMENT 2: Rasio Satuan Bonus Fleksibel ===
      let rasioBonus = Number(item.rasio_bonus_ke_pcs);
      if (!rasioBonus || isNaN(rasioBonus) || rasioBonus <= 0) {
        rasioBonus = rasio; // Fallback ke rasio utama jika tidak dikirim
      }

      // TOTAL PCS MASUK = (Qty Beli x Rasio Beli) + (Qty Bonus x Rasio Bonus)
      const pcs_masuk = (jumlah_beli * rasio) + (qty_bonus * rasioBonus);

      // GUARD: batas wajar PCS masuk per baris (cegah stok_pcs meluber)
      if (pcs_masuk > 100000000) { // 100 juta PCS, sesuaikan skala toko lu
        throw new ValidationError(`Jumlah PCS masuk untuk "${item.nama_barang || item.kode_barang}" melebihi batas wajar!`);
      }

      const namaSatuanItem = (item.nama_satuan || item.satuan || 'KARTON').toUpperCase();
      const namaSatuanBonus = (item.nama_satuan_bonus || namaSatuanItem).toUpperCase();

      // GUARD: untuk RESTOK, satuan/rasio/nama harus sesuai DB (FE tidak dipercaya)
      if (item.status !== 'BARANG BARU') {
        const info = barangDbMap.get(item.kode_barang);
        const kandidat = (satuanMap.get(item.kode_barang) || [])
          .filter((r) => Number(r.is_active_satuan) === 1);

        // Satuan terbesar = rasio tertinggi (sama dengan pilihan FE)
        const barisTerbesar = [...kandidat].sort(
          (a, b) => Number(b.rasio_ke_pcs) - Number(a.rasio_ke_pcs)
        )[0];
        if (!barisTerbesar) {
          throw new ValidationError(`Satuan aktif untuk "${info?.nama || item.kode_barang}" belum terdaftar di database!`);
        }

        if (jumlah_beli > 0) {
          if ((barisTerbesar.nama_satuan || '').toUpperCase() !== namaSatuanItem) {
            throw new ValidationError(`Belanja "${info?.nama}" harus memakai satuan ${barisTerbesar.nama_satuan}, bukan "${namaSatuanItem}"!`);
          }
          if (Number(barisTerbesar.rasio_ke_pcs) !== rasio) {
            throw new ValidationError(`Rasio satuan "${namaSatuanItem}" untuk "${info?.nama}" tidak sesuai database, muat ulang data barang!`);
          }
        }

        if (qty_bonus > 0) {
          const barisBonus = kandidat.find((r) => (r.nama_satuan || '').toUpperCase() === namaSatuanBonus);
          if (!barisBonus) {
            throw new ValidationError(`Satuan bonus "${namaSatuanBonus}" untuk "${info?.nama}" tidak terdaftar/aktif di database!`);
          }
          if (Number(barisBonus.rasio_ke_pcs) !== rasioBonus) {
            throw new ValidationError(`Rasio satuan bonus "${namaSatuanBonus}" untuk "${info?.nama}" tidak sesuai database!`);
          }
        }

        // Nama barang restok selalu dari DB
        item.nama_barang = info?.nama ?? item.nama_barang;
      }

      let diskon_dist = Number(item.persentase_diskon_distributor);
      let fee_jual = Number(item.persentase_fee_harga_jual);

      if (isNaN(diskon_dist) || isNaN(fee_jual)) {
        const existing = persentaseExistingMap.get(item.kode_barang);
        diskon_dist = isNaN(diskon_dist) ? (existing?.diskon ?? 0) : diskon_dist;
        fee_jual = isNaN(fee_jual) ? (existing?.fee ?? 0) : fee_jual;
      }

      // Modal bersih per item
      const modal_bersih = Math.max(0, harga_satuan - Math.round((harga_satuan * diskon_dist) / 100));

      // GUARD: barang yang dibeli tidak boleh bermodal 0 (cegah harga jual di DB tertimpa 0)
      if (jumlah_beli > 0 && modal_bersih <= 0) {
        throw new ValidationError(`Harga setelah diskon untuk "${item.nama_barang || item.kode_barang}" tidak boleh 0!`);
      }

      // Modal riil setelah dipotong diskon faktur & alokasi PPN
      const modal_riil_faktur = modal_bersih * rasioFaktur;
      const subtotal = modal_bersih * jumlah_beli;

      // const harga_jual = Math.round(modal_bersih * (1 + (fee_jual / 100)));
      // const margin = Math.round(harga_jual - modal_bersih);

      // Margin dihitung dari harga beli KOTOR (sebelum diskon), lalu ditambah ke modal bersih
      const margin = Math.round((harga_satuan * fee_jual) / 100);
      const harga_jual = modal_bersih + margin;

      // values_pembelian_detail.push([
      //   id_pembelian,
      //   item.kode_barang,
      //   harga_satuan,
      //   jumlah_beli,
      //   subtotal,
      //   status_item,
      //   namaSatuanItem,
      //   qty_bonus
      // ]);

      // Row 1: barang yang dibeli (bonus TIDAK digabung lagi di sini)
      if (jumlah_beli > 0) {
        values_pembelian_detail.push([
          id_pembelian,
          item.kode_barang,
          harga_satuan,
          jumlah_beli,
          subtotal,
          status_item,
          namaSatuanItem,
          0               // qty_bonus = 0, bonus pindah ke row sendiri
        ]);
      }

      // Row 2: barang bonus (row terpisah, satuan bonus sendiri, harga & subtotal 0)
      if (qty_bonus > 0) {
        values_pembelian_detail.push([
          id_pembelian,
          item.kode_barang,
          0,                // harga_satuan = 0
          0,                // jumlah = 0
          0,                // subtotal = 0
          status_item,
          namaSatuanBonus,  // satuan bonus (PCS/PACK/dll), bukan satuan beli
          qty_bonus
        ]);
      }

      logItems.push({
        kode_barang: item.kode_barang,
        pcs_masuk,
        qty_input: jumlah_beli,
        qty_bonus,
        satuan_input: namaSatuanItem,
        satuan_bonus_input: namaSatuanBonus,
        // HPP Per PCS otomatis menyesuaikan akumulasi total PCS yang masuk dari Beli + Bonus
        hpp_per_pcs: pcs_masuk > 0 ? (modal_riil_faktur * jumlah_beli) / pcs_masuk : 0
      });

      if (aggregatedBarang.has(item.kode_barang)) {
        const existing = aggregatedBarang.get(item.kode_barang);
        existing.pcs_masuk += pcs_masuk;
        if (harga_satuan > 0) {
          existing.harga_satuan = harga_satuan;
          existing.diskon_dist = diskon_dist;
          existing.fee_jual = fee_jual;
          existing.harga_jual = harga_jual;
          existing.margin = margin;
        }
        existing.nama_barang = item.nama_barang || existing.nama_barang;
      } else {
        aggregatedBarang.set(item.kode_barang, {
          kode_barang: item.kode_barang,
          nama_barang: item.nama_barang || "Tanpa Nama",
          harga_satuan,
          diskon_dist,
          fee_jual,
          harga_jual,
          margin,
          pcs_masuk,
          rasio_utamanya: rasio
        });
      }

      if (item.status === 'BARANG BARU' && !kodeBarangBaruSudahDiproses.has(item.kode_barang)) {
        kodeBarangBaruSudahDiproses.add(item.kode_barang);

        const namaSatuanUtama = (item.nama_satuan || 'KARTON').toUpperCase();

        values_insert_satuan.push([
          item.kode_barang,
          namaSatuanUtama,
          rasio,
          harga_jual,
          3
        ]);

        if (Array.isArray(item.list_satuan)) {
          item.list_satuan.forEach((s) => {
            const namaSatuan = (s.nama_satuan || '').toUpperCase();
            if (namaSatuan === namaSatuanUtama) return;

            const rasioSatuan = Number(s.rasio_ke_pcs) || 0;
            const hargaJualSatuan = Number(s.harga_jual) || 0;

            if (rasioSatuan <= 0 || hargaJualSatuan <= 0) return;

            values_insert_satuan.push([
              item.kode_barang,
              s.nama_satuan || 'SATUAN',
              rasioSatuan,
              hargaJualSatuan,
              Number(s.level) || 1
            ]);
          });
        }
      }
    }

    const values_update_stok = Array.from(aggregatedBarang.values()).map((b) => [
      b.kode_barang,
      b.nama_barang,
      b.harga_satuan,
      b.diskon_dist,
      b.fee_jual,
      b.harga_jual,
      b.margin,
      b.pcs_masuk
    ]);

    // C2. Kunci baris barang lama & ambil stok awal
    const saldo = new Map();
    if (kodeBarangRestok.length > 0) {
      const [stokAwalRows] = await connection.query(
        `SELECT kode_barang, stok_pcs FROM barang WHERE kode_barang IN (?) FOR UPDATE`,
        [kodeBarangRestok]
      );
      for (const r of stokAwalRows) {
        saldo.set(r.kode_barang, Number(r.stok_pcs) || 0);
      }
    }



    // D. UPSERT KE TABEL `barang` (MASTER PARENT)
    await connection.query(
      `INSERT INTO barang (
        kode_barang, 
        nama_barang, 
        harga_dasar, 
        persentase_diskon_distributor, 
        persentase_fee_harga_jual, 
        harga_jual_produk_ke_pelanggan, 
        margin, 
        stok_pcs
      ) 
        VALUES ? 
        ON DUPLICATE KEY UPDATE 
          stok_pcs = stok_pcs + VALUES(stok_pcs),
          nama_barang = VALUES(nama_barang),
          harga_dasar = IF(VALUES(harga_dasar) > 0, VALUES(harga_dasar), harga_dasar),
          persentase_diskon_distributor = IF(VALUES(harga_dasar) > 0, VALUES(persentase_diskon_distributor), persentase_diskon_distributor),
          persentase_fee_harga_jual = IF(VALUES(harga_dasar) > 0, VALUES(persentase_fee_harga_jual), persentase_fee_harga_jual),
          harga_jual_produk_ke_pelanggan = IF(VALUES(harga_dasar) > 0, VALUES(harga_jual_produk_ke_pelanggan), harga_jual_produk_ke_pelanggan),
          margin = IF(VALUES(harga_dasar) > 0, VALUES(margin), margin)`,
      [values_update_stok]
    );

    // E. INSERT KE `pembelian_detail` (CHILD TABLE)
    await connection.query(
      `INSERT INTO pembelian_detail (pembelian_id, kode_barang, harga_satuan, jumlah, subtotal, status, satuan, qty_bonus) 
        VALUES ?`,
      [values_pembelian_detail]
    );

    // H. CATAT KE STOK_LOG
    const tglLog = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false
    }).format(new Date());

    const valuesStokLog = logItems.map((l) => {
      const stokAwalNow = saldo.get(l.kode_barang) ?? 0;
      const stokAkhirNow = stokAwalNow + l.pcs_masuk;
      saldo.set(l.kode_barang, stokAkhirNow);

      return [
        tglLog,
        l.kode_barang,
        stokAwalNow,
        l.pcs_masuk,
        0,
        stokAkhirNow,
        'PEMBELIAN',
        'BAGUS',
        l.pcs_masuk,
        l.pcs_masuk,
        l.satuan_input,
        l.qty_input,
        'PEMBELIAN',
        no_faktur,
        l.hpp_per_pcs,
        `Pembelian dari ${nama_supplier} Faktur ${no_faktur}${l.qty_bonus > 0 ? ` (termasuk bonus ${l.qty_bonus} ${l.satuan_bonus_input})` : ''}`,
        req.id_admin ? String(req.id_admin) : null
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

    // F. BULK INSERT `barang_satuan` UNTUK BARANG BARU
    if (values_insert_satuan.length > 0) {
      await connection.query(
        `INSERT INTO barang_satuan (kode_barang, nama_satuan, rasio_ke_pcs, harga_jual, level) 
          VALUES ?`,
        [values_insert_satuan]
      );
    }

    // G. UPDATE HARGA JUAL SATUAN BERDASARKAN LEVEL SATUAN
    const listKodeBarang = Array.from(aggregatedBarang.keys());
    if (listKodeBarang.length > 0) {
      await connection.query(
        `UPDATE barang_satuan bs
          JOIN barang b ON bs.kode_barang = b.kode_barang
          JOIN (
            SELECT kode_barang, rasio_ke_pcs 
            FROM barang_satuan 
            WHERE level = 3 AND kode_barang IN (?)
          ) bs_max ON bs.kode_barang = bs_max.kode_barang
          SET bs.harga_jual = CASE 
            WHEN bs.level = 3 THEN b.harga_jual_produk_ke_pelanggan
            ELSE ROUND((b.harga_jual_produk_ke_pelanggan / NULLIF(bs_max.rasio_ke_pcs, 0)) * bs.rasio_ke_pcs)
          END
          WHERE bs.kode_barang IN (?)`,
        [listKodeBarang, listKodeBarang]
      );
    }

    // COMMIT TRANSAKSI
    await connection.commit();

    return res.status(200).json({
      success: true,
      message: "Transaksi belanja berhasil diselesaikan dan stok PCS berhasil diupdate!",
      pembelian_id: id_pembelian,
      subtotal: total_harga,
      diskon: diskon_faktur,
      dpp_total,
      ppn_persen,
      ppn_nominal,
      grand_total,
      dibayar,
      sisa_hutang,
      status_bayar,
    });

  } catch (err) {
    await connection.rollback();
    console.error("Error BelanjaBarang Transaction:", err);

    if (err instanceof ValidationError) {
      return res.status(400).json({ message: err.message });
    }

    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: "No faktur ini sudah pernah diinput sebelumnya!" });
    }

    return res.status(500).json({
      message: "Gagal menyimpan transaksi belanja, silahkan coba lagi.",
    });

  } finally {
    connection.release();
  }
}

// END PROSES BELANJA //







const REGEX_TANGGAL = /^\d{4}-\d{2}-\d{2}$/;
const LIMIT_PER_HALAMAN = 10;

function tanggalValid(str) {
  if (typeof str !== 'string' || !REGEX_TANGGAL.test(str)) return false;
  const [y, m, d] = str.split('-').map(Number);
  const tgl = new Date(Date.UTC(y, m - 1, d));
  return (
    tgl.getUTCFullYear() === y &&
    tgl.getUTCMonth() === m - 1 &&
    tgl.getUTCDate() === d
  );
}

export async function AMBIL_FAKTUR_BELANJA(req, res) {
  try {
    const { tanggalMulai, tanggalSelesai, page } = req.query;

    // 1. Validasi input
    if (!tanggalMulai || !tanggalSelesai) {
      return res.status(400).json({
        success: false,
        message: 'Parameter tanggalMulai dan tanggalSelesai wajib diisi!'
      });
    }

    if (!tanggalValid(tanggalMulai) || !tanggalValid(tanggalSelesai)) {
      return res.status(400).json({
        success: false,
        message: 'Format tanggal tidak valid (harus YYYY-MM-DD)!'
      });
    }

    if (tanggalMulai > tanggalSelesai) {
      return res.status(400).json({
        success: false,
        message: 'Tanggal mulai tidak boleh setelah tanggal selesai!'
      });
    }

    const limit = LIMIT_PER_HALAMAN;
    const currentPage = Math.max(1, parseInt(page, 10) || 1);
    const offset = (currentPage - 1) * limit;

    // Filter tanggal inklusif sampai akhir hari (aman untuk kolom DATE maupun DATETIME)
    const filterTanggal = `tanggal_belanja >= ? AND tanggal_belanja < DATE_ADD(?, INTERVAL 1 DAY)`;

    // 2. Total data (untuk pagination)
    const [countRows] = await db.query(
      `SELECT COUNT(*) AS total FROM pembelian_header WHERE ${filterTanggal}`,
      [tanggalMulai, tanggalSelesai]
    );
    const totalData = Number(countRows[0]?.total) || 0;
    const totalPages = totalData > 0 ? Math.ceil(totalData / limit) : 0;

    // 3. Header faktur (dibatasi per halaman)
    const [headers] = await db.query(
      `SELECT
         id, no_faktur, supplier_id, nama_supplier, tanggal_belanja,
         total_harga, diskon, created_at, subtotal, dpp_total,
         ppn_persen, ppn_nominal, grand_total
       FROM pembelian_header
       WHERE ${filterTanggal}
       ORDER BY tanggal_belanja DESC, id DESC
       LIMIT ? OFFSET ?`,
      [tanggalMulai, tanggalSelesai, limit, offset]
    );

    // 4. Detail item untuk seluruh header di halaman ini (1 query, tanpa JSON_ARRAYAGG)
    const itemsByFaktur = new Map();

    if (headers.length > 0) {
      const idList = headers.map((h) => h.id);

      const [details] = await db.query(
        `SELECT
           pd.id,
           pd.pembelian_id,
           pd.kode_barang,
           COALESCE(b.nama_barang, 'Tanpa Nama') AS nama_barang,
           COALESCE(b.persentase_diskon_distributor, 0) AS persentase_diskon_distributor,
           pd.harga_satuan,
           pd.jumlah,
           COALESCE(pd.qty_bonus, 0) AS qty_bonus,
           pd.satuan,
           pd.subtotal,
           pd.status
         FROM pembelian_detail pd
         LEFT JOIN barang b ON b.kode_barang = pd.kode_barang
         WHERE pd.pembelian_id IN (?)
         ORDER BY pd.pembelian_id ASC, pd.id ASC`,
        [idList]
      );

      for (const d of details) {
        const jumlah = Number(d.jumlah) || 0;
        const qtyBonus = Number(d.qty_bonus) || 0;

        const item = {
          id: d.id,
          kode_barang: d.kode_barang,
          nama_barang: d.nama_barang,
          persentase_diskon_distributor: Number(d.persentase_diskon_distributor) || 0,
          harga_satuan: Number(d.harga_satuan) || 0,
          jumlah,
          qty_bonus: qtyBonus,
          satuan: d.satuan,
          subtotal: Number(d.subtotal) || 0,
          status: d.status,
          // Row bonus murni (format baru): tidak ada qty beli, hanya qty bonus
          is_bonus: jumlah === 0 && qtyBonus > 0
        };

        if (!itemsByFaktur.has(d.pembelian_id)) itemsByFaktur.set(d.pembelian_id, []);
        itemsByFaktur.get(d.pembelian_id).push(item);
      }
    }

    // 5. Gabungkan header + item
    const data = headers.map((h) => ({
      ...h,
      items: itemsByFaktur.get(h.id) || []
    }));

    return res.status(200).json({
      success: true,
      message: 'Berhasil mengambil data faktur belanja',
      pagination: {
        page: currentPage,
        limit,
        total_data_page: data.length,
        total_data: totalData,
        total_pages: totalPages
      },
      data
    });
  } catch (error) {
    console.error('Error AMBIL_FAKTUR_BELANJA:', error);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan internal server'
    });
  }
}