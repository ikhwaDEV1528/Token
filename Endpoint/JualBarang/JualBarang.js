import express from "express";
import { AMBIL_FAKTUR_PENJUALAN, InputJualBarang, ProsesPesanan } from "../../Logic/Penjualan/InputJualBarang.js";
import { CekRequestAkses } from "../../middleware/Token/cek_request_akses.js";


const JualBarang = express.Router();

JualBarang.get('/JUAL_BARANG' , InputJualBarang)
JualBarang.post('/PROSES_PENJUALAN', CekRequestAkses, ProsesPesanan)
JualBarang.get('/AMBIL_FAKTUR_PENJUALAN' , AMBIL_FAKTUR_PENJUALAN)

export default JualBarang;