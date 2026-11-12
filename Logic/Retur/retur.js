import { db } from "../../db.js";   // <- sesuaikan path ini kalau beda

// ===== HELPER RUMUS NETTO (dipakai 3 endpoint di bawah) =====
/**
 * Helper bersama untuk modul retur. SATU-SATUNYA tempat rumus netto baris,
 * dipakai oleh CariNoFaktur, CariBarangFakturLain, dan ProsesRetur supaya
 * angka di layar SELALU sama dengan angka yang tersimpan.
 *
 * netto baris = (harga_jual x qty) - diskon item - porsi diskon global faktur
 * porsi diskon global = round(diskon_global x setelahDiskonItem / totalFakturSetelahDiskonItem)
 *
 * Contoh: 1 pack @12.000, diskon item 1.000, diskon global 1.000 -> netto 10.000
 */
function hitungNettoBaris({ hargaJual, qty, diskonItem, diskonFaktur, totalSetelahDiskonItem }) {
    const bruto = (Number(hargaJual) || 0) * (Number(qty) || 0);
    const setelahDiskonItem = Math.max(0, bruto - (Number(diskonItem) || 0));

    let porsiDiskonFaktur = 0;
    if (diskonFaktur > 0 && totalSetelahDiskonItem > 0) {
        porsiDiskonFaktur = Math.round((diskonFaktur * setelahDiskonItem) / totalSetelahDiskonItem);
    }
    return {
        setelahDiskonItem,
        porsiDiskonFaktur,
        netto: Math.max(0, setelahDiskonItem - porsiDiskonFaktur)
    };
}

// ===== ENDPOINT 1: CARI FAKTUR =====
/**
 * ============================================================================
 * ENDPOINT: GET /api-be/SERVER_RETUR/CARI_FAKTUR
 * ============================================================================
 * Mengembalikan faktur + item beserta NETTO BARIS (setelah diskon item dan
 * porsi diskon global) memakai rumus yang sama dengan ProsesRetur, sehingga
 * FE tidak perlu menghitung diskon sendiri.
 *
 * Field penting untuk FE: netto_baris, sudah_retur_nominal,
 * total_sudah_retur_pcs, sisa_retur_pcs, harga_jual (bersih per satuan beli).
 * ============================================================================
 */
export async function CariNoFaktur(req, res) {
    const input = req.query.input_no_faktur;

    if (!input || typeof input !== 'string' || input.trim() === '') {
        return res.status(400).json({ status: false, message: "No faktur wajib diisi!" });
    }

    try {
        const [rows] = await db.query(
            `SELECT
                p.no_faktur,
                p.tgl_faktur,
                p.sales AS nama_sales,
                IFNULL(p.diskon_global, 0) AS diskon_global_faktur,
                pl.nama_pelanggan,
                pd.id_detail,
                pd.kode_barang,
                b.nama_barang,
                pd.satuan AS satuan_beli,
                GREATEST(IFNULL(pd.jumlah_keluar, 0), IFNULL(pd.qty_bonus, 0)) AS qty_beli,
                IFNULL(pd.qty_bonus, 0) AS qty_bonus, -- TAMBAHAN 1: Ambil kolom qty_bonus
                pd.harga_jual AS harga_jual_transaksi,
                IFNULL(pd.diskon, 0) AS diskon_item,
                pd.total_harga,
                IFNULL(bs_beli.rasio_ke_pcs, 1) AS rasio_beli_pcs,

                IFNULL((
                    SELECT SUM(GREATEST(d2.harga_jual * d2.jumlah_keluar - IFNULL(d2.diskon, 0), 0))
                      FROM penjualan_detail d2
                     WHERE d2.no_faktur = p.no_faktur
                ), 0) AS total_setelah_diskon_item,

                IFNULL((
                    SELECT SUM(rd.qty_total_pcs)
                      FROM retur_detail rd
                     WHERE rd.id_detail_penjualan = pd.id_detail
                ), 0) AS total_sudah_retur_pcs,

                IFNULL((
                    SELECT SUM(rd.subtotal_retur)
                      FROM retur_detail rd
                     WHERE rd.id_detail_penjualan = pd.id_detail
                ), 0) AS sudah_retur_nominal,

                (
                    SELECT JSON_ARRAYAGG(
                        JSON_OBJECT(
                            'nama_satuan', bs.nama_satuan,
                            'rasio_ke_pcs', bs.rasio_ke_pcs,
                            'harga_jual', bs.harga_jual,
                            'level', bs.level
                        )
                    )
                    FROM barang_satuan bs
                    WHERE bs.kode_barang = pd.kode_barang
                ) AS satuans_json

            FROM penjualan_header p
            LEFT JOIN pelanggan pl ON p.kode_pelanggan = pl.kode_pelanggan
            JOIN penjualan_detail pd ON p.no_faktur = pd.no_faktur
            JOIN barang b ON pd.kode_barang = b.kode_barang
            LEFT JOIN barang_satuan bs_beli
                   ON pd.kode_barang = bs_beli.kode_barang
                  AND pd.satuan = bs_beli.nama_satuan
            WHERE p.no_faktur = ?
            ORDER BY pd.id_detail`,
            [input.trim()]
        );

        if (rows.length === 0) {
            return res.status(404).json({ status: false, message: "No Faktur tidak ditemukan!" });
        }

        const itemsFormatted = rows.map(row => {
            let listSatuans = [];
            try {
                listSatuans = typeof row.satuans_json === 'string'
                    ? JSON.parse(row.satuans_json)
                    : (row.satuans_json || []);
            } catch (e) {
                listSatuans = [];
            }

            // listSatuans = listSatuans.filter(s => s && s.nama_satuan); // KOMENT SEMENTARA

            // TESTING //

            listSatuans = listSatuans.filter(s => s && s.nama_satuan);

            // Barang tanpa satuan PCS: tampilkan PCS virtual
            if (listSatuans.length > 0 && !listSatuans.some(s => Number(s.rasio_ke_pcs) === 1)) {
                const besar = listSatuans.reduce((a, b) => Number(b.rasio_ke_pcs) > Number(a.rasio_ke_pcs) ? b : a);
                if (Number(besar.rasio_ke_pcs) > 0) {
                    listSatuans.push({
                        nama_satuan: 'PCS', rasio_ke_pcs: 1, level: 1,
                        harga_jual: Number(besar.harga_jual) / Number(besar.rasio_ke_pcs)
                    });
                }
            }

            const rasioBeliPcs = Number(row.rasio_beli_pcs) || 1;
            const qtyBeli = Number(row.qty_beli) || 0;
            const totalBeliInPcs = qtyBeli * rasioBeliPcs;
            const sudahReturInPcs = Number(row.total_sudah_retur_pcs) || 0;
            const sisaReturInPcs = Math.max(0, totalBeliInPcs - sudahReturInPcs);

            const { porsiDiskonFaktur, netto } = hitungNettoBaris({
                hargaJual: row.harga_jual_transaksi,
                qty: qtyBeli,
                diskonItem: row.diskon_item,
                diskonFaktur: Number(row.diskon_global_faktur) || 0,
                totalSetelahDiskonItem: Number(row.total_setelah_diskon_item) || 0
            });

            // Item dianggap bonus jika harga transaksi Rp 0 ATAU qty_bonus > 0
            const isBonusItem = Number(row.harga_jual_transaksi) === 0 || Number(row.qty_bonus) > 0;

            return {
                id_detail: row.id_detail,
                kode_barang: row.kode_barang,
                nama_barang: row.nama_barang,
                is_bonus: isBonusItem, // TAMBAHAN 2: Flag boolean penanda bonus
                satuan_beli: row.satuan_beli,
                rasio_beli_pcs: rasioBeliPcs,
                qty_beli: qtyBeli,
                harga_jual_kotor: Number(row.harga_jual_transaksi),
                diskon_item: Number(row.diskon_item),
                porsi_diskon_global: porsiDiskonFaktur,
                netto_baris: netto,
                harga_jual: qtyBeli > 0 ? Math.round(netto / qtyBeli) : Number(row.harga_jual_transaksi),
                total_harga: Number(row.total_harga),

                total_sudah_retur_pcs: sudahReturInPcs,
                sudah_retur_nominal: Number(row.sudah_retur_nominal) || 0,
                sisa_retur_pcs: sisaReturInPcs,
                sisa_qty_retur_satuan_beli: Math.floor(sisaReturInPcs / rasioBeliPcs),
                is_fully_returned: sisaReturInPcs <= 0,

                satuans: listSatuans
            };
        });

        return res.status(200).json({
            status: true,
            faktur: {
                no_faktur: rows[0].no_faktur,
                tgl_faktur: rows[0].tgl_faktur,
                nama_pelanggan: rows[0].nama_pelanggan || '-',
                nama_sales: rows[0].nama_sales || '-',
                items: itemsFormatted
            }
        });

    } catch (error) {
        console.error("[CariNoFaktur] Error:", error);
        return res.status(500).json({
            status: false,
            message: "Terjadi kesalahan server saat mencari faktur"
        });
    }
}


// ===== ENDPOINT 1B: CARI DAFTAR FAKTUR (no faktur / nama pelanggan / kode pelanggan / sales) =====
// HANYA pencarian daftar. Tidak menghitung apa pun, tidak mengubah data.
// Setelah user pilih, FE tetap memanggil CARI_FAKTUR seperti biasa.
export async function CariDaftarFaktur(req, res) {
    const keyword = String(req.query.input ?? '').trim().slice(0, MAX_KEYWORD_LEN);
    if (!keyword) return res.status(200).json({ status: true, list: [] });

    try {
        const terms = keyword.split(/\s+/).filter(Boolean).slice(0, 5);

        const where = terms.map(
            () => `(ph.no_faktur LIKE ? OR pl.nama_pelanggan LIKE ? OR ph.kode_pelanggan LIKE ? OR ph.sales LIKE ?)`
        );
        const params = terms.flatMap(t => {
            const like = `%${escapeLike(t)}%`;
            return [like, like, like, like];
        });

        const [rows] = await db.query(
            `SELECT ph.no_faktur,
                    ph.tgl_faktur,
                    ph.sales AS nama_sales,
                    COALESCE(pl.nama_pelanggan, ph.kode_pelanggan) AS nama_pelanggan,
                    IFNULL(ph.sisa_piutang, 0) AS sisa_piutang,
                    (
                        SELECT COUNT(*)
                          FROM penjualan_detail pd
                          LEFT JOIN barang_satuan bs
                                 ON bs.kode_barang = pd.kode_barang
                                AND bs.nama_satuan = pd.satuan
                         WHERE pd.no_faktur = ph.no_faktur
                           AND pd.harga_jual > 0
                           AND IFNULL(pd.qty_bonus, 0) = 0
                           AND pd.jumlah_keluar * IFNULL(bs.rasio_ke_pcs, 1) >
                               IFNULL((SELECT SUM(rd.qty_total_pcs)
                                         FROM retur_detail rd
                                        WHERE rd.id_detail_penjualan = pd.id_detail), 0)
                    ) AS jumlah_item_bisa_retur
               FROM penjualan_header ph
               LEFT JOIN pelanggan pl ON ph.kode_pelanggan = pl.kode_pelanggan
              WHERE ${where.join(' AND ')}
              ORDER BY ph.tgl_faktur DESC, ph.no_faktur DESC
              LIMIT ${MAX_RESULT}`,
            params
        );

        return res.status(200).json({
            status: true,
            list: rows.map(r => ({
                no_faktur: r.no_faktur,
                tgl_faktur: r.tgl_faktur,
                nama_pelanggan: r.nama_pelanggan || '-',
                nama_sales: r.nama_sales || '-',
                sisa_piutang: Number(r.sisa_piutang) || 0,
                bisa_diretur: Number(r.jumlah_item_bisa_retur) > 0
            }))
        });
    } catch (err) {
        console.error('[CariDaftarFaktur] Error:', err);
        return res.status(500).json({ status: false, message: 'Gagal mencari faktur. Silakan coba lagi.' });
    }
}









// ===== ENDPOINT 2: CARI BARANG FAKTUR LAIN =====
/**
 * ============================================================================
 * ENDPOINT: GET /api-be/SERVER_RETUR/CARI_BARANG_FAKTUR_LAIN
 * ============================================================================
 * Mencari barang dari FAKTUR ASAL (faktur lain) untuk diretur di faktur tujuan.
 *
 * AKAR MASALAH VERSI LAMA (harga tidak 10k):
 *   Porsi diskon global dihitung dengan membagi ke `ph.total_harga`. Kalau
 *   kolom itu sudah/ belum terpotong diskon, pembaginya salah -> porsi diskon
 *   salah -> harga bersih bukan 10.000. Sekarang pembagi dihitung dari
 *   penjumlahan baris detail faktur asal (SUM(bruto - diskon item)), RUMUS
 *   SAMA PERSIS dengan ProsesRetur.js, sehingga angka di layar = angka tersimpan.
 *
 * Contoh: 1 pack @12.000, diskon item 1.000, diskon global 1.000
 *   setelah diskon item = 11.000, total faktur = 11.000
 *   porsi diskon global = round(1.000 * 11.000 / 11.000) = 1.000
 *   netto baris = 10.000  -> harga_bersih = 10.000
 *
 * Field tambahan untuk FE (dipakai preview retur kumulatif):
 *   netto_baris, harga_bersih, rasio_beli, total_beli_pcs,
 *   sudah_retur_pcs, sudah_retur_nominal, sisa_retur_pcs
 *
 * ASUMSI SKEMA: penjualan_header.diskon_global, .sales, .kode_pelanggan;
 *               penjualan_detail.no_faktur; retur_detail.subtotal_retur.
 * ============================================================================
 */


// Hanya tampilkan barang dari faktur milik pelanggan yang sama dengan faktur tujuan.
// Set false kalau lu mau bebas lintas pelanggan seperti versi lama.
// true = hanya tampilkan barang dari faktur pelanggan yang sama dengan faktur tujuan
const BATASI_PELANGGAN_SAMA = true // gw ubah jadi false
const MAX_RESULT = 20;
const MAX_KEYWORD_LEN = 100;

const escapeLike = (s) => s.replace(/[\\%_]/g, '\\$&');


export async function CARI_BARANG_FAKTUR_LAIN(req, res) {
    const keyword = String(req.query.input ?? '').trim().slice(0, MAX_KEYWORD_LEN);
    const noFakturSekarang = String(req.query.no_faktur_sekarang ?? '').trim();

    if (!keyword) return res.status(200).json({ Search: [] });

    try {
        // Tiap kata boleh cocok ke: nama barang / kode barang / no faktur / nama sales /
        // nama pelanggan / kode pelanggan.
        // Contoh: "ale-ale budi" atau "ale PLG001".
        const terms = keyword.split(/\s+/).filter(Boolean).slice(0, 5);

        const where = terms.map(
            () => `(pd.no_faktur LIKE ? OR b.nama_barang LIKE ? OR pd.kode_barang LIKE ? OR ph.sales LIKE ?
            OR p.nama_pelanggan LIKE ? OR ph.kode_pelanggan LIKE ?)`
        );
        const params = terms.flatMap(t => {
            const like = `%${escapeLike(t)}%`;
            return [like, like, like, like, like, like]; // 4 -> 6
        });

        if (noFakturSekarang) {
            where.push(`pd.no_faktur <> ?`);
            params.push(noFakturSekarang);

            if (BATASI_PELANGGAN_SAMA) {
                const [cur] = await db.query(
                    `SELECT kode_pelanggan FROM penjualan_header WHERE no_faktur = ? LIMIT 1`,
                    [noFakturSekarang]
                );
                if (cur.length === 0) return res.status(200).json({ Search: [] });
                where.push(`ph.kode_pelanggan = ?`);
                params.push(cur[0].kode_pelanggan);
            }
        }

        const [rows] = await db.query(
            `SELECT pd.id_detail AS id_detail_penjualan,
                    pd.no_faktur AS no_faktur_asal,
                    ph.sales AS sales_asal,
                    COALESCE(p.nama_pelanggan, ph.kode_pelanggan) AS nama_pelanggan,
                    pd.kode_barang,
                    b.nama_barang,
                    pd.satuan AS satuan_beli,
                    pd.jumlah_keluar AS qty_beli,
                    pd.harga_jual,
                    IFNULL(pd.diskon, 0) AS diskon_item,
                    IFNULL(ph.diskon_global, 0) AS diskon_global_faktur
               FROM penjualan_detail pd
              INNER JOIN penjualan_header ph ON pd.no_faktur = ph.no_faktur
              INNER JOIN barang b ON pd.kode_barang = b.kode_barang
               LEFT JOIN pelanggan p ON ph.kode_pelanggan = p.kode_pelanggan
              WHERE ${where.join(' AND ')}
              ORDER BY pd.id_detail DESC
              LIMIT ${MAX_RESULT}`,
            params
        );

        if (rows.length === 0) {
            // Cek apakah kosong karena barang/faktur itu milik pelanggan lain
            if (noFakturSekarang && BATASI_PELANGGAN_SAMA) {
                try {
                    const [cekPelanggan] = await db.query(
                        `SELECT COUNT(*) AS jml
                           FROM penjualan_detail pd
                          INNER JOIN penjualan_header ph ON pd.no_faktur = ph.no_faktur
                          INNER JOIN barang b ON pd.kode_barang = b.kode_barang
                           LEFT JOIN pelanggan p ON ph.kode_pelanggan = p.kode_pelanggan
                          WHERE ${where.filter(w => !w.includes('ph.kode_pelanggan = ?')).join(' AND ')}`,
                        params.slice(0, params.length - 1)
                    );
                    if (Number(cekPelanggan[0]?.jml) > 0) {
                        return res.status(200).json({
                            Search: [],
                            pesan:
                                'SERVER SAY: Faktur/barang ini milik pelanggan yang berbeda.\n\n' +
                                'Retur silang hanya dapat dilakukan antar faktur milik pelanggan yang sama, dengan alasan berikut:\n' +
                                '1. Retur silang akan memotong piutang pada faktur tujuan. Apabila pelanggannya berbeda, piutang pelanggan lain akan berkurang tanpa ada transaksi retur dari pihaknya.\n' +
                                '2. Pelanggan yang piutangnya terpotong memperoleh keuntungan padahal tidak melakukan retur, sedangkan pelanggan yang benar-benar melakukan retur tidak mendapatkan haknya.\n' +
                                '3. Catatan piutang dan laporan keuangan menjadi tidak akurat dan sulit ditelusuri.\n\n' +
                                'Silakan cari faktur milik pelanggan yang sama dengan faktur yang sedang dibuka.'
                        });
                    }
                } catch (e) {
                    console.error('[CARI_BARANG_FAKTUR_LAIN] cek pelanggan gagal:', e);
                    return res.status(500).json({
                        message: "Gagal memeriksa data pelanggan. Silakan coba lagi."
                    })
                }
            }
            return res.status(200).json({ Search: [] });
        }

        const fakturList = [...new Set(rows.map(r => r.no_faktur_asal))];


        const detailIds = rows.map(r => r.id_detail_penjualan);
        const kodeList = [...new Set(rows.map(r => r.kode_barang))];

        // 3 query batch paralel (bukan subquery per baris)
        const [[totalRows], [returRows], [satuanRows]] = await Promise.all([
            db.query(
                `SELECT no_faktur,
                        SUM(GREATEST(harga_jual * jumlah_keluar - IFNULL(diskon, 0), 0)) AS total_setelah_diskon_item
                   FROM penjualan_detail
                  WHERE no_faktur IN (?)
                  GROUP BY no_faktur`,
                [fakturList]
            ),
            db.query(
                `SELECT id_detail_penjualan AS id,
                        SUM(qty_total_pcs) AS pcs, SUM(subtotal_retur) AS nominal
                   FROM retur_detail
                  WHERE id_detail_penjualan IN (?)
                  GROUP BY id_detail_penjualan`,
                [detailIds]
            ),
            db.query(
                `SELECT id AS id_satuan, kode_barang, nama_satuan, harga_jual, rasio_ke_pcs, level
                   FROM barang_satuan
                  WHERE kode_barang IN (?)`,
                [kodeList]
            )
        ]);

        const totalMap = new Map(totalRows.map(r => [r.no_faktur, Number(r.total_setelah_diskon_item) || 0]));
        const returMap = new Map(returRows.map(r => [Number(r.id), {
            pcs: Number(r.pcs) || 0,
            nominal: Number(r.nominal) || 0
        }]));
        const satuanMap = new Map();
        for (const s of satuanRows) {
            if (!satuanMap.has(s.kode_barang)) satuanMap.set(s.kode_barang, []);
            satuanMap.get(s.kode_barang).push({
                id_satuan: s.id_satuan,
                nama_satuan: s.nama_satuan,
                harga_jual: Number(s.harga_jual) || 0,
                rasio_ke_pcs: Number(s.rasio_ke_pcs) || 1,
                level: Number(s.level) || 0
            });
        }

        const result = rows.map((r) => {
            const qty = Number(r.qty_beli) || 0;
            const hargaJual = Number(r.harga_jual) || 0;
            const diskonItem = Number(r.diskon_item) || 0;
            const diskonFaktur = Number(r.diskon_global_faktur) || 0;

            const { porsiDiskonFaktur, netto } = hitungNettoBaris({
                hargaJual, qty, diskonItem, diskonFaktur,
                totalSetelahDiskonItem: totalMap.get(r.no_faktur_asal) || 0
            });

            // const listSatuan = (satuanMap.get(r.kode_barang) || []).sort((a, b) => b.level - a.level);

            const listSatuan = (satuanMap.get(r.kode_barang) || []).sort((a, b) => b.level - a.level);

            // Barang tanpa satuan PCS: tampilkan PCS virtual
            if (listSatuan.length > 0 && !listSatuan.some(s => s.rasio_ke_pcs === 1)) {
                const besar = listSatuan.reduce((a, b) => b.rasio_ke_pcs > a.rasio_ke_pcs ? b : a);
                if (besar.rasio_ke_pcs > 0) {
                    listSatuan.push({
                        id_satuan: null, nama_satuan: 'PCS', rasio_ke_pcs: 1, level: 1,
                        harga_jual: besar.harga_jual / besar.rasio_ke_pcs
                    });
                }
            }

            const satuanBeli = listSatuan.find(s => s.nama_satuan === r.satuan_beli);
            const rasioBeli = satuanBeli ? satuanBeli.rasio_ke_pcs : null;
            const totalBeliPcs = rasioBeli ? qty * rasioBeli : 0;

            const retur = returMap.get(Number(r.id_detail_penjualan)) || { pcs: 0, nominal: 0 };
            const sisaPcs = Math.max(0, totalBeliPcs - retur.pcs);

            return {
                id_detail_penjualan: r.id_detail_penjualan,
                no_faktur_asal: r.no_faktur_asal,
                sales_asal: r.sales_asal,
                nama_pelanggan: r.nama_pelanggan,
                kode_barang: r.kode_barang,
                nama_barang: r.nama_barang,
                satuan_beli: r.satuan_beli,
                qty_beli: qty,
                harga_jual: hargaJual,
                diskon_item: diskonItem,
                diskon_global_faktur: diskonFaktur,
                porsi_diskon_global: porsiDiskonFaktur,
                netto_baris: netto,
                harga_bersih: qty > 0 ? Math.round(netto / qty) : 0,
                rasio_beli: rasioBeli,
                total_beli_pcs: totalBeliPcs,
                sudah_retur_pcs: retur.pcs,
                sudah_retur_nominal: retur.nominal,
                sisa_retur_pcs: sisaPcs,
                data_satuan_valid: !!satuanBeli,
                list_satuan: listSatuan
            };
        });
        console.log('sukses')
        return res.status(200).json({ Search: result });
    } catch (err) {
        console.error('[CARI_BARANG_FAKTUR_LAIN] Error:', err);
        return res.status(500).json({ message: 'Gagal mencari barang. Silakan coba lagi.' });
    }
}















// ===== ENDPOINT 3: PROSES RETUR =====
/**
 * ============================================================================
 * ENDPOINT: POST /api-be/SERVER_RETUR/PROSES_RETUR   (ProsesRetur v2)
 * ============================================================================
 *
 * ASUMSI SKEMA (WAJIB dicek, sesuaikan di bagian SQL kalau nama kolom beda):
 *   - penjualan_detail.no_faktur          -> faktur asal dari baris detail
 *   - penjualan_header.diskon_global      -> diskon global faktur (nominal Rp)
 *   - retur_detail.subtotal_retur         -> nominal retur yang sudah tercatat
 *   - barang_satuan.harga_jual (opsional) -> dipakai HANYA untuk retur manual
 *
 * PRINSIP UTAMA PERBAIKAN
 *   1. SEMUA nominal uang dihitung di server. subtotal_retur / harga_jual dari
 *      FE DIABAIKAN (tidak bisa dimanipulasi lewat Postman/devtools).
 *   2. Nilai retur = porsi dari NETTO baris (setelah diskon item + porsi
 *      diskon faktur), dihitung KUMULATIF:
 *          nilai = round(netto * (pcsSudahRetur + pcsRetur) / totalPcsBeli)
 *                  - nominalSudahRetur
 *      Hasilnya: tidak ada selisih 1 rupiah, retur terakhir otomatis ambil
 *      sisa (contoh 6.751 / 3 -> 2.250, 2.250, 2.251).
 *   3. Isolation READ COMMITTED + row lock detail, supaya angka "sudah
 *      diretur" selalu membaca data terbaru (bukan snapshot lama).
 *   4. Query di-batch (tidak lagi N+1 per item), lock selalu berurutan
 *      (ORDER BY) untuk mencegah deadlock.
 *   5. Potong piutang atomik: UPDATE ... WHERE sisa_piutang >= ? dan cek
 *      affectedRows.
 *
 * ATURAN BISNIS (tidak diubah):
 *   - no_faktur = faktur TUJUAN (faktur 2). id_detail boleh dari faktur asal
 *     (retur silang) -> hanya dipakai sebagai referensi barang/harga/sisa.
 *   - POTONG_PIUTANG: total retur harus <= sisa_piutang faktur tujuan.
 *   - BAGUS masuk stok, RUSAK tidak menyentuh stok.
 *   - TUKAR_BARANG: logika stok tetap dipertahankan (saat ini FE nonaktif).
 * ============================================================================
 */


const MAX_ITEMS_PER_REQUEST = 100;
const MAX_LEN_NO_FAKTUR = 100;
const MAX_LEN_CATATAN = 500;
const MAX_LEN_ALASAN = 255;
const MAX_QTY_RETUR = 1_000_000;
const METODE_VALID = ['REFUND', 'POTONG_PIUTANG', 'TUKAR_BARANG'];
const KONDISI_VALID = ['BAGUS', 'RUSAK'];

class ValidationError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.name = 'ValidationError';
        this.status = status;
    }
}

// ----------------------------------------------------------------------------
// WAKTU WIB (UTC+7, tanpa DST) — independen dari timezone server Node/MySQL
// ----------------------------------------------------------------------------
function getWaktuWIBParts() {
    const w = new Date(Date.now() + 7 * 60 * 60 * 1000);
    const p = (n) => String(n).padStart(2, '0');
    return {
        yyyymmdd: `${w.getUTCFullYear()}${p(w.getUTCMonth() + 1)}${p(w.getUTCDate())}`,
        sql: `${w.getUTCFullYear()}-${p(w.getUTCMonth() + 1)}-${p(w.getUTCDate())} ` +
            `${p(w.getUTCHours())}:${p(w.getUTCMinutes())}:${p(w.getUTCSeconds())}`
    };
}

const rupiah = (n) => Number(n).toLocaleString('id-ID');
const toInt = (v) => {
    const s = String(v ?? '').trim();
    return /^\d+$/.test(s) ? Number(s) : NaN;
};

// ----------------------------------------------------------------------------
// VALIDASI & NORMALISASI PAYLOAD (murni, tanpa DB)
// ----------------------------------------------------------------------------
function parsePayload(body) {
    const { no_faktur, no_faktur_lain, items, catatan, metode_penyelesaian } = body || {};

    if (typeof no_faktur !== 'string' || no_faktur.trim() === '') {
        throw new ValidationError('Nomor faktur tidak valid!');
    }
    const noFaktur = no_faktur.trim();
    if (noFaktur.length > MAX_LEN_NO_FAKTUR) throw new ValidationError('Nomor faktur terlalu panjang!');

    if (!Array.isArray(items) || items.length === 0) {
        throw new ValidationError('Minimal pilih 1 barang untuk diretur!');
    }
    if (items.length > MAX_ITEMS_PER_REQUEST) {
        throw new ValidationError(
            `Jumlah barang yang diretur melebihi batas (maks ${MAX_ITEMS_PER_REQUEST} item). Silakan pecah menjadi beberapa retur.`
        );
    }

    if (catatan !== undefined && catatan !== null && String(catatan).length > MAX_LEN_CATATAN) {
        throw new ValidationError(`Catatan retur maksimal ${MAX_LEN_CATATAN} karakter!`);
    }

    let metode = 'REFUND';
    if (metode_penyelesaian !== undefined && metode_penyelesaian !== null && metode_penyelesaian !== '') {
        if (!METODE_VALID.includes(metode_penyelesaian)) {
            throw new ValidationError(
                `Metode penyelesaian "${metode_penyelesaian}" tidak dikenali! Pilihan valid: ${METODE_VALID.join(', ')}.`
            );
        }
        metode = metode_penyelesaian;
    }

    const seen = new Set();
    const normalized = items.map((it, i) => {
        if (!it || typeof it !== 'object' || Array.isArray(it)) {
            throw new ValidationError(`Data item retur ke-${i + 1} tidak valid!`);
        }
        const isManual = !!it.is_manual;
        const kodeBarang = String(it.kode_barang ?? '').trim();
        const satuan = String(it.satuan_retur ?? '').trim();
        const kondisi = String(it.kondisi ?? 'BAGUS').trim().toUpperCase();
        const alasan = String(it.alasan ?? '').trim();
        const qty = toInt(it.qty_retur);
        const idDetail = isManual ? null : toInt(it.id_detail);

        if (!Number.isSafeInteger(qty) || qty <= 0 || qty > MAX_QTY_RETUR) {
            throw new ValidationError(`Jumlah retur item ke-${i + 1} tidak valid (harus bilangan bulat 1 - ${MAX_QTY_RETUR})!`);
        }
        if (!satuan) throw new ValidationError(`Satuan retur item ke-${i + 1} wajib diisi!`);
        if (!KONDISI_VALID.includes(kondisi)) throw new ValidationError('Kondisi barang hanya BAGUS atau RUSAK!');
        if (alasan.length > MAX_LEN_ALASAN) throw new ValidationError(`Alasan retur maksimal ${MAX_LEN_ALASAN} karakter!`);
        if (isManual) {
            if (!kodeBarang) throw new ValidationError(`Kode barang manual item ke-${i + 1} tidak valid!`);
        } else if (!Number.isSafeInteger(idDetail) || idDetail <= 0) {
            throw new ValidationError(`ID Detail transaksi item ke-${i + 1} tidak valid!`);
        }

        // Duplikat = detail/barang yang sama DENGAN satuan & kondisi yang sama
        const key = isManual
            ? `M|${kodeBarang}|${satuan.toUpperCase()}|${kondisi}`
            : `D|${idDetail}|${satuan.toUpperCase()}|${kondisi}`;
        if (seen.has(key)) {
            throw new ValidationError(
                `Terdeteksi barang ganda pada daftar retur: [${kodeBarang || 'ID ' + idDetail}] satuan (${satuan}). Gabungkan Qty-nya jadi 1 baris!`
            );
        }
        seen.add(key);

        return { isManual, kodeBarang, satuan, kondisi, alasan, qty, idDetail };
    });

    // Urutan lock konsisten (anti-deadlock): detail dulu berdasarkan id, manual setelahnya
    normalized.sort((a, b) => (a.idDetail ?? Infinity) - (b.idDetail ?? Infinity)
        || a.kodeBarang.localeCompare(b.kodeBarang));

    return {
        noFaktur,
        no_faktur_lain: typeof no_faktur_lain === 'string' ? no_faktur_lain.trim().slice(0, MAX_LEN_NO_FAKTUR) : null,
        metode,
        catatan: catatan ? String(catatan).trim() : null,
        items: normalized
    };
}

// ----------------------------------------------------------------------------
// GENERATE NO RETUR (atomic, 1 query)
//   CREATE TABLE retur_sequence (tanggal VARCHAR(8) PRIMARY KEY, last_seq INT NOT NULL DEFAULT 0);
// ----------------------------------------------------------------------------
async function generateNoRetur(conn, yyyymmdd) {
    const [r] = await conn.query(
        `INSERT INTO retur_sequence (tanggal, last_seq) VALUES (?, 1)
         ON DUPLICATE KEY UPDATE last_seq = LAST_INSERT_ID(last_seq + 1)`,
        [yyyymmdd]
    );
    let seq;
    if (r.affectedRows === 1) seq = 1;            // insert baru
    else if (r.affectedRows === 2) seq = r.insertId; // update
    else throw new Error(`Gagal generate nomor retur: affectedRows tidak terduga (${r.affectedRows})`);
    return `RTR-${yyyymmdd}-${String(seq).padStart(4, '0')}`;
}

// ----------------------------------------------------------------------------
// HANDLER
// ----------------------------------------------------------------------------
// ----------------------------------------------------------------------------
// HANDLER  (ganti fungsi ProsesRetur yang lama dengan ini; helper lain tidak berubah)
//
// Perubahan dibanding versi lama:
//   1. stok_log dicatat PER KEJADIAN (per item), termasuk barang RUSAK (qty_perubahan = 0).
//   2. Barang RUSAK otomatis dicatat ke barang_afkir (tertaut ke stok_log & baris retur).
//   3. stok_awal dibaca (FOR UPDATE) sebelum stok diubah + running balance, bukan hitung balik.
//   4. TUKAR_BARANG: barang rusak yang kembali (0) dan barang pengganti yang keluar (-qty)
//      dicatat sebagai dua baris terpisah.
// ----------------------------------------------------------------------------
export async function ProsesRetur(req, res) {
    let payload;
    try {
        payload = parsePayload(req.body);
    } catch (err) {
        return res.status(err.status || 400).json({ status: false, message: err.message });
    }

    // const { noFaktur,  metode, catatan, items } = payload;
    const { noFaktur, no_faktur_lain, metode, catatan, items } = payload;

    // Faktur Asli (Faktur yang lagi dibuka di layar / dipotong piutangnya)
    const fakturAsli = String(noFaktur).trim();

    // Faktur Numpang (Jika murni retur lokal, otomatis disamakan dengan Faktur Asli)
    const fakturNumpang = (no_faktur_lain && no_faktur_lain !== 'false' && String(no_faktur_lain).trim() !== '')
        ? String(no_faktur_lain).trim()
        : fakturAsli;


    const waktu = getWaktuWIBParts();
    const idAdmin = req.id_admin ? String(req.id_admin).slice(0, 50) : null;
    const bulat4 = (n) => Math.round(Number(n) * 10000) / 10000;
    let conn;

    try {
        conn = await db.getConnection();
        // READ COMMITTED: pembacaan "sudah diretur" selalu data terbaru yang sudah commit.
        // (Di REPEATABLE READ, subquery non-locking bisa membaca snapshot lama.)
        await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
        await conn.beginTransaction();

        // 1. LOCK FAKTUR TUJUAN — gerbang serialisasi semua retur ke faktur ini
        const [fakturRows] = await conn.query(
            `SELECT no_faktur, kode_pelanggan, sisa_piutang, IFNULL(ppn_persen, 0) AS ppn_persen FROM penjualan_header WHERE no_faktur = ? FOR UPDATE`,
            [fakturAsli]
        );

        if (fakturRows.length === 0) throw new ValidationError('Faktur tidak ditemukan!', 404);
        const sisaPiutangSebelum = Number(fakturRows[0].sisa_piutang) || 0;
        const ppnPersenFakturTujuan = Number(fakturRows[0].ppn_persen) || 0; // dipakai untuk barang manual
        const kodePelangganTujuan = fakturRows[0].kode_pelanggan;

        if (metode === 'POTONG_PIUTANG' && sisaPiutangSebelum <= 0) {
            throw new ValidationError(
                `Faktur ${noFaktur} sudah lunas / tidak punya sisa piutang. Retur potong piutang ditolak, tunggu faktur berikutnya.`
            );
        }

        // 2. PRELOAD DATA (batch) --------------------------------------------
        const detailIds = [...new Set(items.filter(i => !i.isManual).map(i => i.idDetail))];
        const kodeSet = new Set(items.filter(i => i.isManual).map(i => i.kodeBarang));

        // 2a. Lock detail (urut id) + nominal & pcs yang sudah diretur
        const detailMap = new Map();
        if (detailIds.length > 0) {
            const [rows] = await conn.query(
                `SELECT id_detail, no_faktur, kode_barang,
                        jumlah_keluar AS qty_beli, satuan AS satuan_beli,
                        harga_jual, IFNULL(diskon, 0) AS diskon_item,
                        hpp_per_unit
                   FROM penjualan_detail
                  WHERE id_detail IN (?)
                  ORDER BY id_detail
                    FOR UPDATE`,
                [detailIds]
            );
            for (const r of rows) {
                detailMap.set(Number(r.id_detail), { ...r, sudah_pcs: 0, sudah_nominal: 0 });
                kodeSet.add(r.kode_barang);
            }
            for (const id of detailIds) {
                if (!detailMap.has(id)) throw new ValidationError(`Detail transaksi ID ${id} tidak ditemukan di database!`);
            }

            const [retRows] = await conn.query(
                `SELECT id_detail_penjualan AS id,
                        SUM(qty_total_pcs) AS pcs, SUM(subtotal_retur) AS nominal
                   FROM retur_detail
                  WHERE id_detail_penjualan IN (?)
                  GROUP BY id_detail_penjualan`,
                [detailIds]
            );
            for (const r of retRows) {
                const d = detailMap.get(Number(r.id));
                if (d) {
                    d.sudah_pcs = Number(r.pcs) || 0;
                    d.sudah_nominal = Number(r.nominal) || 0;
                }
            }
        }

        // 2b. Konteks diskon faktur asal (untuk membagi diskon global proporsional)
        const fakturCtxMap = new Map();
        const fakturAsalList = [...new Set([...detailMap.values()].map(d => d.no_faktur))];
        if (fakturAsalList.length > 0) {
            const [rows] = await conn.query(
                `SELECT h.no_faktur,
                        h.kode_pelanggan,
                        IFNULL(h.diskon_global, 0) AS diskon_faktur,
                        IFNULL(h.ppn_persen, 0) AS ppn_persen,
                        IFNULL((SELECT SUM(GREATEST(d2.harga_jual * d2.jumlah_keluar - IFNULL(d2.diskon, 0), 0))
                                  FROM penjualan_detail d2
                                 WHERE d2.no_faktur = h.no_faktur), 0) AS total_setelah_diskon_item
                   FROM penjualan_header h
                  WHERE h.no_faktur IN (?)`,
                [fakturAsalList]
            );
            for (const r of rows) {
                // GUARD: retur silang hanya boleh antar faktur milik pelanggan yang sama
                if (r.no_faktur !== fakturAsli && String(r.kode_pelanggan ?? '') !== String(kodePelangganTujuan ?? '')) {
                    throw new ValidationError(
                        `Retur silang ditolak! Faktur ${r.no_faktur} milik pelanggan lain. Retur silang hanya boleh antar faktur pelanggan yang sama. Lebih di perhatikan kembali, ya!`
                    );
                }

                fakturCtxMap.set(r.no_faktur, {
                    diskon_faktur: Number(r.diskon_faktur) || 0,
                    ppn_persen: Number(r.ppn_persen) || 0,
                    total_setelah_diskon_item: Number(r.total_setelah_diskon_item) || 0
                });
            }
        }

        // 2c. Master satuan semua barang terkait (1 query)
        const satuanMap = new Map(); // `${kode}|${nama_satuan}` -> row
        if (kodeSet.size > 0) {
            const [rows] = await conn.query(
                `SELECT * FROM barang_satuan WHERE kode_barang IN (?)`,
                [[...kodeSet]]
            );
            // for (const r of rows) satuanMap.set(`${r.kode_barang}|${r.nama_satuan}`, r); // KOMENT UNTUK UJI COBA DULU

            // TESTING  ////////

            for (const r of rows) satuanMap.set(`${r.kode_barang}|${r.nama_satuan}`, r);

            // Barang tanpa baris PCS: sediakan PCS virtual dari rasio satuan terbesarnya
            const perBarang = new Map();
            for (const r of rows) {
                if (!perBarang.has(r.kode_barang)) perBarang.set(r.kode_barang, []);
                perBarang.get(r.kode_barang).push(r);
            }
            for (const [kode, list] of perBarang) {
                if (list.some(r => Number(r.rasio_ke_pcs) === 1)) continue; // sudah punya PCS asli
                const besar = list.reduce((a, b) => Number(b.rasio_ke_pcs) > Number(a.rasio_ke_pcs) ? b : a);
                const rasio = Number(besar.rasio_ke_pcs);
                if (!(rasio > 0)) continue;
                satuanMap.set(`${kode}|PCS`, {
                    kode_barang: kode, nama_satuan: 'PCS', rasio_ke_pcs: 1, level: 1,
                    harga_jual: Number(besar.harga_jual) / rasio // hanya dipakai retur manual
                });
            }
        }

        // 3. HEADER RETUR ----------------------------------------------------
        const noRetur = await generateNoRetur(conn, waktu.yyyymmdd);

        const [headerResult] = await conn.query(
            `INSERT INTO retur_header
            (no_retur, no_faktur, no_faktur_lain, tanggal_retur, metode_penyelesaian, total_nominal_retur, catatan, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
            [noRetur, fakturAsli, fakturNumpang, waktu.sql, metode, catatan, waktu.sql, waktu.sql]
        );

        const idReturHeader = headerResult.insertId;

        // 4. HITUNG SEMUA ITEM (server-side) ---------------------------------
        let grandTotal = 0;
        const dppPerTarif = new Map(); // persen PPN -> total DPP (PPN mengikuti faktur asal barang)
        const detailRowsToInsert = [];
        const stokDelta = new Map();  // kode -> perubahan stok (pcs)
        const tukarButuh = new Map(); // kode -> total pcs yang harus tersedia (TUKAR_BARANG)
        const kejadian = [];          // satu entri per kejadian stok -> jadi baris stok_log (+ afkir)

        for (const it of items) {
            let kodeBarang = it.kodeBarang;
            let idDetailTarget = null;
            let rasioRetur;
            let qtyPcs;
            let subtotal;
            let hargaSatuan;
            let hargaPerPcs;
            let hppPcsSumber = null; // HPP per pcs saat barang dijual (untuk afkir)
            let noFakturAsal = null;

            const satuanRetur = (kode) => {
                const row = satuanMap.get(`${kode}|${it.satuan}`);
                if (!row) throw new ValidationError(`Satuan ${it.satuan} tidak valid untuk barang ${kode}!`);
                const rasio = Number(row.rasio_ke_pcs);
                const level = Number(row.level);
                if (!(rasio > 0)) throw new ValidationError(`Rasio satuan retur barang ${kode} tidak valid (harus > 0)!`);
                if (!Number.isInteger(level) || level < 1 || level > 3) {
                    throw new ValidationError(`Level satuan retur barang ${kode} tidak valid (harus 1-3)! Hubungi admin.`);
                }
                return { row, rasio, level };
            };

            if (it.isManual) {
                // ---- A. Barang manual / luar faktur: harga dari MASTER, bukan dari FE
                const { row, rasio } = satuanRetur(kodeBarang);
                rasioRetur = rasio;
                qtyPcs = it.qty * rasioRetur;
                hargaSatuan = Number(row.harga_jual);
                if (!(hargaSatuan > 0)) {
                    throw new ValidationError(
                        `Harga master barang ${kodeBarang} (${it.satuan}) tidak tersedia. Retur manual tidak bisa diproses, hubungi admin.`
                    );
                }
                subtotal = Math.round(hargaSatuan * it.qty);
                hargaPerPcs = Number((hargaSatuan / rasioRetur).toFixed(4));
            } else {
                // ---- B. Barang dari faktur (mendukung retur silang)
                const d = detailMap.get(it.idDetail);
                idDetailTarget = d.id_detail;
                kodeBarang = d.kode_barang;
                noFakturAsal = d.no_faktur;

                // GUARD: baris bonus murni (jumlah_keluar = 0) tidak boleh diretur
                if (Number(d.qty_beli) <= 0) {
                    throw new ValidationError(`Barang [${kodeBarang}] adalah barang bonus, tidak dapat diretur!`);
                }

                const beli = satuanMap.get(`${kodeBarang}|${d.satuan_beli}`);
                if (!beli) {
                    throw new ValidationError(
                        `Data satuan asli "${d.satuan_beli}" barang ${kodeBarang} tidak ditemukan di master satuan! Hubungi admin.`
                    );
                }
                const rasioBeli = Number(beli.rasio_ke_pcs);
                const levelBeli = Number(beli.level);
                if (!(rasioBeli > 0)) throw new ValidationError(`Rasio satuan asli barang ${kodeBarang} tidak valid (harus > 0)!`);
                if (!Number.isInteger(levelBeli) || levelBeli < 1 || levelBeli > 3) {
                    throw new ValidationError(`Level satuan penjualan barang ${kodeBarang} tidak valid (harus 1-3)! Hubungi admin.`);
                }

                // HPP per pcs saat barang ini dijual (hpp_per_unit = per satuan jual)
                const hppUnit = d.hpp_per_unit == null ? NaN : Number(d.hpp_per_unit);
                hppPcsSumber = Number.isFinite(hppUnit) && hppUnit > 0 ? hppUnit / rasioBeli : null;

                const ret = satuanRetur(kodeBarang);
                rasioRetur = ret.rasio;
                if (ret.level > levelBeli) {
                    throw new ValidationError(
                        `Satuan retur "${it.satuan}" tidak boleh lebih besar dari satuan pembelian "${d.satuan_beli}" untuk barang ${kodeBarang}!`
                    );
                }

                qtyPcs = it.qty * rasioRetur;
                const totalBeliPcs = Number(d.qty_beli) * rasioBeli;
                const sisaPcs = totalBeliPcs - d.sudah_pcs;

                if (qtyPcs > sisaPcs) {
                    throw new ValidationError(
                        `Gagal Retur! Qty barang [${kodeBarang}] melebihi sisa pembelian. ` +
                        `Maksimal retur: ${Math.floor(sisaPcs / rasioRetur)} ${it.satuan} (${sisaPcs} PCS).`
                    );
                }

                // Nilai retur KUMULATIF dari netto baris -> tanpa selisih rupiah
                const ctx = fakturCtxMap.get(d.no_faktur) || {};
                const { netto } = hitungNettoBaris({
                    hargaJual: d.harga_jual,
                    qty: d.qty_beli,
                    diskonItem: d.diskon_item,
                    diskonFaktur: ctx.diskon_faktur || 0,
                    totalSetelahDiskonItem: ctx.total_setelah_diskon_item || 0
                });
                const kumulatifSetelah = Math.round((netto * (d.sudah_pcs + qtyPcs)) / totalBeliPcs);
                subtotal = Math.max(0, kumulatifSetelah - d.sudah_nominal);

                hargaSatuan = Math.round(subtotal / it.qty);
                hargaPerPcs = Number((netto / totalBeliPcs).toFixed(4));

                // update state berjalan (kalau 1 detail diretur 2x dengan satuan beda di request yang sama)
                d.sudah_pcs += qtyPcs;
                d.sudah_nominal += subtotal;
            }

            const ppnPersenItem = it.isManual
                ? ppnPersenFakturTujuan
                : ((fakturCtxMap.get(noFakturAsal) || {}).ppn_persen || 0);
            dppPerTarif.set(ppnPersenItem, (dppPerTarif.get(ppnPersenItem) || 0) + subtotal);

            grandTotal += subtotal;

            detailRowsToInsert.push([
                idReturHeader, idDetailTarget, kodeBarang, it.satuan, rasioRetur, it.qty,
                qtyPcs, hargaSatuan, hargaPerPcs, subtotal, it.kondisi, it.alasan, waktu.sql
            ]);

            const idxDetailRetur = detailRowsToInsert.length - 1;

            // Perubahan stok (diakumulasi, dieksekusi sekali per barang)
            if (metode === 'TUKAR_BARANG') {
                tukarButuh.set(kodeBarang, (tukarButuh.get(kodeBarang) || 0) + (it.kondisi === 'RUSAK' ? qtyPcs : 0));
                if (it.kondisi === 'RUSAK') stokDelta.set(kodeBarang, (stokDelta.get(kodeBarang) || 0) - qtyPcs);
            } else if (it.kondisi === 'BAGUS') {
                stokDelta.set(kodeBarang, (stokDelta.get(kodeBarang) || 0) + qtyPcs);
            }

            // Kejadian untuk stok_log (+ afkir bila rusak)
            const alasanTeks = String(it.alasan || '').trim();
            const dasar = {
                kode: kodeBarang, satuan: it.satuan, qtyInput: it.qty, qtyPcs,
                idxDetailRetur, hppPcs: hppPcsSumber, noFakturAsal
            };

            if (it.kondisi === 'RUSAK') {
                // Barang rusak yang kembali: tidak masuk stok jual (qty_perubahan 0) + masuk afkir
                kejadian.push({
                    ...dasar, kondisi: 'RUSAK', delta: 0, afkir: true,
                    ket: `Retur ${noRetur}: barang rusak, tidak masuk stok jual${alasanTeks ? ` (${alasanTeks})` : ''}`
                });
                if (metode === 'TUKAR_BARANG') {
                    // Barang pengganti (bagus) keluar dari gudang
                    kejadian.push({
                        ...dasar, kondisi: 'BAGUS', delta: -qtyPcs, afkir: false,
                        ket: `Barang pengganti untuk retur ${noRetur}`
                    });
                }
            } else if (metode !== 'TUKAR_BARANG') {
                // Barang bagus kembali ke stok
                kejadian.push({
                    ...dasar, kondisi: 'BAGUS', delta: qtyPcs, afkir: false,
                    ket: alasanTeks ? `Retur ${noRetur}: ${alasanTeks}` : `Retur penjualan faktur ${noFaktur}`
                });
            }
        }

        if (!(grandTotal > 0)) {
            throw new ValidationError('Total nilai retur 0, retur tidak dapat diproses!');
        }


        // // 4.1 KALKULASI PPN DINAMIS DARI FAKTUR ASLI
        // const [fakturPpnRow] = await conn.query(
        //     `SELECT IFNULL(ppn_persen, 0) AS ppn_persen FROM penjualan_header WHERE no_faktur = ?`,
        //     [fakturAsli]
        // );
        // const ppnPersenRetur = Number(fakturPpnRow[0]?.ppn_persen) || 0;

        // let dppRetur = grandTotal;
        // let ppnNominalRetur = 0;

        // if (ppnPersenRetur > 0) {
        //     // dppRetur = Math.round(grandTotal / (1 + (ppnPersenRetur / 100))); // ini gw non aktifkan dlu kayak nya bug 
        //     dppRetur = grandTotal // ini gw yang perbaiki, harusnya dpp itu sama dengan total harga / kolom total_nominal_retur. kalo total nominal retur 1700 maka dpp juga harus 1700, jadi itu udah bersih sama diskon dll
        //     // ppnNominalRetur = grandTotal - dppRetur; // dan ini juga kayak nya bug, harusnya kan nominal ppn itu dari dppretur x persentase ppn kan = nominal ppn nya. tapi disini malah di kurang anjay
        //     ppnNominalRetur = Math.round((dppRetur * ppnPersenRetur) / 100) // dan ini yang gw ubah. jadi dppretur x persentase ppn nya, dan nanti gw minta saran apakah perubahan gw di baris ini benar?

        // }

        // // const grandTotalReturPlusPPN = grandTotal; // ini juga bug , harusnya dpp retur + ppnnominal
        // const grandTotalReturPlusPPN = dppRetur + ppnNominalRetur; // ini udah gw benerin, tapi kira2 bener kan langkah yang gw ambil? kalo tadi gw udah uji coba (testing) hasil nya sesuai harapan banget!


        // 4.1 PPN mengikuti faktur ASAL barang (barang manual: faktur tujuan)
        const dppRetur = grandTotal;
        let ppnNominalRetur = 0;
        for (const [persen, dpp] of dppPerTarif) {
            if (persen > 0) ppnNominalRetur += Math.round((dpp * persen) / 100);
        }
        // kolom header cuma 1: kalau tarif campur, simpan tarif efektif
        const ppnPersenRetur = dppPerTarif.size === 1
            ? [...dppPerTarif.keys()][0]
            : (dppRetur > 0 ? Math.round((ppnNominalRetur / dppRetur) * 10000) / 100 : 0);
        const grandTotalReturPlusPPN = dppRetur + ppnNominalRetur;



        // 5. INSERT DETAIL (bulk) --------------------------------------------
        const [hasilDetail] = await conn.query(
            `INSERT INTO retur_detail
               (retur_id, id_detail_penjualan, kode_barang, satuan_retur, rasio_ke_pcs, qty_input, qty_total_pcs,
                harga_satuan, harga_per_pcs, subtotal_retur, kondisi_barang, alasan_retur, created_at)
             VALUES ?`,
            [detailRowsToInsert]
        );
        // INSERT multi-baris: id dibuat berurutan mulai dari insertId (auto-increment)
        const idDetailReturPertama = Number(hasilDetail.insertId) || null;

        // 6. STOK + STOK_LOG + AFKIR -------------------------------------------
        if (kejadian.length > 0) {
            // 6a. Kunci semua barang terkait (urut kode) & baca stok awal SEBELUM diubah
            const kodeStok = [...new Set(kejadian.map(k => k.kode))].sort();
            const [stokRows] = await conn.query(
                `SELECT kode_barang, stok_pcs FROM barang WHERE kode_barang IN (?) ORDER BY kode_barang FOR UPDATE`,
                [kodeStok]
            );
            const saldo = new Map(stokRows.map(r => [r.kode_barang, Number(r.stok_pcs) || 0]));
            for (const kode of kodeStok) {
                if (!saldo.has(kode)) throw new ValidationError(`Barang [${kode}] tidak ditemukan di master barang!`);
            }

            // 6b. Cek stok untuk barang pengganti (TUKAR_BARANG)
            if (metode === 'TUKAR_BARANG') {
                for (const kode of kodeStok) {
                    const butuh = tukarButuh.get(kode) || 0;
                    if (saldo.get(kode) < butuh) {
                        throw new ValidationError(
                            `Gagal Tukar Barang! Stok barang [${kode}] tidak mencukupi. ` +
                            `Stok tersedia: ${saldo.get(kode)} PCS, dibutuhkan: ${butuh} PCS.`
                        );
                    }
                }
            }

            // 6c. Update stok (1 UPDATE per barang)
            for (const kode of kodeStok) {
                const delta = stokDelta.get(kode) || 0;
                if (delta === 0) continue;
                const [u] = await conn.query(
                    `UPDATE barang SET stok_pcs = stok_pcs + ? WHERE kode_barang = ?`,
                    [delta, kode]
                );
                if (u.affectedRows !== 1) throw new ValidationError(`Barang [${kode}] tidak ditemukan di master barang!`);
            }

            // 6d. HPP cadangan untuk afkir yang HPP penjualannya tidak diketahui (retur manual / data lama)
            const kodePerluHpp = [...new Set(kejadian.filter(k => k.afkir && !(k.hppPcs > 0)).map(k => k.kode))];
            const hppCadangan = new Map();
            if (kodePerluHpp.length > 0) {
                const [hRows] = await conn.query(
                    `SELECT kode_barang, hpp_per_pcs FROM stok_log
                      WHERE jenis_transaksi = 'PEMBELIAN' AND hpp_per_pcs IS NOT NULL AND kode_barang IN (?)
                      ORDER BY id_stok DESC`,
                    [kodePerluHpp]
                );
                for (const r of hRows) {
                    if (!hppCadangan.has(r.kode_barang)) hppCadangan.set(r.kode_barang, Number(r.hpp_per_pcs) || 0);
                }
            }

            // 6e. Tulis stok_log per kejadian (running balance) + afkir
            for (const k of kejadian) {
                const stokAwalNow = saldo.get(k.kode);
                const stokAkhirNow = stokAwalNow + k.delta;
                saldo.set(k.kode, stokAkhirNow);

                const idReturDetail = idDetailReturPertama ? idDetailReturPertama + k.idxDetailRetur : null;
                const hppPcs = k.afkir
                    ? bulat4(k.hppPcs > 0 ? k.hppPcs : (hppCadangan.get(k.kode) || 0))
                    : null;

                const [logHasil] = await conn.query(
                    `INSERT INTO stok_log (
                        tanggal, kode_barang, stok_awal, pembelian, penjualan, stok_akhir,
                        jenis_transaksi, kondisi, jumlah, qty_perubahan, satuan_input, qty_input,
                        referensi_tipe, referensi_no, referensi_id, hpp_per_pcs, keterangan, dibuat_oleh, created_at
                    ) VALUES (?, ?, ?, 0, 0, ?, 'RETUR_PENJUALAN', ?, ?, ?, ?, ?, 'RETUR_PENJUALAN', ?, ?, ?, ?, ?, ?)`,
                    [
                        waktu.sql,
                        k.kode,
                        stokAwalNow,
                        stokAkhirNow,
                        k.kondisi,
                        k.qtyPcs,                      // jumlah (PCS, positif)
                        k.delta,                       // qty_perubahan (+ masuk, - keluar, 0 tidak mengubah stok)
                        String(k.satuan || 'PCS').toUpperCase().slice(0, 30),
                        k.qtyInput,
                        noRetur,
                        idReturDetail,
                        hppPcs,
                        String(k.ket).slice(0, 255),
                        idAdmin,
                        waktu.sql
                    ]
                );

                if (k.afkir) {
                    await conn.query(
                        `INSERT INTO barang_afkir (
                         tanggal, kode_barang, qty_pcs, qty_sisa, hpp_per_pcs, sumber_kerusakan,
                         no_ref_retur, id_retur_detail, no_faktur_asal, id_stok_log, keterangan, dibuat_oleh
                         ) VALUES (?, ?, ?, ?, ?, 'RETUR_PENJUALAN', ?, ?, ?, ?, ?, ?)`,
                        [
                            waktu.sql,
                            k.kode,
                            k.qtyPcs,
                            k.qtyPcs,
                            hppPcs,
                            noRetur,
                            idReturDetail,
                            k.noFakturAsal,
                            logHasil.insertId,
                            String(k.ket).slice(0, 255),
                            idAdmin
                        ]
                    );
                }
            }
        }

        // 7. EFEK METODE PENYELESAIAN ------------------------------------------
        let jumlahRefundKas = 0;
        let jumlahPotongPiutang = 0;

        if (metode === 'POTONG_PIUTANG') {
            if (grandTotalReturPlusPPN > sisaPiutangSebelum) {
                throw new ValidationError(
                    `Gagal Potong Piutang! Total retur + PPN (Rp ${rupiah(grandTotalReturPlusPPN)}) lebih besar dari sisa piutang ` +
                    `faktur ${noFaktur} (Rp ${rupiah(sisaPiutangSebelum)}). Transaksi ditolak, coba retur di penjualan selanjutnya.`
                );
            }
            // MEMOTONG SISA PIUTANG DENGAN NILAI YANG SUDAH TERMASUK PPN (2.058)
            const [u] = await conn.query(
                `UPDATE penjualan_header SET sisa_piutang = sisa_piutang - ?
                 WHERE no_faktur = ? AND sisa_piutang >= ?`,
                [grandTotalReturPlusPPN, fakturAsli, grandTotalReturPlusPPN]
            );

            if (u.affectedRows !== 1) {
                throw new ValidationError('Sisa piutang faktur berubah saat diproses. Silakan coba lagi.');
            }
            jumlahPotongPiutang = grandTotalReturPlusPPN;
        } else if (metode === 'REFUND') {
            jumlahRefundKas = grandTotalReturPlusPPN;
        }

        // 8. FINALISASI HEADER -------------------------------------------------
        await conn.query(
            `UPDATE retur_header
                SET total_nominal_retur = ?,
                    dpp_total = ?,
                    ppn_persen = ?,
                    ppn_nominal = ?,
                    grand_total = ?,
                    jumlah_potong_piutang = ?,
                    jumlah_refund_kas = ?,
                    updated_at = ?
              WHERE id = ?`,
            [
                // grandTotalReturPlusPPN, // 2.058 //tapi ini gw gatau ini bug atau bukan ? harusnya kolom total_nominal retur di isi dengan grandtotal jadi nanti kolom total_nominal_retur = 1700 dan di kolom dpp juga 1700. atau kolom totalnomial retur isi total + ppn aja?
                grandTotal,
                dppRetur,               // 1.854 (DPP Murni untuk omzet sales)
                ppnPersenRetur,         // 11.00
                ppnNominalRetur,        // 204
                grandTotalReturPlusPPN, // 2.058
                jumlahPotongPiutang,    // 2.058
                jumlahRefundKas,
                waktu.sql,
                idReturHeader
            ]
        );

        await conn.commit();

        return res.status(200).json({
            status: true,
            message: 'Retur berhasil diproses!',
            data: {
                no_retur: noRetur,
                total_refund: grandTotalReturPlusPPN,
                jumlah_potong_piutang: jumlahPotongPiutang,
                jumlah_refund_kas: jumlahRefundKas
            }
        });
    } catch (err) {
        if (conn) {
            try {
                await conn.rollback();
            } catch (rollbackErr) {
                console.error('[ProsesRetur] Rollback gagal:', rollbackErr);
            }
        }

        if (err instanceof ValidationError) {
            return res.status(err.status).json({ status: false, message: err.message });
        }

        // Deadlock / lock timeout MySQL: aman di-retry user, bukan error bisnis
        if (err && (err.code === 'ER_LOCK_DEADLOCK' || err.code === 'ER_LOCK_WAIT_TIMEOUT')) {
            console.warn('[ProsesRetur] Lock contention:', err.code);
            return res.status(409).json({
                status: false,
                message: 'Sistem sedang memproses transaksi lain pada data yang sama. Silakan coba lagi.'
            });
        }

        console.error('[ProsesRetur] Unexpected error:', err);
        return res.status(500).json({
            status: false,
            message: 'Terjadi kesalahan sistem saat memproses retur. Silakan coba lagi atau hubungi admin.'
        });
    } finally {
        if (conn) conn.release();
    }
}
