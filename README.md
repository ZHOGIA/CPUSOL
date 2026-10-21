# XMRig VPS setup

Paket ini berisi dua pilihan:

1. `setup-xmrig.sh` untuk mining XMR langsung ke wallet XMR Anda.
2. `webminer-headless.js` untuk menjalankan webminer yang sama melalui Chromium
   headless dengan wallet Solana sebagai identitas worker.

Pilihan kedua diperlukan jika payout harus tetap dihitung oleh backend website.
Alamat Solana pada webminer bukan wallet XMR pool; webminer menggunakannya
sebagai `workerName`/label dan mengirim pekerjaan ke wallet XMR project melalui
bridge website.

## Instalasi

Salin folder ini ke VPS Ubuntu/Debian milik Anda, lalu jalankan:

```bash
chmod +x setup-xmrig.sh
sudo ./setup-xmrig.sh
```

Installer akan meminta:

- alamat wallet XMR publik;
- alamat pool dan port;
- nama worker;
- batas penggunaan CPU.

Private key, seed phrase, dan password wallet tidak diperlukan dan jangan
dimasukkan ke script.

## Operasi service

```bash
sudo systemctl status xmrig
sudo journalctl -u xmrig -f
sudo systemctl restart xmrig
sudo systemctl stop xmrig
sudo systemctl disable xmrig
```

Konfigurasi yang dihasilkan berada di `/etc/xmrig/config.json`, sedangkan
binary berada di `/opt/xmrig/xmrig`.

Pastikan provider VPS mengizinkan cryptocurrency mining. Instalasi ini
memerlukan persetujuan interaktif dan tidak menyamarkan proses mining.

## Webminer headless dengan Node.js

Pilihan ini memerlukan Node.js 20 atau lebih baru. Jalankan sebagai user VPS
biasa, bukan sebagai `root` dan bukan dengan `sudo`.

Setelah file `package.json` dan `webminer-headless.js` disalin ke VPS:

```bash
mkdir -p ~/cpucoinsol
cd ~/cpucoinsol
npm install --omit=dev
```

Gunakan browser Playwright lokal di folder project. Pengaturan `0` mencegah
Playwright mencoba menggunakan cache `/root/.cache/ms-playwright`:

```bash
cd ~/cpucoinsol
export PLAYWRIGHT_BROWSERS_PATH=0
npx playwright install chromium
```

Jalankan webminer:

```bash
cd ~/cpucoinsol
export PLAYWRIGHT_BROWSERS_PATH=0
export SOLANA_WALLET="ALAMAT_SOLANA_ANDA"
export PUBLIC_USERNAME="worker-vps-1"
export WORKLOAD=75
npm run webminer
```

Atau jalankan dalam satu perintah:

```bash
cd ~/cpucoinsol && \
PLAYWRIGHT_BROWSERS_PATH=0 \
SOLANA_WALLET="ALAMAT_SOLANA_ANDA" \
PUBLIC_USERNAME="worker-vps-1" \
WORKLOAD=75 \
npm run webminer
```

Jika server sudah memiliki Chromium atau Google Chrome, Anda dapat
menjalankan browser tersebut tanpa instalasi browser Playwright:

```bash
cd ~/cpucoinsol
export PLAYWRIGHT_BROWSERS_PATH=0
BROWSER_EXECUTABLE_PATH="/usr/bin/chromium" \
SOLANA_WALLET="ALAMAT_SOLANA_ANDA" \
PUBLIC_USERNAME="worker-vps-1" \
npm run webminer
```

Script mewajibkan flag `--confirm` dari script npm sebelum mining dimulai.
`PUBLIC_USERNAME` adalah label publik opsional (3-24 karakter). Wallet Solana
tetap dipakai sebagai identitas accounting sesuai mekanisme website.

Untuk membatasi durasi, gunakan `DURATION_MINUTES`:

```bash
SOLANA_WALLET="ALAMAT_SOLANA_ANDA" \
PUBLIC_USERNAME="worker-vps-1" \
DURATION_MINUTES=60 \
npm run webminer
```

Hentikan proses dengan `Ctrl+C`. Script akan menekan tombol Stop pada webminer
sebelum menutup browser. Payout token tetap bergantung pada backend website,
bridge, aturan campaign, dan ketersediaan URL tersebut.

### Troubleshooting permission browser

Jika muncul error seperti:

```text
EACCES: permission denied, mkdir '/root/.cache/ms-playwright'
```

pastikan proses berjalan sebagai user biasa dan ulangi instalasi browser dengan
cache lokal project:

```bash
cd ~/cpucoinsol
unset PLAYWRIGHT_BROWSERS_PATH
export PLAYWRIGHT_BROWSERS_PATH=0
npx playwright install chromium
```

Jika Chromium gagal karena library sistem seperti `libglib-2.0.so.0` tidak
ditemukan, library tersebut harus disediakan oleh administrator/provider VPS.
Tanpa akses root, gunakan Chromium yang sudah terpasang dengan
`BROWSER_EXECUTABLE_PATH`.

### Troubleshooting tombol Start tetap disabled

Jika muncul:

```text
Timeout 60000ms exceeded. Start masih disabled. Diagnostik: {...}
```

script sudah mencetak penyebab yang perlu diperiksa, termasuk
`randomXLoaded`, `planThreads`, `planError`, `launchLive`, dan panjang alamat
Solana. `planThreads` harus lebih besar dari `0`, `randomXLoaded` harus `true`,
dan `launchLive` harus `true`. Jika `planError` terisi, kirim nilai tersebut
bersama output diagnostik saat meminta bantuan.
