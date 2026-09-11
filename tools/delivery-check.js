import { statSync, readFileSync } from "node:fs";

export function runDeliveryCheck(file, url, evidence) {
  const checks = [];
  if (!file) return { ok: false, checks: [{ name: "file-exists", pass: false, detail: "missing file parameter" }] };
  try {
    const st = statSync(file);
    checks.push({ name: "file-exists", pass: true, detail: `${file} (${st.size} bytes)` });
    checks.push(st.size > 0 ? { name: "file-nonempty", pass: true, detail: `${st.size} bytes` } : { name: "file-nonempty", pass: false, detail: "file is 0 bytes" });
  } catch (e) {
    return { ok: false, checks: [...checks, { name: "file-exists", pass: false, detail: String((e && e.message) || e) }] };
  }
  try {
    const head = readFileSync(file).subarray(0, 65536);
    new TextDecoder("utf-8", { fatal: true }).decode(head);
    checks.push({ name: "encoding-utf8", pass: true, detail: "UTF-8 decode OK (head 64KB)" });
  } catch (e) {
    checks.push({ name: "encoding-utf8", pass: false, detail: String((e && e.message) || e) });
  }
  const ev = evidence;
  if (!ev || !Array.isArray(ev.items) || ev.items.length === 0) {
    checks.push({ name: "delivery-evidence", pass: false, detail: "missing evidence items — provide at least one evidence item: {label, kind, target?, result?, reviewed?}" });
  } else {
    const ALLOWED = new Set(["file", "page", "image", "run", "test", "text", "external", "numeric"]);
    const failures = [];
    for (const it of ev.items) {
      const label = String(it?.label || "").trim();
      const kind = String(it?.kind || "").trim();
      if (!label) { failures.push("empty label"); continue; }
      if (!ALLOWED.has(kind)) { failures.push("bad kind: " + kind); continue; }
      if (kind === "run" || kind === "text") {
        if (!String(it?.result || "").trim()) failures.push(kind + " evidence without result");
        continue;
      }
      if (kind === "numeric") {
        if (!String(it?.result ?? "").trim() || !/^-?[\d.eE+-]+$/.test(String(it.result))) failures.push("numeric evidence needs a numeric result");
        continue;
      }
      const t = String(it?.target || "").trim();
      if (!t) { failures.push(kind + " evidence without target"); continue; }
      try {
        const st = statSync(t);
        if (!st.isFile() || st.size <= 0) failures.push("target not valid file: " + t);
      } catch { failures.push("target missing: " + t); }
      if ((kind === "page" || kind === "image") && it?.reviewed !== true) failures.push("visual not reviewed: " + label);
    }
    if (url && !(ev.items || []).some((it) => ["page", "image", "external"].includes(String(it?.kind)) && it?.reviewed === true)) {
      failures.push("page deliverable needs at least one reviewed visual evidence (page/image/external)");
    }
    checks.push({ name: "delivery-evidence", pass: failures.length === 0, detail: failures.length === 0 ? "evidence accepted (" + ev.items.length + " item(s))" : failures.join("; ") });
  }
  return { ok: checks.every((c) => c.pass), checks };
}

export const name = "delivery_check";
export const description = "交付闸门：校验交付物文件（存在/非空/UTF-8）+ 证据清单。所有检查 PASS 才允许宣告完成。";
export const parameters = {
  type: "object",
  properties: {
    file: { type: "string", description: "交付物文件绝对路径或工作区相对路径（必填）" },
    url: { type: "string", description: "页面交付物必传（可选，校验视觉证据存在）" },
    evidence: { type: "object", description: "证据清单 { items: [{label, kind, target?, result?, reviewed?}] }" },
  },
  required: ["file"],
};
export const sessionPermission = {
  readOnly: true,
  resolveInvocation: () => {
    let ns = "delivery_check";
    try {
      const stack = new Error().stack || "";
      if (/resolveBuiltinInvocation|tool-catalog-bridge/i.test(stack)) {
        ns = "hana-minimal-mode_delivery_check";
      }
    } catch { /* keep bare */ }
    return { action: "read", kind: "read", capability: `${ns}.read` };
  },
};
export async function execute(input, toolCtx) {
  const r = runDeliveryCheck(String(input?.file || "").trim(), input?.url, input?.evidence);
  let text = "delivery-check: " + (r.ok ? "PASS" : "FAIL") + "\n";
  for (const c of r.checks) text += `- [${c.pass ? "PASS" : "FAIL"}] ${c.name}: ${c.detail}\n`;
  text += r.ok ? "All checks passed — you may report completion." : "Do NOT report completion; fix failing checks and re-run.";
  return text;
}