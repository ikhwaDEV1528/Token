import express from 'express';
import parsingInput from '../../middleware/parsing_input/parsingInput.js';
import limit from '../../middleware/rate_limit/rateLimit.js';
import Login from '../../Logic/Auth/Login.js';



const router_login = express.Router(); // <--- Pakai express.Router()

router_login.post('/login' , limit ,  parsingInput , Login)





export default router_login;
