// Agent-callable tool: persona_reconcile
//
// v0.3.6 conflict survey & fusion for the CURRENT assistant's persona file
// (agents/<id>/description.md). It never overwrites the file: it detects only
// clauses that CONFLICT with Minimal Mode's hard guarantees, and with
// action="fix" rewrites just those conflicting sentences, leaving every other
// byte of the file untouched (timestamped backup is written first).
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const name = "persona_reconcile";
export const description =
  "Survey the current assistant's persona file (description.md) for clauses that conflict with Minimal Mode guarantees (e.g. mandatory web-search demands while network is hard-blocked), and optionally fix ONLY those conflicting sentences. Non-conflicting content is always preserved untouched.";

// Each entry: id, detection regex, human reason, replacement sentence.
const CONFLICTS = [
  {
    id: "mandatory-web-search",
    pattern: /[^。\n！？]*(?:全网搜索|联网搜索|(?:必须|一定要?)搜索)[^。\n！？]*[。！？]?/g,
    reason:
      "网络检索工具在锚定轮后可调用；若用户开启了网络命令守卫（networkGuard）或工具调用失败，无条件的\"必须联网搜索\"指令无法保证满足。",
    replacement:
      "涉及概念解释的时候，必须查证优先：先给出验证路径与检索关键词；当前环境检索工具不可用（守卫开启或调用失败）时如实说明限制，禁止凭记忆断言。",
  },
  {
    id: "vision-demand",
    pattern: /[^。\n！？]*(?:必须|一定|总是)(?:查看|分析|识别)图片或截图[^。\n！？]*[。！？]?/g,
    reason:
      "图片上下文由 Hana 原生注入，插件不再裁剪任何记忆/视觉内容；仅当本轮上下文确实缺少图片（用户未上传或未被宿主注入）时，无条件\"必须查看图片\"无法满足。",
    replacement: "遇到图片或截图相关需求时，若当前上下文未包含图片内容，请用户提供文字描述或重新上传。",
  },
];

function agentDirOf(toolCtx) {
  const candidates = [
    toolCtx?.sessionPath,
    toolCtx?.sessionRef?.sessionPath,
    toolCtx?.sessionManager?.getSessionFile?.(),
  ].filter((p) => typeof p === "string" && p);
  for (const c of candidates) {
    const m = String(c).replace(/\\/g, "/").match(/^(.*\/agents\/[^/]+)\//);
    if (m) return m[1];
  }
  return null;
}

function sentenceReplacements(text) {
  const found = [];
  for (const conflict of CONFLICTS) {
    conflict.pattern.lastIndex = 0;
    let m;
    while ((m = conflict.pattern.exec(text)) !== null) {
      const fragment = m[0].trim();
      if (fragment) {
        found.push({ id: conflict.id, reason: conflict.reason, fragment, replacement: conflict.replacement });
      }
    }
  }
  return found;
}

export const parameters = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["survey", "fix"],
      description: "survey (default): report conflicts without touching the file. fix: rewrite ONLY the conflicting sentences after backing up.",
    },
  },
};

export const sessionPermission = {
  kind: "external_side_effect",
  describeSideEffect: () => ({
    kind: "plugin_config",
    summary: "Survey/patch conflicting persona clauses in the current assistant's description.md (backup before any write).",
  }),
  resolveInvocation: () => {
    let ns = "persona_reconcile";
    try {
      const stack = new Error().stack || "";
      if (/resolveBuiltinInvocation|tool-catalog-bridge/i.test(stack)) {
        ns = "hana-minimal-mode_persona_reconcile";
      }
    } catch { /* keep bare */ }
    return { action: "invoke", kind: "review", capability: `${ns}.invoke` };
  },
};

export async function execute(input, toolCtx) {
  const dir = agentDirOf(toolCtx);
  if (!dir) {
    return "Could not locate the current assistant directory (no agents/<id>/ path in session context). Nothing was read or changed.";
  }
  const file = join(dir, "description.md");
  if (!existsSync(file)) {
    return `No description.md at ${dir}. Nothing to reconcile.`;
  }

  const original = readFileSync(file, "utf8");
  const conflicts = sentenceReplacements(original);

  if (!conflicts.length) {
    return `No conflicts found in ${file}. The persona already coexists with Minimal Mode guarantees; the file was NOT modified.`;
  }

  const report = conflicts
    .map((c, i) => `${i + 1}. [${c.id}] "${c.fragment}"\n   reason: ${c.reason}\n   fusion replacement: "${c.replacement}"`)
    .join("\n");

  if (input?.action !== "fix") {
    return `Found ${conflicts.length} conflicting clause(s):\n${report}\n\nCall again with action="fix" to rewrite ONLY these sentences (everything else stays byte-identical; a timestamped backup is created first).`;
  }

  let patched = original;
  for (const c of conflicts) {
    patched = patched.replace(c.fragment, c.replacement);
  }
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
  const backup = `${file}.bak-${stamp}`;
  copyFileSync(file, backup);
  writeFileSync(file, patched, "utf8");

  const unchangedShare = 1 - conflicts.reduce((n, c) => n + c.fragment.length, 0) / Math.max(1, original.length);
  return `Fusion complete.\nBackup: ${backup}\nPatched ${conflicts.length} sentence(s); ~${Math.round(unchangedShare * 100)}% of the file left byte-identical.\n${report}`;
}