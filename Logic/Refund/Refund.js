import { db } from "../../db.js";

// =========================================================================
// 1. GET: Ambil Semua Kewajiban Refund (Edit Faktur + Retur Penjualan)
// Endpoint: GET /api/faktur/kewajiban-refund
// =========================================================================

// LOGIC INI BERADA DI ROUTE FAKTUR //
export async function getKewajibanRefund(req, res) {
    try {
        const query = `
            -- A. Kewajiban dari EDIT FAKTUR (Sisa Piutang Minus)
            SELECT 
                p.no_faktur AS no_referensi,
                p.no_faktur AS no_faktur_asal,
                'EDIT_FAKTUR' AS tipe_transaksi,
                p.tgl_faktur AS tanggal,
                p.kode_pelanggan,
                p.sales,
                p.total_harga,
                ABS(p.sisa_piutang) AS nominal_refund,
                'Kembalian Lebih Bayar Edit Faktur' AS keterangan
            FROM penjualan_header p
            WHERE p.sisa_piutang < 0

            UNION ALL

            -- B. Kewajiban dari RETUR PENJUALAN (metode REFUND & jumlah_refund_kas > 0)
            SELECT 
                r.no_retur AS no_referensi,
                r.no_faktur AS no_faktur_asal,
                'RETUR_BARANG' AS tipe_transaksi,
                r.tanggal_retur AS tanggal,
                p.kode_pelanggan,
                p.sales,
                r.total_nominal_retur AS total_harga,
                r.jumlah_refund_kas AS nominal_refund,
                CONCAT('Retur Barang: ', IFNULL(r.catatan, '-')) AS keterangan
            FROM retur_header r
            LEFT JOIN penjualan_header p ON r.no_faktur = p.no_faktur
            WHERE r.metode_penyelesaian = 'REFUND' 
              AND r.jumlah_refund_kas > 0

            ORDER BY tanggal DESC
        `;

        const [rows] = await db.query(query);

        return res.status(200).json({
            success: true,
            data: rows
        });
    } catch (err) {
        console.error('Error Fetch Kewajiban Refund:', err);
        return res.status(500).json({ success: false, message: 'Gagal mengambil data kewajiban refund' });
    }
}

// =========================================================================
// 2. POST: Eksekusi Penyerahan Uang Refund Tunai
// Endpoint: POST /api/faktur/selesaikan-refund
// Body: { "no_referensi": "...", "tipe_transaksi": "EDIT_FAKTUR" | "RETUR_BARANG" }
// =========================================================================
export async function selesaikanRefund(req, res) {
    const { no_referensi, tipe_transaksi } = req.body;

    if (!no_referensi || !tipe_transaksi) {
        return res.status(400).json({ success: false, message: 'Parameter tidak lengkap!' });
    }

    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        if (tipe_transaksi === 'EDIT_FAKTUR') {
            // Update pembayaran = total_harga agar sisa_piutang jadi 0 & status LUNAS
            await connection.query(
                `UPDATE penjualan_header 
                 SET 
                   pembayaran = total_harga,
                   sisa_piutang = 0,
                   status = 'LUNAS',
                   keterangan = CONCAT(IFNULL(keterangan, ''), ' | Uang kembalian edit faktur telah diserahkan.')
                 WHERE no_faktur = ?`,
                [no_referensi]
            );
        } else if (tipe_transaksi === 'RETUR_BARANG') {
            // Nol-kan jumlah_refund_kas menandakan uang tunai refund retur sudah diserahkan
            await connection.query(
                `UPDATE retur_header 
                 SET 
                   jumlah_refund_kas = 0,
                   catatan = CONCAT(IFNULL(catatan, ''), ' | Refund kas sebesar nominal telah dibayarkan.')
                 WHERE no_retur = ?`,
                [no_referensi]
            );
        }

        await connection.commit();

        return res.status(200).json({
            success: true,
            message: `Uang refund untuk transaksi ${no_referensi} berhasil diserahkan!`
        });

    } catch (err) {
        await connection.rollback();
        console.error('Error Selesaikan Refund:', err);
        return res.status(500).json({ success: false, message: 'Gagal memproses refund' });
    } finally {
        connection.release();
    }
}



