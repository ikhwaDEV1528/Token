// // VERCEL //

// import express from 'express';
// import auth from './Endpoint/auth/auth.js';
// import Token from './Endpoint/Token/Token.js';
// import helmet from 'helmet';
// import { xss } from 'express-xss-sanitizer';
// import cors from 'cors';
// import cookieParser from 'cookie-parser';
// import rateLimit from 'express-rate-limit';
// import Barang from './Endpoint/Barang/Barang.js';
// import JualBarang from './Endpoint/JualBarang/JualBarang.js';
// import Pelanggan from './Endpoint/Pelanggan/Pelanggan.js';
// import Suplier from './Endpoint/Suplier/Suplier.js';
// import BelanjaBarang from './Endpoint/BelanjaBarang/BelanjaBarang.js';
// import Admin from './Endpoint/Admin/admin.js';
// import Retur from './Endpoint/Retur/retur.js';
// import Sales from './Endpoint/Sales/Sales.js';
// import Faktur from './Endpoint/Faktur/Faktur.js';
// import Piutang from './Endpoint/Piutang/Piutang.js';
// import Oprasional from './Endpoint/Oprasional/Oprasional.js';
// import HutangToko from './Endpoint/HutangToko/HutangToko.js';
// import StokOpname from './Endpoint/StokOpname/StokOpname.js';
// import returBelanja from './Endpoint/returBelanja/returBelanja.js';
// import Lapkeu from './Endpoint/Lapkeu/Lapkeu.js';
// import StokLog from './Endpoint/StokLog/StogLog.js';
// import BarangRusak from './Endpoint/BarangRusak/BarangRusak.js';
// import Pajak from './Endpoint/Pajak/Pajak.js';
// import SuratJalan from './Endpoint/SuratJalan/SuratJalan.js';
// import RiwayatReturPenjualan from './Endpoint/RiwayatReturPenjualan/RiwayatReturPenjualan.js';
// import RiwayatReturPembelian from './Endpoint/RiwayatReturPembelian/RiwayatReturPembelian.js';
// import LaporanSales from './Endpoint/LaporanSales/LaporanSales.js';
// import Dashboard from './Endpoint/Dashboard/Dashboard.js';

// const app = express();

// // 💡 1. Wajib untuk Vercel Serverless & Express-Rate-Limit
// app.set('trust proxy', 1);



// console.log("====================================");
// console.log("KODE TERBARU BERHASIL DI-RUNNING!!!");
// console.log("====================================");

// // 💡 2. List domain yang diizinkan (Tanpa trailing slash '/')
// const allowedOrigins = [
//     'https://fetoken.vercel.app', 
//     'http://localhost:3000',
//     'https://familybrs.vercel.app',
//   ];
  
// app.use((req, res, next) => {
//   const origin = req.headers.origin;

//   // 🔒 FIX: origin yang TIDAK dikenali tidak lagi dikasih '*'.
//   // Kalau origin cocok whitelist / dari .netlify.app -> izinkan spesifik ke origin itu.
//   // Kalau tidak ada origin sama sekali (server-to-server / curl / Postman) -> tidak set header (aman, browser tidak butuh header ini).
//   // Kalau origin ASING -> TIDAK set header apapun, sehingga browser otomatis blok response-nya.
//   const isAllowed = origin && (allowedOrigins.includes(origin) || origin.endsWith('.netlify.app'));

//   if (isAllowed) {
//     res.setHeader('Access-Control-Allow-Origin', origin);
//     res.setHeader('Access-Control-Allow-Credentials', 'true');
//   }
//   // Catatan: dulu ada fallback 'Access-Control-Allow-Origin': '*' di else block.
//   // Itu dihapus karena itu lubang keamanan utama (semua domain bisa akses API kamu).

//   res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
//   // Ditambahkan 'x-path' biar header custo
//   res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, path, x-path, X-Requested-With , x-csrf-token');
//   // 🔒 FIX: 'cookie'/'Cookie' dihapus dari Allow-Headers.
//   // Cookie dikirim browser otomatis lewat mekanisme cookie asli (lihat cookie-parser di bawah),
//   // bukan lewat custom header. Meng-allow header 'cookie' manual bisa membuka celah
//   // kalau ada endpoint yang keliru percaya ke header ini untuk autentikasi.

//   if (req.method === 'OPTIONS') {
//     return res.status(204).end(); // 🔒 204 lebih tepat untuk preflight tanpa body
//   }

//   next();
// });

// // 🔒 FIX: batasi ukuran body request, cegah payload raksasa (DoS)
// app.use(express.json({ limit: '10kb' }));
// app.use(cookieParser());
// app.use(helmet());
// app.use(xss())
// app.use(express.json({ limit: '50mb' }));
// app.use(express.urlencoded({ limit: '50mb', extended: true }));

// // 🔒 TAMBAHAN: rate limiter global, proteksi dasar dari flood/DoS ke semua endpoint

// const globalLimiter = rateLimit({
//   windowMs: 15 * 60 * 1000, // 15 menit
//   max: 300,                 // 300 request / IP / 15 menit
//   standardHeaders: true,
//   legacyHeaders: false,
//   message: { message: 'Terlalu banyak request, coba lagi nanti' }
// });



// app.use(globalLimiter);


// // 💡 4. Logger buat intip request masuk di Vercel Logs
// app.use((req, res, next) => {
//     console.log(`[BE HIT] ${req.method} ${req.url}`);
//     // 🔒 Catatan: jangan pernah tambahkan log req.body di sini,
//     // karena akan membocorkan password mentah ke log Vercel.
//     next();
// });


// app.use('/AUTH', auth.default || auth);
// app.use('/SERVER_CEK_TOKEN_ROLE', Token.default || Token);
// app.use('/SERVER_BARANG', Barang.default || Barang);
// app.use('/SERVER_JUAL_BARANG', JualBarang.default || JualBarang);
// app.use('/SERVER_PELANGGAN', Pelanggan.default || Pelanggan);
// app.use('/SERVER_SUPLIER', Suplier.default || Suplier);
// app.use('/SERVER_BELANJA_BARANG', BelanjaBarang.default || BelanjaBarang);
// app.use('/SERVER_ADMIN', Admin.default || Admin);
// app.use('/SERVER_RETUR', Retur.default || Retur);
// app.use('/SERVER_SALES', Sales.default || Sales);
// app.use('/SERVER_FAKTUR', Faktur.default || Faktur);
// app.use('/SERVER_PIUTANG', Piutang.default || Piutang);
// app.use('/SERVER_OPRASIONAL', Oprasional.default || Oprasional);
// app.use('/SERVER_HUTANG', HutangToko.default || HutangToko);
// app.use('/SERVER_STOK_OPNAME', StokOpname.default || StokOpname);
// app.use('/SERVER_RETUR_BELANJA', returBelanja.default || returBelanja);
// app.use('/SERVER_LAPKEU', Lapkeu.default || Lapkeu);
// app.use('/SERVER_STOK_LOG', StokLog.default || StokLog);
// app.use('/SERVER_RUSAK', BarangRusak.default || BarangRusak);
// app.use('/SERVER_PAJAK', Pajak.default || Pajak);
// app.use('/SERVER_SURAT_JALAN', SuratJalan.default || SuratJalan);
// app.use('/SERVER_RIWAYAT_RETUR_PENJUALAN',RiwayatReturPenjualan.default || RiwayatReturPenjualan)
// app.use('/SERVER_RIWAYAT_RETUR_PEMBELIAN' , RiwayatReturPembelian.default || RiwayatReturPembelian)
// app.use('/SERVER_LAPORAN_SALES' , LaporanSales)
// app.use('/SERVER_DASH' , Dashboard)

// // 🔒 TAMBAHAN: 404 handler untuk route yang tidak terdaftar
// app.use((req, res) => {
//   res.status(404).json({ message: 'Endpoint tidak ditemukan' });
// });

// // 🔒 TAMBAHAN: global error handler, cegah stack trace bocor ke client
// app.use((err, req, res, next) => {
//   console.error(err.stack);
//   res.status(err.status || 500).json({ message: 'Terjadi kesalahan pada server' });
// });


// // 💡 5. Vercel Fix: Jalankan app.listen HANYA jika bukan di Vercel
// if (!process.env.VERCEL) {
//     const port = 4000;
//     app.listen(port, () => console.log('BE JALAN DI PORT ' + port));
// }


// export default app;





// GUARD //
import express from 'express';
import auth from './Endpoint/auth/auth.js';
import Token from './Endpoint/Token/Token.js';
import helmet from 'helmet';
import { xss } from 'express-xss-sanitizer';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import Barang from './Endpoint/Barang/Barang.js';
import JualBarang from './Endpoint/JualBarang/JualBarang.js';
import Pelanggan from './Endpoint/Pelanggan/Pelanggan.js';
import Suplier from './Endpoint/Suplier/Suplier.js';
import BelanjaBarang from './Endpoint/BelanjaBarang/BelanjaBarang.js';
import Admin from './Endpoint/Admin/admin.js';
import Retur from './Endpoint/Retur/retur.js';
import Sales from './Endpoint/Sales/Sales.js';
import Faktur from './Endpoint/Faktur/Faktur.js';
import Piutang from './Endpoint/Piutang/Piutang.js';
import Oprasional from './Endpoint/Oprasional/Oprasional.js';
import HutangToko from './Endpoint/HutangToko/HutangToko.js';
import StokOpname from './Endpoint/StokOpname/StokOpname.js';
import returBelanja from './Endpoint/returBelanja/returBelanja.js';
import Lapkeu from './Endpoint/Lapkeu/Lapkeu.js';
import StokLog from './Endpoint/StokLog/StogLog.js';
import BarangRusak from './Endpoint/BarangRusak/BarangRusak.js';
import Pajak from './Endpoint/Pajak/Pajak.js';
import SuratJalan from './Endpoint/SuratJalan/SuratJalan.js';
import RiwayatReturPenjualan from './Endpoint/RiwayatReturPenjualan/RiwayatReturPenjualan.js';
import RiwayatReturPembelian from './Endpoint/RiwayatReturPembelian/RiwayatReturPembelian.js';
import LaporanSales from './Endpoint/LaporanSales/LaporanSales.js';
import Dashboard from './Endpoint/Dashboard/Dashboard.js';

const app = express();

// 1. Wajib untuk Vercel Serverless & Express-Rate-Limit
app.set('trust proxy', 1);

// 🔒 GUARD BARU: sembunyikan fingerprint framework
app.disable('x-powered-by');

console.log("====================================");
console.log("KODE TERBARU BERHASIL DI-RUNNING!!!");
console.log("====================================");

// ───────────────────────────────────────────────
// 🔒 GUARD BARU: process-level (log saja, tidak mematikan server)
// ───────────────────────────────────────────────
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason);
});

// ───────────────────────────────────────────────
// 2. CORS whitelist
// ───────────────────────────────────────────────
const allowedOrigins = [
  'https://fetoken.vercel.app',
  'http://localhost:3000',
  'https://familybrs.vercel.app',
];

// ⚠️ PERHATIAN: endsWith('.netlify.app') mengizinkan SEMUA situs netlify milik siapa pun.
// Ganti dengan subdomain spesifik kamu, mis: origin === 'https://namatoko.netlify.app'
// Dibiarkan sama dulu supaya frontend kamu yang sekarang tidak putus.
const isAllowedOrigin = (origin) =>
  !!origin && (allowedOrigins.includes(origin) || origin.endsWith('.netlify.app'));

// ───────────────────────────────────────────────
// 🔒 GUARD BARU: whitelist HTTP method (blok TRACE, CONNECT, dll)
// ───────────────────────────────────────────────
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']);
app.use((req, res, next) => {
  if (!ALLOWED_METHODS.has(req.method)) {
    return res.status(405).json({ message: 'Method tidak diizinkan' });
  }
  next();
});

// CORS (logika sama seperti sebelumnya)
app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  // 🔒 GUARD BARU: cegah cache/CDN menyajikan response CORS origin lain
  res.setHeader('Vary', 'Origin');

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, path, x-path, X-Requested-With , x-csrf-token'
  );

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  next();
});

// ───────────────────────────────────────────────
// 🔒 GUARD BARU: proteksi CSRF berbasis Origin
// Request yang mengubah data (POST/PUT/PATCH/DELETE) dari browser dengan Origin
// asing langsung ditolak. Request tanpa header Origin (Postman, curl, server-to-server)
// tetap lolos, jadi tidak mengganggu tool/integrasi yang sudah ada.
// ───────────────────────────────────────────────
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
app.use((req, res, next) => {
  if (MUTATING.has(req.method)) {
    const origin = req.headers.origin;
    if (origin && !isAllowedOrigin(origin)) {
      return res.status(403).json({ message: 'Origin tidak diizinkan' });
    }
  }
  next();
});

// ───────────────────────────────────────────────
// 🔒 GUARD BARU: header keamanan + no-cache untuk response API
// ───────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

app.use(helmet());

// ───────────────────────────────────────────────
// Rate limiter
// ───────────────────────────────────────────────
// Global (dipindah ke atas body-parser supaya request flood ditolak sebelum parsing body)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Terlalu banyak request, coba lagi nanti' },
});
app.use(globalLimiter);

// 🔒 GUARD BARU: limiter ketat untuk /AUTH (anti brute-force login)
// skipSuccessfulRequests: hanya request GAGAL (status >= 400) yang dihitung,
// jadi user yang login/refresh token dengan benar tidak akan pernah kena blok.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  skip: (req) => req.method === 'OPTIONS',
  message: { message: 'Terlalu banyak percobaan, coba lagi 15 menit lagi' },
});
app.use('/AUTH', authLimiter);

// ───────────────────────────────────────────────
// Body parser & sanitizer
// ───────────────────────────────────────────────
// Catatan: parser JSON pertama (10kb) yang aktif lebih dulu; yang 50mb di bawah
// praktis tidak terpakai untuk JSON. Dibiarkan agar perilaku server tidak berubah.
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());
app.use(xss());
app.use(express.json({ limit: '50mb' }));
// 🔒 GUARD BARU: 50mb -> 1mb untuk form urlencoded (jarang butuh besar)
app.use(express.urlencoded({ limit: '1mb', extended: true }));

// ───────────────────────────────────────────────
// 🔒 GUARD BARU: anti prototype pollution & NoSQL operator injection
// - body   : key berbahaya dibuang diam-diam (in place)
// - query/params : kalau ada key berbahaya -> 400
// ───────────────────────────────────────────────
const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const isBadKey = (k) => BLOCKED_KEYS.has(k) || k.startsWith('$');

function stripBadKeys(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 20) return;
  for (const key of Object.keys(obj)) {
    if (isBadKey(key)) {
      delete obj[key];
      continue;
    }
    stripBadKeys(obj[key], depth + 1);
  }
}

function hasBadKey(obj, depth = 0) {
  if (!obj || typeof obj !== 'object') return false;
  if (depth > 20) return true; // nesting terlalu dalam = mencurigakan
  for (const key of Object.keys(obj)) {
    if (isBadKey(key)) return true;
    if (hasBadKey(obj[key], depth + 1)) return true;
  }
  return false;
}

app.use((req, res, next) => {
  try {
    if (hasBadKey(req.query) || hasBadKey(req.params)) {
      return res.status(400).json({ message: 'Request tidak valid' });
    }
    if (req.body && typeof req.body === 'object') {
      stripBadKeys(req.body);
    }
  } catch (e) {
    return res.status(400).json({ message: 'Request tidak valid' });
  }
  next();
});

// ───────────────────────────────────────────────
// 4. Logger (pakai req.path, bukan req.url, supaya token di query string tidak bocor ke log)
// ───────────────────────────────────────────────
app.use((req, res, next) => {
  console.log(`[BE HIT] ${req.method} ${req.path}`);
  next();
});

app.use('/AUTH', auth.default || auth);
app.use('/SERVER_CEK_TOKEN_ROLE', Token.default || Token);
app.use('/SERVER_BARANG', Barang.default || Barang);
app.use('/SERVER_JUAL_BARANG', JualBarang.default || JualBarang);
app.use('/SERVER_PELANGGAN', Pelanggan.default || Pelanggan);
app.use('/SERVER_SUPLIER', Suplier.default || Suplier);
app.use('/SERVER_BELANJA_BARANG', BelanjaBarang.default || BelanjaBarang);
app.use('/SERVER_ADMIN', Admin.default || Admin);
app.use('/SERVER_RETUR', Retur.default || Retur);
app.use('/SERVER_SALES', Sales.default || Sales);
app.use('/SERVER_FAKTUR', Faktur.default || Faktur);
app.use('/SERVER_PIUTANG', Piutang.default || Piutang);
app.use('/SERVER_OPRASIONAL', Oprasional.default || Oprasional);
app.use('/SERVER_HUTANG', HutangToko.default || HutangToko);
app.use('/SERVER_STOK_OPNAME', StokOpname.default || StokOpname);
app.use('/SERVER_RETUR_BELANJA', returBelanja.default || returBelanja);
app.use('/SERVER_LAPKEU', Lapkeu.default || Lapkeu);
app.use('/SERVER_STOK_LOG', StokLog.default || StokLog);
app.use('/SERVER_RUSAK', BarangRusak.default || BarangRusak);
app.use('/SERVER_PAJAK', Pajak.default || Pajak);
app.use('/SERVER_SURAT_JALAN', SuratJalan.default || SuratJalan);
app.use('/SERVER_RIWAYAT_RETUR_PENJUALAN', RiwayatReturPenjualan.default || RiwayatReturPenjualan);
app.use('/SERVER_RIWAYAT_RETUR_PEMBELIAN', RiwayatReturPembelian.default || RiwayatReturPembelian);
app.use('/SERVER_LAPORAN_SALES', LaporanSales);
app.use('/SERVER_DASH', Dashboard);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: 'Endpoint tidak ditemukan' });
});

// 🔒 Global error handler (diperbaiki: status error body-parser jadi akurat, stack trace tetap tidak bocor)
app.use((err, req, res, next) => {
  console.error(err.stack || err);

  if (res.headersSent) return next(err);

  if (err.type === 'entity.too.large') {
    return res.status(413).json({ message: 'Ukuran data terlalu besar' });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'Format data tidak valid' });
  }

  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  res.status(status).json({ message: 'Terjadi kesalahan pada server' });
});

// 5. Vercel Fix
if (!process.env.VERCEL) {
  const port = 4000;
  app.listen(port, () => console.log('BE JALAN DI PORT ' + port));
}

export default app;















































// RAILWAY //

// import express from 'express';
// import helmet from 'helmet';
// import cors from 'cors';
// import cookieParser from 'cookie-parser';
// import rateLimit from 'express-rate-limit';

// import auth from './Endpoint/auth/auth.js';
// import Token from './Endpoint/Token/Token.js';
// import Barang from './Endpoint/Barang/Barang.js';
// import JualBarang from './Endpoint/JualBarang/JualBarang.js';
// import Pelanggan from './Endpoint/Pelanggan/Pelanggan.js';
// import Suplier from './Endpoint/Suplier/Suplier.js';
// import BelanjaBarang from './Endpoint/BelanjaBarang/BelanjaBarang.js';

// const app = express();

// app.set('trust proxy', 1);

// // 1. Helmet Konfigurasi
// app.use(helmet({
//   crossOriginResourcePolicy: false, // Wajib agar resource bisa dibaca cross-origin
// }));

// // 2. PAKAI PACKAGE CORS RESMI (Ganti middleware manual tadi)
// const allowedOrigins = [
//   'https://fetoken.vercel.app', 
//   'http://localhost:3000',
//   'https://familybrs.vercel.app'
// ];

// app.use(cors({
//   origin: function (origin, callback) {
//     // Izinkan jika origin ada di list, berakhiran .netlify.app, atau request tanpa origin (Server-to-Server/Postman)
//     if (!origin || allowedOrigins.includes(origin) || origin.endsWith('.netlify.app')) {
//       callback(null, true);
//     } else {
//       callback(new Error('CORS Not Allowed'));
//     }
//   },
//   credentials: true,
//   methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
//   allowedHeaders: ['Content-Type', 'Authorization', 'path', 'x-path', 'X-Requested-With']
// }));

// // 3. Body Parser & Cookie
// app.use(express.json({ limit: '10kb' }));
// app.use(cookieParser());

// // 4. Rate Limiters
// const globalLimiter = rateLimit({
//   windowMs: 15 * 60 * 1000,
//   max: 300,
//   standardHeaders: true,
//   legacyHeaders: false,
//   message: { message: 'Terlalu banyak request, coba lagi nanti' }
// });

// const authLimiter = rateLimit({
//   windowMs: 15 * 60 * 1000,
//   max: 200,
//   standardHeaders: true,
//   legacyHeaders: false,
//   message: { message: 'Terlalu banyak percobaan login, coba lagi nanti' }
// });

// app.use(globalLimiter);

// // 5. Logger
// app.use((req, res, next) => {
//   console.log(`[BE HIT] ${req.method} ${req.url}`);
//   next();
// });

// console.log('=== CEK IMPORT ROUTERS ===');
// console.log('auth:', typeof auth);
// console.log('Token:', typeof Token);
// console.log('Barang:', typeof Barang);
// console.log('JualBarang:', typeof JualBarang);
// console.log('Pelanggan:', typeof Pelanggan);
// console.log('Suplier:', typeof Suplier);
// console.log('BelanjaBarang:', typeof BelanjaBarang);
// console.log('==========================');

// // 6. Routes
// // Ganti baris routes di main_server.js jadi seperti ini sementara:
// app.use('/AUTH', authLimiter, auth.default || auth);
// app.use('/SERVER_CEK_TOKEN_ROLE', Token.default || Token);
// app.use('/SERVER_BARANG', Barang.default || Barang);
// app.use('/SERVER_JUAL_BARANG', JualBarang.default || JualBarang);
// app.use('/SERVER_PELANGGAN', Pelanggan.default || Pelanggan);
// app.use('/SERVER_SUPLIER', Suplier.default || Suplier);
// app.use('/SERVER_BELANJA_BARANG', BelanjaBarang.default || BelanjaBarang);
// // 7. Handlers
// app.use((req, res) => {
//   res.status(404).json({ message: 'Endpoint tidak ditemukan' });
// });

// app.use((err, req, res, next) => {
//   console.error(err.stack);
//   res.status(err.status || 500).json({ message: err.message || 'Terjadi kesalahan pada server' });
// });

// if (!process.env.VERCEL) {
//   const port = process.env.PORT || 4000;
//   app.listen(port, () => console.log('BE JALAN DI PORT ' + port));
// }



