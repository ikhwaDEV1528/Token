import express from 'express';
import { GETSTOKLOG } from '../../Logic/StokLog/StokLog.js';


const StokLog = express.Router();

StokLog.get('/STOK_LOG' , GETSTOKLOG)


export default StokLog;