
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { db } from '../config/firebase/fireStore.js';

dotenv.config();

async function ChekingAdmin(req, res) {
   
  console.log('Masuk Logic Hak Akses!');

  const pathName = req.body.headerPath || req.headers.get('x-path') || req.headers['x-path'];
  
  if(!pathName) {
    console.log('Pathname Tidak Ada!')
    return res.status(404).json({
      message:'Path Tidak Anda!',
      status:404,
      navigasi:'/'
    })
  }

  const isRiderect = pathName.split("/")[1] == 'Admin' ? '/Admin/Dashboard' : '/User/Home';

  try {
    
    const accses_token = req.cookies?.accses_token;
    const refresh_token = req.cookies?.refresh_token;
     
    console.log('Sedang mengecek Token...');

    if(!accses_token && !refresh_token) {

      console.log('Token tidak ada , Silahkan Login kembali!');

      return res.status(401).json({
        message:'Token Tidak ada , Silahkan login!',
        status:401,
        navigasi:'/'
      })
    }

    console.log('Token ada!')
    const decode_accses_token = jwt.verify(accses_token , 'RAHASIA_GW' , {ignoreExpiration:true});
    const decode_refresh_token = jwt.verify(accses_token , 'RAHASIA_GW' , {ignoreExpiration:true});

    if(!decode_accses_token || !decode_refresh_token) {
      console.log('Salah Satu Token Palsu!');
      return res.status(401).json({
        message:'Accses / Refresh Palsu!',
        status:401,
        navigasi:'/'
      })
    }

    // Cek apakah  accses exp ?
    if(decode_accses_token.exp < Date.now() / 1000) {
       console.log('Accses exp')
      // Jika iya , maka cek refrsh exp
      if(decode_refresh_token.exp < Date.now() / 1000) {
        console.log('Refresh exp')
        // Jika refresh Exp maka navigasi login
        console.log('Silahkan login kembali');
        return res.status(401).json({
          message:'Silahkan login kembali!',
          status:401,
          navigasi:'/'
        })
      }

      // Jika refresh tidak exp , buatkan accses baru //
      console.log('Sedang membuat Token Accses baru...')

      const Payload_Baru = {
        username:decode_accses_token.username,
        email:decode_accses_token.email,
        role:decode_accses_token.role,
        user_id:decode_accses_token.user_id
      };

      const Token_Accses_Baru = jwt.sign(Payload_Baru , 'RAHASIA_GW' , {expiresIn:'10m'});

      res.cookie('accses_token' , Token_Accses_Baru , {
        httpOnly:true,
        secure:true,
        sameSite:'none',
        maxxAge: 10 * 60 * 1000
      });

      console.log('Token Accses Berhasil Dibuat!');


      if(pathName.split('/')[1] == 'Admin' && decode_accses_token.role == 'Admin' ) {
         console.log('Anda admin')
        // const ref = db.collection('sesion_user').doc(`${decode_accses_token.user_id}_${decode_accses_token.username}`);
        // const snap = await ref.get();

        // if(!snap.exists) {
        //   console.log('Sesi tidak ditemukan! , silahkan login kembali');
        //   return res.status(402).json({
        //     message:'Sesion Undefined!',
        //     status:402,
        //     navigasi:'/'
        //   })
        // }

        // if(!snap.data()[pathName.slice('/')[2]]) {
        //   console.log('Route halaman sebelum nya belum dilalui!')
        //   return res.status(402).json({
        //     message:'Lalui Route sebelum nya!',
        //     status:402,
        //     navigasi:isRiderect
        //   })
        // }

        return res.status(200).json({message:'ok'})

      }


      if(decode_accses_token.role == 'User' && pathName.split('/')[1] == 'User' ) {
         console.log('Anda user')
        // const ref = db.collection('sesion_user').doc(`${decode_accses_token.user_id}_${decode_accses_token.username}`);
        // const snap = await ref.get();

        // if(!snap.exists) {
        //   console.log('Sesi tidak ditemukan! , silahkan login kembali');
        //   return res.status(402).json({
        //     message:'Sesion Undefined!',
        //     status:402,
        //     navigasi:'/'
        //   })
        // }

        // if(!snap.data()[pathName.split('/')[2]]) {
        //   console.log('Route halaman sebelum nya belum dilalui!')
        //   return res.status(402).json({
        //     message:'Lalui Route sebelum nya!',
        //     status:402,
        //     navigasi:isRiderect
        //   })
        // }

        return res.status(200).json({message:'ok'})

      }
      
      console.log('ROLE/ PATH TIDAK TERPENUHI ERRO : 403')
      return res.status(403).json({
        message:'Credential not found / match',
        status:403,
        navigasi:'/'
      })

    }

    // Kalo Accses tidak EXP //
    console.log(`ACCSES TIDAK EXP RELE:${decode_accses_token.role} : PATH:${pathName.split('/')[1]}` )

    if(pathName.split('/')[1] == 'Admin' && decode_accses_token.role == 'Admin') {
       console.log('Anda admin!')
      // const ref = db.collection('sesion_user').doc(`${decode_accses_token.user_id}_${decode_accses_token.username}`);
      // const snap = await ref.get();

      // if(!snap.exists) {
      //   console.log('Sesi tidak ditemukan! , silahkan login kembali');
      //   return res.status(402).json({
      //     message:'Sesion Undefined!',
      //     status:402,
      //     navigasi:'/'
      //   })
      // }

      // if(!snap.data()[pathName.split('/')[2]]) {
      //   console.log('Route halaman sebelum nya belum dilalui!')
      //   return res.status(402).json({
      //     message:'Lalui Route sebelum nya!',
      //     status:402,
      //     navigasi:isRiderect
      //   })
      // }

      return res.status(200).json({message:'ok'})
   }



    // Cek Path & role user //

   if(decode_accses_token.role == 'User' && pathName.split('/')[1] == 'User' ) {
      console.log('Anda user')
      // const ref = db.collection('sesion_user').doc(`${decode_accses_token.user_id}_${decode_accses_token.username}`);
      // const snap = await ref.get();

      // if(!snap.exists) {
      // console.log('Sesi tidak ditemukan! , silahkan login kembali');
      // return res.status(402).json({
      //   message:'Sesion Undefined!',
      //   status:402,
      //   navigasi:'/'
      //   })
      // };

      // if(!snap.data()[pathName.split('/')[2]]) {
      //   console.log('Route halaman sebelum nya belum dilalui!')
      //   return res.status(402).json({
      //     message:'Lalui Route sebelum nya!',
      //     status:402,
      //     navigasi:isRiderect
      //   })
      // }

      return res.status(200).json({message:'ok'})

    }
      
      console.log('ROLE/ PATH TIDAK TERPENUHI ERRO : 403')
      return res.status(403).json({
        message:'Credential not found / match',
        status:403,
        navigasi:'/'
      })
      
  } catch (err) {
    console.log(err)
    return res.status(500).json({error:err.message})
  }


}

export default ChekingAdmin;

// force rebuild