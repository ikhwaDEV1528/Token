import jwt from 'jsonwebtoken';
import { db } from '../config/firebase/fireStore.js';

const Database = [
    {username:'ikhwan' , email:'ikhwan@gmail.com' , role:'User' , user_id:123},
    {username:'wulan' , email:'wulan@gmail.com' , role:'Admin' ,  user_id:124}
]


async function Logic (req , res ) {
    const {username , email} = req.body;

    try {

    const Search = Database.find(item => item.username == username);
    let redirect;

    if(!Search) return res.status(404).json({message:'User not found!'});

    if(Search.role == 'Admin'){
      redirect = '/Admin/Dashboard'
    }

    else if(Search.role == 'User'){
        redirect = '/User/Home'
    }

    else {
       redirect = 'Driver'
    }

    const payload = {
        username,
        email,
        user_id:Search.user_id,
        role: Search.role
    };

    const TokenAccses = jwt.sign (payload , 'RAHASIA_GW' , {expiresIn:'1m'});
    const TokenReload = jwt.sign (payload , 'RAHASIA_GW' , {expiresIn:'5m'});


    res.cookie('accses_token' , TokenAccses , {
        httpOnly:true,
        secure:false,
        maxAge: 10 * 60 * 1000
    });


    res.cookie('refresh_token' , TokenReload , {
        httpOnly:true,
        secure:false,
        maxAge: 10 * 60 * 1000
    });


    const sesion_user = `${payload.user_id}_${payload.username}`;
    const Alamat = db.collection('sesion_user').doc(sesion_user);

    const pathHalaman = redirect.split('/')[2];

    const addToSesion = await Alamat.set({
        sesion_id:sesion_user,
        username:username,
        user_id:payload.user_id,
        Home: pathHalaman == 'Home' ? true : false,
        Dahsboard: pathHalaman == 'Dashboard' ? true : false,
        Checkout:false,
        Stok:false
    });

    

    console.log('Berhasil membuat sesion user')


    
    console.log('Token berhasil dibuat')
    res.status(200).json({
       message:`${username} , Kamu dapat Token untuk Login!`,
       navigasi:redirect
    });

 } catch (err){
    res.status(500).json({error:err})
 }
};


export default Logic;