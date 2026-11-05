import express from 'express';
import { GetLaporanLabaRugi } from '../../Logic/Lapkeu/Lapkeu.js';
import { CekRequestAkses } from '../../middleware/Token/cek_request_akses.js';
import { doubleCsrfProtection } from '../../configurasiCrsf.js';


const Lapkeu = express.Router();


Lapkeu.get('/GET_LAPKEU' , CekRequestAkses, doubleCsrfProtection, GetLaporanLabaRugi)


export default Lapkeu;