'use strict';

const { chromium } = require('playwright');

const WEBMINER_URL = process.env.WEBMINER_URL || 'https://xmr.cpucoinsol.app/#webminer';
const SOLANA_WALLET = (process.env.SOLANA_WALLET || '').trim();
const PUBLIC_USERNAME = (process.env.PUBLIC_USERNAME || '').trim();
const WORKLOAD = Number(process.env.WORKLOAD || 75);
const DURATION_MINUTES = Number(process.env.DURATION_MINUTES || 0);
const BROWSER_EXECUTABLE_PATH = (process.env.BROWSER_EXECUTABLE_PATH || '').trim();
const STATUS_INTERVAL_MS = 10_000;
const CONFIRM_FLAG = '--confirm';

function fail(message) {
  console.error(`[webminer] ERROR: ${message}`);
  process.exitCode = 1;
}

function isValidSolanaAddress(value) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return false;

  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let decoded = 0n;
  for (const character of value) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) return false;
    decoded = decoded * 58n + BigInt(digit);
  }

  let byteLength = (value.match(/^1*/) || [''])[0].length;
  while (decoded > 0n) {
    byteLength += 1;
    decoded >>= 8n;
  }
  return byteLength === 32;
}

function validateConfiguration() {
  if (!process.argv.includes(CONFIRM_FLAG)) {
    fail(`Mining tidak dimulai tanpa persetujuan eksplisit. Jalankan kembali dengan ${CONFIRM_FLAG}.`);
    return false;
  }
  if (!isValidSolanaAddress(SOLANA_WALLET)) {
    fail('SOLANA_WALLET harus berisi alamat publik Solana yang valid. Jangan masukkan private key atau seed phrase.');
    return false;
  }
  if (PUBLIC_USERNAME && !/^[A-Za-z0-9_-]{3,24}$/.test(PUBLIC_USERNAME)) {
    fail('PUBLIC_USERNAME harus 3-24 karakter: huruf, angka, underscore, atau tanda minus.');
    return false;
  }
  if (!Number.isInteger(WORKLOAD) || WORKLOAD < 1 || WORKLOAD > 100) {
    fail('WORKLOAD harus berupa angka bulat 1 sampai 100.');
    return false;
  }
  if (!Number.isFinite(DURATION_MINUTES) || DURATION_MINUTES < 0) {
    fail('DURATION_MINUTES harus 0 atau angka positif.');
    return false;
  }
  return true;
}

async function readMinerState(page) {
  return page.evaluate(() => ({
    status: document.querySelector('#browserMinerStatus')?.textContent?.trim() || '',
    hashrate: document.querySelector('#browserHashrate')?.textContent?.trim() || '',
    shares: document.querySelector('#browserShares')?.textContent?.trim() || '',
    stopVisible: !document.querySelector('#browserStop')?.hidden,
  }));
}

async function readStartDiagnostics(page) {
  return page.evaluate(() => {
    const start = document.querySelector('#browserStart');
    const solana = document.querySelector('#browserSol');
    const username = document.querySelector('#browserUsername');
    const consent = document.querySelector('#browserConsent');
    const workload = document.querySelector('#browserWorkload');
    const config = window.CPU_MINER_CONFIG || {};
    const launch = config.launch || {};

    let planError = '';
    let plan = null;
    try {
      if (window.RandomXEmbed && typeof window.RandomXEmbed.plan === 'function') {
        plan = window.RandomXEmbed.plan({
          wallet: config.projectXmrWallet,
          pool: config.poolHost,
          port: config.poolPort,
          proxy: config.bridgeUrl,
          workerName: 'diagnostic',
          mode: 'light',
          replicas: 0,
          workload: Number(workload?.value || 0),
          headless: true,
          memoryCap: 2,
        });
      }
    } catch (error) {
      planError = error.message || String(error);
    }

    return {
      startDisabled: Boolean(start?.disabled),
      status: document.querySelector('#browserMinerStatus')?.textContent?.trim() || '',
      cpuPlan: document.querySelector('#browserCPUPlan')?.textContent?.trim() || '',
      randomXLoaded: Boolean(window.RandomXEmbed),
      planThreads: plan?.threads ?? null,
      planError,
      launchLive: launch.tokenLive === true && launch.payoutsLive === true,
      bridgeUrl: config.bridgeUrl || '',
      solanaLength: solana?.value?.trim().length || 0,
      username: username?.value?.trim() || '',
      consentChecked: Boolean(consent?.checked),
      workload: workload?.value || '',
    };
  });
}

async function run() {
  if (!validateConfiguration()) return;

  console.log(`[webminer] URL: ${WEBMINER_URL}`);
  console.log(`[webminer] Solana wallet: ${SOLANA_WALLET}`);
  console.log(`[webminer] Public username: ${PUBLIC_USERNAME || '(kosong)'}`);
  console.log(`[webminer] Workload: ${WORKLOAD}%`);
  console.log('[webminer] Membuka browser headless. Hentikan dengan Ctrl+C.');

  const browser = await chromium.launch({
    headless: true,
    ...(BROWSER_EXECUTABLE_PATH ? { executablePath: BROWSER_EXECUTABLE_PATH } : {}),
  });
  const page = await browser.newPage();
  let shuttingDown = false;
  let statusTimer;

  page.on('pageerror', error => {
    console.error(`[webminer] Page error: ${error.message}`);
  });

  const shutdown = async (reason) => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (statusTimer) clearInterval(statusTimer);
    console.log(`[webminer] Menghentikan mining (${reason}).`);
    try {
      const stop = page.locator('#browserStop');
      if (await stop.isVisible()) {
        await stop.click();
        await page.waitForTimeout(1000);
      }
    } finally {
      await browser.close();
    }
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT').finally(() => process.exit(0));
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM').finally(() => process.exit(0));
  });

  await page.goto(WEBMINER_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.locator('#browserSol').waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('#browserSol').fill(SOLANA_WALLET);

  const username = page.locator('#browserUsername');
  if (await username.count()) {
    await username.fill(PUBLIC_USERNAME);
  }

  const workload = page.locator('#browserWorkload');
  if (await workload.count()) {
    await workload.fill(String(WORKLOAD));
  }

  await page.locator('#browserConsent').check();

  const start = page.locator('#browserStart');
  try {
    await page.waitForFunction(
      () => {
        const button = document.querySelector('#browserStart');
        return button && !button.disabled;
      },
      undefined,
      { timeout: 60_000 },
    );
  } catch (error) {
    const diagnostics = await readStartDiagnostics(page);
    throw new Error(
      `${error.message} Start masih disabled. Diagnostik: ${JSON.stringify(diagnostics)}`,
    );
  }

  await start.click();
  await page.waitForTimeout(3000);

  const initialState = await readMinerState(page);
  console.log(`[webminer] Status: ${initialState.status || '(tidak tersedia)'}`);
  console.log(`[webminer] Hashrate: ${initialState.hashrate || '(menunggu)'}`);
  console.log(`[webminer] Shares: ${initialState.shares || '(menunggu)'}`);

  statusTimer = setInterval(async () => {
    if (shuttingDown) return;
    try {
      const state = await readMinerState(page);
      console.log(`[webminer] ${new Date().toISOString()} | ${state.status} | ${state.hashrate} | ${state.shares}`);
      if (!state.stopVisible && /stopped|error|unavailable/i.test(state.status)) {
        await shutdown(`status halaman: ${state.status}`);
      }
    } catch (error) {
      console.error(`[webminer] Gagal membaca status miner: ${error.message}`);
    }
  }, STATUS_INTERVAL_MS);

  if (DURATION_MINUTES > 0) {
    setTimeout(() => {
      void shutdown(`${DURATION_MINUTES} menit tercapai`).finally(() => process.exit(0));
    }, DURATION_MINUTES * 60_000);
  }

  await new Promise(() => {});
}

run().catch(error => {
  console.error(`[webminer] Gagal menjalankan miner: ${error.stack || error.message}`);
  process.exitCode = 1;
});
