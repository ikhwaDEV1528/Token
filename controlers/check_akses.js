import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { db } from '../config/firebase/fireStore.js';

dotenv.config();

async function ChekingAdmin(req, res) {
  try {
    // 💡 1. Ambil Secret di dalam fungsi + Fallback Hardcode Cadangan
    const RAHASIA_GW = process.env.RAHASIA || process.env.RAHASIA_GW || 'kuncirahasiasuper12345';

    // 1. Ambil & validasi header path agar tidak crash
    const headerPath = req.headers['path'] || '';
    if (!headerPath) {
      return res.status(400).json({ error: 'Header path wajib diisi!' });
    }

    const pathSegments = headerPath.split('/');
    const mainPath = pathSegments[1]; // 'Admin' atau 'User'
    const field = pathSegments[2];    // 'Dashboard', 'Home', dll.

    // 2. Ambil token dari cookie
    let accessToken = req.cookies?.accses_token;
    const refreshToken = req.cookies?.refresh_token;

    if (!accessToken) {
      return res.status(401).json({ error: 'Access token undefined, silakan login kembali!' });
    }

    let decoded;

    // 3. Process Verifikasi Access Token & Auto-Refresh
    try {
      // Coba decode token tanpa mengabaikan expiration
      decoded = jwt.verify(accessToken, RAHASIA_GW);
    } catch (err) {
      // Jika Access Token Expired, coba gunakan Refresh Token
      if (err.name === 'TokenExpiredError' || jwt.decode(accessToken)?.exp < Date.now() / 1000) {
        console.log('Access token expired! Mencoba refresh token...');

        if (!refreshToken) {
          return res.status(401).json({ error: 'Refresh token undefined, silakan login kembali!' });
        }

        try {
          const decodedRefresh = jwt.verify(refreshToken, RAHASIA_GW);

          // Buat Payload & Access Token Baru
          decoded = {
            username: decodedRefresh.username,
            email: decodedRefresh.email,
            role: decodedRefresh.role,
            user_id: decodedRefresh.user_id
          };

          const newAccessToken = jwt.sign(decoded, RAHASIA_GW, { expiresIn: '2m' });

          // Simpan Cookie Baru
          res.cookie('accses_token', newAccessToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 10 * 60 * 1000
          });

          console.log('Access Token berhasil diperbarui secara otomatis!');
        } catch (refreshErr) {
          return res.status(401).json({ error: 'Refresh token kadaluarsa/rusak, silakan login kembali!' });
        }
      } else {
        // Jika token diacak-acak / signature palsu
        return res.status(401).json({ error: 'Access token tidak valid atau rusak!' });
      }
    }

    // 4. Verifikasi Role berdasarkan Path URL
    const userRole = decoded.role;

    if (mainPath === 'Admin' && userRole !== 'Admin') {
      console.log('Bukan Admin!');
      return res.status(403).json({ error: 'Akses ditolak! Anda bukan Admin.' });
    }

    if (mainPath === 'User' && userRole !== 'User') {
      console.log('Bukan User!');
      return res.status(403).json({ error: 'Akses ditolak! Anda bukan User.' });
    }

    // 5. Cek Dokumen Sesi di Firestore
    const sessionDocId = `${decoded.user_id}_${decoded.username}`;
    const sessionRef = db.collection('sesion_user').doc(sessionDocId);
    const doc = await sessionRef.get();

    if (!doc.exists) {
      console.log('Sesi dokumen Firestore tidak ditemukan!');
      return res.status(401).json({ message: `Sesi ${userRole} tidak ditemukan di database!` });
    }

    // 6. Cek Hak Akses Halaman (Field Spesifik) jika ada
    if (field && !doc.data()[field]) {
      console.log(`Akses ke field ${field} bernilai FALSE`);
      return res.status(403).json({
        error: `Akses ke ${field} ditolak`,
        navigasi: '/User/Home'
      });
    }

    // 7. Jika Semua Validasi Lolos
    console.log(`Verifikasi Berhasil! Selamat datang ${userRole}`);
    return res.status(200).json({
      message: `Akses diizinkan untuk ${userRole}!`,
      user: decoded
    });

  } catch (err) {
    console.error('Error pada ChekingAdmin:', err);
    return res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
}

export default ChekingAdmin;