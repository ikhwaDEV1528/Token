import { db } from '../../db.js';// sesuaikan dengan file koneksi DB lu
import { generateKodePelanggan } from './kodePelanggan.js';
import { randomBytes } from 'crypto';

// QUERY SEARCH PELANGGAN SEMENTARA DI KOMEN //


// export async function CariPelanggan(req, res) {
//   try {
//     const { inputCariPelanggan } = req.query;

//     // Kalau input kosong, balikkan array kosong biar gak bebanin query
//     if (!inputCariPelanggan || !inputCariPelanggan.trim()) {
//       return res.status(200).json([]);
//     }

//     // Query kencang, aman dari SQL Injection (pake ?), dan diputus pake LIMIT 15
//     const query = `
//       SELECT kode_pelanggan, nama_pelanggan ,alamat , no_hp
//       FROM pelanggan 
//       WHERE nama_pelanggan LIKE ? 
//       ORDER BY nama_pelanggan ASC 
//       LIMIT 15
//     `;

//     const searchKeyword = `%${inputCariPelanggan}%`;

//     const [rows] = await db.query(query, [searchKeyword]);

//     return res.status(200).json({ data: rows, message: `${rows.length} Pelanggan ditemukan!` });
//   } catch (error) {
//     console.error('Error Cari Pelanggan:', error);
//     return res.status(500).json({ message: 'Server Error' });
//   }
// }






// QUERY SEARCH PELANGGAN versi 2 FULL TEXT SEARCH //
/**
 * =========================================================================
 * MIGRATION — Jalankan SEKALI di database (bukan tiap request)
 * =========================================================================
 *
 * MySQL 5.7+ / 8.0 sudah punya ngram parser bawaan (tidak perlu install
 * plugin tambahan), cocok untuk bahasa Indonesia/CJK yang tidak punya
 * spasi jelas antar-suku-kata pendek atau butuh partial match.
 *
 * -- 1. Set ngram token size (default 2). Taruh di my.cnf / server config:
 * --    ngram_token_size = 2
 * --    (butuh restart MySQL sekali, cukup di awal setup)
 *
 * -- 2. Buat FULLTEXT index dengan ngram parser di kolom yang mau dicari
 * ALTER TABLE pelanggan
 *   ADD FULLTEXT INDEX ft_nama_pelanggan (nama_pelanggan) WITH PARSER ngram;
 *
 * -- (Opsional) kalau mau search no_hp juga, no_hp biasanya lebih pas
 * -- pakai index biasa + LIKE prefix karena formatnya numerik & fixed:
 * -- CREATE INDEX idx_no_hp ON pelanggan(no_hp);
 *
 * Catatan performa:
 * - FULLTEXT ngram index ukurannya lebih besar dari B-tree biasa
 *   (karena setiap kombinasi 2 karakter jadi token), tapi query jadi
 *   O(log n) index lookup, bukan full table scan O(n).
 * - Kalau nama_pelanggan jarang di-update, ini trade-off yang sepadan.
 * =========================================================================
 */

/**
 * Escape karakter khusus MySQL Boolean Full-Text Search mode.
 * Boolean mode punya operator: + - > < ( ) ~ * " @
 * Kalau user ngetik karakter ini, harus di-escape biar gak dianggap operator.
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

export async function CariPelanggan(req, res) {
  try {
    const { inputCariPelanggan } = req.query;
    const keyword = (inputCariPelanggan || '').trim();

    // Kalau input kosong, balikkan array kosong biar gak bebanin query
    if (!keyword) {
      return res.status(200).json({ data: [], message: '0 Pelanggan ditemukan!' });
    }

    let rows;

    // Ngram butuh minimal 2 karakter per token biar FULLTEXT efektif.
    // Kalau user baru ngetik 1 huruf, FULLTEXT ngram gak akan match apa-apa
    // (token terpendek = 2 char), jadi fallback ke LIKE prefix (masih pakai
    // index B-tree biasa kalau ada index di nama_pelanggan, cepat untuk
    // kasus 1 karakter karena hasilnya biasanya dibatasi user lanjut ngetik).
    if (keyword.length < 2) {
      const query = `
        SELECT *
        FROM pelanggan
        WHERE nama_pelanggan LIKE ?
        ORDER BY nama_pelanggan ASC
        LIMIT 15
      `;
      const searchKeyword = `${escapeLikeWildcard(keyword)}%`; // prefix only -> pakai index
      [rows] = await db.query(query, [searchKeyword]);
    } else {
      // Boolean mode + wildcard (*) di tiap kata = partial match tiap token,
      // sekaligus tetap pakai FULLTEXT index (bukan scan).
      const safeKeyword = escapeBooleanFTS(keyword);

      if (!safeKeyword) {
        return res.status(200).json({ data: [], message: '0 Pelanggan ditemukan!' });
      }

      const booleanQuery = safeKeyword
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => `+${word}*`) // '+' = wajib ada, '*' = suffix wildcard
        .join(' ');

      const query = `
        SELECT kode_pelanggan, nama_pelanggan, alamat, no_hp,block
        FROM pelanggan
        WHERE MATCH(nama_pelanggan) AGAINST(? IN BOOLEAN MODE)
        ORDER BY nama_pelanggan ASC
        LIMIT 15
      `;
      [rows] = await db.query(query, [booleanQuery]);

      // Fallback: kalau FULLTEXT gak nemu apa-apa (misal keyword typo minor
      // atau ngram gak match sempurna), coba LIKE sekali sebagai jaring
      // pengaman. Query ini hanya jalan saat FULLTEXT kosong, jadi tidak
      // membebani kasus normal (mayoritas request akan berhenti di atas).
      if (rows.length === 0) {
        const likeQuery = `
          SELECT kode_pelanggan, nama_pelanggan, alamat, no_hp
          FROM pelanggan
          WHERE nama_pelanggan LIKE ?
          ORDER BY nama_pelanggan ASC
          LIMIT 15
        `;
        const likeKeyword = `%${escapeLikeWildcard(keyword)}%`;
        [rows] = await db.query(likeQuery, [likeKeyword]);
      }
    }

    return res.status(200).json({
      data: rows,
      message: `${rows.length} Pelanggan ditemukan!`,
    });
  } catch (error) {
    console.error('Error Cari Pelanggan:', error);
    return res.status(500).json({ message: 'Server Error' });
  }
}




export async function GET_PELANGGAN(req, res) {
  // 1. Ambil page dari query, default ke 1 jika tidak dikirim
  const page = parseInt(req.query.page) || 1;
  const limit = 10;
  const offset = (page - 1) * limit;

  try {
    // 2. Query Data dengan urutan ORDER BY -> LIMIT -> OFFSET
    const [rows] = await db.query(
      `SELECT * FROM pelanggan ORDER BY nama_pelanggan ASC LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    // 3. Hitung total data dari tabel PELANGGAN (bukan barang)
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM pelanggan`
    );

    // 4. Hitung total halaman
    const totalPage = Math.ceil(total / limit);

    return res.status(200).json({
      message: 'ok',
      pelanggan: rows,
      pagination: {
        total_items: total,
        total_pages: totalPage,
        current_page: page,
        limit: limit
      }
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      message: err.message || 'Terjadi kesalahan pada server'
    });
  }
}




export async function TambahPelanggan(req, res) {
  const { form } = req?.body;

  if (form.nama_pelanggan == "" || form.no_hp == "" || form.alamat == "") {
    return res.status(409).json({
      message: 'Ada data yang belum terisi'
    })
  };

  const nama_pelanggan = form.nama_pelanggan;
  const no_hp = form.no_hp;
  const alamat = form.alamat;

  try {
    // kalau kode kebetulan sama, primary key menolak, lalu dicoba lagi dengan kode baru
    for (let percobaan = 0; percobaan < 10; percobaan++) {
      const kode_pelanggan = generateKodePelanggan(nama_pelanggan);

      try {
        await db.query(
          `INSERT INTO pelanggan (kode_pelanggan , nama_pelanggan , alamat , no_hp) VALUES(?,?,?,?) `,
          [kode_pelanggan, nama_pelanggan, alamat, no_hp]
        );
        return res.status(200).json({
          message: 'Berhasil tambah pelanggan'
        })
      } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') continue; // bentrok: generate ulang
        throw err;
      }
    }

    return res.status(409).json({
      message: 'Kesalah saat proses Tambah pelanggan, coba lagi!'
    })
  } catch (err) {
    console.log(err)
    res.status(500).json({
      message: err
    })
  }
}



export async function EditPelanggan(req, res) {
  try {
    const { form } = req.body || {};

    // 1. Cek apakah objek form ada
    if (!form) {
      return res.status(400).json({
        message: 'Data form tidak ditemukan'
      });
    }

    const { nama_pelanggan, kode_pelanggan, no_hp, alamat } = form;

    // 2. Validasi input (termasuk cek null/undefined/spasi)
    if (!nama_pelanggan?.trim() || !kode_pelanggan?.trim() || !no_hp?.trim() || !alamat?.trim()) {
      return res.status(400).json({
        message: 'Semua data (nama, kode, no hp, alamat) wajib diisi!'
      });
    }

    // 3. Eksekusi Query
    const [result] = await db.query(
      `UPDATE pelanggan SET nama_pelanggan = ?, no_hp = ?, alamat = ? WHERE kode_pelanggan = ?`,
      [nama_pelanggan.trim(), no_hp.trim(), alamat.trim(), kode_pelanggan.trim()]
    );

    // 4. Cek apakah ada baris data yang benar-benar ter-update
    if (result.affectedRows === 0) {
      return res.status(404).json({
        message: 'Pelanggan tidak ditemukan atau tidak ada perubahan data'
      });
    }

    return res.status(200).json({
      message: 'Berhasil update data pelanggan!'
    });

  } catch (err) {
    console.error("Error EditPelanggan:", err);
    return res.status(500).json({
      message: 'Terjadi kesalahan pada server',
      error: err.message
    });
  }
}


export async function BlockPelanggan(req, res) {
  const { kode_pelanggan, nama_pelanggan } = req.body;

  if (kode_pelanggan == "" || nama_pelanggan == "" || !kode_pelanggan || !nama_pelanggan) {
    return res.status(409).json({
      message: 'Ada kesalahan, Coba lagi!'
    });
  }


  try {
    const [pelanggan] = await db.query(`SELECT block FROM pelanggan WHERE kode_pelanggan = ? AND nama_pelanggan = ?`,[kode_pelanggan,nama_pelanggan])
    const isBloked = Number(pelanggan[0].block);
    console.log(isBloked)

    if(isBloked || isBloked == 1 || isBloked == '1') {
      return res.status(409).json({
        message:'Pelanggan ini sudah pernah di block'
      })
    }

    const [rows] = await db.query(`UPDATE pelanggan SET block = ? WHERE kode_pelanggan = ? AND nama_pelanggan = ?`,['1',kode_pelanggan,nama_pelanggan]);
    return res.status(200).json({
      message:`Pelanggan ${nama_pelanggan} Berhasil di block!`
    })
  } catch (err) {
    console.log(err)
    return res.status(500).json({
      message:'Kesalahan internal server!'
    })
  }
}




export async function UnBlockPelanggan(req, res) {
  const { kode_pelanggan, nama_pelanggan } = req.body;

  if (kode_pelanggan == "" || nama_pelanggan == "" || !kode_pelanggan || !nama_pelanggan) {
    return res.status(409).json({
      message: 'Ada kesalahan, Coba lagi!'
    });
  }


  try {
    const [pelanggan] = await db.query(`SELECT block FROM pelanggan WHERE kode_pelanggan = ? AND nama_pelanggan = ?`,[kode_pelanggan,nama_pelanggan])
    const isBloked = Number(pelanggan[0].block);
    console.log(isBloked)

    if(isBloked == 0 || isBloked == '0') {
      return res.status(409).json({
        message:'Pelanggan ini sudah pernah di unblock'
      })
    }

    const [rows] = await db.query(`UPDATE pelanggan SET block = ? WHERE kode_pelanggan = ? AND nama_pelanggan = ?`,['0',kode_pelanggan,nama_pelanggan]);
    return res.status(200).json({
      message:`Pelanggan ${nama_pelanggan} Berhasil di unblock!`
    })
  } catch (err) {
    console.log(err)
    return res.status(500).json({
      message:'Kesalahan internal server!'
    })
  }
}