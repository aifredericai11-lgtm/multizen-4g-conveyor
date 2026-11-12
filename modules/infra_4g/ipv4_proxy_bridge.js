/**
 * ============================================================================
 * MÓDULO INFRAESTRUTURA 4G: PONTE PROXY IPv4 PURO & ANTI-VIA (127.0.0.1:8081 -> :8080)
 * ============================================================================
 * Descoberta Forense (09/11/2026):
 * 1. Quando o Chrome envia `CONNECT accounts.google.com:443` direto para o Every Proxy
 *    (`127.0.0.1:8080`) no Samsung SM-A075M, o Android resolve o registro `AAAA` (IPv6)
 *    e sai pelo IPv6 `2804:808:xx:xxxx:18e6:...`, cujo bloco `/40` (`2804:808:`) e
 *    bytes de hardware `:18e6:` na interface `rmnet4` permanecem fixos mesmo girando
 *    o Modo Avião!
 * 2. Além disso, o Every Proxy injeta o header `Via: 1.1 localhost` na resposta do
 *    CONNECT e em requisições HTTP.
 *
 * Solução Cirúrgica:
 * - Escuta localmente em `127.0.0.1:8081`.
 * - Resolve o hostname de destino estritamente para IPv4 (`dns.lookup(..., { family: 4 })`).
 * - Envia `CONNECT <IPv4>:port` para `127.0.0.1:8080` (forçando o Android `rmnet4` a
 *   sair 100% pelo IPv4 CGNAT limpo e recém-rotacionado, ex: `0.0.0.0`,
 *   eliminando 100% o vazamento do prefixo IPv6 `:18e6:`).
 * - Remove o header `Via: 1.1 localhost` do Every Proxy e preserva 100% o handshake
 *   TLS 1.3 (`X25519MLKEM768` / `h2` / `SNI`) nativo do Google Chrome 157 Oficial.
 * ============================================================================
 */

const net = require('net');
const tls = require('tls');
const https = require('https');
const dns = require('dns').promises;
const { Resolver } = dns;

const BRIDGE_HOST = '127.0.0.1';
const BRIDGE_PORT = 8082;
const UPSTREAM_HOST = '127.0.0.1';
const UPSTREAM_PORT = 8080;

const publicResolver = new Resolver();
try {
  publicResolver.setServers(['1.1.1.1', '8.8.8.8', '1.0.0.1', '8.8.4.4']);
} catch (_) {}

const ipv4Cache = new Map();
const inFlightLookups = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutos para IPs resolvidos via DoH 4G
const FALLBACK_TTL_MS = 4000; // 4 segundos se vier de fallback

function create4gDohAgent(dohIp, sniServername) {
  return new https.Agent({
    keepAlive: true,
    maxSockets: 8,
    maxFreeSockets: 4,
    keepAliveMsecs: 25000,
    timeout: 3500,
    createConnection: (_opts, callback) => {
      let settled = false;
      const done = (err, sock) => {
        if (settled) return;
        settled = true;
        callback(err, sock);
      };

      const rawSock = net.connect(UPSTREAM_PORT, UPSTREAM_HOST, () => {
        rawSock.setNoDelay(true);
        rawSock.write(`CONNECT ${dohIp}:443 HTTP/1.1\r\nHost: ${dohIp}:443\r\n\r\n`);
      });
      rawSock.setNoDelay(true);
      rawSock.setTimeout(3200);

      let buf = '';
      const onProxyData = (chunk) => {
        buf += chunk.toString('latin1');
        const idx = buf.indexOf('\r\n\r\n');
        if (idx === -1) {
          if (buf.length > 8192) {
            rawSock.destroy();
            done(new Error('doh_proxy_header_overflow'));
          }
          return;
        }
        rawSock.removeListener('data', onProxyData);
        const statusLine = buf.slice(0, idx).split('\r\n')[0] || '';
        if (!/^HTTP\/1\.[01]\s+200\b/i.test(statusLine)) {
          rawSock.destroy();
          return done(new Error(`doh_proxy_status_${statusLine}`));
        }
        const tlsSock = tls.connect(
          {
            socket: rawSock,
            servername: sniServername,
            rejectUnauthorized: false
          },
          () => {
            tlsSock.setNoDelay(true);
            done(null, tlsSock);
          }
        );
        tlsSock.once('error', (err) => {
          try { tlsSock.destroy(); } catch (_) {}
          done(err);
        });
      };

      rawSock.on('data', onProxyData);
      rawSock.once('error', (err) => {
        try { rawSock.destroy(); } catch (_) {}
        done(err);
      });
      rawSock.once('timeout', () => {
        if (!settled) {
          try { rawSock.destroy(); } catch (_) {}
          done(new Error('doh_proxy_connect_timeout'));
        }
      });
      return undefined;
    }
  });
}

let googleDoh4gAgent = create4gDohAgent('8.8.8.8', 'dns.google');
let cloudflareDoh4gAgent = create4gDohAgent('1.1.1.1', 'cloudflare-dns.com');

function queryDoh4gJson(agent, hostHeader, reqPath, timeoutMs = 2400) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (err, ip) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(ip);
    };

    const req = https.request(
      {
        hostname: hostHeader,
        port: 443,
        path: reqPath,
        method: 'GET',
        agent,
        headers: {
          Host: hostHeader,
          Accept: 'application/dns-json'
        }
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (d) => { body += d; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            const answers = Array.isArray(parsed && parsed.Answer) ? parsed.Answer : [];
            const aRec = answers.find((a) => a && a.type === 1 && net.isIPv4(String(a.data || '').trim()));
            if (aRec) {
              return finish(null, String(aRec.data).trim());
            }
            finish(new Error('no_a_record'));
          } catch (e) {
            finish(e);
          }
        });
      }
    );

    const timer = setTimeout(() => {
      try { req.destroy(new Error('doh_req_timeout')); } catch (_) {}
      finish(new Error('doh_req_timeout'));
    }, timeoutMs);

    req.once('error', (err) => finish(err));
    req.end();
  });
}

function isCritical4gDohOnlyDomain(host) {
  return /(^|\.)(facebook\.com|fbcdn\.net|facebook\.net|fbsbx\.com|instagram\.com|google\.com|google\.com\.br|youtube\.com|googleapis\.com|gstatic\.com|ytimg\.com|ggpht\.com|googleusercontent\.com)$/i.test(host);
}

async function doLookupIpv4Fast(cleanHost) {
  const enc = encodeURIComponent(cleanHost);

  // 1) Tenta primeiro DoH 4G via Google DNS (8.8.8.8 sobre túnel 127.0.0.1:8080) -> devolve PoP da operadora 4G!
  try {
    const ip4g = await queryDoh4gJson(googleDoh4gAgent, 'dns.google', `/resolve?name=${enc}&type=A`, 2400);
    if (ip4g && net.isIPv4(ip4g)) {
      return { ip: ip4g, from4gDoh: true };
    }
  } catch (_) {}

  // 2) Fallback DoH 4G via Cloudflare (1.1.1.1 sobre túnel 127.0.0.1:8080)
  try {
    const ip4gCf = await queryDoh4gJson(cloudflareDoh4gAgent, 'cloudflare-dns.com', `/dns-query?name=${enc}&type=A`, 2200);
    if (ip4gCf && net.isIPv4(ip4gCf)) {
      return { ip: ip4gCf, from4gDoh: true };
    }
  } catch (_) {}

  // Para domínios Meta e Google/YouTube, NUNCA usar DNS da fibra residencial (evita mismatch ECS Fibra vs IP 4G no GFE/BotGuard e FNA Meta);
  // faz retry rápido no DoH 4G caso o túnel estivesse estabilizando pós-Modo Avião
  if (isCritical4gDohOnlyDomain(cleanHost)) {
    await new Promise((r) => setTimeout(r, 450));
    try {
      const ipRetry = await queryDoh4gJson(googleDoh4gAgent, 'dns.google', `/resolve?name=${enc}&type=A`, 2800);
      if (ipRetry && net.isIPv4(ipRetry)) {
        return { ip: ipRetry, from4gDoh: true };
      }
    } catch (_) {}
    try {
      const ipRetryCf = await queryDoh4gJson(cloudflareDoh4gAgent, 'cloudflare-dns.com', `/dns-query?name=${enc}&type=A`, 2500);
      if (ipRetryCf && net.isIPv4(ipRetryCf)) {
        return { ip: ipRetryCf, from4gDoh: true };
      }
    } catch (_) {}
    return { ip: cleanHost, from4gDoh: false };
  }

  // 3) Último fallback (domínios não-Meta) com TTL curto de 4s
  try {
    const list = await Promise.race([
      publicResolver.resolve4(cleanHost),
      new Promise((_, rej) => setTimeout(() => rej(new Error('dns_timeout')), 1000))
    ]);
    if (Array.isArray(list) && list.length > 0 && net.isIPv4(list[0])) {
      return { ip: list[0], from4gDoh: false };
    }
  } catch (_) {}

  return { ip: cleanHost, from4gDoh: false };
}

async function resolveIpv4(hostname) {
  if (!hostname) return hostname;
  if (net.isIPv4(hostname)) return hostname;
  if (net.isIPv6(hostname)) return hostname;

  const cleanHost = String(hostname).trim().toLowerCase();
  const now = Date.now();
  const cached = ipv4Cache.get(cleanHost);
  if (cached && now < cached.expiresAt) {
    return cached.ip;
  }

  if (inFlightLookups.has(cleanHost)) {
    return inFlightLookups.get(cleanHost);
  }

  const lookupPromise = (async () => {
    try {
      const res = await doLookupIpv4Fast(cleanHost);
      const resolved = res && res.ip ? res.ip : cleanHost;
      if (resolved && net.isIPv4(resolved)) {
        const ttl = res.from4gDoh ? CACHE_TTL_MS : FALLBACK_TTL_MS;
        ipv4Cache.set(cleanHost, { ip: resolved, ts: Date.now(), expiresAt: Date.now() + ttl });
        return resolved;
      }
      return cleanHost;
    } finally {
      inFlightLookups.delete(cleanHost);
    }
  })();

  inFlightLookups.set(cleanHost, lookupPromise);
  return lookupPromise;
}

function prewarmMetaAndGoogleDns() {
  const hosts = [
    'www.facebook.com',
    'web.facebook.com',
    'business.facebook.com',
    'static.xx.fbcdn.net',
    'scontent.xx.fbcdn.net',
    'edge-chat.facebook.com',
    'gateway.facebook.com',
    'www.youtube.com',
    'www.google.com',
    'accounts.google.com'
  ];
  for (const h of hosts) {
    resolveIpv4(h).catch(() => {});
  }
}

let _bridgeServer = global.__globalIpv4ProxyBridgeServer || null;

function handleClientConnection(clientSocket) {
  clientSocket.setNoDelay(true);
  clientSocket.setTimeout(120000);
  clientSocket.once('error', () => {
    try { clientSocket.destroy(); } catch (_) {}
  });
  clientSocket.once('timeout', () => {
    try { clientSocket.destroy(); } catch (_) {}
  });

  let headerBuf = Buffer.alloc(0);

  const onFirstData = async (chunk) => {
    headerBuf = Buffer.concat([headerBuf, chunk]);
    const headerEndIdx = headerBuf.indexOf('\r\n\r\n');
    if (headerEndIdx === -1) {
      if (headerBuf.length > 16384) {
        clientSocket.destroy();
      } else {
        clientSocket.once('data', onFirstData);
      }
      return;
    }

    const headerStr = headerBuf.slice(0, headerEndIdx).toString('latin1');
    const restBody = headerBuf.slice(headerEndIdx + 4);
    const lines = headerStr.split('\r\n');
    const firstLine = lines[0] || '';
    const matchConnect = firstLine.match(/^CONNECT\s+([^:\s]+):(\d+)\s+(HTTP\/1\.[01])$/i);

    if (matchConnect) {
      const targetHost = matchConnect[1];
      const targetPort = matchConnect[2];
      const httpVer = matchConnect[3];
      const targetIpv4 = await resolveIpv4(targetHost);

      if (clientSocket.destroyed) return;

      const upstream = net.connect(UPSTREAM_PORT, UPSTREAM_HOST, () => {
        upstream.setNoDelay(true);
        upstream.write(`CONNECT ${targetIpv4}:${targetPort} ${httpVer}\r\nHost: ${targetIpv4}:${targetPort}\r\n\r\n`);
      });
      upstream.setNoDelay(true);
      upstream.setTimeout(120000);

      upstream.once('error', () => {
        try { clientSocket.destroy(); } catch (_) {}
      });
      upstream.once('timeout', () => {
        try { upstream.destroy(); } catch (_) {}
        try { clientSocket.destroy(); } catch (_) {}
      });

      let upBuf = Buffer.alloc(0);
      const onUpstreamResp = (upChunk) => {
        upBuf = Buffer.concat([upBuf, upChunk]);
        const upEndIdx = upBuf.indexOf('\r\n\r\n');
        if (upEndIdx === -1) {
          if (upBuf.length > 16384) {
            upstream.destroy();
            clientSocket.destroy();
          } else {
            upstream.once('data', onUpstreamResp);
          }
          return;
        }

        const upHeader = upBuf.slice(0, upEndIdx).toString('latin1');
        const upRest = upBuf.slice(upEndIdx + 4);
        const statusLine = upHeader.split('\r\n')[0] || 'HTTP/1.1 502 Bad Gateway';

        if (/^HTTP\/1\.[01]\s+200\b/i.test(statusLine)) {
          // Resposta limpa sem 'Via: 1.1 localhost'
          clientSocket.write('HTTP/1.1 200 Connection established\r\n\r\n');
          if (restBody.length > 0) upstream.write(restBody);
          if (upRest.length > 0) clientSocket.write(upRest);
          clientSocket.pipe(upstream);
          upstream.pipe(clientSocket);
        } else {
          clientSocket.write(`${statusLine}\r\n\r\n`);
          clientSocket.destroy();
          upstream.destroy();
        }
      };

      upstream.once('data', onUpstreamResp);
      clientSocket.once('close', () => {
        try { upstream.destroy(); } catch (_) {}
      });
      upstream.once('close', () => {
        try { clientSocket.destroy(); } catch (_) {}
      });
      return;
    }

    // Requisição HTTP comum (ex: http://ip-api.com/...) -> encaminha para o upstream 8080
    const upstream = net.connect(UPSTREAM_PORT, UPSTREAM_HOST, () => {
      upstream.setNoDelay(true);
      upstream.write(headerBuf);
      clientSocket.pipe(upstream);
      upstream.pipe(clientSocket);
    });
    upstream.setNoDelay(true);
    upstream.setTimeout(120000);
    upstream.once('error', () => {
      try { clientSocket.destroy(); } catch (_) {}
    });
    upstream.once('timeout', () => {
      try { upstream.destroy(); } catch (_) {}
      try { clientSocket.destroy(); } catch (_) {}
    });
    clientSocket.once('close', () => {
      try { upstream.destroy(); } catch (_) {}
    });
    upstream.once('close', () => {
      try { clientSocket.destroy(); } catch (_) {}
    });
  };

  clientSocket.once('data', onFirstData);
}

global.__globalIpv4ProxyHandler = handleClientConnection;

function ensureIpv4ProxyBridgeRunning(onLog = () => {}) {
  if (_bridgeServer && _bridgeServer.listening) {
    return Promise.resolve({ running: true, host: BRIDGE_HOST, port: BRIDGE_PORT });
  }
  return new Promise((resolve) => {
    let inUseRetries = 0;
    const srv = net.createServer((clientSock) => {
      const fn = global.__globalIpv4ProxyHandler || handleClientConnection;
      fn(clientSock);
    });
    srv.on('error', (err) => {
      if (err && err.code === 'EADDRINUSE') {
        if (inUseRetries < 6) {
          inUseRetries++;
          setTimeout(() => {
            try { srv.listen(BRIDGE_PORT, BRIDGE_HOST); } catch (_) {}
          }, 350);
          return;
        }
        resolve({ running: true, host: BRIDGE_HOST, port: BRIDGE_PORT, external: true });
      } else {
        resolve({ running: false, host: BRIDGE_HOST, port: BRIDGE_PORT, error: err.message });
      }
    });
    srv.listen(BRIDGE_PORT, BRIDGE_HOST, () => {
      _bridgeServer = srv;
      global.__globalIpv4ProxyBridgeServer = srv;
      setTimeout(() => prewarmMetaAndGoogleDns(), 650);
      onLog(`🛡️ [Ponte 4G IPv4-Only + DoH 4G] Ativa em ${BRIDGE_HOST}:${BRIDGE_PORT} -> ${UPSTREAM_HOST}:${UPSTREAM_PORT} (ECS 4G + Zero IPv6 + Zero Via)`);
      resolve({ running: true, host: BRIDGE_HOST, port: BRIDGE_PORT });
    });
  });
}

function clearIpv4DnsCache() {
  ipv4Cache.clear();
  try { googleDoh4gAgent.destroy(); } catch (_) {}
  try { cloudflareDoh4gAgent.destroy(); } catch (_) {}
  googleDoh4gAgent = create4gDohAgent('8.8.8.8', 'dns.google');
  cloudflareDoh4gAgent = create4gDohAgent('1.1.1.1', 'cloudflare-dns.com');
  setTimeout(() => prewarmMetaAndGoogleDns(), 400);
}

// Inicia automaticamente a ponte 127.0.0.1:8082 assim que o módulo é carregado
ensureIpv4ProxyBridgeRunning().catch(() => {});

module.exports = {
  BRIDGE_HOST,
  BRIDGE_PORT,
  UPSTREAM_HOST,
  UPSTREAM_PORT,
  ensureIpv4ProxyBridgeRunning,
  clearIpv4DnsCache,
  prewarmMetaAndGoogleDns,
  resolveIpv4
};

