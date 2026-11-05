import { db } from "../../db.js";
import bcrypt from 'bcrypt';

export async function GET_ADMIN(req, res) {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = 10;
  const offset = (page - 1) * limit;

  try {
    const [rows] = await db.query(
      `SELECT id_admin, username, role, no_hp, alamat
       FROM admin
       ORDER BY username ASC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    return res.status(200).json({
      message: 'berhasil ambil data admin',
      data: rows
    });
  } catch (err) {
    console.error('GET_ADMIN error:', err);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
}







const ROLE_VALID = ['Admin', 'Sales'];
const SALT_ROUNDS = 10;

export async function TAMBAH_ADMIN(req, res) {
  try {
    // Role Admin sudah dijamin middleware CekRequestAkses
    const { username, password, role, no_hp, alamat } = req.body;

    // --- Validasi (jangan percaya FE) ---
    if (typeof username !== 'string' || !username.trim()) {
      return res.status(400).json({ message: 'Username wajib diisi' });
    }
    if (/\s/.test(username.trim())) {
      return res.status(400).json({ message: 'Username tidak boleh mengandung spasi' });
    }
    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ message: 'Password minimal 6 karakter' });
    }
    if (password.length > 72) { // batas bcrypt: lebih dari 72 byte dipotong
      return res.status(400).json({ message: 'Password maksimal 72 karakter' });
    }
    if (!ROLE_VALID.includes(role)) {
      return res.status(400).json({ message: 'Role tidak valid' });
    }
    if (typeof no_hp !== 'string' || !/^\d{9,15}$/.test(no_hp.trim())) {
      return res.status(400).json({ message: 'No HP tidak valid' });
    }
    if (alamat !== undefined && typeof alamat !== 'string') {
      return res.status(400).json({ message: 'Alamat harus berupa teks' });
    }

    const usernameBersih = username.trim();
    const alamatBersih = (alamat || '').trim();

    // --- Cek username unik ---
    const [cek] = await db.query(
      'SELECT id_admin FROM admin WHERE username = ? LIMIT 1',
      [usernameBersih]
    );
    if (cek.length > 0) {
      return res.status(409).json({ message: 'Username sudah dipakai' });
    }

    // --- Hash password ---
    const hash = await bcrypt.hash(password, SALT_ROUNDS);

    // --- Simpan ---
    const [result] = await db.query(
      `INSERT INTO admin (username, password, role, no_hp, alamat)
       VALUES (?, ?, ?, ?, ?)`,
      [usernameBersih, hash, role, no_hp.trim(), alamatBersih]
    );

    return res.status(201).json({
      message: 'Karyawan berhasil ditambahkan',
      id_admin: result.insertId,
    });
  } catch (err) {
    // Balapan 2 request dengan username sama (kalau kolom username UNIQUE)
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Username sudah dipakai' });
    }
    console.error('TAMBAH_ADMIN error:', err);
    return res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
}