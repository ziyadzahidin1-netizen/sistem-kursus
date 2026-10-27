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

// Helper function yang diperbaiki untuk menapis lajur yang tidak wujud dengan selamat
async function filterExistingColumns(supabase, tableName, payload) {
    try {
        const { data, error } = await supabase.from(tableName).select('*').limit(1);
        
        if (error || !data || data.length === 0) {
            return payload;
        }

        const existingKeys = Object.keys(data[0]);
        const filteredPayload = {};
        for (const key of Object.keys(payload)) {
            if (existingKeys.includes(key)) {
                filteredPayload[key] = payload[key];
            }
        }
        return filteredPayload;
    } catch (e) {
        console.warn("Ralat penapisan lajur:", e.message);
        return payload;
    }
}

// =========================================================================
// REALTIME SSE (SERVER-SENT EVENTS) BROADCASTER
// =========================================================================
let sseClients = [];

app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Simpan sambungan klien
    sseClients.push(res);

    // Buang klien dari senarai apabila peranti/pelayar ditutup
    req.on('close', () => {
        sseClients = sseClients.filter(client => client !== res);
    });
});

function broadcastEvent(data) {
    sseClients.forEach(client => {
        try {
            client.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch (err) {
            console.error("Gagal hantar SSE:", err);
        }
    });
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

// 4. API PENGURUSAN KURSUS (CRUD DENGAN GAMBAR + REALTIME BROADCAST)
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

        const { tajuk, tarikh, tempat, penerangan, gambar_url, bidang, masa, objektif, penyelaras_nama, penyelaras_emel, penyelaras_telefon } = req.body || {};
        if (!tajuk || !tarikh || !tempat || !penerangan) {
            return res.status(400).json({ error: 'Sila lengkapkan semua medan wajib!' });
        }

        const rawData = { tajuk, tarikh, tempat, penerangan, gambar_url, bidang, masa, objektif, penyelaras_nama, penyelaras_emel, penyelaras_telefon };
        const safePayload = await filterExistingColumns(supabase, 'courses', rawData);

        const { data, error } = await supabase
            .from('courses')
            .insert([safePayload]);

        if (error) return res.status(500).json({ error: error.message });

        // Pancarkan notifikasi kemaskini kepada SEMUA pelayar yang dibuka
        broadcastEvent({ type: 'COURSE_UPDATED' });

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
        const { tajuk, tarikh, tempat, penerangan, gambar_url, bidang, masa, objektif, penyelaras_nama, penyelaras_emel, penyelaras_telefon } = req.body || {};

        const rawData = { tajuk, tarikh, tempat, penerangan, gambar_url, bidang, masa, objektif, penyelaras_nama, penyelaras_emel, penyelaras_telefon };
        const updateData = await filterExistingColumns(supabase, 'courses', rawData);

        const { error } = await supabase
            .from('courses')
            .update(updateData)
            .eq('id', id);

        if (error) return res.status(500).json({ error: error.message });

        // Pancarkan acara ke pelayar lain
        broadcastEvent({ type: 'COURSE_UPDATED' });

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

        // Pancarkan acara ke pelayar lain
        broadcastEvent({ type: 'COURSE_UPDATED' });

        return res.status(200).json({ message: 'Kursus berjaya dipadam!' });
    } catch (error) {
        return res.status(500).json({ error: 'Ralat Server: ' + error.message });
    }
});

// 5. API MOHON KURSUS (TERUS SIMPAN KE SUPABASE DATABASE)
app.post('/api/mohon', async function(req, res) {
    try {
        const { nama, ic, email, jawatan, gred, jabatan, penyakit, pengangkutan, kursus } = req.body || {};

        if (!email) {
            return res.status(400).json({ error: 'Alamat e-mel tidak dijumpai!' });
        }

        const supabase = getSupabase();
        if (supabase) {
            try {
                const newRecord = {
                    ic: String(ic).trim(),
                    user_ic: String(ic).trim(),
                    nama_pemohon: nama,
                    nama: nama,
                    email: email,
                    nama_kursus: kursus,
                    kursus: kursus,
                    jawatan: jawatan,
                    gred: gred,
                    jabatan: jabatan,
                    penyakit: penyakit,
                    pengangkutan: pengangkutan,
                    kod_kursus: 'KSR-' + Math.floor(100 + Math.random() * 900),
                    status: 'Dalam Proses',
                    yuran_kursus: 'RM 0.00',
                    created_at: new Date().toISOString()
                };

                const safePayload = await filterExistingColumns(supabase, 'applications', newRecord);
                const { error: insertErr } = await supabase.from('applications').insert([safePayload]);
                if (insertErr) console.error("Supabase Insert Error:", insertErr.message);

                // Pancarkan notifikasi permohonan baru untuk peranti Admin
                broadcastEvent({ type: 'APPLICATION_UPDATED' });

            } catch(dbErr) {
                console.error("Gagal simpan ke Supabase DB:", dbErr.message);
            }
        }

        // Hantar ke Google Sheet
        const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyV9pe3TYHqXAYqQwkNRG10n96p_oz1RoYNd27X1t_T3r5nZEvoWRtACmMbwcoc98qNEw/exec';
        try {
            await fetch(GOOGLE_SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(req.body),
                redirect: 'follow'
            });
        } catch (gsError) {
            console.error('Google Sheets Error:', gsError.message);
        }

        // Hantar E-mel Pengesahan melalui Brevo
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

        try {
            await fetch('https://api.brevo.com/v3/smtp/email', {
                method: 'POST',
                headers: {
                    'accept': 'application/json',
                    'api-key': process.env.BREVO_API_KEY,
                    'content-type': 'application/json'
                },
                body: JSON.stringify(brevoPayload)
            });
        } catch(e) { console.error('Brevo Email Error:', e.message); }

        return res.status(200).json({ status: 'success', message: 'Permohonan diterima dan rekod telah disimpan!' });
    } catch (error) {
        return res.status(500).json({ error: 'Ralat Server: ' + error.message });
    }
});

// =========================================================================
// 6. API ADMIN: PENGURUSAN PERMOHONAN DARI PELBAGAI USER
// =========================================================================

// A. Dapatkan Semua Permohonan (Admin)
app.get('/api/admin/applications', async (req, res) => {
    try {
        const supabase = getSupabase();
        if (!supabase) return res.status(200).json([]);

        const { data, error } = await supabase
            .from('applications')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) return res.status(200).json([]);
        return res.status(200).json(data || []);
    } catch (error) {
        return res.status(200).json([]);
    }
});

// B. Kemaskini Status Permohonan (Approve / Reject)
app.put('/api/admin/applications/:id/status', async (req, res) => {
    try {
        const supabase = getSupabase();
        if (!supabase) return res.status(500).json({ error: 'Supabase Error' });

        const { id } = req.params;
        const { status } = req.body || {};

        const { error } = await supabase
            .from('applications')
            .update({ status: status })
            .eq('id', id);

        if (error) return res.status(500).json({ error: error.message });

        broadcastEvent({ type: 'APPLICATION_UPDATED' });

        return res.status(200).json({ message: 'Status permohonan berjaya dikemas kini!' });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

// C. Padam Permohonan oleh Admin (Auto Delete)
app.delete('/api/admin/applications/:id', async (req, res) => {
    try {
        const supabase = getSupabase();
        if (!supabase) return res.status(500).json({ error: 'Supabase Error' });

        const { id } = req.params;
        const { error } = await supabase.from('applications').delete().eq('id', id);

        if (error) return res.status(500).json({ error: error.message });

        broadcastEvent({ type: 'APPLICATION_UPDATED' });

        return res.status(200).json({ message: 'Permohonan berjaya dipadam!' });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

// =========================================================================
// 7. API PENGURUSAN DATA PROFIL, PERKHIDMATAN, KECEMASAN & PENDIDIKAN
// =========================================================================

// A. Kemaskini Profil Peribadi
app.put('/api/user/profile', async (req, res) => {
    try {
        const supabase = getSupabase();
        if (!supabase) return res.status(500).json({ error: 'Tetapan Supabase tidak dijumpai.' });

        const { ic, nama, emelRasmi, emelPeribadi, telPejabat, telBimbit, alamat1, alamat2, alamat3, poskod, bandar, negeri, gambar } = req.body || {};
        if (!ic) return res.status(400).json({ error: 'No. MyKad diperlukan!' });

        const rawData = {
            nama,
            email: emelRasmi,
            email_peribadi: emelPeribadi,
            tel_pejabat: telPejabat,
            tel_bimbit: telBimbit,
            alamat_1: alamat1,
            alamat_2: alamat2,
            alamat_3: alamat3,
            poskod,
            bandar,
            negeri
        };
        if (gambar) rawData.gambar = gambar;

        const updateData = await filterExistingColumns(supabase, 'users', rawData);

        const { error } = await supabase
            .from('users')
            .update(updateData)
            .eq('ic', String(ic).trim());

        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ message: 'Profil berjaya dikemas kini!' });
    } catch (error) {
        return res.status(500).json({ error: 'Ralat Server: ' + error.message });
    }
});

// B. Kemaskini Maklumat Perkhidmatan
app.put('/api/user/service', async (req, res) => {
    try {
        const supabase = getSupabase();
        if (!supabase) return res.status(500).json({ error: 'Tetapan Supabase tidak dijumpai.' });

        const { ic, jawatan, gelaranJawatan, gredSSM, gredSSPA, tarafJawatan, tarikhLantikan, kementerian, jabatan, bahagian, alamat1, alamat2, alamat3, poskod, bandar, negeri, penyeliaNama, penyeliaJawatan } = req.body || {};
        if (!ic) return res.status(400).json({ error: 'No. MyKad diperlukan!' });

        const rawData = {
            jawatan,
            gelaran_jawatan: gelaranJawatan,
            gred_ssm: gredSSM,
            gred_sspa: gredSSPA,
            taraf_jawatan: tarafJawatan,
            tarikh_lantikan: tarikhLantikan,
            kementerian,
            jabatan,
            bahagian,
            srv_alamat_1: alamat1,
            srv_alamat_2: alamat2,
            srv_alamat_3: alamat3,
            srv_poskod: poskod,
            srv_bandar: bandar,
            srv_negeri: negeri,
            penyelia_nama: penyeliaNama,
            penyelia_jawatan: penyeliaJawatan
        };

        const updateData = await filterExistingColumns(supabase, 'users', rawData);

        const { error } = await supabase
            .from('users')
            .update(updateData)
            .eq('ic', String(ic).trim());

        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ message: 'Maklumat perkhidmatan berjaya dikemas kini!' });
    } catch (error) {
        return res.status(500).json({ error: 'Ralat Server: ' + error.message });
    }
});

// C. Kemaskini Maklumat Perhitungan / Perhitungan Kecemasan
app.put('/api/user/emergency', async (req, res) => {
    try {
        const supabase = getSupabase();
        if (!supabase) return res.status(500).json({ error: 'Tetapan Supabase tidak dijumpai.' });

        const { ic, nama, tel } = req.body || {};
        if (!ic) return res.status(400).json({ error: 'No. MyKad diperlukan!' });

        const rawData = {
            kecemasan_nama: nama,
            kecemasan_tel: tel
        };

        const updateData = await filterExistingColumns(supabase, 'users', rawData);

        const { error } = await supabase
            .from('users')
            .update(updateData)
            .eq('ic', String(ic).trim());

        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ message: 'Maklumat perhubungan kecemasan berjaya dikemas kini!' });
    } catch (error) {
        return res.status(500).json({ error: 'Ralat Server: ' + error.message });
    }
});

// D. Rekod Pendidikan (Dapatkan / Tambah / Padam)
app.get('/api/user/education/:ic', async (req, res) => {
    try {
        const supabase = getSupabase();
        if (!supabase) return res.status(500).json({ error: 'Tetapan Supabase tidak dijumpai.' });

        const { ic } = req.params;
        const { data, error } = await supabase
            .from('user_education')
            .select('*')
            .eq('user_ic', String(ic).trim())
            .order('created_at', { ascending: false });

        if (error) return res.status(200).json([]);
        return res.status(200).json(data || []);
    } catch (error) {
        return res.status(200).json([]);
    }
});

app.post('/api/user/education', async (req, res) => {
    try {
        const supabase = getSupabase();
        if (!supabase) return res.status(500).json({ error: 'Tetapan Supabase tidak dijumpai.' });

        const { ic, peringkat, institusi, bidang, tahun, keputusan } = req.body || {};
        if (!ic || !peringkat || !institusi) {
            return res.status(400).json({ error: 'Sila lengkapkan maklumat wajib!' });
        }

        const { data, error } = await supabase
            .from('user_education')
            .insert([{
                user_ic: String(ic).trim(),
                peringkat,
                institusi,
                bidang,
                tahun,
                keputusan
            }]);

        if (error) return res.status(500).json({ error: error.message });
        return res.status(201).json({ message: 'Rekod pendidikan berjaya ditambah!', data });
    } catch (error) {
        return res.status(500).json({ error: 'Ralat Server: ' + error.message });
    }
});

app.delete('/api/user/education/:id', async (req, res) => {
    try {
        const supabase = getSupabase();
        if (!supabase) return res.status(500).json({ error: 'Tetapan Supabase tidak dijumpai.' });

        const { id } = req.params;
        const { error } = await supabase.from('user_education').delete().eq('id', id);

        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ message: 'Rekod pendidikan berjaya dipadam!' });
    } catch (error) {
        return res.status(500).json({ error: 'Ralat Server: ' + error.message });
    }
});

// E. Sejarah Permohonan Kursus mengikut User (Mendapatkan rekod dari Supabase)
app.get('/api/user/applications/:ic', async (req, res) => {
    try {
        const supabase = getSupabase();
        if (!supabase) return res.status(500).json({ error: 'Tetapan Supabase tidak dijumpai.' });

        const { ic } = req.params;
        const cleanIc = String(ic).trim();

        let { data, error } = await supabase
            .from('applications')
            .select('*')
            .or(`ic.eq.${cleanIc},user_ic.eq.${cleanIc}`)
            .order('created_at', { ascending: false });

        if (error || !data) return res.status(200).json([]);
        return res.status(200).json(data || []);
    } catch (error) {
        return res.status(200).json([]);
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