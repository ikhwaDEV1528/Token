import express from "express";
import {  Cari_seles, GET_PENJUALAN_SALES } from "../../Logic/Sales/Sales.js";
import { CekRequestAkses } from "../../middleware/Token/cek_request_akses.js";
import { doubleCsrfProtection } from "../../configurasiCrsf.js";



const Sales = express.Router();

Sales.get('/CARI_SALES' ,CekRequestAkses , doubleCsrfProtection , Cari_seles)
Sales.post('/penjualan-sales' , CekRequestAkses  , doubleCsrfProtection,  GET_PENJUALAN_SALES)


export default Sales;