/**
 * Realtime Table + Client-Side Pagination
 * - Versi Node.js dengan polling ke /api/data
 * - Paginasi client-side (tanpa server-side)
 * - Status badge berdasarkan nilai watt
 */

(function () {
  'use strict';

  // ===== DOM ELEMENTS =====
  const tbody = document.getElementById('liveTableBody');
  const statusEl = document.getElementById('status');
  const pagerEl = document.getElementById('tablePager');

  // ===== VALIDASI ELEMEN =====
  if (!tbody) {
    console.error('[table] #liveTableBody tidak ditemukan');
    return;
  }
  if (!statusEl) {
    console.warn('[table] #status tidak ditemukan');
  }
  if (!pagerEl) {
    console.warn('[table] #tablePager tidak ditemukan');
  }

  // ===== KONFIGURASI =====
  const CONFIG = {
    PER_PAGE: 10,
    POLLING_INTERVAL_MS: 3000,
    API_ENDPOINT: '/api/data',
    CACHE_MAX_ROWS: 1000 // Batasi memory untuk data besar
  };

  // ===== STATE =====
  let state = {
    currentPage: 1,
    total: 0,
    totalPages: 1,
    allData: [],
    isLoading: false,
    pollingInterval: null,
    statusThresholds: {
        warning: 30.0, // Nilai default jika gagal fetch
        danger: 45.0
    }
  };
  function populateThresholdForm() {
    document.getElementById('warning-threshold').value = state.statusThresholds.warning;
    document.getElementById('danger-threshold').value = state.statusThresholds.danger;
}

  // ===== UTILITY FUNCTIONS =====

  /**
   * Format angka dengan decimal places
   * @param {number} watt - Nilai watt
   * @param {number} n - Angka yang akan diformat
   * @param {number} d - Jumlah decimal places
   * @returns {string} - Hasil format atau '-' jika invalid
   */
  function fmt(n, d) {
    const v = Number(n);
    if (!isFinite(v)) return '-';
    return typeof d === 'number' ? v.toFixed(d) : String(v);
  }

  /**
   * Ubah status (setStatus)
   * @param {string} message - Pesan status
   */
  function setStatus(message) {
    if (!statusEl) return;
    console.log('[table]', message);
    statusEl.textContent = 'Status: ' + message;
  }

  /**
   * Generate HTML badge berdasarkan nilai watt
   * @param {number} watt - Nilai watt
   * @returns {string} - HTML badge
   */
  function getStatusBadge(watt) {
    const v = Number(watt);
    // Ambil nilai dari state global
    const WARNING_THRESHOLD = state.statusThresholds.warning;
    const DANGER_THRESHOLD = state.statusThresholds.danger;

    if (!isFinite(v)) {
      return '<span class="badge bg-secondary">Unknown</span>';
    }

    // Watt > DANGER_THRESHOLD: Bahaya
    if (v > DANGER_THRESHOLD) {
      return '<span class="badge bg-label-danger">Bahaya</span>';
    }

    // Watt > WARNING_THRESHOLD: Warning (karena sudah pasti < DANGER_THRESHOLD)
    if (v > WARNING_THRESHOLD) {
      return '<span class="badge bg-label-warning text-dark">Warning</span>';
    }

    // Watt 0 - WARNING_THRESHOLD: Aman
    if (v > 0) {
      return '<span class="badge bg-label-success">Aman</span>';
    }

    // Watt = 0 atau invalid
    return '<span class="badge bg-label-secondary">—</span>';
  }

  // ===== RENDER FUNCTIONS =====

  /**
   * Render baris tabel dari array data
   * @param {Array} rows - Array data yang akan dirender
   */
  function renderRows(rows) {
    // Validasi input
    if (!Array.isArray(rows)) {
      console.error('[table] renderRows: input bukan array', rows);
      tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">Tidak ada data</td></tr>';
      return;
    }

    // Kosongkan tbody
    tbody.innerHTML = '';

    // Jika tidak ada data
    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">Tidak ada data untuk halaman ini</td></tr>';
      return;
    }

    // Render setiap row
    rows.forEach(row => {
      if (!row || typeof row !== 'object') return;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${fmt(row.volt, 2)} V</td>
        <td>${fmt(row.watt, 1)} W</td>
        <td>${fmt(row.ampere, 3)} A</td>
        <td>${fmt(row.pf, 3)}</td>
        <td>${fmt(row.kwh, 4)} kWh</td>
        <td>${fmt(row.frequency, 2)} Hz</td>
        <td>${getStatusBadge(row.watt)}</td>
      `;
      tbody.appendChild(tr);
    });
  }
  async function handleThresholdFormSubmit(event) {
    event.preventDefault();

    const warningInput = document.getElementById('warning-threshold');
    const dangerInput = document.getElementById('danger-threshold');
    const saveButton = document.getElementById('save-threshold-btn');
    const messageDiv = document.getElementById('threshold-message');

    const warningValue = parseFloat(warningInput.value);
    const dangerValue = parseFloat(dangerInput.value);

    // Validasi Sederhana
    if (warningValue <= 0 || dangerValue <= 0) {
        showMessage(messageDiv, 'Batas harus lebih besar dari 0.', 'alert-danger');
        return;
    }
    if (warningValue >= dangerValue) {
        showMessage(messageDiv, 'Batas "Warning" harus lebih kecil dari batas "Bahaya".', 'alert-danger');
        return;
    }

    saveButton.disabled = true;
    saveButton.textContent = 'Menyimpan...';
    messageDiv.style.display = 'none';

    try {
        const response = await fetch('/api/status/thresholds', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ warning: warningValue, danger: dangerValue })
        });

        const data = await response.json();

        if (response.ok && data.ok) {
            // Update state lokal dan re-render tabel
            state.statusThresholds = { warning: warningValue, danger: dangerValue };
            renderCurrentPage(state.allData);
            
            showMessage(messageDiv, 'Batas status berhasil disimpan!', 'alert-success');
        } else {
            throw new Error(data.error || 'Gagal menyimpan konfigurasi.');
        }

    } catch (error) {
        showMessage(messageDiv, 'Error: ' + error.message, 'alert-danger');
    } finally {
        saveButton.disabled = false;
        saveButton.textContent = 'Simpan Batas Status';
    }
}
function showMessage(element, text, className) {
    element.textContent = text;
    element.className = 'mt-2 alert ' + className;
    element.style.display = 'block';
}
  /**
   * Render pagination controls
   */
  function renderPager() {
    if (!pagerEl) return;

    pagerEl.innerHTML = '';

    // Button "Previous"
    const prevPage = Math.max(1, state.currentPage - 1);
    const prevDisabled = state.currentPage === 1;
    pagerEl.appendChild(buildPageItem('«', prevPage, false, prevDisabled));

    // Range pagination (7 halaman di tengah)
    const WINDOW_SIZE = 7;
    let startPage = Math.max(1, state.currentPage - Math.floor(WINDOW_SIZE / 2));
    let endPage = Math.min(state.totalPages, startPage + WINDOW_SIZE - 1);

    if (endPage - startPage + 1 < WINDOW_SIZE) {
      startPage = Math.max(1, endPage - WINDOW_SIZE + 1);
    }

    for (let p = startPage; p <= endPage; p++) {
      const isActive = p === state.currentPage;
      pagerEl.appendChild(buildPageItem(String(p), p, isActive, false));
    }

    // Button "Next"
    const nextPage = Math.min(state.totalPages, state.currentPage + 1);
    const nextDisabled = state.currentPage === state.totalPages;
    pagerEl.appendChild(buildPageItem('»', nextPage, false, nextDisabled));
  }

  /**
   * Build pagination item
   * @param {string} label - Label untuk tombol
   * @param {number} page - Nomor halaman
   * @param {boolean} active - Apakah halaman aktif
   * @param {boolean} disabled - Apakah tombol disabled
   * @returns {HTMLElement} - Element <li>
   */
  function buildPageItem(label, page, active = false, disabled = false) {
    const li = document.createElement('li');
    li.className = 'page-item';
    if (active) li.classList.add('active');
    if (disabled) li.classList.add('disabled');

    const a = document.createElement('a');
    a.className = 'page-link';
    a.href = '#';
    a.dataset.page = String(page);
    a.textContent = label;

    if (disabled) {
      a.style.pointerEvents = 'none';
      a.style.opacity = '0.5';
    }

    li.appendChild(a);
    return li;
  }

  /**
   * Render halaman saat ini dari data global
   */
  function renderCurrentPage() {
    // Hitung range data untuk halaman saat ini
    const start = (state.currentPage - 1) * CONFIG.PER_PAGE;
    const end = start + CONFIG.PER_PAGE;

    // Ambil potongan data (slice)
    const pageData = state.allData.slice(start, end);

    // Render tabel dan pager
    renderRows(pageData);
    renderPager();

    // Update status
    const displayStart = Math.min(start + 1, state.total);
    const displayEnd = Math.min(end, state.total);
    const statusMsg = `Menampilkan ${displayStart}-${displayEnd} dari ${state.total} data (Hal ${state.currentPage}/${state.totalPages})`;
    setStatus(statusMsg);
  }

  // ===== DATA LOADING =====

  /**
   * Load semua data dari API Node.js
   * Data akan disimpan di state.allData untuk client-side pagination
   */
  async function loadAllData() {
    // Jangan load jika sedang loading
    if (state.isLoading) return;

    state.isLoading = true;
    setStatus('memuat data tabel…');

    try {
      // 1. Fetch dari API Node.js
      const response = await fetch(CONFIG.API_ENDPOINT, {
        cache: 'no-store',
        method: 'GET'
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const json = await response.json();

      // 2. Validasi respons
      if (!json.ok || !Array.isArray(json.data)) {
        console.warn('[table] API respons tidak valid:', json);
        state.allData = [];
        state.total = 0;
        state.totalPages = 1;
        setStatus('tidak ada data');
        renderCurrentPage();
        return;
      }

      // 3. Update state data
      state.allData = json.data.slice(0, CONFIG.CACHE_MAX_ROWS); // Batasi memory
      state.total = state.allData.length;
      state.totalPages = Math.max(1, Math.ceil(state.total / CONFIG.PER_PAGE));

      // 4. Reset ke halaman 1 jika halaman saat ini out of bounds
      if (state.currentPage > state.totalPages) {
        state.currentPage = 1;
      }

      // 5. Render halaman saat ini
      renderCurrentPage();

      console.log('[table] Data loaded:', state.total, 'rows');
    } catch (error) {
      console.error('[table] loadAllData error:', error);
      setStatus(`error: ${error.message}`);
    } finally {
      state.isLoading = false;
    }
  }

  // ===== EVENT HANDLERS =====

  /**
   * Handle pagination click
   */
  function handlePaginationClick(event) {
    const link = event.target.closest('a.page-link');
    if (!link) return;

    event.preventDefault();

    const page = parseInt(link.dataset.page || '1', 10);

    // Validasi halaman
    if (!isFinite(page) || page < 1 || page > state.totalPages) {
      return;
    }

    // Jangan reload jika halaman sama
    if (page === state.currentPage) {
      return;
    }

    // Update halaman dan render
    state.currentPage = page;
    renderCurrentPage();
  }


  // ===== INITIALIZATION =====
  async function loadStatusThresholds() {
    try {
        const response = await fetch('/api/status/thresholds', {
            cache: 'no-store'
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const json = await response.json();
        
        if (json.ok && json.data) {
            state.statusThresholds = {
                warning: parseFloat(json.data.warning) || 30.0,
                danger: parseFloat(json.data.danger) || 45.0
            };
            console.log('[table] Status thresholds loaded:', state.statusThresholds);
        }
    } catch (error) {
        console.error('[table] Gagal memuat status thresholds, menggunakan default.', error);
    }
}

  console.log('[table] Initializing realtime table…');

  // 1. Attach event listener untuk pagination
  if (pagerEl) {
    pagerEl.addEventListener('click', handlePaginationClick);
  }


   // ===================================
   // ===== INISIALISASI BARU (WebSocket) =====
   // ===================================
  
   // 1. Tetap panggil fungsi load data untuk data historis (1x saat load)
// 2. BARU: Muat Threshold sebelum data
const statusFormEl = document.getElementById('status-threshold-form');

if (statusFormEl) {
    statusFormEl.addEventListener('submit', handleThresholdFormSubmit);
    
    // Panggil populate setelah data batas dimuat:
    loadStatusThresholds().then(() => {
        populateThresholdForm(); // BARU: Mengisi form dengan nilai dari DB
        loadAllData();
    });
} else {
    // Jika form tidak ditemukan, setidaknya load thresholds dan data
    loadStatusThresholds().then(() => {
        loadAllData();
    });
}

   // 2. HAPUS: function startPolling() { ... }
   // 3. HAPUS: loadAllData().then(startPolling)...

   // 4. BARU: Mulai listener WebSocket
   console.log('[table.js] Menghubungkan ke WebSocket...');
   const socket = io();

   socket.on('new_reading', (data) => {
     // 'data' adalah JSON sensor baru (misal: {"volt":230, ...})
     console.log('[table.js] Menerima data baru:', data);

    // Tambahkan 'timestamp' dari server jika tidak ada
    if (!data.timestamp) {
        data.timestamp = new Date().toISOString();
    }
    
     // Tambahkan data baru ke ATAS array
     state.allData.unshift(data);
    if (state.allData.length > CONFIG.CACHE_MAX_ROWS) {
        state.allData.pop(); // Hapus data paling lama jika melebihi batas
    }
    
    // Update total & jumlah halaman di state
     state.total = state.allData.length;
     state.totalPages = Math.max(1, Math.ceil(state.total / CONFIG.PER_PAGE)); // Gunakan CONFIG.PER_PAGE

     // Render ulang HANYA jika user ada di halaman 1
     if (state.currentPage === 1) {
        renderCurrentPage();
     } else {
        // Jika user di hal 2, kita bisa update Pager-nya saja
        renderPager(); 
     }
   });

   socket.on('connect_error', (err) => {
     console.log('[table.js] WebSocket error: ' + err.message);
   });

})(); // <-- Akhir file