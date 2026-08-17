import express from "express";
import Cheking_token_role from "../../middleware/Token/cek_token&akses.js";


const Token = express.Router();

Token.post('/CHECK_ROLE_DAN_TOKEN' , Cheking_token_role)


export default Token;