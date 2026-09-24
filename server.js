const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const app = express();
app.use(express.json());
app.use(express.static('.'));

// Format Direct Connection (Bypass isu DNS SRV ENOTFOUND)
// Gantikan dengan pautan yang anda copy dari MongoDB Atlas tadi
const dbURI = 'mongodb://127.0.0.1:27017/SistemKursus';

// Tambah tetapan ini di mongoose.connect untuk paksa sambungan terus melepasi isu network
mongoose.connect(dbURI, {
  family: 4 
})
  .then(() => console.log('>>> BERJAYA SAMBUNG KE MONGODB ATLAS! <<<'))
  .catch(err => console.error('Gagal sambung database:', err));

// Skema Pengguna
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true }
});
const User = mongoose.model('User', userSchema);

// API Register
app.post('/api/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ error: 'E-mel telah wujud.' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ email, password: hashedPassword });
    await newUser.save();

    res.status(201).json({ message: 'Pendaftaran berjaya!' });
  } catch (error) {
    res.status(500).json({ error: 'Ralat pendaftaran.' });
  }
});

// API Login
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: 'Pengguna tidak dijumpai.' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: 'Kata laluan salah.' });

    res.json({ message: 'Log masuk berjaya!', user: { email: user.email } });
  } catch (error) {
    res.status(500).json({ error: 'Ralat log masuk.' });
  }
});

const PORT = 5000;
app.listen(PORT, () => console.log(`Server berjalan di http://localhost:${PORT}`));