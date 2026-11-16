const express = require('express');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

// Muat turun .env untuk pembangunan tempatan (Local)
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const app = express();

// Middleware
app.use(cors());

// Tingkatkan had saiz request untuk menyokong gambar muat naik Base64 / Fail Dokumen
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Sajikan fail statik HTML/CSS/JS dari folder semasa
app.use(express.static(path.join(__dirname)));

// Array Simpanan Memori (Fallback jika Supabase tiada/gagal)
let memoryApplications = [];

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

// Helper function untuk menapis lajur yang tidak wujud dengan selamat
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

// Helper parse tarikh di backend (YYYY-MM-DD, DD/MM/YYYY, atau Teks Melayu)
function parseDateBackend(dateStr) {
    if (!dateStr) return null;
    const str = String(dateStr).trim();

    const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
        return new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]), 0, 0, 0, 0);
    }

    const dmyMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (dmyMatch) {
        return new Date(Number(dmyMatch[3]), Number(dmyMatch[2]) - 1, Number(dmyMatch[1]), 0, 0, 0, 0);
    }

    const bulanMap = {
        januari: 0, februari: 1, mac: 2, april: 3, mei: 4, jun: 5,
        julai: 6, ogos: 7, september: 8, oktober: 9, november: 10, disember: 11
    };
    const textMatch = str.toLowerCase().match(/(\d{1,2})\s+(januari|februari|mac|april|mei|jun|julai|ogos|september|oktober|november|disember)\s+(\d{4})/);
    if (textMatch) {
        return new Date(Number(textMatch[3]), bulanMap[textMatch[2]], Number(textMatch[1]), 0, 0, 0, 0);
    }

    return null;
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

    sseClients.push(res);

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

// 2. API REGISTER
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

// =========================================================================
// 3.1 API LUPA & RESET KATA LALUAN (HANTAR KE E-MEL BERDAFTAR)
// =========================================================================

app.post('/api/forgot-password', async (req, res) => {
    try {
        const supabase = getSupabase();
        if (!supabase) return res.status(500).json({ error: 'Tetapan Supabase tidak dijumpai.' });

        const { email } = req.body || {};
        if (!email) {
            return res.status(400).json({ error: 'Sila masukkan alamat e-mel yang didaftarkan.' });
        }

        const cleanEmail = String(email).trim().toLowerCase();

        const { data: user, error: userError } = await supabase
            .from('users')
            .select('id, nama, email, role')
            .eq('email', cleanEmail)
            .maybeSingle();

        if (userError) {
            return res.status(500).json({ error: 'Ralat pangkalan data: ' + userError.message });
        }

        if (!user) {
            return res.status(404).json({ error: 'E-mel ini tidak dijumpai dalam rekod pendaftaran.' });
        }

        const resetToken = crypto.randomBytes(32).toString('hex');
        const expiryDate = new Date(Date.now() + 3600000).toISOString();

        const { error: updateError } = await supabase
            .from('users')
            .update({
                reset_token: resetToken,
                reset_token_expiry: expiryDate
            })
            .eq('id', user.id);

        if (updateError) {
            return res.status(500).json({ error: 'Gagal menjana token reset: ' + updateError.message });
        }

        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const host = req.get('host');
        const resetLink = `${protocol}://${host}/reset_password.html?token=${resetToken}`;

        if (process.env.BREVO_API_KEY && process.env.SENDER_EMAIL) {
            const htmlContent = `
                <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: auto; border: 1px solid #e2e8f0; border-radius: 8px;">
                    <h2 style="color: #2563eb;">Permintaan Tetapan Semula Kata Laluan</h2>
                    <p>Salam Sejahtera <strong>${user.nama || 'Pengguna'}</strong>,</p>
                    <p>Kami menerima permintaan untuk menetapkan semula kata laluan bagi akaun Portal Kursus anda.</p>
                    <p>Sila klik butang di bawah untuk menetapkan kata laluan baharu (pautan ini sah selama <strong>1 jam</strong>):</p>
                    <div style="margin: 25px 0;">
                        <a href="${resetLink}" style="background-color: #2563eb; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Tetapkan Semula Kata Laluan</a>
                    </div>
                    <p style="font-size: 0.85rem; color: #64748b;">Jika butang di atas tidak berfungsi, salin dan tampal pautan ini ke pelayar web anda:<br>${resetLink}</p>
                    <p style="font-size: 0.85rem; color: #64748b;">Jika anda tidak membuat permintaan ini, sila abaikan e-mel ini.</p>
                </div>
            `;

            const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
                method: 'POST',
                headers: {
                    'accept': 'application/json',
                    'api-key': process.env.BREVO_API_KEY,
                    'content-type': 'application/json'
                },
                body: JSON.stringify({
                    sender: { name: "Portal MOSTI", email: process.env.SENDER_EMAIL },
                    to: [{ email: user.email, name: user.nama || 'Pengguna' }],
                    subject: 'Tetapan Semula Kata Laluan - Portal Kursus',
                    htmlContent: htmlContent
                })
            });

            if (!brevoRes.ok) {
                const errText = await brevoRes.text();
                console.error('Brevo Error:', errText);
                return res.status(500).json({ error: 'Gagal menghantar e-mel melalui Brevo.' });
            }

            return res.status(200).json({ message: 'Pautan tetapan semula kata laluan telah dihantar ke e-mel anda!' });
        } else {
            return res.status(500).json({ error: 'Tetapan BREVO_API_KEY atau SENDER_EMAIL tiada di server.' });
        }
    } catch (error) {
        return res.status(500).json({ error: 'Ralat Server: ' + error.message });
    }
});

app.post('/api/reset-password', async (req, res) => {
    try {
        const supabase = getSupabase();
        if (!supabase) return res.status(500).json({ error: 'Tetapan Supabase tidak dijumpai.' });

        const { token, newPassword } = req.body || {};
        if (!token || !newPassword) {
            return res.status(400).json({ error: 'Token dan kata laluan baharu diperlukan.' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'Kata laluan mestilah sekurang-kurangnya 6 aksara.' });
        }

        const { data: user, error: userError } = await supabase
            .from('users')
            .select('id, reset_token_expiry')
            .eq('reset_token', token)
            .maybeSingle();

        if (userError || !user) {
            return res.status(400).json({ error: 'Pautan tetapan semula tidak sah atau telah digunakan.' });
        }

        if (!user.reset_token_expiry || new Date(user.reset_token_expiry) < new Date()) {
            return res.status(400).json({ error: 'Pautan ini telah tamat tempoh. Sila mohon semula.' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        const { error: updateError } = await supabase
            .from('users')
            .update({
                password: hashedPassword,
                reset_token: null,
                reset_token_expiry: null
            })
            .eq('id', user.id);

        if (updateError) {
            return res.status(500).json({ error: 'Gagal mengemas kini kata laluan: ' + updateError.message });
        }

        return res.status(200).json({ message: 'Kata laluan berjaya ditetapkan semula! Sila log masuk.' });
    } catch (error) {
        return res.status(500).json({ error: 'Ralat Server: ' + error.message });
    }
});

app.post('/api/change-password', async (req, res) => {
    try {
        const supabase = getSupabase();
        if (!supabase) return res.status(500).json({ error: 'Tetapan Supabase tidak dijumpai.' });

        const { email, oldPassword, newPassword } = req.body || {};
        if (!email || !oldPassword || !newPassword) {
            return res.status(400).json({ error: 'Sila lengkapkan semua medan kata laluan.' });
        }

        const { data: user, error: userError } = await supabase
            .from('users')
            .select('id, password')
            .eq('email', String(email).trim().toLowerCase())
            .maybeSingle();

        if (userError || !user) {
            return res.status(404).json({ error: 'Akaun pengguna tidak dijumpai.' });
        }

        const isMatch = await bcrypt.compare(oldPassword, user.password);
        if (!isMatch) {
            return res.status(400).json({ error: 'Kata laluan semasa tidak tepat!' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        const { error: updateError } = await supabase
            .from('users')
            .update({ password: hashedPassword })
            .eq('id', user.id);

        if (updateError) {
            return res.status(500).json({ error: 'Gagal mengemas kini kata laluan: ' + updateError.message });
        }

        return res.status(200).json({ message: 'Kata laluan anda berjaya dikemas kini!' });
    } catch (error) {
        return res.status(500).json({ error: 'Ralat Server: ' + error.message });
    }
});

// =========================================================================
// 4. API PENGURUSAN KURSUS
// =========================================================================
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

        const { 
            tajuk, tarikh, tarikh_mula, tarikh_tamat, tempat, penerangan, 
            gambar_url, bidang, masa, objektif, penyelaras_nama, 
            penyelaras_emel, penyelaras_telefon 
        } = req.body || {};

        if (!tajuk || !tarikh || !tempat || !penerangan) {
            return res.status(400).json({ error: 'Sila lengkapkan semua medan wajib!' });
        }

        const rawData = { 
            tajuk, tarikh, tarikh_mula, tarikh_tamat, tempat, penerangan, 
            gambar_url, bidang, masa, objektif, penyelaras_nama, 
            penyelaras_emel, penyelaras_telefon 
        };
        
        const safePayload = await filterExistingColumns(supabase, 'courses', rawData);

        const { data, error } = await supabase.from('courses').insert([safePayload]).select();
        if (error) {
            console.error("Supabase Insert Error:", error.message);
            return res.status(500).json({ error: error.message });
        }

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
        const { 
            tajuk, tarikh, tarikh_mula, tarikh_tamat, tempat, penerangan, 
            gambar_url, bidang, masa, objektif, penyelaras_nama, 
            penyelaras_emel, penyelaras_telefon 
        } = req.body || {};

        const rawData = { 
            tajuk, tarikh, tarikh_mula, tarikh_tamat, tempat, penerangan, 
            gambar_url, bidang, masa, objektif, penyelaras_nama, 
            penyelaras_emel, penyelaras_telefon 
        };
        
        const updateData = await filterExistingColumns(supabase, 'courses', rawData);

        const { data, error } = await supabase.from('courses').update(updateData).eq('id', id).select();
        if (error) {
            console.error("Supabase Update Error:", error.message);
            return res.status(500).json({ error: error.message });
        }

        broadcastEvent({ type: 'COURSE_UPDATED' });
        return res.status(200).json({ message: 'Kursus berjaya dikemas kini!', data });
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

        if (error) {
            console.error("Supabase Delete Error:", error.message);
            return res.status(500).json({ error: error.message });
        }

        broadcastEvent({ type: 'COURSE_UPDATED' });
        return res.status(200).json({ message: 'Kursus berjaya dipadam!' });
    } catch (error) {
        return res.status(500).json({ error: 'Ralat Server: ' + error.message });
    }
});

// =========================================================================
// 5. API MOHON KURSUS (AUTO BLOCK JIKA TARIKH KURSUS SUDAH TAMAT)
// =========================================================================
app.post('/api/mohon', async function(req, res) {
    try {
        const { nama, ic, email, jawatan, gred, jabatan, penyakit, pengangkutan, kursus } = req.body || {};

        if (!email || !ic) {
            return res.status(400).json({ error: 'Sila lengkapkan alamat e-mel dan No. MyKad!' });
        }

        const supabase = getSupabase();

        if (supabase && kursus) {
            const { data: courseInfo } = await supabase
                .from('courses')
                .select('tarikh')
                .eq('tajuk', kursus)
                .maybeSingle();

            if (courseInfo && courseInfo.tarikh) {
                const today = new Date();
                today.setHours(0, 0, 0, 0);

                const eventDate = parseDateBackend(courseInfo.tarikh);
                if (eventDate && today > eventDate) {
                    return res.status(403).json({ error: 'Permohonan sudah ditutup.' });
                }
            }
        }

        const newRecord = {
            id: Date.now().toString(),
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
            ulasan_admin: '',
            yuran_kursus: 'RM 0.00',
            created_at: new Date().toISOString()
        };

        memoryApplications.unshift(newRecord);

        if (supabase) {
            try {
                const safePayload = await filterExistingColumns(supabase, 'applications', newRecord);
                const { error: insertErr } = await supabase.from('applications').insert([safePayload]);
                if (insertErr) console.error("Supabase Insert Error:", insertErr.message);
            } catch(dbErr) {
                console.error("Gagal simpan ke Supabase DB:", dbErr.message);
            }
        }

        const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyV9pe3TYHqXAYqQwkNRG10n96p_oz1RoYNd27X1t_T3r5nZEvoWRtACmMbwcoc98qNEw/exec';
        try {
            fetch(GOOGLE_SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(req.body),
                redirect: 'follow'
            }).catch(e => console.error('Google Sheets Error:', e.message));
        } catch (gsError) {
            console.error('Google Sheets Fetch Error:', gsError.message);
        }

        if (process.env.BREVO_API_KEY && process.env.SENDER_EMAIL) {
            const htmlContent = `
                <div style="font-family: Arial, sans-serif; padding: 20px;">
                    <h2>Portal Kursus MOSTI</h2>
                    <p>Salam Sejahtera <strong>${nama || 'Pemohon'}</strong>,</p>
                    <p>Permohonan anda untuk kursus <strong>${kursus || '-'}</strong> telah diterima dan sedang diproses. Sekiranya tuan/puan terpilih, surat tawaran akan dikeluarkan dan dihantar melalui e-mel yang didaftarkan. Terima kasih kerana telah memohon kursus ini.</p>
                </div>
            `;

            fetch('https://api.brevo.com/v3/smtp/email', {
                method: 'POST',
                headers: {
                    'accept': 'application/json',
                    'api-key': process.env.BREVO_API_KEY,
                    'content-type': 'application/json'
                },
                body: JSON.stringify({
                    sender: { name: "Portal MOSTI", email: process.env.SENDER_EMAIL },
                    to: [{ email: email, name: nama || 'Pemohon' }],
                    subject: `Permohonan Anda Diterima: ${kursus}`,
                    htmlContent: htmlContent
                })
            }).catch(e => console.error('Brevo Email Error:', e.message));
        }

        broadcastEvent({ type: 'APPLICATION_UPDATED' });

        return res.status(200).json({ status: 'success', message: 'Permohonan diterima dan rekod telah disimpan!' });
    } catch (error) {
        return res.status(500).json({ error: 'Ralat Server: ' + error.message });
    }
});

// =========================================================================
// 6. API ADMIN: PENGURUSAN PERMOHONAN DARI PELBAGAI USER (TERMASUK ULASAN)
// =========================================================================
app.get('/api/admin/applications', async (req, res) => {
    try {
        const supabase = getSupabase();
        if (supabase) {
            const { data, error } = await supabase
                .from('applications')
                .select('*')
                .order('created_at', { ascending: false });

            if (!error && data && data.length > 0) {
                return res.status(200).json(data);
            }
        }
        return res.status(200).json(memoryApplications);
    } catch (error) {
        return res.status(200).json(memoryApplications);
    }
});

// Kemaskini Status & Ulasan Admin sekali gus
app.put('/api/admin/applications/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status, ulasan_admin, ulasan } = req.body || {};
        const teksUlasan = ulasan_admin !== undefined ? ulasan_admin : ulasan;

        const memItem = memoryApplications.find(a => String(a.id) === String(id));
        if (memItem) {
            memItem.status = status;
            if (teksUlasan !== undefined) memItem.ulasan_admin = teksUlasan;
        }

        const supabase = getSupabase();
        if (supabase) {
            const updatePayload = { status: status };
            if (teksUlasan !== undefined) {
                updatePayload.ulasan_admin = teksUlasan;
            }
            const { error } = await supabase
                .from('applications')
                .update(updatePayload)
                .eq('id', id);

            if (error) return res.status(500).json({ error: error.message });
        }

        broadcastEvent({ type: 'APPLICATION_UPDATED' });
        return res.status(200).json({ message: 'Status permohonan berjaya dikemas kini!' });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

// Route khas untuk simpan Ulasan Admin
app.put('/api/admin/applications/:id/ulasan', async (req, res) => {
    try {
        const { id } = req.params;
        const { ulasan_admin, ulasan } = req.body || {};
        const teksUlasan = ulasan_admin !== undefined ? ulasan_admin : (ulasan || '');

        const memItem = memoryApplications.find(a => String(a.id) === String(id));
        if (memItem) {
            memItem.ulasan_admin = teksUlasan;
        }

        const supabase = getSupabase();
        if (supabase) {
            const { error } = await supabase
                .from('applications')
                .update({ ulasan_admin: teksUlasan })
                .eq('id', id);

            if (error) return res.status(500).json({ error: error.message });
        }

        broadcastEvent({ type: 'APPLICATION_UPDATED' });
        return res.status(200).json({ message: 'Ulasan admin berjaya disimpan ke pangkalan data!' });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

app.delete('/api/admin/applications/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        memoryApplications = memoryApplications.filter(a => String(a.id) !== String(id));

        const supabase = getSupabase();
        if (supabase) {
            const { error } = await supabase.from('applications').delete().eq('id', id);
            if (error) return res.status(500).json({ error: error.message });
        }

        broadcastEvent({ type: 'APPLICATION_UPDATED' });
        return res.status(200).json({ message: 'Permohonan berjaya dipadam!' });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

// 6.1 API ADMIN DASHBOARD: SIMPAN & DAPATKAN REKOD MODUL LATIHAN (DTIMS)
app.post('/api/admin/latihan-modul/:moduleName', async (req, res) => {
    try {
        const { moduleName } = req.params;
        const payload = req.body || {};
        const supabase = getSupabase();

        if (supabase) {
            const tableName = `admin_${moduleName}`;
            const safePayload = await filterExistingColumns(supabase, tableName, payload);
            
            let { error: insertErr } = await supabase
                .from(tableName)
                .insert([safePayload]);

            if (insertErr) {
                let updatedPayload = { ...safePayload };
                if (insertErr.message.includes("'fail_syarikat'")) delete updatedPayload.fail_syarikat;
                if (insertErr.message.includes("'updated_at'")) delete updatedPayload.updated_at;

                const retry = await supabase.from(tableName).insert([updatedPayload]);
                insertErr = retry.error;
            }

            if (insertErr) {
                return res.status(500).json({ error: 'Ralat Supabase: ' + insertErr.message });
            }
        }

        broadcastEvent({ type: 'ADMIN_MODULE_UPDATED', module: moduleName, data: payload });

        return res.status(200).json({ 
            status: 'success', 
            message: `Data ${moduleName.replace(/_/g, ' ')} berjaya disimpan!` 
        });
    } catch (error) {
        return res.status(500).json({ error: 'Ralat Server: ' + error.message });
    }
});

app.get('/api/admin/latihan-modul/:moduleName', async (req, res) => {
    try {
        const { moduleName } = req.params;
        const supabase = getSupabase();

        if (supabase) {
            const { data, error } = await supabase
                .from(`admin_${moduleName}`)
                .select('*')
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (!error && data) {
                return res.status(200).json(data);
            }
        }

        return res.status(200).json({});
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

// 7. API PENGURUSAN DATA PROFIL, PERKHIDMATAN, KECEMASAN & PENDIDIKAN
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

        const { error } = await supabase.from('users').update(updateData).eq('ic', String(ic).trim());
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ message: 'Profil berjaya dikemas kini!' });
    } catch (error) {
        return res.status(500).json({ error: 'Ralat Server: ' + error.message });
    }
});

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

        const { error } = await supabase.from('users').update(updateData).eq('ic', String(ic).trim());
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ message: 'Maklumat perkhidmatan berjaya dikemas kini!' });
    } catch (error) {
        return res.status(500).json({ error: 'Ralat Server: ' + error.message });
    }
});

app.put('/api/user/emergency', async (req, res) => {
    try {
        const supabase = getSupabase();
        if (!supabase) return res.status(500).json({ error: 'Tetapan Supabase tidak dijumpai.' });

        const { ic, nama, tel } = req.body || {};
        if (!ic) return res.status(400).json({ error: 'No. MyKad diperlukan!' });

        const rawData = { kecemasan_nama: nama, kecemasan_tel: tel };
        const updateData = await filterExistingColumns(supabase, 'users', rawData);

        const { error } = await supabase.from('users').update(updateData).eq('ic', String(ic).trim());
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ message: 'Maklumat perhubungan kecemasan berjaya dikemas kini!' });
    } catch (error) {
        return res.status(500).json({ error: 'Ralat Server: ' + error.message });
    }
});

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
            .insert([{ user_ic: String(ic).trim(), peringkat, institusi, bidang, tahun, keputusan }]);

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

app.get('/api/user/applications/:ic', async (req, res) => {
    try {
        const supabase = getSupabase();
        const { ic } = req.params;
        const cleanIc = String(ic).trim();

        if (supabase) {
            let { data, error } = await supabase
                .from('applications')
                .select('*')
                .or(`ic.eq.${cleanIc},user_ic.eq.${cleanIc}`)
                .order('created_at', { ascending: false });

            if (!error && data && data.length > 0) return res.status(200).json(data);
        }
        
        const userMemData = memoryApplications.filter(a => a.ic === cleanIc || a.user_ic === cleanIc);
        return res.status(200).json(userMemData);
    } catch (error) {
        return res.status(200).json([]);
    }
});

app.use('/api/*', (req, res) => {
    return res.status(404).json({ error: 'Route API tidak wujud.' });
});

if (!process.env.VERCEL) {
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, function() {
        console.log('Server berjalan di http://localhost:' + PORT);
    });
}

module.exports = app;