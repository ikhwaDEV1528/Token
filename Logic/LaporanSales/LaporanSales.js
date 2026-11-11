// dcrController.js
import { db } from "../../db.js"; // mysql2/promise pool connection


/* ============================================================
 * Error classes
 * ============================================================ */
class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}

class BusyError extends Error {
  constructor(message) {
    super(message);
    this.name = "BusyError";
  }
}

/* ============================================================
 * Konstanta & helper
 * ============================================================ */
const MAX_ITEMS = 200; // batas baris per transaksi (proteksi payload)
const INVOICE_LIMIT = 100; // batas hasil pencarian faktur (proteksi memori)
const MAX_SEARCH_LEN = 100;
const MAX_CATATAN_LEN = 255; // sesuaikan dengan panjang kolom `catatan`
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Tanggal hari ini (YYYY-MM-DD) pada zona waktu WIB, bukan UTC. */
const todayWIB = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());

/** Validasi format & keabsahan tanggal YYYY-MM-DD. */
const isValidDate = (s) => {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

/** Escape karakter wildcard LIKE agar input user tidak jadi pola. */
const escapeLike = (s) => s.replace(/[\\%_]/g, "\\$&");

const rp = (n) => `Rp ${Number(n).toLocaleString("id-ID")}`;

/* ============================================================
 * 1. GET /api/dcr/sales
 * Ambil daftar Sales (role = 'sales', tidak case-sensitive)
 * ============================================================ */
export async function getSalesList(req, res) {
  try {
    const [rows] = await db.query(
      `SELECT id_admin, username, no_hp
       FROM admin
       WHERE LOWER(TRIM(role)) = 'sales'
       ORDER BY username ASC`
    );

    return res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (error) {
    console.error("Error getSalesList:", error);
    return res.status(500).json({
      success: false,
      message: "Gagal mengambil daftar sales",
    });
  }
}

/* ============================================================
 * 2. GET /api/dcr/invoices
 * Ambil daftar faktur belum lunas (sisa_piutang > 0) per Sales / Search
 * ============================================================ */
export async function getUnpaidInvoices(req, res) {
  try {
    const sales = typeof req.query.sales === "string" ? req.query.sales.trim() : "";
    const search =
      typeof req.query.search === "string"
        ? req.query.search.trim().slice(0, MAX_SEARCH_LEN)
        : "";

    let query = `
      SELECT
        ph.no_faktur,
        ph.tgl_faktur,
        ph.jatuhtempo_faktur,
        ph.sales,
        ph.kode_pelanggan,
        p.nama_pelanggan AS nama_toko,
        p.alamat AS area_penjualan,
        CAST(ph.grand_total AS UNSIGNED) AS grand_total,
        CAST(ph.sisa_piutang AS UNSIGNED) AS sisa_piutang
      FROM penjualan_header ph
      LEFT JOIN pelanggan p ON ph.kode_pelanggan = p.kode_pelanggan
      WHERE ph.sisa_piutang > 0
    `;

    const params = [];

    // Filter Sales (Bisa ID atau Username)
    if (sales !== "") {
      query += ` AND (ph.sales = ? OR ph.id_admin = ?)`;
      params.push(sales, sales);
    }

    // Filter Search (Nama Toko / No Faktur)
    if (search !== "") {
      query += ` AND (ph.no_faktur LIKE ? OR p.nama_pelanggan LIKE ?)`;
      const term = `%${escapeLike(search)}%`;
      params.push(term, term);
    }

    // Ambil LIMIT + 1 untuk mendeteksi apakah masih ada data lain
    query += ` ORDER BY ph.jatuhtempo_faktur ASC, ph.no_faktur ASC LIMIT ?`;
    params.push(INVOICE_LIMIT + 1);

    const [rows] = await db.query(query, params);
    const hasMore = rows.length > INVOICE_LIMIT;
    const data = hasMore ? rows.slice(0, INVOICE_LIMIT) : rows;

    return res.status(200).json({
      success: true,
      count: data.length,
      has_more: hasMore,
      data,
    });
  } catch (error) {
    console.error("Error getUnpaidInvoices:", error);
    return res.status(500).json({
      success: false,
      message: "Gagal mengambil daftar faktur piutang",
    });
  }
}

/* ============================================================
 * 3. POST /api/dcr/submit
 * Eksekusi simpan transaksi setoran penagihan DCR
 * ============================================================ */
// export async function submitDCR(req, res) {
//   let connection = null;
//   let inTransaction = false;
//   let lockName = null;
//   let lockAcquired = false;

//   try {
//     const {
//       tanggal_bayar,
//       kode_pelanggan,
//       metode,
//       catatan,
//       sales,
//       area,
//       uang_disetorkan,
//       items, // Array of: { no_faktur, uang_ditagih }
//     } = req.body || {};

//     /* ---------- A. Validasi payload (sebelum mengambil koneksi pool) ---------- */
//     if (!Array.isArray(items) || items.length === 0) {
//       throw new ValidationError("Daftar penagihan faktur tidak boleh kosong!");
//     }
//     if (items.length > MAX_ITEMS) {
//       throw new ValidationError(`Maksimal ${MAX_ITEMS} faktur per transaksi.`);
//     }

//     const created_by = req.id_admin || req.user?.username || "SYSTEM";
//     const tglBayarValid = tanggal_bayar || todayWIB();
//     if (!isValidDate(tglBayarValid)) {
//       throw new ValidationError("Format tanggal bayar tidak valid (YYYY-MM-DD).");
//     }
//     const metodeBayar = metode || "TUNAI";

//     // Gabungkan baris duplikat (no_faktur sama) agar tidak terjadi overpay ganda
//     const merged = new Map(); // no_faktur -> total nominal
//     for (const item of items) {
//       const no_faktur = String(item?.no_faktur ?? "").trim();
//       if (!no_faktur) {
//         throw new ValidationError("Nomor faktur wajib diisi di setiap baris detail!");
//       }
//       const nominal = Math.round(Number(item?.uang_ditagih));
//       if (!Number.isFinite(nominal) || nominal <= 0) continue; // Lewati jika 0 / tidak valid
//       merged.set(no_faktur, (merged.get(no_faktur) || 0) + nominal);
//     }

//     if (merged.size === 0) {
//       throw new ValidationError("Tidak ada nominal uang ditagih yang valid untuk diproses.");
//     }

//     // Urutkan agar urutan penguncian baris konsisten antar request (cegah deadlock)
//     const fakturIds = [...merged.keys()].sort();
//     const totalSetoranKeseluruhan = [...merged.values()].reduce((a, b) => a + b, 0);

//     // Uang disetorkan (opsional) tidak boleh melebihi total ditagih
//     let disetor = null;
//     if (uang_disetorkan !== undefined && uang_disetorkan !== null && uang_disetorkan !== "") {
//       disetor = Math.round(Number(uang_disetorkan));
//       if (!Number.isFinite(disetor) || disetor < 0) {
//         throw new ValidationError("Nominal uang disetorkan tidak valid.");
//       }
//       if (disetor > totalSetoranKeseluruhan) {
//         throw new ValidationError(
//           `Uang disetorkan (${rp(disetor)}) melebihi total uang ditagih (${rp(totalSetoranKeseluruhan)})!`
//         );
//       }
//     }

//     /* ---------- B. Mulai transaksi ---------- */
//     connection = await db.getConnection();
//     await connection.beginTransaction();
//     inTransaction = true;

//     // Kunci semua baris faktur sekaligus (1 query, terurut) - Pessimistic Locking
//     const [fakturRows] = await connection.query(
//       `SELECT no_faktur, sisa_piutang, status
//        FROM penjualan_header
//        WHERE no_faktur IN (?)
//        ORDER BY no_faktur ASC
//        FOR UPDATE`,
//       [fakturIds]
//     );

//     const fakturMap = new Map(fakturRows.map((r) => [String(r.no_faktur), r]));
//     const detailToInsert = [];
//     const headerToUpdate = [];

//     for (const no_faktur of fakturIds) {
//       const row = fakturMap.get(no_faktur);
//       if (!row) {
//         throw new ValidationError(`Faktur ${no_faktur} tidak ditemukan!`);
//       }

//       const nominalTagih = merged.get(no_faktur);
//       const currentSisa = Number(row.sisa_piutang) || 0;

//       if (nominalTagih > currentSisa) {
//         throw new ValidationError(
//           `Nominal ditagih (${rp(nominalTagih)}) melebihi sisa piutang faktur ${no_faktur} (${rp(currentSisa)})!`
//         );
//       }

//       const newSisa = currentSisa - nominalTagih;
//       const newStatus = newSisa === 0 ? "LUNAS" : "PIUTANG";

//       detailToInsert.push({
//         no_faktur,
//         jumlah: nominalTagih,
//         sisa_sebelum: currentSisa,
//         sisa_sesudah: newSisa,
//       });

//       headerToUpdate.push({
//         no_faktur,
//         sisa_piutang: newSisa,
//         status: newStatus,
//       });
//     }

//     /* ---------- C. Generate No. Bayar (BYR-YYYYMMDD-XXXX), aman dari race ---------- */
//     const tglStr = tglBayarValid.replace(/-/g, "");
//     lockName = `dcr_no_bayar_${tglStr}`;
//     const [[lockRow]] = await connection.query(`SELECT GET_LOCK(?, 10) AS got`, [lockName]);
//     if (Number(lockRow?.got) !== 1) {
//       throw new BusyError("Server sedang sibuk memproses setoran lain. Silakan coba lagi.");
//     }
//     lockAcquired = true;

//     const [lastBayar] = await connection.query(
//       `SELECT no_bayar FROM pembayaran_piutang_header
//        WHERE no_bayar LIKE CONCAT('BYR-', ?, '-%')
//        ORDER BY no_bayar DESC LIMIT 1`,
//       [tglStr]
//     );

//     let nextSeq = 1;
//     if (lastBayar.length > 0) {
//       const parts = String(lastBayar[0].no_bayar).split("-");
//       nextSeq = (parseInt(parts[2], 10) || 0) + 1;
//     }
//     const no_bayar = `BYR-${tglStr}-${String(nextSeq).padStart(4, "0")}`;

//     /* ---------- D. Susun catatan (sertakan info DCR yang tidak punya kolom sendiri) ---------- */
//     const catatanParts = [String(catatan || "").trim() || "Setoran DCR Penagihan Sales"];
//     const salesTxt = String(sales || "").trim();
//     const areaTxt = String(area || "").trim();
//     if (salesTxt) catatanParts.push(`Sales: ${salesTxt}`);
//     if (areaTxt) catatanParts.push(`Area: ${areaTxt}`);
//     if (disetor !== null) catatanParts.push(`Disetor: ${rp(disetor)}`);
//     const catatanFinal = catatanParts.join(" | ").slice(0, MAX_CATATAN_LEN);

//     /* ---------- E. Insert header ---------- */
//     const [headerResult] = await connection.query(
//       `INSERT INTO pembayaran_piutang_header (
//         no_bayar, kode_pelanggan, tanggal_bayar, total_bayar, metode, catatan, dibuat_oleh, created_at
//       ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
//       [
//         no_bayar,
//         kode_pelanggan || "MULTI_TOKO",
//         tglBayarValid,
//         totalSetoranKeseluruhan,
//         metodeBayar,
//         catatanFinal,
//         created_by,
//       ]
//     );

//     const id_pembayaran = headerResult.insertId;

//     /* ---------- F. Bulk insert detail ---------- */
//     const detailValues = detailToInsert.map((d) => [
//       id_pembayaran,
//       d.no_faktur,
//       d.jumlah,
//       d.sisa_sebelum,
//       d.sisa_sesudah,
//     ]);

//     await connection.query(
//       `INSERT INTO pembayaran_piutang_detail (
//         id_pembayaran, no_faktur, jumlah, sisa_sebelum, sisa_sesudah
//       ) VALUES ?`,
//       [detailValues]
//     );

//     /* ---------- G. Update sisa_piutang & status di penjualan_header ---------- */
//     for (const u of headerToUpdate) {
//       const [upd] = await connection.query(
//         `UPDATE penjualan_header
//          SET sisa_piutang = ?, status = ?
//          WHERE no_faktur = ?`,
//         [u.sisa_piutang, u.status, u.no_faktur]
//       );
//       if (upd.affectedRows !== 1) {
//         throw new Error(`Gagal memperbarui faktur ${u.no_faktur}`);
//       }
//     }

//     await connection.commit();
//     inTransaction = false;

//     return res.status(200).json({
//       success: true,
//       message: "Transaksi setoran penagihan DCR berhasil disimpan!",
//       data: {
//         id_pembayaran,
//         no_bayar,
//         total_bayar: totalSetoranKeseluruhan,
//         total_faktur_terbayar: detailToInsert.length,
//       },
//     });
//   } catch (error) {
//     if (connection && inTransaction) {
//       try {
//         await connection.rollback();
//       } catch (rollbackErr) {
//         console.error("Error rollback submitDCR:", rollbackErr);
//       }
//     }
//     console.error("Error submitDCR:", error);

//     if (error instanceof ValidationError) {
//       return res.status(400).json({ success: false, message: error.message });
//     }
//     if (error instanceof BusyError) {
//       return res.status(503).json({ success: false, message: error.message });
//     }
//     if (error?.code === "ER_DUP_ENTRY") {
//       return res.status(409).json({
//         success: false,
//         message: "Terjadi bentrok penomoran setoran. Silakan coba simpan ulang.",
//       });
//     }
//     if (error?.code === "ER_LOCK_DEADLOCK" || error?.code === "ER_LOCK_WAIT_TIMEOUT") {
//       return res.status(409).json({
//         success: false,
//         message: "Data faktur sedang diproses pengguna lain. Silakan coba lagi.",
//       });
//     }

//     return res.status(500).json({
//       success: false,
//       message: "Terjadi kesalahan server saat memproses setoran DCR.",
//     });
//   } finally {
//     if (connection) {
//       if (lockAcquired) {
//         try {
//           await connection.query(`SELECT RELEASE_LOCK(?)`, [lockName]);
//         } catch (e) {
//           console.error("Error release lock:", e);
//         }
//       }
//       connection.release();
//     }
//   }
// }




import { BuatNoBayar } from "../Piutang/noBayar.js";


export async function submitDCR(req, res) {
  let connection = null;
  let inTransaction = false;

  try {
    const {
      tanggal_bayar,
      kode_pelanggan,
      metode,
      catatan,
      sales,
      area,
      uang_disetorkan,
      items, // Array of: { no_faktur, uang_ditagih }
    } = req.body || {};

    /* ---------- A. Validasi payload (sebelum mengambil koneksi pool) ---------- */
    if (!Array.isArray(items) || items.length === 0) {
      throw new ValidationError("Daftar penagihan faktur tidak boleh kosong!");
    }
    if (items.length > MAX_ITEMS) {
      throw new ValidationError(`Maksimal ${MAX_ITEMS} faktur per transaksi.`);
    }

    const created_by = req.id_admin || req.user?.username || "SYSTEM";
    const tglBayarValid = tanggal_bayar || todayWIB();
    if (!isValidDate(tglBayarValid)) {
      throw new ValidationError("Format tanggal bayar tidak valid (YYYY-MM-DD).");
    }
    const metodeBayar = metode || "TUNAI";

    // Gabungkan baris duplikat (no_faktur sama) agar tidak terjadi overpay ganda
    const merged = new Map(); // no_faktur -> total nominal
    for (const item of items) {
      const no_faktur = String(item?.no_faktur ?? "").trim();
      if (!no_faktur) {
        throw new ValidationError("Nomor faktur wajib diisi di setiap baris detail!");
      }
      const nominal = Math.round(Number(item?.uang_ditagih));
      if (!Number.isFinite(nominal) || nominal <= 0) continue; // Lewati jika 0 / tidak valid
      merged.set(no_faktur, (merged.get(no_faktur) || 0) + nominal);
    }

    if (merged.size === 0) {
      throw new ValidationError("Tidak ada nominal uang ditagih yang valid untuk diproses.");
    }

    // Urutkan agar urutan penguncian baris konsisten antar request (cegah deadlock)
    const fakturIds = [...merged.keys()].sort();
    const totalSetoranKeseluruhan = [...merged.values()].reduce((a, b) => a + b, 0);

    // Uang disetorkan (opsional) tidak boleh melebihi total ditagih
    let disetor = null;

    if (uang_disetorkan !== undefined && uang_disetorkan !== null && uang_disetorkan !== "") {
      disetor = Math.round(Number(uang_disetorkan));
      if (!Number.isFinite(disetor) || disetor < 0) {
        throw new ValidationError("Nominal uang disetorkan tidak valid.");
      }
      if (disetor > totalSetoranKeseluruhan) {
        throw new ValidationError(
          `Uang disetorkan (${rp(disetor)}) melebihi total uang ditagih (${rp(totalSetoranKeseluruhan)})!`
        );
      }
    }

    // GUARD: uang disetorkan wajib diisi dan harus sama dengan total uang ditagih
    if (disetor === null || disetor !== totalSetoranKeseluruhan) {
      throw new ValidationError(
        `Uang disetorkan (${rp(disetor || 0)}) harus sama dengan total uang ditagih (${rp(totalSetoranKeseluruhan)})!`
      );
    }


    /* ---------- B. Mulai transaksi ---------- */
    connection = await db.getConnection();
    await connection.beginTransaction();
    inTransaction = true;

    // Kunci semua baris faktur sekaligus (1 query, terurut) - Pessimistic Locking
    const [fakturRows] = await connection.query(
      `SELECT no_faktur, sisa_piutang, status
       FROM penjualan_header
       WHERE no_faktur IN (?)
       ORDER BY no_faktur ASC
       FOR UPDATE`,
      [fakturIds]
    );

    const fakturMap = new Map(fakturRows.map((r) => [String(r.no_faktur), r]));
    const detailToInsert = [];
    const headerToUpdate = [];

    for (const no_faktur of fakturIds) {
      const row = fakturMap.get(no_faktur);
      if (!row) {
        throw new ValidationError(`Faktur ${no_faktur} tidak ditemukan!`);
      }

      const nominalTagih = merged.get(no_faktur);
      const currentSisa = Number(row.sisa_piutang) || 0;

      if (nominalTagih > currentSisa) {
        throw new ValidationError(
          `Nominal ditagih (${rp(nominalTagih)}) melebihi sisa piutang faktur ${no_faktur} (${rp(currentSisa)})!`
        );
      }

      const newSisa = currentSisa - nominalTagih;
      const newStatus = newSisa === 0 ? "LUNAS" : "PIUTANG";

      detailToInsert.push({
        no_faktur,
        jumlah: nominalTagih,
        sisa_sebelum: currentSisa,
        sisa_sesudah: newSisa,
      });

      headerToUpdate.push({
        no_faktur,
        sisa_piutang: newSisa,
        status: newStatus,
      });
    }

    /* ---------- C. Generate No. Bayar (BYR-YYYYMMDD-XXXX), generator yang sama dgn BAYAR_PIUTANG ---------- */
    const tglStr = tglBayarValid.replace(/-/g, "");
    const no_bayar = await BuatNoBayar(connection, tglStr);

    /* ---------- D. Susun catatan (sertakan info DCR yang tidak punya kolom sendiri) ---------- */
    const catatanParts = [String(catatan || "").trim() || "Setoran DCR Penagihan Sales"];
    const salesTxt = String(sales || "").trim();
    const areaTxt = String(area || "").trim();
    if (salesTxt) catatanParts.push(`Sales: ${salesTxt}`);
    if (areaTxt) catatanParts.push(`Area: ${areaTxt}`);
    if (disetor !== null) catatanParts.push(`Disetor: ${rp(disetor)}`);
    const catatanFinal = catatanParts.join(" | ").slice(0, MAX_CATATAN_LEN);

    /* ---------- E. Insert header ---------- */
    const [headerResult] = await connection.query(
      `INSERT INTO pembayaran_piutang_header (
        no_bayar, kode_pelanggan, tanggal_bayar, total_bayar, metode, catatan, dibuat_oleh, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        no_bayar,
        kode_pelanggan || "MULTI_TOKO",
        tglBayarValid,
        totalSetoranKeseluruhan,
        metodeBayar,
        catatanFinal,
        created_by,
      ]
    );

    const id_pembayaran = headerResult.insertId;

    /* ---------- F. Bulk insert detail ---------- */
    const detailValues = detailToInsert.map((d) => [
      id_pembayaran,
      d.no_faktur,
      d.jumlah,
      d.sisa_sebelum,
      d.sisa_sesudah,
    ]);

    await connection.query(
      `INSERT INTO pembayaran_piutang_detail (
        id_pembayaran, no_faktur, jumlah, sisa_sebelum, sisa_sesudah
      ) VALUES ?`,
      [detailValues]
    );

    /* ---------- G. Update sisa_piutang & status di penjualan_header ---------- */
    for (const u of headerToUpdate) {
      const [upd] = await connection.query(
        `UPDATE penjualan_header
         SET sisa_piutang = ?, status = ?
         WHERE no_faktur = ?`,
        [u.sisa_piutang, u.status, u.no_faktur]
      );
      if (upd.affectedRows !== 1) {
        throw new Error(`Gagal memperbarui faktur ${u.no_faktur}`);
      }
    }

    await connection.commit();
    inTransaction = false;

    return res.status(200).json({
      success: true,
      message: "Transaksi setoran penagihan DCR berhasil disimpan!",
      data: {
        id_pembayaran,
        no_bayar,
        total_bayar: totalSetoranKeseluruhan,
        total_faktur_terbayar: detailToInsert.length,
      },
    });
  } catch (error) {
    if (connection && inTransaction) {
      try {
        await connection.rollback();
      } catch (rollbackErr) {
        console.error("Error rollback submitDCR:", rollbackErr);
      }
    }
    console.error("Error submitDCR:", error);

    if (error instanceof ValidationError) {
      return res.status(400).json({ success: false, message: error.message });
    }
    if (error instanceof BusyError) {
      return res.status(503).json({ success: false, message: error.message });
    }
    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message: "Terjadi bentrok penomoran setoran. Silakan coba simpan ulang.",
      });
    }
    if (error?.code === "ER_LOCK_DEADLOCK" || error?.code === "ER_LOCK_WAIT_TIMEOUT") {
      return res.status(409).json({
        success: false,
        message: "Data faktur sedang diproses pengguna lain. Silakan coba lagi.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Terjadi kesalahan server saat memproses setoran DCR.",
    });
  } finally {
    if (connection) connection.release();
  }
}
