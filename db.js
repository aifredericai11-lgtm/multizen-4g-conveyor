'use strict';

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'database.json');

const DEFAULT_STATE = {
  settings: {
    mcp_token: process.env.INCOGNITON_MCP_TOKEN || '',
    mcp_api_url: process.env.INCOGNITON_MCP_URL || 'https://v5api.incogniton.com/mcp',
    proxy_4g_host: process.env.PROXY_4G_HOST || '127.0.0.1',
    proxy_4g_port: Number(process.env.PROXY_4G_PORT) || 8080,
    proxy_bridge_port: Number(process.env.IPV4_BRIDGE_PORT) || 8082,
    notebook_warmup_only_mode: true,
    max_pages_per_profile_willas: 10,
    willas_pages_per_session: 10,
    willas_page_creation_pacing_7_10_min: true,
    daily_profile_session_by_id: {}
  },
  pages: []
};

function readDbSafe() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      return { settings: { ...DEFAULT_STATE.settings }, pages: [] };
    }
    const parsed = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    return {
      ...DEFAULT_STATE,
      ...parsed,
      settings: {
        ...DEFAULT_STATE.settings,
        ...(parsed && parsed.settings ? parsed.settings : {})
      },
      pages: Array.isArray(parsed && parsed.pages) ? parsed.pages : []
    };
  } catch (_) {
    return { settings: { ...DEFAULT_STATE.settings }, pages: [] };
  }
}

function writeDbSafe(data) {
  const tmpPath = `${DB_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmpPath, DB_PATH);
}

function getState() { return readDbSafe(); }
function saveState(nextState) { writeDbSafe(nextState); return nextState; }
function getPages() { return readDbSafe().pages; }
function getSettings() { return readDbSafe().settings; }

function updateSettings(patch = {}) {
  const state = readDbSafe();
  state.settings = { ...state.settings, ...patch };
  writeDbSafe(state);
  return state.settings;
}

function addPage(pageObj = {}) {
  const state = readDbSafe();
  const id = pageObj.id || `page_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const created = { id, active: true, warming_day: 1, posts_today: 0, ...pageObj };
  state.pages.push(created);
  writeDbSafe(state);
  return created;
}

function updatePage(pageId, patch = {}) {
  const state = readDbSafe();
  const idx = state.pages.findIndex(p => p && (p.id === pageId || p.name === pageId));
  if (idx === -1) return null;
  state.pages[idx] = { ...state.pages[idx], ...patch };
  writeDbSafe(state);
  return state.pages[idx];
}

module.exports = {
  DB_PATH,
  getState,
  saveState,
  getPages,
  addPage,
  updatePage,
  getSettings,
  updateSettings
};
