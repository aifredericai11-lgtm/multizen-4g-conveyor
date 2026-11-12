'use strict';

/**
 * Adaptador DOM leve (desacoplado de regras de nicho) com os utilitários de interação
 * consumidos pela esteira de aquecimento (`gmail_creator.js`, `runner.js`, `profile_reels_warmer.js`).
 */

const IncognitonService = require('./incogniton');

class AutomatorAdapter {
  constructor() {
    this.lastMouseX = 480;
    this.lastMouseY = 360;
    this.abortRequested = false;
  }

  async humanClickBox(page, box) {
    if (!page || !box || !box.width || !box.height || box.width <= 0 || box.height <= 0) {
      return false;
    }

    const ratio = () => 0.24 + ((Math.random() + Math.random()) / 2) * 0.52;
    const targetX = box.x + box.width * ratio();
    const targetY = box.y + box.height * ratio();

    const startX = Number.isFinite(this.lastMouseX) ? this.lastMouseX : 480;
    const startY = Number.isFinite(this.lastMouseY) ? this.lastMouseY : 360;
    const steps = 6 + Math.floor(Math.random() * 4);

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const ease = 1 - Math.pow(1 - t, 3);
      const x = startX + (targetX - startX) * ease;
      const y = startY + (targetY - startY) * ease;
      await page.mouse.move(x, y).catch(() => {});
      await new Promise(r => setTimeout(r, 8 + Math.floor(Math.random() * 12)));
    }

    await page.mouse.down().catch(() => {});
    await new Promise(r => setTimeout(r, 35 + Math.floor(Math.random() * 45)));
    await page.mouse.up().catch(() => {});

    this.lastMouseX = targetX;
    this.lastMouseY = targetY;
    return true;
  }

  async waitForFacebookDomHydrated(page, maxWaitMs = 28000) {
    const start = Date.now();
    let reloadedOnce = false;
    while (Date.now() - start < maxWaitMs) {
      const state = await page
        .evaluate(() => {
          if (String(location.href || '').startsWith('chrome-error://')) {
            return { ready: false, isErr: true };
          }
          const splash = document.getElementById('splash-screen');
          if (
            splash &&
            window.getComputedStyle(splash).display !== 'none' &&
            splash.getBoundingClientRect().width > 0
          ) {
            return { ready: false, isErr: false, onSplash: true };
          }
          const bodyText = document.body && document.body.innerText ? document.body.innerText.trim() : '';
          if (/ERR_EMPTY_RESPONSE|ERR_CONNECTION_CLOSED|ERR_PROXY|ERR_TIMED_OUT/i.test(bodyText)) {
            return { ready: false, isErr: true };
          }
          return { ready: bodyText.length > 55, isErr: false, onSplash: false };
        })
        .catch(() => ({ ready: false, isErr: false, onSplash: false }));

      if (state.ready) return true;
      const elapsed = Date.now() - start;
      if (!reloadedOnce && ((state.isErr && elapsed > 5000) || elapsed > 22000)) {
        reloadedOnce = true;
        try {
          IncognitonService.ensureAdbProxyTunnelAndWifiOff();
          IncognitonService.flushIdleUpstreamSockets(500);
        } catch (_) {}
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 35000 }).catch(() => {});
      }
      await new Promise(r => setTimeout(r, 1200));
    }
    return false;
  }

  async ensureActingAsPersonalProfile(page, onLog = console.log) {
    if (!page) return false;
    try {
      await this.waitForFacebookDomHydrated(page, 15000);
      return true;
    } catch (err) {
      onLog(`[AutomatorAdapter] Aviso em ensureActingAsPersonalProfile: ${err.message}`);
      return false;
    }
  }

  async ensure2faConfiguredInOpenProfile(profileId, accountWithSecrets, _onSaveSecrets, onLog = console.log) {
    const existingFbTotp = String((accountWithSecrets && accountWithSecrets.totp_secret) || '').replace(/\s+/g, '');
    if (existingFbTotp.length >= 16) {
      return { configured: true, totp_secret: existingFbTotp, newly_created: false };
    }
    onLog(`[AutomatorAdapter] 2FA pendente de configuração manual/externa para o perfil ${String(profileId || '').slice(0, 8)}.`);
    return { configured: false, newly_created: false };
  }

  async dismissWelcomePageModalAndCancelCover(page) {
    if (!page) return false;
    return page
      .evaluate(() => {
        const closeBtns = Array.from(document.querySelectorAll('[aria-label="Close"], [aria-label="Fechar"]'));
        if (closeBtns.length > 0) {
          closeBtns[0].click();
          return true;
        }
        return false;
      })
      .catch(() => false);
  }

  async openReelCreatorHumanly(page, _targetName = '', onLog = console.log) {
    if (!page) return false;
    const clicked = await page
      .evaluate(() => {
        const candidates = Array.from(document.querySelectorAll('[role="button"], a, span'));
        const btn = candidates.find(el => /^(reel|criar reel|create reel)$/i.test((el.innerText || '').trim()));
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      })
      .catch(() => false);
    if (!clicked) {
      onLog('[AutomatorAdapter] Botão Reel não localizado diretamente no feed; navegando para /reels/create/.');
      await page.goto('https://www.facebook.com/reels/create/', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    }
    return true;
  }

  async typeCleanReelCaptionInComposer(page, captionText) {
    if (!page || !captionText) return false;
    const box = await page.$('[role="textbox"][contenteditable="true"]').catch(() => null);
    if (!box) return false;
    await box.click().catch(() => {});
    await page.keyboard.type(String(captionText), { delay: 35 }).catch(() => {});
    return true;
  }

  async clickNextButton(page) {
    if (!page) return false;
    return page
      .evaluate(() => {
        const btns = Array.from(document.querySelectorAll('[role="button"]'));
        const next = btns.find(el => /^(next|avan[cç]ar|seguinte)$/i.test((el.innerText || '').trim()));
        if (next) {
          next.click();
          return true;
        }
        return false;
      })
      .catch(() => false);
  }

  async enableReelSchedulingInComposer() {
    return false;
  }

  async clickPublishButton(page) {
    if (!page) return false;
    return page
      .evaluate(() => {
        const btns = Array.from(document.querySelectorAll('[role="button"]'));
        const pub = btns.find(el => /^(publish|publicar|share|compartilhar)$/i.test((el.innerText || '').trim()));
        if (pub) {
          pub.click();
          return true;
        }
        return false;
      })
      .catch(() => false);
  }

  async waitForPublishConfirmation(page, _onLog = console.log) {
    if (!page) return false;
    await new Promise(r => setTimeout(r, 8000));
    return true;
  }

  async humanSleep(minMs = 800, maxMs = 1800) {
    const ms = minMs + Math.floor(Math.random() * Math.max(1, maxMs - minMs));
    await new Promise(r => setTimeout(r, ms));
  }

  generateNewEnglishWellnessPageName(seedLabel = 'Daily', existingNames = []) {
    const taken = new Set((existingNames || []).map(s => String(s || '').toLowerCase()));
    const firsts = ['Clara', 'Nora', 'Evelyn', 'Grace', 'Martha', 'Helen', 'Ruth', 'Diane', 'judith', 'Brenda', 'lois', 'Marilyn'];
    const suffixes = ['Daily Kitchen', 'Healthy Table', 'Natural Habits', 'Simple Recipes', 'Morning Routine', 'Home Remedies', 'Pure Vitality', 'Healthy Corner'];
    for (let i = 0; i < 80; i++) {
      const f = firsts[(i + Date.now()) % firsts.length];
      const s = suffixes[(i * 3 + Date.now()) % suffixes.length];
      const candidate = `${f.charAt(0).toUpperCase() + f.slice(1)} ${s}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return `Wellness Kitchen ${Date.now().toString().slice(-4)}`;
  }

  ensureWarmupPageRegistered(pageName, profileId, accountLabel = '') {
    const db = require('./db');
    const existing = (db.getPages() || []).find(
      p => String(p.name || '').toLowerCase() === String(pageName || '').toLowerCase() &&
           String(p.profile_browser_ID || '').toLowerCase() === String(profileId || '').toLowerCase()
    );
    if (existing) return { dbPage: existing, dmLink: '' };
    const dbPage = db.addPage({
      name: pageName,
      profile_browser_ID: profileId,
      profile_name: accountLabel,
      language: 'en-US',
      dm_link: '',
      notebook_warmup_only: true,
      age_restriction_target: '24+',
      country_restriction_mode: 'HIDE_25_LOW_CPM',
      page_created_cooling_until: 0,
      created_at: new Date().toISOString()
    });
    return { dbPage, dmLink: '' };
  }

  async tryCreateNewPagesUntilLimitInOpenProfile(profileId, accountLabel = '', options = {}, onLog = console.log) {
    const db = require('./db');
    const settings = db.getSettings() || {};
    const maxPagesCap = Number(settings.max_pages_per_profile_willas || 10);
    const existing = (db.getPages() || []).filter(
      p => String(p.profile_browser_ID || '').toLowerCase() === String(profileId || '').toLowerCase()
    );
    if (existing.length >= maxPagesCap) {
      onLog(`[AutomatorAdapter] Teto de ${maxPagesCap} paginas ja atingido em "${accountLabel}".`);
      return { created_count: 0, created_pages: [], limit_hit: true };
    }
    onLog(`[AutomatorAdapter] Modo standalone: use createNewFacebookPageInPlace ou integre com o servidor local para criar ate ${maxPagesCap} paginas (~5m ficha + 2m pausa offline mesmo-IP).`);
    return { created_count: 0, created_pages: [], limit_hit: false };
  }
}

module.exports = new AutomatorAdapter();
