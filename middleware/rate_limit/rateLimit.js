import rateLimit from "express-rate-limit"

const limit = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 5,
    // Tambahkan 'req' di depan 'res' agar urutannya benar
    handler: (req, res) => {
        res.status(429).json({ message: 'Terlalu banyak aksi!' }); 
        // Note: 429 adalah status code standar untuk Too Many Requests
    },
    standardHeaders: true,
    legacyHeaders: false
});

export default limit;