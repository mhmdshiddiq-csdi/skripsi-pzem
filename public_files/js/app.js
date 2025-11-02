/**
 * Realtime Multi Chart (Volt, Watt, Ampere, kWh, Frequency, PF) + Alert Toast
 * Versi untuk Node.js dengan Polling ke /api/data
 * - Menghapus semua referensi ke fetch_series.php, stream.php, dan fetch_latest.php
 * - Mengganti semua logic data dengan polling sederhana ke endpoint '/api/data'
 */

(function () {
  'use strict';

  // ===== STATUS ELEMENT =====
  const statusEl = document.getElementById('status');
  const setStatus = (s) => {
    if (statusEl) statusEl.textContent = 'Status: ' + s;
    console.log('[STATUS]', s);
  };

  // ===== CANVAS ELEMENTS =====
  const elVolt = document.getElementById('voltChart');
  const elWatt = document.getElementById('wattChart');
  const elAmp = document.getElementById('ampChart');
  const elKwh = document.getElementById('kwhChart');
  const elFreq = document.getElementById('freqChart');
  const elPf = document.getElementById('pfChart');

  // ===== VALIDASI CHART.JS =====
  if (typeof Chart === 'undefined') {
    console.error('Chart.js belum termuat.');
    setStatus('Chart.js tidak ditemukan');
    return;
  }

  // ===== KONFIGURASI TEMA & WARNA =====
  const cfg = window.config || {
    colors: {
      danger: '#ef4444',
      primary: '#0ea5e9',
      info: '#3b82f6',
      success: '#22c55e'
    }
  };
  const cardColor = window.cardColor || '#fff';
  const labelColor = window.labelColor || '#6b7280';
  const borderColor = window.borderColor || '#e5e7eb';
  const headingColor = window.headingColor || '#111827';
  const legendColor = window.legendColor || '#374151';
  const isRtl = !!window.isRtl;

  // ===== ALERT TOAST (WATT >= 45) =====
  const DANGER_WATT = 45;
  const COOLDOWN_MS = 5000;
  let lastToastAt = 0;
  const alertedIds = new Set();

  function remember(id) {
    if (!id) return;
    alertedIds.add(id);
    if (alertedIds.size > 500) {
      const tmp = Array.from(alertedIds).slice(-250);
      alertedIds.clear();
      tmp.forEach(v => alertedIds.add(v));
    }
  }

  function ensureBootstrapContainer() {
    let c = document.getElementById('toast-container');
    if (!c) {
      c = document.createElement('div');
      c.id = 'toast-container';
      c.style.position = 'fixed';
      c.style.top = '1rem';
      c.style.right = '1rem';
      c.style.zIndex = '1080';
      document.body.appendChild(c);
    }
    return c;
  }

  function showBootstrapToast(message) {
    const container = ensureBootstrapContainer();
    const toastEl = document.createElement('div');
    toastEl.className = 'toast text-white bg-danger border-0 mb-2';
    toastEl.setAttribute('role', 'alert');
    toastEl.setAttribute('aria-live', 'assertive');
    toastEl.setAttribute('aria-atomic', 'true');
    toastEl.innerHTML = `
      <div class="d-flex">
        <div class="toast-body">${message}</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" 
                data-bs-dismiss="toast" aria-label="Close"></button>
      </div>
    `;
    container.appendChild(toastEl);
    try {
      const t = new bootstrap.Toast(toastEl, { delay: 4000, autohide: true });
      t.show();
      toastEl.addEventListener('hidden.bs.toast', () => toastEl.remove());
    } catch (e) {
      toastEl.classList.add('show');
      setTimeout(() => toastEl.remove(), 4000);
    }
  }

  function showToastr(message) {
    try {
      const isRtlMode = document.documentElement.getAttribute('dir') === 'rtl';
      toastr.options = Object.assign({}, toastr.options, {
        positionClass: 'toast-top-right',
        closeButton: true,
        progressBar: true,
        timeOut: 4000,
        rtl: isRtlMode,
        preventDuplicates: true
      });
      toastr.error(message, 'Bahaya');
    } catch (e) {
      console.warn('toastr tidak tersedia, gunakan bootstrap toast:', e);
      showBootstrapToast(message);
    }
  }

  function formatTime(ts) {
    try {
      // Handle format ISO string (2023-10-28T03:30:00.000Z)
      if (typeof ts === 'string' && ts.includes('T')) {
        return new Date(ts).toTimeString().slice(0, 8);
      }
      // Handle format string "2023-10-28 10:30:00"
      if (typeof ts === 'string' && ts.includes(' ')) {
        return ts.split(' ')[1]; // Ambil jam:menit:detik
      }
      // Fallback: gunakan current time
      return new Date().toTimeString().slice(0, 8);
    } catch (e) {
      console.error('formatTime error:', e);
      return new Date().toTimeString().slice(0, 8);
    }
  }

  function handleNewReadingAlert(row) {
    if (!row || typeof row !== 'object') return;

    const id = Number(row.id || 0);
    const watt = Number(row.watt);

    // Validasi nilai watt
    if (!isFinite(watt)) return;

    // Cek apakah watt melebihi threshold
    if (watt >= DANGER_WATT) {
      // Jika sudah pernah diberi alert, skip
      if (id && alertedIds.has(id)) return;

      // Cek cooldown
      const now = Date.now();
      if (now - lastToastAt < COOLDOWN_MS) return;

      // Format waktu dan buat pesan
      const timeLabel = formatTime(row.timestamp);
      const msg = `Bahaya: Watt ≥ ${DANGER_WATT} (${watt.toFixed(1)} W) pada ${timeLabel}`;

      // Tampilkan toast
      if (typeof window.toastr !== 'undefined') {
        showToastr(msg);
      } else {
        showBootstrapToast(msg);
      }

      // Update state
      lastToastAt = now;
      remember(id);
    }
  }

  window.handleNewReadingAlert = handleNewReadingAlert;

  // ===== CHART SETUP =====
  const MAX_POINTS = 240;
  const labels = [];
  const vData = [];
  const wData = [];
  const aData = [];
  const kData = [];
  const fData = [];
  const pData = [];
  let lastId = 0;

  // Hancurkan chart lama jika ada
  [elVolt, elWatt, elAmp, elKwh, elFreq, elPf].forEach(el => {
    if (!el) return;
    const inst = Chart.getChart(el);
    if (inst) inst.destroy();
  });

  const chartsAll = [];

  // ===== TOOLTIP CALLBACKS =====
  const tooltipCallbacks = {
    title: (items) => (items && items.length ? items[0].label || '' : ''),
    label: (context) => {
      const label = context.dataset.label || '';
      const value = Number(context.parsed.y);

      if (/volt/i.test(label)) return `${label}: ${value.toFixed(2)} V`;
      if (/watt/i.test(label)) return `${label}: ${value.toFixed(1)} W`;
      if (/amp/i.test(label)) return `${label}: ${value.toFixed(3)} A`;
      if (/kwh/i.test(label)) return `${label}: ${value.toFixed(4)} kWh`;
      if (/freq|frequency/i.test(label)) return `${label}: ${value.toFixed(2)} Hz`;
      if (/pf/i.test(label)) return `${label}: ${value.toFixed(3)}`;
      return `${label}: ${value}`;
    }
  };

  // ===== CHART CONFIGURATION =====
  const xScale = {
    grid: { color: borderColor, drawBorder: false },
    ticks: { color: labelColor, maxRotation: 0, autoSkip: true, maxTicksLimit: 10 }
  };

  const crosshairPlugin = {
    id: 'crosshair',
    afterDraw: (chart, args, options) => {
      const ctx = chart.ctx;
      const active = chart.tooltip && chart.tooltip.getActiveElements ? chart.tooltip.getActiveElements() : [];

      if (active && active.length > 0) {
        const el = active[0].element;
        if (!el) return;

        const x = el.x;
        const { top, bottom } = chart.chartArea;

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
        ctx.lineWidth = options.lineWidth || 1;
        ctx.strokeStyle = options.color || 'rgba(0,0,0,0.12)';
        ctx.setLineDash(options.dash || []);
        ctx.stroke();
        ctx.restore();
      }
    }
  };

  const commonInteraction = { interaction: { mode: 'index', intersect: false } };

  function makeLineChart(el, conf) {
    if (!el) return null;

    const inst = new Chart(el, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data: conf.data,
          label: conf.label,
          borderColor: conf.color,
          backgroundColor: conf.color,
          tension: 0.5,
          pointStyle: 'circle',
          fill: false,
          pointRadius: 2,
          pointHoverRadius: 6,
          pointHoverBorderWidth: 4,
          pointBorderColor: 'transparent',
          pointHoverBorderColor: cardColor,
          pointHoverBackgroundColor: conf.color
        }]
      },
      options: Object.assign({
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        scales: {
          x: xScale,
          y: conf.y
        },
        plugins: {
          tooltip: {
            enabled: true,
            mode: 'index',
            intersect: false,
            rtl: isRtl,
            backgroundColor: cardColor,
            titleColor: headingColor,
            bodyColor: legendColor,
            borderWidth: 1,
            borderColor: borderColor,
            callbacks: tooltipCallbacks
          },
          legend: {
            position: 'top',
            align: 'start',
            rtl: isRtl,
            labels: {
              usePointStyle: true,
              padding: 20,
              boxWidth: 6,
              boxHeight: 6,
              color: legendColor
            }
          },
          crosshair: { color: 'rgba(0,0,0,0.12)', lineWidth: 1, dash: [] }
        }
      }, commonInteraction),
      plugins: [crosshairPlugin]
    });

    chartsAll.push(inst);
    return inst;
  }

  // ===== BUAT CHART INSTANCES =====
  const chartVolt = makeLineChart(elVolt, {
    label: 'Volt',
    data: vData,
    color: cfg.colors.primary,
    y: {
      min: 0,
      ticks: { color: labelColor },
      grid: { color: borderColor, drawBorder: false }
    }
  });

  const chartWatt = makeLineChart(elWatt, {
    label: 'Watt',
    data: wData,
    color: cfg.colors.danger,
    y: {
      min: 0,
      ticks: { color: labelColor },
      grid: { color: borderColor, drawBorder: false }
    }
  });

  const chartAmp = makeLineChart(elAmp, {
    label: 'Ampere',
    data: aData,
    color: cfg.colors.info,
    y: {
      min: 0,
      ticks: { color: labelColor },
      grid: { color: borderColor, drawBorder: false }
    }
  });

  const chartKwh = makeLineChart(elKwh, {
    label: 'kWh',
    data: kData,
    color: cfg.colors.success,
    y: {
      min: 0,
      ticks: { color: labelColor },
      grid: { color: borderColor, drawBorder: false }
    }
  });

  const chartFreq = makeLineChart(elFreq, {
    label: 'Frequency',
    data: fData,
    color: '#f59e0b',
    y: {
      min: 0,
      ticks: { color: labelColor },
      grid: { color: borderColor, drawBorder: false }
    }
  });

  const chartPf = makeLineChart(elPf, {
    label: 'PF',
    data: pData,
    color: '#8b5cf6',
    y: {
      min: 0,
      max: 1.0,
      ticks: { color: labelColor, stepSize: 0.2 },
      grid: { color: borderColor, drawBorder: false }
    }
  });

  // ===== SINKRONISASI HOVER ANTAR CHART =====
  function syncHoverFromEvent(e, sourceChart) {
    if (!sourceChart || !sourceChart.getElementsAtEventForMode) return;

    const points = sourceChart.getElementsAtEventForMode(
      e.native || e,
      'index',
      { intersect: false }
    );

    if (!points || !points.length) {
      clearActiveAcrossCharts();
      return;
    }

    const idx = points[0].index;
    const el = points[0].element;
    const rect = sourceChart.canvas.getBoundingClientRect();
    const cx = el.x;
    const cy = el.y;

    chartsAll.forEach(c => {
      const activeElems = [{ datasetIndex: 0, index: idx }];
      if (typeof c.setActiveElements === 'function') {
        c.setActiveElements(activeElems);
      }
      if (c.tooltip && typeof c.tooltip.setActiveElements === 'function') {
        c.tooltip.setActiveElements(activeElems, { x: rect.left + cx, y: rect.top + cy });
      }
      c.update('none');
    });
  }

  function clearActiveAcrossCharts() {
    chartsAll.forEach(c => {
      if (typeof c.setActiveElements === 'function') {
        c.setActiveElements([]);
      }
      if (c.tooltip && typeof c.tooltip.setActiveElements === 'function') {
        c.tooltip.setActiveElements([], { x: 0, y: 0 });
      }
      c.update('none');
    });
  }

  // ===== ATTACH EVENT LISTENERS =====
  chartsAll.forEach(c => {
    const canvas = c.canvas;

    canvas.addEventListener('mousemove', ev => {
      if (c.chartArea) syncHoverFromEvent(ev, c);
    });

    canvas.addEventListener('mouseout', ev => {
      setTimeout(() => {
        const insideAny = chartsAll.some(ch => {
          const r = ch.canvas.getBoundingClientRect();
          const x = ev.clientX;
          const y = ev.clientY;
          return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
        });

        if (!insideAny) clearActiveAcrossCharts();
      }, 10);
    });
  });

  // ===== UTILITY FUNCTIONS =====
  function updateAll() {
    chartsAll.forEach(c => c.update('none'));
  }

  function clearData() {
    labels.length = 0;
    vData.length = 0;
    wData.length = 0;
    aData.length = 0;
    kData.length = 0;
    fData.length = 0;
    pData.length = 0;
    lastId = 0;
  }

  function appendPoint(row) {
    if (!row || typeof row !== 'object') return;

    const label = formatTime(row.timestamp);
    pushAndTrim(labels, label);
    pushAndTrim(vData, Number(row.volt) || 0);
    pushAndTrim(wData, Number(row.watt) || 0);
    pushAndTrim(aData, Number(row.ampere) || 0);
    pushAndTrim(kData, Number(row.kwh) || 0);
    pushAndTrim(fData, Number(row.frequency) || 0);
    pushAndTrim(pData, Number(row.pf) || 0);
    lastId = Math.max(lastId, Number(row.id || 0));
  }

  function pushAndTrim(arr, v) {
    arr.push(v);
    if (arr.length > MAX_POINTS) arr.shift();
  }

  // ===== FUNGSI UTAMA: LOAD DAN RENDER DATA =====
  /**
   * Fungsi ini menggantikan loadInitial, startSSE, dan startPolling
   * Mengambil data dari API Node.js '/api/data', mengosongkan chart,
   * lalu mengisinya dengan data baru.
   */
  async function loadAndRenderData() {
    setStatus('memuat data…');

    try {
      // 1. Panggil API Node.js (bukan file PHP)
      const response = await fetch('/api/data', { cache: 'no-store' });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const json = await response.json();

      // 2. Validasi respons API
      if (!json.ok || !Array.isArray(json.data) || json.data.length === 0) {
        setStatus('tidak ada data');
        clearData();
        updateAll();
        return;
      }

      // 3. Kosongkan data chart sebelum diisi
      clearData();

      // 4. Balik array (API mengirim DESC, chart butuh ASC)
      const rows = json.data.reverse();

      // 5. Loop data: append ke chart dan cek alert
      rows.forEach(row => {
        appendPoint(row);
        handleNewReadingAlert(row);
      });

      // 6. Update tampilan chart
      updateAll();
      setStatus('realtime (polling setiap 2s)');
    } catch (error) {
      console.error('[ERROR]', error);
      setStatus(`error: ${error.message}`);
    }
  }

  // ===== INISIALISASI =====
  // 1. Load data saat halaman dibuka
 // ===================================
  // ===== INISIALISASI BARU (WebSocket) =====
  // ===================================
  
  // 1. Tetap panggil fungsi load data untuk data historis (1x saat load)
  loadAndRenderData();

  // 2. HAPUS: const POLLING_INTERVAL_MS = 2000;
  // 3. HAPUS: setInterval(loadAndRenderData, POLLING_INTERVAL_MS);

  // 4. BARU: Mulai listener WebSocket
  console.log('[app.js] Menghubungkan ke WebSocket...');
  const socket = io();

  socket.on('new_reading', (data) => {
    // 'data' adalah JSON sensor baru (misal: {"volt":230, ...})
    console.log('[app.js] Menerima data baru:', data);
    setStatus('realtime (WebSocket)');
    
    // Cek alert (fungsi ini sudah ada di file Anda)
    handleNewReadingAlert(data);
    
    // Tambahkan data baru ke chart (fungsi ini sudah ada)
    // appendPoint sudah punya logic 'pushAndTrim'
    appendPoint(data); 
    
    // Update semua chart (fungsi ini sudah ada)
    updateAll();
  });

  socket.on('connect_error', (err) => {
    setStatus('WebSocket error: ' + err.message);
  });

})();