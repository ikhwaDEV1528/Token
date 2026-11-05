import express from "express";
import { GetSuratJalanGabungan } from "../../Logic/SuratJalan/SuratJalan.js";


const SuratJalan = express.Router();


SuratJalan.get('/SURAT_JALAN', GetSuratJalanGabungan)

export default SuratJalan;