
export function generateKodeBarang() {
  // Ambil 4 karakter dari timestamp detik/milidetik saat ini (selalu berubah)
  const timePart = Date.now().toString(36).toUpperCase().slice(-4);
  
  // Ambil 3 karakter acak murni
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let randomPart = '';
  for (let i = 0; i < 3; i++) {
    randomPart += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  // Gabungkan (Total pas 7 digit)
  return `${timePart}${randomPart}`; // Contoh: "K89X2A1", "L0AB9X2"
}