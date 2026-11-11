/**
 * ============================================================================
 * 🎵 TIKTOK VIRAL SHORT VIDEO DOWNLOADER — ESTEIRA PERFIL MÃE (PT-BR)
 * ============================================================================
 * Baixa automaticamente os vídeos mais virais e curtos (<= 35s) de um perfil
 * do TikTok direto para a pasta VIDEOS_AQUECIMENTO_PERFIL_PTBR/
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const puppeteer = require('puppeteer-core');

const OUTPUT_DIR = path.join(__dirname, '..', '..', 'VIDEOS_AQUECIMENTO_PERFIL_PTBR');

function findChromePath() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function parseViewsText(txt) {
  const s = String(txt || '').trim().toUpperCase().replace(/,/g, '.');
  const m = s.match(/([\d.]+)\s*([KMB])?/);
  if (!m) return 0;
  const num = parseFloat(m[1]);
  if (isNaN(num)) return 0;
  const mult = m[2] === 'M' ? 1_000_000 : m[2] === 'B' ? 1_000_000_000 : m[2] === 'K' ? 1_000 : 1;
  return Math.round(num * mult);
}

async function fetchTikTokProfileTopVideos(profileUrlOrHandle, maxCount = 15) {
  const cleanHandle = String(profileUrlOrHandle || '')
    .trim()
    .replace(/^https?:\/\/(www\.)?tiktok\.com\/@?/i, '')
    .replace(/^@/, '')
    .split(/[/?#]/)[0];

  const profileUrl = `https://www.tiktok.com/@${cleanHandle}`;
  console.log(`🔍 [TikTok Harvester] Inspecionando perfil @${cleanHandle} (${profileUrl})...`);

  // 1) Tenta extrair secUid direto do HTML para passar ao yt-dlp (tiktokuser:secUid)
  let secUid = null;
  try {
    const res = await fetch(profileUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8'
      }
    });
    const html = await res.text();
    const m = html.match(/"secUid"\s*:\s*"([^"]+)"/);
    if (m && m[1]) {
      secUid = m[1];
      console.log(`✅ [TikTok Harvester] secUid extraído do HTML: ${secUid.slice(0, 24)}...`);
    }
  } catch (_) {}

  // Se achou secUid, tenta listar via yt-dlp tiktokuser:<secUid>
  if (secUid) {
    try {
      const rawJson = execFileSync(
        'yt-dlp',
        ['--flat-playlist', '-J', '--playlist-end', '45', `tiktokuser:${secUid}`],
        { encoding: 'utf8', maxBuffer: 25 * 1024 * 1024, timeout: 45000 }
      );
      const parsed = JSON.parse(rawJson);
      if (parsed && Array.isArray(parsed.entries) && parsed.entries.length > 0) {
        const filtered = parsed.entries
          .filter(e => !e.duration || e.duration <= 38)
          .sort((a, b) => (b.view_count || 0) - (a.view_count || 0))
          .slice(0, maxCount)
          .map(e => ({
            id: e.id,
            url: e.url || e.webpage_url || `https://www.tiktok.com/@${cleanHandle}/video/${e.id}`,
            views: e.view_count || 0,
            duration: e.duration || 0,
            title: (e.title || '').slice(0, 60)
          }));
        if (filtered.length > 0) {
          return { handle: cleanHandle, secUid, videos: filtered };
        }
      }
    } catch (e) {
      console.log(`⚠️ [TikTok Harvester] yt-dlp tiktokuser falhou, abrindo navegador real para coletar aba Populares...`);
    }
  }

  // 2) Fallback infalível via Chrome/Edge: abre o perfil, clica na aba "Popular" / "Populares" e extrai os links mais virais!
  const chromePath = findChromePath();
  if (!chromePath) throw new Error('Chrome/Edge não encontrado para extrair vídeos do TikTok.');

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1280,900']
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
    await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 4000));

    // Tenta clicar no botão "Popular" / "Populares" para ordenar pelos mais virais
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, div[role="tab"], span'));
      for (const b of btns) {
        const t = (b.innerText || '').trim().toLowerCase();
        if (t === 'popular' || t === 'populares') {
          b.click();
          return true;
        }
      }
      return false;
    }).catch(() => {});
    await new Promise(r => setTimeout(r, 2500));

    // Faz 2 scrolls leves para carregar a grade
    for (let s = 0; s < 2; s++) {
      await page.evaluate(() => window.scrollBy(0, 900)).catch(() => {});
      await new Promise(r => setTimeout(r, 1200));
    }

    const rawVideos = await page.evaluate((h) => {
      const links = Array.from(document.querySelectorAll('a[href*="/video/"]'));
      const seen = new Set();
      const out = [];
      for (const a of links) {
        const href = a.href || '';
        const m = href.match(/\/video\/(\d+)/);
        if (!m) continue;
        const vid = m[1];
        if (seen.has(vid)) continue;
        seen.add(vid);
        const card = a.closest('[data-e2e="user-post-item"]') || a.parentElement;
        const viewEl = card ? card.querySelector('[data-e2e="video-views"], strong') : null;
        const viewTxt = viewEl ? viewEl.innerText : (a.innerText || '');
        out.push({
          id: vid,
          url: `https://www.tiktok.com/@${h}/video/${vid}`,
          viewTxt: String(viewTxt || '').trim()
        });
      }
      return out;
    }, cleanHandle);

    const ranked = rawVideos
      .map(v => ({
        id: v.id,
        url: v.url,
        views: parseViewsText(v.viewTxt),
        viewTxt: v.viewTxt
      }))
      .sort((a, b) => b.views - a.views)
      .slice(0, maxCount);

    return { handle: cleanHandle, secUid, videos: ranked };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function downloadTopTikTokVideosToWarmupPool(profileUrlOrHandle, maxDownload = 12) {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const info = await fetchTikTokProfileTopVideos(profileUrlOrHandle, maxDownload + 6);
  console.log(`📊 [TikTok Harvester] Encontrados ${info.videos.length} vídeos candidatos em @${info.handle}. Baixando os top ${maxDownload} curtos...`);

  const downloaded = [];
  for (const v of info.videos) {
    if (downloaded.length >= maxDownload) break;
    const outName = `PTBR_${info.handle}_${v.id}_${v.views || 0}v.mp4`;
    const outPath = path.join(OUTPUT_DIR, outName);
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 50_000) {
      console.log(`⏭️ Já existe no pool: ${outName}`);
      downloaded.push({ id: v.id, views: v.views, file: outName });
      continue;
    }

    try {
      console.log(`⬇️ Baixando [${downloaded.length + 1}/${maxDownload}] ${v.url} (${v.views || v.viewTxt || '?'} views)...`);
      execFileSync(
        'yt-dlp',
        [
          '--no-warnings',
          '--match-filter', 'duration <= 40',
          '-f', 'mp4/best[ext=mp4]/best',
          '-o', outPath,
          v.url
        ],
        { stdio: 'pipe', timeout: 60000 }
      );
      if (fs.existsSync(outPath) && fs.statSync(outPath).size > 50_000) {
        const sizeMb = (fs.statSync(outPath).size / (1024 * 1024)).toFixed(2);
        console.log(`✅ Salvo: ${outName} (${sizeMb} MB)`);
        downloaded.push({ id: v.id, views: v.views, file: outName, sizeMb });
      }
    } catch (e) {
      console.log(`⚠️ Pulo em ${v.id}: ${e.message.slice(0, 100)}`);
    }
  }

  return {
    handle: info.handle,
    total_found: info.videos.length,
    downloaded_count: downloaded.length,
    output_dir: OUTPUT_DIR,
    files: downloaded
  };
}

async function harvestTikTokKdramaRomance2030(maxDownload = 18) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const warmer = require('./profile_reels_warmer');

  // 1) Remove qualquer arquivo < 10s (000_DORAMA_*) ou do YouTube (00_KDRAMA_ROMANCE_*)
  for (const f of fs.readdirSync(OUTPUT_DIR)) {
    if (f.startsWith('000_DORAMA_') || f.startsWith('00_KDRAMA_ROMANCE_')) {
      try {
        fs.unlinkSync(path.join(OUTPUT_DIR, f));
        console.log(`🗑️ Removido arquivo fora do padrão TikTok 20-30s: ${f}`);
      } catch (_) {}
    }
  }

  // 2) Abre Chrome headless para varrer a busca do TikTok E perfis reais de K-Drama / Romance / AI Korean no TikTok
  const chromePath = findChromePath();
  const candidateVideos = new Map(); // id -> { handle, id, url, views }

  if (chromePath) {
    const browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: 'new',
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1366,900']
    });
    try {
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');

      const searchQueries = [
        'when the phone rings edit',
        'kdrama romance edit',
        'dorama edit romance',
        'ai korean romance',
        'queen of tears romance edit',
        'lovely runner romance edit'
      ];

      for (const q of searchQueries) {
        const searchUrl = `https://www.tiktok.com/search/video?q=${encodeURIComponent(q)}`;
        console.log(`🔎 [TikTok Search] Buscando no TikTok: "${q}"...`);
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
        await new Promise(r => setTimeout(r, 3500));
        const items = await page.evaluate(() => {
          const out = [];
          const anchors = Array.from(document.querySelectorAll('a[href*="/video/"]'));
          for (const a of anchors) {
            const m = (a.href || '').match(/tiktok\.com\/@([^/?#]+)\/video\/(\d{15,22})/i);
            if (m) {
              out.push({ handle: m[1], id: m[2], url: `https://www.tiktok.com/@${m[1]}/video/${m[2]}` });
            }
          }
          return out;
        }).catch(() => []);
        for (const it of items) {
          if (!candidateVideos.has(it.id)) candidateVideos.set(it.id, it);
        }
      }
    } finally {
      await browser.close().catch(() => {});
    }
  }

  // 3) Varre também perfis reais de Edits de Romance Coreano / Dorama no TikTok
  const tiktokKdramaHandles = [
    'filmcybers',
    'kdramas.edits',
    'k.dramaaedits',
    'kdrama_lovers',
    'doramas_editsbr',
    'koreandrama_edits',
    'kdramaclips',
    'dramakorean_edit'
  ];

  for (const h of tiktokKdramaHandles) {
    if (candidateVideos.size >= 70) break;
    try {
      const top = await fetchTikTokProfileTopVideos(h, 18);
      for (const v of (top.videos || [])) {
        if (v.id && !candidateVideos.has(String(v.id))) {
          candidateVideos.set(String(v.id), {
            handle: top.handle || h,
            id: String(v.id),
            url: v.url,
            views: v.views || 0
          });
        }
      }
    } catch (_) {}
  }

  console.log(`📊 Total de candidatos 100% TikTok coletados: ${candidateVideos.size}`);
  const safeHandleMap = new Map();
  const downloaded = [];

  for (const cand of candidateVideos.values()) {
    if (downloaded.length >= maxDownload) break;
    const cleanHandle = String(cand.handle || '').replace(/^@/, '');
    if (!cleanHandle) continue;

    if (!safeHandleMap.has(cleanHandle)) {
      const chk = await warmer.checkTikTokHandleOnFacebook(cleanHandle);
      safeHandleMap.set(cleanHandle, Boolean(chk && chk.safe));
      console.log(`🛡️ checkTikTokHandleOnFacebook(@${cleanHandle}): ${chk.safe ? 'SAFE' : 'BLOCKED'}`);
    }
    if (!safeHandleMap.get(cleanHandle)) continue;

    // Se já existe na pasta com esse ID de 19 dígitos do TikTok, verifica duração (18s..32s)
    const existingFile = fs.readdirSync(OUTPUT_DIR).find(f => f.includes(cand.id) && f.endsWith('.mp4'));
    if (existingFile) {
      try {
        const durStr = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path.join(OUTPUT_DIR, existingFile)], { encoding: 'utf8' }).trim();
        const dur = Number(durStr || 0);
        if (dur >= 18 && dur <= 32) {
          downloaded.push({ handle: cleanHandle, id: cand.id, duration: Number(dur.toFixed(1)), file: existingFile });
        } else {
          fs.unlinkSync(path.join(OUTPUT_DIR, existingFile));
          console.log(`🗑️ Removido vídeo fora da faixa 18s-32s (${dur.toFixed(1)}s): ${existingFile}`);
        }
      } catch (_) {}
      continue;
    }

    const safeHandleSlug = cleanHandle.replace(/[^a-zA-Z0-9]/g, '');
    const outTemplate = path.join(OUTPUT_DIR, `00_KDRAMA_TIKTOK_${safeHandleSlug}_${cand.id}_%(view_count)sv.mp4`);
    try {
      execFileSync(
        'yt-dlp',
        [
          '--no-warnings',
          '--match-filter', 'duration >= 18 & duration <= 32',
          '-f', 'mp4/best[ext=mp4]/best',
          '-o', outTemplate,
          cand.url
        ],
        { stdio: 'pipe', timeout: 45000 }
      );
      const savedFile = fs.readdirSync(OUTPUT_DIR).find(f => f.includes(cand.id) && f.endsWith('.mp4'));
      if (savedFile) {
        const durStr = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path.join(OUTPUT_DIR, savedFile)], { encoding: 'utf8' }).trim();
        const dur = Number(durStr || 0);
        console.log(`✅ Baixado do TikTok (${dur.toFixed(1)}s): ${savedFile}`);
        downloaded.push({ handle: cleanHandle, id: cand.id, duration: Number(dur.toFixed(1)), file: savedFile });
      }
    } catch (_) {}
  }

  return downloaded;
}

if (require.main === module) {
  if (process.argv.includes('--kdrama-romance')) {
    harvestTikTokKdramaRomance2030(18)
      .then(res => {
        console.log('\n🎉 RESUMO 100% TIKTOK K-DRAMA ROMANCE (18s–32s):');
        console.log(JSON.stringify(res, null, 2));
        process.exit(0);
      })
      .catch(err => {
        console.error('❌ Erro:', err.message);
        process.exit(1);
      });
  } else {
    const target = process.argv[2] || 'https://www.tiktok.com/@sr_kittyyyy';
    const count = Number(process.argv[3] || 12);
    downloadTopTikTokVideosToWarmupPool(target, count)
      .then(res => {
        console.log('\n🎉 RESUMO DO DOWNLOAD PARA VIDEOS_AQUECIMENTO_PERFIL_PTBR:');
        console.log(JSON.stringify(res, null, 2));
      })
      .catch(err => {
        console.error('❌ Erro:', err.message);
        process.exit(1);
      });
  }
}

module.exports = {
  fetchTikTokProfileTopVideos,
  downloadTopTikTokVideosToWarmupPool,
  harvestTikTokKdramaRomance2030
};

