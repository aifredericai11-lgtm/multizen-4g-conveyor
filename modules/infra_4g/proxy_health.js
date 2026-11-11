/**
 * ============================================================================
 * MÓDULO INFRAESTRUTURA 4G: MONITOR DE SAÚDE DO PROXY (EVERY PROXY)
 * ============================================================================
 * Diretório: modules/infra_4g/proxy_health.js
 * 
 * Valida a integridade do túnel 4G móvel:
 * - Checagem direta de socket TCP em 127.0.0.1:8080
 * - Resolução de IP público e detecção de operadora (Vivo, Claro, TIM)
 * - Identificação de vazamento para IP fixo residencial
 * ============================================================================
 */

const net = require('net');
const http = require('http');

function checkProxyPortOpen(host = '127.0.0.1', port = 8080, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    socket.setTimeout(timeoutMs);

    socket.on('connect', () => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolve({ open: true, host, port });
      }
    });

    socket.on('timeout', () => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolve({ open: false, host, port, reason: 'TIMEOUT' });
      }
    });

    socket.on('error', (err) => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolve({ open: false, host, port, reason: err.message });
      }
    });

    try {
      socket.connect(port, host);
    } catch (e) {
      if (!settled) {
        settled = true;
        resolve({ open: false, host, port, reason: e.message });
      }
    }
  });
}

function fetchPublicIpViaDirect(timeoutMs = 5000) {
  return new Promise((resolve) => {
    const req = http.get('http://api.ipify.org?format=json', { timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ ok: true, ip: parsed.ip });
        } catch (_) {
          resolve({ ok: false, ip: null, error: 'JSON parse error' });
        }
      });
    });

    req.on('error', (err) => resolve({ ok: false, ip: null, error: err.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, ip: null, error: 'TIMEOUT' });
    });
  });
}

function fetchPublicIpViaProxy(proxyHost = '127.0.0.1', proxyPort = 8080, timeoutMs = 6000) {
  return new Promise((resolve) => {
    const req = http.request({
      host: proxyHost,
      port: proxyPort,
      method: 'GET',
      path: 'http://ip-api.com/json/?fields=status,query,isp,org,as,city,region,countryCode',
      headers: {
        Host: 'ip-api.com',
        'User-Agent': 'curl/8.4.0'
      },
      timeout: timeoutMs
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed && parsed.query) {
            resolve({
              ok: true,
              ip: parsed.query,
              isp: parsed.isp || parsed.org || null,
              city: parsed.city || null,
              region: parsed.region || null
            });
          } else {
            resolve({ ok: false, ip: null, error: 'No IP in proxy response' });
          }
        } catch (_) {
          resolve({ ok: false, ip: null, error: 'JSON parse error via proxy' });
        }
      });
    });

    req.on('error', (err) => resolve({ ok: false, ip: null, error: err.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, ip: null, error: 'PROXY_TIMEOUT' });
    });
    req.end();
  });
}

const MATRIX_FIXED_IP = process.env.MATRIX_FIXED_IP || '';

async function get4gProxyHealth(host = '127.0.0.1', port = 8080) {
  const portStatus = await checkProxyPortOpen(host, port);
  const [directIpRes, proxyIpRes] = await Promise.all([
    fetchPublicIpViaDirect().catch(() => ({ ok: false, ip: null })),
    portStatus.open ? fetchPublicIpViaProxy(host, port).catch(() => ({ ok: false, ip: null })) : Promise.resolve({ ok: false, ip: null })
  ]);

  const proxyIp = proxyIpRes.ip || null;
  const directIp = directIpRes.ip || null;
  const isSafe4gIp = Boolean(
    portStatus.open &&
    proxyIp &&
    proxyIp !== MATRIX_FIXED_IP &&
    (!directIp || proxyIp !== directIp)
  );

  return {
    proxy_port_open: portStatus.open,
    host,
    port,
    proxy_public_ip: proxyIp,
    proxy_isp: proxyIpRes.isp || null,
    proxy_city: proxyIpRes.city || null,
    direct_public_ip: directIp,
    matrix_fixed_ip: MATRIX_FIXED_IP,
    is_safe_4g_ip: isSafe4gIp,
    checked_at: new Date().toISOString()
  };
}

module.exports = {
  checkProxyPortOpen,
  fetchPublicIpViaDirect,
  fetchPublicIpViaProxy,
  get4gProxyHealth,
  MATRIX_FIXED_IP
};
