import express from 'express';
import { parsingInput } from '../../middleware/parsing_input/parsingInput.js';
import { limit } from '../../middleware/rate_limit/rateLimit.js';
import { Login } from '../../Logic/Auth/Login.js';
import { Logout } from '../../Logic/Auth/Logout.js';
import { doubleCsrfProtection } from '../../configurasiCrsf.js';

const auth = express.Router(); // <--- Pakai express.Router()

// Cek nilai variabel saat Netlify melakukan cold-start:
console.log('--- DEBUG HANDLERS ---');
console.log('parsingInput:', typeof parsingInput);
console.log('Login:', typeof Login);
console.log('Logout:', typeof Logout);
console.log('----------------------');

auth.post('/LOGIN' , parsingInput , limit , Login)
auth.delete('/LOGOUT' , Logout)





export default auth;
