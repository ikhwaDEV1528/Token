// import { db } from "../../db.js";


// const tglLogSekarang = () =>
//   new Intl.DateTimeFormat('sv-SE', {
//     timeZone: 'Asia/Jakarta',
//     year: 'numeric', month: '2-digit', day: '2-digit',
//     hour: '2-digit', minute: '2-digit', second: '2-digit',
//     hour12: false
//   }).format(new Date());

// const barisLogPenyesuaian = ({ kode, stokAwal, perubahanPcs, satuan, qtyInput, noFaktur, idDetail, keterangan, idAdmin }) => [
//   tglLogSekarang(),                    // tanggal
//   kode,                                // kode_barang
//   stokAwal,                            // stok_awal
//   0,                                   // pembelian
//   0,                                   // penjualan
//   stokAwal + perubahanPcs,             // stok_akhir
//   'PENYESUAIAN',                       // jenis_transaksi
//   'BAGUS',                             // kondisi
//   Math.abs(perubahanPcs),              // jumlah (positif)
//   perubahanPcs,                        // qty_perubahan (+ masuk, - keluar)
//   String(satuan || 'PCS').toUpperCase(), // satuan_input
//   qtyInput,                            // qty_input
//   'PENJUALAN',                         // referensi_tipe
//   noFaktur,                            // referensi_no
//   idDetail,                            // referensi_id
//   String(keterangan).slice(0, 255),    // keterangan
//   idAdmin ? String(idAdmin) : null     // dibuat_oleh
// ];

// const SQL_INSERT_STOK_LOG = `INSERT INTO stok_log (
//   tanggal, kode_barang, stok_awal, pembelian, penjualan, stok_akhir,
//   jenis_transaksi, kondisi, jumlah, qty_perubahan,
//   satuan_input, qty_input, referensi_tipe, referensi_no, referensi_id,
//   keterangan, dibuat_oleh
// ) VALUES ?`;






// export async function HAPUSITEMFAKTUR(req, res) {
//     const { faktur, no_faktur } = req.body || {};

//     if (!faktur?.id_detail || !no_faktur) {
//         return res.status(400).json({ message: 'Wajib diisi!' });
//     }

//     const connection = await db.getConnection();

//     try {
//         await connection.beginTransaction();

//         // 0. Kunci header faktur
//         const [headerRows] = await connection.query(
//             `SELECT no_faktur FROM penjualan_header WHERE no_faktur = ? FOR UPDATE`,
//             [no_faktur]
//         );
//         if (headerRows.length === 0) {
//             await connection.rollback();
//             return res.status(404).json({ message: 'Faktur tidak ditemukan!' });
//         }

//         // 1. Ambil item yang mau dihapus (dari DB)
//         const [itemRows] = await connection.query(
//             `SELECT kode_barang, satuan, jumlah_keluar
//                FROM penjualan_detail
//               WHERE no_faktur = ? AND id_detail = ?
//               FOR UPDATE`,
//             [no_faktur, faktur.id_detail]
//         );
//         if (itemRows.length === 0) {
//             await connection.rollback();
//             return res.status(404).json({ message: 'Item faktur tidak ditemukan!' });
//         }
//         const item = itemRows[0];

//         // 2. Hitung pcs yang harus dikembalikan
//         const [satuanRows] = await connection.query(
//             `SELECT rasio_ke_pcs FROM barang_satuan
//               WHERE kode_barang = ? AND UPPER(nama_satuan) = UPPER(?)`,
//             [item.kode_barang, item.satuan]
//         );
//         const rasio = satuanRows.length > 0 ? Math.max(1, Number(satuanRows[0].rasio_ke_pcs) || 1) : 1;
//         const pcsKembali = (Number(item.jumlah_keluar) || 0) * rasio;

//         // 3. Kunci barang, baca stok awal, kembalikan stok
//         const [stokRows] = await connection.query(
//             `SELECT stok_pcs FROM barang WHERE kode_barang = ? FOR UPDATE`,
//             [item.kode_barang]
//         );

//         if (stokRows.length > 0 && pcsKembali > 0) {
//             const stokAwal = Number(stokRows[0].stok_pcs) || 0;

//             await connection.query(
//                 `UPDATE barang SET stok_pcs = stok_pcs + ? WHERE kode_barang = ?`,
//                 [pcsKembali, item.kode_barang]
//             );

//             await connection.query(SQL_INSERT_STOK_LOG, [[
//                 barisLogPenyesuaian({
//                     kode: item.kode_barang,
//                     stokAwal,
//                     perubahanPcs: pcsKembali,
//                     satuan: item.satuan,
//                     qtyInput: Number(item.jumlah_keluar) || 0,
//                     noFaktur: no_faktur,
//                     idDetail: faktur.id_detail,
//                     keterangan: `Item dihapus dari faktur ${no_faktur}, stok dikembalikan`,
//                     idAdmin: req.id_admin
//                 })
//             ]]);
//         }

//         // 4. HAPUS ITEM
//         await connection.query(
//             `DELETE FROM penjualan_detail WHERE no_faktur = ? AND id_detail = ?`,
//             [no_faktur, faktur.id_detail]
//         );

//         // 5. Hitung ulang total (kode kamu yang lama, tidak diubah)
//         const [sumResult] = await connection.query(
//             `SELECT COALESCE(SUM(total_harga), 0) AS total_belanja_baru 
//              FROM penjualan_detail WHERE no_faktur = ?`,
//             [no_faktur]
//         );
//         const totalBelanjaBaru = sumResult[0].total_belanja_baru;

//         await connection.query(
//             `UPDATE penjualan_header 
//              SET total_harga = ?,
//                  sisa_piutang = ? - pembayaran,
//                  status = CASE WHEN (? - pembayaran) <= 0 THEN 'LUNAS' ELSE 'PIUTANG' END
//              WHERE no_faktur = ?`,
//             [totalBelanjaBaru, totalBelanjaBaru, totalBelanjaBaru, no_faktur]
//         );

//         await connection.commit();

//         return res.status(200).json({
//             message: 'Berhasil menghapus item dan memperbarui faktur',
//             total_belanja_baru: totalBelanjaBaru
//         });

//     } catch (err) {
//         await connection.rollback();
//         console.error('Error Hapus Item Faktur:', err);
//         return res.status(500).json({ message: 'Gagal menghapus item faktur' });
//     } finally {
//         connection.release();
//     }
// }






// // EDIT ITEM DI FAKTUR //


// /**
//  * ============================================================================
//  * ENDPOINT: PUT /api-be/SERVER_FAKTUR/EDIT_FAKTUR   (handler: EDITITEMFAKTUR)
//  * ============================================================================
//  * Alur bisnis TIDAK diubah:
//  *   1. stok barang lama dikembalikan, stok barang baru dikurangi (cek cukup)
//  *   2. harga 0 -> pakai harga resmi (barang_satuan, lalu barang)
//  *   3. diskon (rupiah) tidak boleh melebihi subtotal; total item = subtotal - diskon
//  *   4. detail di-update, header faktur di-update (total, sisa_piutang, status)
//  *
//  * Tambahan:
//  *   - sisa_piutang disesuaikan dengan SELISIH nilai faktur (bukan ditimpa dari
//  *     nol), sehingga cicilan (pembayaran_piutang) & potongan retur TIDAK hilang.
//  *   - pembayaran_piutang_detail (sisa_sebelum / sisa_sesudah) digeser dengan
//  *     selisih yang sama agar riwayat tetap sinkron dengan faktur.
//  *   - header faktur dikunci FOR UPDATE (aman terhadap input pembayaran bersamaan)
//  *   - validasi ketat, anti race / deadlock, tidak membocorkan err.message
//  * ============================================================================
//  */

// // false = tolak edit yang membuat nilai faktur < uang yang sudah dibayar.
// // true  = perilaku lama: sisa dipaksa 0 (kelebihan bayar diabaikan).
// const IZINKAN_KELEBIHAN_BAYAR = false;

// const MAKS_JUMLAH = 1_000_000;
// const MAKS_RUPIAH = 2_000_000_000;

// const bersih = (v, maks) => {
//     if (typeof v !== 'string') return null;
//     // eslint-disable-next-line no-control-regex
//     const s = v.replace(/[\u0000-\u001F\u007F]/g, '').trim();
//     return s.length >= 1 && s.length <= maks ? s : null;
// };

// // Hanya bilangan bulat >= 0 (tolak 1e5, 1.5, -1, "abc", array, object)
// const keInt = (v) => {
//     if (typeof v === 'number') return Number.isSafeInteger(v) && v >= 0 ? v : null;
//     if (typeof v === 'string' && /^\d{1,15}$/.test(v.trim())) return Number(v.trim());
//     return null;
// };

// const rupiah = (n) => `Rp ${Number(n).toLocaleString('id-ID')}`;

// export async function EDITITEMFAKTUR(req, res) {
//     const body = req.body && typeof req.body === 'object' ? req.body : {};
//     const faktur = body.faktur && typeof body.faktur === 'object' && !Array.isArray(body.faktur) ? body.faktur : null;
//     // Payload 'faktur': { id_detail, kode_barang, satuan, jumlah_keluar, harga_jual, diskon }

//     // ---------------- VALIDASI INPUT ----------------
//     const noFaktur = bersih(body.no_faktur, 50);
//     if (!faktur || !noFaktur) {
//         return res.status(400).json({ message: 'Data faktur dan detail item wajib diisi!' });
//     }

//     const idDetail = keInt(faktur.id_detail);
//     const kodeBarang = bersih(faktur.kode_barang, 50);
//     const satuan = bersih(faktur.satuan, 30);
//     if (!idDetail || idDetail < 1 || !kodeBarang) {
//         return res.status(400).json({ message: 'Data faktur dan detail item wajib diisi!' });
//     }
//     if (!satuan) {
//         return res.status(400).json({ message: 'Satuan wajib diisi!' });
//     }

//     const jumlahKeluar = keInt(faktur.jumlah_keluar);
//     if (!jumlahKeluar || jumlahKeluar < 1 || jumlahKeluar > MAKS_JUMLAH) {
//         return res.status(400).json({ message: `Jumlah harus bilangan bulat 1 - ${MAKS_JUMLAH.toLocaleString('id-ID')}!` });
//     }

//     // harga kosong/0 -> pakai harga resmi (logika lama dipertahankan)
//     const hargaKosong = faktur.harga_jual === undefined || faktur.harga_jual === null || faktur.harga_jual === '';
//     const hargaJualInput = hargaKosong ? 0 : keInt(faktur.harga_jual);
//     if (hargaJualInput === null || hargaJualInput > MAKS_RUPIAH) {
//         return res.status(400).json({ message: 'Harga jual harus bilangan bulat >= 0 dan wajar!' });
//     }

//     const diskonKosong = faktur.diskon === undefined || faktur.diskon === null || faktur.diskon === '';
//     const diskonInput = diskonKosong ? 0 : keInt(faktur.diskon);
//     if (diskonInput === null || diskonInput > MAKS_RUPIAH) {
//         return res.status(400).json({ message: 'Diskon harus bilangan bulat >= 0 (rupiah)!' });
//     }

//     const connection = await db.getConnection();
//     let selesai = false; // true setelah commit/rollback sudah dilakukan

//     const tolak = async (status, message) => {
//         await connection.rollback();
//         selesai = true;
//         return res.status(status).json({ message });
//     };

//     try {
//         await connection.beginTransaction();

//         // 1) KUNCI HEADER FAKTUR (serialisasi dengan BAYAR_PIUTANG / retur / edit lain)
//         const [headerRows] = await connection.query(
//             `SELECT no_faktur, total_harga, sisa_piutang, status
//                FROM penjualan_header
//               WHERE no_faktur = ?
//               FOR UPDATE`,
//             [noFaktur]
//         );
//         if (headerRows.length === 0) {
//             return await tolak(404, 'Faktur tidak ditemukan!');
//         }
//         const header = headerRows[0];

//         // 2) ITEM LAMA
//         const [oldItemRows] = await connection.query(
//             `SELECT kode_barang, satuan, jumlah_keluar, total_harga
//                FROM penjualan_detail
//               WHERE id_detail = ? AND no_faktur = ?
//               FOR UPDATE`,
//             [idDetail, noFaktur]
//         );
//         if (oldItemRows.length === 0) {
//             return await tolak(404, 'Item detail faktur tidak ditemukan!');
//         }
//         const oldItem = oldItemRows[0];

//         // 3) ITEM YANG SUDAH PERNAH DIRETUR TIDAK BOLEH DIUBAH (hitungan retur bergantung qty/harga)
//         const [returRows] = await connection.query(
//             `SELECT 1 FROM retur_detail WHERE id_detail_penjualan = ? LIMIT 1`,
//             [idDetail]
//         );
//         if (returRows.length > 0) {
//             return await tolak(409, 'Item ini sudah pernah diretur, tidak bisa diedit!');
//         }

//         // ---------------- LOGIKA STOK (alur sama seperti sebelumnya) ----------------
//         const getRasio = async (kode, namaSatuan, wajibAda) => {
//             const [rows] = await connection.query(
//                 `SELECT rasio_ke_pcs FROM barang_satuan
//                   WHERE kode_barang = ? AND UPPER(nama_satuan) = UPPER(?)`,
//                 [kode, namaSatuan]
//             );
//             if (rows.length > 0) return Math.max(1, Number(rows[0].rasio_ke_pcs) || 1);
//             if (wajibAda && String(namaSatuan).toUpperCase() !== 'PCS') return null;
//             return 1;
//         };

//         const rasioLama = await getRasio(oldItem.kode_barang, oldItem.satuan, false);
//         const pcsLama = (Number(oldItem.jumlah_keluar) || 0) * rasioLama;

//         const rasioBaru = await getRasio(kodeBarang, satuan, true);
//         if (rasioBaru === null) {
//             return await tolak(400, `Satuan "${satuan}" tidak terdaftar untuk barang ini!`);
//         }
//         const pcsBaru = jumlahKeluar * rasioBaru;

//         // Kunci baris barang dengan urutan tetap (cegah deadlock antar-edit)
//         const daftarKode = [...new Set([oldItem.kode_barang, kodeBarang])].sort();
//         const [stokRows] = await connection.query(
//             `SELECT kode_barang, stok_pcs FROM barang
//               WHERE kode_barang IN (?)
//               ORDER BY kode_barang
//               FOR UPDATE`,
//             [daftarKode]
//         );
//         const stok = new Map(stokRows.map(r => [r.kode_barang, Number(r.stok_pcs) || 0]));

//         if (!stok.has(kodeBarang)) {
//             return await tolak(404, 'Barang tidak ditemukan!');
//         }

//         // 1. kembalikan stok lama (+), 2. cek stok baru, 3. kurangi stok baru (-)
//         if (stok.has(oldItem.kode_barang)) {
//             stok.set(oldItem.kode_barang, stok.get(oldItem.kode_barang) + pcsLama);
//         }
//         const stokTersedia = stok.get(kodeBarang);
//         if (stokTersedia < pcsBaru) {
//             return await tolak(400,
//                 `Stok tidak mencukupi! Stok tersedia: ${stokTersedia} pcs, dibutuhkan: ${pcsBaru} pcs.`);
//         }

//         if (oldItem.kode_barang === kodeBarang) {
//             await connection.query(
//                 `UPDATE barang SET stok_pcs = stok_pcs + ? - ? WHERE kode_barang = ?`,
//                 [pcsLama, pcsBaru, kodeBarang]
//             );
//         } else {
//             if (stok.has(oldItem.kode_barang)) {
//                 await connection.query(
//                     `UPDATE barang SET stok_pcs = stok_pcs + ? WHERE kode_barang = ?`,
//                     [pcsLama, oldItem.kode_barang]
//                 );
//             }
//             await connection.query(
//                 `UPDATE barang SET stok_pcs = stok_pcs - ? WHERE kode_barang = ?`,
//                 [pcsBaru, kodeBarang]
//             );
//         }

//         // ---------------- HARGA & DISKON (logika sama) ----------------
//         let hargaJualFinal = hargaJualInput;

//         if (hargaJualFinal === 0) {
//             const [hargaResult] = await connection.query(
//                 `SELECT harga_jual FROM barang_satuan
//                   WHERE kode_barang = ? AND UPPER(nama_satuan) = UPPER(?)`,
//                 [kodeBarang, satuan]
//             );
//             if (hargaResult.length > 0) {
//                 hargaJualFinal = Math.max(0, Math.round(Number(hargaResult[0].harga_jual) || 0));
//             } else {
//                 const [barangResult] = await connection.query(
//                     `SELECT harga_jual_produk_ke_pelanggan FROM barang WHERE kode_barang = ?`,
//                     [kodeBarang]
//                 );
//                 if (barangResult.length > 0 && Number(barangResult[0].harga_jual_produk_ke_pelanggan) > 0) {
//                     hargaJualFinal = Math.max(0, Math.round(Number(barangResult[0].harga_jual_produk_ke_pelanggan) || 0));
//                 }
//             }
//         }

//         const subtotalKotor = jumlahKeluar * hargaJualFinal;
//         if (subtotalKotor > MAKS_RUPIAH) {
//             return await tolak(400, `Subtotal item terlalu besar (maks ${rupiah(MAKS_RUPIAH)})!`);
//         }
//         if (diskonInput > subtotalKotor) {
//             return await tolak(400,
//                 `Diskon (${rupiah(diskonInput)}) tidak boleh melebihi subtotal item (${rupiah(subtotalKotor)})!`);
//         }
//         const totalHargaItemBaru = subtotalKotor - diskonInput;

//         // ---------------- SELISIH NILAI FAKTUR -> PIUTANG ----------------
//         // delta bernilai negatif bila faktur turun (21k -> 18k = -3k). Diskon global
//         // konstan sehingga tidak mempengaruhi selisih.
//         const totalItemLama = Number(oldItem.total_harga) || 0;
//         const delta = totalHargaItemBaru - totalItemLama;

//         const sisaLama = Number(header.sisa_piutang) || 0;
//         let sisaBaru = sisaLama + delta;

//         if (sisaBaru < 0) {
//             if (!IZINKAN_KELEBIHAN_BAYAR) {
//                 return await tolak(409,
//                     `Edit ditolak: nilai faktur akan lebih kecil dari uang yang sudah dibayar ` +
//                     `(kelebihan ${rupiah(-sisaBaru)}). Selesaikan lewat retur/refund terlebih dahulu.`);
//             }
//             sisaBaru = 0;
//         }
//         const deltaEfektif = sisaBaru - sisaLama; // yang benar-benar berubah di piutang
//         const totalHeaderBaru = Math.max(0, (Number(header.total_harga) || 0) + delta);

//         // ---------------- UPDATE DETAIL ----------------
//         await connection.query(
//             `UPDATE penjualan_detail
//                 SET kode_barang = ?, satuan = ?, jumlah_keluar = ?,
//                     harga_jual = ?, diskon = ?, total_harga = ?
//               WHERE id_detail = ? AND no_faktur = ?`,
//             [kodeBarang, satuan, jumlahKeluar, hargaJualFinal, diskonInput, totalHargaItemBaru, idDetail, noFaktur]
//         );

//         // ---------------- UPDATE HEADER ----------------
//         await connection.query(
//             `UPDATE penjualan_header
//                 SET total_harga = ?, sisa_piutang = ?, status = ?
//               WHERE no_faktur = ?`,
//             [totalHeaderBaru, sisaBaru, sisaBaru <= 0 ? 'LUNAS' : 'PIUTANG', noFaktur]
//         );

//         // ---------------- SINKRON RIWAYAT PEMBAYARAN PIUTANG ----------------
//         // Uang yang diterima (header.total_bayar & detail.jumlah) tidak berubah;
//         // hanya potret saldo sisa_sebelum/sisa_sesudah yang digeser mengikuti faktur.
//         if (deltaEfektif !== 0) {
//             await connection.query(
//                 `UPDATE pembayaran_piutang_detail
//                     SET sisa_sebelum = GREATEST(0, CAST(sisa_sebelum AS SIGNED) + ?),
//                         sisa_sesudah = GREATEST(0, CAST(sisa_sesudah AS SIGNED) + ?)
//                   WHERE no_faktur = ?`,
//                 [deltaEfektif, deltaEfektif, noFaktur]
//             );
//         }

//         await connection.commit();
//         selesai = true;

//         return res.status(200).json({
//             message: 'Berhasil mengedit item dan memperbarui faktur',
//             data: {
//                 kode_barang: kodeBarang,
//                 satuan,
//                 jumlah_keluar: jumlahKeluar,
//                 harga_jual: hargaJualFinal,
//                 diskon: diskonInput,
//                 total_harga_item: totalHargaItemBaru,
//                 total_belanja_baru: totalHeaderBaru,
//                 sisa_piutang_baru: sisaBaru
//             }
//         });

//     } catch (err) {
//         if (!selesai) {
//             try { await connection.rollback(); } catch (e) { /* koneksi sudah putus */ }
//         }
//         console.error('[EDITITEMFAKTUR] Error:', err);

//         if (err && (err.code === 'ER_LOCK_DEADLOCK' || err.code === 'ER_LOCK_WAIT_TIMEOUT')) {
//             return res.status(409).json({ message: 'Faktur sedang diproses pengguna lain, silakan coba lagi.' });
//         }
//         return res.status(500).json({ message: 'Gagal mengedit item faktur' });
//     } finally {
//         connection.release();
//     }
// }



import { db } from "../../db.js";

/**
 * ============================================================================
 * HAPUS & EDIT ITEM FAKTUR PENJUALAN
 * ============================================================================
 * Aturan bisnis:
 *   - Hapus item  : stok barang dikembalikan, faktur & piutang dikurangi sebesar
 *                   nilai item, riwayat pembayaran piutang disinkronkan.
 *   - Edit item   : stok lama dikembalikan, stok baru dipotong (barang boleh
 *                   diganti). Piutang disesuaikan dengan SELISIH nilai item.
 *   - Semua perubahan stok dicatat ke stok_log (jenis PENYESUAIAN, referensi
 *     ke faktur + id_detail) di dalam transaksi yang sama.
 *   - Item yang sudah pernah diretur tidak boleh diubah/dihapus.
 *
 * Pengaman:
 *   - Urutan kunci SAMA di semua handler: header faktur -> detail -> barang
 *     (barang dikunci terurut) sehingga aman dari deadlock; kalau tetap terjadi
 *     deadlock, transaksi diulang otomatis (maks 3x).
 *   - Update stok memakai guard `stok_pcs + delta >= 0` (defense in depth).
 *   - Data item lama selalu dibaca dari DB, bukan dari kiriman FE.
 *   - err.message tidak pernah dikirim ke client.
 * ============================================================================
 */

// ---------------------------------------------------------------------------
// KONFIGURASI
// ---------------------------------------------------------------------------

// Samakan dengan nilai status yang dipakai modul lain (BAYAR_PIUTANG, laporan).
const STATUS_LUNAS = 'LUNAS';
const STATUS_PIUTANG = 'PIUTANG';

// false = tolak perubahan yang membuat nilai faktur < uang yang sudah dibayar.
// true  = sisa piutang dipaksa 0 (kelebihan bayar diabaikan).
const IZINKAN_KELEBIHAN_BAYAR = false;

// false = item terakhir tidak boleh dihapus (faktur harus dibatalkan/diretur).
const IZINKAN_HAPUS_ITEM_TERAKHIR = false;

const MAKS_JUMLAH = 1_000_000;
const MAKS_RUPIAH = 2_000_000_000;
const MAKS_PERCOBAAN_DEADLOCK = 3;

// ---------------------------------------------------------------------------
// HELPER UMUM
// ---------------------------------------------------------------------------

class BisnisError extends Error {
    constructor(status, message) {
        super(message);
        this.name = 'BisnisError';
        this.status = status;
    }
}
const tolak = (status, message) => new BisnisError(status, message);

const bersih = (v, maks) => {
    if (typeof v !== 'string') return null;
    // eslint-disable-next-line no-control-regex
    const s = v.replace(/[\u0000-\u001F\u007F]/g, '').trim();
    return s.length >= 1 && s.length <= maks ? s : null;
};

// Hanya bilangan bulat >= 0 (tolak 1e5, 1.5, -1, "abc", array, object)
const keInt = (v) => {
    if (typeof v === 'number') return Number.isSafeInteger(v) && v >= 0 ? v : null;
    if (typeof v === 'string' && /^\d{1,15}$/.test(v.trim())) return Number(v.trim());
    return null;
};

const adalahObjek = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const rupiah = (n) => `Rp ${Number(n).toLocaleString('id-ID')}`;
const bulat2 = (n) => Math.round(n * 100) / 100;
const bulat4 = (n) => Math.round(n * 10000) / 10000;
const tidur = (ms) => new Promise((r) => setTimeout(r, ms));

const waktuSekarang = () =>
    new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
    }).format(new Date()); // YYYY-MM-DD HH:mm:ss

// ---------------------------------------------------------------------------
// TRANSAKSI (begin/commit/rollback + retry deadlock di satu tempat)
// ---------------------------------------------------------------------------

async function denganTransaksi(kerja) {
    for (let percobaan = 1; ; percobaan++) {
        const conn = await db.getConnection();
        let ulang = false;
        try {
            await conn.beginTransaction();
            const hasil = await kerja(conn);
            await conn.commit();
            return hasil;
        } catch (err) {
            try { await conn.rollback(); } catch (_) { /* koneksi sudah putus */ }
            if (err?.code === 'ER_LOCK_DEADLOCK' && percobaan < MAKS_PERCOBAAN_DEADLOCK) {
                ulang = true;
            } else {
                throw err;
            }
        } finally {
            conn.release();
        }
        if (ulang) await tidur(50 * percobaan);
    }
}

function kirimError(res, err, label) {
    if (err instanceof BisnisError) {
        return res.status(err.status).json({ message: err.message });
    }
    if (err?.code === 'ER_LOCK_DEADLOCK' || err?.code === 'ER_LOCK_WAIT_TIMEOUT') {
        return res.status(409).json({ message: 'Faktur sedang diproses pengguna lain, silakan coba lagi.' });
    }
    console.error(`[${label}] Error:`, err);
    return res.status(500).json({ message: 'Terjadi kesalahan pada server, silakan coba lagi.' });
}

// ---------------------------------------------------------------------------
// HELPER DOMAIN
// ---------------------------------------------------------------------------

// Ambil satuan resmi (nama kanonik + rasio ke pcs). null = tidak valid/tidak terdaftar.
async function ambilSatuan(conn, kode, namaSatuan) {
    const [rows] = await conn.query(
        `SELECT nama_satuan, rasio_ke_pcs FROM barang_satuan
          WHERE kode_barang = ? AND UPPER(nama_satuan) = UPPER(?)
          LIMIT 1`,
        [kode, namaSatuan]
    );
    if (rows.length > 0) {
        const rasio = Number(rows[0].rasio_ke_pcs);
        return Number.isSafeInteger(rasio) && rasio >= 1
            ? { nama: String(rows[0].nama_satuan), rasio }
            : null;
    }
    if (String(namaSatuan).trim().toUpperCase() === 'PCS') return { nama: 'PCS', rasio: 1 };
    return null;
}

// Ubah stok dengan guard anti-minus. delta + = masuk, - = keluar.
async function ubahStok(conn, kode, deltaPcs) {
    if (deltaPcs === 0) return;
    const [r] = await conn.query(
        `UPDATE barang SET stok_pcs = stok_pcs + ?
          WHERE kode_barang = ? AND stok_pcs + ? >= 0`,
        [deltaPcs, kode, deltaPcs]
    );
    if (r.affectedRows !== 1) {
        throw tolak(409, 'Stok berubah saat transaksi diproses, silakan coba lagi.');
    }
}

// Satu baris stok_log (urutan harus sama dengan SQL_INSERT_STOK_LOG).
const barisStokLog = ({
    waktu, kode, stokAwal, perubahanPcs, satuan, qtyInput,
    noFaktur, idDetail, keterangan, idAdmin, hppPerPcs = null
}) => [
    waktu,                                   // tanggal
    kode,                                    // kode_barang
    stokAwal,                                // stok_awal
    0,                                       // pembelian
    0,                                       // penjualan
    stokAwal + perubahanPcs,                 // stok_akhir
    'PENYESUAIAN',                           // jenis_transaksi
    'BAGUS',                                 // kondisi
    Math.abs(perubahanPcs),                  // jumlah (PCS, selalu positif)
    perubahanPcs,                            // qty_perubahan (+ masuk, - keluar)
    String(satuan || 'PCS').toUpperCase().slice(0, 30), // satuan_input
    qtyInput,                                // qty_input
    'PENJUALAN',                             // referensi_tipe
    noFaktur,                                // referensi_no
    idDetail,                                // referensi_id
    hppPerPcs,                               // hpp_per_pcs
    String(keterangan).slice(0, 255),        // keterangan
    idAdmin ? String(idAdmin).slice(0, 50) : null // dibuat_oleh
];

const SQL_INSERT_STOK_LOG = `INSERT INTO stok_log (
    tanggal, kode_barang, stok_awal, pembelian, penjualan, stok_akhir,
    jenis_transaksi, kondisi, jumlah, qty_perubahan,
    satuan_input, qty_input, referensi_tipe, referensi_no, referensi_id,
    hpp_per_pcs, keterangan, dibuat_oleh
) VALUES ?`;

// Hitung total header & sisa piutang baru dari SELISIH nilai item.
// Cara selisih menjaga diskon global, cicilan (pembayaran_piutang) & potongan retur.
function hitungKeuanganBaru(header, delta) {
    const sisaLama = Number(header.sisa_piutang) || 0;
    let sisaBaru = sisaLama + delta;

    if (sisaBaru < 0) {
        if (!IZINKAN_KELEBIHAN_BAYAR) {
            throw tolak(409,
                `Perubahan ditolak: nilai faktur akan lebih kecil dari uang yang sudah dibayar ` +
                `(kelebihan ${rupiah(-sisaBaru)}). Selesaikan lewat retur/refund terlebih dahulu.`);
        }
        sisaBaru = 0;
    }
    const totalBaru = Math.max(0, (Number(header.total_harga) || 0) + delta);
    return { sisaBaru, totalBaru, deltaEfektif: sisaBaru - sisaLama };
}

async function simpanKeuanganFaktur(conn, noFaktur, keu) {
    await conn.query(
        `UPDATE penjualan_header
            SET total_harga = ?, sisa_piutang = ?, status = ?
          WHERE no_faktur = ?`,
        [keu.totalBaru, keu.sisaBaru, keu.sisaBaru <= 0 ? STATUS_LUNAS : STATUS_PIUTANG, noFaktur]
    );

    // Uang yang diterima tidak berubah; hanya potret saldo riwayat yang digeser.
    if (keu.deltaEfektif !== 0) {
        await conn.query(
            `UPDATE pembayaran_piutang_detail
                SET sisa_sebelum = GREATEST(0, CAST(sisa_sebelum AS SIGNED) + ?),
                    sisa_sesudah = GREATEST(0, CAST(sisa_sesudah AS SIGNED) + ?)
              WHERE no_faktur = ?`,
            [keu.deltaEfektif, keu.deltaEfektif, noFaktur]
        );
    }
}

async function itemSudahDiretur(conn, idDetail) {
    const [rows] = await conn.query(
        `SELECT 1 FROM retur_detail WHERE id_detail_penjualan = ? LIMIT 1`,
        [idDetail]
    );
    return rows.length > 0;
}

// ===========================================================================
// HAPUS ITEM FAKTUR
// Payload: { no_faktur, faktur: { id_detail } }
// ===========================================================================
export async function HAPUSITEMFAKTUR(req, res) {
    // Opsional: terisi kalau route memakai middleware auth yang sama dengan ProsesPesanan.
    // Kalau kosong, kolom dibuat_oleh di stok_log diisi NULL (request tidak diblokir).
    const idAdmin = req.id_admin ?? null;

    const body = adalahObjek(req.body) ? req.body : {};
    const noFaktur = bersih(body.no_faktur, 50);
    const idDetail = keInt(adalahObjek(body.faktur) ? body.faktur.id_detail : null);

    if (!noFaktur || !idDetail || idDetail < 1) {
        return res.status(400).json({ message: 'Data faktur dan id_detail wajib diisi!' });
    }

    try {
        const hasil = await denganTransaksi(async (conn) => {
            const waktu = waktuSekarang();

            // 1) Kunci header faktur
            const [headerRows] = await conn.query(
                `SELECT total_harga, sisa_piutang
                   FROM penjualan_header
                  WHERE no_faktur = ?
                  FOR UPDATE`,
                [noFaktur]
            );
            if (headerRows.length === 0) throw tolak(404, 'Faktur tidak ditemukan!');
            const header = headerRows[0];

            // 2) Item yang dihapus (selalu dari DB)
            const [itemRows] = await conn.query(
                `SELECT kode_barang, satuan, jumlah_keluar, total_harga, hpp_per_unit
                   FROM penjualan_detail
                  WHERE id_detail = ? AND no_faktur = ?
                  FOR UPDATE`,
                [idDetail, noFaktur]
            );
            if (itemRows.length === 0) throw tolak(404, 'Item faktur tidak ditemukan!');
            const item = itemRows[0];

            // 3) Item yang sudah diretur: stoknya sudah dikembalikan lewat retur
            if (await itemSudahDiretur(conn, idDetail)) {
                throw tolak(409, 'Item ini sudah pernah diretur, tidak bisa dihapus!');
            }

            // 4) Jangan sisakan faktur kosong
            if (!IZINKAN_HAPUS_ITEM_TERAKHIR) {
                const [cnt] = await conn.query(
                    `SELECT COUNT(*) AS n FROM penjualan_detail WHERE no_faktur = ?`,
                    [noFaktur]
                );
                if (Number(cnt[0].n) <= 1) {
                    throw tolak(409, 'Ini item terakhir pada faktur. Batalkan/retur faktur, bukan hapus item.');
                }
            }

            // 5) Keuangan: kurangi sebesar nilai item (cek kelebihan bayar dulu)
            const totalItem = Number(item.total_harga) || 0;
            const keu = hitungKeuanganBaru(header, -totalItem);

            // 6) Stok: hitung pcs yang dikembalikan (rasio WAJIB valid, tidak ditebak)
            const satuan = await ambilSatuan(conn, item.kode_barang, item.satuan);
            if (!satuan) {
                throw tolak(409,
                    `Satuan "${item.satuan}" pada item ini tidak lagi terdaftar, stok tidak bisa dikembalikan otomatis. Hubungi admin.`);
            }
            const jumlahLama = Number(item.jumlah_keluar) || 0;
            const pcsKembali = jumlahLama * satuan.rasio;
            if (!Number.isSafeInteger(pcsKembali) || pcsKembali <= 0) {
                throw tolak(409, 'Data jumlah item tidak valid, hubungi admin.');
            }

            const [stokRows] = await conn.query(
                `SELECT stok_pcs FROM barang WHERE kode_barang = ? FOR UPDATE`,
                [item.kode_barang]
            );
            if (stokRows.length > 0) {
                const stokAwal = Number(stokRows[0].stok_pcs) || 0;
                await ubahStok(conn, item.kode_barang, pcsKembali);

                const hppUnit = item.hpp_per_unit == null ? NaN : Number(item.hpp_per_unit);
                await conn.query(SQL_INSERT_STOK_LOG, [[
                    barisStokLog({
                        waktu,
                        kode: item.kode_barang,
                        stokAwal,
                        perubahanPcs: pcsKembali,
                        satuan: satuan.nama,
                        qtyInput: jumlahLama,
                        noFaktur,
                        idDetail,
                        keterangan: `Item dihapus dari faktur ${noFaktur}, stok dikembalikan`,
                        idAdmin,
                        hppPerPcs: Number.isFinite(hppUnit) ? bulat4(hppUnit / satuan.rasio) : null
                    })
                ]]);
            } else {
                console.warn(`[HAPUSITEMFAKTUR] barang ${item.kode_barang} tidak ada di master, stok tidak dikembalikan`);
            }

            // 7) Hapus item, simpan keuangan
            await conn.query(
                `DELETE FROM penjualan_detail WHERE id_detail = ? AND no_faktur = ?`,
                [idDetail, noFaktur]
            );
            await simpanKeuanganFaktur(conn, noFaktur, keu);

            return { total_belanja_baru: keu.totalBaru, sisa_piutang_baru: keu.sisaBaru };
        });

        return res.status(200).json({
            message: 'Berhasil menghapus item dan memperbarui faktur',
            ...hasil
        });
    } catch (err) {
        return kirimError(res, err, 'HAPUSITEMFAKTUR');
    }
}

// ===========================================================================
// EDIT ITEM FAKTUR (termasuk ganti barang)
// Payload: { no_faktur, faktur: { id_detail, kode_barang, satuan,
//                                 jumlah_keluar, harga_jual, diskon } }
// ===========================================================================
export async function EDITITEMFAKTUR(req, res) {
    // Opsional: terisi kalau route memakai middleware auth yang sama dengan ProsesPesanan.
    // Kalau kosong, kolom dibuat_oleh di stok_log diisi NULL (request tidak diblokir).
    const idAdmin = req.id_admin ?? null;

    const body = adalahObjek(req.body) ? req.body : {};
    const faktur = adalahObjek(body.faktur) ? body.faktur : null;

    // ---------------- VALIDASI INPUT ----------------
    const noFaktur = bersih(body.no_faktur, 50);
    if (!faktur || !noFaktur) {
        return res.status(400).json({ message: 'Data faktur dan detail item wajib diisi!' });
    }

    const idDetail = keInt(faktur.id_detail);
    const kodeBarang = bersih(faktur.kode_barang, 50);
    const satuanInput = bersih(faktur.satuan, 30);
    if (!idDetail || idDetail < 1 || !kodeBarang) {
        return res.status(400).json({ message: 'Data faktur dan detail item wajib diisi!' });
    }
    if (!satuanInput) {
        return res.status(400).json({ message: 'Satuan wajib diisi!' });
    }

    const jumlahKeluar = keInt(faktur.jumlah_keluar);
    if (!jumlahKeluar || jumlahKeluar < 1 || jumlahKeluar > MAKS_JUMLAH) {
        return res.status(400).json({
            message: `Jumlah harus bilangan bulat 1 - ${MAKS_JUMLAH.toLocaleString('id-ID')}!`
        });
    }

    // harga kosong/0 -> pakai harga resmi
    const hargaKosong = faktur.harga_jual === undefined || faktur.harga_jual === null || faktur.harga_jual === '';
    const hargaJualInput = hargaKosong ? 0 : keInt(faktur.harga_jual);
    if (hargaJualInput === null || hargaJualInput > MAKS_RUPIAH) {
        return res.status(400).json({ message: 'Harga jual harus bilangan bulat >= 0 dan wajar!' });
    }

    const diskonKosong = faktur.diskon === undefined || faktur.diskon === null || faktur.diskon === '';
    const diskonInput = diskonKosong ? 0 : keInt(faktur.diskon);
    if (diskonInput === null || diskonInput > MAKS_RUPIAH) {
        return res.status(400).json({ message: 'Diskon harus bilangan bulat >= 0 (rupiah)!' });
    }

    try {
        const hasil = await denganTransaksi(async (conn) => {
            const waktu = waktuSekarang();

            // 1) Kunci header faktur (serialisasi dengan bayar piutang / retur / edit lain)
            const [headerRows] = await conn.query(
                `SELECT total_harga, sisa_piutang
                   FROM penjualan_header
                  WHERE no_faktur = ?
                  FOR UPDATE`,
                [noFaktur]
            );
            if (headerRows.length === 0) throw tolak(404, 'Faktur tidak ditemukan!');
            const header = headerRows[0];

            // 2) Item lama
            const [oldRows] = await conn.query(
                `SELECT kode_barang, satuan, jumlah_keluar, harga_jual, diskon, total_harga, hpp_per_unit
                   FROM penjualan_detail
                  WHERE id_detail = ? AND no_faktur = ?
                  FOR UPDATE`,
                [idDetail, noFaktur]
            );
            if (oldRows.length === 0) throw tolak(404, 'Item detail faktur tidak ditemukan!');
            const oldItem = oldRows[0];

            // 3) Item yang sudah pernah diretur tidak boleh diubah
            if (await itemSudahDiretur(conn, idDetail)) {
                throw tolak(409, 'Item ini sudah pernah diretur, tidak bisa diedit!');
            }

            // 4) Satuan lama & baru (rasio wajib valid, tidak ditebak)
            const satuanLama = await ambilSatuan(conn, oldItem.kode_barang, oldItem.satuan);
            if (!satuanLama) {
                throw tolak(409,
                    `Satuan lama "${oldItem.satuan}" pada item ini tidak lagi terdaftar, stok tidak bisa dihitung otomatis. Hubungi admin.`);
            }
            const satuanBaru = await ambilSatuan(conn, kodeBarang, satuanInput);
            if (!satuanBaru) {
                throw tolak(400, `Satuan "${satuanInput}" tidak terdaftar untuk barang ini!`);
            }

            const pcsLama = (Number(oldItem.jumlah_keluar) || 0) * satuanLama.rasio;
            const pcsBaru = jumlahKeluar * satuanBaru.rasio;
            if (!Number.isSafeInteger(pcsLama) || !Number.isSafeInteger(pcsBaru) || pcsBaru < 1) {
                throw tolak(400, 'Jumlah terlalu besar atau tidak valid!');
            }

            // 5) Harga resmi bila kosong/0
            let hargaJualFinal = hargaJualInput;
            if (hargaJualFinal === 0) {
                const [hs] = await conn.query(
                    `SELECT harga_jual FROM barang_satuan
                      WHERE kode_barang = ? AND UPPER(nama_satuan) = UPPER(?)
                      LIMIT 1`,
                    [kodeBarang, satuanBaru.nama]
                );
                if (hs.length > 0) {
                    hargaJualFinal = Math.max(0, Math.round(Number(hs[0].harga_jual) || 0));
                }
                if (hargaJualFinal === 0) {
                    const [hb] = await conn.query(
                        `SELECT harga_jual_produk_ke_pelanggan FROM barang WHERE kode_barang = ?`,
                        [kodeBarang]
                    );
                    if (hb.length > 0) {
                        hargaJualFinal = Math.max(0, Math.round(Number(hb[0].harga_jual_produk_ke_pelanggan) || 0));
                    }
                }
            }
            if (hargaJualFinal <= 0) {
                throw tolak(400, 'Harga jual tidak valid: harga resmi barang/satuan ini belum diatur.');
            }

            const subtotalKotor = jumlahKeluar * hargaJualFinal;
            if (subtotalKotor > MAKS_RUPIAH) {
                throw tolak(400, `Subtotal item terlalu besar (maks ${rupiah(MAKS_RUPIAH)})!`);
            }
            if (diskonInput > subtotalKotor) {
                throw tolak(400,
                    `Diskon (${rupiah(diskonInput)}) tidak boleh melebihi subtotal item (${rupiah(subtotalKotor)})!`);
            }
            const totalItemBaru = subtotalKotor - diskonInput;

            const sama = oldItem.kode_barang === kodeBarang;

            // 6) Tidak ada perubahan sama sekali -> tidak perlu menulis apa pun
            const tanpaPerubahan =
                sama &&
                satuanLama.nama.toUpperCase() === satuanBaru.nama.toUpperCase() &&
                Number(oldItem.jumlah_keluar) === jumlahKeluar &&
                Number(oldItem.harga_jual) === hargaJualFinal &&
                Number(oldItem.diskon) === diskonInput;
            if (tanpaPerubahan) {
                return {
                    tanpaPerubahan: true,
                    kode_barang: kodeBarang,
                    satuan: satuanBaru.nama,
                    jumlah_keluar: jumlahKeluar,
                    harga_jual: hargaJualFinal,
                    diskon: diskonInput,
                    total_harga_item: totalItemBaru,
                    total_belanja_baru: Number(header.total_harga) || 0,
                    sisa_piutang_baru: Number(header.sisa_piutang) || 0
                };
            }

            // 7) Keuangan (cek kelebihan bayar SEBELUM menyentuh stok)
            const delta = totalItemBaru - (Number(oldItem.total_harga) || 0);
            const keu = hitungKeuanganBaru(header, delta);

            // 8) Stok: kunci barang dengan urutan tetap (anti deadlock), snapshot stok awal
            const daftarKode = [...new Set([oldItem.kode_barang, kodeBarang])].sort();
            const [stokRows] = await conn.query(
                `SELECT kode_barang, stok_pcs FROM barang
                  WHERE kode_barang IN (?)
                  ORDER BY kode_barang
                  FOR UPDATE`,
                [daftarKode]
            );
            const stokAwal = new Map(stokRows.map((r) => [r.kode_barang, Number(r.stok_pcs) || 0]));

            if (!stokAwal.has(kodeBarang)) throw tolak(404, 'Barang tidak ditemukan!');

            const lamaAdaDiMaster = stokAwal.has(oldItem.kode_barang);
            const stokTersedia = sama
                ? stokAwal.get(kodeBarang) + pcsLama     // stok lama dikembalikan dulu
                : stokAwal.get(kodeBarang);
            if (stokTersedia < pcsBaru) {
                throw tolak(409,
                    `Stok tidak mencukupi! Stok tersedia: ${stokTersedia} pcs, dibutuhkan: ${pcsBaru} pcs.`);
            }

            const idItem = idDetail;
            const logRows = [];

            if (sama) {
                const net = pcsLama - pcsBaru; // + stok kembali, - stok keluar
                if (net !== 0) {
                    await ubahStok(conn, kodeBarang, net);
                    logRows.push(barisStokLog({
                        waktu, kode: kodeBarang, stokAwal: stokAwal.get(kodeBarang),
                        perubahanPcs: net, satuan: 'PCS', qtyInput: Math.abs(net),
                        noFaktur, idDetail: idItem, idAdmin,
                        keterangan: `Edit item faktur ${noFaktur}: ${pcsLama} pcs -> ${pcsBaru} pcs`
                    }));
                }
            } else {
                if (lamaAdaDiMaster) {
                    await ubahStok(conn, oldItem.kode_barang, pcsLama);
                    logRows.push(barisStokLog({
                        waktu, kode: oldItem.kode_barang, stokAwal: stokAwal.get(oldItem.kode_barang),
                        perubahanPcs: pcsLama, satuan: satuanLama.nama,
                        qtyInput: Number(oldItem.jumlah_keluar) || 0,
                        noFaktur, idDetail: idItem, idAdmin,
                        keterangan: `Item diganti di faktur ${noFaktur}, barang lama dikembalikan`
                    }));
                } else {
                    console.warn(`[EDITITEMFAKTUR] barang lama ${oldItem.kode_barang} tidak ada di master, stok tidak dikembalikan`);
                }
                await ubahStok(conn, kodeBarang, -pcsBaru);
                logRows.push(barisStokLog({
                    waktu, kode: kodeBarang, stokAwal: stokAwal.get(kodeBarang),
                    perubahanPcs: -pcsBaru, satuan: satuanBaru.nama, qtyInput: jumlahKeluar,
                    noFaktur, idDetail: idItem, idAdmin,
                    keterangan: `Item diganti di faktur ${noFaktur}, barang baru dipotong`
                }));
            }

            if (logRows.length > 0) {
                await conn.query(SQL_INSERT_STOK_LOG, [logRows]);
            }

            // 9) HPP per unit: ikut disesuaikan bila barang/satuan berubah
            let hppBaru = null; // null = tidak diubah
            let peringatan = null;
            const satuanBerubah = satuanLama.nama.toUpperCase() !== satuanBaru.nama.toUpperCase();
            if (!sama || satuanBerubah) {
                if (sama) {
                    // barang sama, satuan beda: pertahankan HPP historis, konversi per satuan
                    if (oldItem.hpp_per_unit != null && Number.isFinite(Number(oldItem.hpp_per_unit))) {
                        hppBaru = bulat2((Number(oldItem.hpp_per_unit) / satuanLama.rasio) * satuanBaru.rasio);
                    }
                } else {
                    // barang beda: pakai HPP per pcs dari pembelian terakhir barang baru
                    const [hr] = await conn.query(
                        `SELECT hpp_per_pcs FROM stok_log
                          WHERE kode_barang = ? AND jenis_transaksi = 'PEMBELIAN' AND hpp_per_pcs IS NOT NULL
                          ORDER BY id_stok DESC LIMIT 1`,
                        [kodeBarang]
                    );
                    if (hr.length > 0 && Number.isFinite(Number(hr[0].hpp_per_pcs))) {
                        hppBaru = bulat2(Number(hr[0].hpp_per_pcs) * satuanBaru.rasio);
                    }
                }
                if (hppBaru === null) {
                    peringatan = 'HPP item tidak dapat dihitung ulang otomatis, nilai HPP lama dipertahankan. Periksa manual.';
                    console.warn(`[EDITITEMFAKTUR] HPP tidak dihitung ulang: faktur ${noFaktur}, id_detail ${idDetail}`);
                }
            }

            // 10) Update detail & keuangan header
            await conn.query(
                `UPDATE penjualan_detail
                    SET kode_barang = ?, satuan = ?, jumlah_keluar = ?,
                        harga_jual = ?, diskon = ?, total_harga = ?,
                        hpp_per_unit = COALESCE(?, hpp_per_unit)
                  WHERE id_detail = ? AND no_faktur = ?`,
                [kodeBarang, satuanBaru.nama, jumlahKeluar, hargaJualFinal, diskonInput,
                    totalItemBaru, hppBaru, idDetail, noFaktur]
            );
            await simpanKeuanganFaktur(conn, noFaktur, keu);

            return {
                tanpaPerubahan: false,
                peringatan,
                kode_barang: kodeBarang,
                satuan: satuanBaru.nama,
                jumlah_keluar: jumlahKeluar,
                harga_jual: hargaJualFinal,
                diskon: diskonInput,
                total_harga_item: totalItemBaru,
                total_belanja_baru: keu.totalBaru,
                sisa_piutang_baru: keu.sisaBaru
            };
        });

        const { tanpaPerubahan, peringatan, ...data } = hasil;
        return res.status(200).json({
            message: tanpaPerubahan
                ? 'Tidak ada perubahan pada item'
                : 'Berhasil mengedit item dan memperbarui faktur',
            ...(peringatan ? { peringatan } : {}),
            data
        });
    } catch (err) {
        return kirimError(res, err, 'EDITITEMFAKTUR');
    }
}



export const ubahKeteranganFaktur = async (req, res) => {
  try {
   
    if (!req.id_admin) {
      return res.status(403).json({ message: 'id admin tidak ada!' });
    }

    // 2. Validasi input
    const { no_faktur, keterangan } = req.body;

    if (!no_faktur || typeof no_faktur !== 'string') {
      return res.status(400).json({ message: 'no_faktur wajib diisi' });
    }
    if (keterangan !== undefined && typeof keterangan !== 'string') {
      return res.status(400).json({ message: 'keterangan harus berupa teks' });
    }

    const keteranganBersih = (keterangan || '').trim();

    if (keteranganBersih.length > 100) { // sesuaikan dengan panjang kolom di DB
      return res.status(400).json({ message: 'Keterangan maksimal 255 karakter' });
    }

    // 3. Update (query berparameter, aman dari SQL injection)
    const [result] = await db.query(
      'UPDATE penjualan_header SET keterangan = ? WHERE no_faktur = ?',
      [keteranganBersih, no_faktur]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Faktur tidak ditemukan' });
    }

    return res.json({ message: 'Keterangan berhasil diubah', keterangan: keteranganBersih });
  } catch (error) {
    console.error('ubahKeteranganFaktur error:', error);
    return res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
};
