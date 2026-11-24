// ==========================================
// 1. DASHBOARD & STATISTIK LIVE
// ==========================================
async function loadDashboardStats() {
    let totalKursus = 0;
    let totalBidang = 0;
    let totalPusat = 0;
    let totalPeserta = 0;

    try {
        // Ambil data senarai kursus dari Backend API secara terus
        const coursesResponse = await fetch('/api/kursus');
        if (coursesResponse.ok) {
            const courses = await coursesResponse.json();
            totalKursus = courses.length;

            const bidangSet = new Set(courses.map(c => c.bidang).filter(Boolean));
            const pusatSet = new Set(courses.map(c => c.tempat).filter(Boolean));

            totalBidang = bidangSet.size;
            totalPusat = pusatSet.size;
        }

        // Ambil data statistik am daripada Backend API
        const statsResponse = await fetch('/api/stats');
        if (statsResponse.ok) {
            const data = await statsResponse.json();
            if (data.totalPeserta !== undefined) totalPeserta = data.totalPeserta;
        }
    } catch (error) {
        console.warn('Gagal mengambil data dari server:', error);
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
// 3. MUAT DATA PENGGUNA (mohon.html)
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
                if (typeof loadCourses === 'function') loadCourses();
                loadDashboardStats();
            }

            if (data.type === 'APPLICATION_UPDATED') {
                if (typeof loadAllUserApplicationsForAdmin === 'function') loadAllUserApplicationsForAdmin();
                if (typeof loadAllApplicationsPage === 'function') loadAllApplicationsPage();
                if (typeof loadAllApplications === 'function') loadAllApplications();
                if (typeof loadUserApplications === 'function') loadUserApplications();
                loadDashboardStats();
            }

            if (data.type === 'ADMIN_MODULE_UPDATED' && data.module === 'kertas_perakuan') {
                if (typeof muatKertasPerakuanTersimpan === 'function' && typeof checkWorkflowStatus === 'function') {
                    muatKertasPerakuanTersimpan().then(() => checkWorkflowStatus());
                }
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
    checkAndUpdateUserNav();
    
    // Mulakan Realtime Listener untuk mengemas kini semua pelayar secara automatik
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