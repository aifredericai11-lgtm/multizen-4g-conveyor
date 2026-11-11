/**
 * ============================================================================
 * MÓDULO COMUM: COFRE LOCAL CRIPTOGRAFADO (.env.vault.json)
 * ============================================================================
 * Criptografia AES-256-GCM com chave derivada da máquina local (hostname + user + root).
 * Protege senhas, TOTPs e segredos de sistema sem expor em texto puro.
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const LOCAL_ENV_VAULT_FILE = path.join(PROJECT_ROOT, '.env.vault.json');

function getLocalVaultCipherKey() {
  const seed = `LOCAL_001_VAULT::${os.hostname()}::${process.env.USERNAME || 'operator'}::${PROJECT_ROOT}`;
  return crypto.createHash('sha256').update(seed).digest();
}

function encryptVaultSecret(plainText) {
  const clean = String(plainText || '').trim();
  if (!clean) return '';
  try {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', getLocalVaultCipherKey(), iv);
    const enc = Buffer.concat([cipher.update(clean, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
  } catch (_) {
    return '';
  }
}

function decryptVaultSecret(cipherText) {
  const raw = String(cipherText || '').trim();
  if (!raw) return '';
  if (!raw.startsWith('v1:')) return raw;
  try {
    const parts = raw.split(':');
    if (parts.length !== 4) return '';
    const iv = Buffer.from(parts[1], 'hex');
    const tag = Buffer.from(parts[2], 'hex');
    const enc = Buffer.from(parts[3], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', getLocalVaultCipherKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch (_) {
    return '';
  }
}

let _localEnvVaultCache = null;
let _localEnvVaultCacheTs = 0;

function loadLocalEnvVault(forceFresh = false) {
  const now = Date.now();
  if (!forceFresh && _localEnvVaultCache && (now - _localEnvVaultCacheTs) < 5000) {
    return _localEnvVaultCache;
  }
  try {
    if (fs.existsSync(LOCAL_ENV_VAULT_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(LOCAL_ENV_VAULT_FILE, 'utf8')) || { entries: {} };
      _localEnvVaultCache = parsed;
      _localEnvVaultCacheTs = now;
      return parsed;
    }
  } catch (_) {}
  const empty = { entries: {} };
  _localEnvVaultCache = empty;
  _localEnvVaultCacheTs = now;
  return empty;
}

function saveLocalEnvVault(vaultData) {
  try {
    const safeData = vaultData || { entries: {} };
    _localEnvVaultCache = safeData;
    _localEnvVaultCacheTs = Date.now();
    fs.writeFileSync(LOCAL_ENV_VAULT_FILE, JSON.stringify(safeData, null, 2), 'utf8');
  } catch (_) {}
}

function getSystemSecretFromLocalVault(secretKey) {
  if (process.env[secretKey]) return String(process.env[secretKey]).trim();
  const vault = loadLocalEnvVault();
  const sys = vault.system_secrets || {};
  return decryptVaultSecret(sys[secretKey] || '');
}

function storeAccountSecretInLocalVault(accountIdOrEmail, secrets = {}) {
  const key = String(accountIdOrEmail || '').trim().toLowerCase();
  if (!key) return;
  const vault = loadLocalEnvVault();
  vault.entries = vault.entries || {};
  const existing = vault.entries[key] || {};

  if (secrets.password && !String(secrets.password).includes('••••')) {
    existing.password_enc = encryptVaultSecret(secrets.password);
  }
  if (secrets.fb_password && !String(secrets.fb_password).includes('••••')) {
    existing.fb_password_enc = encryptVaultSecret(secrets.fb_password);
  }
  if (secrets.recovery_email !== undefined) {
    existing.recovery_email = String(secrets.recovery_email || '').trim();
  }
  if (secrets.google_totp_secret !== undefined) {
    existing.google_totp_enc = encryptVaultSecret(secrets.google_totp_secret);
  }
  if (secrets.totp_secret !== undefined) {
    existing.fb_totp_enc = encryptVaultSecret(secrets.totp_secret);
  }
  existing.updated_at = new Date().toISOString();
  vault.entries[key] = existing;
  saveLocalEnvVault(vault);
}

function getAccountWithDecryptedVaultSecrets(acc) {
  if (!acc) return acc;
  const vault = loadLocalEnvVault();
  const entries = vault.entries || {};
  const byId = acc.id ? entries[String(acc.id).toLowerCase()] : null;
  const byEmail = acc.email ? entries[String(acc.email).trim().toLowerCase()] : null;
  const record = {
    ...(byEmail || {}),
    ...(byId || {}),
    password_enc: byId?.password_enc || byEmail?.password_enc || '',
    fb_password_enc: byId?.fb_password_enc || byEmail?.fb_password_enc || '',
    recovery_email: byId?.recovery_email || byEmail?.recovery_email || '',
    google_totp_enc: byId?.google_totp_enc || byEmail?.google_totp_enc || '',
    fb_totp_enc: byId?.fb_totp_enc || byEmail?.fb_totp_enc || ''
  };

  const decPassword = decryptVaultSecret(record.password_enc) || (!String(acc.password || '').includes('••••') ? acc.password : '');
  const decFbPassword = decryptVaultSecret(record.fb_password_enc) || decPassword;
  const decGoogleTotp = decryptVaultSecret(record.google_totp_enc) || acc.google_totp_secret || '';
  const decFbTotp = decryptVaultSecret(record.fb_totp_enc) || acc.totp_secret || '';

  return {
    ...acc,
    password: decPassword,
    fb_password: decFbPassword,
    recovery_email: record.recovery_email || acc.recovery_email || '',
    google_totp_secret: decGoogleTotp,
    totp_secret: decFbTotp || acc.totp_secret || ''
  };
}

function hasSecretInLocalVault(acc) {
  if (!acc) return false;
  const vault = loadLocalEnvVault();
  const entries = vault.entries || {};
  const byId = acc.id ? entries[String(acc.id).toLowerCase()] : null;
  const byEmail = acc.email ? entries[String(acc.email).trim().toLowerCase()] : null;
  const hasEnc = Boolean(byId?.password_enc || byEmail?.password_enc || byId?.fb_password_enc || byEmail?.fb_password_enc);
  return Boolean(hasEnc || (acc.password && !String(acc.password).includes('••••')));
}

function generateTotpCode(secretBase32) {
  if (!secretBase32 || typeof secretBase32 !== 'string') return null;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = secretBase32.toUpperCase().replace(/[^A-Z2-7]/g, '');
  if (!clean) return null;

  let bits = '';
  for (let i = 0; i < clean.length; i++) {
    const val = alphabet.indexOf(clean[i]);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  const keyBuf = Buffer.from(bytes);
  if (keyBuf.length === 0) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  const counter = Math.floor(nowSec / 30);
  const remainingSeconds = 30 - (nowSec % 30);

  const counterBuf = Buffer.alloc(8);
  counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuf.writeUInt32BE(counter >>> 0, 4);

  const hmac = crypto.createHmac('sha1', keyBuf).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const code = String(binary % 1000000).padStart(6, '0');
  return {
    code,
    remaining_seconds: remainingSeconds
  };
}

function formatTotpSecret(secret) {
  const clean = String(secret || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  if (!clean) return '';
  return clean.replace(/(.{4})/g, '$1 ').trim();
}

module.exports = {
  PROJECT_ROOT,
  LOCAL_ENV_VAULT_FILE,
  getLocalVaultCipherKey,
  encryptVaultSecret,
  decryptVaultSecret,
  loadLocalEnvVault,
  saveLocalEnvVault,
  getSystemSecretFromLocalVault,
  storeAccountSecretInLocalVault,
  getAccountWithDecryptedVaultSecrets,
  hasSecretInLocalVault,
  generateTotpCode,
  formatTotpSecret,
  formatTotpSecretForDisplay: formatTotpSecret
};
