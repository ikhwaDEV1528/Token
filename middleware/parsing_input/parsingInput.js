

const parsingInput = (req, res, next) => {
    const { username, email } = req.body;

    if (!email || !username) {
        // Gunakan 400 (Bad Request) untuk validasi, bukan 404
        return res.status(400).json({ message: 'Username / email tidak boleh kosong!' });
    }

    const regexUsername = /[A-Z0-9a-z]+$/;
    if (!regexUsername.test(username) || !regexUsername.test(email)) {
        return res.status(400).json({ message: 'Inputan tidak memenuhi syarat' });
    }

    // Jika sukses
    return next()
};

export default parsingInput;