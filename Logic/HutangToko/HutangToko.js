// ============================================================================
// MODUL HUTANG TOKO KE SUPPLIER (BE) — SATU FILE, 4 ENDPOINT
//
//   GET  /api-be/SERVER_HUTANG/DAFTAR_HUTANG_SUPPLIER    daftar supplier yang masih dihutangi toko
//   GET  /api-be/SERVER_HUTANG/DETAIL_HUTANG_SUPPLIER    faktur belanja yang belum lunas
//   POST /api-be/SERVER_HUTANG/BAYAR_HUTANG              input pembayaran hutang per faktur
//   GET  /api-be/SERVER_HUTANG/RIWAYAT_PEMBAYARAN_HUTANG riwayat pembayaran
//
// PASANG (contoh, samakan gaya dengan router SERVER_PIUTANG kamu):
//   import * as Hutang from './Hutang.mjs';
//   router.get('/DAFTAR_HUTANG_SUPPLIER',     <middleware auth>, Hutang.DAFTAR_HUTANG_SUPPLIER);
//   router.get('/DETAIL_HUTANG_SUPPLIER',     <middleware auth>, Hutang.DETAIL_HUTANG_SUPPLIER);
//   router.post('/BAYAR_HUTANG',              <middleware auth>, Hutang.BAYAR_HUTANG);
//   router.get('/RIWAYAT_PEMBAYARAN_HUTANG',  <middleware auth>, Hutang.RIWAYAT_PEMBAYARAN_HUTANG);
//   app.use('/SERVER_HUTANG', router);          // router TIDAK memakai prefix lagi
//
// SKEMA YANG DIPAKAI:
//   pembelian_header : id, no_faktur, supplier_id, nama_supplier, subtotal,
//                      tanggal_belanja, total_harga, diskon, dibayar,
//                      sisa_hutang, jatuh_tempo, status_bayar
//   + 3 tabel baru di hutang_supplier_bayar.sql
// Tabel `supplier` tidak dipakai: nama supplier diambil dari pembelian_header.
//
// Semua nominal dihitung di SERVER. FE hanya mengirim id supplier, id faktur
// belanja, dan jumlah uang yang dibayarkan.
// ============================================================================
import { db } from "../../db.js"; // sesuaikan path

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_KEYWORD_LEN = 100;
const MAX_ITEMS_BAYAR = 50;
const MAX_FAKTUR_DETAIL = 200;                 // batas faktur yang dikirim ke panel
const MAX_NOMINAL = 100_000_000_000;           // 100 miliar, batas waras per faktur
const MAX_LEN_CATATAN = 500;
const MAX_LEN_ID = 18;                         // digit id numerik
const METODE_BAYAR = ['TUNAI', 'TRANSFER'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// whitelist urutan (ORDER BY tidak boleh berasal dari input mentah)
const URUTAN_DAFTAR = {
    total_desc: 'g.total_hutang DESC, hx.nama_supplier ASC, g.supplier_id ASC',
    total_asc: 'g.total_hutang ASC, hx.nama_supplier ASC, g.supplier_id ASC',
    jatuh_tempo: 'g.jatuh_tempo_terdekat IS NULL, g.jatuh_tempo_terdekat ASC, hx.nama_supplier ASC, g.supplier_id ASC',
    terlama: 'g.faktur_tertua ASC, hx.nama_supplier ASC, g.supplier_id ASC',
    nama: 'hx.nama_supplier ASC, g.supplier_id ASC'
};

class HutangError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.name = 'HutangError';
        this.status = status;
    }
}

// ----------------------------------------------------------------------------
// HELPER
// ----------------------------------------------------------------------------
const fmtRp = (n) => Number(n).toLocaleString('id-ID');
const num = (v) => Number(v) || 0;

// string aman: hanya tipe string (array/object dari query diabaikan), tanpa karakter kontrol
// eslint-disable-next-line no-control-regex
const str = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001F\u007F]/g, '').trim() : '');

// bilangan bulat murni >= 0 (tolak 1e5, 1.5, -1, "abc", "")
function keInt(v) {
    const s = typeof v === 'number' ? String(v) : (typeof v === 'string' ? v.trim() : '');
    return /^\d{1,18}$/.test(s) ? Number(s) : NaN;
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
        tanggal,
        yyyymmdd: tanggal.replaceAll('-', ''),
        sql: `${tanggal} ${p(w.getUTCHours())}:${p(w.getUTCMinutes())}:${p(w.getUTCSeconds())}`
    };
}

const TGL_RE = /^\d{4}-\d{2}-\d{2}$/;
function selisihHari(dariStr, keStr) {
    // (ke - dari) dalam hari, bertanda
    if (!TGL_RE.test(dariStr || '') || !TGL_RE.test(keStr || '')) return null;
    const [y, m, d] = dariStr.split('-').map(Number);
    const [y2, m2, d2] = keStr.split('-').map(Number);
    return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y, m - 1, d)) / 86_400_000);
}
// umur (>= 0) sejak tanggal sampai hari ini
const umurHari = (tglStr, hariIni) => {
    const s = selisihHari(tglStr, hariIni);
    return s === null ? null : Math.max(0, s);
};
// hari menuju jatuh tempo: positif = masih lama, 0 = hari ini, negatif = telat
const hariKeJatuhTempo = (tglStr, hariIni) => selisihHari(hariIni, tglStr);

function ambilPaging(query) {
    const page = Math.min(100000, Math.max(1, keInt(query.page) || 1));
    const limit = Math.min(MAX_LIMIT, Math.max(1, keInt(query.limit) || DEFAULT_LIMIT));
    return { page, limit, offset: (page - 1) * limit };
}

// Nama admin dari middleware auth (CekRequestAkses). SESUAIKAN kalau middleware kamu
// menyimpan identitas di properti lain.
function ambilNamaAdmin(req) {
    const u = req.user || req.admin || {};
    const nama = u.username ?? u.nama ?? u.name ?? u.id ?? null;
    return String(nama ?? 'ADMIN').slice(0, 100);
}

function parseIdSupplier(v) {
    const id = keInt(v);
    if (!Number.isSafeInteger(id) || id <= 0) throw new HutangError('Supplier tidak valid!');
    return id;
}

function responError(res, err, tag) {
    if (err instanceof HutangError) {
        return res.status(err.status).json({ status: false, message: err.message });
    }
    if (err && (err.code === 'ER_LOCK_DEADLOCK' || err.code === 'ER_LOCK_WAIT_TIMEOUT')) {
        console.warn(`[${tag}] Lock contention:`, err.code);
        return res.status(409).json({
            status: false,
            message: 'Sistem sedang memproses transaksi lain pada data yang sama. Silakan coba lagi.'
        });
    }
    if (err && err.code === 'ER_DUP_ENTRY') {
        console.warn(`[${tag}] Duplicate entry:`, err.message);
        return res.status(409).json({
            status: false,
            message: 'Permintaan ganda terdeteksi. Muat ulang halaman lalu cek riwayat pembayaran.'
        });
    }
    console.error(`[${tag}] Unexpected error:`, err);
    return res.status(500).json({
        status: false,
        message: 'Terjadi kesalahan sistem. Silakan coba lagi atau hubungi admin.'
    });
}

// ============================================================================
// 1. DAFTAR SUPPLIER YANG DIHUTANGI TOKO
// Query: q (nama supplier / no faktur, boleh banyak kata),
//        sort (total_desc | total_asc | jatuh_tempo | terlama | nama), page, limit
// ============================================================================
export async function DAFTAR_HUTANG_SUPPLIER(req, res) {
    try {
        const q = str(req.query.q).slice(0, MAX_KEYWORD_LEN);
        const sortRaw = str(req.query.sort);
        const sortKey = Object.hasOwn(URUTAN_DAFTAR, sortRaw) ? sortRaw : 'total_desc';
        const { page, limit, offset } = ambilPaging(req.query);
        const hariIni = wibSekarang().tanggal;

        // Semua kata harus cocok. Tiap kata boleh cocok ke nama supplier atau nomor faktur
        // milik supplier itu. Filter di level SUPPLIER (EXISTS), jadi total hutang yang
        // tampil tetap total SELURUH faktur supplier tsb.
        const where = [`h.sisa_hutang > 0`];
        const params = [];
        for (const t of q.split(/\s+/).filter(Boolean).slice(0, 5)) {
            const like = `%${escLike(t)}%`;
            where.push(
                `(h.nama_supplier LIKE ?
                  OR EXISTS (SELECT 1 FROM pembelian_header x
                              WHERE x.supplier_id = h.supplier_id AND x.no_faktur LIKE ?))`
            );
            params.push(like, like);
        }
        const whereSql = where.join(' AND ');

        const [[ringkasanRows], [rows]] = await Promise.all([
            db.query(
                `SELECT COUNT(DISTINCT h.supplier_id) AS jumlah_supplier,
                        COUNT(*)                      AS jumlah_faktur,
                        COALESCE(SUM(h.sisa_hutang), 0) AS total_hutang,
                        COALESCE(SUM(CASE WHEN h.jatuh_tempo IS NOT NULL AND h.jatuh_tempo < ? THEN 1 ELSE 0 END), 0) AS faktur_lewat_tempo,
                        COALESCE(SUM(CASE WHEN h.jatuh_tempo IS NOT NULL AND h.jatuh_tempo < ? THEN h.sisa_hutang ELSE 0 END), 0) AS total_lewat_tempo
                   FROM pembelian_header h
                  WHERE ${whereSql}`,
                [hariIni, hariIni, ...params]
            ),
            db.query(
                `SELECT g.supplier_id,
                        hx.nama_supplier,
                        g.jumlah_faktur,
                        g.total_hutang,
                        g.faktur_tertua,
                        g.jatuh_tempo_terdekat,
                        g.faktur_lewat_tempo
                   FROM (
                        SELECT h.supplier_id,
                               COUNT(*)                                    AS jumlah_faktur,
                               SUM(h.sisa_hutang)                          AS total_hutang,
                               DATE_FORMAT(MIN(h.tanggal_belanja), '%Y-%m-%d') AS faktur_tertua,
                               DATE_FORMAT(MIN(h.jatuh_tempo), '%Y-%m-%d')     AS jatuh_tempo_terdekat,
                               SUM(CASE WHEN h.jatuh_tempo IS NOT NULL AND h.jatuh_tempo < ? THEN 1 ELSE 0 END) AS faktur_lewat_tempo,
                               MAX(h.id)                                   AS id_terbaru
                          FROM pembelian_header h
                         WHERE ${whereSql}
                         GROUP BY h.supplier_id
                   ) g
                   JOIN pembelian_header hx ON hx.id = g.id_terbaru
                  ORDER BY ${URUTAN_DAFTAR[sortKey]}
                  LIMIT ? OFFSET ?`,
                [hariIni, ...params, limit, offset]
            )
        ]);

        const r = ringkasanRows[0] || {};
        const totalSupplier = num(r.jumlah_supplier);

        return res.status(200).json({
            status: true,
            data: {
                ringkasan: {
                    jumlah_supplier: totalSupplier,
                    jumlah_faktur: num(r.jumlah_faktur),
                    total_hutang: num(r.total_hutang),
                    faktur_lewat_tempo: num(r.faktur_lewat_tempo),
                    total_lewat_tempo: num(r.total_lewat_tempo)
                },
                supplier: rows.map((x) => ({
                    supplier_id: x.supplier_id,
                    nama_supplier: x.nama_supplier,
                    jumlah_faktur: num(x.jumlah_faktur),
                    total_hutang: num(x.total_hutang),
                    faktur_tertua: x.faktur_tertua,
                    umur_terlama_hari: umurHari(x.faktur_tertua, hariIni),
                    jatuh_tempo_terdekat: x.jatuh_tempo_terdekat,
                    hari_ke_jatuh_tempo: hariKeJatuhTempo(x.jatuh_tempo_terdekat, hariIni),
                    faktur_lewat_tempo: num(x.faktur_lewat_tempo)
                })),
                paging: {
                    page,
                    limit,
                    total: totalSupplier,
                    total_page: Math.max(1, Math.ceil(totalSupplier / limit))
                }
            }
        });
    } catch (err) {
        return responError(res, err, 'DAFTAR_HUTANG_SUPPLIER');
    }
}

// ============================================================================
// 2. DETAIL HUTANG 1 SUPPLIER (faktur belanja yang belum lunas, terlama dulu)
// Query: supplier_id
//
// Rincian per faktur:
//   subtotal / diskon / total_harga : dari pembelian_header
//   dibayar_total       = pembelian_header.dibayar (saat belanja + semua cicilan)
//   cicilan             = SUM(pembayaran_hutang_detail.jumlah) faktur tsb
//   dibayar_di_awal     = dibayar_total - cicilan (dibayar saat belanja), tidak negatif
//   sisa_hutang         = angka resmi dari pembelian_header (sumber kebenaran)
// ============================================================================
// ============================================================================
// 2. DETAIL HUTANG 1 SUPPLIER (faktur belanja yang belum lunas)
// ============================================================================
export async function DETAIL_HUTANG_SUPPLIER(req, res) {
    try {
        const supplierId = parseIdSupplier(req.query.supplier_id);
        const hariIni = wibSekarang().tanggal;

        const [[fakturRows], [totalRows]] = await Promise.all([
            db.query(
                `SELECT h.id, h.no_faktur, h.nama_supplier,
       DATE_FORMAT(h.tanggal_belanja, '%Y-%m-%d') AS tanggal_belanja,
       DATE_FORMAT(h.jatuh_tempo, '%Y-%m-%d')     AS jatuh_tempo,
       h.subtotal, h.diskon,
       IFNULL(h.ppn_persen, 0) AS ppn_persen,
       IFNULL(h.ppn_nominal, 0) AS ppn_nominal,
       IFNULL(h.grand_total, h.total_harga) AS grand_total,
       h.total_harga, h.dibayar, h.sisa_hutang
  FROM pembelian_header h
                  WHERE h.supplier_id = ? AND h.sisa_hutang > 0
                  ORDER BY h.tanggal_belanja ASC, h.id ASC
                  LIMIT ?`,
                [supplierId, MAX_FAKTUR_DETAIL]
            ),
            db.query(
                `SELECT COUNT(*) AS jumlah_faktur, COALESCE(SUM(sisa_hutang), 0) AS total_hutang
                   FROM pembelian_header
                  WHERE supplier_id = ? AND sisa_hutang > 0`,
                [supplierId]
            )
        ]);

        if (fakturRows.length === 0) {
            const [nm] = await db.query(
                `SELECT nama_supplier FROM pembelian_header
                  WHERE supplier_id = ? ORDER BY id DESC LIMIT 1`,
                [supplierId]
            );
            if (nm.length === 0) throw new HutangError('Supplier tidak ditemukan!', 404);
            return res.status(200).json({
                status: true,
                data: {
                    supplier: { supplier_id: supplierId, nama_supplier: nm[0].nama_supplier },
                    ringkasan: { jumlah_faktur: 0, total_hutang: 0, umur_terlama_hari: null },
                    terpotong: false,
                    faktur: []
                }
            });
        }

        const idsPembelian = fakturRows.map((f) => f.id);
        const noFakturs = fakturRows.map((f) => f.no_faktur);

        // A. Ambil Cicilan Kas/Transfer
        const [cicilRows] = await db.query(
            `SELECT id_pembelian, SUM(jumlah) AS total
               FROM pembayaran_hutang_detail
              WHERE id_pembelian IN (?)
              GROUP BY id_pembelian`,
            [idsPembelian]
        );
        const cicilMap = new Map(cicilRows.map((r) => [String(r.id_pembelian), num(r.total)]));

        // B. Ambil Total Dipotong dari Retur Belanja
        const [returRows] = await db.query(
            `SELECT no_faktur, SUM(jumlah_potong_hutang) AS total_retur
               FROM retur_pembelian_header
              WHERE metode_penyelesaian = 'POTONG_HUTANG' AND no_faktur IN (?)
              GROUP BY no_faktur`,
            [noFakturs]
        );
        const returMap = new Map(returRows.map((r) => [String(r.no_faktur).toLowerCase().trim(), num(r.total_retur)]));

        const faktur = fakturRows.map((f) => {
            const cicilan = cicilMap.get(String(f.id)) || 0;
            const dipotong_retur = returMap.get(String(f.no_faktur).toLowerCase().trim()) || 0;
            const dibayarTotal = num(f.dibayar);

            return {
                id_pembelian: f.id,
                no_faktur: f.no_faktur,
                tanggal_belanja: f.tanggal_belanja,
                umur_hari: umurHari(f.tanggal_belanja, hariIni),
                jatuh_tempo: f.jatuh_tempo,
                hari_ke_jatuh_tempo: hariKeJatuhTempo(f.jatuh_tempo, hariIni),
                subtotal: num(f.subtotal),
                diskon: num(f.diskon),
                ppn_persen: num(f.ppn_persen),
                ppn_nominal: num(f.ppn_nominal),
                grand_total: num(f.grand_total),
                total_harga: num(f.total_harga),
                dibayar_di_awal: Math.max(0, dibayarTotal - cicilan), // murni dibayar tunai saat nota dibuat
                cicilan,
                dipotong_retur, // 👈 Properti Baru
                sisa_hutang: num(f.sisa_hutang)
            };
        });

        const terbaru = fakturRows.reduce((a, b) => (Number(b.id) > Number(a.id) ? b : a));
        const t = totalRows[0] || {};

        return res.status(200).json({
            status: true,
            data: {
                supplier: { supplier_id: supplierId, nama_supplier: terbaru.nama_supplier },
                ringkasan: {
                    jumlah_faktur: num(t.jumlah_faktur),
                    total_hutang: num(t.total_hutang),
                    umur_terlama_hari: faktur[0].umur_hari
                },
                terpotong: num(t.jumlah_faktur) > faktur.length,
                faktur
            }
        });
    } catch (err) {
        return responError(res, err, 'DETAIL_HUTANG_SUPPLIER');
    }
}



// ============================================================================
// 3. BAYAR HUTANG (per faktur, boleh banyak faktur dalam 1 kali bayar)
// Body: { supplier_id, metode: 'TUNAI'|'TRANSFER', catatan?, request_id?,
//         items: [{ id_pembelian, jumlah }] }
//
// Jaminan:
//  - 1 transaksi DB: header + detail + update hutang semua atau tidak sama sekali
//  - faktur dikunci berurutan (anti-deadlock)
//  - sisa_hutang tidak pernah negatif: UPDATE ... WHERE sisa_hutang = <yang dikunci>
//  - jumlah > sisa ditolak (tidak ada kelebihan bayar)
//  - faktur harus milik supplier yang dikirim
//  - request_id (UUID) mencegah dobel catat saat klik ganda / retry jaringan
//  - invarian: total_harga = dibayar + sisa_hutang selalu terjaga
// ============================================================================
function parseBayar(body) {
    const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const { items, metode, catatan, request_id: requestIdRaw } = b;

    const supplierId = parseIdSupplier(b.supplier_id);

    if (!Array.isArray(items) || items.length === 0) {
        throw new HutangError('Pilih minimal 1 faktur dan isi jumlah yang dibayar!');
    }
    if (items.length > MAX_ITEMS_BAYAR) {
        throw new HutangError(`Maksimal ${MAX_ITEMS_BAYAR} faktur dalam satu kali pembayaran.`);
    }

    const metodeFix = metode === undefined || metode === null || metode === ''
        ? 'TUNAI'
        : str(metode).toUpperCase();
    if (!METODE_BAYAR.includes(metodeFix)) {
        throw new HutangError(`Metode pembayaran tidak dikenali! Pilihan valid: ${METODE_BAYAR.join(', ')}.`);
    }

    if (catatan !== undefined && catatan !== null && typeof catatan !== 'string') {
        throw new HutangError('Catatan tidak valid!');
    }
    const catatanFix = str(catatan);
    if (catatanFix.length > MAX_LEN_CATATAN) {
        throw new HutangError(`Catatan maksimal ${MAX_LEN_CATATAN} karakter!`);
    }

    let requestId = null;
    if (requestIdRaw !== undefined && requestIdRaw !== null && requestIdRaw !== '') {
        requestId = typeof requestIdRaw === 'string' ? requestIdRaw.trim().toLowerCase() : '';
        if (!UUID_RE.test(requestId)) throw new HutangError('Request ID tidak valid!');
    }

    const seen = new Set();
    const normalized = items.map((it, i) => {
        if (!it || typeof it !== 'object' || Array.isArray(it)) {
            throw new HutangError(`Data faktur ke-${i + 1} tidak valid!`);
        }
        const idPembelian = keInt(it.id_pembelian);
        const jumlah = keInt(it.jumlah);
        if (!Number.isSafeInteger(idPembelian) || idPembelian <= 0) {
            throw new HutangError(`Faktur ke-${i + 1} tidak valid!`);
        }
        if (!Number.isSafeInteger(jumlah) || jumlah <= 0 || jumlah > MAX_NOMINAL) {
            throw new HutangError(`Jumlah bayar faktur ke-${i + 1} tidak valid (harus bilangan bulat rupiah > 0)!`);
        }
        if (seen.has(idPembelian)) {
            throw new HutangError(`Faktur ke-${i + 1} terdaftar dua kali. Gabungkan jadi satu baris!`);
        }
        seen.add(idPembelian);
        return { idPembelian, jumlah };
    });

    normalized.sort((a, b) => a.idPembelian - b.idPembelian); // urutan lock konsisten

    return {
        supplierId,
        metode: metodeFix,
        catatan: catatanFix || null,
        requestId,
        items: normalized,
        total: normalized.reduce((a, x) => a + x.jumlah, 0)
    };
}

async function buatNoBayar(conn, yyyymmdd) {
    const [r] = await conn.query(
        `INSERT INTO pembayaran_hutang_sequence (tanggal, last_seq) VALUES (?, 1)
         ON DUPLICATE KEY UPDATE last_seq = LAST_INSERT_ID(last_seq + 1)`,
        [yyyymmdd]
    );
    let seq;
    if (r.affectedRows === 1) seq = 1;
    else if (r.affectedRows === 2) seq = r.insertId;
    else throw new Error(`Gagal membuat nomor bayar: affectedRows tidak terduga (${r.affectedRows})`);
    return `HTG-${yyyymmdd}-${String(seq).padStart(4, '0')}`;
}

export async function BAYAR_HUTANG(req, res) {
    let payload;
    try {
        payload = parseBayar(req.body);
    } catch (err) {
        return res.status(err.status || 400).json({ status: false, message: err.message });
    }

    const { supplierId, metode, catatan, requestId, items, total } = payload;
    const waktu = wibSekarang();
    const admin = ambilNamaAdmin(req);
    let conn;

    try {
        conn = await db.getConnection();
        await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
        await conn.beginTransaction();

        // 1. kunci semua faktur yang dibayar (urut id)
        const [fakturRows] = await conn.query(
            `SELECT id, no_faktur, supplier_id, sisa_hutang
               FROM pembelian_header
              WHERE id IN (?)
              ORDER BY id
                FOR UPDATE`,
            [items.map((i) => i.idPembelian)]
        );
        const fakturMap = new Map(fakturRows.map((f) => [Number(f.id), f]));

        // 2. IDEMPOTENSI: request yang sama sudah pernah tersimpan -> kembalikan hasil lama
        if (requestId) {
            const [lama] = await conn.query(
                `SELECT id, no_bayar, supplier_id, total_bayar, metode,
                        DATE_FORMAT(tanggal_bayar, '%Y-%m-%d %H:%i:%s') AS tanggal_bayar
                   FROM pembayaran_hutang_header
                  WHERE request_id = ?
                  LIMIT 1`,
                [requestId]
            );
            if (lama.length > 0) {
                const h = lama[0];
                if (Number(h.supplier_id) !== supplierId || num(h.total_bayar) !== total) {
                    throw new HutangError('Request ID sudah dipakai oleh pembayaran lain. Muat ulang halaman.', 409);
                }
                const [det] = await conn.query(
                    `SELECT id_pembelian, no_faktur, jumlah, sisa_sebelum, sisa_sesudah
                       FROM pembayaran_hutang_detail WHERE id_pembayaran = ? ORDER BY id`,
                    [h.id]
                );
                await conn.rollback(); // tidak ada yang ditulis
                return res.status(200).json({
                    status: true,
                    duplikat: true,
                    message: 'Pembayaran ini sudah tercatat sebelumnya.',
                    data: {
                        no_bayar: h.no_bayar,
                        supplier_id: supplierId,
                        total_bayar: num(h.total_bayar),
                        metode: h.metode,
                        tanggal_bayar: h.tanggal_bayar,
                        rincian: det.map((d) => ({
                            id_pembelian: d.id_pembelian,
                            no_faktur: d.no_faktur,
                            jumlah: num(d.jumlah),
                            sisa_sebelum: num(d.sisa_sebelum),
                            sisa_sesudah: num(d.sisa_sesudah),
                            lunas: num(d.sisa_sesudah) === 0
                        }))
                    }
                });
            }
        }

        // 3. validasi tiap faktur
        for (const it of items) {
            const f = fakturMap.get(it.idPembelian);
            if (!f) throw new HutangError('Ada faktur yang tidak ditemukan. Muat ulang halaman.', 404);
            if (Number(f.supplier_id) !== supplierId) {
                throw new HutangError(`Faktur ${f.no_faktur} bukan milik supplier ini!`);
            }
            const sisa = num(f.sisa_hutang);
            if (sisa <= 0) {
                throw new HutangError(`Faktur ${f.no_faktur} sudah lunas, tidak ada sisa hutang.`);
            }
            if (it.jumlah > sisa) {
                throw new HutangError(
                    `Jumlah bayar faktur ${f.no_faktur} (Rp ${fmtRp(it.jumlah)}) melebihi sisa hutang (Rp ${fmtRp(sisa)}).`
                );
            }
        }

        // 4. header pembayaran
        const noBayar = await buatNoBayar(conn, waktu.yyyymmdd);
        const [hdr] = await conn.query(
            `INSERT INTO pembayaran_hutang_header
                (no_bayar, supplier_id, tanggal_bayar, total_bayar, metode, catatan, request_id, dibuat_oleh, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [noBayar, supplierId, waktu.sql, total, metode, catatan, requestId, admin, waktu.sql]
        );
        const idPembayaran = hdr.insertId;

        // 5. kurangi hutang (atomik) + siapkan detail
        const detailRows = [];
        const rincian = [];
        for (const it of items) {
            const f = fakturMap.get(it.idPembelian);
            const sebelum = num(f.sisa_hutang);
            const sesudah = sebelum - it.jumlah;
            const [u] = await conn.query(
                `UPDATE pembelian_header
                    SET sisa_hutang  = ?,
                        dibayar      = dibayar + ?,
                        status_bayar = ?
                  WHERE id = ? AND sisa_hutang = ?`,
                [sesudah, it.jumlah, sesudah === 0 ? 'LUNAS' : 'HUTANG', it.idPembelian, sebelum]
            );
            if (u.affectedRows !== 1) {
                throw new HutangError(`Sisa hutang faktur ${f.no_faktur} berubah saat diproses. Silakan coba lagi.`, 409);
            }
            detailRows.push([idPembayaran, it.idPembelian, f.no_faktur, it.jumlah, sebelum, sesudah]);
            rincian.push({
                id_pembelian: it.idPembelian,
                no_faktur: f.no_faktur,
                jumlah: it.jumlah,
                sisa_sebelum: sebelum,
                sisa_sesudah: sesudah,
                lunas: sesudah === 0
            });
        }

        await conn.query(
            `INSERT INTO pembayaran_hutang_detail
                (id_pembayaran, id_pembelian, no_faktur, jumlah, sisa_sebelum, sisa_sesudah)
             VALUES ?`,
            [detailRows]
        );

        await conn.commit();

        return res.status(200).json({
            status: true,
            message: 'Pembayaran hutang berhasil dicatat!',
            data: {
                no_bayar: noBayar,
                supplier_id: supplierId,
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
                console.error('[BAYAR_HUTANG] Rollback gagal:', rollbackErr);
            }
        }
        return responError(res, err, 'BAYAR_HUTANG');
    } finally {
        if (conn) conn.release();
    }
}

// ============================================================================
// 4. RIWAYAT PEMBAYARAN HUTANG
// Query: supplier_id (opsional), id_pembelian (opsional), page, limit
// ============================================================================
// ============================================================================
// 4. RIWAYAT PEMBAYARAN HUTANG (TERMASUK POTONGAN HUTANG DARI RETUR)
// Query: supplier_id (opsional), id_pembelian (opsional), page, limit
// ============================================================================
export async function RIWAYAT_PEMBAYARAN_HUTANG(req, res) {
    try {
        const { page, limit, offset } = ambilPaging(req.query);

        const supRaw = req.query.supplier_id;
        const faktRaw = req.query.id_pembelian;

        if ((supRaw !== undefined && typeof supRaw !== 'string') || (faktRaw !== undefined && typeof faktRaw !== 'string')) {
            throw new HutangError('Parameter tidak valid!');
        }

        const filterSupplierId = str(supRaw) !== '' ? parseIdSupplier(supRaw) : null;
        let filterPembelianId = null;
        if (str(faktRaw) !== '') {
            const idp = keInt(faktRaw);
            if (!Number.isSafeInteger(idp) || idp <= 0) throw new HutangError('Faktur tidak valid!');
            filterPembelianId = idp;
        }

        // true = hanya riwayat faktur yang masih berhutang (sama dengan daftar faktur di panel detail)
        const hanyaHutang = filterSupplierId !== null && str(req.query.hanya_hutang) === '1';

        // ----------------------------------------------------------------------
        // SUBQUERY 1: PEMBAYARAN HUTANG REGULER (TUNAI / TRANSFER)
        // ----------------------------------------------------------------------
        let whereBayar = ['1 = 1'];
        let paramsBayar = [];
        if (filterSupplierId) {
            whereBayar.push('h.supplier_id = ?');
            paramsBayar.push(filterSupplierId);
        }
        if (filterPembelianId) {
            whereBayar.push(`EXISTS (SELECT 1 FROM pembayaran_hutang_detail dx WHERE dx.id_pembayaran = h.id AND dx.id_pembelian = ?)`);
            paramsBayar.push(filterPembelianId);
        }
        if (hanyaHutang) {
            // hanya pembayaran yang menyentuh minimal 1 faktur yang masih berhutang
            whereBayar.push(`EXISTS (
        SELECT 1 FROM pembayaran_hutang_detail dk
          JOIN pembelian_header pk ON pk.id = dk.id_pembelian
         WHERE dk.id_pembayaran = h.id AND pk.sisa_hutang > 0)`);
        }
        const whereBayarSql = whereBayar.join(' AND ');

        // ----------------------------------------------------------------------
        // SUBQUERY 2: RETUR PEMBELIAN DENGAN POTONG HUTANG
        // ----------------------------------------------------------------------
        let whereRetur = ["r.metode_penyelesaian = 'POTONG_HUTANG'", "r.jumlah_potong_hutang > 0"];
        let paramsRetur = [];
        if (filterSupplierId) {
            whereRetur.push('p.supplier_id = ?');
            paramsRetur.push(filterSupplierId);
        }
        if (filterPembelianId) {
            whereRetur.push('p.id = ?');
            paramsRetur.push(filterPembelianId);
        }
        if (hanyaHutang) {
            whereRetur.push('p.sisa_hutang > 0');
        }
        const whereReturSql = whereRetur.join(' AND ');

        // ----------------------------------------------------------------------
        // 1. HITUNG TOTAL DATA (UNION COUNT)
        // ----------------------------------------------------------------------
        const [[cntRows]] = await db.query(
            `SELECT COUNT(*) AS total FROM (
                SELECT h.id FROM pembayaran_hutang_header h WHERE ${whereBayarSql}
                UNION ALL
                SELECT r.id FROM retur_pembelian_header r 
                JOIN pembelian_header p ON LOWER(TRIM(r.no_faktur)) = LOWER(TRIM(p.no_faktur))
                WHERE ${whereReturSql}
            ) AS combined_count`,
            [...paramsBayar, ...paramsRetur]
        );
        const total = num(cntRows?.total);

        // ----------------------------------------------------------------------
        // 2. AMBIL COMBINED HEADERS DENGAN UNION ALL
        // ----------------------------------------------------------------------
        const [headers] = await db.query(
            `SELECT * FROM (
                /* TRANSAKSI BAYAR REGULER */
                SELECT 
                    h.id AS source_id,
                    'BAYAR' AS tipe_transaksi,
                    h.no_bayar AS no_transaksi,
                    h.supplier_id,
                    (SELECT p.nama_supplier FROM pembelian_header p WHERE p.supplier_id = h.supplier_id ORDER BY p.id DESC LIMIT 1) AS nama_supplier,
                    DATE_FORMAT(h.tanggal_bayar, '%Y-%m-%d %H:%i:%s') AS tanggal_transaksi,
                    h.total_bayar AS nominal,
                    h.metode,
                    h.catatan,
                    h.dibuat_oleh
                FROM pembayaran_hutang_header h
                WHERE ${whereBayarSql}

                UNION ALL

                /* TRANSAKSI RETUR POTONG HUTANG */
                SELECT 
                    r.id AS source_id,
                    'RETUR' AS tipe_transaksi,
                    r.no_retur AS no_transaksi,
                    p.supplier_id,
                    IFNULL(p.nama_supplier, 'SUPPLIER') AS nama_supplier,
                    DATE_FORMAT(r.tanggal_retur, '%Y-%m-%d %H:%i:%s') AS tanggal_transaksi,
                    r.jumlah_potong_hutang AS nominal,
                    'POTONG_HUTANG' AS metode,
                    r.catatan,
                    'ADMIN' AS dibuat_oleh
                FROM retur_pembelian_header r
                JOIN pembelian_header p ON LOWER(TRIM(r.no_faktur)) = LOWER(TRIM(p.no_faktur))
                WHERE ${whereReturSql}
            ) AS combined_header
            ORDER BY tanggal_transaksi DESC
            LIMIT ? OFFSET ?`,
            [...paramsBayar, ...paramsRetur, limit, offset]
        );

        // ----------------------------------------------------------------------
        // 3. AMBIL RINCIAN DETAIL (DIPISAH BERDASARKAN TIPE TRANSAKSI)
        // ----------------------------------------------------------------------
        const detailMap = new Map();

        const bayarHeaderIds = headers.filter(h => h.tipe_transaksi === 'BAYAR').map(h => h.source_id);
        const returHeaderIds = headers.filter(h => h.tipe_transaksi === 'RETUR').map(h => h.source_id);

        // Fetch Detail Pembayaran Reguler
        if (bayarHeaderIds.length > 0) {

            const [detailsBayar] = await db.query(
                `SELECT d.id_pembayaran, d.id_pembelian, d.no_faktur, d.jumlah, d.sisa_sebelum, d.sisa_sesudah
             FROM pembayaran_hutang_detail d
             ${hanyaHutang ? 'JOIN pembelian_header pk ON pk.id = d.id_pembelian AND pk.sisa_hutang > 0' : ''}
             WHERE d.id_pembayaran IN (?)
             ${filterPembelianId ? 'AND d.id_pembelian = ?' : ''}
             ORDER BY d.id`,
                [bayarHeaderIds, ...(filterPembelianId ? [filterPembelianId] : [])]
            );

            for (const d of detailsBayar) {
                const key = `BAYAR_${d.id_pembayaran}`;
                if (!detailMap.has(key)) detailMap.set(key, []);
                detailMap.get(key).push({
                    id_pembelian: d.id_pembelian,
                    no_faktur: d.no_faktur,
                    jumlah: num(d.jumlah),
                    sisa_sebelum: num(d.sisa_sebelum),
                    sisa_sesudah: num(d.sisa_sesudah)
                });
            }
        }

        // Fetch Detail Retur Potong Hutang
        if (returHeaderIds.length > 0) {
            const [detailsRetur] = await db.query(
                `SELECT rpd.retur_id, rpd.id_detail_pembelian, rph.no_faktur, rpd.subtotal_retur AS jumlah, p.id AS id_pembelian
                 FROM retur_pembelian_detail rpd
                 JOIN retur_pembelian_header rph ON rpd.retur_id = rph.id
                 JOIN pembelian_header p ON LOWER(TRIM(rph.no_faktur)) = LOWER(TRIM(p.no_faktur))
                 WHERE rpd.retur_id IN (?)
                 ${hanyaHutang ? 'AND p.sisa_hutang > 0' : ''}
                 ORDER BY rpd.id`,
                [returHeaderIds]
            );
            for (const d of detailsRetur) {
                const key = `RETUR_${d.retur_id}`;
                if (!detailMap.has(key)) detailMap.set(key, []);
                detailMap.get(key).push({
                    id_pembelian: d.id_pembelian,
                    no_faktur: d.no_faktur,
                    jumlah: num(d.jumlah),
                    sisa_sebelum: null,
                    sisa_sesudah: null
                });
            }
        }

        // ----------------------------------------------------------------------
        // 4. FORMAT RESPONSE
        // ----------------------------------------------------------------------
        return res.status(200).json({
            status: true,
            data: {
                riwayat: headers.map((h) => {
                    const mapKey = `${h.tipe_transaksi}_${h.source_id}`;
                    const rincian = detailMap.get(mapKey) || [];
                    // pembayaran multi-faktur: total kartu = jumlah rincian yang tampil
                    const hitungUlang = h.tipe_transaksi === 'BAYAR' && (hanyaHutang || filterPembelianId);
                    return {
                        tipe_transaksi: h.tipe_transaksi,
                        no_bayar: h.no_transaksi,
                        supplier_id: h.supplier_id,
                        nama_supplier: h.nama_supplier,
                        tanggal_bayar: h.tanggal_transaksi,
                        total_bayar: hitungUlang
                            ? rincian.reduce((a, x) => a + x.jumlah, 0)
                            : num(h.nominal),
                        metode: h.metode,
                        catatan: h.catatan,
                        dibuat_oleh: h.dibuat_oleh,
                        rincian
                    };
                }),
                paging: { page, limit, total, total_page: Math.max(1, Math.ceil(total / limit)) }
            }
        });

    } catch (err) {
        return responError(res, err, 'RIWAYAT_PEMBAYARAN_HUTANG');
    }
}