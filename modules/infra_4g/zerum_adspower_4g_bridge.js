/**
 * ============================================================================
 * 🌉 ZERUM LOCAL <-> 4G ADB + MULTIZEN C++ BRIDGE (ADSPOWER API EMULATOR :50325)
 * ============================================================================
 * Diretório: modules/infra_4g/zerum_adspower_4g_bridge.js
 *
 * OBJETIVO:
 * Faz a ponte 100% transparente entre o aplicativo ZERUM LOCAL (0.1.3) em
 * `~/.adspower-4g-bridge` (que fala nativamente com AdsPower em `127.0.0.1:50325`)
 * e a nossa infraestrutura:
 *   1. Emulador HTTP AdsPower V1 + V2 em `http://127.0.0.1:50325`
 *   2. Regra de Ouro 4G no `/api/v1/browser/start` e `/api/v2/browser-profile/start`:
 *      - Mesmo perfil já aberto -> Reaproveita sessão e IP 4G atual imediatamente.
 *      - Outro Perfil Mãe (ou troca de conta 4G) -> Fecha o perfil anterior no MultiZen,
 *        aciona Rotação de IP 4G via ADB (Modo Avião 10s no Samsung + validação `127.0.0.1:8080`),
 *        abre o novo perfil no MultiZen CloakBrowser 146 C++ e devolve o `ws.puppeteer`!
 *   3. Sincronizador determinístico de `~/.adspower-4g-bridge` (`--sync-zerum`),
 *      populando `navegador.json`, `adspower.json`, `publicar/adspower.json`,
 *      `registro.json`, `paginas.json`, `publicar/config.json` e `meta-api.json`
 *      (JAMAIS tocando em `licenca.json`, `aluno.json` ou `aparelho.id`).
 * ============================================================================
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const db = require('../../db');
const MultiZenService = require('../../multizen');
const { rotate4gIp, getDeviceStatus } = require('./adb_rotator');
const { get4gProxyHealth, MATRIX_PROFILE_ID } = require('./proxy_health');

const BRIDGE_HOST = '127.0.0.1';
const BRIDGE_PORT = Number(process.env.ZERUM_ADSPOWER_PORT) || 50325;
const BRIDGE_API_KEY = 'multizen4gbridge';
const ZERUM_LOCAL_HOME = process.env.ZL_HOME || path.join(os.homedir(), '.zerum-local');
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const VAULT_FILE_PATH = path.join(PROJECT_ROOT, 'meta_graph_apps_vault.json');

// Arquivos INTOCÁVEIS de autenticação/licença do Zerum Local
const PROTECTED_ZERUM_FILES = new Set(['licenca.json', 'aluno.json', 'aparelho.id']);

// Estado em memória do último perfil ativo para controle estrito de rotação 4G entre Perfis Mãe
let _lastActiveProfileId = null;
let _startMutexPromise = Promise.resolve();

function writeJsonSafe(targetPath, dataObj) {
  const baseName = path.basename(targetPath);
  if (PROTECTED_ZERUM_FILES.has(baseName)) {
    throw new Error(`[BLOQUEIO DE SEGURANÇA] Proibido modificar arquivo protegido do Zerum: ${baseName}`);
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tmpPath = `${targetPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(dataObj, null, 2) + '\n', 'utf8');
  fs.renameSync(tmpPath, targetPath);
}

function readJsonSafe(targetPath, fallback = null) {
  try {
    if (!fs.existsSync(targetPath)) return fallback;
    return JSON.parse(fs.readFileSync(targetPath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

/**
 * Filtra as páginas reais de operação (excluindo placeholders de aquecimento de perfil e páginas sem fb_page_id ou em quarentena se solicitado)
 */
function getOperationalPagesAndProfiles() {
  const allPages = db.getPages() || [];
  const mzProfiles = MultiZenService.listProfiles() || [];
  const mzMap = new Map(mzProfiles.map(p => [String(p.id).trim(), p]));

  const badNameRegex = /^(relatar um problema|tela e acessibilidade|criar p[aá]gina)$/i;
  const validPages = allPages.filter(p => {
    if (!p || !p.name) return false;
    if (p.page_mode === 'PROFILE_WARMUP') return false;
    if (String(p.id || '').startsWith('page_warm_')) return false;
    if (badNameRegex.test(String(p.name).trim())) return false;
    if (p.ripa_laio === true || p.archived === true || p.deleted === true) return false;
    return true;
  });

  // Prioriza as 51 páginas ativas com fb_page_id válido (incluindo a campeã primary-page em P01)
  const withFbIdAndActive = validPages.filter(
    p => String(p.fb_page_id || '').trim().length >= 6 && p.paused !== true
  );
  withFbIdAndActive.sort((a, b) => {
    const aPat = /primary-page/i.test(String(a.name || '')) ? 1 : 0;
    const bPat = /primary-page/i.test(String(b.name || '')) ? 1 : 0;
    if (aPat !== bPat) return bPat - aPat;
    return 0;
  });
  const active51Pages = withFbIdAndActive.slice(0, 51);

  // Constrói lista ordenada dos Perfis Mãe operacionais
  const profileOrderMap = new Map();
  for (const p of validPages) {
    const pid = String(p.profile_browser_ID || '').trim();
    if (!pid) continue;
    if (!profileOrderMap.has(pid)) {
      const mzProf = mzMap.get(pid);
      profileOrderMap.set(pid, {
        multizen_id: pid,
        name: (mzProf && mzProf.name) || p.profile_name || p.conta || `Perfil ${pid.slice(0, 8)}`,
        pages: []
      });
    }
    profileOrderMap.get(pid).pages.push(p);
  }

  // Adiciona quaisquer outros perfis do MultiZen que ainda não estejam no mapa
  for (const mzp of mzProfiles) {
    const pid = String(mzp.id || '').trim();
    if (pid && !profileOrderMap.has(pid)) {
      profileOrderMap.set(pid, {
        multizen_id: pid,
        name: mzp.name || `Perfil ${pid.slice(0, 8)}`,
        pages: []
      });
    }
  }

  const profilesList = Array.from(profileOrderMap.values()).map((prof, idx) => {
    const numMatch =
      String(prof.name).match(/PERFIL\s*0*(\d+)/i) ||
      String(prof.name).match(/Conta\s*#?0*(\d+)/i) ||
      String(prof.name).match(/#0*(\d+)/i);
    const serialNum = numMatch ? String(Number(numMatch[1])) : String(idx + 1);
    const zerumPerfilCode = `perfil-${String(idx + 1).padStart(2, '0')}`;
    const isMatrix = prof.multizen_id === MATRIX_PROFILE_ID || /MATRIZ/i.test(prof.name);
    return {
      ...prof,
      index: idx + 1,
      serial_number: serialNum,
      zerum_perfil_id: zerumPerfilCode,
      is_matrix_fixed_ip: isMatrix
    };
  });

  return {
    active51Pages,
    allValidPages: validPages,
    profilesList
  };
}

/**
 * Resolve qualquer identificador enviado pelo Zerum (`user_id`, `profile_id`, `perfil-01`, `serial_number`)
 * para o UUID real do MultiZen C++.
 */
function resolveMultiZenProfileId(rawId) {
  const needle = String(rawId || '').trim();
  if (!needle) return null;
  const { profilesList } = getOperationalPagesAndProfiles();

  const exactByUuid = profilesList.find(p => p.multizen_id.toLowerCase() === needle.toLowerCase());
  if (exactByUuid) return exactByUuid;

  const byZerumCode = profilesList.find(p => p.zerum_perfil_id.toLowerCase() === needle.toLowerCase());
  if (byZerumCode) return byZerumCode;

  const bySerial = profilesList.find(p => p.serial_number === needle);
  if (bySerial) return bySerial;

  // Fallback direto no banco SQLite do MultiZen
  const mzProf = MultiZenService.getProfile(needle);
  if (mzProf) {
    return {
      multizen_id: mzProf.id,
      name: mzProf.name,
      serial_number: '99',
      zerum_perfil_id: 'perfil-99',
      is_matrix_fixed_ip: mzProf.id === MATRIX_PROFILE_ID || /MATRIZ/i.test(mzProf.name)
    };
  }
  return null;
}

/**
 * Consulta todos os perfis atualmente abertos no MultiZen C++ (portas 19300..19350)
 * e retorna seus endpoints CDP (`ws.puppeteer` + `debug_port`).
 */
async function listActiveMultiZenSessions() {
  const { profilesList } = getOperationalPagesAndProfiles();
  const mzAll = MultiZenService.listProfiles() || [];
  const candidateIds = new Set();
  for (const p of mzAll) {
    if (p && p.locked_active && p.id) candidateIds.add(String(p.id).trim());
  }
  for (const p of profilesList.slice(0, 14)) {
    if (p && p.multizen_id) {
      const baseDirs = typeof MultiZenService.resolveProfileBaseDirs === 'function'
        ? MultiZenService.resolveProfileBaseDirs(p.multizen_id)
        : [];
      const hasAnyLockOrPort =
        MultiZenService.isProfileLockedByKernel(p.multizen_id) ||
        baseDirs.some(d =>
          fs.existsSync(path.join(d, 'DevToolsActivePort')) ||
          fs.existsSync(path.join(d, 'multizen_session.json')) ||
          fs.existsSync(path.join(d, 'lockfile'))
        );
      if (hasAnyLockOrPort) {
        candidateIds.add(String(p.multizen_id).trim());
      }
    }
  }
  // Sempre inclui a Matriz se estiver aberta na porta 19307
  candidateIds.add(MATRIX_PROFILE_ID);
  if (_lastActiveProfileId) candidateIds.add(_lastActiveProfileId);

  const activeSessions = [];
  for (const lockedId of candidateIds) {
    const probed = await MultiZenService.probeProfileLocalDevToolsPort(lockedId).catch(() => null);
    if (probed && probed.port) {
      let wsUrl = probed.ws_url;
      if (!wsUrl) {
        try {
          const vRes = await fetch(`http://127.0.0.1:${probed.port}/json/version`, {
            signal: AbortSignal.timeout(1500)
          });
          if (vRes.ok) {
            const vData = await vRes.json();
            wsUrl = vData.webSocketDebuggerUrl || null;
          }
        } catch (_) {}
      }
      if (wsUrl) {
        const profMeta = profilesList.find(p => p.multizen_id.toLowerCase() === lockedId.toLowerCase());
        activeSessions.push({
          user_id: profMeta ? profMeta.multizen_id : lockedId,
          profile_id: profMeta ? profMeta.multizen_id : lockedId,
          serial_number: profMeta ? profMeta.serial_number : '1',
          name: profMeta ? profMeta.name : lockedId,
          ws: {
            puppeteer: wsUrl,
            selenium: `127.0.0.1:${probed.port}`
          },
          debug_port: String(probed.port),
          webdriver: ''
        });
      }
    }
  }
  return activeSessions;
}

/**
 * Formata um perfil do MultiZen no padrão exato da API `/api/v1/user/list` e `/api/v2/browser-profile/list` do AdsPower.
 */
function formatProfileForAdsPower(prof) {
  const nowSec = Math.floor(Date.now() / 1000);
  return {
    user_id: prof.multizen_id,
    profile_id: prof.multizen_id,
    serial_number: prof.serial_number,
    profile_no: prof.serial_number,
    name: prof.name,
    group_id: '1',
    group_name: '4G_MULTIZEN',
    domain_name: 'https://www.facebook.com',
    username: '',
    remark: `MultiZen C++ 146 • ${prof.zerum_perfil_id} (${(prof.pages || []).length} páginas)`,
    created_time: String(nowSec - 86400 * 30),
    last_open_time: String(nowSec),
    ip: '127.0.0.1',
    ip_country: 'br',
    fbcc_user_tag: [
      { name: prof.zerum_perfil_id.toUpperCase(), color: '#10b981' },
      { name: prof.is_matrix_fixed_ip ? 'IP_FIXO_MATRIZ' : '4G_ADB_8080', color: '#3b82f6' }
    ],
    user_proxy_config: prof.is_matrix_fixed_ip
      ? {
          proxy_soft: 'no_proxy',
          proxy_type: 'noproxy',
          proxy_host: '',
          proxy_port: ''
        }
      : {
          proxy_soft: 'other',
          proxy_type: 'http',
          proxy_host: '127.0.0.1',
          proxy_port: '8080'
        }
  };
}

/**
 * Regra de Ouro 4G ao iniciar um navegador via Zerum Local (`/api/v1/browser/start` ou `/api/v2/browser-profile/start`):
 * 1. Se o perfil solicitado já está aberto no MultiZen -> Reaproveita sessão e IP 4G atual imediatamente!
 * 2. Se outro Perfil Mãe estava aberto (ou se é uma troca de perfil 4G):
 *    - Fecha os outros perfis 4G abertos no MultiZen (`MultiZenService.stopProfile`)
 *    - Se o novo perfil usa 4G (`!is_matrix_fixed_ip`), executa Rotação 4G via ADB (Modo Avião 10s + validação `127.0.0.1:8080`)
 *    - Abre o perfil no MultiZen C++ (`MultiZenService.ensureProfileLaunched`) e devolve `ws.puppeteer`!
 */
async function startProfileWith4gGuarantee(rawProfileId, onLog = console.log) {
  const resolved = resolveMultiZenProfileId(rawProfileId);
  if (!resolved) {
    throw new Error(`Perfil "${rawProfileId}" não encontrado no MultiZen / database.json.`);
  }
  const targetId = resolved.multizen_id;

  // Serializa aberturas concorrentes para evitar colisão de rotação 4G
  const runTask = async () => {
    const activeList = await listActiveMultiZenSessions();
    const alreadyOpen = activeList.find(s => s.user_id.toLowerCase() === targetId.toLowerCase());

    if (alreadyOpen && alreadyOpen.ws && alreadyOpen.ws.puppeteer) {
      _lastActiveProfileId = targetId;
      onLog(`♻️ [Zerum 4G Bridge] Perfil "${resolved.name}" (${targetId.slice(0, 8)}) JÁ ESTÁ ABERTO na porta ${alreadyOpen.debug_port}. Reaproveitando sessão e IP atual!`);
      return {
        ws: alreadyOpen.ws,
        debug_port: alreadyOpen.debug_port,
        webdriver: ''
      };
    }

    // Verifica se há outros perfis 4G abertos que precisam ser fechados antes de trocar de conta
    for (const openSess of activeList) {
      if (openSess.user_id.toLowerCase() !== targetId.toLowerCase()) {
        // Preserva PERFIL 04 (MATRIZ) se o operador estiver com ele aberto em IP Fixo, exceto se ambos forem 4G
        const openMeta = resolveMultiZenProfileId(openSess.user_id);
        const isOpenMatrix = openMeta && openMeta.is_matrix_fixed_ip;
        if (!isOpenMatrix) {
          onLog(`🔒 [Isolamento 4G] Fechando perfil anterior "${openSess.name}" (${openSess.user_id.slice(0, 8)}) antes de abrir "${resolved.name}"...`);
          await MultiZenService.stopProfile(openSess.user_id, onLog).catch(() => {});
        }
      }
    }

    // Se o perfil alvo é 4G (não Matriz IP Fixo) e estamos trocando de perfil (ou abrindo o 1º perfil 4G),
    // garante rotação de IP 4G via ADB + saúde do proxy 127.0.0.1:8080!
    if (!resolved.is_matrix_fixed_ip) {
      const isSwitchingProfile = _lastActiveProfileId !== targetId;
      const proxyHealthBefore = await get4gProxyHealth().catch(() => ({ ready_for_4g_Sticky_turn: false }));

      if (isSwitchingProfile || !proxyHealthBefore.ready_for_4g_Sticky_turn) {
        onLog(`📲 [Rotação 4G ADB Automática] Trocando para "${resolved.name}" (anterior: ${_lastActiveProfileId ? _lastActiveProfileId.slice(0, 8) : 'nenhum'}) — acionando Modo Avião 10s no Samsung...`);
        const rotRes = await rotate4gIp({ airplaneDurationMs: 10000 }, onLog).catch(err => ({
          success: false,
          error: err.message
        }));
        if (!rotRes.success) {
          onLog(`⚠️ [Zerum 4G Bridge] Aviso na rotação ADB (${rotRes.error || 'verificar cabo USB'}). Conferindo túnel 127.0.0.1:8080...`);
        } else {
          onLog(`✅ [Rotação 4G Concluída] Novo IP 4G limpo: ${rotRes.after_ip} (anterior: ${rotRes.before_ip || 'N/A'})`);
        }

        const proxyAfter = await get4gProxyHealth().catch(() => null);
        if (!proxyAfter || !proxyAfter.port_8080_listening) {
          throw new Error('BLOQUEIO DE SEGURANÇA 4G: Porta 127.0.0.1:8080 (Every Proxy) não está respondendo. Conecte o celular Samsung 4G antes de abrir o perfil!');
        }
      }
    }

    // Lança o perfil no MultiZen CloakBrowser 146 C++
    const launchRes = await MultiZenService.ensureProfileLaunched(targetId, onLog);
    const port = launchRes.port;
    let wsPuppeteer = null;
    for (let i = 0; i < 20; i++) {
      try {
        const vRes = await fetch(`http://127.0.0.1:${port}/json/version`, {
          signal: AbortSignal.timeout(1500)
        });
        if (vRes.ok) {
          const vData = await vRes.json();
          if (vData && vData.webSocketDebuggerUrl) {
            wsPuppeteer = vData.webSocketDebuggerUrl;
            break;
          }
        }
      } catch (_) {}
      await new Promise(r => setTimeout(r, 300));
    }

    if (!wsPuppeteer) {
      throw new Error(`CloakBrowser abriu na porta ${port}, mas não retornou webSocketDebuggerUrl.`);
    }

    _lastActiveProfileId = targetId;
    return {
      ws: {
        puppeteer: wsPuppeteer,
        selenium: `127.0.0.1:${port}`
      },
      debug_port: String(port),
      webdriver: ''
    };
  };

  const nextPromise = _startMutexPromise.then(runTask, runTask);
  _startMutexPromise = nextPromise.catch(() => {});
  return nextPromise;
}

/**
 * Lê o corpo JSON de uma requisição HTTP POST.
 */
function readRequestBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 1024 * 1024) req.destroy();
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (_) {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, api-key'
  });
  res.end(JSON.stringify(payload));
}

/**
 * Cria e inicia o servidor HTTP em `127.0.0.1:50325` que emula a API Local V1 + V2 do AdsPower.
 */
function startBridgeServer({ port = BRIDGE_PORT, host = BRIDGE_HOST, onLog = console.log } = {}) {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      return sendJson(res, 200, { code: 0, msg: 'success' });
    }

    const parsedUrl = new URL(req.url || '/', `http://${host}:${port}`);
    const pathname = parsedUrl.pathname.replace(/\/+$/, '') || '/';
    const query = Object.fromEntries(parsedUrl.searchParams.entries());
    const body = req.method === 'POST' ? await readRequestBody(req) : {};

    try {
      // 1. GET /status
      if (pathname === '/status' || pathname === '') {
        return sendJson(res, 200, {
          code: 0,
          msg: 'success',
          data: {
            bridge: 'zerum_adspower_4g_multizen_bridge',
            version: '1.0.0',
            last_active_profile_id: _lastActiveProfileId
          }
        });
      }

      // 2. GET /api/v1/user/list e GET|POST /api/v2/browser-profile/list
      if (pathname === '/api/v1/user/list' || pathname === '/api/v2/browser-profile/list') {
        const page = Math.max(1, Number(query.page || body.page || 1));
        const pageSize = Math.max(1, Number(query.page_size || body.page_size || 100));
        const { profilesList } = getOperationalPagesAndProfiles();
        const formatted = profilesList.map(formatProfileForAdsPower);
        const startIdx = (page - 1) * pageSize;
        const pagedList = formatted.slice(startIdx, startIdx + pageSize);

        return sendJson(res, 200, {
          code: 0,
          msg: 'success',
          data: {
            list: pagedList,
            page,
            page_size: pageSize,
            total: formatted.length
          }
        });
      }

      // 3. GET /api/v1/browser/local-active, /api/v1/browser/cloud-active e /api/v2/browser-profile/active
      if (
        pathname === '/api/v1/browser/local-active' ||
        pathname === '/api/v1/browser/cloud-active' ||
        pathname === '/api/v2/browser-profile/active'
      ) {
        const activeList = await listActiveMultiZenSessions();
        const filterId = query.user_id || query.profile_id || body.user_id || body.profile_id;
        if (filterId && pathname === '/api/v2/browser-profile/active') {
          const resolved = resolveMultiZenProfileId(filterId);
          const targetId = resolved ? resolved.multizen_id : filterId;
          const found = activeList.find(s => s.user_id.toLowerCase() === String(targetId).toLowerCase());
          if (found) {
            return sendJson(res, 200, {
              code: 0,
              msg: 'success',
              data: {
                status: 'Active',
                ws: found.ws,
                debug_port: found.debug_port,
                webdriver: ''
              }
            });
          }
          return sendJson(res, 200, {
            code: 0,
            msg: 'success',
            data: { status: 'Inactive' }
          });
        }

        return sendJson(res, 200, {
          code: 0,
          msg: 'success',
          data: {
            list: activeList
          }
        });
      }

      // 4. GET /api/v1/browser/active (query user_id ou profile_id)
      if (pathname === '/api/v1/browser/active') {
        const rawId = query.user_id || query.profile_id || body.user_id || body.profile_id;
        const resolved = resolveMultiZenProfileId(rawId);
        const targetId = resolved ? resolved.multizen_id : String(rawId || '').trim();
        const activeList = await listActiveMultiZenSessions();
        const found = activeList.find(s => s.user_id.toLowerCase() === targetId.toLowerCase());

        if (found) {
          return sendJson(res, 200, {
            code: 0,
            msg: 'success',
            data: {
              status: 'Active',
              ws: found.ws,
              debug_port: found.debug_port,
              webdriver: ''
            }
          });
        }
        return sendJson(res, 200, {
          code: 0,
          msg: 'success',
          data: {
            status: 'Inactive'
          }
        });
      }

      // 5. GET /api/v1/browser/start e POST /api/v2/browser-profile/start (Regra de Ouro 4G + MultiZen C++)
      if (pathname === '/api/v1/browser/start' || pathname === '/api/v2/browser-profile/start') {
        const rawId =
          query.user_id ||
          query.profile_id ||
          query.serial_number ||
          body.profile_id ||
          body.user_id ||
          body.serial_number;

        if (!rawId) {
          return sendJson(res, 200, { code: -1, msg: 'user_id / profile_id é obrigatório' });
        }

        const startData = await startProfileWith4gGuarantee(rawId, onLog);
        return sendJson(res, 200, {
          code: 0,
          msg: 'success',
          data: startData
        });
      }

      // 6. GET /api/v1/browser/stop, POST /api/v2/browser-profile/stop e /api/v2/browser-profile/stop-all
      if (
        pathname === '/api/v1/browser/stop' ||
        pathname === '/api/v2/browser-profile/stop' ||
        pathname === '/api/v2/browser-profile/stop-all'
      ) {
        if (pathname === '/api/v2/browser-profile/stop-all') {
          const activeList = await listActiveMultiZenSessions();
          for (const s of activeList) {
            const meta = resolveMultiZenProfileId(s.user_id);
            if (!meta || !meta.is_matrix_fixed_ip) {
              await MultiZenService.stopProfile(s.user_id, onLog).catch(() => {});
            }
          }
          return sendJson(res, 200, { code: 0, msg: 'success', data: {} });
        }

        const rawId = query.user_id || query.profile_id || body.profile_id || body.user_id;
        const resolved = resolveMultiZenProfileId(rawId);
        const targetId = resolved ? resolved.multizen_id : String(rawId || '').trim();
        const isForceStop = query.force === '1' || query.force === 'true' || body.force === true || body.force === '1';

        if (!isForceStop) {
          onLog(
            `♻️ [Zerum 4G Bridge] Keep-Alive Sticky para perfil ${targetId} (evitando cold-restart entre páginas do mesmo Perfil Mãe; fechamento ocorrerá automaticamente na troca de perfil ou stop-all)`
          );
          return sendJson(res, 200, {
            code: 0,
            msg: 'success',
            data: { keep_alive: true }
          });
        }

        if (targetId) {
          await MultiZenService.stopProfile(targetId, onLog).catch(() => {});
        }
        return sendJson(res, 200, {
          code: 0,
          msg: 'success',
          data: {}
        });
      }

      // 7. Endpoints auxiliares do AdsPower MCP (grupos, categorias, tags, proxies)
      if (pathname === '/api/v1/group/list' || pathname === '/api/v2/category/list') {
        return sendJson(res, 200, {
          code: 0,
          msg: 'success',
          data: {
            list: [{ group_id: '1', group_name: '4G_MULTIZEN', remark: 'Perfis MultiZen 4G ADB' }],
            page: 1,
            page_size: 100
          }
        });
      }

      return sendJson(res, 200, {
        code: 0,
        msg: 'success',
        data: { list: [] }
      });
    } catch (err) {
      onLog(`❌ [Zerum 4G Bridge] Erro em ${req.method} ${pathname}: ${err.message}`);
      return sendJson(res, 200, {
        code: -1,
        msg: err.message || 'Erro interno na Ponte 4G MultiZen'
      });
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', err => {
      reject(err);
    });
    server.listen(port, host, () => {
      onLog(`🌉 [Zerum <-> 4G MultiZen Bridge] Servidor AdsPower V1/V2 ativo em http://${host}:${port}`);
      resolve(server);
    });
  });
}

function syncZerumLocalConfig(onLog = console.log) {
  onLog('[4G AdsPower Bridge] Modo standalone ativo.');
  return { ok: true, bridge_url: `http://${BRIDGE_HOST}:${BRIDGE_PORT}` };
}

if (require.main === module) {
  startBridgeServer({ port: BRIDGE_PORT, host: BRIDGE_HOST, onLog: console.log }).catch(err => {
    console.error('[4G AdsPower Bridge] Falha fatal:', err.message);
    process.exit(1);
  });
}

module.exports = {
  BRIDGE_HOST,
  BRIDGE_PORT,
  BRIDGE_API_KEY,
  getOperationalPagesAndProfiles,
  resolveMultiZenProfileId,
  listActiveMultiZenSessions,
  startProfileWith4gGuarantee,
  syncZerumLocalConfig,
  startBridgeServer
};
