const express = require('express');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');

// Muat turun .env untuk pembangunan tempatan (Local)
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const app = express();

// Middleware
app.use(cors());

// Tingkatkan had saiz request untuk menyokong gambar muat naik Base64
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Sajikan fail statik HTML/CSS/JS dari folder semasa
app.use(express.static(path.join(__dirname)));

// Helper untuk dapatkan Supabase Client dengan selamat tanpa crash
function getSupabase() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_KEY;

    if (!supabaseUrl || !supabaseKey) {
        console.error("Supabase Error: SUPABASE_URL atau Key tidak ditemui dalam Environment Variables!");
        return null;
    }

    try {
        return createClient(supabaseUrl, supabaseKey, {
            auth: {
                persistSession: false,
                autoRefreshToken: false,
                detectSessionInUrl: false
            }
        });
    } catch (err) {
        console.error("Supabase Init Error:", err.message);
        return null;
    }
}

// 1. ROUTE UJIAN HEALTH CHECK
app.get('/api/health', (req, res) => {
    return res.status(200).json({ status: 'ok', message: 'API Backend Beroperasi!' });
});

// 2. API REGISTER (Admin guna Secret Key, User biasa guna Password)
app.post('/api/register', async function(req, res) {
    try {
        const supabase = getSupabase();
        if (!supabase) {
            return res.status(500).json({ error: 'Tetapan Supabase (URL/Key) belum lengkap.' });
        }

        const { nama, ic, email, password, role, adminKey } = req.body || {};
        
        if (!nama || !ic || !email) {
            return res.status(400).json({ error: 'Sila lengkapkan nama, No. MyKad, dan e-mel!' });
        }

        const userRole = role === 'admin' ? 'admin' : 'user';

        if (userRole === 'admin') {
            const VALID_ADMIN_KEY = process.env.ADMIN_SECRET_KEY || 'Admin1234';
            if (!adminKey || adminKey.trim() !== VALID_ADMIN_KEY) {
                return res.status(403).json({ error: 'Kunci Rahsia Admin tidak sah! Sila semak semula.' });
            }
        } else {
            if (!password) {
                return res.status(400).json({ error: 'Sila masukkan kata laluan!' });
            }
        }

        const icString = String(ic).trim();
        const emailString = String(email).trim().toLowerCase();

        const { data: existingUser, error: selectError } = await supabase
            .from('users')
            .select('id, email, ic')
            .or(`email.eq.${emailString},ic.eq.${icString}`)
            .maybeSingle();

        if (selectError) {
            return res.status(500).json({ error: 'Ralat Supabase: ' + selectError.message });
        }

        if (existingUser) {
            return res.status(400).json({ error: 'E-mel atau No. MyKad telah berdaftar!' });
        }

        const hashedPassword = (userRole === 'admin') 
            ? 'ADMIN_NO_PASS' 
            : await bcrypt.hash(password, 10);

        const { error: insertError } = await supabase
            .from('users')
            .insert([{ 
                nama: nama.trim(), 
                ic: icString, 
                email: emailString, 
                password: hashedPassword,
                role: userRole
            }]);

        if (insertError) {
            return res.status(500).json({ error: 'Gagal mendaftar: ' + insertError.message });
        }

        return res.status(201).json({ message: 'Pendaftaran berjaya! Anda boleh log masuk sekarang.' });
    } catch (error) {
        return res.status(500).json({ error: 'Ralat Server Backend: ' + (error.message || 'Ralat tidak diketahui') });
    }
});

// 3. API LOGIN
app.post('/api/login', async function(req, res) {
    try {
        const supabase = getSupabase();
        if (!supabase) {
            return res.status(500).json({ error: 'Tetapan Supabase (URL/Key) tidak dijumpai.' });
        }

        const { role, emailOrIc, password, secretKey } = req.body || {};
        if (!emailOrIc) {
            return res.status(400).json({ error: 'Sila masukkan E-mel atau No. MyKad!' });
        }

        const userRole = role === 'admin' ? 'admin' : 'user';
        const inputSearch = String(emailOrIc).trim().toLowerCase();

        const { data: user, error: userError } = await supabase
            .from('users')
            .select('*')
            .or(`email.eq.${inputSearch},ic.eq.${inputSearch}`)
            .maybeSingle();

        if (userError) {
            return res.status(500).json({ error: 'Ralat Pangkalan Data Supabase: ' + userError.message });
        }

        if (!user) {
            return res.status(400).json({ error: 'Pengguna tidak dijumpai.' });
        }

        if (userRole === 'admin') {
            if (user.role !== 'admin') {
                return res.status(403).json({ error: 'Akaun ini bukan akaun Admin!' });
            }

            const VALID_ADMIN_KEY = process.env.ADMIN_SECRET_KEY || 'Admin1234';
            if (!secretKey || secretKey.trim() !== VALID_ADMIN_KEY) {
                return res.status(400).json({ error: 'Kunci Rahsia Admin (Secret Key) tidak sah!' });
            }
        } else {
            if (!password) {
                return res.status(400).json({ error: 'Sila masukkan kata laluan!' });
            }

            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) {
                return res.status(400).json({ error: 'E-mel / No. MyKad atau kata laluan tidak sah!' });
            }
        }

        return res.status(200).json({
            message: 'Log masuk berjaya!',
            user: { 
                nama: user.nama, 
                email: user.email, 
                ic: user.ic, 
                role: user.role || 'user' 
            }
        });
    } catch (error) {
        return res.status(500).json({ error: 'Ralat Server Backend: ' + (error.message || 'Ralat tidak diketahui') });
    }
});

// 4. API PENGURUSAN KURSUS (CRUD DENGAN GAMBAR)
app.get('/api/kursus', async (req, res) => {
    try {
        const supabase = getSupabase();
        if (!supabase) return res.status(500).json({ error: 'Tetapan Supabase tidak dijumpai.' });

        const { data, error } = await supabase.from('courses').select('*').order('created_at', { ascending: false });
        if (error) return res.status(500).json({ error: error.message });

        return res.status(200).json(data || []);
    } catch (error) {
        return res.status(500).json({ error: 'Ralat Server: ' + error.message });
    }
});

app.post('/api/kursus', async (req, res) => {
    try {
        const supabase = getSupabase();
        if (!supabase) return res.status(500).json({ error: 'Tetapan Supabase tidak dijumpai.' });

        const { tajuk, tarikh, tempat, penerangan, gambar_url } = req.body || {};
        if (!tajuk || !tarikh || !tempat || !penerangan) {
            return res.status(400).json({ error: 'Sila lengkapkan semua medan wajib!' });
        }

        const { data, error } = await supabase
            .from('courses')
            .insert([{ tajuk, tarikh, tempat, penerangan, gambar_url }]);

        if (error) return res.status(500).json({ error: error.message });
        return res.status(201).json({ message: 'Kursus berjaya ditambah!', data });
    } catch (error) {
        return res.status(500).json({ error: 'Ralat Server: ' + error.message });
    }
});

app.put('/api/kursus/:id', async (req, res) => {
    try {
        const supabase = getSupabase();
        if (!supabase) return res.status(500).json({ error: 'Tetapan Supabase tidak dijumpai.' });

        const { id } = req.params;
        const { tajuk, tarikh, tempat, penerangan, gambar_url } = req.body || {};

        const { error } = await supabase
            .from('courses')
            .update({ tajuk, tarikh, tempat, penerangan, gambar_url })
            .eq('id', id);

        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ message: 'Kursus berjaya dikemas kini!' });
    } catch (error) {
        return res.status(500).json({ error: 'Ralat Server: ' + error.message });
    }
});

app.delete('/api/kursus/:id', async (req, res) => {
    try {
        const supabase = getSupabase();
        if (!supabase) return res.status(500).json({ error: 'Tetapan Supabase tidak dijumpai.' });

        const { id } = req.params;
        const { error } = await supabase.from('courses').delete().eq('id', id);

        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ message: 'Kursus berjaya dipadam!' });
    } catch (error) {
        return res.status(500).json({ error: 'Ralat Server: ' + error.message });
    }
});

// 5. API MOHON KURSUS
app.post('/api/mohon', async function(req, res) {
    try {
        const { nama, ic, email, jawatan, gred, jabatan, penyakit, pengangkutan, kursus } = req.body || {};

        if (!email) {
            return res.status(400).json({ error: 'Alamat e-mel tidak dijumpai!' });
        }

        const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyV9pe3TYHqXAYqQwkNRG10n96p_oz1RoYNd27X1t_T3r5nZEvoWRtACmMbwcoc98qNEw/exec';
        
        try {
            const gsResponse = await fetch(GOOGLE_SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(req.body),
                redirect: 'follow'
            });
            const gsResult = await gsResponse.text();
            console.log('Maklum balas Google Sheet:', gsResult);
        } catch (gsError) {
            console.error('Google Sheets Error:', gsError.message);
        }

        const htmlContent = `
            <div style="font-family: Arial, sans-serif; padding: 20px;">
                <h2>Portal Kursus MOSTI</h2>
                <p>Salam Sejahtera <strong>${nama || 'Pemohon'}</strong>,</p>
                <p>Permohonan anda untuk kursus <strong>${kursus || '-'}</strong> telah diterima dan sedang diproses. Sekiranya tuan/puan terpilih, surat tawaran akan dikeluarkan dan dihantar melalui e-mel yang didaftarkan. Terima kasih kerana telah memohon kursus ini.</p>
            </div>
        `;

        const brevoPayload = {
            sender: { name: "Portal MOSTI", email: process.env.SENDER_EMAIL },
            to: [{ email: email, name: nama || 'Pemohon' }],
            subject: `Permohonan Anda Diterima: ${kursus}`,
            htmlContent: htmlContent
        };

        const brevoResponse = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
                'accept': 'application/json',
                'api-key': process.env.BREVO_API_KEY,
                'content-type': 'application/json'
            },
            body: JSON.stringify(brevoPayload)
        });

        if (!brevoResponse.ok) {
            const brevoData = await brevoResponse.json();
            throw new Error(brevoData.message || 'Gagal menghantar e-mel');
        }

        return res.status(200).json({ status: 'success', message: 'Permohonan diterima dan e-mel pengesahan telah dihantar!' });
    } catch (error) {
        return res.status(500).json({ error: 'Gagal menghantar e-mel: ' + error.message });
    }
});

// Fallback untuk semua route /api/* yang tidak wujud
app.use('/api/*', (req, res) => {
    return res.status(404).json({ error: 'Route API tidak wujud.' });
});

// Jalankan server secara tempatan jika bukan di persekitaran Vercel
if (!process.env.VERCEL) {
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, function() {
        console.log('Server berjalan di http://localhost:' + PORT);
    });
}

module.exports = app;