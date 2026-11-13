process.env.REBROWSER_PATCHES_RUNTIME_FIX_MODE = 'addBinding';
let puppeteer;
try {
  puppeteer = require('rebrowser-puppeteer-core');
} catch (_) {
  puppeteer = require('puppeteer-core');
}

const CLOAK_TARGET_FILTER = (t) => {
  try {
    const type = typeof t.type === 'function' ? t.type() : (t && t._targetInfo && t._targetInfo.type ? t._targetInfo.type : '');
    const url = typeof t.url === 'function' ? String(t.url() || '') : (t && t._targetInfo && t._targetInfo.url ? String(t._targetInfo.url || '') : '');
    if (type === 'other' || type === 'service_worker' || type === 'shared_worker' || type === 'worker') return false;
    if (url.includes('/static_resources/webworker') || url.startsWith('devtools://')) return false;
  } catch (_) { }
  return true;
};

if (puppeteer && typeof puppeteer.connect === 'function' && !puppeteer._cloakTargetFilterPatched) {
  const _origPuppeteerConnect = puppeteer.connect.bind(puppeteer);
  puppeteer.connect = function patchedPuppeteerConnect(options = {}) {
    return _origPuppeteerConnect({
      targetFilter: CLOAK_TARGET_FILTER,
      ...options
    });
  };
  puppeteer._cloakTargetFilterPatched = true;
}
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFileSync, execFile, spawn } = require('child_process');
let MultiZenService = null;
try {
  MultiZenService = require('./multizen');
} catch (_) { }

const DEFAULT_MCP_URL = 'https://v5api.incogniton.com/mcp';
const LOCAL_INCOGNITON_URL = 'http://127.0.0.1:35000';
const INCOGNITON_APPDATA_DIR = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'Incogniton',
  'Incogniton'
);
const INCOGNITON_SYSTEM_INFO = JSON.stringify({
  processorIdentifier: 'AMD Ryzen 5 5500                               \n 1 physical CPU package(s)\n 6 physical CPU core(s)\n 12 logical CPU(s)\nIdentifier: AuthenticAMD Family 25 Model 80 Stepping 0\nProcessorID: 178BFBFF00A50F00\nMicroarchitecture: Zen 3',
  vendor: 'Microsoft',
  processors: 12,
  mac: {
    'Realtek PCIe GbE Family Controller-QoS Packet Scheduler-0000': '00:1A:2B:3C:4D:01',
    'Remote NDIS based Internet Sharing Device #2': '00:1A:2B:3C:4D:02',
    'Realtek PCIe GbE Family Controller-WFP Native MAC Layer LightWeight Filter-0000': '00:1A:2B:3C:4D:01',
    'Realtek 8812CU Wireless LAN 802.11ac USB NIC': '00:1A:2B:3C:4D:03',
    'Realtek PCIe GbE Family Controller-WFP 802.3 MAC Layer LightWeight Filter-0000': '00:1A:2B:3C:4D:01',
    'Remote NDIS based Internet Sharing Device': '00:1A:2B:3C:4D:04',
    'Realtek PCIe GbE Family Controller': '00:1A:2B:3C:4D:01',
    'Microsoft Wi-Fi Direct Virtual Adapter': '00:1A:2B:3C:4D:05',
    'Microsoft Wi-Fi Direct Virtual Adapter #2': '00:1A:2B:3C:4D:03'
  },
  macHash: 1640258857,
  processorSerialNumber: 'None'
});
const MATRIX_PROFILE_UUID = '00000000-0000-0000-0000-000000000004';

// Perfil Matriz agora LIBERADO para automação a pedido do usuário
const BLOCKED_PROFILE_IDS = new Set([]);

// Perfis enterrados no Cemitério 001 (UFAC / Desativados — JAMAIS são abertos pelo robô)
const GRAVEYARD_PROFILE_IDS = new Set([
  '00000000-0000-0000-0000-000000000001', // PERFIL 01 (Operador Padrao - UFAC 21/10/2026 - Cemitério 001)
  '00000000-0000-0000-0000-000000000005', // Operador Padrao (Conta #4 - Cemitério 001)
  '00000000-0000-0000-0000-000000000006'  // Operador Padrao (Conta #5 - Cemitério 001)
]);

// Perfis em CHECKPOINT (JAMAIS podem ter abas ou o navegador fechados pelo robô!)
const CHECKPOINT_PROFILE_IDS = new Set([
  '00000000-0000-0000-0000-000000000001', // PERFIL 01 (Operador Padrao - Cemitério 001)
  '00000000-0000-0000-0000-000000000005', // Operador Padrao (Conta #4 - Cemitério 001)
  '00000000-0000-0000-0000-000000000006'  // Operador Padrao (Conta #5 - Cemitério 001)
]);

const KNOWN_WORKER_PROFILE_IDS = [
  '00000000-0000-0000-0000-000000000001', // PERFIL 01 (Conta B - Operador Padrao [CEMITÉRIO])
  '00000000-0000-0000-0000-000000000002', // PERFIL 02 (Conta C - Operador Padrao)
  '00000000-0000-0000-0000-000000000003', // PERFIL 03 (Reserva)
  '00000000-0000-0000-0000-000000000004'  // PERFIL 04 (Conta MATRIZ)
];

// EXCLUSIVIDADE 100% IP FIXO RESIDENCIAL: APENAS A CONTA MATRIZ (PERFIL 04 - 00000000-0000-0000-0000-000000000004)
// tem permissão para rodar em DIRECT_RESIDENTIAL / FIXED_WIFI!
// Todas as outras contas — incluindo PERFIL 02 (Conta C - Operador Padrao: 00000000-0000-0000-0000-000000000002) —
// rodam 100% isoladas no Proxy 4G Móvel (127.0.0.1:8080 • 4G_ROTATING / 4G_REQUIRED) com rotação obrigatória!
const FIXED_IP_LEGACY_PROFILE_IDS = new Set([
  '00000000-0000-0000-0000-000000000004'
]);

let _cachedPipelineAccountsMap = null;
let _cachedPipelineAccountsAt = 0;

function isLegacyFixedIpProfile(profileOrId) {
  const clean = String(profileOrId || '').trim().toLowerCase();
  if (!clean) return false;
  // Bloqueio explícito: PERFIL 02 (Conta C - 00000002) JAMAIS pode usar IP fixo residencial!
  if (
    clean === '00000000-0000-0000-0000-000000000002' ||
    clean === 'conta-c' ||
    clean === 'acc_contac_perfil02'
  ) {
    return false;
  }
  // Exclusividade absoluta da Matriz (PERFIL 04 - Conta A) no IP Fixo Residencial
  if (
    clean === '00000000-0000-0000-0000-000000000004' ||
    clean === 'conta-a' ||
    clean === 'conta-matriz' ||
    clean === 'acc_matriz_perfil04'
  ) {
    return true;
  }
  return FIXED_IP_LEGACY_PROFILE_IDS.has(clean);
}

let cachedDirectPcIp = process.env.MATRIX_FIXED_IP || '';
let cachedDirectPcIpAt = 0;
let _directPcIpRefreshing = false;

function getActiveNotebookLanIpv4() {
  try {
    const nets = os.networkInterfaces();
    for (const [name, list] of Object.entries(nets || {})) {
      if (/loopback|vmware|virtualbox|wsl|vethernet|tap|tun|vpn/i.test(name)) continue;
      for (const addr of (list || [])) {
        if (addr && (addr.family === 'IPv4' || addr.family === 4) && !addr.internal && addr.address) {
          if (addr.address.startsWith('192.168.') || addr.address.startsWith('10.') || /^172\.(1[6-9]|2\d|3[01])\./.test(addr.address)) {
            return addr.address;
          }
        }
      }
    }
  } catch (_) { }
  return '';
}

function buildDirectCurlIpifyArgs(maxTimeSec) {
  const lanIp = getActiveNotebookLanIpv4();
  const base = ['-s', '--max-time', String(maxTimeSec), '--noproxy', '*'];
  if (lanIp) base.push('--interface', lanIp);
  base.push('https://api.ipify.org?format=json');
  return base;
}

function refreshDirectPcEthernetIpAsync() {
  if (_directPcIpRefreshing) return;
  _directPcIpRefreshing = true;
  execFile(
    'curl.exe',
    buildDirectCurlIpifyArgs(3),
    { encoding: 'utf8', timeout: 3500, windowsHide: true },
    (err, stdout) => {
      _directPcIpRefreshing = false;
      cachedDirectPcIpAt = Date.now();
      if (!err && stdout) {
        try {
          const parsed = JSON.parse(stdout);
          if (parsed && parsed.ip) {
            cachedDirectPcIp = String(parsed.ip).trim();
          }
        } catch (_) { }
      }
    }
  );
}

function getDirectPcEthernetIpSync(allowBlockingInit = true) {
  const now = Date.now();
  if (now - cachedDirectPcIpAt > 120000) {
    if (allowBlockingInit && cachedDirectPcIpAt === 0) {
      try {
        const raw = execFileSync(
          'curl.exe',
          buildDirectCurlIpifyArgs(2),
          { encoding: 'utf8', timeout: 2500, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }
        );
        const parsed = JSON.parse(raw);
        if (parsed && parsed.ip) {
          cachedDirectPcIp = String(parsed.ip).trim();
        }
        cachedDirectPcIpAt = now;
      } catch (_) {
        cachedDirectPcIpAt = now;
      }
    } else {
      refreshDirectPcEthernetIpAsync();
    }
  }
  return cachedDirectPcIp;
}

function isResidentialFixedIp(ipInfo) {
  if (!ipInfo || (!ipInfo.ip && !ipInfo.ipv6)) return false;
  const ip = String(ipInfo.ip || '').trim();
  const ipv6 = String(ipInfo.ipv6 || '').trim().toLowerCase();
  const directPcIp = getDirectPcEthernetIpSync();

  // Se o IP veio comprovadamente pelo túnel 4G ADB (127.0.0.1:8080) e é DIFERENTE do IP fixo direto do PC,
  // NUNCA é IP residencial fixo (mesmo que a operadora móvel seja Algar Telecom no chip 4G)!
  if (ipInfo.tunnel_mode === 'ADB_FORWARD_PROXY' || ipInfo.proxy_url?.includes(':8080')) {
    if (directPcIp && ip === directPcIp) return true; // vazamento se o proxy retornar o mesmo IP direto do PC
    if (ip === '0.0.0.0' || ip === '0.0.0.0' || ip === '0.0.0.0' || ip === '0.0.0.0') return true;
    return false; // É 100% 4G móvel!
  }

  return (
    ip === '0.0.0.0' ||
    ip === '0.0.0.0' ||
    ip === '0.0.0.0' ||
    ip === '0.0.0.0' ||
    ip === '0.0.0.0' ||
    ip === '0.0.0.0' ||
    ip === '0.0.0.0' ||
    (directPcIp && ip === directPcIp) ||
    ipv6.startsWith('2001:db8:0000:') ||
    ipInfo.tunnel_mode === 'DIRECT_PC'
  );
}

const ACCOUNT_IP_LEDGER_FILE = path.join(__dirname, 'account_ip_ledger.json');

function findAdbBinary() {
  const candidates = [
    path.join(__dirname, 'platform-tools', 'adb.exe'),
    'adb',
    'C:\\platform-tools\\adb.exe'
  ];
  for (const cand of candidates) {
    try {
      execFileSync(cand, ['version'], { stdio: 'ignore', timeout: 2500 });
      return cand;
    } catch (_) { }
  }
  return path.join(__dirname, 'platform-tools', 'adb.exe');
}

const ADB_BIN = findAdbBinary();

function loadAccountIpLedger() {
  try {
    if (fs.existsSync(ACCOUNT_IP_LEDGER_FILE)) {
      return JSON.parse(fs.readFileSync(ACCOUNT_IP_LEDGER_FILE, 'utf8'));
    }
  } catch (_) { }
  const initial = {
    require_4g_rotation: true,
    last_active_profile_id: null,
    last_active_ip: null,
    last_rotated_at: null,
    by_profile: {},
    ip_history: []
  };
  try {
    fs.writeFileSync(ACCOUNT_IP_LEDGER_FILE, JSON.stringify(initial, null, 2), 'utf8');
  } catch (_) { }
  return initial;
}

function saveAccountIpLedger(ledger) {
  try {
    fs.writeFileSync(ACCOUNT_IP_LEDGER_FILE, JSON.stringify(ledger, null, 2), 'utf8');
  } catch (_) { }
}

const net = require('net');
// CRÍTICO NO WINDOWS COM SAMSUNG (PID_6860 Every Proxy) NO ADB 37.0.1:
// 1. ADB_USB_LEGACY=1 + ADB_LIBUSB=0 força o backend WinUSB clássico (AdbWinApi.dll), pois o libusb (adb_usb_connection.cpp:52) falha no Windows 11 24H2 com "terminated (data): No error".
// 2. ADB_BURST_MODE=0 desativa rajadas assíncronas sem A_OKAY no USB Bulk, evitando colisão half-duplex no controlador musb-hdrc da Samsung!
const _userHomeDir = os.homedir();
const _adbKeyFile = path.join(_userHomeDir, '.android', 'adbkey');
process.env.ADB_LIBUSB = '0';
process.env.ADB_USB_LEGACY = '1';
process.env.ADB_BURST_MODE = '0';
process.env.USERPROFILE = _userHomeDir;
process.env.HOME = _userHomeDir;
process.env.ANDROID_SDK_HOME = _userHomeDir;
if (fs.existsSync(_adbKeyFile)) {
  process.env.ADB_VENDOR_KEYS = _adbKeyFile;
}
const ADB_EXEC_ENV = {
  ...process.env,
  USERPROFILE: _userHomeDir,
  HOME: _userHomeDir,
  ANDROID_SDK_HOME: _userHomeDir,
  ...(fs.existsSync(_adbKeyFile) ? { ADB_VENDOR_KEYS: _adbKeyFile } : {}),
  ADB_LIBUSB: '0',
  ADB_USB_LEGACY: '1',
  ADB_BURST_MODE: '0'
};

let cachedAdbDevStatus = null;
let cachedAdbDevCheckAt = 0;
let _usb4gBridgeServer = null;

/**
 * Detecta em 0.01ms se existe uma placa USB RNDIS 4G (Ancoragem via USB do celular, ex: Ethernet 4 -> 10.x.x.x)
 * separada do cabo de rede fixo do PC (192.168.x).
 */
function findUsb4gLocalInterface() {
  try {
    const nets = os.networkInterfaces() || {};
    for (const [ifName, addrs] of Object.entries(nets)) {
      for (const a of (addrs || [])) {
        if (!a || a.internal) continue;
        const isV4 = a.family === 'IPv4' || a.family === 4;
        if (!isV4 || !a.address) continue;
        if (a.address.startsWith('192.168.') || a.address.startsWith('169.254.') || a.address.startsWith('127.')) continue;
        return { interface_name: ifName, address: a.address, mac: a.mac || '' };
      }
    }
  } catch (_) { }
  return null;
}

const { Worker } = require('worker_threads');
const ADB_4G_PROXY_PORT = 8080;
const ADB_UPSTREAM_PORT = 18080;
const ADB_PHONE_HEX_PORT = 8081;
const HEX_RELAY_JAR_LOCAL = path.join(__dirname, 'hex_relay.jar');
const HEX_RELAY_JAR_REMOTE = '/data/local/tmp/hex_relay.jar';
let _lastAdbSocketSpawnAt = 0;
let _adbHealPromise = null;
let _lastAdbKillServerAt = 0;
let _lastAdbForwardDirectCheckAt = 0;
let _lastPhoneHexRelayVerifiedAt = 0;
let _lastAdbForwardVerifiedAt = 0;
let _currentSessionProfileId = null;
let _lastUsbModeCheckedAt = 0;
let _lastWifiDisableCheckedAt = 0;
let _usb4gBridgeWorker = global.__globalUsb4gBridgeWorker || null;
try {
  require('./modules/infra_4g/ipv4_proxy_bridge').ensureIpv4ProxyBridgeRunning().catch(() => { });
} catch (_) { }

function startAdbServerDetachedSync() {
  try {
    const child = spawn(ADB_BIN, ['start-server'], {
      detached: true,
      stdio: 'ignore',
      env: ADB_EXEC_ENV,
      windowsHide: true
    });
    child.unref();
  } catch (_) { }
}

/**
 * Hard-reset de software do daemon adb.exe no Windows (equivalente a desplugar/plugar o cabo USB sem tocar no celular):
 * Mata qualquer adb.exe travado ("offline" / "unauthorized" / "kill-server rejected") e sobe um novo detached com ADB_USB_LEGACY=1.
 */
function hardResetAdbDaemonSync() {
  try {
    execFileSync('taskkill', ['/F', '/IM', 'adb.exe'], {
      timeout: 3000,
      stdio: 'ignore',
      windowsHide: true
    });
  } catch (_) { }
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  } catch (_) { }
  startAdbServerDetachedSync();
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1200);
  } catch (_) { }
}

function ensurePhoneHexRelayAndForwardSync(forceVerifyDaemon = false) {
  try {
    if (cachedAdbDevStatus && !cachedAdbDevStatus.adb_connected) {
      return false;
    }
    try {
      execFileSync(ADB_BIN, ['forward', `tcp:${ADB_UPSTREAM_PORT}`, `tcp:${ADB_PHONE_HEX_PORT}`], {
        timeout: 2500,
        env: ADB_EXEC_ENV,
        stdio: 'ignore',
        windowsHide: true
      });
    } catch (fwdErr) {
      if (cachedAdbDevStatus && !cachedAdbDevStatus.adb_connected) {
        return false;
      }
      startAdbServerDetachedSync();
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 750);
      execFileSync(ADB_BIN, ['forward', `tcp:${ADB_UPSTREAM_PORT}`, `tcp:${ADB_PHONE_HEX_PORT}`], {
        timeout: 2500,
        env: ADB_EXEC_ENV,
        stdio: 'ignore',
        windowsHide: true
      });
    }

    const now = Date.now();
    // Evita abrir canais `adb shell` a cada 45s enquanto o barramento USB Bulk está transmitindo vídeo (causa de transport_usb.cpp:137)
    if (forceVerifyDaemon && (now - _lastPhoneHexRelayVerifiedAt > 60000 || _lastPhoneHexRelayVerifiedAt === 0)) {
      try {
        const bgChild = spawn(ADB_BIN, [
          'shell',
          `settings put global stay_on_while_plugged_in 7; dumpsys deviceidle whitelist +com.gorillasoftware.everyproxy >/dev/null 2>&1; input keyevent KEYCODE_WAKEUP; wm dismiss-keyguard; am start -n com.gorillasoftware.everyproxy/.MainActivity >/dev/null 2>&1; (ps -A | grep -q dalvikvm64) || (ANDROID_DATA=/data/local/tmp /apex/com.android.art/bin/dalvikvm64 -Xusejit:false -cp ${HEX_RELAY_JAR_REMOTE} HexRelay >/data/local/tmp/hex.log 2>&1 </dev/null &)`
        ], {
          detached: true,
          stdio: 'ignore',
          env: ADB_EXEC_ENV,
          windowsHide: true
        });
        bgChild.unref();
      } catch (_) { }
      _lastPhoneHexRelayVerifiedAt = now;
    }
    return true;
  } catch (_) {
    return false;
  }
}

function spawnAsyncAdbForwardRestore() {
  const adbSt = getAdbDeviceStatus(false);
  if (!adbSt || !adbSt.adb_connected) return;
  try {
    const c = spawn(ADB_BIN, ['forward', `tcp:${ADB_UPSTREAM_PORT}`, `tcp:${ADB_PHONE_HEX_PORT}`], {
      detached: true,
      stdio: 'ignore',
      env: ADB_EXEC_ENV,
      windowsHide: true
    });
    c.unref();
  } catch (_) { }
}

/**
 * Auto-cura assíncrona em 3 ondas (t=0ms, t=550ms, t=1250ms):
 * Quando o USB da Samsung sofre micro-reset de transport_id (~370ms), o adb.exe limpa a tabela `adb forward`
 * somente no final do teardown (~400ms). Executar em 3 ondas garante que o forward `tcp:18080 -> tcp:8081`
 * seja recriado imediatamente após o novo transport_id assumir, sem deixar o Chrome offline!
 */
function healAdbUpstreamTunnelAsync() {
  const adbSt = getAdbDeviceStatus(false);
  if (!adbSt || !adbSt.adb_connected) return Promise.resolve();
  if (_adbHealPromise) return _adbHealPromise;
  const now = Date.now();
  if (now - _lastAdbKillServerAt < 900) return Promise.resolve();
  _lastAdbKillServerAt = now;
  _adbHealPromise = new Promise((resolve) => {
    try {
      spawnAsyncAdbForwardRestore();
      setTimeout(() => {
        spawnAsyncAdbForwardRestore();
      }, 550);
      setTimeout(() => {
        const ok = ensurePhoneHexRelayAndForwardSync(false);
        if (!ok) {
          hardResetAdbDaemonSync();
          ensurePhoneHexRelayAndForwardSync(true);
        }
        _adbHealPromise = null;
        resolve();
      }, 1250);
    } catch (_) {
      _adbHealPromise = null;
      resolve();
    }
  });
  return _adbHealPromise;
}

function flushIdleUpstreamSockets() {
  return 0;
}

/**
 * Garante o Worker Thread Bridge Hex-Encoded em 127.0.0.1:8080 -> 127.0.0.1:18080 (adb forward -> 8081 HexRelay -> 8080 Every Proxy).
 * Por que Hex-Encoded + Worker Thread + Watchdog 1.5s?
 * 1. Quando o USB da Samsung re-enumera o transport_id (~370ms), o adb.exe apaga o `adb forward tcp:18080 tcp:8081`.
 * 2. O Watchdog interno do Worker testa a porta 18080 a cada 1.5s e dispara `need_heal` até o forward voltar (< 600ms),
 *    enquanto `connectUpstreamWithRetry` segura os pacotes iniciais por até 12 tentativas (350ms cada) para o Chrome jamais ver "Você está offline"!
 */
function ensureLocalUsb4gBridgeProxy(port = ADB_4G_PROXY_PORT) {
  const adbSt = getAdbDeviceStatus(false);
  if (!adbSt || !adbSt.adb_connected) {
    return;
  }
  const now = Date.now();
  if (!_usb4gBridgeWorker) {
    try {
      ensurePhoneHexRelayAndForwardSync(true);
    } catch (_) { }
    const workerCode = `
      const net = require('net');
      const { parentPort, workerData } = require('worker_threads');
      const listenPort = workerData.listenPort || 8080;
      const upstreamPort = workerData.upstreamPort || 18080;

      // Watchdog Contínuo de Porta 18080 com limite de tentativas se o forward cair
      let consecutiveFails = 0;
      setInterval(() => {
        if (consecutiveFails > 4) return;
        const probe = net.connect({ host: '127.0.0.1', port: upstreamPort });
        probe.setTimeout(800);
        probe.once('connect', () => {
          consecutiveFails = 0;
          try { probe.destroy(); } catch (_) {}
        });
        probe.once('timeout', () => {
          try { probe.destroy(); } catch (_) {}
        });
        probe.once('error', () => {
          try { probe.destroy(); } catch (_) {}
          consecutiveFails++;
          if (consecutiveFails <= 3 && parentPort) {
            parentPort.postMessage({ type: 'need_heal' });
          }
        });
      }, 2500).unref();

      function writeHexSliced(upSocket, buf) {
        const hexStr = buf.toString('hex');
        const MAX_SLICE = 16384;
        if (hexStr.length <= MAX_SLICE) {
          return upSocket.write(Buffer.from(hexStr, 'ascii'));
        }
        let ok = true;
        for (let i = 0; i < hexStr.length; i += MAX_SLICE) {
          ok = upSocket.write(Buffer.from(hexStr.slice(i, i + MAX_SLICE), 'ascii'));
        }
        return ok;
      }

      // KILL-SWITCH 4G ESTRITO: PROIBIDO fazer fallback direto para a internet residencial do PC!
      function connectUpstreamWithRetry(client, initialChunks, attempt = 1) {
        if (client.destroyed) return;
        const up = net.connect({ host: '127.0.0.1', port: upstreamPort });
        up.setNoDelay(true);
        up.setTimeout(120000);
        let connected = false;
        let receivedAnyData = false;

        up.once('connect', () => {
          connected = true;
          if (client.destroyed) {
            try { up.destroy(); } catch (_) {}
            return;
          }
          for (let i = 0; i < initialChunks.length; i++) {
            writeHexSliced(up, initialChunks[i]);
          }
          const onClientData = (chunk) => {
            if (receivedAnyData) {
              initialChunks.length = 0;
            }
            if (!writeHexSliced(up, chunk)) {
              client.pause();
              up.once('drain', () => client.resume());
            }
          };
          client.on('data', onClientData);
          client.resume();
        });

        let rem = '';
        up.on('data', (chunk) => {
          if (!receivedAnyData) {
            receivedAnyData = true;
            initialChunks.length = 0;
          }
          const str = rem + chunk.toString('ascii');
          const evenLen = str.length & ~1;
          rem = str.slice(evenLen);
          if (evenLen > 0) {
            const raw = Buffer.from(str.slice(0, evenLen), 'hex');
            if (!client.write(raw)) {
              up.pause();
              client.once('drain', () => up.resume());
            }
          }
        });

        const cleanup = () => {
          try { client.destroy(); } catch (_) {}
          try { up.destroy(); } catch (_) {}
        };

        up.on('timeout', cleanup);
        up.on('close', () => {
          if (connected && !receivedAnyData && attempt < 12 && !client.destroyed && initialChunks.length > 0) {
            if (parentPort) parentPort.postMessage({ type: 'need_heal' });
            setTimeout(() => connectUpstreamWithRetry(client, initialChunks, attempt + 1), 350);
            return;
          }
          if (connected) cleanup();
        });
        up.on('error', () => {
          try { up.destroy(); } catch (_) {}
          if ((!connected || !receivedAnyData) && attempt < 12 && !client.destroyed) {
            if (parentPort) parentPort.postMessage({ type: 'need_heal' });
            setTimeout(() => connectUpstreamWithRetry(client, initialChunks, attempt + 1), 350);
          } else {
            if (parentPort) parentPort.postMessage({ type: 'need_heal' });
            cleanup();
          }
        });
      }

      const server = net.createServer((client) => {
        client.setNoDelay(true);
        client.setTimeout(120000);
        const initialChunks = [];
        const onEarlyData = (chunk) => {
          initialChunks.push(chunk);
          if (initialChunks.length > 32) client.pause();
        };
        client.on('data', onEarlyData);
        client.once('close', () => { initialChunks.length = 0; });
        client.once('error', () => { try { client.destroy(); } catch (_) {} });
        client.once('timeout', () => { try { client.destroy(); } catch (_) {} });

        // Substitui o listener inicial assim que connectUpstreamWithRetry assumir
        const origOn = client.on.bind(client);
        client.on = function(ev, fn) {
          if (ev === 'data' && fn !== onEarlyData) {
            client.removeListener('data', onEarlyData);
          }
          return origOn(ev, fn);
        };

        connectUpstreamWithRetry(client, initialChunks, 1);
      });

      let inUseRetries = 0;
      server.on('error', (err) => {
        if (err && err.code === 'EADDRINUSE') {
          inUseRetries++;
          if (inUseRetries <= 2) {
            if (parentPort) parentPort.postMessage({ type: 'port_in_use' });
            setTimeout(() => {
              try { server.listen(listenPort, '127.0.0.1'); } catch (_) {}
            }, 3000);
          }
        }
      });

      server.listen(listenPort, '127.0.0.1');
    `;
    _usb4gBridgeWorker = new Worker(workerCode, {
      eval: true,
      workerData: { listenPort: port, upstreamPort: ADB_UPSTREAM_PORT }
    });
    global.__globalUsb4gBridgeWorker = _usb4gBridgeWorker;
    _usb4gBridgeWorker.unref();
    _usb4gBridgeWorker.on('message', (msg) => {
      if (msg && msg.type === 'need_heal') {
        healAdbUpstreamTunnelAsync();
      } else if (msg && msg.type === 'port_in_use') {
        try {
          execFile(ADB_BIN, ['forward', '--remove', `tcp:${port}`], {
            timeout: 2000,
            env: ADB_EXEC_ENV,
            windowsHide: true
          }, () => { });
        } catch (_) { }
      }
    });
    _usb4gBridgeWorker.on('error', () => {
      _usb4gBridgeWorker = null;
      global.__globalUsb4gBridgeWorker = null;
    });
    _usb4gBridgeWorker.on('exit', () => {
      _usb4gBridgeWorker = null;
      global.__globalUsb4gBridgeWorker = null;
    });
  }

  try {
    const ipv4Bridge = require('./modules/infra_4g/ipv4_proxy_bridge');
    ipv4Bridge.ensureIpv4ProxyBridgeRunning().catch(() => { });
  } catch (_) { }

  if (now - _lastAdbForwardDirectCheckAt < 15000) return true;
  _lastAdbForwardDirectCheckAt = now;
  spawnAsyncAdbForwardRestore();
  return true;
}

let _adbAsyncRefreshInFlight = false;

function parseAndCacheAdbDevicesOutput(out, usbIf) {
  const lines = String(out || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('List of devices') && !l.startsWith('*'));
  const devices = lines.map(line => {
    const parts = line.split(/\s+/);
    const serial = parts[0] || '';
    const status = parts[1] || 'unknown';
    const modelMatch = line.match(/model:([^\s]+)/);
    return {
      serial,
      status,
      model: modelMatch ? modelMatch[1] : 'Android_4G'
    };
  });
  const adbConnected = devices.some(d => d.status === 'device');
  const unauthorized = devices.some(d => d.status === 'unauthorized');
  if (!adbConnected && usbIf) {
    devices.push({
      serial: usbIf.address,
      status: 'usb_tethering',
      model: `USB_4G (${usbIf.interface_name})`
    });
  }
  cachedAdbDevStatus = {
    adb_bin: ADB_BIN,
    connected: adbConnected || Boolean(usbIf),
    adb_connected: adbConnected,
    usb_tethering_connected: Boolean(usbIf),
    usb_interface: usbIf,
    unauthorized,
    devices
  };
  cachedAdbDevCheckAt = Date.now();
  if (adbConnected) {
    spawnAsyncAdbForwardRestore();
    ensureLocalUsb4gBridgeProxy(ADB_4G_PROXY_PORT);
  } else if (usbIf) {
    ensureLocalUsb4gBridgeProxy(ADB_4G_PROXY_PORT);
  }
  return cachedAdbDevStatus;
}

function refreshAdbDeviceStatusAsync() {
  if (_adbAsyncRefreshInFlight) return;
  _adbAsyncRefreshInFlight = true;
  const usbIf = findUsb4gLocalInterface();
  execFile(
    ADB_BIN,
    ['devices', '-l'],
    { encoding: 'utf8', timeout: 2500, env: ADB_EXEC_ENV, windowsHide: true },
    (err, stdout) => {
      _adbAsyncRefreshInFlight = false;
      if (err) {
        cachedAdbDevCheckAt = Date.now();
        if (!cachedAdbDevStatus) {
          cachedAdbDevStatus = {
            adb_bin: ADB_BIN,
            connected: Boolean(usbIf),
            adb_connected: false,
            usb_tethering_connected: Boolean(usbIf),
            usb_interface: usbIf,
            unauthorized: false,
            devices: usbIf ? [{ serial: usbIf.address, status: 'usb_tethering', model: `USB_4G (${usbIf.interface_name})` }] : [],
            error: err.message
          };
        }
        return;
      }
      parseAndCacheAdbDevicesOutput(stdout, usbIf);
    }
  );
}

function getAdbDeviceStatus(forceFresh = false) {
  const cacheTtlMs = (cachedAdbDevStatus && cachedAdbDevStatus.adb_connected) ? 25000 : 10000;
  if (!forceFresh && cachedAdbDevStatus) {
    if (Date.now() - cachedAdbDevCheckAt >= cacheTtlMs) {
      refreshAdbDeviceStatusAsync();
    }
    return cachedAdbDevStatus;
  }

  const usbIf = findUsb4gLocalInterface();
  // No primeiro acesso sem forceFresh, retorna instantaneamente (< 0.2ms) e dispara atualização assíncrona em background!
  if (!forceFresh && !cachedAdbDevStatus) {
    cachedAdbDevStatus = {
      adb_bin: ADB_BIN,
      connected: Boolean(usbIf),
      adb_connected: false,
      usb_tethering_connected: Boolean(usbIf),
      usb_interface: usbIf,
      unauthorized: false,
      devices: usbIf ? [{ serial: usbIf.address, status: 'usb_tethering', model: `USB_4G (${usbIf.interface_name})` }] : []
    };
    cachedAdbDevCheckAt = Date.now() - cacheTtlMs + 2000;
    if (usbIf) {
      ensureLocalUsb4gBridgeProxy(ADB_4G_PROXY_PORT);
    }
    refreshAdbDeviceStatusAsync();
    return cachedAdbDevStatus;
  }

  try {
    const out = execFileSync(ADB_BIN, ['devices', '-l'], {
      encoding: 'utf8',
      timeout: 2200,
      env: ADB_EXEC_ENV,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true
    });
    const parsed = parseAndCacheAdbDevicesOutput(out, usbIf);
    if (parsed.devices.some(d => d.status === 'offline' || d.status === 'unauthorized')) {
      hardResetAdbDaemonSync();
      const out2 = execFileSync(ADB_BIN, ['devices', '-l'], {
        encoding: 'utf8',
        timeout: 2500,
        env: ADB_EXEC_ENV,
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true
      });
      return parseAndCacheAdbDevicesOutput(out2, usbIf);
    }
    return parsed;
  } catch (err) {
    cachedAdbDevCheckAt = Date.now();
    cachedAdbDevStatus = {
      adb_bin: ADB_BIN,
      connected: Boolean(usbIf),
      adb_connected: false,
      usb_tethering_connected: Boolean(usbIf),
      usb_interface: usbIf,
      unauthorized: false,
      devices: usbIf ? [{ serial: usbIf.address, status: 'usb_tethering', model: `USB_4G (${usbIf.interface_name})` }] : [],
      error: err.message
    };
    return cachedAdbDevStatus;
  }
}

                function ensureAdbProxyTunnelAndWifiOff(port = ADB_4G_PROXY_PORT, onLog = null, forceHeal = false) {
                  try {
                    try {
                      const ipv4Bridge = require('./modules/infra_4g/ipv4_proxy_bridge');
                      ipv4Bridge.ensureIpv4ProxyBridgeRunning(onLog || (() => { })).catch(() => { });
                    } catch (_) { }

                    const adbSt = getAdbDeviceStatus(Boolean(forceHeal));
                    if (!adbSt || !adbSt.adb_connected) {
                      return false;
                    }
                    ensureLocalUsb4gBridgeProxy(port);

                    const now = Date.now();
                    if (forceHeal || now - _lastAdbForwardVerifiedAt > 10000) {
                      spawnAsyncAdbForwardRestore();
                      ensurePhoneHexRelayAndForwardSync(Boolean(forceHeal));
                      _lastAdbForwardVerifiedAt = now;
                    }

                    return true;
                  } catch (err) {
                    if (onLog) onLog(`⚠️ [ADB Tunnel] Aviso ao configurar forward USB: ${err.message}`);
                    return false;
                  }
                }

                function execFilePromise(bin, args, opts = {}) {
                  return new Promise((resolve, reject) => {
                    execFile(bin, args, { encoding: 'utf8', windowsHide: true, ...opts }, (err, stdout) => {
                      if (err) return reject(err);
                      resolve(String(stdout || ''));
                    });
                  });
                }

                let _cachedTunnelProbeResult = null;
                let _cachedTunnelProbeAt = 0;
                let _inFlightTunnelProbePromise = null;

                async function probeIpViaLocalProxyTunnelAsync() {
                  const now = Date.now();
                  if (_cachedTunnelProbeResult && (now - _cachedTunnelProbeAt) < 5000) {
                    return _cachedTunnelProbeResult;
                  }
                  if (_inFlightTunnelProbePromise) {
                    return _inFlightTunnelProbePromise;
                  }

                  _inFlightTunnelProbePromise = (async () => {
                    try {
                      const adbSt = cachedAdbDevStatus ? getAdbDeviceStatus(false) : getAdbDeviceStatus(true);
                      if (adbSt && adbSt.adb_connected) {
                        ensureAdbProxyTunnelAndWifiOff(ADB_4G_PROXY_PORT);
                      }

                      const proxyUrl = `http://127.0.0.1:${ADB_4G_PROXY_PORT}`;
                      try {
                        const rawIpify = await execFilePromise(
                          'curl.exe',
                          ['-s', '--max-time', '8', '-x', proxyUrl, 'https://api.ipify.org?format=json'],
                          { timeout: 9000 }
                        );
                        if (rawIpify && rawIpify.includes('"ip"')) {
                          const dIpify = JSON.parse(rawIpify);
                          if (dIpify && dIpify.ip) {
                            const resObj = {
                              ip: String(dIpify.ip).trim(),
                              ipv6: null,
                              org: '4G Mobile Tunnel (Every Proxy)',
                              city: '',
                              region: '',
                              country: 'BR',
                              tunnel_mode: 'ADB_FORWARD_PROXY',
                              proxy_url: 'http://127.0.0.1:8080',
                              checked_at: new Date().toISOString()
                            };
                            _cachedTunnelProbeResult = resObj;
                            _cachedTunnelProbeAt = Date.now();
                            return resObj;
                          }
                        }
                      } catch (_) { }

                      try {
                        const raw = await execFilePromise(
                          'curl.exe',
                          ['-s', '--max-time', '4', '-x', proxyUrl, 'https://ipinfo.io/json'],
                          { timeout: 4800 }
                        );
                        if (raw && raw.includes('"ip"')) {
                          const data = JSON.parse(raw);
                          if (data && data.ip) {
                            const resObj = {
                              ip: String(data.ip).trim(),
                              ipv6: null,
                              org: data.org || '4G Mobile Tunnel',
                              city: data.city || '',
                              region: data.region || '',
                              country: data.country || 'BR',
                              tunnel_mode: 'ADB_FORWARD_PROXY',
                              proxy_url: 'http://127.0.0.1:8080',
                              checked_at: new Date().toISOString()
                            };
                            _cachedTunnelProbeResult = resObj;
                            _cachedTunnelProbeAt = Date.now();
                            return resObj;
                          }
                        }
                      } catch (_) { }

                      try {
                        const ph = await require('./modules/infra_4g/proxy_health').get4gProxyHealth('127.0.0.1', ADB_4G_PROXY_PORT);
                        if (ph && ph.proxy_public_ip && ph.is_safe_4g_ip) {
                          const resObj = {
                            ip: String(ph.proxy_public_ip).trim(),
                            ipv6: null,
                            org: ph.proxy_isp || '4G Mobile Tunnel (Every Proxy)',
                            city: '',
                            region: '',
                            country: 'BR',
                            tunnel_mode: 'ADB_FORWARD_PROXY',
                            proxy_url: 'http://127.0.0.1:8080',
                            checked_at: new Date().toISOString()
                          };
                          _cachedTunnelProbeResult = resObj;
                          _cachedTunnelProbeAt = Date.now();
                          return resObj;
                        }
                      } catch (_) { }

                      return null;
                    } finally {
                      _inFlightTunnelProbePromise = null;
                    }
                  })();

                  return _inFlightTunnelProbePromise;
                }

                function probeIpViaLocalProxyTunnel() {
                  const adbSt = getAdbDeviceStatus(false);
                  if (!adbSt || !adbSt.adb_connected) {
                    return null;
                  }
                  if (_cachedTunnelProbeResult && (Date.now() - _cachedTunnelProbeAt) < 15000) {
                    return _cachedTunnelProbeResult;
                  }
                  ensureAdbProxyTunnelAndWifiOff(ADB_4G_PROXY_PORT);
                  const proxyUrl = `http://127.0.0.1:${ADB_4G_PROXY_PORT}`;
                  try {
                    const rawIpify = execFileSync(
                      'curl.exe',
                      ['-s', '--max-time', '2', '-x', proxyUrl, 'https://api.ipify.org?format=json'],
                      { encoding: 'utf8', timeout: 2500, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }
                    );
                    if (rawIpify && rawIpify.includes('"ip"')) {
                      const dIpify = JSON.parse(rawIpify);
                      if (dIpify && dIpify.ip) {
                        const resObj = {
                          ip: String(dIpify.ip).trim(),
                          ipv6: null,
                          org: '4G Mobile Tunnel (Every Proxy)',
                          city: '',
                          region: '',
                          country: 'BR',
                          tunnel_mode: 'ADB_FORWARD_PROXY',
                          proxy_url: 'http://127.0.0.1:8080',
                          checked_at: new Date().toISOString()
                        };
                        _cachedTunnelProbeResult = resObj;
                        _cachedTunnelProbeAt = Date.now();
                        return resObj;
                      }
                    }
                  } catch (_) { }
                  return null;
                }

                async function getCurrentPublicIpInfo(options = {}) {
                  const { prefer4gTunnel = true, strict4gProxyOnly = false } = options || {};

                  // 1. Sempre tenta primeiro pelo túnel 4G local (127.0.0.1:8080) de forma 100% assíncrona (sem travar o Event Loop do Hub)!
                  if (prefer4gTunnel) {
                    ensureAdbProxyTunnelAndWifiOff(ADB_4G_PROXY_PORT);
                    const tunnelInfo = await probeIpViaLocalProxyTunnelAsync();
                    if (tunnelInfo && tunnelInfo.ip) {
                      return tunnelInfo;
                    }
                    if (strict4gProxyOnly) {
                      return null;
                    }
                  }

                  let ipv6Detected = null;
                  try {
                    const c6 = new AbortController();
                    const t6 = setTimeout(() => c6.abort(), 2500);
                    const r6 = await fetch('https://api64.ipify.org?format=json', { signal: c6.signal });
                    clearTimeout(t6);
                    if (r6.ok) {
                      const d6 = await r6.json();
                      if (d6 && d6.ip && d6.ip.includes(':')) {
                        ipv6Detected = String(d6.ip).trim();
                      }
                    }
                  } catch (_) { }

                  const endpoints = [
                    { url: 'https://ipinfo.io/json', type: 'ipinfo' },
                    { url: 'https://api.ipify.org?format=json', type: 'ipify' },
                    { url: 'https://icanhazip.com', type: 'text' }
                  ];
                  for (const ep of endpoints) {
                    try {
                      const controller = new AbortController();
                      const timeout = setTimeout(() => controller.abort(), 3500);
                      const res = await fetch(ep.url, { signal: controller.signal });
                      clearTimeout(timeout);
                      if (!res.ok) continue;
                      if (ep.type === 'text') {
                        const ip = (await res.text()).trim();
                        if (ip) return { ip, ipv6: ipv6Detected, org: '', city: '', region: '', tunnel_mode: 'DIRECT_PC', checked_at: new Date().toISOString() };
                      } else {
                        const data = await res.json();
                        const ip = String(data.ip || '').trim();
                        if (ip) {
                          return {
                            ip,
                            ipv6: ipv6Detected,
                            org: data.org || '',
                            city: data.city || '',
                            region: data.region || '',
                            country: data.country || '',
                            tunnel_mode: 'DIRECT_PC',
                            checked_at: new Date().toISOString()
                          };
                        }
                      }
                    } catch (_) { }
                  }
                  return ipv6Detected ? { ip: ipv6Detected, ipv6: ipv6Detected, org: '', city: '', region: '', tunnel_mode: 'DIRECT_PC', checked_at: new Date().toISOString() } : null;
                }

                function extractIpv6Prefix64(ipv6) {
                  if (!ipv6 || typeof ipv6 !== 'string' || !ipv6.includes(':')) return null;
                  const parts = ipv6.trim().toLowerCase().split(':').filter(Boolean);
                  if (parts.length < 4) return ipv6.trim().toLowerCase();
                  return parts.slice(0, 4).join(':');
                }

                function extractIpv4Subnet24(ipv4) {
                  if (!ipv4 || typeof ipv4 !== 'string' || !ipv4.includes('.')) return null;
                  const parts = ipv4.trim().split('.');
                  if (parts.length !== 4) return null;
                  return `${parts[0]}.${parts[1]}.${parts[2]}`;
                }

                /**
                 * MOTOR ANTI-COLISÃO CGNAT 4G HIPER-ESCALA (300+ PERFIS):
                 * - No 4G Móvel (CGNAT), 1 único IPv4 público da operadora é compartilhado por ~3.000 celulares reais no mesmo bairro.
                 * - O que o Facebook pune NÃO é duas contas usarem o mesmo IP CGNAT com >35 min de distância, e sim:
                 *   (A) Troca back-to-back no MESMO IP sem girar o Modo Avião (`curIp === ledger.last_active_ip`);
                 *   (B) Entrar em um IP onde outra conta acabou de tomar Checkpoint (`TAINTED_`).
                 * - Portanto:
                 *   1. Exige IP 100% diferente da última conta aberta (`last_active_ip`);
                 *   2. Bloqueia IPs `TAINTED` (Checkpoint) por 24h (e a sub-rede /24 queimada por 2h);
                 *   3. Usa janela dinâmica de reuso CGNAT de 35 minutos (0.58h) para permitir rodar 300+ perfis na mesma torre 4G sem esgotar o pool CGNAT da antena!
                 */
                function hasRecentIpCollisionWithOtherAccount(ipInfo, targetProfileId, ledger, windowHours = 0.58) {
                  if (!ipInfo || !ipInfo.ip) return { collision: true, reason: 'Sem IP detectado' };
                  const targetClean = String(targetProfileId || '').trim().toLowerCase();
                  const curIp = String(ipInfo.ip).trim();
                  const curSubnet24 = extractIpv4Subnet24(curIp);
                  const curV6Prefix = extractIpv6Prefix64(ipInfo.ipv6);
                  const effectiveWindowHours = Math.min(Number(windowHours) || 0.58, 0.75); // Máx 45 min para não esgotar pool CGNAT em 300+ perfis
                  const cutoffMs = Date.now() - effectiveWindowHours * 3600 * 1000;
                  const taintedIpCutoffMs = Date.now() - 24 * 3600 * 1000;     // 24h de bloqueio no IP exato onde caiu conta
                  const taintedSubnetCutoffMs = Date.now() - 2 * 3600 * 1000;  // 2h de bloqueio na sub-rede /24 onde caiu conta

                  // REGRA A: Isolamento estrito Back-to-Back (Jamais usar o mesmo IPv4 ou IPv6 /64 da conta imediatamente anterior!)
                  if (targetClean && ledger?.last_active_profile_id && ledger.last_active_profile_id.toLowerCase() !== targetClean) {
                    if (ledger.last_active_ip && ledger.last_active_ip === curIp) {
                      return { collision: true, reason: `IPv4 ${curIp} idêntico à última conta aberta (${ledger.last_active_profile_id.slice(0, 8)})` };
                    }
                    const lastV6Prefix = extractIpv6Prefix64(ledger.last_active_ipv6);
                    if (curV6Prefix && lastV6Prefix && curV6Prefix === lastV6Prefix) {
                      return { collision: true, reason: `Prefixo IPv6 /64 (${curV6Prefix}) idêntico à última conta (${ledger.last_active_profile_id.slice(0, 8)})` };
                    }
                  }

                  const history = Array.isArray(ledger?.ip_history) ? ledger.ip_history : [];
                  for (const h of history) {
                    if (!h || !h.profile_id) continue;
                    const isTaintedEntry = String(h.profile_id).startsWith('TAINTED_') || Boolean(h.tainted_reason);
                    if (!isTaintedEntry && targetClean && h.profile_id.toLowerCase() === targetClean) continue;
                    const ts = new Date(h.timestamp || 0).getTime();

                    // REGRA B: Quarentena de IP Queimado (Checkpoint)
                    if (isTaintedEntry) {
                      if (h.ip === curIp && ts >= taintedIpCutoffMs) {
                        return {
                          collision: true,
                          reason: `IP QUEIMADO (${curIp}) onde uma conta caiu em Checkpoint nas últimas 24h (${h.tainted_reason || 'Checkpoint'})`
                        };
                      }
                      const taintedSubnet24 = extractIpv4Subnet24(h.ip);
                      if (curSubnet24 && taintedSubnet24 && curSubnet24 === taintedSubnet24 && ts >= taintedSubnetCutoffMs) {
                        return {
                          collision: true,
                          reason: `Sub-rede /24 em quarentena recente (${curSubnet24}.x) após Checkpoint (${h.ip})`
                        };
                      }
                      continue;
                    }

                    // REGRA C: Janela CGNAT de 35 minutos para o mesmo IPv4 exato
                    if (ts < cutoffMs) continue;
                    if (h.ip && h.ip === curIp) {
                      const minsAgo = Math.max(1, Math.round((Date.now() - ts) / 60000));
                      return { collision: true, reason: `IPv4 CGNAT ${curIp} usado há ${minsAgo} min pela conta ${h.profile_id.slice(0, 8)} (janela mínima: 35 min)` };
                    }
                    const histV6Prefix = extractIpv6Prefix64(h.ipv6);
                    if (curV6Prefix && histV6Prefix && curV6Prefix === histV6Prefix) {
                      return { collision: true, reason: `Prefixo IPv6 /64 (${curV6Prefix}) usado recentemente pela conta ${h.profile_id.slice(0, 8)}` };
                    }
                  }
                  return { collision: false };
                }

                function ensureUsbTetheringRndisViaAdb(onLog = console.log) {
                  // MODO DUAL-HOMED (Every Proxy + adb forward tcp:8080 tcp:8080):
                  // JAMAIS liga Ancoragem USB (rndis), pois o RNDIS cria segunda placa de rede no Windows e sequestra a rota do PC!
                  // Apenas garante que o túnel ADB forward 8080 esteja ativo e o Wi-Fi do celular desligado.
                  return ensureAdbProxyTunnelAndWifiOff(ADB_4G_PROXY_PORT, onLog);
                }

                /**
                 * Rotaciona o IP 4G do celular via ADB (Teardown PDP -> Modo Avião ON 18-24s -> Modo Avião OFF + reconexão forçada Dados/Túnel + Anti-Colisão IPv4/IPv6)
                 * REGRA DE SEGURANÇA: JAMAIS executa se houver qualquer navegador do Incogniton aberto!
                 */
                async function rotate4gIpViaAdb(onLog = console.log, maxAttempts = 3, targetProfileId = null) {
                  const lockedProfiles = scanAllLockedProfilesByKernel();
                  if (lockedProfiles.length > 0) {
                    const msg = `🚨 [Trava 4G ADB] Recusando girar Modo Avião porque o perfil ${lockedProfiles[0].slice(0, 8)} ainda está aberto! Fechando primeiro para nunca derrubar sessão ativa.`;
                    onLog(msg);
                    throw new Error(msg);
                  }

                  const beforeInfo = await getCurrentPublicIpInfo({ strict4gProxyOnly: true }) || await getCurrentPublicIpInfo();
                  const beforeIp = beforeInfo?.ip || null;
                  const beforeV6Prefix = extractIpv6Prefix64(beforeInfo?.ipv6);
                  let adbStatus = getAdbDeviceStatus(true);

                  if (adbStatus.unauthorized) {
                    const msg = `📱 [ADB 4G] Celular detectado no USB, mas está como 'unauthorized'! Desbloqueie a tela do celular e toque em "Sempre permitir a partir deste computador" -> "Permitir"!`;
                    onLog(msg);
                    throw new Error(msg);
                  }

                  // Se o Samsung desligou a Depuração USB ao ativar a Ancoragem USB (Ethernet 4 ativa, mas adb_connected=false):
                  if (!adbStatus.adb_connected && adbStatus.usb_tethering_connected) {
                    onLog(`📲 [Ancoragem USB 4G Ativa • Aguardando Giro de IP] O Samsung desligou a Depuração USB quando você ativou a Ancoragem USB! Ligue/Desligue o Modo Avião no celular agora (ou religue a chavinha "Depuração USB" com a Ancoragem já ativa para giro 100% automático). Aguardando novo IP 4G diferente de ${beforeIp}...`);
                    for (let w = 0; w < 30; w++) {
                      await new Promise(r => setTimeout(r, 4000));
                      adbStatus = getAdbDeviceStatus(true);
                      if (adbStatus.adb_connected) {
                        onLog(`✅ [ADB 4G] Depuração USB reconectada! Assumindo giro de Modo Avião 100% no automático...`);
                        break;
                      }
                      const checkInfo = await getCurrentPublicIpInfo({ strict4gProxyOnly: true });
                      const checkLedger = loadAccountIpLedger();
                      const col = hasRecentIpCollisionWithOtherAccount(checkInfo, targetProfileId, checkLedger, 6);
                      if (checkInfo && checkInfo.ip && checkInfo.ip !== beforeIp && !col.collision && !isResidentialFixedIp(checkInfo)) {
                        checkLedger.last_rotated_at = new Date().toISOString();
                        saveAccountIpLedger(checkLedger);
                        onLog(`✅ [4G Renovado] Novo IP 4G detectado (${beforeIp} ➔ ${checkInfo.ip})! Liberando próxima conta...`);
                        return {
                          success: true,
                          adb_connected: true,
                          old_ip: beforeIp,
                          new_ip: checkInfo.ip,
                          info: checkInfo
                        };
                      }
                    }
                  }

                  if (!adbStatus.adb_connected) {
                    const msg = `📱 [ADB 4G] Para trocar o IP entre contas automaticamente, religue a chavinha "Depuração USB" no celular (o Samsung desativa ela quando você liga a Ancoragem USB) ou gire o Modo Avião no celular!`;
                    onLog(msg);
                    return {
                      success: false,
                      adb_connected: false,
                      old_ip: beforeIp,
                      new_ip: beforeIp,
                      reason: msg
                    };
                  }

                  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                    // CRÍTICO DUAL-SIM SAMSUNG (SM_A075M): Sempre usa o ciclo de Modo Avião (nunca svc data disable, que derruba o SIM 2!)
                    const useDataOnlyFirst = false;

                    if (useDataOnlyFirst) {
                      onLog(`📶 [ADB 4G • Tentativa ${attempt}/${maxAttempts}] Reiniciando túnel PDP de Dados Móveis via ADB (${adbStatus.devices[0]?.model || 'USB'}) sem derrubar a Ancoragem USB (IP atual: ${beforeIp || 'desconhecido'})...`);
                      try {
                        execFileSync(ADB_BIN, ['shell', 'svc', 'wifi', 'disable'], { timeout: 3000, env: ADB_EXEC_ENV, stdio: 'ignore', windowsHide: true });
                      } catch (_) { }
                      try {
                        execFileSync(ADB_BIN, ['shell', 'svc', 'data', 'disable'], { timeout: 4000, env: ADB_EXEC_ENV, stdio: 'ignore', windowsHide: true });
                      } catch (_) { }
                      onLog(`⏳ [ADB 4G] Dados móveis desligados por 15s para renovar o lease CGNAT na antena mantendo a placa USB conectada...`);
                      await new Promise(r => setTimeout(r, 15000));
                      try {
                        execFileSync(ADB_BIN, ['shell', 'svc', 'data', 'enable'], { timeout: 4000, env: ADB_EXEC_ENV, stdio: 'ignore', windowsHide: true });
                      } catch (_) { }
                    } else {
                      onLog(`✈️ [ADB 4G • Tentativa ${attempt}/${maxAttempts}] Derrubando sessão PDP e ativando Modo Avião no celular (${adbStatus.devices[0]?.model || 'USB'}) para renovar IP 4G (IP atual: ${beforeIp || 'desconhecido'})...`);

                      // CRÍTICO DUAL-SIM SAMSUNG: NÃO chamar `svc data disable` antes do Modo Avião!
                      // O próprio Modo Avião derruba o contexto PDP na antena, e o `svc data disable` desativa a chavinha do SIM2 se o `svc data enable` rodar antes do SIM registrar na torre.
                      try {
                        execFileSync(ADB_BIN, ['shell', 'cmd', 'connectivity', 'airplane-mode', 'enable'], { timeout: 5000, env: ADB_EXEC_ENV, stdio: 'ignore', windowsHide: true });
                      } catch (_) {
                        try {
                          execFileSync(ADB_BIN, ['shell', 'settings', 'put', 'global', 'airplane_mode_on', '1'], { timeout: 4000, env: ADB_EXEC_ENV, stdio: 'ignore', windowsHide: true });
                          execFileSync(ADB_BIN, ['shell', 'am', 'broadcast', '-a', 'android.intent.action.AIRPLANE_MODE', '--ez', 'state', 'true'], { timeout: 4000, env: ADB_EXEC_ENV, stdio: 'ignore', windowsHide: true });
                        } catch (__) { }
                      }

                      const waitAirplaneMs = attempt === 1 ? 4000 : 6000;
                      onLog(`⏳ [ADB 4G Rápido] Celular em Modo Avião por ${waitAirplaneMs / 1000}s para renovar IP...`);
                      await new Promise(r => setTimeout(r, waitAirplaneMs));

                      // 2. Desliga Modo Avião, garante Wi-Fi do celular desligado, religa Dados Móveis e re-garante Ancoragem USB / Túnel 8080
                      // CRÍTICO: Durante os 18s em Modo Avião, o controlador USB da Samsung pode derrubar o handle do adb.exe.
                      // Por isso, SEMPRE acordamos o daemon ADB (getAdbDeviceStatus(true)) ANTES de enviar o comando `airplane-mode disable`!
                      onLog(`📶 [ADB 4G] Desligando Modo Avião, bloqueando Wi-Fi do celular e religando 4G/5G + Ancoragem USB...`);
                      for (let disTry = 0; disTry < 3; disTry++) {
                        cachedAdbDevCheckAt = 0;
                        getAdbDeviceStatus(true);
                        try {
                          execFileSync(ADB_BIN, ['shell', 'cmd', 'connectivity', 'airplane-mode', 'disable'], { timeout: 5000, env: ADB_EXEC_ENV, stdio: 'ignore', windowsHide: true });
                        } catch (_) { }
                        try {
                          execFileSync(ADB_BIN, ['shell', 'settings', 'put', 'global', 'airplane_mode_on', '0'], { timeout: 4000, env: ADB_EXEC_ENV, stdio: 'ignore', windowsHide: true });
                          execFileSync(ADB_BIN, ['shell', 'am', 'broadcast', '-a', 'android.intent.action.AIRPLANE_MODE', '--ez', 'state', 'false'], { timeout: 4000, env: ADB_EXEC_ENV, stdio: 'ignore', windowsHide: true });
                        } catch (_) { }
                        try {
                          const curAir = String(execFileSync(ADB_BIN, ['shell', 'settings', 'get', 'global', 'airplane_mode_on'], { encoding: 'utf8', timeout: 3000, env: ADB_EXEC_ENV, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }) || '').trim();
                          if (curAir === '0') break;
                        } catch (_) { }
                        await new Promise(r => setTimeout(r, 1200));
                      }
                      try {
                        execFileSync(ADB_BIN, ['shell', 'svc', 'wifi', 'disable'], { timeout: 3000, env: ADB_EXEC_ENV, stdio: 'ignore', windowsHide: true });
                      } catch (_) { }
                      try {
                        execFileSync(ADB_BIN, ['shell', 'svc', 'data', 'enable'], { timeout: 4000, env: ADB_EXEC_ENV, stdio: 'ignore', windowsHide: true });
                      } catch (_) { }
                      try {
                        execFileSync(ADB_BIN, ['shell', 'cmd', 'phone', 'set-allowed-network-types-for-users', '-s', '1', '11001111101111111111'], { timeout: 3500, env: ADB_EXEC_ENV, stdio: 'ignore', windowsHide: true });
                      } catch (_) { }
                      // CRÍTICO SAMSUNG (SM_A075M): JAMAIS executar `svc usb setFunctions rndis,adb` quando operando via Every Proxy (ADB 8080),
                      // pois o kernel OneUI da Samsung derruba a Depuração USB ao receber setFunctions rndis!
                    }

                    await new Promise(r => setTimeout(r, 2000));
                    cachedAdbDevCheckAt = 0;
                    getAdbDeviceStatus(true);
                    ensureAdbProxyTunnelAndWifiOff(ADB_4G_PROXY_PORT, onLog);
                    try {
                      execFileSync('ipconfig', ['/flushdns'], { timeout: 3000, stdio: 'ignore', windowsHide: true });
                    } catch (_) { }

                    // 3. Aguarda a conexão 4G voltar EXCLUSIVAMENTE pelo túnel 127.0.0.1:8080 (strict4gProxyOnly: true) com polling rápido de 1.5s
                    let afterInfo = null;
                    for (let poll = 0; poll < 20; poll++) {
                      await new Promise(r => setTimeout(r, poll === 0 ? 1000 : 1500));
                      if (poll > 0 && poll % 4 === 0) {
                        try {
                          execFileSync(ADB_BIN, ['shell', 'cmd', 'connectivity', 'airplane-mode', 'disable'], { timeout: 3000, env: ADB_EXEC_ENV, stdio: 'ignore', windowsHide: true });
                          execFileSync(ADB_BIN, ['shell', 'svc', 'wifi', 'disable'], { timeout: 3000, env: ADB_EXEC_ENV, stdio: 'ignore', windowsHide: true });
                          execFileSync(ADB_BIN, ['shell', 'svc', 'data', 'enable'], { timeout: 3000, env: ADB_EXEC_ENV, stdio: 'ignore', windowsHide: true });
                        } catch (_) { }
                        cachedAdbDevCheckAt = 0;
                        getAdbDeviceStatus(true);
                      }
                      ensureAdbProxyTunnelAndWifiOff(ADB_4G_PROXY_PORT);
                      afterInfo = await getCurrentPublicIpInfo({ strict4gProxyOnly: true });
                      if (afterInfo && afterInfo.ip && !isResidentialFixedIp(afterInfo)) break;
                    }

                    const afterIp = afterInfo?.ip || null;
                    const afterV6Prefix = extractIpv6Prefix64(afterInfo?.ipv6);
                    const ledger = loadAccountIpLedger();
                    const colCheck = hasRecentIpCollisionWithOtherAccount(afterInfo, targetProfileId, ledger, 0.58);
                    const ipv6SameAsBefore = Boolean(beforeV6Prefix && afterV6Prefix && beforeV6Prefix === afterV6Prefix);

                    if (afterIp && afterIp !== beforeIp && !ipv6SameAsBefore && !colCheck.collision && !isResidentialFixedIp(afterInfo)) {
                      ledger.last_rotated_at = new Date().toISOString();
                      ledger.last_active_ip = afterIp;
                      if (targetProfileId && !String(targetProfileId).startsWith('CLEAN_AFTER_')) {
                        const cleanT = String(targetProfileId).trim().toLowerCase();
                        ledger.last_active_profile_id = cleanT;
                        ledger.last_rotated_for_profile_id = cleanT;
                        if (!ledger.by_profile) ledger.by_profile = {};
                        if (!ledger.by_profile[cleanT]) ledger.by_profile[cleanT] = { ip_history: [] };
                        ledger.by_profile[cleanT].last_ip = afterIp;
                      }
                      saveAccountIpLedger(ledger);
                      try {
                        const ipv4Bridge = require('./modules/infra_4g/ipv4_proxy_bridge');
                        ipv4Bridge.clearIpv4DnsCache();
                      } catch (_) { }
                      onLog(`✅ [ADB 4G Hiper-Escala 300+] Novo IP 4G confirmado e sem colisão CGNAT: ${beforeIp || 'anterior'} ➔ ${afterIp}${afterV6Prefix ? ` (IPv6 /64: ${afterV6Prefix})` : ''} (${afterInfo.org || 'Operadora Móvel'})!`);
                      return {
                        success: true,
                        adb_connected: true,
                        old_ip: beforeIp,
                        new_ip: afterIp,
                        info: afterInfo
                      };
                    }

                    if (!afterIp) {
                      onLog(`⚠️ [ADB 4G] O túnel Every Proxy (127.0.0.1:8080) ainda está aguardando sinal 4G da torre... Reforçando adb forward...`);
                      ensureAdbProxyTunnelAndWifiOff(ADB_4G_PROXY_PORT, onLog);
                    } else if (colCheck.collision) {
                      onLog(`⚠️ [ADB 4G • Anti-Colisão CGNAT] ${colCheck.reason}. Girando novamente para exigir IP inédito...`);
                    } else {
                      onLog(`⚠️ [ADB 4G] A operadora devolveu o mesmo IPv4/IPv6 (${afterIp || 'sem resposta'}). ${attempt < maxAttempts ? 'Repetindo ciclo de Modo Avião mais longo...' : ''}`);
                    }
                  }

                  const finalInfo = await getCurrentPublicIpInfo({ strict4gProxyOnly: true });
                  const ledger = loadAccountIpLedger();
                  const finalCol = hasRecentIpCollisionWithOtherAccount(finalInfo, targetProfileId, ledger, 6);
                  const isOk = Boolean(finalInfo?.ip && finalInfo.ip !== beforeIp && !finalCol.collision && !isResidentialFixedIp(finalInfo));
                  return {
                    success: isOk,
                    adb_connected: true,
                    old_ip: beforeIp,
                    new_ip: finalInfo?.ip || beforeIp,
                    info: finalInfo,
                    reason: !isOk && !finalInfo?.ip
                      ? `Túnel 4G (127.0.0.1:8080 • Every Proxy) não respondeu após sair do Modo Avião. Verifique se o Every Proxy HTTP Proxy está ON no celular!`
                      : (!isOk && finalCol.collision ? finalCol.reason : undefined)
                  };
                }

                /**
                 * Queima/isola imediatamente o IP 4G atual quando uma conta da planilha falha no login (Conta Desativada / Suspensa / Senha Incorreta)
                 * e força um giro obrigatório de Modo Avião antes de tocar na próxima conta!
                 */
                async function taintCurrentIpAndRotate4g(reason, failedAccountLabel = 'CONTA_FALHA', onLog = console.log) {
                  try {
                    const curInfo = await getCurrentPublicIpInfo({ strict4gProxyOnly: true });
                    const ledger = loadAccountIpLedger();
                    if (curInfo && curInfo.ip) {
                      ledger.ip_history = Array.isArray(ledger.ip_history) ? ledger.ip_history : [];
                      ledger.ip_history.unshift({
                        profile_id: `TAINTED_${failedAccountLabel}`,
                        ip: curInfo.ip,
                        ipv6: curInfo.ipv6 || null,
                        org: curInfo.org || '',
                        tainted_reason: reason || 'FAILED_OR_DISABLED_LOGIN',
                        timestamp: new Date().toISOString()
                      });
                      if (ledger.ip_history.length > 50) ledger.ip_history.length = 50;
                      saveAccountIpLedger(ledger);
                      onLog(`☣️ [Quarentena de IP] O IP 4G ${curInfo.ip} foi marcado como QUEIMADO (${reason}) para jamais contaminar a próxima conta boa!`);
                    }
                  } catch (_) { }
                  onLog(`✈️ [Quarentena de IP] Forçando giro imediato de Modo Avião 4G para limpar o IP antes da próxima conta...`);
                  return await rotate4gIpViaAdb(onLog, 3, `CLEAN_AFTER_${Date.now()}`);
                }

                /**
                 * Conta quantos IPs 4G distintos uma mesma conta (`profileId`) já utilizou hoje (a partir da meia-noite BRT 00:00:00 America/Sao_Paulo).
                 * Permite os 3 turnos diários (Manhã, Tarde e Noite) + 1 margem de reconexão (MAX = 4/dia) sem herdar os IPs do dia anterior.
                 */
                function getAccountDistinct4gIpsInWindow(profileId, ledger = null, windowHours = null) {
                  const cleanId = String(profileId || '').trim().toLowerCase();
                  if (!cleanId) return { count: 0, ips: [] };
                  const ldg = ledger || loadAccountIpLedger();
                  const history = Array.isArray(ldg?.ip_history) ? ldg.ip_history : [];
                  const nowBrtObj = new Date(Date.now() - 3 * 3600 * 1000);
                  const startOfTodayBrtMs = Date.UTC(nowBrtObj.getUTCFullYear(), nowBrtObj.getUTCMonth(), nowBrtObj.getUTCDate(), 3, 0, 0);
                  const cutoffMs = startOfTodayBrtMs;
                  const ipSet = new Set();
                  for (const entry of history) {
                    if (String(entry?.profile_id || '').trim().toLowerCase() !== cleanId) continue;
                    const ts = entry?.timestamp ? new Date(entry.timestamp).getTime() : 0;
                    if (ts >= cutoffMs && entry?.ip && !isResidentialFixedIp({ ip: entry.ip, org: entry.org })) {
                      ipSet.add(String(entry.ip).trim());
                    }
                  }
                  return { count: ipSet.size, ips: Array.from(ipSet) };
                }

                /**
                 * Descobre dinamicamente TODOS os diretórios de perfil locais em AppData\Roaming\Incogniton\Incogniton\config
                 * combinados com KNOWN_WORKER_PROFILE_IDS (garantindo que novas contas diárias entrem automaticamente na blindagem).
                 */
                let _cachedLocalProfileIds = null;
                let _cachedLocalProfileIdsAt = 0;

                function getAllLocalProfileIds() {
                  const now = Date.now();
                  if (_cachedLocalProfileIds && now - _cachedLocalProfileIdsAt < 15000) {
                    return _cachedLocalProfileIds;
                  }
                  const ids = new Set(KNOWN_WORKER_PROFILE_IDS.map(x => String(x).trim().toLowerCase()));
                  try {
                    const configDir = path.join(INCOGNITON_APPDATA_DIR, 'config');
                    if (fs.existsSync(configDir)) {
                      const entries = fs.readdirSync(configDir, { withFileTypes: true });
                      for (const entry of entries) {
                        if (entry.isDirectory() && /^[0-9a-f-]{20,}$/i.test(entry.name)) {
                          ids.add(entry.name.toLowerCase());
                        }
                      }
                    }
                    if (MultiZenService && typeof MultiZenService.listProfiles === 'function') {
                      for (const mp of MultiZenService.listProfiles()) {
                        if (mp && mp.id) ids.add(String(mp.id).trim().toLowerCase());
                      }
                    }
                  } catch (_) { }
                  _cachedLocalProfileIds = Array.from(ids);
                  _cachedLocalProfileIdsAt = now;
                  return _cachedLocalProfileIds;
                }

                const BROWSER_LOCKS_DIR = path.join(__dirname, 'browser_locks');

                function isNodePidAlive(pid) {
                  const numPid = Number(pid);
                  if (!numPid || isNaN(numPid) || numPid <= 0) return false;
                  if (numPid === process.pid) return true;
                  try {
                    process.kill(numPid, 0);
                    return true;
                  } catch (err) {
                    return Boolean(err && err.code === 'EPERM');
                  }
                }

                function writeCrossProcessProfileLock(profileId, meta = {}) {
                  if (!profileId) return;
                  try {
                    const cleanId = String(profileId).trim().toLowerCase();
                    if (!fs.existsSync(BROWSER_LOCKS_DIR)) {
                      fs.mkdirSync(BROWSER_LOCKS_DIR, { recursive: true });
                    }
                    const lockFile = path.join(BROWSER_LOCKS_DIR, `${cleanId}.lock`);
                    fs.writeFileSync(
                      lockFile,
                      JSON.stringify({
                        profile_id: cleanId,
                        pid: process.pid,
                        updated_at: new Date().toISOString(),
                        ...meta
                      }, null, 2),
                      'utf8'
                    );
                    _cachedLockedProfiles = null;
                  } catch (_) { }
                }

                function removeCrossProcessProfileLock(profileId) {
                  if (!profileId) return;
                  try {
                    const cleanId = String(profileId).trim().toLowerCase();
                    const lockFile = path.join(BROWSER_LOCKS_DIR, `${cleanId}.lock`);
                    if (fs.existsSync(lockFile)) {
                      fs.unlinkSync(lockFile);
                    }
                    const devToolsPortPath = path.join(INCOGNITON_APPDATA_DIR, 'config', String(profileId).trim(), 'DevToolsActivePort');
                    if (fs.existsSync(devToolsPortPath)) {
                      try { fs.unlinkSync(devToolsPortPath); } catch (_) { }
                    }
                    _cachedLockedProfiles = null;
                  } catch (_) { }
                }

                /**
                 * Checa se o perfil está aberto (em qualquer processo Node ou no OS Windows):
                 * 1. Lock explícito entre processos em `browser_locks/<profileId>.lock` (somente se o PID criador estiver vivo!).
                 * 2. `config/<profileId>/lockfile` ou `Default/Network/Cookies` / `Default/Sessions` travado pelo OS (`EBUSY`/`EPERM`/`EACCES`).
                 */
                let _profileLockCacheMap = new Map();

                function isProfileLockedByKernel(profileId, forceFresh = false) {
                  if (!profileId) return false;
                  try {
                    const cleanId = String(profileId).trim().toLowerCase();
                    const now = Date.now();
                    if (!forceFresh) {
                      const hit = _profileLockCacheMap.get(cleanId);
                      if (hit && (now - hit.ts < 3000)) return hit.locked;
                    }

                    const computeLock = () => {
                      if (MultiZenService && typeof MultiZenService.hasProfile === 'function' && MultiZenService.hasProfile(profileId)) {
                        if (MultiZenService.isProfileLockedByKernel(profileId)) return true;
                      }

                      // 1. Verifica lock explícito entre processos em browser_locks/<profileId>.lock (válido por 2h se o PID dono ainda existir)
                      const crossLockPath = path.join(BROWSER_LOCKS_DIR, `${cleanId}.lock`);
                      if (fs.existsSync(crossLockPath)) {
                        try {
                          const st = fs.statSync(crossLockPath);
                          const lockObj = JSON.parse(fs.readFileSync(crossLockPath, 'utf8'));
                          const ownerAlive = lockObj && lockObj.pid ? isNodePidAlive(lockObj.pid) : true;
                          if (ownerAlive && Date.now() - st.mtimeMs < 2 * 3600 * 1000) {
                            return true;
                          }
                        } catch (_) { }
                      }

                      const profBase = path.join(INCOGNITON_APPDATA_DIR, 'config', String(profileId).trim());

                      // 4. Verifica lockfile ou Cookies/Sessions travados pelo Kernel do Windows (EBUSY / EPERM / EACCES)
                      const lockPath = path.join(profBase, 'lockfile');
                      if (fs.existsSync(lockPath)) {
                        try {
                          fs.unlinkSync(lockPath);
                        } catch (err) {
                          if (err && (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES')) {
                            return true;
                          }
                        }
                      }

                      const cookiesPath = path.join(profBase, 'Default', 'Network', 'Cookies');
                      if (fs.existsSync(cookiesPath)) {
                        try {
                          const fd = fs.openSync(cookiesPath, 'r+');
                          fs.closeSync(fd);
                        } catch (err) {
                          if (err && (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES')) {
                            return true;
                          }
                        }
                      }

                      const sessionsDir = path.join(profBase, 'Default', 'Sessions');
                      if (fs.existsSync(sessionsDir)) {
                        try {
                          const sessFiles = fs.readdirSync(sessionsDir).filter(f => f.startsWith('Session_') || f.startsWith('Tabs_'));
                          for (const sf of sessFiles) {
                            try {
                              const fd = fs.openSync(path.join(sessionsDir, sf), 'r+');
                              fs.closeSync(fd);
                            } catch (err) {
                              if (err && (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES')) {
                                return true;
                              }
                            }
                          }
                        } catch (_) { }
                      }

                      // 5. Se _activeLocalCdpByProfile tem esta conta registrada em sessão ativa, retorna true
                      if (IncognitonService._activeLocalCdpByProfile && IncognitonService._activeLocalCdpByProfile.has(cleanId)) {
                        return true;
                      }
                      return false;
                    };

                    const locked = computeLock();
                    _profileLockCacheMap.set(cleanId, { ts: now, locked });
                    return locked;
                  } catch (_) {
                    return false;
                  }
                }

                let _cachedLockedProfiles = null;
                let _cachedLockedProfilesAt = 0;

                function scanAllLockedProfilesByKernel(forceFresh = false) {
                  const now = Date.now();
                  if (!forceFresh && _cachedLockedProfiles && now - _cachedLockedProfilesAt < 2500) {
                    return _cachedLockedProfiles;
                  }
                  const lockedSet = new Set();
                  for (const id of getAllLocalProfileIds()) {
                    if (isProfileLockedByKernel(id)) {
                      lockedSet.add(String(id).trim().toLowerCase());
                    }
                  }
                  const locked = Array.from(lockedSet);
                  _cachedLockedProfiles = locked;
                  _cachedLockedProfilesAt = now;
                  return locked;
                }

                /**
                 * Higieniza supercookies de rede (Reporting & NEL, QUIC Alt-Svc broken_alternative_services)
                 * e blinda WebRTC + DoH + Preconnect + Zoom/DPR no disco ANTES de abrir o perfil (mesmo no 1º launch!).
                 */
                function sanitizeProfileDiskBeforeLaunch(profileId, onLog = console.log) {
                  if (!profileId || isProfileLockedByKernel(profileId)) return;
                  try {
                    const baseProfileDir = path.join(INCOGNITON_APPDATA_DIR, 'config', String(profileId).trim());
                    const profDir = path.join(baseProfileDir, 'Default');
                    if (!fs.existsSync(profDir)) {
                      try {
                        fs.mkdirSync(profDir, { recursive: true });
                      } catch (_) {
                        return;
                      }
                    }

                    // 1. Remove Reporting and NEL (evita envio de telemetria atrasada entre sessões)
                    const netDir = path.join(profDir, 'Network');
                    if (fs.existsSync(netDir)) {
                      for (const fName of ['Reporting and NEL', 'Reporting and NEL-journal']) {
                        const p = path.join(netDir, fName);
                        if (fs.existsSync(p)) {
                          try { fs.unlinkSync(p); } catch (_) { }
                        }
                      }

                      // 2. Limpa broken_alternative_services e alternative_service do QUIC/HTTP3 (sem tocar em Cookies)
                      const npsPath = path.join(netDir, 'Network Persistent State');
                      if (fs.existsSync(npsPath)) {
                        try {
                          const nps = JSON.parse(fs.readFileSync(npsPath, 'utf8'));
                          if (nps && nps.net) {
                            delete nps.net.broken_alternative_services;
                            if (nps.net.http_server_properties) {
                              delete nps.net.http_server_properties.broken_alternative_services;
                              delete nps.net.http_server_properties.alternative_service;
                            }
                            fs.writeFileSync(npsPath, JSON.stringify(nps), 'utf8');
                          }
                        } catch (_) { }
                      }
                    }

                    // 3. Blinda WebRTC (disable_non_proxied_udp), DoH (off), Preconnect (off), Accept-Language (pt-BR) e remove zoom anormal
                    const prefPath = path.join(profDir, 'Preferences');
                    let prefs = {};
                    if (fs.existsSync(prefPath)) {
                      try {
                        prefs = JSON.parse(fs.readFileSync(prefPath, 'utf8')) || {};
                      } catch (_) {
                        prefs = {};
                      }
                    }
                    prefs.webrtc = {
                      ip_handling_policy: 'disable_non_proxied_udp',
                      multiple_routes_enabled: false,
                      nonproxied_udp_enabled: false,
                      udp_port_range: ''
                    };
                    prefs.dns_over_https = { mode: 'off', templates: '' };
                    prefs.net = Object.assign({}, prefs.net || {}, {
                      network_prediction_options: 2
                    });
                    prefs.dns_prefetching = { enabled: false };
                    prefs.alternate_error_pages = { enabled: false };
                    prefs.intl = Object.assign({}, prefs.intl || {}, {
                      accept_languages: 'pt-BR,pt,en-US,en',
                      selected_languages: 'pt-BR,pt,en-US,en'
                    });
                    if (prefs.partition && prefs.partition.per_host_zoom_levels) {
                      for (const k of Object.keys(prefs.partition.per_host_zoom_levels)) {
                        const zMap = prefs.partition.per_host_zoom_levels[k];
                        if (zMap && typeof zMap === 'object') {
                          delete zMap['facebook.com'];
                          delete zMap['www.facebook.com'];
                          delete zMap['developers.facebook.com'];
                          delete zMap['business.facebook.com'];
                        }
                      }
                    }
                    try {
                      fs.writeFileSync(prefPath, JSON.stringify(prefs), 'utf8');
                    } catch (_) { }
                  } catch (_) { }
                }

                function isBlockedMatrixProfile(profileOrId) {
                  // Matriz liberada para postagens do robô
                  return false;
                }

                function isGraveyardProfile(profileOrId) {
                  const id = String(profileOrId || '').trim().toLowerCase();
                  for (const gId of GRAVEYARD_PROFILE_IDS) {
                    if (gId.toLowerCase() === id) return true;
                  }
                  return false;
                }

                function markProfileGraveyard(profileId, active = true) {
                  const clean = String(profileId || '').trim().toLowerCase();
                  if (!clean) return;
                  if (active) {
                    GRAVEYARD_PROFILE_IDS.add(clean);
                    CHECKPOINT_PROFILE_IDS.add(clean);
                  } else {
                    GRAVEYARD_PROFILE_IDS.delete(clean);
                    CHECKPOINT_PROFILE_IDS.delete(clean);
                  }
                }

                function isCheckpointProtectedProfile(profileOrId) {
                  const id = String(profileOrId || '').trim().toLowerCase();
                  if (isGraveyardProfile(id)) return true;
                  for (const cpId of CHECKPOINT_PROFILE_IDS) {
                    if (cpId.toLowerCase() === id) return true;
                  }
                  return false;
                }

                function markProfileCheckpoint(profileId, active = true) {
                  const clean = String(profileId || '').trim().toLowerCase();
                  if (!clean) return;
                  if (active) CHECKPOINT_PROFILE_IDS.add(clean);
                  else CHECKPOINT_PROFILE_IDS.delete(clean);
                }

                class IncognitonService {
                  constructor(token, mcpUrl = DEFAULT_MCP_URL) {
                    this.token = token;
                    this.mcpUrl = mcpUrl;
                  }

                  setToken(token) {
                    this.token = token;
                  }

                  setMcpUrl(url) {
                    this.mcpUrl = url;
                  }

                  parseMcpResult(result) {
                    if (!result) return { text: '', data: null };
                    if (result.structuredContent) {
                      return { text: JSON.stringify(result.structuredContent), data: result.structuredContent };
                    }
                    const textContent = result.content?.find(c => c.type === 'text')?.text || '';
                    try {
                      return { text: textContent, data: JSON.parse(textContent) };
                    } catch (_) {
                      const objStart = textContent.indexOf('{');
                      const objEnd = textContent.lastIndexOf('}');
                      const arrStart = textContent.indexOf('[');
                      const arrEnd = textContent.lastIndexOf(']');
                      if (arrStart !== -1 && arrEnd !== -1 && (objStart === -1 || arrStart < objStart)) {
                        try {
                          return { text: textContent, data: JSON.parse(textContent.substring(arrStart, arrEnd + 1)) };
                        } catch (_) { }
                      }
                      if (objStart !== -1 && objEnd !== -1) {
                        try {
                          return { text: textContent, data: JSON.parse(textContent.substring(objStart, objEnd + 1)) };
                        } catch (_) { }
                      }
                      return { text: textContent, data: null };
                    }
                  }

                  extractMaxLaunchedProfileCount(parsed) {
                    let maxCount = 0;
                    const rawText = (parsed && (parsed.text || parsed.rawText))
                      ? String(parsed.text || parsed.rawText)
                      : (typeof parsed === 'string' ? parsed : '');
                    const matches = rawText.matchAll(/"?launched_profile_count"?\s*:\s*(\d+)/gi);
                    for (const m of matches) {
                      const val = parseInt(m[1], 10);
                      if (!Number.isNaN(val)) maxCount = Math.max(maxCount, val);
                    }
                    if (parsed && parsed.data) {
                      const sessions = Array.isArray(parsed.data)
                        ? parsed.data
                        : (parsed.data.sessions || parsed.data.eligible_sessions || [parsed.data]);
                      for (const s of sessions) {
                        if (s && typeof s.launched_profile_count === 'number') {
                          maxCount = Math.max(maxCount, s.launched_profile_count);
                        }
                      }
                    }
                    return maxCount;
                  }

                  /**
                   * Inspeciona linhas de comando de processos `chrome.exe` no Windows (~150ms com filtro WMI)
                   * combinando com checagem de `lockfile` do kernel (0.1ms) para detectar QUALQUER perfil aberto no sistema.
                   */
                  inspectWindowsRunningProfiles(forceFresh = false) {
                    const now = Date.now();
                    if (!forceFresh && IncognitonService._cachedWinRunning && now - IncognitonService._cachedWinRunningAt < 5000) {
                      return IncognitonService._cachedWinRunning;
                    }

                    // Usa 100% checagem de lockfile do kernel em Node puro (0.1ms) SEM abrir PowerShell/WMIC/CMD para jamais roubar foco do mouse!
                    const kernelLockedIds = scanAllLockedProfilesByKernel();
                    const activeSet = new Set(kernelLockedIds.map(id => id.toLowerCase()));
                    const activeWorkerIds = Array.from(activeSet);
                    const matrixRunning = activeSet.has(MATRIX_PROFILE_UUID.toLowerCase());
                    const res = {
                      matrixRunning,
                      activeWorkerIds
                    };
                    IncognitonService._cachedWinRunning = res;
                    IncognitonService._cachedWinRunningAt = now;
                    return res;
                  }

                  /**
                   * Varre TODOS os diretórios de perfil do Incogniton em busca de portas TCP locais (DevToolsActivePort) ativas.
                   * Detecta em ~15ms qualquer perfil aberto (mesmo aberto manualmente fora do MCP e mesmo se o PowerShell der timeout!).
                   */
                  async findExistingLocalCdpSession(profileId) {
                    return this.probeProfileLocalDevToolsPort(profileId);
                  }

                  async scanAllOpenProfilePorts() {
                    const openProfiles = [];
                    try {
                      const configDir = path.join(INCOGNITON_APPDATA_DIR, 'config');
                      if (fs.existsSync(configDir)) {
                        const entries = fs.readdirSync(configDir, { withFileTypes: true });
                        for (const entry of entries) {
                          if (!entry.isDirectory()) continue;
                          const profId = entry.name;
                          const probe = await this.probeProfileLocalDevToolsPort(profId);
                          if (probe && probe.cdp_url) {
                            openProfiles.push({ profile_id: profId, cdp_url: probe.cdp_url, ws_url: probe.ws_url });
                          }
                        }
                      }
                      if (MultiZenService && typeof MultiZenService.listProfiles === 'function') {
                        for (const mp of MultiZenService.listProfiles()) {
                          if (!mp || !mp.id) continue;
                          const probe = await MultiZenService.probeProfileLocalDevToolsPort(mp.id);
                          if (probe && probe.cdp_url) {
                            openProfiles.push({ profile_id: mp.id, cdp_url: probe.cdp_url, ws_url: probe.ws_url, engine: 'multizen' });
                          }
                        }
                      }
                    } catch (_) { }
                    return openProfiles;
                  }

                  /**
                   * Pre-Flight de Segurança de IP Único e Anti-Vazamento de Porta:
                   * 1. Varre TODAS as portas DevToolsActivePort locais + lockfiles do kernel + processos do Windows antes de abrir `targetProfileId`.
                   * 2. Se outro perfil estiver em Checkpoint, BLOQUEIA imediatamente (jamais fecha e jamais abre segundo perfil no mesmo IP).
                   * 3. Se outro perfil normal estiver aberto, fecha-o via `stopProfile` (incluindo `browser.close()` via CDP) e re-verifica a porta TCP e o lockfile.
                   * 4. Drena túneis TCP/QUIC/MQTT (`RSTWebWorker`) por 30s após fechar outra conta no mesmo IP.
                   */
                  async checkSafeToLaunch(targetProfileId, onLog = console.log) {
                    const targetClean = String(targetProfileId || '').trim().toLowerCase();
                    _currentSessionProfileId = targetClean;

                    // 0. Se o próprio perfil alvo está marcado em Checkpoint, alerta o usuário antes de tocar nele
                    if (isCheckpointProtectedProfile(targetClean)) {
                      const msg = `🚨 BLOQUEIO DE SEGURANÇA (CHECKPOINT ATIVO): O perfil ${targetClean.slice(0, 8)} está marcado em CHECKPOINT aguardando preenchimento manual!`;
                      onLog(msg);
                      throw new Error(msg);
                    }

                    // 0.5. FAST-PATH MESMA SESSÃO: Se o próprio perfil já está aberto e validado no cache local CDP desta sessão,
                    // pula varredura WMI PowerShell e MCP remoto para não atrasar Slots 2/3 e Páginas 2/3 da mesma conta!
                    if (this.constructor._activeLocalCdpByProfile && this.constructor._activeLocalCdpByProfile.has(targetClean)) {
                      const cachedCdp = this.constructor._activeLocalCdpByProfile.get(targetClean);
                      const fastProbe = await this.probeLocalCdpPort(cachedCdp);
                      const fastLedger = loadAccountIpLedger();
                      if (fastProbe && fastProbe.cdp_url && (!fastLedger.last_active_profile_id || fastLedger.last_active_profile_id.toLowerCase() === targetClean)) {
                        return { safe: true, launched_profile_count: 1, already_open: true };
                      }
                    }

                    // 1. Varredura determinística de TODAS as portas TCP (DevToolsActivePort) + lockfiles do kernel + processos do Windows
                    // ISOLAMENTO DE REDE DUPLO: Matriz IP Fixo (Incogniton • WITHOUT_PROXY) NUNCA colide com Criação/Aquecimento 4G (MultiZen • 127.0.0.1:8080),
                    // mantendo 100% do Mutex Estrito entre 2 contas 4G!
                    const isTargetFixedMatriz = isLegacyFixedIpProfile(targetClean);
                    const isTargetMultiZenEarly = Boolean(MultiZenService && typeof MultiZenService.hasProfile === 'function' && MultiZenService.hasProfile(targetProfileId));
                    const isCrossDomainHarmless = (otherId, otherEngine = '') => {
                      const cleanOther = String(otherId || '').trim().toLowerCase();
                      if (!cleanOther) return true;
                      const otherIsFixedMatriz = isLegacyFixedIpProfile(cleanOther);
                      const otherIsMultiZen = otherEngine === 'multizen' || Boolean(MultiZenService && typeof MultiZenService.hasProfile === 'function' && MultiZenService.hasProfile(cleanOther));
                      if (isTargetFixedMatriz && otherIsMultiZen) return true;
                      if (isTargetMultiZenEarly && otherIsFixedMatriz) return true;
                      return false;
                    };

                    let openPorts = (await this.scanAllOpenProfilePorts()).filter(p => !isCrossDomainHarmless(p.profile_id, p.engine));
                    let osCheck = this.inspectWindowsRunningProfiles();
                    let activeOtherIds = new Set([
                      ...openPorts.map(p => p.profile_id.toLowerCase()),
                      ...osCheck.activeWorkerIds.map(id => id.toLowerCase()).filter(id => !isCrossDomainHarmless(id))
                    ]);
                    activeOtherIds.delete(targetClean);

                    // Anti-Race Condition no fechamento entre contas: se outro perfil acabou de fechar (sem porta CDP viva),
                    // aguarda até 2.5s e limpa processos filhos órfãos de chrome.exe antes de acusar navegador aberto!
                    if (activeOtherIds.size > 0) {
                      for (const workerId of Array.from(activeOtherIds)) {
                        const hasLivePort = openPorts.some(p => p.profile_id.toLowerCase() === workerId);
                        if (!hasLivePort) {
                          try {
                            execFileSync(
                              'powershell.exe',
                              [
                                '-NoProfile',
                                '-Command',
                                `Get-CimInstance Win32_Process -Filter "Name='chrome.exe' AND CommandLine LIKE '%${workerId}%'" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`
                              ],
                              { timeout: 3500, stdio: 'ignore', windowsHide: true }
                            );
                          } catch (_) { }
                        }
                      }
                      await new Promise(r => setTimeout(r, 1200));
                      openPorts = (await this.scanAllOpenProfilePorts()).filter(p => !isCrossDomainHarmless(p.profile_id, p.engine));
                      osCheck = this.inspectWindowsRunningProfiles();
                      activeOtherIds = new Set([
                        ...openPorts.map(p => p.profile_id.toLowerCase()),
                        ...osCheck.activeWorkerIds.map(id => id.toLowerCase()).filter(id => !isCrossDomainHarmless(id))
                      ]);
                      activeOtherIds.delete(targetClean);
                    }

                    for (const workerId of activeOtherIds) {
                      const msg = `🚨 BLOQUEIO DE NAVEGADOR ABERTO: O perfil ${workerId.slice(0, 8)} já está aberto na tela! O robô está 100% PROIBIDO de fechar qualquer navegador do Incogniton sozinho (só fecha quando você clicar em "✅ FINALIZAR JOGO"). Abortando abertura de ${targetClean.slice(0, 8)}!`;
                      onLog(msg);
                      throw new Error(msg);
                    }

                    if (activeOtherIds.size > 0) {
                      // Limpa cache DNS/QUIC do Windows e aguarda 30s para os túneis TCP/QUIC/MQTT (RSTWebWorker) do Facebook encerrarem 100% no IP
                      try {
                        execFileSync('ipconfig', ['/flushdns'], { stdio: 'ignore', timeout: 3000, windowsHide: true });
                      } catch (_) { }
                      onLog(`🛡️ [Isolamento de IP] Cache DNS limpo (ipconfig /flushdns) antes de abrir ${targetClean.slice(0, 8)}...`);
                      await new Promise(r => setTimeout(r, 2000));
                    }

                    // 1.5. Re-auditoria obrigatória das portas TCP locais + lockfiles do kernel após fechamento!
                    const remainingPorts = (await this.scanAllOpenProfilePorts()).filter(
                      p => p.profile_id.toLowerCase() !== targetClean && !isCrossDomainHarmless(p.profile_id, p.engine)
                    );
                    const remainingLocks = scanAllLockedProfilesByKernel().filter(
                      id => id.toLowerCase() !== targetClean && !isCrossDomainHarmless(id)
                    );
                    if (remainingPorts.length > 0 || remainingLocks.length > 0) {
                      const leaked = [
                        ...remainingPorts.map(p => `${p.profile_id.slice(0, 8)} (${p.cdp_url})`),
                        ...remainingLocks.map(id => `${id.slice(0, 8)} (lockfile ativo)`)
                      ].join(', ');
                      const msg = `🚨 BLOQUEIO ANTI-VAZAMENTO DE PORTA/IP: Ainda existe outro perfil aberto no IP (${leaked})! Abortando abertura de ${targetClean.slice(0, 8)} para jamais cruzar sessões no Facebook!`;
                      onLog(msg);
                      throw new Error(msg);
                    }

                    // 2. Checagem via MCP v5 get_eligible_sessions (pula se o perfil alvo for MultiZen ou já estiver aberto localmente na máquina)
                    const isTargetMultiZen = Boolean(MultiZenService && typeof MultiZenService.hasProfile === 'function' && MultiZenService.hasProfile(targetProfileId));
                    const targetLocalPortNow = await this.probeProfileLocalDevToolsPort(targetProfileId);
                    let launchedCount = 0;
                    if (!targetLocalPortNow && !isTargetMultiZen) {
                      try {
                        const eligRes = await this.callMcp('get_eligible_sessions', {
                          profile_browser_ID: targetProfileId
                        });
                        const parsed = this.parseMcpResult(eligRes);
                        launchedCount = this.extractMaxLaunchedProfileCount(parsed);
                      } catch (err) {
                        if (err.message && err.message.includes('BLOQUEIO')) {
                          throw err;
                        }
                        onLog(`[Incogniton] Aviso ao consultar get_eligible_sessions: ${err.message}`);
                      }
                    }

                    // 3. Se launched_profile_count > 0, verifica se outro perfil está aberto e fecha antes de prosseguir
                    let targetAlreadyLaunched = false;
                    if (launchedCount > 0) {
                      try {
                        const statuses = await this.getLaunchStatus(null, targetProfileId);
                        if (Array.isArray(statuses)) {
                          for (const st of statuses) {
                            const stId = String(st.profile_browser_ID || '').trim().toLowerCase();
                            if ((!stId || stId === targetClean) && st.status === 'LAUNCHED') {
                              targetAlreadyLaunched = true;
                            } else if (stId && stId !== targetClean && (st.status === 'LAUNCHED' || st.status === 'LAUNCHING')) {
                              const msg = `🚨 BLOQUEIO DE NAVEGADOR ABERTO: O perfil ${stId.slice(0, 8)} ainda está aberto! O robô está 100% proibido de fechar navegador sozinho.`;
                              onLog(msg);
                              throw new Error(msg);
                            }
                          }
                        }
                      } catch (err) {
                        if (err.message && err.message.includes('BLOQUEIO')) throw err;
                      }

                      if (!targetAlreadyLaunched) {
                        const msg = `🚨 BLOQUEIO DE NAVEGADOR ABERTO: Incogniton reportou launched_profile_count=${launchedCount} (outro perfil aberto). O robô está proibido de fechar navegadores sozinho!`;
                        onLog(msg);
                        throw new Error(msg);
                      }
                    }

                    const isSameProfileAlreadyOpen = targetAlreadyLaunched || isProfileLockedByKernel(targetClean);

                    // 4. Higieniza supercookies de disco se o perfil ainda estiver fechado (JAMAIS chama edit_profile para manter o fingerprint e User-Agent 100% imutáveis após login!)
                    if (!isSameProfileAlreadyOpen) {
                      sanitizeProfileDiskBeforeLaunch(targetClean, onLog);
                    }

                    // 5. GATEKEEPER 4G ADB (SOMENTE PARA CONTAS NOVAS / 4G_REQUIRED!):
                    const ledger = loadAccountIpLedger();
                    const isNew4gAccount = !isLegacyFixedIpProfile(targetClean);
                    const lastActiveClean = String(ledger.last_active_profile_id || '').trim().toLowerCase();
                    let isSwitchingAccount = Boolean(
                      lastActiveClean &&
                      lastActiveClean !== targetClean &&
                      // Se o último perfil ativo foi a Matriz de IP Fixo (Ethernet), NÃO conta como troca de conta 4G no túnel!
                      !(isNew4gAccount && isLegacyFixedIpProfile(lastActiveClean))
                    );

                    // CRÍTICO: Se o próprio perfil alvo JÁ está aberto nesta sessão (!isSwitchingAccount && isSameProfileAlreadyOpen),
                    // JAMAIS gira o Modo Avião nem cai no fallback sem proxy (evitando derrubar a 2ª página da mesma conta)!
                    if (isSameProfileAlreadyOpen && !isSwitchingAccount) {
                      if (isNew4gAccount) {
                        ensureAdbProxyTunnelAndWifiOff(ADB_4G_PROXY_PORT, onLog);
                        await healAdbUpstreamTunnelAsync();
                      }
                      const reusedIpInfo = {
                        ip: ledger.last_active_ip || ledger.by_profile?.[targetClean]?.last_ip || '4G_ACTIVE',
                        ipv6: ledger.last_active_ipv6 || null,
                        org: isNew4gAccount ? '4G Mobile Tunnel (Every Proxy • Sessão Ativa)' : 'IP Fixo Residencial',
                        tunnel_mode: isNew4gAccount ? 'ADB_FORWARD_PROXY' : 'DIRECT_PC'
                      };
                      return { safe: true, launched_profile_count: launchedCount, ip_info: reusedIpInfo, already_open: true };
                    }

                    let currentIpInfo = null;
                    if (isNew4gAccount) {
                      for (let retry = 0; retry < 3; retry++) {
                        ensureAdbProxyTunnelAndWifiOff(ADB_4G_PROXY_PORT);
                        await healAdbUpstreamTunnelAsync();
                        currentIpInfo = await getCurrentPublicIpInfo({ prefer4gTunnel: true, strict4gProxyOnly: true });
                        if (!currentIpInfo || !currentIpInfo.ip) {
                          try {
                            const ph = await require('./modules/infra_4g/proxy_health').get4gProxyHealth('127.0.0.1', ADB_4G_PROXY_PORT);
                            if (ph && ph.proxy_public_ip && ph.is_safe_4g_ip) {
                              currentIpInfo = {
                                ip: String(ph.proxy_public_ip).trim(),
                                ipv6: null,
                                org: ph.proxy_isp || '4G Mobile Tunnel (Every Proxy)',
                                tunnel_mode: 'ADB_FORWARD_PROXY',
                                proxy_url: `http://127.0.0.1:${ADB_4G_PROXY_PORT}`
                              };
                            }
                          } catch (_) { }
                        }
                        if (currentIpInfo && currentIpInfo.ip) break;
                        await new Promise(r => setTimeout(r, 2000));
                      }
                    }
                    if (!currentIpInfo && !isNew4gAccount) {
                      currentIpInfo = await getCurrentPublicIpInfo({ prefer4gTunnel: false });
                    }

                    if (isNew4gAccount) {
                      // Se o IP 4G atual já era o próprio last_ip deste perfil 4G e nenhum outro perfil 4G usou esse IP,
                      // reutiliza o IP dedicado atual sem considerar troca de conta e sem girar Modo Avião!
                      const targetLast4gIp = ledger.by_profile?.[targetClean]?.last_ip || null;
                      const other4gUsedCurrentIp = Boolean(
                        currentIpInfo?.ip &&
                        Object.entries(ledger.by_profile || {}).some(([pid, data]) => {
                          const pClean = String(pid || '').trim().toLowerCase();
                          if (!pClean || pClean === targetClean || isLegacyFixedIpProfile(pClean)) return false;
                          return data?.last_ip === currentIpInfo.ip;
                        })
                      );
                      if (currentIpInfo?.ip && targetLast4gIp === currentIpInfo.ip && !other4gUsedCurrentIp) {
                        isSwitchingAccount = false;
                      } else if (!isSameProfileAlreadyOpen && (other4gUsedCurrentIp || targetLast4gIp !== currentIpInfo?.ip)) {
                        isSwitchingAccount = true;
                      }

                      const distinctToday = getAccountDistinct4gIpsInWindow(targetClean, ledger);
                      const MAX_DISTINCT_4G_IPS_PER_DAY = 4;
                      const wouldUseAnotherIpToday = Boolean(
                        !isSameProfileAlreadyOpen &&
                        distinctToday.count >= MAX_DISTINCT_4G_IPS_PER_DAY &&
                        (isSwitchingAccount || distinctToday.count >= 5 || (currentIpInfo?.ip && !distinctToday.ips.includes(currentIpInfo.ip)))
                      );
                      if (wouldUseAnotherIpToday) {
                        const msg = `🛡️ [PROTEÇÃO ANTI-QUEDA 4G • C12] A conta (${targetClean.slice(0, 8)}) já abriu em ${distinctToday.count} IPs 4G diferentes hoje desde 00:00 BRT (${distinctToday.ips.join(', ')}). Bloqueando nova abertura com troca de IP hoje para evitar Checkpoint de 180 dias!`;
                        onLog(msg);
                        throw new Error(msg);
                      }

                      const onFixedWifiNow = !currentIpInfo || !currentIpInfo.ip || isResidentialFixedIp(currentIpInfo);
                      const colCheckBefore = hasRecentIpCollisionWithOtherAccount(currentIpInfo, targetClean, ledger, 6);
                      const prevProfIp = ledger.by_profile?.[targetClean];
                      const prevWasResidential = Boolean(prevProfIp && isResidentialFixedIp({ ip: prevProfIp.last_ip, ipv6: prevProfIp.last_ipv6 }));
                      if (!isSameProfileAlreadyOpen) {
                        await this.ensureProfile4gProxyConfigured(targetProfileId, onLog).catch(() => { });
                      }
                      const needsFresh4gRotationOnSwitch = Boolean(
                        !isSameProfileAlreadyOpen &&
                        (
                          other4gUsedCurrentIp ||
                          targetLast4gIp !== currentIpInfo?.ip ||
                          (isSwitchingAccount && ledger.require_4g_rotation && ledger.last_rotated_for_profile_id !== targetClean)
                        )
                      );

                      if ((onFixedWifiNow || prevWasResidential || needsFresh4gRotationOnSwitch || (isSwitchingAccount && colCheckBefore.collision)) && getAdbDeviceStatus().adb_connected) {
                        const rotReason = onFixedWifiNow
                          ? 'Em IP Fixo/Sem Túnel 4G'
                          : prevWasResidential
                            ? 'Migrando de IP Fixo para 4G'
                            : colCheckBefore.collision
                              ? colCheckBefore.reason
                              : 'Giro Obrigatório de IP 4G antes de abrir a Conta';
                        onLog(`🔄 [Gatekeeper 4G • Isolamento Conta 4G] Conta 4G detectada (${targetClean.slice(0, 8)}: ${rotReason}). Acionando rotação 4G no celular via ADB com navegadores 100% fechados...`);
                        const rotRes = await rotate4gIpViaAdb(onLog, 2, targetClean);
                        currentIpInfo = rotRes.info || (await getCurrentPublicIpInfo({ prefer4gTunnel: true, strict4gProxyOnly: true }));
                        if (!currentIpInfo || !currentIpInfo.ip) {
                          for (let pRetry = 0; pRetry < 4; pRetry++) {
                            await new Promise(r => setTimeout(r, 2000));
                            currentIpInfo = await getCurrentPublicIpInfo({ prefer4gTunnel: true, strict4gProxyOnly: true });
                            if (currentIpInfo && currentIpInfo.ip) break;
                          }
                        }
                        if (!currentIpInfo || !currentIpInfo.ip) {
                          try {
                            const rawProbe = execFileSync(
                              'curl.exe',
                              ['-s', '--max-time', '4', '-x', `http://127.0.0.1:${ADB_4G_PROXY_PORT}`, 'https://api.ipify.org?format=json'],
                              { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }
                            );
                            const parsed = JSON.parse(rawProbe);
                            if (parsed && parsed.ip) {
                              currentIpInfo = {
                                ip: String(parsed.ip).trim(),
                                ipv6: null,
                                org: '4G Mobile Tunnel (Every Proxy)',
                                tunnel_mode: 'ADB_FORWARD_PROXY',
                                proxy_url: `http://127.0.0.1:${ADB_4G_PROXY_PORT}`
                              };
                            }
                          } catch (_) { }
                        }
                        if (currentIpInfo && currentIpInfo.ip && !isResidentialFixedIp(currentIpInfo)) {
                          ledger.last_rotated_at = new Date().toISOString();
                          ledger.last_rotated_for_profile_id = targetClean;
                        }
                      }

                      if (!currentIpInfo || !currentIpInfo.ip || isResidentialFixedIp(currentIpInfo)) {
                        const msg = `🚨 BLOQUEIO GATEKEEPER 4G (IP FIXO RESIDENCIAL É 100% EXCLUSIVO DA MATRIZ): A conta 4G (${targetClean.slice(0, 8)}) está PROIBIDA de abrir no IP residencial fixo (${currentIpInfo?.ip || 'Sem Túnel 4G 127.0.0.1:8080'} • ${currentIpInfo?.org || 'Algar/Vero'})! Conecte o celular 4G via USB/ADB com Every Proxy ativo (127.0.0.1:8080) antes de abrir esta conta!`;
                        onLog(msg);
                        throw new Error(msg);
                      }
                    } else if (!isNew4gAccount) {
                      ledger.last_rotated_for_profile_id = null;
                      onLog(`🏠 [IP Fixo Residencial Exclusivo MATRIZ] Conta Matriz (${targetClean.slice(0, 8)}) autorizada no IP fixo exclusivo da operação — abrindo normalmente sem exigir 4G.`);
                    }

                    if (currentIpInfo?.ip) {
                      ledger.last_active_profile_id = targetClean;
                      ledger.last_active_ip = currentIpInfo.ip;
                      ledger.last_active_ipv6 = currentIpInfo.ipv6 || null;
                      ledger.by_profile = ledger.by_profile || {};
                      ledger.by_profile[targetClean] = {
                        last_ip: currentIpInfo.ip,
                        last_ipv6: currentIpInfo.ipv6 || null,
                        org: currentIpInfo.org || '',
                        network_mode: isNew4gAccount ? '4G_ROTATING' : 'DIRECT_RESIDENTIAL',
                        proxy_url: isNew4gAccount ? 'http://127.0.0.1:8080' : 'DIRECT',
                        updated_at: new Date().toISOString()
                      };
                      ledger.ip_history = Array.isArray(ledger.ip_history) ? ledger.ip_history : [];
                      ledger.ip_history.unshift({
                        profile_id: targetClean,
                        ip: currentIpInfo.ip,
                        ipv6: currentIpInfo.ipv6 || null,
                        org: currentIpInfo.org || '',
                        timestamp: new Date().toISOString()
                      });
                      if (ledger.ip_history.length > 40) ledger.ip_history.length = 40;
                      saveAccountIpLedger(ledger);
                      onLog(`🌐 [IP da Sessão] Perfil ${targetClean.slice(0, 8)} autorizado no IP ${currentIpInfo.ip} (${currentIpInfo.org || 'Rede Ativa'}).`);
                    }

                    return { safe: true, launched_profile_count: launchedCount, ip_info: currentIpInfo };
                  }

                  /**
                   * Testa se uma porta CDP local (127.0.0.1:porta) está aberta e retorna webSocketDebuggerUrl
                   */
                  async probeLocalCdpPort(portOrUrl) {
                    let url = String(portOrUrl).trim();
                    if (/^\d+$/.test(url)) {
                      url = `http://127.0.0.1:${url}`;
                    }
                    url = url.replace(/\/$/, '');
                    try {
                      const controller = new AbortController();
                      const timeout = setTimeout(() => controller.abort(), 1500);
                      const res = await fetch(`${url}/json/version`, { signal: controller.signal });
                      clearTimeout(timeout);
                      if (!res.ok) return null;
                      const data = await res.json();
                      return {
                        cdp_url: url,
                        ws_url: data.webSocketDebuggerUrl || null,
                        browser: data.Browser || ''
                      };
                    } catch (_) {
                      return null;
                    }
                  }

                  /**
                   * Lê diretamente o arquivo local DevToolsActivePort do perfil no AppData do Incogniton
                   * e verifica se o navegador Chromium daquele perfil já está ativo e respondendo na porta local.
                   */
                  async probeProfileLocalDevToolsPort(profileBrowserId) {
                    if (!profileBrowserId) return null;
                    try {
                      const cleanId = String(profileBrowserId).trim().toLowerCase();
                      if (this.constructor._activeLocalCdpByProfile && this.constructor._activeLocalCdpByProfile.has(cleanId)) {
                        const cachedUrl = this.constructor._activeLocalCdpByProfile.get(cleanId);
                        const probeCached = await this.probeLocalCdpPort(cachedUrl);
                        if (probeCached && probeCached.cdp_url) {
                          return probeCached;
                        }
                        this.constructor._activeLocalCdpByProfile.delete(cleanId);
                      }
                      if (MultiZenService && typeof MultiZenService.hasProfile === 'function' && MultiZenService.hasProfile(cleanId)) {
                        const mzProbe = await MultiZenService.probeProfileLocalDevToolsPort(cleanId);
                        if (mzProbe && mzProbe.cdp_url) {
                          if (!this.constructor._activeLocalCdpByProfile) this.constructor._activeLocalCdpByProfile = new Map();
                          this.constructor._activeLocalCdpByProfile.set(cleanId, mzProbe.cdp_url);
                          return mzProbe;
                        }
                      }
                      const portFile = path.join(INCOGNITON_APPDATA_DIR, 'config', String(profileBrowserId).trim(), 'DevToolsActivePort');
                      if (fs.existsSync(portFile)) {
                        // REGRA DE OURO: JAMAIS apague DevToolsActivePort antes de testar a porta TCP via probeLocalCdpPort(port)!
                        const lines = fs.readFileSync(portFile, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
                        if (lines.length > 0) {
                          const port = parseInt(lines[0], 10);
                          if (Number.isFinite(port) && port > 0 && port !== 9222 && port !== 9223) {
                            const probe = await this.probeLocalCdpPort(port);
                            if (probe && probe.cdp_url) {
                              if (!this.constructor._activeLocalCdpByProfile) this.constructor._activeLocalCdpByProfile = new Map();
                              this.constructor._activeLocalCdpByProfile.set(cleanId, probe.cdp_url);
                              writeCrossProcessProfileLock(cleanId, { cdp_url: probe.cdp_url });
                              return probe;
                            }
                          }
                        }
                        // Só remove DevToolsActivePort órfão se probeLocalCdpPort retornou null E o perfil não está travado no kernel!
                        if (!isProfileLockedByKernel(cleanId)) {
                          try { fs.unlinkSync(portFile); } catch (_) { }
                        }
                        return null;
                      }
                      // Fallback assíncrono: se o processo Chromium do perfil está aberto com --remote-debugging-port=XXXX na linha de comando
                      if (isProfileLockedByKernel(cleanId)) {
                        try {
                          const out = await execFilePromise(
                            'powershell.exe',
                            ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "Name='chrome.exe' AND CommandLine LIKE '%${cleanId}%' AND CommandLine LIKE '%--remote-debugging-port=%'" | Select-Object -First 1 -ExpandProperty CommandLine)`],
                            { timeout: 3500 }
                          );
                          const m = String(out || '').match(/--remote-debugging-port=(\d+)/);
                          if (m && m[1]) {
                            const pPort = parseInt(m[1], 10);
                            if (Number.isFinite(pPort) && pPort > 0) {
                              const probe = await this.probeLocalCdpPort(pPort);
                              if (probe && probe.cdp_url) {
                                if (!this.constructor._activeLocalCdpByProfile) this.constructor._activeLocalCdpByProfile = new Map();
                                this.constructor._activeLocalCdpByProfile.set(cleanId, probe.cdp_url);
                                return probe;
                              }
                            }
                          }
                        } catch (_) { }
                      }
                    } catch (_) { }
                    return null;
                  }

                  /**
                   * Auto-regenera o Token MCP do Incogniton lendo o auth.json local do Incogniton Desktop
                   * caso o token anterior tenha sido revogado ou expirado (HTTP 401).
                   */
                  async autoRefreshMcpToken(onLog = console.log) {
                    try {
                      const authPath = path.join(INCOGNITON_APPDATA_DIR, 'auth.json');
                      if (!fs.existsSync(authPath)) return null;
                      const authData = JSON.parse(fs.readFileSync(authPath, 'utf8'));
                      const apiToken = authData?.auth?.auth;
                      if (!apiToken) return null;

                      onLog(`[Incogniton Auto-Heal] Renovando token MCP automaticamente via credencial local do Incogniton...`);
                      const hwidCandidates = [
                        '{"uniqueIdentifier":"inc02hwid","os":"Windows11","cpu":"Ryzen7800","motherboard":"B650M-A02","macAddress":"024A9C11B"}',
                        INCOGNITON_SYSTEM_INFO
                      ];
                      let sessionToken = null;
                      for (const sysInfo of hwidCandidates) {
                        const checkParams = new URLSearchParams({
                          version: '5.0.1.3',
                          api_token: apiToken,
                          systemInfo: sysInfo,
                          incognitonVersion: '5.0.1.3',
                          deviceName: process.env.COMPUTERNAME || 'DESKTOP-HDSI78P',
                          osInfo: 'Windows 11 10.0 (amd64)'
                        });
                        const checkRes = await fetch('https://v5api.incogniton.com/auth/check', {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/x-www-form-urlencoded',
                            'X-Client-Version': '5.0.1.3',
                            'Authorization': `Bearer ${apiToken}`
                          },
                          body: checkParams.toString()
                        });
                        if (checkRes.ok) {
                          const checkJson = await checkRes.json();
                          sessionToken = checkJson?.sessionToken || checkJson?.data?.sessionToken;
                          if (sessionToken) break;
                        }
                      }
                      if (!sessionToken) return null;

                      const genParams = new URLSearchParams({
                        api_token: apiToken,
                        session_token: sessionToken,
                        version: '5.0.1.3'
                      });
                      const genRes = await fetch('https://v5api.incogniton.com/mcp-token/generate', {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/x-www-form-urlencoded',
                          'X-Client-Version': '5.0.1.3',
                          'Authorization': `Bearer ${apiToken}`,
                          'X-Session-Token': sessionToken
                        },
                        body: genParams.toString()
                      });
                      if (!genRes.ok) return null;
                      const genJson = await genRes.json();
                      const newToken = genJson?.token || genJson?.data?.token;
                      if (!newToken) return null;

                      this.token = newToken;
                      this._lastAuthApiToken = apiToken;

                      // Salva automaticamente no database.json para persistir entre reinicializações
                      try {
                        const dbPath = path.join(__dirname, 'database.json');
                        if (fs.existsSync(dbPath)) {
                          const dbJson = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
                          if (dbJson && dbJson.settings) {
                            dbJson.settings.mcp_token = newToken;
                            fs.writeFileSync(dbPath, JSON.stringify(dbJson, null, 2), 'utf8');
                          }
                        }
                      } catch (_) { }

                      onLog(`[Incogniton Auto-Heal] Novo token MCP gerado e salvo com sucesso (ID: ${genJson.token_id || 'ativo'})!`);
                      return newToken;
                    } catch (err) {
                      onLog(`[Incogniton Auto-Heal] Falha ao auto-renovar token MCP: ${err.message}`);
                      return null;
                    }
                  }

                  /**
                   * Garante que o Incogniton Desktop (porta 35000) esteja aberto e logado na conta Incogniton correta
                   * (auth.conta01.json vs auth.conta02.json) para o profileBrowserId alvo, sem fechar nenhum navegador ativo!
                   */
                  async ensureIncognitonDesktopAccountForProfile(profileBrowserId, onLog = console.log) {
                    const cleanTarget = String(profileBrowserId || '').trim().toLowerCase();
                    if (!cleanTarget) return false;

                    const checkLocalProfileList = async () => {
                      try {
                        const ctrl = new AbortController();
                        const tm = setTimeout(() => ctrl.abort(), 2500);
                        const r = await fetch(`${LOCAL_INCOGNITON_URL}/profile/all`, { signal: ctrl.signal });
                        clearTimeout(tm);
                        if (!r.ok) return null;
                        const j = await r.json();
                        const list = Array.isArray(j?.profileData) ? j.profileData : Array.isArray(j) ? j : [];
                        return list.map(p => String(p.general_profile_information?.browser_id || p.profile_browser_ID || p.id || '').trim().toLowerCase()).filter(Boolean);
                      } catch (_) {
                        return null;
                      }
                    };

                    const currentIds = await checkLocalProfileList();
                    if (Array.isArray(currentIds) && currentIds.includes(cleanTarget)) {
                      return true;
                    }

                    // JAMAIS fecha ou reinicia o Incogniton Desktop se já estiver aberto no Windows!
                    const locked = scanAllLockedProfilesByKernel();
                    if (locked.length > 0) {
                      return false;
                    }

                    try {
                      const incRunning = execFileSync(
                        'powershell.exe',
                        ['-NoProfile', '-Command', '(Get-Process -Name "Incogniton" -ErrorAction SilentlyContinue | Measure-Object).Count'],
                        { timeout: 3000, encoding: 'utf8', windowsHide: true }
                      ).trim();
                      if (Number(incRunning) > 0) {
                        onLog(`🛡️ [Proteção Incogniton] Incogniton Desktop já está aberto. Proibido fechar/reiniciar o aplicativo automaticamente (perfil ${cleanTarget.slice(0, 8)}).`);
                        return false;
                      }
                    } catch (_) {
                      return false;
                    }

                    const CONTA02_PROFILE_IDS = new Set([
                      'a45b6901-662e-4f04-9d18-e4727f77f789',
                      'e21a98ca-6aef-438d-835c-19334d02f273',
                      '405b9eb5-ac9b-4c2a-a134-74381e92f189',
                      '37baf0d3-9c77-437f-beb8-65304db15325',
                      'c21bbb1e-db11-4e8b-8009-7eb02bad4611',
                      '9d87443f-2bd5-4d5c-a6b0-8569f0a83c2d',
                      '8e452106-2a8d-41c9-8759-0f27fd30a94c'
                    ]);
                    const desiredAuthFile = CONTA02_PROFILE_IDS.has(cleanTarget) ? 'auth.conta02.json' : 'auth.conta01.json';
                    const srcAuth = path.join(INCOGNITON_APPDATA_DIR, desiredAuthFile);
                    const dstAuth = path.join(INCOGNITON_APPDATA_DIR, 'auth.json');

                    try {
                      if (fs.existsSync(srcAuth)) {
                        fs.copyFileSync(srcAuth, dstAuth);
                      }
                      onLog(`[Incogniton Auto-Heal] Iniciando Incogniton Desktop visível no monitor (estava fechado) para ${desiredAuthFile} (perfil ${cleanTarget.slice(0, 8)})...`);
                      const incogExe = path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'incogniton', 'Incogniton.exe');
                      const incogDir = path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'incogniton');
                      const child = spawn(incogExe, [], {
                        cwd: incogDir,
                        detached: true,
                        stdio: 'ignore',
                        windowsHide: false
                      });
                      child.unref();
                      for (let i = 0; i < 14; i++) {
                        await new Promise(r => setTimeout(r, 2000));
                        const idsAfter = await checkLocalProfileList();
                        if (Array.isArray(idsAfter) && idsAfter.length > 0) {
                          await this.autoRefreshMcpToken(onLog).catch(() => { });
                          return idsAfter.includes(cleanTarget);
                        }
                      }
                    } catch (_) { }
                    return false;
                  }

                  /**
                   * Tenta usar a API 100% Local do Incogniton Desktop (127.0.0.1:35000) antes de qualquer MCP externo
                   */
                  async tryLocalIncognitonLaunch(profileBrowserId, onLog = console.log) {
                    try {
                      const cleanTarget = String(profileBrowserId || '').trim().toLowerCase();
                      const otherOpenNow = scanAllLockedProfilesByKernel().filter(id => id.toLowerCase() !== cleanTarget);
                      if (otherOpenNow.length > 0) {
                        const msg = `🚨 [MUTEX JANELA ÚNICA] Bloqueando abertura local de ${cleanTarget.slice(0, 8)} porque o perfil ${otherOpenNow[0].slice(0, 8)} já está aberto no Kernel!`;
                        onLog(msg);
                        throw new Error(msg);
                      }
                      await this.ensureIncognitonDesktopAccountForProfile(profileBrowserId, onLog);
                      const controller = new AbortController();
                      const timeout = setTimeout(() => controller.abort(), 25000);
                      const res = await fetch(`${LOCAL_INCOGNITON_URL}/automation/launch/puppeteer/${encodeURIComponent(profileBrowserId)}`, {
                        method: 'GET',
                        signal: controller.signal
                      });
                      clearTimeout(timeout);
                      if (res.ok) {
                        const data = await res.json();
                        const rawUrl = data?.puppeteerUrl || data?.cdp_url || data?.url || (data?.debugPort ? `http://127.0.0.1:${data.debugPort}` : null);
                        if (rawUrl) {
                          const cdpUrl = rawUrl.startsWith('http') ? rawUrl : `http://${rawUrl}`;
                          if (!this.constructor._activeLocalCdpByProfile) this.constructor._activeLocalCdpByProfile = new Map();
                          this.constructor._activeLocalCdpByProfile.set(String(profileBrowserId).trim().toLowerCase(), cdpUrl);
                          onLog(`[Incogniton Local] Perfil aberto via API Local (127.0.0.1:35000) -> ${cdpUrl}`);
                          return { cdp_url: cdpUrl, is_existing: false, mode: 'local_api' };
                        }
                      }
                      const fallbackPort = await this.probeProfileLocalDevToolsPort(profileBrowserId);
                      if (fallbackPort && fallbackPort.cdp_url) {
                        onLog(`[Incogniton Local] Perfil detectado ativo via DevToolsActivePort -> ${fallbackPort.cdp_url}`);
                        return { cdp_url: fallbackPort.cdp_url, is_existing: false, mode: 'local_api' };
                      }
                    } catch (localErr) {
                      if (localErr && localErr.message && localErr.message.includes('MUTEX JANELA ÚNICA')) {
                        throw localErr;
                      }
                      const fallbackPort = await this.probeProfileLocalDevToolsPort(profileBrowserId);
                      if (fallbackPort && fallbackPort.cdp_url) {
                        return { cdp_url: fallbackPort.cdp_url, is_existing: false, mode: 'local_api' };
                      }
                    }
                    return null;
                  }

                  async callMcp(toolName, args = {}, isRetry = false) {
                    if (!this.token) {
                      await this.autoRefreshMcpToken();
                    }
                    if (!this.token) {
                      throw new Error('Token MCP do Incogniton não configurado!');
                    }

                    const payload = {
                      jsonrpc: '2.0',
                      id: Date.now(),
                      method: 'tools/call',
                      params: {
                        name: toolName,
                        arguments: args
                      }
                    };

                    const mcpController = new AbortController();
                    const mcpTimeout = setTimeout(() => mcpController.abort(), 8000);
                    let response;
                    try {
                      response = await fetch(this.mcpUrl, {
                        method: 'POST',
                        headers: {
                          'Authorization': `Bearer ${this.token}`,
                          'Content-Type': 'application/json',
                          'MCP-Protocol-Version': '2026-05-15'
                        },
                        body: JSON.stringify(payload),
                        signal: mcpController.signal
                      });
                    } finally {
                      clearTimeout(mcpTimeout);
                    }

                    if (response.status === 401 && !isRetry) {
                      const refreshed = await this.autoRefreshMcpToken();
                      if (refreshed) {
                        return this.callMcp(toolName, args, true);
                      }
                    }

                    if (!response.ok) {
                      const errText = await response.text();
                      throw new Error(`Erro na API do Incogniton (${response.status}): ${errText}`);
                    }

                    const resJson = await response.json();
                    if (resJson.error) {
                      if (!isRetry && /Profile not found or you do not have access/i.test(String(resJson.error.message || ''))) {
                        const refreshed = await this.autoRefreshMcpToken();
                        if (refreshed) {
                          return this.callMcp(toolName, args, true);
                        }
                      }
                      throw new Error(`Erro MCP Incogniton [${resJson.error.code}]: ${resJson.error.message}`);
                    }

                    return resJson.result;
                  }

                  async ensureProfile4gProxyConfigured(profileBrowserId, onLog = console.log) {
                    const clean = String(profileBrowserId || '').trim().toLowerCase();
                    if (!clean || isLegacyFixedIpProfile(clean) || isProfileLockedByKernel(clean)) {
                      return { skipped: true };
                    }
                    if (!this.constructor._verified4gProxyProfiles) {
                      this.constructor._verified4gProxyProfiles = new Set();
                    }
                    if (this.constructor._verified4gProxyProfiles.has(clean)) {
                      return { success: true, already_configured: true, proxy_url: `127.0.0.1:${ADB_4G_PROXY_PORT}` };
                    }
                    if (MultiZenService && typeof MultiZenService.hasProfile === 'function' && MultiZenService.hasProfile(clean)) {
                      this.constructor._verified4gProxyProfiles.add(clean);
                      return { success: true, already_configured: true, mode: 'multizen_cloak_cpp', proxy_url: `127.0.0.1:${ADB_4G_PROXY_PORT}` };
                    }
                    const targetProxyUrl = `127.0.0.1:${ADB_4G_PROXY_PORT}`;

                    // 1. Verifica se o perfil já está configurado com 127.0.0.1:8080 no Incogniton (evitando chamadas desnecessárias ao edit_profile)
                    try {
                      const profiles = await this.getProfiles();
                      const found = Array.isArray(profiles)
                        ? profiles.find(p => String(p.profile_browser_ID || '').trim().toLowerCase() === clean)
                        : null;
                      if (
                        found &&
                        found.proxy &&
                        String(found.proxy.proxy_url || '').trim() === targetProxyUrl &&
                        (found.proxy.proxy_enabled === true || /http/i.test(String(found.proxy.connection_type || '')))
                      ) {
                        this.constructor._verified4gProxyProfiles.add(clean);
                        return { success: true, already_configured: true, proxy_url: targetProxyUrl };
                      }
                    } catch (_) { }

                    // 2. Tenta atualizar primeiro via API Local do Incogniton (127.0.0.1:35000/profile/update)
                    try {
                      const ctrl = new AbortController();
                      const tm = setTimeout(() => ctrl.abort(), 2500);
                      const localRes = await fetch(`${LOCAL_INCOGNITON_URL}/profile/update`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          profile_browser_id: profileBrowserId,
                          profileData: {
                            Proxy: {
                              connection_type: 'HTTP Proxy',
                              proxy_url: targetProxyUrl,
                              proxy_rotating: 1,
                              proxy_provider: 'main-ipinfo'
                            }
                          }
                        }),
                        signal: ctrl.signal
                      });
                      clearTimeout(tm);
                      if (localRes.ok) {
                        this.constructor._verified4gProxyProfiles.add(clean);
                        onLog(`📱 [Incogniton 4G Proxy Local] Perfil ${clean.slice(0, 8)} sincronizado via API Local (35000) no Proxy 4G ${targetProxyUrl}.`);
                        return { success: true, mode: 'local_api', proxy_url: targetProxyUrl };
                      }
                    } catch (_) { }

                    // 3. Atualiza via MCP Oficial (edit_profile)
                    try {
                      await this.callMcp('edit_profile', {
                        profile_browser_ID: profileBrowserId,
                        custom_proxy: {
                          connection_type: 'HTTP Proxy',
                          proxy_url: targetProxyUrl,
                          proxy_rotating: 1,
                          proxy_provider: 'main-ipinfo'
                        }
                      });
                      this.constructor._verified4gProxyProfiles.add(clean);
                      onLog(`📱 [Incogniton 4G Proxy] Perfil ${clean.slice(0, 8)} sincronizado no Proxy 4G ${targetProxyUrl} (HTTP Proxy Rotativo).`);
                      return { success: true, mode: 'mcp', proxy_url: targetProxyUrl };
                    } catch (err) {
                      return { success: false, error: err.message };
                    }
                  }

                  async getProfiles() {
                    const mergeMultiZen = (incList) => {
                      const out = Array.isArray(incList) ? [...incList] : [];
                      if (MultiZenService && typeof MultiZenService.listProfiles === 'function') {
                        const seen = new Set(out.map(p => String(p.profile_browser_ID || '').trim().toLowerCase()));
                        for (const mp of MultiZenService.listProfiles()) {
                          if (!mp || !mp.id) continue;
                          const clean = String(mp.id).trim().toLowerCase();
                          if (seen.has(clean)) continue;
                          seen.add(clean);
                          out.push({
                            profile_browser_ID: mp.id,
                            profile_name: `${mp.name} [MultiZen C++]`,
                            profile_tags: Array.isArray(mp.tags) ? mp.tags.join(',') : 'MULTIZEN_4G',
                            engine: 'multizen_cloak_cpp',
                            proxy: mp.proxy || { proxy_type: 'custom_proxy', proxy_enabled: true, connection_type: 'HTTP Proxy', proxy_url: '127.0.0.1:8080', proxy_rotating: 1 }
                          });
                        }
                      }
                      return out;
                    };

                    const safeLocalProfiles = [
                      {
                        profile_browser_ID: '00000000-0000-0000-0000-000000000001',
                        profile_name: 'PERFIL 01',
                        profile_tags: 'OPERARIA_CONTA_A',
                        proxy: { proxy_type: 'custom_proxy', proxy_enabled: true, connection_type: 'HTTP Proxy', proxy_url: '127.0.0.1:8080', proxy_rotating: 1 }
                      },
                      {
                        profile_browser_ID: '00000000-0000-0000-0000-000000000002',
                        profile_name: 'PERFIL 02',
                        profile_tags: 'OPERARIA_CONTA_B',
                        proxy: { proxy_type: 'custom_proxy', proxy_enabled: true, connection_type: 'HTTP Proxy', proxy_url: '127.0.0.1:8080', proxy_rotating: 1 }
                      },
                      {
                        profile_browser_ID: '00000000-0000-0000-0000-000000000003',
                        profile_name: 'PERFIL 03',
                        profile_tags: 'OPERARIA_CONTA_C',
                        proxy: { proxy_type: 'custom_proxy', proxy_enabled: true, connection_type: 'HTTP Proxy', proxy_url: '127.0.0.1:8080', proxy_rotating: 1 }
                      },
                      {
                        profile_browser_ID: '00000000-0000-0000-0000-000000000004',
                        profile_name: 'PERFIL 04 (MATRIZ)',
                        profile_tags: 'OPERARIA_MATRIZ',
                        proxy: { proxy_type: 'none', proxy_enabled: false }
                      }
                    ];

                    try {
                      const controller = new AbortController();
                      const timeout = setTimeout(() => controller.abort(), 1800);
                      const localRes = await fetch(`${LOCAL_INCOGNITON_URL}/profile/all`, { signal: controller.signal });
                      clearTimeout(timeout);
                      if (localRes.ok) {
                        const localData = await localRes.json();
                        const list = Array.isArray(localData?.profileData) ? localData.profileData : Array.isArray(localData) ? localData : null;
                        if (Array.isArray(list)) {
                          return mergeMultiZen(
                            list
                              .map((p) => ({
                                profile_browser_ID: p.general_profile_information?.browser_id || p.profile_browser_ID || p.id,
                                profile_name: p.general_profile_information?.profile_name || p.profile_name || p.name,
                                profile_tags: p.general_profile_information?.profile_group || p.profile_tags || '',
                                proxy: p.Proxy || p.proxy || null
                              }))
                              .filter((p) => Boolean(p.profile_browser_ID))
                          );
                        }
                      }
                    } catch (_) { }

                    if (!this.token) {
                      await this.autoRefreshMcpToken();
                    }
                    if (!this.token) {
                      return mergeMultiZen(safeLocalProfiles);
                    }

                    try {
                      const result = await this.callMcp('search_profiles', {});
                      const textContent = result.content?.find(c => c.type === 'text')?.text || '';

                      const jsonStart = textContent.indexOf('[');
                      const jsonEnd = textContent.lastIndexOf(']');
                      if (jsonStart !== -1 && jsonEnd !== -1) {
                        const jsonStr = textContent.substring(jsonStart, jsonEnd + 1);
                        const allProfiles = JSON.parse(jsonStr);
                        return mergeMultiZen(allProfiles);
                      }
                      return mergeMultiZen(safeLocalProfiles);
                    } catch (_) {
                      // Fallback silencioso para o cache local dos 4 perfis operários (PERFIL 01, 02, 03 e MATRIZ)
                      return mergeMultiZen(safeLocalProfiles);
                    }
                  }

                  async getLaunchStatus(requestId = null, profileBrowserId = null) {
                    const args = {};
                    if (requestId) args.request_id = requestId;
                    if (profileBrowserId) args.profile_browser_ID = profileBrowserId;

                    const result = await this.callMcp('get_launch_status', args);
                    const parsed = this.parseMcpResult(result);
                    if (Array.isArray(parsed.data)) {
                      return parsed.data;
                    }
                    if (parsed.data && typeof parsed.data === 'object') {
                      if (Array.isArray(parsed.data.launches)) return parsed.data.launches;
                      if (Array.isArray(parsed.data.statuses)) return parsed.data.statuses;
                      return [parsed.data];
                    }
                    return [];
                  }

                  /**
                   * Abre o perfil ou conecta na sessão já existente
                   * 1. Executa Pre-Flight checkSafeToLaunch (isola IP fechando outro perfil operário aberto)
                   * 2. Se a página tiver cdp_port manual ou API Local 127.0.0.1:35000 responder, usa 100% local
                   * 3. Caso contrário, verifica sessão aberta / inicia via Incogniton
                   */
                  async ensureProfileLaunched(profileBrowserId, onLog = console.log, customCdpPort = null) {
                    // 0. FAST-PATH LOCAL: Verifica primeiro se o perfil já está aberto localmente (cache CDP ou DevToolsActivePort) em ~15ms
                    // Se já estiver aberto, reutiliza a sessão atual sem fechar navegador nem esbarrar na trava 1x/dia!
                    const localDevTools = await this.probeProfileLocalDevToolsPort(profileBrowserId);
                    if (localDevTools && localDevTools.cdp_url) {
                      writeCrossProcessProfileLock(profileBrowserId, { cdp_url: localDevTools.cdp_url, mode: 'incogniton_existing' });
                      onLog(`[Incogniton Local] Perfil já aberto localmente (${localDevTools.cdp_url}). Reutilizando sessão instantaneamente...`);
                      return { cdp_url: localDevTools.cdp_url, is_existing: true, mode: 'incogniton_existing' };
                    }

                    // 0b. TRAVA MECÂNICA HARD-LOCK (1X POR DIA NO 4G):
                    // Antes de fechar qualquer outro perfil (checkSafeToLaunch) ou girar o IP 4G, verifica no IMMUTABLE_HARD_MEMORY.json
                    // e no database.json se este perfil 4G já abriu e rodou sua única sessão diária hoje!
                    if (!isLegacyFixedIpProfile(profileBrowserId)) {
                      const cleanPid = String(profileBrowserId || '').trim().toLowerCase();
                      const todayBrt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
                      let lockedDate = null;
                      try {
                        const dbPath = path.join(__dirname, 'database.json');
                        if (fs.existsSync(dbPath)) {
                          const dbRaw = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
                          lockedDate = dbRaw?.settings?.daily_profile_session_by_id?.[cleanPid] || null;
                        }
                      } catch (_) { }
                      if (!lockedDate) {
                        try {
                          const hardMemPath = path.join(__dirname, 'IMMUTABLE_HARD_MEMORY.json');
                          if (fs.existsSync(hardMemPath)) {
                            const hm = JSON.parse(fs.readFileSync(hardMemPath, 'utf8'));
                            lockedDate = hm?.locked_4g_profiles_by_date?.[cleanPid] || null;
                          }
                        } catch (_) { }
                      }
                      if (lockedDate === todayBrt) {
                        const lockMsg = `🛑 [HARD LOCK 4G 1X/DIA] BLOQUEIO MECÂNICO ABSOLUTO: O perfil 4G (${cleanPid.slice(0, 8)}) já realizou sua única sessão diária permitida hoje (${todayBrt}). Proibido reabrir no mesmo dia para proteger contra troca de IP 4G.`;
                        onLog(lockMsg);
                        throw new Error(lockMsg);
                      }
                    }

                    // Pre-Flight de isolamento de IP Único (verifica e encerra outro perfil aberto antes de abrir o alvo)
                    await this.checkSafeToLaunch(profileBrowserId, onLog);

                    // Registra lock cross-processo imediatamente após o Pre-Flight aprovar a abertura!
                    writeCrossProcessProfileLock(profileBrowserId, { status: 'LAUNCHING' });

                    // 1a.2. SUPORTE NATIVO MULTIZEN C++ (CloakBrowser 146 — Perfis Ilimitados Local SQLite):
                    let isMultiZenFromDb = false;
                    try {
                      const dbMod = require('./db');
                      if (dbMod && typeof dbMod.getPages === 'function') {
                        isMultiZenFromDb = dbMod.getPages().some(p => String(p.profile_browser_ID || '').trim().toLowerCase() === String(profileBrowserId || '').trim().toLowerCase() && p.browser_engine === 'multizen');
                      }
                    } catch (_) { }

                    // BLINDAGEM ANTI-COLISÃO CONTA MATRIZ (PERFIL 04 = 00000000-0000-0000-0000-000000000004):
                    // Perfis legados IP Fixo / Matriz NUNCA são desviados para clones vazios no MultiZen sem opt-in explícito.
                    const isProtectedMatrizOrFixedProfile = isLegacyFixedIpProfile(profileBrowserId) && process.env.FORCE_MULTIZEN_MATRIZ !== '1';
                    const isMultiZenTarget = !isProtectedMatrizOrFixedProfile && Boolean(
                      (MultiZenService && typeof MultiZenService.hasProfile === 'function' && MultiZenService.hasProfile(profileBrowserId)) ||
                      isMultiZenFromDb
                    );
                    if (isMultiZenTarget && MultiZenService) {
                      onLog(`🦊 [MultiZen C++ CloakBrowser] Abrindo perfil isolado MultiZen (${String(profileBrowserId).slice(0, 8)}) no túnel 4G...`);
                      const mzLaunched = await MultiZenService.ensureProfileLaunched(profileBrowserId, onLog, customCdpPort);
                      if (mzLaunched && mzLaunched.cdp_url) {
                        if (!this.constructor._activeLocalCdpByProfile) this.constructor._activeLocalCdpByProfile = new Map();
                        this.constructor._activeLocalCdpByProfile.set(String(profileBrowserId).trim().toLowerCase(), mzLaunched.cdp_url);
                        writeCrossProcessProfileLock(profileBrowserId, { cdp_url: mzLaunched.cdp_url, mode: 'multizen' });
                      }
                      return mzLaunched;
                    }

                    onLog(`[Incogniton MCP] Verificando via MCP se perfil ${profileBrowserId} já possui sessão ativa...`);

                    // 1b. Verifica via Conector Oficial MCP (get_launch_status) se já está LAUNCHED com cdp_url
                    try {
                      const existingStatuses = await this.getLaunchStatus(null, profileBrowserId);
                      if (Array.isArray(existingStatuses) && existingStatuses.length > 0) {
                        const active = existingStatuses.find(s => s.status === 'LAUNCHED' && s.cdp_url);
                        if (active && active.cdp_url) {
                          const probe = await this.probeLocalCdpPort(active.cdp_url);
                          if (probe) {
                            writeCrossProcessProfileLock(profileBrowserId, { cdp_url: active.cdp_url, mode: 'mcp_existing' });
                            onLog(`[Incogniton MCP] Perfil já ativo no MCP! Conectado à sessão MCP em ${active.cdp_url}`);
                            return { cdp_url: active.cdp_url, is_existing: true, mode: 'mcp' };
                          }
                        }
                      }
                    } catch (checkErr) {
                      onLog(`[Incogniton MCP] Aviso ao checar get_launch_status: ${checkErr.message}`);
                    }

                    // 1c-0. FIREWALL ANTI-VAZAMENTO 4G NA MATRIZ: Se for PERFIL 04 (IP Fixo), garante WITHOUT_PROXY antes de abrir!
                    if (isLegacyFixedIpProfile(profileBrowserId)) {
                      try {
                        const ctrlNoProxy = new AbortController();
                        const tmNoProxy = setTimeout(() => ctrlNoProxy.abort(), 2000);
                        await fetch(`${LOCAL_INCOGNITON_URL}/profile/update`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            profile_browser_id: profileBrowserId,
                            profileData: { Proxy: { connection_type: 'WITHOUT_PROXY', proxy_url: '' } }
                          }),
                          signal: ctrlNoProxy.signal
                        }).catch(() => { });
                        clearTimeout(tmNoProxy);
                      } catch (_) { }
                    }

                    // 1c. Tenta abrir primeiro via API Local 127.0.0.1:35000 (/automation/launch/puppeteer/{id})
                    const localApiLaunch = await this.tryLocalIncognitonLaunch(profileBrowserId, onLog);
                    if (localApiLaunch && localApiLaunch.cdp_url) {
                      writeCrossProcessProfileLock(profileBrowserId, { cdp_url: localApiLaunch.cdp_url, mode: 'local_api' });
                      return localApiLaunch;
                    }

                    // 1d. Re-verificação de Mutex no Kernel antes do MCP launch_profile (isolado entre Matriz IP Fixo e MultiZen 4G)
                    const cleanTargetMcp = String(profileBrowserId || '').trim().toLowerCase();
                    const isTargetFixedMcp = isLegacyFixedIpProfile(cleanTargetMcp);
                    const otherOpenBeforeMcp = scanAllLockedProfilesByKernel().filter(id => {
                      const cleanOther = id.toLowerCase();
                      if (cleanOther === cleanTargetMcp) return false;
                      if (isTargetFixedMcp && MultiZenService && typeof MultiZenService.hasProfile === 'function' && MultiZenService.hasProfile(id)) return false;
                      if (!isTargetFixedMcp && isLegacyFixedIpProfile(cleanOther)) return false;
                      return true;
                    });
                    if (otherOpenBeforeMcp.length > 0) {
                      const msg = `🚨 [MUTEX JANELA ÚNICA] Bloqueando launch_profile MCP de ${cleanTargetMcp.slice(0, 8)} porque o perfil ${otherOpenBeforeMcp[0].slice(0, 8)} já está aberto no Kernel!`;
                      onLog(msg);
                      throw new Error(msg);
                    }

                    // 2. Solicita abertura via Conector Oficial MCP (launch_profile) com Auto-Heal de até 3 tentativas contra sessão fantasma ("already running on 'Unknown Device'")
                    onLog(`[Incogniton MCP] Solicitando abertura do perfil via MCP (launch_profile)...`);
                    let launchResult = null;
                    for (let ghostAttempt = 1; ghostAttempt <= 3; ghostAttempt++) {
                      try {
                        launchResult = await this.callMcp('launch_profile', {
                          profile_browser_ID: profileBrowserId
                        });
                        break;
                      } catch (launchErr) {
                        const errMsg = String(launchErr?.message || '');
                        if (/already running on/i.test(errMsg)) {
                          onLog(`⚡ [Auto-Heal Pós-Queda de Energia • Tentativa ${ghostAttempt}/3] Incogniton Cloud reportou sessão fantasma ("already running on Unknown Device") em ${String(profileBrowserId).slice(0, 8)}. Enviando stop_profile + /profile/stop local e aguardando 6.5s...`);
                          await this.callMcp('stop_profile', { profile_browser_ID: profileBrowserId }).catch(() => { });
                          try {
                            const ctrlStop = new AbortController();
                            const tStop = setTimeout(() => ctrlStop.abort(), 4500);
                            await fetch(`${LOCAL_INCOGNITON_URL}/profile/stop/${encodeURIComponent(profileBrowserId)}`, { signal: ctrlStop.signal }).catch(() => { });
                            clearTimeout(tStop);
                          } catch (_) { }
                          await new Promise(r => setTimeout(r, 6500));
                          const localRetryAfterStop = await this.tryLocalIncognitonLaunch(profileBrowserId, onLog);
                          if (localRetryAfterStop && localRetryAfterStop.cdp_url) {
                            writeCrossProcessProfileLock(profileBrowserId, { cdp_url: localRetryAfterStop.cdp_url, mode: 'local_after_ghost_heal' });
                            return localRetryAfterStop;
                          }
                          if (ghostAttempt === 3) {
                            launchResult = await this.callMcp('launch_profile', {
                              profile_browser_ID: profileBrowserId
                            });
                          }
                        } else {
                          throw launchErr;
                        }
                      }
                    }

                    let launchText = launchResult.content?.find(c => c.type === 'text')?.text || '';
                    onLog(`[Incogniton MCP] Resposta do launch_profile: ${launchText}`);

                    // Se o Incogniton Cloud tiver 2 sessões fantasma após troca de placa 4G/Cabo ("Multiple active sessions found"),
                    // extrai os Session IDs (do mais recente para o mais antigo) e dispara com target_session_id!
                    if (/Multiple active sessions found/i.test(launchText)) {
                      const sessionMatches = [...launchText.matchAll(/Session ID:\s*(\d+)/gi)]
                        .map(m => parseInt(m[1], 10))
                        .filter(n => Number.isFinite(n))
                        .sort((a, b) => b - a);
                      for (const sid of sessionMatches) {
                        onLog(`[Incogniton MCP] Selecionando sessão ativa mais recente (target_session_id: ${sid})...`);
                        const retryRes = await this.callMcp('launch_profile', {
                          profile_browser_ID: profileBrowserId,
                          target_session_id: sid
                        });
                        const retryTxt = retryRes.content?.find(c => c.type === 'text')?.text || '';
                        onLog(`[Incogniton MCP] Resposta launch_profile (session ${sid}): ${retryTxt}`);
                        if (retryTxt && !/Multiple active sessions/i.test(retryTxt)) {
                          launchResult = retryRes;
                          launchText = retryTxt;
                          break;
                        }
                      }
                    }

                    const matchReq = launchText.match(/request ID[:\s]+(\d+)/i) || launchText.match(/"request_id":\s*(\d+)/);
                    const requestId = matchReq ? parseInt(matchReq[1], 10) : null;

                    onLog(`[Incogniton MCP] Aguardando confirmação de status LAUNCHED via get_launch_status...`);
                    const maxRetries = 25;
                    for (let i = 0; i < maxRetries; i++) {
                      await new Promise(r => setTimeout(r, 2000));

                      try {
                        const statuses = await this.getLaunchStatus(requestId, profileBrowserId);
                        if (Array.isArray(statuses) && statuses.length > 0) {
                          const current = statuses.find(s => s.status === 'LAUNCHED' && s.cdp_url) || statuses[0];

                          if (current.status === 'LAUNCHED' && current.cdp_url) {
                            writeCrossProcessProfileLock(profileBrowserId, { cdp_url: current.cdp_url, mode: 'mcp' });
                            onLog(`[Incogniton MCP] Perfil LAUNCHED confirmado pelo MCP! cdp_url: ${current.cdp_url}`);
                            return { cdp_url: current.cdp_url, is_existing: false, mode: 'mcp' };
                          }

                          if (current.status === 'CANCELLED' || current.status === 'EXPIRED') {
                            throw new Error(`Abertura do perfil via MCP falhou com status: ${current.status}`);
                          }
                        }
                      } catch (pollErr) {
                        if (pollErr.message && pollErr.message.includes('falhou com status')) throw pollErr;
                      }

                      // Fallback de leitura da porta se o perfil já abriu no Incogniton Desktop após launch_profile
                      if (i >= 3) {
                        const activeLocalPort = await this.probeProfileLocalDevToolsPort(profileBrowserId);
                        if (activeLocalPort && activeLocalPort.cdp_url) {
                          writeCrossProcessProfileLock(profileBrowserId, { cdp_url: activeLocalPort.cdp_url, mode: 'mcp_local_fallback' });
                          onLog(`[Incogniton MCP] Perfil aberto via launch_profile confirmado em ${activeLocalPort.cdp_url}`);
                          return { cdp_url: activeLocalPort.cdp_url, is_existing: false, mode: 'mcp' };
                        }
                      }

                      onLog(`[Incogniton MCP] Aguardando Incogniton iniciar o perfil (${i + 1}/${maxRetries})...`);
                    }

                    throw new Error('Tempo limite excedido aguardando o Incogniton MCP confirmar a abertura do perfil.');
                  }

                  /**
                   * Conecta ao browser do Incogniton via cdp_url local (com Auto-Heal contra aba travada / Network.enable timed out)
                   */
                  async connectBrowser(cdpUrl) {
                    // Limpa instantaneamente abas extras de fundo (YouTube, BusinessInsider, ipify, abas duplicadas) via HTTP /json/close
                    // para que apenas 1 aba principal consuma o túnel 4G (jamais fecha abas em checkpoint/2FA).
                    try {
                      const base = String(cdpUrl || '').replace(/\/$/, '');
                      const listRes = await fetch(`${base}/json/list`);
                      if (listRes.ok) {
                        const listJson = await listRes.json();
                        const pageTabs = (Array.isArray(listJson) ? listJson : []).filter(t => t && t.type === 'page' && t.id);
                        if (pageTabs.length > 1) {
                          const isFbRoot = (u) => /^https:\/\/(www|web)\.facebook\.com\/(\?.*|#.*)?$/i.test(String(u || ''));
                          const isFbAny = (u) => String(u || '').toLowerCase().includes('facebook.com');
                          const keepTab = pageTabs.find(t => isFbRoot(t.url)) || pageTabs.find(t => isFbAny(t.url)) || pageTabs[0];
                          let closedAny = false;
                          for (const t of pageTabs) {
                            if (t.id === keepTab.id) continue;
                            const u = String(t.url || '').toLowerCase();
                            if (
                              u.includes('checkpoint') ||
                              u.includes('two_step_verification') ||
                              u.includes('approvals_code') ||
                              u.includes('auth_platform') ||
                              u.includes('google.com') ||
                              u.includes('gmail.com') ||
                              u.includes('outlook.live.com') ||
                              u.includes('proton.me')
                            ) {
                              continue;
                            }
                            await fetch(`${base}/json/close/${t.id}`).catch(() => { });
                            closedAny = true;
                          }
                          if (closedAny) {
                            await new Promise(r => setTimeout(r, 400));
                          }
                        }
                      }
                    } catch (_) { }

                    try {
                      const browser = await puppeteer.connect({
                        browserURL: cdpUrl,
                        defaultViewport: null,
                        protocolTimeout: 95000,
                        targetFilter: CLOAK_TARGET_FILTER
                      });
                      return browser;
                    } catch (err) {
                      if (/main frame too early/i.test(String(err && err.message))) {
                        await new Promise(r => setTimeout(r, 600));
                        return await puppeteer.connect({
                          browserURL: cdpUrl,
                          defaultViewport: null,
                          protocolTimeout: 95000,
                          targetFilter: CLOAK_TARGET_FILTER
                        });
                      }
                      if (/timed out/i.test(String(err && err.message))) {
                        await new Promise(r => setTimeout(r, 500));
                        return await puppeteer.connect({
                          browserURL: cdpUrl,
                          defaultViewport: null,
                          protocolTimeout: 110000,
                          targetFilter: CLOAK_TARGET_FILTER
                        });
                      }
                      throw err;
                    }
                  }

                  /**
                   * Verifica via CDP (/json/list) se o perfil possui alguma aba aberta em tela de Checkpoint / Verificação de Identidade.
                   * Se for um desafio de login 2FA (two_step_verification / approvals_code) e a conta tiver `totp_secret` no Cofre 2FA,
                   * tenta preencher automaticamente via `automator.tryAutoFill2faTotp` (com `humanTypeText`) antes de tratar como checkpoint de bloqueio!
                   */
                  async hasLiveCheckpointTab(profileBrowserId, onLog = console.log) {
                    try {
                      const localDevTools = await this.probeProfileLocalDevToolsPort(profileBrowserId);
                      if (!localDevTools || !localDevTools.cdp_url) return false;

                      const fetchTabs = async () => {
                        const controller = new AbortController();
                        const timeout = setTimeout(() => controller.abort(), 1500);
                        const res = await fetch(`${localDevTools.cdp_url}/json/list`, { signal: controller.signal });
                        clearTimeout(timeout);
                        if (!res.ok) return [];
                        const tabs = await res.json();
                        return Array.isArray(tabs) ? tabs : [];
                      };

                      const isTabCheckpointOr2fa = (tab) => {
                        const u = String(tab.url || '').toLowerCase();
                        const t = String(tab.title || '').toLowerCase();
                        return (
                          u.includes('/checkpoint') ||
                          u.includes('two_step_verification') ||
                          u.includes('approvals_code') ||
                          t.includes('checkpoint') ||
                          t.includes('confirme sua identidade') ||
                          t.includes('confirm your identity')
                        );
                      };

                      const tabs = await fetchTabs();
                      if (!tabs.some(isTabCheckpointOr2fa)) return false;

                      let totpSecret = null;
                      try {
                        const pFile = path.join(__dirname, 'warming_accounts_pipeline.json');
                        if (fs.existsSync(pFile)) {
                          const pData = JSON.parse(fs.readFileSync(pFile, 'utf8'));
                          const cleanId = String(profileBrowserId || '').trim().toLowerCase();
                          const matchedAcc = (pData.accounts || []).find(
                            a => String(a.incogniton_profile_id || '').trim().toLowerCase() === cleanId && a.totp_secret
                          );
                          if (matchedAcc && matchedAcc.totp_secret) {
                            totpSecret = matchedAcc.totp_secret;
                          }
                        }
                      } catch (_) { }

                      if (totpSecret) {
                        let browser = null;
                        try {
                          const automator = require('./automator');
                          browser = await this.connectBrowser(localDevTools.cdp_url);
                          const pages = await browser.pages().catch(() => []);
                          for (const p of pages) {
                            await automator.tryAutoFill2faTotp(p, totpSecret, onLog);
                          }
                        } catch (_) {
                        } finally {
                          try { if (browser) browser.disconnect(); } catch (_) { }
                        }

                        const tabsAfter = await fetchTabs();
                        if (!tabsAfter.some(isTabCheckpointOr2fa)) {
                          markProfileCheckpoint(profileBrowserId, false);
                          return false;
                        }
                      }

                      return true;
                    } catch (_) {
                      return false;
                    }
                  }

                  /**
                   * Fecha o perfil operário via MCP v5 oficial (`stop_profile`) com fallback na API Local 35000
                   * e aguarda confirmação via `get_launch_status` / `get_eligible_sessions` até zerar a sessão no IP.
                   * REGRA DE OURO: JAMAIS fecha perfil ou aba que esteja em CHECKPOINT!
                   */
                  async stopProfile(profileBrowserId, onLogOrOptions = console.log, forceCloseCheckpoint = true, extraOptions = {}) {
                    let onLog = console.log;
                    let options = (extraOptions && typeof extraOptions === 'object') ? { ...extraOptions } : {};
                    if (typeof onLogOrOptions === 'function') {
                      onLog = onLogOrOptions;
                    } else if (onLogOrOptions && typeof onLogOrOptions === 'object') {
                      options = { ...options, ...onLogOrOptions };
                      if (typeof options.onLog === 'function') onLog = options.onLog;
                      if (options.forceCloseCheckpoint !== undefined) forceCloseCheckpoint = Boolean(options.forceCloseCheckpoint);
                    }

                    if (!profileBrowserId || isBlockedMatrixProfile(profileBrowserId)) return false;

                    if (!forceCloseCheckpoint) {
                      const hasLiveCp = await this.hasLiveCheckpointTab(profileBrowserId, onLog);
                      if (isCheckpointProtectedProfile(profileBrowserId) || hasLiveCp) {
                        markProfileCheckpoint(profileBrowserId, true);
                        onLog(`🚨 [PROTEÇÃO DE CHECKPOINT] Perfil ${String(profileBrowserId).slice(0, 8)} está em Checkpoint! Mantendo aberto.`);
                        return false;
                      }
                    } else {
                      markProfileCheckpoint(profileBrowserId, false);
                    }

                    const targetClean = String(profileBrowserId).trim().toLowerCase();
                    removeCrossProcessProfileLock(targetClean);
                    let stopIssued = false;

                    const record4gDailySessionLockOnStop = () => {
                      try {
                        if (isLegacyFixedIpProfile(targetClean)) return;
                        if (options && options.allowDailyLock === false) {
                          onLog(`🛡️ [Anti-Trava Prematura 4G] Perfil 4G (${targetClean.slice(0, 8)}) encerrado sem queimar lock diário (${options.reason || 'allowDailyLock=false'}).`);
                          return;
                        }
                        const todayBrt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
                        let hasPostedTodayInDb = Boolean(options && options.allowDailyLock === true);
                        if (!hasPostedTodayInDb) {
                          try {
                            const dbPath = path.join(__dirname, 'database.json');
                            if (fs.existsSync(dbPath)) {
                              const dbRaw = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
                              const profPages = (dbRaw.pages || []).filter(
                                p => p && String(p.profile_browser_ID || '').trim().toLowerCase() === targetClean
                              );
                              hasPostedTodayInDb = profPages.some(
                                p => Number(p.posts_today || 0) > 0 && (!p.last_post_date || p.last_post_date === todayBrt)
                              );
                            }
                          } catch (_) { }
                        }

                        if (!hasPostedTodayInDb) {
                          onLog(`🛡️ [Anti-Trava Prematura 4G] Perfil 4G (${targetClean.slice(0, 8)}) fechou com 0 posts gravados hoje — lock 1x/dia preservado para permitir abertura real.`);
                          return;
                        }

                        const hardMemPath = path.join(__dirname, 'IMMUTABLE_HARD_MEMORY.json');
                        if (fs.existsSync(hardMemPath)) {
                          const hm = JSON.parse(fs.readFileSync(hardMemPath, 'utf8'));
                          if (!hm.locked_4g_profiles_by_date || typeof hm.locked_4g_profiles_by_date !== 'object') {
                            hm.locked_4g_profiles_by_date = {};
                          }
                          if (hm.locked_4g_profiles_by_date[targetClean] !== todayBrt) {
                            hm.locked_4g_profiles_by_date[targetClean] = todayBrt;
                            hm.updated_at = new Date().toISOString();
                            fs.writeFileSync(hardMemPath, JSON.stringify(hm, null, 2), 'utf8');
                            onLog(`🔒 [HARD LOCK 4G 1X/DIA] Perfil 4G (${targetClean.slice(0, 8)}) gravado em IMMUTABLE_HARD_MEMORY.json como CONCLUÍDO hoje (${todayBrt}).`);
                          }
                        }
                      } catch (_) { }
                    };

                    // 0.0. Se for perfil do MultiZen C++ (CloakBrowser 146), encerra via MultiZenService + CDP Browser.close
                    if (MultiZenService && typeof MultiZenService.hasProfile === 'function' && MultiZenService.hasProfile(profileBrowserId)) {
                      try {
                        const localMz = await MultiZenService.probeProfileLocalDevToolsPort(profileBrowserId);
                        if (localMz && localMz.cdp_url) {
                          const b = await puppeteer.connect({ browserURL: localMz.cdp_url, defaultViewport: null, protocolTimeout: 4000, targetFilter: CLOAK_TARGET_FILTER }).catch(() => null);
                          if (b) {
                            try {
                              const pages = await b.pages().catch(() => []);
                              for (const pg of pages) {
                                await pg.evaluate(() => {
                                  try {
                                    window.onbeforeunload = null;
                                    window.addEventListener('beforeunload', (e) => { e.stopImmediatePropagation(); }, true);
                                  } catch (_) { }
                                }).catch(() => { });
                              }
                            } catch (_) { }
                            await b.close().catch(() => { });
                          }
                        }
                        if (typeof MultiZenService.stopProfile === 'function') {
                          await MultiZenService.stopProfile(profileBrowserId, onLog);
                        }
                        if (this.constructor._activeLocalCdpByProfile) {
                          this.constructor._activeLocalCdpByProfile.delete(targetClean);
                        }
                        removeCrossProcessProfileLock(targetClean);
                        record4gDailySessionLockOnStop();
                        return true;
                      } catch (_) { }
                    }

                    // 0. Tenta encerrar via API Local 127.0.0.1:35000 (/profile/stop/{id})
                    try {
                      const ctrl = new AbortController();
                      const tm = setTimeout(() => ctrl.abort(), 3500);
                      const localStopRes = await fetch(`${LOCAL_INCOGNITON_URL}/profile/stop/${encodeURIComponent(profileBrowserId)}`, { signal: ctrl.signal });
                      clearTimeout(tm);
                      if (localStopRes.ok) {
                        stopIssued = true;
                        onLog(`[Incogniton Local] Comando stop enviado via API Local (127.0.0.1:35000) para ${profileBrowserId.slice(0, 8)}...`);
                      }
                    } catch (_) { }

                    // 1. Chamada oficial ao Conector MCP v5 `stop_profile`
                    if (!stopIssued) {
                      try {
                        onLog(`[Incogniton MCP] Encerrando perfil ${profileBrowserId.slice(0, 8)} via MCP v5 (stop_profile)...`);
                        await this.callMcp('stop_profile', {
                          profile_browser_ID: profileBrowserId,
                          timeout_seconds: 60
                        });
                        stopIssued = true;
                      } catch (mcpErr) {
                        onLog(`[Incogniton MCP] Aviso ao chamar stop_profile via MCP (${mcpErr.message}).`);
                      }
                    }

                    // 2. Polling rápido de confirmação + fechamento imediato via CDP se o MCP não tinha a sessão
                    const maxPolls = 8;
                    for (let attempt = 0; attempt < maxPolls; attempt++) {
                      const localPortStillAlive = await this.probeProfileLocalDevToolsPort(profileBrowserId);
                      if (localPortStillAlive && localPortStillAlive.cdp_url) {
                        if (!stopIssued || attempt >= 1) {
                          try {
                            const b = await puppeteer.connect({
                              browserURL: localPortStillAlive.cdp_url,
                              defaultViewport: null,
                              protocolTimeout: 3500,
                              targetFilter: CLOAK_TARGET_FILTER
                            });
                            try {
                              const pages = await b.pages().catch(() => []);
                              for (const pg of pages) {
                                try {
                                  const cdp = await pg.target().createCDPSession();
                                  await cdp.send('Page.enable').catch(() => { });
                                  await cdp.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => { });
                                } catch (_) { }
                                await pg.evaluate(() => {
                                  try {
                                    window.onbeforeunload = null;
                                    window.addEventListener('beforeunload', (e) => { e.stopImmediatePropagation(); }, true);
                                  } catch (_) { }
                                }).catch(() => { });
                              }
                            } catch (_) { }
                            await b.close().catch(() => { });
                          } catch (_) { }
                          if (attempt >= 2) {
                            try {
                              execFileSync(
                                'powershell.exe',
                                [
                                  '-NoProfile',
                                  '-Command',
                                  `Get-CimInstance Win32_Process -Filter "Name='chrome.exe' AND CommandLine LIKE '%${targetClean}%'" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`
                                ],
                                { timeout: 3500, stdio: 'ignore', windowsHide: true }
                              );
                            } catch (_) { }
                          }
                          if (this.constructor._activeLocalCdpByProfile) {
                            this.constructor._activeLocalCdpByProfile.delete(targetClean);
                          }
                        }
                        await new Promise(r => setTimeout(r, 1200));
                        continue;
                      }

                      if (this.constructor._activeLocalCdpByProfile) {
                        this.constructor._activeLocalCdpByProfile.delete(targetClean);
                      }

                      const osCheck = this.inspectWindowsRunningProfiles();
                      const stillRunningInOs = osCheck.activeWorkerIds.some(id => id.toLowerCase() === targetClean);

                      if (!localPortStillAlive && !stillRunningInOs) {
                        removeCrossProcessProfileLock(targetClean);
                        record4gDailySessionLockOnStop();
                        onLog(`[Isolamento de IP] Perfil ${profileBrowserId.slice(0, 8)} confirmado 100% encerrado (Porta TCP fechada + Processo Chromium finalizado).`);
                        return true;
                      }

                      if (attempt >= 2 && stillRunningInOs) {
                        try {
                          execFileSync(
                            'powershell.exe',
                            [
                              '-NoProfile',
                              '-Command',
                              `Get-CimInstance Win32_Process -Filter "Name='chrome.exe' AND CommandLine LIKE '%${targetClean}%'" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`
                            ],
                            { timeout: 3500, stdio: 'ignore', windowsHide: true }
                          );
                        } catch (_) { }
                      }

                      await new Promise(r => setTimeout(r, 1200));
                    }

                    if (this.constructor._activeLocalCdpByProfile) {
                      this.constructor._activeLocalCdpByProfile.delete(targetClean);
                    }
                    removeCrossProcessProfileLock(targetClean);
                    record4gDailySessionLockOnStop();
                    onLog(`[Isolamento de IP] Encerramento finalizado para o perfil ${profileBrowserId.slice(0, 8)}.`);
                    return stopIssued;
                  }

                  /**
                   * Fecha e exclui permanentemente um perfil do Incogniton (127.0.0.1:35000/profile/delete/{id})
                   * para liberar vaga imediata no limite de 10 perfis quando a conta vai para o Cemitério.
                   */
                  async deleteProfile(profileBrowserId, onLog = console.log) {
                    const cleanId = String(profileBrowserId || '').trim();
                    if (!cleanId) return { success: false, error: 'profileBrowserId vazio' };
                    try {
                      await this.stopProfile(cleanId, onLog);
                    } catch (_) { }
                    try {
                      const ctrl = new AbortController();
                      const t = setTimeout(() => ctrl.abort(), 8000);
                      const res = await fetch(`${LOCAL_INCOGNITON_URL}/profile/delete/${encodeURIComponent(cleanId)}`, { signal: ctrl.signal });
                      clearTimeout(t);
                      const txt = await res.text();
                      onLog(`🗑️ [Incogniton] Perfil ${cleanId.slice(0, 8)} excluído do Incogniton para abrir vaga (${txt}).`);
                      return { success: res.ok, status: res.status, message: txt };
                    } catch (err) {
                      onLog(`⚠️ [Incogniton] Aviso ao excluir perfil ${cleanId.slice(0, 8)}: ${err.message}`);
                      return { success: false, error: err.message };
                    }
                  }

                  /**
                   * Cria um perfil do zero no Incogniton já configurado com:
                   * - Proxy HTTP do Túnel 4G ADB (`http://127.0.0.1:8080`)
                   * - WebRTC `disable_non_proxied_udp` / disabled
                   * - Timezone `America/Sao_Paulo`, Idioma `pt-BR,pt,en-US,en`, OS `Windows`
                   * - Higienização preventiva de disco (`sanitizeProfileDiskBeforeLaunch`) antes do 1º launch!
                   */
                  async create4gProfileFromScratch(options = {}, onLog = console.log) {
                    const rawName = String(options.profile_name || `CONTA 4G - ${new Date().toLocaleDateString('pt-BR')}`).trim();
                    const profileName = rawName.replace(/[^\x20-\x7EÀ-ÿ•()-]/g, '').replace(/\s+/g, ' ').trim() || rawName;
                    const proxyHostPort = String(options.proxy_host_port || '127.0.0.1:8080').trim();

                    ensureAdbProxyTunnelAndWifiOff(ADB_4G_PROXY_PORT, onLog);

                    // 0. Verifica primeiro se o perfil já existe (no MultiZen ou Incogniton) para nunca duplicar!
                    try {
                      const existingList = await this.getProfiles();
                      const foundExisting = (existingList || []).find(p => {
                        const pName = String(p.profile_name || '').toLowerCase().replace(/\s*\[multizen c\+\+\]\s*/i, '').trim();
                        return pName === profileName.toLowerCase() || pName === rawName.toLowerCase() || (profileName.length >= 6 && pName.includes(profileName.toLowerCase()));
                      });
                      if (foundExisting && foundExisting.profile_browser_ID) {
                        if (!MultiZenService || !MultiZenService.hasProfile(foundExisting.profile_browser_ID)) {
                          sanitizeProfileDiskBeforeLaunch(foundExisting.profile_browser_ID, onLog);
                        }
                        onLog(`♻️ [Reuso Anti-Duplicação] Reutilizando perfil já existente: "${foundExisting.profile_name}" (${foundExisting.profile_browser_ID})`);
                        return { success: true, profile_browser_ID: foundExisting.profile_browser_ID, profile_name: foundExisting.profile_name, proxy: proxyHostPort };
                      }
                    } catch (_) { }

                    // 0.5. MOTOR PRIMÁRIO PADRÃO ("DAQUI PRA FRENTE 100% MULTIZEN C++ CLOAKBROWSER 146"):
                    // Cria todas as novas contas direto no MultiZen C++ (CloakBrowser 146.0.7680.177.5 + SQLite local ilimitado),
                    // a menos que options.force_incogniton === true seja passado explicitamente.
                    if (options.force_incogniton !== true && MultiZenService && typeof MultiZenService.createProfile === 'function' && MultiZenService.isInstalled()) {
                      try {
                        const mzCreated = MultiZenService.createProfile({
                          name: profileName,
                          notes: options.notes || 'Criado via Forja Raiz 2026 no MultiZen C++ CloakBrowser 146 (Proxy 4G ADB 127.0.0.1:8080)',
                          proxyHostPort,
                          tags: ['4G_VIVO', 'MULTIZEN_CPP', 'OPERACAO_001']
                        });
                        if (mzCreated && mzCreated.profile_browser_ID) {
                          onLog(`🦊 [MultiZen C++ CloakBrowser 146 • Motor Primário] Perfil "${profileName}" criado no MultiZen (${mzCreated.profile_browser_ID}) com Proxy 4G ${proxyHostPort}!`);
                          return {
                            success: true,
                            profile_browser_ID: mzCreated.profile_browser_ID,
                            profile_name: mzCreated.profile_name,
                            proxy: proxyHostPort,
                            engine: 'multizen_cloak_cpp'
                          };
                        }
                      } catch (mzPrimaryErr) {
                        onLog(`⚠️ [MultiZen C++ Primário] Aviso ao criar perfil (${mzPrimaryErr.message}); tentando fallback...`);
                      }
                    }

                    // VACINA FORENSE (Pós-Autópsia Perfis Legados):
                    // 1. Timezone fallback cravado em America/Sao_Paulo (-03:00) — JAMAIS deixar o Incogniton sortear Asia/Urumqi (+06:00 China) ou Europe/Ulyanovsk!
                    // 2. Geolocation fallback cravado em MG/Brasil (-19.7472, -47.9381) compatível com o 4G Vivo — JAMAIS China ou Afeganistão!
                    // 3. Fonts: enable_font_list_masking = 'false' (usa as fontes reais do Windows 11 ocidental, ZERO fontes chinesas YaHei/JhengHei, Mac Apple Gothic ou Linux Ubuntu!).
                    // 4. Media_devices: 1 monitor (video_outputs: 1) — JAMAIS 4 monitores em APU de notebook!
                    // 5. Navigator: navigator_useragent_always_latest = false + match_chrome_core = true (impede mutação Chrome 152 -> 155 no meio da vida da conta).
                    const profileDataPayload = {
                      general_profile_information: {
                        profile_name: profileName,
                        profile_notes: options.notes || 'Criado automaticamente com Vacina Forense 4G ADB (Every Proxy 127.0.0.1:8080)',
                        profile_group: options.group || 'Unassigned',
                        simulated_operating_system: 'Windows'
                      },
                      Proxy: {
                        connection_type: 'HTTP proxy',
                        proxy_url: proxyHostPort,
                        proxy_username: '',
                        proxy_password: '',
                        proxy_rotating: true
                      },
                      Timezone: {
                        timezone_name: 'America/Sao_Paulo',
                        timezone_offset: '-03:00',
                        fill_timezone_based_on_ip: 'true'
                      },
                      Geolocation: {
                        behavior: 'Prompt',
                        fill_geolocation_based_on_ip: 'true',
                        location_information: {
                          latitude: -19.7472,
                          longitude: -47.9381,
                          accuracy: 1250.0
                        }
                      },
                      Navigator: {
                        user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
                        screen_resolution: '1920x1080',
                        languages: 'pt-BR,pt,en-US,en',
                        navigator_languageIPToggle: false,
                        platform: 'Win32',
                        do_not_track: false,
                        hardware_concurrency: 8,
                        navigator_deviceMemory: 8,
                        navigator_useragent_always_latest: false,
                        navigator_useragent_match_chrome_core: true
                      },
                      Fonts: {
                        enable_font_list_masking: 'false',
                        enable_unicode_glyps_domrect: 'false'
                      },
                      Media_devices: {
                        enable_media_masking: 'true',
                        video_outputs: 1,
                        audio_inputs: 1,
                        audio_outputs: 2
                      }
                    };

                    // 1. Tenta via API Local 127.0.0.1:35000/profile/add
                    try {
                      const controller = new AbortController();
                      const timeout = setTimeout(() => controller.abort(), 5000);
                      const res = await fetch(`${LOCAL_INCOGNITON_URL}/profile/add`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ profileData: profileDataPayload }),
                        signal: controller.signal
                      });
                      clearTimeout(timeout);
                      if (res.ok) {
                        const data = await res.json();
                        const createdId = data?.profile_browser_id || data?.profile_browser_ID || data?.browser_id || data?.data?.profile_browser_id;
                        if (createdId) {
                          sanitizeProfileDiskBeforeLaunch(createdId, onLog);
                          onLog(`✅ [Incogniton 4G] Perfil "${profileName}" criado do zero via API Local (${createdId}) com Proxy HTTP ${proxyHostPort}!`);
                          return { success: true, profile_browser_ID: createdId, profile_name: profileName, proxy: proxyHostPort };
                        }
                      }
                    } catch (_) { }

                    // 2. Fallback via MCP v5 oficial (`create_profiles` no plural!)
                    try {
                      const mcpRes = await this.callMcp('create_profiles', {
                        profile_names: [profileName],
                        operating_system: 'windows',
                        profile_browser_version: '152',
                        custom_proxy: {
                          connection_type: 'HTTP Proxy',
                          proxy_url: proxyHostPort,
                          proxy_rotating: 1
                        },
                        navigator_languageIPToggle: 1
                      });
                      const parsed = this.parseMcpResult(mcpRes);
                      let createdId =
                        parsed?.data?.profile_browser_ID ||
                        parsed?.data?.profile_browser_id ||
                        parsed?.data?.browser_id ||
                        (parsed?.text && (parsed.text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i) || [])[0]);

                      if (!createdId) {
                        const allProfs = await this.getProfiles();
                        const found = (allProfs || []).find(p => String(p.profile_name || '').trim().toLowerCase() === profileName.toLowerCase());
                        if (found && found.profile_browser_ID) {
                          createdId = found.profile_browser_ID;
                        }
                      }

                      if (createdId) {
                        sanitizeProfileDiskBeforeLaunch(createdId, onLog);
                        onLog(`✅ [Incogniton 4G] Perfil "${profileName}" criado do zero via MCP v5 (${createdId}) com Proxy HTTP ${proxyHostPort}!`);
                        return { success: true, profile_browser_ID: createdId, profile_name: profileName, proxy: proxyHostPort };
                      }
                    } catch (err) {
                      onLog(`⚠️ [Incogniton 4G] Aviso ao criar perfil automático (${err.message}).`);
                    }

                    // 3. Fallback Automático para MultiZen C++ CloakBrowser (Ilimitado 100% Local) quando Incogniton bate 10 perfis ou options.engine === 'multizen'
                    if (MultiZenService && typeof MultiZenService.createProfile === 'function') {
                      try {
                        const mzCreated = MultiZenService.createProfile({
                          name: profileName,
                          notes: options.notes || 'Criado automaticamente no MultiZen C++ CloakBrowser (Proxy 4G ADB 127.0.0.1:8080)',
                          proxyHostPort,
                          tags: ['4G_VIVO', 'MULTIZEN_CPP', 'OPERACAO_001']
                        });
                        if (mzCreated && mzCreated.profile_browser_ID) {
                          onLog(`🦊 [MultiZen C++ CloakBrowser] Perfil ilimitado "${profileName}" criado no MultiZen (${mzCreated.profile_browser_ID}) com Proxy 4G ${proxyHostPort}!`);
                          return {
                            success: true,
                            profile_browser_ID: mzCreated.profile_browser_ID,
                            profile_name: mzCreated.profile_name,
                            proxy: proxyHostPort,
                            engine: 'multizen_cloak_cpp'
                          };
                        }
                      } catch (mzErr) {
                        onLog(`⚠️ [MultiZen C++] Aviso ao criar perfil fallback: ${mzErr.message}`);
                      }
                    }

                    return { success: false, limit_reached: true, reason: 'Limite de 10 perfis gratuitos atingido na conta atual do Incogniton.' };
                  }
                }

                /**
                 * Coletor de Sessões Órfãs de Robô (Orphaned Robot Browser Reaper):
                 * Quando um processo Node (`server.js` ou `runner.js`) é reiniciado ou morto no meio de um turno,
                 * o bloco `finally { stopProfile(...) }` do processo antigo não chega a rodar, mas o arquivo
                 * `browser_locks/<profileId>.lock` permanece no disco com o `pid` do processo Node morto.
                 *
                 * Diferenciação determinística 100% segura:
                 * - Navegador aberto MANUALMENTE pelo operador humano: NÃO possui `browser_locks/<profileId>.lock` -> NUNCA é tocado!
                 * - Navegador aberto PELO ROBÔ cujo processo Node (`lock.pid`) já morreu: POSSUI `browser_locks/<profileId>.lock` com `!isNodePidAlive(lock.pid)` -> É fechado de forma limpa (respeitando proteção de Checkpoint e sem queimar lock diário 4G)!
                 */
                async function reapOrphanedRobotSessions(onLog = console.log, mcpConfig = {}) {
                  const reapedProfiles = [];
                  try {
                    if (!fs.existsSync(BROWSER_LOCKS_DIR)) return reapedProfiles;
                    const files = fs.readdirSync(BROWSER_LOCKS_DIR).filter(f => f.endsWith('.lock'));
                    if (files.length === 0) return reapedProfiles;

                    for (const file of files) {
                      const fullPath = path.join(BROWSER_LOCKS_DIR, file);
                      let lockData = null;
                      try {
                        lockData = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
                      } catch (_) {
                        try { fs.unlinkSync(fullPath); } catch (_) { }
                        continue;
                      }

                      const ownerPid = lockData && lockData.pid ? Number(lockData.pid) : 0;
                      if (ownerPid && isNodePidAlive(ownerPid)) {
                        // Processo dono continua vivo -> mantém o lock intacto
                        continue;
                      }

                      if (file === 'PILOT_4G_CLI.lock') {
                        try { fs.unlinkSync(fullPath); } catch (_) { }
                        onLog(`🧹 [Reaper de Lock Órfão] Removido lock órfão PILOT_4G_CLI.lock do PID morto ${ownerPid}.`);
                        continue;
                      }

                      const orphanProfileId = String(lockData?.profile_id || file.replace(/\.lock$/i, '')).trim().toLowerCase();
                      if (!orphanProfileId) {
                        try { fs.unlinkSync(fullPath); } catch (_) { }
                        continue;
                      }

                      onLog(`🧹 [Reaper Pós-Restart Node] Detectada janela órfã de robô para o perfil ${orphanProfileId.slice(0, 8)} (aberta pelo PID morto ${ownerPid}). Encerrando sessão órfã com segurança...`);
                      try {
                        const inc = new IncognitonService(mcpConfig.mcp_token, mcpConfig.mcp_api_url);
                        await inc.stopProfile(orphanProfileId, {
                          onLog,
                          allowDailyLock: false,
                          forceCloseCheckpoint: false,
                          reason: `Reaper de Sessão Órfã pós-restart do Node (PID ${ownerPid} encerrado antes do finally)`
                        });
                        reapedProfiles.push({ profile_id: orphanProfileId, dead_pid: ownerPid });
                      } catch (err) {
                        onLog(`⚠️ [Reaper Pós-Restart Node] Aviso ao fechar perfil órfão ${orphanProfileId.slice(0, 8)}: ${err.message}`);
                      } finally {
                        removeCrossProcessProfileLock(orphanProfileId);
                      }
                    }
                  } catch (_) { }
                  return reapedProfiles;
                }

                let _cached4gQuotaHealth = null;
                let _cached4gQuotaHealthAt = 0;
                let _inFlight4gQuotaProbe = false;

                function refresh4gDataQuotaHealthAsync() {
                  if (_inFlight4gQuotaProbe) return;
                  _inFlight4gQuotaProbe = true;
                  ensureAdbProxyTunnelAndWifiOff(ADB_4G_PROXY_PORT);
                  execFile(
                    'curl.exe',
                    [
                      '-sS',
                      '--compressed',
                      '-o', 'NUL',
                      '-w', '%{http_code}:%{size_download}',
                      '--max-time', '5',
                      '-x', 'http://127.0.0.1:8082',
                      'https://web.facebook.com/'
                    ],
                    { encoding: 'utf8', timeout: 5800, windowsHide: true },
                    (err, stdout) => {
                      _inFlight4gQuotaProbe = false;
                      const parts = String(stdout || '').trim().split(':');
                      const code = Number(parts[0] || 0);
                      const bytes = Number(parts[1] || 0);
                      if (!err && (code === 200 || code === 301 || code === 302) && bytes >= 12000) {
                        _cached4gQuotaHealth = { healthy: true, code: 'OK', httpStatus: code, bytes };
                        _cached4gQuotaHealthAt = Date.now();
                        return;
                      }
                      if (err && bytes === 0) {
                        _cached4gQuotaHealth = {
                          healthy: false,
                          code: 'TUNNEL_TIMEOUT',
                          httpStatus: code,
                          bytes: 0,
                          reason: 'Túnel 4G (127.0.0.1:8082) sem vazão de dados móveis no chip 4G (verifique franquia 4G / Every Proxy ON no celular Samsung).'
                        };
                        _cached4gQuotaHealthAt = Date.now();
                        return;
                      }
                      _cached4gQuotaHealth = {
                        healthy: false,
                        code: 'THROTTLED_QUOTA',
                        httpStatus: code,
                        bytes,
                        reason: `Franquia de dados do chip 4G esgotada / velocidade reduzida (~${Math.max(1, Math.round(bytes / 5 / 1024))} KB/s — insuficiente para carregar o Facebook e subir Reels .mp4).`
                      };
                      _cached4gQuotaHealthAt = Date.now();
                    }
                  );
                }

                function check4gDataQuotaHealthSync(forceFresh = false) {
                  const now = Date.now();
                  if (!forceFresh && _cached4gQuotaHealth) {
                    const ttl = _cached4gQuotaHealth.healthy ? 90000 : 15000;
                    if ((now - _cached4gQuotaHealthAt) < ttl) {
                      return _cached4gQuotaHealth;
                    }
                  }
                  const adbSt = getAdbDeviceStatus(false);
                  if (!adbSt || !adbSt.adb_connected) {
                    const res = {
                      healthy: false,
                      code: 'ADB_DISCONNECTED',
                      bytes: 0,
                      reason: 'Celular 4G não conectado ao ADB USB.'
                    };
                    _cached4gQuotaHealth = res;
                    _cached4gQuotaHealthAt = now;
                    return res;
                  }

                  // NUNCA usar execFileSync contra 127.0.0.1:8082 na main thread (causa self-deadlock de 5.8s pois :8082 roda neste mesmo event loop!)
                  refresh4gDataQuotaHealthAsync();
                  if (_cached4gQuotaHealth) {
                    return _cached4gQuotaHealth;
                  }
                  return { healthy: true, code: 'PROBING_ASYNC', httpStatus: 200, bytes: 32000 };
                }

                IncognitonService.check4gDataQuotaHealthSync = check4gDataQuotaHealthSync;
                IncognitonService.isNodePidAlive = isNodePidAlive;
                IncognitonService.reapOrphanedRobotSessions = reapOrphanedRobotSessions;
                IncognitonService.isBlockedMatrixProfile = isBlockedMatrixProfile;
                IncognitonService.isGraveyardProfile = isGraveyardProfile;
                IncognitonService.markProfileGraveyard = markProfileGraveyard;
                IncognitonService.isCheckpointProtectedProfile = isCheckpointProtectedProfile;
                IncognitonService.markProfileCheckpoint = markProfileCheckpoint;
                IncognitonService.isProfileInCheckpoint = isCheckpointProtectedProfile;
                IncognitonService.clearProfileCheckpoint = (profileId) => markProfileCheckpoint(profileId, false);
                IncognitonService.getAllLocalProfileIds = getAllLocalProfileIds;
                IncognitonService.isProfileLockedByKernel = isProfileLockedByKernel;
                IncognitonService.scanAllLockedProfilesByKernel = scanAllLockedProfilesByKernel;
                IncognitonService.sanitizeProfileDiskBeforeLaunch = sanitizeProfileDiskBeforeLaunch;
                IncognitonService.getAdbDeviceStatus = getAdbDeviceStatus;
                IncognitonService.ensureAdbProxyTunnelAndWifiOff = ensureAdbProxyTunnelAndWifiOff;
                IncognitonService.flushIdleUpstreamSockets = flushIdleUpstreamSockets;
                IncognitonService.getCurrentPublicIpInfo = getCurrentPublicIpInfo;
                IncognitonService.rotate4gIpViaAdb = rotate4gIpViaAdb;
                IncognitonService.taintCurrentIpAndRotate4g = taintCurrentIpAndRotate4g;
                IncognitonService.loadAccountIpLedger = loadAccountIpLedger;
                IncognitonService.saveAccountIpLedger = saveAccountIpLedger;
                IncognitonService.hasRecentIpCollisionWithOtherAccount = hasRecentIpCollisionWithOtherAccount;
                IncognitonService.getAccountDistinct4gIpsInWindow = getAccountDistinct4gIpsInWindow;
                IncognitonService.isLegacyFixedIpProfile = isLegacyFixedIpProfile;
                IncognitonService.isResidentialFixedIp = isResidentialFixedIp;
                IncognitonService.MATRIX_PROFILE_UUID = MATRIX_PROFILE_UUID;
                IncognitonService.CLOAK_TARGET_FILTER = CLOAK_TARGET_FILTER;
                IncognitonService.ensureProfile4gProxyConfigured = (profileId, onLog) =>
                  new IncognitonService().ensureProfile4gProxyConfigured(profileId, onLog);
                module.exports = IncognitonService;

