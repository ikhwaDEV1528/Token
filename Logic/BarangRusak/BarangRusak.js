// ============================================================================
// MODUL RIWAYAT BARANG RUSAK (BE) — SATU FILE, 3 ENDPOINT, HANYA MEMBACA DATA
//
//   GET /api-be/SERVER_RUSAK/RIWAYAT_BARANG_RUSAK     daftar (infinite scroll, cursor)
//   GET /api-be/SERVER_RUSAK/RINGKASAN_BARANG_RUSAK   total kerugian, status klaim, barang terbanyak
//   GET /api-be/SERVER_RUSAK/OPSI_FILTER_BARANG_RUSAK pilihan filter (penyebab & status klaim)
//
// PASANG (samakan gaya dengan router SERVER_HUTANG kamu):
//   import * as Rusak from './BarangRusak.mjs';
//   router.get('/RIWAYAT_BARANG_RUSAK',     <middleware auth>, Rusak.RIWAYAT_BARANG_RUSAK);
//   router.get('/RINGKASAN_BARANG_RUSAK',   <middleware auth>, Rusak.RINGKASAN_BARANG_RUSAK);
//   router.get('/OPSI_FILTER_BARANG_RUSAK', <middleware auth>, Rusak.OPSI_FILTER_BARANG_RUSAK);
//   app.use('/SERVER_RUSAK', router);          // router TIDAK memakai prefix lagi
//
// INDEX (cek dulu: SHOW INDEX FROM barang_afkir; buat hanya yang belum ada):
//   ALTER TABLE barang_afkir
//     ADD INDEX idx_afkir_tgl_id   (tanggal, id_afkir),
//     ADD INDEX idx_afkir_kode     (kode_barang),
//     ADD INDEX idx_afkir_status   (status_klaim, tanggal),
//     ADD INDEX idx_afkir_sumber   (sumber_kerusakan, tanggal);
//
// SKEMA YANG DIPAKAI:
//   barang_afkir : id_afkir, tanggal, kode_barang, qty_pcs, hpp_per_pcs, subtotal_hpp,
//                  sumber_kerusakan, no_ref_retur, no_faktur_asal, keterangan,
//                  status_klaim, id_supplier, dibuat_oleh
//   barang(kode_barang, nama_barang), penjualan_header(no_faktur, kode_pelanggan),
//   pelanggan(kode_pelanggan, nama_pelanggan), pembelian_header(id, supplier_id, nama_supplier)
//
// PAGINATION: keyset (cursor) berdasarkan (tanggal, id_afkir) menurun. Biaya tiap halaman
// tetap sama walau data ribuan baris, dan tidak ada baris ganda/terlewat saat data baru masuk.
// ============================================================================
import { db } from "../../db.js"; // sesuaikan path

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_KEYWORD_LEN = 100;
const MAX_KATA = 5;
const MAX_OPSI = 50;
const TOP_BARANG = 5;
const MAX_EXEC_MS = 15000; // batas waktu tiap query di sisi MySQL
const COLL = "utf8mb4_0900_ai_ci"; // dipaksa di kunci join agar tidak error "Illegal mix of collations"
const HINT = `/*+ MAX_EXECUTION_TIME(${Number(MAX_EXEC_MS)}) */`;

class RusakError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.name = "RusakError";
        this.status = status;
    }
}

// ----------------------------------------------------------------------------
// HELPER
// ----------------------------------------------------------------------------
const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};
const sen = (v) => Math.round(num(v) * 100);
const rp = (c) => (c === 0 ? 0 : c / 100);

// eslint-disable-next-line no-control-regex
const bersihkan = (v) => v.replace(/[\u0000-\u001F\u007F]/g, "").trim();

// Ambil parameter query bertipe string. Array/objek (?q=a&q=b) ditolak, bukan diam-diam diabaikan.
function ambilTeks(query, kunci) {
    const v = query?.[kunci];
    if (v === undefined) return "";
    if (typeof v !== "string") throw new RusakError(`Parameter ${kunci} tidak valid.`);
    return bersihkan(v);
}

function keInt(v) {
    const s = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";
    return /^\d{1,18}$/.test(s) ? Number(s) : NaN;
}

const escLike = (s) => s.replace(/[\\%_]/g, "\\$&");

const NILAI_RE = /^[A-Za-z0-9_ ]{1,40}$/;
function ambilNilaiFilter(query, kunci) {
    const v = ambilTeks(query, kunci);
    if (!v) return "";
    if (!NILAI_RE.test(v)) throw new RusakError(`Filter ${kunci} tidak valid.`);
    return v;
}

function parseYmd(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const [y, m, d] = s.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt : null;
}
const ymd = (d) => d.toISOString().slice(0, 10);

// ---- cursor: base64url({ t: "YYYY-MM-DD HH:MM:SS", i: id_afkir }) ----
const DT_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const enkodeCursor = (t, i) => Buffer.from(JSON.stringify({ t, i })).toString("base64url");
function dekodeCursor(query) {
    const raw = ambilTeks(query, "cursor");
    if (!raw) return null;
    const salah = () => new RusakError("Halaman tidak valid. Muat ulang daftar.");
    if (raw.length > 120 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw salah();
    let o;
    try {
        o = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    } catch {
        throw salah();
    }
    if (!o || typeof o.t !== "string" || !DT_RE.test(o.t) || !Number.isSafeInteger(o.i) || o.i <= 0) throw salah();
    return o;
}

// Filter yang sama untuk daftar & ringkasan, supaya angka ringkasan selalu cocok dengan daftar.
function bangunFilter(query) {
    const where = [];
    const params = [];

    where.push(`a.qty_sisa > 0`);

    const q = ambilTeks(query, "q").slice(0, MAX_KEYWORD_LEN);
    for (const kata of q.split(/\s+/).filter(Boolean).slice(0, MAX_KATA)) {
        const like = `%${escLike(kata)}%`;
        where.push(`(a.kode_barang LIKE ? OR b.nama_barang LIKE ? OR a.no_ref_retur LIKE ? OR a.no_faktur_asal LIKE ?)`);
        params.push(like, like, like, like);
    }

    const sumber = ambilNilaiFilter(query, "sumber");
    if (sumber) {
        where.push(`a.sumber_kerusakan = ?`);
        params.push(sumber);
    }
    const status = ambilNilaiFilter(query, "status");
    if (status) {
        where.push(`a.status_klaim = ?`);
        params.push(status);
    }

    const sMulai = ambilTeks(query, "tgl_mulai");
    const sSelesai = ambilTeks(query, "tgl_selesai");
    const dMulai = sMulai ? parseYmd(sMulai) : null;
    const dSelesai = sSelesai ? parseYmd(sSelesai) : null;
    if ((sMulai && !dMulai) || (sSelesai && !dSelesai)) {
        throw new RusakError("Format tanggal harus YYYY-MM-DD.");
    }
    if (dMulai && dSelesai && dMulai > dSelesai) {
        throw new RusakError("Tanggal mulai tidak boleh lebih besar dari tanggal selesai.");
    }
    if (dMulai) {
        where.push(`a.tanggal >= ?`);
        params.push(`${ymd(dMulai)} 00:00:00`);
    }
    if (dSelesai) {
        where.push(`a.tanggal < ?`);
        params.push(`${ymd(new Date(dSelesai.getTime() + 86_400_000))} 00:00:00`);
    }

    return { where, params };
}

const FROM_SQL = `
  FROM barang_afkir a
  LEFT JOIN barang b ON b.kode_barang = a.kode_barang COLLATE ${COLL}`;

const whereSql = (where) => (where.length ? `WHERE ${where.join(" AND ")}` : "");

// Semua query ringkasan dibaca dari satu snapshot -> total, rincian status, dan top barang konsisten.
async function denganSnapshot(fn) {
    let conn;
    let rollbackGagal = false;
    try {
        conn = await db.getConnection();
        await conn.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
        await conn.query("START TRANSACTION READ ONLY, WITH CONSISTENT SNAPSHOT");
        return await fn(async (sql, params) => (await conn.query(sql, params))[0]);
    } finally {
        if (conn) {
            try {
                await conn.rollback();
            } catch {
                rollbackGagal = true;
            }
            if (rollbackGagal && typeof conn.destroy === "function") conn.destroy();
            else conn.release();
        }
    }
}

function responError(res, err, tag) {
    if (err instanceof RusakError) {
        return res.status(err.status).json({ status: false, message: err.message });
    }
    if (err && (err.errno === 3024 || err.code === "ER_QUERY_TIMEOUT")) {
        console.warn(`[${tag}] Query timeout`);
        return res.status(504).json({
            status: false,
            message: "Data terlalu lama dimuat. Persempit filter lalu coba lagi."
        });
    }
    if (err && (err.code === "ER_LOCK_DEADLOCK" || err.code === "ER_LOCK_WAIT_TIMEOUT")) {
        console.warn(`[${tag}] Lock contention:`, err.code);
        return res.status(409).json({ status: false, message: "Sistem sedang sibuk. Silakan coba lagi." });
    }
    console.error(`[${tag}] Unexpected error:`, err);
    return res.status(500).json({
        status: false,
        message: "Terjadi kesalahan sistem. Silakan coba lagi atau hubungi admin."
    });
}

// ============================================================================
// 1. DAFTAR RIWAYAT BARANG RUSAK
// Query: q (kode/nama barang, no retur, no faktur; boleh banyak kata), sumber, status,
//        tgl_mulai, tgl_selesai (YYYY-MM-DD), limit (1-50), cursor (dari next_cursor)
// ============================================================================
export async function RIWAYAT_BARANG_RUSAK(req, res) {
    res.set("Cache-Control", "no-store");
    try {
        let limit = DEFAULT_LIMIT;
        if (req.query?.limit !== undefined) {
            const l = keInt(req.query.limit);
            if (!Number.isSafeInteger(l) || l < 1) throw new RusakError("Parameter limit tidak valid.");
            limit = Math.min(MAX_LIMIT, l);
        }

        const { where, params } = bangunFilter(req.query);
        const cur = dekodeCursor(req.query);
        if (cur) {
            where.push(`(a.tanggal < ? OR (a.tanggal = ? AND a.id_afkir < ?))`);
            params.push(cur.t, cur.t, cur.i);
        }

        // limit + 1: baris ekstra hanya untuk tahu masih ada halaman berikutnya (tanpa COUNT mahal)
        const [rows] = await db.query(
            `SELECT ${HINT}
                    a.id_afkir,
                    DATE_FORMAT(a.tanggal, '%Y-%m-%d %H:%i:%s') AS tanggal,
                    a.kode_barang,
                    b.nama_barang,
                    a.qty_pcs,
                    a.qty_sisa,
                    a.hpp_per_pcs,
                    a.subtotal_hpp,
                    a.sumber_kerusakan,
                    a.no_ref_retur,
                    a.no_faktur_asal,
                    a.keterangan,
                    a.status_klaim,
                    a.id_supplier,
                    a.dibuat_oleh,
                    (SELECT p.nama_pelanggan
                       FROM penjualan_header ph
                       JOIN pelanggan p ON p.kode_pelanggan = ph.kode_pelanggan
                      WHERE ph.no_faktur = a.no_faktur_asal COLLATE ${COLL}
                      LIMIT 1) AS nama_pelanggan,
                    CASE WHEN a.id_supplier IS NULL THEN NULL
                         ELSE (SELECT hs.nama_supplier
                                 FROM pembelian_header hs
                                WHERE hs.supplier_id = a.id_supplier
                                ORDER BY hs.id DESC
                                LIMIT 1) END AS nama_supplier
               ${FROM_SQL}
               ${whereSql(where)}
              ORDER BY a.tanggal DESC, a.id_afkir DESC
              LIMIT ?`,
            [...params, limit + 1]
        );

        const adaLagi = rows.length > limit;
        const halaman = adaLagi ? rows.slice(0, limit) : rows;
        const terakhir = halaman[halaman.length - 1];

        return res.status(200).json({
            status: true,
            data: {
                items: halaman.map((x) => ({
                    id_afkir: num(x.id_afkir),
                    tanggal: x.tanggal,
                    kode_barang: x.kode_barang,
                    nama_barang: x.nama_barang ?? null,
                    qty_pcs: num(x.qty_pcs),
                    qty_sisa: num(x.qty_sisa), // 👈 TAMBAHKAN BARIS INI
                    hpp_per_pcs: num(x.hpp_per_pcs),
                    subtotal_hpp: num(x.subtotal_hpp),
                    sumber_kerusakan: x.sumber_kerusakan ?? null,
                    no_ref_retur: x.no_ref_retur ?? null,
                    no_faktur_asal: x.no_faktur_asal ?? null,
                    nama_pelanggan: x.nama_pelanggan ?? null,
                    keterangan: x.keterangan ?? null,
                    status_klaim: x.status_klaim ?? null,
                    id_supplier: x.id_supplier ?? null,
                    nama_supplier: x.nama_supplier ?? null,
                    dibuat_oleh: x.dibuat_oleh == null ? null : String(x.dibuat_oleh)
                })),
                has_more: adaLagi && Boolean(terakhir?.tanggal),
                next_cursor: adaLagi && terakhir?.tanggal ? enkodeCursor(terakhir.tanggal, num(terakhir.id_afkir)) : null
            }
        });
    } catch (err) {
        return responError(res, err, "RIWAYAT_BARANG_RUSAK");
    }
}

// ============================================================================
// 2. RINGKASAN (ikut semua filter yang sama dengan daftar, kecuali cursor/limit)
// ============================================================================
export async function RINGKASAN_BARANG_RUSAK(req, res) {
    res.set("Cache-Control", "no-store");
    try {
        const { where, params } = bangunFilter(req.query);
        const w = whereSql(where);

        const { perStatus, top } = await denganSnapshot(async (q) => {
            const perStatus = await q(
                `SELECT ${HINT}
                        a.status_klaim                          AS status_klaim,
                        COUNT(*)                                AS jumlah,
                        COALESCE(SUM(a.qty_pcs), 0)             AS pcs,
                        ROUND(COALESCE(SUM(a.subtotal_hpp), 0), 2) AS nilai
                   ${FROM_SQL}
                   ${w}
                  GROUP BY a.status_klaim
                  ORDER BY nilai DESC, a.status_klaim`,
                params
            );
            const top = await q(
                `SELECT ${HINT}
                        a.kode_barang,
                        MAX(b.nama_barang)                      AS nama_barang,
                        COUNT(*)                                AS jumlah,
                        COALESCE(SUM(a.qty_pcs), 0)             AS pcs,
                        ROUND(COALESCE(SUM(a.subtotal_hpp), 0), 2) AS nilai
                   ${FROM_SQL}
                   ${w}
                  GROUP BY a.kode_barang
                  ORDER BY nilai DESC, pcs DESC, a.kode_barang
                  LIMIT ${Number(TOP_BARANG)}`,
                params
            );
            return { perStatus, top };
        });

        // total dihitung dari rincian status (satu snapshot) dalam sen -> tanpa selisih pembulatan
        let totalCatatan = 0;
        let totalPcs = 0;
        let totalSen = 0;
        for (const r of perStatus) {
            totalCatatan += num(r.jumlah);
            totalPcs += num(r.pcs);
            totalSen += sen(r.nilai);
        }

        return res.status(200).json({
            status: true,
            data: {
                total_catatan: totalCatatan,
                total_pcs: totalPcs,
                total_kerugian: rp(totalSen),
                per_status: perStatus.map((r) => ({
                    status_klaim: r.status_klaim ?? null,
                    jumlah: num(r.jumlah),
                    pcs: num(r.pcs),
                    nilai: num(r.nilai)
                })),
                top_barang: top.map((r) => ({
                    kode_barang: r.kode_barang,
                    nama_barang: r.nama_barang ?? null,
                    jumlah: num(r.jumlah),
                    pcs: num(r.pcs),
                    nilai: num(r.nilai)
                }))
            }
        });
    } catch (err) {
        return responError(res, err, "RINGKASAN_BARANG_RUSAK");
    }
}

// ============================================================================
// 3. PILIHAN FILTER (nilai yang benar-benar ada di data)
// ============================================================================
export async function OPSI_FILTER_BARANG_RUSAK(req, res) {
    res.set("Cache-Control", "no-store");
    try {
        const [[sumberRows], [statusRows]] = await Promise.all([
            db.query(
                `SELECT ${HINT} DISTINCT sumber_kerusakan AS nilai
                   FROM barang_afkir
                  WHERE sumber_kerusakan IS NOT NULL AND sumber_kerusakan <> ''
                  ORDER BY nilai
                  LIMIT ${Number(MAX_OPSI)}`
            ),
            db.query(
                `SELECT ${HINT} DISTINCT status_klaim AS nilai
                   FROM barang_afkir
                  WHERE status_klaim IS NOT NULL AND status_klaim <> ''
                  ORDER BY nilai
                  LIMIT ${Number(MAX_OPSI)}`
            )
        ]);

        const aman = (r) => typeof r.nilai === "string" && NILAI_RE.test(r.nilai);
        return res.status(200).json({
            status: true,
            data: {
                sumber: sumberRows.filter(aman).map((r) => r.nilai),
                status: statusRows.filter(aman).map((r) => r.nilai)
            }
        });
    } catch (err) {
        return responError(res, err, "OPSI_FILTER_BARANG_RUSAK");
    }
}
