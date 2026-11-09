import { parse, type Node } from "acorn";

/** How long one task's loops may run before they are stopped, so a loop that never ends
 *  can't freeze the app (the preview runs on the app's thread). */
const LOOP_LIMIT_MS = 1000;

// Defines __wdLoop, which every guarded loop calls once per pass. The clock starts at the first
// pass in a task and resets once the task's code has finished, so only one long run trips it.
// Once tripped, every loop in that task stops, so nested loops unwind too.
export const LOOP_GUARD = `<script>(function () {
  var timing = false, start = 0, passes = 0, tripped = false;
  function reset() { timing = false; passes = 0; tripped = false; }
  globalThis.__wdLoop = function (where) {
    if (tripped) return true;
    if (!timing) { timing = true; start = performance.now(); queueMicrotask(reset); }
    if (++passes & 1023) return false;
    if (performance.now() - start < ${LOOP_LIMIT_MS}) return false;
    tripped = true;
    var text = "A loop ran for over a second without finishing, so it was stopped to keep the page from freezing (" + where + ")";
    if (globalThis.__wdReport) globalThis.__wdReport(text); else console.warn(text);
    return true;
  };
})();</script>`;

const LOOPS = new Set(["ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement", "DoWhileStatement"]);

type LoopNode = Node & { body: Node & { type: string }; loc?: { start: { line: number } } };

function parseScript(code: string): Node | null {
  for (const sourceType of ["script", "module"] as const) {
    try {
      return parse(code, { ecmaVersion: "latest", sourceType, locations: true, allowHashBang: true, allowReturnOutsideFunction: true });
    } catch {
      // Try as a module, then give up: code that doesn't parse can't run a loop either
    }
  }
  return null;
}

function findLoops(node: unknown, found: LoopNode[]): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) findLoops(child, found);
    return;
  }
  const n = node as Node;
  if (typeof n.type !== "string") return;
  if (LOOPS.has(n.type)) found.push(n as LoopNode);
  for (const key in n) {
    if (key !== "loc") findLoops((n as unknown as Record<string, unknown>)[key], found);
  }
}

/** The script with a check at the top of every loop body that stops the loop once it has run
 *  too long (see LOOP_GUARD), or the script unchanged when it has no loops or doesn't parse.
 *  Nothing is added on a new line, so error line numbers stay right. `file` names the script in
 *  the report, and `lineOffset` is the line it starts on in that file. */
export function guardLoops(code: string, file: string, lineOffset = 0): { code: string; guarded: boolean } {
  const tree = parseScript(code);
  if (!tree) return { code, guarded: false };
  const loops: LoopNode[] = [];
  findLoops(tree, loops);
  if (!loops.length) return { code, guarded: false };

  const edits: { at: number; text: string }[] = [];
  for (const loop of loops) {
    const where = JSON.stringify(`${file} line ${(loop.loc?.start.line ?? 1) + lineOffset}`);
    const check = `if (__wdLoop(${where})) break;`;
    const body = loop.body;
    if (body.type === "BlockStatement") {
      edits.push({ at: body.start + 1, text: check });
    } else {
      edits.push({ at: body.start, text: `{${check}` }, { at: body.end, text: "}" });
    }
  }
  // From the end, so earlier positions stay valid
  edits.sort((a, b) => b.at - a.at);
  let out = code;
  for (const { at, text } of edits) out = out.slice(0, at) + text + out.slice(at);
  return { code: out, guarded: true };
}
