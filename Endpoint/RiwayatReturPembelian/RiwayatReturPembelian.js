import express from "express";
import {
  LIST_RIWAYAT_RETUR_PEMBELIAN,
  SUMMARY_RIWAYAT_RETUR_PEMBELIAN,
  DETAIL_RIWAYAT_RETUR_PEMBELIAN,
  EXPORT_EXCEL_RIWAYAT_RETUR_PEMBELIAN,
  EXPORT_PDF_RIWAYAT_RETUR_PEMBELIAN
} from '../../Logic/RiwayatReturPembelian/RiwayatReturPembelian.js';


const RiwayatReturPembelian = express.Router();

RiwayatReturPembelian.get("/riwayat", LIST_RIWAYAT_RETUR_PEMBELIAN);
RiwayatReturPembelian.get("/summary", SUMMARY_RIWAYAT_RETUR_PEMBELIAN);
RiwayatReturPembelian.get("/export/excel", EXPORT_EXCEL_RIWAYAT_RETUR_PEMBELIAN);
RiwayatReturPembelian.get("/export/pdf", EXPORT_PDF_RIWAYAT_RETUR_PEMBELIAN);
RiwayatReturPembelian.get("/riwayat/:id", DETAIL_RIWAYAT_RETUR_PEMBELIAN);

export default RiwayatReturPembelian;