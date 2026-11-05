import express from "express";
import { AMBIL_FAKTUR_BELANJA, FunBelanjaBarang } from "../../Logic/BelanjaBarang/BelanjaBarang.js";
import { doubleCsrfProtection } from "../../configurasiCrsf.js";
import { CekRequestAkses } from "../../middleware/Token/cek_request_akses.js";


const BelanjaBarang = express.Router()

BelanjaBarang.post('/BELANJA_BARANG', CekRequestAkses, doubleCsrfProtection, FunBelanjaBarang)
BelanjaBarang.get('/FAKTUR_BELANJA', CekRequestAkses, doubleCsrfProtection, AMBIL_FAKTUR_BELANJA)

export default BelanjaBarang