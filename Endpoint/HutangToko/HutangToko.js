import express from "express";
import { 
    DAFTAR_HUTANG_SUPPLIER ,
    DETAIL_HUTANG_SUPPLIER, 
    BAYAR_HUTANG,
    RIWAYAT_PEMBAYARAN_HUTANG} from "../../Logic/HutangToko/HutangToko.js";
import { CekRequestAkses } from "../../middleware/Token/cek_request_akses.js";
import { doubleCsrfProtection } from "../../configurasiCrsf.js";


const HutangToko = express.Router();




HutangToko.get("/DAFTAR_HUTANG_SUPPLIER", DAFTAR_HUTANG_SUPPLIER);
HutangToko.get("/DETAIL_HUTANG_SUPPLIER", DETAIL_HUTANG_SUPPLIER);
HutangToko.post("/BAYAR_HUTANG",CekRequestAkses , doubleCsrfProtection, BAYAR_HUTANG);
HutangToko.get("/RIWAYAT_PEMBAYARAN_HUTANG", RIWAYAT_PEMBAYARAN_HUTANG);


export default HutangToko;