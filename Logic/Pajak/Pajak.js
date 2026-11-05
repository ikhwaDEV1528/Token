import { db } from "../../db.js";

class LaporanPpnError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.name = 'LaporanPpnError';
        this.status = status;
    }
}

/**
 * Validasi Format Tanggal YYYY-MM-DD
 */
function validateDate(dateStr, paramName) {
    if (!dateStr || typeof dateStr !== 'string') {
        throw new LaporanPpnError(`Parameter "${paramName}" wajib diisi!`);
    }
    const clean = dateStr.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(clean) || isNaN(Date.parse(clean))) {
        throw new LaporanPpnError(`Format "${paramName}" tidak valid! Gunakan format YYYY-MM-DD`);
    }
    return clean;
}

/**
 * Endpoint Rekapitulasi PPN berdasarkan Rentang Tanggal (Start & End Date)
 */
export async function GetRekapPpnRange(req, res) {
    try {
        const startDate = validateDate(req.query.startDate, 'startDate');
        const endDate = validateDate(req.query.endDate, 'endDate');

        if (startDate > endDate) {
            throw new LaporanPpnError('Tanggal mulai (startDate) tidak boleh lebih besar dari tanggal akhir (endDate)!');
        }

        // Query ringkasan PPN teragregasi berdasarkan rentang tanggal
        const query = `
            SELECT 
                -- 1. PPN KELUARAN (Penjualan & Retur Jual)
                IFNULL(j.ppn_kotor, 0) AS ppn_keluaran_kotor,
                IFNULL(rj.ppn_retur, 0) AS retur_ppn_keluaran,
                (IFNULL(j.ppn_kotor, 0) - IFNULL(rj.ppn_retur, 0)) AS ppn_keluaran_bersih,

                -- 2. PPN MASUKAN (Pembelian & Retur Beli)
                IFNULL(p.ppn_kotor, 0) AS ppn_masukan_kotor,
                IFNULL(rb.ppn_retur, 0) AS retur_ppn_masukan,
                (IFNULL(p.ppn_kotor, 0) - IFNULL(rb.ppn_retur, 0)) AS ppn_masukan_bersih,

                -- 3. STATUS KEUANGAN PAJAK
                ((IFNULL(j.ppn_kotor, 0) - IFNULL(rj.ppn_retur, 0)) - 
                 (IFNULL(p.ppn_kotor, 0) - IFNULL(rb.ppn_retur, 0))) AS ppn_selisih
            FROM 
                (
                    SELECT SUM(IFNULL(ppn_nominal, 0)) AS ppn_kotor 
                    FROM penjualan_header 
                    WHERE DATE(tgl_faktur) BETWEEN ? AND ?
                ) j,
                (
                    SELECT SUM(IFNULL(ppn_nominal, 0)) AS ppn_retur 
                    FROM retur_header 
                    WHERE DATE(tanggal_retur) BETWEEN ? AND ?
                ) rj,
                (
                    SELECT SUM(IFNULL(ppn_nominal, 0)) AS ppn_kotor 
                    FROM pembelian_header 
                    WHERE DATE(tanggal_belanja) BETWEEN ? AND ?
                ) p,
                (
                    SELECT SUM(IFNULL(ppn_nominal, 0)) AS ppn_retur 
                    FROM retur_pembelian_header 
                    WHERE DATE(tanggal_retur) BETWEEN ? AND ?
                ) rb
        `;

        const queryParams = [
            startDate, endDate,
            startDate, endDate,
            startDate, endDate,
            startDate, endDate
        ];

        const [rows] = await db.query(query, queryParams);
        const data = rows[0] || {};

        const ppnKeluaranBersih = Number(data.ppn_keluaran_bersih) || 0;
        const ppnMasukanBersih = Number(data.ppn_masukan_bersih) || 0;
        const selisih = Number(data.ppn_selisih) || 0;

        return res.status(200).json({
            status: true,
            message: `Rekapitulasi PPN periode ${startDate} s/d ${endDate} berhasil dimuat.`,
            data: {
                startDate,
                endDate,
                ppn_keluaran: {
                    kotor: Number(data.ppn_keluaran_kotor) || 0,
                    retur: Number(data.retur_ppn_keluaran) || 0,
                    bersih: ppnKeluaranBersih
                },
                ppn_masukan: {
                    kotor: Number(data.ppn_masukan_kotor) || 0,
                    retur: Number(data.retur_ppn_masukan) || 0,
                    bersih: ppnMasukanBersih
                },
                ringkasan: {
                    selisih,
                    status_pajak: selisih > 0 ? 'KURANG_BAYAR' : selisih < 0 ? 'LEBIH_BAYAR' : 'NIHIL',
                    total_yang_harus_disetor: Math.max(0, selisih)
                }
            }
        });
    } catch (err) {
        if (err instanceof LaporanPpnError) {
            return res.status(err.status).json({ status: false, message: err.message });
        }
        console.error('[GetRekapPpnRange_Error]', err);
        return res.status(500).json({ status: false, message: 'Gagal mengambil rekapitulasi PPN' });
    }
}