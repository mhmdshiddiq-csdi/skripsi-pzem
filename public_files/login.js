// (public_files/login.js)
document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const errorAlert = document.getElementById('error-alert');
    const loginButton = document.getElementById('login-button');

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault(); // Hentikan submit form standar
        
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;

        // Tampilkan status loading
        errorAlert.classList.add('d-none');
        loginButton.disabled = true;
        loginButton.textContent = 'Loading...';

        try {
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email, password })
            });

            const data = await res.json();

            if (res.ok && data.ok) {
                // --- SUKSES ---
                // Server sudah mengatur cookie. Redirect ke halaman utama
                window.location.href = '/'; // Redirect ke dashboard
            } else {
                // --- GAGAL ---
                throw new Error(data.error || 'Terjadi kesalahan');
            }
        } catch (err) {
            errorAlert.textContent = err.message;
            errorAlert.classList.remove('d-none');
            loginButton.disabled = false;
            loginButton.textContent = 'Login';
        }
    });
});