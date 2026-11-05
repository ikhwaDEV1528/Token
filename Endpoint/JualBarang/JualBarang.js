import express from "express";
import { AMBIL_FAKTUR_PENJUALAN, InputJualBarang, ProsesPesanan } from "../../Logic/Penjualan/InputJualBarang.js";
import { CekRequestAkses } from "../../middleware/Token/cek_request_akses.js";
import { doubleCsrfProtection } from "../../configurasiCrsf.js";


const JualBarang = express.Router();

JualBarang.get('/JUAL_BARANG' , CekRequestAkses , doubleCsrfProtection, InputJualBarang)
JualBarang.post('/PROSES_PENJUALAN', CekRequestAkses, doubleCsrfProtection, ProsesPesanan);
JualBarang.get('/AMBIL_FAKTUR_PENJUALAN' , AMBIL_FAKTUR_PENJUALAN)

export default JualBarang;