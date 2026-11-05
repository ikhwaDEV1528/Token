import serverless from 'serverless-http';
import app from '../main_server.js'; // 1. Wajib pakai ekstensi .js

// 2. Ekstrak .default jika dibungkus oleh compiler/esbuild Netlify
const expressApp = app.default || app;

export const handler = serverless(expressApp);