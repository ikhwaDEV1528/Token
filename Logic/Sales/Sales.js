import { db } from "../../db.js";
import { randomUUID } from 'node:crypto';

const MIN_KEYWORD_LENGTH = 2;
const MAX_KEYWORD_LENGTH = 100;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;

// Escape karakter wildcard supaya input user "%" atau "_" tidak dianggap wildcard
const escapeLike = (str) => str.replace(/[\\%_]/g, '\\$&');

export async function Cari_seles(req, res) {
  try {
    const rawName = req.query.nama_sales;
    const nama = typeof rawName === 'string' ? rawName.trim() : '';

    if (!nama) {
      return res.status(400).json({
        message: 'Nama sales wajib diisi!',
      });
    }

    if (nama.length < MIN_KEYWORD_LENGTH || nama.length > MAX_KEYWORD_LENGTH) {
      return res.status(400).json({
        message: `Nama sales harus ${MIN_KEYWORD_LENGTH}-${MAX_KEYWORD_LENGTH} karakter!`,
      });
    }

    let limit = parseInt(req.query.limit, 10);
    if (!Number.isInteger(limit) || limit < 1) limit = DEFAULT_LIMIT;
    limit = Math.min(limit, MAX_LIMIT);

    const keyword = escapeLike(nama);

    const [sales] = await db.query(
      `SELECT id_admin, username, role
       FROM admin
       WHERE role = 'Sales'
         AND username LIKE ?
       ORDER BY
         (username = ?) DESC,      -- persis sama paling atas
         (username LIKE ?) DESC,   -- diawali keyword berikutnya
         username ASC
       LIMIT ?`,
      [`%${keyword}%`, nama, `${keyword}%`, limit]
    );

    return res.status(200).json({
      message: sales.length
        ? 'Berhasil ambil data sales!'
        : 'Sales tidak ditemukan',
      total: sales.length,
      sales,
    });
  } catch (err) {
    console.error('[Cari_seles]', err);
    return res.status(500).json({
      message: 'Internal server error',
    });
  }
}





// AMBIL PENJUALAN SALES //



/* ------------------------------------------------------------------ */
/* Konfigurasi                                                         */
/* ------------------------------------------------------------------ */
const QUERY_TIMEOUT_MS = 20_000;
const MAX_RANGE_DAYS = 366;
const MAX_SALES_NAME_LENGTH = 100;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/* ------------------------------------------------------------------ */
/* Helper tanggal (UTC, tanpa dependency)                              */
/* ------------------------------------------------------------------ */
function parseIsoDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const valid =
    dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  return valid ? dt : null;
}

const toIsoDate = (dt) => dt.toISOString().slice(0, 10);
const addDays = (dt, n) => new Date(dt.getTime() + n * DAY_MS);

/* ------------------------------------------------------------------ */
/* Validasi input                                                      */
/* ------------------------------------------------------------------ */
function validateInput(req) {
  // GET seharusnya memakai query string; body tetap didukung agar FE lama tidak rusak.
  const input = { ...(req.body ?? {}), ...(req.query ?? {}) };

  const namaSales = typeof input.nama_sales === 'string' ? input.nama_sales.trim() : '';
  if (!namaSales) {
    return { error: 'nama_sales wajib diisi.' };
  }
  if (namaSales.length > MAX_SALES_NAME_LENGTH) {
    return { error: `nama_sales maksimal ${MAX_SALES_NAME_LENGTH} karakter.` };
  }

  const start = parseIsoDate(input.tanggalstart);
  const end = parseIsoDate(input.tanggalend);
  if (!start || !end) {
    return { error: 'tanggalstart dan tanggalend wajib berformat YYYY-MM-DD dan valid.' };
  }
  if (start > end) {
    return { error: 'tanggalstart tidak boleh lebih besar dari tanggalend.' };
  }
  if ((end - start) / DAY_MS > MAX_RANGE_DAYS) {
    return { error: `Rentang tanggal maksimal ${MAX_RANGE_DAYS} hari.` };
  }

  return {
    value: {
      namaSales,
      tanggalStart: toIsoDate(start),
      tanggalEnd: toIsoDate(end),
      // Batas atas eksklusif: aman untuk kolom DATE maupun DATETIME.
      tanggalEndExclusive: toIsoDate(addDays(end, 1))
    }
  };
}

/* ------------------------------------------------------------------ */
/* Query                                                               */
/* ------------------------------------------------------------------ */
const SQL_REKAP_PENJUALAN_SALES = `
  SELECT
    m.kode_barang,
    COALESCE(b.nama_barang, m.kode_barang) AS nama_barang,

    -- MAX() membuat hasil deterministik
    COALESCE((
      SELECT MAX(bs.rasio_ke_pcs)
      FROM barang_satuan bs
      WHERE bs.kode_barang = m.kode_barang
        AND (UPPER(bs.nama_satuan) LIKE '%KARTON%' OR UPPER(bs.nama_satuan) LIKE '%DUS%')
    ), 0) AS rasio_karton,

    COALESCE((
      SELECT MAX(bs.rasio_ke_pcs)
      FROM barang_satuan bs
      WHERE bs.kode_barang = m.kode_barang
        AND (UPPER(bs.nama_satuan) LIKE '%PACK%'
          OR UPPER(bs.nama_satuan) LIKE '%BOX%'
          OR UPPER(bs.nama_satuan) LIKE '%BOKS%')
    ), 0) AS rasio_pack,

    m.qty_bulat                  AS total_qty_bulat,
    m.qty_retur_pcs              AS total_qty_retur_pcs,
    m.qty_pcs_net                AS jumlah_barang_pcs,
    m.total_harga_net            AS total_harga,
    m.baris_satuan_tidak_dikenal AS baris_satuan_tidak_dikenal
  FROM (
    SELECT
      u.kode_barang,
      SUM(u.qty_bulat)                  AS qty_bulat,
      SUM(u.qty_retur_pcs)              AS qty_retur_pcs,
      SUM(u.qty_pcs_net)                AS qty_pcs_net,
      SUM(u.total_harga_net)            AS total_harga_net,
      SUM(u.baris_satuan_tidak_dikenal) AS baris_satuan_tidak_dikenal
    FROM (
      -- 1. PENJUALAN (GROSS DIPOTONG DISKON ITEM + DISKON GLOBAL PROPORSIONAL)
    
      SELECT
        pd.kode_barang COLLATE utf8mb4_general_ci AS kode_barang,
        SUM(pd.jumlah_keluar) AS qty_bulat,
        0 AS qty_retur_pcs,
        SUM(pd.jumlah_keluar * COALESCE(bs_jual.rasio_ke_pcs, 1)) AS qty_pcs_net,
        
        -- POTONG DISKON GLOBAL PER BARANG:
        -- pd.total_harga dikurangi porsi (pd.total_harga / total_detail_faktur) * ph.diskon_global
        SUM(
          pd.total_harga - (
            (pd.total_harga / NULLIF(ph_total.total_detail_faktur, 0)) * IFNULL(ph.diskon_global, 0)
          )
        ) AS total_harga_net,

        SUM(CASE WHEN bs_jual.rasio_ke_pcs IS NULL THEN 1 ELSE 0 END) AS baris_satuan_tidak_dikenal
      FROM penjualan_header ph
      INNER JOIN penjualan_detail pd ON pd.no_faktur = ph.no_faktur
      LEFT JOIN (
        SELECT no_faktur, SUM(total_harga) AS total_detail_faktur
        FROM penjualan_detail
        GROUP BY no_faktur
      ) ph_total ON ph_total.no_faktur = ph.no_faktur
      LEFT JOIN barang_satuan bs_jual
        ON bs_jual.kode_barang = pd.kode_barang
       AND bs_jual.nama_satuan = pd.satuan
      WHERE ph.sales = ?
        AND ph.tgl_faktur >= ?
        AND ph.tgl_faktur <  ?
      GROUP BY pd.kode_barang

      UNION ALL

      -- 2. RETUR (dibebankan ke sales faktur asal; fallback ke sales faktur tujuan)
      SELECT
       rd.kode_barang COLLATE utf8mb4_general_ci AS kode_barang,
        0 AS qty_bulat,
        SUM(rd.qty_total_pcs) AS qty_retur_pcs,
        -SUM(rd.qty_total_pcs) AS qty_pcs_net,
        -SUM(rd.subtotal_retur) AS total_harga_net,
        0 AS baris_satuan_tidak_dikenal
      FROM retur_header rh
      INNER JOIN retur_detail rd ON rd.retur_id = rh.id
      LEFT JOIN penjualan_detail pd_asli ON pd_asli.id_detail = rd.id_detail_penjualan
      LEFT JOIN penjualan_header ph_asli ON ph_asli.no_faktur = pd_asli.no_faktur
      LEFT JOIN penjualan_header ph_target ON ph_target.no_faktur = rh.no_faktur
      WHERE rh.created_at >= ?
        AND rh.created_at <  ?
        AND COALESCE(ph_asli.sales, ph_target.sales) = ?
      GROUP BY rd.kode_barang
    ) u
    GROUP BY u.kode_barang
  ) m
  LEFT JOIN barang b ON b.kode_barang = m.kode_barang
  ORDER BY nama_barang ASC, m.kode_barang ASC
`;

/* ------------------------------------------------------------------ */
/* Helper angka                                                        */
/* ------------------------------------------------------------------ */
const toNumber = (v) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const roundQty = (n) => Math.round(n * 1e4) / 1e4;
const toCents = (n) => Math.round(n * 100);

/* ------------------------------------------------------------------ */
/* Controller                                                          */
/* ------------------------------------------------------------------ */
export async function GET_PENJUALAN_SALES(req, res) {
  const requestId = req.id ?? randomUUID();
  const startedAt = process.hrtime.bigint();

  res.set('Cache-Control', 'no-store');

  const { error: validationError, value } = validateInput(req);
  if (validationError) {
    return res.status(400).json({ status: 400, message: validationError, request_id: requestId });
  }

  const { namaSales, tanggalStart, tanggalEnd, tanggalEndExclusive } = value;

  try {
    const [rows] = await db.query(
      { sql: SQL_REKAP_PENJUALAN_SALES, timeout: QUERY_TIMEOUT_MS },
      [
        namaSales, tanggalStart, tanggalEndExclusive, // penjualan
        tanggalStart, tanggalEndExclusive, namaSales  // retur
      ]
    );

    let totalQtyPcsCents = 0;
    let totalQtyBulat = 0;
    let totalHargaCents = 0;
    let barisSatuanTidakDikenal = 0;

    const data = rows.map((item) => {
      const jumlahBarangPcs = roundQty(toNumber(item.jumlah_barang_pcs));
      const totalQtyBulatItem = roundQty(toNumber(item.total_qty_bulat));
      const totalHarga = toNumber(item.total_harga);
      const unknown = toNumber(item.baris_satuan_tidak_dikenal);

      totalQtyPcsCents += Math.round(jumlahBarangPcs * 1e4);
      totalQtyBulat += Math.round(totalQtyBulatItem * 1e4);
      totalHargaCents += toCents(totalHarga); // jumlah dalam sen: bebas error floating point
      barisSatuanTidakDikenal += unknown;

      return {
        kode_barang: item.kode_barang,
        nama_barang: item.nama_barang,
        rasio_karton: toNumber(item.rasio_karton),
        rasio_pack: toNumber(item.rasio_pack),
        total_qty_bulat: totalQtyBulatItem,
        total_qty_retur_pcs: roundQty(toNumber(item.total_qty_retur_pcs)),
        jumlah_barang_pcs: jumlahBarangPcs,
        total_harga: totalHarga,
        baris_satuan_tidak_dikenal: unknown
      };
    });

    const durationMs = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);

    if (barisSatuanTidakDikenal > 0) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          event: 'GET_PENJUALAN_SALES_SATUAN_TIDAK_DIKENAL',
          request_id: requestId,
          nama_sales: namaSales,
          jumlah_baris: barisSatuanTidakDikenal
        })
      );
    }

    return res.status(200).json({
      status: 200,
      message: 'Berhasil mengambil data rekap penjualan sales',
      filter: { nama_sales: namaSales, tanggalstart: tanggalStart, tanggalend: tanggalEnd },
      data,
      summary: {
        total_jumlah_barang_pcs: totalQtyPcsCents / 1e4,
        total_jumlah_bulat: totalQtyBulat / 1e4,
        grand_total_harga: totalHargaCents / 100,
        baris_satuan_tidak_dikenal: barisSatuanTidakDikenal
      },
      meta: { request_id: requestId, duration_ms: durationMs, row_count: data.length }
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'GET_PENJUALAN_SALES_ERROR',
        request_id: requestId,
        code: err?.code,
        message: err?.message,
        stack: err?.stack
      })
    );

    const isTimeout =
      err?.code === 'PROTOCOL_SEQUENCE_TIMEOUT' ||
      err?.code === 'ER_QUERY_TIMEOUT' ||
      err?.code === 'ER_LOCK_WAIT_TIMEOUT';

    // Detail error TIDAK dikirim ke client (mencegah kebocoran info SQL/skema).
    return res.status(isTimeout ? 504 : 500).json({
      status: isTimeout ? 504 : 500,
      message: isTimeout
        ? 'Permintaan terlalu lama diproses. Persempit rentang tanggal lalu coba lagi.'
        : 'Terjadi kesalahan pada server.',
      request_id: requestId
    });
  }
}