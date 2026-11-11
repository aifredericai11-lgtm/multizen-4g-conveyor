/**
 * ============================================================================
 * MÓDULO ACCOUNT WARMUP: META PIXEL & COOKIE SEEDING (MÓDULO A)
 * ============================================================================
 * Diretório: modules/account_warmup/meta_pixel_warmer.js
 * 
 * Implementa a especificação forense do Universal Warmup Playbook:
 * - Visita publishers de alta autoridade e lojas Shopify dos EUA com Meta Pixel
 * - Aceita o banner de cookies da UE/EUA para destravar a execução do fbevents.js
 * - Gera cookies legítimos de 1ª parte: _fbp (fb.1.<ts>.<rand>)
 * - Dispara eventos PageView e ViewContent através de cliques internos orgânicos
 * ============================================================================
 */

const SEED_PUBLISHERS = [
  'https://www.goodhousekeeping.com/health/',
  'https://www.prevention.com/health/',
  'https://www.eatingwell.com/recipes/',
  'https://www.womenshealthmag.com/health/'
];

const SEED_SHOPIFY_DTC = [
  'https://allbirds.com/collections/mens',
  'https://nativecos.com/collections/deodorant'
];

function humanSleep(minMs, maxMs) {
  const ms = Math.floor(minMs + Math.random() * (maxMs - minMs));
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function humanTap(page, x, y, jitterPx = 4) {
  const tx = Math.max(4, Math.round(x + (Math.random() * 2 - 1) * jitterPx));
  const ty = Math.max(4, Math.round(y + (Math.random() * 2 - 1) * jitterPx));
  await page.mouse.move(tx, ty, { steps: 5 }).catch(() => {});
  await humanSleep(45, 95);
  await page.mouse.click(tx, ty, { delay: 60 }).catch(() => {});
}

async function dismissCookieBanner(page) {
  return await page.evaluate(() => {
    const selectors = [
      '#onetrust-accept-btn-handler',
      '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
      'button[id*="accept" i]',
      'button[class*="accept" i]'
    ];
    for (const s of selectors) {
      const el = document.querySelector(s);
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 30 && r.height > 18) {
          el.click();
          return { accepted: true, selector: s };
        }
      }
    }
    const btns = Array.from(document.querySelectorAll('button, a[role="button"]'));
    for (const b of btns) {
      const t = String(b.innerText || '').trim().toLowerCase();
      if (/^(accept|accept all|allow all|i agree|got it|agree|concordar|aceitar)$/i.test(t)) {
        b.click();
        return { accepted: true, text: t };
      }
    }
    return { accepted: false };
  }).catch(() => ({ accepted: false }));
}

async function dismissPopups(page) {
  await page.evaluate(() => {
    const closeBtns = Array.from(document.querySelectorAll('[aria-label*="close" i], [class*="klaviyo-close" i], button.close'));
    for (const b of closeBtns) {
      if (b.offsetParent !== null) b.click();
    }
  }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
}

async function readPixelTelemetry(page) {
  return await page.evaluate(() => {
    return {
      hasFbpCookie: document.cookie.includes('_fbp='),
      hasFbcCookie: document.cookie.includes('_fbc='),
      fbqPresent: typeof window.fbq === 'function' || Boolean(window._fbq),
      fbeventsScript: Boolean(document.querySelector('script[src*="connect.facebook.net"]'))
    };
  }).catch(() => ({ hasFbpCookie: false, hasFbcCookie: false, fbqPresent: false, fbeventsScript: false }));
}

async function warmMetaPixelCookies(tab, options = {}, onLog = console.log) {
  if (!tab) return { success: false, fbp_minted: false };

  const pool = [...SEED_PUBLISHERS, ...SEED_SHOPIFY_DTC].sort(() => Math.random() - 0.5);
  const targetDomains = pool.slice(0, Math.min(2, pool.length)); // Visita 2 sites por sessão

  onLog(`🍪 [Meta Pixel Warming • Módulo A] Iniciando seed de cookies _fbp em ${targetDomains.length} portais dos EUA...`);

  let fbpFound = false;

  for (const url of targetDomains) {
    try {
      const hostname = new URL(url).hostname;
      onLog(`🌐 [Pixel Seed] Navegando para https://${hostname}...`);
      
      await tab.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 }).catch(() => {});
      await humanSleep(3000, 5000);

      // 1. Checa se tomou Cloudflare/Bot wall; se sim, pula imediatamente
      const isChallenged = await tab.evaluate(() => {
        const t = (document.title + ' ' + (document.body?.innerText?.slice(0, 1500) || '')).toLowerCase();
        return /(verify you are human|press & hold|just a moment|attention required|access denied|pardon our interruption)/i.test(t);
      }).catch(() => false);

      if (isChallenged) {
        onLog(`⚠️ [Pixel Seed] Bot wall detectado em ${hostname} — pulando sem insistir.`);
        continue;
      }

      // 2. Aceita banner de cookies para permitir execução do fbevents.js
      await dismissCookieBanner(tab);
      await humanSleep(1500, 2500);

      // 3. Fecha popups de desconto/newsletter
      await dismissPopups(tab);

      // 4. Rolagem humana com pausas de leitura
      for (let s = 0; s < 4; s++) {
        const dy = Math.floor(280 + Math.random() * 320);
        await tab.evaluate((y) => window.scrollBy({ top: y, behavior: 'smooth' }), dy).catch(() => {});
        await humanSleep(2000, 3500);
      }

      // 5. Clique interno em link do mesmo domínio para disparar ViewContent
      const clickedInternal = await tab.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a[href]'));
        const curHost = location.hostname;
        const valid = links.find(a => {
          const h = a.href || '';
          return h.includes(curHost) && (h.includes('/health/') || h.includes('/recipes/') || h.includes('/products/') || h.includes('/collections/'));
        });
        if (valid) {
          valid.removeAttribute('target');
          const r = valid.getBoundingClientRect();
          if (r.width > 30 && r.height > 15 && r.y > 100 && r.y < window.innerHeight - 80) {
            valid.click();
            return true;
          }
        }
        return false;
      }).catch(() => false);

      if (clickedInternal) {
        onLog(`🔗 [Pixel Seed • ViewContent] Clicou em link interno do portal ${hostname}.`);
        await humanSleep(4000, 6000);
      }

      // 6. Lê telemetria final dos cookies
      const telem = await readPixelTelemetry(tab);
      if (telem.hasFbpCookie) {
        fbpFound = true;
        onLog(`✅ [Pixel Seed Sucesso] Cookie "_fbp" confirmado com sucesso em ${hostname}!`);
      } else {
        onLog(`ℹ️ [Pixel Seed] Visita concluída em ${hostname} (Pixel: ${telem.fbqPresent ? 'Ativo' : 'Passivo'}).`);
      }
    } catch (err) {
      onLog(`⚠️ [Pixel Seed • Aviso] Erro na navegação de ${url}: ${err.message}`);
    }
  }

  return {
    success: true,
    fbp_minted: fbpFound
  };
}

module.exports = {
  warmMetaPixelCookies,
  readPixelTelemetry,
  SEED_PUBLISHERS,
  SEED_SHOPIFY_DTC
};
