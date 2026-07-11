import { describe, expect, test } from "bun:test";
import type { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import {
  appendCheckpointLabel,
  applyBranchWithSummary,
  buildSessionMessages,
  getHostCapabilities,
  rollbackCheckpointLabel,
} from "./.acm-build/host-bridge.js";
import { useHostSessionHarnesses } from "./harness.js";

const createHarness = useHostSessionHarnesses();

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

describe("typed HostBridge ports with real OMP SessionManager", () => {
  test("detects all guarded capabilities on the real host", () => {
    const harness = createHarness();
    expect(getHostCapabilities(harness.session)).toEqual({ appendLabelChange: true, branchWithSummary: true });
  });

  test("appends idempotent labels and preserves multiple aliases", () => {
    const harness = createHarness();
    const { userId } = appendUserAssistantPair(harness.session);

    const first = appendCheckpointLabel(harness.session, userId, "first");
    expect(first).toMatchObject({ ok: true, state: "applied", value: { aliases: ["first"] } });
    const second = appendCheckpointLabel(harness.session, userId, "second");
    expect(second).toMatchObject({ ok: true, state: "applied", value: { aliases: ["first", "second"] } });
    const duplicate = appendCheckpointLabel(harness.session, userId, "second");
    expect(duplicate).toMatchObject({ ok: true, state: "not_applied", value: { status: "already_present" } });
    expect(harness.snapshot().aliases[userId]).toEqual(["first", "second"]);
  });

  test("returns the existing owner for a case-sensitive collision", () => {
    const harness = createHarness();
    const { userId, assistantId } = appendUserAssistantPair(harness.session);
    expect(appendCheckpointLabel(harness.session, userId, "shared").ok).toBe(true);

    expect(appendCheckpointLabel(harness.session, assistantId, "shared")).toMatchObject({
      ok: false,
      state: "not_applied",
      error: "label_conflict",
      details: { entryId: userId, onActivePath: true },
    });
    expect(appendCheckpointLabel(harness.session, assistantId, "Shared")).toMatchObject({
      ok: true,
      state: "applied",
    });
  });

  test("operation-scoped rollback restores prior aliases", () => {
    const harness = createHarness();
    const { userId } = appendUserAssistantPair(harness.session);
    expect(appendCheckpointLabel(harness.session, userId, "keeper").ok).toBe(true);
    const temporary = appendCheckpointLabel(harness.session, userId, "temporary");
    expect(temporary.ok).toBe(true);
    if (!temporary.ok || !temporary.value.rollback) return;

    expect(rollbackCheckpointLabel(harness.session, temporary.value.rollback)).toMatchObject({
      ok: true,
      state: "applied",
      value: { restoredAliases: ["keeper"] },
    });
    expect(harness.snapshot().aliases[userId]).toEqual(["keeper"]);
  });

  test("aliases, leaf, and built messages survive reload", async () => {
    const harness = createHarness();
    const { userId } = appendUserAssistantPair(harness.session);
    expect(appendCheckpointLabel(harness.session, userId, "reload-check").ok).toBe(true);
    const before = harness.snapshot();

    const reloaded = await harness.reload();
    const after = harness.snapshot(reloaded);
    expect(after.aliases[userId]).toEqual(["reload-check"]);
    expect(after.leafId).toBe(before.leafId);
    expect(after.tree).toEqual(before.tree);
    expect(after.messages).toEqual(before.messages);
  });

  test("buildSessionMessages rebuilds an arbitrary leaf", () => {
    const harness = createHarness();
    const { userId } = appendUserAssistantPair(harness.session);
    const atLeaf = buildSessionMessages(harness.session);
    const atUser = buildSessionMessages(harness.session, userId);
    expect(atLeaf.ok).toBe(true);
    expect(atUser.ok).toBe(true);
    if (!atLeaf.ok || !atUser.ok) return;
    expect(atLeaf.value.length).toBeGreaterThan(atUser.value.length);
  });

  test("applyBranchWithSummary creates and verifies the summary leaf", () => {
    const harness = createHarness();
    const { userId, assistantId } = appendUserAssistantPair(harness.session);
    const result = applyBranchWithSummary(
      harness.session,
      userId,
      "State: investigation distilled\nNEXT: implement the fix",
      { originId: assistantId, targetId: userId },
    );
    expect(result).toMatchObject({ ok: true, state: "applied" });
    if (!result.ok) return;
    expect(harness.snapshot().leafId).toBe(result.value.summaryEntryId);
  });
});
