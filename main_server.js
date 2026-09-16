import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';

import auth from './Endpoint/auth/auth.js';
import Token from './Endpoint/Token/Token.js';
import Barang from './Endpoint/Barang/Barang.js';
import JualBarang from './Endpoint/JualBarang/JualBarang.js';
import Pelanggan from './Endpoint/Pelanggan/Pelanggan.js';
import Suplier from './Endpoint/Suplier/Suplier.js';
import BelanjaBarang from './Endpoint/BelanjaBarang/BelanjaBarang.js';

const app = express();

app.set('trust proxy', 1);

// 1. Helmet Config (Disable CORP agar resource bisa dibaca cross-origin)
app.use(helmet({
  crossOriginResourcePolicy: false,
}));

// 2. CORS Config
const allowedOrigins = [
  'https://fetoken.vercel.app', 
  'http://localhost:3000',
  'https://familybrs.vercel.app'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin) || origin.endsWith('.netlify.app')) {
      callback(null, true);
    } else {
      callback(new Error('CORS Not Allowed'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'path', 'x-path', 'X-Requested-With']
}));

// 3. Body Parser & Cookie
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());

// 4. Rate Limiters
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Terlalu banyak request, coba lagi nanti' }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Terlalu banyak percobaan login, coba lagi nanti' }
});

app.use(globalLimiter);

// 5. Logger
app.use((req, res, next) => {
  console.log(`[RAILWAY BE HIT] ${req.method} ${req.url}`);
  next();
});

// 6. Routes
app.use('/AUTH', authLimiter, auth);
app.use('/SERVER_CEK_TOKEN_ROLE', Token);
app.use('/SERVER_BARANG', Barang);
app.use('/SERVER_JUAL_BARANG', JualBarang);
app.use('/SERVER_PELANGGAN', Pelanggan);
app.use('/SERVER_SUPLIER', Suplier);
app.use('/SERVER_BELANJA_BARANG', BelanjaBarang);

// 7. Handlers
app.use((req, res) => {
  res.status(404).json({ message: 'Endpoint tidak ditemukan' });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ message: err.message || 'Terjadi kesalahan pada server' });
});

// 8. Port listener dinamis untuk Railway
const port = process.env.PORT || 4000;
app.listen(port, () => console.log('BE JALAN DI PORT ' + port));

export default app;