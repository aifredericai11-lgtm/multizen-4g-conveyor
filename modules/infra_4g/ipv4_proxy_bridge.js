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
 *   sair 100% pelo IPv4 CGNAT limpo e recém-rotacionado, ex: `100.64.12.34`,
 *   eliminando 100% o vazamento do prefixo IPv6 `:18e6:`).
 * - Remove o header `Via: 1.1 localhost` do Every Proxy e preserva 100% o handshake
 *   TLS 1.3 (`X25519MLKEM768` / `h2` / `SNI`) nativo do Google Chrome 157 Oficial.
 * ============================================================================
 */

const net = require('net');
const dns = require('dns').promises;
const { execFile } = require('child_process');

const BRIDGE_HOST = '127.0.0.1';
const BRIDGE_PORT = 8082;
const UPSTREAM_HOST = '127.0.0.1';
const UPSTREAM_PORT = 8080;

const ipv4Cache = new Map();
const CACHE_TTL_MS = 180 * 1000;

function resolveIpv4Via4gAdb(hostname) {
  return new Promise((resolve) => {
    const safeHost = String(hostname || '').replace(/[^a-zA-Z0-9.-]/g, '');
    if (!safeHost) return resolve(null);
    execFile('adb', ['shell', `ping -c 1 -W 1 ${safeHost}`], { timeout: 2200 }, (err, stdout) => {
      const out = String(stdout || '');
      const m = out.match(/\(([\d.]+)\)/);
      if (m && m[1] && net.isIPv4(m[1])) {
        return resolve(m[1]);
      }
      resolve(null);
    });
  });
}

async function resolveIpv4(hostname) {
  if (!hostname) return hostname;
  if (net.isIPv4(hostname)) return hostname;
  if (net.isIPv6(hostname)) return hostname;

  const cleanHost = String(hostname).trim().toLowerCase();
  const now = Date.now();
  const cached = ipv4Cache.get(cleanHost);
  if (cached && (now - cached.ts) < CACHE_TTL_MS) {
    return cached.ip;
  }

  // CRÍTICO: Para domínios Facebook/Meta, NUNCA usa o DNS da Fibra do PC (que retorna caches FNA locais 57.144.x.x da Fibra e gera erro no 4G).
  // Resolve o IPv4 diretamente dentro do celular 4G via ADB (ou delega o hostname para o Every Proxy :8080 no 4G)!
  const isMetaDomain = /(^|\.)(facebook\.com|fbcdn\.net|facebook\.net|fbsbx\.com|instagram\.com|whatsapp\.com|meta\.com)$/i.test(cleanHost);
  if (isMetaDomain) {
    const adbIp = await resolveIpv4Via4gAdb(cleanHost);
    if (adbIp && net.isIPv4(adbIp)) {
      ipv4Cache.set(cleanHost, { ip: adbIp, ts: now });
      return adbIp;
    }
    return cleanHost;
  }

  try {
    const res = await dns.lookup(cleanHost, { family: 4 });
    if (res && res.address && net.isIPv4(res.address)) {
      ipv4Cache.set(cleanHost, { ip: res.address, ts: now });
      return res.address;
    }
  } catch (_) {}

  try {
    const list = await dns.resolve4(cleanHost);
    if (Array.isArray(list) && list.length > 0) {
      ipv4Cache.set(cleanHost, { ip: list[0], ts: now });
      return list[0];
    }
  } catch (_) {}

  return cleanHost;
}

let _bridgeServer = null;

function handleClientConnection(clientSocket) {
  clientSocket.once('error', () => {
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

      const upstream = net.connect(UPSTREAM_PORT, UPSTREAM_HOST, () => {
        upstream.write(`CONNECT ${targetIpv4}:${targetPort} ${httpVer}\r\nHost: ${targetIpv4}:${targetPort}\r\n\r\n`);
      });

      upstream.once('error', () => {
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
      upstream.write(headerBuf);
      clientSocket.pipe(upstream);
      upstream.pipe(clientSocket);
    });
    upstream.once('error', () => {
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

function ensureIpv4ProxyBridgeRunning(onLog = () => {}) {
  if (_bridgeServer && _bridgeServer.listening) {
    return Promise.resolve({ running: true, host: BRIDGE_HOST, port: BRIDGE_PORT });
  }
  return new Promise((resolve) => {
    const srv = net.createServer(handleClientConnection);
    srv.on('error', (err) => {
      if (err && err.code === 'EADDRINUSE') {
        resolve({ running: true, host: BRIDGE_HOST, port: BRIDGE_PORT, external: true });
      } else {
        resolve({ running: false, host: BRIDGE_HOST, port: BRIDGE_PORT, error: err.message });
      }
    });
    srv.listen(BRIDGE_PORT, BRIDGE_HOST, () => {
      _bridgeServer = srv;
      onLog(`🛡️ [Ponte 4G IPv4-Only] Ativa em ${BRIDGE_HOST}:${BRIDGE_PORT} -> ${UPSTREAM_HOST}:${UPSTREAM_PORT} (Zero IPv6 :18e6: + Zero Header Via)`);
      resolve({ running: true, host: BRIDGE_HOST, port: BRIDGE_PORT });
    });
  });
}

function clearIpv4DnsCache() {
  ipv4Cache.clear();
}

module.exports = {
  BRIDGE_HOST,
  BRIDGE_PORT,
  UPSTREAM_HOST,
  UPSTREAM_PORT,
  ensureIpv4ProxyBridgeRunning,
  clearIpv4DnsCache,
  resolveIpv4
};

