// retur-riwayat.controller.js
// Riwayat Retur Penjualan: list (keyset pagination), ringkasan, detail, export Excel & PDF (1 tabel).
// Dependensi: npm i exceljs pdfkit
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { db } from '../../db.js'; // <- sesuaikan path koneksi mysql2 pool kamu

/* ───────────────────────── Konfigurasi ───────────────────────── */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_EXPORT_ROWS_EXCEL = 100000; // maks. baris barang per export Excel
const MAX_EXPORT_ROWS_PDF = 15000;    // maks. baris barang per export PDF
const MAX_CONCURRENT_EXPORT = 2;      // proteksi memori: 2 export bersamaan
let activeExports = 0;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/* ───────────────────────── Helper umum ───────────────────────── */
class HttpError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}

const escapeLike = (s) => s.replace(/[\\%_]/g, '\\$&');
const num = (v) => Number(v) || 0;

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

const labelMetode = (m) => ({
    POTONG_PIUTANG: 'Potong Piutang',
    REFUND_KAS: 'Refund Kas'
}[m] || String(m || '-').toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()));

// "2026-10-24 17:35:11" -> Date UTC (supaya Excel menampilkan jam apa adanya, tanpa geser zona waktu)
const toExcelDate = (s) => {
    const [d, t] = String(s).split(' ');
    const [y, m, dd] = d.split('-').map(Number);
    const [h, mi, se] = t.split(':').map(Number);
    return new Date(Date.UTC(y, m - 1, dd, h, mi, se));
};

const fmtTgl = (s) => {
    const [d, t] = String(s).split(' ');
    const [y, m, dd] = d.split('-');
    return `${dd}/${m}/${y} ${t.slice(0, 5)}`;
};

const fmtRp = (n) => 'Rp ' + Math.round(num(n)).toLocaleString('id-ID');
const fmtInt = (n) => Math.round(num(n)).toLocaleString('id-ID');

function handleError(res, err, tag) {
    if (err instanceof HttpError) {
        if (!res.headersSent) return res.status(err.status).json({ message: err.message });
        return res.destroy(err);
    }
    console.error(`[${tag}] Error:`, err);
    if (!res.headersSent) return res.status(500).json({ message: 'Terjadi kesalahan pada server. Silakan coba lagi.' });
    return res.destroy(err);
}

/* ───────────────────────── Filter & cursor ───────────────────────── */
function parseFilters(query) {
    const from = String(query.from ?? '').trim();
    const to = String(query.to ?? '').trim();
    if (from && !isValidDate(from)) throw new HttpError(400, 'Format tanggal awal tidak valid (YYYY-MM-DD).');
    if (to && !isValidDate(to)) throw new HttpError(400, 'Format tanggal akhir tidak valid (YYYY-MM-DD).');
    if (from && to && from > to) throw new HttpError(400, 'Tanggal awal tidak boleh melebihi tanggal akhir.');

    const metode = String(query.metode ?? '').trim().toUpperCase();
    if (metode && !/^[A-Z_]{1,30}$/.test(metode)) throw new HttpError(400, 'Metode penyelesaian tidak valid.');

    const q = String(query.q ?? '').trim().slice(0, 100);
    return { from, to, metode, q };
}

// Rentang tanggal dibuat sargable (>= awal, < hari berikutnya) supaya index tanggal_retur terpakai.
function buildWhere(f) {
    const where = [];
    const params = [];
    if (f.from) { where.push('rh.tanggal_retur >= ?'); params.push(`${f.from} 00:00:00`); }
    if (f.to) { where.push('rh.tanggal_retur < ?'); params.push(`${nextDay(f.to)} 00:00:00`); }
    if (f.metode) { where.push('rh.metode_penyelesaian = ?'); params.push(f.metode); }
    for (const t of f.q.split(/\s+/).filter(Boolean).slice(0, 5)) {
        const like = `%${escapeLike(t)}%`;
        where.push(`(rh.no_retur LIKE ? OR rh.no_faktur LIKE ? OR rh.no_faktur_lain LIKE ?
                     OR p.nama_pelanggan LIKE ? OR ph.kode_pelanggan LIKE ?)`);
        params.push(like, like, like, like, like);
    }
    return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

const encodeCursor = (t, id) => Buffer.from(`${t}|${id}`).toString('base64url');

function decodeCursor(c) {
    if (!c) return null;
    try {
        const [t, id] = Buffer.from(String(c), 'base64url').toString('utf8').split('|');
        if (!DATETIME_RE.test(t) || !/^\d+$/.test(id)) throw new Error('bad');
        return { t, id: Number(id) };
    } catch {
        throw new HttpError(400, 'Cursor tidak valid.');
    }
}

// Pelanggan diambil dari faktur tujuan (retur_header.no_faktur).
const FROM_JOINS = `
    FROM retur_header rh
    LEFT JOIN penjualan_header ph ON ph.no_faktur = rh.no_faktur
    LEFT JOIN pelanggan p ON p.kode_pelanggan = ph.kode_pelanggan`;

const TGL_FMT = `DATE_FORMAT(rh.tanggal_retur, '%Y-%m-%d %H:%i:%s')`;

/* ───────────────────────── GET /riwayat ───────────────────────── */
// Query: from, to, metode, q, limit, cursor
export async function LIST_RIWAYAT_RETUR(req, res) {
    try {
        const f = parseFilters(req.query);
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
        const cursor = decodeCursor(req.query.cursor);

        const w = buildWhere(f);
        const conds = w.sql ? [w.sql.replace(/^WHERE /, '')] : [];
        const params = [...w.params];
        if (cursor) {
            conds.push('(rh.tanggal_retur < ? OR (rh.tanggal_retur = ? AND rh.id < ?))');
            params.push(cursor.t, cursor.t, cursor.id);
        }

        const [rows] = await db.query(
            `SELECT rh.id, rh.no_retur, rh.no_faktur, rh.no_faktur_lain,
                    ${TGL_FMT} AS tanggal_retur,
                    rh.metode_penyelesaian, rh.grand_total, rh.catatan,
                    COALESCE(p.nama_pelanggan, ph.kode_pelanggan) AS nama_pelanggan
             ${FROM_JOINS}
             ${conds.length ? `WHERE ${conds.join(' AND ')}` : ''}
             ORDER BY rh.tanggal_retur DESC, rh.id DESC
             LIMIT ?`,
            [...params, limit + 1]
        );

        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;

        const itemMap = new Map();
        if (page.length) {
            const [items] = await db.query(
                `SELECT retur_id, COUNT(*) AS jumlah_item, SUM(qty_total_pcs) AS total_pcs
                   FROM retur_detail WHERE retur_id IN (?) GROUP BY retur_id`,
                [page.map(r => r.id)]
            );
            for (const i of items) itemMap.set(Number(i.retur_id), i);
        }

        const data = page.map(r => {
            const it = itemMap.get(Number(r.id));
            return {
                id: r.id,
                no_retur: r.no_retur,
                no_faktur: r.no_faktur,
                no_faktur_asal: r.no_faktur_lain,
                tanggal_retur: r.tanggal_retur,
                metode_penyelesaian: r.metode_penyelesaian,
                metode_label: labelMetode(r.metode_penyelesaian),
                grand_total: num(r.grand_total),
                catatan: r.catatan,
                nama_pelanggan: r.nama_pelanggan || '-',
                jumlah_item: it ? num(it.jumlah_item) : 0,
                total_pcs: it ? num(it.total_pcs) : 0
            };
        });

        const last = page[page.length - 1];
        return res.status(200).json({
            data,
            has_more: hasMore,
            next_cursor: hasMore && last ? encodeCursor(last.tanggal_retur, last.id) : null
        });
    } catch (err) {
        return handleError(res, err, 'LIST_RIWAYAT_RETUR');
    }
}

/* ───────────────────────── GET /riwayat/summary ───────────────────────── */
// per_metode mengabaikan filter metode (untuk chip), total mengikuti filter metode.
export async function SUMMARY_RIWAYAT_RETUR(req, res) {
    try {
        const f = parseFilters(req.query);
        const w = buildWhere({ ...f, metode: '' });

        const [rows] = await db.query(
            `SELECT rh.metode_penyelesaian AS metode, COUNT(*) AS jumlah,
                    COALESCE(SUM(rh.grand_total), 0) AS total
             ${FROM_JOINS}
             ${w.sql}
             GROUP BY rh.metode_penyelesaian
             ORDER BY jumlah DESC`,
            w.params
        );

        const perMetode = rows.map(r => ({
            metode: r.metode,
            label: labelMetode(r.metode),
            jumlah: num(r.jumlah),
            total: num(r.total)
        }));
        const aktif = f.metode ? perMetode.filter(m => m.metode === f.metode) : perMetode;

        return res.status(200).json({
            total_retur: aktif.reduce((a, m) => a + m.jumlah, 0),
            total_nilai: aktif.reduce((a, m) => a + m.total, 0),
            per_metode: perMetode,
            semua_jumlah: perMetode.reduce((a, m) => a + m.jumlah, 0)
        });
    } catch (err) {
        return handleError(res, err, 'SUMMARY_RIWAYAT_RETUR');
    }
}

/* ───────────────────────── GET /riwayat/:id ───────────────────────── */
export async function DETAIL_RIWAYAT_RETUR(req, res) {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'ID retur tidak valid.');

        const [[header], [items]] = await Promise.all([
            db.query(
                `SELECT rh.id, rh.no_retur, rh.no_faktur, rh.no_faktur_lain,
                        ${TGL_FMT} AS tanggal_retur,
                        rh.metode_penyelesaian, rh.catatan,
                        rh.dpp_total, rh.ppn_persen, rh.ppn_nominal, rh.grand_total,
                        rh.jumlah_potong_piutang, rh.jumlah_refund_kas,
                        COALESCE(p.nama_pelanggan, ph.kode_pelanggan) AS nama_pelanggan
                 ${FROM_JOINS}
                 WHERE rh.id = ? LIMIT 1`,
                [id]
            ),
            db.query(
                `SELECT rd.id, rd.kode_barang, b.nama_barang, rd.satuan_retur, rd.qty_input,
                        rd.rasio_ke_pcs, rd.qty_total_pcs, rd.harga_satuan, rd.subtotal_retur,
                        rd.kondisi_barang, rd.alasan_retur
                   FROM retur_detail rd
                   LEFT JOIN barang b ON b.kode_barang = rd.kode_barang
                  WHERE rd.retur_id = ?
                  ORDER BY rd.id`,
                [id]
            )
        ]);

        if (header.length === 0) throw new HttpError(404, 'Data retur tidak ditemukan.');
        const h = header[0];

        return res.status(200).json({
            header: {
                id: h.id,
                no_retur: h.no_retur,
                no_faktur: h.no_faktur,
                no_faktur_asal: h.no_faktur_lain,
                tanggal_retur: h.tanggal_retur,
                metode_penyelesaian: h.metode_penyelesaian,
                metode_label: labelMetode(h.metode_penyelesaian),
                nama_pelanggan: h.nama_pelanggan || '-',
                catatan: h.catatan,
                dpp_total: num(h.dpp_total),
                ppn_persen: num(h.ppn_persen),
                ppn_nominal: num(h.ppn_nominal),
                grand_total: num(h.grand_total),
                jumlah_potong_piutang: num(h.jumlah_potong_piutang),
                jumlah_refund_kas: num(h.jumlah_refund_kas)
            },
            items: items.map(i => ({
                id: i.id,
                kode_barang: i.kode_barang,
                nama_barang: i.nama_barang || i.kode_barang,
                satuan_retur: i.satuan_retur,
                qty_input: num(i.qty_input),
                rasio_ke_pcs: num(i.rasio_ke_pcs),
                qty_total_pcs: num(i.qty_total_pcs),
                harga_satuan: num(i.harga_satuan),
                subtotal_retur: num(i.subtotal_retur),
                kondisi_barang: i.kondisi_barang,
                alasan_retur: i.alasan_retur
            }))
        });
    } catch (err) {
        return handleError(res, err, 'DETAIL_RIWAYAT_RETUR');
    }
}

/* ───────────────────────── Export: bagian umum ───────────────────────── */
async function withExportSlot(res, fn) {
    if (activeExports >= MAX_CONCURRENT_EXPORT) {
        return res.status(429).json({ message: 'Server sedang memproses export lain. Coba lagi beberapa saat.' });
    }
    activeExports++;
    try { await fn(); } finally { activeExports--; }
}

const periodeText = (f) => {
    const d = (s) => s.split('-').reverse().join('/');
    if (f.from && f.to) return f.from === f.to ? d(f.from) : `${d(f.from)} s/d ${d(f.to)}`;
    if (f.from) return `Sejak ${d(f.from)}`;
    if (f.to) return `Sampai ${d(f.to)}`;
    return 'Semua tanggal';
};

const fileStamp = (f) => `${f.from || 'awal'}_${f.to || 'akhir'}`;

const nowText = () => new Date().toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
});

/* ───────── Data export: 1 query, 1 baris per barang yang diretur ───────── */
async function fetchExportRows(f, limit) {
    const w = buildWhere(f);
    const [rows] = await db.query(
        `SELECT rh.id AS retur_id, rh.no_retur, ${TGL_FMT} AS tanggal_retur, rh.no_faktur,
                rh.metode_penyelesaian, rh.catatan,
                COALESCE(p.nama_pelanggan, ph.kode_pelanggan) AS nama_pelanggan,
                rd.id AS detail_id, rd.kode_barang, b.nama_barang, rd.satuan_retur,
                rd.qty_input, rd.qty_total_pcs, rd.subtotal_retur,
                rd.kondisi_barang, rd.alasan_retur
         FROM retur_header rh
         LEFT JOIN retur_detail rd ON rd.retur_id = rh.id
         LEFT JOIN barang b ON b.kode_barang = rd.kode_barang
         LEFT JOIN penjualan_header ph ON ph.no_faktur = rh.no_faktur
         LEFT JOIN pelanggan p ON p.kode_pelanggan = ph.kode_pelanggan
         ${w.sql}
         ORDER BY rh.tanggal_retur DESC, rh.id DESC, rd.id
         LIMIT ?`,
        [...w.params, limit + 1]
    );
    if (rows.length > limit) {
        throw new HttpError(413, `Data terlalu banyak (lebih dari ${limit.toLocaleString('id-ID')} baris). Persempit rentang tanggal.`);
    }
    return rows;
}

const kondisiText = (k) => (k ? String(k).toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : '-');
const isRusak = (k) => /rusak/i.test(String(k || ''));
const keteranganText = (r) => [r.alasan_retur, r.catatan].filter(Boolean).join(' | ') || '-';

function totalsOf(rows) {
    return {
        jumlahRetur: new Set(rows.map((r) => r.retur_id)).size,
        totalPcs: rows.reduce((a, r) => a + num(r.qty_total_pcs), 0),
        totalNilai: rows.reduce((a, r) => a + num(r.subtotal_retur), 0)
    };
}

/* ───────── Gaya Excel ───────── */
const X = { EM: 'FF047857', EM_DARK: 'FF065F46', EM_LIGHT: 'FFECFDF5', ZEBRA: 'FFF9FAFB' };
const THIN = { style: 'thin', color: { argb: 'FFD1D5DB' } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const solid = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const FMT_INT = '#,##0';
const FMT_RP = '"Rp" #,##0';

function styleHeader(row, from, to) {
    row.height = 24;
    for (let c = from; c <= to; c++) {
        const cell = row.getCell(c);
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        cell.fill = solid(X.EM);
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = BORDER;
    }
}
function styleBody(row, from, to, zebra) {
    for (let c = from; c <= to; c++) {
        const cell = row.getCell(c);
        cell.border = BORDER;
        cell.alignment = { vertical: 'middle', ...(cell.alignment || {}) };
        if (zebra) cell.fill = solid(X.ZEBRA);
    }
}
function styleTotal(row, from, to) {
    for (let c = from; c <= to; c++) {
        const cell = row.getCell(c);
        cell.font = { bold: true };
        cell.fill = solid(X.EM_LIGHT);
        cell.border = { top: { style: 'medium', color: { argb: X.EM } }, bottom: THIN, left: THIN, right: THIN };
        cell.alignment = { vertical: 'middle', ...(cell.alignment || {}) };
    }
}
// Baris total berisi rumus (SUM / SUBTOTAL) lengkap dengan hasil cache supaya tampil benar di semua viewer.
function totalRow(ws, rowNo, label, labelCol, specs, first, last, fn, lastCol) {
    const row = ws.getRow(rowNo);
    row.getCell(labelCol).value = label;
    for (const s of specs) {
        const L = ws.getColumn(s.col).letter;
        const range = `${L}${first}:${L}${last}`;
        row.getCell(s.col).value = { formula: fn === 'SUBTOTAL' ? `SUBTOTAL(109,${range})` : `SUM(${range})`, result: s.result };
        row.getCell(s.col).numFmt = s.fmt;
    }
    styleTotal(row, 1, lastCol);
    return row;
}
function printSetup(ws, titleRow) {
    ws.pageSetup = {
        orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0,
        margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
        ...(titleRow ? { printTitlesRow: titleRow } : {})
    };
    ws.headerFooter.oddFooter = '&LRiwayat Retur Penjualan&RHalaman &P dari &N';
}

/* ───────────────────────── GET /export/excel ───────────────────────── */
export async function EXPORT_EXCEL_RIWAYAT_RETUR(req, res) {
    return withExportSlot(res, async () => {
        try {
            const f = parseFilters(req.query);
            const rows = await fetchExportRows(f, MAX_EXPORT_ROWS_EXCEL);
            const T = totalsOf(rows);

            const wb = new ExcelJS.Workbook();
            wb.creator = 'Sistem Penjualan';
            wb.created = new Date();

            const cols = [
                ['No', 8], ['Tanggal & Jam', 22], ['No. Retur', 24], ['No. Faktur', 30], ['Pelanggan', 30],
                ['Kode Barang', 18], ['Nama Barang', 38], ['Qty', 9], ['Satuan', 12], ['Rasio Pcs', 13],
                ['Total Retur (Rp)', 20], ['Metode', 18], ['Kondisi', 13], ['Keterangan', 36]
            ];
            const NC = cols.length;

            const ws = wb.addWorksheet('Riwayat Retur', { views: [{ showGridLines: false }] });
            cols.forEach(([, w], i) => { ws.getColumn(i + 1).width = w; });

            // Judul + 1 baris info filter (digabung supaya tidak terpotong), header tabel di baris 4
            const headerRow = 4;
            ws.mergeCells(1, 1, 1, NC);
            const title = ws.getCell(1, 1);
            title.value = 'Riwayat Retur Penjualan';
            title.font = { bold: true, size: 16, color: { argb: X.EM } };
            title.alignment = { vertical: 'middle' };
            ws.getRow(1).height = 28;

            ws.mergeCells(2, 1, 2, NC);
            const info = ws.getCell(2, 1);
            info.value = `Periode: ${periodeText(f)}   |   Metode: ${f.metode ? labelMetode(f.metode) : 'Semua metode'}   |   Kata kunci: ${f.q || '-'}   |   Dicetak: ${nowText()} WIB`;
            info.font = { size: 10, color: { argb: 'FF4B5563' } };
            info.alignment = { vertical: 'middle' };
            ws.getRow(2).height = 18;
            ws.getRow(3).height = 8;

            const hr = ws.getRow(headerRow);
            hr.values = cols.map(([h]) => h);
            styleHeader(hr, 1, NC);
            hr.height = 26;
            // Hanya baris header yang dibekukan (tanpa kolom), jadi tidak ada garis pembagi vertikal
            ws.views = [{ showGridLines: false, state: 'frozen', ySplit: headerRow }];

            rows.forEach((d, i) => {
                const row = ws.getRow(headerRow + 1 + i);
                row.values = [
                    i + 1, toExcelDate(d.tanggal_retur), d.no_retur, d.no_faktur, d.nama_pelanggan || '-',
                    d.kode_barang || '-', d.nama_barang || d.kode_barang || '-', num(d.qty_input), d.satuan_retur || '-',
                    num(d.qty_total_pcs), num(d.subtotal_retur), labelMetode(d.metode_penyelesaian),
                    kondisiText(d.kondisi_barang), keteranganText(d)
                ];
                row.getCell(2).numFmt = 'dd/mm/yyyy hh:mm';
                [8, 10].forEach((c) => { row.getCell(c).numFmt = FMT_INT; });
                row.getCell(11).numFmt = FMT_RP;
                [1, 2, 9, 13].forEach((c) => { row.getCell(c).alignment = { horizontal: 'center' }; });
                [5, 7, 14].forEach((c) => { row.getCell(c).alignment = { wrapText: true }; });
                styleBody(row, 1, NC, i % 2 === 1);
                if (isRusak(d.kondisi_barang)) row.getCell(13).font = { bold: true, color: { argb: 'FFB91C1C' } };
            });

            if (rows.length) {
                const first = headerRow + 1;
                const last = headerRow + rows.length;
                ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: last, column: NC } };
                const t = totalRow(ws, last + 1, `Total (${fmtInt(T.jumlahRetur)} retur)`, 2, [
                    { col: 10, fmt: FMT_INT, result: T.totalPcs },
                    { col: 11, fmt: FMT_RP, result: T.totalNilai }
                ], first, last, 'SUBTOTAL', NC);
                t.getCell(10).alignment = { horizontal: 'center' };
            } else {
                ws.getCell(headerRow + 1, 1).value = 'Tidak ada data retur pada filter ini.';
                ws.getCell(headerRow + 1, 1).font = { italic: true, color: { argb: 'FF6B7280' } };
            }
            printSetup(ws, `${headerRow}:${headerRow}`);

            const buf = await wb.xlsx.writeBuffer();
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="riwayat-retur_${fileStamp(f)}.xlsx"`);
            res.setHeader('Content-Length', buf.byteLength);
            return res.end(Buffer.from(buf));
        } catch (err) {
            return handleError(res, err, 'EXPORT_EXCEL_RIWAYAT_RETUR');
        }
    });
}

/* ───────────────────────── GET /export/pdf ───────────────────────── */
export async function EXPORT_PDF_RIWAYAT_RETUR(req, res) {
    return withExportSlot(res, async () => {
        try {
            const f = parseFilters(req.query);
            const rows = await fetchExportRows(f, MAX_EXPORT_ROWS_PDF);
            const T = totalsOf(rows);

            const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 28, bufferPages: true });
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="riwayat-retur_${fileStamp(f)}.pdf"`);
            doc.pipe(res);

            const EM = '#047857', EM_DARK = '#065f46', EM_LIGHT = '#ecfdf5';
            const INK = '#111827', MUTED = '#6b7280', LINE = '#d1d5db', RED = '#b91c1c';
            const L = doc.page.margins.left;
            const TOP = doc.page.margins.top;
            const W = doc.page.width - L * 2;
            const ROW = 20;
            const BOTTOM = doc.page.height - 44;
            let y = TOP;

            const fit = (str, w) => {
                let t = String(str ?? '');
                if (doc.widthOfString(t) <= w) return t;
                while (t.length > 1 && doc.widthOfString(`${t}…`) > w) t = t.slice(0, -1);
                return `${t}…`;
            };
            const cell = (str, x, yy, w, { align = 'left', bold = false, size = 8, color = INK } = {}) => {
                doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(color);
                doc.text(fit(str, w - 8), x + 4, yy, { width: w - 8, align, lineBreak: false });
            };

            const cols = [
                { t: 'No', w: 22, a: 'center' }, { t: 'Tanggal', w: 74 }, { t: 'No. Retur', w: 92 },
                { t: 'Pelanggan', w: 98 }, { t: 'Nama barang', w: 130 }, { t: 'Qty', w: 34, a: 'right' },
                { t: 'Satuan', w: 42 }, { t: 'Rasio Pcs', w: 58, a: 'right' }, { t: 'Total retur', w: 76, a: 'right' },
                { t: 'Kondisi', w: 46 }
            ];
            const used = cols.reduce((a, c) => a + c.w, 0);
            cols.push({ t: 'Keterangan', w: W - used });

            const head = () => {
                doc.rect(L, y, W, ROW).fill(EM);
                let x = L;
                for (const c of cols) { cell(c.t, x, y + 6, c.w, { align: c.a || 'left', bold: true, color: '#ffffff' }); x += c.w; }
                y += ROW;
            };

            // Judul & info filter
            doc.font('Helvetica-Bold').fontSize(17).fillColor(EM).text('Riwayat Retur Penjualan', L, y, { lineBreak: false });
            y += 24;
            doc.font('Helvetica').fontSize(9).fillColor(MUTED);
            doc.text(`Periode: ${periodeText(f)}     Metode: ${f.metode ? labelMetode(f.metode) : 'Semua'}${f.q ? `     Kata kunci: ${f.q}` : ''}`, L, y, { lineBreak: false });
            y += 12;
            doc.text(`Dicetak: ${nowText()} WIB`, L, y, { lineBreak: false });
            y += 18;

            // Ringkasan 1 baris
            doc.roundedRect(L, y, W, 30, 5).fill(EM_LIGHT);
            [['Jumlah retur', fmtInt(T.jumlahRetur)], ['Total pcs diretur', fmtInt(T.totalPcs)], ['Total nilai retur', fmtRp(T.totalNilai)]]
                .forEach(([k, v], i) => {
                    const cx = L + i * (W / 3) + 12;
                    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(k, cx, y + 5, { lineBreak: false });
                    doc.font('Helvetica-Bold').fontSize(11).fillColor(i === 2 ? EM_DARK : INK).text(v, cx, y + 15, { lineBreak: false });
                });
            y += 42;

            if (!rows.length) {
                doc.font('Helvetica').fontSize(10).fillColor(MUTED)
                    .text('Tidak ada data retur pada filter ini.', L, y + 10, { width: W, align: 'center', lineBreak: false });
            } else {
                head();
                rows.forEach((d, i) => {
                    if (y + ROW > BOTTOM) { doc.addPage(); y = TOP; head(); }
                    if (i % 2 === 1) doc.rect(L, y, W, ROW).fill('#f9fafb');
                    const vals = [
                        String(i + 1), fmtTgl(d.tanggal_retur), d.no_retur, d.nama_pelanggan || '-',
                        d.nama_barang || d.kode_barang || '-', fmtInt(d.qty_input), d.satuan_retur || '-',
                        fmtInt(d.qty_total_pcs), fmtInt(d.subtotal_retur), kondisiText(d.kondisi_barang), keteranganText(d)
                    ];
                    let x = L;
                    cols.forEach((c, k) => {
                        const rusak = k === 9 && isRusak(d.kondisi_barang);
                        cell(vals[k], x, y + 6, c.w, { align: c.a || 'left', color: rusak ? RED : INK, bold: rusak });
                        x += c.w;
                    });
                    doc.moveTo(L, y + ROW).lineTo(L + W, y + ROW).lineWidth(0.4).strokeColor(LINE).stroke();
                    y += ROW;
                });

                // Baris total
                if (y + ROW > BOTTOM) { doc.addPage(); y = TOP; head(); }
                doc.rect(L, y, W, ROW).fill(EM_LIGHT);
                const tot = { 1: `Total (${fmtInt(T.jumlahRetur)} retur)`, 7: fmtInt(T.totalPcs), 8: fmtInt(T.totalNilai) };
                let x = L;
                cols.forEach((c, k) => {
                    if (tot[k] !== undefined) cell(tot[k], x, y + 6, c.w + (k === 1 ? 160 : 0), { align: c.a || 'left', bold: true });
                    x += c.w;
                });
                y += ROW;
            }

            // Footer: periode di kiri, nomor halaman di kanan (margin bawah dinolkan agar tidak memicu halaman baru)
            const range = doc.bufferedPageRange();
            for (let i = range.start; i < range.start + range.count; i++) {
                doc.switchToPage(i);
                doc.page.margins.bottom = 0;
                doc.font('Helvetica').fontSize(8).fillColor(MUTED);
                doc.text(`Riwayat Retur Penjualan · ${periodeText(f)}`, L, doc.page.height - 28, { width: W / 2, lineBreak: false });
                doc.text(`Halaman ${i + 1} dari ${range.count}`, L + W / 2, doc.page.height - 28, { width: W / 2, align: 'right', lineBreak: false });
            }

            await new Promise((resolve, reject) => {
                res.on('finish', resolve);
                res.on('error', reject);
                doc.end();
            });
        } catch (err) {
            return handleError(res, err, 'EXPORT_PDF_RIWAYAT_RETUR');
        }
    });
}
