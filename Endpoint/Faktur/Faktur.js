import express from "express";
import { EDITITEMFAKTUR, HAPUSITEMFAKTUR } from "../../Logic/Faktur/Faktur.js";
import { getKewajibanRefund, selesaikanRefund } from "../../Logic/Refund/Refund.js";
import { CekRequestAkses } from "../../middleware/Token/cek_request_akses.js";
import { ubahKeteranganFaktur } from "../../Logic/Faktur/Faktur.js";
import { doubleCsrfProtection } from "../../configurasiCrsf.js";

const Faktur = express.Router();

Faktur.post('/HAPUS_FAKTUR' ,CekRequestAkses , doubleCsrfProtection, HAPUSITEMFAKTUR);
Faktur.put('/EDIT_FAKTUR' ,CekRequestAkses , doubleCsrfProtection, EDITITEMFAKTUR)
Faktur.get('/REFUND' , getKewajibanRefund)
Faktur.post('/selesaikan-refund' ,CekRequestAkses , doubleCsrfProtection, selesaikanRefund)
Faktur.post('/UBAH_KETERANGAN_FAKTUR', CekRequestAkses, doubleCsrfProtection, ubahKeteranganFaktur);

export default Faktur