import { db } from "../../db.js"; // sesuaikan path, sama seperti di Hutang.mjs

// ============================================================================
// RIWAYAT SEMUA PEMBAYARAN HUTANG (semua supplier)
// File ini BERDIRI SENDIRI: semua helper memakai awalan `rh` supaya tidak
// bentrok dengan Hutang.mjs. Tidak ada satu pun fungsi lama yang diubah.
//
//   GET /api-be/SERVER_HUTANG/RIWAYAT_SEMUA_PEMBAYARAN_HUTANG
//   Query:
//     q            nama supplier / no faktur (boleh beberapa kata, maks 5)
//     supplier_id  filter persis 1 supplier (opsional)
//     tgl_awal     YYYY-MM-DD (opsional)
//     tgl_akhir    YYYY-MM-DD (opsional, sampai akhir hari itu)
//     jenis        SEMUA | PEMBAYARAN | RETUR   (default SEMUA)
//     page, limit
//
// PASANG di router (sama seperti endpoint hutang lain):
//   import { RIWAYAT_SEMUA_PEMBAYARAN_HUTANG } from './riwayatHutang.js';
//   router.get('/RIWAYAT_SEMUA_PEMBAYARAN_HUTANG', <middleware auth>, RIWAYAT_SEMUA_PEMBAYARAN_HUTANG);
// ============================================================================
const RH_MAX_KEYWORD = 100;
const RH_MAX_LIMIT = 50;
const RH_DEFAULT_LIMIT = 20;
const RH_MAX_PAGE = 100000;
const RH_MAX_KATA = 5;
const RH_JENIS = ['SEMUA', 'PEMBAYARAN', 'RETUR'];

const rhNum = (v) => Number(v) || 0;
// eslint-disable-next-line no-control-regex
const rhStr = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001F\u007F]/g, '').trim() : '');
const rhKeInt = (v) => {
    const s = typeof v === 'number' ? String(v) : (typeof v === 'string' ? v.trim() : '');
    return /^\d{1,18}$/.test(s) ? Number(s) : NaN;
};
const rhEscLike = (t) => t.replace(/[\\%_]/g, '\\$&');

class RhError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.name = 'RhError';
        this.status = status;
    }
}

function rhAmbilPaging(query) {
    const page = Math.min(RH_MAX_PAGE, Math.max(1, rhKeInt(query.page) || 1));
    const limit = Math.min(RH_MAX_LIMIT, Math.max(1, rhKeInt(query.limit) || RH_DEFAULT_LIMIT));
    return { page, limit, offset: (page - 1) * limit };
}

function rhTglValid(v) {
    const s = rhStr(v);
    if (!s) return '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new RhError('Format tanggal harus YYYY-MM-DD!');
    const [y, m, d] = s.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
        throw new RhError('Tanggal tidak valid!');
    }
    return s;
}

function rhResponError(res, err, tag) {
    if (err instanceof RhError) {
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

export async function RIWAYAT_SEMUA_PEMBAYARAN_HUTANG(req, res) {
    try {
        const qRaw = req.query.q;
        const supRaw = req.query.supplier_id;
        if ((qRaw !== undefined && typeof qRaw !== 'string') || (supRaw !== undefined && typeof supRaw !== 'string')) {
            throw new RhError('Parameter tidak valid!');
        }

        const q = rhStr(qRaw).slice(0, RH_MAX_KEYWORD);
        let supplierId = null;
        if (rhStr(supRaw) !== '') {
            const id = rhKeInt(supRaw);
            if (!Number.isSafeInteger(id) || id <= 0) throw new RhError('Supplier tidak valid!');
            supplierId = id;
        }

        const tglAwal = rhTglValid(req.query.tgl_awal);
        const tglAkhir = rhTglValid(req.query.tgl_akhir);
        if (tglAwal && tglAkhir && tglAwal > tglAkhir) {
            throw new RhError('Tanggal awal tidak boleh lebih besar dari tanggal akhir!');
        }

        const jenisRaw = rhStr(req.query.jenis).toUpperCase();
        const jenis = RH_JENIS.includes(jenisRaw) ? jenisRaw : 'SEMUA';
        const { page, limit, offset } = rhAmbilPaging(req.query);

        const likes = q.split(/\s+/).filter(Boolean).slice(0, RH_MAX_KATA).map((t) => `%${rhEscLike(t)}%`);
        const adaFilterSupplier = likes.length > 0 || supplierId !== null;

        // Filter per BARIS faktur untuk cabang pembayaran.
        //   a  = alias tabel pembayaran_hutang_detail
        //   pk = pembelian_header (faktur yang dibayar)
        const lineFilter = (a) => {
            const sql = [];
            const params = [];
            for (const l of likes) {
                sql.push(`(pk.nama_supplier LIKE ? OR ${a}.no_faktur LIKE ?)`);
                params.push(l, l);
            }
            if (supplierId !== null) {
                sql.push('pk.supplier_id = ?');
                params.push(supplierId);
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
        if (adaFilterSupplier) {
            const lf = lineFilter('dk');
            whereBayar.push(
                `EXISTS (SELECT 1 FROM pembayaran_hutang_detail dk
                           JOIN pembelian_header pk ON pk.id = dk.id_pembelian
                          WHERE dk.id_pembayaran = h.id AND ${lf.sql.join(' AND ')})`
            );
            paramsBayar.push(...lf.params);
        }

        // ---------------- cabang RETUR (potong hutang) ----------------
        const whereRetur = ["r.metode_penyelesaian = 'POTONG_HUTANG'", 'r.jumlah_potong_hutang > 0'];
        const paramsRetur = [];
        if (jenis === 'PEMBAYARAN') whereRetur.push('1 = 0');
        if (tglAwal) { whereRetur.push('r.tanggal_retur >= ?'); paramsRetur.push(tglAwal); }
        if (tglAkhir) { whereRetur.push('r.tanggal_retur < DATE_ADD(?, INTERVAL 1 DAY)'); paramsRetur.push(tglAkhir); }
        for (const l of likes) {
            whereRetur.push('(p.nama_supplier LIKE ? OR r.no_faktur LIKE ?)');
            paramsRetur.push(l, l);
        }
        if (supplierId !== null) { whereRetur.push('p.supplier_id = ?'); paramsRetur.push(supplierId); }

        const fromBayar = `FROM pembayaran_hutang_header h WHERE ${whereBayar.join(' AND ')}`;
        // join faktur memakai aturan yang sama dengan RIWAYAT_PEMBAYARAN_HUTANG lama
        const fromRetur = `FROM retur_pembelian_header r
                           JOIN pembelian_header p ON LOWER(TRIM(r.no_faktur)) = LOWER(TRIM(p.no_faktur))
                           WHERE ${whereRetur.join(' AND ')}`;
        const paramsGabung = [...paramsBayar, ...paramsRetur];

        // total pembayaran dihitung dari BARIS faktur yang cocok (akurat untuk pembayaran multi-faktur)
        const lfSum = lineFilter('d');
        const sumBayarSql = `SELECT COUNT(DISTINCT h.id) AS n, COALESCE(SUM(d.jumlah), 0) AS total
                               FROM pembayaran_hutang_header h
                               JOIN pembayaran_hutang_detail d ON d.id_pembayaran = h.id
                               JOIN pembelian_header pk ON pk.id = d.id_pembelian
                              WHERE ${[...dateBayarSql, ...lfSum.sql].join(' AND ')}`;

        const [[[cntBayar]], [[cntRetur]], [[sumBayar]], [[sumRetur]], [rows]] = await Promise.all([
            db.query(`SELECT COUNT(*) AS n ${fromBayar}`, paramsBayar),
            db.query(`SELECT COUNT(*) AS n ${fromRetur}`, paramsRetur),
            db.query(sumBayarSql, [...dateBayarParams, ...lfSum.params]),
            db.query(`SELECT COALESCE(SUM(r.jumlah_potong_hutang), 0) AS total ${fromRetur}`, paramsRetur),
            db.query(
                `SELECT u.jenis, u.ref_id, u.nomor, u.supplier_id,
                        DATE_FORMAT(u.tgl, '%Y-%m-%d %H:%i:%s') AS tanggal,
                        u.total, u.metode, u.catatan, u.dibuat_oleh, u.no_faktur_retur,
                        u.dpp_total, u.ppn_persen, u.ppn_nominal, u.grand_total
                   FROM (
                         (SELECT 'PEMBAYARAN' AS jenis, h.id AS ref_id, h.no_bayar AS nomor,
                                 h.supplier_id AS supplier_id, h.tanggal_bayar AS tgl, h.total_bayar AS total,
                                 h.metode AS metode, h.catatan AS catatan, h.dibuat_oleh AS dibuat_oleh,
                                 NULL AS no_faktur_retur,
                                 0 AS dpp_total, 0 AS ppn_persen, 0 AS ppn_nominal, 0 AS grand_total
                            ${fromBayar})
                         UNION ALL
                         (SELECT 'RETUR' AS jenis, r.id AS ref_id, r.no_retur AS nomor,
                                 p.supplier_id AS supplier_id, r.tanggal_retur AS tgl, r.jumlah_potong_hutang AS total,
                                 'POTONG_HUTANG' AS metode, r.catatan AS catatan, NULL AS dibuat_oleh,
                                 r.no_faktur AS no_faktur_retur,
                                 IFNULL(r.dpp_total, 0) AS dpp_total,
                                 IFNULL(r.ppn_persen, 0) AS ppn_persen,
                                 IFNULL(r.ppn_nominal, 0) AS ppn_nominal,
                                 IFNULL(r.grand_total, r.jumlah_potong_hutang) AS grand_total
                            ${fromRetur})
                         ORDER BY tgl DESC, jenis DESC, ref_id DESC
                         LIMIT ? OFFSET ?
                        ) u
                  ORDER BY u.tgl DESC, u.jenis DESC, u.ref_id DESC`,
                [...paramsGabung, limit, offset]
            )
        ]);

        // ---- nama supplier: pakai nama pada faktur terbaru tiap supplier (aturan sama dengan modul lama) ----
        const namaMap = new Map();
        const idSupplier = [...new Set(rows.map((r) => r.supplier_id).filter((x) => x !== null && x !== undefined))];
        if (idSupplier.length > 0) {
            const [namaRows] = await db.query(
                `SELECT p.supplier_id, p.nama_supplier
                   FROM pembelian_header p
                  WHERE p.id IN (SELECT MAX(x.id) FROM pembelian_header x WHERE x.supplier_id IN (?) GROUP BY x.supplier_id)`,
                [idSupplier]
            );
            for (const n of namaRows) namaMap.set(String(n.supplier_id), n.nama_supplier);
        }

        // ---- rincian per faktur untuk baris pembayaran (ikut filter supaya konsisten dengan total) ----
        const detailMap = new Map();
        const idBayar = rows.filter((r) => r.jenis === 'PEMBAYARAN').map((r) => r.ref_id);
        if (idBayar.length > 0) {
            const lfDet = lineFilter('d');
            const [details] = await db.query(
                `SELECT d.id_pembayaran, d.id_pembelian, d.no_faktur, d.jumlah, d.sisa_sebelum, d.sisa_sesudah,
                        pk.nama_supplier AS nama_supplier_faktur
                   FROM pembayaran_hutang_detail d
                   JOIN pembelian_header pk ON pk.id = d.id_pembelian
                  WHERE d.id_pembayaran IN (?)
                  ${lfDet.sql.length ? `AND ${lfDet.sql.join(' AND ')}` : ''}
                  ORDER BY d.id`,
                [idBayar, ...lfDet.params]
            );
            for (const d of details) {
                const k = String(d.id_pembayaran);
                if (!detailMap.has(k)) detailMap.set(k, []);
                detailMap.get(k).push({
                    id_pembelian: d.id_pembelian,
                    no_faktur: d.no_faktur,
                    nama_supplier: d.nama_supplier_faktur,
                    jumlah: rhNum(d.jumlah),
                    sisa_sebelum: rhNum(d.sisa_sebelum),
                    sisa_sesudah: rhNum(d.sisa_sesudah)
                });
            }
        }

        const total = rhNum(cntBayar?.n) + rhNum(cntRetur?.n);
        return res.status(200).json({
            status: true,
            data: {
                ringkasan: {
                    jumlah_pembayaran: rhNum(sumBayar?.n),
                    total_pembayaran: rhNum(sumBayar?.total),
                    jumlah_retur: rhNum(cntRetur?.n),
                    total_retur: rhNum(sumRetur?.total)
                },
                riwayat: rows.map((h) => {
                    const retur = h.jenis === 'RETUR';
                    const rincian = retur
                        ? [{
                            id_pembelian: null,
                            no_faktur: h.no_faktur_retur,
                            nama_supplier: null,
                            jumlah: rhNum(h.total),
                            sisa_sebelum: null,
                            sisa_sesudah: null
                        }]
                        : (detailMap.get(String(h.ref_id)) || []);

                    return {
                        jenis: h.jenis,
                        no_bayar: h.nomor,
                        no_retur: retur ? h.nomor : null,
                        supplier_id: h.supplier_id,
                        nama_supplier: namaMap.get(String(h.supplier_id)) || 'SUPPLIER',
                        tanggal_bayar: h.tanggal,
                        // filter supplier aktif: tampilkan hanya porsi yang cocok
                        total_bayar: !retur && adaFilterSupplier
                            ? rincian.reduce((a, x) => a + x.jumlah, 0)
                            : rhNum(h.total),
                        metode: h.metode,
                        catatan: h.catatan,
                        dibuat_oleh: h.dibuat_oleh,
                        no_faktur_retur: retur ? h.no_faktur_retur : null,
                        dpp_total: retur ? rhNum(h.dpp_total) : null,
                        ppn_persen: retur ? rhNum(h.ppn_persen) : null,
                        ppn_nominal: retur ? rhNum(h.ppn_nominal) : null,
                        grand_total: retur ? rhNum(h.grand_total) : null,
                        rincian
                    };
                }),
                paging: { page, limit, total, total_page: Math.max(1, Math.ceil(total / limit)) }
            }
        });
    } catch (err) {
        return rhResponError(res, err, 'RIWAYAT_SEMUA_PEMBAYARAN_HUTANG');
    }
}
