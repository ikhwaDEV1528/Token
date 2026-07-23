import express from 'express';
import login from './endpoint/auth/login.js';
import cors from 'cors';
import cookieParser from 'cookie-parser';

const app = express();

// 💡 List origin yang diizinkan (BEBAS GARIS MIRING DI AKHIR)
const allowedOrigins = [
  'https://fetoken.netlify.app',
  'http://localhost:3000',
  'http://localhost:4000'
];

app.use(cors({
    origin: function (origin, callback) {
        // Izinkan jika origin sesuai list, atau jika request tanpa origin (seperti Fetch/Middleware)
        if (!origin || allowedOrigins.includes(origin) || origin.endsWith('.netlify.app')) {
            callback(null, true);
        } else {
            callback(null, true); // Fallback true saat dev
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'cookie', 'path']
})); 

app.use(express.json()); // Wajib ada supaya req.body tidak kosong
app.use(cookieParser());

// 💡 Logger sederhana buat mantau request masuk di Vercel Logs
app.use((req, res, next) => {
    console.log(`[BE HIT] ${req.method} ${req.url}`);
    next();
});

app.use('/server_login', login);

// Vercel Fix: Jalankan app.listen HANYA jika bukan di environment Vercel
if (!process.env.VERCEL) {
    const port = 4000;
    app.listen(port, () => console.log('BE JALAN DI PORT ' + port));
}

// WAJIB DI-EXPORT UNTUK VERCEL SERVERLESS
export default app;