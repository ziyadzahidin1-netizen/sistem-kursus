// URL Google Apps Script dari mohon.html
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

// Jalankan skrip ini sebaik sahaja halaman siap dimuatkan
document.addEventListener('DOMContentLoaded', loadDashboardStats);