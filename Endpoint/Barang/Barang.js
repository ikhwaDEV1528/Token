import express from "express";
import Cheking_token_role from "../../middleware/Token/cek_token&akses.js";
import {GET_BARANG, TambahBarang } from "../../Logic/Barang/Barang.js";
import { EDIT_BARANG } from "../../Logic/Barang/Barang.js";


const Barang = express.Router();

Barang.get('/GET_BARANG'  , GET_BARANG )
Barang.put('/UPDATE_BARANG' , EDIT_BARANG)
Barang.post('/TAMBAH_BARANG' , TambahBarang)


export default Barang; 