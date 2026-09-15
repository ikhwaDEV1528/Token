import express from "express";
import { CariPelanggan } from "../../Logic/Pelanggan/Pelanggan.js";


const Pelanggan = express.Router();

Pelanggan.get('/CARI_PELANGGAN' , CariPelanggan)

export default Pelanggan;