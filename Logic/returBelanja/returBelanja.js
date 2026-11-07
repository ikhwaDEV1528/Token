import { db } from "../../db.js";
import { v4 as uuidv4 } from "uuid";

// HELPER: RUMUS NETTO BARIS BELANJA (FIXED & CLEAN)
export function hitungNettoBarisBelanja({
    hargaDasar,
    qty,
    persenDiskonDist
}) {
    const hargaDasarNum = Math.max(0, Number(hargaDasar) || 0);
    const qtyNum = Math.max(0, Number(qty) || 0);
    const persenDistNum = Math.max(0, Math.min(100, Number(persenDiskonDist) || 0));

    // 1. Hitung bruto
    const bruto = hargaDasarNum * qtyNum;

    // 2. Diskon Distributor / Item
    const diskonDistributorRp = bruto * (persenDistNum / 100);

    // 3. Netto murni item
    const netto = Math.max(0, bruto - diskonDistributorRp);

    return { bruto, diskonDistributorRp, netto };
}

// ENDPOINT 1: GET CARI FAKTUR PEMBELIAN
export async function CariNoFakturPembelian(req, res) {
    try {
        const inputRaw = req.query.input_no_faktur;
        if (!inputRaw || typeof inputRaw !== 'string' || inputRaw.trim() === '') {
            return res.status(400).json({ status: false, message: "Nomor faktur pembelian wajib diisi!" });
        }

        const noFakturClean = inputRaw.trim();

        // 1. Query Utama Faktur & Detail
        const [rows] = await db.query(
            `SELECT
                p.id AS id_pembelian,
                p.no_faktur,
                p.tanggal_belanja AS tgl_faktur,
                p.supplier_id AS id_supplier,
                IFNULL(p.nama_supplier, s.nama_supplier) AS nama_supplier,
                IFNULL(p.diskon, 0) AS diskon_global_faktur,
                IFNULL(p.sisa_hutang, p.total_harga) AS sisa_utang_faktur,
                pd.id AS id_detail,
                pd.kode_barang,
                IFNULL(b.nama_barang, pd.kode_barang) AS nama_barang,
                IFNULL(b.persentase_diskon_distributor, 0) AS persen_diskon_dist,
                IFNULL(pd.jumlah, 0) AS qty_beli,
                IFNULL(pd.qty_bonus, 0) AS qty_bonus,
                IFNULL(pd.harga_satuan, 0) AS harga_dasar_transaksi,
                IFNULL(pd.subtotal, 0) AS total_harga,
                IFNULL(pd.satuan, 'PCS') AS satuan_beli,

                IFNULL((
                    SELECT SUM(rpd.qty_total_pcs)
                      FROM retur_pembelian_detail rpd
                      JOIN retur_pembelian_header rph ON rpd.retur_id = rph.id
                     WHERE LOWER(TRIM(rph.no_faktur)) = LOWER(TRIM(p.no_faktur)) 
                       AND rpd.kode_barang = pd.kode_barang
                ), 0) AS total_sudah_retur_pcs

            FROM pembelian_header p
            LEFT JOIN supplier s ON p.supplier_id = s.id_supplier
            LEFT JOIN pembelian_detail pd ON p.id = pd.pembelian_id
            LEFT JOIN barang b ON pd.kode_barang = b.kode_barang
            WHERE LOWER(TRIM(p.no_faktur)) = LOWER(TRIM(?))
            ORDER BY pd.id ASC`,
            [noFakturClean]
        );

        if (!rows || rows.length === 0) {
            return res.status(404).json({ status: false, message: `Nomor Faktur Pembelian '${noFakturClean}' tidak ditemukan!` });
        }

        if (!rows[0].id_detail) {
            return res.status(400).json({ status: false, message: `Faktur '${noFakturClean}' ditemukan tapi tidak memiliki item barang!` });
        }

        // 2. Ambil Satuan Barang
        const kodeBarangList = [...new Set(rows.map(r => r.kode_barang))];
        let allSatuans = [];
        if (kodeBarangList.length > 0) {
            const [satuanRows] = await db.query(
                `SELECT kode_barang, nama_satuan, rasio_ke_pcs, level 
                 FROM barang_satuan 
                 WHERE kode_barang IN (?) 
                 ORDER BY rasio_ke_pcs DESC`,
                [kodeBarangList]
            );
            allSatuans = satuanRows || [];
        }

        // 3. Hitung total netto seluruh faktur
        const totalSubtotalFaktur = rows.reduce((acc, r) => acc + (Number(r.total_harga) || 0), 0);
        const diskonFakturGlobal = Number(rows[0].diskon_global_faktur) || 0;

        const faktorDiskonFaktur = totalSubtotalFaktur > 0
            ? Math.max(0, (totalSubtotalFaktur - diskonFakturGlobal) / totalSubtotalFaktur)
            : 1;

        const itemsFormatted = rows.map(row => {
            let listSatuans = allSatuans
                .filter(s => s.kode_barang === row.kode_barang)
                .map(s => ({
                    nama_satuan: s.nama_satuan,
                    rasio_ke_pcs: Number(s.rasio_ke_pcs) || 1,
                    level: s.level
                }));

            let rasioBeliPcs = 1;
            const matchBeli = listSatuans.find(s => s.nama_satuan.toUpperCase() === (row.satuan_beli || '').toUpperCase());
            if (matchBeli) {
                rasioBeliPcs = matchBeli.rasio_ke_pcs;
            } else {
                listSatuans.unshift({
                    nama_satuan: row.satuan_beli || 'PCS',
                    rasio_ke_pcs: 1,
                    level: 1
                });
            }

            // if (!listSatuans.some(s => s.nama_satuan.toUpperCase() === 'PCS')) {
            //     listSatuans.push({
            //         nama_satuan: 'PCS',
            //         rasio_ke_pcs: 1,
            //         level: 99
            //     });
            // }

            // listSatuans.sort((a, b) => b.rasio_ke_pcs - a.rasio_ke_pcs);

            // Hanya satuan yang sama atau lebih kecil dari satuan beli
            listSatuans = listSatuans.filter(s => s.rasio_ke_pcs <= rasioBeliPcs);

            // Fallback kalau master satuan kosong
            if (listSatuans.length === 0) {
                listSatuans.push({ nama_satuan: row.satuan_beli || 'PCS', rasio_ke_pcs: 1, level: 1 });
            }

            listSatuans.sort((a, b) => b.rasio_ke_pcs - a.rasio_ke_pcs);

            const qtyBeli = Math.max(0, Number(row.qty_beli) || 0);
            const totalBeliInPcs = qtyBeli * rasioBeliPcs;
            const sudahReturInPcs = Math.max(0, Number(row.total_sudah_retur_pcs) || 0);
            const sisaReturInPcs = Math.max(0, totalBeliInPcs - sudahReturInPcs);

            // Subtotal bersih langsung dari database (pd.subtotal = 52220)
            const nettoDistributor = Number(row.total_harga) || 0;
            const nettoAkhirBaris = nettoDistributor * faktorDiskonFaktur;

            // Harga Beli Bersih per Satuan Beli (Rp 52.220 / 1 KARTON = Rp 52.220)
            const hargaBersihPerSatuanBeli = qtyBeli > 0 ? (nettoAkhirBaris / qtyBeli) : Number(row.harga_dasar_transaksi);

            // Harga retur MURNI per PCS presisi (tanpa pembulatan dini agar tidak ada selisih Rp 4)
            const hargaReturPcs = totalBeliInPcs > 0 ? (nettoAkhirBaris / totalBeliInPcs) : 0;

            return {
                id_detail: row.id_detail,
                kode_barang: row.kode_barang,
                nama_barang: row.nama_barang,
                satuan_beli: row.satuan_beli,
                harga_dasar_transaksi: Math.round(hargaBersihPerSatuanBeli),
                rasio_beli_pcs: rasioBeliPcs,
                qty_beli: qtyBeli,
                total_beli_pcs: totalBeliInPcs,
                harga_retur_pcs: hargaReturPcs,
                sisa_retur_pcs: sisaReturInPcs,
                is_fully_returned: sisaReturInPcs <= 0,
                satuans: listSatuans
            };
        });

        return res.status(200).json({
            status: true,
            faktur: {
                id_pembelian: rows[0].id_pembelian,
                no_faktur: rows[0].no_faktur,
                tgl_faktur: rows[0].tgl_faktur,
                id_supplier: rows[0].id_supplier,
                nama_supplier: rows[0].nama_supplier || '-',
                diskon_global_faktur: Number(rows[0].diskon_global_faktur),
                sisa_utang_faktur: Number(rows[0].sisa_utang_faktur),
                items: itemsFormatted
            }
        });

    } catch (error) {
        console.error("[CariNoFakturPembelian_Error]", error);
        return res.status(500).json({ status: false, message: "Terjadi kesalahan server saat mencari faktur." });
    }
}









// ============================================================================
// PROSES RETUR BELANJA (retur pembelian ke supplier, metode potong hutang)
//
// Cara pasang: tempel SEMUA isi file ini menggantikan fungsi ProsesReturBelanja
// yang lama (helper di bawah ikut ditempel di atasnya). Import `db` tidak
// diubah. Jalankan afkir_migration.sql dulu.
//
// Konsep:
//   - Barang BAGUS  -> stok master (barang.stok_pcs) berkurang.
//   - Barang RUSAK  -> diambil dari tumpukan barang_afkir secara FIFO (id_afkir
//                      terkecil dulu). Stok jual TIDAK berubah.
//   - barang_afkir.qty_pcs (kejadian asli & nilai kerugian) TIDAK PERNAH diubah.
//     Yang berkurang hanya qty_sisa. Tiap pengambilan dicatat di
//     barang_afkir_alokasi (jejak audit: retur mana mengambil afkir yang mana).
//   - Semua dalam satu transaksi; kalau ada yang gagal, semuanya batal.
// ============================================================================

const RB_MAKS_ITEM = 100;
const RB_MAKS_QTY = 1_000_000;
const RB_MAKS_PERCOBAAN = 3;

// true  = nilai retur ikut dikurangi porsi diskon faktur (sesuai uang yang benar-benar terutang)
const RB_ALOKASI_DISKON_FAKTUR = true;
// true  = retur ditolak kalau nilainya melebihi sisa hutang (sama seperti retur penjualan)
// false = sisa hutang dipotong sampai 0, selisihnya diabaikan
const RB_TOLAK_JIKA_MELEBIHI_HUTANG = true;

class ReturBelanjaError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.name = 'ReturBelanjaError';
        this.status = status;
    }
}

const rbInt = (v) => {
    const s = String(v ?? '').trim();
    return /^\d+$/.test(s) ? Number(s) : NaN;
};
const rbRupiah = (n) => Number(n).toLocaleString('id-ID');
const rbBulat4 = (n) => Math.round(Number(n) * 10000) / 10000;
const rbTidur = (ms) => new Promise((r) => setTimeout(r, ms));

// Waktu WIB (UTC+7) independen dari timezone server
function rbWaktuWIB() {
    const w = new Date(Date.now() + 7 * 60 * 60 * 1000);
    const p = (n) => String(n).padStart(2, '0');
    return {
        yyyymmdd: `${w.getUTCFullYear()}${p(w.getUTCMonth() + 1)}${p(w.getUTCDate())}`,
        sql: `${w.getUTCFullYear()}-${p(w.getUTCMonth() + 1)}-${p(w.getUTCDate())} ` +
            `${p(w.getUTCHours())}:${p(w.getUTCMinutes())}:${p(w.getUTCSeconds())}`
    };
}

// ----------------------------------------------------------------------------
// VALIDASI PAYLOAD (murni, tanpa DB)
// ----------------------------------------------------------------------------
function rbParse(body) {
    const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};

    const noFaktur = typeof b.no_faktur === 'string' ? b.no_faktur.trim() : '';
    if (!noFaktur || noFaktur.length > 100) throw new ReturBelanjaError('Nomor faktur tidak valid!');

    const catatan = b.catatan == null ? '' : String(b.catatan).trim();
    if (catatan.length > 500) throw new ReturBelanjaError('Catatan retur maksimal 500 karakter!');

    if (!Array.isArray(b.items) || b.items.length === 0) {
        throw new ReturBelanjaError('Minimal pilih 1 barang untuk diretur!');
    }
    if (b.items.length > RB_MAKS_ITEM) {
        throw new ReturBelanjaError(`Jumlah barang melebihi batas (maks ${RB_MAKS_ITEM} item). Pecah menjadi beberapa retur.`);
    }

    const seen = new Set();
    const items = [];
    b.items.forEach((it, i) => {
        if (!it || typeof it !== 'object' || Array.isArray(it)) {
            throw new ReturBelanjaError(`Data item retur ke-${i + 1} tidak valid!`);
        }
        // Baris dengan qty kosong / 0 dianggap tidak dipilih (diabaikan, seperti sebelumnya)
        const rawQty = String(it.qty_retur_input ?? '').trim();
        if (rawQty === '' || rawQty === '0') return;

        const idDetail = rbInt(it.id_detail_pembelian);
        const qty = rbInt(rawQty);
        const satuan = String(it.satuan_retur ?? 'PCS').trim() || 'PCS';
        // Pada fungsi rbParse di file Backend:
        let rawKondisi = String(it.kondisi_barang || it.sumber_stok || 'BAGUS').trim().toUpperCase();
        let kondisi = (rawKondisi === 'RUSAK' || rawKondisi === 'AFKIR' || rawKondisi === 'AFVAL') ? 'RUSAK' : 'BAGUS';


        const alasan = String(it.alasan_retur ?? '').trim();

        if (!Number.isSafeInteger(idDetail) || idDetail <= 0) {
            throw new ReturBelanjaError(`ID detail pembelian item ke-${i + 1} tidak valid!`);
        }
        if (!Number.isSafeInteger(qty) || qty <= 0 || qty > RB_MAKS_QTY) {
            throw new ReturBelanjaError(`Jumlah retur item ke-${i + 1} harus bilangan bulat 1 - ${RB_MAKS_QTY}!`);
        }
        if (satuan.length > 30) throw new ReturBelanjaError(`Satuan retur item ke-${i + 1} terlalu panjang!`);
        if (kondisi !== 'BAGUS' && kondisi !== 'RUSAK') {
            throw new ReturBelanjaError('Kondisi barang hanya BAGUS atau RUSAK!');
        }
        if (alasan.length > 255) throw new ReturBelanjaError('Alasan retur maksimal 255 karakter!');

        const key = `${idDetail}|${satuan.toUpperCase()}|${kondisi}`;
        if (seen.has(key)) {
            throw new ReturBelanjaError(`Barang ganda pada daftar retur (ID ${idDetail}, ${satuan}, ${kondisi}). Gabungkan jadi 1 baris!`);
        }
        seen.add(key);

        items.push({ idDetail, qty, satuan, kondisi, alasan });
    });

    if (items.length === 0) throw new ReturBelanjaError('Tidak ada barang valid untuk diretur!');

    // Urutan tetap -> urutan lock tetap (anti-deadlock)
    items.sort((a, b) => a.idDetail - b.idDetail || a.kondisi.localeCompare(b.kondisi));
    return { noFaktur, catatan, items };
}

// ----------------------------------------------------------------------------
// NOMOR RETUR (urut, atomik; tabel retur_beli_sequence ada di afkir_migration.sql)
// ----------------------------------------------------------------------------
async function rbBuatNoRetur(conn, yyyymmdd) {
    const [r] = await conn.query(
        `INSERT INTO retur_beli_sequence (tanggal, last_seq) VALUES (?, 1)
         ON DUPLICATE KEY UPDATE last_seq = LAST_INSERT_ID(last_seq + 1)`,
        [yyyymmdd]
    );
    let seq;
    if (r.affectedRows === 1) seq = 1;
    else if (r.affectedRows === 2) seq = r.insertId;
    else throw new Error(`Gagal membuat nomor retur belanja (affectedRows ${r.affectedRows})`);
    return `RB-${yyyymmdd}-${String(seq).padStart(4, '0')}`;
}

// ----------------------------------------------------------------------------
// TRANSAKSI + ULANG OTOMATIS KALAU DEADLOCK
// ----------------------------------------------------------------------------
async function rbJalankan(kerja) {
    for (let percobaan = 1; ; percobaan++) {
        const conn = await db.getConnection();
        let ulang = false;
        try {
            await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
            await conn.beginTransaction();
            const hasil = await kerja(conn);
            await conn.commit();
            return hasil;
        } catch (err) {
            try { await conn.rollback(); } catch (_) { /* koneksi sudah putus */ }
            if (err?.code === 'ER_LOCK_DEADLOCK' && percobaan < RB_MAKS_PERCOBAAN) ulang = true;
            else throw err;
        } finally {
            conn.release();
        }
        if (ulang) await rbTidur(50 * percobaan);
    }
}

function rbKirimError(res, err) {
    if (err instanceof ReturBelanjaError) {
        return res.status(err.status).json({ status: false, message: err.message });
    }
    if (err?.code === 'ER_LOCK_DEADLOCK' || err?.code === 'ER_LOCK_WAIT_TIMEOUT') {
        return res.status(409).json({ status: false, message: 'Data sedang diproses pengguna lain, silakan coba lagi.' });
    }
    if (err?.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ status: false, message: 'Nomor retur bentrok, silakan coba lagi.' });
    }
    console.error('[ProsesReturBelanja_Error]', err);
    return res.status(500).json({ status: false, message: 'Gagal memproses retur belanja.' });
}

// ----------------------------------------------------------------------------
// INTI PROSES (berjalan di dalam transaksi)
// ----------------------------------------------------------------------------
async function rbProses(conn, { noFaktur, catatan, items }, idAdmin) {
    const waktu = rbWaktuWIB();


    // 🔴 KODE BARU (Ambil persen PPN juga):
    // 🔴 TAMBAHKAN IFNULL(diskon_faktur, 0) AS diskon_faktur
    const kolomHeader = 'id, no_faktur, supplier_id, subtotal, IFNULL(diskon, 0) AS diskon_faktur, IFNULL(ppn_persen, 0) AS ppn_persen, total_harga, sisa_hutang';
    let [fk] = await conn.query(
        `SELECT ${kolomHeader} FROM pembelian_header WHERE no_faktur = ? FOR UPDATE`,
        [noFaktur]
    );
    if (fk.length === 0) {
        // jaga-jaga data lama yang tersimpan dengan spasi di ujung
        [fk] = await conn.query(
            `SELECT ${kolomHeader} FROM pembelian_header WHERE TRIM(no_faktur) = ? FOR UPDATE`,
            [noFaktur]
        );
    }
    if (fk.length === 0) throw new ReturBelanjaError('Faktur Pembelian tidak ditemukan!', 404);

    const faktur = fk[0];
    const idPembelian = faktur.id;
    const idSupplier = faktur.supplier_id;
    const sisaHutang = faktur.sisa_hutang == null
        ? Number(faktur.total_harga) || 0
        : Number(faktur.sisa_hutang) || 0;

    if (RB_TOLAK_JIKA_MELEBIHI_HUTANG && sisaHutang <= 0) {
        throw new ReturBelanjaError(`Faktur ${faktur.no_faktur} sudah lunas / tidak punya sisa hutang. Retur potong hutang ditolak.`);
    }

    // 2. DATA PEMBANTU (batch, tanpa query per item) ----------------------------
    const detailIds = [...new Set(items.map((i) => i.idDetail))];
    const [detailRows] = await conn.query(
        `SELECT id, kode_barang, jumlah, satuan AS satuan_beli, subtotal
           FROM pembelian_detail
          WHERE pembelian_id = ? AND id IN (?)
          ORDER BY id
            FOR UPDATE`,
        [idPembelian, detailIds]
    );
    const detailMap = new Map(detailRows.map((r) => [Number(r.id), { ...r, sudah_pcs: 0, sudah_nominal: 0 }]));
    for (const id of detailIds) {
        if (!detailMap.has(id)) throw new ReturBelanjaError(`Detail pembelian ID ${id} tidak ditemukan pada faktur ini!`, 404);
    }

    // yang sudah diretur dihitung per BARIS DETAIL (bukan per kode barang)
    const [sudahRows] = await conn.query(
        `SELECT id_detail_pembelian AS id, SUM(qty_total_pcs) AS pcs, SUM(subtotal_retur) AS nominal
           FROM retur_pembelian_detail
          WHERE id_detail_pembelian IN (?)
          GROUP BY id_detail_pembelian`,
        [detailIds]
    );
    for (const r of sudahRows) {
        const d = detailMap.get(Number(r.id));
        if (d) {
            d.sudah_pcs = Number(r.pcs) || 0;
            d.sudah_nominal = Number(r.nominal) || 0;
        }
    }

    const kodeList = [...new Set([...detailMap.values()].map((d) => d.kode_barang))];
    const [satuanRows] = await conn.query(
        `SELECT kode_barang, nama_satuan, rasio_ke_pcs, level FROM barang_satuan WHERE kode_barang IN (?)`,
        [kodeList]
    );
    const satuanMap = new Map(satuanRows.map((r) => [`${r.kode_barang}|${String(r.nama_satuan).toUpperCase()}`, r]));

    // 🔴 KODE PERBAIKAN AKURAT (DPP Murni):
    const subtotalHeader = Number(faktur.subtotal) || 0;
    const diskonFaktur = Number(faktur.diskon_faktur || faktur.diskon) || 0;
    // Hitung total DPP faktur setelah dipotong diskon faktur (52.220 - 1.000 = 51.220)
    const totalDppFaktur = subtotalHeader - diskonFaktur;

    const rasioFaktur = RB_ALOKASI_DISKON_FAKTUR && subtotalHeader > 0
        ? Math.max(0, totalDppFaktur / subtotalHeader)
        : 1;

    const noRetur = await rbBuatNoRetur(conn, waktu.yyyymmdd);

    // 3. HITUNG SEMUA ITEM DI SERVER ------------------------------------------
    let grandTotal = 0;
    const barisDetail = [];
    const kejadian = [];

    for (const it of items) {
        const d = detailMap.get(it.idDetail);

        const beli = satuanMap.get(`${d.kode_barang}|${String(d.satuan_beli).toUpperCase()}`);
        const retur = satuanMap.get(`${d.kode_barang}|${it.satuan.toUpperCase()}`);
        if (!beli || !(Number(beli.rasio_ke_pcs) > 0)) {
            throw new ReturBelanjaError(`Satuan pembelian "${d.satuan_beli}" barang ${d.kode_barang} tidak ditemukan di master satuan! Hubungi admin.`);
        }
        if (!retur || !(Number(retur.rasio_ke_pcs) > 0)) {
            throw new ReturBelanjaError(`Satuan retur "${it.satuan}" tidak valid untuk barang ${d.kode_barang}!`);
        }
        if ((Number(retur.level) || 0) > (Number(beli.level) || 0)) {
            throw new ReturBelanjaError(`Satuan retur "${it.satuan}" tidak boleh lebih besar dari satuan pembelian "${d.satuan_beli}" (barang ${d.kode_barang})!`);
        }

        const rasioBeli = Number(beli.rasio_ke_pcs);
        const rasioRetur = Number(retur.rasio_ke_pcs);
        const qtyPcs = it.qty * rasioRetur;
        const totalBeliPcs = Number(d.jumlah) * rasioBeli;
        const sisaPcs = totalBeliPcs - d.sudah_pcs;

        if (!Number.isSafeInteger(qtyPcs) || qtyPcs > sisaPcs) {
            throw new ReturBelanjaError(
                `Qty retur ${d.kode_barang} (${it.qty} ${it.satuan}) melebihi sisa yang dapat diretur! ` +
                `Maksimal: ${Math.floor(Math.max(0, sisaPcs) / rasioRetur)} ${it.satuan} (${Math.max(0, sisaPcs)} PCS).`
            );
        }

        // Nilai dari subtotal yang TERSIMPAN saat belanja (bukan diskon barang saat ini yang bisa sudah berubah)
        const subtotalTersimpan = Number(d.subtotal);
        if (!Number.isFinite(subtotalTersimpan) || subtotalTersimpan <= 0 || totalBeliPcs <= 0) {
            throw new ReturBelanjaError(`Data nilai pembelian barang ${d.kode_barang} tidak valid! Hubungi admin.`);
        }
        const nettoBaris = Math.round(subtotalTersimpan * rasioFaktur);

        // Kumulatif -> tanpa selisih rupiah antar retur parsial
        const kumulatif = Math.round((nettoBaris * (d.sudah_pcs + qtyPcs)) / totalBeliPcs);
        const subtotalRetur = Math.max(0, kumulatif - d.sudah_nominal);
        const hargaPerPcs = rbBulat4(nettoBaris / totalBeliPcs);

        d.sudah_pcs += qtyPcs;
        d.sudah_nominal += subtotalRetur;
        grandTotal += subtotalRetur;

        barisDetail.push([
            null, it.idDetail, d.kode_barang, it.satuan, rasioRetur, it.qty, qtyPcs,
            Math.round(subtotalRetur / it.qty), hargaPerPcs, subtotalRetur, it.alasan, waktu.sql
        ]);
        kejadian.push({
            idx: barisDetail.length - 1, kode: d.kode_barang, kondisi: it.kondisi,
            qtyPcs, qtyInput: it.qty, satuan: it.satuan, hppPcs: hargaPerPcs, alasan: it.alasan
        });
    }

    // 🔴 KODE BARU (Hitung PPN dan Tambah ke Total Potong Hutang):
    const dppTotalRetur = grandTotal;
    const ppnPersen = Number(faktur.ppn_persen) || 0;
    const ppnNominalRetur = Math.round((dppTotalRetur * ppnPersen) / 100);
    const grandTotalRetur = dppTotalRetur + ppnNominalRetur; // Total Potong Hutang include PPN

    if (!(grandTotalRetur > 0)) throw new ReturBelanjaError('Total nilai retur 0, retur tidak dapat diproses!');

    if (RB_TOLAK_JIKA_MELEBIHI_HUTANG && grandTotalRetur > sisaHutang) {
        throw new ReturBelanjaError(
            `Total potong hutang retur include PPN (Rp ${rbRupiah(grandTotalRetur)}) lebih besar dari sisa hutang faktur ${faktur.no_faktur} ` +
            `(Rp ${rbRupiah(sisaHutang)}). Retur ditolak.`
        );
    }


    if (kejadian.some((k) => k.kondisi === 'RUSAK') && !idSupplier) {
        throw new ReturBelanjaError('Faktur ini tidak punya data supplier, barang rusak tidak bisa dikembalikan. Hubungi admin.');
    }



    // 4. HEADER + DETAIL RETUR --------------------------------------------------

    const [hasilHeader] = await conn.query(
        `INSERT INTO retur_pembelian_header
           (no_retur, no_faktur, tanggal_retur, metode_penyelesaian, total_nominal_retur, dpp_total, ppn_persen, ppn_nominal, grand_total, catatan,
            created_at, updated_at, jumlah_potong_hutang, jumlah_refund_kas)
         VALUES (?, ?, ?, 'POTONG_HUTANG', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        [noRetur, faktur.no_faktur, waktu.sql, dppTotalRetur, dppTotalRetur, ppnPersen, ppnNominalRetur, grandTotalRetur, catatan, waktu.sql, waktu.sql, grandTotalRetur]
    );


    const idReturHeader = hasilHeader.insertId;
    for (const baris of barisDetail) baris[0] = idReturHeader;

    const [hasilDetail] = await conn.query(
        `INSERT INTO retur_pembelian_detail
           (retur_id, id_detail_pembelian, kode_barang, satuan_retur, rasio_ke_pcs, qty_input, qty_total_pcs,
            harga_satuan, harga_per_pcs, subtotal_retur, alasan_retur, created_at)
         VALUES ?`,
        [barisDetail]
    );
    // INSERT multi-baris: id berurutan mulai dari insertId
    const idDetailPertama = Number(hasilDetail.insertId) || null;
    const idRetDetail = (idx) => (idDetailPertama ? idDetailPertama + idx : null);

    // 5. STOK MASTER (barang BAGUS) ---------------------------------------------
    const kodeSemua = [...new Set(kejadian.map((k) => k.kode))].sort();
    const [stokRows] = await conn.query(
        `SELECT kode_barang, stok_pcs FROM barang WHERE kode_barang IN (?) ORDER BY kode_barang FOR UPDATE`,
        [kodeSemua]
    );
    const saldo = new Map(stokRows.map((r) => [r.kode_barang, Number(r.stok_pcs) || 0]));
    for (const kode of kodeSemua) {
        if (!saldo.has(kode)) throw new ReturBelanjaError(`Barang [${kode}] tidak ditemukan di master barang!`);
    }

    const keluarBagus = new Map();
    for (const k of kejadian) {
        if (k.kondisi === 'BAGUS') keluarBagus.set(k.kode, (keluarBagus.get(k.kode) || 0) + k.qtyPcs);
    }
    for (const [kode, total] of keluarBagus) {
        if (saldo.get(kode) < total) {
            throw new ReturBelanjaError(`Gagal Retur! Stok barang [${kode}] tidak mencukupi (tersedia ${saldo.get(kode)} PCS, dibutuhkan ${total} PCS).`);
        }
        const [u] = await conn.query(
            `UPDATE barang SET stok_pcs = stok_pcs - ? WHERE kode_barang = ? AND stok_pcs >= ?`,
            [total, kode, total]
        );
        if (u.affectedRows !== 1) throw new ReturBelanjaError('Stok berubah saat diproses, silakan coba lagi.', 409);
    }

    // 6. AFKIR FIFO (barang RUSAK) ----------------------------------------------
    const kodeRusak = [...new Set(kejadian.filter((k) => k.kondisi === 'RUSAK').map((k) => k.kode))].sort();
    const pool = new Map(); // kode -> [{ id_afkir, awal, sisa, status_klaim, id_supplier }]
    if (kodeRusak.length > 0) {
        const [afkirRows] = await conn.query(
            `SELECT id_afkir, kode_barang, qty_sisa, status_klaim, id_supplier
               FROM barang_afkir
              WHERE kode_barang IN (?) AND qty_sisa > 0
              ORDER BY kode_barang, id_afkir
                FOR UPDATE`,
            [kodeRusak]
        );
        for (const r of afkirRows) {
            if (!pool.has(r.kode_barang)) pool.set(r.kode_barang, []);
            pool.get(r.kode_barang).push({
                id_afkir: r.id_afkir, awal: Number(r.qty_sisa), sisa: Number(r.qty_sisa),
                status_klaim: r.status_klaim, id_supplier: r.id_supplier
            });
        }
    }

    const alokasi = [];
    for (const k of kejadian) {
        if (k.kondisi !== 'RUSAK') continue;
        const baris = pool.get(k.kode) || [];
        const tersedia = baris.reduce((a, r) => a + r.sisa, 0);
        if (tersedia < k.qtyPcs) {
            throw new ReturBelanjaError(
                `Gagal Retur! Stok barang rusak (afkir) [${k.kode}] hanya ${tersedia} PCS, dibutuhkan ${k.qtyPcs} PCS.`
            );
        }
        let butuh = k.qtyPcs;
        for (const r of baris) {
            if (butuh <= 0) break;
            if (r.sisa <= 0) continue;
            const ambil = Math.min(r.sisa, butuh);
            r.sisa -= ambil;
            butuh -= ambil;
            alokasi.push({ id_afkir: r.id_afkir, kode: k.kode, qty: ambil, hppPcs: k.hppPcs, idx: k.idx });
        }
    }

    for (const baris of pool.values()) {
        for (const r of baris) {
            if (r.sisa === r.awal) continue;
            const habis = r.sisa === 0;
            const [u] = await conn.query(
                `UPDATE barang_afkir SET qty_sisa = ?, status_klaim = ?, id_supplier = ?
                  WHERE id_afkir = ? AND qty_sisa = ?`,
                [r.sisa, habis ? 'PROSES_SUPPLIER' : r.status_klaim, habis ? idSupplier : r.id_supplier, r.id_afkir, r.awal]
            );
            if (u.affectedRows !== 1) throw new ReturBelanjaError('Data afkir berubah saat diproses, silakan coba lagi.', 409);
        }
    }

    if (alokasi.length > 0) {
        await conn.query(
            `INSERT INTO barang_afkir_alokasi
               (id_afkir, no_retur_beli, id_retur_detail_beli, id_supplier, qty_pcs, hpp_per_pcs, created_at, dibuat_oleh)
             VALUES ?`,
            [alokasi.map((a) => [a.id_afkir, noRetur, idRetDetail(a.idx), idSupplier, a.qty, a.hppPcs, waktu.sql, idAdmin])]
        );
    }

    // 7. STOK_LOG per kejadian (stok jual; barang rusak = perubahan 0) ------------
    const logRows = kejadian.map((k) => {
        const awal = saldo.get(k.kode);
        const bagus = k.kondisi === 'BAGUS';
        const akhir = bagus ? awal - k.qtyPcs : awal; // barang rusak tidak mengubah stok jual
        saldo.set(k.kode, akhir);
        const ket = bagus
            ? (k.alasan ? `Retur belanja ${noRetur}: ${k.alasan}` : `Retur pembelian faktur ${faktur.no_faktur}`)
            : `Retur belanja ${noRetur}: barang rusak diambil dari stok afkir${k.alasan ? ` (${k.alasan})` : ''}`;
        return [
            waktu.sql,                                   // tanggal
            k.kode,                                      // kode_barang
            awal,                                        // stok_awal
            0,                                           // pembelian
            0,                                           // penjualan
            akhir,                                       // stok_akhir
            'RETUR_BELANJA',                             // jenis_transaksi
            k.kondisi,                                   // kondisi
            k.qtyPcs,                                    // jumlah (PCS, positif)
            bagus ? -k.qtyPcs : 0,                       // qty_perubahan
            String(k.satuan).toUpperCase().slice(0, 30), // satuan_input
            k.qtyInput,                                  // qty_input
            'RETUR_BELANJA',                             // referensi_tipe
            noRetur,                                     // referensi_no
            idRetDetail(k.idx),                          // referensi_id
            k.hppPcs,                                    // hpp_per_pcs
            ket.slice(0, 255),                           // keterangan
            idAdmin,                                     // dibuat_oleh
            waktu.sql                                    // created_at
        ];
    });
    await conn.query(
        `INSERT INTO stok_log (
            tanggal, kode_barang, stok_awal, pembelian, penjualan, stok_akhir,
            jenis_transaksi, kondisi, jumlah, qty_perubahan, satuan_input, qty_input,
            referensi_tipe, referensi_no, referensi_id, hpp_per_pcs, keterangan, dibuat_oleh, created_at
        ) VALUES ?`,
        [logRows]
    );

    // 8. POTONG HUTANG (header sudah terkunci, nilai dihitung di server) ----------
    const sisaBaru = RB_TOLAK_JIKA_MELEBIHI_HUTANG ? sisaHutang - grandTotalRetur : Math.max(0, sisaHutang - grandTotalRetur);
    await conn.query(
        `UPDATE pembelian_header SET sisa_hutang = ?, status_bayar = ? WHERE id = ?`,
        [sisaBaru, sisaBaru > 0 ? 'HUTANG' : 'LUNAS', idPembelian]
    );

    // ringkasan pengambilan afkir (untuk ditampilkan di FE kalau perlu)
    const ringkasAfkir = new Map();
    for (const a of alokasi) {
        const key = a.id_afkir;
        ringkasAfkir.set(key, { id_afkir: key, kode_barang: a.kode, qty_pcs: (ringkasAfkir.get(key)?.qty_pcs || 0) + a.qty });
    }

    return {
        no_retur: noRetur,
        dpp_retur: dppTotalRetur,
        ppn_persen: ppnPersen,
        ppn_nominal: ppnNominalRetur,
        total_potongan_utang: grandTotalRetur,
        sisa_utang_sekarang: sisaBaru,
        alokasi_afkir: [...ringkasAfkir.values()]
    };
}

// ----------------------------------------------------------------------------
// HANDLER
// ----------------------------------------------------------------------------
export async function ProsesReturBelanja(req, res) {
    let input;
    try {
        input = rbParse(req.body);
    } catch (err) {
        return rbKirimError(res, err);
    }
    const idAdmin = req.id_admin ? String(req.id_admin).slice(0, 50) : null;

    try {
        const hasil = await rbJalankan((conn) => rbProses(conn, input, idAdmin));
        return res.status(200).json({ status: true, message: 'Retur Belanja berhasil diproses!', ...hasil });
    } catch (err) {
        return rbKirimError(res, err);
    }
}
