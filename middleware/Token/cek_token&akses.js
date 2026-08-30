import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

async function Cheking_token_role(req, res) {
  console.log('Masuk Logic Hak Akses!');
  console.log('===== DEBUG MASUK FUNGSI =====');
  console.log('Method:', req.method);
  console.log('URL:', req.originalUrl);
  console.log('Body:', req.body);
  console.log('Headers:', req.headers);
  console.log('===============================')

  const pathName = req.body?.headerPath || req.headers['x-path'];

  if (!pathName) {
    console.log('pathname kagak ada')
    return res.status(404).json({ message: 'Path Tidak Ada!', status: 404, navigasi: '/' });
  }


  

  try {
    const accses_token = req.cookies?.accses_token;
    const refresh_token = req.cookies?.refresh_token;

    // 1. CEK KEBERADAAN: Salah satu hilang? Langsung tolak!
    if (!accses_token || !refresh_token) {
      console.log('Salah satu token hilang!');
      return res.status(401).json({ message: 'Token tidak lengkap, silahkan login!', status: 401, navigasi: '/' });
    }

    const JWT_SECRET = process.env.JWT_SECRET || 'RAHASIA_GW';
    let decode_accses_token;
    let decode_refresh_token;

    // 2. CEK SIGNATURE: Langsung verify keduanya tanpa "if" redundan
    try {
      decode_accses_token = jwt.verify(accses_token, JWT_SECRET, { ignoreExpiration: true });
      decode_refresh_token = jwt.verify(refresh_token, JWT_SECRET, { ignoreExpiration: true });
    } catch (err) {
      console.log('Signature Token Palsu / Corrupt!');
      return res.status(401).json({ message: 'Token Invalid!', status: 401, navigasi: '/' });
    }

    const currentTime = Date.now() / 1000;

    // 3. CEK EXPIRED REFRESH: Jika refresh expired, wajib login ulang
    if (decode_refresh_token.exp < currentTime) {
      console.log('Refresh Token Expired!');
      return res.status(401).json({ message: 'Sesi berakhir, silahkan login kembali!', status: 401, navigasi: '/' });
    }

    // 4. CEK EXPIRED ACCESS: Jika access expired, buat baru pakai data refresh
    if (decode_accses_token.exp < currentTime) {
      console.log('Access Token Expired -> Membuat Access Token baru...');

      const Payload_Baru = {
        username: decode_refresh_token.username,
        email: decode_refresh_token.email,
        role: decode_refresh_token.role,
        user_id: decode_refresh_token.user_id
      };

      const Token_Accses_Baru = jwt.sign(Payload_Baru, JWT_SECRET, { expiresIn: '10m' });
      

      res.cookie('accses_token', Token_Accses_Baru, {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        maxAge: 10 * 60 * 1000,
        path: '/'
      });

      decode_accses_token = Payload_Baru;
    }

    // 5. VALIDASI ROLE HALAMAN
    console.log('Token accses tidak EXP!')
    const targetRole = pathName.split('/')[1];
    const userRole = decode_accses_token.role;

    if (targetRole === userRole) {
      return res.status(200).json({ message: 'Hak akses dan Sesi terpenuhi!' });
    }
    
    console.log('Tidak memiliki hak akses!')
    return res.status(403).json({ message: 'Tidak memiliki hak akses!', status: 403, navigasi: '/' });

  } catch (err) {
    console.error('Internal Server Error:', err);
    return res.status(500).json({ error: err.message });
  }
}

export default Cheking_token_role;