/**
 * Statistik Nilai Tertinggi (Volt, Watt, Ampere, PF, kWh, Frequency)
 * - Versi FINAL dengan WebSocket (socket.io)
 * - Load awal via '/api/stats/max' (1x)
 * - Realtime update via WebSocket event 'new_reading'
 * - State management yang proper dengan error handling
 */

(function () {
  'use strict';

  // ===== KONFIGURASI =====
  const CONFIG = {
    API_ENDPOINT: '/api/stats/max',
    TIMEAGO_INTERVAL_MS: 1000,
    CACHE_STRATEGY: 'no-store'
  };

  // ===== DOM ELEMENTS =====
  const elements = {
    volt: document.getElementById('statVolt'),
    watt: document.getElementById('statWatt'),
    amp: document.getElementById('statAmp'),
    pf: document.getElementById('statPf'),
    kwh: document.getElementById('statKwh'),
    freq: document.getElementById('statFreq'),
    updated: document.getElementById('statsUpdated')
  };

  // ===== VALIDASI DOM ELEMENTS =====
  const requiredElements = ['volt', 'updated'];
  const missingElements = requiredElements.filter(key => !elements[key]);

  if (missingElements.length > 0) {
    console.error('[stats] Missing required DOM elements:', missingElements);
    return;
  }

  console.log('[stats] Initializing statistics module (WebSocket mode)…');

  // ===== STATE =====
  let state = {
    max: {
      volt: null,
      watt: null,
      ampere: null,
      pf: null,
      kwh: null,
      frequency: null
    },
    lastUpdatedAt: null,
    isLoading: false,
    lastError: null,
    timeagoInterval: null,
    socketConnected: false
  };

  // ===== FORMATTERS =====
  /**
   * Format functions untuk setiap metric
   * @type {Object<string, Function>}
   */
  const formatters = {
    volt: (v) => isFinite(v) ? Number(v).toFixed(2) : '-',
    watt: (v) => isFinite(v) ? Number(v).toFixed(1) : '-',
    ampere: (v) => isFinite(v) ? Number(v).toFixed(3) : '-',
    pf: (v) => isFinite(v) ? Number(v).toFixed(3) : '-',
    kwh: (v) => isFinite(v) ? Number(v).toFixed(4) : '-',
    frequency: (v) => isFinite(v) ? Number(v).toFixed(2) : '-'
  };

  // ===== UTILITY FUNCTIONS =====

  /**
   * Convert timestamp to "time ago" format
   * @param {string|number} timestamp - Timestamp dari DB atau JS
   * @returns {string} - Format "Xs ago", "Xm ago", "Xh ago", "Xd ago"
   */
  function timeAgo(timestamp) {
    try {
      const now = Date.now();
      const ts = typeof timestamp === 'string'
        ? new Date(timestamp).getTime()
        : (Number(timestamp) || now);

      if (!isFinite(ts) || ts > now) {
        return 'just now';
      }

      const secondsAgo = Math.max(1, Math.round((now - ts) / 1000));

      if (secondsAgo < 60) return `${secondsAgo}s ago`;
      const minutesAgo = Math.round(secondsAgo / 60);
      if (minutesAgo < 60) return `${minutesAgo}m ago`;
      const hoursAgo = Math.round(minutesAgo / 60);
      if (hoursAgo < 24) return `${hoursAgo}h ago`;
      const daysAgo = Math.round(hoursAgo / 24);
      return `${daysAgo}d ago`;
    } catch (error) {
      console.error('[stats] timeAgo error:', error);
      return 'unknown';
    }
  }

  /**
   * Validasi apakah value adalah angka yang valid
   * @param {any} val - Value yang akan divalidasi
   * @returns {boolean}
   */
  function isValidNumber(val) {
    return val !== null && val !== undefined && isFinite(Number(val));
  }

  /**
   * Update UI element dengan error state
   * @param {string} message - Error message
   */
  function showError(message) {
    state.lastError = message;
    if (elements.updated) {
      elements.updated.textContent = `Error: ${message}`;
      elements.updated.classList.add('text-danger');
    }
    console.error('[stats] Error:', message);
  }

  /**
   * Clear error state dan resume normal display
   */
  function clearError() {
    state.lastError = null;
    if (elements.updated) {
      elements.updated.classList.remove('text-danger');
    }
  }

  // ===== RENDER FUNCTIONS =====

  /**
   * Render statistik data ke UI dari state.max
   */
  function renderStats() {
    const maxData = state.max;

    if (!maxData || typeof maxData !== 'object') {
      console.warn('[stats] Invalid data object:', maxData);
      return;
    }

    try {
      if (elements.volt) elements.volt.textContent = formatters.volt(maxData.volt);
      if (elements.watt) elements.watt.textContent = formatters.watt(maxData.watt);
      if (elements.amp) elements.amp.textContent = formatters.ampere(maxData.ampere);
      if (elements.pf) elements.pf.textContent = formatters.pf(maxData.pf);
      if (elements.kwh) elements.kwh.textContent = formatters.kwh(maxData.kwh);
      if (elements.freq) elements.freq.textContent = formatters.frequency(maxData.frequency);

      updateTimestampDisplay();
      clearError();

      console.log('[stats] Stats rendered successfully');
    } catch (error) {
      console.error('[stats] renderStats error:', error);
      showError('Render failed');
    }
  }

  /**
   * Update display timestamp ("Updated Xs ago")
   */
  function updateTimestampDisplay() {
    if (!elements.updated) return;
    if (state.lastError) return; // Jangan update jika sedang error

    if (state.lastUpdatedAt) {
      elements.updated.textContent = `Updated ${timeAgo(state.lastUpdatedAt)}`;
    } else {
      elements.updated.textContent = 'Updated —';
    }
  }

  // ===== DATA FETCHING (1x load awal) =====

  /**
   * Fetch maksimum statistics dari API (untuk initial load)
   * @async
   */
  async function fetchMaxStats() {
    if (state.isLoading) {
      console.warn('[stats] Fetch already in progress');
      return;
    }

    state.isLoading = true;

    try {
      console.log('[stats] Fetching from', CONFIG.API_ENDPOINT);
      const response = await fetch(CONFIG.API_ENDPOINT, {
        cache: CONFIG.CACHE_STRATEGY,
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const json = await response.json();

      if (!json.ok) {
        throw new Error(json.error || 'API returned error');
      }

      // Validasi struktur data
      if (!json.max || typeof json.max !== 'object') {
        console.warn('[stats] Invalid max data structure:', json);
        json.max = {};
      }

      // Update state dengan data awal
      state.max = {
        volt: json.max.volt !== undefined ? Number(json.max.volt) : null,
        watt: json.max.watt !== undefined ? Number(json.max.watt) : null,
        ampere: json.max.ampere !== undefined ? Number(json.max.ampere) : null,
        pf: json.max.pf !== undefined ? Number(json.max.pf) : null,
        kwh: json.max.kwh !== undefined ? Number(json.max.kwh) : null,
        frequency: json.max.frequency !== undefined ? Number(json.max.frequency) : null
      };

      state.lastUpdatedAt = json.updated_at || Date.now();

      // Render data
      renderStats();

      console.log('[stats] Fetch successful, updated at:', state.lastUpdatedAt);
    } catch (error) {
      console.error('[stats] Fetch error:', error);
      showError(error.message || 'Network error');
    } finally {
      state.isLoading = false;
    }
  }

  // ===== WEBSOCKET HANDLERS =====

  /**
   * Bandingkan data baru dari WebSocket dengan state.max
   * Update state.max jika ada nilai yang lebih besar
   * @param {Object} row - Data baru dari WebSocket 'new_reading'
   */
  function consider(row) {
    if (!row || typeof row !== 'object') {
      console.warn('[stats] Invalid row data:', row);
      return;
    }

    let changed = false;
    const max = state.max;

    // Helper untuk update value
    const updateIfGreater = (field, value) => {
      if (isValidNumber(value)) {
        const numVal = Number(value);
        if (max[field] === null || numVal > max[field]) {
          max[field] = numVal;
          changed = true;
          return true;
        }
      }
      return false;
    };

    // Lakukan perbandingan
    const voltChanged = updateIfGreater('volt', row.volt);
    const wattChanged = updateIfGreater('watt', row.watt);
    const ampereChanged = updateIfGreater('ampere', row.ampere);
    const pfChanged = updateIfGreater('pf', row.pf);
    const kwhChanged = updateIfGreater('kwh', row.kwh);
    const freqChanged = updateIfGreater('frequency', row.frequency);

    // Jika ada nilai max baru, render ulang
    if (changed) {
      const changedFields = [];
      if (voltChanged) changedFields.push('volt');
      if (wattChanged) changedFields.push('watt');
      if (ampereChanged) changedFields.push('ampere');
      if (pfChanged) changedFields.push('pf');
      if (kwhChanged) changedFields.push('kwh');
      if (freqChanged) changedFields.push('frequency');

      console.log('[stats] New max value(s) detected:', changedFields, row);
      state.lastUpdatedAt = row.timestamp || Date.now();
      renderStats();
    }
  }

  /**
   * Initialize dan attach WebSocket listeners
   */
  function startWebSocketListener() {
    console.log('[stats] Initializing WebSocket listener…');

    try {
      // Cek apakah socket.io tersedia
      if (typeof io === 'undefined') {
        throw new Error('socket.io library not loaded');
      }

      const socket = io();

      // ===== CONNECTION EVENT =====
      socket.on('connect', () => {
        state.socketConnected = true;
        console.log('[stats] WebSocket connected');
        clearError();
        updateTimestampDisplay();
      });

      // ===== DISCONNECT EVENT =====
      socket.on('disconnect', (reason) => {
        state.socketConnected = false;
        console.warn('[stats] WebSocket disconnected:', reason);
        showError('WebSocket Disconnected');
      });

      // ===== CONNECTION ERROR EVENT =====
      socket.on('connect_error', (error) => {
        console.error('[stats] WebSocket connect error:', error);
        showError('WebSocket Connection Error');
      });

      // ===== NEW READING EVENT (Realtime Data) =====
      socket.on('new_reading', (data) => {
        try {
          // Validasi dan proses data baru
          if (data && typeof data === 'object') {
            consider(data);
          } else {
            console.warn('[stats] Invalid new_reading data:', data);
          }
        } catch (error) {
          console.error('[stats] Error processing new_reading:', error);
        }
      });

      // ===== DEBUG INFO =====
      console.log('[stats] WebSocket listeners attached');
    } catch (error) {
      console.error('[stats] WebSocket init failed:', error);
      showError('WebSocket Init Error');
    }
  }

  // ===== TIMER FOR "AGO" UPDATE =====

  /**
   * Mulai interval timer untuk update "ago" text setiap detik
   */
  function startTimeAgoUpdater() {
    console.log('[stats] Starting timeAgo updater…');

    state.timeagoInterval = setInterval(() => {
      updateTimestampDisplay();
    }, CONFIG.TIMEAGO_INTERVAL_MS);
  }

  /**
   * Stop timer updater
   */
  function stopTimeAgoUpdater() {
    if (state.timeagoInterval) {
      clearInterval(state.timeagoInterval);
      state.timeagoInterval = null;
      console.log('[stats] TimeAgo updater stopped');
    }
  }

  // ===== INITIALIZATION =====

  /**
   * Initialize module
   */
  function init() {
    try {
      console.log('[stats] Loading initial data…');

      // 1. Load data awal
      fetchMaxStats()
        .then(() => {
          console.log('[stats] Initial load completed, starting WebSocket…');
          // 2. Mulai WebSocket listener setelah load awal selesai
          startWebSocketListener();
        })
        .catch(error => {
          console.error('[stats] Initial load failed:', error);
          showError('Failed to load initial data');
          // Tetap coba nyalakan WebSocket meskipun load awal gagal
          startWebSocketListener();
        });

      // 3. Mulai timer 'ago' (terpisah, selalu berjalan)
      startTimeAgoUpdater();

      console.log('[stats] Module initialized');
    } catch (error) {
      console.error('[stats] Initialization error:', error);
    }
  }

  // ===== CLEANUP =====

  /**
   * Cleanup saat page ditutup atau unload
   */
  window.addEventListener('beforeunload', () => {
    console.log('[stats] Cleaning up…');
    stopTimeAgoUpdater();
  });

  // ===== EXPOSE DEBUG TOOLS =====
  window._statsDebug = {
    state: () => ({ ...state }),
    fetch: fetchMaxStats,
    consider: consider,
    config: CONFIG,
    renderStats: renderStats
  };

  // ===== START MODULE =====
  init();
})();