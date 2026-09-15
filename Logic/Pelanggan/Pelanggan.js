import db from "../../db.js"; // sesuaikan dengan file koneksi DB lu

export async function CariPelanggan(req, res) {
  try {
    const { inputCariPelanggan } = req.query;

    // Kalau input kosong, balikkan array kosong biar gak bebanin query
    if (!inputCariPelanggan || !inputCariPelanggan.trim()) {
      return res.status(200).json([]);
    }

    // Query kencang, aman dari SQL Injection (pake ?), dan diputus pake LIMIT 15
    const query = `
      SELECT kode_pelanggan, nama_pelanggan 
      FROM pelanggan 
      WHERE nama_pelanggan LIKE ? 
      ORDER BY nama_pelanggan ASC 
      LIMIT 15
    `;

    const searchKeyword = `%${inputCariPelanggan}%`;

    const [rows] = await db.query(query, [searchKeyword]);

    return res.status(200).json({data:rows , message:`${rows.length} Pelanggan ditemukan!`});
  } catch (error) {
    console.error('Error Cari Pelanggan:', error);
    return res.status(500).json({ message: 'Server Error' });
  }
}