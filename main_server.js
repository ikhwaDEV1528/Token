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









// VERCEL //


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

// 💡 1. Wajib untuk Vercel Serverless & Express-Rate-Limit
app.set('trust proxy', 1);



console.log("====================================");
console.log("KODE TERBARU BERHASIL DI-RUNNING!!!");
console.log("====================================");

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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, path, x-path, X-Requested-With , x-csrf-token');
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
app.use(xss())
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// 🔒 TAMBAHAN: rate limiter global, proteksi dasar dari flood/DoS ke semua endpoint

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 menit
  max: 300,                 // 300 request / IP / 15 menit
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Terlalu banyak request, coba lagi nanti' }
});



app.use(globalLimiter);


// 💡 4. Logger buat intip request masuk di Vercel Logs
app.use((req, res, next) => {
    console.log(`[BE HIT] ${req.method} ${req.url}`);
    // 🔒 Catatan: jangan pernah tambahkan log req.body di sini,
    // karena akan membocorkan password mentah ke log Vercel.
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
app.use('/SERVER_RIWAYAT_RETUR_PENJUALAN',RiwayatReturPenjualan.default || RiwayatReturPenjualan)
app.use('/SERVER_RIWAYAT_RETUR_PEMBELIAN' , RiwayatReturPembelian.default || RiwayatReturPembelian)
app.use('/SERVER_LAPORAN_SALES' , LaporanSales)
app.use('/SERVER_DASH' , Dashboard)

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




export default app;