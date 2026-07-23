import { db } from "../config/firebase/fireStore.js";
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv'; // 1. Tambahkan import dotenv

dotenv.config();

async function cheking_route(req, res, next) {
  try {
    // 💡 Dipindahkan ke dalam fungsi + Fallback Hardcode Cadangan
    const RAHASIA_GW = 'RAHASIA_GW'

    const { route } = req.body;

    // 2. Validasi agar tidak crash jika route kosong
    if (!route || typeof route !== 'string') {
      return res.status(400).json({
        message: 'Route tidak valid!',
        status: 400
      });
    }

    const field = route.split('/')[2];

    // 3. Ambil token dari cookie (dengan optional chaining)
    const token = req.cookies?.accses_token;

    if (!token) {
      // 4. Perbaikan syntax res.status(401).json
      return res.status(401).json({
        message: 'undefined token!',
        navigasi: '/'
      });
    }

    // Verifikasi Token JWT
    const decode = jwt.verify(token, RAHASIA_GW);

    const doc = `${decode.user_id}_${decode.username}`;
    const alamat = db.collection('sesion_user').doc(doc);
    const snap = await alamat.get();

    if (!snap.exists) {
      return res.status(404).json({
        message: 'sesion tidak ditemukan!',
        status: 404,
        navigasi: '/'
      });
    }

    // Update field jika field dari split route tersedia
    if (field) {
      await alamat.update({
        [field]: true
      });
      console.log('FIELD BERHASIL DIUBAH: ' + field);
    }

    return res.status(200).json({
      message: `Navigasi ke ${route}`,
      navigasi: route
    });

  } catch (err) {
    // 5. Menangani error token/server agar frontend dapat respon
    console.error('Error pada cheking_route:', err.message);
    return res.status(401).json({
      message: 'Token tidak valid atau sesi kadaluarsa!',
      error: err.message,
      navigasi: '/'
    });
  }
}

export default cheking_route;