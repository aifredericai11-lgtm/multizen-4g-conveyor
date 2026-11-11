/**
 * ============================================================================
 * RUNNER DE AQUECIMENTO ISOLADO (CLI + PROGRAMÁTICO)
 * ============================================================================
 * Diretório: modules/account_warmup/runner.js
 * Execução CLI Direta:
 *   node modules/account_warmup/runner.js --email "exemplo@gmail.com" [--close]
 * Execução Programática:
 *   const { runAccountWarmup } = require('./modules/account_warmup/runner');
 *   const result = await runAccountWarmup(account, options, onLog);
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { CLOAK_TARGET_FILTER } = require('../../incogniton');
if (puppeteer && typeof puppeteer.connect === 'function' && !puppeteer._cloakTargetFilterPatched) {
  const _origConnect = puppeteer.connect.bind(puppeteer);
  puppeteer.connect = (opts = {}) => _origConnect({ targetFilter: CLOAK_TARGET_FILTER, ...opts });
  puppeteer._cloakTargetFilterPatched = true;
}
const MultiZenService = require('../../multizen');
const gmailAuthenticator = require('./gmail_authenticator');
const newsletterWarmer = require('./newsletter_warmer');
const emailDomainValidator = require('./email_domain_validator');
const lifecyclePipeline = require('./lifecycle_pipeline');
const {
  WARMING_PIPELINE_FILE,
  ACTIVE_CREATION_SLOT_FILE,
  loadPipelineData,
  savePipelineData,
  resolveAccountFromPipeline,
  getActiveCreationSlot
} = lifecyclePipeline;
const vault = require('../common/vault');
const adbRotator = require('../infra_4g/adb_rotator');
const proxyHealth = require('../infra_4g/proxy_health');

function updateAccountInPipeline(email, updates = {}) {
  try {
    const data = loadPipelineData();
    if (!Array.isArray(data.accounts)) return;
    const needle = String(email).trim().toLowerCase();
    const acc = data.accounts.find(a =>
      String(a.email || '').trim().toLowerCase() === needle ||
      String(a.id || '').trim().toLowerCase() === needle ||
      String(a.name || '').trim().toLowerCase() === needle
    );
    if (acc) {
      acc.warmup_stats = acc.warmup_stats || {};
      if (updates.newsletters) {
        acc.warmup_stats.newsletters_subscribed = updates.newsletters.subscribed || acc.warmup_stats.newsletters_subscribed || [];
      }
      if (updates.gmail_authenticated !== undefined) {
        acc.warmup_stats.gmail_authenticated = updates.gmail_authenticated;
      }
      if (updates.status) {
        acc.status = updates.status;
      }
      if (updates.last_checkpoint) {
        acc.last_checkpoint = updates.last_checkpoint;
      }
      if (!acc.warmup_stats.first_email_warmup_at) {
        acc.warmup_stats.first_email_warmup_at = new Date().toISOString();
      }
      acc.warmup_stats.last_email_warmup_at = new Date().toISOString();
      acc.warmup_stats.total_email_sessions = (acc.warmup_stats.total_email_sessions || 0) + 1;
      savePipelineData(data);
      lifecyclePipeline.syncLifecycleState();
    }
  } catch (_) { }
}

async function runAccountWarmup(accountWithSecrets, options = {}, onLog = console.log) {
  let targetAcc = Object.assign({}, accountWithSecrets || {});
  const cleanEmail = String(targetAcc.email || options.email || '').trim();

  if (!cleanEmail) {
    throw new Error('E-mail é obrigatório para execução do aquecimento.');
  }

  // 0. Validação de Domínio, Coerência Geográfica (IP 4G BR) e Entropia de Handle
  const domainCheck = emailDomainValidator.validateEmailFor4gBrWarmup(cleanEmail);
  onLog(`🛡️ [Filtro Domínio & Geo 4G BR] "${cleanEmail}" -> Tier: ${domainCheck.tier} | Handle Score: ${domainCheck.handle_analysis?.score ?? 0}/100 | Molho Mínimo: ${domainCheck.required_soak_hours || '--'}h (${domainCheck.required_newsletters || '--'} newsletters)`);
  if (!domainCheck.domain_allowed) {
    throw new Error(`🚨 [BLOQUEIO DE DOMÍNIO / GEO-MISMATCH] E-mail "${cleanEmail}" reprovado (${domainCheck.tier}): ${domainCheck.reason}`);
  }
  if (!domainCheck.handle_analysis?.is_human_pattern && !options.allowHighEntropyHandle) {
    throw new Error(`🚨 [BLOQUEIO DE HANDLE / BOT FARM PATTERN] E-mail "${cleanEmail}" reprovado por entropia de handle (${domainCheck.handle_analysis?.score}/100): ${domainCheck.handle_analysis?.issues?.join('; ')}`);
  }

  // 1. Completa dados com o pipeline se disponível
  const pipelineAcc = resolveAccountFromPipeline(cleanEmail) || {};
  targetAcc = { ...pipelineAcc, ...targetAcc, email: cleanEmail };

  // 2. Descriptografa senhas/TOTP do cofre local se necessário
  targetAcc = vault.getAccountWithDecryptedVaultSecrets(targetAcc);

  const email = targetAcc.email;
  const password = String(targetAcc.password || targetAcc.gmail_password || options.password || '').trim();
  const recoveryEmail = String(targetAcc.recovery_email || options.recoveryEmail || '').trim();
  const totpSecret = String(targetAcc.google_totp_secret || targetAcc.totp_secret || options.totpSecret || '').trim();
  const phoneNumber = String(targetAcc.phone || targetAcc.phone_number || options.phoneNumber || options.phone || '').trim();
  const smsCode = String(options.smsCode || options.sms || '').trim();
  const profileId = String(targetAcc.incogniton_profile_id || options.profileId || '').trim();
  const closeOnFinish = options.close_browser_on_finish !== false;

  onLog(`🚀 [Warmup Isolado] Iniciando aquecimento para "${email}" (Perfil: ${profileId || 'Auto'})...`);

  // 2.5. ROTAÇÃO 4G ADB OBRIGATÓRIA + VERIFICAÇÃO DE SAÚDE DO PROXY 127.0.0.1:8080 (CLAUDE.md Regra 3)
  if (!options.skipRotate) {
    onLog(`✈️ [Rotação 4G ADB Obrigatória] Girando Modo Avião no Samsung antes de abrir "${email}"...`);
    await adbRotator.rotate4gIp({}, onLog);
  } else {
    adbRotator.ensurePortForward(8080, 8080, onLog);
  }
  let health4g = null;
  for (let hTry = 0; hTry < 6; hTry++) {
    health4g = await proxyHealth.get4gProxyHealth('127.0.0.1', 8080);
    if (health4g && health4g.proxy_public_ip && (health4g.is_safe_4g || health4g.is_safe_4g_ip)) break;
    await new Promise(r => setTimeout(r, 1500));
  }
  if (!health4g || !health4g.proxy_public_ip) {
    throw new Error('🛑 Túnel 4G (127.0.0.1:8080) sem resposta de IP público após giro ADB. Abortando abertura de navegador!');
  }
  onLog(`🌐 [IP 4G Confirmado] "${email}" sairá pelo IP móvel exclusivo: ${health4g.proxy_public_ip} (${health4g.proxy_isp || '4G'})`);

  // 3. Garante perfil MultiZen lançado
  let launchInfo = null;
  if (profileId && MultiZenService.hasProfile(profileId)) {
    launchInfo = await MultiZenService.ensureProfileLaunched(profileId, onLog);
  } else {
    // Busca por e-mail ou cria perfil no MultiZen C++
    const list = MultiZenService.listProfiles() || [];
    const matched = list.find(p => String(p.name || '').toLowerCase() === email.toLowerCase());
    const targetProf = matched || MultiZenService.createProfile({
      name: email,
      notes: `Aquecimento isolado de e-mail (${email}) no MultiZen CloakBrowser 146`
    });
    launchInfo = await MultiZenService.ensureProfileLaunched(targetProf.id, onLog);
  }

  if (!launchInfo || !launchInfo.cdp_url) {
    throw new Error(`Falha ao obter porta CDP do perfil MultiZen para "${email}".`);
  }

  const browser = await puppeteer.connect({
    browserURL: launchInfo.cdp_url,
    defaultViewport: null,
    targetFilter: CLOAK_TARGET_FILTER
  });

  try {
    const pages = await browser.pages();
    let mailTab = pages.find(p => {
      const u = String(p.url() || '').toLowerCase();
      return u.includes('google.com') || u.includes('gmail.com');
    }) || pages[0] || (await browser.newPage());

    await mailTab.bringToFront().catch(() => { });

    // 4. Verificação Segura Zero-BotGuard no Gmail (NUNCA digita/clica em accounts.google.com com CDP ligado!)
    onLog(`🛡️ [Regra Zero-CDP Google] Verificando se "${email}" já possui sessão autenticada no #inbox (sem tocar em accounts.google.com via CDP)...`);
    let isInsideInbox = await gmailAuthenticator.checkIsInsideGmail(mailTab);
    if (!isInsideInbox && (await gmailAuthenticator.hasGoogleAuthCookies(mailTab))) {
      await mailTab.goto('https://mail.google.com/mail/u/0/#inbox', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { });
      await new Promise(r => setTimeout(r, 2000));
      isInsideInbox = await gmailAuthenticator.checkIsInsideGmail(mailTab);
    }

    // Se redirecionou para accounts.google.com (ex: confirmidentifier), fecha/sai imediatamente da URL do Google para não acionar BotGuard!
    const currentMailUrl = String(mailTab.url() || '').toLowerCase();
    if (!isInsideInbox && currentMailUrl.includes('accounts.google.com')) {
      onLog(`🛑 [Proteção Anti-BotGuard] Sessão de "${email}" caiu em accounts.google.com — saindo da página de login para nunca acionar QR Code de bot via CDP!`);
      await mailTab.goto('about:blank').catch(() => { });
    }

    // 5. Leitura Orgânica Inicial da Caixa de Entrada (apenas se já estiver dentro do #inbox)
    if (isInsideInbox) {
      await gmailAuthenticator.warmupInbox(mailTab, email, onLog);
    }

    // 6. Inscrição nas 15 Newsletters Editoriais direto nos portais (NÃO depende de login no Gmail!)
    const newsTab = await browser.newPage();
    let newsRes = { subscribed: [], newly_subscribed: [] };
    try {
      newsRes = await newsletterWarmer.subscribeToPortals(newsTab, email, {
        already_subscribed: targetAcc?.warmup_stats?.newsletters_subscribed || [],
        max_sites_per_session: options.max_newsletters || 15,
        onLog
      });
    } finally {
      await newsTab.close().catch(() => { });
    }

    // 7. Leitura Orgânica Pós-Newsletters para fixar cookies (se #inbox ativo)
    if (isInsideInbox) {
      await gmailAuthenticator.warmupInbox(mailTab, email, onLog, { forceReload: true });
    }

    onLog(`✅ [Warmup Isolado Concluído] "${email}" inscrito em ${newsRes.subscribed.length} newsletters (Sessão #inbox ativa: ${isInsideInbox ? 'SIM' : 'PENDENTE LOGIN ZERO-CDP'})!`);

    updateAccountInPipeline(email, {
      newsletters: newsRes,
      gmail_authenticated: isInsideInbox,
      status: isInsideInbox ? 'STAGE_1_EMAIL_SOAK' : 'GMAIL_LOGIN_ZERO_CDP_PENDENTE'
    });

    return {
      success: true,
      gmail_authenticated: isInsideInbox,
      email,
      newsletters: newsRes
    };
  } finally {
    try { browser.disconnect(); } catch (_) { }
    if (closeOnFinish && launchInfo?.pid) {
      try { process.kill(launchInfo.pid); } catch (_) { }
    }
  }
}

const { analyzeBatchForTomorrow, printBatchPlan } = require('./batch_planner');
const fingerprintGenerator = require('./fingerprint_generator');

let activeNewsletterWarmupState = {
  active: false,
  profile_id: null,
  email: null,
  started_at: null,
  promise: null
};

function getActiveNewsletterWarmupState() {
  return {
    active: Boolean(activeNewsletterWarmupState.active),
    profile_id: activeNewsletterWarmupState.profile_id || null,
    email: activeNewsletterWarmupState.email || null,
    started_at: activeNewsletterWarmupState.started_at || null
  };
}

async function waitForActiveNewsletterWarmup(timeoutMs = 15000, onLog = console.log) {
  if (!activeNewsletterWarmupState.active || !activeNewsletterWarmupState.promise) return true;
  onLog(`⏳ [Sincronia Passo 2 ➔ Passo 3] Aguardando finalização do disparo de newsletters em background para "${activeNewsletterWarmupState.email || activeNewsletterWarmupState.profile_id}"...`);
  try {
    await Promise.race([
      activeNewsletterWarmupState.promise,
      new Promise(resolve => setTimeout(resolve, timeoutMs))
    ]);
  } catch (_) { }
  return !activeNewsletterWarmupState.active;
}

/**
 * Gera um Kit Persona + Credenciais Gmail sugeridas (100% compatível com o Validador de Entropia Humana)
 * para o operador copiar em 1 clique ao criar o Gmail via Web no MultiZen Zero-CDP + usar no Facebook (Passo 3).
 */
function generateSuggestedGmailWebPersona(seedHint = '') {
  const firstNames = [
    'Clara', 'Evelyn', 'Margaret', 'Helen', 'Patricia', 'Judith', 'Sandra', 'Nancy',
    'Carol', 'Diane', 'Ruth', 'Sharon', 'Donna', 'Laura', 'Sarah', 'Deborah',
    'Shirley', 'Cynthia', 'Angela', 'Brenda', 'Rebecca', 'Virginia', 'Kathleen', 'Pamela'
  ];
  const lastNames = [
    'Evans', 'Miller', 'Davis', 'Wilson', 'Moore', 'Taylor', 'Anderson', 'Thomas',
    'Jackson', 'White', 'Harris', 'Martin', 'Thompson', 'Robinson', 'Clark', 'Lewis',
    'Walker', 'Hall', 'Allen', 'Young', 'Wright', 'Scott', 'Green', 'Baker'
  ];
  const suffixes = ['vital', 'pure', 'daily', 'care', 'well', 'life', 'home', 'real'];
  const monthsPt = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

  const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const fName = firstNames[randInt(0, firstNames.length - 1)];
  const lName = lastNames[randInt(0, lastNames.length - 1)];
  const word = suffixes[randInt(0, suffixes.length - 1)];
  const twoDigits = randInt(12, 98);

  const username = `${fName.toLowerCase()}.${lName.toLowerCase()}.${word}${twoDigits}`;
  const email = `${username}@gmail.com`;
  const password = `${fName.slice(0, 3)}${lName.slice(0, 3)}@${randInt(2026, 2029)}#${twoDigits}`;
  const birthDay = String(randInt(2, 27)).padStart(2, '0');
  const birthMonthIdx = randInt(0, 11);
  const birthYear = String(randInt(1963, 1978));

  return {
    first_name: fName,
    last_name: lName,
    full_name: `${fName} ${lName}`,
    suggested_username: username,
    suggested_email: email,
    suggested_password: password,
    raw_step2_prefill: `${email};${password}`,
    birth_day: birthDay,
    birth_month_num: String(birthMonthIdx + 1).padStart(2, '0'),
    birth_month_label: monthsPt[birthMonthIdx],
    birth_year: birthYear,
    birth_formatted: `${birthDay}/${String(birthMonthIdx + 1).padStart(2, '0')}/${birthYear}`,
    seed_hint: String(seedHint || '')
  };
}

function getActiveCreationSlotWithPersona() {
  const s = getActiveCreationSlot() || {};
  if (!s.suggested_persona) {
    s.suggested_persona = generateSuggestedGmailWebPersona(s.slot_name || '');
    try {
      fs.writeFileSync(ACTIVE_CREATION_SLOT_FILE, JSON.stringify(s, null, 2), 'utf8');
    } catch (_) { }
  }
  return s;
}

/**
 * FÁBRICA DE E-MAIL / GMAIL 4G VIA WEB NO MULTIZEN (MODO STEALTH ZERO-CDP • ZERO BOTGUARD):
 * 1. Gira o Modo Avião 4G via ADB no Samsung e confirma o novo IP 4G CGNAT (127.0.0.1:8080).
 * 2. Seleciona um slot virgem em warming_accounts_pipeline.json (ou o profile_id solicitado, ou cria um novo perfil virgem no MultiZen C++)
 *    e gera/renova uma Fingerprint C++ 100% nova e isolada naquele exato slot.
 * 3. Lança o CloakBrowser 146 C++ via Web (accounts.google.com/signup ou youtube.com) SEM --remote-debugging-port e SEM Puppeteer!
 */
async function openYoutubeCreationSlot(options = {}, onLog = console.log) {
  const webEntryMode = String(options.web_entry_mode || '').trim().toUpperCase();
  const defaultUrl = webEntryMode === 'GMAIL_DIRECT'
    ? 'https://accounts.google.com/signup'
    : 'https://www.youtube.com';
  let rawStartUrl = String(options.startUrl || defaultUrl).trim();
  let hashProfileId = '';
  let hashProfileName = '';
  let hashForceNew = false;
  if (rawStartUrl.includes('#mz_')) {
    const [cleanPart, hashPart] = rawStartUrl.split('#');
    rawStartUrl = cleanPart || defaultUrl;
    const params = new URLSearchParams(hashPart);
    hashProfileId = params.get('mz_profile_id') || '';
    hashProfileName = params.get('mz_profile_name') || '';
    hashForceNew = params.get('mz_force_new') === '1';
  }
  const startUrl = rawStartUrl;
  const skipRotate = options.skipRotate === true;
  const requestedProfileId = String(options.profile_id || hashProfileId || '').trim();
  const forceNewProfile = Boolean(options.force_new_profile === true || hashForceNew);
  if (hashProfileName && !options.profile_name) {
    options.profile_name = hashProfileName;
  }

  // 0. Fecha eventual slot anterior aberto para manter isolamento estrito de 1 navegador por vez
  const prevSlot = getActiveCreationSlot();
  if (prevSlot && prevSlot.active && prevSlot.profile_id) {
    onLog(`🛑 [MultiZen Web Gmail 4G] Encerrando janela anterior do slot "${prevSlot.slot_name || prevSlot.profile_id}" antes de girar o 4G...`);
    await MultiZenService.closeStealthZeroCdpProfileGracefully(prevSlot.profile_id, prevSlot.pid, onLog).catch(() => { });
  }

  // 1. Giro 4G ADB + Confirmação de IP CGNAT Novo em 127.0.0.1:8080
  let prevIp4g = prevSlot?.ip_4g || '';
  if (!prevIp4g && !skipRotate) {
    try {
      const preH = await proxyHealth.get4gProxyHealth('127.0.0.1', 8080);
      if (preH && preH.proxy_public_ip) prevIp4g = preH.proxy_public_ip;
    } catch (_) { }
  }

  if (!skipRotate) {
    onLog(`✈️ [Passo 1/3 • Giro 4G ADB] Acionando Modo Avião no Samsung (Android USB) para renovar IP 4G CGNAT (IP anterior: ${prevIp4g || 'n/a'})...`);
    await adbRotator.rotate4gIp({}, onLog);
  } else {
    adbRotator.ensurePortForward(8080, 8080, onLog);
  }

  let health = null;
  for (let i = 0; i < 7; i++) {
    health = await proxyHealth.get4gProxyHealth('127.0.0.1', 8080);
    if (health && health.proxy_public_ip && (health.is_safe_4g || health.is_safe_4g_ip)) break;
    await new Promise(r => setTimeout(r, 2000));
  }

  // Se a operadora devolveu exatamente o mesmo IP CGNAT anterior, força 2º giro de 10s
  if (!skipRotate && prevIp4g && health && health.proxy_public_ip === prevIp4g) {
    onLog(`🔄 [Passo 1/3 • Anti-IP-Repetido] Operadora manteve o mesmo IP (${prevIp4g}). Forçando 2º giro longo de Modo Avião...`);
    await adbRotator.rotate4gIp({ maxAttempts: 2 }, onLog);
    for (let i = 0; i < 6; i++) {
      health = await proxyHealth.get4gProxyHealth('127.0.0.1', 8080);
      if (health && health.proxy_public_ip && (health.is_safe_4g || health.is_safe_4g_ip)) break;
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  if (!health || !health.proxy_public_ip) {
    throw new Error('Túnel 4G (127.0.0.1:8080) não respondeu com IP público após rotação. Verifique se o Every Proxy está ON no Samsung!');
  }

  const ip4g = health.proxy_public_ip;
  const isp4g = health.proxy_isp || '4G Móvel BR';
  onLog(`🌐 [Passo 1/3 • IP 4G Confirmado] Novo IP CGNAT: ${ip4g} (${isp4g})`);

  // 2. Seleciona ou cria Slot Virgem no MultiZen C++ + warming_accounts_pipeline.json
  const pipelineData = fs.existsSync(WARMING_PIPELINE_FILE)
    ? JSON.parse(fs.readFileSync(WARMING_PIPELINE_FILE, 'utf8'))
    : { accounts: [] };
  pipelineData.accounts = Array.isArray(pipelineData.accounts) ? pipelineData.accounts : [];

  let slotAcc = null;
  let refreshedFpInfo = null;

  // Se o operador clicou em um perfil específico na tabela do MultiZen:
  if (requestedProfileId && !forceNewProfile && MultiZenService.hasProfile(requestedProfileId)) {
    const existingByProf = pipelineData.accounts.find(
      a => a && String(a.incogniton_profile_id || '').toLowerCase() === requestedProfileId.toLowerCase()
    );
    if (existingByProf) {
      const hasStandingFb = Boolean(
        existingByProf.fb_logged_in === true ||
        Number(existingByProf.pages_count || 0) > 0 ||
        existingByProf.fb_profile_uid ||
        Number(existingByProf.warmup_stats?.profile_videos_posted || existingByProf.profile_reels_posted || 0) > 0
      );
      if (hasStandingFb || String(existingByProf.email || '').trim()) {
        throw new Error(`O perfil "${existingByProf.name}" já é uma conta em operação/aquecimento (FB de pé, vídeos ou Gmail vinculado). Para abri-lo sem apagar nada, use o botão "🖥️ Abrir Chrome" ou "🎬 Aquecer Hoje"!`);
      }
      slotAcc = existingByProf;
    } else {
      const mzProf = (MultiZenService.listProfiles() || []).find(
        p => String(p.id || p.profile_browser_ID || '').toLowerCase() === requestedProfileId.toLowerCase()
      );
      const slotLabel = (mzProf && (mzProf.name || mzProf.profile_name)) || options.profile_name || `CONTA 4G #${requestedProfileId.slice(0, 4)}`;
      slotAcc = {
        id: `acc_mz_${requestedProfileId.slice(0, 8)}`,
        name: slotLabel,
        fb_profile_name: slotLabel,
        expected_pages: [],
        email: '',
        email_tier: 'GMAIL_TIER1',
        warmup_mode: 'EMAIL_ONLY_PREWARM',
        password: '',
        recovery_email: '',
        totp_secret: '',
        totp_secret_formatted: '',
        incogniton_profile_id: requestedProfileId,
        browser_engine: 'multizen_cloak_cpp',
        network_mode: '4G_REQUIRED',
        template_mode: 'CLASSIC_30D',
        stage_day: 1,
        status: 'DIA_1',
        pages_count: 0,
        is_virgin_slot: true,
        slot_time: 'MultiZen Web Gmail 4G • Zero-CDP',
        added_at: new Date().toISOString(),
        notes: `Slot MultiZen vinculado no IP 4G ${ip4g}`,
        warmup_stats: {
          newsletters_subscribed: [],
          gmail_authenticated: false
        }
      };
      pipelineData.accounts.unshift(slotAcc);
    }
  }

  if (!slotAcc && !forceNewProfile) {
    // Procura um slot virgem sem e-mail (ex.: CONTA 4G #08, CONTA 4G #09, Conta #14, Conta #15)
    const emptyCandidates = pipelineData.accounts
      .filter(a => {
        if (!a || String(a.email || '').trim()) return false;
        const st = String(a.status || '').toUpperCase();
        if (st === 'CEMITERIO' || st === 'BURIED_GRAVEYARD') return false;
        if (a.fb_logged_in === true || Number(a.pages_count || 0) > 0 || a.fb_profile_uid) return false;
        if (Number(a.warmup_stats?.profile_videos_posted || a.profile_reels_posted || 0) > 0) return false;
        const hasValidNameOrFlag = Boolean(a.is_virgin_slot || /^(CONTA 4G #|Conta #)\d+/i.test(String(a.name || '').trim()));
        return hasValidNameOrFlag && a.incogniton_profile_id && MultiZenService.hasProfile(a.incogniton_profile_id);
      })
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true }));

    slotAcc = emptyCandidates[0] || null;
  }

  if (slotAcc && slotAcc.incogniton_profile_id) {
    if (MultiZenService.isProfileLockedByKernel(slotAcc.incogniton_profile_id)) {
      await MultiZenService.stopProfile(slotAcc.incogniton_profile_id, onLog).catch(() => {});
    }
    refreshedFpInfo = fingerprintGenerator.refreshVirginSlotFingerprint(slotAcc.incogniton_profile_id, {
      name: slotAcc.name,
      ip_4g: ip4g,
      wipeDisk: true
    });
    slotAcc.notes = `Fingerprint Nova Isolada 4G (${ip4g}) • Seed #${refreshedFpInfo.fingerprint_seed} (${refreshedFpInfo.gpu?.renderer || 'GPU Windows'})`;
    fs.writeFileSync(WARMING_PIPELINE_FILE, JSON.stringify(pipelineData, null, 2), 'utf8');
    onLog(`🧬 [Fingerprint Generator C++] Disco limpo + Fingerprint nova isolada gerada no slot "${slotAcc.name}" (Seed #${refreshedFpInfo.fingerprint_seed} • ${refreshedFpInfo.gpu?.renderer || 'GPU Windows'})`);
  } else {
    // Descobre o próximo número de CONTA 4G #XX
    let maxNum = 9;
    for (const a of pipelineData.accounts) {
      const m = String(a.name || '').match(/(?:CONTA 4G #|Conta #)(\d+)/i);
      if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
    }
    const nextNum = maxNum + 1;
    const slotLabel = `CONTA 4G #${String(nextNum).padStart(2, '0')}`;
    const newProf = fingerprintGenerator.createNewIsolatedFingerprintProfile({
      name: slotLabel,
      ip_4g: ip4g,
      startUrl
    });
    refreshedFpInfo = newProf;

    slotAcc = {
      id: `acc_mz_${String(newProf.profile_id).slice(0, 8)}`,
      name: slotLabel,
      fb_profile_name: slotLabel,
      expected_pages: [],
      email: '',
      email_tier: 'GMAIL_TIER1',
      warmup_mode: 'EMAIL_ONLY_PREWARM',
      password: '',
      recovery_email: '',
      totp_secret: '',
      totp_secret_formatted: '',
      incogniton_profile_id: newProf.profile_id,
      browser_engine: 'multizen_cloak_cpp',
      network_mode: '4G_REQUIRED',
      template_mode: 'CLASSIC_30D',
      stage_day: 1,
      status: 'DIA_1',
      pages_count: 0,
      is_virgin_slot: true,
      slot_time: 'MultiZen Web Gmail 4G • Zero-CDP',
      added_at: new Date().toISOString(),
      notes: `Slot virgem preparado no IP 4G ${ip4g} • Seed #${newProf.fingerprint_seed}`,
      warmup_stats: {
        newsletters_subscribed: [],
        gmail_authenticated: false
      }
    };
    pipelineData.accounts.unshift(slotAcc);
    fs.writeFileSync(WARMING_PIPELINE_FILE, JSON.stringify(pipelineData, null, 2), 'utf8');
  }

  const profileId = slotAcc.incogniton_profile_id;
  const suggestedPersona = generateSuggestedGmailWebPersona(slotAcc.name);
  onLog(`🧬 [Passo 2/3 • Slot MultiZen C++] Selecionado "${slotAcc.name}" (Profile ID: ${profileId}) • Sugestão: ${suggestedPersona.suggested_email}`);

  // 3. Lança Google Chrome 157 Oficial em Modo Stealth 100% Humano (ZERO CDP / ZERO PUPPETEER)
  // Abre YouTube + Pesquisa Google Brasil orgânica (via Ponte 4G IPv4-Only :8081) para plantar cookies NID/AEC/SEARCH_SAMESITE antes de Criar Conta!
  const prewarmTabs = startUrl.includes('accounts.google.com')
    ? [startUrl, 'https://www.google.com.br/search?q=dicas+saude+bem+estar+rotina&hl=pt-BR']
    : [startUrl, 'https://www.google.com.br/search?q=dicas+saude+bem+estar+rotina&hl=pt-BR'];
  const launchRes = await MultiZenService.launchProfileStealthZeroCdp(profileId, prewarmTabs, onLog);

  const slotState = {
    active: true,
    slot_id: slotAcc.id,
    slot_name: slotAcc.name,
    profile_id: profileId,
    pid: launchRes.pid,
    ip_4g: ip4g,
    isp_4g: isp4g,
    fingerprint_seed: launchRes.fingerprint_seed || refreshedFpInfo?.fingerprint_seed,
    gpu: launchRes.gpu || refreshedFpInfo?.gpu,
    start_url: startUrl,
    web_entry_mode: startUrl.includes('accounts.google.com') ? 'GMAIL_DIRECT' : 'YOUTUBE_WEB',
    suggested_persona: suggestedPersona,
    zero_cdp: true,
    step: 'STEP_1_GMAIL_ZERO_CDP_OPEN',
    opened_at: new Date().toISOString()
  };

  fs.writeFileSync(ACTIVE_CREATION_SLOT_FILE, JSON.stringify(slotState, null, 2), 'utf8');
  onLog(`✅ [Passo 3/3 • MultiZen Aberto via Web (Zero-CDP)] Crie o Gmail (${suggestedPersona.suggested_email}) na janela aberta e depois clique no Passo 2 para salvar e aquecer!`);

  return slotState;
}

/**
 * Executa a inscrição nas 15 Newsletters Editoriais para o e-mail recém-criado e fecha o navegador ao concluir.
 */
async function runPostCreationNewsletters(profileId, cleanEmail, onLog = console.log) {
  let launchInfo = null;
  let browser = null;
  activeNewsletterWarmupState.active = true;
  activeNewsletterWarmupState.profile_id = profileId;
  activeNewsletterWarmupState.email = cleanEmail;
  activeNewsletterWarmupState.started_at = new Date().toISOString();

  const workPromise = (async () => {
    try {
      onLog(`📰 [Fase 1 • 15 Newsletters] Iniciando inscrição editorial para "${cleanEmail}" no perfil ${profileId.slice(0, 8)}...`);
      launchInfo = await MultiZenService.ensureProfileLaunched(profileId, onLog);
      browser = await puppeteer.connect({
        browserURL: launchInfo.cdp_url,
        defaultViewport: null,
        targetFilter: CLOAK_TARGET_FILTER
      });
      const newsTab = await browser.newPage();
      const pipelineAcc = resolveAccountFromPipeline(cleanEmail);
      const newsRes = await newsletterWarmer.subscribeToPortals(newsTab, cleanEmail, {
        already_subscribed: pipelineAcc?.warmup_stats?.newsletters_subscribed || [],
        max_sites_per_session: 15,
        onLog
      });
      // Ancora cookies Meta Pixel (_fbp / tr) em portais externos antes de qualquer acesso ao facebook.com (Anti-Checkpoint Web)
      let pixelRes = { visited: 0, sites: [] };
      try {
        const metaPixelWarmer = require('./meta_pixel_warmer');
        pixelRes = await metaPixelWarmer.warmMetaPixelCookies(newsTab, 4, onLog);
      } catch (errPx) {
        onLog(`⚠️ [Meta Pixel Pre-Warm] ${errPx.message}`);
      }
      await newsTab.close().catch(() => { });
      updateAccountInPipeline(cleanEmail, {
        newsletters: newsRes,
        gmail_authenticated: true,
        status: 'STAGE_1_EMAIL_SOAK'
      });
      onLog(`🎉 [Fase 1 • Molho 24h–48h + Pixel _fbp Iniciado] "${cleanEmail}" inscrito em ${newsRes.subscribed.length} newsletters + ${pixelRes.visited || 0} pixels Meta (_fbp) ancorados! Relógio de 24h–48h rodando.`);
      return { ...newsRes, meta_pixel_sites: pixelRes.sites || [] };
    } catch (err) {
      onLog(`⚠️ [Fase 1 • Aviso Newsletters] ${err.message}`);
      return { subscribed: [], error: err.message };
    } finally {
      if (browser) {
        try { browser.disconnect(); } catch (_) { }
      }
      if (profileId) {
        await MultiZenService.stopProfile(profileId, onLog).catch(() => { });
      }
      activeNewsletterWarmupState = {
        active: false,
        profile_id: null,
        email: null,
        started_at: null,
        promise: null
      };
    }
  })();

  activeNewsletterWarmupState.promise = workPromise;
  return workPromise;
}

/**
 * Finaliza a criação do e-mail no Slot:
 * 1. Valida o domínio via email_domain_validator.js
 * 2. Fecha o processo CloakBrowser Zero-CDP com segurança (flush de cookies SID, SAPISID, OSID, VISITOR_INFO1_LIVE)
 * 3. Vincula o e-mail e grava a senha (+ eventual Google 2FA TOTP) criptografada no .env.vault.json exatamente no profile_id/slot_id
 * 4. Dispara as 15 Newsletters Editoriais e inicia o relógio de 24h–48h da Fase 1 (STAGE_1_EMAIL_SOAK)
 */
async function finalizeCreatedEmailSlot(payload = {}, onLog = console.log) {
  const activeSlot = getActiveCreationSlot() || {};
  let rawInput = String(payload.raw_input || payload.email || '').trim();
  let cleanEmail = String(payload.email || '').trim();
  let password = String(payload.password || '').trim();
  let recoveryEmail = String(payload.recovery_email || '').trim();
  let googleTotpSecret = String(payload.google_totp_secret || '').replace(/\s+/g, '').toUpperCase();

  if (rawInput.includes(';') || rawInput.includes('|') || rawInput.includes('\t')) {
    const sep = rawInput.includes(';') ? ';' : (rawInput.includes('\t') ? '\t' : '|');
    const parts = rawInput.split(sep).map(s => s.trim());
    cleanEmail = parts[0] || cleanEmail;
    if (!password && parts[1]) password = parts[1];
    if (parts[2]) {
      const p2NoSpaces = parts[2].replace(/\s+/g, '');
      if (!parts[2].includes('@') && /^[A-Z2-7]{16,64}$/i.test(p2NoSpaces) && !googleTotpSecret) {
        googleTotpSecret = p2NoSpaces.toUpperCase();
      } else if (!recoveryEmail) {
        recoveryEmail = parts[2];
      }
    }
    if (parts[3] && !googleTotpSecret) {
      const p3NoSpaces = parts[3].replace(/\s+/g, '');
      if (/^[A-Z2-7]{16,64}$/i.test(p3NoSpaces)) {
        googleTotpSecret = p3NoSpaces.toUpperCase();
      }
    }
  }

  cleanEmail = cleanEmail.toLowerCase();
  if (!cleanEmail || !cleanEmail.includes('@')) {
    throw new Error('Informe o e-mail criado (ex: nome.sobrenome@gmail.com;SuaSenha).');
  }
  if (!password) {
    throw new Error('Informe a senha do e-mail criado (formato: email@gmail.com;SenhaForte).');
  }

  // 1. Valida o domínio via email_domain_validator.js
  const domCheck = emailDomainValidator.validateEmailFor4gBrWarmup(cleanEmail);
  if (!domCheck.domain_allowed) {
    throw new Error(`🚫 E-mail reprovado pelo Validador de Domínio 4G BR (${domCheck.tier}): ${domCheck.reason}`);
  }

  const profileId = String(payload.profile_id || activeSlot.profile_id || '').trim();
  const slotId = String(payload.slot_id || activeSlot.slot_id || '').trim();
  const pid = activeSlot.pid || null;

  // 2. Fecha o processo CloakBrowser manual (Zero-CDP) com segurança para salvar os cookies recém-criados no disco
  if (profileId) {
    onLog(`💾 [Fábrica YouTube 4G] Fechando navegador Zero-CDP do perfil ${profileId.slice(0, 8)} com segurança para gravar cookies (SID, SAPISID, OSID)...`);
    await MultiZenService.closeStealthZeroCdpProfileGracefully(profileId, pid, onLog);
  }

  // 3. Vincula o email e grava a senha criptografada no .env.vault.json e warming_accounts_pipeline.json
  const pipelineData = fs.existsSync(WARMING_PIPELINE_FILE)
    ? JSON.parse(fs.readFileSync(WARMING_PIPELINE_FILE, 'utf8'))
    : { accounts: [] };
  pipelineData.accounts = Array.isArray(pipelineData.accounts) ? pipelineData.accounts : [];

  let targetAcc = pipelineData.accounts.find(a =>
    (slotId && a.id === slotId) ||
    (profileId && a.incogniton_profile_id === profileId) ||
    (String(a.email || '').trim().toLowerCase() === cleanEmail)
  );

  const emailTier = /@(gmail|googlemail)\./i.test(cleanEmail)
    ? 'GMAIL_TIER1'
    : /@(outlook|hotmail|live|msn)\./i.test(cleanEmail)
      ? 'OUTLOOK_TIER2'
      : 'CUSTOM_TIER3';

  const nowIso = new Date().toISOString();
  const suggestedFullName = String(
    payload.fb_persona_name ||
    activeSlot.suggested_persona?.full_name ||
    ''
  ).trim();

  // Se o operador criou o Gmail no celular Samsung 4G (ou já tinha o Gmail pronto) e digitou direto no Passo 2 sem abrir o Passo 1 antes,
  // aloca automaticamente o primeiro Slot Virgem disponível (ex.: CONTA 4G #08 / CONTA 4G #09) para já abrir o Facebook Zero-CDP!
  let effectiveProfileId = profileId || (targetAcc && targetAcc.incogniton_profile_id) || '';
  if (!targetAcc) {
    const virginCandidate = pipelineData.accounts.find(a => {
      if (!a || String(a.email || '').trim()) return false;
      const st = String(a.status || '').toUpperCase();
      if (st === 'CEMITERIO' || st === 'BURIED_GRAVEYARD') return false;
      if (a.fb_logged_in === true || Number(a.pages_count || 0) > 0 || a.fb_profile_uid) return false;
      return Boolean((a.is_virgin_slot || /^(CONTA 4G #|Conta #)\d+/i.test(String(a.name || '').trim())) && a.incogniton_profile_id);
    });
    if (virginCandidate) {
      targetAcc = virginCandidate;
      effectiveProfileId = virginCandidate.incogniton_profile_id;
    }
  }
  if (!effectiveProfileId) {
    const newProf = fingerprintGenerator.createNewIsolatedFingerprintProfile({
      name: suggestedFullName || cleanEmail,
      ip_4g: activeSlot.ip_4g || '4G',
      startUrl: 'https://www.facebook.com/'
    });
    effectiveProfileId = newProf.profile_id;
  }

  if (targetAcc) {
    const oldSlotName = targetAcc.name || 'Slot 4G';
    targetAcc.email = cleanEmail;
    targetAcc.name = suggestedFullName || cleanEmail;
    targetAcc.fb_profile_name = suggestedFullName || oldSlotName;
    targetAcc.email_tier = emailTier;
    targetAcc.warmup_mode = 'EMAIL_ONLY_PREWARM';
    targetAcc.recovery_email = recoveryEmail || targetAcc.recovery_email || '';
    targetAcc.password = '';
    if (googleTotpSecret) targetAcc.google_totp_secret = googleTotpSecret;
    targetAcc.is_virgin_slot = false;
    if (effectiveProfileId) targetAcc.incogniton_profile_id = effectiveProfileId;
    targetAcc.browser_engine = 'multizen_cloak_cpp';
    targetAcc.status = 'STAGE_1_EMAIL_SOAK';
    targetAcc.email_created_via_youtube_4g = true;
    targetAcc.created_ip_4g = activeSlot.ip_4g || null;
    targetAcc.warmup_stats = targetAcc.warmup_stats || {};
    targetAcc.warmup_stats.gmail_authenticated = true;
    targetAcc.warmup_stats.first_email_warmup_at = targetAcc.warmup_stats.first_email_warmup_at || nowIso;
    targetAcc.warmup_stats.last_email_warmup_at = nowIso;
    targetAcc.warmup_stats.newsletters_subscribed = targetAcc.warmup_stats.newsletters_subscribed || [];
  } else {
    targetAcc = {
      id: slotId || `acc_${Date.now()}`,
      name: suggestedFullName || cleanEmail,
      fb_profile_name: suggestedFullName || cleanEmail,
      expected_pages: [],
      email: cleanEmail,
      email_tier: emailTier,
      warmup_mode: 'EMAIL_ONLY_PREWARM',
      password: '',
      recovery_email: recoveryEmail,
      totp_secret: '',
      totp_secret_formatted: '',
      google_totp_secret: googleTotpSecret || '',
      incogniton_profile_id: effectiveProfileId,
      browser_engine: 'multizen_cloak_cpp',
      network_mode: '4G_REQUIRED',
      template_mode: 'CLASSIC_30D',
      stage_day: 1,
      status: 'STAGE_1_EMAIL_SOAK',
      email_created_via_youtube_4g: true,
      created_ip_4g: activeSlot.ip_4g || null,
      pages_count: 0,
      slot_time: 'Fábrica YouTube 4G • Fase 1',
      added_at: nowIso,
      notes: `Criado via YouTube 4G Zero-CDP (${activeSlot.ip_4g || '4G'})`,
      warmup_stats: {
        gmail_authenticated: true,
        first_email_warmup_at: nowIso,
        last_email_warmup_at: nowIso,
        newsletters_subscribed: []
      }
    };
    pipelineData.accounts.unshift(targetAcc);
  }

  fs.writeFileSync(WARMING_PIPELINE_FILE, JSON.stringify(pipelineData, null, 2), 'utf8');

  // Renomeia o perfil no MultiZen C++ para exibir o e-mail recém-criado
  if (effectiveProfileId) {
    MultiZenService.renameProfile(
      effectiveProfileId,
      cleanEmail,
      `Criado no YouTube 4G Zero-CDP (${activeSlot.ip_4g || '4G'}) em ${nowIso}`
    );
  }

  // Salva senha criptografada no .env.vault.json local
  const vaultSecretsPayload = {
    password,
    recovery_email: recoveryEmail
  };
  if (googleTotpSecret) {
    vaultSecretsPayload.google_totp_secret = googleTotpSecret;
  }
  vault.storeAccountSecretInLocalVault(targetAcc.id, vaultSecretsPayload);
  vault.storeAccountSecretInLocalVault(cleanEmail, vaultSecretsPayload);

  // Atualiza estado do slot ativo
  const closedSlotState = {
    ...activeSlot,
    active: false,
    step: 'STEP_2_FINALIZED_AWAITING_STEP_3',
    finalized_at: nowIso,
    finalized_email: cleanEmail,
    account_id: targetAcc.id
  };
  fs.writeFileSync(ACTIVE_CREATION_SLOT_FILE, JSON.stringify(closedSlotState, null, 2), 'utf8');
  lifecyclePipeline.syncLifecycleState();

  onLog(`🔒 [Cofre Local .ENV] E-mail "${cleanEmail}" vinculado ao perfil MultiZen ${profileId || targetAcc.id} e senha criptografada com sucesso!`);

  // 4. Fluxo Wilas + Camada Extra Zero-CDP (2026):
  // Em vez de conectar Puppeteer/CDP antes de criar o Facebook, abre IMEDIATAMENTE em 100% Zero-CDP ( no mesmo IP 4G ):
  // - Aba 1 (Focada): https://www.facebook.com/ (Home orgânica -> planta cookie datr para criar o FB à mão)
  // - Aba 2: https://mail.google.com/mail/u/0/#inbox (Inicializa o Gmail Inbox em Zero-CDP para receber o código FB-XXXXX e já autenticar mail.google.com)
  // - Abas 3, 4 e 5: Portais de Saúde/Notícias com Meta Pixel oficial (_fbp) carregando em modo 100% humano Zero-CDP!
  const targetProfId = targetAcc.incogniton_profile_id;
  if (payload.openFbZeroCdpWithPixelShield !== false && targetProfId) {
    const zeroCdpShieldUrls = [
      'https://www.facebook.com/',
      'https://mail.google.com/mail/u/0/#inbox',
      'https://www.healthline.com/',
      'https://time.com/',
      'https://www.nytimes.com/'
    ];
    onLog(`🛡️ [Passo 2 • Camada Extra Zero-CDP + Facebook] Reabrindo "${targetAcc.name}" em 100% Zero-CDP com Home do Facebook + Gmail Inbox + 3 Portais Meta Pixel (_fbp) no mesmo IP 4G...`);
    const fbLaunchRes = await MultiZenService.launchProfileStealthZeroCdp(
      targetProfId,
      zeroCdpShieldUrls,
      onLog
    );
    const step2OpenState = {
      ...closedSlotState,
      active: true,
      pid: fbLaunchRes.pid,
      profile_id: targetProfId,
      start_url: 'https://www.facebook.com/',
      opened_urls: zeroCdpShieldUrls,
      zero_cdp: true,
      step: 'STEP_2_FB_SIGNUP_AND_PIXEL_SHIELD_OPEN',
      opened_at: new Date().toISOString()
    };
    fs.writeFileSync(ACTIVE_CREATION_SLOT_FILE, JSON.stringify(step2OpenState, null, 2), 'utf8');

    return {
      success: true,
      email: cleanEmail,
      tier: domCheck.tier,
      required_soak_hours: domCheck.required_soak_hours || 24,
      profile_id: targetProfId,
      account_id: targetAcc.id,
      pid: fbLaunchRes.pid,
      zero_cdp_fb_open: true,
      opened_urls: zeroCdpShieldUrls,
      message: `Gmail "${cleanEmail}" salvo no Cofre .ENV! Janela Zero-CDP aberta com Camada Extra (_fbp em Healthline/Time/NYT) + Gmail Inbox + Facebook Home. Crie o Facebook à mão na Aba 1 (pegue o código FB-XXXXX na Aba 2) e depois clique no Passo 3 para o Robô assumir tudo!`
    };
  }

  // Fallback para execução isolada de aquecimento de e-mail (sem abrir FB em seguida)
  if (payload.runNewslettersAsync && targetProfId) {
    setImmediate(() => {
      runPostCreationNewsletters(targetProfId, cleanEmail, onLog).catch(() => { });
    });
    return {
      success: true,
      email: cleanEmail,
      tier: domCheck.tier,
      required_soak_hours: domCheck.required_soak_hours || 24,
      profile_id: targetProfId,
      account_id: targetAcc.id,
      newsletters_started_in_background: true,
      message: `E-mail "${cleanEmail}" salvo no Cofre .ENV (Cookies consolidados) e disparo das 15 Newsletters iniciado em background! Relógio de ${domCheck.required_soak_hours || 24}h (Fase 1) ativado.`
    };
  } else if (targetProfId) {
    const newsRes = await runPostCreationNewsletters(targetProfId, cleanEmail, onLog);
    return {
      success: true,
      email: cleanEmail,
      tier: domCheck.tier,
      required_soak_hours: domCheck.required_soak_hours || 24,
      profile_id: targetProfId,
      account_id: targetAcc.id,
      newsletters: newsRes,
      message: `E-mail "${cleanEmail}" salvo no Cofre .ENV e inscrito em ${newsRes.subscribed?.length || 0} newsletters!`
    };
  }

  return {
    success: true,
    email: cleanEmail,
    tier: domCheck.tier,
    account_id: targetAcc.id,
    message: `E-mail "${cleanEmail}" salvo no Cofre .ENV!`
  };
}

// Suporte para execução direta via terminal (CLI)
if (require.main === module) {
  (function runCliMain() {
    const args = process.argv.slice(2);
    const getArg = (flag) => {
      const idx = args.indexOf(flag);
      return idx !== -1 ? args[idx + 1] : null;
    };

    if (args.includes('--pipeline-status') || args.includes('--lifecycle')) {
      lifecyclePipeline.printLifecyclePipelineStatus();
      process.exit(0);
    }

    if (args.includes('--youtube-slot')) {
      const skipRotate = args.includes('--skip-rotate');
      openYoutubeCreationSlot({ skipRotate }, console.log).then(res => {
        console.log('\n============================================================');
        console.log('🎬 SLOT VIRGEM ABERTO NO YOUTUBE (MODO STEALTH ZERO-CDP)');
        console.log('============================================================');
        console.log(JSON.stringify(res, null, 2));
        process.exit(0);
      }).catch(err => {
        console.error('❌ Erro ao abrir slot YouTube 4G:', err.message);
        process.exit(1);
      });
      return;
    }

    const finalizeEmailRaw = getArg('--finalize-email');
    if (finalizeEmailRaw) {
      finalizeCreatedEmailSlot({ raw_input: finalizeEmailRaw }, console.log).then(res => {
        console.log('\n============================================================');
        console.log('✅ E-MAIL CRIADO SALVO NO COFRE .ENV + 15 NEWSLETTERS');
        console.log('============================================================');
        console.log(JSON.stringify(res, null, 2));
        process.exit(0);
      }).catch(err => {
        console.error('❌ Erro ao finalizar e-mail:', err.message);
        process.exit(1);
      });
      return;
    }

    if (args.includes('--gold-conveyor') || args.includes('--esteira')) {
      const profileReelsWarmer = require('./profile_reels_warmer');
      const data = fs.existsSync(WARMING_PIPELINE_FILE)
        ? JSON.parse(fs.readFileSync(WARMING_PIPELINE_FILE, 'utf8'))
        : { accounts: [] };
      console.log('\n================================================================================');
      console.log('🏆 ESTEIRA OURO DIA 0 -> DIA 5+ (PERFIL PT-BR 9 VÍDEOS + PÁGINA EUA 7 PONTOS)');
      console.log('================================================================================');
      for (const acc of (data.accounts || [])) {
        const st = profileReelsWarmer.evaluateGoldConveyorStage(acc);
        console.log(`• [${st.code}] ${acc.name || acc.email} | Vídeos no Perfil: ${st.profile_videos_posted}/9 | Ação: ${st.next_action}`);
      }
      process.exit(0);
    }

    const motherReelsTarget = getArg('--mother-reels');
    if (motherReelsTarget) {
      (async () => {
        const profileReelsWarmer = require('./profile_reels_warmer');
        const IncognitonService = require('../../incogniton');
        const db = require('../../db');
        const automator = require('../../automator');
        const settings = db.getSettings();
        const incogniton = new IncognitonService(settings.mcp_token, settings.mcp_api_url);
        const skipRotate = args.includes('--skip-rotate');
        const data = JSON.parse(fs.readFileSync(WARMING_PIPELINE_FILE, 'utf8'));
        const needle = String(motherReelsTarget).trim().toLowerCase();
        const acc = (data.accounts || []).find(a =>
          String(a.name || '').toLowerCase().includes(needle) ||
          String(a.incogniton_profile_id || '').toLowerCase().startsWith(needle) ||
          String(a.id || '').toLowerCase() === needle
        );
        if (!acc || !acc.incogniton_profile_id) {
          throw new Error(`Conta não encontrada para --mother-reels: "${motherReelsTarget}"`);
        }
        const profileId = acc.incogniton_profile_id;
        console.log(`\n============================================================`);
        console.log(`🎬 ESTEIRA OURO PERFIL MÃE (3 VÍDEOS K-DRAMA/PT-BR) • "${acc.name}" (${profileId.slice(0, 8)})`);
        console.log(`============================================================`);
        if (!skipRotate) {
          console.log(`✈️ [ADB 4G] Girando Modo Avião por 10s no Samsung para novo IP CGNAT...`);
          await adbRotator.rotate4gIp({ airplaneHoldMs: 10000 }, console.log);
        } else {
          adbRotator.ensurePortForward(8080, 8080, console.log);
        }
        // Destrava temporariamente o hard lock diário para complementar os vídeos restantes do Perfil Mãe
        const p8 = profileId.toLowerCase().slice(0, 8);
        try {
          const memPath = path.resolve(__dirname, '../../IMMUTABLE_HARD_MEMORY.json');
          if (fs.existsSync(memPath)) {
            const mem = JSON.parse(fs.readFileSync(memPath, 'utf8'));
            if (mem.locked_4g_profiles_by_date) {
              for (const k of Object.keys(mem.locked_4g_profiles_by_date)) {
                if (k.toLowerCase().startsWith(p8)) delete mem.locked_4g_profiles_by_date[k];
              }
            }
            if (!skipRotate && mem.session_ip_bindings) {
              for (const k of Object.keys(mem.session_ip_bindings)) {
                if (k.toLowerCase().startsWith(p8)) delete mem.session_ip_bindings[k];
              }
            }
            fs.writeFileSync(memPath, JSON.stringify(mem, null, 2), 'utf8');
          }
          const dbPath = path.resolve(__dirname, '../../database.json');
          if (fs.existsSync(dbPath)) {
            const dbRaw = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
            if (dbRaw.settings?.daily_profile_session_by_id) {
              for (const k of Object.keys(dbRaw.settings.daily_profile_session_by_id)) {
                if (k.toLowerCase().startsWith(p8)) delete dbRaw.settings.daily_profile_session_by_id[k];
              }
              fs.writeFileSync(dbPath, JSON.stringify(dbRaw, null, 2), 'utf8');
            }
          }
        } catch (_) { }
        let browser = null;
        let anySuccess = false;
        try {
          const { cdp_url } = await incogniton.ensureProfileLaunched(profileId, console.log);
          if (!cdp_url) throw new Error(`Não foi possível abrir o perfil ${profileId}`);
          browser = await incogniton.connectBrowser(cdp_url);
          const pages = await browser.pages();
          let page = pages.find(p => (p.url() || '').includes('facebook.com')) || pages[0] || (await browser.newPage());
          await page.bringToFront().catch(() => { });
          if (!(page.url() || '').includes('facebook.com')) {
            await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => { });
            await new Promise(r => setTimeout(r, 4000));
          }
          await automator.ensureActingAsPersonalProfile(page, console.log);
          const res = await profileReelsWarmer.postWarmupReelOnPersonalProfile(page, automator, acc, console.log);
          anySuccess = Boolean(res && res.success);
          console.log(`\n📊 [RESULTADO PERFIL MÃE • "${acc.name}"]:`, JSON.stringify(res, null, 2));
          await new Promise(r => setTimeout(r, 3500));
        } finally {
          try { if (browser) browser.disconnect(); } catch (_) { }
          await incogniton.stopProfile(profileId, {
            reason: 'Esteira Ouro Perfil Mãe Concluída',
            allowDailyLock: anySuccess,
            onLog: console.log
          }).catch(() => { });
          console.log(`✅ [Isolamento 4G] Navegador de "${acc.name}" (${profileId.slice(0, 8)}) encerrado com sucesso!`);
        }
        process.exit(0);
      })().catch(err => {
        console.error('❌ Erro em --mother-reels:', err.message);
        process.exit(1);
      });
      return;
    }

    if (args.includes('--plan') || args.includes('--batch')) {
      printBatchPlan();
      process.exit(0);
    }

    const checkOnlyEmail = getArg('--check-email');
    if (checkOnlyEmail) {
      const checkRes = emailDomainValidator.validateEmailFor4gBrWarmup(checkOnlyEmail);
      console.log('\n============================================================');
      console.log(`🛡️ AUDITORIA DE DOMÍNIO & COERÊNCIA GEOGRÁFICA 4G BR (${checkOnlyEmail})`);
      console.log('============================================================');
      console.log(JSON.stringify(checkRes, null, 2));
      process.exit(checkRes.allowed ? 0 : 1);
    }

    const checkMentorTiktok = args.includes('--mentor-tiktok-status');
    if (checkMentorTiktok) {
      const { execSync } = require('child_process');
      try {
        const out = execSync(`python "${path.resolve(__dirname, 'mentor_tiktok/repor_estoque_tiktok.py')}" --status`, { encoding: 'utf8' });
        console.log('\n============================================================');
        console.log('🎞️ ESTOQUE TIKTOK MENTOR (1:1 ESTRETO • KDRAMA ROMANCE & CATS)');
        console.log('============================================================');
        console.log(out);
        process.exit(0);
      } catch (err) {
        console.error('❌ Erro ao consultar estoque mentor tiktok:', err.message);
        process.exit(1);
      }
      return;
    }

    const checkTiktokHandle = getArg('--check-tiktok');
    if (checkTiktokHandle) {
      const profileReelsWarmer = require('./profile_reels_warmer');
      profileReelsWarmer.checkTikTokHandleOnFacebook(checkTiktokHandle).then(res => {
        console.log('\n============================================================');
        console.log(`🎵 AUDITORIA DE DIREITOS AUTORAIS TIKTOK -> FACEBOOK (@${res.handle})`);
        console.log('============================================================');
        console.log(JSON.stringify(res, null, 2));
        process.exit(0);
      });
      return;
    }

    const downloadTiktokProfile = getArg('--download-tiktok');
    if (downloadTiktokProfile) {
      const tiktokDownloader = require('./tiktok_warmup_downloader');
      const maxCount = Number(getArg('--count') || 12);
      tiktokDownloader.downloadTopTikTokVideosToWarmupPool(downloadTiktokProfile, maxCount).then(res => {
        console.log('\n============================================================');
        console.log(`🎉 VÍDEOS TIKTOK BAIXADOS PARA VIDEOS_AQUECIMENTO_PERFIL_PTBR (@${res.handle})`);
        console.log('============================================================');
        console.log(JSON.stringify(res, null, 2));
        process.exit(0);
      }).catch(err => {
        console.error('❌ Erro ao baixar do TikTok:', err.message);
        process.exit(1);
      });
      return;
    }

    const targetEmail = getArg('--email');
    const targetPass = getArg('--password') || '';
    const targetPhone = getArg('--phone') || '';
    const targetSms = getArg('--sms') || '';
    const maxNewsArg = Number(getArg('--max-newsletters') || 15);
    const closeBrowser = args.includes('--close');
    const skipRotate = args.includes('--skip-rotate');

    if (!targetEmail) {
      console.log('Uso CLI:');
      console.log('  node modules/account_warmup/runner.js --pipeline-status                         (Status das 4 Fases Científicas: Contas & Páginas)');
      console.log('  node modules/account_warmup/runner.js --plan                                    (Planeja o lote de amanhã)');
      console.log('  node modules/account_warmup/runner.js --check-email "exemplo@dominio.com"       (Valida domínio + coerência 4G BR + entropia)');
      console.log('  node modules/account_warmup/runner.js --email "user@gmail.com"                 (Aquece uma conta específica com Giro 4G ADB)');
      console.log('  node modules/account_warmup/runner.js --email "user@gmail.com" --phone "..."   (Passa número de telefone novo)');
      console.log('  node modules/account_warmup/runner.js --email "user@gmail.com" --sms "123456"  (Passa código SMS recebido)');
      process.exit(1);
    }

    const preflightCheck = emailDomainValidator.validateEmailFor4gBrWarmup(targetEmail);
    if (!preflightCheck.domain_allowed || (!preflightCheck.handle_analysis?.is_human_pattern && !args.includes('--force-handle'))) {
      console.error(`\n🚨 [BLOQUEIO IMEDIATO DE E-MAIL (${preflightCheck.tier})]: ${preflightCheck.reason}`);
      console.error(JSON.stringify(preflightCheck, null, 2));
      process.exit(1);
    }

    runAccountWarmup(
      { email: targetEmail, password: targetPass, phone: targetPhone },
      { close_browser_on_finish: closeBrowser, smsCode: targetSms, max_newsletters: maxNewsArg, skipRotate },
      console.log
    ).then(res => {
      console.log('\n[RESULTADO]:', JSON.stringify(res, null, 2));
      process.exit(0);
    }).catch(err => {
      console.error('\n[ERRO]:', err.message);
      process.exit(1);
    });
  })();
}

module.exports = {
  runAccountWarmup,
  resolveAccountFromPipeline,
  analyzeBatchForTomorrow,
  printBatchPlan,
  generateSuggestedGmailWebPersona,
  openYoutubeCreationSlot,
  finalizeCreatedEmailSlot,
  getActiveCreationSlot: getActiveCreationSlotWithPersona,
  getActiveNewsletterWarmupState,
  waitForActiveNewsletterWarmup
};
