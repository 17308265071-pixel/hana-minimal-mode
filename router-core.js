/**
 * router-core: task-aware reasoning-mode routing logic for Hana plugins.
 *
 * Ported from dsh-routing-suite preset/router-standard/router-core-v34.mjs
 * (MIT License) — the dsh-router-standard preset. The TOOL_PACKS catalog is
 * ported from the previous Hana plugin version (hana-minimal-mode v0.3.6).
 *
 * BEHAVIORAL REALITY (measured, 21-point × n=2 on v4-pro): model behavior
 * along the react↔spec axis collapses into THREE stable regions, not a
 * continuum — spec [0, 0.15], a transition band [0.2, 0.45] (unstable mix,
 * avoid), and react [0.5, 1.0] (11 mode values behave identically). The
 * numeric interface therefore maps onto three behavior bands; "continuous"
 * tuning is an illusion at the model layer.
 *
 * FOURTH MODE — weak (internal routing): P8/P11 show a weak-persona domain
 * where the model routes itself from the task (discrimination up to +5.0).
 * The optimal weak persona is model-specific (P11, n=3):
 *   - pro:   spec sentence + few-shot routing instruction (w6, +5.00)
 *   - flash: neutral + explicit "classify then act" instruction (w7, +5.67)
 *   - spec-sentence weak personas ANTI-route on flash (planGreen > 0).
 *
 *   mode 0    → pure spec  — plan-first, collective, read-first tools
 *   mode 0.3  → mixed      — transition band (trap; only explicit opt-in)
 *   mode 1    → pure react — doer, produce-verify-fix, test-suppressed
 *   mode W    → weak       — internal routing (model decides per task)
 *
 * `mode` is stored as a number in [0, 1] or the string 'weak'; band mapping
 * quantizes to the four modes.
 */

export const MODE_SPEC = 0;
export const MODE_MIXED = 0.3;
export const MODE_REACT = 1;
export const MODE_WEAK = "weak";
export const MODE_AUTO = "auto";

export const RL_PERSONA = "You are a helpful software engineer assistant.";

const SPEC_PERSONA = "You are a helpful software engineer assistant.";

const MIXED_PERSONA =
  "You are a helpful software engineer assistant.\n"
  + "Work directly: prefer writing or editing code over describing plans. "
  + "Verify your changes by reading and running them.";

const REACT_PERSONA =
  "You are a hands-on software engineer who delivers working output fast.\n"
  + "Work directly: write or edit code, then verify it by reading and running. "
  + "Keep the loop tight — produce, verify, fix — and do not build test "
  + "harnesses, scaffolding, or ceremony the user did not ask for. "
  + "Finish with a usable deliverable and a short summary.";

/** Weak (internal-routing) personas — model-specific optimum (P11/P24).
 *  pro:   spec sentence + classify instruction (w6c, +4.67, P24) — the
 *         few-shot variants and the recall/converge anchors HURT Pro
 *         (P24: suite-full 83% < naked 87.5% vs +guide 100%)
 *  flash: neutral + classify + recall/converge/anti-runaway anchors
 *         (w7, +5.67, P11; anchors lift single-task completion to 100%, P23)
 */
const WEAK_PRO =
  "You are a helpful software engineer assistant.\n"
  + "Before acting, decide the task type (build or fix) and adopt the matching "
  + "style: build → hands-on production; fix → inspect-and-plan.";

const WEAK_FLASH =
  "You are a helpful assistant.\n"
  + "Before acting, decide the task type (build or fix) and adopt the matching "
  + "style: build → hands-on production; fix → inspect-and-plan.\n"
  + "Before acting, briefly review what you have already done in this session and continue from where you left off; do not repeat completed steps. Do not run environment checks (echo, whoami, uname, node --version, date) or exhaustive grep/glob scans.\n"
  + "Think deeply first, then produce.";

/** Complexity heuristic: long or architecturally-worded tasks are COMPLEX.
 *  Simple tasks get fast-convergence guidance; complex tasks get deep
 *  exploration guidance (depth-adaptive, v19). */
const COMPLEX_RE =
  /(重构|架构|全面|详细|设计|系统|优化|分析|survey|overview|architecture|refactor|comprehensive|detailed|design|system|optimize|analyze)/i;

export function isComplexTask(text) {
  return typeof text === "string" && (text.length > 120 || COMPLEX_RE.test(text));
}

const FLASH_RE =
  /flash|deepseek-v[34]-flash|deepseek-r1|vl-lite|mini|nano/i;
const PRO_RE =
  /pro|deepseek-v[34](?!-flash)|deepseek-chat|plus|max|sonnet|opus|gpt-4|gpt-5/i;

/** Route the model id to one of the measured model families (weak-band).
 *  Returns "flash" | "pro" | null (null = unknown, fall through to pro-safe
 *  persona). The regexes intentionally carry no /g flag; lastIndex is reset
 *  on every call so .test() stays stateless even if a future edit
 *  re-introduces the /g flag (sticky .test() caused false pro-family reads). */
export function modelFamily(modelId) {
  if (typeof modelId !== "string" || !modelId.trim()) return null;
  FLASH_RE.lastIndex = 0;
  PRO_RE.lastIndex = 0;
  if (FLASH_RE.test(modelId)) return "flash";
  PRO_RE.lastIndex = 0;
  if (PRO_RE.test(modelId)) return "pro";
  return null;
}

/** True when the routed model id is a Flash-family model. */
export function isFlashModel(modelId) {
  return modelFamily(modelId) === "flash";
}

/** Quantize a mode to one of the four measured behavior bands. */
export function bandOf(mode) {
  if (mode === "weak") return "weak";
  const m = clamp01(mode);
  if (m < 0.2) return "spec"; // measured stable spec region (0..0.15)
  if (m < 0.5) return "transition"; // measured unstable band — avoid
  return "react"; // measured stable react region (0.5..1 behave alike)
}

/** Human-readable band name for a mode value. */
export function bandFor(mode) {
  const b = bandOf(mode);
  return b === "transition" ? "mixed" : b;
}

/** Persona for a mode. Standard modes keep the v1.20 fixed RL persona;
 *  the weak band picks the model-specific internal-routing text. */
export function personaFor(mode, modelId) {
  if (bandOf(mode) === "weak") return isFlashModel(modelId) ? WEAK_FLASH : WEAK_PRO;
  return RL_PERSONA;
}

const REACT_RE =
  /(开发|创建|写一个|生成|从零|做一个|游戏|网页|网站|构建|新项目|搭建|实现|做出|上线|落地|脚本|工具|应用|build|create|develop|generate|implement|make a|new project)/gi;
const SPEC_RE =
  /(修复|修一下|调试|重构|维护|排查|报错|出错|崩溃|优化|审查|review|fix|debug|refactor|maintain|repair|broken|break|为什么|异常|故障|迁移|升级|兼容)/gi;

function countHits(regex, text) {
  return [...text.matchAll(regex)].length;
}

/**
 * Classify a task text into a mode. Clear keyword evidence picks a stable
 * band (1 react / 0 spec); AMBIGUOUS or unmatched text returns 'weak' —
 * the internal-routing mode, where the model decides per task (P11 optimum).
 */
export function classifyTask(text) {
  const react = countHits(REACT_RE, text);
  const spec = countHits(SPEC_RE, text);
  if (react > spec) return MODE_REACT;
  if (spec > react) return MODE_SPEC;
  return MODE_WEAK;
}

export function clamp01(v) {
  return Math.min(1, Math.max(0, Number(v) || 0));
}

/** Parse a user/agent-supplied mode token: number 0-100, 0.0-1.0, or a band
 *  name. Numeric input is quantized through bandOf so the returned mode is
 *  always one of the canonical band values (0 | 0.3 | 1) — "continuous"
 *  tuning is meaningless at the model layer (see header). */
export function parseMode(token) {
  if (token === undefined || token === null) return null;
  const t = String(token).trim().toLowerCase();
  if (t === "auto") return MODE_AUTO;
  if (t === "weak" || t === "router") return MODE_WEAK;
  if (t === "spec" || t === "spec-lean") return MODE_SPEC;
  if (t === "balanced" || t === "mixed") return MODE_MIXED;
  if (t === "react" || t === "react-lean") return MODE_REACT;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  const band = bandOf(clamp01(t.includes(".") ? n : n / 100));
  if (band === "transition") return MODE_MIXED;
  if (band === "spec") return MODE_SPEC;
  return MODE_REACT;
}

/** Canonical config value for a mode token: auto|weak|spec|mixed|react. */
export function canonicalMode(token) {
  const parsed = parseMode(token);
  if (parsed === null) return null;
  if (parsed === "auto") return "auto";
  if (parsed === "weak") return "weak";
  if (parsed === MODE_SPEC) return "spec";
  if (parsed === MODE_MIXED) return "mixed";
  return "react";
}

export function extractText(data) {
  if (!data) return "";
  // 防御性解包：插件/工具生成的 user/message 偶有 `data.message` 嵌套形状
  // （如注入器 startIngest 的 seed），直接读 data.content 会得到空串 →
  // 构建/修复任务被误判 weak（router-standard issue #1）。
  const payload =
    data && typeof data.message === "object" && data.message !== null
      ? data.message
      : data;
  const content = Array.isArray(payload.content) ? payload.content : [];
  return content
    .map((c) => (typeof c === "string" ? c : c?.text ?? ""))
    .join(" ");
}

/**
 * Conversation activation/control phrases. Returns "on", "off", or null.
 * The slash command and the router tool are the precise controls; this is the
 * lightweight conversational switch.
 */
const ON_RE =
  /(开启|打开|启用|进入|切换到?|使用|开始)(极简模式|路由模式|router|minimal|pro模式|v4模式)|enable\s+(minimal|router)\s*mode|turn\s+on\s+(minimal|router)\s*mode|start\s+(minimal|router)\s*mode/i;

const OFF_RE =
  /(关闭|关掉|停用|退出|离开|结束)(极简模式|路由模式|router|minimal|pro模式|v4模式)|disable\s+(minimal|router)\s*mode|turn\s+off\s+(minimal|router)\s*mode|stop\s+(minimal|router)\s*mode/i;

export function activationActionFor(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  if (OFF_RE.test(text)) return "off";
  if (ON_RE.test(text)) return "on";
  return null;
}

// ═══════════════════════════════════════════════════════════════════
// v0.3.5: adaptive task → tool-pack surfacing.
//
// The exposed tool surface is not a fixed allowlist. Each request classifies
// the latest user text and opens every HanaAgent tool family the task
// plausibly needs. Packs accumulate per session (never shrink within a
// session) and the model can unlock more on demand through the request_tools
// control tool.

/** Tool pack catalog covering HanaAgent built-ins and MCP connector families.
 *  Tool entries are exact names or prefix wildcards ending in "*". */
export const TOOL_PACKS = {
  docs: {
    title: "documents (Word/智能文档/知识库)",
    keywords:
      /(文档|docx|word|合同|周报|日报|公文|排版|腾讯文档|智能文档|在线文档|知识库|批注|修订|剪藏|网页剪藏|document|contract|report\b)/i,
    tools: [
      "doc-mcp_*",
      "tencent-docs_doc_*",
      "tencent-docs_smartcanvas_*",
      "tencent-docs_manage_*",
      "tencent-docs_query_space_*",
      "tencent-docs_create_smartcanvas_by_mdx",
      "tencent-docs_create_with_markdown",
      "tencent-docs_create_flowchart_by_mermaid",
      "tencent-docs_create_mind_by_markdown",
      "tencent-docs_get_content",
      "tencent-docs_get_user_info",
      "tencent-docs_scrape_url",
      "tencent-docs_scrape_progress",
      "tencent-docs_upload_image",
      "tencent-docs_ocr_extract",
      "tencent-docs_ocr_toword",
      "tencent-docs_report_unsupported_feature",
    ],
  },
  sheets: {
    title: "spreadsheets (在线表格)",
    keywords:
      /(表格|excel|xlsx|csv|透视表|筛选|单元格|冻结|行高|列宽|条件格式|spreadsheet|pivot)/i,
    tools: [
      "sheet-mcp_*",
      "tencent-docs_sheet_*",
      "tencent-docs_ocr_toexcel",
    ],
  },
  slides: {
    title: "slides (PPT/演示文稿)",
    keywords: /(ppt|幻灯片|演示文稿|slide|keynote|路演|汇报页)/i,
    tools: [
      "slide-mcp_*",
      "tencent-docs_slide_*",
      "tencent-docs_create_slide",
    ],
  },
  smartsheet: {
    title: "smartsheet (多维表格/智能表)",
    keywords: /(多维表格|智能表|记录|字段视图|收集表|登记表|报名表)/i,
    tools: ["tencent-docs_smartsheet_*"],
  },
  browser: {
    title: "browser (Playwright 网页自动化)",
    keywords:
      /(网页|浏览[器器]|抓取|爬取|登录.{0,6}(网站|页面|系统)|点击.{0,6}页|前端调试|截图.{0,4}网页|url\b|http[s]?\/\/|playwright|scrape|crawl)/i,
    tools: ["playwright_browser_*"],
  },
  desktop: {
    title: "desktop (Windows 桌面自动化/nuphus)",
    keywords:
      /(桌面|窗口|鼠标|键盘|微信|截图屏幕|控制电脑|操作.{0,4}(软件|应用|程序)|nuphus|desktop automation)/i,
    tools: [
      "nuphus-desktop_desktop_*",
      "nuphus-desktop_browser_*",
    ],
  },
  media: {
    title: "media (图片/视频生成)",
    keywords:
      /(生图|图片生成|生成图|画一?[张幅]|文生图|封面图|生成视频|视频生成|image generation|text2image|text2video)/i,
    tools: [
      "media_generate-image",
      "media_generate-video",
      "media_describe-options",
      "media_get-guide",
    ],
  },
};

/** Match task text against pack keyword classifiers. Returns matched pack ids. */
export function packsForText(text) {
  const hits = [];
  if (typeof text !== "string" || !text.trim()) return hits;
  for (const [id, pack] of Object.entries(TOOL_PACKS)) {
    pack.keywords.lastIndex = 0;
    if (pack.keywords.test(text)) hits.push(id);
  }
  return hits;
}

/** True when a tool name satisfies an exact entry or "prefix*" wildcard. */
export function matchesToolSpec(name, spec) {
  if (typeof name !== "string" || typeof spec !== "string") return false;
  if (spec.endsWith("*")) return name.startsWith(spec.slice(0, -1));
  return name === spec;
}

/** Expand a list of pack ids into a flat, de-duplicated tool spec list. */
export function expandPackTools(packIds) {
  const out = [];
  for (const id of Array.isArray(packIds) ? packIds : []) {
    const pack = TOOL_PACKS[id];
    if (!pack) continue;
    for (const spec of pack.tools) {
      if (!out.includes(spec)) out.push(spec);
    }
  }
  return out;
}
