import express from "express";
import { BlockPelanggan, CariPelanggan, EditPelanggan, GET_PELANGGAN, TambahPelanggan, UnBlockPelanggan } from "../../Logic/Pelanggan/Pelanggan.js";
import { doubleCsrfProtection } from "../../configurasiCrsf.js";
import { CekRequestAkses } from "../../middleware/Token/cek_request_akses.js";


const Pelanggan = express.Router();

Pelanggan.get('/CARI_PELANGGAN' ,CekRequestAkses,  doubleCsrfProtection, CariPelanggan)
Pelanggan.get('/GET_PELANGGAN' , GET_PELANGGAN)
Pelanggan.post('/TAMBAH_PELANGGAN', CekRequestAkses , doubleCsrfProtection , TambahPelanggan)
Pelanggan.put('/EDIT_PELANGGAN', CekRequestAkses , doubleCsrfProtection , EditPelanggan)
Pelanggan.put('/BLOCK_PELANGGAN', CekRequestAkses , doubleCsrfProtection ,BlockPelanggan)
Pelanggan.put('/UNBLOCK_PELANGGAN', CekRequestAkses , doubleCsrfProtection , UnBlockPelanggan)
export default Pelanggan;