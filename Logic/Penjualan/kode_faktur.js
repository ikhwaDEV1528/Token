export function kode_faktur() {
  const date = new Date();
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  
  // Pakai jam-menit-detik-milidetik + random 3 digit, drastis kurangi peluang bentrok
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  const rand = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
  
  return `INV-${yy}${mm}${dd}-${hh}${mi}${ss}${ms}${rand}`;
}