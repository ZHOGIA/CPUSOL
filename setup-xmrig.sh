#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_DIR="/opt/xmrig"
CONFIG_DIR="/etc/xmrig"
SERVICE_NAME="xmrig"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
CONFIG_FILE="${CONFIG_DIR}/config.json"
XMRIG_USER="xmrig"
DEFAULT_POOL="${POOL_URL:-pool.hashvault.pro:443}"
DEFAULT_THREADS="${CPU_THREADS_HINT:-75}"

log() {
  printf '[xmrig-setup] %s\n' "$*"
}

fail() {
  printf '[xmrig-setup] ERROR: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  rm -f "${CONFIG_FILE}.tmp" "${SERVICE_FILE}.tmp"
}
trap cleanup EXIT

[[ "${EUID}" -eq 0 ]] || fail "Jalankan sebagai root, misalnya: sudo bash setup-xmrig.sh"

command -v apt-get >/dev/null 2>&1 ||
  fail "Script ini membutuhkan Ubuntu/Debian dengan apt-get."
command -v systemctl >/dev/null 2>&1 ||
  fail "systemd tidak ditemukan pada VPS ini."

read -r -p "Alamat wallet XMR publik (private key JANGAN dimasukkan): " XMR_WALLET
[[ "${XMR_WALLET}" =~ ^[48][1-9A-HJ-NP-Za-km-z]{90,110}$ ]] ||
  fail "Format wallet XMR terlihat tidak valid."

read -r -p "Pool [${DEFAULT_POOL}]: " POOL_URL
POOL_URL="${POOL_URL:-${DEFAULT_POOL}}"
[[ "${POOL_URL}" =~ ^[^[:space:]/]+:[0-9]{1,5}$ ]] ||
  fail "Pool harus berbentuk hostname:port, contoh pool.hashvault.pro:443."

read -r -p "Nama worker [$(hostname -s)]: " WORKER_NAME
WORKER_NAME="${WORKER_NAME:-$(hostname -s)}"
[[ "${WORKER_NAME}" =~ ^[A-Za-z0-9._-]{1,64}$ ]] ||
  fail "Nama worker hanya boleh berisi huruf, angka, titik, garis bawah, dan tanda minus."

read -r -p "Batas CPU dalam persen [${DEFAULT_THREADS}]: " CPU_THREADS_HINT_INPUT
CPU_THREADS_HINT_INPUT="${CPU_THREADS_HINT_INPUT:-${DEFAULT_THREADS}}"
[[ "${CPU_THREADS_HINT_INPUT}" =~ ^[1-9][0-9]?$|^100$ ]] ||
  fail "Batas CPU harus berupa angka 1 sampai 100."

printf '\nKonfigurasi yang akan dipakai:\n'
printf '  Wallet : %s...%s\n' "${XMR_WALLET:0:8}" "${XMR_WALLET: -8}"
printf '  Pool   : %s\n' "${POOL_URL}"
printf '  Worker : %s\n' "${WORKER_NAME}"
printf '  CPU    : %s%%\n\n' "${CPU_THREADS_HINT_INPUT}"
read -r -p "Lanjutkan instalasi dan mulai mining sekarang? [y/N] " CONFIRM
[[ "${CONFIRM}" =~ ^[Yy]$ ]] || fail "Instalasi dibatalkan."

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl tar

ARCH="$(uname -m)"
[[ "${ARCH}" == "x86_64" || "${ARCH}" == "amd64" ]] ||
  fail "Build binary otomatis ini hanya mendukung Linux x86_64. Arsitektur terdeteksi: ${ARCH}"

DOWNLOAD_URL="${XMRIG_DOWNLOAD_URL:-}"
if [[ -z "${DOWNLOAD_URL}" ]]; then
  log "Mencari rilis XMRig terbaru dari GitHub..."
  RELEASE_JSON="$(curl --fail --silent --show-error --location \
    --connect-timeout 15 --max-time 60 \
    https://api.github.com/repos/xmrig/xmrig/releases/latest)"
  DOWNLOAD_URL="$(printf '%s\n' "${RELEASE_JSON}" |
    sed -n 's/.*"browser_download_url":[[:space:]]*"\([^"]*linux-static-x64\.tar\.gz\)".*/\1/p' |
    head -n 1)"
fi
[[ -n "${DOWNLOAD_URL}" ]] ||
  fail "URL rilis XMRig tidak ditemukan. Set XMRIG_DOWNLOAD_URL lalu jalankan ulang."

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"; cleanup' EXIT
ARCHIVE="${TMP_DIR}/xmrig.tar.gz"
log "Mengunduh XMRig dari ${DOWNLOAD_URL}"
curl --fail --silent --show-error --location --connect-timeout 15 --max-time 300 \
  "${DOWNLOAD_URL}" -o "${ARCHIVE}"

rm -rf "${TMP_DIR}/unpacked"
mkdir -p "${TMP_DIR}/unpacked"
tar -xzf "${ARCHIVE}" -C "${TMP_DIR}/unpacked"
XMRIG_BINARY="$(find "${TMP_DIR}/unpacked" -type f -name xmrig -perm -u+x -print -quit)"
[[ -n "${XMRIG_BINARY}" ]] || fail "Binary xmrig tidak ditemukan di dalam arsip."

if ! id -u "${XMRIG_USER}" >/dev/null 2>&1; then
  useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin "${XMRIG_USER}"
fi

install -d -m 0755 "${INSTALL_DIR}" "${CONFIG_DIR}"
install -m 0755 "${XMRIG_BINARY}" "${INSTALL_DIR}/xmrig"

cat > "${CONFIG_FILE}.tmp" <<EOF
{
  "autosave": false,
  "background": false,
  "colors": false,
  "donate-level": 1,
  "cpu": {
    "enabled": true,
    "max-threads-hint": ${CPU_THREADS_HINT_INPUT},
    "huge-pages": true
  },
  "pools": [
    {
      "url": "${POOL_URL}",
      "user": "${XMR_WALLET}",
      "pass": "${WORKER_NAME}",
      "keepalive": true,
      "tls": true
    }
  ]
}
EOF
install -o root -g "${XMRIG_USER}" -m 0640 "${CONFIG_FILE}.tmp" "${CONFIG_FILE}"

cat > "${SERVICE_FILE}.tmp" <<EOF
[Unit]
Description=XMRig CPU miner
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=${XMRIG_USER}
Group=${XMRIG_USER}
ExecStart=${INSTALL_DIR}/xmrig --config=${CONFIG_FILE} --no-color
Restart=on-failure
RestartSec=10
Nice=10
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
EOF
install -o root -g root -m 0644 "${SERVICE_FILE}.tmp" "${SERVICE_FILE}"

systemctl daemon-reload
systemctl enable --now "${SERVICE_NAME}.service"

log "Selesai. Status service:"
systemctl --no-pager --full status "${SERVICE_NAME}.service" || true
printf '\nPerintah berguna:\n'
printf '  sudo systemctl status %s\n' "${SERVICE_NAME}"
printf '  sudo journalctl -u %s -f\n' "${SERVICE_NAME}"
printf '  sudo systemctl stop %s\n' "${SERVICE_NAME}"
