import { db } from "../../db.js";

// ---- helper lokal (berdiri sendiri, tidak bergantung file lain) ----
const RS_MAX_KEYWORD = 100;
const RS_MAX_KODE = 50;
const RS_MAX_LIMIT = 50;
const RS_DEFAULT_LIMIT = 20;
const RS_MAX_DETAIL_ROWS = 5000;      // batas baris rincian faktur per 1 request (anti memori membengkak)
const RS_QUERY_TIMEOUT_MS = 20000;    // query yang menggantung diputus, tidak menahan koneksi pool
const rsNum = (v) => Number(v) || 0;
const rsKeInt = (v) => { const t = String(v ?? '').trim(); return /^\d+$/.test(t) ? Number(t) : NaN; };
const rsEscLike = (t) => t.replace(/[\\%_]/g, '\\$&');

class RsError extends Error {
    constructor(message, status = 400) { super(message); this.name = 'RsError'; this.status = status; }
}

// Semua query lewat sini supaya selalu punya timeout
const rsQuery = (sql, values) => db.query({ sql, values, timeout: RS_QUERY_TIMEOUT_MS });

function rsAmbilLimit(query) {
    return Math.min(RS_MAX_LIMIT, Math.max(1, rsKeInt(query.limit) || RS_DEFAULT_LIMIT));
}

function rsResponError(res, err, tag) {
    if (err instanceof RsError) return res.status(err.status).json({ status: false, message: err.message });
    if (err && (err.code === 'ER_LOCK_DEADLOCK' || err.code === 'ER_LOCK_WAIT_TIMEOUT')) {
        return res.status(409).json({ status: false, message: 'Sistem sedang sibuk. Silakan coba lagi.' });
    }
    if (err && (err.code === 'PROTOCOL_SEQUENCE_TIMEOUT' || err.code === 'ER_QUERY_TIMEOUT')) {
        console.warn(`[${tag}] Query timeout`);
        return res.status(504).json({ status: false, message: 'Pencarian terlalu lama. Persempit rentang tanggal atau kata kunci.' });
    }
    console.error(`[${tag}] Unexpected error:`, err);
    return res.status(500).json({ status: false, message: 'Terjadi kesalahan sistem. Silakan coba lagi atau hubungi admin.' });
}

// ============================================================================
// TAMBAHAN BE: RIWAYAT SEMUA PEMBAYARAN PIUTANG (semua pelanggan)
// TEMPEL di PALING BAWAH file modul piutang yang sudah ada (file yang berisi
// DAFTAR_PIUTANG_PELANGGAN, BAYAR_PIUTANG, RIWAYAT_PEMBAYARAN).
// TIDAK mengubah satu pun fungsi lama.
//
//   GET /api-be/SERVER_PIUTANG/RIWAYAT_SEMUA_PEMBAYARAN
//   Query:
//     q              nama / kode pelanggan / no faktur (boleh beberapa kata)
//     kode_pelanggan filter persis 1 pelanggan (opsional)
//     tgl_awal       YYYY-MM-DD (opsional)
//     tgl_akhir      YYYY-MM-DD (opsional, sampai akhir hari itu)
//     jenis          SEMUA | PEMBAYARAN | RETUR   (default SEMUA)
//     limit          1..50 (default 20)
//     cursor         kosong = halaman pertama; isi dengan next_cursor untuk halaman berikutnya
//
//   Response data:
//     ringkasan      HANYA pada halaman pertama (tanpa cursor), halaman berikutnya null
//     riwayat        daftar transaksi (+ rincian_ppn per faktur untuk retur)
//     has_more       masih ada data berikutnya?
//     next_cursor    kirim balik sebagai ?cursor=... untuk halaman berikutnya
//
// PAGINATION: KEYSET (cursor), bukan OFFSET.
//   - Biaya tiap halaman konstan, tidak melambat di halaman dalam.
//   - Tiap cabang (pembayaran / retur) hanya mengambil (limit + 1) baris teratas
//     LALU digabung, jadi seluruh riwayat tidak pernah dimuat sekaligus.
//   - Urutan stabil: tanggal DESC, jenis DESC, id DESC.
//
// INDEX YANG DISARANKAN (jalankan sekali di database):
//   CREATE INDEX idx_pp_header_tgl   ON pembayaran_piutang_header (tanggal_bayar, id);
//   CREATE INDEX idx_retur_header_tgl ON retur_header (tanggal_retur, id);
//   -- biasanya sudah ada: pembayaran_piutang_detail(id_pembayaran), pembayaran_piutang_detail(no_faktur),
//   --                     retur_detail(retur_id), penjualan_detail(id_detail)
//   Catatan: pencarian teks memakai LIKE '%kata%' sehingga tidak bisa memakai index
//   (wajar untuk pencarian admin; selalu digabung dengan batas tanggal agar ringan).
// ============================================================================
const RS_JENIS = ['SEMUA', 'PEMBAYARAN', 'RETUR'];
const RS_JENIS_BARIS = ['PEMBAYARAN', 'RETUR'];
const RS_CURSOR_TGL_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?$/;

function rsTglValid(v) {
    const s = String(v ?? '').trim();
    if (!s) return '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new RsError('Format tanggal harus YYYY-MM-DD!');
    const [y, m, d] = s.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
        throw new RsError('Tanggal tidak valid!');
    }
    return s;
}

const rsEncodeCursor = (tgl, jenis, id) => Buffer.from(`${tgl}|${jenis}|${id}`).toString('base64url');

function rsDecodeCursor(raw) {
    const c = String(raw ?? '').trim();
    if (!c) return null;
    try {
        if (c.length > 200) throw new Error('terlalu panjang');
        const [tgl, jenis, id] = Buffer.from(c, 'base64url').toString('utf8').split('|');
        if (!RS_CURSOR_TGL_RE.test(tgl) || !RS_JENIS_BARIS.includes(jenis) || !/^\d{1,15}$/.test(id ?? '')) {
            throw new Error('format salah');
        }
        return { tgl, jenis, id: Number(id) };
    } catch {
        throw new RsError('Cursor tidak valid!');
    }
}

// Rincian PPN per (faktur, tarif). Total PPN disamakan dengan nilai yang tersimpan
// di retur_header (selisih pembulatan 1-2 rupiah masuk ke baris ber-PPN terakhir).
function rsRincianPpn(list, ppnHeader) {
    const hasil = list.map((g) => ({
        no_faktur: g.no_faktur,
        ppn_persen: rsNum(g.ppn_persen),
        dpp: rsNum(g.dpp),
        ppn_nominal: Math.round((rsNum(g.dpp) * rsNum(g.ppn_persen)) / 100)
    }));
    const selisih = rsNum(ppnHeader) - hasil.reduce((a, x) => a + x.ppn_nominal, 0);
    if (selisih !== 0 && Math.abs(selisih) <= hasil.length) {
        const kena = hasil.filter((x) => x.ppn_persen > 0);
        if (kena.length > 0) kena[kena.length - 1].ppn_nominal += selisih;
    }
    return hasil;
}

export async function RIWAYAT_SEMUA_PEMBAYARAN(req, res) {
    try {
        const q = String(req.query.q ?? '').trim().slice(0, RS_MAX_KEYWORD);
        const kode = String(req.query.kode_pelanggan ?? '').trim().slice(0, RS_MAX_KODE);
        const tglAwal = rsTglValid(req.query.tgl_awal);
        const tglAkhir = rsTglValid(req.query.tgl_akhir);
        if (tglAwal && tglAkhir && tglAwal > tglAkhir) {
            throw new RsError('Tanggal awal tidak boleh lebih besar dari tanggal akhir!');
        }
        const jenisRaw = String(req.query.jenis ?? 'SEMUA').toUpperCase();
        const jenis = RS_JENIS.includes(jenisRaw) ? jenisRaw : 'SEMUA';
        const limit = rsAmbilLimit(req.query);
        const cursor = rsDecodeCursor(req.query.cursor);

        const likes = q.split(/\s+/).filter(Boolean).slice(0, 5).map((t) => `%${rsEscLike(t)}%`);
        const adaFilterPelanggan = likes.length > 0 || !!kode;

        // filter per BARIS faktur (pk = penjualan_header, pq = pelanggan), alias detail dinamis
        const lineFilter = (a) => {
            const sql = [];
            const params = [];
            for (const l of likes) {
                sql.push(`(pq.nama_pelanggan LIKE ? OR pk.kode_pelanggan LIKE ? OR ${a}.no_faktur LIKE ?)`);
                params.push(l, l, l);
            }
            if (kode) {
                sql.push('pk.kode_pelanggan = ?');
                params.push(kode);
            }
            return { sql, params };
        };

        // ---------------- cabang PEMBAYARAN ----------------
        const whereBayar = ['1 = 1'];
        const paramsBayar = [];
        if (jenis === 'RETUR') whereBayar.push('1 = 0');
        if (tglAwal) { whereBayar.push('h.tanggal_bayar >= ?'); paramsBayar.push(tglAwal); }
        if (tglAkhir) { whereBayar.push('h.tanggal_bayar < DATE_ADD(?, INTERVAL 1 DAY)'); paramsBayar.push(tglAkhir); }
        const dateBayarSql = [...whereBayar];
        const dateBayarParams = [...paramsBayar];
        if (adaFilterPelanggan) {
            const lf = lineFilter('dk');
            whereBayar.push(
                `EXISTS (SELECT 1 FROM pembayaran_piutang_detail dk
                           LEFT JOIN penjualan_header pk ON pk.no_faktur = dk.no_faktur
                           LEFT JOIN pelanggan pq ON pq.kode_pelanggan = pk.kode_pelanggan
                          WHERE dk.id_pembayaran = h.id AND ${lf.sql.join(' AND ')})`
            );
            paramsBayar.push(...lf.params);
        }

        // ---------------- cabang RETUR (potong piutang) ----------------
        const whereRetur = ['r.jumlah_potong_piutang > 0'];
        const paramsRetur = [];
        if (jenis === 'PEMBAYARAN') whereRetur.push('1 = 0');
        if (tglAwal) { whereRetur.push('r.tanggal_retur >= ?'); paramsRetur.push(tglAwal); }
        if (tglAkhir) { whereRetur.push('r.tanggal_retur < DATE_ADD(?, INTERVAL 1 DAY)'); paramsRetur.push(tglAkhir); }
        for (const l of likes) {
            whereRetur.push('(pr.nama_pelanggan LIKE ? OR ph.kode_pelanggan LIKE ? OR r.no_faktur LIKE ?)');
            paramsRetur.push(l, l, l);
        }
        if (kode) { whereRetur.push('ph.kode_pelanggan = ?'); paramsRetur.push(kode); }

        // Bangun potongan FROM ... WHERE, dengan syarat tambahan opsional (cursor)
        const fromBayar = (extraSql = [], extraParams = []) => ({
            sql: `FROM pembayaran_piutang_header h WHERE ${[...whereBayar, ...extraSql].join(' AND ')}`,
            params: [...paramsBayar, ...extraParams]
        });
        const fromRetur = (extraSql = [], extraParams = []) => ({
            sql: `FROM retur_header r
                  INNER JOIN penjualan_header ph ON ph.no_faktur = r.no_faktur
                  LEFT JOIN pelanggan pr ON pr.kode_pelanggan = ph.kode_pelanggan
                  WHERE ${[...whereRetur, ...extraSql].join(' AND ')}`,
            params: [...paramsRetur, ...extraParams]
        });

        // Syarat cursor per cabang. Urutan global: tgl DESC, jenis DESC ('RETUR' > 'PEMBAYARAN'), id DESC
        const kondisiCursor = (jenisCabang, kolTgl, kolId) => {
            if (!cursor) return null;
            if (jenisCabang === cursor.jenis) {
                return { sql: `(${kolTgl} < ? OR (${kolTgl} = ? AND ${kolId} < ?))`, params: [cursor.tgl, cursor.tgl, cursor.id] };
            }
            if (jenisCabang < cursor.jenis) return { sql: `${kolTgl} <= ?`, params: [cursor.tgl] };
            return { sql: `${kolTgl} < ?`, params: [cursor.tgl] };
        };
        const cb = kondisiCursor('PEMBAYARAN', 'h.tanggal_bayar', 'h.id');
        const cr = kondisiCursor('RETUR', 'r.tanggal_retur', 'r.id');
        const listBayar = fromBayar(cb ? [cb.sql] : [], cb ? cb.params : []);
        const listRetur = fromRetur(cr ? [cr.sql] : [], cr ? cr.params : []);

        // ---------------- RINGKASAN: hanya halaman pertama ----------------
        let ringkasanPromise = null;
        if (!cursor) {
            // total pembayaran dihitung dari BARIS faktur yang cocok (akurat untuk setoran DCR)
            const lfSum = lineFilter('d');
            const sumBayarSql = `SELECT COUNT(DISTINCT h.id) AS n, COALESCE(SUM(d.jumlah), 0) AS total
                                   FROM pembayaran_piutang_header h
                                   JOIN pembayaran_piutang_detail d ON d.id_pembayaran = h.id
                                   LEFT JOIN penjualan_header pk ON pk.no_faktur = d.no_faktur
                                   LEFT JOIN pelanggan pq ON pq.kode_pelanggan = pk.kode_pelanggan
                                  WHERE ${[...dateBayarSql, ...lfSum.sql].join(' AND ')}`;
            const fr = fromRetur();
            ringkasanPromise = Promise.all([
                rsQuery(sumBayarSql, [...dateBayarParams, ...lfSum.params]),
                rsQuery(`SELECT COUNT(*) AS n, COALESCE(SUM(r.jumlah_potong_piutang), 0) AS total ${fr.sql}`, fr.params)
            ]);
        }

        // ---------------- DAFTAR: top (limit + 1) per cabang, lalu digabung ----------------
        const listPromise = rsQuery(
            `SELECT u.jenis, u.ref_id, u.nomor, u.kode_pelanggan,
                    COALESCE(pl.nama_pelanggan, u.kode_pelanggan)             AS nama_pelanggan,
                    DATE_FORMAT(u.tgl, '%Y-%m-%d %H:%i:%s')                   AS tanggal,
                    DATE_FORMAT(u.tgl, '%Y-%m-%d %H:%i:%s.%f')                AS tgl_cursor,
                    u.total, u.metode, u.catatan, u.dibuat_oleh, u.no_faktur_retur, u.no_faktur_lain,
                    u.dpp_total, u.ppn_persen, u.ppn_nominal, u.grand_total
               FROM (
                     (SELECT 'PEMBAYARAN' AS jenis, h.id AS ref_id, h.no_bayar AS nomor,
                             h.kode_pelanggan, h.tanggal_bayar AS tgl, h.total_bayar AS total,
                             h.metode AS metode, h.catatan AS catatan, h.dibuat_oleh AS dibuat_oleh,
                             NULL AS no_faktur_retur, NULL AS no_faktur_lain,
                             0 AS dpp_total, 0 AS ppn_persen, 0 AS ppn_nominal, 0 AS grand_total
                        ${listBayar.sql}
                        ORDER BY h.tanggal_bayar DESC, h.id DESC
                        LIMIT ?)
                     UNION ALL
                     (SELECT 'RETUR' AS jenis, r.id AS ref_id, r.no_retur AS nomor,
                             ph.kode_pelanggan, r.tanggal_retur AS tgl, r.jumlah_potong_piutang AS total,
                             'RETUR' AS metode, r.catatan AS catatan, NULL AS dibuat_oleh,
                             r.no_faktur AS no_faktur_retur, r.no_faktur_lain AS no_faktur_lain,
                             IFNULL(r.dpp_total, 0) AS dpp_total,
                             IFNULL(r.ppn_persen, 0) AS ppn_persen,
                             IFNULL(r.ppn_nominal, 0) AS ppn_nominal,
                             IFNULL(r.grand_total, r.jumlah_potong_piutang) AS grand_total
                        ${listRetur.sql}
                        ORDER BY r.tanggal_retur DESC, r.id DESC
                        LIMIT ?)
                     ORDER BY tgl DESC, jenis DESC, ref_id DESC
                     LIMIT ?
                    ) u
               LEFT JOIN pelanggan pl ON pl.kode_pelanggan = u.kode_pelanggan
              ORDER BY u.tgl DESC, u.jenis DESC, u.ref_id DESC`,
            [...listBayar.params, limit + 1, ...listRetur.params, limit + 1, limit + 1]
        );

        const [[rowsAll], ringkasanRes] = await Promise.all([listPromise, ringkasanPromise]);

        const hasMore = rowsAll.length > limit;
        const rows = hasMore ? rowsAll.slice(0, limit) : rowsAll;
        const terakhir = rows[rows.length - 1];
        const nextCursor = hasMore && terakhir
            ? rsEncodeCursor(terakhir.tgl_cursor, terakhir.jenis, terakhir.ref_id)
            : null;

        let ringkasan = null;
        if (ringkasanRes) {
            const [[[sb]], [[sr]]] = ringkasanRes;
            ringkasan = {
                jumlah_pembayaran: rsNum(sb?.n),
                total_pembayaran: rsNum(sb?.total),
                jumlah_retur: rsNum(sr?.n),
                total_retur: rsNum(sr?.total)
            };
        }

        // rincian per faktur untuk baris pembayaran (ikut filter pelanggan supaya setoran DCR rapi)
        const detailMap = new Map();
        let rincianTerpotong = false;
        const idBayar = rows.filter((r) => r.jenis === 'PEMBAYARAN').map((r) => r.ref_id);
        if (idBayar.length > 0) {
            const lfDet = lineFilter('d');
            const [details] = await rsQuery(
                `SELECT d.id_pembayaran, d.no_faktur, d.jumlah, d.sisa_sebelum, d.sisa_sesudah,
                        pk.kode_pelanggan AS kode_pelanggan_faktur,
                        COALESCE(pq.nama_pelanggan, pk.kode_pelanggan) AS nama_pelanggan_faktur
                   FROM pembayaran_piutang_detail d
                   LEFT JOIN penjualan_header pk ON pk.no_faktur = d.no_faktur
                   LEFT JOIN pelanggan pq ON pq.kode_pelanggan = pk.kode_pelanggan
                  WHERE d.id_pembayaran IN (?)
                  ${lfDet.sql.length ? `AND ${lfDet.sql.join(' AND ')}` : ''}
                  ORDER BY d.id
                  LIMIT ?`,
                [idBayar, ...lfDet.params, RS_MAX_DETAIL_ROWS + 1]
            );
            rincianTerpotong = details.length > RS_MAX_DETAIL_ROWS;
            for (const d of (rincianTerpotong ? details.slice(0, RS_MAX_DETAIL_ROWS) : details)) {
                if (!detailMap.has(d.id_pembayaran)) detailMap.set(d.id_pembayaran, []);
                detailMap.get(d.id_pembayaran).push({
                    no_faktur: d.no_faktur,
                    nama_pelanggan: d.nama_pelanggan_faktur,
                    kode_pelanggan: d.kode_pelanggan_faktur,
                    jumlah: rsNum(d.jumlah),
                    sisa_sebelum: rsNum(d.sisa_sebelum),
                    sisa_sesudah: rsNum(d.sisa_sesudah)
                });
            }
        }

        // rincian PPN per faktur untuk baris retur.
        // Faktur pajak sebuah barang = faktur ASAL barang (retur silang); barang manual
        // (id_detail_penjualan NULL) memakai faktur tujuan. Sama dengan aturan di ProsesRetur.
        const ppnMap = new Map();
        const idRetur = rows.filter((r) => r.jenis === 'RETUR').map((r) => r.ref_id);
        if (idRetur.length > 0) {
            const [ppnRows] = await rsQuery(
                `SELECT x.retur_id, x.no_faktur_ppn, x.ppn_persen, SUM(x.subtotal_retur) AS dpp
                   FROM (
                         SELECT rd.retur_id, rd.subtotal_retur,
                                COALESCE(pd.no_faktur, rh.no_faktur) AS no_faktur_ppn,
                                IFNULL(ph.ppn_persen, 0) AS ppn_persen
                           FROM retur_detail rd
                           JOIN retur_header rh ON rh.id = rd.retur_id
                           LEFT JOIN penjualan_detail pd ON pd.id_detail = rd.id_detail_penjualan
                           LEFT JOIN penjualan_header ph ON ph.no_faktur = COALESCE(pd.no_faktur, rh.no_faktur)
                          WHERE rd.retur_id IN (?)
                        ) x
                  GROUP BY x.retur_id, x.no_faktur_ppn, x.ppn_persen
                  ORDER BY x.retur_id, x.ppn_persen, x.no_faktur_ppn`,
                [idRetur]
            );
            for (const p of ppnRows) {
                const k = Number(p.retur_id);
                if (!ppnMap.has(k)) ppnMap.set(k, []);
                ppnMap.get(k).push({ no_faktur: p.no_faktur_ppn, ppn_persen: p.ppn_persen, dpp: p.dpp });
            }
        }

        return res.status(200).json({
            status: true,
            data: {
                ringkasan,
                riwayat: rows.map((h) => {
                    const retur = h.jenis === 'RETUR';
                    const isReturSilang = retur && !!(h.no_faktur_lain && h.no_faktur_retur !== h.no_faktur_lain);
                    const isDcr = !retur && h.kode_pelanggan === 'MULTI_TOKO';
                    const rincian = retur
                        ? [{
                            no_faktur: h.no_faktur_retur,
                            nama_pelanggan: h.nama_pelanggan,
                            kode_pelanggan: h.kode_pelanggan,
                            jumlah: rsNum(h.total),
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
                        is_dcr: isDcr,
                        tanggal_bayar: h.tanggal,
                        // filter pelanggan aktif: tampilkan hanya porsi yang cocok
                        total_bayar: !retur && adaFilterPelanggan && !rincianTerpotong
                            ? rincian.reduce((a, x) => a + x.jumlah, 0)
                            : rsNum(h.total),
                        metode: h.metode,
                        catatan: h.catatan,
                        dibuat_oleh: h.dibuat_oleh,
                        is_retur_silang: isReturSilang,
                        no_faktur_asli: retur ? h.no_faktur_retur : null,
                        no_faktur_lain: retur ? (h.no_faktur_lain || h.no_faktur_retur) : null,
                        dpp_total: retur ? rsNum(h.dpp_total) : null,
                        ppn_persen: retur ? rsNum(h.ppn_persen) : null,   // tarif efektif (rata-rata) bila campur tarif
                        ppn_nominal: retur ? rsNum(h.ppn_nominal) : null,
                        grand_total: retur ? rsNum(h.grand_total) : null,
                        rincian_ppn: retur
                            ? rsRincianPpn(ppnMap.get(Number(h.ref_id)) || [], h.ppn_nominal)
                            : [],
                        rincian_terpotong: !retur && rincianTerpotong,
                        rincian
                    };
                }),
                has_more: hasMore,
                next_cursor: nextCursor
            }
        });
    } catch (err) {
        return rsResponError(res, err, 'RIWAYAT_SEMUA_PEMBAYARAN');
    }
}
