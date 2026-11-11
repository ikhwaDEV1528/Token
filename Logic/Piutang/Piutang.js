

// ============================================================================
// MODUL PIUTANG PELANGGAN (BE) — SATU FILE, 4 ENDPOINT
//
//   GET  /api-be/SERVER_PIUTANG/DAFTAR_PIUTANG_PELANGGAN   daftar pelanggan yang berhutang
//   GET  /api-be/SERVER_PIUTANG/DETAIL_PIUTANG_PELANGGAN   faktur-faktur yang belum lunas
//   POST /api-be/SERVER_PIUTANG/BAYAR_PIUTANG              input pembayaran per faktur
//   GET  /api-be/SERVER_PIUTANG/RIWAYAT_PEMBAYARAN         riwayat pembayaran
//
// PENTING: taruh di FILE TERSENDIRI. Jangan digabung ke ReturGabungan.mjs
// (nama helper di sini sengaja dibuat beda agar tetap aman, tapi satu file
// satu modul lebih rapi).
//
// ASUMSI SKEMA (sesuai kode retur yang sudah ada):
//   penjualan_header : no_faktur, kode_pelanggan, tgl_faktur, jatuhtempo_faktur,
//                      sales, pembayaran (dibayar saat penjualan), sisa_piutang, status
//   pelanggan        : kode_pelanggan, nama_pelanggan
//   retur_header     : no_faktur, jumlah_potong_piutang
//   + 3 tabel baru di piutang.sql
//
// Semua nominal dihitung di SERVER. FE hanya mengirim kode pelanggan,
// nomor faktur, dan jumlah uang yang dibayarkan.
// ============================================================================
import { db } from "../../db.js";
import { BuatNoBayar } from "./noBayar.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_KEYWORD_LEN = 100;
const MAX_ITEMS_BAYAR = 50;
const MAX_NOMINAL = 100_000_000_000; // 100 miliar, batas waras per faktur
const MAX_LEN_CATATAN = 500;
const MAX_LEN_KODE = 50;
const MAX_LEN_NO_FAKTUR = 50;
const METODE_BAYAR = ['TUNAI', 'TRANSFER'];

// Isi kalau kolom penjualan_header.status perlu ikut berubah saat piutang jadi 0 / kembali > 0.
// Contoh: STATUS_LUNAS = 'LUNAS'. Biarkan null kalau status tidak perlu disentuh.
// (Cek nilai asli: SELECT DISTINCT status FROM penjualan_header;)
const STATUS_LUNAS = null;

// whitelist urutan (ORDER BY tidak boleh dari input mentah)
const URUTAN_DAFTAR = {
    total_desc: 'total_piutang DESC, nama_pelanggan ASC',
    total_asc: 'total_piutang ASC, nama_pelanggan ASC',
    terlama: 'jatuh_tempo_terawal ASC, nama_pelanggan ASC',
    nama: 'nama_pelanggan ASC'
};

class PiutangError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.name = 'PiutangError';
        this.status = status;
    }
}

// ----------------------------------------------------------------------------
// HELPER
// ----------------------------------------------------------------------------
const fmtRp = (n) => Number(n).toLocaleString('id-ID');
const num = (v) => Number(v) || 0;

function keInt(v) {
    const s = String(v ?? '').trim();
    return /^\d+$/.test(s) ? Number(s) : NaN;
}

function escLike(s) {
    return s.replace(/[\\%_]/g, '\\$&');
}

// Waktu WIB (UTC+7) independen dari timezone server
function wibSekarang() {
    const w = new Date(Date.now() + 7 * 60 * 60 * 1000);
    const p = (n) => String(n).padStart(2, '0');
    const tanggal = `${w.getUTCFullYear()}-${p(w.getUTCMonth() + 1)}-${p(w.getUTCDate())}`;
    return {
        tanggal,                                   // 2026-10-14
        yyyymmdd: tanggal.replaceAll('-', ''),     // 20261014
        sql: `${tanggal} ${p(w.getUTCHours())}:${p(w.getUTCMinutes())}:${p(w.getUTCSeconds())}`
    };
}

// hari ini (WIB) dikurangi tanggal 'YYYY-MM-DD'. Positif = sudah lewat, negatif = belum.
function selisihHari(tglStr, hariIniStr) {
    if (!tglStr || !/^\d{4}-\d{2}-\d{2}$/.test(tglStr)) return null;
    const [y, m, d] = tglStr.split('-').map(Number);
    const [y2, m2, d2] = hariIniStr.split('-').map(Number);
    return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y, m - 1, d)) / 86_400_000);
}

// umur faktur (hari sejak dibuat, tidak pernah negatif)
function umurHari(tglStr, hariIniStr) {
    const s = selisihHari(tglStr, hariIniStr);
    return s === null ? null : Math.max(0, s);
}

function ambilPaging(query) {
    const page = Math.max(1, keInt(query.page) || 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, keInt(query.limit) || DEFAULT_LIMIT));
    return { page, limit, offset: (page - 1) * limit };
}

// Nama admin dari middleware auth (CekRequestAkses). SESUAIKAN kalau middleware lu
// menyimpan identitas di properti lain.
function ambilNamaAdmin(req) {
    const u = req.user || req.admin || {};
    const nama = u.username ?? u.nama ?? u.name ?? u.id ?? null;
    return String(nama ?? 'ADMIN').slice(0, 100);
}

function responError(res, err, tag) {
    if (err instanceof PiutangError) {
        return res.status(err.status).json({ status: false, message: err.message });
    }
    if (err && (err.code === 'ER_LOCK_DEADLOCK' || err.code === 'ER_LOCK_WAIT_TIMEOUT')) {
        console.warn(`[${tag}] Lock contention:`, err.code);
        return res.status(409).json({
            status: false,
            message: 'Sistem sedang memproses transaksi lain pada data yang sama. Silakan coba lagi.'
        });
    }
    console.error(`[${tag}] Unexpected error:`, err);
    return res.status(500).json({
        status: false,
        message: 'Terjadi kesalahan sistem. Silakan coba lagi atau hubungi admin.'
    });
}

// ============================================================================
// 1. DAFTAR PELANGGAN YANG BERHUTANG
// Query: q (nama/kode pelanggan atau no faktur, boleh banyak kata),
//        sort (total_desc | total_asc | terlama (jatuh tempo terawal) | nama), page, limit
// ============================================================================
export async function DAFTAR_PIUTANG_PELANGGAN(req, res) {
    try {
        const q = String(req.query.q ?? '').trim().slice(0, MAX_KEYWORD_LEN);
        const sortKey = Object.hasOwn(URUTAN_DAFTAR, req.query.sort) ? req.query.sort : 'total_desc';
        const { page, limit, offset } = ambilPaging(req.query);

        // Semua kata harus cocok. Tiap kata boleh cocok ke nama pelanggan, kode pelanggan,
        // atau nomor faktur milik pelanggan itu. Filter di level PELANGGAN (EXISTS),
        // jadi total hutang yang tampil tetap total SELURUH faktur pelanggan tsb.
        const where = [`ph.sisa_piutang > 0`];
        const params = [];
        for (const t of q.split(/\s+/).filter(Boolean).slice(0, 5)) {
            const like = `%${escLike(t)}%`;
            where.push(
                `(pl.nama_pelanggan LIKE ? OR ph.kode_pelanggan LIKE ?
                  OR EXISTS (SELECT 1 FROM penjualan_header x
                              WHERE x.kode_pelanggan = ph.kode_pelanggan AND x.no_faktur LIKE ?))`
            );
            params.push(like, like, like);
        }
        const whereSql = where.join(' AND ');

        const [[ringkasanRows], [rows]] = await Promise.all([
            db.query(
                `SELECT COUNT(DISTINCT ph.kode_pelanggan) AS jumlah_pelanggan,
                        COUNT(*)                          AS jumlah_faktur,
                        COALESCE(SUM(ph.sisa_piutang), 0) AS total_piutang
                   FROM penjualan_header ph
                   LEFT JOIN pelanggan pl ON pl.kode_pelanggan = ph.kode_pelanggan
                  WHERE ${whereSql}`,
                params
            ),
            db.query(
                `SELECT ph.kode_pelanggan,
                        COALESCE(pl.nama_pelanggan, ph.kode_pelanggan)          AS nama_pelanggan,
                        COUNT(*)                                                AS jumlah_faktur,
                        SUM(ph.sisa_piutang)                                    AS total_piutang,
                        DATE_FORMAT(MIN(ph.tgl_faktur), '%Y-%m-%d')             AS faktur_tertua,
                        DATE_FORMAT(MIN(ph.jatuhtempo_faktur), '%Y-%m-%d')      AS jatuh_tempo_terawal
                   FROM penjualan_header ph
                   LEFT JOIN pelanggan pl ON pl.kode_pelanggan = ph.kode_pelanggan
                  WHERE ${whereSql}
                  GROUP BY ph.kode_pelanggan, pl.nama_pelanggan
                  ORDER BY ${URUTAN_DAFTAR[sortKey]}
                  LIMIT ? OFFSET ?`,
                [...params, limit, offset]
            )
        ]);

        const hariIni = wibSekarang().tanggal;
        const r = ringkasanRows[0] || {};
        const totalPelanggan = num(r.jumlah_pelanggan);

        return res.status(200).json({
            status: true,
            data: {
                ringkasan: {
                    jumlah_pelanggan: totalPelanggan,
                    jumlah_faktur: num(r.jumlah_faktur),
                    total_piutang: num(r.total_piutang)
                },
                pelanggan: rows.map((x) => ({
                    kode_pelanggan: x.kode_pelanggan,
                    nama_pelanggan: x.nama_pelanggan,
                    jumlah_faktur: num(x.jumlah_faktur),
                    total_piutang: num(x.total_piutang),
                    faktur_tertua: x.faktur_tertua,
                    umur_terlama_hari: umurHari(x.faktur_tertua, hariIni),
                    jatuh_tempo_terawal: x.jatuh_tempo_terawal,
                    // positif = sudah telat N hari, 0 = jatuh tempo hari ini, negatif = N hari lagi
                    terlambat_hari: selisihHari(x.jatuh_tempo_terawal, hariIni)
                })),
                paging: {
                    page,
                    limit,
                    total: totalPelanggan,
                    total_page: Math.max(1, Math.ceil(totalPelanggan / limit))
                }
            }
        });
    } catch (err) {
        return responError(res, err, 'DAFTAR_PIUTANG_PELANGGAN');
    }
}

// ============================================================================
// 2. DETAIL PIUTANG 1 PELANGGAN (faktur yang belum lunas, terlama dulu)
// Query: kode_pelanggan
//
// Rincian per faktur (semua dari data tersimpan, tanpa menebak rumus diskon):
//   dibayar_di_awal    = penjualan_header.pembayaran (dibayar saat penjualan)
//   potongan_retur     = SUM(retur_header.jumlah_potong_piutang) faktur tsb
//   pembayaran_piutang = SUM(pembayaran_piutang_detail.jumlah) faktur tsb
//   sisa_piutang       = penjualan_header.sisa_piutang (sumber kebenaran)
//   total_tagihan      = dibayar_di_awal + potongan_retur + pembayaran_piutang + sisa_piutang
//                        (nilai faktur yang tercermin di pembukuan piutang)
//   terlambat_hari     = hari ini - jatuhtempo_faktur (positif = telat, negatif = belum jatuh tempo)
// ============================================================================
export async function DETAIL_PIUTANG_PELANGGAN(req, res) {
    try {
        const kode = String(req.query.kode_pelanggan ?? '').trim();
        if (!kode || kode.length > MAX_LEN_KODE) {
            throw new PiutangError('Kode pelanggan tidak valid!');
        }

        const [fakturRows] = await db.query(
            `SELECT ph.no_faktur,
                    DATE_FORMAT(ph.tgl_faktur, '%Y-%m-%d')        AS tgl_faktur,
                    DATE_FORMAT(ph.jatuhtempo_faktur, '%Y-%m-%d') AS jatuh_tempo,
                    ph.sales,
                    IFNULL(ph.grand_total, IFNULL(ph.total_harga, 0)) AS total_harga,
                    IFNULL(ph.dpp_total, IFNULL(ph.total_harga, 0)) AS dpp_total,
                    IFNULL(ph.ppn_persen, 0)                      AS ppn_persen,
                    IFNULL(ph.ppn_nominal, 0)                     AS ppn_nominal,
                    IFNULL(ph.pembayaran, 0)                      AS pembayaran_awal,
                    ph.sisa_piutang,
                    IFNULL(ph.diskon_global, 0)                   AS diskon_global,
                    COALESCE(pl.nama_pelanggan, ph.kode_pelanggan) AS nama_pelanggan
               FROM penjualan_header ph
               LEFT JOIN pelanggan pl ON pl.kode_pelanggan = ph.kode_pelanggan
              WHERE ph.kode_pelanggan = ? AND ph.sisa_piutang > 0
              ORDER BY ph.jatuhtempo_faktur ASC, ph.tgl_faktur ASC, ph.no_faktur ASC`,
            [kode]
        );

        if (fakturRows.length === 0) {
            // pelanggan ada tapi tidak punya hutang, atau memang tidak ada
            const [pel] = await db.query(
                `SELECT nama_pelanggan FROM pelanggan WHERE kode_pelanggan = ? LIMIT 1`,
                [kode]
            );
            const [adaFaktur] = await db.query(
                `SELECT 1 FROM penjualan_header WHERE kode_pelanggan = ? LIMIT 1`,
                [kode]
            );
            if (pel.length === 0 && adaFaktur.length === 0) {
                throw new PiutangError('Pelanggan tidak ditemukan!', 404);
            }
            return res.status(200).json({
                status: true,
                data: {
                    pelanggan: { kode_pelanggan: kode, nama_pelanggan: pel[0]?.nama_pelanggan || kode },
                    ringkasan: { jumlah_faktur: 0, total_piutang: 0, umur_terlama_hari: null, terlambat_hari: null },
                    faktur: []
                }
            });
        }

        const listFaktur = fakturRows.map((f) => f.no_faktur);
        const [[returRows], [bayarRows], [subtotalRows]] = await Promise.all([
            db.query(
                `SELECT no_faktur, SUM(jumlah_potong_piutang) AS total
                   FROM retur_header WHERE no_faktur IN (?) GROUP BY no_faktur`,
                [listFaktur]
            ),
            db.query(
                `SELECT d.no_faktur, SUM(d.jumlah) AS total
                   FROM pembayaran_piutang_detail d WHERE d.no_faktur IN (?) GROUP BY d.no_faktur`,
                [listFaktur]
            ),
            db.query(
                `SELECT no_faktur, SUM(total_harga) AS total
                   FROM penjualan_detail WHERE no_faktur IN (?) GROUP BY no_faktur`,
                [listFaktur]
            )
        ]);

        const returMap = new Map(returRows.map((r) => [r.no_faktur, num(r.total)]));
        const bayarMap = new Map(bayarRows.map((r) => [r.no_faktur, num(r.total)]));
        const subtotalMap = new Map(subtotalRows.map((r) => [r.no_faktur, num(r.total)]));

        const hariIni = wibSekarang().tanggal;
        const faktur = fakturRows.map((f) => {
            const sisa = num(f.sisa_piutang);
            const potonganRetur = returMap.get(f.no_faktur) || 0;
            const pembayaran = bayarMap.get(f.no_faktur) || 0;
            const dibayarDiAwal = num(f.pembayaran_awal);
            const totalTagihan = num(f.total_harga);
            const subtotal = subtotalMap.get(f.no_faktur) || 0;
            return {
                no_faktur: f.no_faktur,
                tgl_faktur: f.tgl_faktur,
                jatuh_tempo: f.jatuh_tempo,
                terlambat_hari: selisihHari(f.jatuh_tempo, hariIni),
                sales: f.sales,
                umur_hari: umurHari(f.tgl_faktur, hariIni),
                total_tagihan: totalTagihan,
                subtotal: subtotal,
                diskon_global: num(f.diskon_global),
                dpp_total: num(f.dpp_total),
                ppn_persen: num(f.ppn_persen),
                ppn_nominal: num(f.ppn_nominal),
                dibayar_di_awal: dibayarDiAwal,
                potongan_retur: potonganRetur,
                pembayaran_piutang: pembayaran,
                sisa_piutang: sisa
            };
        });

        return res.status(200).json({
            status: true,
            data: {
                pelanggan: { kode_pelanggan: kode, nama_pelanggan: fakturRows[0].nama_pelanggan },
                ringkasan: {
                    jumlah_faktur: faktur.length,
                    total_piutang: faktur.reduce((a, f) => a + f.sisa_piutang, 0),
                    umur_terlama_hari: Math.max(...faktur.map((f) => f.umur_hari ?? 0)),
                    terlambat_hari: faktur.reduce(
                        (mx, f) => (f.terlambat_hari !== null && (mx === null || f.terlambat_hari > mx) ? f.terlambat_hari : mx),
                        null
                    )
                },
                faktur
            }
        });
    } catch (err) {
        return responError(res, err, 'DETAIL_PIUTANG_PELANGGAN');
    }
}

// ============================================================================
// 3. BAYAR PIUTANG (per faktur, boleh banyak faktur dalam 1 kali bayar)
// Body: { kode_pelanggan, metode: 'TUNAI'|'TRANSFER', catatan?,
//         items: [{ no_faktur, jumlah }] }
//
// Jaminan:
//  - 1 transaksi DB: header + detail + update piutang semua atau tidak sama sekali
//  - faktur dikunci berurutan (anti-deadlock), sama dengan ProsesRetur sehingga
//    retur & pembayaran pada faktur yang sama saling menunggu, tidak saling timpa
//  - sisa_piutang tidak pernah negatif: UPDATE ... WHERE sisa_piutang >= ?
//  - jumlah > sisa ditolak (tidak ada kelebihan bayar / saldo lebih)
//  - faktur harus milik pelanggan yang dikirim
// ============================================================================
function parseBayar(body) {
    const { kode_pelanggan, items, metode, catatan } = body || {};

    const kode = typeof kode_pelanggan === 'string' ? kode_pelanggan.trim() : '';
    if (!kode || kode.length > MAX_LEN_KODE) throw new PiutangError('Kode pelanggan tidak valid!');

    if (!Array.isArray(items) || items.length === 0) {
        throw new PiutangError('Pilih minimal 1 faktur dan isi jumlah yang dibayar!');
    }
    if (items.length > MAX_ITEMS_BAYAR) {
        throw new PiutangError(`Maksimal ${MAX_ITEMS_BAYAR} faktur dalam satu kali pembayaran.`);
    }

    const metodeFix = metode === undefined || metode === null || metode === '' ? 'TUNAI' : String(metode).toUpperCase();
    if (!METODE_BAYAR.includes(metodeFix)) {
        throw new PiutangError(`Metode pembayaran tidak dikenali! Pilihan valid: ${METODE_BAYAR.join(', ')}.`);
    }

    if (catatan !== undefined && catatan !== null && String(catatan).length > MAX_LEN_CATATAN) {
        throw new PiutangError(`Catatan maksimal ${MAX_LEN_CATATAN} karakter!`);
    }

    const seen = new Set();
    const normalized = items.map((it, i) => {
        if (!it || typeof it !== 'object' || Array.isArray(it)) {
            throw new PiutangError(`Data faktur ke-${i + 1} tidak valid!`);
        }
        const noFaktur = String(it.no_faktur ?? '').trim();
        const jumlah = keInt(it.jumlah);
        if (!noFaktur || noFaktur.length > MAX_LEN_NO_FAKTUR) {
            throw new PiutangError(`Nomor faktur ke-${i + 1} tidak valid!`);
        }
        if (!Number.isSafeInteger(jumlah) || jumlah <= 0 || jumlah > MAX_NOMINAL) {
            throw new PiutangError(`Jumlah bayar faktur ${noFaktur} tidak valid (harus bilangan bulat rupiah > 0)!`);
        }
        if (seen.has(noFaktur)) {
            throw new PiutangError(`Faktur ${noFaktur} terdaftar dua kali. Gabungkan jadi satu baris!`);
        }
        seen.add(noFaktur);
        return { noFaktur, jumlah };
    });

    // urutan lock konsisten
    normalized.sort((a, b) => (a.noFaktur < b.noFaktur ? -1 : a.noFaktur > b.noFaktur ? 1 : 0));

    return {
        kode,
        metode: metodeFix,
        catatan: catatan ? String(catatan).trim() : null,
        items: normalized,
        total: normalized.reduce((a, x) => a + x.jumlah, 0)
    };
}

// async function buatNoBayar(conn, yyyymmdd) {
//     const [r] = await conn.query(
//         `INSERT INTO pembayaran_sequence (tanggal, last_seq) VALUES (?, 1)
//          ON DUPLICATE KEY UPDATE last_seq = LAST_INSERT_ID(last_seq + 1)`,
//         [yyyymmdd]
//     );
//     let seq;
//     if (r.affectedRows === 1) seq = 1;
//     else if (r.affectedRows === 2) seq = r.insertId;
//     else throw new Error(`Gagal membuat nomor bayar: affectedRows tidak terduga (${r.affectedRows})`);
//     return `BYR-${yyyymmdd}-${String(seq).padStart(4, '0')}`;
// }



export async function BAYAR_PIUTANG(req, res) {
    let payload;
    try {
        payload = parseBayar(req.body);
    } catch (err) {
        return res.status(err.status || 400).json({ status: false, message: err.message });
    }

    const { kode, metode, catatan, items, total } = payload;
    const waktu = wibSekarang();
    const admin = ambilNamaAdmin(req);
    let conn;

    try {
        conn = await db.getConnection();
        await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
        await conn.beginTransaction();

        // 1. kunci semua faktur yang dibayar (urut no_faktur)
        const [fakturRows] = await conn.query(
            `SELECT no_faktur, kode_pelanggan, sisa_piutang
               FROM penjualan_header
              WHERE no_faktur IN (?)
              ORDER BY no_faktur
                FOR UPDATE`,
            [items.map((i) => i.noFaktur)]
        );
        const fakturMap = new Map(fakturRows.map((f) => [f.no_faktur, f]));

        // 2. validasi tiap faktur
        for (const it of items) {
            const f = fakturMap.get(it.noFaktur);
            if (!f) throw new PiutangError(`Faktur ${it.noFaktur} tidak ditemukan!`, 404);
            if (String(f.kode_pelanggan) !== kode) {
                throw new PiutangError(`Faktur ${it.noFaktur} bukan milik pelanggan ini!`);
            }
            const sisa = num(f.sisa_piutang);
            if (sisa <= 0) {
                throw new PiutangError(`Faktur ${it.noFaktur} sudah lunas, tidak ada sisa piutang.`);
            }
            if (it.jumlah > sisa) {
                throw new PiutangError(
                    `Jumlah bayar faktur ${it.noFaktur} (Rp ${fmtRp(it.jumlah)}) melebihi sisa piutang (Rp ${fmtRp(sisa)}).`
                );
            }
        }

        // 3. header pembayaran
        const noBayar = await BuatNoBayar(conn, waktu.yyyymmdd);
        const [hdr] = await conn.query(
            `INSERT INTO pembayaran_piutang_header
                (no_bayar, kode_pelanggan, tanggal_bayar, total_bayar, metode, catatan, dibuat_oleh, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [noBayar, kode, waktu.sql, total, metode, catatan, admin, waktu.sql]
        );
        const idPembayaran = hdr.insertId;

        // 4. kurangi piutang (atomik) + siapkan detail
        const detailRows = [];
        const rincian = [];
        for (const it of items) {
            const sebelum = num(fakturMap.get(it.noFaktur).sisa_piutang);
            const [u] = await conn.query(
                `UPDATE penjualan_header SET sisa_piutang = sisa_piutang - ?
                  WHERE no_faktur = ? AND sisa_piutang >= ?`,
                [it.jumlah, it.noFaktur, it.jumlah]
            );
            if (u.affectedRows !== 1) {
                throw new PiutangError(`Sisa piutang faktur ${it.noFaktur} berubah saat diproses. Silakan coba lagi.`, 409);
            }
            const sesudah = sebelum - it.jumlah;
            if (STATUS_LUNAS && sesudah === 0) {
                await conn.query(`UPDATE penjualan_header SET status = ? WHERE no_faktur = ?`, [STATUS_LUNAS, it.noFaktur]);
            }
            detailRows.push([idPembayaran, it.noFaktur, it.jumlah, sebelum, sesudah]);
            rincian.push({
                no_faktur: it.noFaktur,
                jumlah: it.jumlah,
                sisa_sebelum: sebelum,
                sisa_sesudah: sesudah,
                lunas: sesudah === 0
            });
        }

        await conn.query(
            `INSERT INTO pembayaran_piutang_detail
                (id_pembayaran, no_faktur, jumlah, sisa_sebelum, sisa_sesudah)
             VALUES ?`,
            [detailRows]
        );

        await conn.commit();

        return res.status(200).json({
            status: true,
            message: 'Pembayaran piutang berhasil dicatat!',
            data: {
                no_bayar: noBayar,
                kode_pelanggan: kode,
                total_bayar: total,
                metode,
                tanggal_bayar: waktu.sql,
                rincian
            }
        });
    } catch (err) {
        if (conn) {
            try {
                await conn.rollback();
            } catch (rollbackErr) {
                console.error('[BAYAR_PIUTANG] Rollback gagal:', rollbackErr);
            }
        }
        return responError(res, err, 'BAYAR_PIUTANG');
    } finally {
        if (conn) conn.release();
    }
}







// ============================================================================
// 4. RIWAYAT PEMBAYARAN (pembayaran piutang + potongan dari retur penjualan)
// Query: kode_pelanggan (opsional), no_faktur (opsional), page, limit
//
// Sumber data:
//   - pembayaran_piutang_header/detail : cicilan / input manual   -> jenis 'PEMBAYARAN'
//   - retur_header (jumlah_potong_piutang > 0) : retur yang otomatis memotong
//     piutang faktur tujuan                                       -> jenis 'RETUR'
//
// Format respons TIDAK berubah (field lama tetap ada). Tambahan: `jenis` dan
// `no_retur`. Untuk baris retur: no_bayar = nomor retur, metode = 'RETUR',
// rincian.sisa_sebelum / sisa_sesudah = null (retur tidak menyimpan potret saldo).
//
// Helper yang dipakai (sudah ada di file kamu): MAX_LEN_KODE, MAX_LEN_NO_FAKTUR,
// ambilPaging, num, responError.
// ============================================================================
// export async function RIWAYAT_PEMBAYARAN(req, res) {
//     try {
//         const kode = String(req.query.kode_pelanggan ?? '').trim().slice(0, MAX_LEN_KODE);
//         const noFaktur = String(req.query.no_faktur ?? '').trim().slice(0, MAX_LEN_NO_FAKTUR);
//         const { page, limit, offset } = ambilPaging(req.query);

//         // --- cabang 1: pembayaran piutang -------------------------------------
//         const whereBayar = ['1 = 1'];
//         const paramsBayar = [];
//         // --- cabang 2: retur yang memotong piutang ------------------------------
//         const whereRetur = ['r.jumlah_potong_piutang > 0'];
//         const paramsRetur = [];

//         if (kode) {
//             whereBayar.push('h.kode_pelanggan = ?');
//             paramsBayar.push(kode);
//             whereRetur.push('ph.kode_pelanggan = ?');
//             paramsRetur.push(kode);
//         }
//         if (noFaktur) {
//             whereBayar.push(`EXISTS (SELECT 1 FROM pembayaran_piutang_detail dx
//                                      WHERE dx.id_pembayaran = h.id AND dx.no_faktur = ?)`);
//             paramsBayar.push(noFaktur);
//             whereRetur.push('r.no_faktur = ?');
//             paramsRetur.push(noFaktur);
//         }

//         const fromBayar = `FROM pembayaran_piutang_header h WHERE ${whereBayar.join(' AND ')}`;
//         const fromRetur = `FROM retur_header r
//                            INNER JOIN penjualan_header ph ON ph.no_faktur = r.no_faktur
//                            WHERE ${whereRetur.join(' AND ')}`;
//         const paramsGabung = [...paramsBayar, ...paramsRetur];

//         const [[cnt], [rows]] = await Promise.all([
//             db.query(
//                 `SELECT (SELECT COUNT(*) ${fromBayar}) AS bayar,
//                         (SELECT COUNT(*) ${fromRetur}) AS retur`,
//                 paramsGabung
//             ),
//             db.query(
//                 `SELECT u.jenis, u.ref_id, u.nomor, u.kode_pelanggan,
//                         COALESCE(pl.nama_pelanggan, u.kode_pelanggan)       AS nama_pelanggan,
//                         DATE_FORMAT(u.tgl, '%Y-%m-%d %H:%i:%s')             AS tanggal,
//                         u.total, u.metode, u.catatan, u.dibuat_oleh, u.no_faktur_retur , u.no_faktur_lain,
//                         u.dpp_total, u.ppn_persen, u.ppn_nominal, u.grand_total
//                    FROM (
//                          (SELECT 'PEMBAYARAN' AS jenis, h.id AS ref_id, h.no_bayar AS nomor,
//                                  h.kode_pelanggan, h.tanggal_bayar AS tgl, h.total_bayar AS total,
//                                  h.metode AS metode, h.catatan AS catatan, h.dibuat_oleh AS dibuat_oleh,
//                                  NULL AS no_faktur_retur , NULL AS no_faktur_lain,
//                                  0 AS dpp_total, 0 AS ppn_persen, 0 AS ppn_nominal, 0 AS grand_total
//                             ${fromBayar})
//                          UNION ALL
//                          (SELECT 'RETUR' AS jenis, r.id AS ref_id, r.no_retur AS nomor,
//                                  ph.kode_pelanggan, r.tanggal_retur AS tgl, r.jumlah_potong_piutang AS total,
//                                  'RETUR' AS metode, r.catatan AS catatan, NULL AS dibuat_oleh,
//                                  r.no_faktur AS no_faktur_retur , r.no_faktur_lain AS no_faktur_lain,
//                                  IFNULL(r.dpp_total, 0) AS dpp_total,
//                                  IFNULL(r.ppn_persen, 11) AS ppn_persen,
//                                  IFNULL(r.ppn_nominal, 0) AS ppn_nominal,
//                                  IFNULL(r.grand_total, r.jumlah_potong_piutang) AS grand_total
//                             ${fromRetur})
//                          ORDER BY tgl DESC, jenis DESC, ref_id DESC
//                          LIMIT ? OFFSET ?
//                         ) u
//                     LEFT JOIN pelanggan pl ON pl.kode_pelanggan = u.kode_pelanggan
//                   ORDER BY u.tgl DESC, u.jenis DESC, u.ref_id DESC`,
//                 [...paramsGabung, limit, offset]
//             )
//         ]);

//         // rincian per faktur hanya untuk baris pembayaran
//         const detailMap = new Map();
//         const idBayar = rows.filter((r) => r.jenis === 'PEMBAYARAN').map((r) => r.ref_id);
//         if (idBayar.length > 0) {
//             const [details] = await db.query(
//                 `SELECT id_pembayaran, no_faktur, jumlah, sisa_sebelum, sisa_sesudah
//                    FROM pembayaran_piutang_detail
//                   WHERE id_pembayaran IN (?)
//                   ORDER BY id`,
//                 [idBayar]
//             );
//             for (const d of details) {
//                 if (!detailMap.has(d.id_pembayaran)) detailMap.set(d.id_pembayaran, []);
//                 detailMap.get(d.id_pembayaran).push({
//                     no_faktur: d.no_faktur,
//                     jumlah: num(d.jumlah),
//                     sisa_sebelum: num(d.sisa_sebelum),
//                     sisa_sesudah: num(d.sisa_sesudah)
//                 });
//             }
//         }

//         const total = num(cnt[0]?.bayar) + num(cnt[0]?.retur);
//         return res.status(200).json({
//             status: true,
//             data: {
//                 riwayat: rows.map((h) => {
//                     const retur = h.jenis === 'RETUR';
//                     const isReturSilang = retur && (h.no_faktur_lain && h.no_faktur_retur !== h.no_faktur_lain);

//                     return {
//                         jenis: h.jenis,
//                         no_bayar: h.nomor,
//                         no_retur: retur ? h.nomor : null,
//                         kode_pelanggan: h.kode_pelanggan,
//                         nama_pelanggan: h.nama_pelanggan,
//                         tanggal_bayar: h.tanggal,
//                         total_bayar: num(h.total),
//                         metode: h.metode,
//                         catatan: h.catatan,
//                         dibuat_oleh: h.dibuat_oleh,
//                         is_retur_silang: isReturSilang,
//                         no_faktur_asli: retur ? h.no_faktur_retur : null,
//                         no_faktur_lain: retur ? (h.no_faktur_lain || h.no_faktur_retur) : null,

//                         // --- FIELD INI YANG TADI KETINGGALAN DI MAPPING JSON KANAN ---
//                         dpp_total: retur ? num(h.dpp_total) : null,
//                         ppn_persen: retur ? num(h.ppn_persen) : null,
//                         ppn_nominal: retur ? num(h.ppn_nominal) : null,
//                         grand_total: retur ? num(h.grand_total) : null,

//                         rincian: retur
//                             ? [{
//                                 no_faktur: h.no_faktur_retur,
//                                 no_faktur_asal_barang: h.no_faktur_lain || h.no_faktur_retur,
//                                 jumlah: num(h.total),
//                                 sisa_sebelum: null,
//                                 sisa_sesudah: null
//                             }]
//                             : (detailMap.get(Number(h.ref_id)) || detailMap.get(String(h.ref_id)) || [])
//                     };
//                 }),
//                 paging: { page, limit, total, total_page: Math.max(1, Math.ceil(total / limit)) }
//             }
//         });
//     } catch (err) {
//         return responError(res, err, 'RIWAYAT_PEMBAYARAN');
//     }
// }



export async function RIWAYAT_PEMBAYARAN(req, res) {
    try {
        const kode = String(req.query.kode_pelanggan ?? '').trim().slice(0, MAX_LEN_KODE);
        const noFaktur = String(req.query.no_faktur ?? '').trim().slice(0, MAX_LEN_NO_FAKTUR);
        const { page, limit, offset } = ambilPaging(req.query);
        // true = hanya riwayat faktur yang masih berhutang (sama dengan daftar faktur di panel detail)
        const hanyaHutang = Boolean(kode) && String(req.query.hanya_hutang ?? '') === '1';

        // --- cabang 1: pembayaran piutang -------------------------------------
        const whereBayar = ['1 = 1'];
        const paramsBayar = [];
        // --- cabang 2: retur yang memotong piutang ------------------------------
        const whereRetur = ['r.jumlah_potong_piutang > 0'];
        const paramsRetur = [];

        // if (kode) {
        //     // termasuk setoran DCR (kode_pelanggan = MULTI_TOKO) yang berisi faktur pelanggan ini
        //     whereBayar.push(`(h.kode_pelanggan = ? OR EXISTS (
        //         SELECT 1 FROM pembayaran_piutang_detail dk
        //           JOIN penjualan_header pk ON pk.no_faktur = dk.no_faktur
        //          WHERE dk.id_pembayaran = h.id AND pk.kode_pelanggan = ?))`);
        //     paramsBayar.push(kode, kode);
        //     whereRetur.push('ph.kode_pelanggan = ?');
        //     paramsRetur.push(kode);
        // }

        if (kode) {
            if (hanyaHutang) {
                // pembayaran (termasuk DCR) yang menyentuh faktur pelanggan ini yang MASIH berhutang
                whereBayar.push(`EXISTS (
            SELECT 1 FROM pembayaran_piutang_detail dk
              JOIN penjualan_header pk ON pk.no_faktur = dk.no_faktur
             WHERE dk.id_pembayaran = h.id
               AND pk.kode_pelanggan = ? AND pk.sisa_piutang > 0)`);
                paramsBayar.push(kode);
                // retur yang memotong piutang faktur yang masih berhutang
                whereRetur.push('ph.kode_pelanggan = ? AND ph.sisa_piutang > 0');
                paramsRetur.push(kode);
            } else {
                // termasuk setoran DCR (kode_pelanggan = MULTI_TOKO) yang berisi faktur pelanggan ini
                whereBayar.push(`(h.kode_pelanggan = ? OR EXISTS (
            SELECT 1 FROM pembayaran_piutang_detail dk
              JOIN penjualan_header pk ON pk.no_faktur = dk.no_faktur
             WHERE dk.id_pembayaran = h.id AND pk.kode_pelanggan = ?))`);
                paramsBayar.push(kode, kode);
                whereRetur.push('ph.kode_pelanggan = ?');
                paramsRetur.push(kode);
            }
        }

        if (noFaktur) {
            whereBayar.push(`EXISTS (SELECT 1 FROM pembayaran_piutang_detail dx
                                     WHERE dx.id_pembayaran = h.id AND dx.no_faktur = ?)`);
            paramsBayar.push(noFaktur);
            whereRetur.push('r.no_faktur = ?');
            paramsRetur.push(noFaktur);
        }

        const fromBayar = `FROM pembayaran_piutang_header h WHERE ${whereBayar.join(' AND ')}`;
        const fromRetur = `FROM retur_header r
                           INNER JOIN penjualan_header ph ON ph.no_faktur = r.no_faktur
                           WHERE ${whereRetur.join(' AND ')}`;
        const paramsGabung = [...paramsBayar, ...paramsRetur];

        const [[cnt], [rows]] = await Promise.all([
            db.query(
                `SELECT (SELECT COUNT(*) ${fromBayar}) AS bayar,
                        (SELECT COUNT(*) ${fromRetur}) AS retur`,
                paramsGabung
            ),
            db.query(
                `SELECT u.jenis, u.ref_id, u.nomor, u.kode_pelanggan,
                        COALESCE(pl.nama_pelanggan, u.kode_pelanggan)       AS nama_pelanggan,
                        DATE_FORMAT(u.tgl, '%Y-%m-%d %H:%i:%s')             AS tanggal,
                        u.total, u.metode, u.catatan, u.dibuat_oleh, u.no_faktur_retur , u.no_faktur_lain,
                        u.dpp_total, u.ppn_persen, u.ppn_nominal, u.grand_total
                   FROM (
                         (SELECT 'PEMBAYARAN' AS jenis, h.id AS ref_id, h.no_bayar AS nomor,
                                 h.kode_pelanggan, h.tanggal_bayar AS tgl, h.total_bayar AS total,
                                 h.metode AS metode, h.catatan AS catatan, h.dibuat_oleh AS dibuat_oleh,
                                 NULL AS no_faktur_retur , NULL AS no_faktur_lain,
                                 0 AS dpp_total, 0 AS ppn_persen, 0 AS ppn_nominal, 0 AS grand_total
                            ${fromBayar})
                         UNION ALL
                         (SELECT 'RETUR' AS jenis, r.id AS ref_id, r.no_retur AS nomor,
                                 ph.kode_pelanggan, r.tanggal_retur AS tgl, r.jumlah_potong_piutang AS total,
                                 'RETUR' AS metode, r.catatan AS catatan, NULL AS dibuat_oleh,
                                 r.no_faktur AS no_faktur_retur , r.no_faktur_lain AS no_faktur_lain,
                                 IFNULL(r.dpp_total, 0) AS dpp_total,
                                 IFNULL(r.ppn_persen, 11) AS ppn_persen,
                                 IFNULL(r.ppn_nominal, 0) AS ppn_nominal,
                                 IFNULL(r.grand_total, r.jumlah_potong_piutang) AS grand_total
                            ${fromRetur})
                         ORDER BY tgl DESC, jenis DESC, ref_id DESC
                         LIMIT ? OFFSET ?
                        ) u
                    LEFT JOIN pelanggan pl ON pl.kode_pelanggan = u.kode_pelanggan
                  ORDER BY u.tgl DESC, u.jenis DESC, u.ref_id DESC`,
                [...paramsGabung, limit, offset]
            )
        ]);

        // rincian per faktur hanya untuk baris pembayaran
        // (kalau filter pelanggan aktif, hanya faktur milik pelanggan itu yang ditampilkan)
        const detailMap = new Map();
        const idBayar = rows.filter((r) => r.jenis === 'PEMBAYARAN').map((r) => r.ref_id);
        if (idBayar.length > 0) {
            const [details] = await db.query(
                `SELECT d.id_pembayaran, d.no_faktur, d.jumlah, d.sisa_sebelum, d.sisa_sesudah
       FROM pembayaran_piutang_detail d
       ${kode ? `JOIN penjualan_header pk ON pk.no_faktur = d.no_faktur AND pk.kode_pelanggan = ?${hanyaHutang ? ' AND pk.sisa_piutang > 0' : ''}` : ''}
      WHERE d.id_pembayaran IN (?)
      ${noFaktur ? 'AND d.no_faktur = ?' : ''}
      ORDER BY d.id`,
                [...(kode ? [kode] : []), idBayar, ...(noFaktur ? [noFaktur] : [])]
            );
            for (const d of details) {
                if (!detailMap.has(d.id_pembayaran)) detailMap.set(d.id_pembayaran, []);
                detailMap.get(d.id_pembayaran).push({
                    no_faktur: d.no_faktur,
                    jumlah: num(d.jumlah),
                    sisa_sebelum: num(d.sisa_sebelum),
                    sisa_sesudah: num(d.sisa_sesudah)
                });
            }
        }

        const total = num(cnt[0]?.bayar) + num(cnt[0]?.retur);
        return res.status(200).json({
            status: true,
            data: {
                riwayat: rows.map((h) => {
                    const retur = h.jenis === 'RETUR';
                    const isReturSilang = retur && (h.no_faktur_lain && h.no_faktur_retur !== h.no_faktur_lain);
                    const isDcr = !retur && h.kode_pelanggan === 'MULTI_TOKO';

                    const rincianFinal = retur
                        ? [{
                            no_faktur: h.no_faktur_retur,
                            no_faktur_asal_barang: h.no_faktur_lain || h.no_faktur_retur,
                            jumlah: num(h.total),
                            sisa_sebelum: null,
                            sisa_sesudah: null
                        }]
                        : (detailMap.get(Number(h.ref_id)) || detailMap.get(String(h.ref_id)) || []);

                    return {
                        jenis: h.jenis,
                        no_bayar: h.nomor,
                        no_retur: retur ? h.nomor : null,
                        kode_pelanggan: h.kode_pelanggan,
                        nama_pelanggan: isDcr ? 'Setoran DCR (Multi Toko)' : h.nama_pelanggan,
                        tanggal_bayar: h.tanggal,
                        // DCR + filter pelanggan: tampilkan hanya porsi pelanggan ini
                        total_bayar: !retur && kode && (isDcr || hanyaHutang || noFaktur)
                            ? rincianFinal.reduce((a, x) => a + x.jumlah, 0)
                            : num(h.total),
                        metode: h.metode,
                        catatan: h.catatan,
                        dibuat_oleh: h.dibuat_oleh,
                        is_retur_silang: isReturSilang,
                        no_faktur_asli: retur ? h.no_faktur_retur : null,
                        no_faktur_lain: retur ? (h.no_faktur_lain || h.no_faktur_retur) : null,

                        dpp_total: retur ? num(h.dpp_total) : null,
                        ppn_persen: retur ? num(h.ppn_persen) : null,
                        ppn_nominal: retur ? num(h.ppn_nominal) : null,
                        grand_total: retur ? num(h.grand_total) : null,

                        rincian: rincianFinal
                    };
                }),
                paging: { page, limit, total, total_page: Math.max(1, Math.ceil(total / limit)) }
            }
        });
    } catch (err) {
        return responError(res, err, 'RIWAYAT_PEMBAYARAN');
    }
}
