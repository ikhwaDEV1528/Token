
import jwt from 'jsonwebtoken'
import { db } from '../config/firebase/fireStore.js'

async function ChekingAdmin  (req , res) {

   const path = req.headers['path'].split('/')[1];
   const field = req.headers['path'].split("/")[2]
    
    console.log('path ,' + req.headers['path'])
    console.log('Path first ,' + path)
   try {
      console.log('Program masuk Try!')
      const Acccses_token = req.cookies?.accses_token;
      console.log('Mencoba mendapatkan Token Accses...')

      if(!Acccses_token) {
         console.log('Token Accses tidak ada! , Silahkan Login kembali')
         return res.status(404).json({errro:'Token Accses undefined!'})
      }

      console.log('Token Accses ada!')
 
      const Decode_Accses_Token = jwt.verify(Acccses_token , 'RAHASIA_GW' , {ignoreExpiration:true});
      console.log('Token Accses berhasil di Decode!')

      if(!Decode_Accses_Token) {
         console.log('Hasil Decode Accses Palsu!!!')
         return res.status(409).json({error:'Token is Broken!'})
      }
       
      console.log('Hasil Decode Accses Asli')

      // JIKAN ACCSES EXP //
      if(Decode_Accses_Token.exp < Date.now() / 1000) {
         console.log('TOKEN ACCSES EXP!!')

         const Refresh_token = req.cookies.refresh_token;
         console.log('Mencoba mendapatkan Token Refresh...')

      if(!Refresh_token) {
         console.log('Token Refresh Token undefined...')
         return res.status(404).json({error:'Token refresh undefined!'})
      }
      
      console.log('Decode Token Refresh...')
      const Decode_Refresh_Token = jwt.verify(Refresh_token , 'RAHASIA_GW' , {ignoreExpiration:true});

      if(!Decode_Refresh_Token){
         console.log('Token Refresh Palsu!!!')
         return res.status(409).json({error:'Refresh Token is Broken!'})
      }

      console.log('Token Refresh Asli!')

      if(Decode_Refresh_Token.exp < Date.now() / 1000) {
        console.log('rfresh exp')
        return res.status(405).json({error:'Silahkan login kembali!'})
      };
      
      // KALO REFRESH TIDAK EXP , MAKA CEK PATH HALAMAN,ROLE.LALU BUAT TOKEN
      console.log('Token Refresh Tidak EXP , Mencoba mendapatkan Role anda...'); 
      let role = Decode_Accses_Token.role;
      console.log('Berhasil mendapatkan Role adna,' + `, ${role}`);
      console.log('Mencoba memeriksa Path Anda...')
       

      if(path == 'Admin') {

         console.log('Anda berada di Path Admin , Mecoba verivikasi Role anda...')

         if(role !== 'Admin') {
            console.log('Anda bukan admin , Silahkan login kembali!')
            return  res.status(403).json({error:'Anda bukan Admin!'})
         }

         console.log('Anda admin , mencoba membuat Payload dan TokeN Accses Baru...')

         const Payload_Baru = {
            username: Decode_Accses_Token.username,
            email: Decode_Accses_Token.email,
            role: Decode_Accses_Token.role,
            user_id:Decode_Accses_Token.user_id
         };

         const Token_Accses_Baru = jwt.sign(Payload_Baru , 'RAHASIA_GW', {expiresIn:'2m'});

         res.cookie('accses_token' , Token_Accses_Baru , {
            httpOnly:true,
            secure:false,
            maxAge: 10 * 60 * 1000
         });

         const alamat_sesion_user = db.collection('sesion_user').doc(`${Decode_Accses_Token.user_id}_${Decode_Accses_Token.username}`);
         const doc = await alamat_sesion_user.get();

         if(!doc.exists) {
            console.log('Token berhasil dibuat! , tapi sesion ga ada!');
            return res.status(302).json({message:'Ok lu Admin TAPI sesion ga ada!'});
         };


         // Kalo sesion ada , maka cek sesion user & cek apakah path halaman di izinkan //
         
         const curentPath = req.headers['path'].split('/')[2]
         const path_halaman = doc.data()[curentPath] // {path_field: ?}

         if(!path_halaman) {
            return res.status(302).json({
               navigasi:'/User/Home',
               status:302
            })
         }

         console.log('Token Berhasil dibuat! , Selamag Datang Admin!!');
         return res.status(200).json({message:'Ok lu Admin!'});

      };
      

      // JIKA HALAMAN USER, MAKA CEK ROLE USER //
      console.log('Anda berada di Path User , mencoba memeriksa Role anda...')

      if(role !== 'User') {
         console.log('Anda Bukan User , Silahkan Login kembali!')
         return res.status(403).json({error:'Anda bukan User!'})
      };

      console.log('Anda User,Mencoba membuat Payload dan Token Accses...');

      const Payload_Baru = {
            username: Decode_Accses_Token.username,
            email: Decode_Accses_Token.email,
            role: Decode_Accses_Token.role,
            user_id:Decode_Accses_Token.user_id
      };


      const Token_Accses_Baru = jwt.sign(Payload_Baru , 'RAHASIA_GW', {expiresIn:'2m'});
      
      res.cookie('accses_token' , Token_Accses_Baru , {
         httpOnly:true,
         secure:false,
         maxAge: 10 * 60 * 1000
        }
      );

      const alamat_sesion_user = db.collection('sesion_user').doc(`${Decode_Accses_Token.user_id}_${Decode_Accses_Token.username}`);
      const doc = await alamat_sesion_user.get();
      

      if(!doc.exists) {       
         console.log('Token berhasil dibuat! , tapi sesion ga ada!');
         return res.status(302).json({message:'Ok lu Admin TAPI sesion ga ada!'});
      };

      const curentPath = req.headers['path'].split('/')[2]
      const path_halaman = doc.data()[curentPath] // {path_field: ?}

      if(!path_halaman) {
         return res.status(302).json({
            navigasi:'/User/Home',
            status:302
         })
      }

      
      console.log('Token Accses berhasil dibuat & Sesion TRUE!')
      return res.status(200).json({message:'Ok'})
      
   };




   // JIKA TOKEN ACCSES TIDAK EXP, MAKA CEK ROLE USER TERLEBIH DAHULU//
   console.log('Token Accses Tidak EXP!, Mencoba memeriksa Path anda...');

   console.log('Mencoba mendapatkan Role anda...');

   let role = Decode_Accses_Token.role;

   console.log('Mendapatkan Role anda' + `, ${role}`);

  

   if(path === 'Admin') {

      console.log('Anda berada didalam Halaman Admin, Mencoba memeriksa Role anda...')

      if(role !== 'Admin') {
         console.log('Anda bukan Admin!')
         return  res.status(403).json({error:'Anda bukan Admin!'})
      }

      const alamat_sesion_user = db.collection('sesion_user').doc(`${Decode_Accses_Token.user_id}_${Decode_Accses_Token.username}`);
      const doc = await alamat_sesion_user.get();
      

      if(!doc.exists) {
         console.log('Token berhasil dibuat! , tapi sesion ga ada!');
         return res.status(302).json({message:'Ok lu Admin TAPI sesion ga ada!'});
      };

      console.log('Anda Admin')
      return res.status(200).json({message:'Ok lu Admin!'})
   };


   // JIKAN PATH USER //
   console.log('Anda memasuki Path User , Mencoba memeriksa Role anda...')

   if(role !== 'User') {
      console.log('Anda bukan User!')
      return res.status(403).json({error:'Anda bukan User!'})
   };

   console.log('Anda user!');

   const alamat_sesion_user = db.collection('sesion_user').doc(`${Decode_Accses_Token.user_id}_${Decode_Accses_Token.username}`);
   const doc = await alamat_sesion_user.get();

   
   console.log('Sedang memeriksa sesion(Dokument) anda... ' + doc.exists);
  
   // kalo sesion gada //

   if(!doc.exists) {
      console.log('Tidak ada sesion yang ditemukan! , sedang mencoba membuat sesiona anda...');
      console.log('Token berhasil dibuat! , tapi sesion ga ada!');
      return res.status(302).json({message:'Ok lu Admin TAPI sesion ga ada!'});
   };
    
   // kalo sesion ada //

   if(!doc.data()[field]) {
      console.log('ANDA USER TAPI FIELD FALSE')
      return res.status(302).json({
         error:`${field} false`,
         navigasi:'/Home'
      })
   }
      
   console.log('Anda User dan field TRUE!')
   return res.status(200).json({message:'Oke lu User'});

    } catch (err) {
      console.log(err)
      res.status(500).json({error:err})
  }
   
}

export default ChekingAdmin