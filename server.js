const express = require('express');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = 5000;
const DB_FILE = path.join(__dirname, 'users.json');

app.use(express.json());
app.use(express.static('.'));

// Fungsi baca data dari fail users.json
function getUsers() {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify([]));
    }
    const data = fs.readFileSync(DB_FILE);
    return JSON.parse(data);
}

// Fungsi simpan data ke fail users.json
function saveUsers(users) {
    fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2));
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

app.listen(PORT, () => console.log(`Server berjalan di http://localhost:${PORT}`));