import type {
 ExtensionAPI,
 ExtensionContext,
} from "@oh-my-pi/pi-coding-agent/extensibility/extensions/types";
import type {
 SessionEntry,
 SessionTreeNode,
} from "@oh-my-pi/pi-coding-agent/session/session-entries";
import type { TextContent, ImageContent, ToolCall, TSchema, ThinkingContent, RedactedThinkingContent, AnthropicFallbackContent } from "@oh-my-pi/pi-ai/types";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core/types";
import {
 ACM_INTERNAL_TOOLS as INTERNAL_TOOLS,
 calculateUsageDelta,
 classifyStructuralMessageDirection,
 compareEntriesByTimestamp,
 entryMatchesLabelSearch,
 estimateUsageAfterMessageChange,
 estimateUsageAtTravelTarget,
 extractTextFromContent,
 findInTree,
 findLastMeaningfulEntry as findLastMeaningfulEntryCore,
 formatBoundaryTravelCue,
 formatContextUsage,
 formatEntryLabels,
 getEntryLabels,
 getMeaningfulSkipReason,
 ContextRefreshRegistry,
 isValidEntryId,
 pushTreeChildrenPreOrder,
 resolveTargetId,
 validateHandoffStructure,
 type MeaningfulResolveResult,
 type LabelMaps,
 HANDOFF_SLOT_HINT,
 type UsageLike,
} from "./lib.js";
import {
 getHostBridge,
 type BranchWithSummaryFailureDetails,
 type CheckpointLabelConflict,
 type CheckpointLabelPrevalidation,
} from "./host-bridge.js";
import { ACM_CORE, ACM_CORE_MARKER, GUIDANCE_CUES, RECOVERY_GUIDANCE, TOOL_DESCRIPTIONS } from "./generated-guidance.js";

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

function formatNumericValue(value: number | null, fractionDigits = 0): string {
 if (value === null || !Number.isFinite(value)) return "unknown";
 return value.toFixed(fractionDigits);
}

function formatSignedDelta(value: number | null, fractionDigits = 0, suffix = ""): string {
 if (value === null || !Number.isFinite(value)) return "unknown";
 const sign = value > 0 ? "+" : "";
 return `${sign}${value.toFixed(fractionDigits)}${suffix}`;
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

function parseBranchFailureDetails(details: unknown): BranchWithSummaryFailureDetails | undefined {
 if (typeof details !== "object" || details === null) return undefined;
 const record = details as Record<string, unknown>;
 if (typeof record.branchFromId !== "string") return undefined;
 if (record.leafBefore !== null && typeof record.leafBefore !== "string") return undefined;
 if (record.leafAfter !== null && typeof record.leafAfter !== "string") return undefined;
 if (typeof record.mutationApplied !== "boolean") return undefined;
 if (record.actualSummaryEntryId !== undefined && typeof record.actualSummaryEntryId !== "string") return undefined;
 return {
  branchFromId: record.branchFromId,
  leafBefore: record.leafBefore,
  leafAfter: record.leafAfter,
  mutationApplied: record.mutationApplied,
  returnedSummaryEntryId: record.returnedSummaryEntryId,
  actualSummaryEntryId: record.actualSummaryEntryId,
 };
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
  footnotes.push(`  :  [off-path] +${offPath.length - maxShow} more — use view search or tree`);
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
 pathOrder: number;
 timestamp: string;
}

function collectCheckpointListings(
 labelMaps: LabelMaps,
 backboneIds: Set<string>,
 currentLeafId: string | null,
 searchTerm: string,
 entriesById: Map<string, SessionEntry>,
 pathOrderById: Map<string, number>,
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
   pathOrder: pathOrderById.get(entryId) ?? Number.MAX_SAFE_INTEGER,
   timestamp: entriesById.get(entryId)?.timestamp ?? "",
  });
 }
 listings.sort((a, b) => {
  if (a.onActivePath !== b.onActivePath) return a.onActivePath ? -1 : 1;
  if (a.onActivePath && a.pathOrder !== b.pathOrder) return a.pathOrder - b.pathOrder;
  const timeOrder = a.timestamp.localeCompare(b.timestamp);
  if (timeOrder !== 0) return timeOrder;
  const entryOrder = a.entryId.localeCompare(b.entryId);
  return entryOrder !== 0 ? entryOrder : a.label.localeCompare(b.label);
 });
 return listings;
}

// ── Timeline: recursive tree renderer ─────────────────────────

// Recursive but bounded by maxDepth (capped at 50) — stack depth cannot exceed 50 frames.
function renderTreeNode(
 node: SessionTreeNode,
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
   children[i], labelMaps, currentLeafId, backboneIds, depth + 1, maxDepth, childPrefix,
   i === children.length - 1, lines, signal,
  );
  if (childTruncated) truncated = true;
 }
 return truncated || (depth >= maxDepth && children.length > 0);
}

interface TreeSearchMatch {
 node: SessionTreeNode;
 checkpointLabels: string;
 preview: string;
}

function createLiteralSearchPattern(searchTerm: string): RegExp {
 return new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

/** Match content without first normalizing and lower-casing every potentially
 * large tool result. Full display text is built only for matching entries. */
function entryContentMatchesSearch(entry: SessionEntry, pattern: RegExp): boolean {
 if (entry.type === "branch_summary" || entry.type === "compaction") {
  return pattern.test(entry.summary ?? "");
 }
 if (entry.type === "label") return pattern.test(`checkpoint: ${entry.label ?? ""}`);
 if (entry.type !== "message") return false;

 const message = entry.message;
 if (message.role === "toolResult") {
  if (pattern.test(message.toolName ?? "")) return true;
  const details = message.details as Record<string, unknown> | undefined;
  if (typeof details?.path === "string" && pattern.test(details.path)) return true;
  return Array.isArray(message.content) && message.content.some((part: unknown) => {
   if (typeof part !== "object" || part === null || !("type" in part) || !("text" in part)) return false;
   return part.type === "text" && typeof part.text === "string" && pattern.test(part.text);
  });
 }
 if (message.role === "bashExecution") return pattern.test(`[Bash] ${message.command ?? ""}`);
 if (message.role !== "user" && message.role !== "assistant") return false;
 if (typeof message.content === "string") return pattern.test(message.content);
 if (!Array.isArray(message.content)) return false;

 return message.content.some((part: unknown) => {
  if (typeof part !== "object" || part === null || !("type" in part)) return false;
  if (part.type === "text" && "text" in part && typeof part.text === "string") return pattern.test(part.text);
  if (message.role === "assistant" && part.type === "toolCall") {
   const toolCall = part as { name?: string; arguments?: unknown; id?: string };
   const callText = `call: ${toolCall.name ?? "unknown"}(${JSON.stringify(toolCall.arguments ?? {})}) ${toolCall.id ?? ""}`;
   return pattern.test(callText);
  }
  return false;
 });
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
 const searchStack: SessionTreeNode[] = [];
 pushTreeChildrenPreOrder(searchStack, tree);
 const contentPattern = createLiteralSearchPattern(searchTerm);
 let visited = 0;
 const maxVisited = 10000;
 while (searchStack.length > 0 && visited < maxVisited) {
  if (signal?.aborted) break;
  visited++;
  const n = searchStack.pop()!;
  if (n.children?.length) pushTreeChildrenPreOrder(searchStack, n.children);
  const checkpointLabels = formatEntryLabels(labelMaps, n.entry.id) ?? "";
  const cheapMatch = checkpointLabels.toLowerCase().includes(searchTerm) ||
   entryMatchesLabelSearch(labelMaps, n.entry.id, searchTerm) ||
   n.entry.id.toLowerCase().includes(searchTerm);
  if (cheapMatch || entryContentMatchesSearch(n.entry, contentPattern)) {
   const normalized = getMsgContent(n.entry, false).replace(/\s+/g, " ");
   matched.push({
    node: n,
    checkpointLabels,
    preview: normalized.length > 80 ? normalized.slice(0, 80) + "..." : normalized,
   });
  }
 }
 matched.sort((a, b) => {
  const timestampOrder = compareEntriesByTimestamp(a.node.entry, b.node.entry);
  return timestampOrder !== 0 ? timestampOrder : a.node.entry.id.localeCompare(b.node.entry.id);
 });
 return {
  matches: matched,
  visited,
  truncated: matched.length > searchLimit || searchStack.length > 0 || signal?.aborted === true,
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
 const displayedCount = Math.min(matches.length, searchLimit);
 lines.push(
  `Search '${searchQuery}': ${displayedCount} displayed${truncated ? "; additional matches truncated" : ` of ${matches.length} matching node(s)`}.`,
 );
 for (const m of matches.slice(0, searchLimit)) {
  const isHead = m.node.entry.id === currentLeafId;
  const role = getDisplayRole(m.node.entry);
  const body = m.preview;
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

export function fixOrphanedToolUse(messages: AgentMessage[]): AgentMessage[] {
 const result = [...messages];

 // Pass 1: Remove tool results that are not attached to the immediately
 // preceding assistant tool-call batch. Walking past sibling tool results is
 // valid; walking past any other role is not.
 for (let i = result.length - 1; i >= 0; i--) {
  const msg = result[i];
  if (msg.role !== "toolResult") continue;
  const toolCallId = msg.toolCallId;
  let precedingIndex = i - 1;
  while (precedingIndex >= 0 && result[precedingIndex].role === "toolResult") precedingIndex--;
  const preceding = precedingIndex >= 0 ? result[precedingIndex] : undefined;
  const hasMatchingCall = Boolean(
   toolCallId &&
   preceding?.role === "assistant" &&
   preceding.stopReason !== "error" &&
   preceding.stopReason !== "aborted" &&
   Array.isArray(preceding.content) &&
   preceding.content.some((block: unknown) => isToolCallBlock(block) && block.id === toolCallId),
  );
  if (!hasMatchingCall) result.splice(i, 1);
 }

 // Pass 2: Inject synthetic toolResults for orphaned tool_use blocks
 // (assistant has tool_use but no subsequent toolResult with matching ID).
 // Skip error/aborted assistants — OMP's downstream message transform removes
 // them before provider dispatch, so synthesizing a result here would create an
 // orphaned tool result that references a tool use the provider never receives.
 for (let i = 0; i < result.length; i++) {
  const msg = result[i];
  if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
  if (msg.stopReason === "error" || msg.stopReason === "aborted") continue;

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
 /** Stable fallback branch-summary leaf if tool-result persistence temporarily moves HEAD. */
 const refreshTargetLeafIds = new WeakMap<object, string>();
 const registerTool = (tool: Parameters<ExtensionAPI["registerTool"]>[0] & { strict?: boolean }) => pi.registerTool(tool);

 pi.on("before_agent_start", (event) => {
  if (event.systemPrompt.some((segment) => segment.includes(ACM_CORE_MARKER))) return undefined;
  return {
   systemPrompt: [...event.systemPrompt, `${ACM_CORE_MARKER}\n${ACM_CORE}`],
  };
 });

 // ── Tool: acm_checkpoint ───────────────────────────────────
 const checkpointSchema = zod.object({
  name: zod.string().min(1).max(64).regex(/^[\w\-\.]+$/).describe(
   "Unique semantic anchor name. Use '<name>-start' for the beginning of a boundary you may later compress: task chain, phase, burst, or risky attempt. Use '<name>-done' for a milestone/archive pointer after results are in hand. E.g. parser-fix-start, timeout-investigation-start, root-cause-done. Avoid generic names like start, checkpoint-1. Only letters, digits, hyphens, underscores, and dots. Max 64 chars.",
  ),
  target: zod.string().min(1).max(256).optional().describe(
   "History node ID or checkpoint name to label. Defaults to current meaningful position near HEAD.",
  ),
 });

 registerTool({
  name: "acm_checkpoint",
  label: "ACM Checkpoint",
  description: TOOL_DESCRIPTIONS.checkpoint,
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
   const bridge = getHostBridge(sm);
   const tree = bridge.getTree();
   const labelMaps = bridge.buildLabelMaps();

   // Label names must be unique across the tree; the same entry may hold multiple aliases.
   const branch = bridge.getBranch();
   const branchIds: Set<string> = new Set(branch.map((e: SessionEntry) => e.id));

   let id: string;
   let autoResolved: MeaningfulResolveResult | undefined;
   let targetEntry: SessionEntry | undefined;
   if (params.target) {
    const resolved = resolveTargetId(bridge, tree, params.target, branchIds, labelMaps);
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

   const appendResult = bridge.appendCheckpointLabel(id, params.name);
   if (!appendResult.ok) {
    if (appendResult.error === "label_conflict") {
     const conflict = appendResult.details as CheckpointLabelConflict | undefined;
     const onPath = conflict?.onActivePath ? "on-path" : "off-path";
     return {
      content: [{
       type: "text" as const,
       text: `Checkpoint '${params.name}' already belongs to ${conflict?.entryId ?? "unknown"} (${onPath}). ${RECOVERY_GUIDANCE.nameCollision}`,
      }],
      details: {
       error: "duplicate_name",
       label: params.name,
       name: params.name,
       entryId: conflict?.entryId ?? "",
       existingEntryId: conflict?.entryId ?? null,
       existingEntryOnActivePath: conflict?.onActivePath ?? null,
      },
     };
    }
    return {
     content: [{ type: "text" as const, text: `${appendResult.message}. ${RECOVERY_GUIDANCE.hostCapability}` }],
     details: {
      error: appendResult.error,
      label: params.name,
      name: params.name,
      entryId: id,
      message: appendResult.message,
      resolvedEntryId: id,
      hostBridgeMessage: appendResult.message,
     },
    };
   }

   const { status, aliases, labelEntryId } = appendResult.value;
   const resolvedEntry = targetEntry ?? findEntryInTree(tree, id);
   const role = autoResolved?.role ?? (resolvedEntry ? getMessageRoleLabel(resolvedEntry) : undefined) ?? resolvedEntry?.type.toUpperCase() ?? "NODE";
   const usage = ctx.getContextUsage();
   const usageText = usage ? formatContextUsage(usage, true) : "unknown";
   const cue = params.name.endsWith("-done") ? GUIDANCE_CUES.checkpointDone : GUIDANCE_CUES.checkpointStart;
   const skippedCount = autoResolved?.skipped.length;
   const placement = autoResolved
    ? `${role}${skippedCount ? `; skipped ${skippedCount} nearer transient/non-meaningful entr${skippedCount === 1 ? "y" : "ies"}` : ""}`
    : `${role}; explicit target '${params.target}'`;
   const action = status === "already_present" ? "Reused" : "Created";
   const aliasesText = aliases.join(", ");
   return {
    content: [{
     type: "text" as const,
     text: `${action} checkpoint '${params.name}' at ${id} via label entry ${labelEntryId} (${placement}). Aliases: ${aliasesText}. Context usage: ${usageText}. ${cue}`,
    }],
    details: {
     status,
     alreadyPresent: status === "already_present",
     label: params.name,
     labelEntryId,
     entryId: id,
     resolvedEntryId: id,
     role,
     aliases,
     target: params.target ?? "auto",
     targetResolution: params.target ? "explicit" : "automatic",
     contextUsage: usage ? { percent: usage.percent, tokens: usage.tokens, contextWindow: usage.contextWindow } : null,
     contextUsageAvailable: usage !== undefined,
     skippedTransientCount: skippedCount ?? null,
     autoResolved: autoResolved
      ? {
         role: autoResolved.role,
         snippet: autoResolved.snippet,
         skippedCount: autoResolved.skipped.length,
         skipped: autoResolved.skipped,
        }
      : undefined,
     cue,
    },
   };
  },
 });

 // ── Tool: acm_timeline ─────────────────────────────────────
 const timelineLimitSchema = zod.number().int().min(1).max(50).default(50).describe(
  "Maximum recent visible entries (active), sorted aliases (checkpoints), matches (search), or traversal depth per root (tree). Range 1..50; default 50.",
 );
 const timelineViewSchema = zod.discriminatedUnion("view", [
  zod.object({
   view: zod.literal("active"),
   limit: timelineLimitSchema,
   verbose: zod.boolean().optional().describe("Show all active-path messages, including internal tool traffic and system/custom metadata."),
  }).strict(),
  zod.object({
   view: zod.literal("checkpoints"),
   limit: timelineLimitSchema,
   filter: zod.string().trim().min(1).max(500).optional().describe("Optional non-blank checkpoint label or entry-ID filter, matched case-insensitively."),
  }).strict(),
  zod.object({
   view: zod.literal("search"),
   limit: timelineLimitSchema,
   query: zod.string().trim().min(1).max(500).describe("Required non-blank full-tree query matching labels, node IDs, or rendered content case-insensitively."),
  }).strict(),
  zod.object({
   view: zod.literal("tree"),
   limit: timelineLimitSchema,
  }).strict(),
 ]);
 const timelineSchema = zod.preprocess((rawParams) => {
  if (typeof rawParams !== "object" || rawParams === null || Array.isArray(rawParams) || "view" in rawParams) return rawParams;
  return { ...rawParams, view: "active" };
 }, timelineViewSchema);

 registerTool({
  name: "acm_timeline",
  label: "ACM Timeline",
  description: TOOL_DESCRIPTIONS.timeline,
  parameters: timelineSchema as unknown as TSchema,
  strict: true,
  async execute(
   _id: string,
   rawParams: unknown,
   signal: AbortSignal | undefined,
   _onUpdate: unknown,
   ctx: ExtensionContext,
  ) {
   const params = timelineSchema.parse(rawParams);
   const sm = ctx.sessionManager;
   const bridge = getHostBridge(sm);
   const tree = bridge.getTree();
   const currentLeafId = bridge.getLeafId();
   const view = params.view;
   const verbose = view === "active" ? params.verbose ?? false : false;
   const limit = params.limit;
   const useFullTree = view === "tree";
   const listCheckpoints = view === "checkpoints";
   const searchTerm = (view === "search" ? params.query : view === "checkpoints" ? params.filter : undefined)?.toLowerCase() ?? "";

   const lines: string[] = [];
   const branch = bridge.getBranch();
   const entries: SessionEntry[] = bridge.getEntries();
   const entriesById = new Map<string, SessionEntry>(entries.map((entry: SessionEntry) => [entry.id, entry]));
   const labelMaps = bridge.buildLabelMaps();
   const backboneIds: Set<string> = new Set(branch.map((e: SessionEntry) => e.id));
   const pathOrderById = new Map<string, number>(branch.map((entry: SessionEntry, index: number) => [entry.id, index]));
   const childIndex = buildChildIndex(tree);
   const offPathForks = countOffPathForks(branch, childIndex, backboneIds);
   let treeTruncated = false;
   let activeVisibleEntries = 0;
   let activeDisplayedEntries = 0;
   let activeOmittedEntries = 0;
   let checkpointsMatchingAliases = 0;
   let checkpointsDisplayedAliases = 0;
   let searchDisplayedMatches = 0;
   let searchWasTruncated = false;

   if (listCheckpoints) {
    const listings = collectCheckpointListings(
     labelMaps, backboneIds, currentLeafId, searchTerm, entriesById, pathOrderById,
    );
    checkpointsMatchingAliases = listings.length;
    checkpointsDisplayedAliases = Math.min(listings.length, limit);
    const listLimit = limit;
    const usage = ctx.getContextUsage();
    const currentMessagesResult = bridge.buildSessionMessages(currentLeafId);
    if (!currentMessagesResult.ok) {
     lines.push(`Checkpoints (${listings.length} matching aliases, 0 displayed). Current messages could not be built: ${currentMessagesResult.message}`);
     return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
      details: { error: currentMessagesResult.error, message: currentMessagesResult.message },
     };
    }
    const currentMessages = currentMessagesResult.value;
    const targetCache = new Map<string, AgentMessage[]>();
    const currentUsageText = formatContextUsage(usage, true);
    lines.push(
     `Checkpoints (${listings.length} matching aliases, ${checkpointsDisplayedAliases} displayed${searchTerm ? ` for '${params.filter}'` : ""}; cap 50). Current: ${currentMessages.length} msgs, ${currentUsageText}:`
    );
    for (const cp of listings.slice(0, listLimit)) {
     const pathTag = cp.onActivePath ? "on-path" : "off-path";
     const headTag = cp.isHead ? ", *HEAD*" : "";
     let targetMessages = targetCache.get(cp.entryId);
     if (!targetMessages) {
      const targetResult = bridge.buildSessionMessages(cp.entryId);
      targetMessages = targetResult.ok ? targetResult.value : [];
      targetCache.set(cp.entryId, targetMessages);
     }
     const estimated = estimateUsageAfterMessageChange(usage, currentMessages, targetMessages);
     const estPart = estimated
      ? `~${targetMessages.length} msgs, ~${formatContextUsage(estimated, true)} est. (+summary)`
      : `~${targetMessages.length} msgs`;
     lines.push(`  ${cp.label} → ${cp.entryId} (${pathTag}${headTag}) ${estPart}`);
    }
    if (listings.length > listLimit) {
     lines.push(`  ... +${listings.length - listLimit} more — use a narrower filter`);
    }
   } else if (view === "search") {
    const { matches, truncated } = searchFullSessionTree(
     tree, labelMaps, searchTerm, limit, signal,
    );
    searchDisplayedMatches = Math.min(matches.length, limit);
    searchWasTruncated = truncated;
    lines.push(...formatTreeSearchResults(matches, currentLeafId, params.query!, limit, truncated));
   } else if (useFullTree) {
    const maxDepth = limit;
    for (let i = 0; i < tree.length; i++) {
     if (signal?.aborted) break;
     const truncated = renderTreeNode(
     tree[i], labelMaps, currentLeafId, backboneIds, 1, maxDepth, "", i === tree.length - 1, lines, signal,
     );
     if (truncated) treeTruncated = true;
    }
    if (lines.length >= 200) treeTruncated = true;
    if (treeTruncated) {
     lines.unshift("⚠ tree truncated by depth/line limit — use view checkpoints or view search to see hidden nodes");
    }
   } else {
    const sequence: SessionEntry[] = [...branch];

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

    const allVisibleSequenceIds = new Set(visibleSequenceIds);
    const visibleEntries = sequence.filter((e: SessionEntry) => visibleSequenceIds.has(e.id));
    activeVisibleEntries = visibleEntries.length;
    activeDisplayedEntries = Math.min(visibleEntries.length, limit);
    activeOmittedEntries = Math.max(0, visibleEntries.length - limit);
    if (activeOmittedEntries > 0) {
     const allowedIds = new Set(visibleEntries.slice(-limit).map((e) => e.id));
     visibleSequenceIds.clear();
     allowedIds.forEach((id) => visibleSequenceIds.add(id));
    }

    if (activeOmittedEntries > 0) {
     lines.push(`  :  ... (${activeOmittedEntries} earlier visible entries omitted by limit) ...`);
    }
    let hiddenCount = 0;
    for (const entry of sequence) {
     if (signal?.aborted) break;
     if (!visibleSequenceIds.has(entry.id)) {
      if (!allVisibleSequenceIds.has(entry.id)) hiddenCount++;
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
    const attempts = contextRefresh.getAttemptCount(sm);
    const exhausted = attempts >= ContextRefreshRegistry.MAX_ATTEMPTS && !refreshPending;
    hudParts.push(`• Context Sync:     last travel refresh failed — ${refreshFailure}${exhausted ? ` ${RECOVERY_GUIDANCE.refreshExhausted}` : ""}`);
   } else if (refreshPending) {
    const attempt = contextRefresh.getAttemptCount(sm);
    const retrySuffix = attempt > 0
     ? ` (retry ${attempt}/${ContextRefreshRegistry.MAX_ATTEMPTS})`
     : "";
    const pendingSuffix = contextRefresh.hasRebuilt(sm) ? "" : " (travel pending)";
    hudParts.push(`• Context Sync:     persistent rebuild active${pendingSuffix}${retrySuffix}`);
   }
   const timelineCue = view === "active"
    ? GUIDANCE_CUES.timelineActive
    : view === "checkpoints"
      ? GUIDANCE_CUES.timelineCheckpoints
      : view === "search"
        ? GUIDANCE_CUES.timelineSearch
        : GUIDANCE_CUES.timelineTree;
   hudParts.push(`• Guidance:        ${timelineCue}`);
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
     view,
     limit,
     verbose,
     treeTruncated,
     activeVisibleEntries: view === "active" ? activeVisibleEntries : null,
     activeDisplayedEntries: view === "active" ? activeDisplayedEntries : null,
     activeOmittedEntries: view === "active" ? activeOmittedEntries : null,
     checkpointsMatchingAliases: view === "checkpoints" ? checkpointsMatchingAliases : null,
     checkpointsDisplayedAliases: view === "checkpoints" ? checkpointsDisplayedAliases : null,
     searchDisplayedMatches: view === "search" ? searchDisplayedMatches : null,
     searchTruncated: view === "search" ? searchWasTruncated : false,
     outputLines: lines.length,
     contextRefreshPending: refreshPending,
     contextRefreshFailure: refreshFailure ?? null,
    },
   };
  },
 });

 // ── Tool: acm_travel ───────────────────────────────────────
 const travelSchema = zod.object({
  target: zod.string().min(1).max(256).describe(
   "Checkpoint name, history node ID, or 'root'. Name the boundary first, then choose a target before that boundary. On large trees use acm_timeline with view checkpoints or search; use view tree only when the surrounding branch structure is needed.",
  ),
  summary: zod.string().min(1).max(10000).describe(
   `Handoff summary — the working state after travel. It must make the next action executable without rereading the folded trail. Fill every slot, write 'none' rather than dropping one: ${HANDOFF_SLOT_HINT}. Include recovery pointers; pointers over dumps. Max 10000 chars.`,
  ),
  backupCurrentHeadAs: zod.string().min(1).max(64).regex(/^[\w\-\.]+$/).optional().describe(
   "Optional archive bookmark for the raw path being folded away. At task end, use '<task>-done' when the preview shows meaningful structural saving and the path does not already carry a suitable '-done' checkpoint. If the preview shows almost no saving, create a unique '-done' checkpoint and answer directly instead of calling travel merely to set this field. This is a recovery pointer, never the travel target or a substitute for a self-contained handoff.",
  ),
 });

 registerTool({
  name: "acm_travel",
  label: "ACM Travel",
  description: TOOL_DESCRIPTIONS.travel,
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
   const handoffValidation = validateHandoffStructure(params.summary);
   if (!handoffValidation.ok) {
    return {
     content: [{ type: "text" as const, text: `Error: handoff must contain each non-empty slot once and in order: ${HANDOFF_SLOT_HINT}. Travel aborted before mutation.` }],
     details: { error: "invalid_handoff", validation: handoffValidation },
    };
   }

   const sm = ctx.sessionManager;
   const bridge = getHostBridge(sm);
   const tree = bridge.getTree();
   const branch = bridge.getBranch();
   const labelMaps = bridge.buildLabelMaps();
   const branchIds: Set<string> = new Set(branch.map((e: SessionEntry) => e.id));
   const requestedRoot = params.target.toLowerCase() === "root";
   const resolvedBy = requestedRoot ? "root" : labelMaps.labelToEntryId.has(params.target) ? "checkpoint" : "entry_id";
   const resolved = resolveTargetId(bridge, tree, params.target, branchIds, labelMaps);
   const tid = resolved.id;
   if (requestedRoot && !isValidEntryId(tid)) {
    return {
     content: [{ type: "text" as const, text: "Error: Cannot travel to root — session tree is empty." }],
     details: { error: "empty_session", requestedTarget: params.target },
    };
   }
   if (requestedRoot && tree.length > 1) {
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
   const currentLeaf = bridge.getLeafId();
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
   const currentMessagesResult = bridge.buildSessionMessages();
   if (!currentMessagesResult.ok) {
    return {
     content: [{ type: "text" as const, text: `Error: cannot build current session messages: ${currentMessagesResult.message}. Travel aborted.` }],
     details: { error: "build_messages_failed", message: currentMessagesResult.message, target: params.target, targetId: tid },
    };
   }
   const currentMessages = currentMessagesResult.value;
   const targetMessagesResult = bridge.buildSessionMessages(tid);
   if (!targetMessagesResult.ok) {
    return {
     content: [{ type: "text" as const, text: `Error: cannot build target session messages: ${targetMessagesResult.message}. Travel aborted.` }],
     details: { error: "build_messages_failed", message: targetMessagesResult.message, target: params.target, targetId: tid },
    };
   }
   const targetMessages = targetMessagesResult.value;
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
   let backupPrevalidation: CheckpointLabelPrevalidation | undefined;
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
   }

   const branchPrevalidation = bridge.prevalidateBranchWithSummary(tid);
   if (!branchPrevalidation.ok) {
    return {
     content: [{ type: "text" as const, text: `Error: travel host prevalidation failed: ${branchPrevalidation.message}. No mutation was attempted. ${RECOVERY_GUIDANCE.hostCapability}` }],
     details: {
      error: "branch_prevalidation_failed",
      hostError: branchPrevalidation.error,
      message: branchPrevalidation.message,
      target: params.target,
      targetId: tid,
     },
    };
   }

   if (params.backupCurrentHeadAs && backupEntryId) {
    const backupCheck = bridge.prevalidateCheckpointLabel(backupEntryId, params.backupCurrentHeadAs);
    if (!backupCheck.ok) {
     if (backupCheck.error === "label_conflict") {
      const conflict = backupCheck.details as CheckpointLabelConflict | undefined;
      const existing = `${conflict?.entryId ?? "unknown"}${conflict?.onActivePath ? " (on-path)" : " (off-path)"}`;
      return {
       content: [{ type: "text" as const, text: `Error: archive bookmark name '${params.backupCurrentHeadAs}' already exists at ${existing}. ${RECOVERY_GUIDANCE.nameCollision}` }],
       details: { error: "duplicate_backup_name", name: params.backupCurrentHeadAs, owner: conflict },
      };
     }
     return {
      content: [{ type: "text" as const, text: `Error: archive bookmark '${params.backupCurrentHeadAs}' failed prevalidation: ${backupCheck.message}. No mutation was attempted. ${RECOVERY_GUIDANCE.hostCapability}` }],
      details: { error: "backup_prevalidation_failed", name: params.backupCurrentHeadAs, message: backupCheck.message, recoveryAction: RECOVERY_GUIDANCE.hostCapability },
     };
    }
    backupPrevalidation = backupCheck.value;
   }

   if (signal?.aborted) {
    return {
     content: [{ type: "text" as const, text: "acm_travel aborted after prevalidation and before mutation." }],
     details: { error: "aborted", target: params.target, targetId: tid },
    };
   }

   let backupLabelWrittenThisCall = false;
   let backupHadNoPriorLabels = false;
   let backupLabelEntryId: string | undefined;
   if (params.backupCurrentHeadAs && backupEntryId && backupPrevalidation?.status === "would_create") {
    const backupAppend = bridge.appendCheckpointLabel(backupEntryId, params.backupCurrentHeadAs);
    if (!backupAppend.ok) {
     const labelOwner = bridge.buildLabelMaps().labelToEntryId.get(params.backupCurrentHeadAs);
     const labelRemaining = labelOwner === backupEntryId;
     return {
      content: [{ type: "text" as const, text: `Error: archive bookmark '${params.backupCurrentHeadAs}' could not be set: ${backupAppend.message}. Travel aborted. ${RECOVERY_GUIDANCE.hostCapability}${labelRemaining ? ` ${RECOVERY_GUIDANCE.rollbackFailed}` : ""}` }],
      details: {
       error: "backup_label_failed",
       name: params.backupCurrentHeadAs,
       message: backupAppend.message,
       backupEntryId,
       labelRemaining,
      },
     };
    }
    backupHadNoPriorLabels = backupPrevalidation.aliases.length === 0;
    backupLabelEntryId = backupAppend.value.labelEntryId;
    backupLabelWrittenThisCall = true;
   }

   const travelDetails: TravelSummaryDetails = {
    originId,
    originLabel,
    target: params.target,
    targetId: tid,
    backupCurrentHeadAs: params.backupCurrentHeadAs ?? null,
   };
   const branchResult = bridge.branchWithSummary(tid, params.summary, travelDetails);
   if (!branchResult.ok) {
    const branchFailure = parseBranchFailureDetails(branchResult.details);
    const mutationApplied = branchFailure?.mutationApplied ?? bridge.getLeafId() !== originId;
    let backupRolledBack = false;
    let backupRollbackFailed = false;
    let backupRollbackSkipped = false;
    let backupRollbackSkipReason: "branch_mutation_observed" | "prior_aliases" | null = null;

    if (backupLabelWrittenThisCall && backupLabelEntryId) {
     if (mutationApplied) {
      backupRollbackSkipped = true;
      backupRollbackSkipReason = "branch_mutation_observed";
     } else if (!backupHadNoPriorLabels) {
      backupRollbackSkipped = true;
      backupRollbackSkipReason = "prior_aliases";
     } else {
      const clear = bridge.clearCreatedLabel(backupLabelEntryId);
      const aliasesAfterRollback = backupEntryId
       ? bridge.buildLabelMaps().entryToLabels.get(backupEntryId) ?? []
       : [];
      const labelStillPresent = params.backupCurrentHeadAs
       ? aliasesAfterRollback.includes(params.backupCurrentHeadAs)
       : false;
      backupRolledBack = clear.ok || !labelStillPresent;
      backupRollbackFailed = !backupRolledBack;
     }
    }

    const aliasesAfterFailure = backupEntryId
     ? bridge.buildLabelMaps().entryToLabels.get(backupEntryId) ?? []
     : [];
    const backupLabelRemaining = params.backupCurrentHeadAs
     ? aliasesAfterFailure.includes(params.backupCurrentHeadAs)
     : false;
    const recoveryAction = backupRollbackFailed
     ? RECOVERY_GUIDANCE.rollbackFailed
     : backupRollbackSkipped || mutationApplied
      ? RECOVERY_GUIDANCE.rollbackSkipped
      : backupRolledBack
       ? RECOVERY_GUIDANCE.branchRolledBack
       : RECOVERY_GUIDANCE.hostCapability;

    let backupNote = "";
    if (backupRollbackSkipped && backupRollbackSkipReason === "branch_mutation_observed") {
     backupNote = ` Backup label '${params.backupCurrentHeadAs}' remains because branch mutation was observed.`;
    } else if (backupRollbackSkipped) {
     backupNote = ` Backup label '${params.backupCurrentHeadAs}' remains because the target had prior aliases.`;
    } else if (backupRollbackFailed) {
     backupNote = ` Backup label '${params.backupCurrentHeadAs}' remains at ${backupEntryId}; rollback failed.`;
    } else if (backupRolledBack) {
     backupNote = ` Backup label '${params.backupCurrentHeadAs}' was rolled back.`;
    } else if (backupLabelWrittenThisCall) {
     backupNote = ` Backup label '${params.backupCurrentHeadAs}' remains on the tree.`;
    }

    return {
     content: [{ type: "text" as const, text: `Error: branchWithSummary failed: ${branchResult.message}.${backupNote} ${recoveryAction}` }],
     details: {
      error: "branch_failed",
      hostError: branchResult.error,
      branchFailure: branchFailure ?? null,
      backupCurrentHeadAs: params.backupCurrentHeadAs ?? null,
      backupEntryId,
      backupLabelWritten: backupLabelWrittenThisCall,
      backupRolledBack,
      backupRollbackFailed,
      backupRollbackSkipped,
      backupRollbackSkipReason,
      remainingBackupLabel: backupLabelRemaining ? params.backupCurrentHeadAs ?? null : null,
      recoveryAction,
     },
    };
   }
   const summaryEntryId = branchResult.value.summaryEntryId;

   contextRefresh.markPending(sm);
   refreshTargetLeafIds.set(sm, summaryEntryId);

   const afterMessagesResult = bridge.buildSessionMessages();
   if (!afterMessagesResult.ok) {
    return {
     content: [{ type: "text" as const, text: `Travel mutation completed, but session-message evidence is unavailable: ${afterMessagesResult.message}. ${RECOVERY_GUIDANCE.refreshPending}` }],
     details: {
      error: "build_messages_failed",
      message: afterMessagesResult.message,
      target: params.target,
      targetId: tid,
      originId,
      summaryEntryId,
      resultingLeafId: branchResult.value.leafAfter,
      contextRefreshPending: true,
      recoveryAction: RECOVERY_GUIDANCE.refreshPending,
     },
    };
   }
   const afterMessages = afterMessagesResult.value;
   const messagesAfter = afterMessages.length;
   const estimatedUsageAfter = estimateUsageAfterMessageChange(usageBefore, currentMessages, afterMessages);
   const estimatedUsageAfterText = formatContextUsage(estimatedUsageAfter, true);
   const usageDelta = calculateUsageDelta(usageBefore, estimatedUsageAfter);
   const structuralMessageDelta = messagesAfter - messagesBefore;
   const structuralMessageDirection = classifyStructuralMessageDirection(messagesBefore, messagesAfter);
   const backupText = formatBackupText(params.backupCurrentHeadAs, backupEntryId, backupResolvedFromHead);
   const backupOutcome = !params.backupCurrentHeadAs
    ? "none"
    : backupPrevalidation?.status === "already_present"
     ? "already_present"
     : backupLabelWrittenThisCall
      ? "created"
      : "unknown";
   const messageDelta = `${messagesBefore} → ${messagesAfter} (${formatSignedDelta(structuralMessageDelta)}, ${structuralMessageDirection})`;
   const usageBeforeTokens = usageBefore?.tokens ?? null;
   const usageBeforePercent = usageBefore?.percent ?? null;
   const usageContextWindow = usageBefore?.contextWindow ?? estimatedUsageAfter?.contextWindow ?? null;
   const estimatedUsageAfterTokens = estimatedUsageAfter?.tokens ?? null;
   const estimatedUsageAfterPercent = estimatedUsageAfter?.percent ?? null;
   const usageBeforePercentText = usageBeforePercent === null ? "unknown" : `${usageBeforePercent.toFixed(1)}%`;
   const estimatedUsageAfterPercentText = estimatedUsageAfterPercent === null ? "unknown" : `${estimatedUsageAfterPercent.toFixed(1)}%`;
   const nextCue = params.backupCurrentHeadAs?.endsWith("-done")
    ? GUIDANCE_CUES.travelTask
    : GUIDANCE_CUES.travelPhase;

   return {
    content: [{
     type: "text" as const,
     text: [
      `Travel complete. target=${params.target} (${tid}); origin=${originLabel ? `${originLabel}@${originId}` : originId}; summaryEntryId=${summaryEntryId}; resultingLeafId=${branchResult.value.leafAfter}; backup=${backupText} (${backupOutcome}); contextTokens=${formatNumericValue(usageBeforeTokens)} → ${formatNumericValue(estimatedUsageAfterTokens)} est. (delta=${formatSignedDelta(usageDelta.tokenDelta)}); contextPercent=${usageBeforePercentText} → ${estimatedUsageAfterPercentText} est. (delta=${formatSignedDelta(usageDelta.percentagePointDelta, 1, " pp")}); sessionMessages=${messageDelta}; contextRefresh=pending.`,
      resolved.fromOffPath ? RECOVERY_GUIDANCE.restoredHistory : null,
      nextCue,
     ].filter((line): line is string => line !== null).join("\n"),
    }],
    details: {
     target: params.target,
     targetId: tid,
     resolvedBy,
     resolvedEntryId: tid,
     rootCount: requestedRoot ? tree.length : null,
     originId,
     originLabel,
     hasBackup: !!params.backupCurrentHeadAs,
     backupCurrentHeadAs: params.backupCurrentHeadAs ?? null,
     backupEntryId,
     backupResolvedFromHead,
     backupOutcome,
     usageBefore: usageBeforeText,
     usageAfter: "pending_next_context_event",
     estimatedUsagePreview: estimatedPreviewText,
     estimatedUsageAfter: estimatedUsageAfterText,
     usageBeforeTokens,
     usageBeforePercent,
     usageContextWindow,
     estimatedUsageAfterTokens,
     estimatedUsageAfterPercent,
     tokenDelta: usageDelta.tokenDelta,
     percentagePointDelta: usageDelta.percentagePointDelta,
     structuralMessagesBefore: messagesBefore,
     structuralMessagesAfter: messagesAfter,
     structuralMessageDelta,
     structuralMessageDirection,
     sessionMessages: messageDelta,
     messagesBefore,
     messagesAfter,
     summaryEntryId,
     resultingLeafId: branchResult.value.leafAfter,
     contextRefreshPending: true,
     contextRefreshState: "pending",
     fromOffPath: resolved.fromOffPath,
    },
   };
  },
 });

 // ── Event: context → request sanitation + persistent travel rebuild ─────
 // Sanitize every outbound request, including the first request after a
 // restored session. The in-memory travel registry is cleared at session_start,
 // but branchWithSummary can persist the acm_travel tool result after the branch
 // summary. On reload that result has no matching assistant tool call on the
 // active branch, so providers reject it unless it is removed even when no
 // travel refresh is pending.
 //
 // While a travel is active, rebuild from buildSessionContext() on every
 // context event. A stable summary-leaf fallback handles runtimes that
 // temporarily move HEAD while persisting the current tool result.
 pi.on("context", (event, ctx: ExtensionContext) => {
  const sm = ctx.sessionManager;
  const bridge = getHostBridge(sm);
  if (!contextRefresh.isPending(sm)) {
   const original = event.messages as AgentMessage[];
   const fixed = fixOrphanedToolUse(original);
   const changed = fixed.length !== original.length || fixed.some((message, index) => message !== original[index]);
   return changed ? { messages: fixed as typeof event.messages } : undefined;
  }

  const reportFailure = (message: string) => {
   const willRetry = contextRefresh.recordFailedAttempt(sm, message);
   const attempt = contextRefresh.getAttemptCount(sm);
   ctx.ui.notify(
    willRetry
     ? `Context refresh after travel failed (${attempt}/${ContextRefreshRegistry.MAX_ATTEMPTS}): ${message}. Will retry on the next LLM turn.`
     : `Context refresh after travel failed after ${attempt} attempts: ${message}. ${RECOVERY_GUIDANCE.refreshExhausted}`,
    "warning",
   );
   return { messages: event.messages };
  };

  try {
   const messagesResult = bridge.buildSessionMessages();
   if (!messagesResult.ok) return reportFailure(messagesResult.message);
   let messages = messagesResult.value;
   if (messages.length === 0) {
    const fallbackLeafId = refreshTargetLeafIds.get(sm);
    const fallbackResult = fallbackLeafId ? bridge.buildSessionMessages(fallbackLeafId) : { ok: true, value: [] };
    messages = fallbackResult.ok ? fallbackResult.value : [];
   }
   if (messages.length === 0) return reportFailure("rebuilt messages array is empty");

   const fixed = fixOrphanedToolUse(messages);
   contextRefresh.markRebuilt(sm);
   return { messages: fixed as typeof event.messages };
  } catch (e) {
   return reportFailure(e instanceof Error ? e.message : String(e));
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
  const bridge = getHostBridge(sm);
  const branch = bridge.getBranch();
  if (branch.length === 0) return;
  const labelMaps = bridge.buildLabelMaps();
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const checkpointBase = `pre-compact-${ts}`;
  let checkpointName = checkpointBase;
  for (let ordinal = 2; labelMaps.labelToEntryId.has(checkpointName); ordinal++) {
   checkpointName = `${checkpointBase}-${ordinal}`;
  }
  const resolve = findLastMeaningfulEntry(branch, event.signal);
  if (!resolve.entryId) return;
  const append = bridge.appendCheckpointLabel(resolve.entryId, checkpointName);
  if (!append.ok) {
   ctx.ui.notify(`Could not create pre-compaction checkpoint: ${append.message}`, "warning");
  }
 });

 // ── Event: session_compact → sync refresh state ──────────────
 pi.on("session_compact", (_event, ctx: ExtensionContext) => {
  contextRefresh.clear(ctx.sessionManager);
  refreshTargetLeafIds.delete(ctx.sessionManager);
  cachedUsageMap.delete(ctx.sessionManager);
 });

 // ── Session lifecycle: clear stale state ───────────────────
 pi.on("session_start", (_event, ctx: ExtensionContext) => {
  contextRefresh.clear(ctx.sessionManager);
  refreshTargetLeafIds.delete(ctx.sessionManager);
  cachedUsageMap.delete(ctx.sessionManager);
 });

 pi.on("session_shutdown", (_event, ctx: ExtensionContext) => {
  contextRefresh.clear(ctx.sessionManager);
  refreshTargetLeafIds.delete(ctx.sessionManager);
  cachedUsageMap.delete(ctx.sessionManager);
 });

}
