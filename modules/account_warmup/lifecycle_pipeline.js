/**
 * ============================================================================
 * MÓDULO ACCOUNT WARMUP: MÁQUINA DE ESTADOS DE 4 FASES CIENTÍFICAS
 * ============================================================================
 * Diretório: modules/account_warmup/lifecycle_pipeline.js
 * Estado Persistente: modules/account_warmup/warmup_pipeline_state.json
 * Protocolo: CÉREBRO CENTRAL/03 - MEMÓRIA AGENTE INFRA 4G E BANCO (GUARDIÃO 5ca82f34)/PROTOCOLO_CIENTIFICO_AQUECIMENTO_4_FASES.md
 *
 * Gerencia de forma determinística o ciclo contínuo:
 *   E-mail ➔ Perfil FB ➔ Fan Page ➔ Graduação
 *
 * Fases:
 *   1. STAGE_1_EMAIL_SOAK             (24h–48h + 10–15 Newsletters + Validação Tier/Entropia)
 *   2. STAGE_2_FB_PROFILE_COOKIE_FARM (72h Perfil Pessoal + Pixel _fbp/datr em IP 4G CGNAT)
 *   3. STAGE_3_PAGE_SETTLING_72H      (72h Sem Vídeo pós-criação da Fan Page + PDQ único + 18 Países VIP)
 *   4. STAGE_4_IGNITION_RAMP          (Dias 1 a 3 de Postagem = 1 Reel/dia em F01/F02/F06/F08/F26 até >= 150 views)
 *   5. GRADUATED_PRODUCTION           (Graduada p/ 2 a 3 Reels/dia Option A MBS)
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const emailDomainValidator = require('./email_domain_validator');

const STATE_FILE = path.resolve(__dirname, 'warmup_pipeline_state.json');
const WARMING_PIPELINE_FILE = path.resolve(__dirname, '../../warming_accounts_pipeline.json');
const ACTIVE_CREATION_SLOT_FILE = path.resolve(__dirname, '../../active_creation_slot.json');
const DISCARDED_GMAILS_ARCHIVE_FILE = path.resolve(__dirname, '../../discarded_dead_gmails_archive.json');
const DATABASE_FILE = path.resolve(__dirname, '../../database.json');
const ADE_MEMORY_FILE = path.resolve(__dirname, '../../ade_memory.json');

const VIRGIN_SLOT_IDS = [
  'acc_multizen_slot_21',
  'acc_multizen_slot_22',
  'acc_multizen_slot_23',
  'acc_multizen_slot_24',
  'acc_multizen_slot_25'
];

const STAGES = {
  STAGE_1_EMAIL_SOAK: {
    code: 'STAGE_1_EMAIL_SOAK',
    step: 1,
    label: '📧 FASE 1: Molho E-mail (24h–48h + 10–15 Newsletters)',
    min_hours: 24,
    max_hours: 48
  },
  STAGE_2_FB_PROFILE_COOKIE_FARM: {
    code: 'STAGE_2_FB_PROFILE_COOKIE_FARM',
    step: 2,
    label: '🛡️ FASE 2: Cookie Farm Perfil FB (72h datr/_fbp + Scroll 4G)',
    min_hours: 72,
    max_hours: 72
  },
  STAGE_3_PAGE_SETTLING_72H: {
    code: 'STAGE_3_PAGE_SETTLING_72H',
    step: 3,
    label: '⏳ FASE 3 (Wilas Dia 4): Assentamento Página Nova (24h Parada + Barra 100% + Geo 18 VIP)',
    min_hours: 24,
    max_hours: 24,
    daily_reel_limit: 0
  },
  STAGE_4_IGNITION_RAMP: {
    code: 'STAGE_4_IGNITION_RAMP',
    step: 4,
    label: '🚀 FASE 4 (Wilas Dia 5+): Rampa de Ignição (3 Reels/dia Roleta até >=150v)',
    daily_reel_limit: 3,
    graduation_min_views: 150,
    ignition_posts_window: 3,
    recommended_formats: ['F01', 'F02', 'F06', 'F08', 'F26']
  },
  GRADUATED_PRODUCTION: {
    code: 'GRADUATED_PRODUCTION',
    step: 5,
    label: '🏆 GRADUADA: Produção Escala (2–3 Reels/dia Option A MBS)',
    daily_reel_limit: 3
  },
  BLOCKED_INVALID_EMAIL: {
    code: 'BLOCKED_INVALID_EMAIL',
    step: 0,
    label: '🚫 BLOQUEADA: Domínio/Entropia Reprovado p/ IP 4G BR',
    daily_reel_limit: 0
  }
};

const CHAMPION_IGNITION_FORMATS = ['F01', 'F02', 'F06', 'F08', 'F26'];

function readJsonSafe(filePath, fallback = {}) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (_) { }
  return fallback;
}

function loadPipeline() {
  const data = readJsonSafe(WARMING_PIPELINE_FILE, { accounts: [] });
  if (!Array.isArray(data.accounts)) data.accounts = [];
  return data;
}

function savePipeline(data) {
  try {
    const safeData = data && typeof data === 'object' ? data : { accounts: [] };
    if (!Array.isArray(safeData.accounts)) safeData.accounts = [];
    safeData.updated_at = new Date().toISOString();
    fs.writeFileSync(WARMING_PIPELINE_FILE, JSON.stringify(safeData, null, 2), 'utf8');
    return true;
  } catch (_) {
    return false;
  }
}

function resolveAccountFromPipeline(identifier) {
  const data = loadPipeline();
  if (!identifier) return null;
  const clean = String(identifier).trim().toLowerCase();
  return data.accounts.find(a =>
    String(a.id || '').toLowerCase() === clean ||
    String(a.email || '').toLowerCase() === clean ||
    String(a.incogniton_profile_id || '').toLowerCase() === clean ||
    String(a.name || '').toLowerCase().includes(clean)
  ) || null;
}

function updateAccountInPipeline(accountId, patchFn) {
  const data = loadPipeline();
  const idx = data.accounts.findIndex(a => a.id === accountId);
  if (idx === -1) return null;
  const updated = patchFn(data.accounts[idx]);
  data.accounts[idx] = updated || data.accounts[idx];
  savePipeline(data);
  return data.accounts[idx];
}

function getActiveCreationSlot() {
  return readJsonSafe(ACTIVE_CREATION_SLOT_FILE, null);
}

function saveActiveCreationSlot(slot) {
  try {
    fs.writeFileSync(ACTIVE_CREATION_SLOT_FILE, JSON.stringify(slot, null, 2), 'utf8');
  } catch (_) { }
  return slot;
}

function clearActiveCreationSlot() {
  try {
    if (fs.existsSync(ACTIVE_CREATION_SLOT_FILE)) fs.unlinkSync(ACTIVE_CREATION_SLOT_FILE);
  } catch (_) { }
}

/**
 * Avalia em qual estágio do Protocolo de 4 Fases uma Conta de E-mail/FB se encontra.
 */
function evaluateAccountLifecycleStage(acc, nowMs = Date.now()) {
  const email = String(acc?.email || '').trim();
  const domainCheck = email ? emailDomainValidator.validateEmailFor4gBrWarmup(email) : null;

  if (!email) {
    return {
      stage: 'EMPTY_SLOT',
      step: 0,
      label: '⚪ SLOT VAZIO (Aguardando Novo E-mail)',
      ready_for_next_stage: false,
      hours_elapsed: 0,
      hours_remaining: 0,
      reason: 'Slot sem e-mail configurado.'
    };
  }

  if (domainCheck && !domainCheck.domain_allowed) {
    return {
      stage: STAGES.BLOCKED_INVALID_EMAIL.code,
      step: 0,
      label: STAGES.BLOCKED_INVALID_EMAIL.label,
      email_tier: domainCheck.tier,
      ready_for_next_stage: false,
      hours_elapsed: 0,
      hours_remaining: 999,
      reason: domainCheck.reason
    };
  }

  const requiredSoakHours = Number(domainCheck?.required_soak_hours || 24);
  const requiredNewsletters = Number(domainCheck?.required_newsletters || 10);
  const stats = acc?.warmup_stats || {};
  const newslettersCount = Array.isArray(stats.newsletters_subscribed) ? stats.newsletters_subscribed.length : 0;
  const gmailAuth = Boolean(stats.gmail_authenticated);

  const firstSeenIso = stats.first_email_warmup_at || acc?.added_at || stats.last_email_warmup_at || null;
  const firstSeenMs = firstSeenIso ? Date.parse(firstSeenIso) : 0;
  const emailElapsedHours = (firstSeenMs > 0 && Number.isFinite(firstSeenMs))
    ? Math.max(0, (nowMs - firstSeenMs) / 3600000)
    : 0;

  const isEmailOnlyMode = String(acc?.warmup_mode || '').toUpperCase() === 'EMAIL_ONLY_PREWARM';
  const hasFbProfile = !isEmailOnlyMode && Boolean(
    acc?.fb_account_created_at ||
    acc?.fb_logged_in === true ||
    Number(stats.cookie_warmer_runs || 0) > 0 ||
    String(acc?.warmup_mode || '').toUpperCase() === 'FB_PROFILE_WARMUP'
  );

  const emailSoakComplete = gmailAuth && newslettersCount >= requiredNewsletters && emailElapsedHours >= requiredSoakHours;

  if (!hasFbProfile && !emailSoakComplete) {
    const hoursLeft = Math.max(0, requiredSoakHours - emailElapsedHours);
    const newsLeft = Math.max(0, requiredNewsletters - newslettersCount);
    return {
      stage: STAGES.STAGE_1_EMAIL_SOAK.code,
      step: 1,
      label: STAGES.STAGE_1_EMAIL_SOAK.label,
      email_tier: domainCheck?.tier || 'UNKNOWN',
      handle_score: domainCheck?.handle_analysis?.score ?? 100,
      gmail_authenticated: gmailAuth,
      newsletters_count: newslettersCount,
      required_newsletters: requiredNewsletters,
      required_soak_hours: requiredSoakHours,
      hours_elapsed: Number(emailElapsedHours.toFixed(1)),
      hours_remaining: Number(hoursLeft.toFixed(1)),
      ready_for_next_stage: false,
      next_action: !gmailAuth
        ? 'Autenticar #inbox no MultiZen + assinar newsletters'
        : (newsLeft > 0
          ? `Completar +${newsLeft} newsletters (${newslettersCount}/${requiredNewsletters}) e aguardar ${hoursLeft.toFixed(1)}h`
          : `Aguardar ${hoursLeft.toFixed(1)}h de molho First_Seen antes do facebook.com/reg`)
    };
  }

  // Se já concluiu o Molho de E-mail ou já tem perfil FB em cookie farm:
  const fbAnchorIso = acc?.fb_account_created_at || stats.first_fb_warmup_at || stats.last_warmup_at || firstSeenIso;
  const fbAnchorMs = fbAnchorIso ? Date.parse(fbAnchorIso) : 0;
  const fbElapsedHours = (fbAnchorMs > 0 && Number.isFinite(fbAnchorMs))
    ? Math.max(0, (nowMs - fbAnchorMs) / 3600000)
    : 0;
  const fbHoursLeft = Math.max(0, 72 - fbElapsedHours);
  const pagesCount = Number(acc?.pages_count || 0);

  return {
    stage: STAGES.STAGE_2_FB_PROFILE_COOKIE_FARM.code,
    step: 2,
    label: STAGES.STAGE_2_FB_PROFILE_COOKIE_FARM.label,
    email_tier: domainCheck?.tier || 'UNKNOWN',
    handle_score: domainCheck?.handle_analysis?.score ?? 100,
    gmail_authenticated: gmailAuth,
    newsletters_count: newslettersCount,
    required_newsletters: requiredNewsletters,
    cookie_warmer_runs: Number(stats.cookie_warmer_runs || 0),
    hours_elapsed: Number(fbElapsedHours.toFixed(1)),
    hours_remaining: Number(fbHoursLeft.toFixed(1)),
    ready_for_next_stage: fbElapsedHours >= 72 && emailSoakComplete,
    next_action: !hasFbProfile
      ? 'Molho de E-mail concluído! Pronto p/ criar/logar Perfil FB no 4G CGNAT e iniciar Cookie Farm (_fbp/datr)'
      : (fbHoursLeft > 0
        ? `Rodar Cookie Farm _fbp + Scroll Perfil Pessoal (faltam ${fbHoursLeft.toFixed(1)}h p/ liberar criação da Fan Page)`
        : '72h concluídas — liberado p/ criar a 1ª Fan Page (STAGE_3_PAGE_SETTLING_72H)')
  };
}

/**
 * Avalia em qual estágio do Protocolo de 4 Fases uma Fan Page do database.json se encontra.
 * Usado tanto pelo CLI (--pipeline-status) quanto diretamente pelo scheduler.js!
 */
function evaluatePageLifecycleStage(page, chrono = null, nowMs = Date.now()) {
  if (!page) {
    return {
      stage: STAGES.GRADUATED_PRODUCTION.code,
      step: 5,
      daily_reel_limit: 3,
      is_settling_72h: false,
      is_ignition_ramp: false
    };
  }

  // 1. Verifica data de criação da página (Método Wilas Dia 4: 24h parada pós-criação)
  const createdTsRaw =
    page.created_timestamp ||
    page.created_at_ms ||
    (page.created_at ? Date.parse(page.created_at) : 0);

  const explicitCoolingUntilMs = createdTsRaw > 0
    ? createdTsRaw + 24 * 3600 * 1000
    : (page.page_created_cooling_until
      ? (typeof page.page_created_cooling_until === 'number'
        ? page.page_created_cooling_until
        : Date.parse(page.page_created_cooling_until))
      : 0);

  const totalPostsAllTime = Math.max(
    Number(page.total_posts_all_time || 0),
    Number(page.total_posts || 0),
    Array.isArray(chrono?.reels) ? chrono.reels.length : 0
  );

  let maxViews = Math.max(
    Number(page.max_views || 0),
    Number(page.max_reel_views || 0),
    Number(chrono?.maxEverViews || 0)
  );
  if (page.format_stats && typeof page.format_stats === 'object') {
    for (const st of Object.values(page.format_stats)) {
      if (st && Number(st.views || 0) > maxViews) {
        maxViews = Number(st.views || 0);
      }
    }
  }

  // STAGE 3 (Wilas Dia 4): Página recém-criada (< 24h de vida) e sem posts
  if (explicitCoolingUntilMs > nowMs && maxViews < 150 && totalPostsAllTime === 0) {
    const hoursLeft = (explicitCoolingUntilMs - nowMs) / 3600000;
    const hoursElapsed = Math.max(0, 24 - hoursLeft);
    return {
      stage: STAGES.STAGE_3_PAGE_SETTLING_72H.code,
      step: 3,
      label: STAGES.STAGE_3_PAGE_SETTLING_72H.label,
      daily_reel_limit: 0,
      is_settling_72h: true,
      is_ignition_ramp: false,
      hours_elapsed: Number(hoursElapsed.toFixed(1)),
      hours_remaining: Number(hoursLeft.toFixed(1)),
      page_created_cooling_until: new Date(explicitCoolingUntilMs).toISOString(),
      max_views: maxViews,
      total_posts: totalPostsAllTime,
      recommended_formats: CHAMPION_IGNITION_FORMATS,
      reason: `⏳ STAGE 3 (Wilas Dia 4 — 24h Parada Pós-Criação): faltam ~${hoursLeft.toFixed(1)}h de descanso antes do 1º Reel.`
    };
  }

  // STAGE 4 (Wilas Dia 5+): 3 Reels/dia em Roleta
  const isEarlyPosts = totalPostsAllTime < 3 || page.warming_no_link === true;

  if (isEarlyPosts && maxViews < 150) {
    const postNumber = Math.min(3, Math.max(1, totalPostsAllTime + 1));
    return {
      stage: STAGES.STAGE_4_IGNITION_RAMP.code,
      step: 4,
      label: STAGES.STAGE_4_IGNITION_RAMP.label,
      daily_reel_limit: 3,
      is_settling_72h: false,
      is_ignition_ramp: true,
      ignition_post_number: postNumber,
      max_views: maxViews,
      total_posts: totalPostsAllTime,
      recommended_formats: CHAMPION_IGNITION_FORMATS,
      reason: `🚀 STAGE 4 (Wilas Dia 5+ • Post #${postNumber}/3 até >=150v): liberado p/ 3 Reels/dia na Roleta.`
    };
  }

  // GRADUATED_PRODUCTION: Já bateu >= 150 views ou já passou da fase inicial
  return {
    stage: STAGES.GRADUATED_PRODUCTION.code,
    step: 5,
    label: STAGES.GRADUATED_PRODUCTION.label,
    daily_reel_limit: 3,
    is_settling_72h: false,
    is_ignition_ramp: false,
    max_views: maxViews,
    total_posts: totalPostsAllTime,
    recommended_formats: CHAMPION_IGNITION_FORMATS,
    reason: `🏆 Graduada (${maxViews} max views • ${totalPostsAllTime} Reels): liberada p/ 2–3 Reels/dia Option A MBS.`
  };
}

/**
 * Sincroniza o estado completo das Contas (warming_accounts_pipeline.json) e Páginas (database.json)
 * e grava deterministicamente em modules/account_warmup/warmup_pipeline_state.json.
 */
function syncLifecycleState() {
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const pipelineData = readJsonSafe(WARMING_PIPELINE_FILE, { accounts: [] });
  const dbData = readJsonSafe(DATABASE_FILE, { pages: [] });
  const adeData = readJsonSafe(ADE_MEMORY_FILE, { reels: [] });

  const rawAccounts = Array.isArray(pipelineData.accounts) ? pipelineData.accounts : [];
  const rawPages = Array.isArray(dbData.pages) ? dbData.pages : [];
  const rawReels = Array.isArray(adeData.reels) ? adeData.reels : [];

  // Indexa Reels por página para cálculo preciso de total_posts e max_views
  const reelsByPage = new Map();
  for (const r of rawReels) {
    const pName = String(r.page_name || '').trim().toLowerCase();
    if (!pName) continue;
    if (!reelsByPage.has(pName)) reelsByPage.set(pName, []);
    reelsByPage.get(pName).push(r);
  }

  const accountsState = [];
  const stageCounts = {
    STAGE_1_EMAIL_SOAK: 0,
    STAGE_2_FB_PROFILE_COOKIE_FARM: 0,
    STAGE_3_PAGE_SETTLING_72H: 0,
    STAGE_4_IGNITION_RAMP: 0,
    GRADUATED_PRODUCTION: 0,
    EMPTY_SLOT: 0,
    BLOCKED_INVALID_EMAIL: 0
  };

  for (const acc of rawAccounts) {
    const evalRes = evaluateAccountLifecycleStage(acc, nowMs);
    if (stageCounts[evalRes.stage] !== undefined) {
      stageCounts[evalRes.stage]++;
    }
    accountsState.push({
      id: acc.id,
      email: acc.email || '',
      profile_id: acc.incogniton_profile_id || null,
      browser_engine: acc.browser_engine || 'multizen_cloak_cpp',
      ...evalRes
    });
  }

  const pagesState = [];
  for (const p of rawPages) {
    const pNameKey = String(p.name || '').trim().toLowerCase();
    const matchedReels = reelsByPage.get(pNameKey) || [];
    const maxReelViews = matchedReels.reduce((mx, r) => Math.max(mx, Number(r.views || 0)), 0);
    const pseudoChrono = {
      reels: matchedReels,
      maturedViews: matchedReels.map(r => Number(r.views || 0)),
      maxEverViews: Math.max(Number(p.max_views || 0), maxReelViews)
    };
    const pEval = evaluatePageLifecycleStage(p, pseudoChrono, nowMs);

    // Contabiliza nas estatísticas de estágios 3, 4 e Graduadas
    if (pEval.stage === STAGES.STAGE_3_PAGE_SETTLING_72H.code) stageCounts.STAGE_3_PAGE_SETTLING_72H++;
    else if (pEval.stage === STAGES.STAGE_4_IGNITION_RAMP.code) stageCounts.STAGE_4_IGNITION_RAMP++;
    else if (pEval.stage === STAGES.GRADUATED_PRODUCTION.code) stageCounts.GRADUATED_PRODUCTION++;

    pagesState.push({
      id: p.id,
      name: p.name,
      conta: p.conta || '',
      profile_id: p.profile_browser_ID || p.incogniton_profile_id || '',
      warming_no_link: Boolean(p.warming_no_link),
      created_at: p.created_at || (p.created_timestamp ? new Date(p.created_timestamp).toISOString() : null),
      ...pEval
    });
  }

  const statePayload = {
    protocol_version: '4_STAGES_SCIENTIFIC_2026_V1',
    operator_chat_id: 'a9dafead-053f-474a-8403-2672642be65e',
    operator_role: 'CHAT 2 [4G] — Operador Único do Modem 4G (Postagem 4G + Esteira de Aquecimento 4G)',
    updated_at: nowIso,
    summary: stageCounts,
    accounts: accountsState,
    pages_in_settling_or_ignition: pagesState.filter(
      p => p.stage === STAGES.STAGE_3_PAGE_SETTLING_72H.code || p.stage === STAGES.STAGE_4_IGNITION_RAMP.code
    ),
    graduated_pages_count: pagesState.filter(p => p.stage === STAGES.GRADUATED_PRODUCTION.code).length,
    all_pages: pagesState
  };

  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(statePayload, null, 2), 'utf8');
  } catch (_) { }

  return statePayload;
}

/**
 * Imprime no terminal o diagnóstico completo e determinístico das 4 fases.
 */
function printLifecyclePipelineStatus() {
  const state = syncLifecycleState();
  const s = state.summary;

  console.log('\n================================================================================');
  console.log('🧬 ESTEIRA CIENTÍFICA DE AQUECIMENTO EM 4 FASES (ZERO-BAGUNÇA • CHAT 2 [4G])');
  console.log('================================================================================');
  console.log(`Estado Persistente: modules/account_warmup/warmup_pipeline_state.json`);
  console.log(`Atualizado em:      ${state.updated_at}`);
  console.log('--------------------------------------------------------------------------------');
  console.log(`📧 FASE 1 (STAGE_1_EMAIL_SOAK • 24h-48h + Newsletters):        ${String(s.STAGE_1_EMAIL_SOAK).padStart(2, '0')} conta(s)`);
  console.log(`🛡️ FASE 2 (STAGE_2_FB_PROFILE_COOKIE_FARM • 72h Perfil FB):    ${String(s.STAGE_2_FB_PROFILE_COOKIE_FARM).padStart(2, '0')} conta(s)`);
  console.log(`⏳ FASE 3 (STAGE_3_PAGE_SETTLING_72H • 72h Sem Vídeo):         ${String(s.STAGE_3_PAGE_SETTLING_72H).padStart(2, '0')} página(s)`);
  console.log(`🚀 FASE 4 (STAGE_4_IGNITION_RAMP • 1 Reel/dia até >=150v):     ${String(s.STAGE_4_IGNITION_RAMP).padStart(2, '0')} página(s)`);
  console.log(`🏆 GRADUADAS (GRADUATED_PRODUCTION • 2–3 Reels/dia Option A):  ${String(s.GRADUATED_PRODUCTION).padStart(2, '0')} página(s)`);
  console.log(`⚪ SLOTS VAZIOS (MultiZen C++ Prontos p/ Novos E-mails):        ${String(s.EMPTY_SLOT).padStart(2, '0')} vaga(s)`);
  if (s.BLOCKED_INVALID_EMAIL > 0) {
    console.log(`🚫 BLOQUEADAS (Domínio/Geo/Entropia Reprovados):               ${String(s.BLOCKED_INVALID_EMAIL).padStart(2, '0')} conta(s)`);
  }

  const activeAccounts = state.accounts.filter(a => a.stage !== 'EMPTY_SLOT');
  console.log('\n--------------------------------------------------------------------------------');
  console.log('📬 CONTAS ATIVAS NAS FASES 1 & 2 (E-MAIL SOAK ➔ FB COOKIE FARM 72H):');
  console.log('--------------------------------------------------------------------------------');
  if (activeAccounts.length === 0) {
    console.log('   (Nenhuma conta ativa no momento)');
  } else {
    activeAccounts.forEach((a, idx) => {
      const num = String(idx + 1).padStart(2, '0');
      const authTag = a.gmail_authenticated ? 'INBOX:OK' : 'INBOX:PENDENTE';
      const newsTag = `News:${a.newsletters_count ?? 0}/${a.required_newsletters ?? 10}`;
      const hrsTag = `Molho:${a.hours_elapsed ?? 0}h (faltam ${a.hours_remaining ?? 0}h)`;
      console.log(`   [${num}] ${a.email.padEnd(28)} | ${a.stage.padEnd(30)} | ${authTag} | ${newsTag} | ${hrsTag}`);
      if (a.next_action) {
        console.log(`        ↳ Próximo Passo: ${a.next_action}`);
      }
    });
  }

  console.log('\n--------------------------------------------------------------------------------');
  console.log('🌱 FAN PAGES NAS FASES 3 & 4 (SETTLING 72H SEM VÍDEO ➔ IGNIÇÃO 1 REEL/DIA):');
  console.log('--------------------------------------------------------------------------------');
  if (state.pages_in_settling_or_ignition.length === 0) {
    console.log('   (Nenhuma página em Fase 3 ou Fase 4 — todas as páginas ativas já graduadas)');
  } else {
    state.pages_in_settling_or_ignition.forEach((p, idx) => {
      const num = String(idx + 1).padStart(2, '0');
      const ctaTag = p.warming_no_link ? 'SEM_CTA' : 'CTA_YES';
      console.log(
        `   [${num}] ${String(p.name || '').padEnd(26)} | ${p.stage.padEnd(25)} | Quota: ${p.daily_reel_limit}/dia | MaxViews: ${String(p.max_views).padStart(3, ' ')} | Posts: ${p.total_posts} | ${ctaTag}`
      );
      if (p.reason) {
        console.log(`        ↳ Regra: ${p.reason}`);
      }
    });
  }
  console.log('================================================================================\n');
  return state;
}

module.exports = {
  STAGES,
  CHAMPION_IGNITION_FORMATS,
  STATE_FILE,
  WARMING_PIPELINE_FILE,
  ACTIVE_CREATION_SLOT_FILE,
  DISCARDED_GMAILS_ARCHIVE_FILE,
  VIRGIN_SLOT_IDS,
  readJsonSafe,
  loadPipeline,
  savePipeline,
  loadPipelineData: loadPipeline,
  savePipelineData: savePipeline,
  loadWarmingPipeline: loadPipeline,
  saveWarmingPipeline: savePipeline,
  resolveAccountFromPipeline,
  updateAccountInPipeline,
  getActiveCreationSlot,
  saveActiveCreationSlot,
  clearActiveCreationSlot,
  evaluateAccountLifecycleStage,
  evaluatePageLifecycleStage,
  syncLifecycleState,
  printLifecyclePipelineStatus
};
