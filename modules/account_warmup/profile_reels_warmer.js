/**
 * ============================================================================
 * MÓDULO ACCOUNT WARMUP: ESTEIRA OURO DIA 0 -> DIA 5+ (PERFIL PT-BR + PÁGINA EUA)
 * ============================================================================
 * Diretório: modules/account_warmup/profile_reels_warmer.js
 *
 * Implementa a Esteira de 6 Etapas validada em operação:
 *   - DIA 0 (0h–24h): Compra/Loga Perfil (IP 4G BR) + 2FA -> 24h 100% Parado
 *   - DIA 1 (Após 24h): Ativa Modo Profissional no Perfil + Posta 3 Vídeos PT-BR no PERFIL (1..3/9) com FFmpeg HSL/Saturação
 *   - DIA 2: Posta 3 Vídeos PT-BR no PERFIL (4..6/9) (Manhã / Tarde / Noite)
 *   - DIA 3: Posta 3 Vídeos PT-BR no PERFIL (7..9/9) -> Completa 9 Vídeos no Perfil Mãe
 *   - DIA 4: Cria a Página Completa EUA (Burger King +4, Tel +1 NXX real, @gmail, @Username, Site facebook.com/@Username, Sempre aberto) + Deixa 24h Parada
 *   - DIA 5+: Configura Países VIP + Idade 24+ + Blocklist Comentários + DM -> Posta Vídeo de VENDA (3/dia)
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadPipeline, savePipeline } = require('./lifecycle_pipeline');

const FFMPEG_BIN = 'ffmpeg';
const FFPROBE_BIN = 'ffprobe';
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const STAGING_DIR = path.resolve(__dirname, '../../temp_upload_staging');
const PROFILE_WARMUP_VIDEOS_DIR = path.resolve(__dirname, '../../VIDEOS_AQUECIMENTO_PERFIL_PTBR');

try {
  fs.mkdirSync(PROFILE_WARMUP_VIDEOS_DIR, { recursive: true });
} catch (_) {}

const GOLD_CONVEYOR_STAGES = {
  DIA_0_REPOUSO_24H: {
    code: 'DIA_0_REPOUSO_24H',
    day: 0,
    label: '🛒 DIA 0 (0h–24h): Compra Perfil + 2FA • 24h 100% Parado',
    target_profile_videos: 0,
    daily_profile_quota: 0
  },
  DIA_1_PERFIL_3_VIDEOS: {
    code: 'DIA_1_PERFIL_3_VIDEOS',
    day: 1,
    label: '⚡ DIA 1 (Após 24h): Ativa Modo Profissional + 3 Vídeos PT-BR no PERFIL (1..3/9)',
    target_profile_videos: 3,
    daily_profile_quota: 3
  },
  DIA_2_PERFIL_6_VIDEOS: {
    code: 'DIA_2_PERFIL_6_VIDEOS',
    day: 2,
    label: '🎬 DIA 2: Posta 3 Vídeos PT-BR no PERFIL (4..6/9 • Manhã / Tarde / Noite)',
    target_profile_videos: 6,
    daily_profile_quota: 3
  },
  DIA_3_PERFIL_9_VIDEOS: {
    code: 'DIA_3_PERFIL_9_VIDEOS',
    day: 3,
    label: '🎬 DIA 3: Posta 3 Vídeos PT-BR no PERFIL (7..9/9 • Completa 9 Vídeos no Perfil)',
    target_profile_videos: 9,
    daily_profile_quota: 3
  },
  DIA_4_CRIA_PAGINA_EUA_24H: {
    code: 'DIA_4_CRIA_PAGINA_EUA_24H',
    day: 4,
    label: '📄 DIA 4: Cria Página Completa EUA (Burger King +4 / @Username / Site FB) + 24h Parada',
    target_profile_videos: 9,
    daily_profile_quota: 0
  },
  DIA_5_VENDA_ESCALA: {
    code: 'DIA_5_VENDA_ESCALA',
    day: 5,
    label: '💰 DIA 5+: Configura Países VIP + Idade Público + Blocklist + DM • Posta Vídeo de VENDA (3/dia)',
    target_profile_videos: 9,
    daily_page_quota: 3
  }
};

const PTBR_FAMILIAR_CAPTIONS = [
  'Rotina matinal tranquila na cozinha de casa, receitas caseiras simples, café quentinho na mesa, saúde natural depois dos 50 e paz em família 🙏☕',
  'Momentos simples de família na cozinha caseira, sabedoria de vó, hábitos saudáveis da manhã e coração leve todos os dias ✨🌿',
  'Que nunca nos falte fé, família reunida, receitas simples de casa e saúde na maturidade ❤️☕',
  'Cuidado diário com o bem-estar depois dos 50 anos, vida tranquila no lar, gratidão e rotina saudável pela manhã 🙌🌻',
  'Histórias reais de família, costumes antigos da vovó, mesa posta com carinho e muita paz no dia a dia 😊✨',
  'Mais um dia abençoado cuidando da casa, da mente e da saúde natural com simplicidade 🙏🌿',
  'Simplicidade na rotina doméstica, chá quentinho na cozinha e bem-estar feminino um dia de cada vez 🌻☕',
  'Vida leve no campo e em casa, temperos naturais, memórias de família e disposição todos os dias 👏❤️',
  'Pequenos hábitos saudáveis pela manhã, aconchego do lar, fé e tranquilidade pra nossa semana 💪☕'
];

/**
 * Verifica se o vídeo já possui blindagem forense CapCut / Apple iPhone no container (-brand qt)
 */
function isVideoAlreadyForensicShielded(filePath) {
  try {
    const probeRaw = execFileSync(FFPROBE_BIN, [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      filePath
    ], { timeout: 10000, encoding: 'utf8' });
    const parsed = JSON.parse(probeRaw);
    const tags = parsed?.format?.tags || {};
    const majorBrand = String(tags.major_brand || '').trim().toLowerCase();
    const comment = String(tags.comment || '');
    const make = String(tags['com.apple.quicktime.make'] || '');
    return (majorBrand === 'qt' || majorBrand === 'mp42') && (comment.includes('LvAppName=CapCut') || make === 'Apple');
  } catch (_) {
    return false;
  }
}

/**
 * Aplica filtro FFmpeg Anti-Hash completo (Receita Will):
 * - Se já blindado no disco (major_brand === 'qt' e LvAppName=CapCut): preserva bit a bit, aplicando apenas timestamp fresco via -c copy em <0.5s.
 * - Se ainda não blindado:
 *   - hflip (Espelhamento Horizontal — padrão true p/ vídeos de aquecimento sem texto na tela)
 *   - HSL / Saturação quente (+4% a +6% saturação e leve shift de matiz)
 *   - Vignette (Vinheta leve periférica PI/6 para alterar pixels das bordas)
 *   - Crop/Scale (Zoom de 2% a 4% cortando bordas + upscale 1080p)
 *   - Limpeza total de ID/Metadados (-map_metadata -1)
 *   - Injeção de metadados CapCut iPhone V2 (-brand qt)
 */
function prepareProfileWarmupVideoHsl(inputPath, slotNumber = 1, options = {}) {
  if (!inputPath || !fs.existsSync(inputPath)) {
    throw new Error(`Arquivo de vídeo não encontrado para aquecimento de perfil: ${inputPath}`);
  }
  fs.mkdirSync(STAGING_DIR, { recursive: true });

  const outName = `IMG_${1000 + ((Date.now() + Number(slotNumber || 1) * 137) % 8999)}.MP4`;
  const outputPath = path.join(STAGING_DIR, outName);

  // Se o vídeo já foi auto-editado e blindado pelo Upload do Hub (HUB_*.mp4), aplica cópia rápida (< 0.2s) com creation_time único sem re-encodar duas vezes!
  const isHubPreEdited = /^HUB_/i.test(path.basename(inputPath));
  if ((options.allowFastCopy === true || isHubPreEdited) && isVideoAlreadyForensicShielded(inputPath)) {
    const nowIso = new Date().toISOString();
    execFileSync(FFMPEG_BIN, [
      '-y',
      '-i', inputPath,
      '-t', '35',
      '-c', 'copy',
      '-brand', 'qt  ',
      '-movflags', '+faststart+use_metadata_tags',
      '-metadata', `creation_time=${nowIso}`,
      outputPath
    ], { stdio: 'ignore', timeout: 30000 });

    return {
      outputPath,
      alreadyShielded: true,
      hslApplied: {
        shieldPreserved: true,
        hflip: false,
        fastCopy: true
      }
    };
  }

  const accountSalt = String(options.accountSalt || '').split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const seed = Number(slotNumber || 1) * 17 + accountSalt + (Date.now() % 97);
  const sat = (1.04 + ((seed % 5) * 0.006)).toFixed(3);       // Saturação quente +4% a +6.4%
  const hueShift = (1.2 + ((seed % 4) * 0.6)).toFixed(1);     // Leve puxada p/ tom quente (+1.2° a +3.0°)
  const bri = (0.008 + ((seed % 4) * 0.004)).toFixed(3);      // Brilho sutil
  const con = (1.02 + ((seed % 4) * 0.008)).toFixed(3);       // Contraste sutil
  const cropScale = (0.965 + ((seed % 3) * 0.004)).toFixed(3);// Zoom leve anti-hash (~96.5%)
  // Por padrão useHflip = false (NUNCA espelha textos/legendas que já venham nos vídeos que o operador baixar!)
  const useHflip = options.hflip === true;

  const flipPrefix = useHflip ? 'hflip,' : '';
  // Zero vinheta: resolução 720x1280 bicubic ultra-leve para encode < 1.5s e arquivo final de 2 MB a 4 MB (upload instantâneo 4G!)
  const vfFilter = `${flipPrefix}crop=iw*${cropScale}:ih*${cropScale},scale=720:1280:flags=bicubic,eq=brightness=${bri}:contrast=${con}:saturation=${sat},hue=h=${hueShift}:s=${sat}`;
  // Blindagem de Áudio Anti-Rights-Manager & Anti-Mute Musical (K-Drama / Gravadoras / Audible Magic):
  // Aplica +3.5% de Pitch Shift (asetrate=48000*1.035) + 1.025x de Tempo Shift (atempo=1.025) + filtro passa-faixa
  const afFilter = 'aresample=48000,asetrate=48000*1.035,aresample=48000,atempo=1.025,highpass=f=65,lowpass=f=14200,volume=1.04';

  const iphoneModels = ['iPhone 15 Pro', 'iPhone 16 Pro', 'iPhone 15 Pro Max', 'iPhone 14 Pro'];
  const chosenModel = iphoneModels[seed % iphoneModels.length];

  execFileSync(FFMPEG_BIN, [
    '-y',
    '-i', inputPath,
    '-t', '32',
    '-map_metadata', '-1',
    '-vf', vfFilter,
    '-af', afFilter,
    '-c:v', 'libx264',
    '-preset', 'superfast',
    '-crf', '25',
    '-maxrate', '1400k',
    '-bufsize', '2800k',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-brand', 'qt  ',
    '-movflags', '+faststart+use_metadata_tags',
    '-metadata:g', 'com.apple.quicktime.make=Apple',
    '-metadata:g', `com.apple.quicktime.model=${chosenModel}`,
    '-metadata:g', 'com.apple.quicktime.software=17.5.1',
    '-metadata:g', 'comment=LvAppName=CapCut;LvAppVersion=12.8.0;HwEncoder=Apple H.264',
    outputPath
  ], { stdio: 'ignore', timeout: 120000 });

  return {
    outputPath,
    alreadyShielded: false,
    hslApplied: {
      hflip: useHflip,
      saturation: Number(sat),
      hueShiftDeg: Number(hueShift),
      brightness: Number(bri),
      contrast: Number(con),
      audioTempoShift: 1.03
    }
  };
}

/**
 * Verifica se um @handle do TikTok já possui Página Homônima no Facebook (Risco de Rights Manager / Cross-Posting Oficial).
 * Uso: await checkTikTokHandleOnFacebook('@homestead_mama')
 */
async function checkTikTokHandleOnFacebook(tiktokHandle) {
  const cleanHandle = String(tiktokHandle || '').trim().replace(/^@+/, '').replace(/[^a-zA-Z0-9._]/g, '');
  if (!cleanHandle) return { safe: true, handle: '', reason: 'Sem handle informado' };

  const https = require('https');
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'www.facebook.com',
      path: `/${encodeURIComponent(cleanHandle)}`,
      method: 'GET',
      headers: {
        'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      timeout: 6000
    }, (res) => {
      let body = '';
      res.on('data', chunk => {
        if (body.length < 45000) body += chunk.toString('utf8');
      });
      res.on('end', () => {
        const status = res.statusCode || 0;
        const lower = body.toLowerCase();
        const ogTitleMatch = body.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
        const ogTitle = ogTitleMatch ? ogTitleMatch[1].trim() : '';
        const isGenericFb = !ogTitle || /^facebook$/i.test(ogTitle) || /log in|entrar/i.test(ogTitle);
        const notFound =
          status === 404 ||
          status === 400 ||
          isGenericFb ||
          lower.includes('content not found') ||
          lower.includes('este conteúdo não está disponível') ||
          lower.includes("this content isn't available");
        if (notFound) {
          resolve({
            safe: true,
            handle: cleanHandle,
            fb_url: `https://www.facebook.com/${cleanHandle}`,
            reason: `✅ SEGURO: @${cleanHandle} NÃO possui página homônima no Facebook (Inexistente/Livre).`
          });
        } else {
          resolve({
            safe: false,
            handle: cleanHandle,
            fb_url: `https://www.facebook.com/${cleanHandle}`,
            fb_title: ogTitle,
            reason: `⚠️ ATENÇÃO: Existe perfil/página "${ogTitle}" em facebook.com/${cleanHandle} (HTTP ${status}) — prefira outro criador pequeno do TikTok ou use o filtro Anti-RM completo (hflip + áudio 1.03x)!`
          });
        }
      });
    });
    req.on('error', () => resolve({ safe: true, handle: cleanHandle, reason: 'Verificação offline — aplique filtro Anti-RM completo.' }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ safe: true, handle: cleanHandle, reason: 'Timeout — aplique filtro Anti-RM completo.' });
    });
    req.end();
  });
}

/**
 * Extrai automaticamente o cookie c_user do Facebook na sessão ativa e salva o link
 * https://www.facebook.com/profile.php?id=<c_user> no objeto da conta, em warming_accounts_pipeline.json
 * e em perfis_matriz_targets.json (para auditoria externa do Agente Spy).
 */
async function extractAndSavePersonalProfileUid(page, accountObj = {}, onLog = console.log) {
  try {
    const cookies = await page.cookies('https://www.facebook.com', 'https://web.facebook.com').catch(() => []);
    const cUserCookie = (cookies || []).find(c => c && c.name === 'c_user' && /^\d{8,17}$/.test(String(c.value || '')));
    let uid = cUserCookie ? String(cUserCookie.value).trim() : null;

    if (!uid) {
      const curUrl = String(page.url() || '');
      const mUrl = curUrl.match(/profile\.php\?id=(\d{8,17})/i);
      if (mUrl) uid = mUrl[1];
    }
    if (!uid) return null;

    const fbProfileUrl = `https://www.facebook.com/profile.php?id=${uid}`;
    accountObj.fb_profile_uid = uid;
    accountObj.fb_profile_url = fbProfileUrl;

    const cleanPid = String(accountObj?.incogniton_profile_id || accountObj?.profile_browser_ID || '').trim().toLowerCase();
    const cleanPid8 = cleanPid.slice(0, 8);
    const cleanName = String(accountObj?.name || '').trim().toLowerCase();

    try {
      const wData = loadPipeline();
      let changed = false;
      for (const acc of (wData.accounts || [])) {
        const accPid8 = String(acc.incogniton_profile_id || '').trim().toLowerCase().slice(0, 8);
        if ((cleanPid8 && accPid8 === cleanPid8) || (accountObj?.id && acc.id === accountObj.id) || (cleanName && String(acc.name || '').trim().toLowerCase() === cleanName)) {
          if (acc.fb_profile_uid !== uid || acc.fb_profile_url !== fbProfileUrl) {
            acc.fb_profile_uid = uid;
            acc.fb_profile_url = fbProfileUrl;
            changed = true;
          }
        }
      }
      if (changed) savePipeline(wData);
    } catch (_) {}

    // 2. Atualiza perfis_matriz_targets.json
    try {
      const tPath = path.join(PROJECT_ROOT, 'perfis_matriz_targets.json');
      let tData = { updated_at: null, profiles: [] };
      if (fs.existsSync(tPath)) {
        try { tData = JSON.parse(fs.readFileSync(tPath, 'utf8')) || tData; } catch (_) {}
      }
      if (!Array.isArray(tData.profiles)) tData.profiles = [];
      const existingIdx = tData.profiles.findIndex(p => p && (p.fb_profile_uid === uid || (cleanPid && String(p.profile_browser_ID || '').toLowerCase() === cleanPid)));
      const entry = {
        account_name: accountObj?.name || accountObj?.email || `Perfil ${uid}`,
        profile_browser_ID: cleanPid || accountObj?.incogniton_profile_id || '',
        fb_profile_uid: uid,
        fb_profile_url: fbProfileUrl,
        reels_tab_url: `${fbProfileUrl}&sk=reels_tab`,
        updated_at: new Date().toISOString()
      };
      if (existingIdx !== -1) {
        tData.profiles[existingIdx] = { ...tData.profiles[existingIdx], ...entry };
      } else {
        tData.profiles.push(entry);
      }
      tData.updated_at = new Date().toISOString();
      fs.writeFileSync(tPath, JSON.stringify(tData, null, 2), 'utf8');
    } catch (_) {}

    onLog(`🆔 [c_user Capturado • Perfil Mãe] ${accountObj?.name || 'Conta'}: ${fbProfileUrl}`);
    return { uid, url: fbProfileUrl };
  } catch (_) {
    return null;
  }
}

/**
 * Garante que na etapa final de /reels/create o seletor de audiência do Reel esteja
 * estritamente em PÚBLICO (🌐 Public / Qualquer pessoa no Facebook ou fora dele) e NUNCA em Amigos (👥 Friends).
 */
async function ensureReelAudienceIsPublic(page, onLog = console.log) {
  try {
    for (let attempt = 1; attempt <= 4; attempt++) {
      const inspectState = await page.evaluate(() => {
        const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
        const visibleDialogs = Array.from(document.querySelectorAll('[role="dialog"]')).filter(d => {
          const r = d.getBoundingClientRect();
          return r.width > 320 && r.height > 240;
        });
        const scopeRoot = visibleDialogs.length > 0 ? visibleDialogs[visibleDialogs.length - 1] : document;

        // 0. Verifica primeiro a linha "Público do post" / "Post audience" / "Público do reel" na coluna esquerda (ou modal)
        const rowCandidates = Array.from(scopeRoot.querySelectorAll('[role="button"], button, div')).filter(el => {
          if (el.getAttribute?.('role') === 'tab' || el.closest?.('[role="tab"]')) return false;
          const r = el.getBoundingClientRect();
          return r.width >= 160 && r.width <= 480 && r.height >= 34 && r.height <= 96 && r.top >= 75 && r.top < 620 && r.left < 560;
        });

        for (const row of rowCandidates) {
          const rawLines = String(row.innerText || '').split('\n').map(s => norm(s)).filter(Boolean);
          if (rawLines.length === 0) continue;
          const firstLine = rawLines[0];
          if (
            firstLine === 'publico do post' ||
            firstLine === 'publico do reel' ||
            firstLine === 'post audience' ||
            firstLine === 'reel audience' ||
            firstLine === 'quem pode ver seu reel?' ||
            firstLine === 'audiencia'
          ) {
            const subText = rawLines.slice(1).join(' ');
            const clickable = row.closest('[role="button"], button') || row.querySelector('[role="button"], button') || row;
            const br = clickable.getBoundingClientRect();
            const isRestricted = /\b(amigos|friends|somente eu|only me|personalizado|custom|especificos)\b/i.test(subText);
            const isPublic = !isRestricted && /\b(publico|public|qualquer pessoa|anyone)\b/i.test(subText);
            if (isPublic) {
              return { status: 'ALREADY_PUBLIC', currentLabel: `${firstLine}: ${subText}` };
            }
            return {
              status: 'NEEDS_SWITCH_FROM_RESTRICTED',
              currentLabel: subText || firstLine,
              x: br.left + br.width / 2,
              y: br.top + br.height / 2,
              rightX: br.right - 24
            };
          }
        }

        // 1. Fallback para composer em modal popup clássico onde o botão mostra diretamente "Amigos" ou "Público"
        const allEls = Array.from(scopeRoot.querySelectorAll('[role="button"], button, [role="combobox"]'));
        for (const el of allEls) {
          if (el.getAttribute?.('role') === 'tab' || el.closest?.('[role="tab"]')) continue;
          const aria = norm(el.getAttribute?.('aria-label') || '');
          const txt = norm(el.innerText || '');
          const r = el.getBoundingClientRect();
          if (r.width < 24 || r.height < 14 || r.height > 110 || r.top < 80 || r.left > 650) continue;

          const isRestricted =
            txt === 'amigos' ||
            txt === 'friends' ||
            txt === 'amigos, exceto...' ||
            txt === 'friends except...' ||
            txt === 'somente eu' ||
            txt === 'only me' ||
            aria.includes('publico: amigos') ||
            aria.includes('audience: friends') ||
            aria === 'amigos' ||
            aria === 'friends' ||
            aria === 'somente eu' ||
            aria === 'only me';

          if (isRestricted) {
            return {
              status: 'NEEDS_SWITCH_FROM_RESTRICTED',
              currentLabel: txt || aria,
              x: r.left + r.width / 2,
              y: r.top + r.height / 2,
              rightX: r.right - 16
            };
          }
        }

        for (const el of allEls) {
          if (el.getAttribute?.('role') === 'tab' || el.closest?.('[role="tab"]')) continue;
          const aria = norm(el.getAttribute?.('aria-label') || '');
          const txt = norm(el.innerText || '');
          const r = el.getBoundingClientRect();
          if (r.width < 24 || r.height < 14 || r.height > 110 || r.top < 80 || r.left > 650) continue;
          if (
            txt === 'publico' ||
            txt === 'public' ||
            txt.includes('qualquer pessoa dentro ou fora do facebook') ||
            txt.includes('qualquer pessoa no facebook ou fora dele') ||
            txt.includes('anyone on or off facebook')
          ) {
            return { status: 'ALREADY_PUBLIC', currentLabel: (txt || aria).slice(0, 60) };
          }
        }

        return { status: 'NO_SELECTOR_VISIBLE' };
      }).catch(() => ({ status: 'ERROR' }));

      if (inspectState.status === 'ALREADY_PUBLIC') {
        onLog(`🌐 [Privacidade Reel • Perfil Mãe] Audiência confirmada em PÚBLICO (${inspectState.currentLabel})!`);
        return true;
      }

      if (inspectState.status !== 'NEEDS_SWITCH_FROM_RESTRICTED') {
        return true;
      }

      onLog(`🚨 [Privacidade Reel • Perfil Mãe • Tentativa ${attempt}/4] Seletor estava em "${inspectState.currentLabel}" (Restrito/Amigos)! Abrindo seletor e trocando para 🌐 PÚBLICO...`);
      await page.mouse.click(inspectState.x, inspectState.y);
      await new Promise(r => setTimeout(r, 900));

      // Garante via DOM .click() que o painel/modal de "Público do post" abriu de verdade
      await page.evaluate((pt) => {
        const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
        const bodyNorm = norm(document.body?.innerText || '');
        if (bodyNorm.includes('qualquer pessoa no facebook ou fora dele') || bodyNorm.includes('qualquer pessoa dentro ou fora do facebook') || bodyNorm.includes('anyone on or off facebook') || bodyNorm.includes('seus amigos no facebook')) {
          return true;
        }
        const hit = document.elementFromPoint(pt.x, pt.y);
        const btn = hit ? (hit.closest('[role="button"], button') || hit) : null;
        if (btn && typeof btn.click === 'function') btn.click();
        return false;
      }, inspectState).catch(() => {});
      await new Promise(r => setTimeout(r, 1400));

      // Localiza e clica na opção "Público" ("Qualquer pessoa no Facebook ou fora dele"), ignorando o título "Público do post" e containers pais!
      const publicOptionBox = await page.evaluate(() => {
        const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
        const candidates = Array.from(document.querySelectorAll('[role="dialog"] [role="radio"], [role="dialog"] [role="button"], [role="menuitemradio"], [role="menuitem"], [role="option"], [role="radio"], [role="button"], span, div'));
        for (const c of candidates) {
          const rawLines = String(c.innerText || c.getAttribute?.('aria-label') || '').split('\n').map(s => norm(s)).filter(Boolean);
          const t = rawLines.join('\n');
          if (!t || t.includes('publico do post') || t.includes('publico do reel') || t.includes('post audience') || t.includes('somente posts publicos')) continue;
          // Jamais seleciona um container pai que também contenha "Amigos" ou "Somente eu"
          if (t.includes('amigos') || t.includes('friends') || t.includes('somente eu') || t.includes('only me')) continue;
          const isPublicOption =
            t === 'publico' ||
            t === 'public' ||
            rawLines[0] === 'publico' ||
            rawLines[0] === 'public' ||
            t.includes('qualquer pessoa dentro ou fora do facebook') ||
            t.includes('qualquer pessoa no facebook ou fora dele') ||
            t.includes('anyone on or off facebook');

          if (isPublicOption) {
            const target = c.closest('[role="radio"], [role="menuitemradio"], [role="menuitem"], [role="option"], [role="button"]') || c;
            const r = target.getBoundingClientRect();
            if (r.width > 24 && r.height >= 16 && r.height < 110 && r.top > 70) {
              const radioInp = target.querySelector?.('input[type="radio"]') || target;
              if (typeof radioInp.click === 'function') {
                try { radioInp.click(); } catch (_) {}
              }
              return { x: r.left + r.width / 2, y: r.top + r.height / 2, label: rawLines[0] || 'publico' };
            }
          }
        }
        return null;
      }).catch(() => null);

      if (publicOptionBox) {
        await page.mouse.click(publicOptionBox.x, publicOptionBox.y);
        await new Promise(r => setTimeout(r, 1200));

        // Clica em "Concluir" / "Salvar" / "Pronto" / "Done" / "Save" (se for modal) OU no botão "Voltar" do subpainel esquerdo se ainda estiver aberto
        const doneOrBackBox = await page.evaluate(() => {
          const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
          const btns = Array.from(document.querySelectorAll('[role="dialog"] [role="button"], [role="dialog"] button, [role="button"], button'));
          for (let i = btns.length - 1; i >= 0; i--) {
            const b = btns[i];
            if (b.getAttribute('aria-disabled') === 'true' || b.disabled) continue;
            const t = norm(b.innerText || b.getAttribute?.('aria-label') || '');
            if (t === 'concluir' || t === 'salvar' || t === 'pronto' || t === 'done' || t === 'save' || t === 'atualizar' || t === 'definir como padrao') {
              const r = b.getBoundingClientRect();
              if (r.width > 35 && r.height > 20) {
                try { b.click(); } catch (_) {}
                return { x: r.left + r.width / 2, y: r.top + r.height / 2, label: t };
              }
            }
          }
          // Se for subpainel lateral ("Qualquer pessoa no Facebook ou fora dele" ainda na tela sem botão Salvar), procura seta Voltar no topo esquerdo
          const bodyNorm = norm(document.body?.innerText || '');
          if (bodyNorm.includes('qualquer pessoa no facebook ou fora dele') || bodyNorm.includes('seus amigos no facebook')) {
            for (const b of btns) {
              const aria = norm(b.getAttribute?.('aria-label') || '');
              const r = b.getBoundingClientRect();
              if ((aria === 'voltar' || aria === 'back') && r.left < 120 && r.top > 50 && r.top < 180 && r.width >= 20 && r.height >= 20) {
                return { x: r.left + r.width / 2, y: r.top + r.height / 2, label: aria };
              }
            }
          }
          return null;
        }).catch(() => null);

        if (doneOrBackBox) {
          await page.mouse.click(doneOrBackBox.x, doneOrBackBox.y);
          await new Promise(r => setTimeout(r, 1200));
        }
      }
    }

    // Verificação final pós-tentativas: JAMAIS permite prosseguir se ainda estiver em Amigos / Somente eu!
    const finalCheck = await page.evaluate(() => {
      const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
      const rows = Array.from(document.querySelectorAll('[role="button"], button, div')).filter(el => {
        const r = el.getBoundingClientRect();
        return r.width >= 160 && r.width <= 480 && r.height >= 34 && r.height <= 96 && r.top >= 75 && r.top < 620 && r.left < 560;
      });
      for (const row of rows) {
        const rawLines = String(row.innerText || '').split('\n').map(s => norm(s)).filter(Boolean);
        if (rawLines[0] === 'publico do post' || rawLines[0] === 'publico do reel' || rawLines[0] === 'post audience') {
          const sub = rawLines.slice(1).join(' ');
          if (/\b(amigos|friends|somente eu|only me)\b/i.test(sub)) {
            return { ok: false, label: sub };
          }
        }
      }
      return { ok: true };
    }).catch(() => ({ ok: true }));

    if (!finalCheck.ok) {
      onLog(`🛑 [BLOQUEIO ANTI-AMIGOS] Audiência continuou em "${finalCheck.label}" após 4 tentativas — bloqueando publicação para jamais postar vídeo de aquecimento só para amigos!`);
      return false;
    }

    onLog(`✅ [Privacidade Reel • Perfil Mãe] Audiência confirmada em 🌐 PÚBLICO!`);
    return true;
  } catch (err) {
    onLog(`⚠️ [Privacidade Reel] Aviso ao verificar audiência pública: ${err.message}`);
    return false;
  }
}

async function armAntiBeforeUnloadAndDismissExitModal(page) {
  if (!page) return null;
  let cdpClient = page._cdpKeepAwakeClient || null;
  if (!cdpClient && typeof page.target === 'function') {
    try {
      cdpClient = await page.target().createCDPSession();
      page._cdpKeepAwakeClient = cdpClient;
    } catch (_) {}
  }
  if (cdpClient) {
    await cdpClient.send('Page.enable').catch(() => {});
    await cdpClient.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
    if (!cdpClient._antiBeforeUnloadListenerAttached) {
      cdpClient._antiBeforeUnloadListenerAttached = true;
      cdpClient.on('Page.javascriptDialogOpening', () => {
        cdpClient.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
      });
    }
  }
  if (!page._antiBeforeUnloadDialogHandlerAttached && typeof page.on === 'function') {
    page._antiBeforeUnloadDialogHandlerAttached = true;
    page.on('dialog', async (dialog) => {
      try { await dialog.accept(); } catch (_) {}
    });
    if (typeof page.evaluateOnNewDocument === 'function') {
      await page.evaluateOnNewDocument(() => {
        try {
          window.onbeforeunload = null;
          window.addEventListener('beforeunload', (e) => { e.stopImmediatePropagation(); }, true);
        } catch (_) {}
      }).catch(() => {});
    }
  }
  await page.evaluate(() => {
    try {
      window.onbeforeunload = null;
      window.addEventListener('beforeunload', (e) => { e.stopImmediatePropagation(); }, true);
      const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]'));
      for (const d of dialogs) {
        const dt = norm(d.innerText || '');
        if (dt.includes('sair da pagina') || dt.includes('leave page') || dt.includes('alteracoes que voce fez')) {
          const btns = Array.from(d.querySelectorAll('[role="button"], button, span'));
          for (const b of btns) {
            const bt = norm(b.innerText || b.getAttribute?.('aria-label') || '');
            if (bt === 'sair' || bt === 'leave' || bt === 'descartar' || bt === 'discard') {
              const target = b.closest('[role="button"], button') || b;
              target.click();
              break;
            }
          }
        }
      }
    } catch (_) {}
  }).catch(() => {});
  return cdpClient;
}

/**
 * Ativa o "Modo Profissional" no Perfil Pessoal (Dia 1):
 * Entra no Perfil Pessoal -> Clica no botão [...] à direita das abas (Tudo | Sobre | Amigos | Fotos | Reels)
 * -> Clica em "Ativar o modo profissional" ("Turn on professional mode") -> Confirma ("Ativar" / "Turn on").
 * Inclui fallback direto via /professional_dashboard caso o menu [...] oculte o item.
 */
async function ensurePersonalProfileProfessionalMode(page, automator, onLog = console.log, accountObj = {}) {
  try {
    await armAntiBeforeUnloadAndDismissExitModal(page);
    if (automator && typeof automator.ensureActingAsPersonalProfile === 'function') {
      await automator.ensureActingAsPersonalProfile(page, onLog);
    }
    await armAntiBeforeUnloadAndDismissExitModal(page);
    const fbOrigin = /^https:\/\/web\.facebook\.com/i.test(page.url()) ? 'https://web.facebook.com' : 'https://www.facebook.com';
    await page.goto(`${fbOrigin}/me`, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    if (automator && typeof automator.waitForFacebookDomHydrated === 'function') {
      await automator.waitForFacebookDomHydrated(page, 22000).catch(() => {});
    }
    await new Promise(r => setTimeout(r, 4200));

    // Extrai e salva automaticamente o c_user (https://www.facebook.com/profile.php?id=...) do Perfil Pessoal!
    await extractAndSavePersonalProfileUid(page, accountObj, onLog);

    for (let tryPro = 0; tryPro < 2; tryPro++) {
      // Verifica se o Painel Profissional já está ativo no Perfil Pessoal (apenas botões reais do Painel Profissional no topo, nunca "Criar reel" ou "seguidores" de sugestões de amigos)
      const alreadyPro = await page.evaluate(() => {
        const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        const mainEl = document.querySelector('[role="main"]') || document.body;
        const hasProHeaderBtn = Array.from(mainEl.querySelectorAll('[role="button"], button, a')).some(el => {
          const bt = norm(el.innerText || el.getAttribute?.('aria-label') || '').trim();
          const r = el.getBoundingClientRect();
          if (r.width < 25 || r.height < 18 || r.top > 620) return false;
          return (
            bt === 'painel' ||
            bt === 'ver painel' ||
            bt === 'painel profissional' ||
            bt === 'painel do criador' ||
            bt === 'ver ferramentas' ||
            bt === 'ferramentas profissionais' ||
            bt === 'view tools' ||
            bt === 'professional dashboard' ||
            bt === 'creator dashboard'
          );
        });
        return hasProHeaderBtn;
      }).catch(() => false);

      if (alreadyPro) {
        onLog(`✅ [Modo Profissional • Perfil Mãe] Modo Profissional já está ATIVO no Perfil Pessoal!`);
        return true;
      }

      // Localiza os botões candidatos [...] no cabeçalho do Perfil Pessoal (priorizando [aria-label="Ver mais opções de configurações de perfil"] + scrollIntoView)
      let dotsCandidates = [];
      for (let wDots = 0; wDots < 8 && dotsCandidates.length === 0; wDots++) {
        dotsCandidates = await page.evaluate(() => {
          const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
          // 1º: Seletor direto calibrado por print (aria-label="Ver mais opções de configurações de perfil")
          const directDots = document.querySelector('[aria-label="Ver mais opções de configurações de perfil"], [aria-label*="opções de configurações de perfil"], [aria-label*="profile settings"]');
          if (directDots) {
            try { directDots.scrollIntoView({ block: 'center' }); } catch (_) {}
            const r = directDots.getBoundingClientRect();
            if (r.width >= 24 && r.height >= 20) {
              return [{
                x: r.left + r.width / 2,
                y: r.top + r.height / 2,
                top: r.top,
                left: r.left,
                aria: directDots.getAttribute('aria-label') || 'direct_profile_dots',
                score: 999
              }];
            }
          }

          const tabs = Array.from(document.querySelectorAll('[role="main"] [role="tab"], [role="main"] a[role="tab"]'));
          let tabRowTop = null;
          for (const tb of tabs) {
            const tr = tb.getBoundingClientRect();
            if (tr.width > 20 && tr.height > 20 && tr.top > 150 && tr.top < 750) {
              tabRowTop = tr.top;
              break;
            }
          }
          const btns = Array.from(document.querySelectorAll('[role="main"] [role="button"]'));
          const found = [];
          for (const b of btns) {
            const aria = norm(b.getAttribute('aria-label') || '');
            const txt = (b.innerText || '').trim();
            // EXCLUI estritamente botões de foto/capa/câmera/editar/pesquisar para jamais clicar em "Editar foto da capa"!
            if (
              aria.includes('capa') ||
              aria.includes('cover') ||
              aria.includes('foto') ||
              aria.includes('photo') ||
              aria.includes('camera') ||
              aria.includes('editar') ||
              aria.includes('edit') ||
              aria.includes('pesquisar') ||
              aria.includes('search')
            ) {
              continue;
            }
            const r = b.getBoundingClientRect();
            if (r.width >= 30 && r.width <= 72 && r.height >= 26 && r.top > 180 && r.top < 750 && r.left > 350 && txt === '') {
              const onTabRow = tabRowTop !== null && Math.abs(r.top - tabRowTop) < 38;
              const hasOptionsAria = aria.includes('opcoes') || aria.includes('options') || aria.includes('mais') || aria.includes('more');
              const hasSvg = Boolean(b.querySelector('svg'));
              if (!hasOptionsAria && !(onTabRow && hasSvg)) continue;
              found.push({
                x: r.left + r.width / 2,
                y: r.top + r.height / 2,
                top: r.top,
                left: r.left,
                aria,
                score: (onTabRow ? 100 : 0) + (hasOptionsAria ? 50 : 0) + (r.top / 10)
              });
            }
          }
          found.sort((a, b) => b.score - a.score);
          return found;
        }).catch(() => []);
        if (dotsCandidates.length === 0) await new Promise(r => setTimeout(r, 1500));
      }

      let turnOnProBox = null;
      let confirmedAlreadyActiveInMenu = false;
      for (const cand of dotsCandidates.slice(0, 3)) {
        await page.mouse.click(cand.x, cand.y);
        await new Promise(r => setTimeout(r, 2200));

        // Procura "Ativar o modo profissional" OU confirma que já está ativo se aparecer "Desativar o modo profissional"
        const menuCheck = await page.evaluate(() => {
          const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
          const items = Array.from(document.querySelectorAll('[role="menuitem"], [role="menu"] [role="button"], [role="menu"] a, [role="menu"] span, [role="button"], a, span, div'));
          for (const it of items) {
            const t = norm(it.innerText || '');
            if (t === 'desativar o modo profissional' || t === 'turn off professional mode' || (t.includes('desativar o modo profissional') && t.length < 50) || (t.includes('turn off professional mode') && t.length < 50)) {
              return { alreadyActive: true };
            }
            if (t === 'ativar o modo profissional' || t === 'ativar modo profissional' || t === 'turn on professional mode' || (t.includes('ativar o modo profissional') && t.length < 45) || (t.includes('turn on professional mode') && t.length < 45)) {
              const clickable = it.closest('[role="menuitem"], [role="button"], a') || it;
              const r = clickable.getBoundingClientRect();
              if (r.width > 40 && r.height > 14 && r.height < 90) {
                try { clickable.click(); } catch (_) {}
                return { alreadyActive: false, box: { x: r.left + r.width / 2, y: r.top + r.height / 2 } };
              }
            }
          }
          return null;
        }).catch(() => null);

        if (menuCheck && menuCheck.alreadyActive) {
          confirmedAlreadyActiveInMenu = true;
          await page.keyboard.press('Escape').catch(() => {});
          await new Promise(r => setTimeout(r, 500));
          break;
        }
        if (menuCheck && menuCheck.box) {
          turnOnProBox = menuCheck.box;
          break;
        }
        await page.keyboard.press('Escape').catch(() => {});
        await new Promise(r => setTimeout(r, 600));
      }

      if (confirmedAlreadyActiveInMenu) {
        onLog(`✅ [Modo Profissional • Perfil Mãe] Confirmado no menu [...]: Modo Profissional já está ATIVO!`);
        return true;
      }

      if (turnOnProBox) {
        await page.mouse.click(turnOnProBox.x, turnOnProBox.y).catch(() => {});
        await new Promise(r => setTimeout(r, 3500));

        // CRÍTICO (Calibrado por Print calib_pro_confirm_modal.png):
        // No modal "Ativar o modo Pro", o botão "Ativar" fica abaixo da dobra do [role="dialog"] (y ~ 757px).
        // Fazer scrollIntoView({ block: 'center' }) + el.click() evita clicar no backdrop fora do modal!
        const confirmBox = await page.evaluate(() => {
          const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
          const btns = Array.from(document.querySelectorAll('[role="dialog"] [role="button"], [role="dialog"] button, [role="button"], button, span'));
          for (const b of btns) {
            const t = norm(b.innerText || b.getAttribute?.('aria-label') || '');
            if (t === 'ativar' || t === 'turn on') {
              const el = b.closest('[role="button"], button') || b;
              try { el.scrollIntoView({ block: 'center' }); } catch (_) {}
              const r = el.getBoundingClientRect();
              if (r.width > 45 && r.height > 24) {
                try { el.click(); } catch (_) {}
                return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
              }
            }
          }
          return null;
        }).catch(() => null);

        if (confirmBox) {
          await new Promise(r => setTimeout(r, 4500));
          onLog(`⚡ [Modo Profissional • Perfil Mãe] Modo Profissional ATIVADO com sucesso no Perfil Pessoal!`);
          return true;
        }
      }

      if (tryPro === 0) {
        await page.goto(`${fbOrigin}/me`, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
        await new Promise(r => setTimeout(r, 4000));
      }
    }

    // Fallback direto via /professional_dashboard caso o menu [...] oculte o item
    await page.goto(`${fbOrigin}/professional_dashboard`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 2800));
    const dashConfirm = await page.evaluate(() => {
      const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
      const btns = Array.from(document.querySelectorAll('[role="button"], button, span'));
      for (const b of btns) {
        const t = norm(b.innerText || b.getAttribute?.('aria-label') || '');
        if (
          t === 'explorar por conta propria' ||
          t === 'explore on your own' ||
          t === 'ativar' ||
          t === 'turn on' ||
          t === 'comecar' ||
          t === 'get started' ||
          t === 'ativar o modo profissional' ||
          t === 'turn on professional mode'
        ) {
          const el = b.closest('[role="button"], button') || b;
          const r = el.getBoundingClientRect();
          if (r.width > 40 && r.height > 20) return { x: r.left + r.width / 2, y: r.top + r.height / 2, label: t };
        }
      }
      return null;
    }).catch(() => null);
    if (dashConfirm) {
      await page.mouse.click(dashConfirm.x, dashConfirm.y);
      await new Promise(r => setTimeout(r, 3000));
      onLog(`⚡ [Modo Profissional • Fallback /professional_dashboard] Modo Profissional confirmado (${dashConfirm.label})!`);
      return true;
    }

    onLog(`ℹ️ [Modo Profissional] Opção "Ativar o modo profissional" não exibida no menu (usando composer nativo de Reels do perfil com trava 🌐 PÚBLICO).`);
    return false;
  } catch (err) {
    onLog(`⚠️ [Modo Profissional] Aviso: ${err.message}`);
    return false;
  }
}

/**
 * Avalia em qual etapa da Esteira Ouro (Dia 0 -> Dia 5+) um perfil se encontra.
 */
function evaluateGoldConveyorStage(acc, nowMs = Date.now()) {
  const firstLoginIso = acc?.fb_first_login_at || acc?.fb_account_created_at || acc?.added_at || null;
  const isOperational = Boolean(acc?.is_operational || acc?.operational || (Array.isArray(acc?.pages) && acc.pages.length > 0));
  const firstLoginMs = firstLoginIso ? Date.parse(firstLoginIso) : (isOperational ? (nowMs - 72 * 3600000) : 0);
  const elapsedHours = (firstLoginMs > 0 && Number.isFinite(firstLoginMs))
    ? Math.max(0, (nowMs - firstLoginMs) / 3600000)
    : (isOperational ? 72 : 0);

  const profileVideosPosted = Number(acc?.profile_videos_posted || acc?.warmup_stats?.profile_videos_posted || 0);
  const pageCreatedAtIso = acc?.page_created_at || acc?.warmup_stats?.page_created_at || null;
  const pageCreatedMs = pageCreatedAtIso ? Date.parse(pageCreatedAtIso) : 0;
  const pageElapsedHours = (pageCreatedMs > 0 && Number.isFinite(pageCreatedMs))
    ? Math.max(0, (nowMs - pageCreatedMs) / 3600000)
    : 0;

  if (!isOperational && elapsedHours < 24 && profileVideosPosted === 0) {
    return {
      ...GOLD_CONVEYOR_STAGES.DIA_0_REPOUSO_24H,
      profile_videos_posted: profileVideosPosted,
      hours_elapsed: Number(elapsedHours.toFixed(1)),
      hours_remaining_in_step: Number(Math.max(0, 24 - elapsedHours).toFixed(1)),
      next_action: 'Manter perfil 100% parado por 24h após o 1º login + 2FA'
    };
  }

  if (profileVideosPosted < 3) {
    return {
      ...GOLD_CONVEYOR_STAGES.DIA_1_PERFIL_3_VIDEOS,
      profile_videos_posted: profileVideosPosted,
      videos_remaining_today: 3 - profileVideosPosted,
      next_action: `Ativar Modo Profissional + Postar vídeos PT-BR ${profileVideosPosted + 1}..3/9 no Perfil Pessoal (FFmpeg HSL)`
    };
  }

  if (profileVideosPosted < 6) {
    return {
      ...GOLD_CONVEYOR_STAGES.DIA_2_PERFIL_6_VIDEOS,
      profile_videos_posted: profileVideosPosted,
      videos_remaining_today: 6 - profileVideosPosted,
      next_action: `Postar vídeos PT-BR ${profileVideosPosted + 1}..6/9 no Perfil Pessoal (Manhã / Tarde / Noite)`
    };
  }

  if (profileVideosPosted < 9) {
    return {
      ...GOLD_CONVEYOR_STAGES.DIA_3_PERFIL_9_VIDEOS,
      profile_videos_posted: profileVideosPosted,
      videos_remaining_today: 9 - profileVideosPosted,
      next_action: `Postar vídeos PT-BR ${profileVideosPosted + 1}..9/9 no Perfil Pessoal para fechar os 9 vídeos do Perfil Mãe`
    };
  }

  if (!pageCreatedMs || pageElapsedHours < 24) {
    return {
      ...GOLD_CONVEYOR_STAGES.DIA_4_CRIA_PAGINA_EUA_24H,
      profile_videos_posted: profileVideosPosted,
      page_created: Boolean(pageCreatedMs > 0),
      page_hours_elapsed: Number(pageElapsedHours.toFixed(1)),
      page_hours_remaining: pageCreatedMs > 0 ? Number(Math.max(0, 24 - pageElapsedHours).toFixed(1)) : 24,
      next_action: !pageCreatedMs
        ? '9/9 vídeos concluídos no Perfil! Criar Página Completa EUA (Burger King +4, Tel +1 real, @gmail, @Username, Site facebook.com/@Username)'
        : `Página criada! Deixar 100% parada por mais ${Math.max(0, 24 - pageElapsedHours).toFixed(1)}h`
    };
  }

  return {
    ...GOLD_CONVEYOR_STAGES.DIA_5_VENDA_ESCALA,
    profile_videos_posted: profileVideosPosted,
    page_hours_elapsed: Number(pageElapsedHours.toFixed(1)),
    next_action: 'Configurar 18 Países VIP + Idade Público + Blocklist Comentários + DM e postar Vídeo de VENDA (3/dia)'
  };
}

/**
 * Sincroniza no disco (warming_accounts_pipeline.json e database.json) o progresso de vídeos
 * de aquecimento do Perfil Mãe (profile_videos_posted e posted_profile_warmup_files).
 */
function syncProfileWarmupToDisk(accountObj = {}, totalPosted, postedToday, postedFiles = [], todayStr, nowIso) {
  const cleanPid8 = String(accountObj?.incogniton_profile_id || accountObj?.profile_browser_ID || '').trim().toLowerCase().slice(0, 8);
  const cleanName = String(accountObj?.name || '').trim().toLowerCase();

  try {
    const wData = loadPipeline();
    for (const acc of (wData.accounts || [])) {
      const accPid8 = String(acc.incogniton_profile_id || '').trim().toLowerCase().slice(0, 8);
      const isMatch = (cleanPid8 && accPid8 === cleanPid8) ||
        (accountObj?.id && acc.id === accountObj.id) ||
        (cleanName && String(acc.name || '').trim().toLowerCase() === cleanName);
      if (isMatch) {
        acc.profile_videos_posted = totalPosted;
        acc.profile_videos_posted_today = postedToday;
        acc.last_profile_video_date = todayStr;
        acc.last_profile_video_at = nowIso;
        acc.posted_profile_warmup_files = [...postedFiles];
        acc.warmup_stats = acc.warmup_stats || {};
        acc.warmup_stats.profile_videos_posted = totalPosted;
        acc.warmup_stats.last_profile_video_at = nowIso;
        acc.warmup_stats.posted_profile_warmup_files = [...postedFiles];
      }
    }
    savePipeline(wData);
  } catch (_) {}

  // 2. Atualiza database.json (nas páginas da conta e em settings.profile_warmup_by_id)
  try {
    const dbPath = path.join(PROJECT_ROOT, 'database.json');
    if (fs.existsSync(dbPath)) {
      const dbData = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
      dbData.settings = dbData.settings || {};
      dbData.settings.profile_warmup_by_id = dbData.settings.profile_warmup_by_id || {};
      if (cleanPid8) {
        dbData.settings.profile_warmup_by_id[cleanPid8] = {
          profile_name: accountObj?.name || '',
          profile_videos_posted: totalPosted,
          profile_videos_posted_today: postedToday,
          last_profile_video_date: todayStr,
          last_profile_video_at: nowIso,
          posted_profile_warmup_files: [...postedFiles]
        };
      }
      for (const pg of (dbData.pages || [])) {
        const pgPid8 = String(pg.profile_browser_ID || '').trim().toLowerCase().slice(0, 8);
        if (cleanPid8 && pgPid8 === cleanPid8) {
          pg.profile_videos_posted = totalPosted;
          pg.profile_videos_posted_today = postedToday;
          pg.last_profile_video_date = todayStr;
          pg.last_profile_video_at = nowIso;
          pg.posted_profile_warmup_files = [...postedFiles];
        }
      }
      fs.writeFileSync(dbPath, JSON.stringify(dbData, null, 2), 'utf8');
    }
  } catch (_) {}
}

/**
 * Posta 1 vídeo de aquecimento em PT-BR/K-Drama diretamente no Perfil Pessoal (Conta Mãe):
 */
async function postSingleWarmupReelOnPersonalProfile(page, automator, accountObj = {}, onLog = console.log, scheduleOffsetMinutes = 0) {
  const settings = require('../../db').getSettings() || {};
  if (settings.emergency_pause_all_posting === true) {
    onLog(`🛑 [EMERGÊNCIA] TRAVA TOTAL DE POSTAGEM ATIVADA PELO OPERADOR (${settings.emergency_pause_reason || 'Pausa geral'}). Nenhuma postagem em perfil pessoal permitida.`);
    return { success: false, reason: 'EMERGENCY_PAUSE_ALL_POSTING' };
  }
  const accountLabel = accountObj?.name || accountObj?.email || 'Perfil Pessoal';
  let stagedFileToClean = null;
  try {
    // 0) Lista QUALQUER arquivo .mp4 ou .mov que o operador colocar na raiz de VIDEOS_AQUECIMENTO_PERFIL_PTBR/ (ignorando subpastas e arquivos .tmp)
    const rawDirFiles = fs.existsSync(PROFILE_WARMUP_VIDEOS_DIR)
      ? fs.readdirSync(PROFILE_WARMUP_VIDEOS_DIR, { withFileTypes: true })
          .filter(ent => ent.isFile() && /\.(mp4|mov)$/i.test(ent.name) && !/\.tmp\.(mp4|mov)$/i.test(ent.name) && !/\.compress_tmp\.mp4$/i.test(ent.name))
          .map(ent => ent.name)
          .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
      : [];
    const allFiles = rawDirFiles;

    if (allFiles.length === 0) {
      onLog(`⏸️ [Perfil Mãe] Pasta VIDEOS_AQUECIMENTO_PERFIL_PTBR vazia — aguardando o operador subir os vídeos próprios.`);
      return { success: false, skipped: true, reason: 'NO_WARMUP_VIDEOS_IN_DIR' };
    }

    await armAntiBeforeUnloadAndDismissExitModal(page);
    // a) Garante atuação no Perfil Pessoal + Modo Profissional ativo + Captura c_user
    await ensurePersonalProfileProfessionalMode(page, automator, onLog, accountObj);

    const alreadyPostedInThisAccount = new Set([
      ...(Array.isArray(accountObj?.posted_profile_warmup_files) ? accountObj.posted_profile_warmup_files : []),
      ...(Array.isArray(accountObj?.warmup_stats?.posted_profile_warmup_files) ? accountObj.warmup_stats.posted_profile_warmup_files : [])
    ]);

    // PARTICIONAMENTO EXCLUSIVO ENTRE CONTAS: Prioriza vídeos de VIDEOS_AQUECIMENTO_PERFIL_PTBR que NENHUMA outra conta postou ainda!
    const globallyUsedByOtherAccounts = new Set();
    try {
      const wData = loadPipeline();
      const curPid = String(accountObj?.incogniton_profile_id || '').trim().toLowerCase();
      const curEmail = String(accountObj?.email || '').trim().toLowerCase();
      for (const otherAcc of (wData.accounts || [])) {
        const oPid = String(otherAcc?.incogniton_profile_id || '').trim().toLowerCase();
        const oEmail = String(otherAcc?.email || '').trim().toLowerCase();
        if ((curPid && oPid === curPid) || (curEmail && oEmail === curEmail)) continue;
        const oFiles = [
          ...(Array.isArray(otherAcc?.posted_profile_warmup_files) ? otherAcc.posted_profile_warmup_files : []),
          ...(Array.isArray(otherAcc?.warmup_stats?.posted_profile_warmup_files) ? otherAcc.warmup_stats.posted_profile_warmup_files : [])
        ];
        for (const f of oFiles) globallyUsedByOtherAccounts.add(f);
      }
    } catch (_) {}

    const currentPostedCount = Number(accountObj?.profile_videos_posted || accountObj?.warmup_stats?.profile_videos_posted || 0);
    const slotNumber = Math.min(9, currentPostedCount + 1);

    // 1ª prioridade: Inédito nesta conta E inédito em todas as outras contas
    // 2ª prioridade: Inédito nesta conta
    const chosenFile =
      allFiles.find(f => !alreadyPostedInThisAccount.has(f) && !globallyUsedByOtherAccounts.has(f)) ||
      allFiles.find(f => !alreadyPostedInThisAccount.has(f)) ||
      allFiles[currentPostedCount % allFiles.length];
    const inputPath = path.join(PROFILE_WARMUP_VIDEOS_DIR, chosenFile);

    // c) Processa via prepareProfileWarmupVideoHsl (useHflip = false p/ preservar textos/legendas do operador) + seleciona legenda PT-BR
    const isDoramaRomance = /03_DORAMA_ROMANCE_HEADLINE_|dorama_romance/i.test(chosenFile);
    const isCoreanoBrasil = /coreano_brasil/i.test(chosenFile);
    const isKdramaEdit = /kdrama|dorama/i.test(chosenFile);

    const doramaRomanceCaptions = [
      'Quem mais ama esses doramas? A química deles é perfeita! ❤️🥺 Qual o nome desse pra quem já viu?',
      'Aquele momento do dorama que faz o coração acelerar... Impossível não se emocionar! 🥰✨',
      'O casal mais lindo dos doramas! Quem aí também é apaixonada por dorama coreano? 😂❤️',
      'Não aguento a fofura desses dois! 🥺❤️ Alguém sabe o nome desse dorama?',
      'A cena mais linda do dorama que você vai ver hoje! Apaixonada real 🥰✨',
      'Aquele friozinho na barriga que só dorama dá... Casal perfeito demais! 🥺❤️',
      'Impossível segurar as lágrimas com esse casal... Quem já assistiu essa obra de arte? 😭✨',
      'Quando o olhar diz mais que qualquer palavra no dorama 🥰❤️'
    ];
    const coreanoBrasilCaptions = [
      'Quando o coreano aprende a xavecar em português ninguém segura! 😂🇰🇷🇧🇷',
      'Olha o desenrolo desse coreano falando português 😳❤️',
      'O sotaque dele mandando cantada em português é tudo! 😂🇧🇷',
      'Esse coreano já tem CPF e diploma de xavequeiro no Brasil 😂❤️',
      'A simpatia e o charme dele falando português conquistam qualquer um 🥰🇰🇷',
      'Impossível não sorrir vendo esse coreano na resenha em português 😂✨',
      'Coreano desenrolando em português melhor que muita gente! 😂🇧🇷🇰🇷',
      'A reação dela quando ele solta o português é impagável 👀❤️',
      'Brasil e Coreia na melhor resenha da internet! 🇧🇷🇰🇷❤️'
    ];
    const kdramaCaptions = [
      '💔✨',
      'Que cena incrível... 💔🎬',
      'Quem mais ama essa série? ❤️✨',
      'Impossível não se emocionar 🥺❤️',
      'Esse olhar diz tudo... 💔✨',
      'Melhor cena! 🎬❤️'
    ];
    onLog(`🎬 [Perfil Mãe PT-BR • Vídeo ${slotNumber}/9] Preparando "${chosenFile}" (Exclusivo + Auto-Edição Anti-Hash 720x1280 + Pitch Shift 1.035x • Sem Espelhar Texto) para "${accountLabel}"...`);
    const hslPrep = prepareProfileWarmupVideoHsl(inputPath, slotNumber, {
      hflip: false,
      accountSalt: accountObj?.incogniton_profile_id || accountObj?.email || accountLabel
    });
    stagedFileToClean = hslPrep.outputPath;
    const captionText = isDoramaRomance
      ? doramaRomanceCaptions[(slotNumber - 1) % doramaRomanceCaptions.length]
      : (isCoreanoBrasil
        ? coreanoBrasilCaptions[(slotNumber - 1) % coreanoBrasilCaptions.length]
        : (isKdramaEdit ? kdramaCaptions[(slotNumber - 1) % kdramaCaptions.length] : PTBR_FAMILIAR_CAPTIONS[(slotNumber - 1) % PTBR_FAMILIAR_CAPTIONS.length]));

    // d) Garante Perfil Pessoal e abre facebook.com/reels/create
    if (automator && typeof automator.ensureActingAsPersonalProfile === 'function') {
      await automator.ensureActingAsPersonalProfile(page, onLog);
    }

    let cdpClient = page._cdpKeepAwakeClient || null;
    if (!cdpClient && typeof page.target === 'function') {
      try {
        cdpClient = await page.target().createCDPSession();
      } catch (_) {}
    }
    if (cdpClient) {
      await cdpClient.send('Page.enable').catch(() => {});
      await cdpClient.send('Page.setInterceptFileChooserDialog', { enabled: true }).catch(() => {});
      if (!cdpClient._antiBeforeUnloadListenerAttached) {
        cdpClient._antiBeforeUnloadListenerAttached = true;
        cdpClient.on('Page.javascriptDialogOpening', () => {
          cdpClient.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
        });
      }
    }
    if (!page._antiBeforeUnloadDialogHandlerAttached && typeof page.on === 'function') {
      page._antiBeforeUnloadDialogHandlerAttached = true;
      page.on('dialog', async (dialog) => {
        try { await dialog.accept(); } catch (_) {}
      });
    }

    const fbOrigin = /^https:\/\/web\.facebook\.com/i.test(page.url()) ? 'https://web.facebook.com' : 'https://www.facebook.com';
    const requireFullPageForScheduling = Number(scheduleOffsetMinutes) > 0;
    onLog(`📤 [Perfil Mãe PT-BR • Vídeo ${slotNumber}/9] Abrindo criador de Reels do Perfil Pessoal (${fbOrigin}/reels/create${requireFullPageForScheduling ? ' • Modo Tela Cheia p/ Agendamento' : ''})...`);
    if (requireFullPageForScheduling || String(page.url() || '').toLowerCase().includes('/professional_dashboard')) {
      if (automator && typeof automator.openReelCreatorHumanly === 'function') {
        await automator.openReelCreatorHumanly(page, accountLabel, onLog, requireFullPageForScheduling).catch(() => {});
      }
      if (!String(page.url() || '').toLowerCase().includes('/reels/create')) {
        onLog(`🧭 [Perfil Mãe PT-BR • Agendamento Slot +${Math.round(Number(scheduleOffsetMinutes) / 60)}h] Garantindo rota de tela cheia (${fbOrigin}/reels/create) — perfis pessoais só exibem "Opções de programação" fora do modal popup!`);
        await page.goto(`${fbOrigin}/reels/create`, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
        await new Promise(r => setTimeout(r, 3800));
      }
    } else if (automator && typeof automator.openReelCreatorHumanly === 'function') {
      await automator.openReelCreatorHumanly(page, accountLabel, onLog, false);
    } else {
      await page.goto(`${fbOrigin}/reels/create`, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 3500));
    }
    if (automator && typeof automator.dismissWelcomePageModalAndCancelCover === 'function') {
      await automator.dismissWelcomePageModalAndCancelCover(page, onLog).catch(() => {});
    }
    await new Promise(r => setTimeout(r, 2400));

    let fileInput = null;
    let retriedOpenModal = false;
    const startWait = Date.now();
    while ((Date.now() - startWait) < 45000 && !fileInput) {
      if (requireFullPageForScheduling && !String(page.url() || '').toLowerCase().includes('/reels/create')) {
        await page.goto(`${fbOrigin}/reels/create`, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
        await new Promise(r => setTimeout(r, 3500));
      }
      if (!retriedOpenModal && (Date.now() - startWait) > 11000) {
        retriedOpenModal = true;
        if (requireFullPageForScheduling) {
          onLog(`🔄 [Perfil Mãe PT-BR] Recarregando ${fbOrigin}/reels/create em tela cheia para slot agendado...`);
          await page.goto(`${fbOrigin}/reels/create`, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
        } else {
          onLog(`🔄 [Perfil Mãe PT-BR] Re-acionando "Criar -> Reel" no Perfil Pessoal (bundle JS agora em cache)...`);
          if (automator && typeof automator.openReelCreatorHumanly === 'function') {
            await automator.openReelCreatorHumanly(page, accountLabel, onLog, false).catch(() => {});
          }
        }
        await new Promise(r => setTimeout(r, 3000));
      }
      const handle = await page.evaluateHandle(() => {
        const sp = document.getElementById('splash-screen');
        if (sp && window.getComputedStyle(sp).display !== 'none' && sp.getBoundingClientRect().width > 0) return null;
        const bodyTxt = (document.body && document.body.innerText ? document.body.innerText : '').trim();
        if (bodyTxt.length < 20) return null;
        if (window.location.href.includes('/reels/create')) {
          const hasReelDropzone = /adicionar um v[ií]deo|adicione um v[ií]deo|add a? ?video|arraste e solte|drag and drop|substituir/i.test(bodyTxt);
          if (!hasReelDropzone) return null;
        }
        const allInputs = Array.from(document.querySelectorAll('input[type="file"]'));
        for (const inp of allInputs) {
          const form = inp.closest('[role="form"]');
          if (form && /reel/i.test(form.getAttribute('aria-label') || '')) return inp;
        }
        for (const inp of allInputs) {
          const dlg = inp.closest('[role="dialog"]');
          if (dlg && /criar reel|create reel|adicione um v|adicionar um v|arraste e solte|drag and drop/i.test(dlg.innerText || '')) return inp;
        }
        // Prioridade máxima para input exclusivo de vídeo (sem image)
        for (let i = allInputs.length - 1; i >= 0; i--) {
          const acc = (allInputs[i].getAttribute('accept') || '').toLowerCase();
          if (acc.includes('video') && !acc.includes('image')) return allInputs[i];
        }
        if (window.location.href.includes('/reels/create')) {
          for (let i = allInputs.length - 1; i >= 0; i--) {
            const acc = (allInputs[i].getAttribute('accept') || '').toLowerCase();
            if (acc.includes('video')) return allInputs[i];
          }
        }
        return null;
      }).catch(() => null);
      const elem = handle && handle.asElement ? handle.asElement() : null;
      if (elem) {
        fileInput = elem;
        break;
      }
      if (handle) await handle.dispose().catch(() => {});
      await new Promise(r => setTimeout(r, 900));
    }

    if (!fileInput) {
      throw new Error('Input de vídeo hidratado não encontrado em /reels/create no Perfil Pessoal.');
    }

    try {
      await fileInput.uploadFile(hslPrep.outputPath);
    } finally {
      if (cdpClient) {
        await cdpClient.send('Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => {});
      }
    }

    onLog(`⏳ [Perfil Mãe PT-BR • Vídeo ${slotNumber}/9] Vídeo enviado. Aguardando pré-visualização carregar e botão "Avançar" (ou Composer de 1 Etapa) habilitar...`);
    await new Promise(r => setTimeout(r, 2600));
    let retriedHydratedUploadCount = 0;
    let onboardingModalClicksCount = 0;
    let previewReady = false;
    let isSingleStepComposer = false;
    for (let wStep1 = 0; wStep1 < 45; wStep1++) {
      const step1State = await page.evaluate(() => {
        const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
        const bodyTxt = (document.body?.innerText || '');
        const bodyNorm = norm(bodyTxt);

        // 1A-0. Se o modal "Sair da página?" ("Você ainda não terminou de escrever seu post") aparecer DURANTE o upload/edição, clica em "Continuar editando"!
        let modalAction = null;
        const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]'));
        for (const d of dialogs) {
          const dt = norm(d.innerText || '');
          if (dt.includes('sair da pagina') || dt.includes('leave page') || dt.includes('ainda nao terminou de escrever')) {
            const btns = Array.from(d.querySelectorAll('[role="button"], button, span'));
            for (const b of btns) {
              const bt = norm(b.innerText || b.getAttribute?.('aria-label') || '');
              if (bt === 'continuar editando' || bt === 'keep editing' || bt === 'permanecer' || bt === 'stay') {
                const target = b.closest('[role="button"], button') || b;
                const r = target.getBoundingClientRect();
                if (r.width > 30 && r.height > 18) {
                  modalAction = { type: 'KEEP_EDITING', label: bt, x: r.left + r.width / 2, y: r.top + r.height / 2 };
                  break;
                }
              }
            }
          }
          if (modalAction) break;
        }

        // 1A. Modal de onboarding de 2 Etapas ("Atualizar as configurações" / "Simplifique seu processo de criação" / "Quem pode ver seus posts e reels futuros?")
        if (
          !modalAction && (
            bodyNorm.includes('atualizar as configuracoes') ||
            bodyNorm.includes('simplifique seu processo de criacao') ||
            bodyNorm.includes('os reels podem ser longos ou curtos') ||
            bodyNorm.includes('quem pode ver seus posts e reels futuros') ||
            bodyNorm.includes('who can see your future posts and reels') ||
            bodyNorm.includes('update settings') ||
            bodyNorm.includes('simplify your creation process')
          )
        ) {
          // Etapa 2: "Quem pode ver seus posts e reels futuros?" -> Seleciona rádio "Público" e depois clica em "Salvar" (ou "Cancelar")
          if (
            bodyNorm.includes('quem pode ver seus posts e reels futuros') ||
            bodyNorm.includes('who can see your future posts and reels')
          ) {
            const scopeDlg = dialogs.find(d => {
              const dt = norm(d.innerText || '');
              return dt.includes('quem pode ver seus posts e reels futuros') || dt.includes('who can see your future posts and reels') || dt.includes('atualizar as configuracoes');
            }) || document;

            // Se o botão "Salvar" já estiver habilitado, clica nele
            const dlgBtns = Array.from(scopeDlg.querySelectorAll('[role="button"], button'));
            for (const b of dlgBtns) {
              const bt = norm(b.innerText || b.getAttribute?.('aria-label') || '');
              if ((bt === 'salvar' || bt === 'save') && b.getAttribute('aria-disabled') !== 'true' && !b.disabled) {
                const r = b.getBoundingClientRect();
                if (r.width > 30 && r.height > 18) {
                  modalAction = { type: 'SAVE_FUTURE_AUDIENCE', label: bt, x: r.left + r.width / 2, y: r.top + r.height / 2 };
                  break;
                }
              }
            }

            // Senão, localiza o rádio "Público" / "Public" dentro do modal
            if (!modalAction) {
              const radioCandidates = Array.from(scopeDlg.querySelectorAll('[role="radio"], [role="button"], span, div'));
              for (const rc of radioCandidates) {
                const rt = norm(rc.innerText || rc.getAttribute?.('aria-label') || '');
                if (rt === 'publico' || rt === 'public') {
                  const target = rc.closest('[role="radio"], [role="button"]') || rc;
                  const r = target.getBoundingClientRect();
                  if (r.width > 20 && r.height > 14 && r.height < 110) {
                    modalAction = { type: 'SELECT_PUBLIC_FOR_FUTURE_REELS', label: rt, x: r.left + r.width / 2, y: r.top + r.height / 2 };
                    break;
                  }
                }
              }
            }

            // Fallback: se não achou o rádio, clica em "Cancelar" no modal de Atualizar configurações para destravar na hora
            if (!modalAction) {
              for (const b of dlgBtns) {
                const bt = norm(b.innerText || b.getAttribute?.('aria-label') || '');
                if ((bt === 'cancelar' || bt === 'cancel') && b.getAttribute('aria-disabled') !== 'true') {
                  const r = b.getBoundingClientRect();
                  if (r.width > 30 && r.height > 18) {
                    modalAction = { type: 'CANCEL_ONBOARDING_MODAL', label: bt, x: r.left + r.width / 2, y: r.top + r.height / 2 };
                    break;
                  }
                }
              }
            }
          } else {
            // Etapa 1: "Os reels podem ser longos ou curtos..." -> botão "Continuar"
            const modalBtns = Array.from(document.querySelectorAll('[role="dialog"] [role="button"], [role="dialog"] button, [role="button"], button, span'));
            for (const b of modalBtns) {
              const bt = norm(b.innerText || b.textContent || '');
              const aria = norm(b.getAttribute?.('aria-label') || '');
              if (bt === 'continuar' || bt === 'continue' || bt === 'entendi' || bt === 'got it' || bt === 'ok' || aria === 'continuar' || aria === 'continue') {
                const btnEl = b.closest('[role="button"], button') || b;
                if (btnEl.getAttribute('aria-disabled') === 'true' || btnEl.disabled) continue;
                const r = btnEl.getBoundingClientRect();
                if (r.width > 30 && r.height > 18 && r.top > 120) {
                  modalAction = { type: 'CONTINUE_ONBOARDING_STEP1', label: bt || aria, x: r.left + r.width / 2, y: r.top + r.height / 2 };
                  break;
                }
              }
            }
          }
        }

        const pctMatch = bodyTxt.match(/(?:carregando|loading)\s+(\d+)%/i);
        const pct = pctMatch ? parseInt(pctMatch[1], 10) : null;
        // IMPORTANTE: Remove o texto estático da dropzone ("Carregando vídeo\nou arraste e solte" = tradução da Meta para "Upload video or drag and drop") antes de testar isProcessingVideo!
        const bodyWithoutDropzone = bodyTxt.replace(/carregando v[ií]deo[\s\n]+ou arraste e solte/gi, '');
        const hasLoadedMedia = /m[ií]dia carregada|substituir m[ií]dia|loaded media|replace media/i.test(bodyTxt);
        const hasVideoElReady = Array.from(document.querySelectorAll('video')).some(v => v.readyState >= 2 || v.duration > 0);
        const btns = Array.from(document.querySelectorAll('div[role="button"], button, span'));
        const hasNext = btns.some(b => {
          const t = (b.innerText || b.textContent || '').trim().toLowerCase();
          const a = (b.getAttribute?.('aria-label') || '').trim().toLowerCase();
          if (t !== 'avançar' && t !== 'next' && a !== 'avançar' && a !== 'next') return false;
          const btnEl = b.closest('div[role="button"], button') || b;
          if (btnEl.getAttribute('aria-disabled') === 'true' || btnEl.disabled) return false;
          const r = btnEl.getBoundingClientRect();
          return r.width > 20 && r.height > 15;
        });
        const isProcessingVideo = !hasNext && !hasLoadedMedia && !hasVideoElReady && /carregando v[ií]deo|loading video/i.test(bodyWithoutDropzone);
        const isPreviewPending = !hasNext && !hasLoadedMedia && !hasVideoElReady && /carregue o v[ií]deo para ver uma pr[eé]via|carregue um v[ií]deo para ver uma pr[eé]via/i.test(bodyTxt);
        const hasDirectPublishBtn = btns.some(b => {
          const t = (b.innerText || b.textContent || '').trim().toLowerCase();
          const a = (b.getAttribute?.('aria-label') || '').trim().toLowerCase();
          if (!/^(publicar|postar|compartilhar(\s+agora|\s+reel)?|publish|share(\s+now|\s+reel)?|post)$/i.test(t || a)) return false;
          const btnEl = b.closest('div[role="button"], button') || b;
          if (btnEl.getAttribute('aria-disabled') === 'true' || btnEl.disabled) return false;
          const r = btnEl.getBoundingClientRect();
          return r.width > 20 && r.height > 15;
        });
        const stillOnEmptyDropzone = !hasNext && !hasLoadedMedia && pct === null && (isPreviewPending || /adicionar um v[ií]deo|adicione um v[ií]deo|adicionar v[ií]deo|add a? ?video|arraste e solte|drag and drop/i.test(bodyTxt)) && !/substituir|replace/i.test(bodyTxt);
        return { hasNext, hasLoadedMedia, hasDirectPublishBtn, modalAction, pct, isProcessingVideo, isPreviewPending, stillOnEmptyDropzone };
      }).catch(() => ({ hasNext: false, hasLoadedMedia: false, hasDirectPublishBtn: false, modalAction: null, pct: null, isProcessingVideo: false, isPreviewPending: false, stillOnEmptyDropzone: false }));

      if (step1State.modalAction && onboardingModalClicksCount < 5) {
        onboardingModalClicksCount += 1;
        const ma = step1State.modalAction;
        if (ma.type === 'KEEP_EDITING') {
          onLog(`🛡️ [Perfil Mãe PT-BR] Modal "Sair da página?" detectado durante o upload — clicando em "${ma.label}" via mouse físico...`);
          await page.mouse.click(ma.x, ma.y);
          await new Promise(r => setTimeout(r, 1200));
        } else if (ma.type === 'SELECT_PUBLIC_FOR_FUTURE_REELS') {
          onLog(`🌐 [Perfil Mãe PT-BR] Modal "Atualizar as configurações (Etapa 2: Quem pode ver seus posts e reels futuros?)" — selecionando "Público" + "Salvar"...`);
          await page.mouse.click(ma.x, ma.y);
          await new Promise(r => setTimeout(r, 850));
          const saveOrCancelBox = await page.evaluate(() => {
            const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
            const btns = Array.from(document.querySelectorAll('[role="dialog"] [role="button"], [role="dialog"] button, [role="button"], button'));
            for (const b of btns) {
              const bt = norm(b.innerText || b.getAttribute?.('aria-label') || '');
              if ((bt === 'salvar' || bt === 'save') && b.getAttribute('aria-disabled') !== 'true' && !b.disabled) {
                const r = b.getBoundingClientRect();
                if (r.width > 30 && r.height > 18) return { label: bt, x: r.left + r.width / 2, y: r.top + r.height / 2 };
              }
            }
            for (const b of btns) {
              const bt = norm(b.innerText || b.getAttribute?.('aria-label') || '');
              if ((bt === 'cancelar' || bt === 'cancel') && b.getAttribute('aria-disabled') !== 'true' && !b.disabled) {
                const r = b.getBoundingClientRect();
                if (r.width > 30 && r.height > 18 && r.top > 150) return { label: bt, x: r.left + r.width / 2, y: r.top + r.height / 2 };
              }
            }
            return null;
          }).catch(() => null);
          if (saveOrCancelBox) {
            await page.mouse.click(saveOrCancelBox.x, saveOrCancelBox.y);
            await new Promise(r => setTimeout(r, 1400));
          }
        } else {
          onLog(`👋 [Perfil Mãe PT-BR] Modal "Atualizar as configurações / Simplifique seu processo de criação" fechado via mouse físico ("${ma.label}").`);
          await page.mouse.click(ma.x, ma.y);
          await new Promise(r => setTimeout(r, 1400));
        }
        wStep1 = Math.max(0, wStep1 - 1);
        continue;
      }

      if ((step1State.hasNext || (step1State.hasLoadedMedia && step1State.hasDirectPublishBtn)) && !step1State.isProcessingVideo && !step1State.isPreviewPending && (step1State.pct === null || step1State.pct >= 95)) {
        isSingleStepComposer = !step1State.hasNext && Boolean(step1State.hasDirectPublishBtn);
        onLog(`⏳ [Perfil Mãe PT-BR • Prévia Pronta${isSingleStepComposer ? ' • Composer Unificado 1 Etapa' : ''}] Aguardando 5s para consolidação e extração de thumbnail pelo Facebook (evita capa preta)...`);
        await new Promise(r => setTimeout(r, 5000));
        previewReady = true;
        break;
      }
      if ((step1State.stillOnEmptyDropzone || (!step1State.hasNext && !step1State.hasLoadedMedia && step1State.pct === null && !step1State.isProcessingVideo)) && retriedHydratedUploadCount < 2 && (wStep1 === 2 || wStep1 === 7)) {
        retriedHydratedUploadCount += 1;
        onLog(`🔄 [Auto-Heal Upload Perfil Mãe #${retriedHydratedUploadCount}] Criador de Reels (/reels/create) terminou de hidratar — reinjetando vídeo no input recém-montado...`);
        const reHandle = await page.evaluateHandle(() => {
          const inps = Array.from(document.querySelectorAll('input[type="file"]'));
          for (let i = inps.length - 1; i >= 0; i--) {
            const acc = (inps[i].getAttribute('accept') || '').toLowerCase();
            if (acc.includes('video') && !acc.includes('image')) return inps[i];
          }
          for (let i = inps.length - 1; i >= 0; i--) {
            const acc = (inps[i].getAttribute('accept') || '').toLowerCase();
            if (acc.includes('video')) return inps[i];
          }
          return inps[inps.length - 1] || null;
        }).catch(() => null);
        const reElem = reHandle && reHandle.asElement ? reHandle.asElement() : null;
        if (reElem) {
          if (cdpClient) {
            await cdpClient.send('Page.setInterceptFileChooserDialog', { enabled: true }).catch(() => {});
          }
          try {
            await reElem.uploadFile(hslPrep.outputPath);
          } catch (_) {}
          if (cdpClient) {
            await cdpClient.send('Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => {});
          }
          await new Promise(r => setTimeout(r, 5000));
        }
        if (reHandle) await reHandle.dispose().catch(() => {});
      }
      await new Promise(r => setTimeout(r, 2200));
    }

    if (!previewReady) {
      throw new Error('Pré-visualização do vídeo não carregou ou botão "Avançar" permaneceu desabilitado no Perfil Pessoal.');
    }

    let captionTyped = false;
    if (automator && typeof automator.typeCleanReelCaptionInComposer === 'function') {
      captionTyped = await automator.typeCleanReelCaptionInComposer(page, captionText, onLog, true).catch(() => false);
    }

    if (!isSingleStepComposer && automator && typeof automator.clickNextButton === 'function') {
      await automator.clickNextButton(page, onLog);
      await new Promise(r => setTimeout(r, 2200));
      if (automator.dismissWelcomePageModalAndCancelCover) {
        await automator.dismissWelcomePageModalAndCancelCover(page, onLog).catch(() => {});
      }
      await automator.clickNextButton(page, onLog, true);
      await new Promise(r => setTimeout(r, 2200));
      if (automator.dismissWelcomePageModalAndCancelCover) {
        await automator.dismissWelcomePageModalAndCancelCover(page, onLog).catch(() => {});
      }
    } else if (isSingleStepComposer) {
      onLog(`✨ [Composer Unificado 1 Etapa] Pulando cliques em "Avançar" — tela já exibe legenda, público e botão Publicar/Programar.`);
    }

    if (!captionTyped && automator && typeof automator.typeCleanReelCaptionInComposer === 'function') {
      await automator.typeCleanReelCaptionInComposer(page, captionText, onLog, false).catch(() => false);
    }

    // e.1) TRAVA OBRIGATÓRIA DE AUDIÊNCIA: garante 🌐 PÚBLICO (Public) antes de clicar em Publicar (nunca 👥 Amigos)!
    const isPublicConfirmed = await ensureReelAudienceIsPublic(page, onLog);
    if (!isPublicConfirmed) {
      throw new Error('BLOQUEIO ANTI-AMIGOS: Não foi possível alterar a audiência do Reel para PÚBLICO no Perfil Pessoal — abortando para jamais postar apenas para amigos!');
    }

    let publishedClicked = false;
    let scheduledForIso = null;
    if (Number(scheduleOffsetMinutes) > 0 && automator && typeof automator.enableReelSchedulingInComposer === 'function') {
      scheduledForIso = await automator.enableReelSchedulingInComposer(page, Number(scheduleOffsetMinutes), onLog);
      if (!scheduledForIso) {
        throw new Error('Botão Programar não disponível no modal do Perfil Pessoal — abortando agendamento para jamais postar ao vivo em rajada.');
      }
    }
    if (automator && typeof automator.clickPublishButton === 'function') {
      await automator.clickPublishButton(page, onLog, Boolean(scheduledForIso)).then(() => {
        publishedClicked = true;
      }).catch(async () => {
        const fallbackBox = await page.evaluate((wantSchedule) => {
          const re = wantSchedule
            ? /^(programar|agendar|schedule|publicar|postar|compartilhar(\s+agora|\s+reel)?|publish|share(\s+now|\s+reel)?|post)$/i
            : /^(publicar|postar|compartilhar(\s+agora|\s+reel)?|publish|share(\s+now|\s+reel)?|post)$/i;
          const visibleDialogs = Array.from(document.querySelectorAll('[role="dialog"]')).filter(d => {
            const r = d.getBoundingClientRect();
            return r.width > 400 && r.height > 300;
          });
          const scopeRoot = visibleDialogs.length > 0 ? visibleDialogs[visibleDialogs.length - 1] : document;
          const nodes = Array.from(scopeRoot.querySelectorAll('[role="button"], button'));
          for (let i = nodes.length - 1; i >= 0; i--) {
            const btn = nodes[i];
            const txt = (btn.innerText || btn.textContent || btn.getAttribute('aria-label') || '').trim();
            if (!re.test(txt)) continue;
            if (btn.getAttribute('aria-disabled') === 'true' || btn.disabled) continue;
            const r = btn.getBoundingClientRect();
            if (r.width > 20 && r.height > 15) {
              return { x: r.left, y: r.top, width: r.width, height: r.height, label: txt };
            }
          }
          return null;
        }, Boolean(scheduledForIso)).catch(() => null);
        if (fallbackBox && typeof automator.humanClickBox === 'function') {
          await automator.humanClickBox(page, fallbackBox);
          publishedClicked = true;
          onLog(`✅ [Perfil Mãe PT-BR] Botão final "${fallbackBox.label}" acionado dentro do modal no Perfil Pessoal!`);
        }
      });
    }

    if (!publishedClicked) {
      throw new Error('Botão Publicar/Compartilhar/Programar não foi clicado no Perfil Pessoal (bloqueio anti-falso-positivo).');
    }

    if (automator && typeof automator.waitForPublishConfirmation === 'function') {
      await automator.waitForPublishConfirmation(page, onLog, Boolean(scheduledForIso));
    } else {
      await new Promise(r => setTimeout(r, 8000));
    }

    // Pula navegação à aba Reels pós-post por padrão para manter velocidade máxima (só abre /me se forceAuditAfterPost === true)
    if (Boolean(accountObj?.forceAuditAfterPost)) {
      try {
        const shotsDir = path.join(PROJECT_ROOT, 'public', 'debug_shots');
        fs.mkdirSync(shotsDir, { recursive: true });
        await page.evaluate(() => {
          try { window.onbeforeunload = null; } catch (_) {}
        }).catch(() => {});
        await page.goto(`${fbOrigin}/me`, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
        await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('[role="dialog"] [role="button"], [role="dialog"] button'));
          for (const b of btns) {
            const t = (b.innerText || b.textContent || '').trim().toLowerCase();
            if (t === 'sair' || t === 'leave') { b.click(); break; }
          }
        }).catch(() => {});
        await new Promise(r => setTimeout(r, 2500));
        const shotPath = path.join(shotsDir, `perfil_pessoal_matriz_reel_${slotNumber}_9.png`);
        await page.screenshot({ path: shotPath, fullPage: false }).catch(() => {});
        onLog(`📸 [Prova Visual Perfil Mãe] Screenshot salvo em: ${shotPath}`);
      } catch (_) {}
    }

    onLog(`✅ [Perfil Mãe PT-BR • ${slotNumber}/9 Concluído] Reel "${chosenFile}" ${scheduledForIso ? `AGENDADO (${scheduledForIso})` : 'publicado AO VIVO'} no Perfil Pessoal de "${accountLabel}"!`);
    return {
      success: true,
      video_file: chosenFile,
      slot_number: slotNumber,
      caption: captionText,
      hsl: hslPrep.hslApplied,
      scheduled: Boolean(scheduledForIso),
      scheduled_for_iso: scheduledForIso
    };
  } catch (err) {
    onLog(`⚠️ [Perfil Mãe PT-BR] Aviso ao postar Reel no Perfil Pessoal de "${accountLabel}": ${err.message}`);
    try {
      await page.evaluate(() => {
        try { window.onbeforeunload = null; } catch (_) {}
        const btns = Array.from(document.querySelectorAll('[role="dialog"] [role="button"], [role="dialog"] button'));
        for (const b of btns) {
          const t = (b.innerText || b.textContent || '').trim().toLowerCase();
          if (t === 'sair' || t === 'leave' || t === 'continuar editando' || t === 'keep editing') { b.click(); break; }
        }
      }).catch(() => {});
    } catch (_) {}
    return {
      success: false,
      error: err.message
    };
  } finally {
    if (stagedFileToClean && fs.existsSync(stagedFileToClean)) {
      try { fs.unlinkSync(stagedFileToClean); } catch (_) {}
    }
  }
}

function getMinutesUntil2353(nowMs = Date.now()) {
  const nowObj = new Date(nowMs);
  const todayMaxMs = new Date(nowObj.getFullYear(), nowObj.getMonth(), nowObj.getDate(), 23, 53, 0).getTime();
  return Math.max(25, Math.floor((todayMaxMs - nowMs) / 60000));
}

function computeDynamicLiveCooldownMinutes(postedToday = 0, dailyQuota = 3, nowMs = Date.now()) {
  if (Number(postedToday || 0) <= 0) return 0;
  const remaining = Math.max(1, Number(dailyQuota || 3) - Number(postedToday || 0));
  const minsLeft = getMinutesUntil2353(nowMs);
  if (minsLeft >= remaining * 365) return 360; // 6h alvo quando há janela completa
  return Math.max(45, Math.floor((minsLeft * 0.88) / remaining));
}

function computeDynamicSameDayScheduleOffsetMinutes(slotOrder = 1, totalToSchedule = 2, previousSlotOffsetMinutes = 0, ownerId = '') {
  const randomInt = (min, max) => {
    const lo = Math.ceil(min);
    const hi = Math.max(lo, Math.floor(max));
    return lo + Math.floor(Math.random() * (hi - lo + 1));
  };
  const nowObj = new Date();
  const nowMs = nowObj.getTime();
  const todayMaxMs = new Date(nowObj.getFullYear(), nowObj.getMonth(), nowObj.getDate(), 23, 53, 0).getTime();
  const minutesLeftToday = Math.max(36, Math.floor((todayMaxMs - nowMs) / 60000));

  let minAllowedOffset = 24;
  let maxAllowedOffset = minutesLeftToday;
  let baseOffset = 180;

  if (Number(totalToSchedule) === 1 && Number(slotOrder) === 1 && Number(previousSlotOffsetMinutes) <= 0) {
    if (minutesLeftToday >= 390) {
      minAllowedOffset = 360;
      maxAllowedOffset = Math.min(minutesLeftToday - 2, 415);
      baseOffset = randomInt(minAllowedOffset, maxAllowedOffset);
    } else {
      minAllowedOffset = Math.max(24, Math.floor(minutesLeftToday * 0.56));
      maxAllowedOffset = Math.max(minAllowedOffset + 6, Math.min(minutesLeftToday - 2, Math.floor(minutesLeftToday * 0.78)));
      baseOffset = randomInt(minAllowedOffset, maxAllowedOffset);
    }
  } else if (minutesLeftToday >= 750) {
    const stepMinutes = 360 + randomInt(12, 55);
    baseOffset = (Number(slotOrder) === 1 || Number(previousSlotOffsetMinutes) <= 0)
      ? stepMinutes
      : (Number(previousSlotOffsetMinutes) + stepMinutes);
    minAllowedOffset = Math.max(25, baseOffset - 15);
    maxAllowedOffset = Math.min(minutesLeftToday - 2, baseOffset + 75);
  } else if (Number(slotOrder) === 1 && Number(previousSlotOffsetMinutes) <= 0) {
    minAllowedOffset = Math.max(23, Math.floor(minutesLeftToday * 0.40));
    maxAllowedOffset = Math.max(minAllowedOffset + 8, Math.floor(minutesLeftToday * 0.50));
    baseOffset = randomInt(minAllowedOffset, maxAllowedOffset);
  } else {
    minAllowedOffset = Math.min(minutesLeftToday - 8, Math.max(Number(previousSlotOffsetMinutes) + 24, Math.floor(minutesLeftToday * 0.82)));
    maxAllowedOffset = Math.max(minAllowedOffset + 5, minutesLeftToday - 2);
    baseOffset = randomInt(minAllowedOffset, maxAllowedOffset);
  }

  let scheduleOffsetMinutes = Math.min(maxAllowedOffset, Math.max(minAllowedOffset, baseOffset));
  const dbRef = require('../../db');
  const st = (dbRef && typeof dbRef.getSettings === 'function' ? dbRef.getSettings() : {}) || {};
  const rawList = Array.isArray(st.scheduled_slot_timestamps_utc) ? st.scheduled_slot_timestamps_utc : [];
  const activeTimestampsMs = rawList
    .map(x => {
      if (typeof x === 'number') return x;
      if (typeof x === 'string') return new Date(x).getTime();
      if (x && (x.target_ms || x.timestamp_utc)) return Number(x.target_ms || new Date(x.timestamp_utc).getTime());
      return 0;
    })
    .filter(ms => Number.isFinite(ms) && ms > nowMs - 3600000 && ms <= todayMaxMs);

  const isRoundQuarterMinute = (ms) => {
    const m = new Date(ms).getMinutes();
    return m === 0 || m === 15 || m === 30 || m === 45;
  };
  const minCollisionGapMs = minutesLeftToday >= 360 ? 660000 : (minutesLeftToday >= 180 ? 360000 : 180000);
  const hasCollision = (ms) => activeTimestampsMs.some(otherMs => Math.abs(ms - otherMs) < minCollisionGapMs);

  let targetMs = nowMs + scheduleOffsetMinutes * 60000;
  let guard = 0;
  while ((hasCollision(targetMs) || isRoundQuarterMinute(targetMs) || targetMs > todayMaxMs) && guard < 90) {
    scheduleOffsetMinutes += minutesLeftToday >= 360 ? randomInt(7, 15) : randomInt(2, 5);
    if (scheduleOffsetMinutes > maxAllowedOffset) {
      scheduleOffsetMinutes = minAllowedOffset + (guard % Math.max(4, maxAllowedOffset - minAllowedOffset));
    }
    targetMs = nowMs + scheduleOffsetMinutes * 60000;
    guard++;
  }
  if (targetMs > todayMaxMs) {
    scheduleOffsetMinutes = Math.max(23, minutesLeftToday - randomInt(2, 7));
    targetMs = nowMs + scheduleOffsetMinutes * 60000;
    if (isRoundQuarterMinute(targetMs)) {
      scheduleOffsetMinutes -= 2;
      targetMs = nowMs + scheduleOffsetMinutes * 60000;
    }
  }

  const targetIso = new Date(targetMs).toISOString();
  const updatedList = [
    ...rawList.filter(x => {
      const ms = typeof x === 'number' ? x : (typeof x === 'string' ? new Date(x).getTime() : Number(x?.target_ms || new Date(x?.timestamp_utc || 0).getTime()));
      return Number.isFinite(ms) && ms > nowMs - 3600000;
    }),
    targetIso
  ].slice(-250);

  try {
    if (dbRef && typeof dbRef.updateSettings === 'function') {
      dbRef.updateSettings({ scheduled_slot_timestamps_utc: updatedList });
    }
  } catch (_) {}

  return {
    offsetMinutes: scheduleOffsetMinutes,
    targetMs,
    targetIso,
    ownerId
  };
}

function hasUnpostedWarmupVideoForAccount(accountObj = {}) {
  try {
    if (!fs.existsSync(PROFILE_WARMUP_VIDEOS_DIR)) return false;
    const allFiles = fs.readdirSync(PROFILE_WARMUP_VIDEOS_DIR).filter(f => /\.(mp4|mov)$/i.test(f));
    if (allFiles.length === 0) return false;
    const used = new Set([
      ...(Array.isArray(accountObj?.posted_profile_warmup_files) ? accountObj.posted_profile_warmup_files : []),
      ...(Array.isArray(accountObj?.warmup_stats?.posted_profile_warmup_files) ? accountObj.warmup_stats.posted_profile_warmup_files : [])
    ]);
    return allFiles.some(f => !used.has(f));
  } catch (_) {
    return true;
  }
}

/**
 * Executa a cota diária de 3 vídeos/dia do Perfil Pessoal (Conta Mãe):
 * - Posta o Slot #1 AO VIVO (se fora de cooldown) e agenda os Slots #2 e #3 em tela cheia (/reels/create)
 *   com espaçamento alvo de 6h ou compressão proporcional automática até 23:53 de hoje!
 * - Caso o Perfil Pessoal específico não exiba botão "Programar", aborta o agendamento sem rajada
 *   e recalcula o cooldown dinâmico ao vivo para caberem os 3 vídeos no dia.
 */
async function postWarmupReelOnPersonalProfile(page, automator, accountObj = {}, onLog = console.log) {
  const settings = require('../../db').getSettings() || {};
  if (settings.emergency_pause_all_posting === true) {
    onLog(`🛑 [EMERGÊNCIA] TRAVA TOTAL DE POSTAGEM ATIVADA PELO OPERADOR (${settings.emergency_pause_reason || 'Pausa geral'}). Nenhuma postagem em perfil pessoal permitida.`);
    return {
      success: false,
      reason: 'EMERGENCY_PAUSE_ALL_POSTING',
      posted_this_session: 0,
      total_posted: Number(accountObj?.profile_videos_posted || accountObj?.warmup_stats?.profile_videos_posted || 0)
    };
  }
  const accountLabel = accountObj?.name || accountObj?.email || 'Perfil Pessoal';
  const cleanPid = String(accountObj?.incogniton_profile_id || accountObj?.profile_browser_ID || '').trim().toLowerCase();
  const isFixedIpMatriz = cleanPid === '00000000-0000-0000-0000-000000000004';
  const todayStr = new Date().toLocaleDateString('en-CA');
  let totalPosted = Number(accountObj?.profile_videos_posted || accountObj?.warmup_stats?.profile_videos_posted || 0);
  let postedToday = accountObj?.last_profile_video_date === todayStr
    ? Number(accountObj?.profile_videos_posted_today || 0)
    : 0;
  const postedFiles = Array.from(new Set([
    ...(Array.isArray(accountObj?.posted_profile_warmup_files) ? accountObj.posted_profile_warmup_files : []),
    ...(Array.isArray(accountObj?.warmup_stats?.posted_profile_warmup_files) ? accountObj.warmup_stats.posted_profile_warmup_files : [])
  ]));

  const dailyQuota = accountObj?.force_single_profile_video ? 1 : 3;

  // 0. TRAVA DE QUARENTENA DE 24H (Anti-Spam Recovery pós-rajada)
  const restUntil24h = accountObj?.rest_until_24h || accountObj?.warmup_stats?.rest_until_24h;
  if (restUntil24h) {
    const restMs = new Date(restUntil24h).getTime() - Date.now();
    if (restMs > 0) {
      const remHours = (restMs / (1000 * 3600)).toFixed(1);
      onLog(`🛑 [QUARENTENA 24H ATIVA] Perfil "${accountLabel}" está em repouso obrigatório por mais ${remHours}h (até ${restUntil24h}) para limpeza de score na Meta.`);
      return {
        success: false,
        skipped: true,
        reason: 'QUARANTINE_24H_ACTIVE',
        rest_until_24h: restUntil24h
      };
    }
  }

  // 1. Verificação de cota diária (3 vídeos/dia por perfil)
  if (postedToday >= dailyQuota) {
    onLog(`✅ [Cota Diária Concluída] Perfil "${accountLabel}" já atingiu a cota de ${postedToday}/${dailyQuota} Reels hoje (${todayStr}).`);
    return {
      success: false,
      skipped: true,
      reason: 'DAILY_QUOTA_REACHED',
      posted_today: postedToday,
      daily_quota: dailyQuota,
      total_posted: totalPosted
    };
  }

  const sessionResults = [];
  const lastPostIso = accountObj?.last_profile_video_at || accountObj?.warmup_stats?.last_profile_video_at;
  const elapsedMinutes = lastPostIso ? ((Date.now() - new Date(lastPostIso).getTime()) / (1000 * 60)) : 99999;
  const dynamicLiveCooldown = computeDynamicLiveCooldownMinutes(postedToday, dailyQuota);
  const canPostLiveSlotNow = postedToday === 0 || elapsedMinutes >= dynamicLiveCooldown;

  // Se ainda não pode postar AO VIVO porque já postou hoje há pouco tempo, em conta 4G ainda tenta AGENDAR os slots restantes!
  if (!canPostLiveSlotNow && (isFixedIpMatriz || settings.disable_facebook_native_scheduling || accountObj?._personalNativeScheduleUnsupported)) {
    const remainingMin = Math.max(1, Math.ceil(dynamicLiveCooldown - elapsedMinutes));
    onLog(`🛑 [Espaçamento Dinâmico Perfil Mãe] "${accountLabel}" postou há ${Math.round(elapsedMinutes)}min (${postedToday}/${dailyQuota} hoje). Próximo slot recalculado em ${remainingMin}min.`);
    return {
      success: false,
      skipped: true,
      reason: 'COOLDOWN_ACTIVE',
      elapsed_minutes: Math.round(elapsedMinutes),
      remaining_minutes: remainingMin
    };
  }

  accountObj.profile_videos_posted = totalPosted;
  accountObj.profile_videos_posted_today = postedToday;
  accountObj.last_profile_video_date = todayStr;
  accountObj.posted_profile_warmup_files = [...postedFiles];
  accountObj.warmup_stats = accountObj.warmup_stats || {};
  accountObj.warmup_stats.profile_videos_posted = totalPosted;
  accountObj.warmup_stats.posted_profile_warmup_files = [...postedFiles];

  if (canPostLiveSlotNow) {
    const nextDailyIdx = postedToday + 1;
    onLog(`🚀 [Perfil Mãe • Slot #${nextDailyIdx}/${dailyQuota} AO VIVO 🌐 PÚBLICO] Publicando Reel ${nextDailyIdx}/${dailyQuota} de hoje (Acumulado: ${totalPosted + 1}) em "${accountLabel}"...`);
    const liveRes = await postSingleWarmupReelOnPersonalProfile(page, automator, accountObj, onLog, 0);
    if (!liveRes || !liveRes.success) {
      onLog(`⚠️ [Perfil Mãe] Falha no Reel AO VIVO do Perfil Pessoal (${nextDailyIdx}/${dailyQuota}): ${liveRes?.error || liveRes?.reason || 'falha'}`);
      return liveRes;
    }

    totalPosted += 1;
    postedToday += 1;
    if (liveRes.video_file && !postedFiles.includes(liveRes.video_file)) {
      postedFiles.push(liveRes.video_file);
    }
    const nowIso = new Date().toISOString();
    accountObj.profile_videos_posted = totalPosted;
    accountObj.profile_videos_posted_today = postedToday;
    accountObj.last_profile_video_date = todayStr;
    accountObj.last_profile_video_at = nowIso;
    accountObj.posted_profile_warmup_files = [...postedFiles];
    accountObj.warmup_stats.profile_videos_posted = totalPosted;
    accountObj.warmup_stats.last_profile_video_at = nowIso;
    accountObj.warmup_stats.posted_profile_warmup_files = [...postedFiles];
    syncProfileWarmupToDisk(accountObj, totalPosted, postedToday, postedFiles, todayStr, nowIso);
    sessionResults.push(liveRes);
  }

  // 2. Agenda os slots restantes do dia (Slot #2 e Slot #3) em tela cheia (/reels/create) com recálculo automático <= 23:53!
  const allowPersonalScheduling = !settings.disable_facebook_native_scheduling && !accountObj?._personalNativeScheduleUnsupported;
  if (allowPersonalScheduling && postedToday < dailyQuota && hasUnpostedWarmupVideoForAccount(accountObj)) {
    const remainingToSchedule = dailyQuota - postedToday;
    let prevOffsetMins = 0;
    for (let sOrder = 1; sOrder <= remainingToSchedule; sOrder++) {
      if (automator?.abortRequested) break;
      if (!hasUnpostedWarmupVideoForAccount(accountObj)) break;
      const schedCalc = computeDynamicSameDayScheduleOffsetMinutes(sOrder, remainingToSchedule, prevOffsetMins, cleanPid || accountLabel);
      const offsetMins = schedCalc.offsetMinutes;
      prevOffsetMins = offsetMins;
      const targetSlotNum = postedToday + 1;
      onLog(`📅 [Perfil Mãe • Agendamento Slot #${targetSlotNum}/${dailyQuota}] Programando Reel para +${offsetMins}min (~${(offsetMins / 60).toFixed(1)}h -> ${schedCalc.targetIso}) em "${accountLabel}"...`);
      const schedRes = await postSingleWarmupReelOnPersonalProfile(page, automator, accountObj, onLog, offsetMins);
      if (schedRes && schedRes.success && schedRes.scheduled) {
        totalPosted += 1;
        postedToday += 1;
        if (schedRes.video_file && !postedFiles.includes(schedRes.video_file)) {
          postedFiles.push(schedRes.video_file);
        }
        const nowIsoSched = new Date().toISOString();
        accountObj.profile_videos_posted = totalPosted;
        accountObj.profile_videos_posted_today = postedToday;
        accountObj.last_profile_video_date = todayStr;
        accountObj.posted_profile_warmup_files = [...postedFiles];
        accountObj.warmup_stats.profile_videos_posted = totalPosted;
        accountObj.warmup_stats.posted_profile_warmup_files = [...postedFiles];
        syncProfileWarmupToDisk(accountObj, totalPosted, postedToday, postedFiles, todayStr, accountObj.last_profile_video_at || nowIsoSched);
        sessionResults.push(schedRes);
      } else {
        accountObj._personalNativeScheduleUnsupported = true;
        const nextDynMins = computeDynamicLiveCooldownMinutes(postedToday, dailyQuota);
        onLog(`ℹ️ [Perfil Mãe] Agendamento nativo indisponível neste perfil (${schedRes?.error || 'sem botão Programar'}). Próximo slot ao vivo recalculado para +${nextDynMins}min (<= 23:53).`);
        break;
      }
    }
  }

  // 3. Adição gradual de amigos pelas Sugestões do Facebook + Comunidade Health (Regra Wilas 60–75 amigos)
  let friendsRes = null;
  try {
    friendsRes = await warmPersonalProfileFriendsAndHealthGroups(page, accountObj, onLog);
  } catch (_) {}

  const firstSuccess = sessionResults[0] || { success: false, error: 'Nenhum slot publicado nesta sessão' };
  const nextCooldownMins = computeDynamicLiveCooldownMinutes(postedToday, dailyQuota);
  return {
    ...firstSuccess,
    success: sessionResults.length > 0,
    posted_this_session: sessionResults.length,
    posted_files: postedFiles,
    session_results: sessionResults,
    total_posted: totalPosted,
    posted_today: postedToday,
    daily_quota: dailyQuota,
    cooldown_enforced_minutes: nextCooldownMins,
    friends_warmup: friendsRes
  };
}

/**
 * REGRA WILAS CALL 04/11 (60 a 75 AMIGOS PELAS SUGESTÕES + COMUNIDADES HEALTH):
 * - Nunca faz busca manual nem adiciona em massa no mesmo turno (evita flag de spam).
 * - Visita 1 busca/comunidade do nicho Health / Receitas para calibrar as sugestões do algoritmo.
 * - Abre `facebook.com/friends/suggestions` e adiciona devagar 3 a 5 amigos sugeridos por sessão (delay humano 2.8s–4.8s),
 *   acumulando até a faixa alvo de 60 a 75 amigos.
 */
async function warmPersonalProfileFriendsAndHealthGroups(page, accountObj = {}, onLog = console.log, options = {}) {
  const accountLabel = accountObj?.name || accountObj?.email || 'Perfil Pessoal';
  let currentFriends = Number(accountObj?.friends_added_count || accountObj?.warmup_stats?.friends_added_count || 0);
  const targetGoal = 68; // Meio da faixa 60–75 do Wilas

  if (currentFriends >= targetGoal) {
    onLog(`🤝 [Amigos Wilas 60–75] "${accountLabel}" já atingiu ${currentFriends} amigos adicionados (dentro da meta 60–75).`);
    return { success: true, added_this_session: 0, total_friends_added: currentFriends, skipped_target_reached: true };
  }

  const maxToAdd = Math.max(2, Math.min(5, Number(options.max_per_session) || 4));
  let addedThisSession = 0;
  let healthGroupSeeded = false;

  try {
    // 1. Semente de Nicho Health (1x se ainda tiver poucos amigos): visita grupos públicos de Health/Recipes para calibrar sugestões
    if (currentFriends < 15 && options.seedHealthGroup !== false) {
      onLog(`🌿 [Nicho Health • Wilas] Calibrando algoritmo de sugestões de "${accountLabel}" em comunidades de receitas/saúde...`);
      await page.goto('https://www.facebook.com/search/groups/?q=healthy%20recipes%20daily%20wellness', {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      }).catch(() => {});
      await new Promise(r => setTimeout(r, 2600 + Math.floor(Math.random() * 1400)));
      await page.mouse.wheel({ deltaY: 320 + Math.floor(Math.random() * 240) }).catch(() => {});
      await new Promise(r => setTimeout(r, 1800));

      // Tenta entrar em 1 grupo público de saúde se houver botão "Participar" / "Join"
      healthGroupSeeded = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('[role="button"], button'));
        for (const b of btns) {
          const t = String(b.innerText || b.textContent || b.getAttribute('aria-label') || '').trim().toLowerCase();
          if (/^(participar|participar do grupo|join|join group)$/i.test(t)) {
            const r = b.getBoundingClientRect();
            if (r.width > 40 && r.height > 20 && r.top > 80 && r.top < 820) {
              b.click();
              return true;
            }
          }
        }
        return false;
      }).catch(() => false);

      if (healthGroupSeeded) {
        onLog(`✅ [Nicho Health • Wilas] Solicitação de entrada em comunidade Health enviada para calibrar sugestões!`);
        await new Promise(r => setTimeout(r, 2200));
      }
    }

    // 2. Abre as Sugestões Oficiais do Facebook (/friends/suggestions) e adiciona devagar 3 a 5 pessoas
    onLog(`🤝 [Amigos Wilas • Meta 60–75] Abrindo Sugestões do Facebook para "${accountLabel}" (Acumulado: ${currentFriends}/${targetGoal} • Meta desta sessão: +${maxToAdd})...`);
    await page.goto('https://www.facebook.com/friends/suggestions', {
      waitUntil: 'domcontentloaded',
      timeout: 35000
    }).catch(() => {});
    await new Promise(r => setTimeout(r, 3200 + Math.floor(Math.random() * 1200)));

    for (let step = 0; step < maxToAdd; step++) {
      const box = await page.evaluate(() => {
        const candidates = Array.from(document.querySelectorAll('[role="button"], button'));
        for (const el of candidates) {
          if (el.dataset && el.dataset.wilasClicked === '1') continue;
          const txt = String(el.innerText || el.textContent || '').trim().toLowerCase();
          const aria = String(el.getAttribute('aria-label') || '').trim().toLowerCase();
          const isAddFriend =
            txt === 'adicionar aos amigos' ||
            txt === 'adicionar' ||
            txt === 'add friend' ||
            aria.startsWith('adicionar ') ||
            aria.startsWith('add friend');
          if (!isAddFriend) continue;
          if (txt.includes('cancelar') || txt.includes('remover') || txt.includes('remove')) continue;
          const r = el.getBoundingClientRect();
          if (r.width >= 60 && r.height >= 24 && r.top >= 90 && r.top <= 860) {
            el.dataset.wilasClicked = '1';
            return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.5 };
          }
        }
        return null;
      }).catch(() => null);

      if (!box) {
        await page.mouse.wheel({ deltaY: 340 + Math.floor(Math.random() * 180) }).catch(() => {});
        await new Promise(r => setTimeout(r, 1600));
        continue;
      }

      await page.mouse.move(box.x + (Math.random() * 8 - 4), box.y + (Math.random() * 6 - 3), { steps: 6 }).catch(() => {});
      await new Promise(r => setTimeout(r, 180 + Math.floor(Math.random() * 200)));
      await page.mouse.click(box.x, box.y, { delay: 55 + Math.floor(Math.random() * 55) }).catch(() => {});
      addedThisSession++;
      currentFriends++;
      await new Promise(r => setTimeout(r, 2800 + Math.floor(Math.random() * 2000)));
    }

    // 3. Persiste contador de amigos em warming_accounts_pipeline.json
    accountObj.friends_added_count = currentFriends;
    accountObj.warmup_stats = accountObj.warmup_stats || {};
    accountObj.warmup_stats.friends_added_count = currentFriends;
    accountObj.warmup_stats.last_friends_warmup_at = new Date().toISOString();

    try {
      const pData = loadPipeline();
      if (pData && Array.isArray(pData.accounts)) {
        const needleId = String(accountObj.id || '').trim();
        const needleProf = String(accountObj.incogniton_profile_id || '').trim();
        const match = pData.accounts.find(a =>
          (needleId && a.id === needleId) ||
          (needleProf && a.incogniton_profile_id === needleProf)
        );
        if (match) {
          match.friends_added_count = currentFriends;
          match.warmup_stats = match.warmup_stats || {};
          match.warmup_stats.friends_added_count = currentFriends;
          match.warmup_stats.last_friends_warmup_at = new Date().toISOString();
          savePipeline(pData);
        }
      }
    } catch (_) {}

    onLog(`✅ [Amigos Wilas 60–75] +${addedThisSession} solicitações enviadas pelas Sugestões do Facebook (Total acumulado: ${currentFriends}/60–75)!`);
    return {
      success: true,
      added_this_session: addedThisSession,
      total_friends_added: currentFriends,
      health_group_seeded: healthGroupSeeded
    };
  } catch (err) {
    onLog(`⚠️ [Amigos Wilas] Aviso ao adicionar sugestões: ${err.message}`);
    return {
      success: false,
      added_this_session: addedThisSession,
      total_friends_added: currentFriends,
      error: err.message
    };
  }
}

module.exports = {
  GOLD_CONVEYOR_STAGES,
  PTBR_FAMILIAR_CAPTIONS,
  PROFILE_WARMUP_VIDEOS_DIR,
  prepareProfileWarmupVideoHsl,
  checkTikTokHandleOnFacebook,
  extractAndSavePersonalProfileUid,
  ensureReelAudienceIsPublic,
  ensurePersonalProfileProfessionalMode,
  evaluateGoldConveyorStage,
  syncProfileWarmupToDisk,
  getMinutesUntil2353,
  computeDynamicLiveCooldownMinutes,
  computeDynamicSameDayScheduleOffsetMinutes,
  hasUnpostedWarmupVideoForAccount,
  postSingleWarmupReelOnPersonalProfile,
  postWarmupReelOnPersonalProfile,
  warmPersonalProfileFriendsAndHealthGroups
};
