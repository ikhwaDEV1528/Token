


function Logout (req , res)  {
        
   res.clearCookie('refresh_token', {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path:'/'
  });

  res.clearCookie('accses_token', {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path:'/'
  });

  res.status(200).json({
    message:'Berhasil Logout!',
    status:200,
    navigasi:'/'
  })
}


export default Logout;