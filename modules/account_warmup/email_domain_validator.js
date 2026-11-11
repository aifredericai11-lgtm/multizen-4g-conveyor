/**
 * ============================================================================
 * VALIDADOR DE DOMÍNIOS DE E-MAIL, COERÊNCIA GEOGRÁFICA (IP 4G BR) & ENTROPIA
 * ============================================================================
 * Diretório: modules/account_warmup/email_domain_validator.js
 * Propósito:
 *   - Classificar o domínio de e-mail para criação/aquecimento de contas em IP 4G Brasil (pt-BR).
 *   - Bloquear domínios descartáveis/temp-mail (LexisNexis Emailage / Sift High-Risk).
 *   - Bloquear domínios com Geo-Mismatch crítico para IP 4G Brasileiro (.ru, .ua, .pl, .de, .cn, etc.)
 *     e subdomínios de vaidade queimados da mail.com (dr.com, usa.com, consultant.com, etc.).
 *   - Calcular o risco de entropia do handle (Local-Part Scoring) contra padrões de bot farm
 *     (ex.: 4+ dígitos no sufixo como marlene.silva84920@... ou strings de consoantes aleatórias).
 * ============================================================================
 */

const TIER_S_GOLD_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'icloud.com',
  'me.com',
  'mac.com'
]);

const TIER_A_BIGTECH_DOMAINS = new Set([
  'outlook.com',
  'outlook.com.br',
  'hotmail.com',
  'hotmail.com.br',
  'live.com',
  'msn.com',
  'yahoo.com',
  'yahoo.com.br',
  'ymail.com'
]);

const TIER_B_BR_NATIONAL_DOMAINS = new Set([
  'uol.com.br',
  'bol.com.br',
  'terra.com.br',
  'ig.com.br',
  'r7.com',
  'claro.com.br',
  'globo.com',
  'globomail.com',
  'oi.com.br',
  'zipmail.com.br'
]);

const TIER_C_PRIVACY_DOMAINS = new Set([
  'proton.me',
  'protonmail.com',
  'protonmail.ch',
  'pm.me',
  'zoho.com',
  'zohomail.com',
  'gmx.com',
  'gmx.net',
  'tuta.com',
  'tutanota.com',
  'tutanota.de',
  'fastmail.com'
]);

const BLOCKED_GEO_MISMATCH_DOMAINS = new Set([
  // Rússia & Leste Europeu
  'mail.ru',
  'bk.ru',
  'inbox.ru',
  'list.ru',
  'internet.ru',
  'rambler.ru',
  'lenta.ru',
  'autorambler.ru',
  'myrambler.ru',
  'ro.ru',
  'yandex.ru',
  'yandex.com',
  'yandex.ua',
  'yandex.by',
  'yandex.kz',
  'ya.ru',
  'ukr.net',
  'i.ua',
  'meta.ua',
  'wp.pl',
  'onet.pl',
  'interia.pl',
  'o2.pl',
  'gazeta.pl',
  'seznam.cz',
  'centrum.cz',
  'abv.bg',
  'inbox.lv',
  'mail.ee',
  // ISPs Regionais Europeus & Asiáticos (Incompatíveis com IP 4G Brasil)
  'web.de',
  'gmx.de',
  't-online.de',
  'freenet.de',
  'orange.fr',
  'wanadoo.fr',
  'laposte.net',
  'free.fr',
  'sfr.fr',
  'libero.it',
  'virgilio.it',
  'alice.it',
  'tiscali.it',
  'naver.com',
  'daum.net',
  'hanmail.net',
  '163.com',
  '126.com',
  'qq.com',
  'sina.com',
  'sohu.com',
  'aliyun.com',
  // Subdomínios de vaidade queimados da mail.com (abusados por spam/bot farms)
  'mail.com',
  'email.com',
  'dr.com',
  'consultant.com',
  'usa.com',
  'techie.com',
  'engineer.com',
  'accountant.com',
  'myself.com',
  'post.com',
  'europe.com',
  'writeme.com',
  'cheerful.com',
  'execs.com',
  'asia.com',
  'berlin.com',
  'london.com',
  'madrid.com',
  'moscowmail.com',
  'munich.com',
  'rome.com',
  'tokyo.com'
]);

const BLOCKED_GEO_MISMATCH_TLDS = [
  '.ru', '.su', '.ua', '.by', '.kz', '.pl', '.cz', '.bg', '.lv', '.ee', '.lt',
  '.de', '.fr', '.it', '.kr', '.cn', '.jp', '.vn', '.ir', '.pk', '.bd', '.ng'
];

const BLOCKED_DISPOSABLE_TEMP_DOMAINS = new Set([
  'tmailor.com',
  'temp-mail.org',
  'tempmail.com',
  'temp-mail.io',
  'tempmailo.com',
  'guerrillamail.com',
  'guerrillamailblock.com',
  'sharklasers.com',
  'grr.la',
  'pokemail.net',
  'spam4.me',
  'yopmail.com',
  'yopmail.fr',
  'yopmail.net',
  'mailinator.com',
  '10minutemail.com',
  '10minutemail.net',
  'emailondeck.com',
  'moakt.com',
  'invertexto.com',
  'getnada.com',
  'nada.email',
  'trashmail.com',
  'trashmail.net',
  'maildrop.cc',
  'dispostable.com',
  'throwawaymail.com',
  'fakemail.net',
  'tempail.com',
  'duck.com',
  'mozmail.com',
  'burnermail.io',
  'anonaddy.com',
  'simplelogin.com',
  'simplelogin.co',
  'mailnesia.com',
  'mohmal.com',
  'crazymailing.com',
  'mailcatch.com',
  'mintemail.com',
  'mytemp.email',
  'tempmailaddress.com'
]);

/**
 * Avalia a entropia e estrutura do handle (parte antes do @) contra padrões de bot farm
 */
function evaluateHandleEntropy(localPart) {
  const raw = String(localPart || '').trim().toLowerCase();
  const issues = [];
  let score = 100;

  if (!raw || raw.length < 4) {
    return {
      handle: raw,
      score: 0,
      is_human_pattern: false,
      bot_farm_risk: 'CRITICAL',
      issues: ['Handle muito curto (< 4 caracteres).']
    };
  }

  // 1. Verifica 4 ou mais dígitos seguidos no final (ex.: marlene.silva84920)
  const trailingDigitsMatch = raw.match(/(\d{4,})$/);
  if (trailingDigitsMatch) {
    const dStr = trailingDigitsMatch[1];
    // Permite anos de nascimento plausíveis de 4 dígitos (1955..2004), bloqueia 5+ dígitos ou 4 dígitos aleatórios
    const numVal = parseInt(dStr, 10);
    const isPlausibleBirthYear = dStr.length === 4 && numVal >= 1950 && numVal <= 2005;
    if (!isPlausibleBirthYear) {
      score -= 60;
      issues.push(`Sufixo numérico de Bot Farm detectado ("${dStr}" no final do handle). Use no máximo 2 dígitos ou ano de nascimento real (ex.: 1978).`);
    }
  }

  // 2. Excesso total de dígitos no handle (> 4 dígitos no total)
  const allDigits = (raw.match(/\d/g) || []).length;
  if (allDigits >= 5) {
    score -= 45;
    issues.push(`Excesso de números no handle (${allDigits} dígitos). Padrão clássico de geração automatizada em lote.`);
  }

  // 3. Sequência de 5+ consoantes seguidas sem vogal (teclado batido / string aleatória ex.: xkrtplm)
  const alphaOnly = raw.replace(/[^a-z]/g, '');
  if (/[bcdfghjklmnpqrstvwxz]{5,}/i.test(alphaOnly)) {
    score -= 55;
    issues.push('Sequência de 5+ consoantes consecutivas (alta entropia / string aleatória não-humana).');
  }

  // 4. Proporção de vogais muito baixa em handles longos (ex.: Strings geradas por script)
  const vowels = (alphaOnly.match(/[aeiouy]/gi) || []).length;
  const vowelRatio = alphaOnly.length > 0 ? vowels / alphaOnly.length : 0;
  if (alphaOnly.length >= 7 && vowelRatio < 0.2) {
    score -= 45;
    issues.push(`Proporção de vogais anormalmente baixa (${(vowelRatio * 100).toFixed(0)}%) — assinatura de gerador randômico.`);
  }

  // 5. Prefixos suspeitos ou descartáveis no próprio handle
  if (/^(?:test|teste|temp|fake|bot|spam|admin|user\d+|conta\d+)/i.test(raw)) {
    score -= 70;
    issues.push('Handle inicia com palavra-chave de teste/automação (test/temp/fake/bot/conta).');
  }

  const finalScore = Math.max(0, score);
  const botFarmRisk = finalScore < 50 ? 'HIGH' : (finalScore < 80 ? 'MEDIUM' : 'LOW');

  return {
    handle: raw,
    score: finalScore,
    is_human_pattern: finalScore >= 60,
    bot_farm_risk: botFarmRisk,
    issues
  };
}

/**
 * Classifica o e-mail completo segundo a Tabela Realista de Confiança + Anti-Geo-Mismatch (IP 4G BR)
 */
function validateEmailFor4gBrWarmup(emailInput) {
  const cleanEmail = String(emailInput || '').trim().toLowerCase();
  const parts = cleanEmail.split('@');
  if (parts.length !== 2 || !parts[0] || !parts[1] || !parts[1].includes('.')) {
    return {
      valid_format: false,
      allowed: false,
      email: cleanEmail,
      tier: 'INVALID_EMAIL_FORMAT',
      reason: 'Formato de e-mail inválido.'
    };
  }

  const [localPart, domain] = parts;
  const handleReport = evaluateHandleEntropy(localPart);

  let tier = 'UNCLASSIFIED_CUSTOM';
  let domainAllowed = true;
  let minSoakHours = 24;
  let minNewsletters = 10;
  let domainReason = '';

  if (BLOCKED_DISPOSABLE_TEMP_DOMAINS.has(domain)) {
    tier = 'BLOCKED_DISPOSABLE_TEMP';
    domainAllowed = false;
    minSoakHours = null;
    domainReason = `Domínio descartável/relay bloqueado ("${domain}"). Causa ban/checkpoint imediato (Emailage / Sift / Meta).`;
  } else if (
    BLOCKED_GEO_MISMATCH_DOMAINS.has(domain) ||
    BLOCKED_GEO_MISMATCH_TLDS.some(tld => domain.endsWith(tld))
  ) {
    tier = 'BLOCKED_GEO_MISMATCH';
    domainAllowed = false;
    minSoakHours = null;
    domainReason = `Domínio com Geo-Mismatch crítico ou queimado ("${domain}") incompatível com IP 4G Brasil (pt-BR).`;
  } else if (TIER_S_GOLD_DOMAINS.has(domain)) {
    tier = 'TIER_S_GOLD';
    domainAllowed = true;
    minSoakHours = 24;
    minNewsletters = 10;
    domainReason = 'Domínio Tier S Ouro (Máxima confiança + ecossistema nativo de cookies).';
  } else if (TIER_A_BIGTECH_DOMAINS.has(domain)) {
    tier = 'TIER_A_BIGTECH';
    domainAllowed = true;
    minSoakHours = 24;
    minNewsletters = 12;
    domainReason = 'Domínio Tier A BigTech (Aprovado com Molho de 24h–48h de Newsletters + caixa desbloqueada sem trava de SMS).';
  } else if (TIER_B_BR_NATIONAL_DOMAINS.has(domain) || domain.endsWith('.com.br')) {
    tier = 'TIER_B_BR_NATIONAL';
    domainAllowed = true;
    minSoakHours = 24;
    minNewsletters = 12;
    domainReason = 'Domínio Tier B Nacional Brasileiro (Alta coerência geográfica com IP 4G Vivo/Claro/Algar Brasil).';
  } else if (TIER_C_PRIVACY_DOMAINS.has(domain)) {
    tier = 'TIER_C_PRIVACY';
    domainAllowed = true;
    minSoakHours = 48;
    minNewsletters = 15;
    domainReason = 'Domínio Tier C Privacidade (Exige obrigatoriamente 48h de molho de newsletters antes de facebook.com/reg).';
  } else {
    tier = 'TIER_C_CUSTOM';
    domainAllowed = true;
    minSoakHours = 48;
    minNewsletters = 15;
    domainReason = 'Domínio próprio/customizado (Exige 48h de molho de newsletters + MX/SPF válidos).';
  }

  const allowed = domainAllowed && handleReport.is_human_pattern;
  const combinedReasons = [domainReason, ...handleReport.issues].filter(Boolean);

  return {
    valid_format: true,
    allowed,
    email: cleanEmail,
    domain,
    tier,
    domain_allowed: domainAllowed,
    required_soak_hours: minSoakHours,
    required_newsletters: minNewsletters,
    handle_analysis: handleReport,
    reason: combinedReasons.join(' | ')
  };
}

module.exports = {
  validateEmailFor4gBrWarmup,
  evaluateHandleEntropy,
  TIER_S_GOLD_DOMAINS,
  TIER_A_BIGTECH_DOMAINS,
  TIER_B_BR_NATIONAL_DOMAINS,
  TIER_C_PRIVACY_DOMAINS,
  BLOCKED_GEO_MISMATCH_DOMAINS,
  BLOCKED_DISPOSABLE_TEMP_DOMAINS
};

