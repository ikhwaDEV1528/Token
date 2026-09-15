import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import db from '../../db.js';

dotenv.config();

async function Login(req, res) {
  const { username, password } = req.body || {};



  // 1. Validasi Input Dasar
  if (!username || !password) {
    return res.status(400).json({ message: 'Username dan password wajib diisi!' });
  }

  try {
    const RAHASIA_GW = 'RAHASIA_GW';

    // 2. Query ke MySQL (Cari berdasarkan username saja agar lebih aman)
    console.log('Mencoba mencari user di DB...');
    const [rows] = await db.query(
      `SELECT * FROM admin WHERE username = ?`, 
      [username]
    );

    // 3. Cek apakah user DITEMUKAN di DB
    // (Jika rows kosong / length === 0, BERARTI USER GAK ADA)
    if (!rows || rows.length === 0) {
      console.log('❌ User tidak ditemukan di DB');
      return res.status(404).json({ message: 'User tidak ditemukan!' });
    }

    const user = rows[0]; // Ambil objek user dari baris pertama

    // 4. Cek Password Secara Eksplisit
    if (user.password !== password) {
      console.log('❌ Password salah');
      return res.status(401).json({ message: 'Username/Password salah!' });
    }

    // 5. Normalisasi Role (Cegah spasi / beda huruf besar kecil dari DB)
    const roleUser = user.role
   

    // 6. Penentuan Navigasi Redirect
    let redirect;
    if (roleUser === 'Admin') {
      redirect = '/Admin/Dashboard';
    } else if (roleUser === 'Sales') {
      redirect = '/User/Home';
    } else {
      redirect = '/Driver/Home';
    }

    // 7. JWT Payload & Cookie
    const payload = {
      id_admin: user.id_admin,
      username: user.username,
      role: roleUser
    };

    const TokenAccses = jwt.sign(payload, RAHASIA_GW, { expiresIn: '15m' });
    const TokenReload = jwt.sign(payload, RAHASIA_GW, { expiresIn: '2h' });

    const cookieOptions = {
      httpOnly: true,
      secure:false , // Set false untuk dev localhost
      sameSite: 'lax', // lax
      maxAge: 15 * 60 * 1000,
      path: '/'
    };


    const cookieOptionsRefresh = {
      httpOnly: true,
      secure: false, // Set false untuk dev localhost
      sameSite: 'lax', // lax
      maxAge: 2 * 60 * 60 * 1000,
      path: '/'
    };

    res.cookie('accses_token', TokenAccses, cookieOptions);
    res.cookie('refresh_token', TokenReload, cookieOptionsRefresh);

    console.log(`🚀 Success Login! Navigasi ke: ${redirect}`);
    return res.status(200).json({
      message: `${user.username}, berhasil login!`,
      navigasi: redirect
    });

  } catch (err) {
    console.error('❌ Error Catch Controller:', err);
    return res.status(500).json({ message: err.message || 'Internal Server Error' });
  }
}

export default Login;