import type {
 ExtensionAPI,
 ExtensionContext,
} from "@oh-my-pi/pi-coding-agent/extensibility/extensions/types";
import type { ReadonlySessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import type {
 SessionEntry,
 SessionTreeNode,
} from "@oh-my-pi/pi-coding-agent/session/session-entries";
import type { TextContent, ImageContent, ToolCall, TSchema, ThinkingContent, RedactedThinkingContent } from "@oh-my-pi/pi-ai/types";

/** Content part types that can appear in assistant message arrays. */
type AssistantContentPart = TextContent | ThinkingContent | RedactedThinkingContent | ToolCall;
// ── Module state ──────────────────────────────────────────────

const pendingCompactCounts = new Map<string, number>();

const INTERNAL_TOOLS = new Set(["acm_checkpoint", "acm_timeline", "acm_compact"]);

// ── Tree traversal ────────────────────────────────────────────

/** Iterative DFS — avoids stack overflow on deep session trees. */
function findInTree(
 nodes: SessionTreeNode[],
 predicate: (n: SessionTreeNode) => boolean,
): SessionTreeNode | undefined {
 const stack: SessionTreeNode[] = [...nodes];
 while (stack.length > 0) {
  const n = stack.pop()!;
  if (predicate(n)) return n;
  if (n.children?.length) { for (const child of n.children) stack.push(child); }
 }
 return undefined;
}


/** Resolve "root" / label / raw hex ID to an entry ID. */
function resolveTargetId(
 sm: ReadonlySessionManager,
 tree: SessionTreeNode[],
 target: string,
 branchIds?: Set<string>,
): string {
 if (target.toLowerCase() === "root") {
  return tree.length > 0 ? tree[0].entry.id : target;
 }
 // Label lookup: prefer active path, then search entire tree.
 const ids = branchIds ?? new Set(sm.getBranch().map((e: SessionEntry) => e.id));
 const onPath = findInTree(tree, (n) => sm.getLabel(n.entry.id) === target && ids.has(n.entry.id))?.entry.id;
 if (onPath) return onPath;
 // Fallback: search entire tree (enables "return to the future" — off-path checkpoint labels)
 const anyMatch = findInTree(tree, (n) => sm.getLabel(n.entry.id) === target)?.entry.id;
 if (anyMatch) return anyMatch;
 // Not a label match — return as-is (caller validates existence via findInTree)
 return target;
}


function formatTokens(tokens: number): string {
 if (!Number.isFinite(tokens) || tokens < 0) return "N/A";
 // 999_950 so that values rounding to 1000.0K display as 1.0M instead
 if (tokens >= 999_950) return `${(tokens / 1_000_000).toFixed(1)}M`;
 if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
 return String(tokens);
}

interface UsageLike {
 tokens: number;
 contextWindow: number;
 percent: number;
}

function formatContextUsage(usage: UsageLike | undefined, includeTokens = false): string {
 if (!usage) return "Unknown";
 const pct = Number.isFinite(usage.percent) ? `${usage.percent.toFixed(1)}%` : "N/A";
 if (!includeTokens) return pct;
 return `${pct} (${formatTokens(usage.tokens)}/${formatTokens(usage.contextWindow)})`;
}

// ── Session label helper ──────────────────────────────────────

/** Set a label on a session entry. pi.setLabel() only sets the extension
 *  display name, not entry labels. ReadonlySessionManager is the full
 *  SessionManager at runtime — guarded cast to access appendLabelChange. */
function setEntryLabel(sm: ReadonlySessionManager, entryId: string, label: string | undefined): void {
 const full = sm as unknown as {
  appendLabelChange?: (id: string, label: string | undefined) => string;
 };
 if (typeof full.appendLabelChange !== "function") {
  throw new Error("SessionManager does not support appendLabelChange — cannot create checkpoint label");
 }
 full.appendLabelChange(entryId, label);
}
/** Call branchWithSummary on the runtime SessionManager.
 *  ReadonlySessionManager is the full SessionManager at runtime. */
function branchWithSummary(
 sm: ReadonlySessionManager,
 branchFromId: string,
 summary: string,
): string {
 const full = sm as unknown as {
  branchWithSummary?: (id: string, summary: string, details?: unknown, fromExtension?: boolean) => string;
 };
 if (typeof full.branchWithSummary !== "function") {
  throw new Error("SessionManager does not support branchWithSummary");
 }
 return full.branchWithSummary(branchFromId, summary, undefined, true);
}

// ── Content extraction for timeline ───────────────────────────

/** Extract a human-readable summary string from a session entry. */
function getMsgContent(entry: SessionEntry, sm: ReadonlySessionManager, verbose: boolean): string {
 if (entry.type === "branch_summary" || entry.type === "compaction") {
  return entry.summary || "[No summary provided]";
 }
 if (entry.type === "label") {
  return `checkpoint: ${entry.label}`;
 }
 if (entry.type !== "message") return "";

 const msg = entry.message;

 if (msg.role === "toolResult") {
  if (!verbose && INTERNAL_TOOLS.has(msg.toolName)) return "";
  let resText = msg.content
   .map((p: TextContent | ImageContent) => (p.type === "text" ? p.text : ""))
   .join(" ")
   .trim();
  const details = msg.details;
  if (
   typeof details === "object" && details !== null &&
   "path" in details && typeof details.path === "string"
  ) {
   resText = `${details.path}: ${resText}`;
  }
  return `(${msg.toolName}) ${resText}`;
 }
 if (msg.role === "bashExecution") {
  return `[Bash] ${msg.command}`;
 }

 if (msg.role === "user" || msg.role === "assistant") {
  let text = "";
  if (typeof msg.content === "string") {
   text = msg.content;
  } else if (Array.isArray(msg.content)) {
   text = msg.content
    .map((p: AssistantContentPart | ImageContent) => {
     if (p.type === "text") return p.text;
     return "";
    })
    .join(" ")
    .trim();
  }

  let toolCallsText = "";
  if (msg.role === "assistant" && Array.isArray(msg.content)) {
   const toolCalls = msg.content.filter(
    (c: AssistantContentPart): c is ToolCall => c.type === "toolCall",
   );
   toolCallsText = toolCalls
    .filter((tc: ToolCall) => verbose || !INTERNAL_TOOLS.has(tc.name))
    .map((tc: ToolCall) => `call: ${tc.name}(${JSON.stringify(tc.arguments)})`)
    .join("; ");
  }

  return [text, toolCallsText].filter(Boolean).join(" ");
 }

 return "";
}

// ── Timeline: "interesting" node filter ───────────────────────

function isInteresting(
 entry: SessionEntry,
 sm: ReadonlySessionManager,
 childIndex: Map<string, SessionTreeNode[]>,
 branch: SessionEntry[],
 currentLeafId: string | null,
): boolean {
 if (entry.id === currentLeafId) return true;
 if (branch.length > 0 && entry.id === branch[0].id) return true;
 if (sm.getLabel(entry.id)) return true;
 if (entry.type === "label") return false;
 if (entry.type === "branch_summary" || entry.type === "compaction") return true;
 if ((childIndex.get(entry.id) ?? []).length > 1) return true;
 if (entry.type === "message" && entry.message.role === "user") return true;
 return false;
}

// ── Timeline: role mapping ────────────────────────────────────

function getDisplayRole(entry: SessionEntry): string {
 if (entry.type === "message") {
  const m = entry.message;
  if (m.role === "assistant") return "AI";
  if (m.role === "user") return "USER";
  if (m.role === "bashExecution") return "BASH";
  return "TOOL";
 }
 if (entry.type === "branch_summary" || entry.type === "compaction") return "SUMMARY";
 if (entry.type === "label") return "LABEL";
 return entry.type.toUpperCase();
}

// ── Timeline: recursive tree renderer ─────────────────────────

// Recursive but bounded by maxDepth (capped at 50) — stack depth cannot exceed 50 frames.
function renderTreeNode(
 node: SessionTreeNode,
 sm: ReadonlySessionManager,
 currentLeafId: string | null,
 depth: number,
 maxDepth: number,
 prefix: string,
 isLast: boolean,
 lines: string[],
): void {
 if (depth > maxDepth) return;
 if (lines.length >= 200) return;

 const entry = node.entry;
 const isHead = entry.id === currentLeafId;
 const label = sm.getLabel(entry.id);
 const role = getDisplayRole(entry);

 const metaParts: string[] = [];
 if (label) metaParts.push(`checkpoint: ${label}`);
 if (entry.type === "branch_summary") metaParts.push(`from: ${entry.fromId}`);
 if (entry.type === "compaction") metaParts.push(`firstKept: ${entry.firstKeptEntryId}`);
 if (isHead) metaParts.push("*HEAD*");

 const content = getMsgContent(entry, sm, false).replace(/\s+/g, " ");
 const body = content.length > 50 ? content.slice(0, 50) + "..." : content;
 const connector = isLast ? "└─" : "├─";
 const meta = metaParts.length > 0 ? ` (${metaParts.join(", ")})` : "";

 lines.push(`${prefix}${connector} ${entry.id}${meta} [${role}] ${body}`);

 const childPrefix = prefix + (isLast ? "   " : "│  ");
 const children = node.children ?? [];
 for (let i = 0; i < children.length; i++) {
  if (lines.length > 200) break;
  renderTreeNode(children[i], sm, currentLeafId, depth + 1, maxDepth, childPrefix, i === children.length - 1, lines);
 }
}

// ── Extension factory ─────────────────────────────────────────

export default function(pi: ExtensionAPI): void {
 const zod = pi.zod;

 // ── Tool: acm_checkpoint ───────────────────────────────────
 const checkpointSchema = zod.object({
  name: zod.string().min(1).describe(
   "Unique semantic anchor name encoding task+phase, e.g. parser-fix-start, timeout-investigation-search. Avoid generic names like start, checkpoint-1.",
  ),
  target: zod.string().min(1).optional().describe(
   "History node ID or checkpoint name to label. Defaults to current meaningful position near HEAD.",
  ),
 });

 pi.registerTool({
  name: "acm_checkpoint",
  label: "ACM Checkpoint",
  description:
   "Create a named anchor on a conversation history node. Zero cost: no branch, no summary, no context change — just a label you can compact back to later. Create checkpoints liberally before noisy work, at phase boundaries, before risky attempts, and after milestones. More checkpoints = more compact target options later.",
  parameters: checkpointSchema as unknown as TSchema,
  async execute(
   _id: string,
   rawParams: unknown,
   _signal: AbortSignal | undefined,
   _onUpdate,
   ctx: ExtensionContext,
  ) {
   const params = checkpointSchema.parse(rawParams);
   const sm = ctx.sessionManager;
   const tree = sm.getTree();

   // Uniqueness check: active path only (off-path branches are stale)
   const branch = sm.getBranch();
   const branchIds: Set<string> = new Set(branch.map((e: SessionEntry) => e.id));
   const existing = findInTree(tree, (n) => sm.getLabel(n.entry.id) === params.name && branchIds.has(n.entry.id))?.entry.id;
   if (existing) {
    return {
     content: [{ type: "text" as const, text: `Error: Checkpoint '${params.name}' already exists at ${existing} on the active path. Use a different name.` }],
     details: { error: "duplicate_name", name: params.name, existingEntryId: existing },
    };
   }

   let id: string;
   if (params.target) {
    id = resolveTargetId(sm, tree, params.target, branchIds);
    const targetExists = findInTree(tree, (n) => n.entry.id === id) !== undefined;
    if (!targetExists) {
     return {
      content: [{ type: "text" as const, text: `Error: Target '${params.target}' not found in session tree. Use acm_timeline to see available node IDs.` }],
      details: { error: "target_not_found", requestedTarget: params.target },
     };
    }
   } else {
    // Auto-resolve: find last meaningful node, skipping internal tool traffic
    // Reuse outer `branch` (already fetched above for uniqueness check)
    id = "";
    for (let i = branch.length - 1; i >= 0; i--) {
     const entry = branch[i];
     // Skip non-message entries (labels, compactions, etc.) — checkpoint a meaningful message node
     if (entry.type !== "message") continue;
     const msg = entry.message;
     if (msg.role === "toolResult" && INTERNAL_TOOLS.has(msg.toolName)) continue;
     if (msg.role === "assistant" && Array.isArray(msg.content)) {
      const toolCalls = msg.content.filter(
       (c: AssistantContentPart): c is ToolCall => c.type === "toolCall",
      );
      const hasVisibleText = msg.content.some(
       (c: AssistantContentPart) =>
        c.type === "text" && c.text.trim().length > 0,
      );
      // Skip assistant messages with only internal tool calls
      const allInternal = toolCalls.length > 0 &&
       !hasVisibleText &&
       toolCalls.every((tc: ToolCall) => INTERNAL_TOOLS.has(tc.name));
      if (allInternal) continue;
      // Skip assistant messages with no visible text and no tool calls
      // (covers thinking-only, empty content, and other non-actionable messages)
      if (!hasVisibleText && toolCalls.length === 0) continue;
     } else if (msg.role === "assistant" && typeof msg.content === "string" && msg.content.trim().length === 0) {
      // Skip assistant messages with empty/whitespace-only string content
      continue;
     } else if (msg.role === "assistant" && (msg.content === null || msg.content === undefined)) {
      continue;
     }
     id = entry.id;
     break;
    }
   }

   if (!id) {
    const isEmpty = branch.length === 0;
    const msg = isEmpty
     ? "No session entry to checkpoint. The conversation is empty."
     : "No meaningful entry to checkpoint. All recent messages are internal tool traffic. Specify a target explicitly.";
    return {
     content: [{ type: "text" as const, text: msg }],
     details: { error: isEmpty ? "empty_session" : "no_meaningful_entry" },
    };
   }

   setEntryLabel(sm, id, params.name);
   return {
    content: [{ type: "text" as const, text: `Created checkpoint '${params.name}' at ${id}.` }],
    details: { entryId: id, label: params.name, target: params.target ?? "auto" },
   };
  },
 });

 // ── Tool: acm_timeline ─────────────────────────────────────
 const timelineSchema = zod.object({
  limit: zod.number().optional().describe("In default mode: maximum visible entries (default 50). In full_tree mode without search: maximum tree depth to render (capped at 50). In full_tree search mode: maximum results returned (capped at 50)."),
  verbose: zod.boolean().optional().describe(
   "Show all messages including internal tool traffic. Default false.",
  ),
  full_tree: zod.boolean().optional().describe(
   "Show all branches including off-path nodes with IDs. Default false (active path only). Use search to filter by keyword instead of browsing unlimited depth.",
  ),
  search: zod.string().optional().describe(
   "Filter timeline to nodes whose content or label matches this keyword. Works in both default and full_tree modes. Use to find specific checkpoints or nodes without rendering the entire tree.",
  ),
 });

 pi.registerTool({
  name: "acm_timeline",
  label: "ACM Timeline",
  description:
   "Inspect the active conversation path as a structural map: checkpoints, summaries/compactions, branch points, user turns, and current position. Use when orientation or compact target selection depends on the shape of history.",
  parameters: timelineSchema as unknown as TSchema,
  async execute(
   _id: string,
   rawParams: unknown,
   _signal: AbortSignal | undefined,
   _onUpdate,
   ctx: ExtensionContext,
  ) {
   const params = timelineSchema.parse(rawParams);
   const sm = ctx.sessionManager;
   const tree = sm.getTree();
   const currentLeafId = sm.getLeafId();
   const verbose = params.verbose ?? false;
   const limit = params.limit ?? 50;
   const useFullTree = params.full_tree ?? false;
   const searchTerm = params.search?.toLowerCase().trim() ?? "";

   const lines: string[] = [];
   const branch = sm.getBranch();

   if (useFullTree) {
    // Build all nodes flat list for search, or render with depth limit
    if (searchTerm) {
     // Search mode: find matching nodes across entire tree, show with context
     const allNodes: SessionTreeNode[] = [];
     const stack: SessionTreeNode[] = [...tree];
     while (stack.length > 0) {
      const n = stack.pop()!;
      allNodes.push(n);
      if (n.children?.length) { for (const child of n.children) stack.push(child); }
     }
     const matched = allNodes.map((n) => ({
      node: n,
      label: sm.getLabel(n.entry.id) ?? "",
      content: getMsgContent(n.entry, sm, false),
     })).filter((m) =>
      m.label.toLowerCase().includes(searchTerm) ||
      m.content.toLowerCase().includes(searchTerm) ||
      m.node.entry.id.toLowerCase().includes(searchTerm)
     );
     const searchLimit = Math.min(limit > 0 ? limit : 50, 50);
     lines.push(`Found ${matched.length} node(s) matching '${params.search}' (showing first ${Math.min(matched.length, searchLimit)}):`);
     for (const m of matched.slice(0, searchLimit)) {
      const isHead = m.node.entry.id === currentLeafId;
      const role = getDisplayRole(m.node.entry);
      const body = m.content.replace(/\s+/g, " ").slice(0, 80) + (m.content.length > 80 ? "..." : "");
      const metaParts = [m.label ? `checkpoint: ${m.label}` : null, isHead ? "*HEAD*" : null, `type: ${m.node.entry.type}`].filter((s): s is string => s !== null);
      const meta = metaParts.length > 0 ? ` (${metaParts.join(", ")})` : "";
      lines.push(`${isHead ? "*" : " "} ${m.node.entry.id}${meta} [${role}] ${body}`);
     }
    } else {
     // No search: render full tree. limit controls max depth (capped at 50).
     const maxDepth = Math.min(limit > 0 ? limit : 50, 50);
     tree.forEach((root: SessionTreeNode, i: number) => {
      renderTreeNode(root, sm, currentLeafId, 0, maxDepth, "", i === tree.length - 1, lines);
     });
     if (lines.length >= 200) {
      lines.push("... (output truncated at 200 lines — use search to find specific nodes) ...");
     }
    }
   } else {
    const backboneIds = new Set(branch.map((e: SessionEntry) => e.id));

    // Build child index once for O(n+m) lookups instead of O(n×m) DFS per entry
    const childIndex = new Map<string, SessionTreeNode[]>();
    const idxStack: SessionTreeNode[] = [...tree];
    while (idxStack.length > 0) {
     const n = idxStack.pop()!;
     childIndex.set(n.entry.id, n.children ?? []);
     if (n.children?.length) { for (const child of n.children) idxStack.push(child); }
    }

    const sequence: SessionEntry[] = [];
    branch.forEach((entry: SessionEntry) => {
     sequence.push(entry);
     const children = childIndex.get(entry.id) ?? [];
     children.forEach((child) => {
      if (
       (child.entry.type === "branch_summary" || child.entry.type === "compaction") &&
       !backboneIds.has(child.entry.id)
      ) {
       sequence.push(child.entry);
      }
     });
    });

    // Pre-compute content for all sequence entries (used for both search matching and display)
    const contentCache = new Map<string, string>();
    sequence.forEach((e: SessionEntry) => {
     contentCache.set(e.id, getMsgContent(e, sm, verbose));
    });

    const visibleSequenceIds = new Set<string>();
    sequence.forEach((e: SessionEntry) => {
     if (searchTerm) {
      const label = sm.getLabel(e.id) ?? "";
      const content = contentCache.get(e.id) ?? "";
      if (label.toLowerCase().includes(searchTerm) || content.toLowerCase().includes(searchTerm) || e.id.toLowerCase().includes(searchTerm)) {
       visibleSequenceIds.add(e.id);
      }
     } else if (verbose || isInteresting(e, sm, childIndex, branch, currentLeafId)) {
      visibleSequenceIds.add(e.id);
     }
    });

    const visibleEntries = sequence.filter((e: SessionEntry) => visibleSequenceIds.has(e.id));
    if (visibleEntries.length > limit) {
     const allowedIds = new Set(visibleEntries.slice(-limit).map((e) => e.id));
     visibleSequenceIds.clear();
     allowedIds.forEach((id) => visibleSequenceIds.add(id));
    }

    let hiddenCount = 0;
    sequence.forEach((entry) => {
     if (!visibleSequenceIds.has(entry.id)) {
      hiddenCount++;
      return;
     }
     if (hiddenCount > 0) {
      lines.push(`  :  ... (${hiddenCount} hidden messages) ...`);
      hiddenCount = 0;
     }

     const isHead = entry.id === currentLeafId;
     const label = sm.getLabel(entry.id);
     const content = (contentCache.get(entry.id) ?? "").replace(/\s+/g, " ");
     const role = getDisplayRole(entry);

     // Hide custom messages (count as hidden for accurate totals)
     if (role === "CUSTOM") { hiddenCount++; return; }

     const isRoot = branch.length > 0 && entry.id === branch[0].id;
     const metaParts = [
      isRoot ? "ROOT" : null,
      isHead ? "HEAD" : null,
      label ? `checkpoint: ${label}` : null,
     ].filter((s): s is string => s !== null);
     const meta = metaParts.length > 0 ? ` (${metaParts.join(", ")})` : "";
     const body = content.length > 100 ? content.slice(0, 100) + "..." : content;
     let marker = "|";
     if (isHead) marker = "*";
     else if (role === "USER") marker = "•";

     lines.push(`${marker} ${entry.id}${meta} [${role}] ${body}`);
    });

    if (hiddenCount > 0) {
     lines.push(`  :  ... (${hiddenCount} hidden messages) ...`);
    }
   }

   // ── Context Dashboard HUD ──
   const usage = ctx.getContextUsage();
   const usageStr = formatContextUsage(usage, true);

   let stepsSinceCheckpoint = 0;
   let nearestCheckpointName: string | null = null;
   for (let i = branch.length - 1; i >= 0; i--) {
    const label = sm.getLabel(branch[i].id);
    if (label) {
     nearestCheckpointName = label;
     break;
    }
    stepsSinceCheckpoint++;
   }

   const compactCue =
    nearestCheckpointName === null
     ? "create a checkpoint before the next noisy phase"
     : `if this segment has produced a stable result and another phase remains, compact to '${nearestCheckpointName}' with a handoff summary before continuing`;
   const hud = [
    `[Context Dashboard]`,
    `• Context Usage:    ${usageStr}`,
    `• Segment Size:     ${stepsSinceCheckpoint} steps since last checkpoint '${nearestCheckpointName ?? "None"}'`,
    `• Compact Cue:      ${compactCue}`,
    `---------------------------------------------------`,
   ].join("\n");

   return {
    content: [{ type: "text" as const, text: hud + "\n" + (lines.join("\n") || "(Root Path Only)") }],
    details: {
     contextUsage: usage ? { percent: usage.percent, tokens: usage.tokens, contextWindow: usage.contextWindow } : null,
     leafId: currentLeafId,
     nearestCheckpoint: nearestCheckpointName,
     stepsSinceCheckpoint,
     fullTree: useFullTree,
     visibleEntries: lines.length,
    },
   };
  },
 });

 // ── Tool: acm_compact ──────────────────────────────────────
 const compactSchema = zod.object({
  target: zod.string().min(1).describe(
   "Checkpoint name, history node ID, or 'root'. Use acm_timeline with full_tree to see all available targets.",
  ),
  summary: zod.string().min(1).describe(
   "Handoff state summary: current task/state, decisions/constraints, external side effects (changed files, processes, remote state), validation status, source anchors, and explicit next step. This is NOT a recap—it's the state needed to resume.",
  ),
  backupCheckpoint: zod.string().min(1).optional().describe(
   "Optional name to label current HEAD before branching. Recovery pointer only; summary must still be self-contained.",
  ),
 });

 pi.registerTool({
  name: "acm_compact",
  label: "ACM Compact",
  description:
   "Create a summarized continuation branch from any tree node (checkpoint name, node ID, or 'root'). The target becomes the branch point; your summary replaces the path after it. The old path is preserved as an off-path branch — use acm_timeline with full_tree to find it and compact back later ('return to the future'). Compact executes synchronously: the result is immediately visible in acm_timeline. A continuation turn starts automatically after the agent stops. This changes conversation history only; it does not modify disk files or external systems.",
  parameters: compactSchema as unknown as TSchema,
  async execute(
   _id: string,
   rawParams: unknown,
   _signal: AbortSignal | undefined,
   _onUpdate,
   ctx: ExtensionContext,
  ) {
   const params = compactSchema.parse(rawParams);
   const sm = ctx.sessionManager;
   const tree = sm.getTree();
   const branchIds: Set<string> = new Set(sm.getBranch().map((e: SessionEntry) => e.id));
   const tid = resolveTargetId(sm, tree, params.target, branchIds);
   // Validate that the resolved target actually exists in the tree
   const targetExists = findInTree(tree, (n) => n.entry.id === tid) !== undefined;
   if (!targetExists) {
    return {
     content: [{ type: "text" as const, text: `Error: Target '${params.target}' not found in session tree. Use acm_timeline with full_tree to see available targets.` }],
     details: { error: "target_not_found", requestedTarget: params.target, resolvedTargetId: tid },
    };
   }

   const currentLeaf = sm.getLeafId();
   if (!currentLeaf) {
    return {
     content: [{ type: "text" as const, text: "Error: No active leaf in session. Cannot compact." }],
     details: { error: "no_active_leaf" },
    };
   }
   if (currentLeaf === tid) {
    return {
     content: [{ type: "text" as const, text: `Already at target ${tid}. Nothing to compact.` }],
     details: { error: "already_at_target", targetId: tid, leafId: currentLeaf },
    };
   }

   const originId = currentLeaf;
   const originLabel = sm.getLabel(originId);
   const fromPart = originLabel
    ? `(handoff summary from ${originLabel}, from: ${originId})`
    : `(handoff summary from: ${originId})`;
   const enrichedMessage = `${fromPart}\n${params.summary}`;
   const usageBeforeText = formatContextUsage(ctx.getContextUsage());

   // Set backup label before branching
   let backupLabelSet = false;
   if (params.backupCheckpoint) {
    const backupExists = findInTree(tree, (n) => sm.getLabel(n.entry.id) === params.backupCheckpoint && branchIds.has(n.entry.id))?.entry.id;
    if (backupExists && backupExists !== originId) {
     return {
      content: [{ type: "text" as const, text: `Error: backupCheckpoint name '${params.backupCheckpoint}' already exists at ${backupExists} on the active path. Use a different name.` }],
      details: { error: "duplicate_backup_name", name: params.backupCheckpoint, existingEntryId: backupExists },
     };
    }
    if (originLabel && originLabel !== params.backupCheckpoint) {
     ctx.ui.notify(`Warning: node ${originId} already has checkpoint '${originLabel}'. backupCheckpoint will overwrite it.`, "warning");
    }
    try {
     setEntryLabel(sm, originId, params.backupCheckpoint);
     backupLabelSet = true;
    } catch (e) {
     return {
      content: [{ type: "text" as const, text: `Error: backup label '${params.backupCheckpoint}' could not be set: ${e instanceof Error ? e.message : String(e)}. Compact aborted.` }],
      details: { error: "backup_label_failed", name: params.backupCheckpoint, message: e instanceof Error ? e.message : String(e) },
     };
    }
   }

   // Synchronous compact: execute branchWithSummary immediately.
   // leaf auto-set to new summary entry by insert().
   // Agent sees the result in the next acm_timeline call — no delay, no confusion.
   let summaryEntryId: string;
   try {
    summaryEntryId = branchWithSummary(sm, tid, enrichedMessage);
   } catch (err) {
    let rollbackFailed = false;
    if (backupLabelSet) {
     try {
      setEntryLabel(sm, originId, originLabel);
     } catch (rollbackErr) {
      rollbackFailed = true;
      ctx.ui.notify(
       `Warning: backup label '${params.backupCheckpoint}' could not be rolled back after compact failure: ${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}`,
       "warning",
      );
     }
    }
    const rollbackNote = rollbackFailed
     ? ` Additionally, backup label '${params.backupCheckpoint}' could not be rolled back — labels may be inconsistent.`
     : "";
    return {
     content: [{ type: "text" as const, text: `acm_compact failed: ${err instanceof Error ? err.message : String(err)}${rollbackNote}` }],
     details: { error: "compact_failed", target: params.target, targetId: tid, message: err instanceof Error ? err.message : String(err), rollbackFailed, backupCheckpoint: params.backupCheckpoint ?? null },
    };
   }

   const sid = sm.getSessionId();
   pendingCompactCounts.set(sid, (pendingCompactCounts.get(sid) ?? 0) + 1);

   const usageAfter = ctx.getContextUsage();
   ctx.ui.notify(
    [
     `Compacted to ${params.target}`,
     `Context: ${usageBeforeText} → ${formatContextUsage(usageAfter)}`,
     `Backup: ${params.backupCheckpoint || "none"}`,
    ].join("\n"),
    "info",
   );

   return {
    content: [{ type: "text" as const, text: `Compact complete. Branch summary ${summaryEntryId} created at ${tid}. A continuation turn will start automatically. Read the injected summary and execute the Next Step.` }],
    details: {
     target: params.target,
     targetId: tid,
     summaryEntryId,
     originId,
     originLabel,
     hasBackup: backupLabelSet,
     backupCheckpoint: params.backupCheckpoint ?? null,
     usageBefore: usageBeforeText,
     usageAfter: formatContextUsage(usageAfter),
    },
   };
  },
 });

 // ── Event: session_stop → continuation turn ────────────────
 // compact is already executed synchronously in the tool. session_stop
 // only triggers a continuation turn so the agent reads the new leaf.
 pi.on("session_stop", (_event, ctx: ExtensionContext) => {
  const sid = ctx.sessionManager.getSessionId();
  const count = pendingCompactCounts.get(sid) ?? 0;
  if (count === 0) return;
  pendingCompactCounts.delete(sid);

  const message = count === 1
   ? "acm_compact complete. A handoff summary of your previous conversation path was injected above. Read it to understand your new state. Execute the Next Step from the summary."
   : `${count} compacts completed. ${count} handoff summaries were injected above. Read them to understand your new state. Execute the Next Step from the most recent summary.`;

  return {
   continue: true,
   additionalContext: message,
  };
 });

 // ── Session lifecycle: clear stale state ───────────────────
 // session_switch is not handled here: ctx.sessionManager already points to the
 // new session at switch time, so we can't clean up the old session's count.
 // Stale counts are harmless — they're consumed by the owning session's
 // session_stop, or cleared on process exit via session_shutdown.
 pi.on("session_shutdown", () => {
  pendingCompactCounts.clear();
 });

}
