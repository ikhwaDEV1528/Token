import { db } from "../config/firebase/fireStore.js";
import jwt from 'jsonwebtoken'



async function cheking_route (req, res , next) {

    const {route} = req.body;
    const field = route.split('/')[2]

    try {
       const token = req.cookies.accses_token;
       
       if(!token) {
         return res.status.json({
            message:'undefined token!',
            navigasi:'/'
         })
       }

       const decode = jwt.verify(token , 'RAHASIA_GW')
       
       const doc = `${decode.user_id}_${decode.username}`;

       const alamat = db.collection('sesion_user').doc(doc)
       const snap = await alamat.get()

       if(!snap.exists) {
        return res.status(404).json({
            message:'sesion tidak ditemukan!',
            status: 404,
            navigasi:'/'
        })
       }
    
       
       await alamat.update({
          [field]:true   
       })

       console.log('FIELDDDDDDDD BERHASILLLL DIUBAHHH' + field)
       
       const tolol = '/kontol'
       res.status(200).json({
        message:`Navigasi ke ${route}`,
        navigasi:route
       });


    } catch (err) {

    }
}

export default cheking_route;