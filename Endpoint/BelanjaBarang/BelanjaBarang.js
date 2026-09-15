import express from "express";
import { AMBIL_FAKTUR_BELANJA, FunBelanjaBarang } from "../../Logic/BelanjaBarang/BelanjaBarang.js";


const BelanjaBarang = express.Router()

BelanjaBarang.post('/BELANJA_BARANG', FunBelanjaBarang)
BelanjaBarang.get('/FAKTUR_BELANJA', AMBIL_FAKTUR_BELANJA)

export default BelanjaBarang