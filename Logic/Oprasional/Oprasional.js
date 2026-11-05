// ============================================================================
// MODUL BEBAN OPERASIONAL (BE) — SATU FILE, 5 ENDPOINT
//
//   GET  /SERVER_OPERASIONAL/KATEGORI_OPERASIONAL   daftar kategori beban (sumber tunggal untuk FE)
//   POST /SERVER_OPERASIONAL/TAMBAH_OPERASIONAL     catat 1 beban
//   GET  /SERVER_OPERASIONAL/DAFTAR_OPERASIONAL     riwayat + filter + pagination
//   GET  /SERVER_OPERASIONAL/RINGKASAN_OPERASIONAL  total, per kategori, per metode, banding periode lalu
//   POST /SERVER_OPERASIONAL/BATALKAN_OPERASIONAL   batalkan (soft delete, wajib alasan)
//
// Taruh di FILE TERSENDIRI. Jalankan operasional.sql dulu.
//
// PRINSIP KEUANGAN
//  - Data TIDAK pernah dihapus/diubah nominalnya. Salah input = BATALKAN lalu catat ulang.
//    Jadi laporan keuangan yang sudah dilihat tidak berubah diam-diam.
//  - Semua nominal, tanggal, dan kategori divalidasi di server. FE hanya kemudahan.
//  - Waktu memakai WIB (UTC+7) dan tidak bergantung timezone server.
//  - Semua query memakai placeholder (anti SQL injection); ORDER BY dari whitelist.
//  - TAMBAH idempoten lewat request_id: klik dobel / retry tidak membuat baris ganda.
//
// ASUMSI: db dari ../../db.js (mysql2/promise pool). Identitas admin dibaca dari
// req.user (hasil middleware CekRequestAkses) — sesuaikan di ambilNamaAdmin().
// ============================================================================
import { db } from "../../db.js";

// ----------------------------------------------------------------------------
// KONFIGURASI
// ----------------------------------------------------------------------------
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_PAGE = 100_000;
const MAX_KEYWORD_LEN = 100;
const MAX_NOMINAL = 2_000_000_000;      // kolom jumlah_biaya bertipe INT (maks 2.147.483.647)
const MAX_LEN_KETERANGAN = 255;
const MAX_LEN_NO_BUKTI = 50;
const MAX_LEN_KATEGORI_FILTER = 50;
const MIN_LEN_ALASAN = 5;
const MAX_LEN_ALASAN = 255;
const MAX_BACKDATE_HARI = 366;          // input beban maksimal 1 tahun ke belakang
const TOLERANSI_FUTURE_MENIT = 5;       // selisih jam perangkat yang masih dimaafkan
const MAX_RENTANG_HARI = 3660;          // batas rentang filter tanggal (10 tahun)

const METODE_VALID = ['TUNAI', 'TRANSFER'];
const STATUS_FILTER_VALID = ['AKTIF', 'BATAL', 'SEMUA'];

// Kategori resmi untuk input BARU. Ubah daftar ini kalau toko butuh kategori lain
// (kode maksimal 50 karakter, huruf besar dan underscore).
const KATEGORI_BEBAN = [
    { kode: 'GAJI_KARYAWAN', label: 'Gaji Karyawan' },
    { kode: 'LISTRIK_AIR', label: 'Listrik & Air' },
     { kode: 'BEBAN RETUR', label: 'BEBAN RETUR' },
    { kode: 'SEWA_TEMPAT', label: 'Sewa Tempat' },
    { kode: 'BENSIN_TRANSPORT', label: 'Bensin & Transport' },
    { kode: 'PERBAIKAN_PERAWATAN', label: 'Perbaikan & Perawatan' },
    { kode: 'PERLENGKAPAN_TOKO', label: 'Perlengkapan Toko' },
    { kode: 'KEBERSIHAN_KEAMANAN', label: 'Kebersihan & Keamanan' },
    { kode: 'KOMUNIKASI_INTERNET', label: 'Pulsa & Internet' },
    { kode: 'PAJAK_RETRIBUSI', label: 'Pajak & Retribusi' },
    { kode: 'KONSUMSI', label: 'Konsumsi' },
    { kode: 'LAINNYA', label: 'Lainnya (wajib isi keterangan)' }
];
const KATEGORI_KODE = new Set(KATEGORI_BEBAN.map((k) => k.kode));
const KATEGORI_LABEL = new Map(KATEGORI_BEBAN.map((k) => [k.kode, k.label]));

// whitelist urutan (ORDER BY tidak pernah dari input mentah)
const URUTAN = {
    terbaru: 'tanggal DESC, id_operasional DESC',
    terlama: 'tanggal ASC, id_operasional ASC',
    terbesar: 'jumlah_biaya DESC, id_operasional DESC',
    terkecil: 'jumlah_biaya ASC, id_operasional ASC'
};

const KOLOM_BARIS = `
    id_operasional,
    DATE_FORMAT(tanggal, '%Y-%m-%d %H:%i:%s')          AS tanggal,
    kategori_beban,
    keterangan,
    no_bukti,
    jumlah_biaya,
    metode_bayar,
    status,
    dibuat_oleh,
    DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s')       AS created_at,
    dibatalkan_oleh,
    DATE_FORMAT(dibatalkan_pada, '%Y-%m-%d %H:%i:%s')  AS dibatalkan_pada,
    alasan_batal`;

class OperasionalError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.name = 'OperasionalError';
        this.status = status;
    }
}

// ----------------------------------------------------------------------------
// HELPER
// ----------------------------------------------------------------------------
const num = (v) => Number(v) || 0;
const fmtRp = (n) => Number(n).toLocaleString('id-ID');
const pad2 = (n) => String(n).padStart(2, '0');

// hanya terima string asli (menolak array/objek dari query ?a[]=1 atau ?a[x]=1)
const str = (v) => (typeof v === 'string' ? v : '');

function keInt(v) {
    const s = String(v ?? '').trim();
    return /^\d+$/.test(s) ? Number(s) : NaN;
}

function escLike(s) {
    return s.replace(/[\\%_]/g, '\\$&');
}

// "sekarang" dalam WIB, direpresentasikan sebagai komponen UTC (tanpa DST)
function wibSekarang() {
    const ms = Date.now() + 7 * 60 * 60 * 1000;
    const w = new Date(ms);
    const tanggal = `${w.getUTCFullYear()}-${pad2(w.getUTCMonth() + 1)}-${pad2(w.getUTCDate())}`;
    return {
        ms,
        tanggal,
        sql: `${tanggal} ${pad2(w.getUTCHours())}:${pad2(w.getUTCMinutes())}:${pad2(w.getUTCSeconds())}`
    };
}

// 'YYYY-MM-DD' valid (tanggal kalender nyata) -> {y,m,d} atau null
function parseTanggal(s) {
    const mt = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!mt) return null;
    const y = Number(mt[1]);
    const m = Number(mt[2]);
    const d = Number(mt[3]);
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return { y, m, d, ms: dt.getTime() };
}

function tambahHari(tglStr, n) {
    const p = parseTanggal(tglStr);
    const w = new Date(p.ms + n * 86_400_000);
    return `${w.getUTCFullYear()}-${pad2(w.getUTCMonth() + 1)}-${pad2(w.getUTCDate())}`;
}

function selisihHariInklusif(dari, sampai) {
    return Math.round((parseTanggal(sampai).ms - parseTanggal(dari).ms) / 86_400_000) + 1;
}

// 'YYYY-MM-DDTHH:mm[:ss]' atau 'YYYY-MM-DD HH:mm[:ss]' -> { sql, ms } (WIB) atau null
function parseTanggalWaktu(s) {
    const mt = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
    if (!mt) return null;
    const tgl = parseTanggal(mt[1]);
    const jam = Number(mt[2]);
    const menit = Number(mt[3]);
    const detik = mt[4] === undefined ? 0 : Number(mt[4]);
    if (!tgl || jam > 23 || menit > 59 || detik > 59) return null;
    return {
        ms: Date.UTC(tgl.y, tgl.m - 1, tgl.d, jam, menit, detik),
        sql: `${mt[1]} ${pad2(jam)}:${pad2(menit)}:${pad2(detik)}`
    };
}

function bersihkanTeks(v) {
    return String(v)
        .replace(/[\u0000-\u001F\u007F]/g, ' ') // buang karakter kontrol
        .replace(/\s+/g, ' ')
        .trim();
}

function ambilNamaAdmin(req) {
    const u = req.user || req.admin || {};
    const nama = u.username ?? u.nama ?? u.name ?? u.id ?? null;
    return String(nama ?? 'ADMIN').slice(0, 100);
}

function ambilPaging(query) {
    const page = Math.min(MAX_PAGE, Math.max(1, keInt(query.page) || 1));
    const limit = Math.min(MAX_LIMIT, Math.max(1, keInt(query.limit) || DEFAULT_LIMIT));
    return { page, limit, offset: (page - 1) * limit };
}

function responError(res, err, tag) {
    if (err instanceof OperasionalError) {
        return res.status(err.status).json({ status: false, message: err.message });
    }
    if (err && (err.code === 'ER_LOCK_DEADLOCK' || err.code === 'ER_LOCK_WAIT_TIMEOUT')) {
        console.warn(`[${tag}] Lock contention:`, err.code);
        return res.status(409).json({
            status: false,
            message: 'Sistem sedang sibuk memproses data yang sama. Silakan coba lagi.'
        });
    }
    console.error(`[${tag}] Unexpected error:`, err);
    return res.status(500).json({
        status: false,
        message: 'Terjadi kesalahan sistem. Silakan coba lagi atau hubungi admin.'
    });
}

function petaBaris(r) {
    return {
        id_operasional: r.id_operasional,
        tanggal: r.tanggal,
        kategori_beban: r.kategori_beban,
        kategori_label: KATEGORI_LABEL.get(r.kategori_beban) || r.kategori_beban,
        keterangan: r.keterangan,
        no_bukti: r.no_bukti,
        jumlah_biaya: num(r.jumlah_biaya),
        metode_bayar: r.metode_bayar,
        status: r.status,
        dibuat_oleh: r.dibuat_oleh,
        created_at: r.created_at,
        dibatalkan_oleh: r.dibatalkan_oleh,
        dibatalkan_pada: r.dibatalkan_pada,
        alasan_batal: r.alasan_batal
    };
}

// ----------------------------------------------------------------------------
// FILTER (dipakai DAFTAR dan RINGKASAN, supaya angka selalu sinkron)
// ----------------------------------------------------------------------------
function parseFilter(query) {
    const q = bersihkanTeks(str(query.q)).slice(0, MAX_KEYWORD_LEN);
    const kategori = bersihkanTeks(str(query.kategori)).slice(0, MAX_LEN_KATEGORI_FILTER);

    const metode = str(query.metode).toUpperCase();
    if (metode && !METODE_VALID.includes(metode)) {
        throw new OperasionalError('Filter metode bayar tidak valid!');
    }

    const statusRaw = str(query.status).toUpperCase() || 'AKTIF';
    if (!STATUS_FILTER_VALID.includes(statusRaw)) {
        throw new OperasionalError('Filter status tidak valid!');
    }

    const dari = str(query.dari).trim();
    const sampai = str(query.sampai).trim();
    if (dari && !parseTanggal(dari)) throw new OperasionalError('Tanggal "dari" tidak valid (format YYYY-MM-DD)!');
    if (sampai && !parseTanggal(sampai)) throw new OperasionalError('Tanggal "sampai" tidak valid (format YYYY-MM-DD)!');
    if (dari && sampai) {
        if (dari > sampai) throw new OperasionalError('Tanggal "dari" tidak boleh lebih besar dari "sampai"!');
        if (selisihHariInklusif(dari, sampai) > MAX_RENTANG_HARI) {
            throw new OperasionalError('Rentang tanggal terlalu panjang!');
        }
    }

    return { q, kategori, metode, status: statusRaw, dari, sampai };
}

function bangunWhere(f, statusPaksa) {
    const conds = [];
    const params = [];

    const status = statusPaksa || f.status;
    if (status !== 'SEMUA') {
        conds.push('status = ?');
        params.push(status);
    }
    if (f.dari) {
        conds.push('tanggal >= ?');
        params.push(`${f.dari} 00:00:00`);
    }
    if (f.sampai) {
        conds.push('tanggal < ?');
        params.push(`${tambahHari(f.sampai, 1)} 00:00:00`);
    }
    if (f.kategori) {
        conds.push('kategori_beban = ?');
        params.push(f.kategori);
    }
    if (f.metode) {
        conds.push('metode_bayar = ?');
        params.push(f.metode);
    }
    for (const t of f.q.split(' ').filter(Boolean).slice(0, 5)) {
        const like = `%${escLike(t)}%`;
        conds.push('(keterangan LIKE ? OR kategori_beban LIKE ? OR no_bukti LIKE ?)');
        params.push(like, like, like);
    }

    return { whereSql: conds.length ? `WHERE ${conds.join(' AND ')}` : '', params };
}

// ============================================================================
// 1. KATEGORI
// Kategori resmi + kategori lama (data sebelum fitur ini) yang masih ada di tabel,
// supaya filter riwayat tetap bisa memilih data lama.
// ============================================================================
export async function KATEGORI_OPERASIONAL(req, res) {
    try {
        const [legacy] = await db.query(
            `SELECT DISTINCT kategori_beban
               FROM operasional
              WHERE kategori_beban NOT IN (?)
              ORDER BY kategori_beban
              LIMIT 100`,
            [[...KATEGORI_KODE]]
        );
        return res.status(200).json({
            status: true,
            data: {
                kategori: KATEGORI_BEBAN,
                kategori_lama: legacy.map((r) => r.kategori_beban),
                metode: METODE_VALID,
                batas: {
                    max_nominal: MAX_NOMINAL,
                    max_keterangan: MAX_LEN_KETERANGAN,
                    max_no_bukti: MAX_LEN_NO_BUKTI,
                    max_backdate_hari: MAX_BACKDATE_HARI,
                    min_alasan_batal: MIN_LEN_ALASAN,
                    max_alasan_batal: MAX_LEN_ALASAN
                }
            }
        });
    } catch (err) {
        return responError(res, err, 'KATEGORI_OPERASIONAL');
    }
}

// ============================================================================
// 2. TAMBAH
// Body: { kategori_beban, jumlah_biaya, tanggal ('YYYY-MM-DDTHH:mm'), keterangan?,
//         no_bukti?, metode_bayar?, request_id (UUID dari FE) }
// ============================================================================
const REGEX_UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const REGEX_NO_BUKTI = /^[A-Za-z0-9][A-Za-z0-9 ._\-/]*$/;

function parseTambah(body, sekarang) {
    const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};

    const kategori = str(b.kategori_beban).trim();
    if (!KATEGORI_KODE.has(kategori)) throw new OperasionalError('Kategori beban tidak valid!');

    const jumlah = keInt(b.jumlah_biaya);
    if (!Number.isSafeInteger(jumlah) || jumlah <= 0) {
        throw new OperasionalError('Jumlah biaya harus bilangan bulat rupiah lebih dari 0!');
    }
    if (jumlah > MAX_NOMINAL) {
        throw new OperasionalError(`Jumlah biaya melebihi batas (maks Rp ${fmtRp(MAX_NOMINAL)})!`);
    }

    const waktu = parseTanggalWaktu(str(b.tanggal).trim());
    if (!waktu) throw new OperasionalError('Tanggal & jam tidak valid!');
    if (waktu.ms > sekarang.ms + TOLERANSI_FUTURE_MENIT * 60_000) {
        throw new OperasionalError('Tanggal beban tidak boleh di masa depan!');
    }
    if (waktu.ms < sekarang.ms - MAX_BACKDATE_HARI * 86_400_000) {
        throw new OperasionalError(`Tanggal beban maksimal ${MAX_BACKDATE_HARI} hari ke belakang!`);
    }

    const keterangan = b.keterangan === undefined || b.keterangan === null ? '' : bersihkanTeks(b.keterangan);
    if (keterangan.length > MAX_LEN_KETERANGAN) {
        throw new OperasionalError(`Keterangan maksimal ${MAX_LEN_KETERANGAN} karakter!`);
    }
    if (kategori === 'LAINNYA' && keterangan.length < 3) {
        throw new OperasionalError('Kategori "Lainnya" wajib diisi keterangan (minimal 3 karakter)!');
    }

    const noBukti = b.no_bukti === undefined || b.no_bukti === null ? '' : bersihkanTeks(b.no_bukti);
    if (noBukti && (noBukti.length > MAX_LEN_NO_BUKTI || !REGEX_NO_BUKTI.test(noBukti))) {
        throw new OperasionalError(
            `No bukti hanya boleh huruf, angka, spasi, titik, minus, garis miring (maks ${MAX_LEN_NO_BUKTI} karakter)!`
        );
    }

    const metode = b.metode_bayar === undefined || b.metode_bayar === null || b.metode_bayar === ''
        ? 'TUNAI'
        : str(b.metode_bayar).toUpperCase();
    if (!METODE_VALID.includes(metode)) {
        throw new OperasionalError(`Metode bayar tidak valid! Pilihan: ${METODE_VALID.join(', ')}.`);
    }

    const requestId = str(b.request_id).trim();
    if (!REGEX_UUID.test(requestId)) throw new OperasionalError('Kunci permintaan (request_id) tidak valid!');

    return {
        kategori,
        jumlah,
        tanggalSql: waktu.sql,
        keterangan: keterangan || null,
        noBukti: noBukti || null,
        metode,
        requestId: requestId.toLowerCase()
    };
}

async function ambilBarisById(id) {
    const [rows] = await db.query(`SELECT ${KOLOM_BARIS} FROM operasional WHERE id_operasional = ? LIMIT 1`, [id]);
    return rows[0] || null;
}

export async function TAMBAH_OPERASIONAL(req, res) {
    const sekarang = wibSekarang();
    let p;
    try {
        p = parseTambah(req.body, sekarang);
    } catch (err) {
        return res.status(err.status || 400).json({ status: false, message: err.message });
    }

    const admin = ambilNamaAdmin(req);

    try {
        let insertId;
        try {
            const [r] = await db.query(
                `INSERT INTO operasional
                    (tanggal, kategori_beban, keterangan, no_bukti, jumlah_biaya, metode_bayar,
                     status, dibuat_oleh, created_at, request_id)
                 VALUES (?, ?, ?, ?, ?, ?, 'AKTIF', ?, ?, ?)`,
                [p.tanggalSql, p.kategori, p.keterangan, p.noBukti, p.jumlah, p.metode,
                 admin, sekarang.sql, p.requestId]
            );
            insertId = r.insertId;
        } catch (err) {
            // Permintaan yang sama dikirim ulang (klik dobel / retry) -> kembalikan baris yang sudah ada
            if (err && err.code === 'ER_DUP_ENTRY' && String(err.sqlMessage || err.message).includes('uq_operasional_request_id')) {
                const [rows] = await db.query(
                    `SELECT ${KOLOM_BARIS} FROM operasional WHERE request_id = ? LIMIT 1`,
                    [p.requestId]
                );
                if (rows[0]) {
                    return res.status(200).json({
                        status: true,
                        message: 'Beban ini sudah tercatat sebelumnya.',
                        data: { duplikat: true, operasional: petaBaris(rows[0]) }
                    });
                }
            }
            throw err;
        }

        const baris = await ambilBarisById(insertId);
        return res.status(200).json({
            status: true,
            message: 'Beban operasional berhasil dicatat!',
            data: { duplikat: false, operasional: baris ? petaBaris(baris) : null }
        });
    } catch (err) {
        return responError(res, err, 'TAMBAH_OPERASIONAL');
    }
}

// ============================================================================
// 3. DAFTAR (riwayat) — filter + pagination
// Query: q, kategori, metode, status (AKTIF|BATAL|SEMUA, default AKTIF),
//        dari, sampai (YYYY-MM-DD), sort (terbaru|terlama|terbesar|terkecil), page, limit
// ============================================================================
export async function DAFTAR_OPERASIONAL(req, res) {
    try {
        const f = parseFilter(req.query);
        const sortRaw = str(req.query.sort);
        const sortKey = Object.hasOwn(URUTAN, sortRaw) ? sortRaw : 'terbaru';
        const { page, limit, offset } = ambilPaging(req.query);
        const { whereSql, params } = bangunWhere(f);

        const [[cnt], [rows]] = await Promise.all([
            db.query(`SELECT COUNT(*) AS total FROM operasional ${whereSql}`, params),
            db.query(
                `SELECT ${KOLOM_BARIS}
                   FROM operasional
                   ${whereSql}
                  ORDER BY ${URUTAN[sortKey]}
                  LIMIT ? OFFSET ?`,
                [...params, limit, offset]
            )
        ]);

        const total = num(cnt[0]?.total);
        return res.status(200).json({
            status: true,
            data: {
                operasional: rows.map(petaBaris),
                paging: {
                    page,
                    limit,
                    total,
                    total_page: Math.max(1, Math.ceil(total / limit)),
                    dari: offset >= total ? 0 : offset + 1,
                    sampai: offset >= total ? 0 : Math.min(offset + limit, total)
                }
            }
        });
    } catch (err) {
        return responError(res, err, 'DAFTAR_OPERASIONAL');
    }
}

// ============================================================================
// 4. RINGKASAN — selalu hanya data AKTIF, mengikuti filter periode/kategori/metode/pencarian
// Query: dari, sampai, kategori, metode, q
// Perbandingan: bila dari & sampai diisi, dibandingkan dengan periode sebelumnya
// yang panjangnya sama persis (hari yang sama jumlahnya).
// ============================================================================
export async function RINGKASAN_OPERASIONAL(req, res) {
    try {
        const f = parseFilter(req.query);
        const { whereSql, params } = bangunWhere(f, 'AKTIF');

        let queryPrev = null;
        let periodePrev = null;
        if (f.dari && f.sampai) {
            const panjang = selisihHariInklusif(f.dari, f.sampai);
            periodePrev = { dari: tambahHari(f.dari, -panjang), sampai: tambahHari(f.dari, -1) };
            const w = bangunWhere({ ...f, dari: periodePrev.dari, sampai: periodePrev.sampai }, 'AKTIF');
            queryPrev = db.query(
                `SELECT COALESCE(SUM(jumlah_biaya), 0) AS total FROM operasional ${w.whereSql}`,
                w.params
            );
        }

        const [[ringkas], [perKategori], [perMetode], prev] = await Promise.all([
            db.query(
                `SELECT COUNT(*)                         AS jumlah,
                        COALESCE(SUM(jumlah_biaya), 0)   AS total,
                        COALESCE(MAX(jumlah_biaya), 0)   AS tertinggi
                   FROM operasional ${whereSql}`,
                params
            ),
            db.query(
                `SELECT kategori_beban, COUNT(*) AS jumlah, SUM(jumlah_biaya) AS total
                   FROM operasional ${whereSql}
                  GROUP BY kategori_beban
                  ORDER BY total DESC, kategori_beban ASC
                  LIMIT 30`,
                params
            ),
            db.query(
                `SELECT metode_bayar, SUM(jumlah_biaya) AS total
                   FROM operasional ${whereSql}
                  GROUP BY metode_bayar`,
                params
            ),
            queryPrev ? queryPrev : Promise.resolve([[{ total: null }]])
        ]);

        const total = num(ringkas[0]?.total);
        const jumlah = num(ringkas[0]?.jumlah);
        const totalPrev = prev[0][0].total === null ? null : num(prev[0][0].total);

        let perubahanPersen = null;
        if (totalPrev !== null && totalPrev > 0) {
            perubahanPersen = Math.round(((total - totalPrev) / totalPrev) * 1000) / 10;
        }

        return res.status(200).json({
            status: true,
            data: {
                total,
                jumlah_transaksi: jumlah,
                rata_rata: jumlah > 0 ? Math.round(total / jumlah) : 0,
                tertinggi: num(ringkas[0]?.tertinggi),
                per_kategori: perKategori.map((r) => ({
                    kategori_beban: r.kategori_beban,
                    kategori_label: KATEGORI_LABEL.get(r.kategori_beban) || r.kategori_beban,
                    jumlah: num(r.jumlah),
                    total: num(r.total),
                    persen: total > 0 ? Math.round((num(r.total) / total) * 1000) / 10 : 0
                })),
                per_metode: perMetode.map((r) => ({ metode_bayar: r.metode_bayar, total: num(r.total) })),
                pembanding: periodePrev
                    ? { dari: periodePrev.dari, sampai: periodePrev.sampai, total: totalPrev, perubahan_persen: perubahanPersen }
                    : null
            }
        });
    } catch (err) {
        return responError(res, err, 'RINGKASAN_OPERASIONAL');
    }
}

// ============================================================================
// 5. BATALKAN (soft delete)
// Body: { id_operasional, alasan }
// Atomik: UPDATE ... WHERE status = 'AKTIF' -> dua admin membatalkan bersamaan,
// hanya satu yang berhasil.
// ============================================================================
export async function BATALKAN_OPERASIONAL(req, res) {
    const b = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const id = keInt(b.id_operasional);
    const alasan = b.alasan === undefined || b.alasan === null ? '' : bersihkanTeks(b.alasan);

    if (!Number.isSafeInteger(id) || id <= 0) {
        return res.status(400).json({ status: false, message: 'ID operasional tidak valid!' });
    }
    if (alasan.length < MIN_LEN_ALASAN || alasan.length > MAX_LEN_ALASAN) {
        return res.status(400).json({
            status: false,
            message: `Alasan pembatalan wajib diisi (${MIN_LEN_ALASAN}-${MAX_LEN_ALASAN} karakter)!`
        });
    }

    const sekarang = wibSekarang();
    const admin = ambilNamaAdmin(req);

    try {
        const [u] = await db.query(
            `UPDATE operasional
                SET status = 'BATAL', dibatalkan_oleh = ?, dibatalkan_pada = ?, alasan_batal = ?
              WHERE id_operasional = ? AND status = 'AKTIF'`,
            [admin, sekarang.sql, alasan, id]
        );

        if (u.affectedRows !== 1) {
            const ada = await ambilBarisById(id);
            if (!ada) throw new OperasionalError('Data operasional tidak ditemukan!', 404);
            throw new OperasionalError('Data ini sudah dibatalkan sebelumnya.', 409);
        }

        const baris = await ambilBarisById(id);
        return res.status(200).json({
            status: true,
            message: 'Beban operasional berhasil dibatalkan.',
            data: { operasional: baris ? petaBaris(baris) : null }
        });
    } catch (err) {
        return responError(res, err, 'BATALKAN_OPERASIONAL');
    }
}
