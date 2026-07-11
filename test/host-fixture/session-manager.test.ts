import { afterEach, describe, expect, test } from "bun:test";
import type { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { createHostSessionHarness, type HostSessionHarness } from "./harness.js";

const active: HostSessionHarness[] = [];

afterEach(async () => {
  await Promise.all(active.splice(0).map((harness) => harness.cleanup()));
});

function createHarness(): HostSessionHarness {
  const harness = createHostSessionHarness();
  active.push(harness);
  return harness;
}

function appendRepresentativeHistory(session: SessionManager) {
  const userId = session.appendMessage({
    role: "user",
    content: [{ type: "text", text: "investigate the failing parser" }],
    timestamp: Date.now(),
  });
  const assistantId = session.appendMessage({
    role: "assistant",
    content: [{ type: "toolCall", id: "call-read", name: "read", arguments: { path: "parser.ts" } }],
    api: "test",
    provider: "test",
    model: "test",
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: 0 },
    stopReason: "toolUse",
    timestamp: Date.now(),
  });
  const toolResultId = session.appendMessage({
    role: "toolResult",
    toolCallId: "call-read",
    toolName: "read",
    content: [{ type: "text", text: "export function parse() {}" }],
    isError: false,
    timestamp: Date.now(),
  });
  const conclusionId = session.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "the parser drops escaped delimiters" }],
    api: "test",
    provider: "test",
    model: "test",
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: 0 },
    stopReason: "stop",
    timestamp: Date.now(),
  });
  return { userId, assistantId, toolResultId, conclusionId };
}

describe("real OMP SessionManager harness", () => {
  test("persists aliases, leaf, topology, and built messages across reload", async () => {
    const harness = createHarness();
    const ids = appendRepresentativeHistory(harness.session);
    harness.session.appendLabelChange(ids.userId, "parser-start");
    harness.session.appendLabelChange(ids.userId, "Parser-Start");
    await harness.session.flush();

    const before = harness.snapshot();
    const reloaded = await harness.reload();
    const after = harness.snapshot(reloaded);

    expect(after.aliases).toEqual(before.aliases);
    expect(after.aliases[ids.userId]).toEqual(["parser-start", "Parser-Start"]);
    expect(after.leafId).toBe(before.leafId);
    expect(after.tree).toEqual(before.tree);
    expect(after.messages).toEqual(before.messages);
  });

  test("keeps the abandoned branch and builds context from the summary leaf", () => {
    const harness = createHarness();
    const rootId = harness.session.appendMessage({
      role: "user",
      content: [{ type: "text", text: "root request" }],
      timestamp: Date.now(),
    });
    const abandonedId = harness.session.appendMessage({
      role: "user",
      content: [{ type: "text", text: "raw noisy investigation" }],
      timestamp: Date.now(),
    });

    const summaryId = harness.session.branchWithSummary(rootId, "State: investigation distilled\nNEXT: implement the fix", {
      originId: abandonedId,
      targetId: rootId,
    }, true);
    const snapshot = harness.snapshot();

    expect(snapshot.leafId).toBe(summaryId);
    expect(snapshot.tree[0]?.children.map((node) => node.id).sort()).toEqual([abandonedId, summaryId].sort());
    expect(snapshot.messages.some((message) => JSON.stringify(message).includes("raw noisy investigation"))).toBe(false);
    expect(snapshot.messages.some((message) => JSON.stringify(message).includes("investigation distilled"))).toBe(true);
  });

  test("appends compaction through real host behavior", () => {
    const harness = createHarness();
    const firstKeptId = harness.session.appendMessage({
      role: "user",
      content: [{ type: "text", text: "kept request" }],
      timestamp: Date.now(),
    });
    const compactionId = harness.session.appendCompaction("older work summarized", undefined, firstKeptId, 1200, {
      source: "host-fixture",
    });

    const entry = harness.session.getEntry(compactionId);
    expect(entry?.type).toBe("compaction");
    expect(harness.session.getLeafId()).toBe(compactionId);
  });
});
