import jwt from 'jsonwebtoken';

const accsesToken = (req , res , next) => {

   

    try {
       const tokenAccses = req.cookies.accses_token;

       if(!tokenAccses) {
          return res.status(404).json({error:'Undefined Token Accses'})
       }

       const decode = jwt.verify(tokenAccses , 'RAHASIA_GW', { ignoreExpiration: true });

       if(!decode) {
          return res.status(401).json({error:'Token Bermasalah'})
       }

       if(decode.exp < Date.now() / 1000) {
          console.log('Accses Exp')
          const tokenRefresh = req.cookies.refresh_token;
          
          if(!tokenRefresh) {
           console.log('Token refresh Tidak ada')
           return res.status(404).json({error:'Undefined Token Refresh'});
          }

          const decodeRefresh = jwt.verify(tokenRefresh, 'RAHASIA_GW' , {ignoreExpiration:true});

          if(!decodeRefresh) {
           console.log('Token refresh Rusak')
           return res.status(401).json({error:'Token rusak'})
          }

          if(decodeRefresh.exp < Date.now() / 1000){
           console.log('Token refresh EXP')
           return res.status(401).json({error:'Token refresh exp , Silahkan login kembali'})
          };

          const payload = {
             username:decode.username,
             email:decode.email,
             role:decode.role,
          }

          const AccsesTokenBaru = jwt.sign(payload,'RAHASIA_GW', {expiresIn:'2m'});
          
          res.cookie('accses_token' , AccsesTokenBaru , {
            httpOnly:true,
            secure:false,
            maxAge: 10 * 60 * 1000
          });

          req.user = payload; // <= Dipake di Next Controllers

          console.log('Accses Token diperbarui!');
          return next();
        };

        const payload = {
             username:decode.username,
             email:decode.email,
             role:decode.role,
         }

        req.user = payload
       
        console.log('Next ke Logic!')
        return next()

    } catch (err) {
        return res.status(407).json({error:err.message + ' internal'})
    }
}


export default accsesToken