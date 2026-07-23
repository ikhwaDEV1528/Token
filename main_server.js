import express from 'express';
import login from './endpoint/auth/login.js';
import cors from 'cors';
import cookieParser from 'cookie-parser';

const app = express();

// 💡 FIX UNTUK VERCEL RATE LIMIT (PENTING!)
app.set('trust proxy', 1);

app.use(cors({
    origin: function (origin, callback) {
        callback(null, true); // Allow origin
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'cookie', 'path']
})); 

app.use(express.json()); 
app.use(cookieParser());

app.use((req, res, next) => {
    console.log(`[BE HIT] ${req.method} ${req.url}`);
    next();
});

app.use('/server_login', login);

if (!process.env.VERCEL) {
    const port = 4000;
    app.listen(port, () => console.log('BE JALAN DI PORT ' + port));
}

export default app;