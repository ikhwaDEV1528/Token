
import db from "../../db.js";

export async function CariSuplier(req, res) {
  const { inputCariSuplier } = req.query;

  if (!inputCariSuplier || !inputCariSuplier.trim()) {
    return res.status(200).json({ status: "success", data: [] });
  }

  try {
    const keyword = inputCariSuplier.trim();

    // Query khusus MySQL
    const query = `
      SELECT id_supplier, nama_supplier
      FROM Supplier
      WHERE nama_supplier LIKE ?
      ORDER BY nama_supplier ASC
      LIMIT 10;
    `;

    const values = [`%${keyword}%`];
    const [rows] = await db.query(query, values); // Menyesuaikan driver MySQL (mysql2/promise)
    
    if(rows.length == 0) {
        return res.status(404).json({
            message:'Supplier tidak ditemukam!'
        })
    }
    return res.status(200).json({
      status: "success",
      data: rows,
    });
  } catch (err) {
    console.error("Error CariSuplier:", err);
    return res.status(500).json({
      status: "error",
      message: "Gagal mengambil data supplier",
    });
  }
}