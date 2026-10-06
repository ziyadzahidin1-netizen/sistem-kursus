const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');

// Import Firebase Admin
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

// Load fail JSON
const serviceAccount = require('./serviceAccountKey.json');

// Inisialisasi Firebase Admin
initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();
const usersCollection = db.collection('users');

// API REGISTER
app.post('/api/register', async (req, res) => {
    try {
        const { nama, ic, email, password } = req.body;

        if (!nama || !ic || !email || !password) {
            return res.status(400).json({ error: 'Sila lengkapkan semua maklumat!' });
        }

        // Semak jika email atau IC sudah wujud dalam Firestore
        const emailCheck = await usersCollection.where('email', '==', email).get();
        const icCheck = await usersCollection.where('ic', '==', ic).get();

        if (!emailCheck.empty || !icCheck.empty) {
            return res.status(400).json({ error: 'E-mel atau No. MyKad telah berdaftar!' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        // Simpan dokumen baru ke dalam Firestore
        await usersCollection.add({
            nama,
            ic,
            email,
            password: hashedPassword,
            createdAt: FieldValue.serverTimestamp() // Dibetulkan di sini
        });

        res.status(201).json({ message: 'Pendaftaran berjaya! Anda boleh log masuk sekarang.' });
    } catch (error) {
        console.error('Register Error:', error);
        res.status(500).json({ error: 'Ralat pendaftaran pada server.' });
    }
});

// API LOGIN
app.post('/api/login', async (req, res) => {
    try {
        const { emailOrIc, password } = req.body;

        if (!emailOrIc || !password) {
            return res.status(400).json({ error: 'Sila isi e-mel/MyKad dan kata laluan!' });
        }

        // Cari pengguna mengikut email atau IC
        let userSnap = await usersCollection.where('email', '==', emailOrIc).limit(1).get();
        
        if (userSnap.empty) {
            userSnap = await usersCollection.where('ic', '==', emailOrIc).limit(1).get();
        }

        if (userSnap.empty) {
            return res.status(400).json({ error: 'Pengguna tidak dijumpai.' });
        }

        const userDoc = userSnap.docs[0];
        const user = userDoc.data();

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ error: 'E-mel / No. MyKad atau kata laluan tidak sah!' });
        }

        res.json({
            message: 'Log masuk berjaya!',
            user: { nama: user.nama, email: user.email, ic: user.ic }
        });
    } catch (error) {
        console.error('Login Error:', error);
        res.status(500).json({ error: 'Ralat log masuk pada server.' });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

if (!process.env.VERCEL) {
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => console.log(`Server berjalan di http://localhost:${PORT}`));
}

module.exports = app;