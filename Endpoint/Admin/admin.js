import express from "express";
import { GET_ADMIN } from "../../Logic/Admin/Admin.js";
import { CekRequestAkses } from "../../middleware/Token/cek_request_akses.js";
import { TAMBAH_ADMIN } from "../../Logic/Admin/Admin.js";
import { doubleCsrfProtection } from "../../configurasiCrsf.js";

const Admin = express.Router();

Admin.get('/GET_ADMIN', GET_ADMIN)
Admin.post('/TAMBAH_ADMIN', CekRequestAkses, doubleCsrfProtection, TAMBAH_ADMIN);

export default Admin;