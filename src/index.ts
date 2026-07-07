import type {
 ExtensionAPI,
 ExtensionContext,
} from "@oh-my-pi/pi-coding-agent/extensibility/extensions/types";
import type { ReadonlySessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import type {
 SessionEntry,
 SessionTreeNode,
} from "@oh-my-pi/pi-coding-agent/session/session-entries";
import type { TextContent, ImageContent, ToolCall, TSchema, ThinkingContent, RedactedThinkingContent, AnthropicFallbackContent } from "@oh-my-pi/pi-ai/types";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core/types";
import {
 ACM_INTERNAL_TOOLS as INTERNAL_TOOLS,
 buildLabelMaps,
 classifyStructuralMessageEffect,
 classifyTravelEffect,
 compareEntriesByTimestamp,
 entryMatchesLabelSearch,
 estimateUsageAfterMessageChange,
 estimateUsageAtTravelTarget,
 extractTextFromContent,
 findCheckpointLabelOwner,
 findInTree,
 findLastMeaningfulEntry as findLastMeaningfulEntryCore,
 formatBoundaryTravelCue,
 formatContextUsage,
 formatEntryLabels,
 formatFoldCandidatePreview,
 getBuildSessionMessages,
 getEntryLabels,
 getMeaningfulSkipReason,
 ContextRefreshRegistry,
 isValidEntryId,
 pushTreeChildrenPreOrder,
 resolveTargetId,
 resolveTimelineMode,
 type MeaningfulResolveResult,
 type LabelMaps,
 HANDOFF_SLOT_HINT,
 type UsageLike,
} from "./lib.js";

/** Content part types that can appear in assistant message arrays. */
type AssistantContentPart = TextContent | ThinkingContent | RedactedThinkingContent | ToolCall | AnthropicFallbackContent;

function formatBackupText(
 name: string | undefined,
 entryId: string | undefined,
 resolvedFromHead: string | undefined,
): string {
 if (!name || !entryId) return "none";
 if (resolvedFromHead) {
  return `${name}@${entryId} (resolved from HEAD ${resolvedFromHead})`;
 }
 return `${name}@${entryId}`;
}

function getMessageRoleLabel(entry: SessionEntry): string | undefined {
 if (entry.type !== "message") return undefined;
 const msg = entry.message;
 if (msg.role === "assistant") return "AI";
 if (msg.role === "user") return "USER";
 if (msg.role === "toolResult") return `TOOL:${msg.toolName}`;
 if (msg.role === "bashExecution") return "BASH";
 if (msg.role === "custom") return "CUSTOM";
 if ((msg.role as string) === "system") return "SYSTEM";
 return msg.role.toUpperCase();
}

function isCheckpointableMessage(entry: SessionEntry): boolean {
 if (entry.type !== "message") return false;
 const role = entry.message.role;
 return role === "user" || role === "assistant";
}

function describeEntrySnippet(entry: SessionEntry, maxLen = 60): string {
 const content = getMsgContent(entry, false).replace(/\s+/g, " ").trim();
 if (!content) return "";
 return content.length > maxLen ? `${content.slice(0, maxLen)}...` : content;
}

function describeSkipReason(reason: ReturnType<typeof getMeaningfulSkipReason>, role?: string): string {
 switch (reason) {
  case "non_message": return "non-message node";
  case "tool_result": return role ?? "tool result";
  case "bash_execution": return "bash execution";
  case "custom_message": return "custom message";
  case "system_message": return "system message";
  case "internal_tool_only_assistant": return "internal-tool-only AI turn";
  case "empty_assistant": return "empty AI turn";
  case "empty_user": return "empty user turn";
  default: return "skipped";
 }
}

function findLastMeaningfulEntry(
 branch: SessionEntry[],
 signal?: AbortSignal,
): MeaningfulResolveResult {
 return findLastMeaningfulEntryCore(
  branch,
  getMeaningfulSkipReason,
  getMessageRoleLabel,
  (entry) => describeEntrySnippet(entry),
  signal,
 );
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

function isTravelSummaryDetails(details: unknown): details is TravelSummaryDetails {
 if (typeof details !== "object" || details === null) return false;
 const d = details as Record<string, unknown>;
 if (typeof d.originId !== "string") return false;
 if (d.originLabel !== undefined && typeof d.originLabel !== "string") return false;
 if (typeof d.target !== "string") return false;
 if (typeof d.targetId !== "string") return false;
 if (
  d.backupCurrentHeadAs !== undefined &&
  d.backupCurrentHeadAs !== null &&
  typeof d.backupCurrentHeadAs !== "string"
 ) return false;
 return true;
}

function getBranchSummaryMetaParts(entry: SessionEntry): string[] {
 if (entry.type !== "branch_summary") return [];
 const parts = [`branchPoint: ${entry.fromId}`];
 const details = isTravelSummaryDetails(entry.details) ? entry.details : undefined;
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
 *  Passing label=undefined appends a journal entry that clears ALL aliases on
 *  the target node — only safe when that entry had no prior labels. */
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
 const result = full.branchWithSummary(branchFromId, summary, details, true);
 if (typeof result !== "string" || result.length === 0) {
  throw new Error(`branchWithSummary returned invalid entry id: ${typeof result}`);
 }
 return result;
}

// ── Content extraction for timeline ───────────────────────────

/** Extract plain text from user/assistant/system/custom message content. */
function extractMessageText(content: unknown): string {
 return extractTextFromContent(content);
}

/** Extract a human-readable summary string from a session entry. */
function getMsgContent(entry: SessionEntry, verbose: boolean): string {
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
 if ((msg.role as string) === "system" || msg.role === "custom") {
  const text = "content" in msg ? extractMessageText(msg.content) : "";
  const label = (msg.role as string) === "system" ? "System" : "Custom";
  return text ? `[${label}] ${text}` : "";
 }

 if (msg.role === "user" || msg.role === "assistant") {
  let text = extractMessageText(msg.content);
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
  if (m.role === "custom") return "CUSTOM";
  if ((m.role as string) === "system") return "SYSTEM";
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

 const content = getMsgContent(entry, false).replace(/\s+/g, " ");
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
  if (n.children?.length) pushTreeChildrenPreOrder(searchStack, n.children);
  const checkpointLabels = formatEntryLabels(labelMaps, n.entry.id) ?? "";
  const content = getMsgContent(n.entry, false);
  if (
   checkpointLabels.toLowerCase().includes(searchTerm) ||
   entryMatchesLabelSearch(labelMaps, n.entry.id, searchTerm) ||
   content.toLowerCase().includes(searchTerm) ||
   n.entry.id.toLowerCase().includes(searchTerm)
  ) {
   matched.push({ node: n, checkpointLabels, content });
  }
 }
 matched.sort((a, b) => compareEntriesByTimestamp(a.node.entry, b.node.entry));
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

// ── Post-processing: fix orphaned tool_use after travel ────────

// After branchWithSummary, the rebuilt message array may have an assistant
// message with tool_use blocks whose tool_results are on the abandoned branch.
// The LLM API requires every tool_use to have a corresponding tool_result in
// the immediately following message. This function injects synthetic tool_result
// messages for any orphaned tool_use blocks.
/** Type guard: detect a ToolCall content block in an unknown array element. */
function isToolCallBlock(block: unknown): block is ToolCall {
 return (
  typeof block === "object" &&
  block !== null &&
  "type" in block &&
  block.type === "toolCall" &&
  "id" in block &&
  "name" in block
 );
}

function fixOrphanedToolUse(messages: AgentMessage[]): AgentMessage[] {
 const result = [...messages];

 // Pass 1: Remove orphaned toolResult messages (toolResult references a
 // toolCallId not present in the preceding assistant message's tool_use blocks).
 for (let i = result.length - 1; i >= 0; i--) {
  const msg = result[i];
  if (msg.role !== "toolResult") continue;
  const toolCallId = msg.toolCallId;
  if (!toolCallId) {
   // A toolResult without toolCallId is invalid — remove it.
   result.splice(i, 1);
   continue;
  }

  let handled = false;
  for (let j = i - 1; j >= 0; j--) {
   const prev = result[j];
   if (prev.role === "assistant" && Array.isArray(prev.content)) {
    const hasMatch = prev.content.some(
     (block: unknown) => isToolCallBlock(block) && block.id === toolCallId,
    );
    if (!hasMatch) {
     result.splice(i, 1);
    }
    handled = true;
    break;
   } else if (prev.role === "toolResult") {
    continue;
   } else {
    result.splice(i, 1);
    handled = true;
    break;
   }
  }
  // Inner loop exhausted without finding assistant or non-toolResult — orphaned.
  if (!handled) {
   result.splice(i, 1);
  }
 }

 // Pass 2: Inject synthetic toolResults for orphaned tool_use blocks
 // (assistant has tool_use but no subsequent toolResult with matching ID).
 for (let i = 0; i < result.length; i++) {
  const msg = result[i];
  if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;

  const toolUseIds: { id: string; name: string }[] = [];
  for (const block of msg.content as unknown[]) {
   if (isToolCallBlock(block)) {
    if (block.id) toolUseIds.push({ id: block.id, name: block.name });
   }
  }
  if (toolUseIds.length === 0) continue;

  const resolvedIds = new Set<string>();
  for (let j = i + 1; j < result.length; j++) {
   const tr = result[j];
   if (tr.role === "toolResult") {
    if (tr.toolCallId) resolvedIds.add(tr.toolCallId);
   } else {
    break;
   }
  }

  const orphaned = toolUseIds.filter((t) => !resolvedIds.has(t.id));
  if (orphaned.length === 0) continue;

  const synthetics: AgentMessage[] = orphaned.map((t) => ({
   role: "toolResult" as const,
   toolCallId: t.id,
   toolName: t.name,
   content: [{ type: "text" as const, text: "[Interrupted by context travel]" }],
   timestamp: Date.now(),
   isError: true,
  }));

  // Insert synthetics immediately after the assistant message. LLM APIs
  // match tool_result to tool_use by toolCallId, not by position.
  result.splice(i + 1, 0, ...synthetics);
  i += synthetics.length;
 }

 return result;
}

// ── Extension factory ─────────────────────────────────────────

export default function(pi: ExtensionAPI): void {
 const zod = pi.zod;
 /** Per-extension-instance refresh state (avoids cross-instance sharing on hot reload). */
 const contextRefresh = new ContextRefreshRegistry();
 /** Accurate token cache from turn_end — keyed by session manager for per-session isolation. */
 const cachedUsageMap = new WeakMap<object, UsageLike>();
 const registerTool = (tool: Parameters<ExtensionAPI["registerTool"]>[0] & { strict?: boolean }) => pi.registerTool(tool);

 // ── Tool: acm_checkpoint ───────────────────────────────────
 const checkpointSchema = zod.object({
  name: zod.string().min(1).max(64).regex(/^[\w\-\.]+$/).describe(
   "Unique semantic anchor name. Use '<name>-start' for the beginning of a boundary you may later compress: task chain, phase, burst, or risky attempt. Use '<name>-done' for a milestone/archive pointer after results are in hand. E.g. parser-fix-start, timeout-investigation-start, root-cause-done. Avoid generic names like start, checkpoint-1. Only letters, digits, hyphens, underscores, and dots. Max 64 chars.",
  ),
  target: zod.string().min(1).optional().describe(
   "History node ID or checkpoint name to label. Defaults to current meaningful position near HEAD.",
  ),
 });

 registerTool({
  name: "acm_checkpoint",
  label: "ACM Checkpoint",
  description:
   "Create a recoverability anchor on a conversation node. Zero cost: no branch, no handoff, no context change. Checkpoint before task chains, phase starts, bursts whose output cannot be bounded, risky steps, and milestones. A checkpoint does not fold context; it makes a future boundary fold possible. Names are unique across the session tree; one node may hold multiple aliases. The result reports context usage and fold candidates — choose by boundary, not proximity.",
  parameters: checkpointSchema as unknown as TSchema,
  strict: false,
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
    id = resolved.id;
    if (!isValidEntryId(id)) {
     return {
      content: [{ type: "text" as const, text: "Error: Cannot checkpoint root — session tree is empty." }],
      details: { error: "empty_session", requestedTarget: params.target },
     };
    }
    if (params.target.toLowerCase() === "root" && tree.length > 1) {
     ctx.ui.notify(
      `Note: 'root' resolved to the first top-level node (${id}); this session has ${tree.length} top-level roots.`,
      "info",
     );
    }
    targetEntry = findEntryInTree(tree, id);
    if (!targetEntry) {
     const hint = " Use acm_timeline to choose the last clean node before the boundary you want to label; raw node IDs are valid targets.";
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
    autoResolved = findLastMeaningfulEntry(branch, signal);
    id = autoResolved.entryId ?? "";
   }
   if (signal?.aborted || autoResolved?.aborted) {
    return {
     content: [{ type: "text" as const, text: "acm_checkpoint aborted." }],
     details: { error: "aborted" },
    };
   }

   if (!id) {
    const isEmpty = branch.length === 0;
    const msg = isEmpty
     ? "No session entry to checkpoint. The conversation is empty."
     : "No meaningful entry to checkpoint. Recent HEAD traffic is tool/bash/custom/system-only or empty — specify a target explicitly.";
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
   const explicitRole = targetEntry ? getMessageRoleLabel(targetEntry) : "NODE";
   // Push context usage plus a fold preview into every checkpoint result,
   // so the agent sees its fill level and the concrete benefit of folding
   // to the previous anchor during normal work, without calling acm_timeline.
   const usage = ctx.getContextUsage();
   const usageText = formatContextUsage(usage, true);
   // Nearest previous anchor behind HEAD — the phase-fold target.
   let prevAnchorLabel: string | null = null;
   let prevAnchorEntryId: string | null = null;
   for (let i = branch.length - 1; i >= 0; i--) {
    const eid = branch[i].id;
    if (eid === id) continue;
    const labels = getEntryLabels(labelMaps, eid);
    if (labels.length > 0) {
     prevAnchorLabel = labels[labels.length - 1];
     prevAnchorEntryId = eid;
     break;
    }
   }
   // Earliest on-path '-start' anchor — the task-chain fold target.
   let earliestStartLabel: string | null = null;
   let earliestStartEntryId: string | null = null;
   for (let i = 0; i < branch.length; i++) {
    const eid = branch[i].id;
    if (eid === id) continue;
    const startLabel = getEntryLabels(labelMaps, eid).find((l) => l.endsWith("-start"));
    if (startLabel) {
     earliestStartLabel = startLabel;
     earliestStartEntryId = eid;
     break;
    }
   }
   let foldPreview = "";
   let estimatedAtPrevAnchor: UsageLike | undefined;
   let estimatedAtEarliestStart: UsageLike | undefined;
   if (usage && (prevAnchorEntryId || earliestStartEntryId)) {
    const currentMessages = getBuildSessionMessages(sm);
    const previewParts: string[] = [];
    if (prevAnchorEntryId && prevAnchorLabel) {
     estimatedAtPrevAnchor = estimateUsageAfterMessageChange(
      usage, currentMessages, getBuildSessionMessages(sm, prevAnchorEntryId),
     );
     if (estimatedAtPrevAnchor) {
      previewParts.push(`nearest anchor '${prevAnchorLabel}' → phase/burst candidate ~${formatContextUsage(estimatedAtPrevAnchor, true)} est.`);
     }
    }
    if (earliestStartEntryId && earliestStartLabel && earliestStartEntryId !== prevAnchorEntryId) {
     estimatedAtEarliestStart = estimateUsageAfterMessageChange(
      usage, currentMessages, getBuildSessionMessages(sm, earliestStartEntryId),
     );
     if (estimatedAtEarliestStart) {
      previewParts.push(`earliest on-path -start '${earliestStartLabel}' → possible task-chain candidate ~${formatContextUsage(estimatedAtEarliestStart, true)} est.`);
     }
    }
    if (previewParts.length > 0) {
     foldPreview = formatFoldCandidatePreview(previewParts);
    }
   }
   // Name-triggered directive: a '-done' checkpoint marks finished work — the
   // fold that closes it should follow immediately, not wait for the next message.
   let doneDirective = "";
   if (params.name.endsWith("-done")) {
    const base = params.name.slice(0, -"-done".length);
    const siblingStart = `${base}-start`;
    const startRef = labelMaps.labelToEntryId.has(siblingStart) ? siblingStart : "<task>-start";
    doneDirective = ` '${params.name}' is a milestone/archive pointer. If later work moves past it, this is a recovery target. If this closes the task, fold before the final answer and answer from the handoff: acm_travel({ target: "${startRef}", summary: <${HANDOFF_SLOT_HINT} handoff> }) — this '-done' label bookmarks the raw archive path.`;
   }
   const usageSuffix = ` Context usage: ${usageText}.${foldPreview}${doneDirective}`;
   return {
    content: [{
     type: "text" as const,
     text: autoResolved
      ? `Created checkpoint '${params.name}' at ${id} (${formatMeaningfulResolveSummary(autoResolved)}).${aliasSuffix}${usageSuffix}`
      : `Created checkpoint '${params.name}' at ${id} (${explicitRole}${params.target ? `, target='${params.target}'` : ""}).${aliasSuffix}${usageSuffix}`,
    }],
    details: {
     entryId: id,
     label: params.name,
     aliases: [...priorLabels, params.name],
     target: params.target ?? "auto",
     contextUsage: usage ? { percent: usage.percent, tokens: usage.tokens, contextWindow: usage.contextWindow } : null,
     previousAnchor: prevAnchorLabel,
     estimatedUsageAtPreviousAnchor: estimatedAtPrevAnchor ? formatContextUsage(estimatedAtPrevAnchor, true) : null,
     earliestStartAnchor: earliestStartLabel,
     estimatedUsageAtEarliestStart: estimatedAtEarliestStart ? formatContextUsage(estimatedAtEarliestStart, true) : null,
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
   "Show all messages including internal tool traffic, system/custom meta messages, and ACM tool calls. Applies only in default active-path mode; ignored when list_checkpoints, search, or full_tree is active.",
  ),
  full_tree: zod.boolean().optional().describe(
   "Show all branches including off-path nodes with IDs. Default false (active path only). Prefer list_checkpoints or search on large trees. Ignored when list_checkpoints or search is set.",
  ),
  list_checkpoints: zod.boolean().optional().describe(
   "List checkpoint labels across the full tree with node IDs and on-path/off-path tags. Display is capped at 50 — use search to narrow. Ignores verbose and full_tree when set.",
  ),
  search: zod.string().optional().describe(
   "Search the full session tree (active + off-path) for matching checkpoint labels, node IDs, or content. When set without list_checkpoints, returns matching nodes. With list_checkpoints, filters the checkpoint catalog. Mode precedence when multiple params are set: list_checkpoints > search > full_tree > default active path.",
  ),
 });

 registerTool({
  name: "acm_timeline",
  label: "ACM Timeline",
  description:
   "Inspect the conversation tree: active path (default), full tree, checkpoint catalog, or global search. Default shows the active path spine; search scans the entire tree including off-path branches. Call when choosing a travel target, when orientation is unclear, or to check context usage — list_checkpoints estimates what every anchor would leave after a fold. On large trees prefer list_checkpoints or search over full_tree.",
  parameters: timelineSchema as unknown as TSchema,
  strict: false,
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
   const timelineMode = resolveTimelineMode(params);
   const useFullTree = timelineMode === "full_tree";
   const listCheckpoints = timelineMode === "list_checkpoints";
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
    const currentMessages = getBuildSessionMessages(sm);
    const currentUsageText = formatContextUsage(usage, true);
    lines.push(
     `Checkpoints (${listings.length} total${searchTerm ? ` matching '${params.search}'` : ""}, showing up to ${listLimit}; cap 50). Current: ${currentMessages.length} msgs, ${currentUsageText}:`,
    );
    for (const cp of listings.slice(0, listLimit)) {
     const pathTag = cp.onActivePath ? "on-path" : "off-path";
     const headTag = cp.isHead ? ", *HEAD*" : "";
     const targetMessages = getBuildSessionMessages(sm, cp.entryId);
     const estimated = estimateUsageAfterMessageChange(usage, currentMessages, targetMessages);
     const estPart = estimated
      ? `~${targetMessages.length} msgs, ~${formatContextUsage(estimated, true)} est. (+summary)`
      : `~${targetMessages.length} msgs`;
     lines.push(`  ${cp.label} → ${cp.entryId} (${pathTag}${headTag}) ${estPart}`);
    }
    if (listings.length > listLimit) {
     lines.push(`  ... +${listings.length - listLimit} more — use search to narrow (display cap 50)`);
    }
   } else if (searchTerm) {
    const searchLimit = Math.min(limit > 0 ? limit : 50, 50);
    const { matches, truncated } = searchFullSessionTree(
     tree, labelMaps, searchTerm, searchLimit, signal,
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
     lines.unshift("⚠ tree truncated by depth/line limit — use list_checkpoints or search to see hidden nodes");
    }
   } else {
    const sequence: SessionEntry[] = [...branch];
    if (params.search !== undefined && searchTerm === "") lines.push("query is empty; showing active path");

    const contentCache = new Map<string, string>();
    for (const e of sequence) {
     if (signal?.aborted) break;
     contentCache.set(e.id, getMsgContent(e, verbose));
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

     // Hide system/custom meta messages unless verbose (count as hidden for accurate totals)
     if (!verbose && (role === "CUSTOM" || role === "SYSTEM")) { hiddenCount++; continue; }

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
   const officialUsage = ctx.getContextUsage();
   const officialStr = formatContextUsage(officialUsage, true);
   const lastLlmStr = cachedUsageMap.has(sm) ? formatContextUsage(cachedUsageMap.get(sm), true) : "N/A";

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

   const travelCue = formatBoundaryTravelCue(nearestCheckpointName);
   const refreshFailure = contextRefresh.getFailure(sm);
   const refreshPending = contextRefresh.isPending(sm);
   const hudParts = [
    `[Context Dashboard]`,
    `• Context Usage:    ${officialStr} (official)`,
    `• Last LLM Prompt:  ${lastLlmStr} (turn_end)`,
    `• Active Path:      ${branch.length} node(s) — LLM context follows this spine`,
    `• Off-path Summaries: ${offPathForks} branch point(s) with abandoned summaries`,
    `• Segment Size:     ${stepsSinceCheckpoint} steps since last checkpoint '${nearestCheckpointName ?? "None"}'`,
    `• Travel Cue:       ${travelCue}`,
   ];
   if (refreshFailure) {
    hudParts.push(`• Context Sync:     last travel refresh failed — ${refreshFailure}`);
   } else if (refreshPending) {
    const attempt = contextRefresh.getAttemptCount(sm);
    const retrySuffix = attempt > 0
     ? ` (retry ${attempt}/${ContextRefreshRegistry.MAX_ATTEMPTS})`
     : "";
    const pendingSuffix = contextRefresh.hasRebuilt(sm) ? "" : " (travel pending)";
    hudParts.push(`• Context Sync:     persistent rebuild active${pendingSuffix}${retrySuffix}`);
   }
   if (!listCheckpoints && !useFullTree) {
    hudParts.push(`• Tip:              large trees → list_checkpoints or search before full_tree`);
   } else if (useFullTree && treeTruncated) {
    hudParts.push(`• Tip:              tree truncated → list_checkpoints: true or search: "checkpoint-name"`);
   }
   const hud = [...hudParts, `---------------------------------------------------`].join("\n");

   return {
    content: [{ type: "text" as const, text: hud + "\n" + (lines.join("\n") || "(Root Path Only)") }],
    details: {
     contextUsage: officialUsage ? { percent: officialUsage.percent, tokens: officialUsage.tokens, contextWindow: officialUsage.contextWindow } : null,
     leafId: currentLeafId,
     nearestCheckpoint: nearestCheckpointName,
     stepsSinceCheckpoint,
     activePathNodes: branch.length,
     offPathSummaries: offPathForks,
     fullTree: useFullTree,
     listCheckpoints,
     timelineMode,
     search: searchTerm || null,
     verbose,
     treeTruncated,
     outputLines: lines.length,
     contextRefreshPending: refreshPending,
     contextRefreshFailure: refreshFailure ?? null,
    },
   };
  },
 });

 // ── Tool: acm_travel ───────────────────────────────────────
 const travelSchema = zod.object({
  target: zod.string().min(1).describe(
   "Checkpoint name, history node ID, or 'root'. Name the boundary first, then choose a target before that boundary. Use acm_timeline with full_tree or search to see labels and node IDs.",
  ),
  summary: zod.string().min(1).max(10000).describe(
   `Handoff summary — the working state after travel. It must make the next action executable without rereading the folded trail. Fill every slot, write 'none' rather than dropping one: ${HANDOFF_SLOT_HINT}. Include recovery pointers; pointers over dumps. Max 10000 chars.`,
  ),
  backupCurrentHeadAs: zod.string().min(1).max(64).regex(/^[\w\-\.]+$/).optional().describe(
   "Optional archive bookmark for the raw path being folded away. At task end use '<task>-done'. This is a recovery pointer, never the travel target and never a substitute for a self-contained handoff. Omit when the path being left already carries a checkpoint.",
  ),
 });

 registerTool({
  name: "acm_travel",
  label: "ACM Travel",
  description:
   "Fold conversation history into a recoverable handoff by traveling to a checkpoint, node ID, or root. Use at stable boundaries: burst distilled, phase complete, direction failed, batch item done, task chain complete, or new request over finished work. Name the boundary first, choose a target before that boundary, and write a handoff with executable NEXT plus recovery pointers. Fold by boundary, not proximity. At task end, set backupCurrentHeadAs to '<task>-done', travel to the semantic task-chain start, then answer from the handoff. Travel changes conversation history only, not disk files or external systems.",
  parameters: travelSchema as unknown as TSchema,
  strict: false,
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
   const tid = resolved.id;
   if (params.target.toLowerCase() === "root" && !isValidEntryId(tid)) {
    return {
     content: [{ type: "text" as const, text: "Error: Cannot travel to root — session tree is empty." }],
     details: { error: "empty_session", requestedTarget: params.target },
    };
   }
   if (params.target.toLowerCase() === "root" && tree.length > 1) {
    ctx.ui.notify(
     `Note: 'root' resolved to the first top-level node (${tid}); this session has ${tree.length} top-level roots.`,
     "info",
    );
   }
   const targetExists = findInTree(tree, (n) => n.entry.id === tid) !== undefined;
   if (!targetExists) {
    const hint = " Use acm_timeline to choose the last clean node before the boundary you want to compress; raw node IDs are valid targets.";
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
   const currentMessages = getBuildSessionMessages(sm);
   const targetMessages = getBuildSessionMessages(sm, tid);
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
   let backupLabelWrittenThisCall = false;
   let backupHadNoPriorLabels = false;
   if (params.backupCurrentHeadAs) {
    const headResolve = findLastMeaningfulEntry(branch, signal);
    if (headResolve.aborted) {
     return {
      content: [{ type: "text" as const, text: "acm_travel aborted during backup target resolution." }],
      details: { error: "aborted", target: params.target, targetId: tid },
     };
    }
    backupEntryId = headResolve.entryId ?? undefined;
    if (!backupEntryId) {
     return {
      content: [{ type: "text" as const, text: `Error: archive bookmark backupCurrentHeadAs '${params.backupCurrentHeadAs}' could not be placed — no meaningful USER/AI message found near HEAD. Travel aborted.` }],
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
    const backupOwner = findCheckpointLabelOwner(labelMaps, params.backupCurrentHeadAs, branchIds);
    if (backupOwner && backupOwner.entryId !== backupEntryId) {
     const existing = `${backupOwner.entryId}${backupOwner.onActivePath ? " (on-path)" : " (off-path)"}`;
     return {
      content: [{ type: "text" as const, text: `Error: archive bookmark name '${params.backupCurrentHeadAs}' already exists at ${existing}. Use a different backupCurrentHeadAs name; the handoff must still carry the executable state.` }],
      details: { error: "duplicate_backup_name", name: params.backupCurrentHeadAs, owner: backupOwner },
     };
    }
    const backupPriorLabels = getEntryLabels(labelMaps, backupEntryId);
    if (!backupPriorLabels.includes(params.backupCurrentHeadAs)) {
     backupHadNoPriorLabels = backupPriorLabels.length === 0;
     try {
      setEntryLabel(sm, backupEntryId, params.backupCurrentHeadAs);
      backupLabelWrittenThisCall = true;
     } catch (e) {
      return {
       content: [{ type: "text" as const, text: `Error: archive bookmark '${params.backupCurrentHeadAs}' could not be set: ${e instanceof Error ? e.message : String(e)}. Travel aborted.` }],
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
   let summaryEntryId: string | undefined;
   try {
    summaryEntryId = branchWithSummary(sm, tid, params.summary, travelDetails);
   } catch (e) {
    const errText = e instanceof Error ? e.message : String(e);
    let backupRolledBack = false;
    let backupRollbackFailed = false;
    let backupRollbackSkipped = false;
    if (backupLabelWrittenThisCall && backupEntryId) {
     if (backupHadNoPriorLabels) {
      try {
       setEntryLabel(sm, backupEntryId, undefined);
       backupRolledBack = true;
      } catch {
       backupRollbackFailed = true;
      }
     } else {
      backupRollbackSkipped = true;
     }
    }
    let backupNote = "";
    if (params.backupCurrentHeadAs) {
     if (backupRollbackSkipped) {
      backupNote = ` Backup label '${params.backupCurrentHeadAs}' remains on the tree (rollback skipped — entry had other checkpoint aliases).`;
     } else if (backupRollbackFailed) {
      backupNote = ` Backup label '${params.backupCurrentHeadAs}' was written but could not be rolled back.`;
     } else if (backupRolledBack) {
      backupNote = ` Backup label '${params.backupCurrentHeadAs}' was rolled back.`;
     } else if (backupLabelWrittenThisCall) {
      backupNote = ` Backup label '${params.backupCurrentHeadAs}' remains on the tree.`;
     }
    }
    return {
     content: [{ type: "text" as const, text: `Error: branchWithSummary failed: ${errText}.${backupNote}` }],
     details: {
      error: "branch_failed",
      backupCurrentHeadAs: params.backupCurrentHeadAs ?? null,
      backupEntryId,
      backupLabelWritten: backupLabelWrittenThisCall,
      backupRolledBack,
      backupRollbackFailed,
      backupRollbackSkipped,
     },
    };
   }

   contextRefresh.markPending(sm);

   const afterMessages = getBuildSessionMessages(sm);
   const messagesAfter = afterMessages.length;
   const estimatedUsageAfter = estimateUsageAfterMessageChange(usageBefore, currentMessages, afterMessages);
   const estimatedUsageAfterText = formatContextUsage(estimatedUsageAfter, true);
   const estimatedEffect = classifyTravelEffect(usageBefore, estimatedUsageAfter);
   const structuralEffect = classifyStructuralMessageEffect(messagesBefore, messagesAfter);
   const backupText = formatBackupText(params.backupCurrentHeadAs, backupEntryId, backupResolvedFromHead);
   const messageDelta = `${messagesBefore} → ${messagesAfter} (${structuralEffect})`;

   return {
    content: [{
     type: "text" as const,
     text: [
      `Travel complete. You are now on the handoff branch. target=${params.target} (${tid}); archive=${backupText}; context ${usageBeforeText} → ${estimatedUsageAfterText} est. (estimatedEffect=${estimatedEffect}, structuralEffect=${structuralEffect}); sessionMessages=${messageDelta}; summaryEntryId=${summaryEntryId}.`,
      "Treat the handoff as the working state: execute its NEXT. Raw trail is archived off-path; recover it via the archive pointer or timeline search.",
      "Context rebuild is now persistent: every subsequent LLM turn is rebuilt from the handoff branch until the next travel or session reload. Run acm_timeline if official token % or sync status is unclear.",
      estimatedUsagePreview
       ? `Pre-travel preview was ${estimatedPreviewText} est. — compare with post-travel estimate above.`
       : null,
      "Estimates use buildSessionContext + token model; official % confirms on the next LLM context event or acm_timeline.",
      "Note: the branch summary entry is appended synchronously and may appear before this tool call in the session log.",
      "If this was a task-end fold, give the final answer from the handoff. Otherwise checkpoint the next phase ('<phase>-start') before its first action.",
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
     sessionMessages: messageDelta,
     messagesBefore,
     messagesAfter,
     summaryEntryId,
     contextRefreshPending: true,
     fromOffPath: resolved.fromOffPath,
    },
   };
  },
 });

 // ── Event: context → persistent message rebuild after travel ─────────
 // After branchWithSummary, agent.state.messages stays stale — the extension
 // has no access to agent.replaceMessages (OMP core calls it after every tree
 // mutation; extensions don't). So rebuild from buildSessionContext() on EVERY
 // context event while a travel is active, so every LLM turn sees the new
 // branch. Pending is cleared only on session_start/shutdown or after repeated
 // rebuild failures (falls back to event.messages as a degraded mode).
 pi.on("context", (event, ctx: ExtensionContext) => {
  const sm = ctx.sessionManager;
  if (!contextRefresh.isPending(sm)) return;

  try {
   const messages = getBuildSessionMessages(sm);
   if (messages.length === 0) {
    const message = "rebuilt messages array is empty";
    const willRetry = contextRefresh.recordFailedAttempt(sm, message);
    ctx.ui.notify(
     willRetry
      ? `Context refresh after travel failed (${contextRefresh.getAttemptCount(sm)}/${ContextRefreshRegistry.MAX_ATTEMPTS}): ${message}. Will retry on next LLM turn.`
      : `Context refresh after travel failed: ${message}. Reload the session to sync messages.`,
     "warning",
    );
    return { messages: event.messages };
   }
   const fixed = fixOrphanedToolUse(messages);
   contextRefresh.markRebuilt(sm);
   return { messages: fixed as typeof event.messages };
  } catch (e) {
   const message = e instanceof Error ? e.message : String(e);
   const willRetry = contextRefresh.recordFailedAttempt(sm, message);
   ctx.ui.notify(
    willRetry
     ? `Context refresh after travel failed (${contextRefresh.getAttemptCount(sm)}/${ContextRefreshRegistry.MAX_ATTEMPTS}): ${message}. Will retry on next LLM turn.`
     : `Context refresh after travel failed: ${message}. Reload the session to sync messages.`,
    "warning",
   );
   return { messages: event.messages };
  }
 });

 // ── Event: turn_end → cache accurate token usage ─────────────
 pi.on("turn_end", (event, ctx: ExtensionContext) => {
  const msg = event.message;
  if (msg.role !== "assistant") return;
  const usage = msg.usage;
  if (!usage) return;
  const promptTokens = (usage.input ?? 0) + (usage.cacheRead ?? 0);
  const officialUsage = ctx.getContextUsage();
  const contextWindow = officialUsage?.contextWindow;
  if (typeof contextWindow === "number" && contextWindow > 0) {
   cachedUsageMap.set(ctx.sessionManager, { tokens: promptTokens, contextWindow, percent: (promptTokens / contextWindow) * 100 });
  }
 });

 // ── Event: session_before_compact → auto checkpoint ──────────
 pi.on("session_before_compact", (event, ctx: ExtensionContext) => {
 const sm = ctx.sessionManager;
 const branch = sm.getBranch();
 if (branch.length === 0) return;
 const labelMaps = buildLabelMaps(sm.getEntries());
 const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
 const checkpointName = `pre-compact-${ts}`;
 const resolve = findLastMeaningfulEntry(branch, event.signal);
 if (!resolve.entryId) return;
 const priorLabels = getEntryLabels(labelMaps, resolve.entryId);
 if (priorLabels.includes(checkpointName)) return;
 setEntryLabel(sm, resolve.entryId, checkpointName);
 });

 // ── Event: session_compact → sync refresh state ──────────────
 pi.on("session_compact", (_event, ctx: ExtensionContext) => {
  contextRefresh.clear(ctx.sessionManager);
  cachedUsageMap.delete(ctx.sessionManager);
 });

 // ── Session lifecycle: clear stale state ───────────────────
 pi.on("session_start", (_event, ctx: ExtensionContext) => {
  contextRefresh.clear(ctx.sessionManager);
  cachedUsageMap.delete(ctx.sessionManager);
 });

 pi.on("session_shutdown", (_event, ctx: ExtensionContext) => {
  contextRefresh.clear(ctx.sessionManager);
  cachedUsageMap.delete(ctx.sessionManager);
 });

}
