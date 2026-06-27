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


/** Resolve "root" / label / raw hex ID to an entry ID.
 *  Returns { id, fromOffPath } where fromOffPath indicates the label was
 *  found on an off-path branch (not the active path). */
function resolveTargetId(
 sm: ReadonlySessionManager,
 tree: SessionTreeNode[],
 target: string,
 branchIds?: Set<string>,
): { id: string; fromOffPath: boolean } {
 if (target.toLowerCase() === "root") {
  return { id: tree.length > 0 ? tree[0].entry.id : target, fromOffPath: false };
 }
 // Label lookup: prefer active path, then search entire tree.
 const ids = branchIds ?? new Set(sm.getBranch().map((e: SessionEntry) => e.id));
 const onPath = findInTree(tree, (n) => sm.getLabel(n.entry.id) === target && ids.has(n.entry.id))?.entry.id;
 if (onPath) return { id: onPath, fromOffPath: false };
 // Fallback: search entire tree (enables "return to the future" — off-path checkpoint labels)
 const anyMatch = findInTree(tree, (n) => sm.getLabel(n.entry.id) === target)?.entry.id;
 if (anyMatch) return { id: anyMatch, fromOffPath: true };
 // Not a label match — check if raw ID is on active path
 const isOnPath = ids.has(target);
 return { id: target, fromOffPath: !isOnPath };
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
 *  SessionManager at runtime — guarded cast to access appendLabelChange.
 *  Passing label=undefined relies on appendLabelChange treating it as label
 *  removal — verified against OMP SessionManager source. */
function setEntryLabel(sm: ReadonlySessionManager, entryId: string, label: string | undefined): void {
 const full = sm as unknown as {
  appendLabelChange?: (id: string, label: string | undefined) => string;
 };
 if (typeof full.appendLabelChange !== "function") {
  throw new Error("SessionManager does not support appendLabelChange — cannot create checkpoint label");
 }
 const result = full.appendLabelChange(entryId, label);
 if (typeof result !== "string") {
  throw new Error(`appendLabelChange returned non-string: ${typeof result}`);
 }
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
  let resText = (msg.content ?? [])
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
 signal?: AbortSignal,
): void {
 if (depth > maxDepth) return;
 if (lines.length >= 200) return;
 if (signal?.aborted) return;

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
  if (lines.length >= 200) break;
  renderTreeNode(children[i], sm, currentLeafId, depth + 1, maxDepth, childPrefix, i === children.length - 1, lines, signal);
 }
}

// ── Extension factory ─────────────────────────────────────────

export default function(pi: ExtensionAPI): void {
 const zod = pi.zod;

 // ── Tool: acm_checkpoint ───────────────────────────────────
 const checkpointSchema = zod.object({
  name: zod.string().min(1).max(64).regex(/^[\w\-\.]+$/).describe(
   "Unique semantic anchor name encoding task+phase, e.g. parser-fix-start, timeout-investigation-search. Avoid generic names like start, checkpoint-1. Only letters, digits, hyphens, underscores, and dots. Max 64 chars.",
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
   signal: AbortSignal | undefined,
   _onUpdate: unknown,
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
    const resolved = resolveTargetId(sm, tree, params.target, branchIds);
    id = resolved.id;
    const targetExists = findInTree(tree, (n) => n.entry.id === id) !== undefined;
    if (!targetExists) {
     const hint = " It may be a misspelled checkpoint name — use acm_timeline to see available labels and node IDs.";
     return {
      content: [{ type: "text" as const, text: `Error: Target '${params.target}' not found in session tree.${hint}` }],
      details: { error: "target_not_found", requestedTarget: params.target },
     };
    }
    if (resolved.fromOffPath) {
     ctx.ui.notify(`Note: target '${params.target}' resolved from an off-path branch. Checkpoint will be placed on a non-active node.`, "warning");
    }
   } else {
    // Auto-resolve: find last meaningful node, skipping internal tool traffic
    // Reuse outer `branch` (already fetched above for uniqueness check)
    id = "";
    for (let i = branch.length - 1; i >= 0; i--) {
     if (signal?.aborted) break;
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
      // Skip assistant messages whose tool calls are all internal tools,
      // even if they contain visible text (e.g. "Let me create a checkpoint")
      const onlyInternalTools = toolCalls.length > 0 &&
       toolCalls.every((tc: ToolCall) => INTERNAL_TOOLS.has(tc.name));
      if (onlyInternalTools) continue;
      // Skip assistant messages with no visible text and no tool calls
      // (covers thinking-only, empty content, and other non-actionable messages)
      if (!hasVisibleText && toolCalls.length === 0) continue;
     } else if (msg.role === "assistant" && typeof msg.content === "string" && msg.content.trim().length === 0) {
      // Skip assistant messages with empty/whitespace-only string content
      continue;
     } else if (msg.role === "assistant" && (msg.content === null || msg.content === undefined)) {
      continue;
     } else if (msg.role === "user") {
      // Skip user messages with empty/null/undefined content
      const isEmpty = msg.content === null || msg.content === undefined ||
       (typeof msg.content === "string" && msg.content.trim().length === 0) ||
       (Array.isArray(msg.content) && msg.content.length === 0);
      if (isEmpty) continue;
     }
     id = entry.id;
     break;
    }
   }
   if (signal?.aborted) {
    return {
     content: [{ type: "text" as const, text: "acm_checkpoint aborted." }],
     details: { error: "aborted" },
    };
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

   const existingLabel = sm.getLabel(id);
   if (existingLabel && existingLabel !== params.name) {
    ctx.ui.notify(`Warning: node ${id} already has checkpoint '${existingLabel}'. New checkpoint '${params.name}' will overwrite it.`, "warning");
   }
   try {
    setEntryLabel(sm, id, params.name);
   } catch (e) {
    return {
     content: [{ type: "text" as const, text: `Error: checkpoint label '${params.name}' could not be set: ${e instanceof Error ? e.message : String(e)}.` }],
     details: { error: "label_set_failed", name: params.name, entryId: id, message: e instanceof Error ? e.message : String(e) },
    };
   }
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
   signal: AbortSignal | undefined,
   _onUpdate: unknown,
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
     // Search mode: traverse tree, collect matches with early termination
     const searchLimit = Math.min(limit > 0 ? limit : 50, 50);
     const matched: { node: SessionTreeNode; label: string; content: string }[] = [];
     const searchStack: SessionTreeNode[] = [...tree];
     let visited = 0;
     const maxVisited = 10000;
     while (searchStack.length > 0 && matched.length < searchLimit * 2 && visited < maxVisited) {
      if (signal?.aborted) break;
      visited++;
      const n = searchStack.pop()!;
      if (n.children?.length) { for (const child of n.children) searchStack.push(child); }
      const label = sm.getLabel(n.entry.id) ?? "";
      const content = getMsgContent(n.entry, sm, false);
      if (
       label.toLowerCase().includes(searchTerm) ||
       content.toLowerCase().includes(searchTerm) ||
       n.entry.id.toLowerCase().includes(searchTerm)
      ) {
       matched.push({ node: n, label, content });
      }
     }
     const truncated = matched.length >= searchLimit * 2 || visited >= maxVisited;
     const totalCount = truncated ? `${Math.min(matched.length, searchLimit * 2)}+` : String(matched.length);
     lines.push(`Found ${totalCount} node(s) matching '${params.search}' (showing first ${Math.min(matched.length, searchLimit)}):${truncated ? " Results may be incomplete — narrow your search for full coverage." : ""}`);
     for (const m of matched.slice(0, searchLimit)) {
      const isHead = m.node.entry.id === currentLeafId;
      const role = getDisplayRole(m.node.entry);
      const normalized = m.content.replace(/\s+/g, " ");
      const body = normalized.length > 80 ? normalized.slice(0, 80) + "..." : normalized;
      const metaParts = [m.label ? `checkpoint: ${m.label}` : null, isHead ? "*HEAD*" : null, `type: ${m.node.entry.type}`].filter((s): s is string => s !== null);
      const meta = metaParts.length > 0 ? ` (${metaParts.join(", ")})` : "";
      lines.push(`${isHead ? "*" : " "} ${m.node.entry.id}${meta} [${role}] ${body}`);
     }
    } else {
     // No search: render full tree. limit controls max depth (capped at 50).
     const maxDepth = Math.min(limit > 0 ? limit : 50, 50);
     for (let i = 0; i < tree.length; i++) {
      if (signal?.aborted) break;
      renderTreeNode(tree[i], sm, currentLeafId, 0, maxDepth, "", i === tree.length - 1, lines, signal);
     }
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
     if (signal?.aborted) break;
     const n = idxStack.pop()!;
     childIndex.set(n.entry.id, n.children ?? []);
     if (n.children?.length) { for (const child of n.children) idxStack.push(child); }
    }

    const sequence: SessionEntry[] = [];
    for (const entry of branch) {
     if (signal?.aborted) break;
     sequence.push(entry);
     const children = childIndex.get(entry.id) ?? [];
     for (const child of children) {
      if (
       (child.entry.type === "branch_summary" || child.entry.type === "compaction") &&
       !backboneIds.has(child.entry.id)
      ) {
       sequence.push(child.entry);
      }
     }
    }

    // Pre-compute content: contentCache uses current verbose setting for display;
    // searchContentCache uses verbose=false for search matching (excludes internal tool noise).
    const contentCache = new Map<string, string>();
    const searchContentCache = new Map<string, string>();
    for (const e of sequence) {
     if (signal?.aborted) break;
     contentCache.set(e.id, getMsgContent(e, sm, verbose));
     if (searchTerm && verbose) searchContentCache.set(e.id, getMsgContent(e, sm, false));
    }

    const visibleSequenceIds = new Set<string>();
    for (const e of sequence) {
     if (signal?.aborted) break;
     if (searchTerm) {
      const label = sm.getLabel(e.id) ?? "";
      const content = (verbose ? searchContentCache.get(e.id) : contentCache.get(e.id)) ?? "";
      if (label.toLowerCase().includes(searchTerm) || content.toLowerCase().includes(searchTerm) || e.id.toLowerCase().includes(searchTerm)) {
       visibleSequenceIds.add(e.id);
      }
     } else if (verbose || isInteresting(e, sm, childIndex, branch, currentLeafId)) {
      visibleSequenceIds.add(e.id);
     }
    }

    const visibleEntries = sequence.filter((e: SessionEntry) => visibleSequenceIds.has(e.id));
    const effectiveLimit = limit > 0 ? limit : 50;
    if (visibleEntries.length > effectiveLimit) {
     const allowedIds = new Set(visibleEntries.slice(-effectiveLimit).map((e) => e.id));
     visibleSequenceIds.clear();
     allowedIds.forEach((id) => visibleSequenceIds.add(id));
    }

    let hiddenCount = 0;
    for (const entry of sequence) {
     if (signal?.aborted) break;
     if (!visibleSequenceIds.has(entry.id)) {
      hiddenCount++;
      continue;
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
     if (role === "CUSTOM") { hiddenCount++; continue; }

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
    }

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
  summary: zod.string().min(1).max(10000).describe(
   "Handoff state summary: current task/state, decisions/constraints, external side effects (changed files, processes, remote state), validation status, source anchors, and explicit next step. This is NOT a recap—it's the state needed to resume. Max 10000 chars.",
  ),
  backupCheckpoint: zod.string().min(1).max(64).regex(/^[\w\-\.]+$/).optional().describe(
   "Optional name to label current HEAD before branching. Recovery pointer only; summary must still be self-contained. Only letters, digits, hyphens, underscores, and dots. Max 64 chars.",
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
   signal: AbortSignal | undefined,
   _onUpdate: unknown,
   ctx: ExtensionContext,
  ) {
   const params = compactSchema.parse(rawParams);
   const sm = ctx.sessionManager;
   const tree = sm.getTree();
   // Capture sessionId early — reused after branchWithSummary for continuation registration.
   // Session ID doesn't change across branching, but capturing it here eliminates any
   // timing window where getSessionId() could fail after a successful compact.
   const sessionId = sm.getSessionId();
   const branchIds: Set<string> = new Set(sm.getBranch().map((e: SessionEntry) => e.id));
   const resolved = resolveTargetId(sm, tree, params.target, branchIds);
   const tid = resolved.id;
   // Validate that the resolved target actually exists in the tree
   const targetExists = findInTree(tree, (n) => n.entry.id === tid) !== undefined;
   if (!targetExists) {
    const hint = " It may be a misspelled checkpoint name — use acm_timeline with full_tree to see available labels and node IDs.";
    return {
     content: [{ type: "text" as const, text: `Error: Target '${params.target}' not found in session tree.${hint}` }],
     details: { error: "target_not_found", requestedTarget: params.target, resolvedTargetId: tid },
    };
   }
   // off-path notify deferred until after all validation checks pass
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
   // Abort check before any side effects or mutations (notify, backup label, branchWithSummary).
   if (signal?.aborted) {
    return {
     content: [{ type: "text" as const, text: "acm_compact aborted: signal was already aborted." }],
     details: { error: "aborted", target: params.target, targetId: tid },
    };
   }
   if (resolved.fromOffPath) {
    ctx.ui.notify(`Note: '${params.target}' resolved from an off-path branch (not the active path). This is a "return to the future" operation.`, "info");
   }

   const originId = currentLeaf;
   const originLabel = sm.getLabel(originId) ?? undefined;
   // originLabel is captured BEFORE backupCheckpoint may overwrite it.
   // The summary references the original label for readability; agent should
   // use originId (stable) to locate the node, not the label name.
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
   // NOTE: If branchWithSummary partially modifies the tree before throwing,
   // we can only roll back the backup label — the session tree may be in an
   // inconsistent state. This is an acceptable limitation given OMP's API.
   let summaryEntryId: string;
   let ghostEntry = false;
   try {
    summaryEntryId = branchWithSummary(sm, tid, enrichedMessage);
    if (!summaryEntryId || typeof summaryEntryId !== "string") {
     throw new Error(`branchWithSummary returned invalid entry ID: ${String(summaryEntryId)}`);
    }
    // Verify the returned ID actually exists in the tree.
    // branchWithSummary already mutated the tree (leaf moved), so we can't roll back —
    // downgrade to warning and let continuation fire so agent reads the summary.
    const newTree = sm.getTree();
    if (!findInTree(newTree, (n) => n.entry.id === summaryEntryId)) {
     ghostEntry = true;
     pi.logger.debug("branchWithSummary returned ID not found in tree", { summaryEntryId });
     try { ctx.ui.notify(`Warning: compact succeeded but summary entry ${summaryEntryId} not found in tree. Session state may be inconsistent.`, "warning"); } catch (e) { pi.logger.debug("ghost entry notify failed", { error: e instanceof Error ? e.message : String(e) }); }
    }
   } catch (err) {
    let rollbackFailed = false;
    if (backupLabelSet) {
     try {
      setEntryLabel(sm, originId, originLabel);
      // Verify rollback succeeded — check label matches expected state
      const currentLabel = sm.getLabel(originId) ?? undefined;
      if (currentLabel !== originLabel) {
       rollbackFailed = true;
      }
     } catch (rollbackErr) {
      rollbackFailed = true;
      try { pi.logger.debug("compact rollback failed", { error: rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr) }); } catch { /* best-effort */ }
     }
     if (rollbackFailed) {
      try { ctx.ui.notify(`Warning: backup label '${params.backupCheckpoint}' could not be rolled back after compact failure. Manual cleanup needed for node ${originId}.`, "warning"); } catch (ne) { pi.logger.debug("rollback notify failed", { error: ne instanceof Error ? ne.message : String(ne) }); }
     }
    }
    const rollbackNote = rollbackFailed
     ? ` Additionally, backup label '${params.backupCheckpoint}' could not be rolled back — node ${originId} still has label '${params.backupCheckpoint}'. Use acm_checkpoint with target '${originId}' to fix the label manually.`
     : "";
    return {
     content: [{ type: "text" as const, text: `acm_compact failed: ${err instanceof Error ? err.message : String(err)}${rollbackNote}` }],
     details: { error: "compact_failed", target: params.target, targetId: tid, message: err instanceof Error ? err.message : String(err), rollbackFailed, backupCheckpoint: params.backupCheckpoint ?? null, ...(rollbackFailed ? { inconsistentLabelEntryId: originId, staleLabel: params.backupCheckpoint ?? null } : {}) },
    };
   }

   // Count increment immediately after successful branchWithSummary —
   // session state is already mutated, continuation MUST fire even if notification fails.
   // sessionId was captured at the top of execute() — no timing window.
   // Map.set with string key cannot throw, so no try-catch needed.
   pendingCompactCounts.set(sessionId, (pendingCompactCounts.get(sessionId) ?? 0) + 1);

   let usageAfter: UsageLike | undefined;
   try {
    usageAfter = ctx.getContextUsage();
   } catch (e) { pi.logger.debug("getContextUsage failed after compact", { error: e instanceof Error ? e.message : String(e) }); }
   try {
    ctx.ui.notify(
     [
      `Compacted to ${params.target}`,
      `Context: ${usageBeforeText} → ${formatContextUsage(usageAfter)}`,
      `Backup: ${params.backupCheckpoint || "none"}`,
     ].join("\n"),
     "info",
    );
   } catch (e) { pi.logger.debug("notify failed after compact", { error: e instanceof Error ? e.message : String(e) }); }
   return {
    content: [{
     type: "text" as const, text: ghostEntry
      ? `Compact complete but summary entry ${summaryEntryId} was not found in tree after creation. Session state may be inconsistent. A continuation turn will start — use acm_timeline to inspect current state before proceeding.`
      : `Compact complete. Branch summary ${summaryEntryId} created at ${tid}. A continuation turn will start automatically. Read the injected summary and execute the Next Step.`
    }],
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
     ghostEntry,
    },
   };
  },
 });

 // ── Event: session_stop → continuation turn ────────────────
 // compact is already executed synchronously in the tool. session_stop
 // only triggers a continuation turn so the agent reads the new leaf.
 pi.on("session_stop", (_event, ctx: ExtensionContext) => {
  let capturedSid: string | undefined;
  try {
   const sid = ctx.sessionManager.getSessionId();
   capturedSid = sid;
   const count = pendingCompactCounts.get(sid) ?? 0;
   if (count === 0) return { continue: false }; // No pending compact
   const message = count === 1
    ? "acm_compact complete. A handoff summary of your previous conversation path was injected above. Read it to understand your new state. Execute the Next Step from the summary."
    : `${count} compacts completed in this turn. Only the most recent handoff summary is on the active path — read it to understand your current state. Execute the Next Step from that summary.`;
   return { continue: true, additionalContext: message };
  } catch (e) {
   pi.logger.debug("session_stop handler failed", { error: e instanceof Error ? e.message : String(e) });
   // If getSessionId() threw, we can't identify this session.
   // Can't safely use pendingCompactCounts.size > 0 (may match other sessions). Log only.
   return { continue: false };
  } finally {
   if (capturedSid !== undefined) pendingCompactCounts.delete(capturedSid);
  }
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
