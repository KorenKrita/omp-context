import { describe, expect, test } from "bun:test";
import type { SessionEntry } from "@oh-my-pi/pi-coding-agent/session/session-entries";
import {
 PendingContextRefreshRegistry,
 buildLabelMaps,
 classifyStructuralMessageEffect,
 classifyTravelEffect,
 compareEntriesByTimestamp,
 estimateUsageAfterMessageChange,
 estimateUsageAtTravelTarget,
 findLastMeaningfulEntry,
 getMeaningfulSkipReason,
 resolveTargetId,
 resolveTimelineMode,
 type UsageLike,
} from "./lib.js";

function labelEntry(id: string, targetId: string, label: string): SessionEntry {
 return {
  type: "label",
  id,
  parentId: null,
  timestamp: new Date().toISOString(),
  targetId,
  label,
 } as SessionEntry;
}

function userEntry(id: string, text: string, timestamp = "2026-01-01T00:00:00.000Z"): SessionEntry {
 return {
  type: "message",
  id,
  parentId: null,
  timestamp,
  message: { role: "user", content: text },
 } as SessionEntry;
}

describe("buildLabelMaps", () => {
 test("accumulates multiple aliases on one entry", () => {
  const maps = buildLabelMaps([
   labelEntry("l1", "e1", "alpha"),
   labelEntry("l2", "e1", "beta"),
  ]);
  expect(maps.entryToLabels.get("e1")).toEqual(["alpha", "beta"]);
  expect(maps.labelToEntryId.get("alpha")).toBe("e1");
  expect(maps.labelToEntryId.get("beta")).toBe("e1");
 });

 test("moves label ownership and removes alias from previous entry", () => {
  const maps = buildLabelMaps([
   labelEntry("l1", "e1", "shared"),
   labelEntry("l2", "e2", "shared"),
  ]);
  expect(maps.labelToEntryId.get("shared")).toBe("e2");
  expect(maps.entryToLabels.get("e1")).toBeUndefined();
  expect(maps.entryToLabels.get("e2")).toEqual(["shared"]);
 });

 test("clears labels when label entry clears target", () => {
  const maps = buildLabelMaps([
   labelEntry("l1", "e1", "gone"),
   { ...labelEntry("l2", "e1", "gone"), label: undefined } as SessionEntry,
  ]);
  expect(maps.entryToLabels.get("e1")).toBeUndefined();
  expect(maps.labelToEntryId.has("gone")).toBe(false);
 });
});

describe("resolveTargetId", () => {
 const sm = {
  getBranch: () => [{ id: "e1" } as SessionEntry],
  getEntries: () => [
   labelEntry("l1", "e1", "anchor"),
   userEntry("e1", "hello"),
  ],
 } as Parameters<typeof resolveTargetId>[0];

 test("resolves checkpoint label to entry id", () => {
  const result = resolveTargetId(sm, [{ entry: userEntry("e1", "x"), children: [] }], "anchor");
  expect(result).toEqual({ id: "e1", fromOffPath: false });
 });

 test("marks unknown id as off-path when not on branch", () => {
  const result = resolveTargetId(sm, [], "deadbeef");
  expect(result.fromOffPath).toBe(true);
  expect(result.id).toBe("deadbeef");
 });

 test("returns empty id for root on empty tree", () => {
  const result = resolveTargetId(sm, [], "root");
  expect(result.id).toBe("");
  expect(result.fromOffPath).toBe(false);
 });
});

describe("resolveTimelineMode", () => {
 test("list_checkpoints wins over search and full_tree", () => {
  expect(resolveTimelineMode({ list_checkpoints: true, search: "x", full_tree: true })).toBe("list_checkpoints");
 });

 test("search wins over full_tree", () => {
  expect(resolveTimelineMode({ search: "x", full_tree: true })).toBe("search");
 });

 test("defaults to active_path", () => {
  expect(resolveTimelineMode({})).toBe("active_path");
  expect(resolveTimelineMode({ full_tree: false })).toBe("active_path");
 });
});

describe("PendingContextRefreshRegistry", () => {
 test("marks, checks, and clears per session manager", () => {
  const registry = new PendingContextRefreshRegistry();
  const smA = {};
  const smB = {};
  registry.mark(smA);
  expect(registry.has(smA)).toBe(true);
  expect(registry.has(smB)).toBe(false);
  registry.clear(smA);
  expect(registry.has(smA)).toBe(false);
 });

 test("sessions are isolated", () => {
  const registry = new PendingContextRefreshRegistry();
  const smA = {};
  const smB = {};
  registry.mark(smA);
  registry.mark(smB);
  registry.clear(smA);
  expect(registry.has(smB)).toBe(true);
 });
});

describe("classify effects", () => {
 test("classifyTravelEffect respects threshold", () => {
  const before: UsageLike = { tokens: 10_000, contextWindow: 100_000, percent: 10 };
  const afterSmall: UsageLike = { tokens: 9_600, contextWindow: 100_000, percent: 9.6 };
  const afterLarge: UsageLike = { tokens: 5_000, contextWindow: 100_000, percent: 5 };
  expect(classifyTravelEffect(before, afterSmall)).toBe("unchanged");
  expect(classifyTravelEffect(before, afterLarge)).toBe("shrunk");
 });

 test("classifyStructuralMessageEffect", () => {
  expect(classifyStructuralMessageEffect(80, 12)).toBe("shrunk");
  expect(classifyStructuralMessageEffect(12, 80)).toBe("restored");
  expect(classifyStructuralMessageEffect(10, 11)).toBe("unchanged");
 });
});

describe("estimateUsageAfterMessageChange", () => {
 test("clamps percent to 100", () => {
  const usageBefore: UsageLike = { tokens: 95_000, contextWindow: 100_000, percent: 95 };
  const before = [{ role: "user", content: "x" }] as Parameters<typeof estimateUsageAfterMessageChange>[1];
  const after = [
   { role: "user", content: "x".repeat(50_000) },
  ] as Parameters<typeof estimateUsageAfterMessageChange>[2];
  const result = estimateUsageAfterMessageChange(usageBefore, before, after);
  expect(result?.percent).toBeLessThanOrEqual(100);
 });
});

describe("estimateUsageAtTravelTarget", () => {
 test("includes summary token overhead", () => {
  const usageBefore: UsageLike = { tokens: 10_000, contextWindow: 100_000, percent: 10 };
  const current = [{ role: "user", content: "current" }] as Parameters<typeof estimateUsageAtTravelTarget>[1];
  const target = [{ role: "user", content: "target" }] as Parameters<typeof estimateUsageAtTravelTarget>[2];
  const withSummary = estimateUsageAtTravelTarget(usageBefore, current, target, "handoff summary");
  const withoutSummary = estimateUsageAfterMessageChange(usageBefore, current, target);
  expect(withSummary?.tokens).toBeGreaterThan(withoutSummary?.tokens ?? 0);
 });
});

describe("compareEntriesByTimestamp", () => {
 test("sorts entries chronologically", () => {
  const a = userEntry("a", "first", "2026-01-01T00:00:00.000Z");
  const b = userEntry("b", "second", "2026-01-02T00:00:00.000Z");
  expect(compareEntriesByTimestamp(a, b)).toBeLessThan(0);
  expect(compareEntriesByTimestamp(b, a)).toBeGreaterThan(0);
 });
});

describe("getMeaningfulSkipReason", () => {
 test("skips bash, custom, and system messages", () => {
  const bash = {
   type: "message",
   id: "b1",
   message: { role: "bashExecution", command: "ls" },
  } as SessionEntry;
  const custom = {
   type: "message",
   id: "c1",
   message: { role: "custom", content: "meta" },
  } as SessionEntry;
  const system = {
   type: "message",
   id: "s1",
   message: { role: "system", content: "rules" },
  } as SessionEntry;
  expect(getMeaningfulSkipReason(bash)).toBe("bash_execution");
  expect(getMeaningfulSkipReason(custom)).toBe("custom_message");
  expect(getMeaningfulSkipReason(system)).toBe("system_message");
 });
});

describe("findLastMeaningfulEntry", () => {
 test("skips internal-tool-only assistant turns near HEAD", () => {
  const branch = [
   userEntry("u1", "task"),
   userEntry("u2", "follow-up"),
   {
    type: "message",
    id: "a1",
    parentId: "u2",
    timestamp: new Date().toISOString(),
    message: {
     role: "assistant",
     content: [{ type: "toolCall", name: "acm_timeline", arguments: {} }],
    },
   } as SessionEntry,
  ];
  const result = findLastMeaningfulEntry(
   branch,
   getMeaningfulSkipReason,
   () => "USER",
   () => "",
  );
  expect(result.entryId).toBe("u2");
  expect(result.skipped.length).toBe(1);
 });

 test("skips bash execution near HEAD", () => {
  const branch = [
   userEntry("u1", "task"),
   {
    type: "message",
    id: "b1",
    parentId: "u1",
    timestamp: new Date().toISOString(),
    message: { role: "bashExecution", command: "npm test" },
   } as SessionEntry,
  ];
  const result = findLastMeaningfulEntry(
   branch,
   getMeaningfulSkipReason,
   () => "BASH",
   () => "",
  );
  expect(result.entryId).toBe("u1");
  expect(result.skipped[0]?.reason).toBe("bash_execution");
 });
});
