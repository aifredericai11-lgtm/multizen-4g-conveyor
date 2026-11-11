/**
 * ============================================================================
 * RUNNER DE INFRAESTRUTURA 4G (CLI + PROGRAMÁTICO)
 * ============================================================================
 * Diretório: modules/infra_4g/runner.js
 * 
 * Execução CLI:
 *   node modules/infra_4g/runner.js --status   (Exibe status do ADB e porta 8080)
 *   node modules/infra_4g/runner.js --rotate   (Aciona rotação via Modo Avião)
 *   node modules/infra_4g/runner.js --restart  (Reinicia daemon ADB do Windows)
 * ============================================================================
 */

const { getDeviceStatus, rotate4gIp, restartAdbDaemon } = require('./adb_rotator');
const { get4gProxyHealth } = require('./proxy_health');
const zerumAdsPowerBridge = require('./zerum_adspower_4g_bridge');

async function runInfra4gStatus(onLog = console.log) {
  onLog('🔍 [Infra 4G] Coletando status de dispositivos e proxy...');
  const adbStatus = getDeviceStatus(true);
  const proxyHealth = await get4gProxyHealth();

  return {
    adb: adbStatus,
    proxy: proxyHealth
  };
}

async function runInfra4gRotation(options = {}, onLog = console.log) {
  return await rotate4gIp(options, onLog);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const hasRotate = args.includes('--rotate');
  const hasRestart = args.includes('--restart');
  const hasSyncZerum = args.includes('--sync-zerum');
  const hasBridgeDaemon = args.includes('--bridge-daemon') || args.includes('--adspower-bridge');
  const hasHotInjectServer = args.includes('--hot-inject-server');

  if (hasHotInjectServer) {
    (async () => {
      try {
        const list = await (await fetch('http://127.0.0.1:9229/json')).json();
        const ws = new WebSocket(list[0].webSocketDebuggerUrl);
        await new Promise(r => { ws.onopen = r; });
        const expr = `(function(){
          const m = process.mainModule || require.main;
          const req = m ? m.require.bind(m) : require;
          const p = req('path');
          const Module = req('module');
          const modPath = p.resolve('modules/infra_4g/zerum_adspower_4g_bridge.js');
          const guarPath = p.resolve('modules/meta_publisher/zerum_post_guarantor.js');
          if (Module && Module._cache) {
            delete Module._cache[modPath];
            delete Module._cache[guarPath];
          }
          const { registerZerumBridgeRoutes } = req(modPath);
          const handles = process._getActiveHandles();
          let expressApp = null;
          for (const h of handles) {
            if (h && h._events && typeof h._events.request === 'function') {
              expressApp = h._events.request;
              break;
            }
          }
          if (!expressApp) return 'NO_APP';
          registerZerumBridgeRoutes(expressApp, {});
          return 'INJECTED_OK';
        })()`;
        ws.send(JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { expression: expr, includeCommandLineAPI: true, returnByValue: true }
        }));
        const msg = await new Promise(r => { ws.onmessage = e => r(JSON.parse(e.data)); });
        ws.close();
        console.log('Inspector:', JSON.stringify(msg));
        const st = await (await fetch('http://127.0.0.1:3000/api/zerum-local/bridge-status')).json();
        console.log('GET /api/zerum-local/bridge-status:', JSON.stringify({
          ok: st.ok,
          bridgeOnline: st.bridgeOnline,
          port: st.port,
          profilesCount: st.profilesCount,
          pagesCount: st.pagesCount,
          metaApiPagesCount: st.metaApiPagesCount,
          todaySlots: st.todayGrade && st.todayGrade.totalSlots,
          tomorrowSlots: st.tomorrowGrade && st.tomorrowGrade.totalSlots,
          activeBrowsers: st.activeBrowsers && st.activeBrowsers.length
        }, null, 2));
        process.exit(0);
      } catch (err) {
        console.error('[ERRO HOT-INJECT]:', err.message);
        process.exit(1);
      }
    })();
    return;
  }

  if (hasSyncZerum && !hasBridgeDaemon) {
    try {
      const res = zerumAdsPowerBridge.syncZerumLocalConfig(console.log);
      console.log('\n[SYNC ZERUM CONCLUÍDO]:', JSON.stringify(res, null, 2));
      process.exit(0);
    } catch (err) {
      console.error('\n[ERRO SYNC ZERUM]:', err.message);
      process.exit(1);
    }
  }

  if (hasBridgeDaemon) {
    try {
      if (hasSyncZerum) {
        zerumAdsPowerBridge.syncZerumLocalConfig(console.log);
      }
      zerumAdsPowerBridge.startBridgeServer({ onLog: console.log }).catch(err => {
        console.error('\n[ERRO PONTE 50325]:', err.message);
        process.exit(1);
      });
    } catch (err) {
      console.error('\n[ERRO]:', err.message);
      process.exit(1);
    }
    return;
  }

  if (hasRestart) {
    restartAdbDaemon(console.log);
    const st = getDeviceStatus(true);
    console.log('\n[STATUS PÓS-REINÍCIO]:', JSON.stringify(st, null, 2));
    process.exit(0);
  }

  if (hasRotate) {
    runInfra4gRotation({}, console.log).then(res => {
      console.log('\n[RESULTADO ROTAÇÃO]:', JSON.stringify(res, null, 2));
      process.exit(res.success ? 0 : 1);
    }).catch(err => {
      console.error('\n[ERRO]:', err.message);
      process.exit(1);
    });
  } else {
    runInfra4gStatus(console.log).then(res => {
      console.log('\n[STATUS ATUAL]:', JSON.stringify(res, null, 2));
      process.exit(0);
    }).catch(err => {
      console.error('\n[ERRO]:', err.message);
      process.exit(1);
    });
  }
}

module.exports = {
  runInfra4gStatus,
  runInfra4gRotation,
  zerumAdsPowerBridge
};
