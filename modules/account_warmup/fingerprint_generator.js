/**
 * ============================================================================
 * FINGERPRINT GENERATOR — MOTOR DE FINGERPRINT ISOLADA C++ (MULTIZEN / 4G)
 * ============================================================================
 * Gera e renova perfis Chrome / CloakBrowser 146 C++ com Fingerprint única e
 * determinística por perfil (Canvas/WebGL/Audio Seed 10000..99999, GPU Windows,
 * Resolução de Tela, HardwareConcurrency, W3C DeviceMemory <= 8GB e Proxy 4G
 * ADB 127.0.0.1:8080) para a Esteira de Criação Zero-CDP.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const MultiZenService = require('../../multizen');
const { GPU_PROFILES_WIN, SCREEN_PROFILES } = MultiZenService;

const DB_JSON_PATH = path.join(__dirname, '..', '..', 'database.json');

function isStandingFacebookProfileId(profileId) {
  if (!profileId) return false;
  try {
    if (!fs.existsSync(DB_JSON_PATH)) return false;
    const raw = JSON.parse(fs.readFileSync(DB_JSON_PATH, 'utf8'));
    const profiles = Array.isArray(raw.PROFILES) ? raw.PROFILES : [];
    const target = String(profileId).trim().toLowerCase();
    return profiles.some(p => String(p.profile_browser_ID || '').trim().toLowerCase() === target);
  } catch (_) {
    return false;
  }
}

/**
 * Limpa 100% os artefatos de disco de um Slot Virgem (sem Gmail/Facebook de pé)
 * antes de aplicar uma nova Fingerprint C++ e novo IP 4G.
 * Isso impede que o Google BotGuard veja os mesmos Cookies (__Secure-YNID, VISITOR_INFO1_LIVE),
 * Trust Tokens, MediaDeviceSalts e Local State (client_id) mudarem de placa de vídeo (GPU),
 * resolução de tela e Seed C++ entre tentativas!
 */
function wipeVirginProfileDiskDirectory(profileDataDir, profileId) {
  if (!profileDataDir || !fs.existsSync(profileDataDir)) return false;
  if (isStandingFacebookProfileId(profileId)) {
    return false; // Trava absoluta: NUNCA limpa disco de conta com Facebook de pé!
  }
  try {
    const entries = fs.readdirSync(profileDataDir);
    for (const entry of entries) {
      const fullPath = path.join(profileDataDir, entry);
      try {
        fs.rmSync(fullPath, { recursive: true, force: true });
      } catch (_) {}
    }
    const hasOfficialChrome = typeof MultiZenService.getOfficialGoogleChromeBinaryPath === 'function' &&
      Boolean(MultiZenService.getOfficialGoogleChromeBinaryPath());
    const targetEngineDir = hasOfficialChrome
      ? path.join(profileDataDir, 'chrome_native')
      : path.join(profileDataDir, 'engines', 'cloakbrowser');
    fs.mkdirSync(targetEngineDir, { recursive: true });
    if (hasOfficialChrome && typeof MultiZenService.seedOfficialChromeVariationsAndTrustTokens === 'function') {
      MultiZenService.seedOfficialChromeVariationsAndTrustTokens(targetEngineDir);
    }
    if (typeof MultiZenService.sanitizeMultiZenDiskBeforeLaunch === 'function') {
      MultiZenService.sanitizeMultiZenDiskBeforeLaunch(targetEngineDir);
    }
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Gera um Seed numérico único (10000..99999) compatível com CloakBrowser C++
 */
function generateFreshFingerprintSeed(entropyStr = '') {
  const raw = `${entropyStr || ''}_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  const hex = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 8);
  return 10000 + (Number.parseInt(hex, 16) % 90000);
}

/**
 * Cria um novo perfil isolado no MultiZen C++ com Fingerprint nova e Proxy 4G (127.0.0.1:8080)
 */
function createNewIsolatedFingerprintProfile(options = {}) {
  const slotName = String(options.name || `CONTA 4G #${Date.now().toString().slice(-4)}`).trim();
  const ip4g = String(options.ip_4g || '4G_DINAMICO').trim();
  const startUrl = String(options.startUrl || 'https://www.youtube.com').trim();
  const created = MultiZenService.createProfile({
    name: slotName,
    notes: options.notes || `Fingerprint Nova Isolada 4G (${ip4g}) • Esteira Zero-CDP + Wilas Dia 01`,
    tags: Array.isArray(options.tags) ? options.tags : ['001', '4G', 'FINGERPRINT_NOVA', 'WILAS_DIA01'],
    use4gProxy: true,
    proxyHost: options.proxyHost || '127.0.0.1',
    proxyPort: Number(options.proxyPort || 8080),
    timezone: options.timezone || 'America/Sao_Paulo',
    locale: options.locale || 'pt-BR',
    startUrl
  });

  return {
    profile_id: created.id || created.profile_browser_ID,
    name: created.name || created.profile_name || slotName,
    fingerprint_seed: created.fingerprint_seed,
    gpu: created.gpu || created.fingerprint?.webgl || GPU_PROFILES_WIN[0],
    screen: created.fingerprint?.screen || SCREEN_PROFILES[0],
    data_dir: created.dataDir || created.data_dir,
    proxy: 'http://127.0.0.1:8080'
  };
}

/**
 * Garante que um Slot Virgem (ainda sem Gmail/Facebook logado) receba uma Fingerprint
 * 100% nova e exclusiva antes de abrir a janela Zero-CDP no novo IP 4G.
 */
function refreshVirginSlotFingerprint(profileId, options = {}) {
  if (!profileId || !MultiZenService.hasProfile(profileId)) {
    return createNewIsolatedFingerprintProfile(options);
  }
  const db = MultiZenService.openDb(false);
  try {
    const row = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
    if (!row) {
      return createNewIsolatedFingerprintProfile(options);
    }
    let fp = {};
    try {
      fp = JSON.parse(row.fingerprint || '{}');
    } catch (_) {
      fp = {};
    }
    const newSeed = generateFreshFingerprintSeed(`${profileId}_${options.ip_4g || ''}`);
    const gpuIdx = newSeed % GPU_PROFILES_WIN.length;
    const scrIdx = Math.floor(newSeed / 7) % SCREEN_PROFILES.length;
    const chosenGpu = GPU_PROFILES_WIN[gpuIdx];
    const chosenScreen = SCREEN_PROFILES[scrIdx];

    const latJitter = Number((((newSeed % 1000) / 1000 - 0.5) * 0.022).toFixed(6));
    const lonJitter = Number(((((Math.floor(newSeed / 13) % 1000) / 1000) - 0.5) * 0.022).toFixed(6));

    fp.seed = newSeed;
    fp.webgl = chosenGpu;
    fp.screen = { width: chosenScreen.width, height: chosenScreen.height };
    fp.availScreen = { width: chosenScreen.width, height: Math.max(0, chosenScreen.height - 48) };
    fp.deviceMemory = 8;
    fp.hardwareConcurrency = [8, 12, 16][newSeed % 3];
    fp.geolocation = {
      latitude: Number((-19.7472 + latJitter).toFixed(6)),
      longitude: Number((-47.9381 + lonJitter).toFixed(6)),
      accuracy: 20 + (newSeed % 25)
    };

    const nowIso = new Date().toISOString();
    db.prepare('UPDATE profiles SET fingerprint = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(fp),
      nowIso,
      profileId
    );

    const diskWiped = options.wipeDisk !== false
      ? wipeVirginProfileDiskDirectory(row.data_dir, profileId)
      : false;

    return {
      profile_id: profileId,
      name: row.name,
      fingerprint_seed: newSeed,
      gpu: chosenGpu,
      screen: chosenScreen,
      data_dir: row.data_dir,
      proxy: 'http://127.0.0.1:8080',
      disk_wiped: diskWiped,
      refreshed: true
    };
  } finally {
    db.close();
  }
}

module.exports = {
  GPU_PROFILES_WIN,
  SCREEN_PROFILES,
  generateFreshFingerprintSeed,
  createNewIsolatedFingerprintProfile,
  refreshVirginSlotFingerprint,
  wipeVirginProfileDiskDirectory
};
