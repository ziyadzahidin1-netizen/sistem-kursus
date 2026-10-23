// ==========================================
// 1. DASHBOARD & STATISTIK LIVE
// ==========================================
async function loadDashboardStats() {
    let totalKursus = 0;
    let totalBidang = 0;
    let totalPusat = 0;
    let totalPeserta = 0;

    // Ambil kursus dari localStorage (User & Admin local additions)
    let localCourses = [];
    try {
        localCourses = JSON.parse(localStorage.getItem('custom_courses')) || [];
    } catch (e) {
        localCourses = [];
    }

    try {
        // Ambil data statistik daripada Backend API
        const response = await fetch('/api/stats');
        if (response.ok) {
            const data = await response.json();
            totalKursus = data.totalKursus || 0;
            totalBidang = data.totalBidang || 0;
            totalPusat = data.totalPusat || 0;
            totalPeserta = data.totalPeserta || 0;
        }
    } catch (error) {
        console.warn('Gagal mengambil statistik dari server, bertukar ke pengiraan tempatan:', error);
    }

    // Gabungkan dengan data tempatan jika ada
    if (localCourses.length > 0) {
        totalKursus += localCourses.length;

        const bidangSet = new Set(localCourses.map(c => c.bidang).filter(Boolean));
        const pusatSet = new Set(localCourses.map(c => c.tempat).filter(Boolean));

        totalBidang = Math.max(totalBidang, bidangSet.size);
        totalPusat = Math.max(totalPusat, pusatSet.size);
    }

    // Kemaskini elemen HTML secara Live
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
// 2. FUNGSI TOGGLE PASSWORD
// ==========================================
function togglePassword(id, icon) {
    const input = document.getElementById(id);
    if (!input) return;
    
    if (input.type === 'password') {
        input.type = 'text';
        icon.classList.replace('fa-eye', 'fa-eye-slash');
    } else {
        input.type = 'password';
        icon.classList.replace('fa-eye-slash', 'fa-eye');
    }
}

// ==========================================
// 3. PERMOHONAN KURSUS VIA NODEMAILER / BREVO (mohon.html)
// ==========================================
function loadUserData() {
    const userData = localStorage.getItem('user') || sessionStorage.getItem('user');

    if (!userData) {
        alert('Sila log masuk terlebih dahulu.');
        window.location.href = 'login.html';
        return;
    }

    const user = JSON.parse(userData);

    const nameInput = document.getElementById('app-name');
    const icInput = document.getElementById('app-ic');
    const emailInput = document.getElementById('app-email');

    if (nameInput) nameInput.value = user.nama || user.name || '';
    if (icInput) icInput.value = user.ic || '';
    if (emailInput) emailInput.value = user.email || '';
}

function setupCourseForm() {
    const courseForm = document.getElementById('courseForm');
    const isMohonPage = window.location.pathname.includes('mohon.html');

    if (isMohonPage) {
        loadUserData();

        if (courseForm) {
            courseForm.addEventListener('submit', async (e) => {
                e.preventDefault();

                const btnSubmit = document.getElementById('btn-submit');
                if (btnSubmit) {
                    btnSubmit.disabled = true;
                    btnSubmit.innerHTML = 'Menghantar Permohonan... <i class="fa-solid fa-spinner fa-spin"></i>';
                }

                const formData = {
                    nama: document.getElementById('app-name')?.value || '',
                    ic: document.getElementById('app-ic')?.value || '',
                    email: document.getElementById('app-email')?.value || '',
                    jawatan: document.getElementById('app-jawatan')?.value || '',
                    gred: document.getElementById('app-gred')?.value || '',
                    jabatan: document.getElementById('app-jabatan')?.value || '',
                    penyakit: document.getElementById('app-penyakit')?.value || '',
                    pengangkutan: document.getElementById('app-pengangkutan')?.value || '',
                    kursus: document.getElementById('course-select')?.value || ''
                };

                try {
                    const response = await fetch('/api/mohon', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(formData)
                    });

                    const result = await response.json();

                    if (response.ok) {
                        alert('Permohonan berjaya dihantar! E-mel pengesahan telah dihantar.');
                        courseForm.reset();
                        loadUserData();
                    } else {
                        alert('Gagal menghantar permohonan: ' + (result.error || result.message || 'Sila cuba lagi.'));
                    }
                } catch (error) {
                    console.error('Ralat Server:', error);
                    alert('Gagal menyambung ke server backend: ' + error.message);
                } finally {
                    if (btnSubmit) {
                        btnSubmit.disabled = false;
                        btnSubmit.innerHTML = 'Hantar Permohonan <i class="fa-solid fa-paper-plane"></i>';
                    }
                }
            });
        }
    }
}

// ==========================================
// 4. NAVBAR USER DROPDOWN & LOGOUT GLOBAL
// ==========================================
function checkAndUpdateUserNav() {
    const navContainer = document.getElementById('user-nav-container');
    const userData = localStorage.getItem('user') || sessionStorage.getItem('user');

    if (userData && navContainer) {
        try {
            const user = JSON.parse(userData);
            const userPhoto = user.gambar || 'https://via.placeholder.com/150';
            const userName = user.nama || user.name || 'Pengguna';

            navContainer.innerHTML = `
                <div class="user-dropdown-container">
                    <button id="userMenuBtn" onclick="toggleUserDropdown()" class="user-dropdown-btn">
                        <img src="${userPhoto}" alt="Avatar" class="user-avatar-small" id="navUserAvatar">
                        <span>${userName}</span>
                        <i class="fa-solid fa-chevron-down" style="font-size: 0.8rem;"></i>
                    </button>
                    <div id="userMenuDropdown" class="dropdown-menu">
                        <a href="user_dashboard.html"><i class="fa-solid fa-id-card"></i> User Dashboard</a>
                        <a href="tukar_kata_laluan.html"><i class="fa-solid fa-key"></i> Tukar Kata Laluan</a>
                        <button onclick="handleLogout()" class="logout-item"><i class="fa-solid fa-right-from-bracket"></i> Log Keluar</button>
                    </div>
                </div>
            `;
        } catch(e) {
            console.error('Ralat parse data pengguna:', e);
        }
    }
}

function toggleUserDropdown() {
    const dropdown = document.getElementById('userMenuDropdown');
    if (dropdown) {
        dropdown.classList.toggle('show');
    }
}

function handleLogout() {
    localStorage.removeItem('user');
    sessionStorage.removeItem('user');
    window.location.href = 'login.html';
}

// ==========================================
// 5. REALTIME LISTENER (SERVER-SENT EVENTS)
// ==========================================
function initRealtimeListener() {
    if (!!window.EventSource) {
        const eventSource = new EventSource('/api/events');

        eventSource.onmessage = function(e) {
            const data = JSON.parse(e.data);

            if (data.type === 'COURSE_UPDATED') {
                if (typeof loadAdminCoursesOnly === 'function') loadAdminCoursesOnly();
                if (typeof renderAdminCoursesOnly === 'function') renderAdminCoursesOnly();
                loadDashboardStats();
            }

            if (data.type === 'APPLICATION_UPDATED') {
                if (typeof loadAllUserApplicationsForAdmin === 'function') loadAllUserApplicationsForAdmin();
            }
        };

        eventSource.onerror = function(err) {
            console.warn("Ralat sambungan live SSE:", err);
        };
    }
}

// ==========================================
// 6. JALANKAN SEBAIK HALAMAN DISIAPKAN
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    loadDashboardStats();
    setupCourseForm();
    checkAndUpdateUserNav();
    
    // Mulakan Realtime Listener untuk ganti Polling
    initRealtimeListener();

    // Tutup dropdown apabila klik di luar
    document.addEventListener('click', (e) => {
        const dropdown = document.getElementById('userMenuDropdown');
        const btn = document.getElementById('userMenuBtn');
        if (dropdown && btn && !btn.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.classList.remove('show');
        }
    });

    const mobileMenu = document.getElementById('mobile-menu');
    const navLinks = document.getElementById('nav-links');

    if (mobileMenu && navLinks) {
        mobileMenu.addEventListener('click', function () {
            mobileMenu.classList.toggle('active');
            navLinks.classList.toggle('active');
        });

        const buttons = navLinks.querySelectorAll('a');
        buttons.forEach(button => {
            button.addEventListener('click', () => {
                mobileMenu.classList.remove('active');
                navLinks.classList.remove('active');
            });
        });
    }
});