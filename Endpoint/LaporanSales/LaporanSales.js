import express from 'express';
import { getSalesList, getUnpaidInvoices , submitDCR } from '../../Logic/LaporanSales/LaporanSales.js';

const LaporanSales = express.Router();

// 1. Ambil daftar sales (role = 'Sales')
LaporanSales.get('/sales', getSalesList);

// 2. Ambil daftar faktur belum lunas (sisa_piutang > 0)
LaporanSales.get('/invoices', getUnpaidInvoices);

// 3. Simpan transaksi setoran penagihan DCR
LaporanSales.post('/submit', submitDCR);

export default LaporanSales;