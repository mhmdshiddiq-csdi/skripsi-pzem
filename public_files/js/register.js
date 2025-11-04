// public_files/register.js

document.addEventListener('DOMContentLoaded', () => {
    const registerForm = document.getElementById('register-form');
    const errorAlert = document.getElementById('error-alert');
    const successAlert = document.getElementById('success-alert');
    const registerButton = document.getElementById('register-button');

    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault(); // Mencegah form refresh halaman
        
        const name = document.getElementById('name').value;
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const confirmPassword = document.getElementById('confirm-password').value;
        console.log(name, email, password, confirmPassword);
        // Sembunyikan pesan lama
        errorAlert.classList.add('d-none');
        successAlert.classList.add('d-none');

        // --- Validasi Sisi Klien ---
        if (password !== confirmPassword) {
            showError('Password dan konfirmasi password tidak cocok.');
            return;
        }
        if (password.length < 6) {
            showError('Password minimal harus 6 karakter.');
            return;
        }
        // -----------------------------

        setLoading(true);

        try {
            const res = await fetch('/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email, password })
            });

            const data = await res.json();

            if (res.ok && data.ok) {
                // --- SUKSES ---
                showSuccess(data.message + " Anda akan diarahkan ke halaman login.");
                // Reset form
                registerForm.reset();
                // Redirect ke login setelah 2 detik
                setTimeout(() => {
                    window.location.href = '/login';
                }, 2000);
            } else {
                // --- GAGAL (misal: email duplikat) ---
                throw new Error(data.error || 'Terjadi kesalahan');
            }
        } catch (err) {
            showError(err.message);
            setLoading(false);
            console.error('Error saat registrasi:', err);
        }
    });

    function showError(message) {
        errorAlert.textContent = message;
        errorAlert.classList.remove('d-none');
    }

    function showSuccess(message) {
        successAlert.textContent = message;
        successAlert.classList.remove('d-none');
    }

    function setLoading(isLoading) {
        registerButton.disabled = isLoading;
        registerButton.textContent = isLoading ? 'Loading...' : 'Register';
    }
});