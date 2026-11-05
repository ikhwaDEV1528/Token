import express from 'express';
import { SIMPAN_STOK_OPNAME } from '../../Logic/StokOpname/StokOpname.js';
import { CekRequestAkses } from '../../middleware/Token/cek_request_akses.js';
import { doubleCsrfProtection } from '../../configurasiCrsf.js';


const StokOpname = express.Router();


StokOpname.post('/SIMPAN' , CekRequestAkses, doubleCsrfProtection, SIMPAN_STOK_OPNAME)


export default StokOpname;