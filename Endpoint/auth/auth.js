import express from 'express';
import parsingInput from '../../middleware/parsing_input/parsingInput.js';
import limit from '../../middleware/rate_limit/rateLimit.js';
import Login from '../../Logic/Auth/Login.js';
import Logout from '../../Logic/Auth/Logout.js';


const auth = express.Router(); // <--- Pakai express.Router()

auth.post('/LOGIN' , limit  , parsingInput, Login)
auth.delete('/LOGOUT' , Logout)





export default auth;
