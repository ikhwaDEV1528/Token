import { db } from '../../db.js';
import { generateKodeBarang } from "../Barang/Buat_kode_barang.js";



// // PROSES BELANJA ASLI ORGINAL//

// class ValidationError extends Error {
//   constructor(message) {
//     super(message);
//     this.name = 'ValidationError';
//   }
// }


// export async function FunBelanjaBarang(req, res) {
//   const { faktur, ListPesanan } = req.body;

//   // 1. Destructuring data faktur
//   const no_faktur = faktur?.no_faktur;
//   const ppn = faktur?.ppn // field baru ppn
//   const supplier_id = faktur?.dataSupplier?.id_supplier;
//   const nama_supplier = faktur?.dataSupplier?.nama_supplier;
//   const tanggal_belanja = faktur?.tanggal_belanja;
//   const diskon_faktur = Number(faktur?.diskon_faktur) || 0;

//   // 2. Validasi input faktur
//   if (!no_faktur || !supplier_id || !nama_supplier || !tanggal_belanja) {
//     return res.status(400).json({ message: "Data Faktur ada yang belum terisi!" });
//   }

//   const rawDiskonFaktur = String(faktur?.diskon_faktur ?? '0').trim();
//   if (!/^\d+(\.\d{1,2})?$/.test(rawDiskonFaktur)) {
//     return res.status(400).json({
//       message: "Diskon faktur harus berupa angka murni 0-100 (tanpa %, koma, minus, atau huruf)!"
//     });
//   }

//   // 2b. FIX: diskon_faktur gak boleh negatif
//   if (diskon_faktur < 0) {
//     return res.status(400).json({ message: "Diskon faktur tidak boleh negatif!" });
//   }

//   // 3. Validasi list pesanan
//   if (!Array.isArray(ListPesanan) || ListPesanan.length === 0) {
//     return res.status(400).json({ message: "List pesanan kosong atau tidak valid!" });
//   }




//   // 3b. VALIDASI ITEM: jumlah & harga harus > 0, kode_barang wajib ada
//   for (const item of ListPesanan) {
//     const jumlah = Number(item.jumlah);
//     const harga = Number(item.harga_satuan ?? item.harga_dasar);
//     if (!jumlah || jumlah <= 0) {
//       return res.status(400).json({
//         message: `Jumlah beli untuk "${item.nama_barang || item.kode_barang || 'item'}" harus lebih dari 0!`
//       });
//     }

//     const rawJumlah = String(item?.jumlah ?? '').trim();
//     if (!/^\d+$/.test(rawJumlah) || !Number.isFinite(jumlah) || jumlah <= 0) {
//       return res.status(400).json({
//         status: "error",
//         message: `Jumlah pembelian untuk '${item.kode_barang}' tidak valid (harus angka murni lebih dari 0)`
//       });
//     }

//     if (isNaN(harga) || harga < 0) {
//       return res.status(400).json({
//         message: `Harga satuan untuk "${item.nama_barang || item.kode_barang || 'item'}" tidak valid!`
//       });
//     }

//     if (item.status !== 'BARANG BARU' && !item.kode_barang) {
//       return res.status(400).json({
//         message: `Kode barang wajib diisi untuk item "${item.nama_barang || 'item'}"!`
//       });
//     }
//   }

//   // 4. Hitung total harga & diskon faktur
//   // 4. Hitung total harga faktur (SETELAH DIPOTONG DISKON DISTRIBUTOR)
//   const total_harga = ListPesanan.reduce((acc, item) => {
//     const harga_satuan = Number(item.harga_satuan ?? item.harga_dasar) || 0;
//     const diskon_dist = Number(item.persentase_diskon_distributor) || 0;

//     // Modal bersih per item setelah diskon distributor
//     const modal_bersih = Math.max(0, harga_satuan - Math.round((harga_satuan * diskon_dist) / 100));
//     const jumlah = Number(item.jumlah) || 0;

//     return acc + (modal_bersih * jumlah);
//   }, 0);

//   const total_harga_setelah_diskon = Math.max(total_harga - diskon_faktur, 0);

//   // 🔴 TAMBAHKAN BARIS INI: Rasio Alokasi Diskon Faktur Global
//   const rasioFaktur = total_harga > 0 ? (total_harga_setelah_diskon / total_harga) : 1;

//   // 4b. [HUTANG SUPPLIER] Validasi pembayaran toko saat belanja.
//   // Nominal dibayar dari FE hanya dipakai sebagai input; sisa hutang & status
//   // SELALU dihitung ulang di server.
//   const rawDibayar = String(faktur?.dibayar ?? '').trim() || '0';
//   if (!/^\d{1,13}$/.test(rawDibayar)) {
//     return res.status(400).json({
//       message: "Nominal dibayar harus berupa angka bulat murni (tanpa titik, koma, minus, atau huruf)!"
//     });
//   }
//   const dibayar = Number(rawDibayar);
//   if (dibayar > total_harga_setelah_diskon) {
//     return res.status(400).json({
//       message: `Nominal dibayar (Rp ${dibayar.toLocaleString('id-ID')}) tidak boleh melebihi total belanja (Rp ${total_harga_setelah_diskon.toLocaleString('id-ID')})!`
//     });
//   }

//   const sisa_hutang = total_harga_setelah_diskon - dibayar;
//   const status_bayar = sisa_hutang > 0 ? 'HUTANG' : 'LUNAS';

//   // Jatuh tempo hanya relevan kalau masih ada sisa hutang (opsional).
//   let jatuh_tempo = null;
//   const rawJatuhTempo = String(faktur?.jatuh_tempo ?? '').trim();
//   if (sisa_hutang > 0 && rawJatuhTempo !== '') {
//     const cocok = /^(\d{4})-(\d{2})-(\d{2})$/.exec(rawJatuhTempo);
//     const tgl = cocok ? new Date(Date.UTC(+cocok[1], +cocok[2] - 1, +cocok[3])) : null;
//     const tanggalValid = tgl
//       && tgl.getUTCFullYear() === +cocok[1]
//       && tgl.getUTCMonth() === +cocok[2] - 1
//       && tgl.getUTCDate() === +cocok[3];
//     if (!tanggalValid) {
//       return res.status(400).json({ message: "Format jatuh tempo tidak valid (harus YYYY-MM-DD)!" });
//     }
//     const tglBelanja10 = String(tanggal_belanja).slice(0, 10);
//     if (/^\d{4}-\d{2}-\d{2}$/.test(tglBelanja10) && rawJatuhTempo < tglBelanja10) {
//       return res.status(400).json({ message: "Jatuh tempo tidak boleh sebelum tanggal belanja!" });
//     }
//     jatuh_tempo = rawJatuhTempo;
//   }

//   const connection = await db.getConnection();

//   try {
//     await connection.beginTransaction();

//     // A. GENERATE KODE BARANG UNTUK 'BARANG BARU'
//     // NOTE: pastikan generateKodeBarang() menghasilkan kode yang benar-benar unik.
//     // Kalau sampai collision dengan kode_barang yang sudah ada, INSERT ... ON
//     // DUPLICATE KEY UPDATE di bawah akan nganggep ini restok barang LAMA yang
//     // gak terkait, dan nyampur stok/harga dua barang yang sebenarnya berbeda.
//     for (let item of ListPesanan) {
//       if (item.status === 'BARANG BARU' && (!item.kode_barang || item.kode_barang === 'AUTO' || item.kode_barang === '')) {
//         item.kode_barang = generateKodeBarang();
//       }
//     }

//     // A2. BATCH PRE-FETCH
//     const kodeBarangRestok = [
//       ...new Set(
//         ListPesanan
//           .filter((it) => it.status !== 'BARANG BARU')
//           .map((it) => it.kode_barang)
//       )
//     ];

//     const satuanMap = new Map();
//     const persentaseExistingMap = new Map();

//     if (kodeBarangRestok.length > 0) {
//       const [satuanRowsAll] = await connection.query(
//         `SELECT id, kode_barang, nama_satuan, rasio_ke_pcs FROM barang_satuan WHERE kode_barang IN (?)`,
//         [kodeBarangRestok]
//       );
//       for (const row of satuanRowsAll) {
//         if (!satuanMap.has(row.kode_barang)) satuanMap.set(row.kode_barang, []);
//         satuanMap.get(row.kode_barang).push(row);
//       }

//       const [barangRowsAll] = await connection.query(
//         `SELECT kode_barang, persentase_diskon_distributor, persentase_fee_harga_jual 
//          FROM barang WHERE kode_barang IN (?)`,
//         [kodeBarangRestok]
//       );
//       for (const row of barangRowsAll) {
//         persentaseExistingMap.set(row.kode_barang, {
//           diskon: Number(row.persentase_diskon_distributor) || 0,
//           fee: Number(row.persentase_fee_harga_jual) || 0
//         });
//       }
//     }

//     // B. INSERT PEMBELIAN HEADER
//     const [rowsHeader] = await connection.query(
//       `INSERT INTO pembelian_header (no_faktur, supplier_id, nama_supplier, tanggal_belanja, subtotal, total_harga, diskon, created_at, dibayar, sisa_hutang, jatuh_tempo, status_bayar)
//        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//       [
//         no_faktur,
//         supplier_id,
//         nama_supplier,
//         tanggal_belanja,
//         total_harga,
//         total_harga_setelah_diskon,
//         diskon_faktur,
//         new Date(),
//         dibayar,
//         sisa_hutang,
//         jatuh_tempo,
//         status_bayar
//       ]
//     );

//     const id_pembelian = rowsHeader.insertId;

//     // C. MAPPING DATA PEMBELIAN DETAIL & UPDATE MASTER BARANG
//     const values_pembelian_detail = [];
//     const logItems = [];
//     const aggregatedBarang = new Map();
//     const values_insert_satuan = [];
//     const kodeBarangBaruSudahDiproses = new Set();

//     for (let item of ListPesanan) {
//       const harga_satuan = Number(item.harga_satuan ?? item.harga_dasar) || 0;
//       const jumlah_beli = Number(item.jumlah) || 0;
//       const status_item = item.status || "RESTOK";

//       let rasio = Number(item.rasio_ke_pcs);

//       if (!rasio || isNaN(rasio) || rasio <= 0) {
//         if (item.status === 'BARANG BARU') {
//           throw new ValidationError(
//             `Rasio (isi per satuan) untuk barang baru "${item.nama_barang || item.kode_barang}" wajib diisi!`
//           );
//         }

//         const kandidatSatuan = satuanMap.get(item.kode_barang) || [];
//         let baris = null;

//         if (item.id) {
//           baris = kandidatSatuan.find((r) => String(r.id) === String(item.id)) || null;
//         } else if (item.nama_satuan) {
//           baris = kandidatSatuan.find(
//             (r) => (r.nama_satuan || '').toUpperCase() === item.nama_satuan.toUpperCase()
//           ) || null;
//         } else {
//           throw new ValidationError(
//             `Satuan pembelian untuk "${item.nama_barang || item.kode_barang}" tidak jelas (id_satuan/nama_satuan tidak dikirim)!`
//           );
//         }

//         if (baris && Number(baris.rasio_ke_pcs) > 0) {
//           rasio = Number(baris.rasio_ke_pcs);
//         } else {
//           throw new ValidationError(
//             `Data satuan untuk "${item.nama_barang || item.kode_barang}" tidak ditemukan di database!`
//           );
//         }
//       }

//       const pcs_masuk = jumlah_beli * rasio;

//       // Ambil satuan yang dikirim FE. Jika kosong, baru default ke 'KARTON'
//       const namaSatuanItem = (item.nama_satuan || item.satuan || 'KARTON').toUpperCase();

//       let diskon_dist = Number(item.persentase_diskon_distributor);
//       let fee_jual = Number(item.persentase_fee_harga_jual);

//       if (isNaN(diskon_dist) || isNaN(fee_jual)) {
//         const existing = persentaseExistingMap.get(item.kode_barang);
//         diskon_dist = isNaN(diskon_dist) ? (existing?.diskon ?? 0) : diskon_dist;
//         fee_jual = isNaN(fee_jual) ? (existing?.fee ?? 0) : fee_jual;
//       }

//       // Modal bersih per item
//       const modal_bersih = Math.max(0, harga_satuan - Math.round((harga_satuan * diskon_dist) / 100));

//       // 🔴 TAMBAHKAN BARIS INI: Modal riil setelah dipotong diskon faktur
//       const modal_riil_faktur = modal_bersih * rasioFaktur;
//       // Subtotal per baris item dihitung dari modal bersih
//       const subtotal = modal_bersih * jumlah_beli;

//       const harga_jual = Math.round(modal_bersih * (1 + (fee_jual / 100)));
//       const margin = Math.round(harga_jual - modal_bersih);

//       values_pembelian_detail.push([
//         id_pembelian,
//         item.kode_barang,
//         harga_satuan,
//         jumlah_beli,
//         subtotal,
//         status_item,
//         namaSatuanItem // 👈 Menggunakan variabel ini, bukan string 'KARTON' keras
//       ]);

//       logItems.push({
//         kode_barang: item.kode_barang,
//         pcs_masuk,
//         qty_input: jumlah_beli,
//         satuan_input: namaSatuanItem,
//         hpp_per_pcs: modal_riil_faktur / rasio
//       });

//       // NOTE: kalau ada >1 baris di ListPesanan dengan kode_barang yang SAMA
//       // (misal beli barang sama dalam 2 satuan berbeda di 1 faktur), pcs_masuk
//       // di bawah diakumulasi dengan benar, TAPI harga_satuan/diskon_dist/fee_jual/
//       // harga_jual/margin akan KETIMPA baris yang diproses TERAKHIR, bukan digabung.
//       // Cek apakah ini memang perilaku yang diinginkan.
//       if (aggregatedBarang.has(item.kode_barang)) {
//         const existing = aggregatedBarang.get(item.kode_barang);
//         existing.pcs_masuk += pcs_masuk;
//         existing.harga_satuan = harga_satuan;
//         existing.diskon_dist = diskon_dist;
//         existing.fee_jual = fee_jual;
//         existing.harga_jual = harga_jual;
//         existing.margin = margin;
//         existing.nama_barang = item.nama_barang || existing.nama_barang;
//       } else {
//         aggregatedBarang.set(item.kode_barang, {
//           kode_barang: item.kode_barang,
//           nama_barang: item.nama_barang || "Tanpa Nama",
//           harga_satuan,
//           diskon_dist,
//           fee_jual,
//           harga_jual,
//           margin,
//           pcs_masuk,
//           rasio_utamanya: rasio // Simpan rasio satuan terbesar
//         });
//       }

//       if (item.status === 'BARANG BARU' && !kodeBarangBaruSudahDiproses.has(item.kode_barang)) {
//         kodeBarangBaruSudahDiproses.add(item.kode_barang);

//         const namaSatuanUtama = (item.nama_satuan || 'KARTON').toUpperCase();

//         values_insert_satuan.push([
//           item.kode_barang,
//           namaSatuanUtama,
//           rasio,
//           harga_jual,
//           3
//         ]);

//         if (Array.isArray(item.list_satuan)) {
//           item.list_satuan.forEach((s) => {
//             const namaSatuan = (s.nama_satuan || '').toUpperCase();
//             if (namaSatuan === namaSatuanUtama) return;

//             const rasioSatuan = Number(s.rasio_ke_pcs) || 0;
//             const hargaJualSatuan = Number(s.harga_jual) || 0;

//             if (rasioSatuan <= 0 || hargaJualSatuan <= 0) return;

//             values_insert_satuan.push([
//               item.kode_barang,
//               s.nama_satuan || 'SATUAN',
//               rasioSatuan,
//               hargaJualSatuan,
//               Number(s.level) || 1
//             ]);
//           });
//         }
//       }
//     }

//     const values_update_stok = Array.from(aggregatedBarang.values()).map((b) => [
//       b.kode_barang,
//       b.nama_barang,
//       b.harga_satuan,
//       b.diskon_dist,
//       b.fee_jual,
//       b.harga_jual,
//       b.margin,
//       b.pcs_masuk
//     ]);


//     // C2. Kunci baris barang lama & ambil stok awal (sebelum di-upsert)
//     const saldo = new Map();
//     if (kodeBarangRestok.length > 0) {
//       const [stokAwalRows] = await connection.query(
//         `SELECT kode_barang, stok_pcs FROM barang WHERE kode_barang IN (?) FOR UPDATE`,
//         [kodeBarangRestok]
//       );
//       for (const r of stokAwalRows) {
//         saldo.set(r.kode_barang, Number(r.stok_pcs) || 0);
//       }
//     }
//     // kode yang tidak ada di map = barang baru, stok awal 0

//     // D. UPSERT KE TABEL `barang` (MASTER PARENT)
//     await connection.query(
//       `INSERT INTO barang (
//         kode_barang, 
//         nama_barang, 
//         harga_dasar, 
//         persentase_diskon_distributor, 
//         persentase_fee_harga_jual, 
//         harga_jual_produk_ke_pelanggan, 
//         margin, 
//         stok_pcs
//       ) 
//        VALUES ? 
//        ON DUPLICATE KEY UPDATE 
//          stok_pcs = stok_pcs + VALUES(stok_pcs),
//          nama_barang = VALUES(nama_barang),
//          harga_dasar = VALUES(harga_dasar),
//          persentase_diskon_distributor = VALUES(persentase_diskon_distributor),
//          persentase_fee_harga_jual = VALUES(persentase_fee_harga_jual),
//          harga_jual_produk_ke_pelanggan = VALUES(harga_jual_produk_ke_pelanggan),
//          margin = VALUES(margin)`,
//       [values_update_stok]
//     );

//     // E. INSERT KE `pembelian_detail` (CHILD TABLE)
//     await connection.query(
//       `INSERT INTO pembelian_detail (pembelian_id, kode_barang, harga_satuan, jumlah, subtotal, status,satuan) 
//        VALUES ?`,
//       [values_pembelian_detail]
//     );


//         // H. CATAT KE STOK_LOG (satu baris per item, running balance per kode barang)
//     const tglLog = new Intl.DateTimeFormat('sv-SE', {
//       timeZone: 'Asia/Jakarta',
//       year: 'numeric', month: '2-digit', day: '2-digit',
//       hour: '2-digit', minute: '2-digit', second: '2-digit',
//       hour12: false
//     }).format(new Date()); // YYYY-MM-DD HH:mm:ss

//     const valuesStokLog = logItems.map((l) => {
//       const stokAwalNow = saldo.get(l.kode_barang) ?? 0;
//       const stokAkhirNow = stokAwalNow + l.pcs_masuk;
//       saldo.set(l.kode_barang, stokAkhirNow); // kode duplikat tetap berurutan

//       return [
//         tglLog,                 // tanggal
//         l.kode_barang,          // kode_barang
//         stokAwalNow,            // stok_awal
//         l.pcs_masuk,            // pembelian
//         0,                      // penjualan
//         stokAkhirNow,           // stok_akhir
//         'PEMBELIAN',            // jenis_transaksi
//         'BAGUS',                // kondisi
//         l.pcs_masuk,            // jumlah (PCS, positif)
//         l.pcs_masuk,            // qty_perubahan (+ masuk)
//         l.satuan_input,         // satuan_input
//         l.qty_input,            // qty_input
//         'PEMBELIAN',            // referensi_tipe
//         no_faktur,              // referensi_no
//         l.hpp_per_pcs,          // hpp_per_pcs
//         `Pembelian dari ${nama_supplier} Faktur ${no_faktur}`, // keterangan
//         req.id_admin ? String(req.id_admin) : null             // dibuat_oleh
//       ];
//     });

//     await connection.query(
//       `INSERT INTO stok_log (
//         tanggal, kode_barang, stok_awal, pembelian, penjualan, stok_akhir,
//         jenis_transaksi, kondisi, jumlah, qty_perubahan,
//         satuan_input, qty_input, referensi_tipe, referensi_no,
//         hpp_per_pcs, keterangan, dibuat_oleh
//       ) VALUES ?`,
//       [valuesStokLog]
//     );

//     // F. BULK INSERT `barang_satuan` UNTUK BARANG BARU
//     if (values_insert_satuan.length > 0) {
//       await connection.query(
//         `INSERT INTO barang_satuan (kode_barang, nama_satuan, rasio_ke_pcs, harga_jual, level) 
//          VALUES ?`,
//         [values_insert_satuan]
//       );
//     }

//     // G. UPDATE HARGA JUAL SATUAN BERDASARKAN LEVEL SATUAN (100% DINAMIS)
//     const listKodeBarang = Array.from(aggregatedBarang.keys());
//     if (listKodeBarang.length > 0) {
//       await connection.query(
//         `UPDATE barang_satuan bs
//          JOIN barang b ON bs.kode_barang = b.kode_barang
//          JOIN (
//            SELECT kode_barang, rasio_ke_pcs 
//            FROM barang_satuan 
//            WHERE level = 3 AND kode_barang IN (?)
//          ) bs_max ON bs.kode_barang = bs_max.kode_barang
//          SET bs.harga_jual = CASE 
//            WHEN bs.level = 3 THEN b.harga_jual_produk_ke_pelanggan
//            ELSE ROUND((b.harga_jual_produk_ke_pelanggan / NULLIF(bs_max.rasio_ke_pcs, 0)) * bs.rasio_ke_pcs)
//          END
//          WHERE bs.kode_barang IN (?)`,
//         [listKodeBarang, listKodeBarang]
//       );
//     }



//     // COMMIT TRANSAKSI
//     await connection.commit();

//     return res.status(200).json({
//       success: true,
//       message: "Transaksi belanja berhasil diselesaikan dan stok PCS berhasil diupdate!",
//       pembelian_id: id_pembelian,
//       subtotal: total_harga,
//       total_harga: total_harga_setelah_diskon,
//       dibayar,
//       sisa_hutang,
//       status_bayar,
//     });

//   } catch (err) {
//     await connection.rollback();
//     console.error("Error BelanjaBarang Transaction:", err);

//     // FIX: error validasi bisnis (ValidationError) -> 400, bukan 500
//     if (err instanceof ValidationError) {
//       return res.status(400).json({ message: err.message });
//     }

//     // FIX: no_faktur duplikat (unique constraint) -> 409 + pesan jelas
//     if (err.code === 'ER_DUP_ENTRY') {
//       return res.status(409).json({ message: "No faktur ini sudah pernah diinput sebelumnya!" });
//     }

//     // FIX: error server/DB lain -> 500, TANPA expose err.message mentah ke client
//     return res.status(500).json({
//       message: "Gagal menyimpan transaksi belanja, silahkan coba lagi.",
//     });

//   } finally {
//     connection.release();
//   }
// }





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

  // Rasio Diskon Faktur Murni
  const total_harga_setelah_diskon = Math.max(0, total_harga - diskon_faktur);
  const rasioFaktur = total_harga > 0 ? (total_harga_setelah_diskon / total_harga) : 1;

  // Hitung DPP & PPN Faktur
  const dpp_total = total_harga_setelah_diskon;
  const ppn_nominal = Math.round((dpp_total * ppn_persen) / 100);
  const grand_total = dpp_total + ppn_nominal;

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

    if (kodeBarangRestok.length > 0) {
      const [satuanRowsAll] = await connection.query(
        `SELECT id, kode_barang, nama_satuan, rasio_ke_pcs FROM barang_satuan WHERE kode_barang IN (?)`,
        [kodeBarangRestok]
      );
      for (const row of satuanRowsAll) {
        if (!satuanMap.has(row.kode_barang)) satuanMap.set(row.kode_barang, []);
        satuanMap.get(row.kode_barang).push(row);
      }

      const [barangRowsAll] = await connection.query(
        `SELECT kode_barang, persentase_diskon_distributor, persentase_fee_harga_jual 
         FROM barang WHERE kode_barang IN (?)`,
        [kodeBarangRestok]
      );
      for (const row of barangRowsAll) {
        persentaseExistingMap.set(row.kode_barang, {
          diskon: Number(row.persentase_diskon_distributor) || 0,
          fee: Number(row.persentase_fee_harga_jual) || 0
        });
      }
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
      const namaSatuanItem = (item.nama_satuan || item.satuan || 'KARTON').toUpperCase();
      const namaSatuanBonus = (item.nama_satuan_bonus || namaSatuanItem).toUpperCase();

      let diskon_dist = Number(item.persentase_diskon_distributor);
      let fee_jual = Number(item.persentase_fee_harga_jual);

      if (isNaN(diskon_dist) || isNaN(fee_jual)) {
        const existing = persentaseExistingMap.get(item.kode_barang);
        diskon_dist = isNaN(diskon_dist) ? (existing?.diskon ?? 0) : diskon_dist;
        fee_jual = isNaN(fee_jual) ? (existing?.fee ?? 0) : fee_jual;
      }

      // Modal bersih per item
      const modal_bersih = Math.max(0, harga_satuan - Math.round((harga_satuan * diskon_dist) / 100));

      // Modal riil setelah dipotong diskon faktur & alokasi PPN
      const modal_riil_faktur = modal_bersih * rasioFaktur;
      const subtotal = modal_bersih * jumlah_beli;

      const harga_jual = Math.round(modal_bersih * (1 + (fee_jual / 100)));
      const margin = Math.round(harga_jual - modal_bersih);

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