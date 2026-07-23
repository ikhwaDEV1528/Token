import 'dotenv/config';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore.js';

const serviceAccountEnv = process.env.FIREBASE_SERVICE_ACCOUNT;

if (!serviceAccountEnv) {
  throw new Error("❌ FIREBASE_SERVICE_ACCOUNT tidak ditemukan di .env!");
}

const serviceAccount = JSON.parse(serviceAccountEnv);
serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');

// Inisialisasi Firebase App
const app = initializeApp({
  credential: cert(serviceAccount)
});

// Inisialisasi Firestore
export const db = getFirestore(app);