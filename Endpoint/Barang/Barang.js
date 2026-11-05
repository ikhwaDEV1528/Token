import express from "express";
import { Cheking_token_role } from "../../middleware/Token/cek_token&akses.js";
import {CloseBonus, GET_BARANG, TambahBarang } from "../../Logic/Barang/Barang.js";
import { EDIT_BARANG } from "../../Logic/Barang/Barang.js";
import { doubleCsrfProtection } from "../../configurasiCrsf.js";
import { CekRequestAkses } from "../../middleware/Token/cek_request_akses.js";
import { OpenBonus } from "../../Logic/Barang/Barang.js";

const Barang = express.Router();

Barang.get('/GET_BARANG'  , CekRequestAkses , doubleCsrfProtection ,GET_BARANG )
Barang.put('/UPDATE_BARANG' , CekRequestAkses ,doubleCsrfProtection , EDIT_BARANG)
Barang.post('/TAMBAH_BARANG' , CekRequestAkses , doubleCsrfProtection, TambahBarang)
Barang.put('/OPEN_BONUS' , CekRequestAkses, doubleCsrfProtection, OpenBonus)
Barang.put('/CLOSE_BONUS' , CekRequestAkses, doubleCsrfProtection , CloseBonus)

export default Barang; 