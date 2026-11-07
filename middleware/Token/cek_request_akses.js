// import jwt from 'jsonwebtoken';
// import dotenv from 'dotenv'; // 1. FIX: Tambah import dotenv

// dotenv.config();

// export function CekRequestAkses(req, res, next) {
//     // 2. FIX: Samakan nama variabel cookie biar gak ReferenceError
//     const accses_token = req.cookies?.accses_token;
//     const refresh_token = req.cookies?.refresh_token;


//     if (!refresh_token || !accses_token) {
//         return res.status(401).json({
//             message: 'Acsses berkahir, Silahkan login kembali!',
//             navigasi: '/'
//         });
//     }

//     const JWT_SECRET = process.env.JWT_SECRET || 'RAHASIA_GW';
//     let decode_accses_token;
//     let decode_refresh_token;

//     try {
//         decode_accses_token = jwt.verify(accses_token, JWT_SECRET, { ignoreExpiration: true });
//         decode_refresh_token = jwt.verify(refresh_token, JWT_SECRET, { ignoreExpiration: true });

//         if (!decode_accses_token || !decode_refresh_token) {
//             return res.status(401).json({
//                 message: 'Token rusak',
//                 navigasi: '/'
//             });
//         }

//         if (decode_refresh_token.exp < Date.now() / 1000) {
//             return res.status(401).json({
//                 message: 'Silahkan login',
//                 navigasi: '/'
//             });
//         }

//         if (decode_accses_token.exp < Date.now() / 1000) {
//             const Payload_Baru = {
//                 username: decode_refresh_token.username,
//                 role: decode_refresh_token.role,
//                 id_admin: decode_refresh_token.id_admin // 3. FIX: Pakai id_admin biar sama kayak Login.js
//             };

//             const Token_Accses_Baru = jwt.sign(Payload_Baru, JWT_SECRET, { expiresIn: '10m' });

//             res.cookie('accses_token', Token_Accses_Baru, {
//                 httpOnly: true,
//                 secure: false,
//                 sameSite: 'lax',
//                 maxAge: 15 * 60 * 1000,
//                 path: '/'
//             });

//             if (decode_refresh_token.role !== 'Admin' || !decode_refresh_token.role) {
//                 return res.status(403).json({
//                     message: 'Anda bukan admin, silahkan login kembali!'
//                 })
//             }

//             req.id_admin = decode_refresh_token.id_admin;
//             next();
//             return;
//         }

//         if (decode_refresh_token.role !== 'Admin' || !decode_accses_token.role) {
//             return res.status(403).json({
//                 message: 'Anda bukan admin. Atau terdapat masalah internal server, silahkan login kembali!'
//             })
//         }

//         req.id_admin = decode_accses_token.id_admin;
//         next();
//         return;

//     } catch (err) {
//         res.status(500).json({
//             message: `Kesalahan ${err}`,
//             navigasi: '/'
//         });
//     }
// }


import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

// Tanpa fallback hardcoded. Kalau env kosong, server langsung gagal start.
const JWT_SECRET =  process.env.RAHASIA;

if (!JWT_SECRET) {
    throw new Error('JWT_SECRET belum di-set di environment variable!');
}

export function CekRequestAkses(req, res, next) {
    const accses_token = req.cookies?.accses_token;
    const refresh_token = req.cookies?.refresh_token;

    // Yang wajib cuma refresh token. Access token boleh hilang
    // (browser menghapus cookie yang sudah lewat maxAge-nya).
    if (!refresh_token) {
        console.log('Silahkan login kembali!')
        return res.status(401).json({
            message: 'Silahkan login kembali!',
            navigasi: '/'
        });
    }

    let decode_refresh_token;
    try {
        // Tanpa ignoreExpiration: refresh token expired / palsu -> throw
        decode_refresh_token = jwt.verify(refresh_token, JWT_SECRET, { algorithms: ['HS256'] });
    } catch (err) {
        console.log('Sesio berkahir')
        return res.status(401).json({
            message: 'Sesi berakhir, silahkan login kembali!',
            navigasi: '/'
        });
    }

    if (decode_refresh_token.role !== 'Admin') {
        console.log('Anda bukan admin')
        return res.status(403).json({
            message: 'Anda bukan admin, silahkan login kembali!',
            navigasi: '/'
        });
    }

    // Access token masih valid dan cocok dengan refresh token -> lanjut
    if (accses_token) {
        try {
            const decode_accses_token = jwt.verify(accses_token, JWT_SECRET, { algorithms: ['HS256'] });

            if (
                decode_accses_token.role === 'Admin' &&
                decode_accses_token.id_admin === decode_refresh_token.id_admin
            ) {
                req.id_admin = decode_accses_token.id_admin;
                return next();
            }
        } catch (err) {
            // expired / tidak valid -> jatuh ke penerbitan token baru di bawah
        }
    }

    // Access token hilang / expired, refresh token masih valid -> terbitkan baru
    const Payload_Baru = {
        username: decode_refresh_token.username,
        role: decode_refresh_token.role,
        id_admin: decode_refresh_token.id_admin
    };

    const Token_Accses_Baru = jwt.sign(Payload_Baru, JWT_SECRET, { expiresIn: '10m' });

    res.cookie('accses_token', Token_Accses_Baru, {
        httpOnly: true,
        secure: true, // TODO: ganti true saat production (HTTPS)
        sameSite: 'lax',
        maxAge: 10 * 60 * 1000,
        path: '/'
    });

    req.id_admin = decode_refresh_token.id_admin;
    return next();
}