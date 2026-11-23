import express from "express";
import { CARI_BARANG_FAKTUR_LAIN, CariDaftarFaktur, CariNoFaktur, ProsesRetur } from "../../Logic/Retur/retur.js";
import { CekRequestAkses } from "../../middleware/Token/cek_request_akses.js";
import { doubleCsrfProtection } from "../../configurasiCrsf.js";
import { HapusRetur } from "../../Logic/Retur/retur.js";
import { LIST_PEMBATALAN_RETUR,SUMMARY_PEMBATALAN_RETUR,DETAIL_PEMBATALAN_RETUR } from "../../Logic/Retur/LogBatalRetur.js";



const Retur = express.Router();


Retur.get('/CARI_FAKTUR' , CekRequestAkses,  doubleCsrfProtection, CariNoFaktur)
Retur.get('/CARI_DAFTAR_FAKTUR', CariDaftarFaktur);
Retur.post('/PROSES_RETUR' , CekRequestAkses , doubleCsrfProtection, ProsesRetur)
Retur.get('/CARI_BARANG_FAKTUR_LAIN', CARI_BARANG_FAKTUR_LAIN)
Retur.post("/HAPUS_RETUR", CekRequestAkses, HapusRetur);
Retur.get('/list', CekRequestAkses, LIST_PEMBATALAN_RETUR);
Retur.get('/summary', CekRequestAkses, SUMMARY_PEMBATALAN_RETUR);
Retur.get('/detail/:id', CekRequestAkses, DETAIL_PEMBATALAN_RETUR);


export default Retur;