import { afterEach, describe, expect, test } from "bun:test";
import type { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { HostBridge } from "../../src/host-bridge.js";
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

function appendUserAssistantPair(session: SessionManager): { userId: string; assistantId: string } {
  const userId = session.appendMessage({
    role: "user",
    content: [{ type: "text", text: "hello" }],
    timestamp: Date.now(),
  });
  const assistantId = session.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "hi" }],
    api: "test",
    provider: "test",
    model: "test",
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: 0 },
    stopReason: "endTurn",
    timestamp: Date.now(),
  });
  return { userId, assistantId };
}

describe("HostBridge with real OMP SessionManager", () => {
  test("detects all required capabilities on the real host", () => {
    const harness = createHarness();
    const bridge = new HostBridge(harness.session);
    expect(bridge.capabilities).toEqual({
      appendLabelChange: true,
      branchWithSummary: true,
    });
  });

  test("appends a checkpoint label and records it in the alias journal", () => {
    const harness = createHarness();
    const { userId } = appendUserAssistantPair(harness.session);
    const bridge = new HostBridge(harness.session);

    const result = bridge.appendCheckpointLabel(userId, "parser-fix-start");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.status).toBe("created");
    expect(result.value.aliases).toEqual(["parser-fix-start"]);

    const snapshot = harness.snapshot();
    expect(snapshot.aliases[userId]).toEqual(["parser-fix-start"]);
  });

  test("same-node same-name retry is idempotent", () => {
    const harness = createHarness();
    const { userId } = appendUserAssistantPair(harness.session);
    const bridge = new HostBridge(harness.session);

    const first = bridge.appendCheckpointLabel(userId, "parser-fix-start");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.status).toBe("created");

    const second = bridge.appendCheckpointLabel(userId, "parser-fix-start");
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.status).toBe("already_present");

    const snapshot = harness.snapshot();
    expect(snapshot.aliases[userId]).toEqual(["parser-fix-start"]);
    // No duplicate label entries should accumulate.
    expect(harness.session.getEntries().filter((e) => e.type === "label")).toHaveLength(1);
  });

  test("adding a second alias preserves the first alias", () => {
    const harness = createHarness();
    const { userId } = appendUserAssistantPair(harness.session);
    const bridge = new HostBridge(harness.session);

    const first = bridge.appendCheckpointLabel(userId, "first");
    expect(first.ok).toBe(true);
    const second = bridge.appendCheckpointLabel(userId, "second");
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.aliases).toEqual(["first", "second"]);

    const snapshot = harness.snapshot();
    expect(snapshot.aliases[userId]).toEqual(["first", "second"]);
  });

  test("name collision returns existing owner entry", () => {
    const harness = createHarness();
    const { userId } = appendUserAssistantPair(harness.session);
    const assistantId = harness.session.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "later" }],
      api: "test",
      provider: "test",
      model: "test",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: 0 },
      stopReason: "endTurn",
      timestamp: Date.now(),
    });
    const bridge = new HostBridge(harness.session);

    const first = bridge.appendCheckpointLabel(userId, "shared");
    expect(first.ok).toBe(true);

    const conflict = bridge.appendCheckpointLabel(assistantId, "shared");
    expect(conflict.ok).toBe(false);
    if (conflict.ok) return;
    expect(conflict.error).toBe("label_conflict");
    expect(conflict.details).toEqual({ entryId: userId, onActivePath: true });
  });

  test("case-sensitive name uniqueness", () => {
    const harness = createHarness();
    const { userId } = appendUserAssistantPair(harness.session);
    const assistantId = harness.session.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "later" }],
      api: "test",
      provider: "test",
      model: "test",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: 0 },
      stopReason: "endTurn",
      timestamp: Date.now(),
    });
    const bridge = new HostBridge(harness.session);

    const lower = bridge.appendCheckpointLabel(userId, "case");
    expect(lower.ok).toBe(true);

    const upper = bridge.appendCheckpointLabel(assistantId, "Case");
    expect(upper.ok).toBe(true);
    if (!upper.ok) return;
    expect(upper.value.status).toBe("created");
  });

  test("safe clear only removes a bridge-created label on a clean target", () => {
    const harness = createHarness();
    const { userId } = appendUserAssistantPair(harness.session);
    const bridge = new HostBridge(harness.session);

    const append = bridge.appendCheckpointLabel(userId, "temp");
    expect(append.ok).toBe(true);
    if (!append.ok) return;

    const clear = bridge.clearCreatedLabel(append.value.labelEntryId);
    expect(clear.ok).toBe(true);
    if (!clear.ok) return;

    const snapshot = harness.snapshot();
    expect(snapshot.aliases[userId]).toBeUndefined();
  });

  test("safe clear rejects a target with prior aliases", () => {
    const harness = createHarness();
    const { userId } = appendUserAssistantPair(harness.session);
    const bridge = new HostBridge(harness.session);

    const first = bridge.appendCheckpointLabel(userId, "keeper");
    expect(first.ok).toBe(true);
    const second = bridge.appendCheckpointLabel(userId, "temp");
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    const clear = bridge.clearCreatedLabel(second.value.labelEntryId);
    expect(clear.ok).toBe(false);
    if (clear.ok) return;
    expect(clear.error).toBe("unsafe_clear");

    const snapshot = harness.snapshot();
    expect(snapshot.aliases[userId]).toEqual(["keeper", "temp"]);
  });

  test("safe clear rejects a label not created by this bridge", () => {
    const harness = createHarness();
    const { userId } = appendUserAssistantPair(harness.session);
    const labelEntryId = harness.session.appendLabelChange(userId, "external");
    const bridge = new HostBridge(harness.session);

    const clear = bridge.clearCreatedLabel(labelEntryId);
    expect(clear.ok).toBe(false);
    if (clear.ok) return;
    expect(clear.error).toBe("label_not_created_here");
  });

  test("aliases, leaf, and built messages survive reload", async () => {
    const harness = createHarness();
    const { userId } = appendUserAssistantPair(harness.session);
    const bridge = new HostBridge(harness.session);

    const append = bridge.appendCheckpointLabel(userId, "reload-check");
    expect(append.ok).toBe(true);

    const before = harness.snapshot();
    const reloaded = await harness.reload();
    const after = harness.snapshot(reloaded);

    expect(after.aliases[userId]).toEqual(["reload-check"]);
    expect(after.leafId).toBe(before.leafId);
    expect(after.tree).toEqual(before.tree);
    expect(after.messages).toEqual(before.messages);
  });

  test("buildSessionMessages rebuilds messages for an arbitrary leaf", () => {
    const harness = createHarness();
    const { userId, assistantId } = appendUserAssistantPair(harness.session);
    const bridge = new HostBridge(harness.session);

    const atLeaf = bridge.buildSessionMessages();
    expect(atLeaf.ok).toBe(true);
    if (!atLeaf.ok) return;

    const atUser = bridge.buildSessionMessages(userId);
    expect(atUser.ok).toBe(true);
    if (!atUser.ok) return;

    expect(atLeaf.value.length).toBeGreaterThan(atUser.value.length);
  });

  test("branchWithSummary creates a summary entry and abandons the branch", () => {
    const harness = createHarness();
    const { userId } = appendUserAssistantPair(harness.session);
    const assistantId = harness.session.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "investigation done" }],
      api: "test",
      provider: "test",
      model: "test",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: 0 },
      stopReason: "endTurn",
      timestamp: Date.now(),
    });
    const bridge = new HostBridge(harness.session);

    const result = bridge.branchWithSummary(userId, "State: investigation distilled\nNEXT: implement the fix", {
      originId: assistantId,
      targetId: userId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const snapshot = harness.snapshot();
    expect(snapshot.leafId).toBe(result.value.summaryEntryId);
    expect(snapshot.tree.some((node) => node.id === userId && node.children.some((c) => c.id === result.value.summaryEntryId))).toBe(true);
  });
});
