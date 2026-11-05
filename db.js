import mysql from "mysql2/promise";
import dotenv from 'dotenv';

dotenv.config()


const dbPassword = process.env.PASSWORD_DB !== undefined ? process.env.PASSWORD_DB : "";

export const db = mysql.createPool({
  host: process.env.HOST, 
  user: 'root', 
  port: process.env.PORT,     // Username MySQL (XAMPP/Laragon default: root)
  password: '',      // Password MySQL (default: kosong)
  database: process.env.NAMA_DB, // Sesuaikan nama database kamu
  waitForConnections: true,
  connectionLimit: 5,
  multipleStatements:true,
  dateStrings:true
});







