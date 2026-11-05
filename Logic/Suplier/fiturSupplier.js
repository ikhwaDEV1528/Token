// supplier.controller.js  (ESM)
// Syarat: app sudah pakai express.json() dan punya pool mysql2/promise.
import { db } from "../../db.js"; // <- sesuaikan path ke pool mysql2/promise lo (opsi dateStrings: true disarankan)

const COLUMNS = `
  id_supplier   AS id,
  kode_supplier AS kode,
  nama_supplier AS nama,
  no_telepon    AS telepon,
  alamat,
  created_at    AS createdAt`;

const PHONE_RE = /^[0-9+\-\s()]{8,20}$/;
const formatKode = (id) => `SUP-${String(id).padStart(5, '0')}`;

function validate(body) {
  const b = body ?? {};
  const data = {
    nama_supplier: typeof b.nama_supplier === 'string' ? b.nama_supplier.trim() : '',
    no_telepon: typeof b.no_telepon === 'string' ? b.no_telepon.trim() : '',
    alamat: typeof b.alamat === 'string' ? b.alamat.trim() : '',
  };
  const errors = {};
  if (!data.nama_supplier) errors.nama_supplier = ['Nama supplier wajib diisi.'];
  else if (data.nama_supplier.length > 100) errors.nama_supplier = ['Nama supplier maksimal 100 karakter.'];

  if (!data.no_telepon) errors.no_telepon = ['Nomor telepon wajib diisi.'];
  else if (!PHONE_RE.test(data.no_telepon))
    errors.no_telepon = ['Nomor telepon harus 8-20 karakter berisi angka, +, -, spasi, atau tanda kurung.'];

  if (!data.alamat) errors.alamat = ['Alamat wajib diisi.'];
  else if (data.alamat.length > 500) errors.alamat = ['Alamat maksimal 500 karakter.'];

  return { data, errors: Object.keys(errors).length ? errors : null };
}

function handleError(res, err) {
  if (err?.code === 'ER_DUP_ENTRY' && String(err.sqlMessage).includes('uq_supplier_nama')) {
    return res.status(422).json({
      message: 'Data tidak valid.',
      errors: { nama_supplier: ['Nama supplier sudah terdaftar.'] },
    });
  }
  console.error('[supplier]', err);
  return res.status(500).json({ message: 'Terjadi kesalahan pada server.' });
}

// GET /api/suppliers?q=&cursor=&limit=
// Keyset pagination (stabil & cepat, tanpa OFFSET / COUNT)
export async function listSuppliers(req, res) {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
    const cursor = parseInt(req.query.cursor, 10);
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';

    const where = [];
    const params = [];
    if (cursor > 0) {
      where.push('id_supplier < ?');
      params.push(cursor);
    }
    if (q) {
      const esc = q.replace(/[\\%_]/g, '\\$&');
      where.push('(nama_supplier LIKE ? OR kode_supplier LIKE ? OR no_telepon LIKE ?)');
      params.push(`%${esc}%`, `${esc}%`, `${esc}%`);
    }

    const sql = `SELECT ${COLUMNS} FROM supplier
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY id_supplier DESC LIMIT ?`;
    params.push(limit + 1);

    const [rows] = await db.query(sql, params);
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;

    return res.json({ data, hasMore, nextCursor: hasMore ? data[data.length - 1].id : null });
  } catch (err) {
    return handleError(res, err);
  }
}

// POST /api/suppliers
export async function createSupplier(req, res) {
  const { data, errors } = validate(req.body);
  if (errors) return res.status(422).json({ message: 'Data tidak valid.', errors });

  let conn;
  try {
    conn = await db.getConnection();
    await conn.beginTransaction();

    const [ins] = await conn.query(
      'INSERT INTO supplier (nama_supplier, no_telepon, alamat, created_at) VALUES (?, ?, ?, NOW())',
      [data.nama_supplier, data.no_telepon, data.alamat],
    );
    const id = ins.insertId;
    // Kode diturunkan dari PK auto increment => dijamin unik
    await conn.query('UPDATE supplier SET kode_supplier = ? WHERE id_supplier = ?', [formatKode(id), id]);
    const [rows] = await conn.query(`SELECT ${COLUMNS} FROM supplier WHERE id_supplier = ?`, [id]);

    await conn.commit();
    return res.status(201).json({ message: 'Supplier berhasil ditambahkan.', data: rows[0] });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    return handleError(res, err);
  } finally {
    if (conn) conn.release();
  }
}

// PUT /api/suppliers/:id
export async function updateSupplier(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!(id > 0)) return res.status(404).json({ message: 'Supplier tidak ditemukan.' });

  const { data, errors } = validate(req.body);
  if (errors) return res.status(422).json({ message: 'Data tidak valid.', errors });

  try {
    await db.query(
      'UPDATE supplier SET nama_supplier = ?, no_telepon = ?, alamat = ?, updated_at = NOW() WHERE id_supplier = ?',
      [data.nama_supplier, data.no_telepon, data.alamat, id],
    );
    const [rows] = await db.query(`SELECT ${COLUMNS} FROM supplier WHERE id_supplier = ? LIMIT 1`, [id]);
    if (!rows[0]) return res.status(404).json({ message: 'Supplier tidak ditemukan.' });

    return res.json({ message: 'Perubahan supplier disimpan.', data: rows[0] });
  } catch (err) {
    return handleError(res, err);
  }
}

/* Pasang di router:
   router.get('/api/suppliers', listSuppliers);
   router.post('/api/suppliers', createSupplier);
   router.put('/api/suppliers/:id', updateSupplier);
*/
