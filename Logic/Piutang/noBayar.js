// Satu-satunya generator nomor bayar (dipakai BAYAR_PIUTANG & submitDCR)

export async function BuatNoBayar(conn, yyyymmdd) {
    const prefix = `BYR-${yyyymmdd}-`;

    // nomor tertinggi yang SUDAH ada di header hari itu
    const [[m]] = await conn.query(
        `SELECT COALESCE(MAX(CAST(SUBSTRING(no_bayar, -4) AS UNSIGNED)), 0) AS maks
           FROM pembayaran_piutang_header
          WHERE no_bayar LIKE ?`,
        [`${prefix}%`]
    );
    const maks = Number(m.maks);

    // sequence selalu disesuaikan ke nomor tertinggi, baru +1
    const [r] = await conn.query(
        `INSERT INTO pembayaran_sequence (tanggal, last_seq) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE last_seq = LAST_INSERT_ID(GREATEST(last_seq, ?) + 1)`,
        [yyyymmdd, maks + 1, maks]
    );

    let seq;
    if (r.affectedRows === 1) seq = maks + 1;
    else if (r.affectedRows === 2) seq = r.insertId;
    else throw new Error(`Gagal membuat nomor bayar: affectedRows tidak terduga (${r.affectedRows})`);

    return `${prefix}${String(seq).padStart(4, '0')}`;
}