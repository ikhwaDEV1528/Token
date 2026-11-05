import express from 'express';
import { CariNoFakturPembelian, ProsesReturBelanja } from '../../Logic/returBelanja/returBelanja.js';
import { CekRequestAkses } from '../../middleware/Token/cek_request_akses.js';
import { doubleCsrfProtection } from '../../configurasiCrsf.js';



const returBelanja = express.Router();



returBelanja.get('/CARI_FAKTUR_BELANJA', CariNoFakturPembelian);
returBelanja.post('/PROSES_RETUR_BELANJA' ,CekRequestAkses , doubleCsrfProtection, ProsesReturBelanja)


export default returBelanja;