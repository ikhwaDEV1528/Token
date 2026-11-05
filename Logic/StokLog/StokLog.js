// import { db } from "../../db.js";

// /**
//  * ============================================================================
//  * GET RIWAYAT STOK (stok_log) - read only
//  * ============================================================================
//  * Contoh route:  router.get('/STOK_LOG', GETSTOKLOG);
//  *
//  * Query string (semua opsional):
//  *   page        halaman, default 1
//  *   limit       baris per halaman, default 20, maks 100
//  *   q           cari: kode barang / nama barang / nomor referensi (faktur, retur, opname)
//  *   kode_barang riwayat satu barang (cocok persis)
//  *   jenis       PEMBELIAN | PENJUALAN | RETUR_PENJUALAN | RETUR_BELANJA |
//  *               STOK_OPNAME | PENYESUAIAN | BARANG_RUSAK | LEGACY
//  *   arah        MASUK | KELUAR | TETAP
//  *   kondisi     BAGUS | RUSAK | KADALUARSA
//  *   dari        tanggal awal  (YYYY-MM-DD)
//  *   sampai      tanggal akhir (YYYY-MM-DD, ikut dihitung)
//  *   urut        terbaru (default) | terlama
//  *
//  * Respons:
//  *   { data: [...], pagination: { page, limit, total, total_pages },
//  *     ringkasan: { total_masuk_pcs, total_keluar_pcs } }
//  *
//  * Keamanan & performa:
//  *   - Semua input divalidasi (whitelist / regex), query pakai placeholder.
//  *   - Karakter LIKE (% _ \) di pencarian di-escape.
//  *   - Pagination wajib, limit maks 100, offset dibatasi.
//  *   - tanggal dikirim sebagai string (DATE_FORMAT) supaya tidak bergeser zona waktu.
//  *   - Nama barang di-JOIN hanya untuk baris di halaman terpilih (bukan seluruh tabel).
//  *   - err.message tidak pernah dikirim ke client.
//  * ============================================================================
//  */

// const JENIS_VALID = [
//     'PEMBELIAN', 'PENJUALAN', 'RETUR_PENJUALAN', 'RETUR_BELANJA',
//     'STOK_OPNAME', 'PENYESUAIAN', 'BARANG_RUSAK', 'LEGACY'
// ];
// const KONDISI_VALID = ['BAGUS', 'RUSAK', 'KADALUARSA'];
// const ARAH_VALID = ['MASUK', 'KELUAR', 'TETAP'];
// const URUT_VALID = ['terbaru', 'terlama'];

// const LIMIT_DEFAULT = 20;
// const LIMIT_MAKS = 100;
// const OFFSET_MAKS = 50_000;

// class InputError extends Error { }

// const bersih = (v, maks) => {
//     if (typeof v !== 'string') return null;
//     // eslint-disable-next-line no-control-regex
//     const s = v.replace(/[\u0000-\u001F\u007F]/g, '').trim();
//     return s.length >= 1 && s.length <= maks ? s : null;
// };

// const escapeLike = (s) => s.replace(/[\\%_]/g, '\\$&');

// const tanggalValid = (s) => {
//     const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
//     if (!m) return false;
//     const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
//     return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
// };

// const hariBerikutnya = (s) => {
//     const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
//     const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) + 86_400_000);
//     return d.toISOString().slice(0, 10);
// };

// function bacaFilter(query) {
//     const q = query && typeof query === 'object' ? query : {};

//     const kosong = (v) => v === undefined || v === null || v === '';

//     const teks = (nama, maks) => {
//         if (kosong(q[nama])) return undefined;
//         const s = bersih(q[nama], maks);
//         if (s === null) throw new InputError(`Parameter "${nama}" tidak valid!`);
//         return s;
//     };

//     const pilihan = (nama, daftar, ubah = (x) => x.toUpperCase()) => {
//         const s = teks(nama, 30);
//         if (s === undefined) return undefined;
//         const nilai = ubah(s);
//         if (!daftar.includes(nilai)) throw new InputError(`Nilai "${nama}" tidak dikenal!`);
//         return nilai;
//     };

//     const bilangan = (nama, awal, min, maks) => {
//         if (kosong(q[nama])) return awal;
//         const s = typeof q[nama] === 'string' ? q[nama].trim() : '';
//         if (!/^\d{1,9}$/.test(s)) throw new InputError(`Parameter "${nama}" harus berupa angka bulat!`);
//         const n = Number(s);
//         if (n < min || n > maks) throw new InputError(`Parameter "${nama}" harus antara ${min} dan ${maks}!`);
//         return n;
//     };

//     const tanggal = (nama) => {
//         const s = teks(nama, 10);
//         if (s === undefined) return undefined;
//         if (!tanggalValid(s)) throw new InputError(`Tanggal "${nama}" tidak valid (format YYYY-MM-DD)!`);
//         return s;
//     };

//     const f = {
//         page: bilangan('page', 1, 1, 1_000_000),
//         limit: bilangan('limit', LIMIT_DEFAULT, 1, LIMIT_MAKS),
//         cari: teks('q', 100),
//         kode: teks('kode_barang', 50),
//         jenis: pilihan('jenis', JENIS_VALID),
//         arah: pilihan('arah', ARAH_VALID),
//         kondisi: pilihan('kondisi', KONDISI_VALID),
//         dari: tanggal('dari'),
//         sampai: tanggal('sampai'),
//         urut: pilihan('urut', URUT_VALID, (x) => x.toLowerCase()) || 'terbaru'
//     };

//     if (f.dari && f.sampai && f.dari > f.sampai) {
//         throw new InputError('Tanggal "dari" tidak boleh lebih besar dari tanggal "sampai"!');
//     }
//     if ((f.page - 1) * f.limit > OFFSET_MAKS) {
//         throw new InputError('Halaman terlalu jauh. Persempit pencarian dengan filter tanggal atau barang.');
//     }
//     return f;
// }

// function susunWhere(f) {
//     const where = [];
//     const params = [];

//     if (f.kode) { where.push('s.kode_barang = ?'); params.push(f.kode); }
//     if (f.cari) {
//         const like = `%${escapeLike(f.cari)}%`;
//         where.push(
//             `(s.kode_barang LIKE ? OR s.referensi_no LIKE ?
//               OR s.kode_barang IN (SELECT kode_barang FROM barang WHERE nama_barang LIKE ?))`
//         );
//         params.push(like, like, like);
//     }
//     if (f.jenis) { where.push('s.jenis_transaksi = ?'); params.push(f.jenis); }
//     if (f.kondisi) { where.push('s.kondisi = ?'); params.push(f.kondisi); }
//     if (f.arah === 'MASUK') where.push('s.qty_perubahan > 0');
//     if (f.arah === 'KELUAR') where.push('s.qty_perubahan < 0');
//     if (f.arah === 'TETAP') where.push('s.qty_perubahan = 0');
//     if (f.dari) { where.push('s.tanggal >= ?'); params.push(`${f.dari} 00:00:00`); }
//     if (f.sampai) { where.push('s.tanggal < ?'); params.push(`${hariBerikutnya(f.sampai)} 00:00:00`); }

//     return { whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
// }

// export async function GETSTOKLOG(req, res) {
//     try {
//         const f = bacaFilter(req.query);
//         const { whereSql, params } = susunWhere(f);
//         const dir = f.urut === 'terlama' ? 'ASC' : 'DESC';
//         const offset = (f.page - 1) * f.limit;

//         const sqlRingkasan = `
//             SELECT COUNT(*) AS total,
//                    COALESCE(SUM(CASE WHEN s.qty_perubahan > 0 THEN s.qty_perubahan ELSE 0 END), 0) AS masuk,
//                    COALESCE(SUM(CASE WHEN s.qty_perubahan < 0 THEN -s.qty_perubahan ELSE 0 END), 0) AS keluar
//               FROM stok_log s
//               ${whereSql}`;

//         // Ambil 1 halaman dulu (memakai index tanggal), baru JOIN nama barang.
//         const sqlData = `
//             SELECT t.*, b.nama_barang
//               FROM (
//                 SELECT s.id_stok,
//        DATE_FORMAT(s.tanggal, '%Y-%m-%d %H:%i:%s') AS tanggal,
//        s.kode_barang, s.stok_awal, s.stok_akhir, s.jenis_transaksi, s.kondisi,
//        s.jumlah, s.qty_perubahan, s.satuan_input, s.qty_input,
//        IFNULL(s.qty_bonus, 0) AS qty_bonus, -- <-- TAMBAHKAN KOLOM INI
//        s.referensi_tipe, s.referensi_no, s.referensi_id,
//        s.hpp_per_pcs, s.keterangan, s.dibuat_oleh
//                   FROM stok_log s
//                   ${whereSql}
//                  ORDER BY s.tanggal ${dir}, s.id_stok ${dir}
//                  LIMIT ? OFFSET ?
//               ) t
//               LEFT JOIN barang b ON b.kode_barang = t.kode_barang
//              ORDER BY t.tanggal ${dir}, t.id_stok ${dir}`;

//         const [hasilRingkasan, hasilData] = await Promise.all([
//             db.query(sqlRingkasan, params),
//             db.query(sqlData, [...params, f.limit, offset])
//         ]);

//         const r = hasilRingkasan[0][0] || {};
//         const total = Number(r.total) || 0;

//         const data = hasilData[0].map((x) => {
//             const qty = Number(x.qty_perubahan) || 0;
//             const hpp = x.hpp_per_pcs == null ? null : Number(x.hpp_per_pcs);
//             return {
//                 id_stok: x.id_stok,
//                 tanggal: x.tanggal,
//                 kode_barang: x.kode_barang,
//                 nama_barang: x.nama_barang || null,
//                 stok_awal: Number(x.stok_awal) || 0,
//                 stok_akhir: Number(x.stok_akhir) || 0,
//                 jumlah: Number(x.jumlah) || 0,
//                 qty_perubahan: qty,
//                 arah: qty > 0 ? 'MASUK' : qty < 0 ? 'KELUAR' : 'TETAP',
//                 jenis_transaksi: x.jenis_transaksi,
//                 kondisi: x.kondisi,
//                 satuan_input: x.satuan_input,
//                 qty_input: x.qty_input == null ? null : Number(x.qty_input),
//                 qty_bonus: Number(x.qty_bonus) || 0, // <-- TAMBAHKAN DI SINI
//                 referensi_tipe: x.referensi_tipe,
//                 referensi_no: x.referensi_no,
//                 referensi_id: x.referensi_id,
//                 hpp_per_pcs: Number.isFinite(hpp) ? hpp : null,
//                 keterangan: x.keterangan,
//                 dibuat_oleh: x.dibuat_oleh
//             };
//         });

//         res.set('Cache-Control', 'no-store');
//         return res.status(200).json({
//             data,
//             pagination: {
//                 page: f.page,
//                 limit: f.limit,
//                 total,
//                 total_pages: Math.ceil(total / f.limit)
//             },
//             ringkasan: {
//                 total_masuk_pcs: Number(r.masuk) || 0,
//                 total_keluar_pcs: Number(r.keluar) || 0
//             }
//         });
//     } catch (err) {
//         if (err instanceof InputError) {
//             return res.status(400).json({ message: err.message });
//         }
//         console.error('[GETSTOKLOG] Error:', err);
//         return res.status(500).json({ message: 'Gagal memuat riwayat stok, silakan coba lagi.' });
//     }
// }

import { db } from "../../db.js";

/**
 * ============================================================================
 * GET RIWAYAT STOK (stok_log) - read only
 * ============================================================================
 */

const JENIS_VALID = [
    'PEMBELIAN', 'PENJUALAN', 'RETUR_PENJUALAN', 'RETUR_BELANJA',
    'STOK_OPNAME', 'PENYESUAIAN', 'BARANG_RUSAK', 'LEGACY'
];
const KONDISI_VALID = ['BAGUS', 'RUSAK', 'KADALUARSA'];
const ARAH_VALID = ['MASUK', 'KELUAR', 'TETAP'];
const URUT_VALID = ['terbaru', 'terlama'];

const LIMIT_DEFAULT = 20;
const LIMIT_MAKS = 100;
const OFFSET_MAKS = 50_000;

class InputError extends Error { }

const bersih = (v, maks) => {
    if (typeof v !== 'string') return null;
    // eslint-disable-next-line no-control-regex
    const s = v.replace(/[\u0000-\u001F\u007F]/g, '').trim();
    return s.length >= 1 && s.length <= maks ? s : null;
};

const escapeLike = (s) => s.replace(/[\\%_]/g, '\\$&');

const tanggalValid = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return false;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
};

const hariBerikutnya = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) + 86_400_000);
    return d.toISOString().slice(0, 10);
};

function bacaFilter(query) {
    const q = query && typeof query === 'object' ? query : {};

    const kosong = (v) => v === undefined || v === null || v === '';

    const teks = (nama, maks) => {
        if (kosong(q[nama])) return undefined;
        const s = bersih(q[nama], maks);
        if (s === null) throw new InputError(`Parameter "${nama}" tidak valid!`);
        return s;
    };

    const pilihan = (nama, daftar, ubah = (x) => x.toUpperCase()) => {
        const s = teks(nama, 30);
        if (s === undefined) return undefined;
        const nilai = ubah(s);
        if (!daftar.includes(nilai)) throw new InputError(`Nilai "${nama}" tidak dikenal!`);
        return nilai;
    };

    const bilangan = (nama, awal, min, maks) => {
        if (kosong(q[nama])) return awal;
        const s = typeof q[nama] === 'string' ? q[nama].trim() : '';
        if (!/^\d{1,9}$/.test(s)) throw new InputError(`Parameter "${nama}" harus berupa angka bulat!`);
        const n = Number(s);
        if (n < min || n > maks) throw new InputError(`Parameter "${nama}" harus antara ${min} dan ${maks}!`);
        return n;
    };

    const tanggal = (nama) => {
        const s = teks(nama, 10);
        if (s === undefined) return undefined;
        if (!tanggalValid(s)) throw new InputError(`Tanggal "${nama}" tidak valid (format YYYY-MM-DD)!`);
        return s;
    };

    const f = {
        page: bilangan('page', 1, 1, 1_000_000),
        limit: bilangan('limit', LIMIT_DEFAULT, 1, LIMIT_MAKS),
        cari: teks('q', 100),
        kode: teks('kode_barang', 50),
        jenis: pilihan('jenis', JENIS_VALID),
        arah: pilihan('arah', ARAH_VALID),
        kondisi: pilihan('kondisi', KONDISI_VALID),
        dari: tanggal('dari'),
        sampai: tanggal('sampai'),
        urut: pilihan('urut', URUT_VALID, (x) => x.toLowerCase()) || 'terbaru'
    };

    if (f.dari && f.sampai && f.dari > f.sampai) {
        throw new InputError('Tanggal "dari" tidak boleh lebih besar dari tanggal "sampai"!');
    }
    if ((f.page - 1) * f.limit > OFFSET_MAKS) {
        throw new InputError('Halaman terlalu jauh. Persempit pencarian dengan filter tanggal atau barang.');
    }
    return f;
}

function susunWhere(f) {
    const where = [];
    const params = [];

    if (f.kode) { where.push('s.kode_barang = ?'); params.push(f.kode); }
    if (f.cari) {
        const like = `%${escapeLike(f.cari)}%`;
        where.push(
            `(s.kode_barang LIKE ? OR s.referensi_no LIKE ?
              OR s.kode_barang IN (SELECT kode_barang FROM barang WHERE nama_barang LIKE ?))`
        );
        params.push(like, like, like);
    }
    if (f.jenis) { where.push('s.jenis_transaksi = ?'); params.push(f.jenis); }
    if (f.kondisi) { where.push('s.kondisi = ?'); params.push(f.kondisi); }
    if (f.arah === 'MASUK') where.push('s.qty_perubahan > 0');
    if (f.arah === 'KELUAR') where.push('s.qty_perubahan < 0');
    if (f.arah === 'TETAP') where.push('s.qty_perubahan = 0');
    if (f.dari) { where.push('s.tanggal >= ?'); params.push(`${f.dari} 00:00:00`); }
    if (f.sampai) { where.push('s.tanggal < ?'); params.push(`${hariBerikutnya(f.sampai)} 00:00:00`); }

    return { whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

export async function GETSTOKLOG(req, res) {
    try {
        const f = bacaFilter(req.query);
        const { whereSql, params } = susunWhere(f);
        const dir = f.urut === 'terlama' ? 'ASC' : 'DESC';
        const offset = (f.page - 1) * f.limit;

        const sqlRingkasan = `
            SELECT COUNT(*) AS total,
                   COALESCE(SUM(CASE WHEN s.qty_perubahan > 0 THEN s.qty_perubahan ELSE 0 END), 0) AS masuk,
                   COALESCE(SUM(CASE WHEN s.qty_perubahan < 0 THEN -s.qty_perubahan ELSE 0 END), 0) AS keluar
              FROM stok_log s
              ${whereSql}`;

        // PERBAIKAN: Menambahkan presisi JOIN pada pd.satuan dan GROUP BY s.id_stok agar tidak terduplikasi
        const sqlData = `
            SELECT t.*, b.nama_barang
              FROM (
                SELECT s.id_stok,
                       DATE_FORMAT(s.tanggal, '%Y-%m-%d %H:%i:%s') AS tanggal,
                       s.kode_barang, s.stok_awal, s.stok_akhir, s.jenis_transaksi, s.kondisi,
                       s.jumlah, s.qty_perubahan, s.satuan_input, s.qty_input,
                       IFNULL(MAX(pd.qty_bonus), 0) AS qty_bonus,
                       s.referensi_tipe, s.referensi_no, s.referensi_id,
                       s.hpp_per_pcs, s.keterangan, s.dibuat_oleh
                  FROM stok_log s
                  LEFT JOIN penjualan_detail pd 
                         ON pd.no_faktur = s.referensi_no 
                        AND pd.kode_barang = s.kode_barang
                        AND pd.satuan = s.satuan_input
                  ${whereSql}
                 GROUP BY s.id_stok
                 ORDER BY s.tanggal ${dir}, s.id_stok ${dir}
                 LIMIT ? OFFSET ?
              ) t
              LEFT JOIN barang b ON b.kode_barang = t.kode_barang
             ORDER BY t.tanggal ${dir}, t.id_stok ${dir}`;

        const [hasilRingkasan, hasilData] = await Promise.all([
            db.query(sqlRingkasan, params),
            db.query(sqlData, [...params, f.limit, offset])
        ]);

        const r = hasilRingkasan[0][0] || {};
        const total = Number(r.total) || 0;

        const data = hasilData[0].map((x) => {
            const qty = Number(x.qty_perubahan) || 0;
            const hpp = x.hpp_per_pcs == null ? null : Number(x.hpp_per_pcs);
            return {
                id_stok: x.id_stok,
                tanggal: x.tanggal,
                kode_barang: x.kode_barang,
                nama_barang: x.nama_barang || null,
                stok_awal: Number(x.stok_awal) || 0,
                stok_akhir: Number(x.stok_akhir) || 0,
                jumlah: Number(x.jumlah) || 0,
                qty_perubahan: qty,
                arah: qty > 0 ? 'MASUK' : qty < 0 ? 'KELUAR' : 'TETAP',
                jenis_transaksi: x.jenis_transaksi,
                kondisi: x.kondisi,
                satuan_input: x.satuan_input,
                qty_input: x.qty_input == null ? null : Number(x.qty_input),
                qty_bonus: Number(x.qty_bonus) || 0,
                referensi_tipe: x.referensi_tipe,
                referensi_no: x.referensi_no,
                referensi_id: x.referensi_id,
                hpp_per_pcs: Number.isFinite(hpp) ? hpp : null,
                keterangan: x.keterangan,
                dibuat_oleh: x.dibuat_oleh
            };
        });

        res.set('Cache-Control', 'no-store');
        return res.status(200).json({
            data,
            pagination: {
                page: f.page,
                limit: f.limit,
                total,
                total_pages: Math.ceil(total / f.limit)
            },
            ringkasan: {
                total_masuk_pcs: Number(r.masuk) || 0,
                total_keluar_pcs: Number(r.keluar) || 0
            }
        });
    } catch (err) {
        if (err instanceof InputError) {
            return res.status(400).json({ message: err.message });
        }
        console.error('[GETSTOKLOG] Error:', err);
        return res.status(500).json({ message: 'Gagal memuat riwayat stok, silakan coba lagi.' });
    }
}