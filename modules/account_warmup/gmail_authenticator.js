/**
 * ============================================================================
 * MÓDULO ISOLADO: GMAIL AUTHENTICATOR & INBOX WARMUP
 * ============================================================================
 * Diretório: modules/account_warmup/gmail_authenticator.js
 * Papel: Login automático blindado no Gmail/Google Workspace, resolução de
 *        telas pós-login (speedbump, passkey, recoveryoptions, uplevelingstep)
 *        e leitura orgânica de e-mails na Caixa de Entrada (#inbox).
 * Zero dependência de código do Facebook ou do Scheduler.
 */

const vault = require('../common/vault');

class GmailAuthenticator {
  constructor(options = {}) {
    this.options = options;
  }

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

  async hasGoogleAuthCookies(page) {
    if (!page) return false;
    try {
      const cList = await page.cookies('https://mail.google.com', 'https://accounts.google.com', 'https://www.google.com');
      return cList.some(c => (c.name === 'SID' || c.name === 'SAPISID' || c.name === '__Secure-1PSID' || c.name === 'OSID') && c.value);
    } catch (_) {
      return false;
    }
  }

  async checkIsInsideGmail(page) {
    if (!page) return false;
    const u = String(page.url() || '');
    if (!(/^https:\/\/mail\.google\.com\/mail/i.test(u) && !u.includes('accounts.google.com'))) {
      return false;
    }
    return await this.hasGoogleAuthCookies(page);
  }

  async isAlreadyOnPostLoginScreen(page) {
    if (!page) return false;
    const u = String(page.url() || '').toLowerCase();
    if (
      u.includes('/speedbump/') ||
      u.includes('/uplevelingstep/') ||
      u.includes('/interstitials/') ||
      u.includes('gds.google.com') ||
      u.includes('consent.google.com') ||
      u.includes('myaccount.google.com')
    ) {
      return true;
    }
    return await page.evaluate(() => {
      const uNow = String(location.href || '').toLowerCase();
      const txt = String(document.body ? document.body.innerText : '').toLowerCase();
      const hasIdentifier = Boolean(document.querySelector('input#identifierId, input[name="identifier"]'));
      if (hasIdentifier) return false;
      if (
        uNow.includes('/challenge/') ||
        txt.includes('chave de acesso') ||
        txt.includes('passkey') ||
        txt.includes('adicione um endereço de e-mail de recuperação') ||
        txt.includes('add a recovery email') ||
        txt.includes('adicionar e-mail de recuperação') ||
        txt.includes('adicione um número de telefone') ||
        txt.includes('add a phone number') ||
        txt.includes('proteção reforçada') ||
        txt.includes('navegação segura')
      ) {
        return true;
      }
      return false;
    }).catch(() => false);
  }

  /**
   * Executa o login 100% automático e blindado no Gmail
   */
  async login(gmailTab, rawEmail, rawPassword, options = {}) {
    const onLog = options.onLog || console.log;
    const recoveryEmail = String(options.recoveryEmail || '').trim();
    const totpSecret = String(options.totpSecret || '').trim();
    const phoneNumber = String(options.phoneNumber || options.phone || '').trim();
    const smsCode = String(options.smsCode || options.sms || '').trim();

    if (!gmailTab) return { loggedIn: false };
    let cleanEmail = String(rawEmail || '').trim();
    let cleanPass = String(rawPassword || '').trim();
    if (cleanEmail.includes(';')) {
      const parts = cleanEmail.split(';').map(s => s.trim());
      cleanEmail = parts[0] || cleanEmail;
      if (!cleanPass && parts[1]) cleanPass = parts[1];
    }
    if (!cleanEmail) return { loggedIn: false };

    await gmailTab.bringToFront().catch(() => {});

    if (await this.checkIsInsideGmail(gmailTab)) {
      onLog(`✅ [Gmail Forte] "${cleanEmail}" já está autenticado na Caixa de Entrada (#inbox)!`);
      return { loggedIn: true };
    }

    const curU0 = String(gmailTab.url() || '').toLowerCase();
    if (curU0.includes('myaccount.google.com') && (await this.hasGoogleAuthCookies(gmailTab))) {
      await gmailTab.goto('https://mail.google.com/mail/u/0/#inbox', { waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => {});
      if (await this.checkIsInsideGmail(gmailTab)) {
        onLog(`✅ [Gmail Forte] "${cleanEmail}" redirecionado de MyAccount para a Caixa de Entrada (#inbox)!`);
        return { loggedIn: true };
      }
    }

    const curU = String(gmailTab.url() || '').toLowerCase();
    if (!curU.includes('accounts.google.com') && !curU.includes('mail.google.com') && !curU.includes('gds.google.com') && !curU.includes('consent.google.com')) {
      await gmailTab.goto('https://accounts.google.com/ServiceLogin?service=mail&continue=https://mail.google.com/mail/', {
        waitUntil: 'domcontentloaded',
        timeout: 45000
      }).catch(() => {});
    }

    let skipToStep3PostLogin = await this.isAlreadyOnPostLoginScreen(gmailTab);

    // ETAPA 1: Preencher E-mail (#identifierId)
    let emailSubmitted = skipToStep3PostLogin;
    if (!skipToStep3PostLogin) {
      onLog(`📧 [Sentinela Login Gmail] Digitando e-mail "${cleanEmail}" automaticamente na tela do Google...`);
      for (let step1 = 0; step1 < 38; step1++) {
        await gmailTab.bringToFront().catch(() => {});
        if (await this.checkIsInsideGmail(gmailTab)) return { loggedIn: true };
        if (await this.isAlreadyOnPostLoginScreen(gmailTab)) {
          skipToStep3PostLogin = true;
          emailSubmitted = true;
          break;
        }

        const state1 = await gmailTab.evaluate((targetMail) => {
          const normMail = String(targetMail || '').toLowerCase();
          const passInputs = Array.from(document.querySelectorAll('input[name="Passwd"], input[type="password"]'));
          for (const p of passInputs) {
            if (p.disabled || p.getAttribute('aria-hidden') === 'true' || p.name === 'hiddenPassword') continue;
            const r = p.getBoundingClientRect();
            const st = window.getComputedStyle(p);
            if (r.width > 40 && r.height > 15 && st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity || 1) > 0.1) {
              return { mode: 'ALREADY_ON_PASSWORD' };
            }
          }

          const uNow = String(location.href || '').toLowerCase();
          const emailSelector = (uNow.includes('identifier') || uNow.includes('servicelogin') || uNow.includes('signin'))
            ? 'input#identifierId, input[name="identifier"], input[type="email"]:not([name*="recovery" i]):not([id*="recovery" i]):not([id*="preregistered" i])'
            : 'input#identifierId, input[name="identifier"]';
          const emailInputs = Array.from(document.querySelectorAll(emailSelector));
          for (const el of emailInputs) {
            if (el.disabled || el.getAttribute('aria-hidden') === 'true') continue;
            const r = el.getBoundingClientRect();
            const st = window.getComputedStyle(el);
            if (r.width > 40 && r.height > 15 && st.visibility !== 'hidden' && st.display !== 'none') {
              const nextBtn = document.querySelector('#identifierNext button, #identifierNext');
              const nr = nextBtn ? nextBtn.getBoundingClientRect() : null;
              return {
                mode: 'EMAIL_INPUT',
                box: { x: r.left, y: r.top, width: Math.min(r.width * 0.7, 220), height: r.height },
                nextBox: nr && nr.width > 30 ? { x: nr.left, y: nr.top, width: nr.width, height: nr.height } : null
              };
            }
          }

          const chooserItems = Array.from(document.querySelectorAll('[data-identifier], [data-email], li, div[role="link"]'));
          for (const item of chooserItems) {
            const idTxt = String(item.getAttribute('data-identifier') || item.getAttribute('data-email') || item.innerText || '').toLowerCase();
            if (normMail && idTxt.includes(normMail)) {
              const r = item.getBoundingClientRect();
              if (r.width > 40 && r.height > 20) {
                return { mode: 'CLICK_EXISTING_ACCOUNT', box: { x: r.left, y: r.top, width: r.width, height: r.height } };
              }
            }
          }
          for (const item of chooserItems) {
            const txt = String(item.innerText || item.textContent || '').trim().toLowerCase();
            if (txt.includes('usar outra conta') || txt.includes('use another account') || txt.includes('adicionar outra conta')) {
              const r = item.getBoundingClientRect();
              if (r.width > 40 && r.height > 20) {
                return { mode: 'USE_ANOTHER_ACCOUNT', box: { x: r.left, y: r.top, width: r.width, height: r.height } };
              }
            }
          }

          return { mode: 'WAITING' };
        }, cleanEmail).catch(() => ({ mode: 'WAITING' }));

        if (state1.mode === 'ALREADY_ON_PASSWORD') {
          emailSubmitted = true;
          break;
        }
        if (state1.mode === 'USE_ANOTHER_ACCOUNT') {
          await this.humanClickBox(gmailTab, state1.box).catch(() => {});
          await this.humanSleep(1500, 2200);
          continue;
        }
        if (state1.mode === 'CLICK_EXISTING_ACCOUNT') {
          await this.humanClickBox(gmailTab, state1.box).catch(() => {});
          await this.humanSleep(2200, 3200);
          emailSubmitted = true;
          break;
        }
        if (state1.mode === 'EMAIL_INPUT' && state1.box) {
          await this.humanClickBox(gmailTab, state1.box).catch(() => {});
          await this.humanSleep(220, 380);
          await gmailTab.evaluate(() => {
            const el = document.querySelector('input#identifierId, input[name="identifier"], input[type="email"]');
            if (el) el.focus();
          }).catch(() => {});
          await gmailTab.keyboard.down('Control').catch(() => {});
          await gmailTab.keyboard.press('KeyA').catch(() => {});
          await gmailTab.keyboard.up('Control').catch(() => {});
          await gmailTab.keyboard.press('Backspace').catch(() => {});
          await this.humanSleep(120, 220);
          await this.humanTypeText(gmailTab, cleanEmail);
          await gmailTab.evaluate((val) => {
            const el = document.querySelector('input#identifierId, input[name="identifier"], input[type="email"]');
            if (el) {
              el.focus();
              if (String(el.value || '').trim().toLowerCase() !== String(val).trim().toLowerCase()) {
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                if (setter) setter.call(el, val);
                else el.value = val;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }
          }, cleanEmail).catch(() => {});
          await this.humanSleep(350, 600);
          if (state1.nextBox) {
            await this.humanClickBox(gmailTab, state1.nextBox).catch(() => {});
          } else {
            await gmailTab.keyboard.press('Enter').catch(() => {});
          }
          await this.humanSleep(2200, 2800);
          emailSubmitted = true;
          break;
        }
        await new Promise(r => setTimeout(r, 450));
      }
    }

    if (!emailSubmitted || (!cleanPass && !skipToStep3PostLogin)) {
      return { loggedIn: await this.checkIsInsideGmail(gmailTab) };
    }

    // ETAPA 2: Aguardar Senha Visível
    let passSubmitted = skipToStep3PostLogin;
    if (!skipToStep3PostLogin) {
      onLog(`🔑 [Sentinela Login Gmail] Aguardando campo de senha visível para "${cleanEmail}"...`);
      for (let step2 = 0; step2 < 48; step2++) {
        await gmailTab.bringToFront().catch(() => {});
        if (await this.checkIsInsideGmail(gmailTab)) return { loggedIn: true };
        if (await this.isAlreadyOnPostLoginScreen(gmailTab)) {
          passSubmitted = true;
          break;
        }

        const passState = await gmailTab.evaluate(() => {
          const inputs = Array.from(document.querySelectorAll('input[name="Passwd"], input[type="password"]'));
          for (const el of inputs) {
            if (el.disabled || el.getAttribute('aria-hidden') === 'true' || el.name === 'hiddenPassword') continue;
            const r = el.getBoundingClientRect();
            const st = window.getComputedStyle(el);
            if (r.width > 40 && r.height > 15 && st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity || 1) > 0.15) {
              const nextBtn = document.querySelector('#passwordNext button, #passwordNext');
              const nr = nextBtn ? nextBtn.getBoundingClientRect() : null;
              return {
                found: true,
                box: { x: r.left, y: r.top, width: Math.min(r.width * 0.65, 190), height: r.height },
                nextBox: nr && nr.width > 30 ? { x: nr.left, y: nr.top, width: nr.width, height: nr.height } : null
              };
            }
          }
          return { found: false };
        }).catch(() => ({ found: false }));

        if (passState.found && passState.box) {
          await this.humanSleep(550, 800);
          await this.humanClickBox(gmailTab, passState.box).catch(() => {});
          await this.humanSleep(200, 350);
          await gmailTab.keyboard.down('Control').catch(() => {});
          await gmailTab.keyboard.press('KeyA').catch(() => {});
          await gmailTab.keyboard.up('Control').catch(() => {});
          await gmailTab.keyboard.press('Backspace').catch(() => {});
          await this.humanSleep(120, 220);
          await this.humanTypeText(gmailTab, cleanPass);
          await gmailTab.evaluate((val) => {
            const inputs = Array.from(document.querySelectorAll('input[name="Passwd"], input[type="password"]'));
            for (const el of inputs) {
              if (!el.disabled && el.getAttribute('aria-hidden') !== 'true' && el.name !== 'hiddenPassword') {
                el.focus();
                if (!el.value || el.value !== val) {
                  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                  if (setter) setter.call(el, val);
                  else el.value = val;
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                }
                break;
              }
            }
          }, cleanPass).catch(() => {});
          await this.humanSleep(350, 600);
          if (passState.nextBox) {
            await this.humanClickBox(gmailTab, passState.nextBox).catch(() => {});
          } else {
            await gmailTab.keyboard.press('Enter').catch(() => {});
          }
          await this.humanSleep(2200, 2900);
          passSubmitted = true;
          onLog(`🚀 [Sentinela Login Gmail] Senha enviada para "${cleanEmail}" — resolvendo telas pós-login...`);
          break;
        }
        await new Promise(r => setTimeout(r, 400));
      }
    }

    if (!passSubmitted) {
      return { loggedIn: await this.checkIsInsideGmail(gmailTab) };
    }

    // ETAPA 3: Pós-Login Completo & Desbloqueio de Telas Intermediárias
    let spinnerTicks = 0;
    for (let step3 = 0; step3 < 65; step3++) {
      await gmailTab.bringToFront().catch(() => {});
      await new Promise(r => setTimeout(r, 650));

      if (await this.checkIsInsideGmail(gmailTab)) {
        onLog(`✅ [Gmail Forte Autenticado] "${cleanEmail}" logado com sucesso na Caixa de Entrada (#inbox)!`);
        await this.humanSleep(1500, 2200);
        return { loggedIn: true };
      }

      const curStep3Url = String(gmailTab.url() || '').toLowerCase();
      if (curStep3Url.includes('/uplevelingstep/spinner') || curStep3Url.includes('/checkcookie') || curStep3Url.includes('myaccount.google.com')) {
        spinnerTicks++;
        if (spinnerTicks >= 6 && (await this.hasGoogleAuthCookies(gmailTab))) {
          onLog(`⚡ [Destrava Pós-Login] Redirecionamento intermediário já autenticado — abrindo #inbox diretamente...`);
          await gmailTab.goto('https://mail.google.com/mail/u/0/#inbox', { waitUntil: 'domcontentloaded', timeout: 35000 }).catch(() => {});
          spinnerTicks = 0;
          await this.humanSleep(1800, 2500);
          if (await this.checkIsInsideGmail(gmailTab)) return { loggedIn: true };
          continue;
        }
      } else {
        spinnerTicks = 0;
      }

      // E-mail de Recuperação
      if (recoveryEmail && recoveryEmail.includes('@')) {
        const recChallenge = await gmailTab.evaluate(() => {
          const txt = String(document.body ? document.body.innerText : '').toLowerCase();
          const items = Array.from(document.querySelectorAll('li, div[role="link"], div[data-challengetype]'));
          for (const it of items) {
            const t = String(it.innerText || it.textContent || '').trim().toLowerCase();
            if ((t.includes('confirmar') && t.includes('recuperação')) || (t.includes('confirm') && t.includes('recovery email'))) {
              const r = it.getBoundingClientRect();
              if (r.width > 40 && r.height > 18) {
                return { step: 'SELECT_RECOVERY_OPTION', box: { x: r.left, y: r.top, width: r.width, height: r.height } };
              }
            }
          }
          const recInp = document.querySelector('input#knowledge-preregistered-email-response, input[name="knowledgePreregisteredEmailResponse"]');
          if (recInp && (txt.includes('recuperação') || txt.includes('recovery'))) {
            const r = recInp.getBoundingClientRect();
            if (r.width > 40 && r.height > 15) {
              return { step: 'TYPE_RECOVERY_EMAIL', box: { x: r.left, y: r.top, width: Math.min(r.width * 0.7, 220), height: r.height } };
            }
          }
          return null;
        }).catch(() => null);

        if (recChallenge) {
          if (recChallenge.step === 'SELECT_RECOVERY_OPTION') {
            await this.humanClickBox(gmailTab, recChallenge.box).catch(() => {});
            await this.humanSleep(2200, 3000);
            continue;
          }
          if (recChallenge.step === 'TYPE_RECOVERY_EMAIL') {
            await this.humanClickBox(gmailTab, recChallenge.box).catch(() => {});
            await this.humanSleep(200, 350);
            await this.humanTypeText(gmailTab, recoveryEmail);
            await this.humanSleep(300, 500);
            await gmailTab.keyboard.press('Enter').catch(() => {});
            await this.humanSleep(3000, 4200);
            continue;
          }
        }
      }

      // 2A. Desafio 2FA TOTP (Google Authenticator)
      const totpChallenge = await gmailTab.evaluate(() => {
        const inp = document.querySelector('input#totpPin, input[name="totpPin"], input[type="tel"][id*="totp"]');
        if (inp) {
          const r = inp.getBoundingClientRect();
          if (r.width > 30 && r.height > 15) {
            return { found: true, box: { x: r.left, y: r.top, width: r.width, height: r.height } };
          }
        }
        return { found: false };
      }).catch(() => ({ found: false }));

      if (totpChallenge.found && totpChallenge.box) {
        if (totpSecret) {
          const codeObj = vault.generateTotpCode(totpSecret);
          if (codeObj && codeObj.code) {
            onLog(`🔐 [Google 2FA TOTP] Inserindo código 6 dígitos gerado (${codeObj.code}) para "${cleanEmail}"...`);
            await this.humanClickBox(gmailTab, totpChallenge.box).catch(() => {});
            await this.humanSleep(150, 300);
            await this.humanTypeText(gmailTab, codeObj.code);
            await this.humanSleep(250, 450);
            await gmailTab.keyboard.press('Enter').catch(() => {});
            await this.humanSleep(3000, 4200);
            continue;
          }
        } else {
          onLog(`⚠️ [Google 2FA TOTP] Tela exige código do Authenticator para "${cleanEmail}", mas chave TOTP não está cadastrada no cofre.`);
          return { loggedIn: false, challenge_type: 'TOTP_SECRET_MISSING' };
        }
      }

      // 2B. Desafio de Notificação no Celular (Google Tap / Confirme o Número)
      const phonePromptChallenge = await gmailTab.evaluate(() => {
        const txt = String(document.body ? document.body.innerText : '').toLowerCase();
        const isTap = txt.includes('toque em sim') || txt.includes('check your phone') || txt.includes('tap yes') || txt.includes('verifique seu smartphone') || txt.includes('confirme o número');
        if (isTap) {
          const numberEl = document.querySelector('div[data-number], .nYk40, span.b31N1d, div.b31N1d');
          const number = numberEl ? String(numberEl.innerText || '').trim() : '';
          return { found: true, number };
        }
        return { found: false };
      }).catch(() => ({ found: false }));

      if (phonePromptChallenge.found) {
        const numStr = phonePromptChallenge.number ? ` [Toque no número: ${phonePromptChallenge.number}]` : '';
        onLog(`📱 [Google Prompt Celular] O Google enviou notificação para o smartphone de "${cleanEmail}"!${numStr}`);
        onLog(`⏳ [Aguardando Celular] Aguardando até 20s para confirmação no aparelho...`);
        for (let waitTap = 0; waitTap < 10; waitTap++) {
          await this.humanSleep(2000, 2200);
          if (await this.checkIsInsideGmail(gmailTab)) {
            onLog(`✅ [Google Prompt Aprovado] Toque no celular confirmado com sucesso!`);
            return { loggedIn: true };
          }
        }
        return { loggedIn: false, challenge_type: 'PHONE_PROMPT_TIMEOUT', prompt_number: phonePromptChallenge.number };
      }

      // 2C. Desafio de Inserir Novo Número de Telefone (Phone Number Checkpoint)
      const phoneInputChallenge = await gmailTab.evaluate(() => {
        const txt = String(document.body ? document.body.innerText : '').toLowerCase();
        const isPhoneCheck = txt.includes('número de telefone') || txt.includes('phone number') || txt.includes('verificar sua conta') || txt.includes('verify your account') || txt.includes('confirm it\'s you');
        const phoneInp = document.querySelector('input#phoneNumberId, input[name="phoneNumber"], input[type="tel"]:not(#idvPin):not(#totpPin)');
        if (phoneInp && isPhoneCheck) {
          const r = phoneInp.getBoundingClientRect();
          if (r.width > 40 && r.height > 15) {
            return { found: true, box: { x: r.left, y: r.top, width: Math.min(r.width * 0.7, 220), height: r.height } };
          }
        }
        return { found: false };
      }).catch(() => ({ found: false }));

      if (phoneInputChallenge.found && phoneInputChallenge.box) {
        if (phoneNumber) {
          onLog(`📱 [Google Phone Checkpoint] Preenchendo número de telefone "${phoneNumber}" para "${cleanEmail}"...`);
          await this.humanClickBox(gmailTab, phoneInputChallenge.box).catch(() => {});
          await this.humanSleep(150, 300);
          await this.humanTypeText(gmailTab, phoneNumber);
          await this.humanSleep(350, 600);
          await gmailTab.keyboard.press('Enter').catch(() => {});
          await this.humanSleep(3500, 4800);
          continue;
        } else {
          onLog(`⚠️ [Google Checkpoint Telefônico] "${cleanEmail}" precisa de um número de celular/chip para receber o código SMS de desbloqueio.`);
          return { loggedIn: false, challenge_type: 'NEW_PHONE_NUMBER_REQUIRED' };
        }
      }

      // 2D. Desafio de Código SMS no Celular (G-XXXXXX)
      const smsChallenge = await gmailTab.evaluate(() => {
        const txt = String(document.body ? document.body.innerText : '').toLowerCase();
        const isSms = (txt.includes('código de verificação') && (txt.includes('mensagem de texto') || txt.includes('sms') || txt.includes('envie'))) || txt.includes('get a verification code') || txt.includes('enter code');
        const smsInp = document.querySelector('input#idvPin, input[name="idvPin"], input[type="tel"]');
        if (smsInp && isSms) {
          const r = smsInp.getBoundingClientRect();
          if (r.width > 30 && r.height > 15) {
            return { found: true, box: { x: r.left, y: r.top, width: r.width, height: r.height } };
          }
        }
        return { found: false };
      }).catch(() => ({ found: false }));

      if (smsChallenge.found) {
        if (smsCode && smsChallenge.box) {
          onLog(`📲 [Google SMS Challenge] Inserindo código SMS recebido (${smsCode}) para "${cleanEmail}"...`);
          await this.humanClickBox(gmailTab, smsChallenge.box).catch(() => {});
          await this.humanSleep(150, 300);
          await this.humanTypeText(gmailTab, smsCode);
          await this.humanSleep(350, 500);
          await gmailTab.keyboard.press('Enter').catch(() => {});
          await this.humanSleep(3500, 4800);
          continue;
        } else {
          onLog(`📲 [Google SMS Challenge] O Google exige código SMS de 6 dígitos no celular para desbloquear "${cleanEmail}".`);
          return { loggedIn: false, challenge_type: 'SMS_CODE_REQUIRED' };
        }
      }

      // Resolvedor de Botões: Prioridade 1 (Pular/Agora não) e Prioridade 2 (Continuar/Concordo)
      const dismissBox = await gmailTab.evaluate(() => {
        const uNow = String(location.href || '').toLowerCase();
        const isPostLoginOptional = uNow.includes('/speedbump/') || uNow.includes('/interstitials/') || uNow.includes('gds.google.com') || uNow.includes('passkey') || uNow.includes('recoveryoptions');
        const rawBtns = Array.from(document.querySelectorAll('button, [role="button"], a, input[type="submit"], input[type="button"], span'));
        const candidates = [];
        for (const b of rawBtns) {
          const target = b.closest('button') || b.closest('[role="button"]') || b.closest('a') || b;
          const r = target.getBoundingClientRect();
          const st = window.getComputedStyle(target);
          if (r.width <= 28 || r.height <= 16 || st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity || 1) < 0.1) continue;
          const t = String(target.innerText || target.value || target.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
          if (!t || t.length > 45) continue;
          candidates.push({ x: r.left, y: r.top, width: r.width, height: r.height, label: t });
        }

        const skipLabels = ['agora não', 'not now', 'pular', 'skip', 'fazer isso mais tarde', 'do this later', 'mais tarde', 'later', 'não, obrigado', 'no thanks'];
        if (isPostLoginOptional) skipLabels.push('cancelar', 'cancel');
        for (const want of skipLabels) {
          const hit = candidates.find(c => c.label === want);
          if (hit) return hit;
        }

        const hasEmptyInput = Array.from(document.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"]')).some(inp => {
          if (inp.disabled || inp.getAttribute('aria-hidden') === 'true') return false;
          const r = inp.getBoundingClientRect();
          return r.width > 40 && r.height > 15 && !String(inp.value || '').trim();
        });

        const proceedLabels = ['continuar no gmail', 'continue to gmail', 'ir para o gmail', 'go to gmail', 'concordo', 'i agree', 'aceitar', 'accept', 'entendi', 'got it', 'concluído', 'done'];
        if (!hasEmptyInput) proceedLabels.push('continuar', 'continue', 'confirmar', 'confirm');
        for (const want of proceedLabels) {
          const hit = candidates.find(c => c.label === want);
          if (hit) return hit;
        }
        return null;
      }).catch(() => null);

      if (dismissBox) {
        onLog(`🛡️ [Sentinela Pós-Login] Clicando em "${dismissBox.label}"...`);
        await this.humanClickBox(gmailTab, dismissBox).catch(() => {});
        await this.humanSleep(2200, 3200);
      }
    }

    if (!(await this.checkIsInsideGmail(gmailTab)) && (await this.hasGoogleAuthCookies(gmailTab))) {
      await gmailTab.goto('https://mail.google.com/mail/u/0/#inbox', { waitUntil: 'domcontentloaded', timeout: 35000 }).catch(() => {});
      await this.humanSleep(2000, 3000);
    }

    return { loggedIn: await this.checkIsInsideGmail(gmailTab) };
  }

  /**
   * Aquecimento Orgânico Real dentro da Caixa de Entrada do Gmail (#inbox)
   */
  async warmupInbox(gmailTab, email, onLog = console.log, opts = {}) {
    if (!gmailTab) return { ok: false, emailsRead: 0 };
    try {
      await gmailTab.bringToFront().catch(() => {});
      const u = String(gmailTab.url() || '');
      if (!/^https:\/\/mail\.google\.com\/mail/i.test(u) || opts.forceReload) {
        await gmailTab.goto('https://mail.google.com/mail/u/0/#inbox', { waitUntil: 'domcontentloaded', timeout: 35000 }).catch(() => {});
      }
      await this.humanSleep(2000, 3000);

      // Fecha modais de 1º acesso
      for (let m = 0; m < 3; m++) {
        const modalBtn = await gmailTab.evaluate(() => {
          const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], .Kj-JD'));
          for (const d of dialogs) {
            const dr = d.getBoundingClientRect();
            if (dr.width < 100 || dr.height < 60) continue;
            const btns = Array.from(d.querySelectorAll('button, [role="button"], span'));
            for (const b of btns) {
              const t = String(b.innerText || b.textContent || '').trim().toLowerCase();
              if (/^(continuar|continue|avançar|next|concluído|done|ok|entendi|got it|fechar|close|dispensar)$/i.test(t)) {
                const target = b.closest('button') || b.closest('[role="button"]') || b;
                const r = target.getBoundingClientRect();
                if (r.width > 30 && r.height > 18) {
                  return { x: r.left, y: r.top, width: r.width, height: r.height, label: t };
                }
              }
            }
          }
          return null;
        }).catch(() => null);
        if (!modalBtn) break;
        onLog(`📬 [Aquecimento Inbox] Fechando popup inicial ("${modalBtn.label}")...`);
        await this.humanClickBox(gmailTab, modalBtn).catch(() => {});
        await this.humanSleep(1200, 1800);
      }

      // Lê 1 e-mail real na Caixa de Entrada
      const rowBox = await gmailTab.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('tr.zA'));
        for (const row of rows) {
          const r = row.getBoundingClientRect();
          if (r.width > 200 && r.height > 20 && r.top >= 60 && r.top < 780) {
            return {
              x: r.left + Math.min(180, r.width * 0.35),
              y: r.top + r.height * 0.5,
              width: 40,
              height: r.height,
              subject: String(row.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 70)
            };
          }
        }
        return null;
      }).catch(() => null);

      let emailsRead = 0;
      if (rowBox) {
        onLog(`📖 [Aquecimento Inbox • "${email}"] Abrindo e lendo e-mail: "${rowBox.subject}"...`);
        await this.humanClickBox(gmailTab, rowBox).catch(() => {});
        await this.humanSleep(2400, 3600);
        await gmailTab.mouse.wheel({ deltaY: 220 }).catch(() => {});
        await this.humanSleep(1500, 2300);
        emailsRead++;
        await gmailTab.goto('https://mail.google.com/mail/u/0/#inbox', { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
        await this.humanSleep(1400, 2000);
      }

      return { ok: true, emailsRead };
    } catch (err) {
      return { ok: false, emailsRead: 0, error: err.message };
    }
  }
}

module.exports = new GmailAuthenticator();
