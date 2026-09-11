import fs from "node:fs";
import path from "node:path";

const MODULE_VERSION = "0.5.0";
const _state = await import(new URL("./state.js?v=" + MODULE_VERSION, import.meta.url).href);
const _catalog = await import(new URL("./agent-catalog.js?v=" + MODULE_VERSION, import.meta.url).href);
const _routing = await import(new URL("./routing-store.js?v=" + MODULE_VERSION, import.meta.url).href);
const _target = await import(new URL("./target-service.js?v=" + MODULE_VERSION, import.meta.url).href);
const _legacy = await import(new URL("./config-legacy.js?v=" + MODULE_VERSION, import.meta.url).href);
const { stripLegacyConfigKeys, removeStaleDataFiles } = _legacy;
const { initStore, setState, defaultConfig, setPluginCtx, targetAgentIds, clearAgentStages, pruneStagesExcept, pruneMissingSessions } = _state;
const { pruneDeletedTargets, mapAgentEntries, scanAgentsDir } = _catalog;
const { migrateRouting, loadRouting, saveRouting } = _routing;
const { setTarget, collapseToSingle, getTarget } = _target;

export function migrateConfig(raw) {
  const out = { ...raw };
  if (out.minimalAgentId !== undefined && out.targetAgents === undefined) {
    out.targetAgents = out.minimalAgentId;
  }
  delete out.minimalAgentId;
  delete out.allowlist; // 新机制无 allowlist（阶段窗口取代）
  return out;
}

export async function readConfig(configStore) {
  const get = async (key, fallback) => {
    try {
      const value = await configStore?.get?.(key);
      return value === undefined ? fallback : value;
    } catch {
      return fallback;
    }
  };
  const d = defaultConfig();
  return {
    enabled: await get("enabled", d.enabled),
    routerMode: await get("routerMode", d.routerMode),
    stagedUnlock: await get("stagedUnlock", d.stagedUnlock),
    zeroToolAnchor: await get("zeroToolAnchor", d.zeroToolAnchor),
    bootstrapMaxTokens: await get("bootstrapMaxTokens", d.bootstrapMaxTokens),
    dynamicPacks: await get("dynamicPacks", d.dynamicPacks),
    postAnchorInjection: await get("postAnchorInjection", d.postAnchorInjection),
    networkGuard: await get("networkGuard", d.networkGuard),
    conversationControl: await get("conversationControl", d.conversationControl),
  };
}

export default class HanaMinimalModePlugin {
  async onload() {
    const ctx = this.ctx;
    this._ctx = ctx;
    initStore(ctx.dataDir);
    setPluginCtx(ctx);
    const register = (d) => { if (typeof this.register === "function") this.register(d); };
    this._sync = async () => {
      try {
        const raw = (await ctx.config.getAll?.({ redacted: true })) ?? {};
        const migrated = migrateConfig(raw);
        // Explicit undefined values must never clobber canonical defaults with
        // undefined (silent zero intervention); only defined keys are mirrored.
        const migratedDefined = Object.fromEntries(Object.entries(migrated).filter(([, v]) => v !== undefined));
        setState(await readConfig(ctx.config));
        setState(migratedDefined);
        // 目标助手列表持久化在 routing.json：原生设置表单已不含助手项，
        // migrateConfig 仍负责把旧 minimalAgentId 映射进来，作为一次性迁移
        // 输入（传入 migrateRouting）。R34 起注册/取消注册由侧边栏面板 API
        // 管理，_sync 不再读写任何目标相关的原生配置。
        const dataDir = typeof ctx.dataDir === "string" && ctx.dataDir ? ctx.dataDir : process.cwd();
        const agentsDir = path.resolve(dataDir, "../../agents");
        const routingExists = fs.existsSync(path.join(dataDir, "routing.json"));
        const routing = migrateRouting({ configValue: migrated.targetAgents, routingExists, agentsDir });
        if (routing.migrated) {
          saveRouting(dataDir, routing.ids);
          setState({ targetAgents: routing.ids.join(",") });
        } else {
          setState({ targetAgents: loadRouting(dataDir).targetAgents.join(",") });
        }

        // 存活助手列表：collapse 平局判定共用。
        let liveIds = [];
        try {
          const result = await ctx.bus?.request?.("agent:list", {});
          liveIds = mapAgentEntries(Array.isArray(result?.agents) ? result.agents : []).map((a) => a.id);
        } catch {
          /* fall through to the fs scan */
        }
        if (!liveIds.length) liveIds = scanAgentsDir(agentsDir).map((a) => a.id);

        // R33: 单选收敛。历史双注册按 registeredAt 最新者保留（同刻偏好存活
        // 助手），其余从 registrations.json + routing.json 移除并清理阶段状态。
        try {
          const collapsed = collapseToSingle(dataDir, { liveIds });
          if (collapsed.removed.length) {
            for (const id of collapsed.removed) clearAgentStages(id);
          }
          setState({ targetAgents: collapsed.kept || "" });
        } catch {
          /* best effort */
        }

        // 已删除目标：通过 target-service 清空注册 + 阶段状态（不回写原生设置）。
        try {
          const { removed } = pruneDeletedTargets(targetAgentIds(), agentsDir);
          if (removed.length) {
            setTarget(dataDir, "", { source: "prune" });
            for (const id of removed) clearAgentStages(id);
            setState({ targetAgents: "" });
          }
        } catch {
          /* best effort */
        }

        // R39: 目标解析完成后清扫其他助手的阶段残留（旧版本可能独立留下），
        // 每次同步都执行，切换/取消注册后不留任何可被内置助手读到的痕迹。
        try {
          pruneStagesExcept(getTarget(dataDir));
        } catch {
          /* best effort */
        }

        // R40: 已删除会话的阶段/别名残留——仅清理指向不存在文件的绝对
        // `agents/<id>/` 路径；相对键与无法检查的键一律保留。
        try {
          pruneMissingSessions();
        } catch {
          /* best effort */
        }
      } catch (err) {
        ctx.log?.warn?.("hana-minimal-mode: config sync failed: " + (err?.message || err));
      }
    };
    await this._sync();
    // R38: cleanup runs AFTER _sync — the one-shot legacy target migration
    // (migrateRouting) must read config.global.targetAgents/minimalAgentId
    // before they are stripped, or a direct upgrade loses the user's target.
    // One-time, per instance, best-effort; the host config store reads from
    // disk per call, so no cache to invalidate.
    if (!this._legacyCleaned) {
      this._legacyCleaned = true;
      try {
        const dataDir = typeof ctx.dataDir === "string" && ctx.dataDir ? ctx.dataDir : "";
        const removed = dataDir ? stripLegacyConfigKeys(dataDir) : [];
        if (removed.length) ctx.log?.info?.("hana-minimal-mode: stripped legacy config keys: " + removed.join(", "));
        // R39: R33-era settings-mirror.json contradicts the panel-managed
        // target and is deleted once on load (best-effort, may be absent).
        const removedFiles = dataDir ? removeStaleDataFiles(dataDir) : [];
        if (removedFiles.length) ctx.log?.info?.("hana-minimal-mode: removed stale data files: " + removedFiles.join(", "));
      } catch {
        /* best effort */
      }
    }
    // 实时生效：plugin_config_changed + 60s 轮询兜底（旧版无事件或事件丢失）
    const unsub = ctx.bus?.subscribe?.((event) => {
      if (event?.type === "plugin_config_changed" && event?.pluginId === ctx.pluginId) void this._sync();
    });
    if (typeof unsub === "function") register(unsub);
    const timer = setInterval(() => void this._sync(), 60_000);
    if (typeof timer?.unref === "function") timer.unref();
    register(() => clearInterval(timer));
    ctx.log?.info?.("hana-minimal-mode v0.5.0 loaded (router-standard progressive disclosure, sidebar-panel single-target)");
  }

  async onunload() {
    this._ctx?.log?.info?.("hana-minimal-mode unloaded");
  }
}
