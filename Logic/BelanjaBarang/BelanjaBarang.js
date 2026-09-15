import db from "../../db.js";
import { generateKodeBarang } from "../Barang/Buat_kode_barang.js";





// INPUT DATA BELANJA FAKTUR //

// export async function FunBelanjaBarang(req, res) {
//   const { faktur, ListPesanan } = req.body;

//   // 1. Destructuring data faktur
//   const no_faktur = faktur?.no_faktur;
//   const supplier_id = faktur?.dataSupplier?.id_supplier;
//   const nama_supplier = faktur?.dataSupplier?.nama_supplier;
//   const tanggal_belanja = faktur?.tanggal_belanja;
//   const diskon_faktur = Number(faktur?.diskon_faktur) || 0;

//   // 2. Validasi input faktur
//   if (!no_faktur || !supplier_id || !nama_supplier || !tanggal_belanja) {
//     return res.status(400).json({ message: "Data Faktur ada yang belum terisi!" });
//   }

//   // 3. Validasi list pesanan
//   if (!Array.isArray(ListPesanan) || ListPesanan.length === 0) {
//     return res.status(400).json({ message: "List pesanan kosong atau tidak valid!" });
//   }

//   // 3b. VALIDASI ITEM: jumlah & harga harus > 0
//   for (const item of ListPesanan) {
//     const jumlah = Number(item.jumlah);
//     const harga = Number(item.harga_satuan ?? item.harga_dasar);
//     if (!jumlah || jumlah <= 0) {
//       return res.status(400).json({
//         message: `Jumlah beli untuk "${item.nama_barang || item.kode_barang || 'item'}" harus lebih dari 0!`
//       });
//     }
//     if (isNaN(harga) || harga < 0) {
//       return res.status(400).json({
//         message: `Harga satuan untuk "${item.nama_barang || item.kode_barang || 'item'}" tidak valid!`
//       });
//     }
//   }

//   // 4. Hitung total harga & diskon faktur
//   const total_harga = ListPesanan.reduce((acc, item) => {
//     const harga_satuan = Number(item.harga_satuan ?? item.harga_dasar) || 0;
//     const jumlah = Number(item.jumlah) || 0;
//     return acc + (harga_satuan * jumlah);
//   }, 0);

//   const total_harga_setelah_diskon = Math.max(total_harga - diskon_faktur, 0);

//   const connection = await db.getConnection();

//   try {
//     await connection.beginTransaction();

//     // A. GENERATE KODE BARANG UNTUK 'BARANG BARU'
//     for (let item of ListPesanan) {
//       if (item.status === 'BARANG BARU' && (!item.kode_barang || item.kode_barang === 'AUTO' || item.kode_barang === '')) {
//         item.kode_barang = generateKodeBarang();
//       }
//     }

//     // B. INSERT PEMBELIAN HEADER
//     const [rowsHeader] = await connection.query(
//       `INSERT INTO pembelian_header (no_faktur, supplier_id, nama_supplier, tanggal_belanja, total_harga, diskon, created_at) 
//        VALUES (?, ?, ?, ?, ?, ?, ?)`,
//       [
//         no_faktur,
//         supplier_id,
//         nama_supplier,
//         tanggal_belanja,
//         total_harga_setelah_diskon,
//         diskon_faktur,
//         new Date()
//       ]
//     );

//     const id_pembelian = rowsHeader.insertId;

//     // C. MAPPING DATA PEMBELIAN DETAIL & UPDATE MASTER BARANG
//     const values_pembelian_detail = [];
//     const aggregatedBarang = new Map(); // kode_barang -> accumulated data barang

//     // BARU: kumpulkan baris-baris barang_satuan yang perlu di-insert
//     // khusus untuk item berstatus BARANG BARU (barang lama sudah punya
//     // baris satuan sendiri, jadi tidak disentuh di sini)
//     const values_insert_satuan = [];
//     const kodeBarangBaruSudahDiproses = new Set(); // cegah insert satuan dobel kalau kode_barang sama muncul >1x di ListPesanan

//     for (let item of ListPesanan) {
//       const harga_satuan = Number(item.harga_satuan ?? item.harga_dasar) || 0;
//       const jumlah_beli = Number(item.jumlah) || 0;
//       const subtotal = harga_satuan * jumlah_beli;
//       const status_item = item.status || "RESTOK";

//       // --- HITUNG KONVERSI STOK PCS SECARA AKURAT ---
//       let rasio = Number(item.rasio_ke_pcs);

//       if (!rasio || isNaN(rasio) || rasio <= 0) {
//         if (item.status === 'BARANG BARU') {
//           throw new Error(
//             `Rasio (isi per satuan) untuk barang baru "${item.nama_barang || item.kode_barang}" wajib diisi!`
//           );
//         }

//         let sqlSatuan;
//         let paramsSatuan;

//         if (item.id_satuan) {
//           sqlSatuan = `SELECT rasio_ke_pcs FROM barang_satuan WHERE id = ? AND kode_barang = ? LIMIT 1`;
//           paramsSatuan = [item.id_satuan, item.kode_barang];
//         } else if (item.nama_satuan) {
//           sqlSatuan = `SELECT rasio_ke_pcs FROM barang_satuan WHERE kode_barang = ? AND UPPER(nama_satuan) = UPPER(?) LIMIT 1`;
//           paramsSatuan = [item.kode_barang, item.nama_satuan];
//         } else {
//           throw new Error(
//             `Satuan pembelian untuk "${item.nama_barang || item.kode_barang}" tidak jelas (id_satuan/nama_satuan tidak dikirim)!`
//           );
//         }

//         const [satuanRows] = await connection.query(sqlSatuan, paramsSatuan);

//         if (satuanRows.length > 0 && Number(satuanRows[0].rasio_ke_pcs) > 0) {
//           rasio = Number(satuanRows[0].rasio_ke_pcs);
//         } else {
//           throw new Error(
//             `Data satuan untuk "${item.nama_barang || item.kode_barang}" tidak ditemukan di database!`
//           );
//         }
//       }

//       const pcs_masuk = jumlah_beli * rasio;

//       values_pembelian_detail.push([
//         id_pembelian,
//         item.kode_barang,
//         harga_satuan,
//         jumlah_beli,
//         subtotal,
//         status_item
//       ]);

//       // Parameter Master Barang
//       const diskon_dist = Number(item.persentase_diskon_distributor) || 0;
//       const fee_jual = Number(item.persentase_fee_harga_jual) || 0;

//       const modal_bersih = harga_satuan - (harga_satuan * (diskon_dist / 100));
//       const harga_jual = Math.round(modal_bersih * (1 + (fee_jual / 100)));
//       const margin = Math.round(harga_jual - modal_bersih);

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
//           pcs_masuk
//         });
//       }

//       // ============================================
//       // BARU: SIAPKAN INSERT KE `barang_satuan` UNTUK BARANG BARU
//       // ============================================
//       if (item.status === 'BARANG BARU' && !kodeBarangBaruSudahDiproses.has(item.kode_barang)) {
//         kodeBarangBaruSudahDiproses.add(item.kode_barang);

//         // Baris KARTON — diturunkan dari data pembelian utama item ini
//         // (rasio = isi per karton, harga_jual = hasil kalkulasi modal+fee di atas)
//         values_insert_satuan.push([
//           item.kode_barang,
//           'KARTON',
//           rasio,
//           harga_jual,
//           3 // level 3 = KARTON, konsisten dengan skema yang sudah ada
//         ]);

//         // Baris satuan tambahan (PACK, PCS, dll) — diambil dari
//         // item.list_satuan yang dikirim FE saat user set harga eceran
//         // untuk barang baru ini. Item KARTON di-skip di sini karena
//         // sudah ditangani di atas (hindari baris dobel).
//         if (Array.isArray(item.list_satuan)) {
//           item.list_satuan.forEach((s) => {
//             const namaSatuan = (s.nama_satuan || '').toUpperCase();
//             if (namaSatuan === 'KARTON') return;

//             const rasioSatuan = Number(s.rasio_ke_pcs) || 0;
//             const hargaJualSatuan = Number(s.harga_jual) || 0;

//             // Skip satuan yang belum diisi rasio/harganya — jangan
//             // masukin baris sampah (rasio 0 atau harga 0) ke DB
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

//     // D. BULK INSERT PEMBELIAN DETAIL
//     await connection.query(
//       `INSERT INTO pembelian_detail (pembelian_id, kode_barang, harga_satuan, jumlah, subtotal, status) 
//        VALUES ?`,
//       [values_pembelian_detail]
//     );

//     // E. BULK UPDATE/INSERT STOK PCS MASTER BARANG
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
//          harga_dasar = VALUES(harga_dasar),
//          persentase_diskon_distributor = VALUES(persentase_diskon_distributor),
//          persentase_fee_harga_jual = VALUES(persentase_fee_harga_jual),
//          harga_jual_produk_ke_pelanggan = VALUES(harga_jual_produk_ke_pelanggan),
//          margin = VALUES(margin)`,
//       [values_update_stok]
//     );

//     // F. BARU: BULK INSERT `barang_satuan` UNTUK BARANG BARU
//     // Ini WAJIB dijalankan SETELAH insert ke tabel `barang` di atas,
//     // karena `barang_satuan` kemungkinan besar punya foreign key
//     // ke `barang.kode_barang` — kalau urutannya dibalik, insert ini
//     // akan gagal karena kode_barang induknya belum ada.
//     if (values_insert_satuan.length > 0) {
//       await connection.query(
//         `INSERT INTO barang_satuan (kode_barang, nama_satuan, rasio_ke_pcs, harga_jual, level) 
//          VALUES ?`,
//         [values_insert_satuan]
//       );
//     }

//     // COMMIT TRANSAKSI
//     await connection.commit();

//     return res.status(200).json({
//       success: true,
//       message: "Transaksi belanja berhasil diselesaikan dan stok PCS berhasil diupdate!",
//       pembelian_id: id_pembelian,
//     });

//   } catch (err) {
//     await connection.rollback();
//     console.error("Error BelanjaBarang Transaction:", err);

//     return res.status(500).json({
//       message: err.message || "Gagal menyimpan transaksi belanja!",
//       error: err.message,
//     });
//   } finally {
//     connection.release();
//   }
// }




export async function FunBelanjaBarang(req, res) {
  const { faktur, ListPesanan } = req.body;

  // 1. Destructuring data faktur
  const no_faktur = faktur?.no_faktur;
  const supplier_id = faktur?.dataSupplier?.id_supplier;
  const nama_supplier = faktur?.dataSupplier?.nama_supplier;
  const tanggal_belanja = faktur?.tanggal_belanja;
  const diskon_faktur = Number(faktur?.diskon_faktur) || 0;

  // 2. Validasi input faktur
  if (!no_faktur || !supplier_id || !nama_supplier || !tanggal_belanja) {
    return res.status(400).json({ message: "Data Faktur ada yang belum terisi!" });
  }

  // 3. Validasi list pesanan
  if (!Array.isArray(ListPesanan) || ListPesanan.length === 0) {
    return res.status(400).json({ message: "List pesanan kosong atau tidak valid!" });
  }

  // 3b. VALIDASI ITEM: jumlah & harga harus > 0, kode_barang wajib ada
  for (const item of ListPesanan) {
    const jumlah = Number(item.jumlah);
    const harga = Number(item.harga_satuan ?? item.harga_dasar);
    if (!jumlah || jumlah <= 0) {
      return res.status(400).json({
        message: `Jumlah beli untuk "${item.nama_barang || item.kode_barang || 'item'}" harus lebih dari 0!`
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
  const total_harga = ListPesanan.reduce((acc, item) => {
    const harga_satuan = Number(item.harga_satuan ?? item.harga_dasar) || 0;
    const jumlah = Number(item.jumlah) || 0;
    return acc + (harga_satuan * jumlah);
  }, 0);

  const total_harga_setelah_diskon = Math.max(total_harga - diskon_faktur, 0);

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
      `INSERT INTO pembelian_header (no_faktur, supplier_id, nama_supplier, tanggal_belanja, total_harga, diskon, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        no_faktur,
        supplier_id,
        nama_supplier,
        tanggal_belanja,
        total_harga_setelah_diskon,
        diskon_faktur,
        new Date()
      ]
    );

    const id_pembelian = rowsHeader.insertId;

    // C. MAPPING DATA PEMBELIAN DETAIL & UPDATE MASTER BARANG
    const values_pembelian_detail = [];
    const aggregatedBarang = new Map();
    const values_insert_satuan = [];
    const kodeBarangBaruSudahDiproses = new Set();

    for (let item of ListPesanan) {
      const harga_satuan = Number(item.harga_satuan ?? item.harga_dasar) || 0;
      const jumlah_beli = Number(item.jumlah) || 0;
      const subtotal = harga_satuan * jumlah_beli;
      const status_item = item.status || "RESTOK";

      let rasio = Number(item.rasio_ke_pcs);

      if (!rasio || isNaN(rasio) || rasio <= 0) {
        if (item.status === 'BARANG BARU') {
          throw new Error(
            `Rasio (isi per satuan) untuk barang baru "${item.nama_barang || item.kode_barang}" wajib diisi!`
          );
        }

        const kandidatSatuan = satuanMap.get(item.kode_barang) || [];
        let baris = null;

        if (item.id_satuan) {
          baris = kandidatSatuan.find((r) => String(r.id) === String(item.id_satuan)) || null;
        } else if (item.nama_satuan) {
          baris = kandidatSatuan.find(
            (r) => (r.nama_satuan || '').toUpperCase() === item.nama_satuan.toUpperCase()
          ) || null;
        } else {
          throw new Error(
            `Satuan pembelian untuk "${item.nama_barang || item.kode_barang}" tidak jelas (id_satuan/nama_satuan tidak dikirim)!`
          );
        }

        if (baris && Number(baris.rasio_ke_pcs) > 0) {
          rasio = Number(baris.rasio_ke_pcs);
        } else {
          throw new Error(
            `Data satuan untuk "${item.nama_barang || item.kode_barang}" tidak ditemukan di database!`
          );
        }
      }

      const pcs_masuk = jumlah_beli * rasio;

      values_pembelian_detail.push([
        id_pembelian,
        item.kode_barang,
        harga_satuan,
        jumlah_beli,
        subtotal,
        status_item
      ]);

      let diskon_dist = Number(item.persentase_diskon_distributor);
      let fee_jual = Number(item.persentase_fee_harga_jual);

      if (isNaN(diskon_dist) || isNaN(fee_jual)) {
        const existing = persentaseExistingMap.get(item.kode_barang);
        diskon_dist = isNaN(diskon_dist) ? (existing?.diskon ?? 0) : diskon_dist;
        fee_jual = isNaN(fee_jual) ? (existing?.fee ?? 0) : fee_jual;
      }

      const modal_bersih = harga_satuan - (harga_satuan * (diskon_dist / 100));
      const harga_jual = Math.round(modal_bersih * (1 + (fee_jual / 100)));
      const margin = Math.round(harga_jual - modal_bersih);

      if (aggregatedBarang.has(item.kode_barang)) {
        const existing = aggregatedBarang.get(item.kode_barang);
        existing.pcs_masuk += pcs_masuk;
        existing.harga_satuan = harga_satuan;
        existing.diskon_dist = diskon_dist;
        existing.fee_jual = fee_jual;
        existing.harga_jual = harga_jual;
        existing.margin = margin;
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
          rasio_karton: rasio // Simpan rasio karton untuk kalkulasi presisi
        });
      }

      if (item.status === 'BARANG BARU' && !kodeBarangBaruSudahDiproses.has(item.kode_barang)) {
        kodeBarangBaruSudahDiproses.add(item.kode_barang);

        values_insert_satuan.push([
          item.kode_barang,
          'KARTON',
          rasio,
          harga_jual,
          3
        ]);

        if (Array.isArray(item.list_satuan)) {
          item.list_satuan.forEach((s) => {
            const namaSatuan = (s.nama_satuan || '').toUpperCase();
            if (namaSatuan === 'KARTON') return;

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
         harga_dasar = VALUES(harga_dasar),
         persentase_diskon_distributor = VALUES(persentase_diskon_distributor),
         persentase_fee_harga_jual = VALUES(persentase_fee_harga_jual),
         harga_jual_produk_ke_pelanggan = VALUES(harga_jual_produk_ke_pelanggan),
         margin = VALUES(margin)`,
      [values_update_stok]
    );

    // E. INSERT KE `pembelian_detail` (CHILD TABLE)
    await connection.query(
      `INSERT INTO pembelian_detail (pembelian_id, kode_barang, harga_satuan, jumlah, subtotal, status) 
       VALUES ?`,
      [values_pembelian_detail]
    );

    // F. BULK INSERT `barang_satuan` UNTUK BARANG BARU
    if (values_insert_satuan.length > 0) {
      await connection.query(
        `INSERT INTO barang_satuan (kode_barang, nama_satuan, rasio_ke_pcs, harga_jual, level) 
         VALUES ?`,
        [values_insert_satuan]
      );
    }

    // G. SINGLE BULK UPDATE KE `barang_satuan` (Bebas Bug Subquery - 100% AMAN & STABIL)
    const listKodeBarang = Array.from(aggregatedBarang.keys());
    if (listKodeBarang.length > 0) {
      await connection.query(
        `UPDATE barang_satuan bs
         JOIN barang b ON bs.kode_barang = b.kode_barang
         SET bs.harga_jual = CASE 
           WHEN bs.nama_satuan = 'KARTON' OR bs.level = 3 THEN b.harga_jual_produk_ke_pelanggan
           ELSE ROUND((b.harga_jual_produk_ke_pelanggan / NULLIF(b.stok_pcs, 0)) * bs.rasio_ke_pcs)
         END
         WHERE bs.kode_barang IN (?)`,
        [listKodeBarang]
      );
    }

    // COMMIT TRANSAKSI
    await connection.commit();

    return res.status(200).json({
      success: true,
      message: "Transaksi belanja berhasil diselesaikan dan stok PCS berhasil diupdate!",
      pembelian_id: id_pembelian,
    });

  } catch (err) {
    await connection.rollback();
    console.error("Error BelanjaBarang Transaction:", err);

    return res.status(500).json({
      message: err.message || "Gagal menyimpan transaksi belanja!",
      error: err.message,
    });
  } finally {
    connection.release();
  }
}









export async function AMBIL_FAKTUR_BELANJA(req, res) {
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

    // Subquery membatasi 10 HEADER faktur terlebih dahulu
    const query = `
      SELECT 
        ph.id,
        ph.no_faktur,
        ph.supplier_id,
        ph.nama_supplier,
        ph.tanggal_belanja,
        ph.total_harga,
        ph.diskon,
        ph.created_at,
        JSON_ARRAYAGG(
          JSON_OBJECT(
            'id', pd.id,
            'kode_barang', pd.kode_barang,
            'nama_barang', COALESCE(b.nama_barang, 'Tanpa Nama'),
            'harga_satuan', pd.harga_satuan,
            'jumlah', pd.jumlah,
            'subtotal', pd.subtotal,
            'status', pd.status
          )
        ) AS items
      FROM (
        SELECT * 
        FROM pembelian_header
        WHERE tanggal_belanja BETWEEN ? AND ?
        ORDER BY tanggal_belanja DESC, id DESC
        LIMIT ? OFFSET ?
      ) ph
      JOIN pembelian_detail pd ON ph.id = pd.pembelian_id
      LEFT JOIN barang b ON pd.kode_barang = b.kode_barang 
      GROUP BY ph.id
      ORDER BY ph.tanggal_belanja DESC, ph.id DESC;
    `;

    // Pastikan limit dan offset dipastikan bertipe Integer
    const [rows] = await db.query(query, [
      tanggalMulai, 
      tanggalSelesai, 
      Number(limit), 
      Number(offset)
    ]);

    return res.status(200).json({
      success: true,
      message: "Berhasil mengambil data faktur belanja",
      pagination: {
        page: currentPage,
        limit: limit,
        total_data_page: rows.length
      },
      data: rows
    });

  } catch (error) {
    console.error("Error AMBIL_FAKTUR_BELANJA:", error);
    return res.status(500).json({
      success: false,
      message: "Terjadi kesalahan internal server",
      error: error.message
    });
  }
}




// export async function FunBelanjaBarang(req, res) {
//   const { faktur, ListPesanan } = req.body;

//   // tambahkan logika kalo di Listpesanan ada status BARANG BARU maka tambahkan ke tabel barang

//   // 1. Destructuring data faktur
//   const no_faktur = faktur?.no_faktur;
//   const supplier_id = faktur?.dataSupplier?.id_supplier;
//   const nama_supplier = faktur?.dataSupplier?.nama_supplier;
//   const tanggal_belanja = faktur?.tanggal_belanja;
//   const diskon_faktur = Number(faktur?.diskon_faktur) || 0; // Default ke 0 jika kosong/null

//   // 2. Validasi input faktur
//   if (!no_faktur || !supplier_id || !nama_supplier || !tanggal_belanja) {
//     console.log('gada')
//     return res.status(400).json({
//       message: "Data Faktur ada yang belum terisi!",
//     });
//   }

//   // 3. Validasi list pesanan
//   if (!Array.isArray(ListPesanan) || ListPesanan.length === 0) {
//     return res.status(400).json({
//       message: "List pesanan kosong atau tidak valid!",
//     });
//   }

//   // 4. Hitung total harga & diskon
//   const total_harga = ListPesanan.reduce((acc, item) => {
//     const harga_satuan = Number(item.harga_satuan) || 0;
//     const jumlah = Number(item.jumlah) || 0;
//     return acc + harga_satuan * jumlah;
//   }, 0);

//   const total_harga_setelah_diskon = Math.max(total_harga - diskon_faktur, 0);

//   // Ambil koneksi khusus untuk transaksi (agar atomic)
//   const connection = await db.getConnection();

//   try {
//     // ==========================================
//     // START TRANSACTION (SEMUA HARUS BERHASIL)
//     // ==========================================
//     await connection.beginTransaction();

//     // 1. INSERT PEMBELIAN HEADER
//     const [rowsHeader] = await connection.query(
//       `INSERT INTO pembelian_header (no_faktur, supplier_id, nama_supplier, tanggal_belanja, total_harga, diskon, created_at) 
//        VALUES (?, ?, ?, ?, ?, ?, ?)`,
//       [
//         no_faktur,
//         supplier_id,
//         nama_supplier,
//         tanggal_belanja,
//         total_harga_setelah_diskon,
//         diskon_faktur,
//         new Date(),
//       ]
//     );

//     // Ambil insertId langsung dari object hasil query header
//     const id_pembelian = rowsHeader.insertId;

//     // 2. MAPPING BULK INSERT PEMBELIAN DETAIL
//     const values_pembelian_detail = ListPesanan.map((item) => {
//       const harga_satuan = Number(item.harga_satuan) || 0;
//       const jumlah = Number(item.jumlah) || 0;
//       const subtotal = harga_satuan * jumlah;

//       return [
//         id_pembelian,
//         item.kode_barang,
//         harga_satuan,
//         jumlah,
//         subtotal,
//       ];
//     });

//     await connection.query(
//       `INSERT INTO pembelian_detail (pembelian_id, kode_barang, harga_satuan, jumlah, subtotal) VALUES ?`,
//       [values_pembelian_detail]
//     );

//     // 3. BULK UPDATE STOK BARANG (ON DUPLICATE KEY UPDATE)
//     // Map data khusus untuk update stok
//     const values_update_stok = ListPesanan.map((item) => [
//       item.kode_barang,
//       item.nama_barang || "Tanpa Nama",
//       item.satuan_crt || "PCS",                     // Wajib ada
//       Number(item.harga_satuan) || 0,                // harga_dasar
//       Number(item.harga_jual_produk_ke_pelanggan) || 0, // harga_jual
//       Number(item.jumlah) || 0,
//       item.status
//     ]);

//     await connection.query(
//       `INSERT INTO barang (kode_barang,nama_barang,satuan_crt,harga_dasar,harga_jual_produk_ke_pelanggan, stok , status) 
//        VALUES ? 
//        AS new_data 
//        ON DUPLICATE KEY UPDATE stok = barang.stok + new_data.stok`, // update juga harga_dasar
//       [values_update_stok]
//     );

//     // ==========================================
//     // COMMIT TRANSAKSI (SIMPAN PERMANEN)
//     // ==========================================
//     await connection.commit();

//     return res.status(200).json({
//       success: true,
//       message: "Transaksi belanja berhasil disimpan dan stok telah diperbarui!",
//       pembelian_id: id_pembelian,
//     });
//   } catch (err) {
//     // ==========================================
//     // ROLLBACK JIKA ADA 1 QUERY YANG GAGAL
//     // ==========================================
//     await connection.rollback();
//     console.error("Error BelanjaBarang Transaction:", err);

//     return res.status(500).json({
//       message: "Gagal menyimpan transaksi belanja!",
//       error: err.message,
//     });
//   } finally {
//     // KEMBALIKAN KONEKSI KE POOL
//     connection.release();
//   }
// }