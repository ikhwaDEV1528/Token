import db from "../../db.js";
import JualBarang from "../../Endpoint/JualBarang/JualBarang.js";
import { kode_faktur } from "./kode_faktur.js";



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
    const words = keyword.toLowerCase().split(/\s+/);

    // Semua kata harus ditemukan di nama barang
    const whereConditions = words
      .map(() => 'b.nama_barang LIKE ?')
      .join(' AND ');

    const queryParams = words.map(word => `%${word}%`);

    const sql = `
  SELECT
    b.kode_barang,
    b.nama_barang,
    b.stok_pcs,
    b.harga_dasar,
    b.margin,
    b.harga_jual_produk_ke_pelanggan,
    b.persentase_diskon_distributor,
    b.persentase_fee_harga_jual,

    IF(
      COUNT(bs.id) = 0,
      JSON_ARRAY(),
      JSON_ARRAYAGG(
        JSON_OBJECT(
          'id_satuan', bs.id,
          'nama_satuan', bs.nama_satuan,
          'harga_jual', bs.harga_jual,
          'rasio_ke_pcs', bs.rasio_ke_pcs,
          'level', bs.level
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
      persentase_fee_harga_jual
    FROM barang b
    WHERE ${whereConditions}
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
    b.persentase_fee_harga_jual
 `;

    const [resultSearch] = await db.query(sql, queryParams);

    // Format JSON + urutkan satuan berdasarkan level terbesar → terkecil
    const formattedResult = resultSearch.map(item => {
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
      message: err.message
    });
  }
}










// export async function ProsesPesanan(req, res) {
//   const { dataListBarang, nama_pelanggan, tenggat_hutang, total_dibayarkan_pelanggan, kode_pelanggan } = req.body || {};
//   const id_admin = req.id_admin;

//   // 1. Validasi Input Dasar
//   if (!dataListBarang || dataListBarang.length === 0 || !tenggat_hutang || total_dibayarkan_pelanggan === undefined || !kode_pelanggan) {
//     return res.status(400).json({
//       message: 'Semua input wajib diisi!',
//       status: 400
//     });
//   }

//   const now = new Date();
//   const timeSequence = String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0') + String(now.getSeconds()).padStart(2, '0');
//   const kodeFaktur = kode_faktur(timeSequence);

//   // 2. Hitung Total & Sisa Piutang
//   const total_harga = dataListBarang.reduce((acc, item) => {
//     const harga_jual = Number(item.harga_jual_produk_ke_pelanggan) || 0;
//     const jumlah = Number(item.jumlah) || 0;
//     return acc + (harga_jual * jumlah);
//   }, 0);

//   const bayar = Number(total_dibayarkan_pelanggan) || 0;
//   const sisaHutang = total_harga - bayar;
//   const status_lunas = sisaHutang <= 0 ? 'Lunas' : 'Belum lunas';

//   // 3. Prepare Data Detail untuk Bulk Insert
//   const valuesPenjualanDetail = dataListBarang.map(item => [
//     kodeFaktur,
//     item.kode_barang,
//     item.satuan_crt,
//     item.jumlah,
//     item.harga_jual_produk_ke_pelanggan,
//     item.harga_jual_produk_ke_pelanggan * item.jumlah,
//     item.harga_dasar || 0
//   ]);

//   // Gunakan connection khusus untuk Transaction
//   const connection = await db.getConnection();

//   try {
//     await connection.beginTransaction(); // START TRANSAKSI

//     // A. Insert ke penjualan_header
//     await connection.query(
//       `INSERT INTO penjualan_header 
//        (no_faktur, tgl_faktur, jatuhtempo_faktur, id_admin, kode_pelanggan, pembayaran, sisa_piutang, status, keterangan) 
//        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//       [
//         kodeFaktur,
//         new Date(),
//         tenggat_hutang,
//         id_admin,
//         kode_pelanggan,
//         bayar,
//         sisaHutang,
//         status_lunas,
//         'Belum ada keterangan'
//       ]
//     );

//     // B. Bulk Insert ke penjualan_detail
//     await connection.query(
//       `INSERT INTO penjualan_detail 
//        (no_faktur, kode_barang, satuan, jumlah_keluar, harga_jual, total_harga, hpp_per_unit) 
//        VALUES ?`,
//       [valuesPenjualanDetail]
//     );

//     // C. Loop Potong Stok Barang
//     for (const item of dataListBarang) {
//       await connection.query(
//         `UPDATE barang SET stok_pcs = stok_pcs - ? WHERE kode_barang = ?`,
//         [item.jumlah, item.kode_barang]
//       );
//     }

//     await connection.commit(); // COMMIT TRANSAKSI (Simpan Permanen)
//     connection.release();

//     return res.status(200).json({
//       message: 'Transaksi berhasil diproses!',
//       no_faktur: kodeFaktur,
//       status: 200
//     });

//   } catch (err) {
//     await connection.rollback(); // BATALKAN SEMUA JIKA ADA SATU SAJA KESALAHAN
//     connection.release();

//     console.error('Error ProsesPesanan:', err);
//     return res.status(500).json({
//       message: err.message || 'Gagal memproses pesanan',
//       status: 500
//     });
//   }
// }

export async function ProsesPesanan(req, res) {
  const { 
    dataListBarang, 
    nama_pelanggan, 
    tenggat_hutang, 
    total_dibayarkan_pelanggan, 
    kode_pelanggan 
  } = req.body || {};
  
  const id_admin = req.id_admin || 97;

  // 1. Validasi Input
  if (!dataListBarang || dataListBarang.length === 0 || !kode_pelanggan) {
    return res.status(400).json({
      message: 'Data barang dan pelanggan wajib diisi!',
      status: 400
    });
  }

  // Generate No Faktur & Tanggal Format YYYY-MM-DD (Waktu Lokal)
  const now = new Date();
  const timeSequence = String(now.getHours()).padStart(2, '0') + 
                       String(now.getMinutes()).padStart(2, '0') + 
                       String(now.getSeconds()).padStart(2, '0');
  const kodeFaktur = kode_faktur(timeSequence);

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const tglFakturFormatted = `${year}-${month}-${day}`;

  // 2. Hitung Total Belanja & Piutang
  const total_harga = dataListBarang.reduce((acc, item) => {
    return acc + (Number(item.subtotal) || (Number(item.harga_satuan) * Number(item.jumlah)));
  }, 0);

  const bayar = Number(total_dibayarkan_pelanggan) || 0;
  const sisaHutang = Math.max(total_harga - bayar, 0);
  const status_lunas = sisaHutang === 0 ? 'Lunas' : 'Belum lunas';
  const tglJatuhTempo = (sisaHutang > 0 && tenggat_hutang) ? tenggat_hutang : tglFakturFormatted;

  // 3. Prepare Data Detail untuk Bulk Insert
  const valuesPenjualanDetail = dataListBarang.map(item => [
    kodeFaktur,
    item.kode_barang,
    item.nama_satuan,
    Number(item.jumlah),
    Number(item.harga_satuan),
    Number(item.subtotal),
    Number(item.hpp_per_unit || item.harga_dasar || 0)
  ]);

  // 4. Batch Update Stok (Gunakan Binding Parameter Lengkap untuk Keamanan SQL)
  const caseParams = [];
  const caseStatements = dataListBarang.map(item => {
    const totalPcsDipotong = Number(item.jumlah) * Number(item.rasio_ke_pcs || 1);
    caseParams.push(item.kode_barang, totalPcsDipotong);
    return `WHEN ? THEN stok_pcs - ?`;
  }).join(' ');

  const kodeBarangList = dataListBarang.map(item => item.kode_barang);

  const sqlUpdateStokBatch = `
    UPDATE barang 
    SET stok_pcs = CASE kode_barang 
      ${caseStatements}
    END
    WHERE kode_barang IN (${kodeBarangList.map(() => '?').join(',')})
  `;

  // Gabungkan seluruh parameter untuk query UPDATE
  const updateQueryParams = [...caseParams, ...kodeBarangList];

  // DB Transaction
  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    // A. Insert Header
    await connection.query(
      `INSERT INTO penjualan_header 
       (no_faktur, tgl_faktur, jatuhtempo_faktur, id_admin, kode_pelanggan, pembayaran, sisa_piutang, status, keterangan) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        kodeFaktur,
        tglFakturFormatted,
        tglJatuhTempo,
        id_admin,
        kode_pelanggan,
        bayar,
        sisaHutang,
        status_lunas,
        'Belum ada keterangan'
      ]
    );

    // B. Bulk Insert Detail
    await connection.query(
      `INSERT INTO penjualan_detail 
       (no_faktur, kode_barang, satuan, jumlah_keluar, harga_jual, total_harga, hpp_per_unit) 
       VALUES ?`,
      [valuesPenjualanDetail]
    );

    // C. Potong Stok Sekaligus
    await connection.query(sqlUpdateStokBatch, updateQueryParams);

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
      message: err.message || 'Gagal memproses pesanan',
      status: 500
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
}








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

    const query = `
      SELECT 
        pj.no_faktur,
        pj.tgl_faktur,
        pj.jatuhtempo_faktur,
        pj.pembayaran,
        pj.sisa_piutang,
        pj.status,
        pj.keterangan,
        pj.id_admin,
        COALESCE(adm.username, 'Admin Tidak Ditemukan') AS nama_admin,
        pj.kode_pelanggan,
        COALESCE(pel.nama_pelanggan, 'Pelanggan Umum') AS nama_pelanggan,
        JSON_ARRAYAGG(
          JSON_OBJECT(
            'id_detail', pd.id_detail,
            'kode_barang', pd.kode_barang,
            'nama_barang', COALESCE(b.nama_barang, 'Barang Tidak Ditemukan'),
            'satuan', pd.satuan,
            'jumlah_keluar', pd.jumlah_keluar,
            'harga_jual', pd.harga_jual,
            'total_harga', pd.total_harga,
            'hpp_per_unit', pd.hpp_per_unit
          )
        ) AS items
      FROM (
        SELECT * 
        FROM penjualan_header
        WHERE tgl_faktur BETWEEN ? AND ?
        ORDER BY tgl_faktur DESC, no_faktur DESC
        LIMIT ? OFFSET ?
      ) pj
      JOIN penjualan_detail pd ON pj.no_faktur = pd.no_faktur
      LEFT JOIN admin adm ON pj.id_admin = adm.id_admin
      LEFT JOIN pelanggan pel ON pj.kode_pelanggan = pel.kode_pelanggan
      LEFT JOIN barang b ON pd.kode_barang = b.kode_barang
      GROUP BY 
        pj.no_faktur,
        pj.tgl_faktur,
        pj.jatuhtempo_faktur,
        pj.pembayaran,
        pj.sisa_piutang,
        pj.status,
        pj.keterangan,
        pj.id_admin,
        adm.username,
        pj.kode_pelanggan,
        pel.nama_pelanggan
      ORDER BY pj.tgl_faktur DESC, pj.no_faktur DESC;
    `;

    const [rows] = await db.query(query, [
      tanggalMulai, 
      tanggalSelesai, 
      Number(limit), 
      Number(offset)
    ]);

    // Format aman dari pergeseran tipe data JSON MySQL driver
    const formattedRows = rows.map((row) => ({
      ...row,
      items: typeof row.items === 'string' ? JSON.parse(row.items) : (row.items || [])
    }));

    return res.status(200).json({
      success: true,
      message: "Berhasil mengambil data faktur penjualan",
      pagination: {
        page: currentPage,
        limit: limit,
        total_data_page: formattedRows.length
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