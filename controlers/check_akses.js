import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { db } from '../config/firebase/fireStore.js';

dotenv.config();

async function ChekingAdmin(req, res) {
  try {
  const {headerPath} = req.body;

  if(!headerPath) {
    return res.status(404).json({message:'PATH KONTOL'})
  }
  console.log('VERCEL KONTOL')

   res.status(200).json({message:'VERCELL KONTOLLL'})
  } catch (err) {
    console.error('Error pada ChekingAdmin:', err);
    return res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
}

export default ChekingAdmin;

// force rebuild