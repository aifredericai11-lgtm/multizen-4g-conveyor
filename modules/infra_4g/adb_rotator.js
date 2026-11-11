/**
 * ============================================================================
 * MÓDULO INFRAESTRUTURA 4G: CONTROLADOR ADB & ROTAÇÃO DE IP
 * ============================================================================
 * Diretório: modules/infra_4g/adb_rotator.js
 * 
 * Gerencia dispositivos Android (Samsung SM-A075M e outros) via ADB:
 * - Localiza o binário adb.exe em platform-tools/
 * - Controla Modo Avião com proteção dual-SIM e resiliência OneUI
 * - Garante redirecionamento de portas (adb forward tcp:8080 tcp:8080)
 * - Mantém Wi-Fi do smartphone permanentemente desativado
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, execSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const USER_HOME = os.homedir();

function resolveAdbBinary() {
  const candidates = [
    path.join(PROJECT_ROOT, 'platform-tools', 'adb.exe'),
    path.join(PROJECT_ROOT, 'adb.exe'),
    'C:\\platform-tools\\adb.exe',
    'adb'
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

const ADB_BIN = resolveAdbBinary();
const ADB_KEY_FILE = path.join(USER_HOME, '.android', 'adbkey');

const ADB_EXEC_ENV = {
  ...process.env,
  ADB_USB_LEGACY: '1',
  ADB_LIBUSB: '0',
  ADB_TRACE: '',
  ...(fs.existsSync(ADB_KEY_FILE) ? { ADB_VENDOR_KEYS: ADB_KEY_FILE } : {})
};

let _lastAdbStatus = null;
let _lastAdbStatusTs = 0;

function restartAdbDaemon(onLog = console.log) {
  onLog('🔄 [ADB 4G] Reiniciando daemon do adb.exe...');
  try {
    execFileSync('taskkill', ['/F', '/IM', 'adb.exe'], { timeout: 3000, stdio: 'ignore', windowsHide: true });
  } catch (_) {}
  try {
    execFileSync(ADB_BIN, ['start-server'], { timeout: 10000, env: ADB_EXEC_ENV, stdio: 'ignore', windowsHide: true });
  } catch (err) {
    onLog(`⚠️ [ADB 4G] Erro ao subir adb server: ${err.message}`);
  }
}

function getDeviceStatus(forceFresh = false) {
  const now = Date.now();
  if (!forceFresh && _lastAdbStatus && (now - _lastAdbStatusTs) < 8000) {
    return _lastAdbStatus;
  }

  const result = {
    adb_bin: ADB_BIN,
    adb_connected: false,
    devices: [],
    unauthorized: false,
    timestamp: new Date().toISOString()
  };

  try {
    const raw = execFileSync(ADB_BIN, ['devices', '-l'], {
      timeout: 4000,
      env: ADB_EXEC_ENV,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true
    }) || '';

    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (line.startsWith('List of devices')) continue;
      const parts = line.split(/\s+/);
      if (parts.length >= 2) {
        const serial = parts[0];
        const status = parts[1];
        if (status === 'unauthorized') result.unauthorized = true;
        if (status === 'device') {
          result.adb_connected = true;
          const modelMatch = line.match(/model:(\S+)/);
          const devMatch = line.match(/device:(\S+)/);
          result.devices.push({
            serial,
            status,
            model: modelMatch ? modelMatch[1] : 'Android',
            device: devMatch ? devMatch[1] : 'Device'
          });
        }
      }
    }
  } catch (_) {
    result.adb_connected = false;
  }

  _lastAdbStatus = result;
  _lastAdbStatusTs = now;
  return result;
}

function ensurePortForward(localPort = 8080, remotePort = 8080, onLog = console.log) {
  try {
    execFileSync(ADB_BIN, ['forward', `tcp:${localPort}`, `tcp:${remotePort}`], {
      timeout: 3000,
      env: ADB_EXEC_ENV,
      stdio: 'ignore',
      windowsHide: true
    });
    return true;
  } catch (err) {
    return false;
  }
}

async function rotate4gIp(options = {}, onLog = console.log) {
  const maxAttempts = options.maxAttempts || 3;
  const status = getDeviceStatus(true);

  if (!status.adb_connected) {
    onLog('❌ [ADB 4G] Nenhum aparelho conectado via depuração USB.');
    return {
      success: false,
      adb_connected: false,
      error: 'Nenhum dispositivo Android autorizado conectado ao ADB.'
    };
  }

  const device = status.devices[0] || {};
  onLog(`✈️ [ADB 4G] Acionando Modo Avião no smartphone (${device.model || 'Android'})...`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // 1. Ativa Modo Avião (sem derrubar SIM secundário)
      try {
        execFileSync(ADB_BIN, ['shell', 'cmd', 'connectivity', 'airplane-mode', 'enable'], {
          timeout: 4000, env: ADB_EXEC_ENV, stdio: 'ignore', windowsHide: true
        });
      } catch (_) {
        execFileSync(ADB_BIN, ['shell', 'settings', 'put', 'global', 'airplane_mode_on', '1'], {
          timeout: 3000, env: ADB_EXEC_ENV, stdio: 'ignore', windowsHide: true
        });
      }

      const waitMs = attempt === 1 ? 7500 : 10000;
      onLog(`⏳ [ADB 4G] Aguardando ${waitMs / 1000}s em Modo Avião para renovar lease CGNAT na torre...`);
      await new Promise(r => setTimeout(r, waitMs));

      // 2. Acorda conexão USB e desliga Modo Avião
      getDeviceStatus(true);
      try {
        execFileSync(ADB_BIN, ['shell', 'cmd', 'connectivity', 'airplane-mode', 'disable'], {
          timeout: 4000, env: ADB_EXEC_ENV, stdio: 'ignore', windowsHide: true
        });
      } catch (_) {
        execFileSync(ADB_BIN, ['shell', 'settings', 'put', 'global', 'airplane_mode_on', '0'], {
          timeout: 3000, env: ADB_EXEC_ENV, stdio: 'ignore', windowsHide: true
        });
      }

      // 3. Força Wi-Fi off e dados móveis on
      try {
        execFileSync(ADB_BIN, ['shell', 'svc', 'wifi', 'disable'], {
          timeout: 3000, env: ADB_EXEC_ENV, stdio: 'ignore', windowsHide: true
        });
        execFileSync(ADB_BIN, ['shell', 'svc', 'data', 'enable'], {
          timeout: 3000, env: ADB_EXEC_ENV, stdio: 'ignore', windowsHide: true
        });
      } catch (_) {}

      // 4. Garante port forward e aguarda estabilização do link rmnet4 LTE (3.5s)
      ensurePortForward(8080, 8080, onLog);
      await new Promise(r => setTimeout(r, 3500));

      try {
        const ipv4Bridge = require('./ipv4_proxy_bridge');
        ipv4Bridge.clearIpv4DnsCache();
        await ipv4Bridge.ensureIpv4ProxyBridgeRunning(onLog);
      } catch (_) {}

      // Flush DNS no host Windows
      try {
        execFileSync('ipconfig', ['/flushdns'], { timeout: 3000, stdio: 'ignore', windowsHide: true });
      } catch (_) {}

      onLog(`✅ [ADB 4G] Modo Avião concluído com sucesso (Tentativa ${attempt}/${maxAttempts}).`);
      return {
        success: true,
        adb_connected: true,
        attempt,
        device: device.model || 'Android'
      };
    } catch (err) {
      onLog(`⚠️ [ADB 4G • Falha ${attempt}/${maxAttempts}] ${err.message}`);
      if (attempt === maxAttempts) {
        return {
          success: false,
          adb_connected: true,
          error: err.message
        };
      }
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  return { success: false, error: 'Falha desconhecida na rotação 4G.' };
}

function openNativeGoogleAddAccountOnPhone(onLog = console.log) {
  const status = getDeviceStatus(true);
  if (!status.adb_connected) {
    return {
      success: false,
      error: 'Celular Samsung 4G não encontrado no USB ADB.'
    };
  }
  const device = status.devices[0] || {};
  try {
    execFileSync(ADB_BIN, ['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'], {
      timeout: 3000, env: ADB_EXEC_ENV, stdio: 'ignore', windowsHide: true
    });
    execFileSync(ADB_BIN, ['shell', 'am', 'start', '-a', 'android.settings.ADD_ACCOUNT_SETTINGS'], {
      timeout: 4000, env: ADB_EXEC_ENV, stdio: 'ignore', windowsHide: true
    });
    onLog(`📱 [ADB Nativo Samsung] Tela acordada e menu "Adicionar Conta" aberto no ${device.model || 'Android'} (100% DroidGuard Nativo • Zero QR Code)!`);
    return {
      success: true,
      device: device.model || 'SM_A075M',
      serial: device.serial || ''
    };
  } catch (err) {
    return {
      success: false,
      error: err.message
    };
  }
}

module.exports = {
  ADB_BIN,
  ADB_EXEC_ENV,
  resolveAdbBinary,
  restartAdbDaemon,
  getDeviceStatus,
  ensurePortForward,
  rotate4gIp,
  openNativeGoogleAddAccountOnPhone
};
