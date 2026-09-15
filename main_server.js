// import express from 'express';
// import auth from './Endpoint/auth/auth.js';
// import Token from './Endpoint/Token/Token.js';
// import helmet from 'helmet';
// import cors from 'cors';
// import cookieParser from 'cookie-parser';
// import Barang from './Endpoint/Barang/Barang.js';
// import JualBarang from './Endpoint/JualBarang/JualBarang.js';
// import Pelanggan from './Endpoint/Pelanggan/Pelanggan.js';
// import Suplier from './Endpoint/Suplier/Suplier.js';
// import BelanjaBarang from './Endpoint/BelanjaBarang/BelanjaBarang.js';

// const app = express();

// // 💡 1. Wajib untuk Vercel Serverless & Express-Rate-Limit
// app.set('trust proxy', 1);

// // 💡 2. List domain yang diizinkan (Tanpa trailing slash '/')
// const allowedOrigins = [
//     'https://fetoken.vercel.app', 
//     'http://localhost:3000'
//   ];
  
// app.use((req, res, next) => {
//   const origin = req.headers.origin;

//   // Izinkan origin jika cocok / dari Netlify / request Server-to-Server (tanpa origin)
//   if (!origin || allowedOrigins.includes(origin) || origin.endsWith('.netlify.app')) {
//     res.setHeader('Access-Control-Allow-Origin', origin || '*');
//   } else {
//     res.setHeader('Access-Control-Allow-Origin', '*');
//   }

//   res.setHeader('Access-Control-Allow-Credentials', 'true');
//   res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
//   // Ditambahkan 'x-path' biar header custo
//   res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, cookie, Cookie, path, x-path, X-Requested-With');

//   if (req.method === 'OPTIONS') {
//     return res.status(200).end();
//   }

//   next();
// });

// app.use(express.json()); 
// app.use(cookieParser());
// app.use(helmet());



// // 💡 4. Logger buat intip request masuk di Vercel Logs
// app.use((req, res, next) => {
//     console.log(`[BE HIT] ${req.method} ${req.url}`);
//     next();
// });


// app.use('/AUTH', auth);
// app.use('/SERVER_CEK_TOKEN_ROLE' , Token)
// app.use('/SERVER_BARANG' , Barang)
// app.use('/SERVER_JUAL_BARANG' , JualBarang)
// app.use('/SERVER_PELANGGAN' , Pelanggan)
// app.use('/SERVER_SUPLIER' , Suplier)
// app.use('/SERVER_BELANJA_BARANG' , BelanjaBarang)




// // 💡 5. Vercel Fix: Jalankan app.listen HANYA jika bukan di Vercel
// if (!process.env.VERCEL) {
//     const port = 4000;
//     app.listen(port, () => console.log('BE JALAN DI PORT ' + port));
// }

// export default app;


import express from 'express';
import auth from './Endpoint/auth/auth.js';
import Token from './Endpoint/Token/Token.js';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import Barang from './Endpoint/Barang/Barang.js';
import JualBarang from './Endpoint/JualBarang/JualBarang.js';
import Pelanggan from './Endpoint/Pelanggan/Pelanggan.js';
import Suplier from './Endpoint/Suplier/Suplier.js';
import BelanjaBarang from './Endpoint/BelanjaBarang/BelanjaBarang.js';

const app = express();

// 💡 1. Wajib untuk Vercel Serverless & Express-Rate-Limit
app.set('trust proxy', 1);

// 💡 2. List domain yang diizinkan (Tanpa trailing slash '/')
const allowedOrigins = [
    'https://fetoken.vercel.app', 
    'http://localhost:3000',
    'https://familybrs.vercel.app',
  ];
  
app.use((req, res, next) => {
  const origin = req.headers.origin;

  // 🔒 FIX: origin yang TIDAK dikenali tidak lagi dikasih '*'.
  // Kalau origin cocok whitelist / dari .netlify.app -> izinkan spesifik ke origin itu.
  // Kalau tidak ada origin sama sekali (server-to-server / curl / Postman) -> tidak set header (aman, browser tidak butuh header ini).
  // Kalau origin ASING -> TIDAK set header apapun, sehingga browser otomatis blok response-nya.
  const isAllowed = origin && (allowedOrigins.includes(origin) || origin.endsWith('.netlify.app'));

  if (isAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  // Catatan: dulu ada fallback 'Access-Control-Allow-Origin': '*' di else block.
  // Itu dihapus karena itu lubang keamanan utama (semua domain bisa akses API kamu).

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  // Ditambahkan 'x-path' biar header custo
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, path, x-path, X-Requested-With');
  // 🔒 FIX: 'cookie'/'Cookie' dihapus dari Allow-Headers.
  // Cookie dikirim browser otomatis lewat mekanisme cookie asli (lihat cookie-parser di bawah),
  // bukan lewat custom header. Meng-allow header 'cookie' manual bisa membuka celah
  // kalau ada endpoint yang keliru percaya ke header ini untuk autentikasi.

  if (req.method === 'OPTIONS') {
    return res.status(204).end(); // 🔒 204 lebih tepat untuk preflight tanpa body
  }

  next();
});

// 🔒 FIX: batasi ukuran body request, cegah payload raksasa (DoS)
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());
app.use(helmet());

// 🔒 TAMBAHAN: rate limiter global, proteksi dasar dari flood/DoS ke semua endpoint
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 menit
  max: 300,                 // 300 request / IP / 15 menit
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Terlalu banyak request, coba lagi nanti' }
});
app.use(globalLimiter);

// 🔒 TAMBAHAN: rate limiter lebih ketat khusus AUTH, cegah brute-force login
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 menit
  max: 20,                  // 20 percobaan / IP / 15 menit
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Terlalu banyak percobaan login, coba lagi nanti' }
});

// 💡 4. Logger buat intip request masuk di Vercel Logs
app.use((req, res, next) => {
    console.log(`[BE HIT] ${req.method} ${req.url}`);
    // 🔒 Catatan: jangan pernah tambahkan log req.body di sini,
    // karena akan membocorkan password mentah ke log Vercel.
    next();
});


app.use('/AUTH', authLimiter, auth); // 🔒 authLimiter dipasang khusus di sini
app.use('/SERVER_CEK_TOKEN_ROLE' , Token)
app.use('/SERVER_BARANG' , Barang)
app.use('/SERVER_JUAL_BARANG' , JualBarang)
app.use('/SERVER_PELANGGAN' , Pelanggan)
app.use('/SERVER_SUPLIER' , Suplier)
app.use('/SERVER_BELANJA_BARANG' , BelanjaBarang)


// 🔒 TAMBAHAN: 404 handler untuk route yang tidak terdaftar
app.use((req, res) => {
  res.status(404).json({ message: 'Endpoint tidak ditemukan' });
});

// 🔒 TAMBAHAN: global error handler, cegah stack trace bocor ke client
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ message: 'Terjadi kesalahan pada server' });
});


// 💡 5. Vercel Fix: Jalankan app.listen HANYA jika bukan di Vercel
if (!process.env.VERCEL) {
    const port = 4000;
    app.listen(port, () => console.log('BE JALAN DI PORT ' + port));
}



export default app;