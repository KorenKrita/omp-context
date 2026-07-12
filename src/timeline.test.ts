import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/types";
import type { SessionEntry, SessionTreeNode } from "@oh-my-pi/pi-coding-agent/session/session-entries";
import { z } from "zod";
import registerACMExtension from "./index.js";
import { GUIDANCE_CUES } from "./generated-guidance.js";

type RegisteredTool = {
 name: string;
 strict?: boolean;
 parameters: { parse(value: unknown): unknown };
 execute: (id: string, params: unknown, signal: AbortSignal | undefined, onUpdate: unknown, ctx: unknown) => Promise<{
  content: Array<{ type: string; text: string }>;
  details: Record<string, unknown>;
 }>;
};

function message(id: string, parentId: string | null, text: string, timestamp: string): SessionEntry {
 return {
  id,
  type: "message",
  parentId,
  timestamp,
  message: { role: "user", content: [{ type: "text", text }] },
 } as unknown as SessionEntry;
}

function label(id: string, targetId: string, name: string, timestamp: string): SessionEntry {
 return {
  id,
  type: "label",
  parentId: null,
  timestamp,
  targetId,
  label: name,
 } as unknown as SessionEntry;
}

function summary(id: string, parentId: string, text: string, timestamp: string): SessionEntry {
 return {
  id,
  type: "branch_summary",
  parentId,
  timestamp,
  fromId: parentId,
  summary: text,
 } as unknown as SessionEntry;
}

function node(entry: SessionEntry, children: SessionTreeNode[] = []): SessionTreeNode {
 return { entry, children };
}

function captureTimelineTool(): RegisteredTool {
 let timeline: RegisteredTool | undefined;
 const pi = {
  zod: z,
  on() {},
  registerTool(tool: RegisteredTool) {
   if (tool.name === "acm_timeline") timeline = tool;
  },
 };
 registerACMExtension(pi as unknown as ExtensionAPI);
 if (!timeline) throw new Error("acm_timeline was not registered");
 return timeline;
}

function makeContext(options: {
 entries: SessionEntry[];
 tree: SessionTreeNode[];
 branch: SessionEntry[];
 leafId?: string | null;
 usage?: { percent: number; tokens: number; contextWindow: number };
}) {
 const byId = new Map(options.entries.map((entry) => [entry.id, entry]));
 const sessionManager = {
  getEntries: () => options.entries,
  getTree: () => options.tree,
  getBranch: (fromId?: string) => {
   if (fromId === undefined || fromId === options.leafId) return options.branch;
   const result: SessionEntry[] = [];
   let current = byId.get(fromId);
   while (current) {
    result.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
   }
   return result;
  },
  getLeafId: () => options.leafId ?? options.branch.at(-1)?.id ?? null,
  getEntry: (id: string) => byId.get(id),
  getLabel: () => undefined,
 };
 return {
  sessionManager,
  getContextUsage: () => options.usage,
 };
}

async function execute(
 tool: RegisteredTool,
 params: unknown,
 ctx: ReturnType<typeof makeContext>,
 signal?: AbortSignal,
) {
 return tool.execute("timeline-test", params, signal, undefined, ctx);
}

describe("registered acm_timeline schema", () => {
 const tool = captureTimelineTool();
 const schema = tool.parameters;

 test("registers a strict tool and defaults active view and limit", () => {
  expect(tool.strict).toBe(true);
  expect(schema.parse({})).toEqual({ view: "active", limit: 50 });
 });

 test.each([
  [{ view: "active", verbose: true, limit: 1 }, { view: "active", verbose: true, limit: 1 }],
  [{ view: "checkpoints", filter: "  Anchor-ID  ", limit: 50 }, { view: "checkpoints", filter: "Anchor-ID", limit: 50 }],
  [{ view: "search", query: "  Needle  " }, { view: "search", query: "Needle", limit: 50 }],
  [{ view: "tree", limit: 50 }, { view: "tree", limit: 50 }],
 ] as const)("accepts and normalizes valid view parameters %#", (input, expected) => {
  expect(schema.parse(input)).toEqual(expected);
 });

 test.each([
  { view: "search" },
  { view: "search", query: "   " },
  { view: "checkpoints", filter: "   " },
  { view: "active", query: "x" },
  { view: "tree", query: "x" },
  { view: "search", query: "x", filter: "y" },
  { view: "active", filter: "x" },
  { view: "checkpoints", verbose: false },
  { view: "search", query: "x", verbose: true },
  { view: "tree", verbose: false },
  { full_tree: true },
  { list_checkpoints: true },
  { search: "legacy" },
  { view: "active", limt: 5 },
  { view: "active", limit: 0 },
  { view: "active", limit: 51 },
  { view: "active", limit: 1.5 },
  { view: "unknown" },
 ])("rejects invalid or legacy parameters %#", (input) => {
  expect(() => schema.parse(input)).toThrow();
 });
});

describe("registered acm_timeline execute handler", () => {
 const tool = captureTimelineTool();
 const base = message("a1", null, "root", "2026-01-01T00:00:00.000Z");

 test("active limits recent visible entries and reports exact omissions", async () => {
  const branch = Array.from({ length: 52 }, (_, index) => message(
   `a${index + 1}`,
   index === 0 ? null : `a${index}`,
   `message ${index + 1}`,
   `2026-01-01T00:00:${String(index).padStart(2, "0")}.000Z`,
  ));
  const tree = branch.reduceRight<SessionTreeNode | undefined>((child, entry) => node(entry, child ? [child] : []), undefined);
  const result = await execute(tool, {}, makeContext({ entries: branch, tree: tree ? [tree] : [], branch }));

  expect(result.details).toMatchObject({
   view: "active",
   limit: 50,
   activeVisibleEntries: 52,
   activeDisplayedEntries: 50,
   activeOmittedEntries: 2,
   activeSummaryDepth: 0,
   contextUsage: null,
  });
  expect(result.content[0].text).toContain("2 earlier visible entries omitted by limit");
  expect(result.content[0].text).not.toContain("[USER] message 1\n");
  expect(result.content[0].text).toContain("message 52");
  expect(result.content[0].text).toContain("Context Usage:    Unknown");
  expect(result.content[0].text).toContain(GUIDANCE_CUES.timelineActive);
  expect(result.content[0].text).not.toContain(GUIDANCE_CUES.rebaseCheck);
 });

 test("active reports semantic summary depth and switches to the canonical rebase cue", async () => {
  const root = message("root", null, "root", "2026-01-01T00:00:00.000Z");
  const firstSummary = summary("summary-1", "root", "first handoff", "2026-01-01T00:00:01.000Z");
  const current = message("current", "summary-1", "current", "2026-01-01T00:00:02.000Z");
  const entries = [root, firstSummary, current];
  const tree = [node(root, [node(firstSummary, [node(current)])])];
  const result = await execute(tool, {}, makeContext({ entries, tree, branch: entries, leafId: "current" }));

  expect(result.details).toMatchObject({ activeSummaryDepth: 1 });
  expect(result.content[0].text).toContain("Summary Depth:    1 active handoff summary layer(s)");
  expect(result.content[0].text).toContain(GUIDANCE_CUES.rebaseCheck);
  expect(result.content[0].text).toContain(GUIDANCE_CUES.timelineActive);

  const checkpoints = await execute(tool, { view: "checkpoints" }, makeContext({ entries, tree, branch: entries, leafId: "current" }));
  expect(checkpoints.content[0].text).toContain("summary depth 1 → 1 projected; projected depth is 1 rather than 0 because travel appends one new handoff");
 });

 test("checkpoints filters aliases by label or entry ID and reports matching/displayed counts", async () => {
  const active = message("ActiveEntry", null, "active", "2026-01-01T00:00:00.000Z");
  const activeChild = message("CurrentEntry", "ActiveEntry", "current", "2026-01-01T00:00:01.000Z");
  const offPath = message("OffPathEntry", "ActiveEntry", "off path", "2026-01-01T00:00:02.000Z");
  const entries = [
   active,
   activeChild,
   offPath,
   label("l1", "ActiveEntry", "Alpha", "2026-01-01T00:00:03.000Z"),
   label("l2", "ActiveEntry", "SecondAlias", "2026-01-01T00:00:04.000Z"),
   label("l3", "OffPathEntry", "Beta", "2026-01-01T00:00:05.000Z"),
  ];
  const ctx = makeContext({
   entries,
   tree: [node(active, [node(activeChild), node(offPath)])],
   branch: [active, activeChild],
   leafId: "CurrentEntry",
  });

  const byLabel = await execute(tool, { view: "checkpoints", filter: "ALP", limit: 1 }, ctx);
  expect(byLabel.details).toMatchObject({ checkpointsMatchingAliases: 1, checkpointsDisplayedAliases: 1 });
  expect(byLabel.content[0].text).toContain("Alpha → ActiveEntry");

  const byId = await execute(tool, { view: "checkpoints", filter: "offpathentry" }, ctx);
  expect(byId.details).toMatchObject({ checkpointsMatchingAliases: 1, checkpointsDisplayedAliases: 1 });
  expect(byId.content[0].text).toContain("Beta → OffPathEntry (off-path)");

  const limited = await execute(tool, { view: "checkpoints", limit: 1 }, ctx);
  expect(limited.details).toMatchObject({
   checkpointsMatchingAliases: 3,
   checkpointsDisplayedAliases: 1,
   activeSummaryDepth: 0,
   rootCandidateDisplayed: true,
   rootCandidateEntryId: "ActiveEntry",
   rootProjectedSummaryDepth: 1,
  });
  expect(limited.content[0].text).toContain("3 matching aliases, 1 displayed");
  expect(limited.content[0].text).toContain("root → ActiveEntry (structural candidate, not a checkpoint)");
  expect(limited.content[0].text).toContain("summary depth 0 → 1 projected");
  expect(byLabel.details).toMatchObject({ rootCandidateDisplayed: false });
  expect(byLabel.content[0].text).toContain(GUIDANCE_CUES.timelineCheckpoints);

  const alreadyAtRoot = await execute(tool, { view: "checkpoints" }, makeContext({
   entries: [active],
   tree: [node(active)],
   branch: [active],
   leafId: "ActiveEntry",
  }));
  expect(alreadyAtRoot.details).toMatchObject({ rootCandidateDisplayed: false });
  expect(alreadyAtRoot.content[0].text).not.toContain("structural candidate, not a checkpoint");
 });

 test("search matches active and off-path labels, IDs, and rendered content case-insensitively", async () => {
  const active = message("RootNode", null, "ordinary", "2026-01-01T00:00:00.000Z");
  const activeChild = message("ActiveNeedleId", "RootNode", "active content", "2026-01-01T00:00:01.000Z");
  const offPath = message("OffNode", "RootNode", "contains NEEDLE text", "2026-01-01T00:00:02.000Z");
  const entries = [active, activeChild, offPath, label("l1", "OffNode", "NeedleLabel", "2026-01-01T00:00:03.000Z")];
  const ctx = makeContext({ entries, tree: [node(active, [node(activeChild), node(offPath)])], branch: [active, activeChild], leafId: "ActiveNeedleId" });

  const result = await execute(tool, { view: "search", query: "needle" }, ctx);
  expect(result.details).toMatchObject({ view: "search", searchDisplayedMatches: 2, searchTruncated: false });
  expect(result.content[0].text).toContain("ActiveNeedleId");
  expect(result.content[0].text).toContain("OffNode");

  const truncated = await execute(tool, { view: "search", query: "needle", limit: 1 }, ctx);
  expect(truncated.details).toMatchObject({ searchDisplayedMatches: 1, searchTruncated: true });
  expect(truncated.content[0].text).toContain("additional matches truncated");

  const empty = await execute(tool, { view: "search", query: "absent" }, ctx);
  expect(empty.details).toMatchObject({ searchDisplayedMatches: 0, searchTruncated: false });
  expect(empty.content[0].text).toContain("0 displayed of 0 matching node(s)");
  expect(result.content[0].text).toContain(GUIDANCE_CUES.timelineSearch);
 });

 test("tree applies depth per root and reports depth truncation", async () => {
  const child = message("child", "root", "child", "2026-01-01T00:00:01.000Z");
  const root = message("root", null, "root", "2026-01-01T00:00:00.000Z");
  const result = await execute(tool, { view: "tree", limit: 1 }, makeContext({
   entries: [root, child],
   tree: [node(root, [node(child)])],
   branch: [root, child],
   leafId: "child",
  }));

  expect(result.details).toMatchObject({ view: "tree", limit: 1, treeTruncated: true });
  expect(result.content[0].text).toContain("root");
  expect(result.content[0].text).not.toContain("[USER] child");
  expect(result.content[0].text).toContain(GUIDANCE_CUES.timelineTree);
 });

 test("tree independently enforces the 200-line ceiling", async () => {
  const roots = Array.from({ length: 201 }, (_, index) => message(
   `r${index}`,
   null,
   `root ${index}`,
   `2026-01-01T00:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`,
  ));
  const result = await execute(tool, { view: "tree", limit: 50 }, makeContext({
   entries: roots,
   tree: roots.map((entry) => node(entry)),
   branch: [roots[0]],
   leafId: roots[0].id,
  }));

  expect(result.details).toMatchObject({ treeTruncated: true, outputLines: 201 });
  expect(result.content[0].text).toContain("tree truncated by depth/line limit");
  expect(result.content[0].text).not.toContain("r200");
 });

 test("aborted search reports truncation instead of implying absence", async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await execute(tool, { view: "search", query: "root" }, makeContext({
   entries: [base],
   tree: [node(base)],
   branch: [base],
  }), controller.signal);

  expect(result.details).toMatchObject({ searchDisplayedMatches: 0, searchTruncated: true });
  expect(result.content[0].text).toContain("additional matches truncated");
 });
});
