import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';


dotenv.config();

const Database = [
  { username: 'ikhwan', email: 'ikhwan@gmail.com', role: 'User', user_id: 123 },
  { username: 'wulan', email: 'wulan@gmail.com', role: 'Admin', user_id: 124 }
];

async function Login(req, res) {
  const { username, email } = req.body;

  console.log('Masuk login')

  try {
   
    const RAHASIA_GW = 'RAHASIA_GW';

    
    console.log('Mencoba mencari user...')
    const Search = Database.find(item => item.username === username);

    if (!Search) {
      console.log('Tidak ada user yang ditemukan')
      return res.status(404).json({ message: 'User not found!' , status:404});
    }


    console.log('User ditemukan! , mengecek role anda...')

    let redirect;
    if (Search.role === 'Admin') {
      redirect = '/Admin/Dashboard';
    } else if (Search.role === 'User') {
      redirect = '/User/Home';
    } else {
      redirect = 'no/Driver/Home';
    }
    
    console.log(`ROLE:${Search.role}`)
    console.log('Sedang membuat token...')

    const payload = {
      username: Search.username,
      email: Search.email,
      user_id: Search.user_id,
      role: Search.role
    };

   
    const TokenAccses = jwt.sign(payload, RAHASIA_GW, { expiresIn: '10m' });
    const TokenReload = jwt.sign(payload, RAHASIA_GW, { expiresIn: '20m' });



    
    const cookieOptions = {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 10 * 60 * 1000,
      path:'/'
    };

    res.cookie('accses_token', TokenAccses, cookieOptions);
    res.cookie('refresh_token', TokenReload, cookieOptions);

    console.log(`Kamu berhasil login ke ${redirect}`)
    return res.status(200).json({
      message: `${payload.username}, Kamu dapat Token untuk Login! hauaha`,
      navigasi: redirect
    });

  } catch (err) {
    console.error('Error pada Logic Controller:', err);
    return res.status(500).json({ message: err.message || 'Internal Server Error' });
  }
}

export default Login;

