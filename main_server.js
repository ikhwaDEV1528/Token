import express from 'express';
import login from './endpoint/auth/login.js';
import cors from 'cors';
import cookieParser from 'cookie-parser';

const app = express();

// 1. CORS Fix: Hapus trailing slash '/' di akhir URL Netlify!
app.use(cors({
    origin: 'https://token-phi-dun.vercel.app/', 
    credentials: true
})); 

app.use(express.json()); // Wajib ada supaya req.body tidak kosong
app.use(cookieParser());

app.use('/server_login', login);

// 2. Vercel Fix: Jalankan app.listen HANYA jika bukan di environment Vercel
if (!process.env.VERCEL) {
    const port =  4000;
    app.listen(port, () => console.log('BE JALAN DI PORT ' + port));
}

// WAJIB DI-EXPORT UNTUK VERCEL SERVERLESS
export default app;