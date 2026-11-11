const adbRotator = require('./adb_rotator');
const proxyHealth = require('./proxy_health');
const zerumAdsPowerBridge = require('./zerum_adspower_4g_bridge');
const { runInfra4gStatus, runInfra4gRotation } = require('./runner');

module.exports = {
  ...adbRotator,
  ...proxyHealth,
  ...zerumAdsPowerBridge,
  runInfra4gStatus,
  runInfra4gRotation
};
