import express from 'express';
import { RIWAYAT_BARANG_RUSAK , RINGKASAN_BARANG_RUSAK , OPSI_FILTER_BARANG_RUSAK } from '../../Logic/BarangRusak/BarangRusak.js';
import { CekRequestAkses } from '../../middleware/Token/cek_request_akses.js';
import { doubleCsrfProtection } from '../../configurasiCrsf.js';

const BarangRusak = express.Router();


BarangRusak.get('/RIWAYAT_BARANG_RUSAK', CekRequestAkses , doubleCsrfProtection, RIWAYAT_BARANG_RUSAK);
BarangRusak.get('/RINGKASAN_BARANG_RUSAK',CekRequestAkses , doubleCsrfProtection,  RINGKASAN_BARANG_RUSAK);
BarangRusak.get('/OPSI_FILTER_BARANG_RUSAK',CekRequestAkses,doubleCsrfProtection, OPSI_FILTER_BARANG_RUSAK);


export default BarangRusak;