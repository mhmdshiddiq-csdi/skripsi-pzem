const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const mysql = require('mysql2');
const express = require('express');
const path = require('path');
const http = require('http'); // <-- BARU
const { Server } = require("socket.io"); // <-- BARU
const session = require('express-session'); // <-- BARU
const bcrypt = require('bcryptjs');       // <-- BARU

const SERIAL_PORT_PATH = 'COM9'; 
const BAUD_RATE = 115200;
const WEB_SERVER_PORT = 3000; //

const dbConfig = {
  host: "localhost",
  user: "root",       // User default XAMPP
  password: "",     // Password default XAMPP
  database: "skripsi" // GANTI INI dengan nama database Anda
};

// GANTI INI: Sesuaikan nama tabel dan kolom Anda
const NAMA_TABEL = "parameters"; 

const app = express();
const server = http.createServer(app); // <-- BARU: Bungkus 'app' dengan server HTTP
const io = new Server(server); // <-- BARU: Hubungkan socket.io ke server HTTP

// --- 3. Konfigurasi Sesi (PENGGANTI $_SESSION) ---
const sessionMiddleware = session({
  secret: 'iniadalahkunciyangsangatrahasiagantilainkali', // <-- GANTI INI
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false, // Set 'true' jika Anda menggunakan HTTPS
    maxAge: 1000 * 60 * 60 * 24 // Cookie berlaku 1 hari
  }
});
app.use(sessionMiddleware);
app.use(express.json()); // Middleware untuk parse JSON body
const checkAuth = (req, res, next) => {
  if (req.session.user) {
    // Pengguna sudah login, lanjutkan
    next();
  } else {
    // Pengguna belum login
    if (req.accepts('html')) {
      // Jika minta halaman, redirect ke login
      res.redirect('/login.html');
    } else {
      // Jika minta API, kirim error 401
      res.status(401).json({ ok: false, error: 'Akses ditolak. Silakan login.' });
    }
  }
};

// --- D. Rute Halaman (BARU) ---
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public_files', 'login.html'));
});

// Halaman Dashboard Utama (DIPROTEKSI)
app.get('/', checkAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public_files', 'index.html'));
});
app.use(express.static(path.join(__dirname, 'public_files')));


let lastKnownRelay1 = false;
let lastKnownRelay2 = false;


// --- 2. Koneksi Database ---
const db = mysql.createConnection(dbConfig);
db.connect(err => {
  if (err) {
    console.error('❌ Error koneksi ke MySQL:', err.message);
    process.exit(1);
  }
  console.log('✅ Berhasil terhubung ke database MySQL.');
});

// --- 3. Koneksi Serial Port ---
const port = new SerialPort({ path: SERIAL_PORT_PATH, baudRate: BAUD_RATE });
const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

port.on('open', () => console.log(`✅ Port Serial ${SERIAL_PORT_PATH} terbuka.`));
port.on('error', err => console.error('❌ Error Port Serial:', err.message));

// --- 4. Listener Data Serial (Ingest) ---
parser.on('data', line => {
  const trimmedLine = line.trim();
  
  if (trimmedLine.startsWith('{') && trimmedLine.endsWith('}')) {
    try {
      const data = JSON.parse(trimmedLine);
      
      if (data.hasOwnProperty('ok')) {
        // Ini JSON Status (respons dari perintah)
        console.log(`[ESP32-STATUS]: ${trimmedLine}`);
        if (data.hasOwnProperty('relay1')) lastKnownRelay1 = data.relay1;
        if (data.hasOwnProperty('relay2')) lastKnownRelay2 = data.relay2;

        // BARU: Siarkan status update ke browser
        io.emit('status_update', data);

      } else if (data.hasOwnProperty('volt')) {
        // Ini JSON Ingest (data sensor)
        console.log('Data Ingest Diterima:', data); 
        
        // 1. Simpan ke DB (TETAP DILAKUKAN)
        insertToDB(data); 
        
        // 2. BARU: Siarkan data ini ke semua browser
        io.emit('new_reading', data);
        
      } else {
        console.warn('⚠️ JSON tidak dikenal:', trimmedLine);
      }
    } catch (e) {
      console.warn('⚠️ Gagal parse JSON:', trimmedLine, e.message);
    }
  } else if (trimmedLine.length > 0) {
    console.log(`[ESP32-DEBUG]: ${trimmedLine}`);
  }
});

// Fungsi untuk memasukkan data ke database
function insertToDB(data) {
  // Pastikan NAMA_KOLOM di atas sesuai
  const sql = `INSERT INTO ${NAMA_TABEL} (volt, ampere, watt, frequency, pf, kwh, ts) VALUES (?, ?, ?, ?, ?, ?, NOW())`;
  
  const values = [
    data.volt,
    data.ampere,
    data.watt,
    data.frequency,
    data.pf,
    data.kwh
  ];

  db.query(sql, values, (err, results) => {
    if (err) {
      console.error('❌ GAGAL insert ke DB:', err.message);
      return;
    }
    console.log(`✅ Data Ingest Sukses (ID: ${results.insertId})`);
  });
}

io.on('connection', (socket) => {
  console.log('✅ Browser terhubung (WebSocket)');
  socket.on('disconnect', () => {
    console.log('Browser terputus');
  });
});
// --- A. API Login ---
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ ok: false, error: 'Email dan password diperlukan.' });
  }

  try {
    const [rows] = await db.promise().query('SELECT * FROM users WHERE email = ?', [email]);
    if (rows.length === 0) {
      return res.status(401).json({ ok: false, error: 'Email atau password salah.' });
    }

    const user = rows[0];

    // Verifikasi password (PHP password_hash() vs bcryptjs)
    // bcryptjs bisa memverifikasi hash dari PHP password_hash() (BCRYPT)
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    if (!isPasswordValid) {
      return res.status(401).json({ ok: false, error: 'Email atau password salah.' });
    }

    // --- LOGIN SUKSES ---
    // Simpan info user di sesi (tanpa password)
    req.session.user = {
      id: user.id,
      email: user.email,
      nama: user.nama
    };

    console.log(`[Auth] Pengguna berhasil login: ${user.email}`);
    res.json({ ok: true, user: req.session.user });

  } catch (err) {
    console.error('[Auth] Error saat login:', err.message);
    res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});
// --- B. API Logout ---
app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ ok: false, error: 'Gagal logout' });
    }
    res.clearCookie('connect.sid'); // Hapus cookie sesi
    res.json({ ok: true, message: 'Berhasil logout' });
  });
});
// API untuk mendapatkan statistik MAX dari database
app.get('/api/stats/max', async (req, res) => {
  try {
    // ===== VALIDASI =====
    // 1. Pastikan NAMA_TABEL sudah didefinisikan dan tidak kosong
    if (!NAMA_TABEL || typeof NAMA_TABEL !== 'string' || NAMA_TABEL.trim() === '') {
      console.warn('[/api/stats/max] NAMA_TABEL tidak valid atau undefined');
      return res.status(400).json({
        ok: false,
        error: 'Configuration error: table name not set',
        max: {},
        updated_at: null
      });
    }

    // ===== SQL QUERY =====
    // Query untuk mendapatkan nilai MAX dari semua field metrics
    // Escape table name untuk mencegah SQL Injection (jika perlu, gunakan backtick)
    const tableName = NAMA_TABEL.replace(/[^a-zA-Z0-9_]/g, ''); // Hanya alphanumeric & underscore
    
    const sql = `
      SELECT 
        MAX(volt) AS volt, 
        MAX(watt) AS watt, 
        MAX(ampere) AS ampere, 
        MAX(pf) AS pf, 
        MAX(kwh) AS kwh, 
        MAX(frequency) AS frequency
      FROM \`${tableName}\`
    `;

    // ===== EXECUTE QUERY =====
    console.log('[/api/stats/max] Executing query...');
    const [rows] = await db.promise().query(sql);

    // ===== VALIDASI RESPONS DATABASE =====
    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      console.warn('[/api/stats/max] No data returned from database');
      return res.json({
        ok: true,
        max: {
          volt: null,
          watt: null,
          ampere: null,
          pf: null,
          kwh: null,
          frequency: null
        },
        updated_at: null
      });
    }

    const row = rows[0];

    // ===== MAPPING & KONVERSI DATA =====
    // Pastikan semua nilai numeric dan tidak undefined
    const maxStats = {
      volt: row.volt !== null && row.volt !== undefined ? parseFloat(row.volt) : null,
      watt: row.watt !== null && row.watt !== undefined ? parseFloat(row.watt) : null,
      ampere: row.ampere !== null && row.ampere !== undefined ? parseFloat(row.ampere) : null,
      pf: row.pf !== null && row.pf !== undefined ? parseFloat(row.pf) : null,
      kwh: row.kwh !== null && row.kwh !== undefined ? parseFloat(row.kwh) : null,
      frequency: row.frequency !== null && row.frequency !== undefined ? parseFloat(row.frequency) : null
    };

    // ===== RESPONS SUKSES =====
    console.log('[/api/stats/max] Query succeeded', maxStats);
    res.json({
      ok: true,
      max: maxStats,
      updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null
    });

  } catch (err) {
    // ===== ERROR HANDLING =====
    console.error('[/api/stats/max] Database error:', {
      message: err.message,
      code: err.code,
      errno: err.errno,
      sqlState: err.sqlState
    });

    // Tentukan status code berdasarkan jenis error
    let statusCode = 500;
    let errorMessage = 'Internal server error';

    if (err.code === 'ER_NO_SUCH_TABLE') {
      statusCode = 404;
      errorMessage = 'Table not found';
    } else if (err.code === 'ER_ACCESS_DENIED_ERROR') {
      statusCode = 403;
      errorMessage = 'Database access denied';
    } else if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ECONNREFUSED') {
      statusCode = 503;
      errorMessage = 'Database connection failed';
    }

    res.status(statusCode).json({
      ok: false,
      error: errorMessage,
      max: {},
      updated_at: null
    });
  }
});

// API untuk Kontrol Relay (dipanggil oleh tombol di index.html)
app.post('/api/kontrol', (req, res) => {
  const { lamp, state } = req.body; // state adalah 'on' atau 'off'
  
  if (!lamp || !state) {
    return res.status(400).json({ ok: false, error: 'lamp and state required' });
  }

  // Buat perintah untuk ESP32
  let command = '';
  if (lamp == 1) command = `RELAY1=${state.toUpperCase()}`;
  if (lamp == 2) command = `RELAY2=${state.toUpperCase()}`;
  
  if (command === '') {
     return res.status(400).json({ ok: false, error: 'invalid lamp' });
  }

  // Kirim perintah ke Serial
  port.write(command + '\n', (err) => {
    if (err) {
      console.error('❌ Gagal kirim perintah:', err.message);
      return res.status(500).json({ ok: false, error: 'serial write error' });
    }
    console.log(`[API] -> Perintah terkirim: ${command}`);
    // Update status internal
    if (command === 'RELAY1=ON') lastKnownRelay1 = true;
    if (command === 'RELAY1=OFF') lastKnownRelay1 = false;
    if (command === 'RELAY2=ON') lastKnownRelay2 = true;
    if (command === 'RELAY2=OFF') lastKnownRelay2 = false;
    
    res.json({ ok: true, lamp: lamp, state: state });
  });
});

// API untuk mendapatkan status relay terakhir
app.get('/api/status', (req, res) => {
  // Minta status terbaru dari ESP32
  port.write('STATUS?\n', (err) => {
    if (err) console.error('Gagal minta status:', err.message);
  });
  
  // Kirim status terakhir yang kita tahu
  res.json({
    ok: true,
    relay1: lastKnownRelay1,
    relay2: lastKnownRelay2
    // Anda bisa tambahkan query DB di sini untuk data sensor terakhir
  });
});

// TAMBAHKAN INI: API untuk data tabel dan chart
// (Ini menggantikan app.js, table.js, stats.js Anda yang lama)
app.get('/api/data', async (req, res) => {
    try {
        // Ambil data terbaru dari DB (contoh: 100 data terakhir)
        const [rows] = await db.promise().query(
            `SELECT * FROM ${NAMA_TABEL} ORDER BY id DESC LIMIT 100`
        );
        res.json({ ok: true, data: rows });
    } catch (err) {
        console.error('Gagal query data:', err.message);
        res.status(500).json({ ok: false, error: 'database error' });
    }
});
// API untuk export CSV (menggantikan export_all_excel.php)
app.get('/api/export/csv', async (req, res) => {
  try {
    // 1. Ambil SEMUA data dari database
    // Hati-hati jika data sangat besar, mungkin perlu dibatasi
    const [rows] = await db.promise().query(
      `SELECT * FROM ${NAMA_TABEL} ORDER BY id DESC`
    );

    if (rows.length === 0) {
      return res.status(404).send('Tidak ada data untuk diexport.');
    }

    // 2. Tentukan header CSV
    const headers = Object.keys(rows[0]);
    let csvContent = headers.join(',') + '\n'; // "id,volt,ampere,..."

    // 3. Ubah data JSON menjadi baris CSV
    rows.forEach(row => {
      // Ambil nilai sesuai urutan header dan gabungkan dengan koma
      const values = headers.map(header => {
        let val = row[header];
        // Pastikan nilai string yang mengandung koma dibungkus tanda kutip
        if (typeof val === 'string' && val.includes(',')) {
          return `"${val}"`;
        }
        return val;
      });
      csvContent += values.join(',') + '\n';
    });

    // 4. Kirim file sebagai respons
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="export_data.csv"');
    res.status(200).send(csvContent);

  } catch (err) {
    console.error('Gagal export CSV:', err.message);
    res.status(500).json({ ok: false, error: 'database error' });
  }
});
app.post('/api/threshold', (req, res) => {
  // 1. Ambil nilai dari body request (dikirim oleh JavaScript browser)
  const { value } = req.body;
  
  // 2. Validasi nilai
  const thresholdValue = parseFloat(value);
  if (isNaN(thresholdValue) || thresholdValue <= 0) {
    console.error(`[API /api/threshold] Nilai tidak valid diterima: ${value}`);
    return res.status(400).json({ ok: false, error: 'Nilai threshold harus angka positif.' });
  }

  // 3. Buat perintah serial untuk ESP32
  //    Gunakan toFixed(1) untuk mengirim 1 angka desimal, sesuaikan jika perlu
  const command = `THRESHOLD=${thresholdValue.toFixed(1)}\n`; 

  // 4. Kirim perintah ke Serial ESP32
  port.write(command, (err) => {
    if (err) {
      console.error('❌ Gagal kirim perintah THRESHOLD:', err.message);
      return res.status(500).json({ ok: false, error: 'Gagal mengirim perintah ke ESP32.' });
    }
    
    // 5. Kirim respons sukses ke browser
    console.log(`[API /api/threshold] -> Perintah terkirim: ${command.trim()}`);
    res.json({ ok: true, threshold: thresholdValue });
  });
});

// --- 7. Jalankan Server ---
// DIUBAH: Gunakan 'server.listen' BUKAN 'app.listen'
server.listen(WEB_SERVER_PORT, () => {
  console.log(`✅ Web Server (HTTP + WebSocket) berjalan di http://localhost:${WEB_SERVER_PORT}`);
  console.log('Hentikan XAMPP, buka URL di atas di browser Anda.');
});