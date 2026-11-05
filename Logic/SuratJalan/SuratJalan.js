import { db } from "../../db.js";

class SuratJalanError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.name = 'SuratJalanError';
        this.status = status;
    }
}

function validateDate(dateStr, paramName) {
    if (!dateStr || typeof dateStr !== 'string') {
        throw new SuratJalanError(`Parameter "${paramName}" wajib diisi.`);
    }
    const clean = dateStr.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(clean) || isNaN(Date.parse(clean))) {
        throw new SuratJalanError(`Format "${paramName}" tidak valid. Gunakan YYYY-MM-DD.`);
    }
    return clean;
}

export async function GetSuratJalanGabungan(req, res) {
    try {
        const startDate = validateDate(req.query.startDate, 'startDate');
        const endDate = validateDate(req.query.endDate, 'endDate');

        if (startDate > endDate) {
            throw new SuratJalanError('Tanggal mulai tidak boleh melebihi tanggal selesai.');
        }

        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
        const offset = (page - 1) * limit;

        // 1. Total Unik Barang Pengiriman
        const countQuery = `
            SELECT COUNT(DISTINCT d.kode_barang) AS total_items
            FROM penjualan_header h
            INNER JOIN penjualan_detail d ON h.no_faktur = d.no_faktur
            WHERE DATE(h.tanggal_pengiriman) BETWEEN ? AND ?
        `;
        const [countRows] = await db.query(countQuery, [startDate, endDate]);
        const totalItems = countRows[0]?.total_items || 0;
        const totalPages = Math.ceil(totalItems / limit);

        // 2. Query Utama (Mengakumulasikan seluruh row detail berdasar kode_barang)
        const dataQuery = `
            SELECT 
                d.kode_barang,
                COALESCE(MAX(b.nama_barang), '-') AS nama_barang,
                -- Utamakan nama_satuan dari rasio > 1, jika tidak ada baru gunakan 'KARTON'
                COALESCE(
                    (
                        SELECT nama_satuan 
                        FROM barang_satuan 
                        WHERE kode_barang = d.kode_barang AND rasio_ke_pcs > 1 
                        ORDER BY rasio_ke_pcs DESC 
                        LIMIT 1
                    ),
                    'KARTON'
                ) AS nama_satuan_utama,
                -- Ambil rasio terbesar
                COALESCE(
                    (
                        SELECT rasio_ke_pcs 
                        FROM barang_satuan 
                        WHERE kode_barang = d.kode_barang 
                        ORDER BY rasio_ke_pcs DESC 
                        LIMIT 1
                    ),
                    1
                ) AS rasio_ke_pcs,
                -- Akumulasi total PCS gabungan (Beli + Bonus)
                SUM(
                    (
                        CAST(IFNULL(d.jumlah_keluar, 0) AS SIGNED) * 
                        COALESCE(
                            (
                                SELECT rasio_ke_pcs 
                                FROM barang_satuan 
                                WHERE kode_barang = d.kode_barang 
                                  AND LOWER(TRIM(nama_satuan)) = LOWER(TRIM(d.satuan)) 
                                LIMIT 1
                            ),
                            1
                        )
                    ) + 
                    (
                        CAST(IFNULL(d.qty_bonus, 0) AS SIGNED) * 
                        COALESCE(
                            (
                                SELECT rasio_ke_pcs 
                                FROM barang_satuan 
                                WHERE kode_barang = d.kode_barang 
                                  AND LOWER(TRIM(nama_satuan)) = LOWER(TRIM(d.satuan)) 
                                LIMIT 1
                            ),
                            1
                        )
                    )
                ) AS total_qty_pcs,
                GROUP_CONCAT(DISTINCT h.no_faktur ORDER BY h.no_faktur ASC SEPARATOR ', ') AS daftar_faktur,
                GROUP_CONCAT(DISTINCT h.kode_pelanggan ORDER BY h.kode_pelanggan ASC SEPARATOR ', ') AS daftar_pelanggan
            FROM penjualan_header h
            INNER JOIN penjualan_detail d ON h.no_faktur = d.no_faktur
            LEFT JOIN barang b ON d.kode_barang = b.kode_barang
            WHERE DATE(h.tanggal_pengiriman) BETWEEN ? AND ?
            GROUP BY d.kode_barang
            ORDER BY d.kode_barang ASC
            LIMIT ? OFFSET ?
        `;

        const [items] = await db.query(dataQuery, [startDate, endDate, limit, offset]);

        // 3. Logika Format Pengiriman (Multi-Satuan)
        const formattedData = items.map((item, index) => {
            const totalPcs = Number(item.total_qty_pcs) || 0;
            const rasio = Number(item.rasio_ke_pcs) > 0 ? Number(item.rasio_ke_pcs) : 1;

            const qtyUtama = Math.floor(totalPcs / rasio);
            const sisaPcs = totalPcs % rasio;

            let formatTeks = '';
            if (rasio > 1) {
                const partUtama = qtyUtama > 0 ? `${qtyUtama} ${item.nama_satuan_utama}` : '';
                const partSisa = sisaPcs > 0 ? `${sisaPcs} PCS` : '';
                formatTeks = [partUtama, partSisa].filter(Boolean).join(' ');
                if (!formatTeks) formatTeks = '0 PCS';
            } else {
                formatTeks = `${totalPcs} PCS`;
            }

            return {
                no: offset + index + 1,
                kode_barang: item.kode_barang,
                nama_barang: item.nama_barang,
                total_qty_pcs: totalPcs,
                rasio_ke_pcs: rasio,
                qty_utama: qtyUtama,
                satuan_utama: item.nama_satuan_utama,
                sisa_pcs: sisaPcs,
                format_pengiriman: formatTeks,
                daftar_faktur: item.daftar_faktur || '-',
                daftar_pelanggan: item.daftar_pelanggan || '-'
            };
        });

        return res.status(200).json({
            status: true,
            message: 'Data Surat Jalan Gabungan berhasil dimuat.',
            meta: {
                startDate,
                endDate,
                page,
                limit,
                totalItems,
                totalPages,
                hasMore: page < totalPages
            },
            data: formattedData
        });

    } catch (err) {
        if (err instanceof SuratJalanError) {
            return res.status(err.status).json({ status: false, message: err.message });
        }
        console.error('[GetSuratJalanGabungan_Error]', err);
        return res.status(500).json({ status: false, message: 'Gagal memproses data Surat Jalan.' });
    }
}