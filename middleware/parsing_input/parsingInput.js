

// const parsingInput = (req, res, next) => {
//     const { username, password } = req.body;

//     if (!password || !username) {
//         // Gunakan 400 (Bad Request) untuk validasi, bukan 404
//         return res.status(400).json({ message: 'Username / email tidak boleh kosong!' });
//     }

//     const regexUsername = /[A-Z0-9a-z]+$/;
//     if (!regexUsername.test(username) || !regexUsername.test(password)) {
//         return res.status(400).json({ message: 'Inputan tidak memenuhi syarat' });
//     }

//     // Jika sukses
//     return next()
// };


const parsingInput = (req, res, next) => {
    const { username, password } = req.body;

    // Pastikan tipe data string (cegah NoSQL injection via object/array)
    if (typeof username !== 'string' || typeof password !== 'string') {
        return res.status(400).json({ message: 'Format input tidak valid' });
    }

    const trimmedUsername = username.trim();
    const trimmedPassword = password.trim();

    if (!trimmedUsername || !trimmedPassword) {
        return res.status(400).json({ message: 'Username / password tidak boleh kosong!' });
    }

    // Batasi panjang input (cegah abuse & ReDoS)
    if (trimmedUsername.length > 50 || trimmedPassword.length > 128) {
        return res.status(400).json({ message: 'Panjang input melebihi batas' });
    }

    // Username: alfanumerik + underscore, 3-50 karakter, wajib diawal & akhir string
    const regexUsername = /^[A-Za-z0-9_]{3,50}$/;
    if (!regexUsername.test(trimmedUsername)) {
        return res.status(400).json({ message: 'Username tidak memenuhi syarat' });
    }

    // Password: minimal 8 karakter, boleh simbol (jangan batasi terlalu ketat)
    if (trimmedPassword.length < 8) {
        return res.status(400).json({ message: 'Password minimal 8 karakter' });
    }

    req.body.username = trimmedUsername;
    req.body.password = trimmedPassword;

    return next();
};

export default parsingInput;