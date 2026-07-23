import rateLimit from "express-rate-limit"

import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	max: 100,
	validate: { xForwardedForHeader: false }, // 💡 MATIKAN VALIDASI INI BIAR GAK ERROR DI VERCEL
});

export default limit;