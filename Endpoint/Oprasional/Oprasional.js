import express from "express";
import { 
    KATEGORI_OPERASIONAL,TAMBAH_OPERASIONAL,
    DAFTAR_OPERASIONAL,RINGKASAN_OPERASIONAL,
    BATALKAN_OPERASIONAL } from "../../Logic/Oprasional/Oprasional.js";
import { CekRequestAkses } from "../../middleware/Token/cek_request_akses.js";
import { doubleCsrfProtection } from "../../configurasiCrsf.js";

const Oprasional = express.Router();

   Oprasional.get('/KATEGORI_OPERASIONAL',CekRequestAkses , doubleCsrfProtection, KATEGORI_OPERASIONAL);
   Oprasional.post('/TAMBAH_OPERASIONAL',CekRequestAkses, doubleCsrfProtection, TAMBAH_OPERASIONAL);
   Oprasional.get('/DAFTAR_OPERASIONAL', CekRequestAkses,doubleCsrfProtection, DAFTAR_OPERASIONAL);
   Oprasional.get('/RINGKASAN_OPERASIONAL',CekRequestAkses,doubleCsrfProtection, RINGKASAN_OPERASIONAL);
   Oprasional.post('/BATALKAN_OPERASIONAL',CekRequestAkses, doubleCsrfProtection, BATALKAN_OPERASIONAL);
   // server: app.use('/SERVER_OPERASIONAL', Operasional.default || Operasional)



   export default Oprasional