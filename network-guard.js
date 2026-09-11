// Network command guard for Minimal Mode.
//
// Hana's Windows command sandbox does not support true network isolation, so
// this plugin blocks common network-access commands at the tool_call layer.
// This is a heuristic guard, not a kernel-level network sandbox.

const NETWORK_COMMAND_PATTERNS = [
  /\bcurl\b/i,
  /\bwget\b/i,
  /\bInvoke-WebRequest\b/i,
  /\bInvoke-RestMethod\b/i,
  /\biwr\b/i,
  /\birm\b/i,
  /\bnetcat\b/i,
  /\bnc\b/i,
  /\btelnet\b/i,
  /\bssh\b/i,
  /\bsftp\b/i,
  /\bscp\b/i,
  /\brsync\b/i,
  /\bftp\b/i,
  /\bnslookup\b/i,
  /\bping\b/i,
  /\btracert\b/i,
  /\bpathping\b/i,
  /\bTest-NetConnection\b/i,
  /\bNew-Object\s+Net\.Sockets\.TCPClient\b/i,
  /\bSystem\.Net\.WebClient\b/i,
  /\bSystem\.Net\.Http\b/i,
  /\bpython[^\n]*\s(?:-c|import)\s+[\"']?requests[\"']?/i,
  /\bpython[^\n]*\s(?:-c|import)\s+[\"']?urllib[\"']?/i,
  /\bnode[^\n]*\s(?:-e|--eval)[^\n]*\bfetch\s*\(/i,
  /\bdeno[^\n]*\s(?:-e|eval)[^\n]*\bfetch\s*\(/i,
];

export function isNetworkCommand(command) {
  if (typeof command !== "string" || !command.trim()) return false;
  return NETWORK_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
}

export function extractCommandFromToolInput(input) {
  if (typeof input === "string") return input;
  if (!input || typeof input !== "object") return "";
  return (
    input.cmd
    || input.command
    || input.args?.cmd
    || input.args?.command
    || input.params?.cmd
    || input.params?.command
    || ""
  );
}
