import jwt from 'jsonwebtoken';
import dotenv from 'dotenv'; // 1. Import dotenv

dotenv.config(); // 2. Panggil dengan tanda kurung ()

const accsesToken = (req, res, next) => {
  try {
    // 💡 Dipindahkan ke dalam fungsi + Fallback Hardcode Cadangan
    const RAHASIA_GW = process.env.RAHASIA || process.env.RAHASIA_GW || 'kuncirahasiasuper12345';

    // Gunakan optional chaining (?.) agar tidak crash jika cookie kosong
    const tokenAccses = req.cookies?.accses_token;

    if (!tokenAccses) {
      return res.status(401).json({ error: 'Undefined Access Token' });
    }

    // Decode token tanpa memicu error expired dulu
    const decode = jwt.verify(tokenAccses, RAHASIA_GW, { ignoreExpiration: true });

    // -------------------------------------------------------------
    // SKENARIO 1: Access Token Sudah Expired (Coba Auto-Refresh)
    // -------------------------------------------------------------
    if (decode.exp < Date.now() / 1000) {
      console.log('Access Token Expired, mencoba Auto-Refresh...');
      const tokenRefresh = req.cookies?.refresh_token;

      if (!tokenRefresh) {
        console.log('Token Refresh tidak ditemukan');
        return res.status(401).json({ error: 'Undefined Refresh Token, silakan login ulang' });
      }

      const decodeRefresh = jwt.verify(tokenRefresh, RAHASIA_GW, { ignoreExpiration: true });

      if (decodeRefresh.exp < Date.now() / 1000) {
        console.log('Token Refresh Expired');
        return res.status(401).json({ error: 'Sesi habis, Silahkan login kembali' });
      }

      // Siapkan payload baru (sertakan user_id juga)
      const payload = {
        user_id: decode.user_id,
        username: decode.username,
        email: decode.email,
        role: decode.role,
      };

      const AccsesTokenBaru = jwt.sign(payload, RAHASIA_GW, { expiresIn: '2m' });

      // Pasang cookie baru
      res.cookie('accses_token', AccsesTokenBaru, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 10 * 60 * 1000
      });

      req.user = payload; // Disimpan untuk controller selanjutnya
      console.log('Access Token berhasil diperbarui secara otomatis!');
      return next();
    }

    // -------------------------------------------------------------
    // SKENARIO 2: Access Token Masih Aktif & Valid
    // -------------------------------------------------------------
    const payload = {
      user_id: decode.user_id,
      username: decode.username,
      email: decode.email,
      role: decode.role,
    };

    req.user = payload;
    console.log('Token Valid, Lanjut ke Controller Logic!');
    return next();

  } catch (err) {
    // Tangkap jika token diubah/dimanipulasi oleh hacker (signature invalid)
    console.error('Error Autentikasi Token:', err.message);
    return res.status(401).json({ error: 'Token rusak atau tidak valid: ' + err.message });
  }
};

export default accsesToken;