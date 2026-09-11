// Minimal Mode panel API: /state (read), /set (behavior toggles), /register,
// /unregister and /reregister (single-target registration). The sidebar panel
// is the only registration surface; routing.json + registrations.json always
// hold at most one target (target-service.js). Every mutation response carries
// the full state (enabled/routerMode/target/registrations) so the panel never
// has to merge partial payloads. Every handler is best-effort: errors return
// a 500 JSON payload and never throw into the host pipeline.
import path from "node:path";

const MODULE_VERSION = "0.4.7";
const _state = await import(new URL("../state.js?v=" + MODULE_VERSION, import.meta.url).href);
const _router = await import(new URL("../router-core.js?v=" + MODULE_VERSION, import.meta.url).href);
const _catalog = await import(new URL("../agent-catalog.js?v=" + MODULE_VERSION, import.meta.url).href);
const _target = await import(new URL("../target-service.js?v=" + MODULE_VERSION, import.meta.url).href);
const _reg = await import(new URL("../registration-store.js?v=" + MODULE_VERSION, import.meta.url).href);
const { setState, clearAgentStages } = _state;
const { canonicalMode } = _router;
const { mapAgentEntries, scanAgentsDir } = _catalog;
const { getTarget, setTarget, reregisterTarget } = _target;
const { loadRegistrations } = _reg;

function readAgentId(body) {
  return body && typeof body.agentId === "string" ? body.agentId.trim() : "";
}

export default function registerApi(app, ctx) {
  const dataDir = typeof ctx.dataDir === "string" && ctx.dataDir ? ctx.dataDir : process.cwd();
  const agentsDir = path.resolve(dataDir, "../../agents");

  async function listAgents(c) {
    const req = c.get?.("pluginRequestContext") ?? null;
    const bus = req?.bus ?? ctx.bus;
    let mapped = [];
    try {
      // No includePluginPrivate: only user-visible agents are mapped.
      const result = await bus?.request?.("agent:list", {});
      mapped = mapAgentEntries(Array.isArray(result?.agents) ? result.agents : []);
    } catch {
      mapped = [];
    }
    if (mapped.length) return mapped;
    return scanAgentsDir(agentsDir);
  }

  async function fullView() {
    const enabled = (await ctx.config.get("enabled")) ?? true;
    const routerMode = (await ctx.config.get("routerMode")) ?? "auto";
    return {
      enabled,
      routerMode,
      target: getTarget(dataDir),
      registrations: loadRegistrations(dataDir).registrations,
    };
  }

  app.get("/state", async (c) => {
    try {
      const agents = await listAgents(c);
      return c.json({ ok: true, ...(await fullView()), agents });
    } catch (err) {
      return c.json({ ok: false, error: err?.message || String(err) }, 500);
    }
  });

  app.post("/set", async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      const accepted = {};
      if (typeof body.enabled === "boolean") {
        await ctx.config.set("enabled", body.enabled);
        accepted.enabled = body.enabled;
      }
      if (typeof body.routerMode === "string") {
        const mode = canonicalMode(body.routerMode.trim());
        if (mode !== null && body.routerMode.trim() !== "") {
          await ctx.config.set("routerMode", mode);
          accepted.routerMode = mode;
        }
      }
      if (Object.keys(accepted).length) setState(accepted);
      return c.json({ ok: true, ...accepted });
    } catch (err) {
      return c.json({ ok: false, error: err?.message || String(err) }, 500);
    }
  });

  app.post("/register", async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      const agentId = readAgentId(body);
      if (!agentId) return c.json({ ok: false, error: "agentId is required" }, 400);
      const agents = await listAgents(c);
      if (!agents.some((a) => a.id === agentId)) {
        return c.json({ ok: false, error: "unknown agent: " + agentId }, 400);
      }
      // Single target: registering replaces the previous registration.
      const result = setTarget(dataDir, agentId, { source: "panel" });
      for (const id of result.removed) clearAgentStages(id);
      setState({ targetAgents: result.next.join(",") });
      return c.json({ ok: true, ...(await fullView()) });
    } catch (err) {
      return c.json({ ok: false, error: err?.message || String(err) }, 500);
    }
  });

  app.post("/unregister", async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      const agentId = readAgentId(body);
      if (!agentId) return c.json({ ok: false, error: "agentId is required" }, 400);
      if (getTarget(dataDir) === agentId) setTarget(dataDir, "", { source: "panel" });
      const cleared = clearAgentStages(agentId);
      setState({ targetAgents: getTarget(dataDir) });
      return c.json({ ok: true, ...(await fullView()), cleared });
    } catch (err) {
      return c.json({ ok: false, error: err?.message || String(err) }, 500);
    }
  });

  app.post("/reregister", async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      const agentId = readAgentId(body);
      if (!agentId) return c.json({ ok: false, error: "agentId is required" }, 400);
      if (getTarget(dataDir) !== agentId) {
        return c.json({ ok: false, error: "not the registered target: " + agentId }, 400);
      }
      const result = reregisterTarget(dataDir, "panel");
      if (!result.ok) return c.json({ ok: false, error: "no registered target" }, 400);
      return c.json({ ok: true, ...(await fullView()) });
    } catch (err) {
      return c.json({ ok: false, error: err?.message || String(err) }, 500);
    }
  });
}
