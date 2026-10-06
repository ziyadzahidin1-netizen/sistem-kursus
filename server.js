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
let serviceAccount;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else {
    try {
        serviceAccount = require('./serviceAccountKey.json');
    } catch (err) {
        console.error('ERROR: Fail serviceAccountKey.json tidak dijumpai!');
    }
}

if (serviceAccount) {
    initializeApp({
        credential: cert(serviceAccount)
    });
}
// Inisialisasi Firebase Admin
if (serviceAccount) {
    initializeApp({
        credential: cert(serviceAccount)
    });
}

const db = getFirestore();
const usersCollection = db.collection('users');

// API REGISTER
app.post('/api/register', async (req, res) => {
    try {
        const { nama, ic, email, password } = req.body;

        if (!nama || !ic || !email || !password) {
            return res.status(400).json({ error: 'Sila lengkapkan semua maklumat!' });
        }

        const icString = String(ic).trim();
        const emailString = String(email).trim().toLowerCase();

        // Semak jika email atau IC sudah wujud dalam Firestore
        const emailCheck = await usersCollection.where('email', '==', emailString).get();
        const icCheck = await usersCollection.where('ic', '==', icString).get();

        if (!emailCheck.empty || !icCheck.empty) {
            return res.status(400).json({ error: 'E-mel atau No. MyKad telah berdaftar!' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        // Simpan dokumen baru ke dalam Firestore
        await usersCollection.add({
            nama: nama.trim(),
            ic: icString,
            email: emailString,
            password: hashedPassword,
            createdAt: FieldValue.serverTimestamp()
        });

        res.status(201).json({ message: 'Pendaftaran berjaya! Anda boleh log masuk sekarang.' });
    } catch (error) {
        console.error('Register Error Detail:', error);
        // Menghantar mesej ralat terperinci ke frontend supaya mudah faham puncanya
        res.status(500).json({ error: 'Ralat Server: ' + (error.message || 'Ralat tidak diketahui') });
    }
});

// API LOGIN
app.post('/api/login', async (req, res) => {
    try {
        const { emailOrIc, password } = req.body;

        if (!emailOrIc || !password) {
            return res.status(400).json({ error: 'Sila isi e-mel/MyKad dan kata laluan!' });
        }

        const inputSearch = String(emailOrIc).trim().toLowerCase();

        // Cari pengguna mengikut email dahulu
        let userSnap = await usersCollection.where('email', '==', inputSearch).limit(1).get();
        
        // Jika tidak dijumpai mengikut email, cari mengikut IC
        if (userSnap.empty) {
            userSnap = await usersCollection.where('ic', '==', String(emailOrIc).trim()).limit(1).get();
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
        console.error('Login Error Detail:', error);
        res.status(500).json({ error: 'Ralat Server: ' + (error.message || 'Ralat tidak diketahui') });
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