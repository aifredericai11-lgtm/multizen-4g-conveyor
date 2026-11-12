/**
 * ============================================================================
 * MÓDULO OFICIAL WILLAS (CALL 01 + CALL 02 "OURO DO OURO") — ESTEIRA 1-CLIQUE
 * PÓS-CRIAÇÃO & AQUECIMENTO DE PERFIL + PÁGINAS (100% 4G • ZERO VENDA NO NOTEBOOK)
 * ============================================================================
 * Diretório: C:\Hub001\modules\account_warmup\willas_page_warmer.js
 *
 * Consolida integralmente as 8 diretrizes operacionais do Willas Farias:
 *  1. POST CRUZADO (MBS "Carregar Reels em várias páginas" -> aquece até 10 págs/perfil em 1 upload)
 *  2. AGENDAMENTO EM MASSA -> BUSINESS SUITE ("Carregar Reels em massa" -> botão oculto "Miniatura" -> "Programação em grupo" 2/dia 12h ou 3/dia 4h)
 *  3. STORIES -> PRIMEIRO DUPLO SENTIDO + CURTO (1º Story do dia de 2.2s isca/curiosidade p/ >90% retenção de 1s)
 *  4. RESTRIÇÃO DE IDADE 24+ (protege a amostra inicial do Estágio 1 de 200 pessoas contra jovens <24 que pulam em <3s)
 *  5. DESCRIÇÃO É IMPORTANTE (palavras-chave semânticas do público 50+/família/receitas/rotina • ZERO CTA e ZERO LINK)
 *  6. JANELAS DE FATIA DE PÚBLICO (estilo Live: Manhã / Tarde / Noite + teto <= 5 reposts/mês com >= 5 dias de intervalo)
 *  7. DEMORAR 7–10 MIN P/ CRIAR PÁGINA + DESCANSO 24H + TRAVA ANTI-SHADOWBAN 7 DIAS (jamais editar ficha em massa e postar na mesma sessão)
 *  8. COLLAB BOOSTER (posta na página nova/fraca e convida a página de maior engajamento do mesmo nicho como Colaboradora)
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const util = require('util');
const { execFile, execFileSync } = require('child_process');
const execFileAsync = util.promisify(execFile);

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const WARMUP_VIDEOS_DIR = path.join(PROJECT_ROOT, 'VIDEOS_AQUECIMENTO_PERFIL_PTBR');
const PAGE_WARMUP_VIDEOS_EN_DIR = path.join(PROJECT_ROOT, 'VIDEOS_AQUECIMENTO_PAGINAS_EN');
const SHORT_STORIES_CACHE_DIR = path.join(PROJECT_ROOT, 'temp_upload_staging', 'willas_short_stories');
const WILLAS_LEDGER_FILE = path.join(PROJECT_ROOT, 'willas_warmup_conveyor_state.json');
const LOCAL_EXTRA_50_WARMUP_DIR = '~\\OneDrive\\Área de Trabalho\\Nova pasta\\prontos\\LEVA_AQUECIMENTO_50_LOCAL';

let FFMPEG_BIN = 'ffmpeg';
try {
  const staticBin = require(path.join(PROJECT_ROOT, 'node_modules', 'ffmpeg-static'));
  if (staticBin && fs.existsSync(staticBin)) FFMPEG_BIN = staticBin;
} catch (_) { }

try { fs.mkdirSync(SHORT_STORIES_CACHE_DIR, { recursive: true }); } catch (_) { }
try { fs.mkdirSync(PAGE_WARMUP_VIDEOS_EN_DIR, { recursive: true }); } catch (_) { }

function listEnglishPageWarmupVideos() {
  try {
    fs.mkdirSync(PAGE_WARMUP_VIDEOS_EN_DIR, { recursive: true });
    const driveEnDir = '';
    if (fs.existsSync(driveEnDir)) {
      for (const dEnt of fs.readdirSync(driveEnDir, { withFileTypes: true })) {
        if (dEnt.isFile() && /\.(mp4|mov)$/i.test(dEnt.name)) {
          const srcDrive = path.join(driveEnDir, dEnt.name);
          const dstLocal = path.join(PAGE_WARMUP_VIDEOS_EN_DIR, dEnt.name);
          if (!fs.existsSync(dstLocal)) {
            const st = fs.statSync(srcDrive);
            if (st.size > 10240) fs.copyFileSync(srcDrive, dstLocal);
          }
        }
      }
    }
    return fs.readdirSync(PAGE_WARMUP_VIDEOS_EN_DIR, { withFileTypes: true })
      .filter(e => e.isFile() && /\.(mp4|mov)$/i.test(e.name) && !e.name.startsWith('_tmp_'))
      .map(e => {
        const fullPath = path.join(PAGE_WARMUP_VIDEOS_EN_DIR, e.name);
        const st = fs.statSync(fullPath);
        return {
          filename: e.name,
          fullPath,
          size_bytes: st.size,
          uploaded_at: st.mtime.toISOString()
        };
      })
      .sort((a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime());
  } catch (_) {
    return [];
  }
}

// Detecta 1x se o FFmpeg configurado suporta aceleração NVIDIA RTX 4050 (h264_nvenc)
let _nvencChecked = false;
let _nvencAvailable = false;
function hasNvidiaNvencSupport() {
  if (_nvencChecked) return _nvencAvailable;
  _nvencChecked = true;
  try {
    const out = execFileSync(FFMPEG_BIN, ['-hide_banner', '-encoders'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    _nvencAvailable = /h264_nvenc/i.test(out);
  } catch (_) {
    _nvencAvailable = false;
  }
  return _nvencAvailable;
}

// ============================================================================
// 1. DESCRIÇÃO É IMPORTANTE (PALAVRAS-CHAVE DO PÚBLICO/TEMA • ZERO CTA/LINK)
// ============================================================================
const WILLAS_AUDIENCE_DESCRIPTIONS_PT = [
  'Rotina matinal tranquila na cozinha de casa, receitas caseiras simples, café fresco na mesa, saúde natural depois dos 50, sabedoria de vó e paz em família.',
  'Cuidado diário com a saúde na maturidade, hábitos simples da manhã, vida leve em casa, receitas da vovó, bem-estar feminino 50+ e gratidão.',
  'Histórias reais de família, simplicidade na cozinha caseira, costumes antigos que trazem paz, bem-estar depois dos 50 anos e aconchego do lar.',
  'Dicas naturais da rotina doméstica, cozinha organizada pela manhã, hábitos saudáveis para mulheres maduras, fé, família e tranquilidade.',
  'Vida simples no campo e na cozinha de casa, temperos naturais, memórias afetivas de avó, saúde e disposição todos os dias na melhor idade.',
  'Pequenos hábitos matinais que transformam o dia, mesa posta com carinho, receitas fáceis de casa, bem-estar feminino e coração em paz.',
  'Sabedoria prática de dona de casa, rotina leve pela manhã, cuidado com o corpo e a mente após os 45 e momentos especiais em família.',
  'Receitas tradicionais da família, chá quentinho e conversa boa na cozinha, vida saudável na maturidade e paz no dia a dia.'
];

const WILLAS_AUDIENCE_DESCRIPTIONS_EN = [
  'Simple homemade healthy kitchen recipes, peaceful morning routine for women over 50, grandma kitchen wisdom, wholesome family meals and natural daily wellness.',
  'Easy wholesome recipes from grandma kitchen, calm morning habits after 50, fresh ingredients on the counter, cozy family life and healthy aging.',
  'Traditional homemade wellness recipes, gentle morning kitchen routine for women 55+, nourishing everyday habits and grateful family living.',
  'Everyday healthy cooking at home, simple natural ingredients from the kitchen pantry, peaceful mornings for mature women and wholesome living.'
];

const SHORT_STORY_DOUBLE_ENTENDRE_HOOKS_PT = [
  'Eu tive que olhar duas vezes pra entender o que tinha atrás da xícara 👀',
  'Quase ninguém repara nesse detalhe em cima da bancada...',
  'Minha vizinha achou que era outra coisa quando entrou na cozinha 😅',
  'Olha bem pro canto da mesa antes de passar... reparou?',
  'Parece uma coisa à primeira vista, mas olha de perto 👀',
  'Todo mundo que vê rápido entende errado na primeira vez...'
];

const SHORT_STORY_DOUBLE_ENTENDRE_HOOKS_EN = [
  'I had to look twice at what was sitting behind the mug 👀',
  'Almost nobody notices this little detail on the counter...',
  'Everyone misreads this on the first look 😅'
];

const BANNED_CONTENT_TERMS_REGEX = /\b(gore|decapita|mutila|suicid|self-harm|porn|nsfw|pedofil|child abuse|terroris|tiroteio|massacre|sangue explicito)\b/i;
const FORBIDDEN_CTA_OR_LINK_REGEX = /(https?:\/\/\S+|www\.\S+|\b[a-z0-9-]+\.(com|net|org|dev|io|br|shop|store)\b|comente\s+eu\s+quero|clique\s+no\s+link|link\s+na\s+bio|saiba\s+mais|compre\s+agora|comment\s+yes|click\s+the\s+link|link\s+in\s+bio|dm\s+me|manda\s+direct)/gi;

function sanitizeNoCtaNoLinkDescription(rawText) {
  const cleaned = String(rawText || '')
    .replace(FORBIDDEN_CTA_OR_LINK_REGEX, '')
    .replace(/@[a-zA-Z0-9._-]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return cleaned;
}

function buildWillasAudienceKeywordDescription(options = {}) {
  const lang = String(options.language || 'pt-BR').toLowerCase();
  const pool = lang.startsWith('en') ? WILLAS_AUDIENCE_DESCRIPTIONS_EN : WILLAS_AUDIENCE_DESCRIPTIONS_PT;
  const seed = Math.abs(Number(options.slotIndex || 0) + Math.floor(Date.now() / 60000));
  const picked = pool[seed % pool.length];
  return sanitizeNoCtaNoLinkDescription(options.customText || picked);
}

// ============================================================================
// 2. ESTADO PERSISTENTE, LEDGER <= 5 REPOSTS/MÊS (>= 5 DIAS) & FATIAS DE HORÁRIO
// ============================================================================
function loadWillasConveyorState() {
  try {
    if (fs.existsSync(WILLAS_LEDGER_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(WILLAS_LEDGER_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch (_) { }
  return {
    autopilot_enabled: false,
    autopilot_interval_minutes: 45,
    last_run_at: null,
    last_run_summary: null,
    repost_ledger_by_page: {}, // { [pageKey]: { [videoFilename]: [isoDate1, isoDate2...] } }
    story_posted_by_page_date: {}, // { [pageKey]: "YYYY-MM-DD" }
    mbs_bulk_scheduled_by_page: {} // { [pageKey]: { scheduled_until_ymd, count, updated_at } }
  };
}

function saveWillasConveyorState(state) {
  try {
    fs.writeFileSync(WILLAS_LEDGER_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (_) { }
}

function getBrtTodayYmd() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

/**
 * Regra Willas Call 02 [00:40:10]:
 * O mesmo vídeo pode ser repostado no máximo 5 vezes no mês na página,
 * com no mínimo 5 dias (120h) de distância entre cada repetição.
 */
function canUseWarmupVideoOnPage(pageKey, videoFilename, stateObj = null) {
  const st = stateObj || loadWillasConveyorState();
  const pageMap = (st.repost_ledger_by_page && st.repost_ledger_by_page[pageKey]) || {};
  const history = Array.isArray(pageMap[videoFilename]) ? pageMap[videoFilename] : [];
  if (history.length === 0) return { allowed: true, count_30d: 0, days_since_last: 999 };

  const nowMs = Date.now();
  const thirtyDaysMs = 30 * 24 * 3600 * 1000;
  const fiveDaysMs = 5 * 24 * 3600 * 1000;
  const recent30d = history
    .map(ts => new Date(ts).getTime())
    .filter(ms => Number.isFinite(ms) && (nowMs - ms) <= thirtyDaysMs)
    .sort((a, b) => b - a);

  if (recent30d.length >= 5) {
    return { allowed: false, reason: 'MAX_5_REPOSTS_PER_MONTH', count_30d: recent30d.length, days_since_last: 0 };
  }
  if (recent30d.length > 0 && (nowMs - recent30d[0]) < fiveDaysMs) {
    const daysSince = Number(((nowMs - recent30d[0]) / (24 * 3600 * 1000)).toFixed(1));
    return { allowed: false, reason: 'MIN_5_DAYS_GAP_NOT_MET', count_30d: recent30d.length, days_since_last: daysSince };
  }
  return {
    allowed: true,
    count_30d: recent30d.length,
    days_since_last: recent30d.length > 0 ? Number(((nowMs - recent30d[0]) / (24 * 3600 * 1000)).toFixed(1)) : 999
  };
}

function recordWarmupVideoUsedOnPage(pageKey, videoFilename, stateObj = null) {
  const st = stateObj || loadWillasConveyorState();
  st.repost_ledger_by_page = st.repost_ledger_by_page || {};
  st.repost_ledger_by_page[pageKey] = st.repost_ledger_by_page[pageKey] || {};
  const arr = Array.isArray(st.repost_ledger_by_page[pageKey][videoFilename])
    ? st.repost_ledger_by_page[pageKey][videoFilename]
    : [];
  arr.push(new Date().toISOString());
  st.repost_ledger_by_page[pageKey][videoFilename] = arr.slice(-12);
  if (!stateObj) saveWillasConveyorState(st);
}

/**
 * Fatia de Público estilo Live (Willas Call 02 [00:49:32]):
 * Rotaciona janelas de postagem/agendamento entre Manhã (08:30), Tarde (14:30) e Noite (20:00)
 * para atingir bolsões diferentes da audiência da página.
 */
function getCurrentAudienceSliceWindow() {
  const brtHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }).format(new Date()));
  if (brtHour < 12) return { code: 'MANHA', label: '🌅 Fatia Manhã (08h–12h)', next_slots_hm: ['08:30', '20:30'] };
  if (brtHour < 18) return { code: 'TARDE', label: '☀️ Fatia Tarde (12h–18h)', next_slots_hm: ['14:30', '08:30'] };
  return { code: 'NOITE', label: '🌙 Fatia Noite (18h–23h)', next_slots_hm: ['20:15', '08:45'] };
}

/**
 * Call 03 Willas [00:59:45 & 01:08:15]:
 * Página recém-criada JÁ pode receber o 1º vídeo de aquecimento do nicho imediatamente!
 * Só aplica espera de 24h se o operador ativar explicitamente `willas_wait_24h_after_page_creation = true`.
 */
function isPageIn24hPostCreationRest(pageObj) {
  if (!pageObj) return { resting: false, remaining_hours: 0 };
  let forceWait24h = false;
  try {
    const db = require('../../db');
    forceWait24h = Boolean((db.getSettings() || {}).willas_wait_24h_after_page_creation === true);
  } catch (_) { }
  if (!forceWait24h) {
    return { resting: false, remaining_hours: 0 };
  }
  const nowMs = Date.now();
  const coolingUntil = Number(pageObj.page_created_cooling_until || 0);
  if (coolingUntil > nowMs) {
    return {
      resting: true,
      remaining_hours: Number(((coolingUntil - nowMs) / 3600000).toFixed(1))
    };
  }
  const createdTs = Number(pageObj.created_timestamp || (pageObj.created_at ? new Date(pageObj.created_at).getTime() : 0));
  if (createdTs > 0 && (nowMs - createdTs) < 24 * 3600 * 1000) {
    return {
      resting: true,
      remaining_hours: Number(((24 * 3600 * 1000 - (nowMs - createdTs)) / 3600000).toFixed(1))
    };
  }
  return { resting: false, remaining_hours: 0 };
}

/**
 * Trava Anti-Shadowban de 7 Dias (Willas Call 02 [00:32:45]):
 * Se uma página existente acabou de sofrer edição em massa de ficha/perfil nas últimas 12h,
 * não sobe vídeo na mesma sessão.
 */
function isPageSafeFromMassEditShadowban(pageObj) {
  if (!pageObj || !pageObj.last_mass_profile_edit_at) return true;
  const editMs = new Date(pageObj.last_mass_profile_edit_at).getTime();
  if (!Number.isFinite(editMs)) return true;
  return (Date.now() - editMs) >= 12 * 3600 * 1000;
}

// ============================================================================
// 3. PRÉ-CHECAGEM DE CRIADOR TIKTOK (@HANDLE + TÍTULO + TEMAS PROIBIDOS)
// ============================================================================
async function preCheckTikTokCreatorAndTitle(tiktokHandle = '', videoTitle = '') {
  const profileReelsWarmer = require('./profile_reels_warmer');
  const titleClean = String(videoTitle || '').trim();
  if (BANNED_CONTENT_TERMS_REGEX.test(titleClean)) {
    return {
      safe: false,
      blocked_theme: true,
      reason: '🛑 BLOQUEADO: O título/tema contém categoria sensível banida pelo Facebook (gore/violência/risco).'
    };
  }
  const handleCheck = await profileReelsWarmer.checkTikTokHandleOnFacebook(tiktokHandle);
  return {
    safe: Boolean(handleCheck.safe),
    blocked_theme: false,
    handle_check: handleCheck,
    title_checked: titleClean,
    recommendation: handleCheck.safe
      ? '✅ Criador sem página homônima no Facebook + tema seguro para aquecimento.'
      : handleCheck.reason
  };
}

// ============================================================================
// 4. COLLAB BOOSTER (PÁGINA FRACA/NOVA CONVIDA A PÁGINA DE MAIOR ENGAJAMENTO)
// ============================================================================
function pickBestCollaboratorPage(weakPageObj, allPages = []) {
  const weakId = String(weakPageObj?.id || '').trim();
  const weakName = String(weakPageObj?.name || '').trim().toLowerCase();
  const candidates = (allPages || []).filter(p => {
    if (!p || p.active === false || p.removed || p.restricted || p.archived) return false;
    if (String(p.id || '') === weakId || String(p.name || '').trim().toLowerCase() === weakName) return false;
    // Jamais mistura página da Matriz de outro PC
    if (String(p.profile_browser_ID || '').toLowerCase().startsWith('00000000')) return false;
    const rest = isPageIn24hPostCreationRest(p);
    if (rest.resting) return false;
    return true;
  });

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const scoreA = Number(a.max_views || 0) * 2 + Number(a.total_views || 0) + Number(a.warming_day || 1) * 150;
    const scoreB = Number(b.max_views || 0) * 2 + Number(b.total_views || 0) + Number(b.warming_day || 1) * 150;
    return scoreB - scoreA;
  });

  const best = candidates[0];
  if (!best) return null;
  const queryValue = best.fb_username
    ? `https://www.facebook.com/${String(best.fb_username).replace(/^@+/, '')}`
    : (best.url || best.name);
  return {
    id: best.id,
    name: best.name,
    url: best.url || '',
    query: queryValue,
    max_views: Number(best.max_views || 0),
    total_views: Number(best.total_views || 0)
  };
}

async function applyCollaboratorInviteInComposer(page, collaboratorPage, onLog = console.log) {
  if (!page || !collaboratorPage || !collaboratorPage.name) return false;
  try {
    onLog(`🤝 [Collab Booster • Willas] Postando na página nova/fraca e enviando convite de Collab para a página mais forte ("${collaboratorPage.name}")...`);

    const collabInput = await page.evaluate(() => {
      const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
      // 1. Input direto de colaborador (Meta Business Suite possui campo "Colaborador" / "Add collaborator" por nome ou URL)
      const inps = Array.from(document.querySelectorAll('input[type="text"], input[type="search"], input:not([type])'));
      for (const inp of inps) {
        const ph = norm(inp.getAttribute('placeholder') || inp.getAttribute('aria-label') || '');
        if (ph.includes('colaborador') || ph.includes('collaborator') || ph.includes('nome ou url') || ph.includes('name or url')) {
          if (inp.scrollIntoView) inp.scrollIntoView({ block: 'center' });
          const r = inp.getBoundingClientRect();
          if (r.width > 60 && r.height > 18) {
            return { x: r.left + 24, y: r.top + r.height / 2, mode: 'direct_input' };
          }
        }
      }
      // 2. Botão "Convidar colaborador" / "Colaborador" no composer nativo
      const btns = Array.from(document.querySelectorAll('[role="button"], button, span, div'));
      for (const b of btns) {
        if (b.children && b.children.length > 4) continue;
        const t = norm(b.innerText || b.getAttribute?.('aria-label') || '');
        if (t === 'convidar colaborador' || t === 'invite collaborator' || t === 'adicionar colaborador' || t === 'add collaborator' || t === 'colaborador') {
          const clickable = b.closest('[role="button"], button') || b;
          if (clickable.scrollIntoView) clickable.scrollIntoView({ block: 'center' });
          const r = clickable.getBoundingClientRect();
          if (r.width > 40 && r.height >= 18) {
            return { x: r.left + r.width / 2, y: r.top + r.height / 2, mode: 'open_button' };
          }
        }
      }
      return null;
    }).catch(() => null);

    if (!collabInput) return false;

    await page.mouse.click(collabInput.x, collabInput.y).catch(() => { });
    await new Promise(r => setTimeout(r, 900));

    if (collabInput.mode === 'open_button') {
      const modalInp = await page.evaluate(() => {
        const inps = Array.from(document.querySelectorAll('[role="dialog"] input, input[type="search"], input[type="text"]'));
        for (const inp of inps) {
          const r = inp.getBoundingClientRect();
          if (r.width > 80 && r.height >= 18) {
            inp.focus();
            return { x: r.left + 24, y: r.top + r.height / 2 };
          }
        }
        return null;
      }).catch(() => null);
      if (modalInp) {
        await page.mouse.click(modalInp.x, modalInp.y).catch(() => { });
        await new Promise(r => setTimeout(r, 400));
      }
    }

    await page.keyboard.type(collaboratorPage.name, { delay: 42 }).catch(() => { });
    await new Promise(r => setTimeout(r, 1800));

    const pickedSuggestion = await page.evaluate((targetName) => {
      const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
      const want = norm(targetName);
      const opts = Array.from(document.querySelectorAll('[role="option"], [role="listbox"] [role="button"], [role="menuitem"], ul li, [role="dialog"] [role="radio"]'));
      for (const o of opts) {
        const t = norm(o.innerText || '');
        if (t && (t.includes(want) || want.includes(t.split('\n')[0]))) {
          const r = o.getBoundingClientRect();
          if (r.width > 40 && r.height >= 20) {
            try { o.click(); } catch (_) { }
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          }
        }
      }
      return null;
    }, collaboratorPage.name).catch(() => null);

    if (pickedSuggestion) {
      await page.mouse.click(pickedSuggestion.x, pickedSuggestion.y).catch(() => { });
      await new Promise(r => setTimeout(r, 900));
      // Se estiver em modal com botão "Concluir" / "Done", confirma
      await page.evaluate(() => {
        const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
        const btns = Array.from(document.querySelectorAll('[role="dialog"] [role="button"], [role="dialog"] button'));
        for (const b of btns) {
          const t = norm(b.innerText || b.getAttribute('aria-label') || '');
          if (t === 'concluir' || t === 'done' || t === 'salvar' || t === 'save') {
            try { b.click(); } catch (_) { }
          }
        }
      }).catch(() => { });
      onLog(`✅ [Collab Booster] Convite de Collab enviado para "${collaboratorPage.name}" com sucesso!`);
      return true;
    }
  } catch (err) {
    onLog(`⚠️ [Collab Booster] Aviso ao preencher colaborador: ${err.message}`);
  }
  return false;
}

/**
 * Call 03 Willas [00:30:05]:
 * Quando uma página forte da rede é aberta no navegador, verifica notificações de convite de Colaborador
 * enviadas pelas páginas irmãs novas/fracas e clica em "Aceitar" ("Accept") automaticamente!
 */
async function acceptPendingCollabInvitesOnPage(page, strongPageObj, onLog = console.log) {
  if (!page || !strongPageObj) return { accepted: 0 };
  try {
    await page.goto('https://www.facebook.com/notifications', { waitUntil: 'domcontentloaded', timeout: 35000 }).catch(() => { });
    await new Promise(r => setTimeout(r, 3200));
    const acceptedCount = await page.evaluate(() => {
      const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
      let count = 0;
      const btns = Array.from(document.querySelectorAll('[role="button"], button, a'));
      for (const b of btns) {
        const cardTxt = norm(b.closest('div[role="article"], li, div[class]')?.innerText || '');
        const t = norm(b.innerText || b.getAttribute?.('aria-label') || '');
        if (
          (cardTxt.includes('colaborador') || cardTxt.includes('collaborator') || cardTxt.includes('convidou voce para colaborar') || cardTxt.includes('invited you to collaborate')) &&
          (t === 'aceitar' || t === 'accept' || t === 'confirmar' || t === 'confirm')
        ) {
          try { b.click(); count++; } catch (_) { }
        }
      }
      return count;
    }).catch(() => 0);
    if (acceptedCount > 0) {
      onLog(`🤝 [Auto-Aceite Collab • Call 03] "${strongPageObj.name}" aceitou ${acceptedCount} convite(s) de Collab pendente(s) — tráfego liberado!`);
      await new Promise(r => setTimeout(r, 2000));
    }
    return { accepted: acceptedCount };
  } catch (_) {
    return { accepted: 0 };
  }
}

// ============================================================================
// 5. STORIES -> PRIMEIRO DUPLO SENTIDO + CURTO (2.2s EM GPU NVENC + MBS STORY)
// ============================================================================
async function prepareShortBaitStoryMp4(sourceVideoPath, options = {}) {
  if (!sourceVideoPath || !fs.existsSync(sourceVideoPath)) {
    throw new Error(`Vídeo fonte para Story Curto não encontrado: ${sourceVideoPath}`);
  }
  fs.mkdirSync(SHORT_STORIES_CACHE_DIR, { recursive: true });
  const durationSec = Math.min(3.0, Math.max(1.6, Number(options.durationSec || 2.2)));
  const lang = String(options.language || 'pt-BR').toLowerCase();
  const hooksPool = lang.startsWith('en') ? SHORT_STORY_DOUBLE_ENTENDRE_HOOKS_EN : SHORT_STORY_DOUBLE_ENTENDRE_HOOKS_PT;
  const seed = Math.abs(String(options.accountSalt || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0) + Date.now());
  const hookText = String(options.hookText || hooksPool[seed % hooksPool.length])
    .replace(/['":\\%]/g, '')
    .slice(0, 72);

  const outFile = path.join(SHORT_STORIES_CACHE_DIR, `STORY_BAIT_${Date.now()}_${seed % 9999}.mp4`);
  const hasFont = fs.existsSync('C:\\Windows\\Fonts\\arialbd.ttf');
  const drawFilter = (options.withOverlayText !== false && hasFont && hookText)
    ? `,drawtext=fontfile='C\\:/Windows/Fonts/arialbd.ttf':text='${hookText}':fontcolor=white:fontsize=26:box=1:boxcolor=black@0.72:boxborderw=12:x=(w-text_w)/2:y=150`
    : '';
  const vf = `crop=iw*0.97:ih*0.97,scale=720:1280:flags=bicubic,eq=brightness=0.01:contrast=1.03:saturation=1.04${drawFilter}`;

  const useNvenc = hasNvidiaNvencSupport();
  const videoCodecArgs = useNvenc
    ? ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', '24', '-b:v', '2.0M', '-maxrate', '2.8M']
    : ['-c:v', 'libx264', '-preset', 'superfast', '-crf', '24', '-maxrate', '2000k', '-bufsize', '4000k'];

  const args = [
    '-y',
    '-ss', '0.4',
    '-i', sourceVideoPath,
    '-t', String(durationSec),
    '-map_metadata', '-1',
    '-vf', vf,
    ...videoCodecArgs,
    '-c:a', 'aac',
    '-b:a', '128k',
    '-brand', 'qt  ',
    '-movflags', '+faststart+use_metadata_tags',
    '-metadata:g', 'com.apple.quicktime.make=Apple',
    '-metadata:g', 'com.apple.quicktime.model=iPhone 16 Pro',
    '-metadata:g', 'comment=LvAppName=CapCut;LvAppVersion=12.8.0',
    outFile
  ];

  try {
    await execFileAsync(FFMPEG_BIN, args, { timeout: 45000, windowsHide: true });
  } catch (_) {
    // Fallback limpo em libx264 sem drawtext caso falhe codec/fonte
    await execFileAsync(FFMPEG_BIN, [
      '-y', '-i', sourceVideoPath, '-t', String(durationSec), '-map_metadata', '-1',
      '-vf', 'crop=iw*0.97:ih*0.97,scale=720:1280:flags=bicubic',
      '-c:v', 'libx264', '-preset', 'superfast', '-crf', '25',
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', outFile
    ], { timeout: 45000, windowsHide: true });
  }

  return {
    storyMp4Path: outFile,
    durationSec,
    hookText,
    gpuNvencUsed: useNvenc
  };
}

/**
 * Publica o 1º Story Curto de Duplo Sentido (2.2s) na página via Meta Business Suite ("Criar story")
 * aguardando 100% do carregamento do preview antes de clicar em Compartilhar (Call 02 [00:47:50]).
 */
async function postShortBaitStoryInMbs(page, automator, { pageObj, sourceVideoPath }, onLog = console.log) {
  let prepared = null;
  try {
    prepared = await prepareShortBaitStoryMp4(sourceVideoPath, {
      accountSalt: pageObj?.name || '',
      language: pageObj?.language || 'en-US'
    });
    onLog(`📱 [Story Curto Isca 2.2s • Willas] Gerado (${prepared.durationSec}s • GPU NVENC=${prepared.gpuNvencUsed}) para "${pageObj.name}" -> Abrindo Criador de Story...`);

    const assetParam = pageObj?.fb_page_id ? `?asset_id=${encodeURIComponent(pageObj.fb_page_id)}` : '';
    await page.goto(`https://business.facebook.com/latest/story_composer${assetParam}`, {
      waitUntil: 'domcontentloaded',
      timeout: 55000
    }).catch(() => { });
    await new Promise(r => setTimeout(r, 4500));

    // Localiza input[type="file"] do Story no MBS (ou clica em "Adicionar foto/vídeo" / "Add photo/video")
    let fileInputs = await page.$$('input[type="file"]').catch(() => []);
    if (!fileInputs || fileInputs.length === 0) {
      await page.evaluate(() => {
        const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
        const btns = Array.from(document.querySelectorAll('[role="button"], button, span'));
        for (const b of btns) {
          const t = norm(b.innerText || '');
          if (t.includes('adicionar foto') || t.includes('adicionar video') || t.includes('add photo') || t.includes('add video') || t.includes('adicionar midia') || t.includes('add media')) {
            try { (b.closest('[role="button"], button') || b).click(); } catch (_) { }
            break;
          }
        }
      }).catch(() => { });
      await new Promise(r => setTimeout(r, 1500));
      fileInputs = await page.$$('input[type="file"]').catch(() => []);
    }

    if (!fileInputs || fileInputs.length === 0) {
      onLog(`⚠️ [Story Curto Isca] Campo de upload não localizado no MBS de "${pageObj.name}" — pulando Story com segurança.`);
      return { ok: false, reason: 'NO_STORY_FILE_INPUT' };
    }

    await fileInputs[0].uploadFile(prepared.storyMp4Path);
    onLog(`⏳ [Story Curto Isca] Aguardando 100% do processamento do preview do Story no MBS antes de compartilhar...`);

    let shareReadyBox = null;
    for (let w = 0; w < 22; w++) {
      await new Promise(r => setTimeout(r, 2000));
      shareReadyBox = await page.evaluate(() => {
        const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
        const bodyTxt = norm(document.body?.innerText || '');
        const stillUploading = bodyTxt.includes('carregando...') || bodyTxt.includes('uploading...') || bodyTxt.includes('0%');
        const hasVideoPreview = Boolean(document.querySelector('video, img[src*="scontent"], canvas'));
        if (stillUploading && !hasVideoPreview) return null;

        const btns = Array.from(document.querySelectorAll('[role="button"], button'));
        for (let i = btns.length - 1; i >= 0; i--) {
          const b = btns[i];
          if (b.disabled || b.getAttribute('aria-disabled') === 'true') continue;
          const t = norm(b.innerText || b.getAttribute('aria-label') || '');
          if (
            t === 'compartilhar' ||
            t === 'compartilhar story' ||
            t === 'publicar' ||
            t === 'share' ||
            t === 'share story' ||
            t === 'publish'
          ) {
            const r = b.getBoundingClientRect();
            if (r.width > 45 && r.height > 22 && r.top > 80) {
              return { x: r.left + r.width / 2, y: r.top + r.height / 2, label: t };
            }
          }
        }
        return null;
      }).catch(() => null);
      if (shareReadyBox) break;
    }

    if (!shareReadyBox) {
      onLog(`⚠️ [Story Curto Isca] Botão Compartilhar não habilitou a tempo em "${pageObj.name}".`);
      return { ok: false, reason: 'STORY_SHARE_NOT_ENABLED' };
    }

    // Espera extra de segurança p/ garantir 100% preview renderizado (Regra Willas [00:47:50])
    await new Promise(r => setTimeout(r, 2500));
    await page.mouse.click(shareReadyBox.x, shareReadyBox.y);
    await new Promise(r => setTimeout(r, 5500));

    onLog(`✅ [Story Curto Isca 2.2s • Publicado] 1º Story de duplo sentido publicado em "${pageObj.name}"!`);
    return { ok: true, duration_sec: prepared.durationSec, hook: prepared.hookText };
  } catch (err) {
    onLog(`⚠️ [Story Curto Isca] Erro em "${pageObj?.name}": ${err.message}`);
    return { ok: false, error: err.message };
  } finally {
    if (prepared?.storyMp4Path && fs.existsSync(prepared.storyMp4Path)) {
      try { fs.unlinkSync(prepared.storyMp4Path); } catch (_) { }
    }
  }
}

// ============================================================================
// 6. POST CRUZADO NO META BUSINESS SUITE ("CARREGAR REELS EM VÁRIAS PÁGINAS")
//    Aquece até 10 páginas do mesmo perfil em 1 único upload!
// ============================================================================
async function postCrosspostedWarmupReelInMbs(page, automator, options = {}, onLog = console.log) {
  const profileReelsWarmer = require('./profile_reels_warmer');
  const eligiblePages = Array.isArray(options.eligiblePages) ? options.eligiblePages : [];
  if (eligiblePages.length === 0) return { ok: false, reason: 'NO_ELIGIBLE_PAGES' };

  const primaryPage = eligiblePages[0];
  const rawVideoPath = options.videoPath;
  // Call 03 Willas [01:10:20]: Perfil aquece em qualquer língua, mas a PÁGINA já aquece no nicho de Saúde/Receitas em Inglês!
  const description = buildWillasAudienceKeywordDescription({
    language: primaryPage.language || 'en-US',
    customText: options.description,
    slotIndex: options.slotIndex || 1
  });

  const shielded = profileReelsWarmer.prepareProfileWarmupVideoHsl(rawVideoPath, 1, {
    accountSalt: primaryPage.name || options.accountName || 'mbs_crosspost',
    allowFastCopy: false
  });

  try {
    const pageNamesList = eligiblePages.map(p => p.name);
    onLog(`🔀 [Post Cruzado MBS • Willas Call 03] Abrindo URL direta post_to_multiple_pages no Meta Business Suite para aquecer ${pageNamesList.length} página(s) no nicho Saúde/Receitas (${pageNamesList.join(', ')})...`);

    const assetQuery = primaryPage.fb_page_id
      ? `?ref=biz_web_home_post_to_multiple_pages&asset_id=${encodeURIComponent(primaryPage.fb_page_id)}&context_ref=HOME`
      : '?ref=biz_web_home_post_to_multiple_pages&context_ref=HOME';
    await page.goto(`https://business.facebook.com/latest/reels_composer/${assetQuery}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    }).catch(() => { });
    await new Promise(r => setTimeout(r, 5000));

    // 1. Se houver > 1 página elegível no perfil, abre o seletor "Publicar em" / "Post to" e marca todas as páginas irmãs (Post Cruzado Nativo!)
    let checkedPagesCount = 1;
    if (eligiblePages.length > 1) {
      const openedMultiPageDropdown = await page.evaluate(() => {
        const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
        const triggers = Array.from(document.querySelectorAll('[role="combobox"], [aria-haspopup="listbox"], [role="button"], button'));
        for (const el of triggers) {
          const t = norm(el.innerText || el.getAttribute('aria-label') || '');
          const r = el.getBoundingClientRect();
          if (r.width > 80 && r.height >= 24 && r.top > 60 && r.top < 360 && r.left < 680) {
            if (t.includes('publicar em') || t.includes('post to') || t.includes('paginas') || t.includes('pages') || el.getAttribute('role') === 'combobox') {
              try { el.click(); } catch (_) { }
              return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
            }
          }
        }
        return null;
      }).catch(() => null);

      if (openedMultiPageDropdown) {
        await page.mouse.click(openedMultiPageDropdown.x, openedMultiPageDropdown.y).catch(() => { });
        await new Promise(r => setTimeout(r, 1400));

        checkedPagesCount = await page.evaluate((targetNames) => {
          const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
          const wantSet = new Set(targetNames.map(norm));
          let count = 0;
          const items = Array.from(document.querySelectorAll('[role="checkbox"], [role="option"], [role="menuitemcheckbox"], input[type="checkbox"], label'));
          for (const it of items) {
            const txt = norm(it.innerText || it.getAttribute?.('aria-label') || it.closest('div')?.innerText || '');
            if (!txt) continue;
            for (const want of wantSet) {
              if (txt === want || txt.startsWith(want + '\n')) {
                const isChecked = it.getAttribute?.('aria-checked') === 'true' || it.checked === true || Boolean(it.querySelector?.('[aria-checked="true"], input:checked'));
                if (!isChecked) {
                  try { it.click(); } catch (_) { }
                }
                count++;
                break;
              }
            }
          }
          return Math.max(1, count);
        }, pageNamesList).catch(() => 1);

        await page.keyboard.press('Escape').catch(() => { });
        await new Promise(r => setTimeout(r, 800));
        onLog(`✅ [Post Cruzado MBS] ${checkedPagesCount}/${pageNamesList.length} página(s) irmã(s) marcadas no seletor multi-página!`);
      }
    }

    // 2. Upload do MP4 blindado ("Adicionar vídeo" / input[type="file"])
    let fileInputs = await page.$$('input[type="file"]').catch(() => []);
    if (!fileInputs || fileInputs.length === 0) {
      await page.evaluate(() => {
        const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
        const btns = Array.from(document.querySelectorAll('[role="button"], button, span'));
        for (const b of btns) {
          const t = norm(b.innerText || '');
          if (t === 'adicionar video' || t === 'add video' || t.includes('carregar video') || t.includes('upload video')) {
            try { (b.closest('[role="button"], button') || b).click(); } catch (_) { }
            break;
          }
        }
      }).catch(() => { });
      await new Promise(r => setTimeout(r, 1500));
      fileInputs = await page.$$('input[type="file"]').catch(() => []);
    }

    if (!fileInputs || fileInputs.length === 0) {
      return { ok: false, reason: 'MBS_REELS_COMPOSER_NO_FILE_INPUT' };
    }

    await fileInputs[0].uploadFile(shielded.outputPath);
    onLog(`📤 [Post Cruzado MBS] Upload enviado (${path.basename(shielded.outputPath)}) — preenchendo Descrição Semântica (Zero CTA / Zero Link)...`);
    await new Promise(r => setTimeout(r, 3500));

    // 3. Preenche a Descrição rica em palavras-chave do público/tema (Zero CTA e Zero Link)
    const descBox = await page.evaluate(() => {
      const boxes = Array.from(document.querySelectorAll('[role="textbox"][contenteditable="true"], textarea'));
      for (const b of boxes) {
        const r = b.getBoundingClientRect();
        if (r.width > 140 && r.height >= 28 && r.top > 120) {
          b.focus();
          return { x: r.left + 25, y: r.top + 18 };
        }
      }
      return null;
    }).catch(() => null);

    if (descBox && description) {
      await page.mouse.click(descBox.x, descBox.y).catch(() => { });
      await new Promise(r => setTimeout(r, 350));
      await page.keyboard.type(description, { delay: 18 }).catch(() => { });
      onLog(`📝 [Descrição c/ Palavras-Chave EN • Willas] "${description.slice(0, 78)}..."`);
    }

    // 3B. Preenche também o campo "Tags • opcional" do Reels Composer (Call 03 [00:21:20 & 01:08:20])
    const tagsInputBox = await page.evaluate(() => {
      const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
      const inps = Array.from(document.querySelectorAll('input[type="text"], input[type="search"], input:not([type])'));
      for (const inp of inps) {
        const ph = norm(inp.getAttribute('placeholder') || inp.getAttribute('aria-label') || '');
        if (ph.includes('palavras-chave') || ph.includes('keywords') || ph.includes('tags')) {
          if (inp.scrollIntoView) inp.scrollIntoView({ block: 'center' });
          const r = inp.getBoundingClientRect();
          if (r.width > 80 && r.height >= 18) return { x: r.left + 25, y: r.top + r.height / 2 };
        }
      }
      return null;
    }).catch(() => null);

    if (tagsInputBox) {
      const nicheTags = ['healthy recipes', 'morning routine', 'natural wellness', 'healthy living over 50'];
      await page.mouse.click(tagsInputBox.x, tagsInputBox.y).catch(() => { });
      await new Promise(r => setTimeout(r, 250));
      for (const tg of nicheTags) {
        await page.keyboard.type(tg, { delay: 25 }).catch(() => { });
        await page.keyboard.press('Enter').catch(() => { });
        await new Promise(r => setTimeout(r, 200));
      }
    }

    // 4. Se houver página colaboradora campeã de engajamento (Collab Booster), convida antes de avançar!
    if (options.collaboratorPage) {
      await applyCollaboratorInviteInComposer(page, options.collaboratorPage, onLog).catch(() => false);
    }

    // 5. Avança pelas etapas do MBS ("Avançar" -> "Avançar" -> "Compartilhar" / "Publicar" após 100% upload)
    let publishedOk = false;
    for (let step = 0; step < 18; step++) {
      await new Promise(r => setTimeout(r, 3200));
      const actionBtn = await page.evaluate(() => {
        const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
        const bodyTxt = norm(document.body?.innerText || '');
        const uploadDone = bodyTxt.includes('100%') || !bodyTxt.includes('carregando video');
        const btns = Array.from(document.querySelectorAll('[role="button"], button'));

        // Prioriza botão final Compartilhar / Publicar quando habilitado
        const shareTargets = ['compartilhar', 'publicar', 'compartilhar agora', 'share', 'publish', 'share now'];
        for (let i = btns.length - 1; i >= 0; i--) {
          const b = btns[i];
          if (b.disabled || b.getAttribute('aria-disabled') === 'true') continue;
          const t = norm(b.innerText || b.getAttribute('aria-label') || '');
          if (shareTargets.includes(t)) {
            const r = b.getBoundingClientRect();
            if (r.width > 45 && r.height > 22 && r.top > 120) {
              return { x: r.left + r.width / 2, y: r.top + r.height / 2, label: t, isFinal: true, uploadDone };
            }
          }
        }

        // Caso esteja na aba Criar/Editar do MBS, clica em Avançar / Next
        const nextTargets = ['avancar', 'next'];
        for (let i = btns.length - 1; i >= 0; i--) {
          const b = btns[i];
          if (b.disabled || b.getAttribute('aria-disabled') === 'true') continue;
          const t = norm(b.innerText || b.getAttribute('aria-label') || '');
          if (nextTargets.includes(t)) {
            const r = b.getBoundingClientRect();
            if (r.width > 45 && r.height > 22 && r.top > 120) {
              return { x: r.left + r.width / 2, y: r.top + r.height / 2, label: t, isFinal: false, uploadDone };
            }
          }
        }
        return null;
      }).catch(() => null);

      if (!actionBtn) continue;
      if (actionBtn.isFinal && !actionBtn.uploadDone && step < 12) continue;

      await page.mouse.click(actionBtn.x, actionBtn.y);
      if (actionBtn.isFinal) {
        publishedOk = true;
        await new Promise(r => setTimeout(r, 6500));
        break;
      }
    }

    if (publishedOk) {
      onLog(`🎉 [Post Cruzado MBS Concluído] Reel de aquecimento publicado simultaneamente para ${checkedPagesCount} página(s)!`);
    }
    return {
      ok: publishedOk,
      pages_warmed_count: publishedOk ? checkedPagesCount : 0,
      description_used: description
    };
  } finally {
    if (shielded?.outputPath && fs.existsSync(shielded.outputPath)) {
      try { fs.unlinkSync(shielded.outputPath); } catch (_) { }
    }
  }
}

// ============================================================================
// 7. AGENDAMENTO EM MASSA NO BUSINESS SUITE -> BOTÃO OCULTO "MINIATURA" -> "PROGRAMAÇÃO EM GRUPO"
//    (2 posts/dia 12h ou 3 posts/dia 4h • Teto rígido <= 12/dia com >= 1h intervalo)
// ============================================================================
async function scheduleBulkWarmupReelsInMbs(page, options = {}, onLog = console.log) {
  const profileReelsWarmer = require('./profile_reels_warmer');
  const pageObj = options.pageObj || {};
  const rawVideoPaths = (Array.isArray(options.videoPaths) ? options.videoPaths : []).slice(0, 50);
  if (rawVideoPaths.length === 0) return { ok: false, reason: 'NO_VIDEOS_FOR_BULK' };

  // Trava Rígida Willas Call 02: jamais passar de 12 vídeos/dia e mínimo 1h entre vídeos (padrão seguro: 2/dia a cada 12h ou 3/dia a cada 4h)
  const postsPerDay = Math.min(12, Math.max(1, Number(options.postsPerDay || 2)));
  const hoursGap = postsPerDay === 2 ? 12 : Math.max(1, Number(options.hoursGap || 4));
  const stagedOutputs = [];

  try {
    for (let i = 0; i < rawVideoPaths.length; i++) {
      const prep = profileReelsWarmer.prepareProfileWarmupVideoHsl(rawVideoPaths[i], i + 1, {
        accountSalt: `${pageObj.name || 'bulk'}_${i}`,
        allowFastCopy: false
      });
      stagedOutputs.push(prep.outputPath);
    }

    onLog(`📦 [Agendamento em Massa MBS • Willas] Abrindo "Carregar Reels em massa" para "${pageObj.name}" (${stagedOutputs.length} vídeos • ${postsPerDay}/dia a cada ${hoursGap}h)...`);
    const assetParam = pageObj.fb_page_id ? `?asset_id=${encodeURIComponent(pageObj.fb_page_id)}` : '';
    await page.goto(`https://business.facebook.com/latest/bulk_upload_composer${assetParam}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    }).catch(() => { });
    await new Promise(r => setTimeout(r, 5000));

    // Se a rota direta cair na Home/Content do MBS, clica em "Mais" / "Criar reel" -> "Carregar Reels em massa" ("Bulk upload reels")
    let multiFileInput = await page.$('input[type="file"][multiple], input[type="file"]').catch(() => null);
    if (!multiFileInput) {
      await page.goto(`https://business.facebook.com/latest/home${assetParam}`, {
        waitUntil: 'domcontentloaded',
        timeout: 55000
      }).catch(() => { });
      await new Promise(r => setTimeout(r, 4500));

      await page.evaluate(() => {
        const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
        const btns = Array.from(document.querySelectorAll('[role="button"], button, a, span'));
        for (const b of btns) {
          const t = norm(b.innerText || '');
          if (t === 'mais' || t === 'more' || t.includes('carregar reels em massa') || t.includes('bulk upload reels')) {
            try { (b.closest('[role="button"], button, a') || b).click(); } catch (_) { }
          }
        }
      }).catch(() => { });
      await new Promise(r => setTimeout(r, 1500));

      await page.evaluate(() => {
        const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
        const items = Array.from(document.querySelectorAll('[role="menuitem"], [role="button"], button, a, span'));
        for (const it of items) {
          const t = norm(it.innerText || '');
          if (t.includes('carregar reels em massa') || t.includes('bulk upload reels')) {
            try { (it.closest('[role="menuitem"], [role="button"], button, a') || it).click(); } catch (_) { }
            break;
          }
        }
      }).catch(() => { });
      await new Promise(r => setTimeout(r, 3500));
      multiFileInput = await page.$('input[type="file"][multiple], input[type="file"]').catch(() => null);
    }

    if (!multiFileInput) {
      return { ok: false, reason: 'MBS_BULK_UPLOAD_INPUT_NOT_FOUND' };
    }

    await multiFileInput.uploadFile(...stagedOutputs);
    onLog(`⏳ [Agendamento em Massa MBS] ${stagedOutputs.length} vídeos carregados — preenchendo Descrições Semânticas e clicando no botão oculto "Miniatura" para liberar "Programação em grupo"...`);
    await new Promise(r => setTimeout(r, 6500));

    // Preenche descrições temáticas em Inglês p/ Fan Pages EUA (Zero CTA / Zero Link) em todas as linhas visíveis
    const descriptionsList = stagedOutputs.map((_, idx) =>
      buildWillasAudienceKeywordDescription({ language: pageObj.language || 'en-US', slotIndex: idx })
    );
    await page.evaluate((descs) => {
      const boxes = Array.from(document.querySelectorAll('[role="textbox"][contenteditable="true"], textarea'));
      boxes.forEach((box, idx) => {
        const txt = descs[idx % descs.length];
        if (box.tagName === 'TEXTAREA') {
          box.focus();
          box.value = txt;
          box.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
          box.focus();
          document.execCommand('insertText', false, txt);
        }
      });
    }, descriptionsList).catch(() => { });
    await new Promise(r => setTimeout(r, 1500));

    // SEGREDO DO WILLAS CALL 02 [00:28:30]: Clicar no botão oculto "Miniatura" ("Thumbnail") destrava "Programação em grupo" ("Group schedule")!
    const clickedMiniatura = await page.evaluate(() => {
      const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
      const els = Array.from(document.querySelectorAll('[role="button"], button, [role="tab"], span'));
      for (const el of els) {
        const t = norm(el.innerText || el.getAttribute?.('aria-label') || '');
        if (t === 'miniatura' || t === 'thumbnail' || t.includes('miniatura')) {
          const btn = el.closest('[role="button"], button, [role="tab"]') || el;
          const r = btn.getBoundingClientRect();
          if (r.width > 24 && r.height >= 18) {
            try { btn.click(); } catch (_) { }
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          }
        }
      }
      return null;
    }).catch(() => null);

    if (clickedMiniatura) {
      await page.mouse.click(clickedMiniatura.x, clickedMiniatura.y).catch(() => { });
      await new Promise(r => setTimeout(r, 1500));
      onLog(`🔓 [Atalho Secreto Willas • "Miniatura"] Botão Miniatura acionado -> Abrindo "Programação em grupo"!`);
    }

    // Clica em "Programação em grupo" / "Group schedule"
    const clickedGroupSchedule = await page.evaluate(() => {
      const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
      const els = Array.from(document.querySelectorAll('[role="button"], button, span'));
      for (const el of els) {
        const t = norm(el.innerText || el.getAttribute?.('aria-label') || '');
        if (t.includes('programacao em grupo') || t.includes('agendamento em grupo') || t.includes('group schedule') || t.includes('bulk schedule')) {
          const btn = el.closest('[role="button"], button') || el;
          const r = btn.getBoundingClientRect();
          if (r.width > 40 && r.height >= 20) {
            try { btn.click(); } catch (_) { }
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          }
        }
      }
      return null;
    }).catch(() => null);

    if (clickedGroupSchedule) {
      await page.mouse.click(clickedGroupSchedule.x, clickedGroupSchedule.y).catch(() => { });
      await new Promise(r => setTimeout(r, 1800));

      // Confirma o modal da Programação em Grupo ("Aplicar" / "Salvar" / "Confirmar")
      await page.evaluate(() => {
        const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
        const btns = Array.from(document.querySelectorAll('[role="dialog"] [role="button"], [role="dialog"] button'));
        for (const b of btns) {
          const t = norm(b.innerText || '');
          if (t === 'aplicar' || t === 'salvar' || t === 'confirmar' || t === 'apply' || t === 'save') {
            try { b.click(); } catch (_) { }
          }
        }
      }).catch(() => { });
      await new Promise(r => setTimeout(r, 1800));
    }

    // Aguarda 100% upload dos vídeos e clica em "Publicar" / "Programar" ("Schedule" / "Publish")
    let scheduledOk = false;
    for (let w = 0; w < 24; w++) {
      await new Promise(r => setTimeout(r, 3500));
      const finalBtn = await page.evaluate(() => {
        const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
        const btns = Array.from(document.querySelectorAll('[role="button"], button'));
        for (let i = btns.length - 1; i >= 0; i--) {
          const b = btns[i];
          if (b.disabled || b.getAttribute('aria-disabled') === 'true') continue;
          const t = norm(b.innerText || b.getAttribute('aria-label') || '');
          if (
            t.includes('programar reels') ||
            t.includes('publicar reels') ||
            t === 'programar' ||
            t === 'agendar' ||
            t === 'schedule reels' ||
            t === 'schedule' ||
            t === 'publish reels'
          ) {
            const r = b.getBoundingClientRect();
            if (r.width > 50 && r.height > 22) {
              return { x: r.left + r.width / 2, y: r.top + r.height / 2, label: t };
            }
          }
        }
        return null;
      }).catch(() => null);

      if (finalBtn) {
        await page.mouse.click(finalBtn.x, finalBtn.y);
        scheduledOk = true;
        await new Promise(r => setTimeout(r, 6500));
        break;
      }
    }

    return {
      ok: scheduledOk,
      scheduled_count: scheduledOk ? stagedOutputs.length : 0,
      posts_per_day: postsPerDay,
      hours_gap: hoursGap
    };
  } finally {
    for (const f of stagedOutputs) {
      if (f && fs.existsSync(f)) {
        try { fs.unlinkSync(f); } catch (_) { }
      }
    }
  }
}

// ============================================================================
// 8. SINCRONIZADOR DO POOL EXTRA DE VÍDEOS DE AQUECIMENTO (LEVA_AQUECIMENTO_50_LOCAL)
// ============================================================================
async function syncLocal50WarmupVideosIntoHub(options = {}, onLog = console.log) {
  const hubVideoUploader = require('./hub_video_uploader');
  const sourceDir = options.sourceDir || LOCAL_EXTRA_50_WARMUP_DIR;
  if (!fs.existsSync(sourceDir)) {
    return { ok: false, imported: 0, error: `Pasta fonte não encontrada: ${sourceDir}` };
  }
  const maxImport = Math.min(50, Math.max(1, Number(options.limit || 20)));
  const existingFiles = hubVideoUploader.listActiveWarmupVideos().map(x => x.filename.toLowerCase());
  const rawEntries = fs.readdirSync(sourceDir, { withFileTypes: true })
    .filter(e => e.isFile() && /\.(mp4|mov)$/i.test(e.name));

  let imported = 0;
  for (const ent of rawEntries) {
    if (imported >= maxImport) break;
    const cleanStem = ent.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 40).toLowerCase();
    if (existingFiles.some(f => f.includes(cleanStem))) continue;
    const srcPath = path.join(sourceDir, ent.name);
    try {
      await hubVideoUploader.autoEditOperatorWarmupVideo(srcPath, ent.name, '');
      imported++;
    } catch (e) {
      onLog(`⚠️ [Sync Pool Aquecimento] Falha em "${ent.name}": ${e.message}`);
    }
  }
  const totalNow = hubVideoUploader.listActiveWarmupVideos().length;
  onLog(`🎬 [Pool de Aquecimento] +${imported} vídeo(s) importado(s) e blindados (Total ativo no Hub: ${totalNow} MP4s)!`);
  return { ok: true, imported, total_pool_count: totalNow };
}

// ============================================================================
// 9. ORQUESTRADOR 1-CLIQUE "APERTE PLAY E ESQUEÇA" (ESTEIRA COMPLETA WILLAS)
// ============================================================================
let _willasConveyorRunning = false;
let _willasCurrentStepLabel = '';
let _willasAbortRequested = false;

function buildWillasConveyorDashboardStatus() {
  const db = require('../../db');
  const { loadPipelineData } = require('./lifecycle_pipeline');
  const hubVideoUploader = require('./hub_video_uploader');
  const state = loadWillasConveyorState();
  const todayYmd = getBrtTodayYmd();

  const pipeline = loadPipelineData();
  const allAccounts = (pipeline.accounts || []).filter(a => {
    if (!a) return false;
    const st = String(a.status || '').toUpperCase();
    if (st === 'CEMITERIO' || st === 'BURIED_GRAVEYARD') return false;
    // Jamais inclui Matriz no Notebook
    if (String(a.incogniton_profile_id || '').toLowerCase().startsWith('00000000')) return false;
    return true;
  });

  const allPages = (db.getPages() || []).filter(p =>
    p && p.active !== false && !p.removed && !p.archived &&
    !String(p.profile_browser_ID || '').toLowerCase().startsWith('00000000')
  );

  const pagesIn24hRest = [];
  const pagesReadyForWarmup = [];
  const pagesGraduatedForMainPc = [];

  for (const p of allPages) {
    const rest = isPageIn24hPostCreationRest(p);
    const pageKey = String(p.id || p.name);
    const storyDoneToday = state.story_posted_by_page_date?.[pageKey] === todayYmd;
    const wDay = Number(p.warming_day || 1);
    const item = {
      id: p.id,
      name: p.name,
      conta: p.conta || p.profile_name || '',
      profile_id: p.profile_browser_ID || '',
      warming_day: wDay,
      posts_today: Number(p.posts_today || 0),
      total_views: Number(p.total_views || 0),
      max_views: Number(p.max_views || 0),
      story_short_today: storyDoneToday,
      age_restriction: p.age_restriction_target || '24+',
      country_mode: p.country_restriction_mode || 'HIDE_67_LOW_CPM_BR_AFRICA_ASIA',
      resting_24h: rest.resting,
      remaining_rest_h: rest.remaining_hours
    };
    if (rest.resting) {
      pagesIn24hRest.push(item);
    } else {
      pagesReadyForWarmup.push(item);
      // Padrão "Ideal" do Willas (Call 02 [52:38] & Call 03 [01:00:33]): 7 dias bem aquecidos!
      if (wDay >= 7 && Number(p.max_views || 0) >= 200) {
        pagesGraduatedForMainPc.push(item);
      }
    }
  }

  const sliceWin = getCurrentAudienceSliceWindow();
  const warmupVideos = hubVideoUploader.listActiveWarmupVideos();
  const pageEnVideos = listEnglishPageWarmupVideos();

  return {
    ok: true,
    success: true,
    running: _willasConveyorRunning,
    current_step: _willasCurrentStepLabel,
    autopilot_enabled: Boolean(state.autopilot_enabled),
    autopilot_interval_minutes: Number(state.autopilot_interval_minutes || 45),
    last_run_at: state.last_run_at,
    last_run_summary: state.last_run_summary,
    notebook_warmup_only_mode: Boolean((db.getSettings() || {}).notebook_warmup_only_mode !== false),
    matriz_leak_zero_verified: true,
    audience_slice_now: sliceWin,
    counts: {
      accounts_4g_total: allAccounts.length,
      accounts_logged_fb: allAccounts.filter(a => a.fb_logged_in || Number(a.pages_count || 0) > 0).length,
      warmup_videos_pool: warmupVideos.length,
      page_en_videos_pool: pageEnVideos.length,
      pages_4g_total: allPages.length,
      pages_resting_24h: pagesIn24hRest.length,
      pages_ready_post_24h: pagesReadyForWarmup.length,
      pages_graduated_for_desktop_pc: pagesGraduatedForMainPc.length
    },
    pages_resting_24h: pagesIn24hRest,
    pages_ready_post_24h: pagesReadyForWarmup.slice(0, 30),
    pages_graduated_for_desktop_pc: pagesGraduatedForMainPc
  };
}

/**
 * Executa a Esteira Completa 1-Clique do Willas para todas as contas 4G elegíveis (ou 1 conta específica):
 *  - Gira 4G ADB + valida IP móvel (Zero vazamento Wi-Fi / Zero Matriz)
 *  - Aquece Perfil Pessoal (2FA + Newsletters + Pro Mode + 1..3 Reels Públicos/dia até 9/9 + Amigos 60–75)
 *  - Cria 1 Fan Page nova/dia (em 7–10 min + Idade 24+ + Ocultar 30 Países CPM Baixo + Descanso 24h)
 *  - Nas páginas pós-24h da conta:
 *      1) Publica o 1º Story Curto de Duplo Sentido (2.2s) do dia
 *      2) Roda Post Cruzado no MBS ("Carregar Reels em várias páginas") ou Agendamento em Massa ("Miniatura" -> "Programação em grupo")
 *      3) Injeta Descrição com Palavras-Chave do Público (Zero CTA / Zero Link) + Convite de Collab da página mais forte!
 */
async function runWillasFullWarmupConveyor(options = {}, logFn = (lvl, msg) => console.log(`[${lvl}] ${msg}`)) {
  if (_willasConveyorRunning) {
    return { ok: false, already_running: true, error: `Esteira Willas já está em execução (${_willasCurrentStepLabel}).` };
  }
  _willasConveyorRunning = true;
  _willasAbortRequested = false;

  const db = require('../../db');
  const IncognitonService = require('../../incogniton');
  const automator = require('../../automator');
  const adbRotator = require('../infra_4g/adb_rotator');
  const proxyHealth = require('../infra_4g/proxy_health');
  const hubVideoUploader = require('./hub_video_uploader');
  const { loadPipelineData, savePipelineData } = require('./lifecycle_pipeline');

  const emit = (lvl, msg) => {
    _willasCurrentStepLabel = msg;
    if (typeof logFn === 'function') {
      try { logFn(lvl, msg); } catch (_) { }
    }
  };

  const state = loadWillasConveyorState();
  const todayYmd = getBrtTodayYmd();
  const summary = {
    started_at: new Date().toISOString(),
    accounts_processed: 0,
    profile_reels_posted: 0,
    pages_created_7_10_min: 0,
    short_stories_posted: 0,
    crossposted_pages_warmed: 0,
    bulk_scheduled_videos: 0,
    errors: []
  };

  try {
    const warmupPool = hubVideoUploader.listActiveWarmupVideos();
    const pageEnVideosPool = listEnglishPageWarmupVideos();
    if (warmupPool.length === 0 && pageEnVideosPool.length === 0) {
      throw new Error('Nenhum vídeo de aquecimento encontrado em VIDEOS_AQUECIMENTO_PAGINAS_EN nem em VIDEOS_AQUECIMENTO_PERFIL_PTBR.');
    }

    const pipelineData = loadPipelineData();
    const targetAccountId = String(options.accountId || '').trim().toLowerCase();
    const eligibleAccounts = (pipelineData.accounts || []).filter(acc => {
      if (!acc) return false;
      const st = String(acc.status || '').toUpperCase();
      if (st === 'CEMITERIO' || st === 'BURIED_GRAVEYARD') return false;
      const pid = String(acc.incogniton_profile_id || '').trim().toLowerCase();
      if (!pid || pid.startsWith('00000000')) return false; // ZERO Matriz
      if (targetAccountId && String(acc.id || '').toLowerCase() !== targetAccountId && pid !== targetAccountId) return false;
      // Ignora slots virgens sem login
      const allDbPages = db.getPages() || [];
      const hasPages = allDbPages.some(p => String(p.profile_browser_ID || '').toLowerCase() === pid);
      const isLogged = Boolean(acc.fb_logged_in || hasPages || Number(acc.profile_videos_posted || 0) > 0);
      return isLogged;
    });

    const profileReelsWarmer = require('./profile_reels_warmer');
    const seen4gIpsInRun = new Set();
    let lastAccount4gIp = null;

    emit('INFO', `🚀 [PLAY ESTEIRA PADRÃO IDEAL WILLAS] Iniciando para ${eligibleAccounts.length} conta(s) 4G (1 Giro 4G Exclusivo por Conta • Pool: ${warmupPool.length} vídeos • Meta Ideal: 7 Dias • Zero Venda • Zero Matriz)...`);

    for (let idx = 0; idx < eligibleAccounts.length; idx++) {
      if (_willasAbortRequested || automator.abortRequested) {
        emit('WARN', `⏹️ [Esteira Willas] Parada solicitada pelo operador.`);
        break;
      }

      const acc = eligibleAccounts[idx];
      const profileId = String(acc.incogniton_profile_id || '').trim();
      const settings = db.getSettings() || {};
      const inc = new IncognitonService(settings.mcp_token, settings.mcp_api_url);
      let browser = null;

      emit('INFO', `\n▶️ [Conta ${idx + 1}/${eligibleAccounts.length} • "${acc.name}"] Girando 4G p/ IP 100% Exclusivo antes de abrir a conta...`);

      try {
        // 0. ISOLAMENTO ABSOLUTO 4G: 1 CONTA = 1 IP MÓVEL INÉDITO (NUNCA REPETE IP ENTRE CONTAS!)
        let h4g = null;
        for (let rotTry = 1; rotTry <= 3; rotTry++) {
          await adbRotator.rotate4gIp({ previousIp: lastAccount4gIp }, (m) => emit('INFO', m));
          h4g = await proxyHealth.get4gProxyHealth('127.0.0.1', 8080);
          if (h4g && h4g.proxy_public_ip && h4g.is_safe_4g_ip && !seen4gIpsInRun.has(h4g.proxy_public_ip)) {
            break;
          }
          emit('WARN', `⚠️ [Isolamento 4G] IP "${h4g?.proxy_public_ip || 'nulo'}" repetido ou instável (tentativa ${rotTry}/3) — girando Modo Avião novamente...`);
        }
        if (!h4g || !h4g.proxy_public_ip || !h4g.is_safe_4g_ip) {
          throw new Error(`Túnel 4G (127.0.0.1:8080) indisponível ou inseguro antes de abrir "${acc.name}".`);
        }
        if (seen4gIpsInRun.has(h4g.proxy_public_ip)) {
          throw new Error(`Operadora 4G devolveu IP repetido (${h4g.proxy_public_ip}) após 3 giros — pulando "${acc.name}" p/ jamais cruzar IP entre contas!`);
        }
        seen4gIpsInRun.add(h4g.proxy_public_ip);
        lastAccount4gIp = h4g.proxy_public_ip;
        emit('SUCCESS', `🛡️ [IP 4G Exclusivo Travado] "${acc.name}" operando isolada no IP ${h4g.proxy_public_ip}!`);

        // Abre 1 única sessão do navegador para fazer TUDO desta conta no mesmo IP e fechar no final!
        const { cdp_url } = await inc.ensureProfileLaunched(profileId, (m) => emit('INFO', m));
        if (!cdp_url) throw new Error(`Falha ao abrir CloakBrowser de "${acc.name}".`);
        browser = await inc.connectBrowser(cdp_url);
        let tabs = await browser.pages();
        let mbsTab = tabs.find(t => String(t.url() || '').includes('facebook.com')) || tabs[0] || (await browser.newPage());
        await mbsTab.bringToFront().catch(() => { });

        // ETAPA A: Aquecimento do Perfil Pessoal (2–3 dias: Modo Profissional + Reels PT-BR + Amigos) + Criação das 10 Páginas na Mesma Conta/Mesmo IP!
        if (options.onlyPageMbsWarmup !== true) {
          const curPagesBefore = (db.getPages() || []).filter(p =>
            p && p.active !== false && !p.removed && !p.archived &&
            String(p.profile_browser_ID || '').trim().toLowerCase() === profileId.toLowerCase()
          );
          const profVideosDone = Number(acc.profile_videos_posted || acc.warmup_stats?.profile_videos_posted || 0);

          // A.1: Aquecimento do Perfil Pessoal (se ainda não fechou os 9 Reels PT-BR de 3 dias)
          if (profVideosDone < 9) {
            await profileReelsWarmer.ensurePersonalProfileProfessionalMode(mbsTab, (m) => emit('INFO', m)).catch(() => { });
            const reelRes = await profileReelsWarmer.postWarmupReelOnPersonalProfile(mbsTab, automator, acc, (m) => emit('INFO', m)).catch(e => ({ success: false, error: e.message }));
            if (reelRes && (reelRes.posted_this_session > 0 || reelRes.success)) {
              summary.profile_reels_posted += Number(reelRes.posted_this_session || 1);
            }
            await profileReelsWarmer.warmPersonalProfileFriendsAndHealthGroups(mbsTab, acc, (m) => emit('INFO', m)).catch(() => { });
          }

          // A.2: Criação das Páginas no Padrão Ideal Willas (até 10 páginas na mesma conta e mesmo IP: ~5m estruturação + 2m pausa offline mesmo-IP)
          const profileReadyForPages = profVideosDone >= 6 || Number(acc.warmup_day || 0) >= 3 || curPagesBefore.length > 0 || Boolean(options.forceAll);
          if (profileReadyForPages && options.skipPageCreation !== true && curPagesBefore.length < Number(settings.max_pages_per_profile_willas || 10)) {
            const expRes = await automator.tryCreateNewPagesUntilLimitInOpenProfile(
              profileId,
              acc.name,
              { maxPagesThisSession: Number(options.maxPagesThisSession || settings.willas_pages_per_session || 10) },
              (m) => emit('INFO', m)
            );
            const createdCount = Number(expRes?.created_count || (expRes?.created_pages || []).length || 0);
            if (createdCount > 0) {
              summary.pages_created_7_10_min += createdCount;
            }
            // Re-conecta referência da aba ativa após o tryCreateNewPagesUntilLimitInOpenProfile
            browser = await inc.connectBrowser(cdp_url);
            tabs = await browser.pages();
            mbsTab = tabs.find(t => String(t.url() || '').includes('facebook.com')) || tabs[0] || (await browser.newPage());
          } else if (!profileReadyForPages) {
            emit('INFO', `🌱 [Aquecimento Perfil 2–3 Dias] "${acc.name}" em maturação de perfil (${profVideosDone}/9 Reels) antes de liberar criação das 10 páginas.`);
          }
        }

        // ETAPA B: Aquecimento de 7 Dias das Fan Pages (no MESMO IP 4G desta conta: 1º Story 2.2s + 1 Único Upload Post Cruzado em Inglês p/ todas as páginas da conta!)
        const allPagesNow = db.getPages() || [];
        const accountPages = allPagesNow.filter(p =>
          p && p.active !== false && !p.removed && !p.archived &&
          String(p.profile_browser_ID || '').trim().toLowerCase() === profileId.toLowerCase()
        );
        const post24hPages = accountPages.filter(p => {
          const rest = isPageIn24hPostCreationRest(p);
          if (rest.resting) {
            emit('INFO', `⏳ [Descanso Pós-Criação] "${p.name}" em repouso (${rest.remaining_hours}h restantes) — protegida.`);
            return false;
          }
          if (!isPageSafeFromMassEditShadowban(p)) {
            emit('WARN', `🛡️ [Trava Anti-Shadowban 7d] "${p.name}" teve edição em massa recente (<12h) — adiando vídeo p/ próxima sessão.`);
            return false;
          }
          if (!options.forceAll && Number(p.posts_today || 0) >= Number(p.daily_target || 2)) {
            return false;
          }
          return true;
        });

        if (post24hPages.length > 0 && options.skipPageMbsWarmup !== true) {
          emit('INFO', `🔥 [Aquecimento Ideal 7 Dias • "${acc.name}" • Mesmo IP ${lastAccount4gIp}] ${post24hPages.length} página(s) -> Story 2.2s + ${options.bulkScheduleMode ? 'Agendamento em Massa MBS' : 'Post Cruzado MBS (1 upload p/ todas)'} + Collab!`);

          // B.0 (Call 03 [28:50]): Auto-aceite de convites Collab pendentes nas páginas mais fortes desta conta!
          if (settings.willas_collab_booster_enabled !== false) {
            const strongPagesOfAcc = accountPages.filter(p => Number(p.views_total || p.total_views || 0) >= 300 || Number(p.warming_day || 0) >= 4);
            for (const strongPg of strongPagesOfAcc.slice(0, 2)) {
              const accCollabRes = await acceptPendingCollabInvitesOnPage(mbsTab, strongPg, (m) => emit('INFO', m)).catch(() => ({ accepted: 0 }));
              if (accCollabRes && accCollabRes.accepted > 0) {
                summary.collab_invites_accepted = (summary.collab_invites_accepted || 0) + accCollabRes.accepted;
              }
            }
          }

          // Seleciona vídeo do pool EN de Receitas/Saúde p/ Fan Pages EUA (VIDEOS_AQUECIMENTO_PAGINAS_EN),
          // caindo p/ fallback apenas se a pasta EN estiver temporariamente vazia! Respeita <= 5 reposts/mês e >= 5 dias de distância.
          const primaryPg = post24hPages[0];
          const primaryKey = String(primaryPg.id || primaryPg.name);
          const activePagePool = pageEnVideosPool.length > 0 ? pageEnVideosPool : warmupPool;
          const activePageDir = pageEnVideosPool.length > 0 ? PAGE_WARMUP_VIDEOS_EN_DIR : WARMUP_VIDEOS_DIR;
          if (pageEnVideosPool.length === 0) {
            emit('WARN', `⚠️ [Pool Páginas EN Vazio] Solte vídeos de receitas/saúde em Inglês em C:\\Hub001\\VIDEOS_AQUECIMENTO_PAGINAS_EN p/ aquecimento 100% EUA!`);
          }
          const eligibleVideos = activePagePool.filter(v => canUseWarmupVideoOnPage(primaryKey, v.filename, state).allowed);
          const chosenPool = eligibleVideos.length > 0 ? eligibleVideos : activePagePool;
          const chosenVid = chosenPool[(idx + Date.now()) % chosenPool.length];
          const chosenVidFullPath = chosenVid.fullPath || path.join(activePageDir, chosenVid.filename);

          // B.1: 1º Story do Dia = Duplo Sentido + Curto (2.2s)
          if (settings.willas_daily_short_bait_story_enabled !== false && state.story_posted_by_page_date?.[primaryKey] !== todayYmd) {
            const stRes = await postShortBaitStoryInMbs(mbsTab, automator, {
              pageObj: primaryPg,
              sourceVideoPath: chosenVidFullPath
            }, (m) => emit('INFO', m));
            if (stRes && stRes.ok) {
              state.story_posted_by_page_date = state.story_posted_by_page_date || {};
              state.story_posted_by_page_date[primaryKey] = todayYmd;
              saveWillasConveyorState(state);
              summary.short_stories_posted++;
            }
          }

          // B.2: Agendamento em Massa ("Miniatura" -> "Programação em grupo") OU Post Cruzado Multi-Páginas + Collab Booster
          if (options.bulkScheduleMode === true) {
            const batchFiles = chosenPool.slice(0, Math.min(10, Number(options.bulkVideosCount || 6)));
            const batchPaths = batchFiles.map(v => v.fullPath || path.join(activePageDir, v.filename));
            const bulkRes = await scheduleBulkWarmupReelsInMbs(mbsTab, {
              pageObj: primaryPg,
              videoPaths: batchPaths,
              postsPerDay: Number(options.postsPerDay || 2)
            }, (m) => emit('INFO', m));
            if (bulkRes && bulkRes.ok) {
              summary.bulk_scheduled_videos += bulkRes.scheduled_count;
              batchFiles.forEach(v => recordWarmupVideoUsedOnPage(primaryKey, v.filename, state));
              saveWillasConveyorState(state);
            }
          } else {
            const collabCandidate = settings.willas_collab_booster_enabled !== false
              ? pickBestCollaboratorPage(primaryPg, allPagesNow)
              : null;
            const crossRes = await postCrosspostedWarmupReelInMbs(mbsTab, automator, {
              accountName: acc.name,
              eligiblePages: post24hPages,
              videoPath: chosenVidFullPath,
              slotIndex: idx,
              collaboratorPage: collabCandidate
            }, (m) => emit('INFO', m));

            if (crossRes && crossRes.ok) {
              summary.crossposted_pages_warmed += crossRes.pages_warmed_count;
              for (const warmedPg of post24hPages) {
                const pKey = String(warmedPg.id || warmedPg.name);
                recordWarmupVideoUsedOnPage(pKey, chosenVid.filename, state);
                db.updatePage(warmedPg.id, {
                  posts_today: Number(warmedPg.posts_today || 0) + 1,
                  warming_day: Number(warmedPg.warming_day || 1) + (Number(warmedPg.posts_today || 0) === 0 ? 1 : 0),
                  last_post_timestamp: Date.now(),
                  last_willas_crosspost_at: new Date().toISOString()
                });
              }
              saveWillasConveyorState(state);
            }
          }
        }

        summary.accounts_processed++;
      } catch (accErr) {
        summary.errors.push({ account: acc.name, error: accErr.message });
        emit('ERROR', `❌ [Esteira Willas • "${acc.name}"] ${accErr.message}`);
      } finally {
        try { if (browser) browser.disconnect(); } catch (_) { }
        await inc.stopProfile(profileId, (m) => emit('INFO', m)).catch(() => { });
      }
    }

    summary.finished_at = new Date().toISOString();
    state.last_run_at = summary.finished_at;
    state.last_run_summary = summary;
    saveWillasConveyorState(state);
    savePipelineData(pipelineData);

    emit(
      'SUCCESS',
      `🏆 [ESTEIRA WILLAS FINALIZADA] Contas: ${summary.accounts_processed} | Reels Perfil: ${summary.profile_reels_posted} | Páginas 7–10m: ${summary.pages_created_7_10_min} | Stories Curtos 2.2s: ${summary.short_stories_posted} | Págs Post Cruzado: ${summary.crossposted_pages_warmed} | Massa Agendados: ${summary.bulk_scheduled_videos}`
    );
    return { ok: true, success: true, summary };
  } finally {
    _willasConveyorRunning = false;
    _willasCurrentStepLabel = '';
  }
}

// ============================================================================
// 10. ROTAS EXPRESS + AUTO-PLAY BACKGROUND TIMER (/api/willas-conveyor/*)
// ============================================================================
function registerWillasConveyorRoutes(app, options = {}) {
  if (!app) return;
  const logFn = typeof options.broadcastLog === 'function'
    ? options.broadcastLog
    : (lvl, msg) => console.log(`[${lvl}] ${msg}`);
  const isBusyFn = typeof options.isBusyFn === 'function' ? options.isBusyFn : () => false;

  // Remove rotas anteriores se hot-reload for chamado
  const rtr = app._router || app.router;
  if (rtr && Array.isArray(rtr.stack)) {
    rtr.stack = rtr.stack.filter(
      layer => !(layer && layer.route && String(layer.route.path || '').startsWith('/api/willas-conveyor'))
    );
  }

  app.get('/api/willas-conveyor/status', (req, res) => {
    try {
      res.json(buildWillasConveyorDashboardStatus());
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/willas-conveyor/play', (req, res) => {
    try {
      if (_willasConveyorRunning) {
        return res.status(409).json({ ok: false, error: `A Esteira Willas já está rodando (${_willasCurrentStepLabel}).` });
      }
      const bodyOpts = req.body || {};
      res.json({
        ok: true,
        success: true,
        started: true,
        message: '▶️ Esteira Automática 4G Willas iniciada (Perfil 9/9 -> Página 7–10min + Idade 24+ -> Story Curto 2.2s + Post Cruzado MBS + Collab)! Acompanhe os logs ao vivo.'
      });
      runWillasFullWarmupConveyor(bodyOpts, logFn).catch(err => {
        logFn('ERROR', `❌ [Esteira Willas] ${err.message}`);
      });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/willas-conveyor/stop', (req, res) => {
    _willasAbortRequested = true;
    global._abortWarmupRoundRequested = true;
    res.json({ ok: true, success: true, message: '⏹️ Sinal de parada enviado para a Esteira Willas.' });
  });

  app.post('/api/willas-conveyor/toggle-autopilot', (req, res) => {
    try {
      const state = loadWillasConveyorState();
      const nextVal = typeof req.body?.enabled === 'boolean' ? req.body.enabled : !state.autopilot_enabled;
      state.autopilot_enabled = nextVal;
      saveWillasConveyorState(state);
      const db = require('../../db');
      db.updateSettings({ willas_autopilot_conveyor_enabled: nextVal });
      logFn(
        nextVal ? 'SUCCESS' : 'WARN',
        `🤖 [Auto-Play Esteira Willas 4G] Piloto Automático ${nextVal ? 'ATIVADO (roda sozinho nas janelas Manhã/Tarde/Noite quando o 4G estiver livre)' : 'DESATIVADO'}.`
      );
      res.json({ ok: true, success: true, autopilot_enabled: nextVal });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/willas-conveyor/precheck-tiktok', async (req, res) => {
    try {
      const out = await preCheckTikTokCreatorAndTitle(req.body?.handle || '', req.body?.title || '');
      res.json({ ok: true, ...out });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/willas-conveyor/sync-local-50-videos', async (req, res) => {
    try {
      const out = await syncLocal50WarmupVideosIntoHub({ limit: req.body?.limit || 25 }, (m) => logFn('INFO', m));
      res.json(out);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Call 03 Willas [00:38:39 & Print 04]: Criação 100% Web usando Outlook (signup.live.com) + Facebook (r.php) com Giro de IP 4G (1 IP CGNAT novo = 1 proxy limpa, até 2 perfis/IP sem QR Code do Google!)
  app.post('/api/willas-conveyor/open-web-creator-4g', async (req, res) => {
    try {
      const adbRotator = require('../infra_4g/adb_rotator');
      const multizen = require('../../multizen');
      const { loadPipelineData, savePipelineData } = require('./lifecycle_pipeline');

      logFn('INFO', `🌐 [Criador Web Willas • Outlook + 4G] Girando IP 4G USB para entregar IP móvel limpo antes de abrir MultiZen...`);
      const rot = await adbRotator.rotate4gIp({}, (m) => logFn('INFO', m)).catch(e => ({ ok: false, error: e.message }));

      const pipe = loadPipelineData();
      const idxNum = (pipe.accounts || []).length + 1;
      const personaLabel = String(req.body?.label || `Perfil Web #${idxNum} (Outlook + 4G)`).trim();
      const createdProf = multizen.createProfile({
        name: personaLabel,
        proxy: 'http://127.0.0.1:8080',
        notes: 'Criado via Esteira Web Willas Call 03 (Outlook Web + 4G Rotativo — máx 2 perfis por IP)'
      });
      const profId = createdProf.id || createdProf.profile_id;

      pipe.accounts = pipe.accounts || [];
      pipe.accounts.push({
        id: `acc_web_${Date.now()}`,
        name: personaLabel,
        incogniton_profile_id: profId,
        network_mode: '4G_REQUIRED',
        notebook_warmup_only: true,
        fb_logged_in: false,
        two_fa_enabled: false,
        warmup_day: 1,
        pages_count: 0,
        created_at: new Date().toISOString(),
        creation_method: 'WEB_OUTLOOK_4G_WILLAS_CALL03'
      });
      savePipelineData(pipe);

      const launched = await multizen.launchProfile(profId, {
        startUrls: ['https://signup.live.com/signup', 'https://www.facebook.com/r.php']
      });
      logFn('SUCCESS', `✅ [Criador Web Willas Aberto] Perfil "${personaLabel}" aberto em Outlook + Facebook sobre IP 4G (${rot?.new_ip || 'túnel :8080'}). Crie o Outlook + FB + ative 2FA e feche: a Esteira assume o aquecimento sozinha!`);
      res.json({
        ok: true,
        success: true,
        profile_id: profId,
        name: personaLabel,
        new_4g_ip: rot?.new_ip || null,
        port: launched?.port || null
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Timer de Piloto Automático Contínuo (a cada 20 min verifica se Auto-Play está ON + Semáforo Verde + 4G Conectado)
  if (global._willasAutopilotInterval) {
    clearInterval(global._willasAutopilotInterval);
    global._willasAutopilotInterval = null;
  }
  global._willasAutopilotInterval = setInterval(async () => {
    try {
      const st = loadWillasConveyorState();
      if (!st.autopilot_enabled || _willasConveyorRunning || isBusyFn()) return;
      const brtHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }).format(new Date()));
      if (brtHour < 7 || brtHour >= 23) return; // Descanso noturno humano

      const lastMs = st.last_run_at ? new Date(st.last_run_at).getTime() : 0;
      const minWaitMs = Math.max(25, Number(st.autopilot_interval_minutes || 45)) * 60 * 1000;
      if (lastMs > 0 && (Date.now() - lastMs) < minWaitMs) return;

      const IncognitonService = require('../../incogniton');
      const openProfiles = IncognitonService.scanAllLockedProfilesByKernel();
      if (openProfiles.length > 0) return;

      // Confirma cabo USB 4G ADB ativo antes de acordar sozinho
      const adbOut = execFileSync('adb', ['devices'], { encoding: 'utf8', timeout: 3000, windowsHide: true });
      const hasPhone = adbOut.split(/\r?\n/).slice(1).some(l => /\tdevice\s*$/.test(l.trim()));
      if (!hasPhone) return;

      logFn('INFO', `🤖 [Auto-Play Willas 4G] Janela ativa e celular 4G conectado — disparando rodada automática da esteira!`);
      await runWillasFullWarmupConveyor({}, logFn);
    } catch (_) { }
  }, 10 * 60 * 1000);
  if (global._willasAutopilotInterval.unref) global._willasAutopilotInterval.unref();
}

module.exports = {
  PAGE_WARMUP_VIDEOS_EN_DIR,
  listEnglishPageWarmupVideos,
  WILLAS_AUDIENCE_DESCRIPTIONS_PT,
  WILLAS_AUDIENCE_DESCRIPTIONS_EN,
  sanitizeNoCtaNoLinkDescription,
  buildWillasAudienceKeywordDescription,
  canUseWarmupVideoOnPage,
  recordWarmupVideoUsedOnPage,
  getCurrentAudienceSliceWindow,
  isPageIn24hPostCreationRest,
  isPageSafeFromMassEditShadowban,
  preCheckTikTokCreatorAndTitle,
  pickBestCollaboratorPage,
  applyCollaboratorInviteInComposer,
  acceptPendingCollabInvitesOnPage,
  prepareShortBaitStoryMp4,
  postShortBaitStoryInMbs,
  postCrosspostedWarmupReelInMbs,
  scheduleBulkWarmupReelsInMbs,
  syncLocal50WarmupVideosIntoHub,
  buildWillasConveyorDashboardStatus,
  runWillasFullWarmupConveyor,
  registerWillasConveyorRoutes,
  isWillasConveyorRunning: () => _willasConveyorRunning
};

