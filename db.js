import mysql from "mysql2/promise";

const db = mysql.createPool({
  host: 'eglet-9-154-220-124.run.pinggy-free.link',
  user: 'root', 
  port:33523,     // Username MySQL (XAMPP/Laragon default: root)
  password: '',      // Password MySQL (default: kosong)
  database: 'cv_bakhti_putra_pratama', // Sesuaikan nama database kamu
  waitForConnections: true,
  connectionLimit: 10,
  multipleStatements:true
});



export default db; 