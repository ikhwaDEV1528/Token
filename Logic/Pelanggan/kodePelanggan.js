// export function generateKodePelanggan(namaPelanggan) {
//   // 1. Bersihin nama & ambil kata-katanya
//   const kata = namaPelanggan.trim().toUpperCase().split(/\s+/);
//   let inisial = '';

//   if (kata.length >= 2) {
//     // Kalau ada 2 kata atau lebih, ambil huruf pertama dari kata ke-1 & ke-2 (Contoh: "Ahmad Dahlan" -> "AD")
//     inisial = kata[0][0] + kata[1][0];
//   } else if (kata[0].length >= 3) {
//     // Kalau cuma 1 kata & panjang >= 3 huruf, ambil 3 huruf pertama (Contoh: "Zainal" -> "ZAI")
//     inisial = kata[0].slice(0, 3);
//   } else {
//     // Kalau namanya pendek banget (contoh: "Li"), ambil semua lalu pad dengan "X" (Contoh: "LI" -> "LIX")
//     inisial = kata[0].padEnd(3, 'X');
//   }

//   // 2. Ambil waktu (Tahun, Bulan, Tanggal, Milidetik)
//   const date = new Date();
//   const time = date.getFullYear().toString().slice(-2) +
//                String(date.getMonth() + 1).padStart(2, '0') +
//                String(date.getDate()).padStart(2, '0') +
//                String(date.getMilliseconds()).padStart(3, '0');

//   // 3. Tambah 2 digit acak biar makin aman kalau submit barengan di milidetik yang sama
//   const random = Math.floor(10 + Math.random() * 90);

//   return `${inisial}${time}${random}`;
// }

import { randomInt } from 'crypto';

const ALFABET = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // tanpa I & O biar tidak ambigu

export function generateKodePelanggan(namaPelanggan) {
  const kata = String(namaPelanggan || '')
    .toUpperCase()
    .replace(/[^A-Z\s]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  let inisial;
  if (kata.length >= 2) inisial = kata[0][0] + kata[1][0];                  // "Ahmad Dahlan" -> "AD"
  else if (kata.length === 1) inisial = kata[0].slice(0, 2).padEnd(2, 'X'); // "Zainal" -> "ZA"
  else inisial = 'XX';

  let acak = '';
  for (let i = 0; i < 5; i++) acak += ALFABET[randomInt(ALFABET.length)];

  return inisial + acak; // 7 karakter, contoh: AD7K2QX
}