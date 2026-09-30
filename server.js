const express = require('express');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const app = express();

// Di Vercel, kita wajib gunakan folder /tmp untuk simpanan fail sementara
const isVercel = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME;
const DB_FILE = isVercel 
    ? path.join('/tmp', 'users.json') 
    : path.join(__dirname, 'users.json');

app.use(express.json());

// Melayan fail statik (HTML, CSS, JS) dari direktori utama
app.use(express.static(__dirname));

// Fungsi baca data dari fail users.json
function getUsers() {
    try {
        if (!fs.existsSync(DB_FILE)) {
            fs.writeFileSync(DB_FILE, JSON.stringify([]));
        }
        const data = fs.readFileSync(DB_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        return [];
    }
}

// Fungsi simpan data ke fail users.json
function saveUsers(users) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2));
    } catch (err) {
        console.error('Ralat menulis fail:', err);
    }
}

// API Register
app.post('/api/register', async (req, res) => {
    try {
        const { nama, ic, email, password } = req.body;
        const users = getUsers();

        // Semak jika pengguna wujud
        const existingUser = users.find(u => u.email === email || u.ic === ic);
        if (existingUser) {
            return res.status(400).json({ error: 'E-mel atau No. MyKad telah berdaftar!' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        users.push({ nama, ic, email, password: hashedPassword });
        saveUsers(users);

        res.status(201).json({ message: 'Pendaftaran berjaya! Anda boleh log masuk sekarang.' });
    } catch (error) {
        res.status(500).json({ error: 'Ralat pendaftaran pada server.' });
    }
});

// API Login
app.post('/api/login', async (req, res) => {
    try {
        const { emailOrIc, password } = req.body;
        const users = getUsers();

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

// Serve fail HTML jika diakses terus melalui path root (Contoh: localhost:5000)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Jalankan app.listen jika run di localhost, atau eksport app jika di Vercel
if (!isVercel) {
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => console.log(`Server berjalan di http://localhost:${PORT}`));
}

module.exports = app;