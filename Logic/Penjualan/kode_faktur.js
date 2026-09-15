

// Fungsi generator kode faktur ringkas
export function kode_faktur(sequenceNumber) {
  const date = new Date();
  const yy = String(date.getFullYear()).slice(-2); // 26
  const mm = String(date.getMonth() + 1).padStart(2, '0'); // 09
  
  // Format sequence menjadi 4 digit (misal: 1 -> 0001)
  const seq = String(sequenceNumber).padStart(4, '0');
  
  return `INV-${yy}${mm}-${seq}`; // Output: INV-2609-0001
}

