// controllers/DashboardMonitoring.mjs
// Endpoint dashboard monitoring penjualan & pembelian.
//
// Route (contoh):
//   router.get("/dashboard/monitoring", CekRequestAkses, GET_DASHBOARD_MONITORING);
//
// Query string:
//   ?periode=hari_ini | 7_hari | 30_hari   (default: hari_ini)
//
// Aturan angka (disamakan dengan laporan & omzet sales):
//   - Penjualan = DPP faktur (tanpa PPN) dikurangi DPP retur penjualan.
//   - Faktur dihitung di tgl_faktur, retur dihitung di tanggal_retur.
//   - Pembelian = DPP pembelian (tanpa PPN).
//
// Index yang disarankan supaya query tetap cepat saat data membesar:
//   ALTER TABLE penjualan_header ADD INDEX idx_penjualan_tgl_faktur (tgl_faktur);
//   ALTER TABLE pembelian_header ADD INDEX idx_pembelian_tanggal_belanja (tanggal_belanja);
//   ALTER TABLE retur_header     ADD INDEX idx_retur_tanggal_retur (tanggal_retur);

import { db } from "../../db.js"; // <- sesuaikan: harus mysql2/promise pool

const TZ = "Asia/Jakarta";

const PERIODE = {
  hari_ini: { hari: 1, label: "Hari Ini", pembanding: "kemarin" },
  "7_hari": { hari: 7, label: "7 Hari Terakhir", pembanding: "7 hari sebelumnya" },
  "30_hari": { hari: 30, label: "30 Hari Terakhir", pembanding: "30 hari sebelumnya" },
};

// Nominal murni = dpp_total (di luar PPN). Jika dpp_total kosong/0
// (data lama sebelum kolom PPN ada), fallback ke total_harga.
const NOMINAL = "IF(COALESCE(dpp_total, 0) > 0, dpp_total, COALESCE(total_harga, 0))";

// Konfigurasi statis (BUKAN input user) sehingga aman dipakai di template SQL.
const SUMBER = {
  penjualan: {
    tabel: "penjualan_header",
    tanggal: "tgl_faktur",
    nominal: NOMINAL,
    dibayar: "COALESCE(pembayaran, 0)",
    sisa: "COALESCE(sisa_piutang, 0)",
    pihak: "kode_pelanggan",
    status: "status",
    urut: "tgl_faktur DESC, no_faktur DESC",
  },
  pembelian: {
    tabel: "pembelian_header",
    tanggal: "tanggal_belanja",
    nominal: NOMINAL,
    dibayar: "COALESCE(dibayar, 0)",
    sisa: "COALESCE(sisa_hutang, 0)",
    pihak: "nama_supplier",
    status: "status_bayar",
    urut: "tanggal_belanja DESC, id DESC",
  },
  // Retur penjualan: DPP retur murni (tanpa PPN). Fallback ke total_nominal_retur untuk data lama.
  retur: {
    tabel: "retur_header",
    tanggal: "tanggal_retur",
    nominal: "IF(COALESCE(dpp_total, 0) > 0, dpp_total, COALESCE(total_nominal_retur, 0))",
    dibayar: "0",
    sisa: "0",
  },
};

/* ----------------------------- Helper tanggal ----------------------------- */

// Tanggal hari ini (YYYY-MM-DD) menurut WIB, tidak tergantung timezone server.
const hariIniWIB = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());

const tambahHari = (ymd, n) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

/* ------------------------------ Helper angka ------------------------------ */

const angka = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

// Penyebut pakai nilai mutlak supaya arah persen tetap benar walau periode
// pembanding bernilai negatif (hari yang isinya hanya retur).
const hitungPerubahan = (sekarang, sebelumnya) => {
  if (sebelumnya === 0) return sekarang === 0 ? 0 : null; // null = tidak ada pembanding
  return Math.round(((sekarang - sebelumnya) / Math.abs(sebelumnya)) * 1000) / 10;
};

/* -------------------------------- Query ----------------------------------- */

const ambilRingkasan = async (cfg, dari, sampai) => {
  const [rows] = await db.query(
    `SELECT
        COUNT(*)                          AS jumlah,
        COALESCE(SUM(${cfg.nominal}), 0)  AS total,
        COALESCE(SUM(${cfg.dibayar}), 0)  AS dibayar,
        COALESCE(SUM(${cfg.sisa}), 0)     AS sisa
       FROM ${cfg.tabel}
      WHERE ${cfg.tanggal} >= ? AND ${cfg.tanggal} < ?`,
    [dari, sampai]
  );
  const r = rows[0] || {};
  return {
    jumlah: angka(r.jumlah),
    total: angka(r.total),
    dibayar: angka(r.dibayar),
    sisa: angka(r.sisa),
  };
};

const ambilHarian = async (cfg, dari, sampai) => {
  const [rows] = await db.query(
    `SELECT
        DATE_FORMAT(${cfg.tanggal}, '%Y-%m-%d') AS hari,
        COUNT(*)                                AS jumlah,
        COALESCE(SUM(${cfg.nominal}), 0)        AS total
       FROM ${cfg.tabel}
      WHERE ${cfg.tanggal} >= ? AND ${cfg.tanggal} < ?
      GROUP BY hari
      ORDER BY hari ASC`,
    [dari, sampai]
  );
  return rows;
};

const ambilTerbaru = async (cfg, dari, sampai, limit = 5) => {
  const [rows] = await db.query(
    `SELECT
        no_faktur,
        DATE_FORMAT(${cfg.tanggal}, '%Y-%m-%d') AS tanggal,
        ${cfg.pihak}                            AS pihak,
        ${cfg.nominal}                          AS total,
        ${cfg.status}                           AS status
       FROM ${cfg.tabel}
      WHERE ${cfg.tanggal} >= ? AND ${cfg.tanggal} < ?
      ORDER BY ${cfg.urut}
      LIMIT ?`,
    [dari, sampai, limit]
  );
  return rows.map((r) => ({
    no_faktur: r.no_faktur,
    tanggal: r.tanggal,
    pihak: r.pihak ?? "-",
    total: angka(r.total),
    status: r.status ?? "-",
  }));
};

/* ------------------------------ Transformasi ------------------------------ */

// Penjualan bersih = penjualan murni - retur penjualan.
const bentukRingkasanPenjualan = (kotorNow, kotorPrev, returNow, returPrev) => {
  const bersih = angka(kotorNow.total - returNow.total);
  const bersihPrev = angka(kotorPrev.total - returPrev.total);
  return {
    jumlah: kotorNow.jumlah,
    total: bersih,
    kotor: kotorNow.total,
    retur: returNow.total,
    jumlah_retur: returNow.jumlah,
    dibayar: kotorNow.dibayar,
    sisa: kotorNow.sisa,
    rata_rata: kotorNow.jumlah > 0 ? angka(kotorNow.total / kotorNow.jumlah) : 0,
    perubahan: {
      jumlah_pct: hitungPerubahan(kotorNow.jumlah, kotorPrev.jumlah),
      total_pct: hitungPerubahan(bersih, bersihPrev),
    },
  };
};

const bentukRingkasanPembelian = (sekarang, sebelumnya) => ({
  jumlah: sekarang.jumlah,
  total: sekarang.total,
  dibayar: sekarang.dibayar,
  sisa: sekarang.sisa,
  rata_rata: sekarang.jumlah > 0 ? angka(sekarang.total / sekarang.jumlah) : 0,
  perubahan: {
    jumlah_pct: hitungPerubahan(sekarang.jumlah, sebelumnya.jumlah),
    total_pct: hitungPerubahan(sekarang.total, sebelumnya.total),
  },
});

// Isi hari yang tidak ada transaksi dengan 0 supaya grafik tidak bolong.
// Penjualan per hari sudah dikurangi retur pada tanggal retur tersebut.
const bentukTren = (mulai, hari, barisJual, barisBeli, barisRetur) => {
  const mapJual = new Map(barisJual.map((r) => [r.hari, r]));
  const mapBeli = new Map(barisBeli.map((r) => [r.hari, r]));
  const mapRetur = new Map(barisRetur.map((r) => [r.hari, r]));

  return Array.from({ length: hari }, (_, i) => {
    const tanggal = tambahHari(mulai, i);
    const j = mapJual.get(tanggal);
    const b = mapBeli.get(tanggal);
    const r = mapRetur.get(tanggal);
    return {
      tanggal,
      penjualan: angka(angka(j?.total) - angka(r?.total)),
      jumlah_penjualan: angka(j?.jumlah),
      retur: angka(r?.total),
      pembelian: angka(b?.total),
      jumlah_pembelian: angka(b?.jumlah),
    };
  });
};

/* ------------------------------- Controller ------------------------------- */

export const GET_DASHBOARD_MONITORING = async (req, res) => {
  try {
    const kunci = String(req.query.periode ?? "hari_ini");
    const periode = PERIODE[kunci];

    if (!periode) {
      return res.status(400).json({
        success: false,
        message: "Periode tidak valid. Gunakan: hari_ini, 7_hari, atau 30_hari.",
      });
    }

    const hari = periode.hari;
    const hariIni = hariIniWIB();
    const dari = tambahHari(hariIni, -(hari - 1)); // inklusif
    const sampai = tambahHari(hariIni, 1); // eksklusif
    const dariSebelum = tambahHari(dari, -hari); // periode pembanding
    const sampaiSebelum = dari;

    const { penjualan: jual, pembelian: beli, retur } = SUMBER;

    const [
      jualNow,
      jualPrev,
      beliNow,
      beliPrev,
      returNow,
      returPrev,
      jualHarian,
      beliHarian,
      returHarian,
      jualTerbaru,
      beliTerbaru,
    ] = await Promise.all([
      ambilRingkasan(jual, dari, sampai),
      ambilRingkasan(jual, dariSebelum, sampaiSebelum),
      ambilRingkasan(beli, dari, sampai),
      ambilRingkasan(beli, dariSebelum, sampaiSebelum),
      ambilRingkasan(retur, dari, sampai),
      ambilRingkasan(retur, dariSebelum, sampaiSebelum),
      ambilHarian(jual, dari, sampai),
      ambilHarian(beli, dari, sampai),
      ambilHarian(retur, dari, sampai),
      ambilTerbaru(jual, dari, sampai),
      ambilTerbaru(beli, dari, sampai),
    ]);

    const penjualan = bentukRingkasanPenjualan(jualNow, jualPrev, returNow, returPrev);
    const pembelian = bentukRingkasanPembelian(beliNow, beliPrev);

    res.set("Cache-Control", "no-store");
    return res.status(200).json({
      success: true,
      data: {
        periode: {
          kunci,
          label: periode.label,
          pembanding: periode.pembanding,
          hari,
          dari,
          sampai: hariIni,
        },
        penjualan,
        pembelian,
        selisih: angka(penjualan.total - pembelian.total),
        tren: bentukTren(dari, hari, jualHarian, beliHarian, returHarian),
        terbaru: {
          penjualan: jualTerbaru,
          pembelian: beliTerbaru,
        },
      },
    });
  } catch (error) {
    console.error("[GET_DASHBOARD_MONITORING]", error);
    return res.status(500).json({
      success: false,
      message: "Terjadi kesalahan pada server saat memuat dashboard.",
    });
  }
};
