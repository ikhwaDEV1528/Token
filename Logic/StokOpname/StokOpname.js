import { db } from "../../db.js";// Sesuaikan dengan koneksi db kamu



export async function SIMPAN_STOK_OPNAME(req, res) {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const { catatan, dibuat_oleh, items } = req.body;

        if (!items || !Array.isArray(items) || items.length === 0) {
            await connection.rollback();
            return res.status(400).json({ message: "Daftar barang opname tidak boleh kosong!" });
        }

        // Generate Nomor Transaksi Opname (Contoh: OP-20261015-8492)
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const random4Digit = Math.floor(1000 + Math.random() * 9000);
        const noOpname = `OP-${dateStr}-${random4Digit}`;

        // 1. Simpan ke stok_opname_header
        await connection.query(
            `INSERT INTO stok_opname_header (no_opname, tanggal, catatan, dibuat_oleh, created_at) 
             VALUES (?, NOW(), ?, ?, NOW())`,
            [noOpname, catatan || '', dibuat_oleh || 'ADMIN']
        );

        // 2. Loop setiap item opname
        for (const item of items) {
            const stokSistem = Number(item.stok_sistem_pcs) || 0;
            const stokFisik = item.stok_fisik_pcs === '' ? stokSistem : (Number(item.stok_fisik_pcs) || 0);
            const selisih = stokFisik - stokSistem;

            // A. Simpan ke stok_opname_detail
            await connection.query(
                `INSERT INTO stok_opname_detail 
                 (no_opname, kode_barang, stok_sistem_pcs, stok_fisik_pcs, selisih_pcs, keterangan)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [noOpname, item.kode_barang, stokSistem, stokFisik, selisih, item.keterangan || '']
            );

            // B. Update Langsung stok_pcs di tabel barang
            await connection.query(
                `UPDATE barang SET stok_pcs = ? WHERE kode_barang = ?`,
                [stokFisik, item.kode_barang]
            );

            // C. Masukkan log ke tabel stok_log sesuai struktur kolom milik kamu
            // C. Masukkan log ke tabel stok_log (KODE BARU FLEKSIBEL)
            await connection.query(
                `INSERT INTO stok_log (
        tanggal, 
        kode_barang, 
        stok_awal, 
        pembelian, 
        penjualan, 
        stok_akhir,
        jenis_transaksi,
        kondisi,
        jumlah,
        qty_perubahan,
        satuan_input,
        qty_input,
        referensi_tipe,
        referensi_no,
        keterangan,
        dibuat_oleh
    ) VALUES (NOW(), ?, ?, 0, 0, ?, 'STOK_OPNAME', 'BAGUS', ?, ?, 'PCS', ?, 'OPNAME', ?, ?, ?)`,
                [
                    item.kode_barang,
                    stokSistem,                             // stok_awal
                    stokFisik,                              // stok_akhir
                    Math.abs(selisih),                       // jumlah kejadian dalam PCS (selalu positif)
                    selisih,                                // qty_perubahan (+ jika fisik > sistem, - jika fisik < sistem, 0 jika cocok)
                    stokFisik,                              // qty_input sesuai stok fisik
                    noOpname,                               // referensi_no (nomor opname)
                    item.keterangan || `Stok Opname ${noOpname}`,
                    dibuat_oleh || 'ADMIN'
                ]
            );
        }

        await connection.commit();
        return res.status(200).json({
            message: "Stok Opname berhasil disimpan dan stok barang telah diperbarui!",
            no_opname: noOpname
        });

    } catch (err) {
        await connection.rollback();
        console.error("[SIMPAN_STOK_OPNAME_ERROR]", err);
        return res.status(500).json({ message: "Gagal menyimpan transaksi stok opname." });
    } finally {
        connection.release();
    }
}


