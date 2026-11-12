/**
 * ============================================================================
 * MULTIZEN SERVICE — INTEGRAÇÃO NATIVA COM MULTIZEN BROWSER + CLOAKBROWSER C++
 * ============================================================================
 * Permite criar, listar e lançar perfis ilimitados no MultiZen Browser (v0.4.2+)
 * usando o motor C++ anti-detect CloakBrowser (Chromium 146) + SQLite local
 * (%APPDATA%\MultiZen\data\profiles.db), 100% compatível com o automator.js
 * e com o isolamento de Proxy 4G (127.0.0.1:8080).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const MULTIZEN_APPDATA = path.join(process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming'), 'MultiZen');
const MULTIZEN_DB_PATH = path.join(MULTIZEN_APPDATA, 'data', 'profiles.db');
const MULTIZEN_PROFILES_ROOT = path.join(MULTIZEN_APPDATA, 'data', 'profiles');
const MULTIZEN_CLOAK_DIR = path.join(MULTIZEN_APPDATA, 'chromium', 'cloakbrowser');
const MULTIZEN_TOKEN_PATH = path.join(MULTIZEN_APPDATA, 'mcp-token');
const MULTIZEN_EXE_PATH = path.join(
  process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local'),
  'Programs',
  'MultiZen',
  'MultiZen.exe'
);

const GPU_PROFILES_WIN = [
  {
    vendor: 'Google Inc. (NVIDIA)',
    renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 SUPER (0x00002783) Direct3D11 vs_5_0 ps_5_0, D3D11)'
  },
  {
    vendor: 'Google Inc. (AMD)',
    renderer: 'ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001681) Direct3D11 vs_5_0 ps_5_0, D3D11)'
  },
  {
    vendor: 'Google Inc. (NVIDIA)',
    renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 (0x00002786) Direct3D11 vs_5_0 ps_5_0, D3D11)'
  },
  {
    vendor: 'Google Inc. (AMD)',
    renderer: 'ANGLE (AMD, AMD Radeon RX 6600 (0x000073FF) Direct3D11 vs_5_0 ps_5_0, D3D11)'
  },
  {
    vendor: 'Google Inc. (NVIDIA)',
    renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Ti (0x00002803) Direct3D11 vs_5_0 ps_5_0, D3D11)'
  },
  {
    vendor: 'Google Inc. (AMD)',
    renderer: 'ANGLE (AMD, AMD Radeon RX 6650 XT (0x000073EF) Direct3D11 vs_5_0 ps_5_0, D3D11)'
  },
  {
    vendor: 'Google Inc. (NVIDIA)',
    renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 (0x00002882) Direct3D11 vs_5_0 ps_5_0, D3D11)'
  },
  {
    vendor: 'Google Inc. (AMD)',
    renderer: 'ANGLE (AMD, AMD Radeon RX 6700 XT (0x000073DF) Direct3D11 vs_5_0 ps_5_0, D3D11)'
  },
  {
    vendor: 'Google Inc. (NVIDIA)',
    renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4050 Laptop GPU (0x000028A1) Direct3D11 vs_5_0 ps_5_0, D3D11)'
  },
  {
    vendor: 'Google Inc. (AMD)',
    renderer: 'ANGLE (AMD, AMD Radeon RX 7600 (0x00007480) Direct3D11 vs_5_0 ps_5_0, D3D11)'
  },
  {
    vendor: 'Google Inc. (NVIDIA)',
    renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)'
  },
  {
    vendor: 'Google Inc. (AMD)',
    renderer: 'ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)'
  },
  {
    vendor: 'Google Inc. (NVIDIA)',
    renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3050 (0x00002507) Direct3D11 vs_5_0 ps_5_0, D3D11)'
  },
  {
    vendor: 'Google Inc. (AMD)',
    renderer: 'ANGLE (AMD, AMD Radeon RX 580 2048SP (0x00006FDF) Direct3D11 vs_5_0 ps_5_0, D3D11)'
  },
  {
    vendor: 'Google Inc. (NVIDIA)',
    renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER (0x000021C4) Direct3D11 vs_5_0 ps_5_0, D3D11)'
  },
  {
    vendor: 'Google Inc. (AMD)',
    renderer: 'ANGLE (AMD, AMD Radeon(TM) Vega 8 Graphics (0x000015D8) Direct3D11 vs_5_0 ps_5_0, D3D11)'
  }
];

function selectOfficialChromeHardwareProfile(seed = 54321, fp = null) {
  const numSeed = Number(seed) || 54321;
  const vendorStr = String((fp && fp.webgl && fp.webgl.vendor) || '').toUpperCase();
  const useAmdLowPower = vendorStr.includes('AMD')
    ? true
    : (vendorStr.includes('NVIDIA') ? false : (numSeed % 2 === 1));
  const useD3d11On12 = ((Math.floor(numSeed / 3)) % 2) === 1;
  const winWidths = [1280, 1344, 1366, 1408, 1440, 1480, 1512, 1536];
  const winHeights = [768, 792, 810, 824, 840, 864, 880, 900];
  const winW = winWidths[numSeed % winWidths.length];
  const winH = winHeights[Math.floor(numSeed / 11) % winHeights.length];
  const posX = 16 + (numSeed % 84);
  const posY = 14 + (Math.floor(numSeed / 17) % 52);

  const gpuFlags = [
    useAmdLowPower ? '--force_low_power_gpu' : '--force_high_performance_gpu'
  ];
  if (useD3d11On12) {
    gpuFlags.push('--use-angle=d3d11on12');
  } else {
    gpuFlags.push('--use-angle=d3d11');
  }

  return {
    silicon_family: useAmdLowPower ? 'AMD_RADEON_LOW_POWER' : 'NVIDIA_RTX_HIGH_PERF',
    angle_backend: useD3d11On12 ? 'd3d11on12' : 'd3d11',
    window_width: winW,
    window_height: winH,
    window_x: posX,
    window_y: posY,
    cli_flags: [
      ...gpuFlags,
      `--window-position=${posX},${posY}`,
      `--window-size=${winW},${winH}`
    ]
  };
}

const SCREEN_PROFILES = [
  { width: 1920, height: 1080 },
  { width: 1600, height: 900 },
  { width: 1536, height: 864 },
  { width: 1366, height: 768 }
];

const HWC_OPTIONS = [8, 12, 16];
// W3C Device Memory Spec + MultiZen app.asar (deviceMemoryApiValue):
// Navegadores Chromium reais no Windows NUNCA retornam navigator.deviceMemory > 8 (mesmo em PCs de 16GB/32GB/64GB).
const MEM_OPTIONS = [8, 8, 4];

function deviceMemoryApiValue(physicalGb) {
  const n = Number(physicalGb);
  if (!(n > 0)) return 8;
  return Math.min(8, Math.max(2, 2 ** Math.round(Math.log2(n))));
}

function migrateNativeChromeToCloakBrowser(profileDataDir, onLog = () => { }) {
  if (!profileDataDir) return false;
  try {
    const nativeChromeDir = path.join(profileDataDir, 'chrome_native');
    const nativeCookies = path.join(nativeChromeDir, 'Default', 'Network', 'Cookies');
    if (!fs.existsSync(nativeCookies)) return false;

    const officialDir = path.join(profileDataDir, 'engines', 'cloakbrowser');
    const officialDefDir = path.join(officialDir, 'Default');
    const officialNetDir = path.join(officialDefDir, 'Network');
    fs.mkdirSync(officialNetDir, { recursive: true });

    // Semeia VariationsSeedV2 + TrustTokenKeyCommitments no destino antes de mesclar Local State
    seedOfficialChromeVariationsAndTrustTokens(officialDir);

    // 1. Copia Local State preservando os_crypt.encrypted_key (DPAPI v10) + client_id2 + installation_date2 do Passo 1 (continuidade total!)
    const srcLs = path.join(nativeChromeDir, 'Local State');
    const dstLs = path.join(officialDir, 'Local State');
    if (fs.existsSync(srcLs)) {
      try {
        const srcLsObj = JSON.parse(fs.readFileSync(srcLs, 'utf8')) || {};
        let dstLsObj = {};
        if (fs.existsSync(dstLs)) {
          try { dstLsObj = JSON.parse(fs.readFileSync(dstLs, 'utf8')) || {}; } catch (_) { dstLsObj = {}; }
        }
        for (const keepKey of ['os_crypt', 'uninstall_metrics', 'user_experience_metrics']) {
          if (srcLsObj[keepKey]) {
            dstLsObj[keepKey] = srcLsObj[keepKey];
          }
        }
        fs.writeFileSync(dstLs, JSON.stringify(dstLsObj), 'utf8');
      } catch (_) {
        try { fs.copyFileSync(srcLs, dstLs); } catch (_) { }
      }
    }

    // 2. Copia Cookies + Trust Tokens + TransportSecurity da rede (SID, HSID, SSID, APISID, SAPISID, OSID, __Secure-1PSID, TrustTokens)
    for (const f of ['Cookies', 'Cookies-journal', 'Trust Tokens', 'Trust Tokens-journal', 'TransportSecurity']) {
      const s = path.join(nativeChromeDir, 'Default', 'Network', f);
      const d = path.join(officialNetDir, f);
      if (fs.existsSync(s)) {
        try { fs.copyFileSync(s, d); } catch (_) { }
      }
    }

    // 2.1. Copia Web Data + Local Storage + Session Storage + IndexedDB (evita perda de tokens OAuth/AccountChooser do Gmail no Passo 2!)
    for (const f of ['Web Data', 'Web Data-journal']) {
      const s = path.join(nativeChromeDir, 'Default', f);
      const d = path.join(officialDefDir, f);
      if (fs.existsSync(s)) {
        try { fs.copyFileSync(s, d); } catch (_) { }
      }
    }
    for (const dirName of ['Local Storage', 'Session Storage', 'IndexedDB']) {
      const sDir = path.join(nativeChromeDir, 'Default', dirName);
      const dDir = path.join(officialDefDir, dirName);
      if (fs.existsSync(sDir)) {
        try { fs.cpSync(sDir, dDir, { recursive: true, force: true }); } catch (_) { }
      }
    }

    // 3. Arquiva chrome_native -> chrome_native_gmail_seed para que o perfil passe a rodar no MultiZen CloakBrowser C++ mantendo backup nativo!
    const seedArchiveDir = path.join(profileDataDir, 'chrome_native_gmail_seed');
    try {
      if (fs.existsSync(seedArchiveDir)) {
        fs.rmSync(seedArchiveDir, { recursive: true, force: true });
      }
      fs.renameSync(nativeChromeDir, seedArchiveDir);
    } catch (_) { }

    onLog(`🔄 [Ponte Contínua Passo 1 ➔ Passo 2] Cookies + TrustTokens + Storage + os_crypt migrados sem perda para o motor Anti-Detect C++!`);
    return true;
  } catch (_) {
    return false;
  }
}

function resolveEngineDataDir(profileDataDir) {
  const nativeChromeDir = path.join(profileDataDir, 'chrome_native');
  if (fs.existsSync(path.join(nativeChromeDir, 'Default'))) {
    return nativeChromeDir;
  }
  if (fs.existsSync(path.join(profileDataDir, 'Default'))) {
    return profileDataDir;
  }
  const legacyDir = path.join(profileDataDir, 'chromium-cloakbrowser');
  const officialDir = path.join(profileDataDir, 'engines', 'cloakbrowser');
  if (fs.existsSync(path.join(legacyDir, 'Default')) && !fs.existsSync(path.join(officialDir, 'Default'))) {
    return legacyDir;
  }
  return officialDir;
}

// Mapa em memória de processos CloakBrowser lançados pelo Hub
const activeMultiZenProcesses = new Map(); // profileId -> { pid, port, cdp_url, startedAt, browserDataDir }
let nextCdpPort = 19300;

function seededRand(seedStr) {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let state = h >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state = state >>> 0;
    return state / 0xffffffff;
  };
}

function pick(arr, rand) {
  return arr[Math.floor(rand() * arr.length)] || arr[0];
}

function buildRealisticFingerprint(profileId, opts = {}) {
  const rand = seededRand(profileId);
  const screen = opts.screen || pick(SCREEN_PROFILES, rand);
  const webgl = opts.webgl || pick(GPU_PROFILES_WIN, rand);
  const hardwareConcurrency = opts.hardwareConcurrency || pick(HWC_OPTIONS, rand);
  const deviceMemory = opts.deviceMemory || pick(MEM_OPTIONS, rand);
  const timezone = opts.timezone || 'America/Sao_Paulo';
  const locale = opts.locale || 'pt-BR';
  const languages = opts.languages || ['pt-BR', 'pt', 'en-US', 'en'];
  const chromeFull = '146.0.7680.177';
  const chromeMajor = '146';
  const grease = '"Not?A_Brand";v="99"';
  // Geolocalização determinística 4G BR (evita fallback nulo ou vazamento Asia/Urumqi em boot 4G lento)
  const baseLat = typeof opts.latitude === 'number' ? opts.latitude : -19.7472;
  const baseLon = typeof opts.longitude === 'number' ? opts.longitude : -47.9381;
  const latOffset = Number(((rand() - 0.5) * 0.018).toFixed(6));
  const lonOffset = Number(((rand() - 0.5) * 0.018).toFixed(6));
  const geolocation = {
    latitude: Number((baseLat + latOffset).toFixed(6)),
    longitude: Number((baseLon + lonOffset).toFixed(6)),
    accuracy: 20 + Math.floor(rand() * 25)
  };

  return {
    device: 'windows-desktop',
    userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeFull} Safari/537.36`,
    platform: 'Win32',
    clientHints: {
      secChUa: `"Chromium";v="${chromeMajor}", "Google Chrome";v="${chromeMajor}", ${grease}`,
      secChUaPlatform: '"Windows"',
      secChUaPlatformVersion: '"15.0.0"',
      secChUaArch: '"x86"',
      secChUaBitness: '"64"',
      secChUaMobile: '?0',
      secChUaModel: '""',
      secChUaFullVersionList: `"Chromium";v="${chromeFull}", "Google Chrome";v="${chromeFull}", ${grease}`
    },
    locale,
    languages,
    acceptLanguage: 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    timezone,
    country: 'BR',
    geolocation,
    screen: { width: screen.width, height: screen.height },
    availScreen: { width: screen.width, height: Math.max(0, screen.height - 40) },
    dpr: 1,
    webgl,
    hardwareConcurrency,
    deviceMemory
  };
}

function computeNumericFingerprintSeed(profileId, fp) {
  if (fp && fp.seed !== undefined && fp.seed !== null) {
    const numSeed = Number(fp.seed);
    if (Number.isInteger(numSeed) && numSeed >= 10000 && numSeed <= 99999) {
      return numSeed;
    }
  }
  const raw = fp && fp.seed ? String(fp.seed) : String(profileId);
  const hex = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 8);
  // Alinhado 100% com fingerprintSeed() do app.asar nativo do MultiZen (10000..99999)
  return 10000 + (Number.parseInt(hex, 16) % 90000);
}

/**
 * Vacina Forense de Disco Pré-Launch (herdada da autópsia de Perfis Legados no Incogniton):
 * 1. Deleta `Reporting and NEL` (impede envio atrasado de telemetria do IP 4G anterior no novo IP 4G).
 * 2. Limpa `broken_alternative_services` e `alternative_service` do QUIC/HTTP3 em `Network Persistent State` (sem tocar em Cookies).
 * 3. Trava `webrtc.ip_handling_policy = 'disable_non_proxied_udp'`, `dns_over_https.mode = 'off'`, `network_prediction_options = 2`,
 *    `dns_prefetching.enabled = false`, `intl.accept_languages = 'pt-BR,pt,en-US,en'` e remove `per_host_zoom_levels` do Facebook (DPR = 1.0).
 */
function sanitizeMultiZenDiskBeforeLaunch(browserDataDir, seedHint = null, fpHint = null) {
  if (!browserDataDir) return;
  try {
    const profDir = path.join(browserDataDir, 'Default');
    fs.mkdirSync(profDir, { recursive: true });

    // 1. Remove Reporting and NEL (evita telemetria atrasada cruzando IPs 4G)
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

    // 3. Blinda Preferences (WebRTC, DoH, Preconnect, Accept-Language, Exit Normal, Geometria Única por Seed e DPR 1.0)
    const prefPath = path.join(profDir, 'Preferences');
    let prefs = {};
    if (fs.existsSync(prefPath)) {
      try {
        prefs = JSON.parse(fs.readFileSync(prefPath, 'utf8')) || {};
      } catch (_) {
        prefs = {};
      }
    }
    prefs.profile = Object.assign({}, prefs.profile || {}, {
      exit_type: 'Normal',
      exited_cleanly: true
    });
    const hwGeom = selectOfficialChromeHardwareProfile(seedHint || 54321, fpHint);
    const curPlacement = (prefs.browser && prefs.browser.window_placement) || {};
    const defLeft = hwGeom.window_x;
    const defTop = hwGeom.window_y;
    const defRight = defLeft + hwGeom.window_width;
    const defBottom = defTop + hwGeom.window_height;
    prefs.browser = Object.assign({}, prefs.browser || {}, {
      window_placement: {
        bottom: Number(curPlacement.bottom) > 650 ? Number(curPlacement.bottom) : defBottom,
        left: (typeof curPlacement.left === 'number' && curPlacement.left > 0 && curPlacement.left <= 1600) ? curPlacement.left : defLeft,
        maximized: curPlacement.maximized !== undefined ? Boolean(curPlacement.maximized) : false,
        minimized: false,
        right: Number(curPlacement.right) > 1100 ? Number(curPlacement.right) : defRight,
        top: (typeof curPlacement.top === 'number' && curPlacement.top > 0 && curPlacement.top <= 900) ? curPlacement.top : defTop,
        work_area_bottom: Number(curPlacement.work_area_bottom) || 1040,
        work_area_left: 0,
        work_area_right: Number(curPlacement.work_area_right) || 1920,
        work_area_top: 0
      }
    });
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
    fs.writeFileSync(prefPath, JSON.stringify(prefs), 'utf8');
  } catch (_) { }
}

/**
 * Pré-semeia um diretório isolado do Google Chrome Oficial (157+) / CloakBrowser com os componentes
 * criptográficos reais da instalação oficial do Windows (%LOCALAPPDATA%\Google\Chrome\User Data):
 * - `VariationsSeedV2`, `VariationsSafeSeedV2`, `Variations`, `First Run`
 * - `TrustTokenKeyCommitments`, `CaptchaProviders`, `PrivacySandboxAttestationsPreloaded`, `FirstPartySetsPreloaded`, `PKIMetadata`, `MEIPreload`, `OriginTrials`
 * - Chaves `variations_*` limpas no `Local State` (EXCLUINDO `variations_sticky_studies` e `variations_google_groups` do host pessoal,
 *   para que `low_entropy_source3` gere um header `X-Client-Data` criptograficamente válido e 100% ÚNICO para cada Gmail criado no PC!).
 */
function seedOfficialChromeVariationsAndTrustTokens(browserDataDir, seedHint = null) {
  if (!browserDataDir) return false;
  try {
    fs.mkdirSync(path.join(browserDataDir, 'Default'), { recursive: true });
    const hostUserData = path.join(
      process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local'),
      'Google',
      'Chrome',
      'User Data'
    );
    if (!fs.existsSync(hostUserData)) return false;

    for (const fileName of ['Variations', 'VariationsSeedV2', 'VariationsSafeSeedV2', 'First Run']) {
      const src = path.join(hostUserData, fileName);
      const dst = path.join(browserDataDir, fileName);
      if (fs.existsSync(src) && !fs.existsSync(dst)) {
        try { fs.copyFileSync(src, dst); } catch (_) { }
      }
    }

    for (const dirName of [
      'TrustTokenKeyCommitments',
      'CaptchaProviders',
      'PrivacySandboxAttestationsPreloaded',
      'FirstPartySetsPreloaded',
      'PKIMetadata',
      'MEIPreload',
      'OriginTrials'
    ]) {
      const srcDir = path.join(hostUserData, dirName);
      const dstDir = path.join(browserDataDir, dirName);
      if (fs.existsSync(srcDir) && !fs.existsSync(dstDir)) {
        try { fs.cpSync(srcDir, dstDir, { recursive: true }); } catch (_) { }
      }
    }

    const hostLsPath = path.join(hostUserData, 'Local State');
    const dstLsPath = path.join(browserDataDir, 'Local State');
    if (fs.existsSync(hostLsPath)) {
      const hostLs = JSON.parse(fs.readFileSync(hostLsPath, 'utf8')) || {};
      let dstLs = {};
      if (fs.existsSync(dstLsPath)) {
        try { dstLs = JSON.parse(fs.readFileSync(dstLsPath, 'utf8')) || {}; } catch (_) { dstLs = {}; }
      }
      const blockedHostVariationKeys = new Set([
        'variations_sticky_studies',
        'variations_google_groups'
      ]);
      for (const k of Object.keys(hostLs)) {
        if (k.startsWith('variations') && !blockedHostVariationKeys.has(k) && dstLs[k] === undefined) {
          dstLs[k] = hostLs[k];
        }
      }
      // Remove caso tenha sobrado de versão antiga
      delete dstLs.variations_sticky_studies;
      dstLs.variations_google_groups = { Default: [] };

      // Gera entropia única por perfil + seed (cada Gmail emite um X-Client-Data Google válido e diferente!)
      const entropyInput = `${browserDataDir}|${seedHint !== null && seedHint !== undefined ? seedHint : ''}`;
      const dirHash = crypto.createHash('sha256').update(entropyInput).digest('hex');
      const daysAgoSec = (18 + (parseInt(dirHash.slice(0, 4), 16) % 55)) * 86400 + (parseInt(dirHash.slice(4, 8), 16) % 86400);
      const fakeInstallEpoch = String(Math.floor(Date.now() / 1000) - daysAgoSec);
      if (!dstLs.uninstall_metrics || seedHint !== null) {
        if (!dstLs.uninstall_metrics) {
          dstLs.uninstall_metrics = { installation_date2: fakeInstallEpoch };
        }
      }
      if (!dstLs.user_experience_metrics) {
        const lowEntropy = seedHint !== null && Number.isFinite(Number(seedHint))
          ? ((Number(seedHint) * 131 + parseInt(dirHash.slice(8, 12), 16)) % 8000)
          : (parseInt(dirHash.slice(8, 12), 16) % 8000);
        dstLs.user_experience_metrics = {
          client_id2: crypto.randomUUID(),
          client_id_timestamp: fakeInstallEpoch,
          low_entropy_source3: lowEntropy,
          limited_entropy_randomization_source: dirHash.slice(12, 44).toUpperCase()
        };
      }
      fs.writeFileSync(dstLsPath, JSON.stringify(dstLs), 'utf8');
    }
    return true;
  } catch (_) {
    return false;
  }
}

class MultiZenService {
  static isInstalled() {
    return fs.existsSync(MULTIZEN_DB_PATH) || fs.existsSync(MULTIZEN_EXE_PATH);
  }

  static getOfficialGoogleChromeBinaryPath() {
    const candidates = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
    ];
    for (const c of candidates) {
      if (c && fs.existsSync(c)) return c;
    }
    return null;
  }

  static getCloakBrowserBinaryPath() {
    const curPath = path.join(MULTIZEN_CLOAK_DIR, 'current.json');
    if (fs.existsSync(curPath)) {
      try {
        const cur = JSON.parse(fs.readFileSync(curPath, 'utf8'));
        const candidate = path.join(MULTIZEN_CLOAK_DIR, cur.version, cur.binaryRelative || 'chrome.exe');
        if (fs.existsSync(candidate)) return candidate;
      } catch (_) { }
    }
    const fallback = path.join(MULTIZEN_CLOAK_DIR, '146.0.7680.177.5', 'chrome.exe');
    if (fs.existsSync(fallback)) return fallback;
    return null;
  }

  static getMcpToken() {
    if (fs.existsSync(MULTIZEN_TOKEN_PATH)) {
      return fs.readFileSync(MULTIZEN_TOKEN_PATH, 'utf8').trim();
    }
    return '';
  }

  /**
   * Chama o servidor MCP nativo do MultiZen Desktop (http://127.0.0.1:7777/mcp) se o app MultiZen.exe estiver aberto na tela.
   * Quando o MultiZen.exe está aberto no Desktop do usuário, pedir `launch_profile` via MCP garante que a janela do
   * CloakBrowser abre 100% visível no monitor do usuário e aparece como "Running" ao vivo dentro do app MultiZen!
   */
  static async callDesktopMcp(toolName, toolArgs = {}, timeoutMs = 15000) {
    const token = this.getMcpToken();
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream'
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const health = await fetch('http://127.0.0.1:7777/healthz', { headers, signal: ctrl.signal });
      if (!health.ok) return null;

      const res = await fetch('http://127.0.0.1:7777/mcp', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'tools/call',
          params: { name: toolName, arguments: toolArgs }
        }),
        signal: ctrl.signal
      });
      if (!res.ok) return null;
      const payload = await res.json();
      const text = payload?.result?.content?.find(c => c.type === 'text')?.text;
      if (text) {
        try { return JSON.parse(text); } catch (_) { return { raw: text }; }
      }
      return payload?.result || null;
    } catch (_) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  static openDb(readOnly = false) {
    fs.mkdirSync(path.dirname(MULTIZEN_DB_PATH), { recursive: true });
    fs.mkdirSync(MULTIZEN_PROFILES_ROOT, { recursive: true });
    const db = new DatabaseSync(MULTIZEN_DB_PATH, { readOnly });
    if (!readOnly) {
      db.exec(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS profiles (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          notes TEXT,
          tags TEXT NOT NULL DEFAULT '[]',
          proxy TEXT,
          fingerprint TEXT NOT NULL,
          data_dir TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          last_opened_at TEXT,
          proxy_country TEXT,
          extensions TEXT,
          icon TEXT,
          start_url TEXT,
          search_provider TEXT,
          engine TEXT
        );
      `);
    }
    return db;
  }

  static hasProfile(profileId) {
    if (!profileId || !fs.existsSync(MULTIZEN_DB_PATH)) return false;
    const norm = String(profileId).trim().toLowerCase();
    // BLINDAGEM ABSOLUTA DE REDE: PERFIL 04 (MATRIZ - IP Fixo) NUNCA pertence ao MultiZen 4G!
    if (norm === '00000000-0000-0000-0000-000000000004') return false;
    try {
      const now = Date.now();
      if (!this._profileIdsSetCache || (now - (this._profileIdsSetAt || 0) > 10000)) {
        const db = this.openDb(true);
        const rows = db.prepare('SELECT id FROM profiles').all();
        db.close();
        this._profileIdsSetCache = new Set(rows.map(r => String(r.id || '').trim()));
        this._profileIdsSetAt = now;
      }
      return this._profileIdsSetCache.has(String(profileId).trim());
    } catch (_) {
      return false;
    }
  }

  static resolveProfileBaseDirs(profileId, knownDataDir = null) {
    const cleanId = String(profileId || '').trim();
    if (!cleanId) return [];
    const candidates = [];
    if (knownDataDir && typeof knownDataDir === 'string') {
      candidates.push(knownDataDir.trim());
    } else {
      try {
        const prof = this.getProfile(cleanId);
        if (prof && prof.data_dir) candidates.push(String(prof.data_dir).trim());
      } catch (_) { }
    }
    candidates.push(path.join(MULTIZEN_PROFILES_ROOT, cleanId));
    if (process.env.APPDATA) {
      candidates.push(path.join(process.env.APPDATA, 'Incogniton', 'Incogniton', 'config', cleanId));
    }
    return Array.from(new Set(candidates.filter(Boolean)));
  }

  static listProfiles() {
    if (!fs.existsSync(MULTIZEN_DB_PATH)) return [];
    const db = this.openDb(true);
    try {
      const rows = db.prepare('SELECT * FROM profiles ORDER BY updated_at DESC').all();
      return rows.map(r => {
        let fp = {};
        let proxy = null;
        let tags = [];
        try { fp = JSON.parse(r.fingerprint || '{}'); } catch (_) { }
        try { proxy = r.proxy ? JSON.parse(r.proxy) : null; } catch (_) { }
        try { tags = JSON.parse(r.tags || '[]'); } catch (_) { }
        const runningInfo = activeMultiZenProcesses.get(r.id) || null;
        const lockedByKernel = Boolean(runningInfo) || this.isProfileLockedByKernel(r.id, r.data_dir);
        let detectedPort = runningInfo ? runningInfo.port : null;
        if (!detectedPort && lockedByKernel) {
          try {
            const baseDirs = this.resolveProfileBaseDirs(r.id, r.data_dir);
            for (const baseDir of baseDirs) {
              const engineDir = resolveEngineDataDir(baseDir);
              const portFile = fs.existsSync(path.join(engineDir, 'DevToolsActivePort'))
                ? path.join(engineDir, 'DevToolsActivePort')
                : path.join(baseDir, 'chromium-cloakbrowser', 'DevToolsActivePort');
              if (fs.existsSync(portFile)) {
                const pNum = parseInt(fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0], 10);
                if (Number.isFinite(pNum) && pNum > 0) {
                  detectedPort = pNum;
                  break;
                }
              }
            }
          } catch (_) { }
        }
        return {
          id: r.id,
          profile_browser_ID: r.id,
          name: r.name,
          profile_name: r.name,
          notes: r.notes || '',
          tags,
          proxy,
          fingerprint: {
            ...fp,
            seed: computeNumericFingerprintSeed(r.id, fp),
            gpuRenderer: fp.webgl ? fp.webgl.renderer : ''
          },
          data_dir: r.data_dir,
          engine: r.engine || 'cloakbrowser',
          created_at: r.created_at,
          updated_at: r.updated_at,
          last_opened_at: r.last_opened_at,
          is_running: lockedByKernel,
          locked_active: lockedByKernel,
          cdp_url: detectedPort ? `http://127.0.0.1:${detectedPort}` : null,
          cdp_port: detectedPort
        };
      });
    } finally {
      db.close();
    }
  }

  static isProfileLockedByKernel(profileId, knownDataDir = null) {
    if (!profileId) return false;
    try {
      const cleanId = String(profileId).trim();
      if (activeMultiZenProcesses.has(cleanId)) return true;
      const baseDirs = this.resolveProfileBaseDirs(cleanId, knownDataDir);
      for (const baseDir of baseDirs) {
        const engineDir = resolveEngineDataDir(baseDir);
        const lockCandidates = [
          path.join(engineDir, 'lockfile'),
          path.join(baseDir, 'chrome_native', 'lockfile'),
          path.join(baseDir, 'chromium-cloakbrowser', 'lockfile')
        ];
        for (const lockPath of lockCandidates) {
          if (fs.existsSync(lockPath)) {
            try {
              fs.unlinkSync(lockPath);
            } catch (err) {
              if (err && (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES')) {
                return true;
              }
            }
          }
        }
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  static async probeProfileLocalDevToolsPort(profileId) {
    if (!profileId) return null;
    try {
      const cleanId = String(profileId).trim();
      const baseDirs = this.resolveProfileBaseDirs(cleanId);
      const primaryBaseDir = baseDirs[0] || path.join(MULTIZEN_PROFILES_ROOT, cleanId);
      const primaryEngineDir = resolveEngineDataDir(primaryBaseDir);

      const existing = activeMultiZenProcesses.get(cleanId);
      if (existing && existing.cdp_url) {
        try {
          const ctrl = new AbortController();
          const tm = setTimeout(() => ctrl.abort(), 1500);
          const res = await fetch(`${existing.cdp_url}/json/version`, { signal: ctrl.signal });
          clearTimeout(tm);
          if (res.ok) {
            const data = await res.json();
            return {
              cdp_url: existing.cdp_url,
              port: existing.port,
              pid: existing.pid || null,
              ws_url: data.webSocketDebuggerUrl || null,
              browser: data.Browser || ''
            };
          }
        } catch (_) { }
        activeMultiZenProcesses.delete(cleanId);
      }

      const lockedNow = this.isProfileLockedByKernel(cleanId);
      for (const baseDir of baseDirs) {
        const engineDir = resolveEngineDataDir(baseDir);
        const sessionFile = path.join(engineDir, 'multizen_session.json');
        if (fs.existsSync(sessionFile)) {
          try {
            const sess = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
            if (sess && sess.is_ide_background_session === true && process.env.ANTIGRAVITY_AGENT !== '1') {
              // O Chrome anterior foi aberto na sessão oculta da IDE (exebox); mata para reabrir 100% visível no monitor!
              try {
                if (sess.pid) {
                  require('child_process').execFileSync('taskkill.exe', ['/PID', String(sess.pid), '/T', '/F'], { stdio: 'ignore', timeout: 3000, windowsHide: true });
                }
                fs.unlinkSync(sessionFile);
              } catch (_) { }
              activeMultiZenProcesses.delete(cleanId);
              return null;
            }
            if (sess && sess.port) {
              const cdpUrl = `http://127.0.0.1:${sess.port}`;
              const ctrl = new AbortController();
              const tm = setTimeout(() => ctrl.abort(), 1500);
              const res = await fetch(`${cdpUrl}/json/version`, { signal: ctrl.signal });
              clearTimeout(tm);
              if (res.ok) {
                const data = await res.json();
                activeMultiZenProcesses.set(cleanId, {
                  pid: sess.pid || null,
                  port: Number(sess.port),
                  cdp_url: cdpUrl,
                  startedAt: sess.startedAt || new Date().toISOString(),
                  browserDataDir: engineDir
                });
                return {
                  cdp_url: cdpUrl,
                  port: Number(sess.port),
                  pid: sess.pid || null,
                  ws_url: data.webSocketDebuggerUrl || null,
                  browser: data.Browser || ''
                };
              }
            }
          } catch (_) { }
        }

        const portFile = fs.existsSync(path.join(engineDir, 'DevToolsActivePort'))
          ? path.join(engineDir, 'DevToolsActivePort')
          : path.join(baseDir, 'chromium-cloakbrowser', 'DevToolsActivePort');
        if (fs.existsSync(portFile)) {
          const lines = fs.readFileSync(portFile, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
          const port = parseInt(lines[0], 10);
          if (Number.isFinite(port) && port > 0 && port !== 9222 && port !== 9223) {
            const cdpUrl = `http://127.0.0.1:${port}`;
            const ctrl = new AbortController();
            const tm = setTimeout(() => ctrl.abort(), 1500);
            const res = await fetch(`${cdpUrl}/json/version`, { signal: ctrl.signal });
            clearTimeout(tm);
            if (res.ok) {
              const data = await res.json();
              activeMultiZenProcesses.set(cleanId, {
                pid: null,
                port,
                cdp_url: cdpUrl,
                startedAt: new Date().toISOString(),
                browserDataDir: engineDir
              });
              return { cdp_url: cdpUrl, port, pid: null, ws_url: data.webSocketDebuggerUrl || null, browser: data.Browser || '' };
            }
          }
        }
      }

      // Fallback WMI determinístico: descobre ProcessId + --remote-debugging-port direto da linha de comando do chrome.exe!
      if (lockedNow || cleanId) {
        try {
          const { execFileSync } = require('child_process');
          const wmiOut = execFileSync(
            'powershell.exe',
            [
              '-NoProfile',
              '-Command',
              `Get-CimInstance Win32_Process -Filter "Name='chrome.exe' AND CommandLine LIKE '%${cleanId}%' AND CommandLine LIKE '%--remote-debugging-port=%'" | Select-Object -First 1 ProcessId, CommandLine | ConvertTo-Json -Compress`
            ],
            { encoding: 'utf8', timeout: 3500, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }
          ).trim();
          if (wmiOut) {
            const parsed = JSON.parse(wmiOut);
            const cmdLine = String(parsed?.CommandLine || '');
            const foundPid = Number(parsed?.ProcessId) || null;
            const mPort = cmdLine.match(/--remote-debugging-port=(\d+)/);
            if (mPort && mPort[1]) {
              const pPort = parseInt(mPort[1], 10);
              if (Number.isFinite(pPort) && pPort > 0 && pPort !== 9222 && pPort !== 9223) {
                const cdpUrl = `http://127.0.0.1:${pPort}`;
                const ctrl = new AbortController();
                const tm = setTimeout(() => ctrl.abort(), 1500);
                const res = await fetch(`${cdpUrl}/json/version`, { signal: ctrl.signal });
                clearTimeout(tm);
                if (res.ok) {
                  const data = await res.json();
                  const info = {
                    pid: foundPid,
                    port: pPort,
                    cdp_url: cdpUrl,
                    startedAt: new Date().toISOString(),
                    browserDataDir: primaryEngineDir
                  };
                  activeMultiZenProcesses.set(cleanId, info);
                  try {
                    fs.writeFileSync(path.join(primaryEngineDir, 'DevToolsActivePort'), `${pPort}\n/devtools/browser/${cleanId}\n`, 'utf8');
                    fs.writeFileSync(path.join(primaryEngineDir, 'multizen_session.json'), JSON.stringify(info, null, 2), 'utf8');
                  } catch (_) { }
                  return {
                    cdp_url: cdpUrl,
                    port: pPort,
                    pid: foundPid,
                    ws_url: data.webSocketDebuggerUrl || null,
                    browser: data.Browser || ''
                  };
                }
              }
            }
          }
        } catch (_) { }
      }
    } catch (_) { }
    return null;
  }

  static getStatus() {
    const binPath = this.getCloakBrowserBinaryPath();
    const profiles = this.listProfiles();
    return {
      installed: fs.existsSync(MULTIZEN_DB_PATH) || Boolean(binPath),
      cloak_browser_ready: Boolean(binPath && fs.existsSync(binPath)),
      cloak_browser_binary: binPath || null,
      db_path: MULTIZEN_DB_PATH,
      total_profiles: profiles.length,
      running_profiles_count: profiles.filter(p => p.locked_active).length,
      profiles
    };
  }

  static getProfile(profileId) {
    if (!fs.existsSync(MULTIZEN_DB_PATH)) return null;
    const db = this.openDb(true);
    try {
      const r = db.prepare('SELECT * FROM profiles WHERE id = ?').get(String(profileId).trim());
      if (!r) return null;
      let fp = {};
      let proxy = null;
      let tags = [];
      try { fp = JSON.parse(r.fingerprint || '{}'); } catch (_) { }
      try { proxy = r.proxy ? JSON.parse(r.proxy) : null; } catch (_) { }
      try { tags = JSON.parse(r.tags || '[]'); } catch (_) { }
      return {
        id: r.id,
        profile_browser_ID: r.id,
        name: r.name,
        profile_name: r.name,
        notes: r.notes || '',
        tags,
        proxy,
        fingerprint: fp,
        fingerprint_seed: computeNumericFingerprintSeed(r.id, fp),
        gpu: fp.webgl || null,
        data_dir: r.data_dir,
        engine: r.engine || 'cloakbrowser',
        start_url: r.start_url || 'https://www.facebook.com/',
        created_at: r.created_at,
        updated_at: r.updated_at,
        last_opened_at: r.last_opened_at
      };
    } finally {
      db.close();
    }
  }

  /**
   * Cria 1 novo perfil isolado no MultiZen Browser com CloakBrowser C++ e Proxy 4G (127.0.0.1:8080)
   */
  static createProfile({
    name,
    notes = 'Criado via Esteira Hub Central 001',
    tags = ['001', '4G', 'ESTEIRA'],
    use4gProxy = true,
    proxyHost = '127.0.0.1',
    proxyPort = 8080,
    proxyHostPort = null,
    timezone = 'America/Sao_Paulo',
    locale = 'pt-BR',
    startUrl = 'https://www.facebook.com/'
  } = {}) {
    if (proxyHostPort && String(proxyHostPort).includes(':')) {
      const [h, p] = String(proxyHostPort).split(':');
      if (h) proxyHost = h.trim();
      if (p) proxyPort = Number(p.trim()) || 8080;
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const dataDir = path.join(MULTIZEN_PROFILES_ROOT, id);
    const hasOfficialChrome = Boolean(this.getOfficialGoogleChromeBinaryPath());
    const engineDataDir = hasOfficialChrome
      ? path.join(dataDir, 'chrome_native')
      : resolveEngineDataDir(dataDir);
    fs.mkdirSync(engineDataDir, { recursive: true });
    if (hasOfficialChrome) {
      seedOfficialChromeVariationsAndTrustTokens(engineDataDir);
    }
    // Vacina o Default/Preferences no disco já no nascimento do perfil (WebRTC, DoH, Preconnect, DPR 1.0)
    sanitizeMultiZenDiskBeforeLaunch(engineDataDir);

    const fp = buildRealisticFingerprint(id, { timezone, locale });
    const proxyObj = use4gProxy
      ? { protocol: 'http', host: proxyHost, port: Number(proxyPort) }
      : null;

    const db = this.openDb(false);
    try {
      db.prepare(`
        INSERT INTO profiles (
          id, name, notes, tags, proxy, fingerprint, data_dir,
          created_at, updated_at, last_opened_at, proxy_country,
          extensions, icon, start_url, search_provider, engine
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, '[]', 'globe', ?, 'duckduckgo', 'cloakbrowser')
      `).run(
        id,
        String(name || `CONTA 001 - ${id.slice(0, 6)}`).trim(),
        notes,
        JSON.stringify(tags),
        proxyObj ? JSON.stringify(proxyObj) : null,
        JSON.stringify(fp),
        dataDir,
        now,
        now,
        'br',
        startUrl
      );
    } finally {
      db.close();
    }

    return this.getProfile(id);
  }

  /**
   * Cria um lote de N perfis isolados (ex.: 2, 5 ou 10 contas novas do dia)
   */
  static createBatchProfiles(countOrOpts = 5, maybeOpts = {}) {
    const opts = typeof countOrOpts === 'object' && countOrOpts !== null
      ? countOrOpts
      : { count: countOrOpts, ...(maybeOpts || {}) };
    const {
      count = 5,
      prefix = 'CONTA 4G',
      startNumber = 1,
      tags = ['001', '4G', 'LOTE_DIARIO'],
      use4gProxy = true,
      proxyHostPort = '127.0.0.1:8080'
    } = opts;
    const created = [];
    const safeCount = Math.max(1, Math.min(50, Number(count) || 1));
    for (let i = 0; i < safeCount; i++) {
      const num = startNumber + i;
      const label = `${prefix} #${String(num).padStart(2, '0')}`;
      const prof = this.createProfile({
        name: label,
        tags,
        use4gProxy,
        proxyHostPort
      });
      created.push(prof);
    }
    return {
      created_count: created.length,
      created
    };
  }

  /**
   * Lança o perfil MultiZen usando o binário CloakBrowser 146 C++ Anti-Detect
   * com todos os flags nativos de fingerprint + Proxy 4G e retorna { cdp_url }.
   */
  static async ensureProfileLaunched(profileId, onLog = console.log, preferredPort = null) {
    const cleanId = String(profileId || '').trim();
    const probedExisting = await this.probeProfileLocalDevToolsPort(cleanId);
    if (probedExisting && probedExisting.cdp_url) {
      onLog(`[MultiZen C++] Perfil ${cleanId} já está aberto em ${probedExisting.cdp_url}. Reutilizando sessão!`);
      return {
        cdp_url: probedExisting.cdp_url,
        port: probedExisting.port || null,
        pid: probedExisting.pid || null,
        engine: 'cloakbrowser'
      };
    }

    const prof = this.getProfile(cleanId);
    if (!prof) {
      throw new Error(`Perfil MultiZen "${cleanId}" não encontrado em profiles.db.`);
    }

    const port = preferredPort || nextCdpPort++;
    migrateNativeChromeToCloakBrowser(prof.data_dir, onLog);
    const browserDataDir = resolveEngineDataDir(prof.data_dir);
    fs.mkdirSync(browserDataDir, { recursive: true });

    const officialChromeBin = this.getOfficialGoogleChromeBinaryPath();
    const isNativeChromeProfile = path.basename(browserDataDir) === 'chrome_native' && Boolean(officialChromeBin);
    const binPath = isNativeChromeProfile ? officialChromeBin : this.getCloakBrowserBinaryPath();
    if (!binPath) {
      throw new Error('Binário do navegador (Chrome Oficial ou CloakBrowser) não encontrado.');
    }

    const fp = prof.fingerprint || buildRealisticFingerprint(cleanId);
    const seed = computeNumericFingerprintSeed(cleanId, fp);

    seedOfficialChromeVariationsAndTrustTokens(browserDataDir, seed);
    // Higieniza supercookies de rede (Reporting & NEL, QUIC broken_alternative_services) e blinda Preferences antes do launch
    sanitizeMultiZenDiskBeforeLaunch(browserDataDir, seed, fp);

    if (process.env.ANTIGRAVITY_AGENT === '1') {
      onLog(`⚠️ [AVISO DE TELA VISÍVEL] O servidor do Hub está rodando na sessão em segundo plano da IDE. Para a janela do navegador abrir visível no seu monitor, dê 2 cliques em ABRIR_HUB_CENTRAL_001.bat!`);
    }

    const acceptLang = Array.isArray(fp.languages) && fp.languages.length > 0
      ? fp.languages.join(',')
      : 'pt-BR,pt,en-US,en';
    const screenW = (fp.screen && fp.screen.width) || 1920;
    const screenH = (fp.screen && fp.screen.height) || 1080;
    const safeDeviceMem = deviceMemoryApiValue(fp.deviceMemory || 8);
    const geoLat = fp.geolocation && typeof fp.geolocation.latitude === 'number' ? fp.geolocation.latitude : -19.7472;
    const geoLon = fp.geolocation && typeof fp.geolocation.longitude === 'number' ? fp.geolocation.longitude : -47.9381;

    const isMatrixFixedIp = cleanId.toLowerCase() === '00000000-0000-0000-0000-000000000004';
    if (isMatrixFixedIp && process.env.FORCE_MULTIZEN_MATRIZ !== '1') {
      throw new Error('🚨 [FIREWALL DE REDE] PERFIL 04 (MATRIZ) é exclusivo do Incogniton em IP Fixo (WITHOUT_PROXY) — bloqueado no MultiZen 4G!');
    }

    // FAIL-CLOSED 4G PROXY: Todo perfil 4G no MultiZen OBRIGATORIAMENTE usa o túnel 127.0.0.1:8080 (jamais cai para o Wi-Fi fixo se prof.proxy vier nulo!)
    const effectiveProxy = isMatrixFixedIp
      ? null
      : (prof.proxy && prof.proxy.host && prof.proxy.port
          ? prof.proxy
          : { protocol: 'http', host: '127.0.0.1', port: 8080 });

    let args;
    if (isNativeChromeProfile) {
      const hwProf = selectOfficialChromeHardwareProfile(seed, fp);
      args = [
        `--user-data-dir=${browserDataDir}`,
        `--remote-debugging-port=${port}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--restore-last-session',
        ...hwProf.cli_flags
      ];
      if (isMatrixFixedIp) {
        args.push('--no-proxy-server');
      } else if (effectiveProxy) {
        const proto = effectiveProxy.protocol || 'http';
        let effHost = effectiveProxy.host;
        let effPort = effectiveProxy.port;
        if (effHost === '127.0.0.1' && Number(effPort) === 8080) {
          try {
            const ipv4Bridge = require('./modules/infra_4g/ipv4_proxy_bridge');
            await ipv4Bridge.ensureIpv4ProxyBridgeRunning(onLog);
            effPort = ipv4Bridge.BRIDGE_PORT;
          } catch (_) { }
        }
        args.push('--disable-quic');
        args.push(`--proxy-server=${proto}://${effHost}:${effPort}`);
        args.push('--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1');
      }
    } else {
      const hwGeom = selectOfficialChromeHardwareProfile(seed, fp);
      args = [
        `--user-data-dir=${browserDataDir}`,
        `--remote-debugging-port=${port}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--restore-last-session',
        '--disable-features=Translate,MediaRouter',
        `--lang=${fp.locale || 'pt-BR'}`,
        `--accept-lang=${acceptLang}`,
        `--window-position=${hwGeom.window_x},${hwGeom.window_y}`,
        `--window-size=${screenW},${screenH}`,
        `--fingerprint=${seed}`,
        '--fingerprint-platform=windows',
        `--fingerprint-timezone=${fp.timezone || 'America/Sao_Paulo'}`,
        `--fingerprint-location=${geoLat},${geoLon}`,
        `--fingerprint-screen-width=${screenW}`,
        `--fingerprint-screen-height=${screenH}`,
        `--fingerprint-hardware-concurrency=${fp.hardwareConcurrency || 8}`,
        `--fingerprint-device-memory=${safeDeviceMem}`
      ];

      if (fp.webgl && fp.webgl.vendor) {
        args.push(`--fingerprint-gpu-vendor=${fp.webgl.vendor}`);
      }
      if (fp.webgl && fp.webgl.renderer) {
        args.push(`--fingerprint-gpu-renderer=${fp.webgl.renderer}`);
      }
      args.push('--fingerprint-brand=Chrome');
      args.push('--fingerprint-brand-version=146.0.7680.177');
      args.push('--fingerprint-platform-version=15.0.0');

      if (isMatrixFixedIp) {
        args.push('--no-proxy-server');
      } else if (effectiveProxy) {
        const proto = effectiveProxy.protocol || 'http';
        let effHost = effectiveProxy.host;
        let effPort = effectiveProxy.port;
        if (effHost === '127.0.0.1' && Number(effPort) === 8080) {
          try {
            const ipv4Bridge = require('./modules/infra_4g/ipv4_proxy_bridge');
            const brStatus = await ipv4Bridge.ensureIpv4ProxyBridgeRunning(onLog);
            if (brStatus && brStatus.running) effPort = ipv4Bridge.BRIDGE_PORT;
          } catch (_) { }
        }
        args.push('--fingerprint-webrtc-ip=auto');
        args.push(`--proxy-server=${proto}://${effHost}:${effPort}`);
        args.push('--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1');
        args.push('--disable-quic');
        args.push('--force-webrtc-ip-handling-policy=disable_non_proxied_udp');
        args.push('--enforce-webrtc-ip-permission-check');
        args.push('--dns-over-https-mode=off');
      }
    }

    const hasSession = fs.existsSync(path.join(browserDataDir, 'Default', 'Sessions'));
    if (!hasSession) {
      args.push(prof.start_url || 'https://www.facebook.com/');
    }

    onLog(`🚀 [MultiZen CloakBrowser C++] Iniciando perfil "${prof.name}" (${cleanId}) na porta CDP ${port} (Seed #${seed})...`);

    const child = spawn(binPath, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
      env: {
        ...process.env,
        SystemRoot: process.env.SystemRoot || 'C:\\WINDOWS',
        WINDIR: process.env.WINDIR || 'C:\\WINDOWS'
      }
    });
    child.unref();

    // Atualiza last_opened_at no SQLite do MultiZen
    try {
      const db = this.openDb(false);
      db.prepare('UPDATE profiles SET last_opened_at = ?, updated_at = ? WHERE id = ?')
        .run(new Date().toISOString(), new Date().toISOString(), cleanId);
      db.close();
    } catch (_) { }

    const cdpUrl = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(`${cdpUrl}/json/version`);
        if (res.ok) {
          const info = {
            pid: child.pid,
            port,
            cdp_url: cdpUrl,
            startedAt: new Date().toISOString(),
            browserDataDir,
            is_ide_background_session: process.env.ANTIGRAVITY_AGENT === '1'
          };
          activeMultiZenProcesses.set(cleanId, info);
          try {
            fs.writeFileSync(path.join(browserDataDir, 'DevToolsActivePort'), `${port}\n/devtools/browser/${cleanId}\n`, 'utf8');
            fs.writeFileSync(path.join(browserDataDir, 'multizen_session.json'), JSON.stringify(info, null, 2), 'utf8');
          } catch (_) { }
          onLog(`✅ [MultiZen CloakBrowser C++] Perfil "${prof.name}" pronto em ${cdpUrl} (PID ${child.pid})!`);
          return { cdp_url: cdpUrl, port, pid: child.pid, engine: 'cloakbrowser' };
        }
      } catch (_) { }
      await new Promise(r => setTimeout(r, 500));
    }

    throw new Error(`Timeout aguardando CloakBrowser abrir porta CDP ${port} para o perfil ${cleanId}.`);
  }

  /**
   * Lança o perfil MultiZen no Modo STEALTH 100% HUMANO (ZERO PUPPETEER / ZERO CDP):
   * - NÃO passa `--remote-debugging-port` e NÃO conecta Puppeteer (Zero BotGuard Detection no Signup do Google/YouTube!)
   * - Passa `--disable-quic`, `--proxy-server=http://127.0.0.1:8080`, `--fingerprint=...`, `--lang=pt-BR`
   * - Abre direto em `startUrl` (`https://www.youtube.com`) na janela visível (`windowsHide: false`)
   */
  static async launchProfileStealthZeroCdp(profileId, startUrl = 'https://www.youtube.com', onLog = console.log) {
    const cleanId = String(profileId || '').trim();
    const prof = this.getProfile(cleanId);
    if (!prof) {
      throw new Error(`Perfil MultiZen "${cleanId}" não encontrado em profiles.db.`);
    }

    // Se já estiver aberto (ex.: com CDP antigo), fecha primeiro para abrir 100% Zero-CDP
    if (this.isProfileLockedByKernel(cleanId)) {
      await this.stopProfile(cleanId, onLog);
    }

    const rawUrlCheck = Array.isArray(startUrl) ? startUrl.join(' ') : String(startUrl || '');
    const isFacebookLaunch = /facebook\.com/i.test(rawUrlCheck);
    if (isFacebookLaunch) {
      migrateNativeChromeToCloakBrowser(prof.data_dir, onLog);
    }

    const officialChromeBin = this.getOfficialGoogleChromeBinaryPath();
    let browserDataDir = resolveEngineDataDir(prof.data_dir);
    // REGRA DE OURO HÍBRIDA (2026):
    // - Passo 1 (Criar Gmail no YouTube/Google): usa Google Chrome Oficial 157+ (VariationsSeedV2 + X-Client-Data -> zero QR Code / zero "Baixe o Chrome").
    // - Passo 2 em diante (Criar Facebook + Aquecimento): migra os cookies do Gmail para o MultiZen CloakBrowser 146 C++ e abre com Fingerprint C++ única (--fingerprint=seed, Canvas/WebGL/Audio/Screen/Font isolados)!
    const hasLegacyCloakCookies = path.basename(browserDataDir) !== 'chrome_native' &&
      fs.existsSync(path.join(browserDataDir, 'Default', 'Network', 'Cookies'));
    const useOfficialChrome = !isFacebookLaunch && Boolean(officialChromeBin) && !hasLegacyCloakCookies;
    if (useOfficialChrome) {
      browserDataDir = path.join(prof.data_dir, 'chrome_native');
    }
    const binPath = useOfficialChrome ? officialChromeBin : this.getCloakBrowserBinaryPath();
    if (!binPath) {
      throw new Error('Binário do navegador não encontrado.');
    }

    fs.mkdirSync(browserDataDir, { recursive: true });

    // Remove qualquer arquivo residual de DevToolsActivePort / multizen_session.json
    for (const f of ['DevToolsActivePort', 'multizen_session.json']) {
      const p = path.join(browserDataDir, f);
      if (fs.existsSync(p)) {
        try { fs.unlinkSync(p); } catch (_) { }
      }
    }

    const fp = prof.fingerprint || buildRealisticFingerprint(cleanId);
    const seed = computeNumericFingerprintSeed(cleanId, fp);

    seedOfficialChromeVariationsAndTrustTokens(browserDataDir, seed);
    // Vacina forense de disco pré-launch (Reporting & NEL, QUIC broken_alternative_services, WebRTC, DoH, Geometria por Seed, DPR 1.0)
    sanitizeMultiZenDiskBeforeLaunch(browserDataDir, seed, fp);

    const acceptLang = Array.isArray(fp.languages) && fp.languages.length > 0
      ? fp.languages.join(',')
      : 'pt-BR,pt,en-US,en';
    const screenW = (fp.screen && fp.screen.width) || 1920;
    const screenH = (fp.screen && fp.screen.height) || 1080;
    const safeDeviceMem = deviceMemoryApiValue(fp.deviceMemory || 8);
    const geoLat = fp.geolocation && typeof fp.geolocation.latitude === 'number' ? fp.geolocation.latitude : -19.7472;
    const geoLon = fp.geolocation && typeof fp.geolocation.longitude === 'number' ? fp.geolocation.longitude : -47.9381;

    // Suporta 1 URL ou múltiplas abas em Zero-CDP (ex: Facebook Home + Gmail Inbox + Portais com Meta Pixel _fbp)
    const urlList = Array.isArray(startUrl)
      ? startUrl.map(u => String(u || '').trim()).filter(Boolean)
      : [String(startUrl || 'https://www.youtube.com').trim()];
    if (urlList.length === 0) urlList.push('https://www.youtube.com');

    const proxyHost = (prof.proxy && prof.proxy.host) || '127.0.0.1';
    let proxyPort = (prof.proxy && prof.proxy.port) || 8080;
    const proxyProto = (prof.proxy && prof.proxy.protocol) || 'http';

    if (proxyHost === '127.0.0.1' && Number(proxyPort) === 8080) {
      try {
        const ipv4Bridge = require('./modules/infra_4g/ipv4_proxy_bridge');
        await ipv4Bridge.ensureIpv4ProxyBridgeRunning(onLog);
        proxyPort = ipv4Bridge.BRIDGE_PORT;
      } catch (_) { }
    }

    const isMatrixFixedIpZero = cleanId.toLowerCase() === '00000000-0000-0000-0000-000000000004';
    const hwProf = selectOfficialChromeHardwareProfile(seed, fp);
    let args;
    if (useOfficialChrome) {
      // GOOGLE CHROME OFICIAL 157+ ASSINADO PELA GOOGLE LLC:
      // - ZERO-CDP + X-Client-Data Único por Seed + VariationsSeedV2 + Ponte 4G IPv4 Puro (:8082)
      // - Rotação Real Dual-Silicon (AMD Radeon 680M <-> NVIDIA RTX 4050 + d3d11/d3d11on12 + Viewport Único)
      // - WebRTC e DoH já blindados silenciosamente via Default/Preferences (zero flags suspeitas na linha de comando!)
      args = [
        `--user-data-dir=${browserDataDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--new-window',
        '--disable-quic',
        ...hwProf.cli_flags
      ];
      if (isMatrixFixedIpZero) {
        args.push('--no-proxy-server');
      } else {
        args.push(`--proxy-server=${proxyProto}://${proxyHost}:${proxyPort}`);
        args.push('--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1');
      }
      args.push(...urlList);
    } else {
      args = [
        `--user-data-dir=${browserDataDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--new-window',
        '--disable-quic',
        '--disable-features=Translate,MediaRouter',
        `--lang=${fp.locale || 'pt-BR'}`,
        `--accept-lang=${acceptLang}`,
        `--window-position=${hwProf.window_x},${hwProf.window_y}`,
        `--window-size=${screenW},${screenH}`,
        `--fingerprint=${seed}`,
        '--fingerprint-platform=windows',
        `--fingerprint-timezone=${fp.timezone || 'America/Sao_Paulo'}`,
        `--fingerprint-location=${geoLat},${geoLon}`,
        `--fingerprint-screen-width=${screenW}`,
        `--fingerprint-screen-height=${screenH}`,
        `--fingerprint-hardware-concurrency=${fp.hardwareConcurrency || 8}`,
        `--fingerprint-device-memory=${safeDeviceMem}`
      ];

      if (fp.webgl && fp.webgl.vendor) {
        args.push(`--fingerprint-gpu-vendor=${fp.webgl.vendor}`);
      }
      if (fp.webgl && fp.webgl.renderer) {
        args.push(`--fingerprint-gpu-renderer=${fp.webgl.renderer}`);
      }
      args.push('--fingerprint-brand=Chrome');
      args.push('--fingerprint-brand-version=146.0.7680.177');
      args.push('--fingerprint-platform-version=15.0.0');
      if (isMatrixFixedIpZero) {
        args.push('--no-proxy-server');
      } else {
        args.push('--fingerprint-webrtc-ip=auto');
        args.push(`--proxy-server=${proxyProto}://${proxyHost}:${proxyPort}`);
        args.push('--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1');
        args.push('--force-webrtc-ip-handling-policy=disable_non_proxied_udp');
        args.push('--enforce-webrtc-ip-permission-check');
        args.push('--dns-over-https-mode=off');
      }
      for (const u of urlList) {
        args.push(u);
      }
    }

    onLog(`🎬 [PC Zero-QR-Code • ZERO-CDP] Abrindo "${prof.name}" (${cleanId}) em ${urlList.join(' + ')} [Engine: ${useOfficialChrome ? `Official Chrome 157 (${hwProf.silicon_family} • ${hwProf.angle_backend} • X-Client-Data #${seed})` : `CloakBrowser C++ (Seed #${seed})`} | Proxy 4G IPv4 ${proxyHost}:${proxyPort}]...`);

    const child = spawn(binPath, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
      env: {
        ...process.env,
        SystemRoot: process.env.SystemRoot || 'C:\\WINDOWS',
        WINDIR: process.env.WINDIR || 'C:\\WINDOWS'
      }
    });
    child.unref();

    const info = {
      pid: child.pid || null,
      zero_cdp: true,
      port: null,
      cdp_url: null,
      startedAt: new Date().toISOString(),
      browserDataDir,
      is_ide_background_session: false
    };
    activeMultiZenProcesses.set(cleanId, info);
    try {
      fs.writeFileSync(path.join(browserDataDir, 'multizen_session.json'), JSON.stringify(info, null, 2), 'utf8');
    } catch (_) { }

    if (child && typeof child.on === 'function') {
      child.on('exit', () => {
        activeMultiZenProcesses.delete(cleanId);
        try {
          const sPath = path.join(browserDataDir, 'multizen_session.json');
          if (fs.existsSync(sPath)) fs.unlinkSync(sPath);
        } catch (_) { }
      });
    }

    try {
      const db = this.openDb(false);
      db.prepare('UPDATE profiles SET last_opened_at = ?, updated_at = ? WHERE id = ?')
        .run(new Date().toISOString(), new Date().toISOString(), cleanId);
      db.close();
    } catch (_) { }

    await new Promise(r => setTimeout(r, 1200));

    return {
      profile_id: cleanId,
      profile_name: prof.name,
      pid: child.pid || null,
      browser_data_dir: browserDataDir,
      fingerprint_seed: seed,
      gpu: fp.webgl && fp.webgl.renderer ? fp.webgl.renderer : '',
      start_url: urlList[0],
      opened_urls: urlList,
      zero_cdp: true,
      engine: 'cloakbrowser'
    };
  }

  /**
   * Fecha gentilmente uma janela Stealth Zero-CDP para garantir que o SQLite de Cookies
   * (`SID`, `SAPISID`, `OSID`, `VISITOR_INFO1_LIVE`) faça flush limpo para o disco antes de encerrar.
   */
  static async closeStealthZeroCdpProfileGracefully(profileId, pid = null, onLog = console.log) {
    const cleanId = String(profileId || '').trim();
    const { execFileSync } = require('child_process');
    try {
      if (pid) {
        // Envia WM_CLOSE gentil sem /F primeiro para o Chromium gravar Cookies e Preferences (exited_cleanly: true)
        execFileSync('taskkill.exe', ['/PID', String(pid)], { timeout: 3000, stdio: 'ignore', windowsHide: true });
      } else if (cleanId) {
        execFileSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-Command',
            `Get-CimInstance Win32_Process -Filter "Name='chrome.exe' AND CommandLine LIKE '%${cleanId}%'" | ForEach-Object { $p = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; if ($p) { $null = $p.CloseMainWindow() } }`
          ],
          { timeout: 3500, stdio: 'ignore', windowsHide: true }
        );
      }
    } catch (_) { }

    await new Promise(r => setTimeout(r, 2000));
    await this.stopProfile(cleanId, onLog);
    if (cleanId) {
      try {
        const baseDir = path.join(MULTIZEN_PROFILES_ROOT, cleanId);
        const engineDir = resolveEngineDataDir(baseDir);
        sanitizeMultiZenDiskBeforeLaunch(engineDir);
      } catch (_) { }
    }
    return true;
  }

  static renameProfile(profileId, newName, newNotes = null) {
    const cleanId = String(profileId || '').trim();
    if (!cleanId || !newName || !fs.existsSync(MULTIZEN_DB_PATH)) return false;
    const db = this.openDb(false);
    try {
      if (newNotes !== null) {
        db.prepare('UPDATE profiles SET name = ?, notes = ?, updated_at = ? WHERE id = ?')
          .run(String(newName).trim(), String(newNotes).trim(), new Date().toISOString(), cleanId);
      } else {
        db.prepare('UPDATE profiles SET name = ?, updated_at = ? WHERE id = ?')
          .run(String(newName).trim(), new Date().toISOString(), cleanId);
      }
      return true;
    } catch (_) {
      return false;
    } finally {
      db.close();
    }
  }

  /**
   * Fecha de forma limpa o processo CloakBrowser C++ de um perfil MultiZen
   * (Mesmo que tenha sido aberto por um processo anterior do server.js!)
   */
  static async stopProfile(profileId, onLog = console.log) {
    const cleanId = String(profileId || '').trim();
    if (!cleanId) return false;
    await this.callDesktopMcp('close_profile', { profile_id: cleanId }, 5000).catch(() => null);

    const probed = await this.probeProfileLocalDevToolsPort(cleanId).catch(() => null);
    if (probed && probed.ws_url) {
      try {
        const WebSocket = require('ws');
        const ws = new WebSocket(probed.ws_url);
        await new Promise((resolve) => {
          const t = setTimeout(resolve, 1500);
          ws.on('open', () => {
            try { ws.send(JSON.stringify({ id: 1, method: 'Browser.close', params: {} })); } catch (_) { }
            setTimeout(() => { clearTimeout(t); try { ws.close(); } catch (_) { } resolve(); }, 600);
          });
          ws.on('error', () => { clearTimeout(t); resolve(); });
        });
      } catch (_) { }
    }

    const { execFileSync } = require('child_process');
    const info = activeMultiZenProcesses.get(cleanId) || probed;
    if (info && info.pid) {
      try {
        // Mata toda a árvore de processos (/T) do CloakBrowser (incluindo filhos GPU/Utility/Crashpad que seguram lockfile e CommandLine)
        execFileSync('taskkill.exe', ['/F', '/T', '/PID', String(info.pid)], { timeout: 3500, stdio: 'ignore', windowsHide: true });
        onLog(`🛑 [MultiZen CloakBrowser C++] Árvore do processo PID ${info.pid} do perfil ${cleanId.slice(0, 8)} encerrada.`);
      } catch (_) {
        try { process.kill(info.pid); } catch (_) { }
      }
    }
    activeMultiZenProcesses.delete(cleanId);

    // Garante encerramento determinístico de qualquer processo chrome.exe remanescente deste perfil e liberação do lockfile do kernel
    for (let waitAttempt = 0; waitAttempt < 8; waitAttempt++) {
      if (!this.isProfileLockedByKernel(cleanId) && waitAttempt > 0) break;
      if (waitAttempt === 0 || this.isProfileLockedByKernel(cleanId)) {
        try {
          execFileSync(
            'powershell.exe',
            [
              '-NoProfile',
              '-Command',
              `Get-CimInstance Win32_Process -Filter "Name='chrome.exe' AND CommandLine LIKE '%${cleanId}%'" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`
            ],
            { timeout: 3500, stdio: 'ignore', windowsHide: true }
          );
        } catch (_) { }
      }
      if (!this.isProfileLockedByKernel(cleanId)) break;
      await new Promise(r => setTimeout(r, 300));
    }

    try {
      const baseDir = path.join(MULTIZEN_PROFILES_ROOT, cleanId);
      const engineDir = resolveEngineDataDir(baseDir);
      for (const f of ['DevToolsActivePort', 'multizen_session.json']) {
        const p = path.join(engineDir, f);
        if (fs.existsSync(p)) {
          try { fs.unlinkSync(p); } catch (_) { }
        }
      }
    } catch (_) { }

    return true;
  }

  /**
   * Vacina retroativamente todos os perfis já existentes no profiles.db do MultiZen:
   * - Corrige deviceMemory > 8 para <= 8 (teto W3C)
   * - Garante geolocation determinística BR (-19.7472, -47.9381 + jitter)
   * - Executa sanitizeMultiZenDiskBeforeLaunch no diretório de cada perfil (se não estiver em uso)
   */
  static vaccinateAllExistingProfiles() {
    if (!fs.existsSync(MULTIZEN_DB_PATH)) return { vaccinated: 0 };
    const db = this.openDb(false);
    let count = 0;
    try {
      const rows = db.prepare('SELECT id, fingerprint, data_dir FROM profiles').all();
      const updateStmt = db.prepare('UPDATE profiles SET fingerprint = ? WHERE id = ?');
      for (const r of rows) {
        let fp = {};
        try { fp = JSON.parse(r.fingerprint || '{}'); } catch (_) { }
        const rebuilt = buildRealisticFingerprint(r.id, {
          screen: fp.screen,
          webgl: fp.webgl,
          hardwareConcurrency: fp.hardwareConcurrency,
          deviceMemory: deviceMemoryApiValue(fp.deviceMemory || 8),
          timezone: fp.timezone || 'America/Sao_Paulo',
          locale: fp.locale || 'pt-BR',
          languages: fp.languages
        });
        const mergedFp = Object.assign({}, rebuilt, fp, {
          deviceMemory: deviceMemoryApiValue(fp.deviceMemory || 8),
          geolocation: fp.geolocation && typeof fp.geolocation.latitude === 'number'
            ? fp.geolocation
            : rebuilt.geolocation
        });
        updateStmt.run(JSON.stringify(mergedFp), r.id);
        if (!this.isProfileLockedByKernel(r.id) && r.data_dir) {
          const engineDir = resolveEngineDataDir(r.data_dir);
          sanitizeMultiZenDiskBeforeLaunch(engineDir);
        }
        count++;
      }
    } finally {
      db.close();
    }
    return { vaccinated: count };
  }
}

MultiZenService.MultiZenService = MultiZenService;
MultiZenService.sanitizeMultiZenDiskBeforeLaunch = sanitizeMultiZenDiskBeforeLaunch;
MultiZenService.seedOfficialChromeVariationsAndTrustTokens = seedOfficialChromeVariationsAndTrustTokens;
MultiZenService.selectOfficialChromeHardwareProfile = selectOfficialChromeHardwareProfile;
MultiZenService.GPU_PROFILES_WIN = GPU_PROFILES_WIN;
MultiZenService.SCREEN_PROFILES = SCREEN_PROFILES;
module.exports = MultiZenService;
