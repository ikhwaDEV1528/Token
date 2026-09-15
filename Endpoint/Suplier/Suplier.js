import express from "express";
import { CariSuplier } from "../../Logic/Suplier/Suplier.js";



const Suplier = express.Router();


Suplier.get('/CARI_SUPLIER' , CariSuplier)

export default Suplier