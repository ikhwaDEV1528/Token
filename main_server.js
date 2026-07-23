import express from 'express';
import login from './endpoint/auth/login.js';
import cors from 'cors';
import cookieParser from 'cookie-parser';

const app = express();

// 💡 1. Wajib untuk Vercel Serverless & Express-Rate-Limit
app.set('trust proxy', 1);

// 💡 2. List domain yang diizinkan (Tanpa trailing slash '/')
const allowedOrigins = [
    'https://fetoken.vercel.app', 
    'http://localhost:3000'
  ];

// 💡 3. Preflight & CORS Handler Manual (Kebal Vercel & Browser)
app.use((req, res, next) => {
  const origin = req.headers.origin;

  // Izinkan origin jika cocok / dari Netlify / request Server-to-Server (tanpa origin)
  if (!origin || allowedOrigins.includes(origin) || origin.endsWith('.netlify.app')) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }

  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  // Ditambahkan 'x-path' biar header custom dari Next.js gak dibuang
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, cookie, Cookie, path, x-path, X-Requested-With');

  // Langsung jawab OK untuk Preflight OPTIONS dari browser
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  next();
});

app.use(express.json()); 
app.use(cookieParser());

// 💡 4. Logger buat intip request masuk di Vercel Logs
app.use((req, res, next) => {
    console.log(`[BE HIT] ${req.method} ${req.url}`);
    next();
});

app.use('/server_login', login);

// 💡 5. Vercel Fix: Jalankan app.listen HANYA jika bukan di Vercel
if (!process.env.VERCEL) {
    const port = 4000;
    app.listen(port, () => console.log('BE JALAN DI PORT ' + port));
}

export default app;