import express from "express";
import { GetRekapPpnRange } from "../../Logic/Pajak/Pajak.js";


const Pajak = express.Router()

Pajak.get('/REKAP_PAJAK', GetRekapPpnRange)


export default Pajak