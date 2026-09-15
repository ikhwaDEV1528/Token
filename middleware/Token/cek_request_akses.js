import jwt from 'jsonwebtoken';
import dotenv from 'dotenv'; // 1. FIX: Tambah import dotenv

dotenv.config();

export function CekRequestAkses(req, res, next) {
    // 2. FIX: Samakan nama variabel cookie biar gak ReferenceError
     const accses_token = req.cookies?.accses_token;
     const refresh_token = req.cookies?.refresh_token;


    if (!refresh_token || !accses_token) {
        return res.status(401).json({
            message: 'Acsses berkahir, Silahkan login kembali!',
            navigasi:'/'
        });
    }

    const JWT_SECRET = process.env.JWT_SECRET || 'RAHASIA_GW';
    let decode_accses_token;
    let decode_refresh_token;

    try {
        decode_accses_token = jwt.verify(accses_token, JWT_SECRET, { ignoreExpiration: true });
        decode_refresh_token = jwt.verify(refresh_token, JWT_SECRET, { ignoreExpiration: true });

        if (!decode_accses_token || !decode_refresh_token) {
            return res.status(401).json({
                message: 'Token rusak',
                navigasi: '/'
            });
        }

        if (decode_refresh_token.exp < Date.now() / 1000) {
            return res.status(401).json({
                message: 'Silahkan login',
                navigasi: '/'
            });
        }

        if (decode_accses_token.exp < Date.now() / 1000) {
            const Payload_Baru = {
                username: decode_refresh_token.username,
                role: decode_refresh_token.role,
                id_admin: decode_refresh_token.id_admin // 3. FIX: Pakai id_admin biar sama kayak Login.js
            };

            const Token_Accses_Baru = jwt.sign(Payload_Baru, JWT_SECRET, { expiresIn: '10m' });

            res.cookie('accses_token', Token_Accses_Baru, {
                httpOnly: true,
                secure: false,
                sameSite: 'lax',
                maxAge: 15 * 60 * 1000,
                path: '/'
            });

            req.id_admin = decode_refresh_token.id_admin;
            next();
            return;
        }

        req.id_admin = decode_accses_token.id_admin;
        
        next();
        return;

    } catch (err) {
        res.status(500).json({
            message: `Kesalahan ${err}`,
            navigasi: '/'
        });
    }
}