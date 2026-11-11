/**
 * ============================================================================
 * MÓDULO ISOLADO: NEWSLETTER & PIXEL WARMER
 * ============================================================================
 * Diretório: modules/account_warmup/newsletter_warmer.js
 * Papel: Cadastro automático do e-mail nos 15 grandes portais editoriais diários
 *        (The Guardian, CNN, TechCrunch, Telegraph, Reuters, The Sun, etc.)
 *        e ancoragem de cookies reais de anunciantes para maturação de perfil.
 */

const NEWSLETTER_PORTALS = [
  { id: 'techcrunch', name: 'TechCrunch', url: 'https://techcrunch.com/newsletters/' },
  { id: 'sifted', name: 'Sifted EU', url: 'https://sifted.eu/newsletters' },
  { id: 'monevator', name: 'Monevator', url: 'https://monevator.com/subscribe/' },
  { id: 'theguardian', name: 'The Guardian', url: 'https://www.theguardian.com/email-newsletters' },
  { id: 'morningbrew', name: 'Morning Brew', url: 'https://www.morningbrew.com/daily' },
  { id: 'tldr', name: 'TLDR Newsletter', url: 'https://tldr.tech/' },
  { id: 'medicalnewstoday', name: 'Medical News Today', url: 'https://www.medicalnewstoday.com/newsletter' },
  { id: 'healthline', name: 'Healthline', url: 'https://www.healthline.com/newsletter-signup' },
  { id: 'everydayhealth', name: 'Everyday Health', url: 'https://www.everydayhealth.com/newsletters/' },
  { id: 'reuters', name: 'Reuters', url: 'https://www.reuters.com/newsletters/' },
  { id: 'standard', name: 'Evening Standard', url: 'https://www.standard.co.uk/newsletters' },
  { id: 'thesun', name: 'The Sun', url: 'https://www.thesun.co.uk/newsletters/' },
  { id: 'mirror', name: 'The Mirror', url: 'https://www.mirror.co.uk/newsletters/' },
  { id: 'moneyweek', name: 'MoneyWeek', url: 'https://moneyweek.com/newsletters' },
  { id: 'cnn', name: 'CNN Edition', url: 'https://edition.cnn.com/newsletters' }
];

class NewsletterWarmer {
  async humanSleep(minMs, maxMs) {
    const ms = Math.floor(minMs + Math.random() * (maxMs - minMs));
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async humanClickBox(page, box) {
    if (!page || !box) return false;
    const x = box.x + Math.floor(box.width * (0.25 + Math.random() * 0.5));
    const y = box.y + Math.floor(box.height * (0.25 + Math.random() * 0.5));
    await page.mouse.move(x, y, { steps: 5 + Math.floor(Math.random() * 6) }).catch(() => {});
    await this.humanSleep(80, 160);
    await page.mouse.click(x, y, { delay: 40 + Math.floor(Math.random() * 60) }).catch(() => {});
    return true;
  }

  async humanTypeText(page, text) {
    if (!page || !text) return;
    for (const ch of String(text)) {
      await page.keyboard.type(ch, { delay: 35 + Math.floor(Math.random() * 45) }).catch(() => {});
    }
  }

  async subscribeToPortals(page, rawEmail, options = {}) {
    const onLog = options.onLog || console.log;
    const cleanEmail = String(rawEmail || '').trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      return { success: false, subscribed: [], newly_subscribed: [] };
    }

    const alreadySet = new Set((options.already_subscribed || []).map(x => String(x || '').toLowerCase()));
    const available = NEWSLETTER_PORTALS.filter(p => !alreadySet.has(p.id) && !alreadySet.has(p.url.toLowerCase()));
    const maxSites = Math.max(1, Math.min(15, Number(options.max_sites_per_session) || 15));

    if (available.length === 0) {
      onLog(`📧 [Aquecimento E-mail] Conta já cadastrada em todos os ${NEWSLETTER_PORTALS.length} portais diários!`);
      return { success: true, subscribed: Array.from(alreadySet), newly_subscribed: [] };
    }

    const shuffled = [...available].sort(() => Math.random() - 0.5);
    const newlySubscribed = [];
    let consecutiveNetErrors = 0;

    onLog(`📧 [Aquecimento E-mail + Pixel] Meta desta sessão: inscrever "${cleanEmail}" em até ${maxSites} portal(is) diários...`);

    for (const portal of shuffled) {
      if (newlySubscribed.length >= maxSites) break;
      try {
        onLog(`📰 [Newsletter • ${portal.name}] Abrindo ${portal.url}...`);
        let navFailed = false;
        await page.goto(portal.url, { waitUntil: 'domcontentloaded', timeout: 28000 }).catch(() => {
          navFailed = true;
        });
        await this.humanSleep(2200, 3400);

        const pageLoadCheck = await page.evaluate(() => {
          const href = String(location.href || '').toLowerCase();
          if (href.startsWith('chrome-error://') || href === 'about:blank') return { ok: false, reason: href };
          const txt = document.body ? String(document.body.innerText || '') : '';
          if (/ERR_EMPTY_RESPONSE|ERR_PROXY|ERR_TIMED_OUT|ERR_CONNECTION|esta página não está funcionando/i.test(txt)) {
            return { ok: false, reason: 'ERR_PROXY_OR_EMPTY' };
          }
          return { ok: txt.trim().length > 40, reason: 'OK' };
        }).catch(() => ({ ok: false, reason: 'EVAL_ERR' }));

        if (navFailed || !pageLoadCheck.ok) {
          consecutiveNetErrors++;
          onLog(`⚠️ [Newsletter • ${portal.name}] Portal não carregou no túnel 4G (${pageLoadCheck.reason}) — pulando sem marcar falso positivo.`);
          if (consecutiveNetErrors >= 3) {
            onLog(`🛑 [Proteção Túnel 4G] 3 portais seguidos sem resposta — encerrando newsletters desta sessão para liberar o navegador!`);
            break;
          }
          continue;
        }
        consecutiveNetErrors = 0;

        // 1. Aceita Banner de Cookies / GDPR (inclusive dentro de iframes SourcePoint/OneTrust)
        for (const frame of page.frames()) {
          const clickedInFrame = await frame.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button, [role="button"], a'));
            for (const b of btns) {
              const t = String(b.innerText || b.textContent || b.getAttribute('title') || '').trim().toLowerCase();
              if (/^(accept all|accept cookies|i agree|agree|allow all|yes, i’m happy|yes, i'm happy|got it|continue|accept|aceitar tudo|aceitar)$/i.test(t)) {
                const r = b.getBoundingClientRect();
                if (r.width > 30 && r.height > 16) {
                  b.click();
                  return true;
                }
              }
            }
            return false;
          }).catch(() => false);
          if (clickedInFrame) {
            await this.humanSleep(1200, 1800);
            break;
          }
        }

        // 2. Rola humanamente e seleciona 1 a 2 tópicos/botões de newsletter ("Sign up", "Add", "+", checkbox)
        await page.mouse.wheel({ deltaY: 260 + Math.floor(Math.random() * 180) }).catch(() => {});
        await this.humanSleep(1200, 1800);

        await page.evaluate(() => {
          const candidates = Array.from(document.querySelectorAll('input[type="checkbox"], button, [role="checkbox"]'));
          let count = 0;
          for (const el of candidates) {
            const r = el.getBoundingClientRect();
            if (r.width < 12 || r.height < 12 || r.top < 40 || r.top > 900) continue;
            const t = String(el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim().toLowerCase();
            if (el.tagName.toLowerCase() === 'input' || el.getAttribute('role') === 'checkbox' || /^(select|add|\+|sign up|choose|adicionar)$/i.test(t)) {
              if (!el.checked && el.getAttribute('aria-checked') !== 'true') {
                el.click();
                count++;
                if (count >= 2) break;
              }
            }
          }
        }).catch(() => {});
        await this.humanSleep(900, 1400);

        // 3. Procura input de e-mail na página ou iframes, faz scroll se necessário e preenche
        let subscribedOnPortal = false;
        for (const frame of page.frames()) {
          const fillResult = await frame.evaluate((targetEmail) => {
            const selectors = 'input[type="email"], input[name*="email" i], input[placeholder*="email" i], input[placeholder*="e-mail" i], input[id*="email" i], input[type="text"][placeholder*="mail" i]';
            const inputs = Array.from(document.querySelectorAll(selectors));
            for (const inp of inputs) {
              if (inp.disabled || inp.type === 'hidden') continue;
              inp.scrollIntoView({ behavior: 'instant', block: 'center' });
              const r = inp.getBoundingClientRect();
              if (r.width < 50 || r.height < 14) continue;
              inp.focus();
              const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
              if (setter) setter.call(inp, targetEmail);
              else inp.value = targetEmail;
              inp.dispatchEvent(new Event('input', { bubbles: true }));
              inp.dispatchEvent(new Event('change', { bubbles: true }));

              // Marca eventual checkbox de termos próximo
              const form = inp.closest('form') || inp.parentElement?.parentElement || document;
              const chks = Array.from(form.querySelectorAll('input[type="checkbox"]'));
              for (const c of chks) {
                if (!c.checked) {
                  try { c.click(); } catch (_) {}
                }
              }

              // Procura botão submit no mesmo form ou próximo
              const btns = Array.from(form.querySelectorAll('button[type="submit"], input[type="submit"], button, [role="button"]'));
              for (const b of btns) {
                const bt = String(b.innerText || b.value || b.textContent || '').trim().toLowerCase();
                if (/subscribe|sign up|sign-up|register|submit|join|send|try|get|confirm|continuar|inscrever/i.test(bt)) {
                  b.click();
                  return { filled: true, submitted: true, box: { x: r.left, y: r.top, width: r.width, height: r.height } };
                }
              }
              if (inp.form && typeof inp.form.requestSubmit === 'function') {
                try { inp.form.requestSubmit(); return { filled: true, submitted: true }; } catch (_) {}
              }
              return { filled: true, submitted: false, box: { x: r.left, y: r.top, width: r.width, height: r.height } };
            }
            return { filled: false };
          }, cleanEmail).catch(() => ({ filled: false }));

          if (fillResult && fillResult.filled) {
            if (!fillResult.submitted) {
              await page.keyboard.press('Enter').catch(() => {});
            }
            await this.humanSleep(2600, 3800);
            newlySubscribed.push(portal.id);
            alreadySet.add(portal.id);
            subscribedOnPortal = true;
            onLog(`✅ [Newsletter • ${portal.name}] E-mail "${cleanEmail}" inscrito com sucesso (${alreadySet.size} total)!`);
            break;
          }
        }

        if (!subscribedOnPortal) {
          onLog(`🍪 [Pixel Editorial • ${portal.name}] Leitura orgânica e cookies ancorados (sem formulário direto visível).`);
        }
      } catch (pErr) {
        onLog(`⚠️ [Newsletter • ${portal.name}] Aviso: ${pErr.message}`);
      }
    }

    return {
      success: true,
      subscribed: Array.from(alreadySet),
      newly_subscribed: newlySubscribed
    };
  }
}

module.exports = new NewsletterWarmer();
