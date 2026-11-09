import express from "express";
import { CARI_BARANG_FAKTUR_LAIN, CariDaftarFaktur, CariNoFaktur, ProsesRetur } from "../../Logic/Retur/retur.js";
import { CekRequestAkses } from "../../middleware/Token/cek_request_akses.js";
import { doubleCsrfProtection } from "../../configurasiCrsf.js";



const Retur = express.Router();


Retur.get('/CARI_FAKTUR' , CekRequestAkses,  doubleCsrfProtection, CariNoFaktur)
Retur.get('/CARI_DAFTAR_FAKTUR', CariDaftarFaktur);
Retur.post('/PROSES_RETUR' , CekRequestAkses , doubleCsrfProtection, ProsesRetur)
Retur.get('/CARI_BARANG_FAKTUR_LAIN', CARI_BARANG_FAKTUR_LAIN)


export default Retur;