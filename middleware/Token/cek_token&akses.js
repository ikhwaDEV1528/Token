
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { generateToken } from '../../configurasiCrsf.js';

dotenv.config();

// ============================================================
// KONFIGURASI (dibiarkan statis seperti sebelumnya)
// ============================================================
const JWT_SECRET =  process.env.RAHASIA;

// Whitelist algoritma HMAC saja: menolak token "alg: none" dan algoritma asimetris.
const JWT_ALGORITHMS = ['HS256', 'HS384', 'HS512'];

// Umur access token baru dan umur cookie-nya dibuat SATU sumber agar tidak beda lagi
// (sebelumnya token 10 menit, cookie 15 menit).
const ACCESS_TOKEN_TTL_SECONDS = 10 * 60;

const ACCESS_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
  path: '/'
};

// ============================================================
// HELPER
// ============================================================

// Verifikasi signature. Expired TIDAK ditolak di sini karena dicek manual (untuk alur auto-refresh).
// exp WAJIB ada dan berupa angka: token tanpa exp dulu dianggap tidak pernah expired.
function bacaToken(token) {
  const decoded = jwt.verify(token, JWT_SECRET, {
    algorithms: JWT_ALGORITHMS,
    ignoreExpiration: true
  });

  if (!decoded || typeof decoded !== 'object' || typeof decoded.exp !== 'number') {
    throw new Error('Token tidak memiliki exp yang valid');
  }
  return decoded;
}

function sudahExpired(decoded, nowSeconds) {
  return decoded.exp <= nowSeconds;
}

// Ambil segmen pertama path sebagai role halaman.
// "/admin/dashboard" -> "admin", "admin/dashboard" -> "admin", "/admin?x=1" -> "admin"
// Sebelumnya split('/')[1] membuat path tanpa "/" di depan salah terbaca (jadi 403).
function ambilRoleDariPath(pathName) {
  if (typeof pathName !== 'string') return null;
  const tanpaQuery = pathName.split(/[?#]/)[0];
  const segmen = tanpaQuery.split('/').filter(Boolean);
  return segmen[0] || null;
}

// ============================================================
// HANDLER UTAMA
// ============================================================
export async function Cheking_token_role(req, res) {
  // Log aman: TIDAK mencetak body, headers, atau cookie (isinya token dan data sensitif).
  console.log('Masuk Logic Hak Akses!', req.method, req.originalUrl);

  const pathName = req.body?.headerPath || req.headers['x-path'];

  if (!pathName) {
    console.log('pathname kagak ada');
    return res.status(403).json({ message: 'Path Tidak Ada!', status: 404, navigasi: '/' });
  }

  try {
    const accses_token = req.cookies?.accses_token;
    const refresh_token = req.cookies?.refresh_token;

    // 1. Refresh token adalah kredensial utama. Tanpa ini wajib login.
    if (!refresh_token) {
      console.log('Refresh token hilang!');
      return res.status(401).json({ message: 'Token tidak lengkap, silahkan login!', status: 401, navigasi: '/' });
    }

    // 2. Cek signature refresh token
    let decode_refresh_token;
    try {
      decode_refresh_token = bacaToken(refresh_token);
    } catch (err) {
      console.log('Signature Refresh Token Palsu / Corrupt!');
      return res.status(401).json({ message: 'Token Invalid!', status: 401, navigasi: '/' });
    }

    const currentTime = Date.now() / 1000;

    // 3. Refresh expired -> wajib login ulang
    if (sudahExpired(decode_refresh_token, currentTime)) {
      console.log('Refresh Token Expired!');
      return res.status(401).json({ message: 'Sesi berakhir, silahkan login kembali!', status: 401, navigasi: '/' });
    }

    // 4. Cek access token (kalau ada)
    let decode_accses_token = null;

    if (accses_token) {
      try {
        decode_accses_token = bacaToken(accses_token);
      } catch (err) {
        console.log('Signature Access Token Palsu / Corrupt!');
        return res.status(401).json({ message: 'Token Invalid!', status: 401, navigasi: '/' });
      }
    }

    // 5. Access token HILANG atau EXPIRED -> buat baru dari data refresh token.
    //    Sebelumnya, cookie access yang sudah hilang dari browser (maxAge habis) langsung
    //    ditolak, padahal refresh token masih valid. Ini penyebab utama "dikit-dikit disuruh login".
    if (!decode_accses_token || sudahExpired(decode_accses_token, currentTime)) {
      console.log('Access Token hilang/expired -> Membuat Access Token baru...');

      const Payload_Baru = {
        username: decode_refresh_token.username,
        email: decode_refresh_token.email,
        role: decode_refresh_token.role,
        user_id: decode_refresh_token.user_id
      };

      const Token_Accses_Baru = jwt.sign(Payload_Baru, JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL_SECONDS });

      res.cookie('accses_token', Token_Accses_Baru, ACCESS_COOKIE_OPTIONS);

      decode_accses_token = Payload_Baru;
    }

    // 6. VALIDASI ROLE HALAMAN
    const targetRole = ambilRoleDariPath(pathName);
    const userRole = decode_accses_token.role;

    // targetRole dan userRole sama-sama wajib ada (sebelumnya undefined === undefined bisa lolos)
    if (targetRole && userRole && targetRole === userRole) {
      if (typeof generateToken !== 'function') {
        console.error('CRITICAL ERROR: generateToken bernilai', typeof generateToken);
        return res.status(500).json({ message: 'Konfigurasi CSRF di server bermasalah!' });
      }
      const csrfToken = generateToken(req, res);
      return res.status(200).json({ message: 'Hak akses dan Sesi terpenuhi!', csrfToken: csrfToken });
    }

    console.log('Tidak memiliki hak akses!');
    return res.status(403).json({ message: 'Tidak memiliki hak akses!', status: 403, navigasi: '/' });

  } catch (err) {
    console.error('Internal Server Error:', err);
    // Jangan kirim objek error mentah ke client (bisa membocorkan detail internal)
    return res.status(500).json({ message: 'Terjadi kesalahan pada server!' });
  }
}
