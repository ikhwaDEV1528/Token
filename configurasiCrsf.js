import { doubleCsrf } from 'csrf-csrf';
import dotenv from 'dotenv';

dotenv.config()
const isProduction = process.env.NODE_ENV === 'production';

// Inisialisasi doubleCsrf
const doubleCsrfUtilities = doubleCsrf({
  getSecret: () =>  process.env.CSRF_SECRET,
  cookieName: isProduction ? '__Host-ps.x-csrf-token' : 'ps.x-csrf-token',
  cookieOptions: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction, // Wajib true jika HTTPS/Production
    path: '/',
  },
  size: 64,
  ignoredMethods: [ 'HEAD', 'OPTIONS'],
  getTokenFromRequest: (req) => req.headers['x-csrf-token'],

  // 💡 TAMBAHKAN BARIS INI: Wajib ada di versi v3+ agar tidak crash
  getSessionIdentifier: (req) => req.cookies?.refresh_token || 'default-session-id',
});

// Log untuk memastikan di Railway server
console.log("--> CSRF Utilities Keys:", Object.keys(doubleCsrfUtilities));

// Export Middleware Proteksi
export const doubleCsrfProtection = doubleCsrfUtilities.doubleCsrfProtection;

// Export Fungsi Generate Token (Support Versi Baru & Lama)
export const generateToken = (req, res) => {
  // Versi v3+ menggunakan nama generateCsrfToken atau generateToken
  const generate = doubleCsrfUtilities.generateCsrfToken || doubleCsrfUtilities.generateToken;

  if (typeof generate === 'function') {
    return generate(req, res);
  }

  throw new Error("Fungsi generateToken tidak ditemukan pada instance csrf-csrf!");
};