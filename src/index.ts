import type { AgentMessage } from "@oh-my-pi/pi-agent-core/types";
import { estimateTokens } from "@oh-my-pi/pi-agent-core/compaction/compaction";
import { countTokens } from "@oh-my-pi/pi-agent-core/tokenizer";
import type {
 ExtensionAPI,
 ExtensionContext,
} from "@oh-my-pi/pi-coding-agent/extensibility/extensions/types";
import type { ReadonlySessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import type {
 SessionEntry,
 SessionTreeNode,
} from "@oh-my-pi/pi-coding-agent/session/session-entries";
import { buildSessionContext } from "@oh-my-pi/pi-coding-agent/session/session-context";
import type { TextContent, ImageContent, ToolCall, TSchema, ThinkingContent, RedactedThinkingContent } from "@oh-my-pi/pi-ai/types";

/** Content part types that can appear in assistant message arrays. */
type AssistantContentPart = TextContent | ThinkingContent | RedactedThinkingContent | ToolCall;
// ── Module state ──────────────────────────────────────────────

/** Persistent flag: when set, every context event rebuilds messages via buildSessionContext(). Cleared on session_shutdown. */
let pendingContextRefresh: string | null = null;


/** Legacy ghost session tracking (kept for backward compat with older session logs). */
const pendingGhostSessions = new Set<string>();

const INTERNAL_TOOLS = new Set(["acm_checkpoint", "acm_timeline", "acm_travel"]);

type MeaningfulSkipReason =
 | "non_message"
 | "tool_result"
 | "internal_tool_only_assistant"
 | "empty_assistant"
 | "empty_user";

interface SkippedEntry {
 id: string;
 reason: MeaningfulSkipReason;
 role?: string;
}

interface MeaningfulResolveResult {
 entryId: string | null;
 role?: string;
 snippet?: string;
 skipped: SkippedEntry[];
}

function getMessageRoleLabel(entry: SessionEntry): string | undefined {
 if (entry.type !== "message") return undefined;
 const msg = entry.message;
 if (msg.role === "assistant") return "AI";
 if (msg.role === "user") return "USER";
 if (msg.role === "toolResult") return `TOOL:${msg.toolName}`;
 if (msg.role === "bashExecution") return "BASH";
 return msg.role.toUpperCase();
}

function getMeaningfulSkipReason(entry: SessionEntry): MeaningfulSkipReason | null {
 if (entry.type !== "message") return "non_message";
 const msg = entry.message;
 if (msg.role === "toolResult") return "tool_result";
 if (msg.role === "assistant" && Array.isArray(msg.content)) {
  const toolCalls = msg.content.filter(
   (c: AssistantContentPart): c is ToolCall => c.type === "toolCall",
  );
  const hasVisibleText = msg.content.some(
   (c: AssistantContentPart) => c.type === "text" && c.text.trim().length > 0,
  );
  const onlyInternalTools = toolCalls.length > 0 &&
   toolCalls.every((tc: ToolCall) => INTERNAL_TOOLS.has(tc.name));
  if (onlyInternalTools && !hasVisibleText) return "internal_tool_only_assistant";
  if (!hasVisibleText && toolCalls.length === 0) return "empty_assistant";
 } else if (msg.role === "assistant" && typeof msg.content === "string" && msg.content.trim().length === 0) {
  return "empty_assistant";
 } else if (msg.role === "assistant" && (msg.content === null || msg.content === undefined)) {
  return "empty_assistant";
 } else if (msg.role === "user") {
  const isEmpty = msg.content === null || msg.content === undefined ||
   (typeof msg.content === "string" && msg.content.trim().length === 0) ||
   (Array.isArray(msg.content) && msg.content.length === 0);
  if (isEmpty) return "empty_user";
 }
 return null;
}

function isCheckpointableMessage(entry: SessionEntry): boolean {
 if (entry.type !== "message") return false;
 const role = entry.message.role;
 return role === "user" || role === "assistant";
}

function describeEntrySnippet(entry: SessionEntry, sm: ReadonlySessionManager, maxLen = 60): string {
 const content = getMsgContent(entry, sm, false).replace(/\s+/g, " ").trim();
 if (!content) return "";
 return content.length > maxLen ? `${content.slice(0, maxLen)}...` : content;
}

function describeSkipReason(reason: MeaningfulSkipReason, role?: string): string {
 switch (reason) {
  case "non_message": return "non-message node";
  case "tool_result": return role ?? "tool result";
  case "internal_tool_only_assistant": return "internal-tool-only AI turn";
  case "empty_assistant": return "empty AI turn";
  case "empty_user": return "empty user turn";
 }
}

function findLastMeaningfulEntry(
 branch: SessionEntry[],
 sm: ReadonlySessionManager,
 signal?: AbortSignal,
): MeaningfulResolveResult {
 const skipped: SkippedEntry[] = [];
 for (let i = branch.length - 1; i >= 0; i--) {
  if (signal?.aborted) break;
  const entry = branch[i];
  const skipReason = getMeaningfulSkipReason(entry);
  if (skipReason) {
   skipped.push({ id: entry.id, reason: skipReason, role: getMessageRoleLabel(entry) });
   continue;
  }
  return {
   entryId: entry.id,
   role: getMessageRoleLabel(entry),
   snippet: describeEntrySnippet(entry, sm),
   skipped,
  };
 }
 return { entryId: null, skipped };
}

function formatMeaningfulResolveSummary(result: MeaningfulResolveResult): string {
 if (!result.entryId) return "";
 const role = result.role ?? "NODE";
 const anchor = result.snippet ? `${role}: "${result.snippet}"` : role;
 if (result.skipped.length === 0) return anchor;
 const skipParts = result.skipped.slice(0, 3).map((s) => describeSkipReason(s.reason, s.role));
 const more = result.skipped.length > 3 ? ` +${result.skipped.length - 3} more` : "";
 return `${anchor}; skipped ${result.skipped.length} nearer HEAD (${skipParts.join(", ")}${more})`;
}

function findEntryInTree(tree: SessionTreeNode[], id: string): SessionEntry | undefined {
 return findInTree(tree, (n) => n.entry.id === id)?.entry;
}

interface TravelSummaryDetails {
 originId: string;
 originLabel?: string;
 target: string;
 targetId: string;
 backupCurrentHeadAs?: string | null;
}

type TravelEffect = "shrunk" | "restored" | "unchanged" | "unknown";

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


interface LabelMaps {
 /** Latest owner per label name (for travel resolution). */
 labelToEntryId: Map<string, string>;
 /** All aliases per entry, in chronological order. */
 entryToLabels: Map<string, string[]>;
}

/** OMP getLabel() keeps only the latest label per entry; scan all label journal entries for aliases. */
function buildLabelMaps(entries: SessionEntry[]): LabelMaps {
 const labelToEntryId = new Map<string, string>();
 const entryToLabels = new Map<string, string[]>();

 for (const entry of entries) {
  if (entry.type !== "label") continue;
  const { targetId, label } = entry;
  if (!label) {
   entryToLabels.delete(targetId);
   for (const [name, id] of [...labelToEntryId.entries()]) {
    if (id === targetId) labelToEntryId.delete(name);
   }
   continue;
  }
  const previousOwner = labelToEntryId.get(label);
  if (previousOwner && previousOwner !== targetId) {
   const prevLabels = entryToLabels.get(previousOwner);
   if (prevLabels) {
    const filtered = prevLabels.filter((l) => l !== label);
    if (filtered.length === 0) entryToLabels.delete(previousOwner);
    else entryToLabels.set(previousOwner, filtered);
   }
  }
  labelToEntryId.set(label, targetId);
  const existing = entryToLabels.get(targetId) ?? [];
  if (!existing.includes(label)) {
   entryToLabels.set(targetId, [...existing, label]);
  }
 }
 return { labelToEntryId, entryToLabels };
}

function getEntryLabels(labelMaps: LabelMaps, entryId: string): string[] {
 return labelMaps.entryToLabels.get(entryId) ?? [];
}

function formatEntryLabels(labelMaps: LabelMaps, entryId: string): string | undefined {
 const labels = getEntryLabels(labelMaps, entryId);
 return labels.length > 0 ? labels.join(", ") : undefined;
}

function entryMatchesLabelSearch(labelMaps: LabelMaps, entryId: string, searchTerm: string): boolean {
 return getEntryLabels(labelMaps, entryId).some((label) => label.toLowerCase().includes(searchTerm));
}

function findCheckpointLabelOwners(
 labelMaps: LabelMaps,
 label: string,
 backboneIds: Set<string>,
): { entryId: string; onActivePath: boolean }[] {
 const entryId = labelMaps.labelToEntryId.get(label);
 if (!entryId) return [];
 return [{ entryId, onActivePath: backboneIds.has(entryId) }];
}

type ResolveTargetResult =
 | { ok: true; id: string; fromOffPath: boolean }
 | { ok: false; error: "ambiguous_label"; label: string; matches: { entryId: string; onActivePath: boolean }[] };

/** Resolve "root" / label / raw hex ID to an entry ID. */
function resolveTargetId(
 sm: ReadonlySessionManager,
 tree: SessionTreeNode[],
 target: string,
 branchIds?: Set<string>,
 labelMaps?: LabelMaps,
): ResolveTargetResult {
 if (target.toLowerCase() === "root") {
  return { ok: true, id: tree.length > 0 ? tree[0].entry.id : target, fromOffPath: false };
 }
 const ids = branchIds ?? new Set(sm.getBranch().map((e: SessionEntry) => e.id));
 const maps = labelMaps ?? buildLabelMaps(sm.getEntries());

 const owners = findCheckpointLabelOwners(maps, target, ids);
 if (owners.length > 1) {
  return { ok: false, error: "ambiguous_label", label: target, matches: owners };
 }
 if (owners.length === 1) {
  return { ok: true, id: owners[0].entryId, fromOffPath: !owners[0].onActivePath };
 }

 const isOnPath = ids.has(target);
 return { ok: true, id: target, fromOffPath: !isOnPath };
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

function classifyTravelEffect(before: UsageLike | undefined, after: UsageLike | undefined): TravelEffect {
 if (!before || !after) return "unknown";
 const delta = after.tokens - before.tokens;
 const threshold = Math.max(500, before.tokens * 0.02);
 if (Math.abs(delta) <= threshold) return "unchanged";
 return delta < 0 ? "shrunk" : "restored";
}

function classifyStructuralMessageEffect(before: number | undefined, after: number | undefined): TravelEffect {
 if (before === undefined || after === undefined) return "unknown";
 const delta = after - before;
 if (Math.abs(delta) <= 1) return "unchanged";
 return delta < 0 ? "shrunk" : "restored";
}

/** Walk session tree at an optional leaf and return resolved LLM messages. */
function getBuildSessionMessages(sm: ReadonlySessionManager, leafId?: string | null): AgentMessage[] | undefined {
 const entries = sm.getEntries();
 if (entries.length === 0) return [];
 const byId = new Map(entries.map((e) => [e.id, e]));
 const effectiveLeaf = leafId === undefined ? sm.getLeafId() : leafId;
 return buildSessionContext(entries, effectiveLeaf, byId).messages as AgentMessage[];
}

function sumMessageTokens(messages: AgentMessage[]): number {
 return messages.reduce((sum, msg) => sum + estimateTokens(msg), 0);
}

/** Estimate total context usage after message set changes, holding system/tools overhead fixed. */
function estimateUsageAfterMessageChange(
 usageBefore: UsageLike | undefined,
 messagesBefore: AgentMessage[],
 messagesAfter: AgentMessage[],
 extraTokens = 0,
): UsageLike | undefined {
 if (!usageBefore || usageBefore.contextWindow <= 0) return undefined;
 const beforeMsgTokens = sumMessageTokens(messagesBefore);
 const afterMsgTokens = sumMessageTokens(messagesAfter);
 const fixedOverhead = Math.max(0, usageBefore.tokens - beforeMsgTokens);
 const estimatedTokens = fixedOverhead + afterMsgTokens + extraTokens;
 return {
  tokens: estimatedTokens,
  contextWindow: usageBefore.contextWindow,
  percent: (estimatedTokens / usageBefore.contextWindow) * 100,
 };
}

/** Pre-travel preview: target-path messages + handoff summary (branch_summary wrapper overhead). */
function estimateUsageAtTravelTarget(
 usageBefore: UsageLike | undefined,
 currentMessages: AgentMessage[],
 targetMessages: AgentMessage[],
 summaryText: string,
): UsageLike | undefined {
 const summaryTokens = summaryText.length > 0 ? countTokens(summaryText) : 0;
 const branchSummaryOverhead = 100;
 return estimateUsageAfterMessageChange(
  usageBefore,
  currentMessages,
  targetMessages,
  summaryTokens + branchSummaryOverhead,
 );
}

function countContextMessages(sm: ReadonlySessionManager): number | undefined {
 const messages = getBuildSessionMessages(sm);
 return messages?.length;
}

function getBranchSummaryMetaParts(entry: SessionEntry): string[] {
 if (entry.type !== "branch_summary") return [];
 const parts = [`branchPoint: ${entry.fromId}`];
 const details = entry.details as TravelSummaryDetails | undefined;
 if (details?.originId) {
  const origin = details.originLabel
   ? `${details.originLabel} (${details.originId})`
   : details.originId;
  parts.push(`origin: ${origin}`);
 }
 if (details?.target) parts.push(`target: ${details.target}`);
 if (details?.backupCurrentHeadAs) parts.push(`backupCurrentHeadAs: ${details.backupCurrentHeadAs}`);
 return parts;
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
 details?: TravelSummaryDetails,
): string {
 const full = sm as unknown as {
  branchWithSummary?: (id: string, summary: string, details?: unknown, fromExtension?: boolean) => string;
 };
 if (typeof full.branchWithSummary !== "function") {
  throw new Error("SessionManager does not support branchWithSummary");
 }
 return full.branchWithSummary(branchFromId, summary, details, true);
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
 labelMaps: LabelMaps,
 childIndex: Map<string, SessionTreeNode[]>,
 branch: SessionEntry[],
 currentLeafId: string | null,
 backboneIds: Set<string>,
): boolean {
 if (entry.id === currentLeafId) return true;
 if (branch.length > 0 && entry.id === branch[0].id) return true;
 if (getEntryLabels(labelMaps, entry.id).length > 0) return true;
 if (entry.type === "label") return false;
 if (entry.type === "branch_summary" || entry.type === "compaction") {
  return backboneIds.has(entry.id);
 }
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

// ── Timeline: off-path footnotes & checkpoint listing ─────────

function countSubtreeNodes(node: SessionTreeNode): number {
 let count = 1;
 const stack = [...(node.children ?? [])];
 while (stack.length > 0) {
  const n = stack.pop()!;
  count++;
  if (n.children?.length) stack.push(...n.children);
 }
 return count;
}

function countOffPathForks(
 branch: SessionEntry[],
 childIndex: Map<string, SessionTreeNode[]>,
 backboneIds: Set<string>,
): number {
 let forks = 0;
 for (const entry of branch) {
  const children = childIndex.get(entry.id) ?? [];
  if (children.some(
   (c) =>
    (c.entry.type === "branch_summary" || c.entry.type === "compaction") &&
    !backboneIds.has(c.entry.id),
  )) {
   forks++;
  }
 }
 return forks;
}

function formatOffPathFootnotes(
 entry: SessionEntry,
 childIndex: Map<string, SessionTreeNode[]>,
 backboneIds: Set<string>,
): string[] {
 const children = childIndex.get(entry.id) ?? [];
 const offPath = children.filter(
  (c) =>
   (c.entry.type === "branch_summary" || c.entry.type === "compaction") &&
   !backboneIds.has(c.entry.id),
 );
 if (offPath.length === 0) return [];

 const footnotes: string[] = [];
 const maxShow = 3;
 for (let i = 0; i < Math.min(offPath.length, maxShow); i++) {
  const child = offPath[i];
  const e = child.entry;
  const kind = e.type;
  const meta = e.type === "branch_summary"
   ? getBranchSummaryMetaParts(e).join(", ")
   : e.type === "compaction"
    ? `firstKept: ${e.firstKeptEntryId}`
    : "";
  const subtreeSize = countSubtreeNodes(child);
  footnotes.push(
   `  :  [off-path] ${kind} ${e.id} (${meta}) — ${subtreeSize} node(s), not on active path`,
  );
 }
 if (offPath.length > maxShow) {
  footnotes.push(`  :  [off-path] +${offPath.length - maxShow} more — use search or full_tree`);
 }
 return footnotes;
}

function buildChildIndex(tree: SessionTreeNode[]): Map<string, SessionTreeNode[]> {
 const childIndex = new Map<string, SessionTreeNode[]>();
 const idxStack: SessionTreeNode[] = [...tree];
 while (idxStack.length > 0) {
  const n = idxStack.pop()!;
  childIndex.set(n.entry.id, n.children ?? []);
  if (n.children?.length) { for (const child of n.children) idxStack.push(child); }
 }
 return childIndex;
}

interface CheckpointListing {
 entryId: string;
 label: string;
 onActivePath: boolean;
 isHead: boolean;
}

function collectCheckpointListings(
 labelMaps: LabelMaps,
 backboneIds: Set<string>,
 currentLeafId: string | null,
 searchTerm: string,
): CheckpointListing[] {
 const listings: CheckpointListing[] = [];
 for (const [label, entryId] of labelMaps.labelToEntryId) {
  if (searchTerm && !label.toLowerCase().includes(searchTerm) && !entryId.toLowerCase().includes(searchTerm)) {
   continue;
  }
  listings.push({
   entryId,
   label,
   onActivePath: backboneIds.has(entryId),
   isHead: entryId === currentLeafId,
  });
 }
 listings.sort((a, b) => {
  if (a.onActivePath !== b.onActivePath) return a.onActivePath ? -1 : 1;
  if (a.entryId !== b.entryId) return a.entryId.localeCompare(b.entryId);
  return a.label.localeCompare(b.label);
 });
 return listings;
}

// ── Timeline: recursive tree renderer ─────────────────────────

// Recursive but bounded by maxDepth (capped at 50) — stack depth cannot exceed 50 frames.
function renderTreeNode(
 node: SessionTreeNode,
 sm: ReadonlySessionManager,
 labelMaps: LabelMaps,
 currentLeafId: string | null,
 backboneIds: Set<string>,
 depth: number,
 maxDepth: number,
 prefix: string,
 isLast: boolean,
 lines: string[],
 signal?: AbortSignal,
): boolean {
 if (depth > maxDepth) return true;
 if (lines.length >= 200) return true;
 if (signal?.aborted) return true;

 const entry = node.entry;
 const isHead = entry.id === currentLeafId;
 const checkpointLabels = formatEntryLabels(labelMaps, entry.id);
 const role = getDisplayRole(entry);

 const metaParts: string[] = [];
 if (!backboneIds.has(entry.id)) metaParts.push("off-path");
 if (checkpointLabels) metaParts.push(`checkpoint: ${checkpointLabels}`);
 if (entry.type === "branch_summary") metaParts.push(...getBranchSummaryMetaParts(entry));
 if (entry.type === "compaction") metaParts.push(`firstKept: ${entry.firstKeptEntryId}`);
 if (isHead) metaParts.push("*HEAD*");

 const content = getMsgContent(entry, sm, false).replace(/\s+/g, " ");
 const body = content.length > 50 ? content.slice(0, 50) + "..." : content;
 const connector = isLast ? "└─" : "├─";
 const meta = metaParts.length > 0 ? ` (${metaParts.join(", ")})` : "";

 lines.push(`${prefix}${connector} ${entry.id}${meta} [${role}] ${body}`);

 let truncated = false;
 const childPrefix = prefix + (isLast ? "   " : "│  ");
 const children = node.children ?? [];
 for (let i = 0; i < children.length; i++) {
  if (lines.length >= 200) { truncated = true; break; }
  const childTruncated = renderTreeNode(
   children[i], sm, labelMaps, currentLeafId, backboneIds, depth + 1, maxDepth, childPrefix,
   i === children.length - 1, lines, signal,
  );
  if (childTruncated) truncated = true;
 }
 return truncated || (depth >= maxDepth && children.length > 0);
}

interface TreeSearchMatch {
 node: SessionTreeNode;
 checkpointLabels: string;
 content: string;
}

/** Full-tree search across all branches (active + off-path). */
function searchFullSessionTree(
 sm: ReadonlySessionManager,
 tree: SessionTreeNode[],
 labelMaps: LabelMaps,
 searchTerm: string,
 searchLimit: number,
 signal?: AbortSignal,
): { matches: TreeSearchMatch[]; visited: number; truncated: boolean } {
 const matched: TreeSearchMatch[] = [];
 const searchStack: SessionTreeNode[] = [...tree];
 let visited = 0;
 const maxVisited = 10000;
 while (searchStack.length > 0 && matched.length < searchLimit * 2 && visited < maxVisited) {
  if (signal?.aborted) break;
  visited++;
  const n = searchStack.pop()!;
  if (n.children?.length) { for (const child of n.children) searchStack.push(child); }
  const checkpointLabels = formatEntryLabels(labelMaps, n.entry.id) ?? "";
  const content = getMsgContent(n.entry, sm, false);
  if (
   checkpointLabels.toLowerCase().includes(searchTerm) ||
   entryMatchesLabelSearch(labelMaps, n.entry.id, searchTerm) ||
   content.toLowerCase().includes(searchTerm) ||
   n.entry.id.toLowerCase().includes(searchTerm)
  ) {
   matched.push({ node: n, checkpointLabels, content });
  }
 }
 return {
  matches: matched,
  visited,
  truncated: matched.length >= searchLimit * 2 || visited >= maxVisited,
 };
}

function formatTreeSearchResults(
 matches: TreeSearchMatch[],
 currentLeafId: string | null,
 searchQuery: string,
 searchLimit: number,
 truncated: boolean,
): string[] {
 const lines: string[] = [];
 const totalCount = truncated ? `${Math.min(matches.length, searchLimit * 2)}+` : String(matches.length);
 lines.push(
  `Found ${totalCount} node(s) matching '${searchQuery}' across full tree (showing first ${Math.min(matches.length, searchLimit)}):${truncated ? " Results may be incomplete — narrow your search." : ""}`,
 );
 for (const m of matches.slice(0, searchLimit)) {
  const isHead = m.node.entry.id === currentLeafId;
  const role = getDisplayRole(m.node.entry);
  const normalized = m.content.replace(/\s+/g, " ");
  const body = normalized.length > 80 ? normalized.slice(0, 80) + "..." : normalized;
  const metaParts = [
   m.checkpointLabels ? `checkpoint: ${m.checkpointLabels}` : null,
   isHead ? "*HEAD*" : null,
   `type: ${m.node.entry.type}`,
  ].filter((s): s is string => s !== null);
  const meta = metaParts.length > 0 ? ` (${metaParts.join(", ")})` : "";
  lines.push(`${isHead ? "*" : " "} ${m.node.entry.id}${meta} [${role}] ${body}`);
 }
 return lines;
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
   "Create a named anchor on a conversation history node. Zero cost: no branch, no summary, no context change — just a label you can travel back to later. The same node may hold multiple checkpoint aliases; each name must be unique across the session tree. Create checkpoints liberally before noisy work, at phase boundaries, before risky attempts, and after milestones. More checkpoints = more travel target options later.",
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
   const labelMaps = buildLabelMaps(sm.getEntries());

   // Label names must be unique across the tree; the same entry may hold multiple aliases.
   const branch = sm.getBranch();
   const branchIds: Set<string> = new Set(branch.map((e: SessionEntry) => e.id));

   let id: string;
   let autoResolved: MeaningfulResolveResult | undefined;
   let targetEntry: SessionEntry | undefined;
   if (params.target) {
    const resolved = resolveTargetId(sm, tree, params.target, branchIds, labelMaps);
    if (!resolved.ok) {
     const matchList = resolved.matches
      .map((m) => `${m.entryId}${m.onActivePath ? " (on-path)" : " (off-path)"}`)
      .join(", ");
     return {
      content: [{ type: "text" as const, text: `Error: Checkpoint name '${resolved.label}' is ambiguous (${matchList}). Use a node ID from acm_timeline({ list_checkpoints: true }).` }],
      details: { error: resolved.error, label: resolved.label, matches: resolved.matches },
     };
    }
    id = resolved.id;
    targetEntry = findEntryInTree(tree, id);
    if (!targetEntry) {
     const hint = " It may be a misspelled checkpoint name — use acm_timeline to see available labels and node IDs.";
     return {
      content: [{ type: "text" as const, text: `Error: Target '${params.target}' not found in session tree.${hint}` }],
      details: { error: "target_not_found", requestedTarget: params.target },
     };
    }
    if (!isCheckpointableMessage(targetEntry)) {
     const role = getMessageRoleLabel(targetEntry) ?? targetEntry.type;
     ctx.ui.notify(
      `Warning: explicit checkpoint target '${params.target}' (${id}) is a ${role} node, not USER/AI. Prefer conversational turns; travel semantics may be unintuitive.`,
      "warning",
     );
    }
    if (resolved.fromOffPath) {
     ctx.ui.notify(`Note: target '${params.target}' resolved from an off-path branch. Checkpoint will be placed on a non-active node.`, "warning");
    }
   } else {
    autoResolved = findLastMeaningfulEntry(branch, sm, signal);
    id = autoResolved.entryId ?? "";
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

   const existingOwner = labelMaps.labelToEntryId.get(params.name);
   if (existingOwner && existingOwner !== id) {
    const onPath = branchIds.has(existingOwner) ? "on-path" : "off-path";
    return {
     content: [{ type: "text" as const, text: `Error: Checkpoint '${params.name}' already exists at ${existingOwner} (${onPath}). Use a different name.` }],
     details: { error: "duplicate_name", name: params.name, entryId: existingOwner },
    };
   }

   const priorLabels = getEntryLabels(labelMaps, id);
   if (priorLabels.includes(params.name)) {
    const aliasText = priorLabels.length > 1 ? ` Aliases on this node: ${priorLabels.join(", ")}.` : "";
    return {
     content: [{ type: "text" as const, text: `Checkpoint '${params.name}' already exists at ${id}.${aliasText}` }],
     details: { entryId: id, label: params.name, aliases: priorLabels, alreadyPresent: true },
    };
   }

   try {
    setEntryLabel(sm, id, params.name);
   } catch (e) {
    return {
     content: [{ type: "text" as const, text: `Error: checkpoint label '${params.name}' could not be set: ${e instanceof Error ? e.message : String(e)}.` }],
     details: { error: "label_set_failed", name: params.name, entryId: id, message: e instanceof Error ? e.message : String(e) },
    };
   }

   const aliasSuffix = priorLabels.length > 0 ? ` Added alias alongside: ${priorLabels.join(", ")}.` : "";
   return {
    content: [{
     type: "text" as const,
     text: autoResolved
      ? `Created checkpoint '${params.name}' at ${id} (${formatMeaningfulResolveSummary(autoResolved)}).${aliasSuffix}`
      : `Created checkpoint '${params.name}' at ${id} (${getMessageRoleLabel(targetEntry!) ?? "NODE"}${params.target ? `, target='${params.target}'` : ""}).${aliasSuffix}`,
    }],
    details: {
     entryId: id,
     label: params.name,
     aliases: [...priorLabels, params.name],
     target: params.target ?? "auto",
     autoResolved: autoResolved
      ? {
         role: autoResolved.role,
         snippet: autoResolved.snippet,
         skippedCount: autoResolved.skipped.length,
         skipped: autoResolved.skipped,
        }
      : undefined,
    },
   };
  },
 });

 // ── Tool: acm_timeline ─────────────────────────────────────
 const timelineSchema = zod.object({
  limit: zod.number().optional().describe("In default active-path mode: maximum visible entries (default 50). In full_tree mode: maximum tree depth to render (capped at 50). With search: maximum results returned (capped at 50)."),
  verbose: zod.boolean().optional().describe(
   "Show all messages including internal tool traffic. Default false.",
  ),
  full_tree: zod.boolean().optional().describe(
   "Show all branches including off-path nodes with IDs. Default false (active path only). Prefer list_checkpoints or search on large trees.",
  ),
  list_checkpoints: zod.boolean().optional().describe(
   "List checkpoint labels across the full tree with node IDs and on-path/off-path tags. Display is capped at 50 — use search to narrow.",
  ),
  search: zod.string().optional().describe(
   "Search the full session tree (active + off-path) for matching checkpoint labels, node IDs, or content. When set, overrides default active-path-only view unless list_checkpoints is also true.",
  ),
 });

 pi.registerTool({
  name: "acm_timeline",
  label: "ACM Timeline",
  description:
   "Inspect the conversation tree: active path (default), full tree, checkpoint catalog, or global search. Default shows the active path spine; search scans the entire tree including off-path branches.",
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
   const listCheckpoints = params.list_checkpoints ?? false;
   const searchTerm = params.search?.toLowerCase().trim() ?? "";

   const lines: string[] = [];
   const branch = sm.getBranch();
   const labelMaps = buildLabelMaps(sm.getEntries());
   const backboneIds: Set<string> = new Set(branch.map((e: SessionEntry) => e.id));
   const childIndex = buildChildIndex(tree);
   const offPathForks = countOffPathForks(branch, childIndex, backboneIds);
   let treeTruncated = false;

   if (listCheckpoints) {
    const listings = collectCheckpointListings(labelMaps, backboneIds, currentLeafId, searchTerm);
    const listLimit = Math.min(limit > 0 ? limit : 50, 50);
    const usage = ctx.getContextUsage();
    const currentMessages = getBuildSessionMessages(sm) ?? [];
    const currentUsageText = formatContextUsage(usage, true);
    lines.push(
     `Checkpoints (${listings.length} total${searchTerm ? ` matching '${params.search}'` : ""}, showing up to ${listLimit}; cap 50). Current: ${currentMessages.length} msgs, ${currentUsageText}:`,
    );
    for (const cp of listings.slice(0, listLimit)) {
     const pathTag = cp.onActivePath ? "on-path" : "off-path";
     const headTag = cp.isHead ? ", *HEAD*" : "";
     const targetMessages = getBuildSessionMessages(sm, cp.entryId) ?? [];
     const estimated = estimateUsageAfterMessageChange(usage, currentMessages, targetMessages);
     const estPart = estimated
      ? `~${targetMessages.length} msgs, ~${formatContextUsage(estimated, true)} est. (target path only; travel summary not included)`
      : `~${targetMessages.length} msgs`;
     lines.push(`  ${cp.label} → ${cp.entryId} (${pathTag}${headTag}) ${estPart}`);
    }
    if (listings.length > listLimit) {
     lines.push(`  ... +${listings.length - listLimit} more — use search to narrow (display cap 50)`);
    }
   } else if (searchTerm) {
    const searchLimit = Math.min(limit > 0 ? limit : 50, 50);
    const { matches, truncated } = searchFullSessionTree(
     sm, tree, labelMaps, searchTerm, searchLimit, signal,
    );
    lines.push(...formatTreeSearchResults(matches, currentLeafId, params.search!, searchLimit, truncated));
   } else if (useFullTree) {
    const maxDepth = Math.min(limit > 0 ? limit : 50, 50);
    for (let i = 0; i < tree.length; i++) {
     if (signal?.aborted) break;
     const truncated = renderTreeNode(
      tree[i], sm, labelMaps, currentLeafId, backboneIds, 0, maxDepth, "", i === tree.length - 1, lines, signal,
     );
     if (truncated) treeTruncated = true;
    }
    if (lines.length >= 200) treeTruncated = true;
    if (treeTruncated) {
     lines.push("... (tree truncated by depth/line limit — use list_checkpoints: true or search: \"name\") ...");
    }
   } else {
    const sequence: SessionEntry[] = [...branch];

    const contentCache = new Map<string, string>();
    for (const e of sequence) {
     if (signal?.aborted) break;
     contentCache.set(e.id, getMsgContent(e, sm, verbose));
    }

    const visibleSequenceIds = new Set<string>();
    for (const e of sequence) {
     if (signal?.aborted) break;
     if (verbose || isInteresting(e, labelMaps, childIndex, branch, currentLeafId, backboneIds)) {
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
     const checkpointLabels = formatEntryLabels(labelMaps, entry.id);
     const content = (contentCache.get(entry.id) ?? "").replace(/\s+/g, " ");
     const role = getDisplayRole(entry);

     // Hide custom messages (count as hidden for accurate totals)
     if (role === "CUSTOM") { hiddenCount++; continue; }

     const isRoot = branch.length > 0 && entry.id === branch[0].id;
     const metaParts = [
      isRoot ? "ROOT" : null,
      isHead ? "HEAD" : null,
      checkpointLabels ? `checkpoint: ${checkpointLabels}` : null,
      ...getBranchSummaryMetaParts(entry),
     ].filter((s): s is string => s !== null);
     const meta = metaParts.length > 0 ? ` (${metaParts.join(", ")})` : "";
     const body = content.length > 100 ? content.slice(0, 100) + "..." : content;
     let marker = "|";
     if (isHead) marker = "*";
     else if (role === "USER") marker = "•";

     lines.push(`${marker} ${entry.id}${meta} [${role}] ${body}`);

     for (const footnote of formatOffPathFootnotes(entry, childIndex, backboneIds)) {
      lines.push(footnote);
     }
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
    const labels = getEntryLabels(labelMaps, branch[i].id);
    if (labels.length > 0) {
     nearestCheckpointName = labels[labels.length - 1];
     break;
    }
    stepsSinceCheckpoint++;
   }

   const travelCue =
    nearestCheckpointName === null
     ? "create a checkpoint before the next noisy phase"
     : `if this segment has produced a stable result and another phase remains, travel to '${nearestCheckpointName}' with a handoff summary before continuing`;
   const hudParts = [
    `[Context Dashboard]`,
    `• Context Usage:    ${usageStr}`,
    `• Active Path:      ${branch.length} node(s) — LLM context follows this spine`,
    `• Off-path Summaries: ${offPathForks} branch point(s) with abandoned summaries`,
    `• Segment Size:     ${stepsSinceCheckpoint} steps since last checkpoint '${nearestCheckpointName ?? "None"}'`,
    `• Travel Cue:       ${travelCue}`,
   ];
   if (!listCheckpoints && !useFullTree) {
    hudParts.push(`• Tip:              large trees → list_checkpoints or search before full_tree`);
   } else if (useFullTree && treeTruncated) {
    hudParts.push(`• Tip:              tree truncated → list_checkpoints: true or search: "checkpoint-name"`);
   }
   const hud = [...hudParts, `---------------------------------------------------`].join("\n");

   return {
    content: [{ type: "text" as const, text: hud + "\n" + (lines.join("\n") || "(Root Path Only)") }],
    details: {
     contextUsage: usage ? { percent: usage.percent, tokens: usage.tokens, contextWindow: usage.contextWindow } : null,
     leafId: currentLeafId,
     nearestCheckpoint: nearestCheckpointName,
     stepsSinceCheckpoint,
     activePathNodes: branch.length,
     offPathSummaries: offPathForks,
     fullTree: useFullTree,
     listCheckpoints,
     treeTruncated,
     visibleEntries: lines.length,
    },
   };
  },
 });

 // ── Tool: acm_travel ───────────────────────────────────────
 const travelSchema = zod.object({
  target: zod.string().min(1).describe(
   "Checkpoint name, history node ID, or 'root'. Use acm_timeline with full_tree or search to see all available targets.",
  ),
  summary: zod.string().min(1).max(10000).describe(
   "Handoff state summary: current task/state, decisions/constraints, external side effects (changed files, processes, remote state), validation status, source anchors, and explicit next step. This is NOT a recap—it's the state needed to resume. Max 10000 chars.",
  ),
  backupCurrentHeadAs: zod.string().min(1).max(64).regex(/^[\w\-\.]+$/).optional().describe(
   "Optional checkpoint name for the current HEAD before traveling. Recovery pointer only; summary must still be self-contained. Not the travel target.",
  ),
 });

 pi.registerTool({
  name: "acm_travel",
  label: "ACM Travel",
  description:
   "Travel on the conversation timeline to any checkpoint or node (name, node ID, or 'root'). The target becomes the branch point; your summary replaces only the path after it. Context may shrink (travel to an earlier anchor before noisy work) or grow (travel to a later/off-path anchor that still carries raw history). The old path is preserved as an off-path branch. Executes synchronously; verify with acm_timeline. Changes conversation history only — not disk files or external systems.",
  parameters: travelSchema as unknown as TSchema,
  async execute(
   _id: string,
   rawParams: unknown,
   signal: AbortSignal | undefined,
   _onUpdate: unknown,
   ctx: ExtensionContext,
  ) {
   const params = travelSchema.parse(rawParams);
   const sm = ctx.sessionManager;
   const tree = sm.getTree();
   const branch = sm.getBranch();
   const labelMaps = buildLabelMaps(sm.getEntries());
   const branchIds: Set<string> = new Set(branch.map((e: SessionEntry) => e.id));
   const resolved = resolveTargetId(sm, tree, params.target, branchIds, labelMaps);
   if (!resolved.ok) {
    const matchList = resolved.matches
     .map((m) => `${m.entryId}${m.onActivePath ? " (on-path)" : " (off-path)"}`)
     .join(", ");
    return {
     content: [{ type: "text" as const, text: `Error: Travel target '${resolved.label}' is ambiguous (${matchList}). Use a node ID from acm_timeline({ list_checkpoints: true }).` }],
     details: { error: resolved.error, label: resolved.label, matches: resolved.matches },
    };
   }
   const tid = resolved.id;
   const targetExists = findInTree(tree, (n) => n.entry.id === tid) !== undefined;
   if (!targetExists) {
    const hint = " It may be a misspelled checkpoint name — use acm_timeline with full_tree or search to see available labels and node IDs.";
    return {
     content: [{ type: "text" as const, text: `Error: Target '${params.target}' not found in session tree.${hint}` }],
     details: { error: "target_not_found", requestedTarget: params.target, resolvedTargetId: tid },
    };
   }
   const currentLeaf = sm.getLeafId();
   if (!currentLeaf) {
    return {
     content: [{ type: "text" as const, text: "Error: No active leaf in session. Cannot travel." }],
     details: { error: "no_active_leaf" },
    };
   }
   if (currentLeaf === tid) {
    return {
     content: [{ type: "text" as const, text: `Already at target ${tid}. Nothing to travel.` }],
     details: { error: "already_at_target", targetId: tid, leafId: currentLeaf },
    };
   }
   if (signal?.aborted) {
    return {
     content: [{ type: "text" as const, text: "acm_travel aborted: signal was already aborted." }],
     details: { error: "aborted", target: params.target, targetId: tid },
    };
   }
   if (resolved.fromOffPath) {
    ctx.ui.notify(`Note: '${params.target}' resolved from an off-path branch (not the active path). Traveling to off-path anchors may restore raw history and increase context.`, "info");
   }

   const originId = currentLeaf;
   const originLabel = formatEntryLabels(labelMaps, originId);
   const usageBefore = ctx.getContextUsage();
   const usageBeforeText = formatContextUsage(usageBefore, true);
   const currentMessages = getBuildSessionMessages(sm) ?? [];
   const targetMessages = getBuildSessionMessages(sm, tid) ?? [];
   const estimatedUsagePreview = estimateUsageAtTravelTarget(
    usageBefore,
    currentMessages,
    targetMessages,
    params.summary,
   );
   const estimatedPreviewText = formatContextUsage(estimatedUsagePreview, true);
   const messagesBefore = currentMessages.length;

   let backupEntryId: string | undefined;
   let backupResolvedFromHead: string | undefined;
   if (params.backupCurrentHeadAs) {
    const headResolve = findLastMeaningfulEntry(branch, sm, signal);
    backupEntryId = headResolve.entryId ?? undefined;
    if (!backupEntryId) {
     return {
      content: [{ type: "text" as const, text: `Error: backupCurrentHeadAs '${params.backupCurrentHeadAs}' could not be placed — no meaningful USER/AI message found near HEAD. Travel aborted.` }],
      details: { error: "no_meaningful_backup_target", name: params.backupCurrentHeadAs, headId: originId },
     };
    }
    if (backupEntryId !== originId) {
     backupResolvedFromHead = originId;
     ctx.ui.notify(
      `Note: backupCurrentHeadAs '${params.backupCurrentHeadAs}' placed on ${backupEntryId} (${headResolve.role ?? "message"}) instead of HEAD ${originId} (tool/internal traffic).`,
      "info",
     );
    }
    const backupOwners = findCheckpointLabelOwners(labelMaps, params.backupCurrentHeadAs, branchIds);
    const conflicting = backupOwners.filter((o) => o.entryId !== backupEntryId);
    if (conflicting.length > 0) {
     const existing = conflicting.map((o) => `${o.entryId}${o.onActivePath ? " (on-path)" : " (off-path)"}`).join(", ");
     return {
      content: [{ type: "text" as const, text: `Error: backupCurrentHeadAs name '${params.backupCurrentHeadAs}' already exists at ${existing}. Use a different name.` }],
      details: { error: "duplicate_backup_name", name: params.backupCurrentHeadAs, owners: conflicting },
     };
    }
    const backupPriorLabels = getEntryLabels(labelMaps, backupEntryId);
    if (!backupPriorLabels.includes(params.backupCurrentHeadAs)) {
     try {
      setEntryLabel(sm, backupEntryId, params.backupCurrentHeadAs);
     } catch (e) {
      return {
       content: [{ type: "text" as const, text: `Error: backup label '${params.backupCurrentHeadAs}' could not be set: ${e instanceof Error ? e.message : String(e)}. Travel aborted.` }],
       details: { error: "backup_label_failed", name: params.backupCurrentHeadAs, message: e instanceof Error ? e.message : String(e) },
      };
     }
    }
   }

   const travelDetails: TravelSummaryDetails = {
    originId,
    originLabel,
    target: params.target,
    targetId: tid,
    backupCurrentHeadAs: params.backupCurrentHeadAs ?? null,
   };
   const enrichedMessage = `${params.summary}`;

   let summaryEntryId: string | undefined;
   try {
    summaryEntryId = branchWithSummary(sm, tid, enrichedMessage, travelDetails);
   } catch (e) {
    return {
     content: [{ type: "text" as const, text: `Error: branchWithSummary failed: ${e instanceof Error ? e.message : String(e)}` }],
     details: { error: "branch_failed" },
    };
   }

   pendingContextRefresh = enrichedMessage;

   const afterMessages = getBuildSessionMessages(sm) ?? [];
   const messagesAfter = afterMessages.length;
   const estimatedUsageAfter = estimateUsageAfterMessageChange(usageBefore, currentMessages, afterMessages);
   const estimatedUsageAfterText = formatContextUsage(estimatedUsageAfter, true);
   const estimatedEffect = classifyTravelEffect(usageBefore, estimatedUsageAfter);
   const structuralEffect = classifyStructuralMessageEffect(messagesBefore, messagesAfter);
   const backupText = params.backupCurrentHeadAs
    ? backupResolvedFromHead
      ? `${params.backupCurrentHeadAs}@${backupEntryId} (resolved from HEAD ${backupResolvedFromHead})`
      : `${params.backupCurrentHeadAs}@${backupEntryId}`
    : "none";
   const messageDelta = messagesBefore !== undefined && messagesAfter !== undefined
    ? `${messagesBefore} → ${messagesAfter} (${structuralEffect})`
    : "unknown";

   return {
    content: [{
     type: "text" as const,
     text: [
      `Travel complete. target=${params.target} (${tid}); backupCurrentHeadAs=${backupText}; context ${usageBeforeText} → ${estimatedUsageAfterText} est. (estimatedEffect=${estimatedEffect}); sessionMessages=${messageDelta}; summaryEntry=${summaryEntryId}.`,
      estimatedUsagePreview
       ? `Pre-travel preview was ${estimatedPreviewText} est. — compare with post-travel estimate above.`
       : null,
      "Estimates use buildSessionContext + token model; official % confirms on the next LLM context event or acm_timeline.",
      "Note: the branch summary entry is appended synchronously and may appear before this tool call in the session log.",
     ].filter((line): line is string => line !== null).join("\n"),
    }],
    details: {
     target: params.target,
     targetId: tid,
     originId,
     originLabel,
     hasBackup: !!params.backupCurrentHeadAs,
     backupCurrentHeadAs: params.backupCurrentHeadAs ?? null,
     backupEntryId,
     backupResolvedFromHead,
     usageBefore: usageBeforeText,
     usageAfter: "pending_next_context_event",
     estimatedUsagePreview: estimatedPreviewText,
     estimatedUsageAfter: estimatedUsageAfterText,
     estimatedEffect,
     structuralMessagesBefore: messagesBefore,
     structuralMessagesAfter: messagesAfter,
     structuralEffect,
     messagesBefore,
     messagesAfter,
     summaryEntryId,
     fromOffPath: resolved.fromOffPath,
    },
   };
  },
 });

 // ── Event: context → persistent message rebuild after travel ────────────
 // After branchWithSummary, the tree is correct but agent memory is stale.
 // On EVERY LLM call while pendingContextRefresh is set, rebuild messages
 // from the current branch via buildSessionContext(). This includes both
 // the original context up to target + summary AND any new messages added
 // after travel (new conversation grows naturally on the branch).
 // Cleared on session_shutdown only.
 pi.on("context", (event, ctx: ExtensionContext) => {
  if (!pendingContextRefresh) return;

  // Guarded runtime cast: ReadonlySessionManager is the full SessionManager at runtime.
  const sm = ctx.sessionManager as unknown as
   { buildSessionContext?: () => { messages: unknown[] } };
  if (typeof sm.buildSessionContext !== "function") return;

  const sessionContext = sm.buildSessionContext();
  return { messages: sessionContext.messages as typeof event.messages };
 });

 // ── Session lifecycle: clear stale state ───────────────────
 pi.on("session_shutdown", () => {
  pendingContextRefresh = null;
  pendingGhostSessions.clear();
 });

}
