// retur-riwayat.routes.js
import express from "express";
import { LIST_RIWAYAT_RETUR,EXPORT_EXCEL_RIWAYAT_RETUR,EXPORT_PDF_RIWAYAT_RETUR,SUMMARY_RIWAYAT_RETUR,DETAIL_RIWAYAT_RETUR } from "../../Logic/RiwayatReturPenjualan/RiwayatReturPenjualan.js";

// Pasang middleware auth yang sama dengan route retur kamu, contoh:
// router.use(authMiddleware);

const RiwayatReturPenjualan = express.Router()

// URUTAN PENTING: route statis harus di atas '/riwayat/:id'
RiwayatReturPenjualan.get('/riwayat', LIST_RIWAYAT_RETUR);
RiwayatReturPenjualan.get('/summary', SUMMARY_RIWAYAT_RETUR);
RiwayatReturPenjualan.get('/export/excel', EXPORT_EXCEL_RIWAYAT_RETUR);
RiwayatReturPenjualan.get('/export/pdf', EXPORT_PDF_RIWAYAT_RETUR);
RiwayatReturPenjualan.get('/riwayat/:id', DETAIL_RIWAYAT_RETUR);

export default RiwayatReturPenjualan;

// Di app utama:
// import returRiwayatRoutes from './retur-riwayat/retur-riwayat.routes.js';
// app.use('/api/retur', returRiwayatRoutes);
