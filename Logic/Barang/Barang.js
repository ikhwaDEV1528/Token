import { json } from "express";
import db from "../../db.js";
import { generateKodeBarang } from "./Buat_kode_barang.js";


// AMBIL BARANG //
export async function GET_BARANG(req, res) {
    const page = Math.max(1, parseInt(req.query?.page) || 1);
    const limit = 10;
    const offset = (page - 1) * limit;

    try {
        const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM barang`);

        const querySQL = `
            SELECT 
                b.kode_barang,
                b.nama_barang,
                b.harga_dasar,
                b.persentase_diskon_distributor,
                b.persentase_fee_harga_jual,
                b.harga_net_distributor,
                b.harga_jual_produk_ke_pelanggan,
                b.margin,
                b.stok_pcs,
                b.stok_min,
                CASE 
                    WHEN COUNT(bs.id) = 0 THEN JSON_ARRAY()
                    ELSE JSON_ARRAYAGG(
                        JSON_OBJECT(
                            'id', bs.id,
                            'nama_satuan', bs.nama_satuan,
                            'rasio_ke_pcs', bs.rasio_ke_pcs,
                            'harga_jual', bs.harga_jual,
                            'level', bs.level
                        )
                    )
                END AS list_satuan
            FROM (
                SELECT kode_barang, nama_barang, harga_dasar, persentase_diskon_distributor, 
                       persentase_fee_harga_jual, harga_net_distributor, 
                       harga_jual_produk_ke_pelanggan, margin, stok_pcs, stok_min
                FROM barang 
                ORDER BY kode_barang ASC 
                LIMIT ? OFFSET ?
            ) b
            LEFT JOIN (
                SELECT id, kode_barang, nama_satuan, rasio_ke_pcs, harga_jual, level 
                FROM barang_satuan 
                ORDER BY level ASC
            ) bs ON b.kode_barang = bs.kode_barang
            GROUP BY 
                b.kode_barang, b.nama_barang, b.harga_dasar, 
                b.persentase_diskon_distributor, b.persentase_fee_harga_jual, 
                b.harga_net_distributor, b.harga_jual_produk_ke_pelanggan, 
                b.margin, b.stok_pcs, b.stok_min
            ORDER BY b.kode_barang ASC
        `;

        const [BARANG] = await db.query(querySQL, [limit, offset]);

        return res.status(200).json({
            message: 'Berhasil ambil barang',
            status: 200,
            barang: BARANG,
            totalPage: Math.ceil(total / limit)
        });
    } catch (err) {
        console.error('Error GET_BARANG:', err);
        return res.status(500).json({
            message: `Internal server error: ${err.message || err}`,
            status: 500
        });
    }
}





export async function EDIT_BARANG(req, res) {
  const { dataBarang, formUser } = req.body;
  const kode_barang = dataBarang?.kode_barang;

  // 1. Ekstrak & Parsing Data Utama
  const harga_dasar = parseFloat(formUser?.harga_dasar);
  const disc_dist = parseFloat(formUser?.persentase_diskon_distributor) || 0;
  const disc_fee = parseFloat(formUser?.persentase_fee_harga_jual) || 0;
  const list_satuan = Array.isArray(formUser?.list_satuan) ? formUser.list_satuan : [];

  // 2. Validasi Input Utama
  if (!kode_barang || isNaN(harga_dasar) || harga_dasar <= 0) {
    return res.status(400).json({
      message: 'Kode barang dan harga dasar (harus berupa angka > 0) wajib diisi!'
    });
  }

  if (disc_dist < 0 || disc_dist > 100) {
    return res.status(400).json({
      message: 'Diskon distributor harus berada di antara 0% hingga 100%!'
    });
  }

  if (disc_fee < 0) {
    return res.status(400).json({
      message: 'Fee persentase tidak boleh bernilai negatif!'
    });
  }

  // 3. Kalkulasi Presisi Tinggi
  const modal_bersih_raw = harga_dasar - (harga_dasar * (disc_dist / 100));
  const modal_bersih = Math.round(modal_bersih_raw);
  const harga_jual = Math.round(modal_bersih_raw * (1 + (disc_fee / 100)));
  const margin = Math.max(harga_jual - modal_bersih, 0);

  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    // 4. QUERY 1: Update Master Data `barang` (Fast Indexed Primary Key Update)
    const [updateResult] = await connection.query(
      `UPDATE barang 
       SET harga_dasar = ?, 
           harga_jual_produk_ke_pelanggan = ?, 
           margin = ?, 
           persentase_diskon_distributor = ?, 
           persentase_fee_harga_jual = ? 
       WHERE kode_barang = ?`,
      [harga_dasar, harga_jual, margin, disc_dist, disc_fee, kode_barang]
    );

    if (updateResult.affectedRows === 0) {
      await connection.rollback();
      return res.status(404).json({
        message: `Barang dengan kode ${kode_barang} tidak ditemukan!`
      });
    }

    // 5. QUERY 2: Update Otomatis Harga Satuan Karton (Tingkat Level 3)
    // Query ini memanfaatkan index (kode_barang, level)
    await connection.query(
      `UPDATE barang_satuan 
       SET harga_jual = ? 
       WHERE kode_barang = ? AND level = 3`,
      [harga_jual, kode_barang]
    );

    // 6. QUERY 3: Processing & Validasi Bulk Update Eceran (Pack / PCS)
    const validEceran = list_satuan.filter((item) => {
      const isKarton = Number(item?.level) === 3 || (item?.nama_satuan || '').toUpperCase() === 'KARTON';
      return item?.id && !isKarton && !isNaN(parseFloat(item?.harga_jual)) && parseFloat(item?.harga_jual) > 0;
    });

    let warningEceran = null;

    if (validEceran.length > 0) {
      const idsToCheck = validEceran.map((item) => Number(item.id)).filter(id => !isNaN(id));

      if (idsToCheck.length > 0) {
        // Query 3a: Select Existing Safe Check (Guaranteed Safe Query Engine)
        const [existingRows] = await connection.query(
          `SELECT id, rasio_ke_pcs, nama_satuan 
           FROM barang_satuan 
           WHERE id IN (?) AND kode_barang = ?`,
          [idsToCheck, kode_barang]
        );

        if (existingRows.length > 0) {
          const validMap = new Map(existingRows.map((r) => [Number(r.id), r]));
          
          // Query 3b: Ambil Rasio Karton untuk Cek HPP
          const [kartonRows] = await connection.query(
            `SELECT rasio_ke_pcs FROM barang_satuan WHERE kode_barang = ? AND level = 3 LIMIT 1`,
            [kode_barang]
          );
          
          const rasioKarton = Number(kartonRows[0]?.rasio_ke_pcs) || 0;
          const hppPerPcs = rasioKarton > 0 ? modal_bersih / rasioKarton : 0;
          const bulkValues = [];

          for (const item of validEceran) {
            const idNum = Number(item.id);
            if (validMap.has(idNum)) {
              const dbData = validMap.get(idNum);
              const hargaJualSatuan = parseFloat(item.harga_jual);
              const rasioItem = parseFloat(item.rasio_ke_pcs) || parseFloat(dbData.rasio_ke_pcs) || 1;

              bulkValues.push([
                idNum,
                kode_barang,
                item.nama_satuan || dbData.nama_satuan,
                rasioItem,
                hargaJualSatuan,
                Number(item.level) || 1
              ]);

              // Deteksi Warning Eceran dibawah Modal
              if (hppPerPcs > 0 && hargaJualSatuan < (hppPerPcs * rasioItem)) {
                warningEceran = `Peringatan: Satuan ${item.nama_satuan || dbData.nama_satuan} di-set di bawah modal bersih!`;
              }
            }
          }

          // Query 3c: Atomic Bulk Upsert Query (Sangat Cepat & Tanpa Deadlock)
          if (bulkValues.length > 0) {
            await connection.query(
              `INSERT INTO barang_satuan (id, kode_barang, nama_satuan, rasio_ke_pcs, harga_jual, level)
               VALUES ?
               ON DUPLICATE KEY UPDATE 
                 harga_jual = VALUES(harga_jual),
                 rasio_ke_pcs = VALUES(rasio_ke_pcs)`,
              [bulkValues]
            );
          }
        }
      }
    }

    // Commit Transaction jika semua query aman
    await connection.commit();

    return res.status(200).json({
      success: true,
      message: 'Data barang & seluruh harga satuan berhasil diperbarui',
      warning: warningEceran,
      data: {
        calculated: { modal_bersih, harga_jual, margin }
      }
    });

  } catch (err) {
    await connection.rollback();
    console.error('ERROR EDIT_BARANG TRANSACTION:', err);

    return res.status(500).json({
      message: 'Terjadi kesalahan sistem database saat memperbarui data barang',
      error: err.message || err
    });
  } finally {
    connection.release();
  }
}






export async function TambahBarang(req,res) {
  const {nama_barang , satuan , harga_dasar , persentase_diskon_distributor,persentase_fee_harga_jual} = req.body;

  if(nama_barang == "" || satuan == "" || harga_dasar == "" || persentase_diskon_distributor == "" || persentase_fee_harga_jual == ""){
    return res.status(400).json({
      message:'Lengkapi semua inputan!',
      status:400,
    })
  }

  const hasil_kode_barang = generateKodeBarang()

  const modal_bersih = harga_dasar - (harga_dasar * (parseFloat(persentase_diskon_distributor) / 100));
  const harga_jual = Math.round(modal_bersih * (1 + (parseFloat(persentase_fee_harga_jual) / 100)));
  const margin = Math.round(harga_jual - modal_bersih);

  try {
    const [tambah_barang] = await db.query(`INSERT INTO Barang (kode_barang,nama_barang,satuan_crt,harga_dasar,persentase_diskon_distributor,persentase_fee_harga_jual,harga_jual_produk_ke_pelanggan,margin) VALUES(?,?,?,?,?,?,?,?)`,[
      hasil_kode_barang,nama_barang,satuan,harga_dasar,persentase_diskon_distributor,persentase_fee_harga_jual,harga_jual,margin
    ])

    return res.status(200).json({
      message:'Barang berhasil ditambahkan!',
      status:200
    })
  } catch (err) {
    console.log(err)
    return res.status(500).json({
      message:'Internal server!',
      err:err
    })
  }
}

// // EDIT BARANG //
// export async function EDIT_BARANG(req, res) { // 1. Tambahkan req dan res pada parameter
//   const { dataBarang , formUser} = req.body; // 2. Tambahkan identifier (seperti id_barang)

 
//   const kode_barang = dataBarang.kode_barang

//   const harga_dasar = Number(formUser.harga_dasar)
//   const harga_jual = Number(formUser.harga_jual)
//   const disc_dist = parseFloat(formUser.persentase_diskon_distributor)
//   const disc_fee = parseFloat(formUser.persentase_fee_harga_jual)
//   const satuan = formUser.satuan

//   if(harga_dasar == ""  || harga_jual == "" || satuan == "") {
//     return res.status(400).json({
//       message:'Isi semua input!'
//     })
//   }

//   if(isNaN(harga_dasar) || isNaN(harga_jual) ){
//     return res.status(400).json({
//       message:'Inputan harus disesuaikan dengan angka!'
//     })
//   }



//   try {
//     // 5. Perbaiki sintaks UPDATE SQL dan tambahkan klausa WHERE
//     const [updateBarang] = await db.query(
//       `UPDATE barang SET satuan_crt = ?, harga_dasar = ?, harga_jual_produk_ke_pelanggan = ?, persentase_diskon_distributor  = ? , persentase_fee_harga_jual = ? WHERE kode_barang = ?`,
//       [satuan, harga_dasar, harga_jual, disc_dist , disc_fee, kode_barang]
//     );

//     // 6. Kirim respon sukses jika berhasil
//     return res.status(200).json({
//       message: 'Data barang berhasil diperbarui',
//       status: 200,
//       data: updateBarang
//     });
//   } catch (err) {
//     console.log(err)
//     return res.status(500).json({
//       message: 'Masalah internal server',
//       status: 500,
//       err: err.message || err
//     });
//   }
// }



