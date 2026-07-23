import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { db } from '../config/firebase/fireStore.js';

dotenv.config();

async function ChekingAdmin(req, res) {
  try {
    const RAHASIA_GW = process.env.RAHASIA || 'RAHASIA_GW';

    // 1. Ambil & validasi header path
    const headerPath = req.headers['path'] || '';
    if (!headerPath) {
      return res.status(400).json({ error: 'Header path wajib diisi!' });
    }

    const pathSegments = headerPath.split('/');
    // Pakai lowercase biar tidak bentrok beda huruf besar/kecil
    const mainPath = pathSegments[1]?.toLowerCase() || ''; 
    const fieldRaw = pathSegments[2] || '';

    // 2. Ambil token dari cookie
    let accessToken = req.cookies?.accses_token;
    const refreshToken = req.cookies?.refresh_token;

    if (!accessToken) {
      return res.status(401).json({ error: 'Access token undefined, silakan login kembali!' });
    }

    let decoded;

    // 3. Process Verifikasi Access Token & Auto-Refresh
    try {
      decoded = jwt.verify(accessToken, RAHASIA_GW);
    } catch (err) {
      if (err.name === 'TokenExpiredError' || jwt.decode(accessToken)?.exp < Date.now() / 1000) {
        console.log('Access token expired! Mencoba refresh token...');

        if (!refreshToken) {
          return res.status(401).json({ error: 'Refresh token undefined, silakan login kembali!' });
        }

        try {
          const decodedRefresh = jwt.verify(refreshToken, RAHASIA_GW);

          decoded = {
            username: decodedRefresh.username,
            email: decodedRefresh.email,
            role: decodedRefresh.role,
            user_id: decodedRefresh.user_id
          };

          const newAccessToken = jwt.sign(decoded, RAHASIA_GW, { expiresIn: '2m' });

          // 💡 Cookie Options disamakan agar tembus Cross-Site Vercel
          res.cookie('accses_token', newAccessToken, {
            httpOnly: true,
            secure: true,
            sameSite: 'none',
            maxAge: 10 * 60 * 1000
          });

          console.log('Access Token berhasil diperbarui secara otomatis!');
        } catch (refreshErr) {
          return res.status(401).json({ error: 'Refresh token kadaluarsa/rusak, silakan login kembali!' });
        }
      } else {
        return res.status(401).json({ error: 'Access token tidak valid atau rusak!' });
      }
    }

    // 4. Verifikasi Role berdasarkan Path URL (Format disamakan ke Lowercase)
    const userRole = decoded.role?.toLowerCase();

    if (mainPath === 'admin' && userRole !== 'admin') {
      console.log('Bukan Admin!');
      return res.status(403).json({ error: 'Akses ditolak! Anda bukan Admin.' });
    }

    if (mainPath === 'user' && userRole !== 'user') {
      console.log('Bukan User!');
      return res.status(403).json({ error: 'Akses ditolak! Anda bukan User.' });
    }

    // 5. Cek Dokumen Sesi di Firestore
    const sessionDocId = `${decoded.user_id}_${decoded.username}`;
    const sessionRef = db.collection('sesion_user').doc(sessionDocId);
    const doc = await sessionRef.get();

    if (!doc.exists) {
      console.log('Sesi dokumen Firestore tidak ditemukan!');
      return res.status(401).json({ message: `Sesi ${decoded.role} tidak ditemukan di database!` });
    }

    // 6. Cek Hak Akses Halaman (Pengecekan Fleksibel Uppercase/Lowercase)
    if (fieldRaw) {
      const docData = doc.data();
      // Cari field di firestore tanpa peduli Kapital/Kecilnya
      const hasAccess = docData[fieldRaw] || docData[fieldRaw.charAt(0).toUpperCase() + fieldRaw.slice(1)];

      if (!hasAccess) {
        console.log(`Akses ke field ${fieldRaw} bernilai FALSE`);
        return res.status(403).json({
          error: `Akses ke ${fieldRaw} ditolak`,
          navigasi: userRole === 'admin' ? '/admin/dashboard' : '/user/home'
        });
      }
    }

    // 7. Jika Semua Validasi Lolos
    console.log(`Verifikasi Berhasil! Selamat datang ${decoded.role}`);
    return res.status(200).json({
      message: `Akses diizinkan untuk ${decoded.role}!`,
      user: decoded
    });

  } catch (err) {
    console.error('Error pada ChekingAdmin:', err);
    return res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
}

export default ChekingAdmin;