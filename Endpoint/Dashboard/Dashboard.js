import { GET_DASHBOARD_MONITORING } from "../../Logic/Dashboard/Dashboard.js";
import { CekRequestAkses } from "../../middleware/Token/cek_request_akses.js";
import express from "express";
import { Cheking_token_role } from "../../middleware/Token/cek_token&akses.js";
import { doubleCsrfProtection } from "../../configurasiCrsf.js";

const Dashboard = express.Router()

Dashboard.get("/monitoring", CekRequestAkses, doubleCsrfProtection , GET_DASHBOARD_MONITORING);

export default Dashboard