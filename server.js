const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');

const app = express();

app.use(express.json());

// 1. Melayan fail statik (CSS, JS, Gambar) dari folder utama
app.use(express.static(__dirname));

// Simpan data dalam memori (In-Memory Array) untuk persekitaran Vercel Serverless
const users = [];

// 2. API REGISTER
app.post('/api/register', async (req, res) => {
    try {
        const { nama, ic, email, password } = req.body;

        const existingUser = users.find(u => u.email === email || u.ic === ic);
        if (existingUser) {
            return res.status(400).json({ error: 'E-mel atau No. MyKad telah berdaftar!' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        users.push({ nama, ic, email, password: hashedPassword });

        res.status(201).json({ message: 'Pendaftaran berjaya! Anda boleh log masuk sekarang.' });
    } catch (error) {
        res.status(500).json({ error: 'Ralat pendaftaran pada server.' });
    }
});

// 3. API LOGIN
app.post('/api/login', async (req, res) => {
    try {
        const { emailOrIc, password } = req.body;

        const user = users.find(u => u.email === emailOrIc || u.ic === emailOrIc);
        if (!user) {
            return res.status(400).json({ error: 'Pengguna tidak dijumpai.' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ error: 'E-mel / No. MyKad atau kata laluan tidak sah!' });
        }

        res.json({ message: 'Log masuk berjaya!', user: { nama: user.nama, email: user.email, ic: user.ic } });
    } catch (error) {
        res.status(500).json({ error: 'Ralat log masuk pada server.' });
    }
});

// 4. Hantar index.html untuk laluan utama (Root)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 5. Jalankan app.listen hanya untuk persekitaran tempatan (Localhost)
if (!process.env.VERCEL) {
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => console.log(`Server berjalan di http://localhost:${PORT}`));
}

module.exports = app;