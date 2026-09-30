// ==========================================
// 1. DASHBOARD & GOOGLE APPS SCRIPT (ASAL)
// ==========================================
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz4TB216Zg7ZqmE17Ggv2pzCPsPT4TXANkqFJxe4SoCAjQSlAz-7DQlioFh_oakP6vlmA/exec';

async function loadDashboardStats() {
    // Bilangan berdasarkan data daripada iklan.html dan mohon.html
    const totalKursus = 8;  // 8 Iklan kursus di iklan.html
    const totalBidang = 28; // 28 Jabatan/Agensi di mohon.html
    const totalPusat = 8;   // 8 Lokasi pusat latihan di iklan.html
    
    let totalPeserta = 0;   // Akan diisi secara LIVE dari Google Sheets

    try {
        // Panggil Google Apps Script secara Live untuk membaca jumlah peserta
        const response = await fetch(SCRIPT_URL);
        
        if (response.ok) {
            const data = await response.json();
            if (data.totalPeserta !== undefined) {
                totalPeserta = data.totalPeserta;
            }
        }
    } catch (error) {
        console.warn('Gagal mengambil jumlah peserta live dari Google Sheets, menggunakan nilai lalai:', error);
    }

    // Kemaskini elemen di index.html secara dinamik
    updateElementText('stat-kursus', totalKursus);
    updateElementText('stat-bidang', totalBidang);
    updateElementText('stat-peserta', totalPeserta.toLocaleString());
    updateElementText('stat-pusat', totalPusat);
}

function updateElementText(id, value) {
    const el = document.getElementById(id);
    if (el) {
        el.innerText = value;
    }
}


// ==========================================
// 2. LOG MASUK (LOGIN)
// ==========================================
function setupAuthForms() {
    // Handling Form Log Masuk sahaja (login.html)
    const loginForm = document.getElementById('loginForm');
    const isLoginPage = window.location.pathname.includes('login.html');

    if (isLoginPage && loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const emailOrIc = document.getElementById('emailOrIc')?.value || loginForm.querySelector('input[type="text"], input[type="email"]')?.value;
            const password = document.getElementById('password')?.value || loginForm.querySelector('input[type="password"]')?.value;

            try {
                // Hantar ke endpoint relative /api/login di Vercel
                const response = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ emailOrIc, password })
                });

                const result = await response.json();

                if (response.ok) {
                    alert(result.message || 'Log masuk berjaya!');
                    localStorage.setItem('user', JSON.stringify(result.user));
                    window.location.href = 'index.html';
                } else {
                    alert(result.error || 'Log masuk gagal.');
                }
            } catch (error) {
                console.error('Ralat Log Masuk:', error);
                alert('Gagal berhubung dengan server.');
            }
        });
    }
}


// ==========================================
// 3. JALANKAN FUNGSI SEBAIK HALAMAN DISIAPKAN
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    loadDashboardStats();
    setupAuthForms();
});