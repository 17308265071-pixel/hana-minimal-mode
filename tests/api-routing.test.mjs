// Route-level tests for the panel API (R34): /state reads the behavior config,
// the single target and the live agent list; /set keeps the canonicalMode
// validation; /register replaces the single target and clears the replaced
// agent's stages; /unregister clears the target files and the agent's stages.
// The sidebar panel is the only registration surface and the API never writes
// a target key into the native config.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import manifest from "../manifest.json" with { type: "json" };
import { fileURLToPath, pathToFileURL } from "node:url";

const pluginRoot = fileURLToPath(new URL("..", import.meta.url));
const state = await import(`../state.js?v=${manifest.version}`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hmm-api-routing-"));
const dataDir = path.join(tmp, "plugins", "hana-minimal-mode");
const agentsDir = path.join(tmp, "agents");

const HANAKO_STAGE = "C:/x/agents/hanako/sessions/s1.jsonl";
const BUTLER_STAGE = "C:/x/agents/butler/sessions/s1.jsonl";
const QIUSHI_STAGE = "C:/x/agents/qiushi/sessions/s1.jsonl";

for (const id of ["hanako", "butler", "qiushi"]) {
  fs.mkdirSync(path.join(agentsDir, id), { recursive: true });
}
fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(path.join(dataDir, "stage-state.json"), JSON.stringify({
  schemaVersion: 1,
  buckets: {
    [HANAKO_STAGE]: { aliases: [HANAKO_STAGE], state: {} },
    [BUTLER_STAGE]: { aliases: [BUTLER_STAGE], state: {} },
    [QIUSHI_STAGE]: { aliases: [QIUSHI_STAGE], state: {} },
  },
  stages: {
    [HANAKO_STAGE]: { stage: 2, guided: true },
    [BUTLER_STAGE]: { stage: 1 },
    [QIUSHI_STAGE]: { stage: 3 },
  },
}, null, 2) + "\n");
// The stage store binds on the first clearAgentStages() call and then reads the
// file above; every stage key used in this file is seeded before any handler
// runs, so ordering between tests cannot lose seeded entries.
state.initStore(dataDir);

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readRouting() {
  return readJson(path.join(dataDir, "routing.json")).targetAgents;
}

function readRegistrations() {
  return readJson(path.join(dataDir, "registrations.json")).registrations;
}

function readStages() {
  return readJson(path.join(dataDir, "stage-state.json"));
}

function clearTargetFiles() {
  for (const name of ["routing.json", "registrations.json"]) {
    try {
      fs.rmSync(path.join(dataDir, name));
    } catch {
      /* already absent */
    }
  }
}

function writeTargetFiles(routing, registrations) {
  fs.writeFileSync(
    path.join(dataDir, "routing.json"),
    JSON.stringify({ schemaVersion: 1, targetAgents: routing }, null, 2) + "\n",
  );
  fs.writeFileSync(
    path.join(dataDir, "registrations.json"),
    JSON.stringify({ schemaVersion: 1, registrations }, null, 2) + "\n",
  );
}

async function loadApi(store = {}) {
  const href = pathToFileURL(path.join(pluginRoot, "routes", "api.js")).href + "?t=" + Date.now();
  const mod = await import(href);
  const handlers = {};
  const app = {
    get: (route, fn) => { handlers["GET " + route] = fn; },
    post: (route, fn) => { handlers["POST " + route] = fn; },
  };
  mod.default(app, {
    dataDir,
    config: {
      get: async (k) => store[k],
      set: async (k, v) => { store[k] = v; },
      getAll: async () => ({ ...store }),
    },
    bus: { request: async () => ({ agents: [] }) },
    log: { info() {}, warn() {}, error() {} },
  });
  const c = (body) => ({
    get: () => null,
    req: { json: async () => body },
    json: (b, status) => ({ body: b, status: status ?? 200 }),
  });
  return { handlers, c, store };
}

test("GET /state reports config + single target + live agents; /set persists toggles and validates the mode", async () => {
  clearTargetFiles();
  const store = {};
  const { handlers, c } = await loadApi(store);

  const initial = await handlers["GET /state"](c());
  assert.equal(initial.status, 200);
  assert.equal(initial.body.ok, true);
  assert.equal(initial.body.enabled, true);
  assert.equal(initial.body.routerMode, "auto");
  assert.equal(initial.body.target, "");
  assert.deepEqual(initial.body.registrations, {});
  assert.deepEqual(
    initial.body.agents.map((a) => a.id).sort(),
    ["butler", "hanako", "qiushi"],
    "no bus agents: the fs scan must list the live agents dir",
  );

  const set = await handlers["POST /set"](c({ enabled: false, routerMode: "balanced" }));
  assert.equal(set.body.ok, true);
  assert.equal(set.body.enabled, false);
  assert.equal(set.body.routerMode, "mixed", "canonicalMode must canonicalize the saved mode");
  assert.equal(store.enabled, false);
  assert.equal(store.routerMode, "mixed");
  assert.equal(store.targetAgent, undefined, "no target key may ever be written to the native config");
  assert.equal(store.targetAgents, undefined, "no target list may ever be written to the native config");

  const invalid = await handlers["POST /set"](c({ routerMode: "nope", enabled: "yes", targetAgents: "ghost" }));
  assert.equal(invalid.body.ok, true);
  assert.equal(invalid.body.routerMode, undefined, "invalid modes must be ignored");
  assert.equal(store.routerMode, "mixed", "an invalid mode must not overwrite the stored value");
});

test("POST /register validates the agent and stores the single target", async () => {
  clearTargetFiles();
  const store = {};
  const { handlers, c } = await loadApi(store);

  const unknown = await handlers["POST /register"](c({ agentId: "ghost" }));
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.ok, false);
  assert.equal(fs.existsSync(path.join(dataDir, "registrations.json")), false, "unknown agents must not be persisted");
  assert.equal(fs.existsSync(path.join(dataDir, "routing.json")), false, "unknown agents must not touch routing.json");

  const missing = await handlers["POST /register"](c({}));
  assert.equal(missing.status, 400);

  const res = await handlers["POST /register"](c({ agentId: "hanako" }));
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.target, "hanako");
  assert.equal(res.body.enabled, true, "mutation responses must carry enabled");
  assert.equal(res.body.routerMode, "auto", "mutation responses must carry routerMode");
  assert.equal(res.body.registrations.hanako.source, "panel");
  assert.equal(typeof res.body.registrations.hanako.registeredAt, "number");
  assert.deepEqual(readRouting(), ["hanako"]);
  assert.deepEqual(Object.keys(readRegistrations()), ["hanako"]);
  assert.equal(state.getState().targetAgents, "hanako");
  assert.equal(store.targetAgent, undefined, "registration never writes the native config");

  const stateRes = await handlers["GET /state"](c());
  assert.equal(stateRes.body.target, "hanako");
  assert.equal(stateRes.body.registrations.hanako.source, "panel");
});

test("POST /register replaces the previous target and clears the replaced agent's stages", async () => {
  writeTargetFiles(["hanako"], { hanako: { registeredAt: 1, source: "panel" } });
  const { handlers, c } = await loadApi({});

  const first = await handlers["POST /register"](c({ agentId: "butler" }));
  assert.equal(first.body.target, "butler");
  assert.deepEqual(readRouting(), ["butler"]);
  assert.deepEqual(Object.keys(readRegistrations()), ["butler"]);

  const second = await handlers["POST /register"](c({ agentId: "qiushi" }));
  assert.equal(second.body.target, "qiushi");
  assert.deepEqual(readRouting(), ["qiushi"]);
  assert.deepEqual(Object.keys(readRegistrations()), ["qiushi"]);
  assert.equal(state.getState().targetAgents, "qiushi");

  const persisted = readStages();
  assert.deepEqual(
    Object.keys(persisted.stages),
    [QIUSHI_STAGE],
    "replaced agents' stage state must be cleared, the new target's kept",
  );
  assert.deepEqual(Object.keys(persisted.buckets), [QIUSHI_STAGE], "replaced agents' alias buckets are cleared too");
});

test("POST /unregister clears the target files and the registered agent's stages", async () => {
  const { handlers, c } = await loadApi({});
  assert.equal(state.getState().targetAgents, "qiushi", "previous test left qiushi registered");

  const res = await handlers["POST /unregister"](c({ agentId: "qiushi" }));
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.target, "");
  assert.equal(res.body.enabled, true, "mutation responses must carry enabled");
  assert.equal(res.body.routerMode, "auto", "mutation responses must carry routerMode");
  assert.deepEqual(res.body.registrations, {});
  assert.ok(res.body.cleared >= 2, "the agent's stage + alias bucket must be cleared");
  assert.deepEqual(readRouting(), []);
  assert.deepEqual(readRegistrations(), {});
  assert.equal(state.getState().targetAgents, "");

  const persisted = readStages();
  assert.deepEqual(Object.keys(persisted.stages), [], "unregistered agent's stages are gone");
  assert.deepEqual(Object.keys(persisted.buckets), [], "unregistered agent's buckets are gone");
});

test("POST /unregister of a non-target agent only clears its stages and requires an id", async () => {
  const { handlers, c } = await loadApi({});

  const missing = await handlers["POST /unregister"](c({}));
  assert.equal(missing.status, 400);
  assert.equal(missing.body.ok, false);

  const res = await handlers["POST /unregister"](c({ agentId: "butler" }));
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.deepEqual(readRouting(), [], "a non-target unregister must not create target files");
  assert.deepEqual(readRegistrations(), {});
});

test("POST /reregister refreshes the target's registeredAt and rejects non-targets", async () => {
  writeTargetFiles(["hanako"], { hanako: { registeredAt: 1, source: "panel" } });
  const { handlers, c } = await loadApi({});

  const missing = await handlers["POST /reregister"](c({}));
  assert.equal(missing.status, 400);
  assert.equal(missing.body.ok, false);

  const nonTarget = await handlers["POST /reregister"](c({ agentId: "butler" }));
  assert.equal(nonTarget.status, 400);
  assert.equal(nonTarget.body.ok, false);
  assert.equal(readRegistrations().hanako.registeredAt, 1, "a refused reregister must not touch the record");

  await delay(5);
  const res = await handlers["POST /reregister"](c({ agentId: "hanako" }));
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.target, "hanako");
  assert.equal(res.body.enabled, true, "mutation responses must carry enabled");
  assert.equal(res.body.routerMode, "auto", "mutation responses must carry routerMode");
  assert.equal(res.body.registrations.hanako.source, "panel");
  assert.ok(res.body.registrations.hanako.registeredAt > 1, "registeredAt must strictly increase");
  assert.equal(readRegistrations().hanako.registeredAt, res.body.registrations.hanako.registeredAt);
  assert.deepEqual(readRouting(), ["hanako"], "reregister must not touch the routing list");
});
