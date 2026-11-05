import express from 'express';
import { DAFTAR_PIUTANG_PELANGGAN,
    DETAIL_PIUTANG_PELANGGAN,BAYAR_PIUTANG,RIWAYAT_PEMBAYARAN } from '../../Logic/Piutang/Piutang.js';
import { CekRequestAkses } from '../../middleware/Token/cek_request_akses.js';
import { doubleCsrfProtection } from '../../configurasiCrsf.js';


const Piutang = express.Router();


   Piutang.get('/DAFTAR_PIUTANG_PELANGGAN', DAFTAR_PIUTANG_PELANGGAN);
   Piutang.get('/DETAIL_PIUTANG_PELANGGAN', DETAIL_PIUTANG_PELANGGAN);
   Piutang.post('/BAYAR_PIUTANG',CekRequestAkses, doubleCsrfProtection, BAYAR_PIUTANG);
   Piutang.get('/RIWAYAT_PEMBAYARAN', RIWAYAT_PEMBAYARAN);


   export default Piutang;