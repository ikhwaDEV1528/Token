import express from 'express';
import login from './endpoint/auth/login.js';
import cors from 'cors';
import cookieParser from 'cookie-parser';

const app = express();

app.use(cors({
    origin: process.env.CLIENT_URL || 'http://localhost:3000',
    credentials: true
})); 

app.use(express.json()); // Wajib ada supaya req.body tidak kosong!
app.use(cookieParser());

app.use('/server_login', login);

// Untuk testing lokal di laptop kamu
const port = process.env.PORT || 4000;
app.listen(port, () => console.log('BE JALAN DI PORT ' + port));

// ⚠️ WAJIB DI-EXPORT SUPAYA VERCEL BISA BACA APP EXPRESS KAMU
export default app;