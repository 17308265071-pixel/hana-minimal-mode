const MODULE_VERSION = "0.4.6";
const _state = await import(new URL("../state.js?v=" + MODULE_VERSION, import.meta.url).href);
const _policy = await import(new URL("../policy.js?v=" + MODULE_VERSION, import.meta.url).href);
const _compat = await import(new URL("../compat.js?v=" + MODULE_VERSION, import.meta.url).href);
const _stage = await import(new URL("../stage-engine.js?v=" + MODULE_VERSION, import.meta.url).href);
const _router = await import(new URL("../router-core.js?v=" + MODULE_VERSION, import.meta.url).href);
const _network = await import(new URL("../network-guard.js?v=" + MODULE_VERSION, import.meta.url).href);
const _target = await import(new URL("../target-service.js?v=" + MODULE_VERSION, import.meta.url).href);
const { getState, setState, getStageBucket, setStageBucket, isAgentInScope, getPluginCtx, clearAgentStages } = _state;
const { computePolicy } = _policy;
const { TIER, detectTier, stripPrefix } = _compat;
const { autoAdvance } = _stage;
const { activationActionFor, expandPackTools, matchesToolSpec, TOOL_PACKS } = _router;
const { isNetworkCommand, extractCommandFromToolInput } = _network;
const { setTarget } = _target;

const PREFIX = "hana-minimal-mode_";
const MARKER = { persona: "[router-persona]", stage: "[router-stage]", anchor: "[anchor-notice]",
                 bootstrap: "[router-bootstrap]", decl: "[router-decl]", proactivity: "[router-proactivity]",
                 pack: "[tool-pack-hint]", capabilities: "[router-capabilities]" };
// R29: informational only — packs and tools auto-release on call; the model is
// never pushed through the bridge to pre-open a pack.
const TOOL_PACK_HINT =
  "Platform packs and on-demand tools open automatically when you call them — call the tool you need directly. "
  + "request_tools remains available if you prefer to pre-open a pack.";

function sessionKeyCandidates(event, ctx) {
  return [
    ctx?.sessionManager?.getSessionFile?.(),
    event?.sessionPath, ctx?.sessionRef?.sessionPath, ctx?.sessionPath,
    event?.sessionId, ctx?.sessionRef?.sessionId,
  ].filter((k) => typeof k === "string" && k && k !== "global");
}
function sessionKeyOf(event, ctx) { return sessionKeyCandidates(event, ctx)[0] || "global"; }
function agentIdFromSessionKey(key) {
  const m = String(key || "").replace(/\\/g, "/").match(/agents\/([^/]+)\//);
  return m?.[1] || null;
}
function toolNameOf(tool) { return tool?.function?.name || tool?.name; }
function messageText(m) {
  if (!m || typeof m !== "object") return "";
  const c = m.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((b) => (typeof b === "string" ? b : b?.text || b?.content || "")).join(" ");
  return "";
}
function userMessages(messages) { return Array.isArray(messages) ? messages.filter((m) => m?.role === "user") : []; }
function stripMarker(text, marker) {
  if (typeof text !== "string") return text;
  const i = text.indexOf(marker);
  return i === -1 ? text : text.slice(0, i).replace(/\s+$/, "");
}
function appendBlock(text, marker, block) {
  if (typeof text !== "string" || !block) return text;
  const base = stripMarker(text, marker);
  return `${base.replace(/\s+$/, "")}\n\n${marker}\n${block}`;
}
function getSystemText(payload) {
  if (typeof payload?.system === "string") return payload.system;
  if (payload && Array.isArray(payload.messages)) {
    for (const m of payload.messages) {
      if (m?.role !== "system") continue;
      if (typeof m.content === "string") return m.content;
      if (Array.isArray(m.content)) return m.content.map((b) => (typeof b === "string" ? b : b?.text || "")).join("");
    }
  }
  return "";
}
function setSystemText(payload, text) {
  if (typeof payload?.system === "string") { payload.system = text; return; }
  if (!Array.isArray(payload.messages)) return;
  for (let i = 0; i < payload.messages.length; i += 1) {
    const m = payload.messages[i];
    if (m?.role === "system") { payload.messages[i] = { ...m, content: text }; return; }
  }
  payload.messages.unshift({ role: "system", content: text });
}
function appendToLastUser(messages, marker, block) {
  if (!Array.isArray(messages) || !block) return messages;
  let idx = -1;
  for (let i = 0; i < messages.length; i += 1) if (messages[i]?.role === "user") idx = i;
  if (idx === -1) return messages;
  const m = messages[idx];
  if (typeof m.content === "string") {
    const next = appendBlock(m.content, marker, block);
    return next === m.content ? messages : messages.map((x, i) => (i === idx ? { ...x, content: next } : x));
  }
  if (Array.isArray(m.content)) {
    let lastText = -1;
    for (let i = 0; i < m.content.length; i += 1) {
      const b = m.content[i];
      if (b && typeof b === "object" && (b.type === "text" || typeof b.text === "string")) lastText = i;
    }
    if (lastText === -1) {
      const content = [...m.content, { type: "text", text: `${marker}\n${block}` }];
      return messages.map((x, i) => (i === idx ? { ...x, content } : x));
    }
    const target = m.content[lastText];
    if (typeof target?.text !== "string") {
      const content = m.content.map((b, i) => (i === lastText ? { ...b, text: `${marker}\n${block}` } : b));
      return messages.map((x, i) => (i === idx ? { ...x, content } : x));
    }
    const next = appendBlock(target.text, marker, block);
    if (next === target.text) return messages;
    const content = m.content.map((b, i) => (i === lastText ? { ...b, text: next } : b));
    return messages.map((x, i) => (i === idx ? { ...x, content } : x));
  }
  return messages;
}

export default function (pi) {
  pi.on("before_provider_request", (event, ctx) => {
    try {
      const state = getState();
      const key = sessionKeyOf(event, ctx);
      const agentId = agentIdFromSessionKey(key);
      if (!state.enabled || !agentId || !isAgentInScope(agentId)) return event.payload;
      const p = event.payload;
      if (!p || typeof p !== "object") return p;
      const messages = Array.isArray(p.messages) ? p.messages : [];
      const tools = Array.isArray(p.tools) ? p.tools : [];
      const tier = detectTier(tools.map(toolNameOf), PREFIX);
      const sb = getStageBucket(key);
      if (sb.tier !== tier) setStageBucket(key, { tier });
      const priorAssistant = messages.some((m) => m?.role === "assistant");
      // 锚定轮已结束（存在 assistant 回复）即视为会话已进入路由运行态：
      // bridge/legacy 档没有 phase_begin，guided 必须在此自动置位，
      // 否则 policy 永不注入阶段文本/声明，平台包也不会打开。
      if (priorAssistant && !sb.guided) {
        setStageBucket(key, { guided: true });
        sb.guided = true;
      }
      const userTexts = userMessages(messages).map(messageText);
      const policy = computePolicy({
        state, session: sb, tier, availableTools: tools.map(toolNameOf), userTexts, priorAssistant,
      });

      // R29: 工具面只在锚定轮裁剪；锚定之后全量保留，需要什么工具就直接调用。
      if (policy.anchor && Array.isArray(p.tools) && p.tools.length) {
        const allow = new Set(policy.allowed);
        p.tools = p.tools.filter((t) => allow.has(toolNameOf(t)));
        if (p.tools.length === 0) delete p.tools;
      }

      // 平台包累积（在注入前完成，便于本轮附加按需释放提示）
      const packsOpened = policy.nextPacks.length > 0;
      if (packsOpened) {
        const merged = [...(sb.openedPacks || []), ...policy.nextPacks.filter((x) => !sb.openedPacks?.includes(x))];
        setStageBucket(key, { openedPacks: merged });
      }

      // 注入（全部追加标记块，绝不整段替换）
      const system = getSystemText(p);
      let next = system;
      if (policy.inject.persona) next = appendBlock(next, MARKER.persona, policy.inject.persona);
      // R37: anchor-round capability map (idempotent append-only marker block).
      if (policy.inject.capabilityMap) next = appendBlock(next, MARKER.capabilities, policy.inject.capabilityMap);
      if (policy.inject.bootstrap) {
        next = appendBlock(next, MARKER.bootstrap, policy.inject.bootstrap);
        // One-shot: BOOTSTRAP says "appears only once" — consume the flag now
        // that the block has been applied to this request's system prompt.
        setStageBucket(key, { bootstrapPending: false });
        sb.bootstrapPending = false;
      }
      if (policy.inject.stage) next = appendBlock(next, MARKER.stage, policy.inject.stage);
      if (policy.inject.declaration) next = appendBlock(next, MARKER.decl, policy.inject.declaration);
      if (policy.inject.proactivity) next = appendBlock(next, MARKER.proactivity, policy.inject.proactivity);
      if (packsOpened && !policy.anchor && state.postAnchorInjection !== false) {
        next = appendBlock(next, MARKER.pack, TOOL_PACK_HINT);
      }
      if (next !== system) setSystemText(p, next);

      // 锚定轮提示 + 预算
      if (policy.anchor) {
        p.messages = appendToLastUser(p.messages, MARKER.anchor, policy.inject.anchorNotice || "");
      }
      if (policy.budget) {
        const field = p.max_tokens !== undefined ? "max_tokens" : "max_completion_tokens";
        p[field] = Math.floor(policy.budget);
      }

      return p;
    } catch (err) {
      // 非破坏铁律：扩展异常绝不阻断 Hana 管道
      try { ctx?.log?.error?.("hana-minimal-mode: " + (err?.message || err)); } catch {}
      return event.payload;
    }
  });

  pi.on("tool_call", (event, ctx) => {
    try {
      const state = getState();
      const key = sessionKeyOf(event, ctx);
      const agentId = agentIdFromSessionKey(key);
      if (!state.enabled || !agentId || !isAgentInScope(agentId)) return undefined;
      const name = String(event?.toolName || event?.name || "");
      const bare = stripPrefix(name, PREFIX);
      const sb = getStageBucket(key);

      // 完成信号 → 自动晋级（一次一级）
      // native 档 2→3 仍需 delivery_check；bridge/legacy 档首次调用阶段 3
      // 工具即按需晋级并放行（R29：不再有调用面拦截）。
      const next = autoAdvance(sb.stage, [bare], { legacy: sb.tier === TIER.LEGACY || sb.tier === TIER.BRIDGE });
      if (next > sb.stage) {
        setStageBucket(key, { stage: next, guided: true, lastAdvance: { at: Date.now(), reason: "auto:" + bare } });
        sb.stage = next;
        sb.guided = true;
      }

      // R29: 按需自动释放——调用命中未打开的平台包规格时，先打开该包再放行。
      // 其余调用一律放行：锚定后不再有"tool locked until phase"拦截。
      const opened = Array.isArray(sb.openedPacks) ? sb.openedPacks : [];
      const newly = [];
      for (const id of Object.keys(TOOL_PACKS)) {
        if (opened.includes(id)) continue;
        const specs = expandPackTools([id]);
        if (specs.some((spec) => matchesToolSpec(name, spec) || matchesToolSpec(bare, spec))) newly.push(id);
      }
      if (newly.length) {
        const merged = [...opened, ...newly.filter((x) => !opened.includes(x))];
        setStageBucket(key, { openedPacks: merged });
        sb.openedPacks = merged;
      }

      // 网络守卫（可选）
      if (state.networkGuard && (name === "exec_command" || name === "bash" || name === "pwsh")) {
        const cmd = extractCommandFromToolInput(event.input || event.params || event.args);
        if (isNetworkCommand(cmd)) {
          return { block: true, reason: "minimal-mode: network commands blocked by networkGuard setting", details: { toolName: name, command: cmd } };
        }
      }
      if (bare === "phase_begin") {
        setStageBucket(key, { guided: true, bootstrapPending: true, stage: 0 });
      }
      return undefined;
    } catch (err) {
      return undefined;
    }
  });

  pi.on("input", (event, ctx) => {
    try {
      const state = getState();
      if (!state.conversationControl) return undefined;
      const text = String(event?.text || event?.input || "");
      const action = activationActionFor(text);
      if (!action) return undefined;
      const key = sessionKeyOf(event, ctx);
      const agentId = agentIdFromSessionKey(key);
      if (!agentId) return undefined;
      const desired = action === "on" ? agentId : "";
      const enabled = action === "on";
      const p = getPluginCtx();
      const dataDir = typeof p?.dataDir === "string" && p.dataDir ? p.dataDir : "";
      // R33: 目标唯一。持久化 routing.json + registrations.json（dataDir 不可用时
      // 跳过落盘但仍更新内存镜像），并清理被替换助手的阶段状态。
      let nextIds = desired ? [desired] : [];
      if (dataDir) {
        const result = setTarget(dataDir, desired, { source: "toggle" });
        nextIds = result.next;
        for (const id of result.removed) clearAgentStages(id);
      }
      // enabled 走配置存储（尽力而为）；仅改内存镜像会被 _sync 回滚。
      // R34：注册目标只落 routing.json/registrations.json（面板、命令、开关
      // 三个入口共用 target-service），不再回写任何原生设置。
      if (p?.config?.set) {
        try {
          const r1 = p.config.set("enabled", enabled);
          if (r1?.catch) r1.catch(() => {});
        } catch { /* best effort */ }
      }
      // 内存立即生效（界面/后续请求不用等 config 回读）
      setState({ targetAgents: nextIds.join(","), enabled });
      return undefined;
    } catch { return undefined; }
  });
}
