/**
 * stage-engine: progressive tool-unlock state machine for Hana plugins.
 *
 * Ported from dsh-routing-suite preset/router-standard/router-bootstrap.mjs
 * (v1.20.0, MIT License). Pure logic only — no host wiring, no persistence.
 * The STAGES tool table is the Hana mapping of the dsh v1.20 stage table
 * (read/ls/grep/find/web_search/web_fetch/current_status + memory recall →
 * todo_write → write/edit + memory write → exec_command/write_stdin/subagent).
 *
 * v1.20 semantics kept 1:1:
 *   - zero pre-unlock: windowFor(stage) = min(stage + 1, STAGES.length)
 *   - completion signals auto-advance (one level per step, never by tool name)
 *   - we-form stage declaration + Task echo + stage guide + advance hint
 *   - stage 3 releases the full catalog ("full catalog open")
 *   - user memory opt-out (memoryMuted) scrubs memory-tool mentions
 */

export const STAGES = [
  { name: "了解/对齐", tools: ["read", "ls", "grep", "find", "web_search", "web_fetch", "current_status", "todo_write", "search_memory", "recall_experience"], completion: ["todo_write"] },
  { name: "拟合方案", tools: ["todo_write", "search_memory", "recall_experience"], completion: ["todo_write"] },
  { name: "开发", tools: ["write", "edit", "record_experience", "pin_memory"], completion: ["delivery_check"] },
  { name: "验证", tools: ["exec_command", "write_stdin", "subagent"], completion: [] },
];

/** Stage-table tool universe (single source of truth, derived from STAGES).
 *  De-duplicated: Hana memory tools appear in both stage 0 and stage 1. */
export const STAGE_SAFE = [...new Set(STAGES.flatMap((s) => s.tools))];

export const META_TOOLS = [
  "phase_begin", "phase_advance", "tools_catalog", "tools_help",
  "router_status", "delivery_check", "request_tools", "persona_reconcile",
];

const MEMORY_TOOLS = ["search_memory", "recall_experience", "record_experience", "pin_memory"];

/** Window (single source of truth): end index of the visible STAGES slice.
 *  v1.20 zero pre-unlock — a stage sees only its own tools (no next-tier
 *  names in view, removing the "there is more later" haste attractor). */
export function windowFor(stage) {
  return Math.min(stage + 1, STAGES.length);
}

function clampStage(stage) {
  const n = Number(stage);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(Math.floor(n), STAGES.length - 1));
}

/** Set of stage-window tools callable at `stage` (meta tools excluded). */
export function stageToolSet(stage) {
  return new Set(STAGES.slice(0, windowFor(clampStage(stage))).flatMap((s) => s.tools));
}

/** Pre-unlocked tools — v1.20 zero pre-unlock keeps this permanently empty.
 *  Kept as an API so a future relaxation only touches windowFor. */
export function preUnlockedFor(_stage) {
  return [];
}

/** Tool ownership: stage (in the phase table) / meta (always resident) /
 *  host (host-registered, outside the phase table). */
export function stageInfo(name) {
  const idx = STAGES.findIndex((s) => s.tools.includes(name));
  if (idx >= 0) return { kind: "stage", stage: idx };
  if (META_TOOLS.includes(name)) return { kind: "meta" };
  return { kind: "host" };
}

/** Catalog row marker: 全量 (stage 3) / meta / 可调 / 未解锁.
 *  Pack ids already opened are callable even though they are host tools. */
export function markerFor(name, stage, openedPacks = []) {
  if (stage >= STAGES.length - 1) return "全量";
  if (META_TOOLS.includes(name)) return "meta";
  const packs = Array.isArray(openedPacks) ? openedPacks : [];
  if (packs.includes(name)) return "可调";
  const idx = STAGES.findIndex((s) => s.tools.includes(name));
  if (idx >= 0 && idx < windowFor(clampStage(stage))) return "可调";
  return "未解锁";
}

/** Completion-signal driven advance (v1.19/v1.20): completing the current
 *  stage is what opens the next one — tool names never skip a level.
 *  0→1 todo_write; 1→2 todo_write; 2→3 delivery_check, or (legacy channel)
 *  the first attempt at a stage-3 tool unlocks it on demand. */
export function autoAdvance(stage, toolNames, opts = {}) {
  const current = clampStage(stage);
  if (current >= STAGES.length - 1) return current;
  const legacy = opts?.legacy === true;
  const names = new Set(
    (Array.isArray(toolNames) ? toolNames : [])
      .map((t) => (typeof t === "string" ? t : t?.name))
      .filter(Boolean),
  );
  if (current === 0 && names.has("todo_write")) return 1;
  if (current === 1 && names.has("todo_write")) return 2;
  if (current === 2 && (names.has("delivery_check") || (legacy && (names.has("exec_command") || names.has("write_stdin") || names.has("subagent"))))) return 3;
  return current;
}

/** Phase summary: name + stage + callable stage/meta tools + open packs. */
export function stageSummary(stage, openedPacks = []) {
  const s = clampStage(stage);
  const unlockedEnd = windowFor(s);
  const unlocked = STAGES.slice(0, unlockedEnd).flatMap((st) => st.tools).concat(META_TOOLS);
  return {
    name: STAGES[s].name,
    stage: s,
    unlocked,
    packsOpen: Array.isArray(openedPacks) ? [...openedPacks] : [],
  };
}

function muteAwareList(names, muted) {
  return muted ? names.filter((n) => !MEMORY_TOOLS.includes(n)) : names;
}

/** Scrub memory-tool mentions from guide text when the user opted out. */
function muteMemoryText(text) {
  return String(text)
    .replace(/\s*\+\s*memory recall \(search_memory\/recall_experience\)/g, " (memory disabled by user)")
    .replace(/\s*\+\s*memory review \(search_memory\/recall_experience\)/g, " (memory disabled by user)")
    .replace(/\s*\+\s*memory write \(record_experience\/pin_memory\)/g, " (memory disabled by user)")
    .replace(/\(record_experience\)/g, "(memory disabled by user)")
    .replace(/search_memory|recall_experience|record_experience|pin_memory/g, "memory");
}

/** Stage declaration (we-form — you-form is the "let me" attractor).
 *  Orthogonal single truth: Core = callable stage window + meta tools;
 *  stage 3 = full catalog open. muted strips memory-tool mentions. */
export function stageText(stage, openedPacks, taskText, muted = false) {
  const s = stageSummary(stage, openedPacks);
  const callable = muteAwareList(s.unlocked, muted);
  const taskLine = taskText ? "\nTask: " + taskText : "";
  let guide = STAGE_GUIDES[s.stage] || "";
  if (muted) guide = muteMemoryText(guide);
  if (s.stage >= STAGES.length - 1) {
    return "Current phase: " + s.name + " (" + s.stage + "/3). Delivery: restrict released — full catalog open: " + callable.join(", ")
      + taskLine
      + "\nDelivery evidence gate: provide an evidence manifest (kind by artifact). Visual/3D tasks: capture views and review them visually; no fixed view count."
      + "\nStage guide: " + guide
      + "\nUntil delivery_check passes, do NOT declare the task delivered. Delivery is the gate, not a progress label.";
  }
  const preSet = new Set(preUnlockedFor(s.stage));
  const core = callable.filter((n) => !preSet.has(n));
  const pre = muteAwareList(callable.filter((n) => preSet.has(n)), muted);
  return "Current phase: " + s.name + " (" + s.stage + "/3). Core: " + core.join(", ")
    + taskLine
    + (pre.length ? "\nPre-unlocked (already callable): " + pre.join(", ") : "")
    + "\nAll tools stay callable on demand — platform packs auto-open when you call one of their tools; browse availability via tools_catalog(query) (single-point whitebox)."
    + "\nStage guide: " + guide
    + "\nPhase is self-routed state: advancing requires the phase completion signal (todo_write/delivery_check) or phase_advance; tool usage alone never skips a stage.";
}

/** User memory opt-out (v1.15): once any user text asks for no memory, stage
 *  guidance stops mentioning recall/verify/store tools entirely. */
export function memoryMuted(texts) {
  const re = /(不用记忆|勿用记忆|禁用记忆|不要用记忆|no memory|without memory)/i;
  if (!Array.isArray(texts)) return false;
  for (const t of texts) {
    if (typeof t === "string" && re.test(t)) return true;
  }
  return false;
}

/** Task echo (v1.19.1): first real user message, truncated at 160 chars,
 *  so the model always sees what it is working on. */
export function firstUserTask(texts) {
  if (!Array.isArray(texts)) return "";
  for (const t of texts) {
    const txt = typeof t === "string" ? t.trim() : "";
    if (txt) return txt.length > 160 ? txt.slice(0, 160) + "…" : txt;
  }
  return "";
}

/** Declaration block (ported PROGRESSIVE_DECL; dsh tool names → Hana names). */
export const PROGRESSIVE_DECL =
  "We hold a full tool registry: tools are all callable on demand — a call releases what it needs; the phase marks in tools_catalog are guidance, not gates. tools_catalog lists tools with name + phase mark and pack availability; a query is a single-point whitebox. tools_help <name> returns that tool's phase mark and current callable status; parameters follow each tool's own invocation contract. We query on demand and call precisely. "
  + "Meta tools (phase_begin/phase_advance, tools_catalog/tools_help, router_status, request_tools, delivery_check, persona_reconcile) are optional helpers. On Hana 0.449+ they are native tools; on older hosts they are deferred and reachable via mcp_call with the full name, e.g. {\"server\":\"hana-minimal-mode\",\"tool\":\"hana-minimal-mode_router_status\",\"arguments\":{}}. Phase state advances automatically from completion signals and platform packs auto-open when you call their tools — use them only when useful. "
  + "Long-running goals carry todo_write: read the plan before updating, and mark items complete only when actually achieved. "
  + "Tool signatures are NOT uniform: before the first use of any tool this session, read its parameter names via tools_catalog or tools_help — never guess. Runtime caps (read lines, search count, output bytes) are enforced at call time — check tools_help before big calls. "
  + "Tools are directly callable (native mode — no wrapping): call write/edit/read/exec_command directly; the full tool surface stays available and platform packs auto-release on demand. Zero-arg tools still take {}: tools['router_status']({}). "
  + "write/edit bindings return the FULL before/after text — take only path/operation, never print a whole write/edit result (context explosion); inspect the changed lines with grep/read instead. Verify your own work: use exec_command to run a headless browser / playwright (or install one) and screenshot/render the page, then view the shot to visually confirm — do not rely on a fixed page-verify tool. "
  + "Proactivity protocol: act on reversible next steps; ask only for user-owned choices; report actions with evidence.";

/** Proactivity block (ported PRESSURE_GUIDE, 1:1 — no tool names). */
export const PRESSURE_GUIDE =
  "\n\nProactivity (replaces the pressure valve): every turn, before awaiting the user, scan for the next actionable item — unfinished work, unverified claims, reversible improvements, unfixed warnings. Choose one and act; report what you did and why. Ask only when the choice belongs to the user (preference, budget, irreversible/destructive, external approval). Two or more dependent steps: think step by step, but do not stop to ask permission for reversible work. Depth is our call: a small result gets a small thought, a consequential fork gets full reasoning.";

/** Bootstrap block (ported START_GUIDE; dsh tool names → Hana names). */
export const BOOTSTRAP =
  "\n\nBootstrap (once per session): this is a progressive tool-unlock session — tools open in phases like a leveling game. When native plugin tools are exposed, call phase_begin to confirm start; on older hosts the meta tools are deferred and reachable via mcp_call with the full name, e.g. {\"server\":\"hana-minimal-mode\",\"tool\":\"hana-minimal-mode_router_status\",\"arguments\":{}} — or simply let the session auto-start at phase 0. "
  + "Unlock order: understanding (read/ls/grep/find/web_search/web_fetch/current_status) → planning (todo_write) → development (write/edit) → verification (exec_command/write_stdin/subagent). "
  + "This guide appears only once; after this, no phase messages are injected. "
  + "Current phase + unlocked tools are always visible in the system prompt (router-stage section) and via router_status. "
  + "You route yourself: to advance, complete the current phase — alignment (assumptions stated or question asked / plan recorded) → planning (plan locked) → development (self-check) → verification (delivery_check) — or call phase_advance; tool usage alone never skips a stage.";

/** Per-stage guides (ported STAGE_GUIDES; dsh tool names → Hana names).
 *  These live in stageText, so they survive compaction — the "to unlock X,
 *  first do Y" hint is always in view. */
export const STAGE_GUIDES = [
  "Phase: understanding. Unlocked: this stage only — read/ls/grep/find/web_search/web_fetch/current_status + memory recall (search_memory/recall_experience). Ground first: recall → read/ask. Do this stage properly and think broadly — do not settle on the first obvious reading. Break the request into its dimensions (what the user wants, how features should behave, what \"good\" looks like) and surface the genuinely ambiguous ones: a word like \"拖拽\" could mean reorder, drag-to-recategory, or both; \"瀑布流\" could mean masonry columns or JS-grid; persistence is often unspecified. **Decide each ambiguity by its impact:** if you can infer the common meaning and only one interpretation is reasonable for a deliverable, state that assumption clearly in one sentence (so the user can correct it) and continue — but if two or more interpretations would materially change the result (reorder vs recategory; persist vs not), ask the user ONE focused question per such ambiguity, with concrete options. Do not under-ask (assume everything) nor over-ask (interrogate trivia) — aim for the questions that actually change the artifact. This is a deep-thinking stage: if the task is complex, also record a plan (todo_write). **Complete when: you understand the task (assumptions stated, or key ambiguities answered) — and, if complex, a plan is recorded. No alignment, no advancement.** → Done? Understood (stated assumption / question answered / plan recorded) → next stage.",
  "Phase: planning. Unlocked: todo_write + memory review (search_memory/recall_experience). Do this stage properly: design the approach, cover edge cases, define what \"done\" means, and decide acceptance criteria — not just list steps. **Attention reclamation: assetize your context — keep the task goal + the current decision + the live evidence in the attention window; sink settled exploration/details into memory (record_experience) instead of holding them all; let stale, superseded, or resolved threads truly drop (fresh context recovers attention). Do not hold \"everything might be useful\" in mind — that is attention leakage, not diligence.** **Isolation & parallel (pillar 4): when two independent concerns are polluting one thread, or a sub-problem is eating the mainline budget, push it into a subagent / workflow (independent context) instead of keeping it in the same stream — a focused subagent holds its own attention so your mainline stays on the critical path.** **Complete when: the plan is thorough enough that the design is decision-complete (what to build, how it fits, what success looks like), recorded via todo_write.** Only this lets you enter development. Note: a completion signal (todo_write) AUTO-advances to the next phase — do NOT call phase_advance after it, or you will skip a phase. → Done? Plan is decision-complete and locked (todo_write) → develop (auto).",
  "Phase: development. Unlocked: write/edit + memory write (record_experience/pin_memory). Re-read before re-edit (editor enforces fresh read); write/edit results carry FULL before/after text — take path/operation, inspect with grep/read. Do this stage properly: make the artifact real, self-check it against the plan and the acceptance criteria, and do not declare it done until it actually passes its own check. **Avoid local-optima: keep the WHOLE artifact working while you iterate. If you find yourself re-fighting the same detail for several rounds with no convergence (e.g. a finite-difference sign, a conservation drift), step back: (1) is this detail blocking the overall deliverable, or is it polish? (2) preserve a working version; iterate on the detail in parallel, not by stalling the whole. (3) if a detail resists, finish the rest and re-attack it fresh — do not let one stubborn sub-problem stall the deliverable.** **Complete when: the artifact exists and passes its self-check — then enter verification via delivery_check (completion signal) or phase_advance.** → Done? Self-check passes → delivery_check → verification.",
  "Phase: verification → delivery gate. Unlocked: exec_command/write_stdin/subagent + delivery_check. exec_command runs the host shell (PowerShell/Git Bash on Windows); a one-shot sandbox escalation may be required (if denied, report it — never bypass). Page verify with your OWN tools: run a headless browser/playwright via exec_command (or install one), screenshot and visually inspect each shot (reviewed:true) to confirm. **On verification failure, hold a quick hypothesis-audit (guidance, not a hard block): before touching the implementation, name in one line (a) which assumption you are now re-checking, (b) what NEW evidence you just gained — this turns \"doubt the hypothesis\" from a prompt into a habit. If the code is actually correct, say so and move on (do not manufacture a bug to justify rework).** Then check gates/evidence. Do this stage properly: verify the real artifact, not a summary of it — check evidence, look for defects, review the visuals honestly. **Gate: delivery_check must PASS — evidence manifest required; missing evidence/unreviewed visuals = FAIL.**",
];
