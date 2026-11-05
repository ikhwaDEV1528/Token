// import { db } from "../../db.js";

// /**
//  * Controller Laporan Laba Rugi
//  * Endpoint: GET /SERVER_LAPKEU/GET_LAPKEU?tgl_mulai=YYYY-MM-DD&tgl_selesai=YYYY-MM-DD[&strict=1]
//  *
//  * Jaminan:
//  *  - Semua query dibaca dari SATU snapshot (READ ONLY + CONSISTENT SNAPSHOT) -> angka antar bagian konsisten.
//  *  - Semua nilai uang dihitung dalam sen (integer) -> tidak ada selisih pembulatan float.
//  *  - Semua input dari user hanya lewat placeholder `?`; fragmen SQL yang disisipkan hanya konstanta/whitelist.
//  *  - Query punya batas waktu eksekusi dan jumlah laporan bersamaan dibatasi (lindungi pool DB).
//  */

// /* ============================================================================
//  * KONFIGURASI
//  * ========================================================================== */
// const STATUS_FAKTUR_BATAL = ["BATAL", "VOID", "DIBATALKAN", "CANCEL"];
// const KONDISI_KEMBALI_STOK = ["BAGUS", "BAIK"];
// const STATUS_BEBAN_DIHITUNG = ["AKTIF"];
// const STATUS_BEBAN_DIABAIKAN = ["BATAL", "VOID", "DIBATALKAN", "CANCEL", "NONAKTIF"];
// const KATEGORI_NON_OPERASIONAL = [];
// const MAX_HARI = 366;

// const BATAS_HPP_BAWAH = 0.9;
// const BATAS_HPP_ATAS = 1.1;
// const MARGIN_TIDAK_WAJAR = 0.5;
// const MAX_CONTOH_BARIS = 20;

// // Sumber HPP yang diprioritaskan:
// //  "MASTER"   : harga_dasar x (1 - diskon distributor) dari tabel barang (perilaku lama, default)
// //  "SNAPSHOT" : penjualan_detail.hpp_per_unit (HPP saat transaksi, laporan periode lama tidak berubah)
// // Yang kedua selalu jadi cadangan bila yang pertama tidak bisa dihitung.
// const PRIORITAS_HPP = "MASTER";

// // Kolom tanggal yang menentukan periode retur: "created_at" (perilaku lama) atau "tanggal_retur".
// const KOLOM_TANGGAL_RETUR = "created_at";

// const MAX_EXEC_MS = 20000; // batas waktu tiap query di sisi MySQL
// const MAX_LAPORAN_BERSAMAAN = 4; // lebih dari ini dibalas 429

// if (!["MASTER", "SNAPSHOT"].includes(PRIORITAS_HPP)) throw new Error("PRIORITAS_HPP tidak valid");
// if (!["created_at", "tanggal_retur"].includes(KOLOM_TANGGAL_RETUR)) throw new Error("KOLOM_TANGGAL_RETUR tidak valid");

// /* ============================================================================
//  * UTIL
//  * ========================================================================== */
// const num = (v) => {
//     const n = Number(v);
//     return Number.isFinite(n) ? n : 0;
// };
// const sen = (v) => Math.round(num(v) * 100);
// const rp = (c) => (c === 0 ? 0 : c / 100);

// const parseYmd = (s) => {
//     if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
//     const [y, m, d] = s.split("-").map(Number);
//     const dt = new Date(Date.UTC(y, m - 1, d));
//     return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt : null;
// };

// const labelKategori = (k) =>
//     k ? String(k).toLowerCase().split("_").filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ") : "Lain-lain";

// /* ============================================================================
//  * FRAGMEN SQL HPP
//  * ========================================================================== */
// const HINT = `/*+ MAX_EXECUTION_TIME(${Number(MAX_EXEC_MS)}) */`;

// // Nama satuan dinormalisasi di dalam derived table supaya join bisa memakai auto-key
// // (kode_barang, satuan_n) dan tidak peka spasi/huruf besar-kecil.
// const JOIN_MASTER = `
//   LEFT JOIN barang b ON b.kode_barang = pd.kode_barang
//   LEFT JOIN (
//       SELECT kode_barang, UPPER(TRIM(nama_satuan)) AS satuan_n, MAX(rasio_ke_pcs) AS rasio
//         FROM barang_satuan WHERE rasio_ke_pcs > 0
//        GROUP BY kode_barang, UPPER(TRIM(nama_satuan))
//   ) bs ON bs.kode_barang = pd.kode_barang AND bs.satuan_n = UPPER(TRIM(pd.satuan))
//   LEFT JOIN (
//       SELECT kode_barang, MAX(rasio_ke_pcs) AS rasio
//         FROM barang_satuan WHERE rasio_ke_pcs > 0
//        GROUP BY kode_barang
//   ) bx ON bx.kode_barang = pd.kode_barang`;

// // modal_bersih_besar = harga_dasar (per satuan terbesar) setelah diskon distributor
// const KOLOM_HPP = `
//   NULLIF(pd.hpp_per_unit, 0) AS hpp_snapshot,
//   COALESCE(bs.rasio, IF(UPPER(TRIM(pd.satuan)) = 'PCS', 1, NULL)) AS rasio_jual,
//   bx.rasio AS rasio_max,
//   (NULLIF(b.harga_dasar, 0) * (1 - LEAST(100, GREATEST(0, IFNULL(b.persentase_diskon_distributor, 0))) / 100)) AS modal_bersih_besar`;

// // hpp_master = (modal per pcs) x (rasio satuan jual).
// // PERBAIKAN: rasio_jual TIDAK lagi di-fallback ke 1. Satuan yang tidak dikenal menghasilkan NULL
// // (jatuh ke cadangan snapshot + masuk peringatan), bukan HPP per-pcs yang salah diam-diam.
// const lapisHpp = (inner) => `
//   SELECT t.*,
//          (t.modal_bersih_besar / GREATEST(COALESCE(t.rasio_max, 1), 1)) * t.rasio_jual AS hpp_master
//     FROM (${inner}) t`;

// const B_BAWAH = Number(BATAS_HPP_BAWAH);
// const B_ATAS = Number(BATAS_HPP_ATAS);

// const HPP_UNIT =
//     PRIORITAS_HPP === "MASTER"
//         ? `(COALESCE(u.hpp_master, u.hpp_snapshot))`
//         : `(COALESCE(u.hpp_snapshot, u.hpp_master))`;

// const SNAPSHOT_MENYIMPANG = `(u.hpp_snapshot IS NOT NULL AND u.hpp_master IS NOT NULL
//     AND (u.hpp_snapshot < u.hpp_master * ${B_BAWAH} OR u.hpp_snapshot > u.hpp_master * ${B_ATAS}))`;

// const SATUAN_TIDAK_DIKENAL = `(u.rasio_jual IS NULL)`;

// const JUAL_DI_BAWAH_MODAL = `(${HPP_UNIT} IS NOT NULL AND u.qty * ${HPP_UNIT} > u.total_harga)`;

// const MARGIN_ANEH = `(${HPP_UNIT} IS NOT NULL AND u.total_harga > 0
//     AND (u.total_harga - u.qty * ${HPP_UNIT}) / u.total_harga > ${Number(MARGIN_TIDAK_WAJAR)})`;

// const FAKTUR_WHERE = `ph.tgl_faktur >= ? AND ph.tgl_faktur < ?
//     AND (ph.status IS NULL OR UPPER(TRIM(ph.status)) NOT IN (?))`;

// const BARIS_PENJUALAN = `
//   SELECT pd.id_detail, pd.no_faktur, pd.kode_barang, pd.satuan,
//          IFNULL(pd.jumlah_keluar, 0) AS qty,
//          IFNULL(pd.total_harga, 0)   AS total_harga,
//          IFNULL(pd.diskon, 0)        AS diskon,
//          ${KOLOM_HPP}
//     FROM penjualan_detail pd
//     JOIN penjualan_header ph ON ph.no_faktur = pd.no_faktur
//     ${JOIN_MASTER}
//    WHERE ${FAKTUR_WHERE}`;

// const BARIS_RETUR_HPP = `
//   SELECT pd.id_detail, pd.kode_barang, pd.satuan,
//          IFNULL(rd.qty_total_pcs, 0) AS qty_retur_pcs,
//          ${KOLOM_HPP}
//     FROM retur_header rh
//     JOIN retur_detail rd ON rd.retur_id = rh.id
//     JOIN penjualan_detail pd ON pd.id_detail = rd.id_detail_penjualan
//     JOIN penjualan_header ph ON ph.no_faktur = pd.no_faktur
//     ${JOIN_MASTER}
//    WHERE rh.${KOLOM_TANGGAL_RETUR} >= ? AND rh.${KOLOM_TANGGAL_RETUR} < ?
//      AND (ph.status IS NULL OR UPPER(TRIM(ph.status)) NOT IN (?))
//      AND UPPER(TRIM(rd.kondisi_barang)) IN (?)`;

// /* ============================================================================
//  * QUERY
//  * ========================================================================== */
// const SQL_PENJUALAN = `
//   SELECT ${HINT}
//          ROUND(IFNULL(SUM(u.total_harga + u.diskon), 0), 2)   AS penjualan_bruto,
//          ROUND(IFNULL(SUM(u.diskon), 0), 2)                   AS diskon_barang,
//          ROUND(IFNULL(SUM(u.qty * ${HPP_UNIT}), 0), 2)        AS total_hpp,
//          COUNT(*)                                             AS jumlah_baris,
//          IFNULL(SUM(${HPP_UNIT} IS NULL), 0)                  AS baris_hpp_tidak_valid,
//          IFNULL(SUM(${SATUAN_TIDAK_DIKENAL}), 0)              AS baris_satuan_tidak_dikenal,
//          IFNULL(SUM(${SNAPSHOT_MENYIMPANG}), 0)               AS baris_hpp_menyimpang,
//          IFNULL(SUM(${JUAL_DI_BAWAH_MODAL}), 0)               AS baris_jual_di_bawah_modal,
//          IFNULL(SUM(${MARGIN_ANEH}), 0)                       AS baris_margin_tidak_wajar
//     FROM (${lapisHpp(BARIS_PENJUALAN)}) u`;

// const SQL_CONTOH_BERMASALAH = `
//   SELECT ${HINT}
//          u.no_faktur, u.kode_barang, u.satuan, u.qty, u.total_harga,
//          u.hpp_snapshot, u.hpp_master, ${HPP_UNIT} AS hpp_dipakai,
//          CASE
//            WHEN ${HPP_UNIT} IS NULL THEN 'HPP_TIDAK_DAPAT_DIHITUNG'
//            WHEN ${SATUAN_TIDAK_DIKENAL} THEN 'SATUAN_TIDAK_DIKENAL'
//            WHEN ${SNAPSHOT_MENYIMPANG} THEN 'HPP_SNAPSHOT_MENYIMPANG'
//            WHEN ${JUAL_DI_BAWAH_MODAL} THEN 'JUAL_DI_BAWAH_MODAL'
//            ELSE 'MARGIN_TIDAK_WAJAR'
//          END AS alasan
//     FROM (${lapisHpp(BARIS_PENJUALAN)}) u
//    WHERE ${HPP_UNIT} IS NULL OR ${SATUAN_TIDAK_DIKENAL} OR ${SNAPSHOT_MENYIMPANG}
//       OR ${JUAL_DI_BAWAH_MODAL} OR ${MARGIN_ANEH}
//    ORDER BY u.total_harga DESC, u.no_faktur, u.kode_barang
//    LIMIT ${Number(MAX_CONTOH_BARIS)}`;

// const SQL_HEADER = `
//   SELECT ${HINT}
//          ROUND(IFNULL(SUM(ph.diskon_global), 0), 2) AS diskon_global,
//          COUNT(*)                                   AS jumlah_faktur
//     FROM penjualan_header ph
//    WHERE ${FAKTUR_WHERE}`;

// const SQL_RETUR = `
//   SELECT ${HINT}
//          ROUND(IFNULL(SUM(rd.subtotal_retur), 0), 2)                                   AS total_retur,
//          COUNT(*)                                                                     AS jumlah_baris_retur,
//          IFNULL(SUM(rd.id_detail_penjualan IS NULL), 0)                               AS retur_tanpa_referensi,
//          IFNULL(SUM(rd.id_detail_penjualan IS NOT NULL AND pd.id_detail IS NULL), 0)   AS retur_referensi_hilang
//     FROM retur_header rh
//     JOIN retur_detail rd ON rd.retur_id = rh.id
//     LEFT JOIN penjualan_detail pd ON pd.id_detail = rd.id_detail_penjualan
//     LEFT JOIN penjualan_header ph ON ph.no_faktur = pd.no_faktur
//    WHERE rh.${KOLOM_TANGGAL_RETUR} >= ? AND rh.${KOLOM_TANGGAL_RETUR} < ?
//      AND (ph.no_faktur IS NULL OR ph.status IS NULL OR UPPER(TRIM(ph.status)) NOT IN (?))`;

// // qty_retur_pcs sudah dalam PCS; HPP_UNIT per satuan jual -> per pcs = HPP_UNIT / rasio_jual.
// const SQL_HPP_RETUR = `
//   SELECT ${HINT}
//          ROUND(IFNULL(SUM(u.qty_retur_pcs * (${HPP_UNIT} / NULLIF(u.rasio_jual, 0))), 0), 2) AS hpp_retur,
//          IFNULL(SUM(${HPP_UNIT} IS NULL OR u.rasio_jual IS NULL), 0)                         AS baris_retur_hpp_tidak_valid
//     FROM (${lapisHpp(BARIS_RETUR_HPP)}) u`;

// const SQL_OPERASIONAL = `
//   SELECT ${HINT}
//          UPPER(TRIM(kategori_beban)) AS kategori_beban,
//          ROUND(IFNULL(SUM(jumlah_biaya), 0), 2) AS total_per_kategori
//     FROM operasional
//    WHERE tanggal >= ? AND tanggal < ?
//      AND UPPER(TRIM(status)) IN (?)
//    GROUP BY UPPER(TRIM(kategori_beban))
//    ORDER BY total_per_kategori DESC, kategori_beban`;

// const SQL_OPERASIONAL_STATUS_ANEH = `
//   SELECT ${HINT}
//          COUNT(*) AS jumlah, ROUND(IFNULL(SUM(jumlah_biaya), 0), 2) AS nominal
//     FROM operasional
//    WHERE tanggal >= ? AND tanggal < ?
//      AND (status IS NULL OR UPPER(TRIM(status)) NOT IN (?))`;

// /* ============================================================================
//  * HANDLER
//  * ========================================================================== */
// let laporanAktif = 0;

// export async function GetLaporanLabaRugi(req, res) {
//     res.set("Cache-Control", "no-store");

//     const s = parseYmd(req.query?.tgl_mulai);
//     const e = parseYmd(req.query?.tgl_selesai);
//     if (!s || !e) {
//         return res.status(400).json({
//             status: false,
//             message: "Parameter tgl_mulai dan tgl_selesai wajib diisi dengan format YYYY-MM-DD.",
//         });
//     }
//     if (s > e) {
//         return res.status(400).json({ status: false, message: "Tanggal mulai tidak boleh melebihi tanggal selesai." });
//     }
//     if ((e.getTime() - s.getTime()) / 86400000 + 1 > MAX_HARI) {
//         return res.status(400).json({ status: false, message: `Rentang tanggal maksimal ${MAX_HARI} hari.` });
//     }
//     const strict = req.query?.strict === "1";

//     const mulai = s.toISOString().slice(0, 10);
//     const selesai = e.toISOString().slice(0, 10);
//     const batas = new Date(e.getTime() + 86400000).toISOString().slice(0, 10);

//     if (laporanAktif >= MAX_LAPORAN_BERSAMAAN) {
//         res.set("Retry-After", "5");
//         return res.status(429).json({ status: false, message: "Server sedang memproses laporan lain. Coba lagi sebentar." });
//     }
//     laporanAktif += 1;

//     let conn;
//     let rollbackGagal = false;
//     try {
//         conn = await db.getConnection();
//         await conn.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
//         await conn.query("START TRANSACTION READ ONLY, WITH CONSISTENT SNAPSHOT");
//         const q = async (sql, params) => (await conn.query(sql, params))[0];

//         const argsFaktur = [mulai, batas, STATUS_FAKTUR_BATAL];

//         const penjualanRows = await q(SQL_PENJUALAN, argsFaktur);
//         const contohRows = await q(SQL_CONTOH_BERMASALAH, argsFaktur);
//         const headerRows = await q(SQL_HEADER, argsFaktur);
//         const returRows = await q(SQL_RETUR, [mulai, batas, STATUS_FAKTUR_BATAL]);
//         const hppReturRows = await q(SQL_HPP_RETUR, [mulai, batas, STATUS_FAKTUR_BATAL, KONDISI_KEMBALI_STOK]);
//         const operasionalRows = await q(SQL_OPERASIONAL, [mulai, batas, STATUS_BEBAN_DIHITUNG]);
//         const bebanAnehRows = await q(SQL_OPERASIONAL_STATUS_ANEH, [
//             mulai,
//             batas,
//             [...STATUS_BEBAN_DIHITUNG, ...STATUS_BEBAN_DIABAIKAN],
//         ]);

//         const p = penjualanRows[0] ?? {};
//         const h = headerRows[0] ?? {};
//         const r = returRows[0] ?? {};
//         const hr = hppReturRows[0] ?? {};
//         const ba = bebanAnehRows[0] ?? {};

//         // ===== KALKULASI (integer sen) =====
//         const penjualanBruto = sen(p.penjualan_bruto);
//         const diskonBarang = sen(p.diskon_barang);
//         const diskonGlobal = sen(h.diskon_global);
//         const retur = sen(r.total_retur);

//         const totalDiskon = diskonBarang + diskonGlobal;
//         const jumlahPendapatan = penjualanBruto - totalDiskon - retur;
//         const hpp = sen(p.total_hpp) - sen(hr.hpp_retur);
//         const labaKotor = jumlahPendapatan - hpp;

//         const nonOp = new Set(KATEGORI_NON_OPERASIONAL.map((k) => k.toUpperCase()));
//         const rincianOperasional = [];
//         const rincianNonOperasional = [];
//         let totalOperasional = 0;
//         let totalNonOperasional = 0;

//         for (const row of operasionalRows) {
//             const kategori = row.kategori_beban ? String(row.kategori_beban).trim() : "";
//             const nominal = sen(row.total_per_kategori);
//             const item = { kategori_beban: labelKategori(kategori), total_biaya: rp(nominal) };
//             if (nonOp.has(kategori.toUpperCase())) {
//                 rincianNonOperasional.push(item);
//                 totalNonOperasional += nominal;
//             } else {
//                 rincianOperasional.push(item);
//                 totalOperasional += nominal;
//             }
//         }

//         const pendapatanOperasional = labaKotor - totalOperasional;
//         const labaBersih = pendapatanOperasional - totalNonOperasional;

//         // ===== KUALITAS DATA =====
//         const peringatan = [];
//         const tambah = (kode, jumlah, pesan, extra = {}) => {
//             if (num(jumlah) > 0) peringatan.push({ kode, jumlah: num(jumlah), pesan, ...extra });
//         };

//         tambah(
//             "HPP_TIDAK_DAPAT_DIHITUNG",
//             p.baris_hpp_tidak_valid,
//             "Baris penjualan yang HPP-nya tidak bisa dihitung (modal barang tidak lengkap). HPP baris ini dihitung 0."
//         );
//         tambah(
//             "SATUAN_TIDAK_DIKENAL",
//             p.baris_satuan_tidak_dikenal,
//             "Satuan di faktur tidak ada di barang_satuan (mungkin sudah dihapus). HPP memakai cadangan snapshot hpp_per_unit, bukan master."
//         );
//         tambah("HPP_SNAPSHOT_MENYIMPANG", p.baris_hpp_menyimpang, "hpp_per_unit di transaksi menyimpang dari modal master.");
//         tambah("MARGIN_TIDAK_WAJAR", p.baris_margin_tidak_wajar, `Baris dengan margin di atas ${MARGIN_TIDAK_WAJAR * 100}% perlu dicek.`);
//         tambah("JUAL_DI_BAWAH_MODAL", p.baris_jual_di_bawah_modal, "Baris dijual di bawah HPP.", { perlu_review: false });
//         tambah("RETUR_TANPA_REFERENSI", r.retur_tanpa_referensi, "Retur tanpa id_detail_penjualan.");
//         tambah("RETUR_REFERENSI_HILANG", r.retur_referensi_hilang, "Retur menunjuk detail penjualan yang tidak ada.");
//         tambah("RETUR_HPP_TIDAK_VALID", hr.baris_retur_hpp_tidak_valid, "Retur barang kondisi baik yang HPP-nya tidak bisa dihitung.");
//         tambah("BEBAN_STATUS_TIDAK_DIKENAL", ba.jumlah, "Beban operasional dengan status kosong/tidak dikenal TIDAK dihitung.", { nominal: rp(sen(ba.nominal)) });

//         const perluReview = peringatan.some((w) => w.perlu_review !== false);
//         const statusLaporan = perluReview ? "PERLU_REVIEW" : "LENGKAP";

//         const kualitasData = {
//             status_laporan: statusLaporan,
//             peringatan,
//             contoh_baris_bermasalah: contohRows.map((c) => ({
//                 no_faktur: c.no_faktur,
//                 kode_barang: c.kode_barang,
//                 satuan: c.satuan,
//                 qty: num(c.qty),
//                 total_harga: num(c.total_harga),
//                 hpp_snapshot: c.hpp_snapshot == null ? null : num(c.hpp_snapshot),
//                 hpp_master: c.hpp_master == null ? null : num(c.hpp_master),
//                 hpp_dipakai: c.hpp_dipakai == null ? null : num(c.hpp_dipakai),
//                 alasan: c.alasan,
//             })),
//         };

//         if (strict && perluReview) {
//             return res.status(422).json({
//                 status: false,
//                 message: "Laporan ditolak (mode strict): terdapat data yang perlu direview sebelum tutup buku.",
//                 kualitas_data: kualitasData,
//             });
//         }

//         return res.status(200).json({
//             status: true,
//             message: "Berhasil mengambil Laporan Laba Rugi",
//             periode: { tgl_mulai: mulai, tgl_selesai: selesai },
//             kontrol: {
//                 jumlah_faktur: num(h.jumlah_faktur),
//                 jumlah_baris_penjualan: num(p.jumlah_baris),
//                 jumlah_baris_retur: num(r.jumlah_baris_retur),
//                 prioritas_hpp: PRIORITAS_HPP,
//                 kolom_tanggal_retur: KOLOM_TANGGAL_RETUR,
//                 dibuat_pada: new Date().toISOString(),
//             },
//             kualitas_data: kualitasData,
//             laporan: {
//                 pendapatan: {
//                     penjualan: rp(penjualanBruto),
//                     diskon_penjualan: -rp(totalDiskon),
//                     retur_penjualan: -rp(retur),
//                     jumlah_pendapatan: rp(jumlahPendapatan),
//                 },
//                 beban_pokok_penjualan: rp(hpp),
//                 laba_kotor: rp(labaKotor),
//                 beban_operasional: { rincian: rincianOperasional, total: rp(totalOperasional) },
//                 pendapatan_operasional: rp(pendapatanOperasional),
//                 non_operasional: {
//                     total_pendapatan: 0,
//                     rincian_beban: rincianNonOperasional,
//                     total_beban: rp(totalNonOperasional),
//                     total: -rp(totalNonOperasional),
//                 },
//                 laba_bersih: rp(labaBersih),
//             },
//         });
//     } catch (error) {
//         console.error("[GetLaporanLabaRugi_Error]", error?.code, error);
//         if (error?.errno === 3024 || error?.code === "ER_QUERY_TIMEOUT") {
//             return res.status(504).json({
//                 status: false,
//                 message: "Laporan terlalu lama diproses. Persempit rentang tanggal lalu coba lagi.",
//             });
//         }
//         return res.status(500).json({
//             status: false,
//             message: "Terjadi kesalahan internal server saat memproses laporan keuangan.",
//         });
//     } finally {
//         laporanAktif -= 1;
//         if (conn) {
//             try {
//                 await conn.rollback();
//             } catch (_) {
//                 rollbackGagal = true;
//             }
//             // Koneksi yang gagal rollback jangan dikembalikan ke pool (bisa masih memegang snapshot).
//             if (rollbackGagal && typeof conn.destroy === "function") conn.destroy();
//             else conn.release();
//         }
//     }
// }




import { db } from "../../db.js";

/**
 * Controller Laporan Laba Rugi
 * Endpoint: GET /SERVER_LAPKEU/GET_LAPKEU?tgl_mulai=YYYY-MM-DD&tgl_selesai=YYYY-MM-DD[&strict=1]
 *
 * Jaminan:
 *  - Semua query dibaca dari SATU snapshot (READ ONLY + CONSISTENT SNAPSHOT) -> angka antar bagian konsisten.
 *  - Semua nilai uang dihitung dalam sen (integer) -> tidak ada selisih pembulatan float.
 *  - Semua input dari user hanya lewat placeholder `?`; fragmen SQL yang disisipkan hanya konstanta/whitelist.
 *  - Query punya batas waktu eksekusi dan jumlah laporan bersamaan dibatasi (lindungi pool DB).
 */

/* ============================================================================
 * KONFIGURASI
 * ========================================================================== */
const STATUS_FAKTUR_BATAL = ["BATAL", "VOID", "DIBATALKAN", "CANCEL"];
// KONDISI_KEMBALI_STOK dilepas karena semua retur (bagus/rusak) mengurangi HPP
const STATUS_BEBAN_DIHITUNG = ["AKTIF"];
const STATUS_BEBAN_DIABAIKAN = ["BATAL", "VOID", "DIBATALKAN", "CANCEL", "NONAKTIF"];
const KATEGORI_NON_OPERASIONAL = [];
const MAX_HARI = 366;

const BATAS_HPP_BAWAH = 0.9;
const BATAS_HPP_ATAS = 1.1;
const MARGIN_TIDAK_WAJAR = 0.5;
const MAX_CONTOH_BARIS = 20;

// Sumber HPP yang diprioritaskan:
//  "MASTER"   : harga_dasar x (1 - diskon distributor) dari tabel barang (perilaku lama, default)
//  "SNAPSHOT" : penjualan_detail.hpp_per_unit (HPP saat transaksi, laporan periode lama tidak berubah)
// Yang kedua selalu jadi cadangan bila yang pertama tidak bisa dihitung.
const PRIORITAS_HPP = "MASTER";

// Kolom tanggal yang menentukan periode retur: "created_at" (perilaku lama) atau "tanggal_retur".
const KOLOM_TANGGAL_RETUR = "created_at";

const MAX_EXEC_MS = 20000; // batas waktu tiap query di sisi MySQL
const MAX_LAPORAN_BERSAMAAN = 4; // lebih dari ini dibalas 429

if (!["MASTER", "SNAPSHOT"].includes(PRIORITAS_HPP)) throw new Error("PRIORITAS_HPP tidak valid");
if (!["created_at", "tanggal_retur"].includes(KOLOM_TANGGAL_RETUR)) throw new Error("KOLOM_TANGGAL_RETUR tidak valid");

/* ============================================================================
 * UTIL
 * ========================================================================== */
const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};
const sen = (v) => Math.round(num(v) * 100);
const rp = (c) => (c === 0 ? 0 : c / 100);

const parseYmd = (s) => {
    if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const [y, m, d] = s.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt : null;
};

const labelKategori = (k) =>
    k ? String(k).toLowerCase().split("_").filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ") : "Lain-lain";

/* ============================================================================
 * FRAGMEN SQL HPP
 * ========================================================================== */
const HINT = `/*+ MAX_EXECUTION_TIME(${Number(MAX_EXEC_MS)}) */`;

// Nama satuan dinormalisasi di dalam derived table supaya join bisa memakai auto-key
// (kode_barang, satuan_n) dan tidak peka spasi/huruf besar-kecil.
const JOIN_MASTER = `
  LEFT JOIN barang b ON b.kode_barang = pd.kode_barang
  LEFT JOIN (
      SELECT kode_barang, UPPER(TRIM(nama_satuan)) AS satuan_n, MAX(rasio_ke_pcs) AS rasio
        FROM barang_satuan WHERE rasio_ke_pcs > 0
       GROUP BY kode_barang, UPPER(TRIM(nama_satuan))
  ) bs ON bs.kode_barang = pd.kode_barang AND bs.satuan_n = UPPER(TRIM(pd.satuan))
  LEFT JOIN (
      SELECT kode_barang, MAX(rasio_ke_pcs) AS rasio
        FROM barang_satuan WHERE rasio_ke_pcs > 0
       GROUP BY kode_barang
  ) bx ON bx.kode_barang = pd.kode_barang`;

// modal_bersih_besar = harga_dasar (per satuan terbesar) setelah diskon distributor
const KOLOM_HPP = `
  NULLIF(pd.hpp_per_unit, 0) AS hpp_snapshot,
  COALESCE(bs.rasio, IF(UPPER(TRIM(pd.satuan)) = 'PCS', 1, NULL)) AS rasio_jual,
  bx.rasio AS rasio_max,
  (NULLIF(b.harga_dasar, 0) * (1 - LEAST(100, GREATEST(0, IFNULL(b.persentase_diskon_distributor, 0))) / 100)) AS modal_bersih_besar`;

// hpp_master = (modal per pcs) x (rasio satuan jual).
// PERBAIKAN: rasio_jual TIDAK lagi di-fallback ke 1. Satuan yang tidak dikenal menghasilkan NULL
// (jatuh ke cadangan snapshot + masuk peringatan), bukan HPP per-pcs yang salah diam-diam.
const lapisHpp = (inner) => `
  SELECT t.*,
         (t.modal_bersih_besar / GREATEST(COALESCE(t.rasio_max, 1), 1)) * t.rasio_jual AS hpp_master
    FROM (${inner}) t`;

const B_BAWAH = Number(BATAS_HPP_BAWAH);
const B_ATAS = Number(BATAS_HPP_ATAS);

const HPP_UNIT =
    PRIORITAS_HPP === "MASTER"
        ? `(COALESCE(u.hpp_master, u.hpp_snapshot))`
        : `(COALESCE(u.hpp_snapshot, u.hpp_master))`;

const SNAPSHOT_MENYIMPANG = `(u.hpp_snapshot IS NOT NULL AND u.hpp_master IS NOT NULL
    AND (u.hpp_snapshot < u.hpp_master * ${B_BAWAH} OR u.hpp_snapshot > u.hpp_master * ${B_ATAS}))`;

const SATUAN_TIDAK_DIKENAL = `(u.rasio_jual IS NULL)`;

const JUAL_DI_BAWAH_MODAL = `(${HPP_UNIT} IS NOT NULL AND u.qty * ${HPP_UNIT} > u.total_harga)`;

const MARGIN_ANEH = `(${HPP_UNIT} IS NOT NULL AND u.total_harga > 0
    AND (u.total_harga - u.qty * ${HPP_UNIT}) / u.total_harga > ${Number(MARGIN_TIDAK_WAJAR)})`;

const FAKTUR_WHERE = `ph.tgl_faktur >= ? AND ph.tgl_faktur < ?
    AND (ph.status IS NULL OR UPPER(TRIM(ph.status)) NOT IN (?))`;

// const BARIS_PENJUALAN = `
//   SELECT pd.id_detail, pd.no_faktur, pd.kode_barang, pd.satuan,
//          IFNULL(pd.jumlah_keluar, 0) AS qty,
//          IFNULL(pd.total_harga, 0)   AS total_harga,
//          IFNULL(pd.diskon, 0)        AS diskon,
//          ${KOLOM_HPP}
//     FROM penjualan_detail pd
//     JOIN penjualan_header ph ON ph.no_faktur = pd.no_faktur
//     ${JOIN_MASTER}
//    WHERE ${FAKTUR_WHERE}`;


const BARIS_PENJUALAN = `
  SELECT pd.id_detail, pd.no_faktur, pd.kode_barang, pd.satuan,
         (IFNULL(pd.jumlah_keluar, 0) + IFNULL(pd.qty_bonus, 0)) AS qty, -- <-- UBAH DI SINI (Penjumlahan Beli + Bonus)
         IFNULL(pd.total_harga, 0)   AS total_harga,
         IFNULL(pd.diskon, 0)        AS diskon,
         ${KOLOM_HPP}
    FROM penjualan_detail pd
    JOIN penjualan_header ph ON ph.no_faktur = pd.no_faktur
    ${JOIN_MASTER}
   WHERE ${FAKTUR_WHERE}`;

const BARIS_RETUR_HPP = `
  SELECT pd.id_detail, pd.kode_barang, pd.satuan,
         IFNULL(rd.qty_total_pcs, 0) AS qty_retur_pcs,
         ${KOLOM_HPP}
    FROM retur_header rh
    JOIN retur_detail rd ON rd.retur_id = rh.id
    JOIN penjualan_detail pd ON pd.id_detail = rd.id_detail_penjualan
    JOIN penjualan_header ph ON ph.no_faktur = pd.no_faktur
    ${JOIN_MASTER}
   WHERE rh.${KOLOM_TANGGAL_RETUR} >= ? AND rh.${KOLOM_TANGGAL_RETUR} < ?
     AND (ph.status IS NULL OR UPPER(TRIM(ph.status)) NOT IN (?))`;

/* ============================================================================
 * QUERY
 * ========================================================================== */
const SQL_PENJUALAN = `
  SELECT ${HINT}
         ROUND(IFNULL(SUM(u.total_harga + u.diskon), 0), 2)   AS penjualan_bruto,
         ROUND(IFNULL(SUM(u.diskon), 0), 2)                   AS diskon_barang,
         ROUND(IFNULL(SUM(u.qty * ${HPP_UNIT}), 0), 2)        AS total_hpp,
         COUNT(*)                                             AS jumlah_baris,
         IFNULL(SUM(${HPP_UNIT} IS NULL), 0)                  AS baris_hpp_tidak_valid,
         IFNULL(SUM(${SATUAN_TIDAK_DIKENAL}), 0)              AS baris_satuan_tidak_dikenal,
         IFNULL(SUM(${SNAPSHOT_MENYIMPANG}), 0)               AS baris_hpp_menyimpang,
         IFNULL(SUM(${JUAL_DI_BAWAH_MODAL}), 0)               AS baris_jual_di_bawah_modal,
         IFNULL(SUM(${MARGIN_ANEH}), 0)                       AS baris_margin_tidak_wajar
    FROM (${lapisHpp(BARIS_PENJUALAN)}) u`;

const SQL_CONTOH_BERMASALAH = `
  SELECT ${HINT}
         u.no_faktur, u.kode_barang, u.satuan, u.qty, u.total_harga,
         u.hpp_snapshot, u.hpp_master, ${HPP_UNIT} AS hpp_dipakai,
         CASE
           WHEN ${HPP_UNIT} IS NULL THEN 'HPP_TIDAK_DAPAT_DIHITUNG'
           WHEN ${SATUAN_TIDAK_DIKENAL} THEN 'SATUAN_TIDAK_DIKENAL'
           WHEN ${SNAPSHOT_MENYIMPANG} THEN 'HPP_SNAPSHOT_MENYIMPANG'
           WHEN ${JUAL_DI_BAWAH_MODAL} THEN 'JUAL_DI_BAWAH_MODAL'
           ELSE 'MARGIN_TIDAK_WAJAR'
         END AS alasan
    FROM (${lapisHpp(BARIS_PENJUALAN)}) u
   WHERE ${HPP_UNIT} IS NULL OR ${SATUAN_TIDAK_DIKENAL} OR ${SNAPSHOT_MENYIMPANG}
      OR ${JUAL_DI_BAWAH_MODAL} OR ${MARGIN_ANEH}
   ORDER BY u.total_harga DESC, u.no_faktur, u.kode_barang
   LIMIT ${Number(MAX_CONTOH_BARIS)}`;

const SQL_HEADER = `
  SELECT ${HINT}
         ROUND(IFNULL(SUM(ph.diskon_global), 0), 2) AS diskon_global,
         COUNT(*)                                   AS jumlah_faktur
    FROM penjualan_header ph
   WHERE ${FAKTUR_WHERE}`;

const SQL_RETUR = `
  SELECT ${HINT}
         ROUND(IFNULL(SUM(rd.subtotal_retur), 0), 2)                                   AS total_retur,
         COUNT(*)                                                                     AS jumlah_baris_retur,
         IFNULL(SUM(rd.id_detail_penjualan IS NULL), 0)                               AS retur_tanpa_referensi,
         IFNULL(SUM(rd.id_detail_penjualan IS NOT NULL AND pd.id_detail IS NULL), 0)   AS retur_referensi_hilang
    FROM retur_header rh
    JOIN retur_detail rd ON rd.retur_id = rh.id
    LEFT JOIN penjualan_detail pd ON pd.id_detail = rd.id_detail_penjualan
    LEFT JOIN penjualan_header ph ON ph.no_faktur = pd.no_faktur
   WHERE rh.${KOLOM_TANGGAL_RETUR} >= ? AND rh.${KOLOM_TANGGAL_RETUR} < ?
     AND (ph.no_faktur IS NULL OR ph.status IS NULL OR UPPER(TRIM(ph.status)) NOT IN (?))`;

// qty_retur_pcs sudah dalam PCS; HPP_UNIT per satuan jual -> per pcs = HPP_UNIT / rasio_jual.
const SQL_HPP_RETUR = `
  SELECT ${HINT}
         ROUND(IFNULL(SUM(u.qty_retur_pcs * (${HPP_UNIT} / NULLIF(u.rasio_jual, 0))), 0), 2) AS hpp_retur,
         IFNULL(SUM(${HPP_UNIT} IS NULL OR u.rasio_jual IS NULL), 0)                         AS baris_retur_hpp_tidak_valid
    FROM (${lapisHpp(BARIS_RETUR_HPP)}) u`;

const SQL_OPERASIONAL = `
  SELECT ${HINT}
         UPPER(TRIM(kategori_beban)) AS kategori_beban,
         ROUND(IFNULL(SUM(jumlah_biaya), 0), 2) AS total_per_kategori
    FROM operasional
   WHERE tanggal >= ? AND tanggal < ?
     AND UPPER(TRIM(status)) IN (?)
   GROUP BY UPPER(TRIM(kategori_beban))
   ORDER BY total_per_kategori DESC, kategori_beban`;

const SQL_OPERASIONAL_STATUS_ANEH = `
  SELECT ${HINT}
         COUNT(*) AS jumlah, ROUND(IFNULL(SUM(jumlah_biaya), 0), 2) AS nominal
    FROM operasional
   WHERE tanggal >= ? AND tanggal < ?
     AND (status IS NULL OR UPPER(TRIM(status)) NOT IN (?))`;

/* ============================================================================
 * HANDLER
 * ========================================================================== */
let laporanAktif = 0;

export async function GetLaporanLabaRugi(req, res) {
    res.set("Cache-Control", "no-store");

    const s = parseYmd(req.query?.tgl_mulai);
    const e = parseYmd(req.query?.tgl_selesai);
    if (!s || !e) {
        return res.status(400).json({
            status: false,
            message: "Parameter tgl_mulai dan tgl_selesai wajib diisi dengan format YYYY-MM-DD.",
        });
    }
    if (s > e) {
        return res.status(400).json({ status: false, message: "Tanggal mulai tidak boleh melebihi tanggal selesai." });
    }
    if ((e.getTime() - s.getTime()) / 86400000 + 1 > MAX_HARI) {
        return res.status(400).json({ status: false, message: `Rentang tanggal maksimal ${MAX_HARI} hari.` });
    }
    const strict = req.query?.strict === "1";

    const mulai = s.toISOString().slice(0, 10);
    const selesai = e.toISOString().slice(0, 10);
    const batas = new Date(e.getTime() + 86400000).toISOString().slice(0, 10);

    if (laporanAktif >= MAX_LAPORAN_BERSAMAAN) {
        res.set("Retry-After", "5");
        return res.status(429).json({ status: false, message: "Server sedang memproses laporan lain. Coba lagi sebentar." });
    }
    laporanAktif += 1;

    let conn;
    let rollbackGagal = false;
    try {
        conn = await db.getConnection();
        await conn.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
        await conn.query("START TRANSACTION READ ONLY, WITH CONSISTENT SNAPSHOT");
        const q = async (sql, params) => (await conn.query(sql, params))[0];

        const argsFaktur = [mulai, batas, STATUS_FAKTUR_BATAL];

        const penjualanRows = await q(SQL_PENJUALAN, argsFaktur);
        const contohRows = await q(SQL_CONTOH_BERMASALAH, argsFaktur);
        const headerRows = await q(SQL_HEADER, argsFaktur);
        const returRows = await q(SQL_RETUR, [mulai, batas, STATUS_FAKTUR_BATAL]);
        const hppReturRows = await q(SQL_HPP_RETUR, [mulai, batas, STATUS_FAKTUR_BATAL]);
        const operasionalRows = await q(SQL_OPERASIONAL, [mulai, batas, STATUS_BEBAN_DIHITUNG]);
        const bebanAnehRows = await q(SQL_OPERASIONAL_STATUS_ANEH, [
            mulai,
            batas,
            [...STATUS_BEBAN_DIHITUNG, ...STATUS_BEBAN_DIABAIKAN],
        ]);

        const p = penjualanRows[0] ?? {};
        const h = headerRows[0] ?? {};
        const r = returRows[0] ?? {};
        const hr = hppReturRows[0] ?? {};
        const ba = bebanAnehRows[0] ?? {};

        // ===== KALKULASI (integer sen) =====
        const penjualanBruto = sen(p.penjualan_bruto);
        const diskonBarang = sen(p.diskon_barang);
        const diskonGlobal = sen(h.diskon_global);
        const retur = sen(r.total_retur);

        const totalDiskon = diskonBarang + diskonGlobal;
        const jumlahPendapatan = penjualanBruto - totalDiskon - retur;
        const hpp = sen(p.total_hpp) - sen(hr.hpp_retur);
        const labaKotor = jumlahPendapatan - hpp;

        const nonOp = new Set(KATEGORI_NON_OPERASIONAL.map((k) => k.toUpperCase()));
        const rincianOperasional = [];
        const rincianNonOperasional = [];
        let totalOperasional = 0;
        let totalNonOperasional = 0;

        for (const row of operasionalRows) {
            const kategori = row.kategori_beban ? String(row.kategori_beban).trim() : "";
            const nominal = sen(row.total_per_kategori);
            const item = { kategori_beban: labelKategori(kategori), total_biaya: rp(nominal) };
            if (nonOp.has(kategori.toUpperCase())) {
                rincianNonOperasional.push(item);
                totalNonOperasional += nominal;
            } else {
                rincianOperasional.push(item);
                totalOperasional += nominal;
            }
        }

        const pendapatanOperasional = labaKotor - totalOperasional;
        const labaBersih = pendapatanOperasional - totalNonOperasional;

        // ===== KUALITAS DATA =====
        const peringatan = [];
        const tambah = (kode, jumlah, pesan, extra = {}) => {
            if (num(jumlah) > 0) peringatan.push({ kode, jumlah: num(jumlah), pesan, ...extra });
        };

        tambah(
            "HPP_TIDAK_DAPAT_DIHITUNG",
            p.baris_hpp_tidak_valid,
            "Baris penjualan yang HPP-nya tidak bisa dihitung (modal barang tidak lengkap). HPP baris ini dihitung 0."
        );
        tambah(
            "SATUAN_TIDAK_DIKENAL",
            p.baris_satuan_tidak_dikenal,
            "Satuan di faktur tidak ada di barang_satuan (mungkin sudah dihapus). HPP memakai cadangan snapshot hpp_per_unit, bukan master."
        );
        tambah("HPP_SNAPSHOT_MENYIMPANG", p.baris_hpp_menyimpang, "hpp_per_unit di transaksi menyimpang dari modal master.");
        tambah("MARGIN_TIDAK_WAJAR", p.baris_margin_tidak_wajar, `Baris dengan margin di atas ${MARGIN_TIDAK_WAJAR * 100}% perlu dicek.`);
        tambah("JUAL_DI_BAWAH_MODAL", p.baris_jual_di_bawah_modal, "Baris dijual di bawah HPP.", { perlu_review: false });
        tambah("RETUR_TANPA_REFERENSI", r.retur_tanpa_referensi, "Retur tanpa id_detail_penjualan.");
        tambah("RETUR_REFERENSI_HILANG", r.retur_referensi_hilang, "Retur menunjuk detail penjualan yang tidak ada.");
        tambah("RETUR_HPP_TIDAK_VALID", hr.baris_retur_hpp_tidak_valid, "Retur barang yang HPP-nya tidak bisa dihitung.");
        tambah("BEBAN_STATUS_TIDAK_DIKENAL", ba.jumlah, "Beban operasional dengan status kosong/tidak dikenal TIDAK dihitung.", { nominal: rp(sen(ba.nominal)) });

        const perluReview = peringatan.some((w) => w.perlu_review !== false);
        const statusLaporan = perluReview ? "PERLU_REVIEW" : "LENGKAP";

        const kualitasData = {
            status_laporan: statusLaporan,
            peringatan,
            contoh_baris_bermasalah: contohRows.map((c) => ({
                no_faktur: c.no_faktur,
                kode_barang: c.kode_barang,
                satuan: c.satuan,
                qty: num(c.qty),
                total_harga: num(c.total_harga),
                hpp_snapshot: c.hpp_snapshot == null ? null : num(c.hpp_snapshot),
                hpp_master: c.hpp_master == null ? null : num(c.hpp_master),
                hpp_dipakai: c.hpp_dipakai == null ? null : num(c.hpp_dipakai),
                alasan: c.alasan,
            })),
        };

        if (strict && perluReview) {
            return res.status(422).json({
                status: false,
                message: "Laporan ditolak (mode strict): terdapat data yang perlu direview sebelum tutup buku.",
                kualitas_data: kualitasData,
            });
        }

        return res.status(200).json({
            status: true,
            message: "Berhasil mengambil Laporan Laba Rugi",
            periode: { tgl_mulai: mulai, tgl_selesai: selesai },
            kontrol: {
                jumlah_faktur: num(h.jumlah_faktur),
                jumlah_baris_penjualan: num(p.jumlah_baris),
                jumlah_baris_retur: num(r.jumlah_baris_retur),
                prioritas_hpp: PRIORITAS_HPP,
                kolom_tanggal_retur: KOLOM_TANGGAL_RETUR,
                dibuat_pada: new Date().toISOString(),
            },
            kualitas_data: kualitasData,
            laporan: {
                pendapatan: {
                    penjualan: rp(penjualanBruto),
                    diskon_penjualan: -rp(totalDiskon),
                    retur_penjualan: -rp(retur),
                    jumlah_pendapatan: rp(jumlahPendapatan),
                },
                beban_pokok_penjualan: rp(hpp),
                laba_kotor: rp(labaKotor),
                beban_operasional: { rincian: rincianOperasional, total: rp(totalOperasional) },
                pendapatan_operasional: rp(pendapatanOperasional),
                non_operasional: {
                    total_pendapatan: 0,
                    rincian_beban: rincianNonOperasional,
                    total_beban: rp(totalNonOperasional),
                    total: -rp(totalNonOperasional),
                },
                laba_bersih: rp(labaBersih),
            },
        });
    } catch (error) {
        console.error("[GetLaporanLabaRugi_Error]", error?.code, error);
        if (error?.errno === 3024 || error?.code === "ER_QUERY_TIMEOUT") {
            return res.status(504).json({
                status: false,
                message: "Laporan terlalu lama diproses. Persempit rentang tanggal lalu coba lagi.",
            });
        }
        return res.status(500).json({
            status: false,
            message: "Terjadi kesalahan internal server saat memproses laporan keuangan.",
        });
    } finally {
        laporanAktif -= 1;
        if (conn) {
            try {
                await conn.rollback();
            } catch (_) {
                rollbackGagal = true;
            }
            if (rollbackGagal && typeof conn.destroy === "function") conn.destroy();
            else conn.release();
        }
    }
}
