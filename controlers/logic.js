import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { db } from '../config/firebase/fireStore.js';

dotenv.config();

const Database = [
  { username: 'ikhwan', email: 'ikhwan@gmail.com', role: 'User', user_id: 123 },
  { username: 'wulan', email: 'wulan@gmail.com', role: 'Admin', user_id: 124 }
];

async function Logic(req, res) {
  const { username, email } = req.body;

  try {
    // 💡 AMBIL DARI process.env DI DALAM FUNGSI (Pasti terbaca oleh Vercel)
    const RAHASIA_GW = 'RAHASIA_GW';

    // Cari user berdasarkan username
    const Search = Database.find(item => item.username === username);

    if (!Search) {
      return res.status(404).json({ message: 'User not found!' });
    }

    // Tentukan halaman redirect berdasarkan role
    let redirect;
    if (Search.role === 'Admin') {
      redirect = '/Admin/Dashboard';
    } else if (Search.role === 'User') {
      redirect = '/User/Home';
    } else {
      redirect = '/Driver/Home';
    }

    const payload = {
      username: Search.username,
      email: Search.email,
      user_id: Search.user_id,
      role: Search.role
    };

    // Make Access & Refresh Token
    const TokenAccses = jwt.sign(payload, RAHASIA_GW, { expiresIn: '1m' });
    const TokenReload = jwt.sign(payload, RAHASIA_GW, { expiresIn: '5m' });

    // Opsi konfigurasi Cookie dinamis
    const isProduction = process.env.NODE_ENV === 'production';
    const cookieOptions = {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      maxAge: 10 * 60 * 1000
    };

    res.cookie('accses_token', TokenAccses, cookieOptions);
    res.cookie('refresh_token', TokenReload, cookieOptions);

    // Ambil kata kunci halaman dari URL redirect
    const pathHalaman = redirect.split('/')[2];

    const sesion_user = `${payload.user_id}_${payload.username}`;
    const Alamat = db.collection('sesion_user').doc(sesion_user);

    // Simpan ke Firestore
    await Alamat.set({
      sesion_id: sesion_user,
      username: payload.username,
      user_id: payload.user_id,
      Home: pathHalaman === 'Home',
      Dashboard: pathHalaman === 'Dashboard',
      Checkout: false,
      Stok: false
    });

    console.log('Berhasil membuat sesi user & token');

    return res.status(200).json({
      message: `${payload.username}, Kamu dapat Token untuk Login!`,
      navigasi: redirect
    });

  } catch (err) {
    console.error('Error pada Logic Controller:', err);
    return res.status(500).json({ message: err.message || 'Internal Server Error' });
  }
}

export default Logic;

// force rebuild