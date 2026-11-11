import express from "express";
import { EDITITEMFAKTUR, HAPUSITEMFAKTUR, ubahTglPengiriman } from "../../Logic/Faktur/Faktur.js";
import { getKewajibanRefund, selesaikanRefund } from "../../Logic/Refund/Refund.js";
import { CekRequestAkses } from "../../middleware/Token/cek_request_akses.js";
import { ubahKeteranganFaktur } from "../../Logic/Faktur/Faktur.js";
import { doubleCsrfProtection } from "../../configurasiCrsf.js";
import { TAMBAHITEMFAKTUR } from "../../Logic/Faktur/Faktur.js";
import { HAPUSFAKTUR } from "../../Logic/Faktur/Faktur.js";

const Faktur = express.Router();

Faktur.post('/HAPUS_FAKTUR' ,CekRequestAkses , doubleCsrfProtection, HAPUSITEMFAKTUR);
Faktur.put('/EDIT_FAKTUR' ,CekRequestAkses , doubleCsrfProtection, EDITITEMFAKTUR)
Faktur.get('/REFUND' , getKewajibanRefund)
Faktur.post('/selesaikan-refund' ,CekRequestAkses , doubleCsrfProtection, selesaikanRefund)
Faktur.post('/UBAH_KETERANGAN_FAKTUR', CekRequestAkses, doubleCsrfProtection, ubahKeteranganFaktur);
Faktur.post('/TAMBAH_ITEM_FAKTUR', CekRequestAkses, doubleCsrfProtection, TAMBAHITEMFAKTUR);
Faktur.post('/HAPUS_SEMUA_FAKTUR',CekRequestAkses, doubleCsrfProtection, HAPUSFAKTUR);
Faktur.post('/UBAH_TGL_PENGIRIMAN', CekRequestAkses, ubahTglPengiriman);

export default Faktur