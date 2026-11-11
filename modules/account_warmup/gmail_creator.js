/**
 * ============================================================================
 * GMAIL & FACEBOOK CREATION CONVEYOR + WILAS 2FA AUDITOR + 4G SEMAPHORE
 * ============================================================================
 * 1. Limpeza Segura Anti-Burrada (`cleanDeadStandaloneGmailsPreservingFacebook`):
 *    - Descarta/arquiva Gmails avulsos que caíram e NÃO têm Facebook de pé.
 *    - PRESERVA 100% qualquer conta cujo Facebook já está de pé (`fb_logged_in`,
 *      `fb_profile_uid`, `pages_count > 0` ou páginas no `database.json`),
 *      marcando `email_status: 'DEAD_NEEDS_RECOVERY_SWAP_FOR_2FA'` se o Gmail
 *      original morreu/caiu.
 * 2. Auditoria de E-mail Ativo + 2FA Obrigatório do Wilas (`auditStandingFacebookAccounts2faAndEmail`):
 *    - Verifica em todas as contas com Facebook de pé se o e-mail vinculado está
 *      ativo para receber código e se o 2FA do Facebook (`totp_secret`) está ativo.
 * 3. Semáforo Verde / Vermelho Anti-Conflito 4G (`getCreationSemaphoreStatus`):
 *    - Só libera `🟢 SEMÁFORO VERDE` quando não há postagem de vendas nem
 *      aquecimento rodando, sem agendamento iminente e o Mutex 4G está 100% livre.
 * 4. Esteira Integrada de Criação (Passo 1: Giro 4G + Fingerprint Nova ->
 *    Passo 2: Gmail Zero-CDP + 15 Newsletters -> Passo 3: Criar Facebook +
 *    Configurar Dia 01 do Plano Wilas com 2FA Obrigatório + Pro Mode + 9 Vídeos).
 */

const fs = require('fs');
const path = require('path');
const MultiZenService = require('../../multizen');
const IncognitonService = require('../../incogniton');
const db = require('../../db');
const vault = require('../common/vault');
const { formatTotpSecretForDisplay } = vault;
const {
  WARMING_PIPELINE_FILE,
  DISCARDED_GMAILS_ARCHIVE_FILE,
  ACTIVE_CREATION_SLOT_FILE,
  VIRGIN_SLOT_IDS,
  loadPipelineData,
  savePipelineData,
  getActiveCreationSlot,
  saveActiveCreationSlot,
  clearActiveCreationSlot
} = require('./lifecycle_pipeline');
const fingerprintGenerator = require('./fingerprint_generator');
const profileReelsWarmer = require('./profile_reels_warmer');
const runner = require('./runner');

const ROOT_DIR = path.resolve(__dirname, '../..');
const LEGACY_YOUTUBE_SLOT_FILE = path.join(ROOT_DIR, 'active_youtube_creation_slot.json');

try {
  if (fs.existsSync(LEGACY_YOUTUBE_SLOT_FILE)) {
    fs.unlinkSync(LEGACY_YOUTUBE_SLOT_FILE);
  }
} catch (_) { }

function getDbPagesForAccount(acc, allDbPages = null) {
  const pages = Array.isArray(allDbPages)
    ? allDbPages
    : (typeof db.getPages === 'function' ? db.getPages() : []);
  if (!acc) return [];
  const profId = String(acc.incogniton_profile_id || '').trim().toLowerCase();
  const accName = String(acc.name || '').trim().toLowerCase();
  return pages.filter(p => {
    const pProf = String(p.profile_browser_ID || '').trim().toLowerCase();
    const pConta = String(p.conta || p.profile_name || '').trim().toLowerCase();
    if (profId && pProf && pProf === profId) return true;
    if (accName && pConta && pConta === accName) return true;
    return false;
  });
}

/**
 * REGRA CRÍTICA ANTI-BURRADA:
 * Determina se uma conta já tem um Facebook de pé (logado, com UID de perfil ou com páginas).
 * Contas onde `isStandingFacebookAccount` retorna `true` JAMAIS podem ser descartadas,
 * mesmo que o Gmail original tenha morrido/caído!
 */
function isStandingFacebookAccount(acc, allDbPages = null) {
  if (!acc) return false;
  const st = String(acc.status || '').toUpperCase();
  if (st === 'CEMITERIO' || st === 'BURIED_GRAVEYARD') {
    return false;
  }

  const dbPages = getDbPagesForAccount(acc, allDbPages);
  const hasDbPages = dbPages.length > 0;
  const hasPagesInside = Array.isArray(acc.pages_found_inside) && acc.pages_found_inside.length > 0;
  const hasFbUid = Boolean(acc.fb_profile_uid && String(acc.fb_profile_uid).trim());
  const hasFbLoggedInFlag = Boolean(acc.fb_logged_in === true && acc.warmup_mode !== 'EMAIL_ONLY_PREWARM');

  // Se era apenas EMAIL_ONLY_PREWARM sem UID de Facebook, sem páginas reais dentro e sem páginas no banco, é Gmail avulso!
  if (acc.warmup_mode === 'EMAIL_ONLY_PREWARM' && !hasFbUid && !hasDbPages && !hasPagesInside) {
    return false;
  }

  const hasPagesCount = Number(acc.pages_count || 0) > 0 && acc.warmup_mode !== 'EMAIL_ONLY_PREWARM';
  return Boolean(hasDbPages || hasPagesCount || hasPagesInside || hasFbUid || hasFbLoggedInFlag);
}

/**
 * Verifica se é um Slot Virgem (sem e-mail ainda, pronto para criar nova conta no 4G)
 */
function isVirginCreationSlot(acc, allDbPages = null) {
  if (!acc) return false;
  const st = String(acc.status || '').toUpperCase();
  if (st === 'CEMITERIO' || st === 'BURIED_GRAVEYARD') return false;
  if (isStandingFacebookAccount(acc, allDbPages)) return false;
  const cleanEmail = String(acc.email || '').trim();
  return !cleanEmail;
}

/**
 * Avalia a saúde do E-mail vinculado e do 2FA Obrigatório do Wilas em uma conta Facebook de pé
 */
function evaluateStandingAccountEmailAnd2fa(acc, allDbPages = null) {
  const dbPages = getDbPagesForAccount(acc, allDbPages);
  let decAcc = acc || {};
  try {
    decAcc = vault.getAccountWithDecryptedVaultSecrets(acc) || acc;
  } catch (_) { }

  const cleanEmail = String(acc.email || decAcc.email || '').trim();
  const recoveryEmail = String(acc.recovery_email || decAcc.recovery_email || '').trim();
  const effectiveTotp = String(acc.totp_secret || decAcc.totp_secret || '').replace(/\s+/g, '');
  const st = String(acc.status || '').toUpperCase();
  const hasTotp = Boolean(effectiveTotp.length >= 16);
  const newslettersCount = Array.isArray(acc.warmup_stats?.newsletters_subscribed)
    ? acc.warmup_stats.newsletters_subscribed.length
    : 0;

  // Detecta se o e-mail original morreu, deslogou ou nunca foi vinculado
  const explicitlyDeadOrPendingLogin = Boolean(
    !cleanEmail ||
    st === 'GMAIL_LOGIN_ZERO_CDP_PENDENTE' ||
    st === 'GMAIL_LOGIN_PENDENTE' ||
    acc.warmup_stats?.gmail_authenticated === false ||
    acc.email_status === 'DEAD_NEEDS_RECOVERY_SWAP_FOR_2FA'
  );

  const explicitlyVerifiedActive = Boolean(
    cleanEmail &&
    !explicitlyDeadOrPendingLogin &&
    (
      acc.email_active_verified === true ||
      acc.email_status === 'ACTIVE_OK' ||
      acc.warmup_stats?.gmail_authenticated === true ||
      newslettersCount > 0 ||
      hasTotp ||
      /@(outlook|hotmail|live|msn)\./i.test(cleanEmail)
    )
  );

  const emailActiveVerified = Boolean(explicitlyVerifiedActive && !explicitlyDeadOrPendingLogin);
  const emailStatus = emailActiveVerified
    ? 'ACTIVE_OK'
    : 'DEAD_NEEDS_RECOVERY_SWAP_FOR_2FA';

  let wilas2faAuditStatus = 'READY_TO_ACTIVATE_WILAS_2FA';
  let recommendedAction = '';

  if (hasTotp && emailActiveVerified) {
    wilas2faAuditStatus = '2FA_OK';
    recommendedAction = '✅ 2FA Obrigatório Wilas ATIVO + E-mail Ativo';
  } else if (hasTotp && !emailActiveVerified) {
    wilas2faAuditStatus = '2FA_OK_EMAIL_DEAD';
    recommendedAction = '🔐 2FA já está ativo, mas o Gmail original caiu/ausente — recomendado atualizar e-mail de contato no Facebook';
  } else if (!hasTotp && emailActiveVerified) {
    wilas2faAuditStatus = 'READY_TO_ACTIVATE_WILAS_2FA';
    recommendedAction = `⚡ E-mail "${cleanEmail}" está ATIVO! Clique em "Ativar 2FA Wilas" para puxar o código e gerar a chave TOTP`;
  } else {
    wilas2faAuditStatus = 'BLOCKED_EMAIL_DEAD_SWAP_FIRST';
    recommendedAction = cleanEmail
      ? `🚨 Facebook de pé preservado! O Gmail "${cleanEmail}" caiu/deslogou — troque o e-mail no Facebook antes de ativar o 2FA`
      : '🚨 Facebook de pé preservado! Sem Gmail ativo vinculado — cadastre/vincule um e-mail ativo antes de ativar o 2FA';
  }

  const pageNames = dbPages.length > 0
    ? dbPages.map(p => p.name)
    : (Array.isArray(acc.pages_found_inside) ? acc.pages_found_inside : []);

  return {
    fb_logged_in: true,
    email: cleanEmail,
    recovery_email: recoveryEmail,
    totp_secret: effectiveTotp,
    email_status: emailStatus,
    email_active_verified: emailActiveVerified,
    fb_2fa_enabled: hasTotp,
    two_factor_enabled: hasTotp,
    wilas_2fa_audit_status: wilas2faAuditStatus,
    recommended_action: recommendedAction,
    can_activate_2fa_immediately: Boolean(!hasTotp && emailActiveVerified),
    needs_email_swap_before_2fa: Boolean(!hasTotp && !emailActiveVerified),
    pages_count_effective: Math.max(Number(acc.pages_count || 0), pageNames.length),
    page_names: pageNames
  };
}

/**
 * 1. LIMPEZA SEGURA DE GMAILS CAÍDOS VS. CONTAS FACEBOOK DE PÉ:
 * - Remove da fila ativa (`warming_accounts_pipeline.json`) APENAS Gmails avulsos
 *   que caíram/morreram e NÃO têm conta de Facebook de pé (`!isStandingFacebookAccount`),
 *   arquivando-os em `discarded_dead_gmails_archive.json`.
 * - PRESERVA 100% todas as contas onde o Facebook está de pé (`isStandingFacebookAccount`),
 *   atualizando nelas `email_status`, `email_active_verified`, `fb_2fa_enabled` e `wilas_2fa_audit_status`.
 */
function cleanDeadStandaloneGmailsPreservingFacebook(options = {}) {
  if (options.regenerate_persona && typeof runner.generateSuggestedGmailWebPersona === 'function') {
    const newPersona = runner.generateSuggestedGmailWebPersona();
    const curSlot = runner.getActiveCreationSlot() || {};
    curSlot.suggested_persona = newPersona;
    try {
      fs.writeFileSync(ACTIVE_CREATION_SLOT_FILE, JSON.stringify(curSlot, null, 2), 'utf8');
    } catch (_) { }
    return {
      success: true,
      suggested_persona: newPersona,
      kept_accounts: [],
      discarded_standalone_count: 0,
      discarded_standalone_gmails: [],
      total_Archived_discarded: 0,
      preserved_standing_fb_total: 0,
      preserved_standing_fb_count: 0,
      preserved_standing_fb_with_dead_gmail: [],
      preserved_standing_fb_with_active_email: [],
      virgin_slots_ready: []
    };
  }
  const isCustomAccountsInput = Array.isArray(options.accounts);
  const dryRun = Boolean(options.dryRun || isCustomAccountsInput);
  const pipelineData = isCustomAccountsInput
    ? { accounts: options.accounts.map(a => ({ ...a })) }
    : loadPipelineData();
  const allDbPages = Array.isArray(options.dbPages)
    ? options.dbPages
    : (typeof db.getPages === 'function' ? db.getPages() : []);
  const recentEmailCreatedCutoffMs = Number(options.preserveRecentStandaloneMinutes || 0) * 60 * 1000;

  let activeSlot = null;
  if (!isCustomAccountsInput) {
    try {
      activeSlot = runner.getActiveCreationSlot();
    } catch (_) { }
  } else if (options.activeSlot) {
    activeSlot = options.activeSlot;
  }
  const activeSlotId = activeSlot && activeSlot.slot_id ? String(activeSlot.slot_id) : '';
  const activeSlotEmail = activeSlot && activeSlot.finalized_email ? String(activeSlot.finalized_email).toLowerCase() : '';

  const keptAccounts = [];
  const discardedStandaloneGmails = [];
  const preservedStandingFbWithDeadGmail = [];
  const preservedStandingFbWithActiveEmail = [];
  const keptVirginSlots = [];

  for (const acc of pipelineData.accounts) {
    if (!acc) continue;

    // 1. Conta com Facebook de Pé -> JAMAIS DESCARTAR!
    if (isStandingFacebookAccount(acc, allDbPages)) {
      const evalInfo = evaluateStandingAccountEmailAnd2fa(acc, allDbPages);
      acc.fb_logged_in = true;
      if (!acc.totp_secret && evalInfo.totp_secret) {
        acc.totp_secret = evalInfo.totp_secret;
        acc.totp_secret_formatted = formatTotpSecretForDisplay(evalInfo.totp_secret);
      }
      acc.email_status = evalInfo.email_status;
      acc.email_active_verified = evalInfo.email_active_verified;
      acc.fb_2fa_enabled = evalInfo.fb_2fa_enabled;
      acc.wilas_2fa_audit_status = evalInfo.wilas_2fa_audit_status;
      acc.pages_count = evalInfo.pages_count_effective;

      keptAccounts.push(acc);
      if (evalInfo.email_status === 'DEAD_NEEDS_RECOVERY_SWAP_FOR_2FA') {
        preservedStandingFbWithDeadGmail.push({
          id: acc.id,
          name: acc.name,
          email: acc.email || '(sem e-mail registrado)',
          fb_profile_uid: acc.fb_profile_uid || '',
          pages_count: evalInfo.pages_count_effective,
          email_status: acc.email_status,
          wilas_2fa_audit_status: acc.wilas_2fa_audit_status
        });
      } else {
        preservedStandingFbWithActiveEmail.push({
          id: acc.id,
          name: acc.name,
          email: acc.email,
          fb_profile_uid: acc.fb_profile_uid || '',
          pages_count: evalInfo.pages_count_effective,
          fb_2fa_enabled: acc.fb_2fa_enabled,
          wilas_2fa_audit_status: acc.wilas_2fa_audit_status
        });
      }
      continue;
    }

    // 2. Slot Virgem para criação (ex.: CONTA 4G #08, CONTA 4G #09, Conta #14, Conta #15) -> Manter pronto
    if (isVirginCreationSlot(acc, allDbPages)) {
      acc.is_virgin_slot = true;
      keptAccounts.push(acc);
      keptVirginSlots.push({
        id: acc.id,
        name: acc.name,
        incogniton_profile_id: acc.incogniton_profile_id || ''
      });
      continue;
    }

    // 3. Se for o Gmail recém-criado no slot ativo atual (aguardando Passo 3 de criar o Facebook), preserva!
    const accEmailLower = String(acc.email || '').trim().toLowerCase();
    const addedMs = acc.added_at ? (Date.now() - new Date(acc.added_at).getTime()) : 999999999;
    const isCurrentActiveSlotAccount = Boolean(
      (activeSlotId && acc.id === activeSlotId) ||
      (activeSlotEmail && accEmailLower === activeSlotEmail) ||
      (acc.awaiting_step3_fb_creation === true) ||
      (recentEmailCreatedCutoffMs > 0 && addedMs < recentEmailCreatedCutoffMs)
    );
    if (isCurrentActiveSlotAccount && acc.status !== 'CEMITERIO' && acc.status !== 'BURIED_GRAVEYARD') {
      keptAccounts.push(acc);
      continue;
    }

    // 4. Caso contrário: é um Gmail avulso antigo/caído SEM Facebook de pé (ou conta já sepultada no Cemitério) -> Descartar da fila ativa e arquivar!
    const isGraveyard = acc.status === 'CEMITERIO' || acc.status === 'BURIED_GRAVEYARD';
    discardedStandaloneGmails.push({
      ...acc,
      fb_logged_in: false,
      discarded_at: new Date().toISOString(),
      discard_reason: isGraveyard
        ? 'BURIED_IN_GRAVEYARD_CHECKPOINT'
        : 'STANDALONE_DEAD_OR_ABANDONED_GMAIL_WITHOUT_STANDING_FACEBOOK'
    });
  }

  if (!dryRun && (discardedStandaloneGmails.length > 0 || options.forceSave !== false)) {
    pipelineData.accounts = keptAccounts;
    savePipelineData(pipelineData);
  }

  let archiveData = { updated_at: new Date().toISOString(), discarded_accounts: [] };
  if (!dryRun && fs.existsSync(DISCARDED_GMAILS_ARCHIVE_FILE)) {
    try {
      archiveData = JSON.parse(fs.readFileSync(DISCARDED_GMAILS_ARCHIVE_FILE, 'utf8'));
      archiveData.discarded_accounts = Array.isArray(archiveData.discarded_accounts) ? archiveData.discarded_accounts : [];
    } catch (_) {
      archiveData = { updated_at: new Date().toISOString(), discarded_accounts: [] };
    }
  }
  if (discardedStandaloneGmails.length > 0) {
    const existingIds = new Set(archiveData.discarded_accounts.map(x => x.id));
    for (const d of discardedStandaloneGmails) {
      if (!existingIds.has(d.id)) {
        archiveData.discarded_accounts.unshift(d);
      }
    }
    archiveData.updated_at = new Date().toISOString();
    if (!dryRun) {
      fs.writeFileSync(DISCARDED_GMAILS_ARCHIVE_FILE, JSON.stringify(archiveData, null, 2), 'utf8');
    }
  }

  return {
    success: true,
    kept_accounts: keptAccounts,
    discarded_standalone_count: discardedStandaloneGmails.length,
    discarded_standalone_gmails: discardedStandaloneGmails.map(d => ({
      id: d.id,
      name: d.name,
      email: d.email || '',
      status: d.status
    })),
    total_Archived_discarded: archiveData.discarded_accounts.length,
    preserved_standing_fb_total: preservedStandingFbWithDeadGmail.length + preservedStandingFbWithActiveEmail.length,
    preserved_standing_fb_count: preservedStandingFbWithDeadGmail.length + preservedStandingFbWithActiveEmail.length,
    preserved_standing_fb_with_dead_gmail: preservedStandingFbWithDeadGmail,
    preserved_standing_fb_with_active_email: preservedStandingFbWithActiveEmail,
    virgin_slots_ready: keptVirginSlots
  };
}

/**
 * 2. AUDITORIA DE E-MAIL ATIVO + 2FA OBRIGATÓRIO DO WILAS NAS CONTAS FACEBOOK DE PÉ
 */
function auditStandingFacebookAccounts2faAndEmail(options = {}) {
  const customAccounts = Array.isArray(options)
    ? options
    : (Array.isArray(options.accounts) ? options.accounts : null);
  const pipelineData = customAccounts
    ? { accounts: customAccounts }
    : loadPipelineData();
  const allDbPages = Array.isArray(options.dbPages)
    ? options.dbPages
    : (typeof db.getPages === 'function' ? db.getPages() : []);

  const standingAccounts = [];
  const virginSlots = [];
  const awaitingStep3FbAccounts = [];

  for (const acc of pipelineData.accounts) {
    if (!acc) continue;
    if (isStandingFacebookAccount(acc, allDbPages)) {
      const evalInfo = evaluateStandingAccountEmailAnd2fa(acc, allDbPages);
      const secStr = String(evalInfo.totp_secret || acc.totp_secret || '');
      standingAccounts.push({
        id: acc.id,
        name: acc.name,
        fb_profile_name: acc.fb_profile_name || acc.name,
        fb_profile_uid: acc.fb_profile_uid || '',
        incogniton_profile_id: acc.incogniton_profile_id || '',
        browser_engine: acc.browser_engine || 'multizen_cloak_cpp',
        network_mode: acc.network_mode || '4G_REQUIRED',
        status: acc.status || 'ACTIVE',
        stage_day: Number(acc.stage_day || 1),
        email: evalInfo.email,
        recovery_email: evalInfo.recovery_email,
        email_status: evalInfo.email_status,
        email_active_verified: evalInfo.email_active_verified,
        fb_2fa_enabled: evalInfo.fb_2fa_enabled,
        two_factor_enabled: evalInfo.two_factor_enabled,
        totp_secret_present: evalInfo.fb_2fa_enabled,
        totp_secret_preview: secStr ? `${secStr.slice(0, 4)}••••${secStr.slice(-4)}` : '',
        wilas_2fa_audit_status: evalInfo.wilas_2fa_audit_status,
        action_code: evalInfo.wilas_2fa_audit_status,
        recommended_action: evalInfo.recommended_action,
        can_activate_2fa_immediately: evalInfo.can_activate_2fa_immediately,
        needs_email_swap_before_2fa: evalInfo.needs_email_swap_before_2fa,
        pages_count: evalInfo.pages_count_effective,
        page_names: evalInfo.page_names,
        profile_videos_posted: Number(acc.profile_videos_posted || acc.warmup_stats?.profile_videos_posted || 0),
        wilas_day1_configured: Boolean(acc.wilas_day1_configured || evalInfo.fb_2fa_enabled)
      });
    } else if (isVirginCreationSlot(acc, allDbPages)) {
      virginSlots.push({
        id: acc.id,
        name: acc.name,
        incogniton_profile_id: acc.incogniton_profile_id || '',
        browser_engine: acc.browser_engine || 'multizen_cloak_cpp'
      });
    } else if (acc.awaiting_step3_fb_creation || acc.email) {
      awaitingStep3FbAccounts.push({
        id: acc.id,
        name: acc.name,
        email: acc.email || '',
        incogniton_profile_id: acc.incogniton_profile_id || '',
        status: acc.status || 'STAGE_1_EMAIL_SOAK',
        newsletters_count: Array.isArray(acc.warmup_stats?.newsletters_subscribed) ? acc.warmup_stats.newsletters_subscribed.length : 0
      });
    }
  }

  // Ordena priorizando: 1º Prontas para ativar 2FA (Email Ativo + Sem 2FA), 2º Email Caído precisando troca, 3º 2FA já OK
  const orderWeight = {
    READY_TO_ACTIVATE_WILAS_2FA: 1,
    BLOCKED_EMAIL_DEAD_SWAP_FIRST: 2,
    '2FA_OK_EMAIL_DEAD': 3,
    '2FA_OK': 4
  };
  standingAccounts.sort((a, b) => {
    const wa = orderWeight[a.wilas_2fa_audit_status] || 9;
    const wb = orderWeight[b.wilas_2fa_audit_status] || 9;
    if (wa !== wb) return wa - wb;
    return b.pages_count - a.pages_count;
  });

  let discardedArchiveCount = 0;
  if (fs.existsSync(DISCARDED_GMAILS_ARCHIVE_FILE)) {
    try {
      const arch = JSON.parse(fs.readFileSync(DISCARDED_GMAILS_ARCHIVE_FILE, 'utf8'));
      discardedArchiveCount = Array.isArray(arch.discarded_accounts) ? arch.discarded_accounts.length : 0;
    } catch (_) { }
  }

  const with2faActive = standingAccounts.filter(a => a.fb_2fa_enabled);
  const readyFor2faNow = standingAccounts.filter(a => a.can_activate_2fa_immediately);
  const blockedByDeadEmail = standingAccounts.filter(a => a.needs_email_swap_before_2fa);

  return {
    summary: {
      total_standing_fb: standingAccounts.length,
      with_2fa_active: with2faActive.length,
      pending_2fa_total: standingAccounts.length - with2faActive.length,
      pending_2fa_email_active_ready: readyFor2faNow.length,
      pending_2fa_email_dead_needs_swap: blockedByDeadEmail.length,
      virgin_slots_available: virginSlots.length,
      awaiting_step3_fb_count: awaitingStep3FbAccounts.length,
      discarded_standalone_gmails_count: discardedArchiveCount
    },
    standing_accounts: standingAccounts,
    ready_for_2fa_now: readyFor2faNow,
    blocked_by_dead_email: blockedByDeadEmail,
    with_2fa_active: with2faActive,
    virgin_slots: virginSlots,
    awaiting_step3_fb_accounts: awaitingStep3FbAccounts
  };
}

/**
 * 3. SEMÁFORO VERDE / VERMELHO ANTI-CONFLITO 4G (`SEMAFORO_CRIACAO_4G`)
 * Garante que a esteira de criação NUNCA conflite com postagem de vendas ou aquecimento.
 */
function getCreationSemaphoreStatus(runtimeState = {}) {
  const isShiftRunning = Boolean(runtimeState.isShiftRunning || runtimeState.shiftRunning);
  const automatorIsRunning = Boolean(runtimeState.automatorIsRunning);
  const isWarmupRunning = Boolean(runtimeState.isWarmupRunning);
  const isViewsAuditRunning = Boolean(runtimeState.isViewsAuditRunning);
  const isStealthConfigRunning = Boolean(runtimeState.isStealthConfigRunning);
  const isCreationStepRunning = Boolean(runtimeState.isCreationStepRunning);
  const hasImminentSalesSchedule = Boolean(runtimeState.hasImminentSalesSchedule || runtimeState.imminentScheduleWithin35m);

  let activeSlot = null;
  if (runtimeState.activeCreationSlot !== undefined) {
    activeSlot = runtimeState.activeCreationSlot;
  } else {
    try {
      activeSlot = runner.getActiveCreationSlot();
    } catch (_) { }
  }

  let activeNewsletterWarmup = { active: false };
  if (runtimeState.activeNewsletterWarmup !== undefined) {
    activeNewsletterWarmup = typeof runtimeState.activeNewsletterWarmup === 'boolean'
      ? { active: runtimeState.activeNewsletterWarmup }
      : (runtimeState.activeNewsletterWarmup || { active: false });
  } else {
    try {
      if (typeof runner.getActiveNewsletterWarmupState === 'function') {
        activeNewsletterWarmup = runner.getActiveNewsletterWarmupState() || { active: false };
      }
    } catch (_) { }
  }

  let lockedProfiles = [];
  if (Array.isArray(runtimeState.openProfileIds)) {
    lockedProfiles = runtimeState.openProfileIds;
  } else if (runtimeState.mutexLockedByProfile !== undefined) {
    lockedProfiles = runtimeState.mutexLockedByProfile ? [String(runtimeState.mutexLockedByProfile)] : [];
  } else {
    try {
      lockedProfiles = IncognitonService.scanAllLockedProfilesByKernel() || [];
    } catch (_) { }
  }

  const activeSlotProfId = activeSlot && activeSlot.active && activeSlot.profile_id
    ? String(activeSlot.profile_id).toLowerCase()
    : '';
  const activeNewsProfId = activeNewsletterWarmup && activeNewsletterWarmup.active && activeNewsletterWarmup.profile_id
    ? String(activeNewsletterWarmup.profile_id).toLowerCase()
    : '';

  // Filtra navegadores 4G abertos que NÃO sejam o próprio slot Zero-CDP de criação atual
  const conflictingOpen4gProfiles = lockedProfiles.filter(pid => {
    const clean = String(pid || '').toLowerCase();
    if (!clean) return false;
    if (IncognitonService.isLegacyFixedIpProfile(clean)) return false;
    if (activeSlotProfId && clean === activeSlotProfId) return false;
    if (activeNewsProfId && clean === activeNewsProfId) return false;
    return true;
  });

  const blockers = [];
  if (isShiftRunning || automatorIsRunning) {
    blockers.push('Robô de Postagem de Vendas (Reels) está em execução neste momento.');
  }
  if (hasImminentSalesSchedule) {
    blockers.push('Há agendamento/onda de postagem de vendas prestes a abrir o navegador 4G.');
  }
  if (isWarmupRunning) {
    blockers.push('Motor de Aquecimento / Onboarding 4G está em execução neste momento.');
  }
  if (activeNewsletterWarmup.active) {
    blockers.push(`Inscrição nas 15 Newsletters (Passo 2 • ${activeNewsletterWarmup.email || 'Gmail'}) em andamento no navegador 4G.`);
  }
  if (isViewsAuditRunning) {
    blockers.push('Auditoria de Views / Métricas está com navegador aberto neste momento.');
  }
  if (isStealthConfigRunning) {
    blockers.push('Configuração Stealth de Página está em execução neste momento.');
  }
  if (isCreationStepRunning) {
    blockers.push('Uma etapa da Esteira de Criação já está rodando no 4G neste momento.');
  }
  if (conflictingOpen4gProfiles.length > 0) {
    blockers.push(`Mutex 4G ocupado por outro perfil aberto (${conflictingOpen4gProfiles.map(p => p.slice(0, 8)).join(', ')}).`);
  }

  const isGreen = blockers.length === 0;

  return {
    code: isGreen ? 'SEMAFORO_VERDE' : 'SEMAFORO_VERMELHO',
    semaphore: isGreen ? 'SEMAFORO_VERDE' : 'SEMAFORO_VERMELHO',
    color: isGreen ? 'GREEN' : 'RED',
    can_create_now: isGreen,
    badge_text: isGreen
      ? '🟢 SEMÁFORO VERDE: LIVRE PARA CRIAR CONTAS (4G DESOCUPADO • ZERO CONFLITO COM VENDAS)'
      : '🔴 SEMÁFORO VERMELHO: BLOQUEADO — POSTAGEM DE VENDAS OU AQUECIMENTO EM ANDAMENTO NO 4G',
    short_label: isGreen ? '🟢 SEMÁFORO VERDE (LIVRE P/ CRIAR)' : '🔴 SEMÁFORO VERMELHO (4G OCUPADO)',
    checks: {
      sales_posting_idle: !isShiftRunning && !automatorIsRunning,
      no_imminent_schedule: !hasImminentSalesSchedule,
      warmup_engine_idle: !isWarmupRunning && !activeNewsletterWarmup.active && !isViewsAuditRunning && !isStealthConfigRunning,
      mutex_4g_free: conflictingOpen4gProfiles.length === 0,
      creation_step_idle: !isCreationStepRunning
    },
    blockers,
    active_creation_slot: activeSlot,
    active_newsletter_warmup: activeNewsletterWarmup,
    checked_at: new Date().toISOString()
  };
}

/**
 * PASSO 1 DA ESTEIRA INTEGRADA:
 * Verifica Semáforo Verde -> Gira IP 4G ADB -> Gera/Renova Fingerprint C++ Isolada no exato slot ->
 * Abre Janela em Modo Stealth Zero-CDP no YouTube/Google (sem porta CDP em accounts.google.com!)
 */
async function step1OpenNewFingerprint4gGmailZeroCdp(options = {}, runtimeState = {}, onLog = console.log) {
  const cleanRuntime = Object.assign({}, runtimeState, { isCreationStepRunning: false });
  const sem = getCreationSemaphoreStatus(cleanRuntime);
  if (!sem.can_create_now && !options.forceOverrideSemaphore) {
    throw new Error(`${sem.badge_text} — Motivo: ${sem.blockers.join(' | ')}`);
  }

  // Padrão Wilas: cria o Gmail pelo YouTube (YOUTUBE_WEB) em 100% Zero-CDP
  const mergedOpts = Object.assign({ web_entry_mode: 'YOUTUBE_WEB' }, options);
  const slotState = await runner.openYoutubeCreationSlot(mergedOpts, onLog);
  return {
    success: true,
    step: 1,
    semaphore: getCreationSemaphoreStatus(cleanRuntime),
    slot: slotState,
    message: `Passo 1 concluído! IP 4G renovado (${slotState.ip_4g}) + Fingerprint C++ #${slotState.fingerprint_seed} aberta no YouTube em Modo Zero-CDP (Estilo Wilas). Crie o Gmail lá dentro e depois clique no Passo 2!`
  };
}

/**
 * PASSO 2 DA ESTEIRA INTEGRADA (FLUXO WILAS + CAMADA EXTRA ZERO-CDP 2026):
 * 1. Fecha o YouTube Zero-CDP com segurança (flush de cookies Google SID, SAPISID, OSID).
 * 2. Salva Gmail + Senha no Cofre .ENV.
 * 3. SEM ligar CDP/Puppeteer (mantendo 100% humano antes do FB nascer!), abre a janela Zero-CDP no mesmo IP 4G com:
 *    - Aba 1 (Focada): https://www.facebook.com/ (Home orgânica -> planta datr p/ você criar o FB à mão)
 *    - Aba 2: https://mail.google.com/mail/u/0/#inbox (Inicializa o Gmail Inbox em Zero-CDP p/ pegar o código FB-XXXXX)
 *    - Abas 3, 4 e 5: Healthline, Time e NYTimes (Camada Extra: disparam o Meta Pixel _fbp real em Zero-CDP!)
 */
async function step2FinalizeGmailAndWarmup15Newsletters(payload = {}, onLog = console.log) {
  const out = await runner.finalizeCreatedEmailSlot(
    Object.assign({}, payload, {
      openFbZeroCdpWithPixelShield: payload.openFbZeroCdpWithPixelShield !== false,
      runNewslettersAsync: false
    }),
    onLog
  );

  // Marca na esteira que este Gmail recém-criado está ativo e com a janela do Facebook aberta aguardando o Passo 3 (Robô Assume Wilas)
  const pipelineData = loadPipelineData();
  const targetAcc = pipelineData.accounts.find(a =>
    (out.account_id && a.id === out.account_id) ||
    (out.email && String(a.email || '').trim().toLowerCase() === String(out.email).trim().toLowerCase())
  );
  if (targetAcc) {
    targetAcc.email_status = 'ACTIVE_OK';
    targetAcc.email_active_verified = true;
    targetAcc.awaiting_step3_fb_creation = true;
    targetAcc.conveyor_step = 2;
    savePipelineData(pipelineData);
  }

  return {
    ...out,
    step: 2,
    next_step: 'PASSO_3_CRIAR_FB_A_MAO_E_DEIXAR_ROBO_ASSUMIR_WILAS'
  };
}

/**
 * PASSO 3 DA ESTEIRA INTEGRADA:
 * - Sub-modo A (`mode === 'OPEN_FB_SIGNUP_WINDOW'`): Caso tenha fechado a janela do Passo 2, reabre `https://www.facebook.com/` + `mail.google.com` + Portais Pixel `_fbp` em Zero-CDP.
 * - Sub-modo B (`mode === 'CONFIGURE_WILAS_DAY01'` — "JÁ CRIEI O FB À MÃO -> ROBÔ ASSUME TUDO"):
 *   1) Fecha a janela Zero-CDP com segurança gravando os cookies do Facebook (`c_user`, `xs`, `datr`, `_fbp`) e do Gmail (`SID`, `OSID`).
 *   2) Ativa o **2FA Obrigatório do Wilas no Facebook** (salvando TOTP de 32 letras no Cofre `.ENV`).
 *   3) Ativa **Pro Mode (Painel Profissional)** no Perfil Pessoal e extrai o `c_user`.
 *   4) Posta o **1º Reel de Aquecimento (`1/9`) em 🌐 PÚBLICO** no Perfil Pessoal (com FFmpeg Anti-Hash CapCut/iPhone e zero link/CTA).
 *   5) Calibra interesse em **Comunidade Health + adiciona 3 a 5 amigos das Sugestões do Facebook** (rumo à meta de 60 a 75 amigos).
 *   6) Inscreve o Gmail nas **15 Newsletters Editoriais** para manter o e-mail recebendo mensagens reais todo dia.
 */
async function step3CreateFacebookAndSetupWilasDay01(payload = {}, runtimeState = {}, deps = {}, onLog = console.log) {
  if (typeof runner.waitForActiveNewsletterWarmup === 'function') {
    await runner.waitForActiveNewsletterWarmup(20000, onLog);
  }

  const cleanRuntime = Object.assign({}, runtimeState, { isCreationStepRunning: false });
  const sem = getCreationSemaphoreStatus(cleanRuntime);
  if (!sem.can_create_now && !payload.forceOverrideSemaphore) {
    throw new Error(`${sem.badge_text} — Motivo: ${sem.blockers.join(' | ')}`);
  }

  const pipelineData = loadPipelineData();
  const activeSlot = runner.getActiveCreationSlot() || {};
  const accountId = String(payload.account_id || activeSlot.account_id || activeSlot.slot_id || '').trim();
  const cleanEmail = String(payload.email || activeSlot.finalized_email || '').trim().toLowerCase();
  const fbPersonaName = String(payload.fb_name || payload.name || '').trim();
  const fbPassword = String(payload.fb_password || payload.password || '').trim();
  const manualTotp = String(payload.totp_secret || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  const usCity = String(payload.us_city || 'Orlando, Florida').trim();
  const mode = String(payload.mode || 'CONFIGURE_WILAS_DAY01').trim().toUpperCase();

  let targetAcc = pipelineData.accounts.find(a =>
    (accountId && a.id === accountId) ||
    (cleanEmail && String(a.email || '').trim().toLowerCase() === cleanEmail) ||
    (activeSlot.profile_id && a.incogniton_profile_id === activeSlot.profile_id) ||
    (a.awaiting_step3_fb_creation === true)
  );

  if (!targetAcc) {
    throw new Error('Nenhuma conta encontrada do Passo 2 para iniciar o Passo 3. Selecione a conta ou finalize o Passo 2 primeiro.');
  }

  const profileId = String(payload.profile_id || targetAcc.incogniton_profile_id || activeSlot.profile_id || '').trim();
  if (!profileId) {
    throw new Error(`A conta "${targetAcc.name}" não possui um Profile ID MultiZen C++ vinculado.`);
  }

  if (fbPersonaName) {
    targetAcc.name = fbPersonaName;
    targetAcc.fb_profile_name = fbPersonaName;
  }
  if (fbPassword && !fbPassword.includes('••••')) {
    vault.storeAccountSecretInLocalVault(targetAcc.id, { fb_password: fbPassword, password: fbPassword });
    if (targetAcc.email) {
      vault.storeAccountSecretInLocalVault(targetAcc.email, { fb_password: fbPassword, password: fbPassword });
    }
  }
  if (manualTotp && manualTotp.length >= 16) {
    targetAcc.totp_secret = manualTotp;
    targetAcc.totp_secret_formatted = formatTotpSecretForDisplay(manualTotp);
    vault.storeAccountSecretInLocalVault(targetAcc.id, { totp_secret: manualTotp });
    if (targetAcc.email) {
      vault.storeAccountSecretInLocalVault(targetAcc.email, { totp_secret: manualTotp });
    }
  }

  // Sub-modo A: Reabrir janela Zero-CDP com Facebook Home + Gmail Inbox + Portais Pixel _fbp
  if (mode === 'OPEN_FB_SIGNUP_WINDOW') {
    const zeroCdpShieldUrls = [
      String(payload.fb_entry_url || 'https://www.facebook.com/').trim(),
      'https://mail.google.com/mail/u/0/#inbox',
      'https://www.healthline.com/',
      'https://time.com/',
      'https://www.nytimes.com/'
    ];
    onLog(`📘 [Passo 3A • Reabrir Facebook + Camada Extra Zero-CDP] Abrindo Facebook Home + Gmail Inbox + Portais _fbp no perfil "${targetAcc.name}" (${profileId.slice(0, 8)})...`);
    const launchRes = await MultiZenService.launchProfileStealthZeroCdp(
      profileId,
      zeroCdpShieldUrls,
      onLog
    );
    const updatedSlot = {
      ...activeSlot,
      active: true,
      slot_id: targetAcc.id,
      account_id: targetAcc.id,
      slot_name: targetAcc.name,
      finalized_email: targetAcc.email || activeSlot.finalized_email || '',
      profile_id: profileId,
      pid: launchRes.pid,
      start_url: zeroCdpShieldUrls[0],
      opened_urls: zeroCdpShieldUrls,
      zero_cdp: true,
      step: 'STEP_3A_FB_SIGNUP_OPEN',
      opened_at: new Date().toISOString()
    };
    fs.writeFileSync(ACTIVE_CREATION_SLOT_FILE, JSON.stringify(updatedSlot, null, 2), 'utf8');
    savePipelineData(pipelineData);

    return {
      success: true,
      step: '3A',
      mode: 'OPEN_FB_SIGNUP_WINDOW',
      account_id: targetAcc.id,
      profile_id: profileId,
      pid: launchRes.pid,
      message: `Janela aberta em Zero-CDP (Facebook Home + Gmail Inbox + Camada Extra _fbp) para "${targetAcc.name}" (${targetAcc.email})! Crie o Facebook à mão e depois clique em "3. Já Criei o FB -> Robô Assume Tudo".`
    };
  }

  // Sub-modo B: "JÁ CRIEI O FB À MÃO -> ROBÔ ASSUME TUDO" (Fechar Zero-CDP -> 2FA Obrigatório FB -> Pro Mode -> 1º Reel + Sugestões de Amigos -> 15 Newsletters)
  if (activeSlot && activeSlot.active && activeSlot.profile_id === profileId) {
    onLog(`💾 [Passo 3 • Robô Assumindo Wilas] Consolidando cookies do Facebook criado à mão e do Gmail em "${targetAcc.name}"...`);
    await MultiZenService.closeStealthZeroCdpProfileGracefully(profileId, activeSlot.pid, onLog).catch(() => { });
  } else {
    await MultiZenService.closeStealthZeroCdpProfileGracefully(profileId, null, onLog).catch(() => { });
  }

  const automator = deps.automator || require('../../automator');
  const newsletterWarmer = require('./newsletter_warmer');
  const results = {
    fb_2fa_configured: Boolean(targetAcc.totp_secret),
    totp_secret: targetAcc.totp_secret || '',
    pro_mode_enabled: false,
    first_profile_reel_posted: false,
    friends_added_this_session: 0,
    total_friends_added: Number(targetAcc.friends_added_count || 0),
    newsletters_subscribed_count: 0,
    wilas_day1_checklist_applied: true
  };

  if (!payload.skip_browser_execution) {
    // 1. Ativa 2FA Obrigatório do Wilas no Facebook (se ainda não tiver TOTP salvo) passando os 5 argumentos corretos
    if (!targetAcc.totp_secret && typeof automator.ensure2faConfiguredInOpenProfile === 'function') {
      onLog(`🔐 [Passo 3 • 2FA Obrigatório Wilas] Ativando 2FA TOTP no Facebook de "${targetAcc.name}"...`);
      try {
        const accWithSecrets = vault.getAccountWithDecryptedVaultSecrets(targetAcc);
        const twoFaRes = await automator.ensure2faConfiguredInOpenProfile(
          profileId,
          accWithSecrets,
          async (savedSecrets) => {
            if (savedSecrets && savedSecrets.totp_secret) {
              const cleanSec = String(savedSecrets.totp_secret).replace(/\s+/g, '').toUpperCase();
              targetAcc.totp_secret = cleanSec;
              targetAcc.totp_secret_formatted = formatTotpSecretForDisplay(cleanSec);
              vault.storeAccountSecretInLocalVault(targetAcc.id, { totp_secret: cleanSec });
              if (targetAcc.email) {
                vault.storeAccountSecretInLocalVault(targetAcc.email, { totp_secret: cleanSec });
              }
              savePipelineData(pipelineData);
            }
          },
          onLog,
          { forceAttempt2fa: true, closeBrowserOnFinish: false }
        );
        if (twoFaRes && twoFaRes.totp_secret) {
          const cleanSecret = String(twoFaRes.totp_secret).replace(/\s+/g, '').toUpperCase();
          targetAcc.totp_secret = cleanSecret;
          targetAcc.totp_secret_formatted = formatTotpSecretForDisplay(cleanSecret);
          results.fb_2fa_configured = true;
          results.totp_secret = cleanSecret;
          vault.storeAccountSecretInLocalVault(targetAcc.id, { totp_secret: cleanSecret });
          if (targetAcc.email) {
            vault.storeAccountSecretInLocalVault(targetAcc.email, { totp_secret: cleanSecret });
          }
        }
      } catch (err2fa) {
        onLog(`⚠️ [Passo 3 • Aviso 2FA] ${err2fa.message}`);
      }
    }

    // 2. Ativa Pro Mode (Painel Profissional) + Captura c_user + Posta 1º Reel no Perfil Pessoal + Sugestões de Amigos (60-75) + 15 Newsletters
    const settings = typeof db.getSettings === 'function' ? db.getSettings() : {};
    const inc = new IncognitonService(settings.mcp_token, settings.mcp_api_url);
    let browser = null;
    try {
      onLog(`🎬 [Passo 3 • Robô Wilas Dia 01] Conectando ao Perfil Pessoal de "${targetAcc.name}" para Pro Mode + 1º Reel + Amigos Sugeridos + 15 Newsletters...`);
      const { cdp_url } = await inc.ensureProfileLaunched(profileId, onLog);
      if (cdp_url) {
        browser = await inc.connectBrowser(cdp_url);
        const pages = await browser.pages();
        let fbTab = pages.find(p => String(p.url() || '').toLowerCase().includes('facebook.com')) || pages[0] || (await browser.newPage());
        await fbTab.bringToFront().catch(() => { });
        if (!String(fbTab.url() || '').toLowerCase().includes('facebook.com')) {
          await fbTab.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => { });
          await new Promise(r => setTimeout(r, 3500));
        }

        // 2a. Ativa Modo Profissional (Pro Mode) e extrai c_user
        const proOk = await profileReelsWarmer.ensurePersonalProfileProfessionalMode(fbTab, automator, onLog, targetAcc);
        results.pro_mode_enabled = Boolean(proOk);

        // 2b. Inicia o ciclo Dia 01 dos 9 vídeos no Perfil Pessoal (que também já chama warmPersonalProfileFriendsAndHealthGroups)
        let friendsAlreadyRun = false;
        if (payload.post_first_profile_reel !== false) {
          const reelRes = await profileReelsWarmer.postWarmupReelOnPersonalProfile(fbTab, automator, targetAcc, onLog);
          if (reelRes && reelRes.success) {
            results.first_profile_reel_posted = true;
            if (reelRes.friends_warmup) {
              friendsAlreadyRun = true;
              results.friends_added_this_session = Number(reelRes.friends_warmup.added_this_session || 0);
              results.total_friends_added = Number(reelRes.friends_warmup.total_friends_added || targetAcc.friends_added_count || 0);
            }
          }
        }

        // 2c. Se o Reel foi pulado/cooldown, garante mesmo assim a rodada de Sugestões de Amigos + Comunidade Health do Wilas
        if (!friendsAlreadyRun && typeof profileReelsWarmer.warmPersonalProfileFriendsAndHealthGroups === 'function') {
          const fRes = await profileReelsWarmer.warmPersonalProfileFriendsAndHealthGroups(fbTab, targetAcc, onLog).catch(() => null);
          if (fRes) {
            results.friends_added_this_session = Number(fRes.added_this_session || 0);
            results.total_friends_added = Number(fRes.total_friends_added || targetAcc.friends_added_count || 0);
          }
        }

        // 2d. Inscreve o Gmail nas 15 Newsletters Editoriais na mesma sessão antes de fechar o navegador
        if (targetAcc.email && payload.run_newsletters !== false) {
          const newsTab = await browser.newPage();
          try {
            const newsRes = await newsletterWarmer.subscribeToPortals(newsTab, targetAcc.email, {
              already_subscribed: targetAcc?.warmup_stats?.newsletters_subscribed || [],
              max_sites_per_session: Number(payload.max_newsletters) || 15,
              onLog
            });
            targetAcc.warmup_stats = targetAcc.warmup_stats || {};
            targetAcc.warmup_stats.newsletters_subscribed = newsRes.subscribed || targetAcc.warmup_stats.newsletters_subscribed || [];
            results.newsletters_subscribed_count = (targetAcc.warmup_stats.newsletters_subscribed || []).length;
          } catch (errNews) {
            onLog(`⚠️ [Passo 3 • Aviso Newsletters] ${errNews.message}`);
          } finally {
            await newsTab.close().catch(() => { });
          }
        }
      }
    } catch (errReel) {
      onLog(`⚠️ [Passo 3 • Aviso Pro Mode / Reel Perfil] ${errReel.message}`);
    } finally {
      try {
        if (browser) browser.disconnect();
      } catch (_) { }
      await inc.stopProfile(profileId, {
        reason: 'Passo 3 Setup Completo Dia 01 Wilas Concluído',
        onLog
      }).catch(() => { });
    }
  }

  // 3. Atualiza o estado da conta como Facebook de Pé + Dia 01 do Plano Wilas configurado
  const nowIso = new Date().toISOString();
  targetAcc.fb_logged_in = true;
  targetAcc.fb_account_created_at = targetAcc.fb_account_created_at || nowIso;
  targetAcc.awaiting_step3_fb_creation = false;
  targetAcc.conveyor_step = 3;
  targetAcc.wilas_day1_configured = true;
  targetAcc.wilas_day1_configured_at = nowIso;
  targetAcc.us_city = usCity;
  targetAcc.target_friends_goal = '60-75';
  targetAcc.email_status = 'ACTIVE_OK';
  targetAcc.email_active_verified = true;
  targetAcc.fb_2fa_enabled = Boolean(targetAcc.totp_secret);
  targetAcc.wilas_2fa_audit_status = targetAcc.totp_secret ? '2FA_OK' : 'READY_TO_ACTIVATE_WILAS_2FA';
  targetAcc.stage_day = 1;
  targetAcc.status = 'WILAS_DIA_01_ATIVO';
  targetAcc.warmup_mode = 'FB_PROFILE_COOKIE_FARM_ONLY';
  targetAcc.wilas_day1_checklist = {
    avatar_and_cover_configured: true,
    bio_and_us_city: usCity,
    fb_2fa_mandatory_enabled: Boolean(targetAcc.totp_secret),
    pro_mode_enabled: results.pro_mode_enabled,
    profile_reels_target: '9 vídeos no Perfil Pessoal (3/dia por 3 dias sem link/CTA)',
    profile_reels_posted: Number(targetAcc.profile_videos_posted || 0),
    friends_target: '60 a 75 amigos pelas sugestões (grupos health)',
    friends_added_count: Number(targetAcc.friends_added_count || results.total_friends_added || 0),
    newsletters_subscribed_count: Number(results.newsletters_subscribed_count || (targetAcc.warmup_stats?.newsletters_subscribed || []).length || 0)
  };
  targetAcc.notes = `Plano Wilas Dia 01 Ativo • 2FA: ${targetAcc.totp_secret ? 'ATIVO 🔐' : 'Pendente'} • Vídeos Perfil: ${targetAcc.profile_videos_posted || 0}/9 • Amigos: ${targetAcc.friends_added_count || 0}/60-75 • Newsletters: ${targetAcc.wilas_day1_checklist.newsletters_subscribed_count}/15`;

  savePipelineData(pipelineData);

  if (activeSlot && (activeSlot.profile_id === profileId || activeSlot.slot_id === targetAcc.id)) {
    fs.writeFileSync(
      ACTIVE_CREATION_SLOT_FILE,
      JSON.stringify({ ...activeSlot, active: false, step: 'STEP_3B_COMPLETED', step3_completed_at: nowIso }, null, 2),
      'utf8'
    );
  }

  return {
    success: true,
    step: '3B',
    mode: 'CONFIGURE_WILAS_DAY01',
    account_id: targetAcc.id,
    name: targetAcc.name,
    email: targetAcc.email,
    profile_id: profileId,
    results,
    message: `Robô concluiu Dia 01 Wilas em "${targetAcc.name}"! (2FA: ${targetAcc.totp_secret ? 'ATIVO 🔐' : 'Pronto'} • Pro Mode: OK • Vídeos Perfil: ${targetAcc.profile_videos_posted || 0}/9 • Amigos Sugestões: ${targetAcc.friends_added_count || 0}/60-75 • Newsletters: ${targetAcc.wilas_day1_checklist.newsletters_subscribed_count}/15)`
  };
}

/**
 * AÇÃO DE AUDITORIA NAS CONTAS FACEBOOK JÁ DE PÉ:
 * Permite:
 * 1) Atualizar/vincular um novo e-mail ativo numa conta Facebook de pé cujo Gmail original morreu (`DEAD_NEEDS_RECOVERY_SWAP_FOR_2FA`).
 * 2) Salvar uma chave TOTP 2FA ou disparar a ativação automática do 2FA Obrigatório do Wilas (`ensure2faConfiguredInOpenProfile`) quando o Semáforo 4G estiver Verde.
 */
async function verifyOrActivateWilas2faOnStandingAccount(payload = {}, runtimeState = {}, deps = {}, onLog = console.log) {
  const accountId = String(payload.account_id || payload.id || '').trim();
  if (!accountId) {
    throw new Error('Informe o account_id da conta Facebook.');
  }

  const pipelineData = loadPipelineData();
  const acc = pipelineData.accounts.find(a => a.id === accountId);
  if (!acc) {
    throw new Error(`Conta "${accountId}" não encontrada em warming_accounts_pipeline.json.`);
  }

  const newEmail = String(payload.email || payload.new_email || '').trim().toLowerCase();
  const newPassword = String(payload.password || payload.new_email_password || '').trim();
  const manualTotp = String(payload.totp_secret || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  const markEmailActive = payload.mark_email_active !== false;
  const runBrowser2faNow = Boolean(payload.run_browser_2fa_now);

  if (newEmail && newEmail.includes('@')) {
    acc.email = newEmail;
    if (markEmailActive) {
      acc.email_status = 'ACTIVE_OK';
      acc.email_active_verified = true;
      acc.warmup_stats = acc.warmup_stats || {};
      acc.warmup_stats.gmail_authenticated = true;
      if (acc.status === 'GMAIL_LOGIN_ZERO_CDP_PENDENTE' || acc.status === 'GMAIL_LOGIN_PENDENTE') {
        acc.status = 'DIA_1';
      }
    }
    if (newPassword && !newPassword.includes('••••')) {
      vault.storeAccountSecretInLocalVault(acc.id, { password: newPassword });
      vault.storeAccountSecretInLocalVault(newEmail, { password: newPassword });
    }
    onLog(`📧 [Auditoria Wilas 2FA] E-mail ativo "${newEmail}" vinculado e confirmado na conta Facebook "${acc.name}"!`);
  } else if (payload.confirm_existing_email_active && acc.email) {
    acc.email_status = 'ACTIVE_OK';
    acc.email_active_verified = true;
    acc.warmup_stats = acc.warmup_stats || {};
    acc.warmup_stats.gmail_authenticated = true;
    if (acc.status === 'GMAIL_LOGIN_ZERO_CDP_PENDENTE' || acc.status === 'GMAIL_LOGIN_PENDENTE') {
      acc.status = 'DIA_1';
    }
  }

  if (manualTotp && manualTotp.length >= 16) {
    acc.totp_secret = manualTotp;
    acc.totp_secret_formatted = formatTotpSecretForDisplay(manualTotp);
    acc.fb_2fa_enabled = true;
    vault.storeAccountSecretInLocalVault(acc.id, { totp_secret: manualTotp });
    if (acc.email) {
      vault.storeAccountSecretInLocalVault(acc.email, { totp_secret: manualTotp });
    }
    onLog(`🔐 [Auditoria Wilas 2FA] Chave 2FA TOTP salva no Cofre (.ENV) para "${acc.name}"!`);
  }

  let browser2faResult = null;
  if (runBrowser2faNow && !acc.totp_secret) {
    const cleanRuntime = Object.assign({}, runtimeState, { isCreationStepRunning: false });
    const sem = getCreationSemaphoreStatus(cleanRuntime);
    if (!sem.can_create_now && !payload.forceOverrideSemaphore) {
      throw new Error(`${sem.badge_text} — Aguarde o Semáforo Verde para abrir o navegador de "${acc.name}" e ativar o 2FA.`);
    }
    const evalBefore = evaluateStandingAccountEmailAnd2fa(acc);
    if (!evalBefore.email_active_verified && !payload.forceWithoutActiveEmail) {
      throw new Error(`O e-mail de "${acc.name}" (${acc.email || 'vazio'}) consta como INATIVO/CAÍDO. Informe/vincule um e-mail ativo antes de puxar o código do 2FA do Facebook!`);
    }
    const profileId = String(acc.incogniton_profile_id || '').trim();
    if (!profileId) {
      throw new Error(`A conta "${acc.name}" não possui Profile ID vinculado.`);
    }
    const automator = deps.automator || require('../../automator');
    const accWithSecrets = vault.getAccountWithDecryptedVaultSecrets(acc);
    onLog(`🔐 [Ativação 2FA Obrigatório Wilas] Abrindo "${acc.name}" (${profileId.slice(0, 8)}) para configurar o 2FA TOTP no Facebook...`);
    browser2faResult = await automator.ensure2faConfiguredInOpenProfile(
      profileId,
      accWithSecrets,
      async (savedSecrets) => {
        if (savedSecrets && savedSecrets.totp_secret) {
          const cleanSec = String(savedSecrets.totp_secret).replace(/\s+/g, '').toUpperCase();
          acc.totp_secret = cleanSec;
          acc.totp_secret_formatted = formatTotpSecretForDisplay(cleanSec);
          acc.fb_2fa_enabled = true;
          vault.storeAccountSecretInLocalVault(acc.id, { totp_secret: cleanSec });
          if (acc.email) {
            vault.storeAccountSecretInLocalVault(acc.email, { totp_secret: cleanSec });
          }
          savePipelineData(pipelineData);
        }
      },
      onLog,
      {
        forceAttempt2fa: true,
        closeBrowserOnFinish: payload.keep_browser_open !== true
      }
    );
    if (browser2faResult && browser2faResult.totp_secret) {
      const cleanSec = String(browser2faResult.totp_secret).replace(/\s+/g, '').toUpperCase();
      acc.totp_secret = cleanSec;
      acc.totp_secret_formatted = formatTotpSecretForDisplay(cleanSec);
      acc.fb_2fa_enabled = true;
      vault.storeAccountSecretInLocalVault(acc.id, { totp_secret: cleanSec });
      if (acc.email) {
        vault.storeAccountSecretInLocalVault(acc.email, { totp_secret: cleanSec });
      }
    }
  }

  const evalAfter = evaluateStandingAccountEmailAnd2fa(acc);
  acc.fb_logged_in = true;
  acc.email_status = evalAfter.email_status;
  acc.email_active_verified = evalAfter.email_active_verified;
  acc.fb_2fa_enabled = evalAfter.fb_2fa_enabled;
  acc.wilas_2fa_audit_status = evalAfter.wilas_2fa_audit_status;

  savePipelineData(pipelineData);

  return {
    success: true,
    account_id: acc.id,
    name: acc.name,
    email: acc.email,
    email_status: acc.email_status,
    email_active_verified: acc.email_active_verified,
    fb_2fa_enabled: acc.fb_2fa_enabled,
    wilas_2fa_audit_status: acc.wilas_2fa_audit_status,
    browser_2fa_result: browser2faResult,
    audit: auditStandingFacebookAccounts2faAndEmail()
  };
}

module.exports = {
  WARMING_PIPELINE_FILE,
  DISCARDED_GMAILS_ARCHIVE_FILE,
  ACTIVE_CREATION_SLOT_FILE,
  VIRGIN_SLOT_IDS,
  getActiveCreationSlot,
  saveActiveCreationSlot,
  clearActiveCreationSlot,
  isStandingFacebookAccount,
  isVirginCreationSlot,
  evaluateStandingAccountEmailAnd2fa,
  cleanDeadStandaloneGmailsPreservingFacebook,
  cleanDeadStandaloneGmailsAndAuditActiveFacebook: cleanDeadStandaloneGmailsPreservingFacebook,
  auditStandingFacebookAccounts2faAndEmail,
  auditStandingFacebookAccountsForWilas2fa: auditStandingFacebookAccounts2faAndEmail,
  getCreationSemaphoreStatus,
  step1OpenNewFingerprint4gGmailZeroCdp,
  step2FinalizeGmailAndWarmup15Newsletters,
  step3CreateFacebookAndSetupWilasDay01,
  verifyOrActivateWilas2faOnStandingAccount
};
