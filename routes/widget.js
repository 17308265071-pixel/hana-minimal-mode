// Minimal Mode sidebar panel (Chinese, plain HTML/JS, no build step) served at
// GET /widget. This is the single management surface: register one assistant
// (single target: registering replaces the previous one) from a dropdown of
// live agents; the registered row can be re-registered (refresh the
// registration time) or removed from a collapsible list with a two-step
// inline confirmation (no window.confirm: sandboxed iframes block it). All
// dynamic DOM is written via textContent; the API calls carry the
// plugin surface session header and the route shell follows the host
// conventions (hana-theme/hana-css query params, ready postMessage handshake,
// string-slice base derivation).
export default function registerWidget(app, ctx) {
  app.get("/widget", (c) => c.html(renderWidget(c)));
}

function renderWidget(c) {
  const hanaCss = (c?.req?.query?.("hana-css") || "").trim();
  const theme = (c?.req?.query?.("hana-theme") || "inherit").trim();
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>极简模式</title>
  ${hanaCss ? `<link rel="stylesheet" href="${escapeAttr(hanaCss)}">` : ""}
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { width: 100%; background: transparent; }
  html { scrollbar-color: var(--text-muted, #6e7781) transparent; }
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--text-muted, #6e7781); border-radius: 5px; }
  ::-webkit-scrollbar-thumb:hover { background: var(--text-light, #57606a); }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    margin: 0;
    padding: 16px;
    color: var(--text, #1f2328);
    font-size: 13px;
  }
  h1 { font-size: 16px; margin: 0; color: var(--text, #1f2328); }
  .head { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 8px; min-width: 0; margin-bottom: 10px; }
  .sub { font-size: 12px; color: var(--text-muted, #6e7781); margin: 4px 0 0; line-height: 1.5; min-width: 0; overflow-wrap: anywhere; }
  .card {
    background: var(--bg-card, #ffffff);
    border: 1px solid var(--border, #d0d7de);
    border-radius: 10px;
    box-shadow: 0 1px 2px var(--shadow, rgba(0, 0, 0, 0.06));
    padding: 12px;
    margin-bottom: 12px;
  }
  .section-title { font-size: 13px; font-weight: 600; margin: 0 0 8px; color: var(--text, #1f2328); }
  .switch { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 6px; min-width: 0; font-size: 13px; white-space: nowrap; cursor: pointer; color: var(--text, #1f2328); }
  input[type=checkbox] { width: 16px; height: 16px; accent-color: var(--accent, #0969da); }
  select {
    width: 100%;
    max-width: 100%;
    min-width: 0;
    padding: 6px 26px 6px 9px;
    border: 1px solid var(--border, #d0d7de);
    border-radius: 6px;
    background-color: var(--overlay-subtle, rgba(0, 0, 0, 0.03));
    background-image: var(--select-arrow, none);
    background-repeat: no-repeat;
    background-position: right 8px center;
    color: var(--text, #1f2328);
    font-size: 13px;
    font-family: inherit;
    appearance: none;
    -webkit-appearance: none;
  }
  select:focus { outline: 2px solid var(--accent-light, #dbeafe); border-color: var(--accent, #0969da); }
  select option { background: var(--bg-card, #ffffff); color: var(--text, #1f2328); }
  .pick { display: flex; flex-wrap: wrap; gap: 8px; min-width: 0; }
  .pick select { flex: 1; min-width: 0; }
  button {
    background: var(--accent, #0969da);
    color: #fff;
    border: 0;
    border-radius: 6px;
    padding: 7px 14px;
    cursor: pointer;
    font-size: 13px;
    font-family: inherit;
    white-space: normal;
    max-width: 100%;
    overflow-wrap: anywhere;
  }
  button:hover:not(:disabled) { background: var(--accent-hover, #0875e8); }
  button:focus-visible { outline: 2px solid var(--accent, #0969da); outline-offset: 1px; }
  button:disabled { opacity: 0.6; cursor: default; }
  button.secondary {
    background: var(--overlay-medium, rgba(0, 0, 0, 0.06));
    color: var(--text, #1f2328);
    border: 1px solid var(--border, #d0d7de);
  }
  button.secondary:hover:not(:disabled) { background: var(--overlay-light, rgba(0, 0, 0, 0.04)); }
  button.danger {
    background: transparent;
    color: var(--danger, #cf222e);
    border: 1px solid var(--danger, #cf222e);
  }
  button.danger:hover:not(:disabled) { background: var(--overlay-light, rgba(0, 0, 0, 0.04)); }
  button.danger.armed { background: var(--danger, #cf222e); color: #fff; }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 2px 10px;
    border-radius: 999px;
    background: var(--accent-light, rgba(9, 105, 218, 0.1));
    border: 1px solid var(--border, #d0d7de);
    color: var(--text, #1f2328);
    font-size: 12px;
  }
  .status { font-size: 13px; margin: 0 0 10px; min-height: 18px; min-width: 0; overflow-wrap: anywhere; color: var(--text-muted, #6e7781); }
  .status.on { color: var(--green, #1a7f37); }
  .status.off, .status.err { color: var(--danger, #cf222e); }
  details { border: 0; min-width: 0; }
  summary {
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    color: var(--text, #1f2328);
    padding: 4px 6px;
    border-radius: 6px;
    max-width: 100%;
    overflow-wrap: anywhere;
  }
  summary:hover { background: var(--overlay-medium, rgba(0, 0, 0, 0.06)); }
  summary .count { font-weight: 400; color: var(--text-muted, #6e7781); }
  .row { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; min-width: 0; padding: 8px 0; border-top: 1px solid var(--border, #d0d7de); }
  .row:first-of-type { border-top: 0; }
  .row .info { flex: 1 1 200px; min-width: 0; }
  .row .name { font-size: 13px; font-weight: 600; color: var(--text, #1f2328); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row .meta { font-size: 12px; color: var(--text-light, #57606a); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; min-width: 0; }
  .empty { font-size: 12px; color: var(--text-muted, #6e7781); padding: 8px 0; min-width: 0; overflow-wrap: anywhere; }
  .hint { font-size: 12px; color: var(--text-muted, #6e7781); margin-top: 8px; line-height: 1.5; min-width: 0; overflow-wrap: anywhere; }
  .foot { font-size: 12px; color: var(--text-muted, #6e7781); border-top: 1px solid var(--border, #d0d7de); padding-top: 10px; line-height: 1.5; min-width: 0; overflow-wrap: anywhere; }
  a { color: var(--link, var(--accent, #0969da)); }
  @media (max-width: 340px) {
    body { padding: 10px; font-size: 12px; }
    h1 { font-size: 15px; }
    .card { padding: 8px; margin-bottom: 8px; }
    .section-title, .status, .row .name, .switch, summary { font-size: 12px; }
    .pick select, button { font-size: 12px; }
    button { padding: 6px 10px; }
    .sub, .hint, .foot, .empty, .row .meta { font-size: 11px; }
  }
  [hidden] { display: none !important; }
</style>
</head>
<body data-hana-theme="${escapeAttr(theme)}" data-theme="${escapeAttr(theme)}">
  <header class="head">
    <div>
      <h1>极简模式</h1>
      <p class="sub">注册后，该助手的会话启用任务感知路由（T0 锚定 + 四阶段渐进披露）。</p>
    </div>
    <label class="switch" for="enabledEl">
      <input type="checkbox" id="enabledEl" role="switch">
      <span>总开关</span>
    </label>
  </header>

  <div id="status" class="status" role="status"></div>

  <section class="card">
    <div class="section-title">路由模式</div>
    <select id="routerMode" aria-label="路由模式">
      <option value="auto">auto（标准渐进流程）</option>
      <option value="spec">spec</option>
      <option value="react">react</option>
      <option value="weak">weak</option>
      <option value="mixed">mixed</option>
    </select>
  </section>

  <section class="card">
    <div class="section-title">注册助手</div>
    <div class="pick">
      <select id="agentPick" aria-label="选择要注册的助手">
        <option value="">选择助手…</option>
      </select>
      <button id="registerBtn" type="button" disabled>注册</button>
    </div>
    <div id="pickHint" class="hint">注册将把该助手设为唯一目标。每个助手需单独注册。</div>
  </section>

  <section class="card">
    <details id="registered" open>
      <summary>已注册助手 <span id="count" class="count"></span></summary>
      <div id="list"></div>
      <div id="empty" class="empty">暂无已注册助手。从上方下拉选择助手并点击「注册」。</div>
    </details>
  </section>

  <footer class="foot">取消注册不会修改助手的任何文件；本插件仅管理路由注册与会话状态；插件不裁剪、不替换 Hana 的原生上下文（记忆/技能/身份），只追加路由标记。列表每 5 秒自动刷新。</footer>

<script>
(function () {
  const pathname = location.pathname;
  let base = pathname;
  if (base.endsWith('/widget')) base = base.slice(0, -'/widget'.length);
  const params = new URLSearchParams(location.search);
  const theme = (params.get('hana-theme') || 'inherit').trim();
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.setAttribute('data-hana-theme', theme);
  document.documentElement.style.colorScheme = /midnight/i.test(theme) ? 'dark' : 'light';
  const surfaceSession = params.get('pluginSurfaceSession') || '';

  // Legacy ready handshake (also accepted by the host).
  try { window.parent.postMessage({ type: 'ready' }, '*'); } catch {}

  async function api(path, options = {}) {
    const headers = Object.assign({}, options.headers || {});
    if (surfaceSession) headers['X-Hana-Plugin-Surface-Session'] = surfaceSession;
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + path, Object.assign({}, options, { headers }));
    return res.json();
  }

  const statusEl = document.getElementById('status');
  const enabledEl = document.getElementById('enabledEl');
  const modeEl = document.getElementById('routerMode');
  const pickEl = document.getElementById('agentPick');
  const registerBtn = document.getElementById('registerBtn');
  const pickHintEl = document.getElementById('pickHint');
  const listEl = document.getElementById('list');
  const emptyEl = document.getElementById('empty');
  const countEl = document.getElementById('count');

  const SOURCE_LABELS = {
    panel: '面板注册',
    page: '面板注册',
    legacy: '历史迁移',
    routing: '路由同步',
    settings: '设置同步',
    toggle: '对话开关',
    command: '命令',
    prune: '已删除清理',
    unknown: '未知',
  };

  let agents = []; // live agents: [{ id, name }]
  let target = ''; // current single target id ('' = none)
  let registrations = {}; // id -> { registeredAt, source }
  let savingEnabled = false;
  let modeSaving = false;
  let stickyUntil = 0;
  let armedDelete = { id: '', timer: null };

  function setStatus(text, kind, stickyMs) {
    statusEl.textContent = text || '';
    statusEl.className = 'status' + (kind ? ' ' + kind : '');
    if (stickyMs) stickyUntil = Date.now() + stickyMs;
  }

  function sourceLabel(source) {
    return SOURCE_LABELS[source] || String(source || '未知');
  }

  function formatTime(ts) {
    const n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return '未知';
    try { return new Date(n).toLocaleString(); } catch { return String(ts); }
  }

  function agentName(id) {
    const found = agents.find((a) => a.id === id);
    return found ? found.name : id;
  }

  function resetArmedDelete() {
    if (armedDelete.timer) clearTimeout(armedDelete.timer);
    armedDelete = { id: '', timer: null };
  }

  // Two-step delete: the first click arms the button, a second click within
  // 3 seconds deletes. Never window.confirm (sandboxed iframes block it).
  function armDelete(id, button) {
    resetArmedDelete();
    armedDelete.id = id;
    armedDelete.timer = setTimeout(() => {
      armedDelete = { id: '', timer: null };
      button.textContent = '删除注册';
      button.classList.remove('armed');
    }, 3000);
    button.textContent = '确认删除';
    button.classList.add('armed');
  }

  async function reregister(id) {
    setStatus('正在重注册「' + agentName(id) + '」…');
    try {
      const data = await api('/reregister', { method: 'POST', body: JSON.stringify({ agentId: id }) });
      if (!data.ok) throw new Error(data.error || 'reregister failed');
      applyState(data);
      setStatus('已重注册「' + agentName(id) + '」，注册时间已刷新。', 'on', 4000);
    } catch (err) {
      setStatus('重注册失败：' + err.message, 'err', 5000);
    }
  }

  async function unregister(id) {
    setStatus('正在取消注册「' + agentName(id) + '」…');
    try {
      const data = await api('/unregister', { method: 'POST', body: JSON.stringify({ agentId: id }) });
      if (!data.ok) throw new Error(data.error || 'unregister failed');
      applyState(data);
      setStatus('已取消注册，助手行为已恢复为注册前。', 'on', 5000);
    } catch (err) {
      setStatus('取消注册失败：' + err.message, 'err', 5000);
    } finally {
      resetArmedDelete();
    }
  }

  function renderList() {
    listEl.textContent = '';
    const entries = Object.entries(registrations);
    countEl.textContent = '（' + entries.length + '）';
    if (!entries.length) {
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;
    entries.forEach(([id, record]) => {
      const row = document.createElement('div');
      row.className = 'row';

      const info = document.createElement('div');
      info.className = 'info';
      const nameEl = document.createElement('div');
      nameEl.className = 'name';
      nameEl.textContent = agentName(id) + '（' + id + '）';
      const metaEl = document.createElement('div');
      metaEl.className = 'meta';
      metaEl.textContent = '注册时间：' + formatTime(record.registeredAt) + ' · 来源：' + sourceLabel(record.source);
      info.appendChild(nameEl);
      info.appendChild(metaEl);

      const actions = document.createElement('div');
      actions.className = 'actions';
      const reBtn = document.createElement('button');
      reBtn.type = 'button';
      reBtn.className = 'secondary';
      reBtn.textContent = '重注册';
      reBtn.addEventListener('click', () => { void reregister(id); });
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'danger';
      const armed = armedDelete.id === id;
      delBtn.textContent = armed ? '确认删除' : '删除注册';
      if (armed) delBtn.classList.add('armed');
      delBtn.addEventListener('click', () => {
        if (armedDelete.id === id) {
          resetArmedDelete();
          void unregister(id);
        } else {
          armDelete(id, delBtn);
          setStatus('再次点击「确认删除」以取消注册「' + agentName(id) + '」。', 'err', 3000);
        }
      });
      actions.appendChild(reBtn);
      actions.appendChild(delBtn);
      row.appendChild(info);
      row.appendChild(actions);
      listEl.appendChild(row);
    });
  }

  // Dropdown: only live, not-yet-registered agents. The current pick survives
  // a rebuild while it is still selectable (never clobbered mid-interaction);
  // an open dropdown is left untouched until the user is done with it.
  function renderPick() {
    const previous = pickEl.value;
    if (document.activeElement === pickEl) {
      registerBtn.disabled = !(previous && agents.some((a) => a.id === previous) && !registrations[previous]);
      return;
    }
    pickEl.textContent = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '选择助手…';
    pickEl.appendChild(placeholder);
    agents.forEach((agent) => {
      if (registrations[agent.id]) return;
      const opt = document.createElement('option');
      opt.value = agent.id;
      opt.textContent = agent.name + '（' + agent.id + '）';
      pickEl.appendChild(opt);
    });
    const stillThere = previous && agents.some((a) => a.id === previous) && !registrations[previous];
    pickEl.value = stillThere ? previous : '';
    registerBtn.disabled = !pickEl.value;
  }

  // Merge the fresh list: keep existing ids (and their order) while still
  // present, append newly created agents, drop the ones that disappeared.
  function mergeAgents(fresh) {
    const byId = new Map();
    fresh.forEach((a) => {
      if (!a || typeof a.id !== 'string' || !a.id) return;
      byId.set(a.id, { id: a.id, name: a.name || a.id });
    });
    const merged = [];
    agents.forEach((a) => {
      if (byId.has(a.id)) merged.push(byId.get(a.id));
    });
    byId.forEach((a, id) => {
      if (!merged.some((x) => x.id === id)) merged.push(a);
    });
    agents = merged;
  }

  // Partial merge: a response only updates the controls it actually carries,
  // so a mutation payload can never blank the enabled toggle / mode select.
  function applyState(data) {
    if (!savingEnabled && data.enabled !== undefined) enabledEl.checked = !!data.enabled;
    if (!modeSaving && data.routerMode !== undefined) modeEl.value = String(data.routerMode || 'auto');
    if (data.target !== undefined) target = typeof data.target === 'string' ? data.target : '';
    if (data.registrations !== undefined) {
      registrations = data.registrations && typeof data.registrations === 'object' ? data.registrations : {};
    }
    if (Array.isArray(data.agents)) mergeAgents(data.agents);
    if (data.target !== undefined || data.registrations !== undefined) {
      renderList();
      renderPick();
      pickHintEl.textContent = target
        ? '当前已注册「' + agentName(target) + '」；再次注册将替换该助手。'
        : '注册将把该助手设为唯一目标。每个助手需单独注册。';
    }
  }

  async function refresh() {
    try {
      const data = await api('/state');
      if (!data.ok) throw new Error(data.error || 'load failed');
      applyState(data);
      if (Date.now() >= stickyUntil) {
        const count = Object.keys(registrations).length;
        setStatus('运行状态：' + (data.enabled ? 'ON' : 'OFF') + ' · 已注册 ' + count + ' 个助手', data.enabled ? 'on' : 'off');
      }
    } catch (err) {
      setStatus('读取状态失败：' + err.message, 'err');
    }
  }

  registerBtn.addEventListener('click', async () => {
    const id = pickEl.value;
    if (!id) return;
    registerBtn.disabled = true;
    registerBtn.textContent = '注册中…';
    const replacing = target ? '（将替换「' + agentName(target) + '」）' : '';
    setStatus('正在注册「' + agentName(id) + '」' + replacing + '…');
    try {
      const data = await api('/register', { method: 'POST', body: JSON.stringify({ agentId: id }) });
      if (!data.ok) throw new Error(data.error || 'register failed');
      applyState(data);
      setStatus('已注册助手「' + agentName(id) + '」，其会话将启用极简模式。', 'on', 4000);
    } catch (err) {
      setStatus('注册失败：' + err.message, 'err', 5000);
    } finally {
      registerBtn.textContent = '注册';
      renderPick();
    }
  });

  enabledEl.addEventListener('change', async () => {
    const next = !!enabledEl.checked;
    savingEnabled = true;
    try {
      const data = await api('/set', { method: 'POST', body: JSON.stringify({ enabled: next }) });
      if (!data.ok) throw new Error(data.error || 'save failed');
      setStatus('已' + (next ? '启用' : '关闭') + '极简模式路由。', next ? 'on' : 'off', 4000);
    } catch (err) {
      enabledEl.checked = !next;
      setStatus('保存失败：' + err.message, 'err', 5000);
    } finally {
      savingEnabled = false;
    }
  });

  modeEl.addEventListener('change', async () => {
    const next = modeEl.value;
    modeSaving = true;
    try {
      const data = await api('/set', { method: 'POST', body: JSON.stringify({ routerMode: next }) });
      if (!data.ok) throw new Error(data.error || 'save failed');
      setStatus('路由模式已设为 ' + (data.routerMode || next) + '。', 'on', 4000);
    } catch (err) {
      setStatus('保存失败：' + err.message, 'err', 5000);
    } finally {
      modeSaving = false;
    }
  });

  (async function init() {
    await refresh();
    setInterval(refresh, 5000);
  })();
})();
</script>
</body>
</html>`;
}

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}
