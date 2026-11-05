import bcrypt from 'bcrypt';
import { db } from './db.js'; // sesuaikan path ke db.js kamu

const [rows] = await db.query('SELECT id_admin, username, password FROM admin');

let jumlah = 0;

for (const r of rows) {
  if (/^\$2[aby]\$/.test(r.password)) {
    console.log(`- ${r.username}: sudah hash, dilewati`);
    continue;
  }

  const hash = await bcrypt.hash(r.password, 10);
  await db.query('UPDATE admin SET password = ? WHERE id_admin = ?', [hash, r.id_admin]);
  console.log(`✔ ${r.username}: di-hash`);
  jumlah++;
}

console.log(`Selesai. ${jumlah} akun di-hash.`);
process.exit(0);