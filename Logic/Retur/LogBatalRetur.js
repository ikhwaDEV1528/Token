// retur-pembatalan.controller.js
// Riwayat Pembatalan Retur (HANYA BACA): daftar (keyset pagination), ringkasan, detail.
// Sumber data: tabel retur_hapus_log (ditulis oleh HapusRetur). Tidak ada satu pun query yang mengubah data.
import { db } from '../../db.js'; // <- sesuaikan path koneksi mysql2 pool kamu

/* ───────────────────────── Konfigurasi ───────────────────────── */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_KEYWORD_LEN = 100;
const MAX_TERMS = 5;
const QUERY_TIMEOUT_MS = 15000; // query yang menggantung diputus, tidak menahan koneksi pool

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/* ───────────────────────── Helper ───────────────────────── */
class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.name = 'HttpError';
        this.status = status;
    }
}

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

const escapeLike = (s) => s.replace(/[\\%_]/g, '\\$&');

const isValidDate = (s) => {
    if (!DATE_RE.test(s)) return false;
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

const nextDay = (s) => {
    const d = new Date(`${s}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
};

// Semua query lewat sini supaya selalu punya timeout
const runQuery = (sql, values) => db.query({ sql, values, timeout: QUERY_TIMEOUT_MS });

const labelMetode = (m) =>
    ({ POTONG_PIUTANG: 'Potong Piutang', REFUND: 'Refund', TUKAR_BARANG: 'Tukar Barang' }[m] ||
        String(m || '-').toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()));

// Kolom JSON bisa datang sebagai object (MySQL) atau string (MariaDB)
function bacaSnapshot(raw) {
    if (raw == null) return {};
    if (Buffer.isBuffer(raw)) raw = raw.toString('utf8');
    if (typeof raw === 'object') return raw;
    try {
        const parsed = JSON.parse(String(raw));
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

function handleError(res, err, tag) {
    if (err instanceof HttpError) {
        return res.status(err.status).json({ status: false, message: err.message });
    }
    if (err && (err.code === 'PROTOCOL_SEQUENCE_TIMEOUT' || err.code === 'ER_QUERY_TIMEOUT')) {
        console.warn(`[${tag}] Query timeout`);
        return res.status(504).json({ status: false, message: 'Pencarian terlalu lama. Persempit rentang tanggal atau kata kunci.' });
    }
    console.error(`[${tag}] Error:`, err);
    return res.status(500).json({ status: false, message: 'Terjadi kesalahan pada server. Silakan coba lagi.' });
}

/* ───────────────────────── Filter & cursor ───────────────────────── */
function parseFilters(query) {
    const from = String(query.from ?? '').trim();
    const to = String(query.to ?? '').trim();
    if (from && !isValidDate(from)) throw new HttpError(400, 'Format tanggal awal tidak valid (YYYY-MM-DD).');
    if (to && !isValidDate(to)) throw new HttpError(400, 'Format tanggal akhir tidak valid (YYYY-MM-DD).');
    if (from && to && from > to) throw new HttpError(400, 'Tanggal awal tidak boleh melebihi tanggal akhir.');
    const q = String(query.q ?? '').trim().slice(0, MAX_KEYWORD_LEN);
    return { from, to, q };
}

// Rentang tanggal dibuat sargable (>= awal, < hari berikutnya) supaya index dihapus_pada terpakai.
function buildWhere(f) {
    const where = [];
    const params = [];
    if (f.from) { where.push('dihapus_pada >= ?'); params.push(`${f.from} 00:00:00`); }
    if (f.to) { where.push('dihapus_pada < ?'); params.push(`${nextDay(f.to)} 00:00:00`); }
    for (const t of f.q.split(/\s+/).filter(Boolean).slice(0, MAX_TERMS)) {
        const like = `%${escapeLike(t)}%`;
        where.push('(no_retur LIKE ? OR no_faktur LIKE ? OR alasan LIKE ?)');
        params.push(like, like, like);
    }
    return { where, params };
}

const encodeCursor = (t, id) => Buffer.from(`${t}|${id}`).toString('base64url');

function decodeCursor(raw) {
    const c = String(raw ?? '').trim();
    if (!c) return null;
    try {
        if (c.length > 200) throw new Error('terlalu panjang');
        const [t, id] = Buffer.from(c, 'base64url').toString('utf8').split('|');
        if (!DATETIME_RE.test(t) || !/^\d{1,15}$/.test(id ?? '')) throw new Error('format salah');
        return { t, id: Number(id) };
    } catch {
        throw new HttpError(400, 'Cursor tidak valid.');
    }
}

// Nama admin diambil terpisah (batch) supaya tidak bergantung pada tipe/collation kolom saat JOIN.
// Kalau gagal, daftar tetap tampil dengan id admin.
async function ambilNamaAdmin(ids) {
    const unik = [...new Set(ids.filter((v) => v !== null && v !== undefined && String(v) !== ''))];
    const peta = new Map();
    if (unik.length === 0) return peta;
    try {
        const [rows] = await runQuery(`SELECT id_admin, username FROM admin WHERE id_admin IN (?)`, [unik]);
        for (const r of rows) peta.set(String(r.id_admin), r.username);
    } catch (err) {
        console.warn('[PEMBATALAN_RETUR] Gagal membaca nama admin:', err?.code || err?.message);
    }
    return peta;
}

/* ───────────────────────── GET /list ───────────────────────── */
// Query: from, to, q, limit, cursor
export async function LIST_PEMBATALAN_RETUR(req, res) {
    res.set('Cache-Control', 'no-store');
    try {
        const f = parseFilters(req.query);
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
        const cursor = decodeCursor(req.query.cursor);

        const w = buildWhere(f);
        const conds = [...w.where];
        const params = [...w.params];
        if (cursor) {
            conds.push('(dihapus_pada < ? OR (dihapus_pada = ? AND id < ?))');
            params.push(cursor.t, cursor.t, cursor.id);
        }

        // Snapshot TIDAK dikirim di daftar: hanya field ringan yang diambil lewat JSON_EXTRACT.
        const [rows] = await runQuery(
            `SELECT id, id_retur_lama, no_retur, no_faktur, alasan, dihapus_oleh,
                    DATE_FORMAT(dihapus_pada, '%Y-%m-%d %H:%i:%s') AS waktu,
                    JSON_UNQUOTE(JSON_EXTRACT(snapshot, '$.header.metode_penyelesaian')) AS metode,
                    JSON_UNQUOTE(JSON_EXTRACT(snapshot, '$.header.grand_total'))         AS grand_total,
                    JSON_UNQUOTE(JSON_EXTRACT(snapshot, '$.header.tgl'))                 AS tanggal_retur,
                    JSON_LENGTH(snapshot, '$.detail')                                    AS jumlah_item
               FROM retur_hapus_log
              ${conds.length ? `WHERE ${conds.join(' AND ')}` : ''}
              ORDER BY dihapus_pada DESC, id DESC
              LIMIT ?`,
            [...params, limit + 1]
        );

        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        const namaAdmin = await ambilNamaAdmin(page.map((r) => r.dihapus_oleh));

        const data = page.map((r) => {
            const metode = r.metode && r.metode !== 'null' ? r.metode : null;
            return {
                id: r.id,
                no_retur: r.no_retur,
                no_faktur: r.no_faktur,
                alasan: r.alasan,
                dihapus_oleh: r.dihapus_oleh,
                dihapus_oleh_nama: namaAdmin.get(String(r.dihapus_oleh)) || null,
                waktu: r.waktu,
                tanggal_retur: r.tanggal_retur && r.tanggal_retur !== 'null' ? r.tanggal_retur : null,
                metode,
                metode_label: labelMetode(metode),
                grand_total: num(r.grand_total),
                jumlah_item: num(r.jumlah_item)
            };
        });

        const last = page[page.length - 1];
        return res.status(200).json({
            data,
            has_more: hasMore,
            next_cursor: hasMore && last ? encodeCursor(last.waktu, last.id) : null
        });
    } catch (err) {
        return handleError(res, err, 'LIST_PEMBATALAN_RETUR');
    }
}

/* ───────────────────────── GET /summary ───────────────────────── */
// Query: from, to, q
export async function SUMMARY_PEMBATALAN_RETUR(req, res) {
    res.set('Cache-Control', 'no-store');
    try {
        const f = parseFilters(req.query);
        const w = buildWhere(f);

        const [rows] = await runQuery(
            `SELECT COUNT(*) AS jumlah,
                    COALESCE(SUM(CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(snapshot, '$.header.grand_total')), 'null') AS DECIMAL(20,2))), 0) AS total_nilai
               FROM retur_hapus_log
              ${w.where.length ? `WHERE ${w.where.join(' AND ')}` : ''}`,
            w.params
        );

        const r = rows[0] || {};
        return res.status(200).json({
            total_pembatalan: num(r.jumlah),
            total_nilai: num(r.total_nilai)
        });
    } catch (err) {
        return handleError(res, err, 'SUMMARY_PEMBATALAN_RETUR');
    }
}

/* ───────────────────────── GET /detail/:id ───────────────────────── */
export async function DETAIL_PEMBATALAN_RETUR(req, res) {
    res.set('Cache-Control', 'no-store');
    try {
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, 'ID pembatalan tidak valid.');

        const [rows] = await runQuery(
            `SELECT id, id_retur_lama, no_retur, no_faktur, alasan, dihapus_oleh,
                    DATE_FORMAT(dihapus_pada, '%Y-%m-%d %H:%i:%s') AS waktu,
                    snapshot
               FROM retur_hapus_log
              WHERE id = ?
              LIMIT 1`,
            [id]
        );
        if (rows.length === 0) throw new HttpError(404, 'Data pembatalan tidak ditemukan.');

        const row = rows[0];
        const snap = bacaSnapshot(row.snapshot);
        const h = snap.header && typeof snap.header === 'object' ? snap.header : {};
        const detail = Array.isArray(snap.detail) ? snap.detail : [];

        const kodeList = [...new Set(detail.map((d) => d?.kode_barang).filter(Boolean))];
        const namaBarang = new Map();
        if (kodeList.length > 0) {
            try {
                const [brg] = await runQuery(`SELECT kode_barang, nama_barang FROM barang WHERE kode_barang IN (?)`, [kodeList]);
                for (const b of brg) namaBarang.set(b.kode_barang, b.nama_barang);
            } catch (err) {
                console.warn('[DETAIL_PEMBATALAN_RETUR] Gagal membaca nama barang:', err?.code || err?.message);
            }
        }

        const namaAdmin = await ambilNamaAdmin([row.dihapus_oleh]);
        const metode = h.metode_penyelesaian || null;

        return res.status(200).json({
            data: {
                id: row.id,
                no_retur: row.no_retur,
                no_faktur: row.no_faktur,
                alasan: row.alasan,
                dihapus_oleh: row.dihapus_oleh,
                dihapus_oleh_nama: namaAdmin.get(String(row.dihapus_oleh)) || null,
                waktu: row.waktu,
                retur: {
                    tanggal_retur: h.tgl || null,
                    no_faktur_asal: h.no_faktur_lain || null,
                    metode,
                    metode_label: labelMetode(metode),
                    catatan: h.catatan || null,
                    dpp_total: num(h.dpp_total),
                    ppn_persen: num(h.ppn_persen),
                    ppn_nominal: num(h.ppn_nominal),
                    grand_total: num(h.grand_total),
                    jumlah_potong_piutang: num(h.jumlah_potong_piutang),
                    jumlah_refund_kas: num(h.jumlah_refund_kas)
                },
                items: detail.map((d, i) => ({
                    id: d?.id ?? i,
                    kode_barang: d?.kode_barang || '-',
                    nama_barang: namaBarang.get(d?.kode_barang) || d?.kode_barang || '-',
                    satuan_retur: d?.satuan_retur || '-',
                    qty_input: num(d?.qty_input),
                    rasio_ke_pcs: num(d?.rasio_ke_pcs),
                    qty_total_pcs: num(d?.qty_total_pcs),
                    harga_satuan: num(d?.harga_satuan),
                    subtotal_retur: num(d?.subtotal_retur),
                    kondisi_barang: d?.kondisi_barang || null,
                    alasan_retur: d?.alasan_retur || null
                })),
                jumlah_afkir: Array.isArray(snap.afkir) ? snap.afkir.length : 0
            }
        });
    } catch (err) {
        return handleError(res, err, 'DETAIL_PEMBATALAN_RETUR');
    }
}

/* ───────────────────────── CONTOH ROUTE ─────────────────────────
import express from 'express';
import { CekRequestAkses } from '../middleware/...';   // pakai middleware yang sama seperti route retur
import { LIST_PEMBATALAN_RETUR, SUMMARY_PEMBATALAN_RETUR, DETAIL_PEMBATALAN_RETUR } from './retur-pembatalan.controller.js';

const router = express.Router();
router.get('/list', CekRequestAkses, LIST_PEMBATALAN_RETUR);
router.get('/summary', CekRequestAkses, SUMMARY_PEMBATALAN_RETUR);
router.get('/detail/:id', CekRequestAkses, DETAIL_PEMBATALAN_RETUR);
export default router;

// di file app utama:
// app.use('/SERVER_PEMBATALAN_RETUR', router);

INDEX (jalankan sekali di phpMyAdmin):
  CREATE INDEX idx_hapus_log_pada ON retur_hapus_log (dihapus_pada, id);
*/
