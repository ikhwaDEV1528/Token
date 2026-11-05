import express from "express";
import { CariSuplier } from "../../Logic/Suplier/Suplier.js";
import { doubleCsrfProtection } from "../../configurasiCrsf.js";
import { listSuppliers, createSupplier, updateSupplier } from "../../Logic/Suplier/fiturSupplier.js";
import { CekRequestAkses } from "../../middleware/Token/cek_request_akses.js";

const Suplier = express.Router();

Suplier.get('/CARI_SUPLIER', CariSuplier);

Suplier.get('/', listSuppliers);
Suplier.post('/', CekRequestAkses, doubleCsrfProtection,  createSupplier);
Suplier.put('/:id', CekRequestAkses , updateSupplier);

export default Suplier;