import { afterEach, describe, expect, test } from "bun:test";
import type { SessionManager, ReadonlySessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@oh-my-pi/pi-coding-agent/extensibility/extensions/types";
import * as zod from "zod/v4";
import registerACMExtension from "../../src/index.js";
import { createHostSessionHarness, type HostSessionHarness, type HostSessionSnapshot } from "./harness.js";

const active: HostSessionHarness[] = [];
const VALID_HANDOFF = [
  "Goal: exercise travel",
  "State: ready",
  "Evidence: real SessionManager fixture",
  "External: none",
  "Exclusions: none",
  "Recover: none",
  "NEXT: verify the result",
].join("\n");

interface TravelParams {
  target: string;
  summary: string;
  backupCurrentHeadAs?: string;
}

interface TravelRun {
  result: Awaited<ReturnType<ToolDefinition["execute"]>>;
  notifications: string[];
}

function createHarness(): HostSessionHarness {
  const harness = createHostSessionHarness();
  active.push(harness);
  return harness;
}

afterEach(async () => {
  await Promise.all(active.splice(0).map((harness) => harness.cleanup()));
});

function appendUserAssistantPair(session: SessionManager): { userId: string; assistantId: string } {
  const userId = session.appendMessage({
    role: "user",
    content: [{ type: "text", text: "start the task" }],
    timestamp: Date.now(),
  });
  const assistantId = session.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "finish the phase" }],
    api: "test",
    provider: "test",
    model: "test",
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: 0 },
    stopReason: "stop",
    timestamp: Date.now(),
  });
  return { userId, assistantId };
}

function captureTravelTool(): ToolDefinition {
  let travelTool: ToolDefinition | undefined;
  const api = {
    zod,
    on(_event: string, _handler: unknown) {},
    registerTool(tool: ToolDefinition) {
      if (tool.name === "acm_travel") travelTool = tool;
    },
  };
  // The fixture supplies only registration capabilities used during extension setup.
  registerACMExtension(api as unknown as ExtensionAPI);
  if (!travelTool) throw new Error("acm_travel was not registered");
  return travelTool;
}

function createContext(sessionManager: ReadonlySessionManager, notifications: string[]): ExtensionContext {
  const context = {
    sessionManager,
    getContextUsage: () => ({ tokens: 1200, contextWindow: 100_000, percent: 1.2 }),
    ui: {
      notify(message: string) {
        notifications.push(message);
      },
    },
  };
  // Travel execution touches only sessionManager, context usage, and UI notification.
  return context as unknown as ExtensionContext;
}

async function runTravel(
  sessionManager: ReadonlySessionManager,
  params: TravelParams,
  signal?: AbortSignal,
): Promise<TravelRun> {
  const notifications: string[] = [];
  const result = await captureTravelTool().execute(
    "travel-fixture",
    params,
    signal,
    undefined,
    createContext(sessionManager, notifications),
  );
  return { result, notifications };
}

function resultDetails(run: TravelRun): Record<string, unknown> {
  const details = run.result.details;
  if (typeof details !== "object" || details === null) throw new Error("travel result did not include details");
  return details as Record<string, unknown>;
}

function structuralSnapshot(snapshot: HostSessionSnapshot) {
  return {
    entries: snapshot.entries,
    aliases: snapshot.aliases,
    leafId: snapshot.leafId,
    tree: snapshot.tree,
  };
}

function sessionView(
  session: SessionManager,
  overrides: Partial<{
    appendLabelChange: (targetId: string, label: string | undefined) => string;
    branchWithSummary: (
      branchFromId: string | null,
      summary: string,
      details?: unknown,
      fromExtension?: boolean,
    ) => string;
  }> = {},
): ReadonlySessionManager {
  const view = {
    getEntries: session.getEntries.bind(session),
    getTree: session.getTree.bind(session),
    getBranch: session.getBranch.bind(session),
    getLeafId: session.getLeafId.bind(session),
    getEntry: session.getEntry.bind(session),
    appendLabelChange: overrides.appendLabelChange ?? session.appendLabelChange.bind(session),
    branchWithSummary: overrides.branchWithSummary ?? session.branchWithSummary.bind(session),
  };
  // The view binds public reads to a real SessionManager while selectively replacing guarded host capabilities.
  return view as unknown as ReadonlySessionManager;
}

describe("acm_travel with real OMP SessionManager", () => {
  test("rejects an incomplete handoff before mutating entries, aliases, leaf, or topology", async () => {
    const harness = createHarness();
    const { userId } = appendUserAssistantPair(harness.session);
    const before = structuralSnapshot(harness.snapshot());

    const run = await runTravel(harness.session, {
      target: userId,
      summary: "Goal: incomplete",
      backupCurrentHeadAs: "invalid-handoff-done",
    });

    expect(resultDetails(run).error).toBe("invalid_handoff");
    expect(structuralSnapshot(harness.snapshot())).toEqual(before);
  });

  test("prevalidates branch capability before creating a backup label", async () => {
    const harness = createHarness();
    const { userId } = appendUserAssistantPair(harness.session);
    const before = structuralSnapshot(harness.snapshot());
    const view = sessionView(harness.session);
    const withoutBranch = {
      getEntries: view.getEntries.bind(view),
      getTree: view.getTree.bind(view),
      getBranch: view.getBranch.bind(view),
      getLeafId: view.getLeafId.bind(view),
      getEntry: view.getEntry.bind(view),
      appendLabelChange: view.appendLabelChange?.bind(view),
    };

    const run = await runTravel(withoutBranch as unknown as ReadonlySessionManager, {
      target: userId,
      summary: VALID_HANDOFF,
      backupCurrentHeadAs: "missing-capability-done",
    });

    expect(resultDetails(run).error).toBe("branch_prevalidation_failed");
    expect(structuralSnapshot(harness.snapshot())).toEqual(before);
  });

  test("rolls back a new backup label when branch creation throws before mutation", async () => {
    const harness = createHarness();
    const { userId, assistantId } = appendUserAssistantPair(harness.session);
    const messagesBefore = harness.snapshot().messages;
    const view = sessionView(harness.session, {
      branchWithSummary() {
        throw new Error("synthetic branch failure");
      },
    });

    const run = await runTravel(view, {
      target: userId,
      summary: VALID_HANDOFF,
      backupCurrentHeadAs: "rollback-clean-done",
    });
    const details = resultDetails(run);

    expect(details.error).toBe("branch_failed");
    expect(details.backupRolledBack).toBe(true);
    const after = harness.snapshot();
    expect(after.aliases[assistantId]).toBeUndefined();
    expect(after.messages).toEqual(messagesBefore);
    expect(after.entries.some((entry) => entry.type === "branch_summary")).toBe(false);
  });

  test("preserves the backup when branch mutation happened but returned an invalid identifier", async () => {
    const harness = createHarness();
    const { userId, assistantId } = appendUserAssistantPair(harness.session);
    const view = sessionView(harness.session, {
      branchWithSummary(branchFromId, summary, details, fromExtension) {
        harness.session.branchWithSummary(branchFromId, summary, details, fromExtension);
        return "missing-summary-entry";
      },
    });

    const run = await runTravel(view, {
      target: userId,
      summary: VALID_HANDOFF,
      backupCurrentHeadAs: "partial-mutation-done",
    });
    const details = resultDetails(run);

    expect(details.error).toBe("branch_failed");
    expect(details.backupRolledBack).toBe(false);
    expect(details.backupRollbackSkipped).toBe(true);
    expect(details.recoveryAction).toContain("partial-mutation-done");
    expect(harness.snapshot().aliases[assistantId]).toContain("partial-mutation-done");
    expect(harness.snapshot().leafId).not.toBe(assistantId);
  });

  test("reports rollback failure with the remaining label, entry, and recovery action", async () => {
    const harness = createHarness();
    const { userId, assistantId } = appendUserAssistantPair(harness.session);
    const view = sessionView(harness.session, {
      appendLabelChange(targetId, label) {
        if (label === undefined) throw new Error("synthetic clear failure");
        return harness.session.appendLabelChange(targetId, label);
      },
      branchWithSummary() {
        throw new Error("synthetic branch failure");
      },
    });

    const run = await runTravel(view, {
      target: userId,
      summary: VALID_HANDOFF,
      backupCurrentHeadAs: "rollback-failed-done",
    });
    const details = resultDetails(run);

    expect(details.error).toBe("branch_failed");
    expect(details.backupRollbackFailed).toBe(true);
    expect(details.remainingBackupLabel).toBe("rollback-failed-done");
    expect(details.backupEntryId).toBe(assistantId);
    expect(details.recoveryAction).toContain("rollback-failed-done");
    expect(harness.snapshot().aliases[assistantId]).toContain("rollback-failed-done");
  });

  test("reports actual raw-node, checkpoint, and multi-root root targets", async () => {
    const rawHarness = createHarness();
    const rawPair = appendUserAssistantPair(rawHarness.session);
    const rawRun = await runTravel(rawHarness.session, { target: rawPair.userId, summary: VALID_HANDOFF });
    const rawDetails = resultDetails(rawRun);
    expect(rawDetails.resolvedBy).toBe("entry_id");
    expect(rawDetails.resolvedEntryId).toBe(rawPair.userId);
    expect(rawDetails.resultingLeafId).toBe(rawDetails.summaryEntryId);

    const labelHarness = createHarness();
    const labelPair = appendUserAssistantPair(labelHarness.session);
    labelHarness.session.appendLabelChange(labelPair.userId, "labeled-phase-start");
    const labelRun = await runTravel(labelHarness.session, {
      target: "labeled-phase-start",
      summary: VALID_HANDOFF,
    });
    const labelDetails = resultDetails(labelRun);
    expect(labelDetails.resolvedBy).toBe("checkpoint");
    expect(labelDetails.resolvedEntryId).toBe(labelPair.userId);

    const rootHarness = createHarness();
    appendUserAssistantPair(rootHarness.session);
    rootHarness.session.resetLeaf();
    rootHarness.session.appendMessage({
      role: "user",
      content: [{ type: "text", text: "second root" }],
      timestamp: Date.now(),
    });
    const selectedRoot = rootHarness.session.getTree()[0]?.entry.id;
    if (!selectedRoot) throw new Error("fixture did not create a root");
    const rootRun = await runTravel(rootHarness.session, { target: "root", summary: VALID_HANDOFF });
    const rootDetails = resultDetails(rootRun);
    expect(rootDetails.resolvedBy).toBe("root");
    expect(rootDetails.resolvedEntryId).toBe(selectedRoot);
    expect(rootDetails.rootCount).toBe(2);
    expect(rootRun.notifications.some((message) => message.includes(selectedRoot) && message.includes("2 top-level roots"))).toBe(true);
  });

  test("restores an off-path raw node while preserving both abandoned branches", async () => {
    const harness = createHarness();
    const { userId, assistantId } = appendUserAssistantPair(harness.session);
    const firstSummaryId = harness.session.branchWithSummary(userId, "first branch", { originId: assistantId }, true);

    const run = await runTravel(harness.session, { target: assistantId, summary: VALID_HANDOFF });
    const details = resultDetails(run);
    const snapshot = harness.snapshot();

    expect(details.fromOffPath).toBe(true);
    expect(details.resolvedEntryId).toBe(assistantId);
    expect(run.notifications.some((message) => message.includes("off-path"))).toBe(true);
    expect(snapshot.entries.some((entry) => entry.id === firstSummaryId)).toBe(true);
    expect(snapshot.entries.some((entry) => entry.id === details.summaryEntryId)).toBe(true);
    expect(snapshot.entries.some((entry) => entry.id === assistantId)).toBe(true);
  });

  test("leaves all structure unchanged for target, abort, and duplicate-label prevalidation failures", async () => {
    const missingTargetHarness = createHarness();
    appendUserAssistantPair(missingTargetHarness.session);
    const missingBefore = structuralSnapshot(missingTargetHarness.snapshot());
    const missingRun = await runTravel(missingTargetHarness.session, {
      target: "missing-entry",
      summary: VALID_HANDOFF,
      backupCurrentHeadAs: "missing-target-done",
    });
    expect(resultDetails(missingRun).error).toBe("target_not_found");
    expect(structuralSnapshot(missingTargetHarness.snapshot())).toEqual(missingBefore);

    const abortedHarness = createHarness();
    const abortedPair = appendUserAssistantPair(abortedHarness.session);
    const abortedBefore = structuralSnapshot(abortedHarness.snapshot());
    const controller = new AbortController();
    controller.abort();
    const abortedRun = await runTravel(abortedHarness.session, {
      target: abortedPair.userId,
      summary: VALID_HANDOFF,
      backupCurrentHeadAs: "aborted-done",
    }, controller.signal);
    expect(resultDetails(abortedRun).error).toBe("aborted");
    expect(structuralSnapshot(abortedHarness.snapshot())).toEqual(abortedBefore);

    const duplicateHarness = createHarness();
    const duplicatePair = appendUserAssistantPair(duplicateHarness.session);
    duplicateHarness.session.appendLabelChange(duplicatePair.userId, "duplicate-backup");
    const duplicateBefore = structuralSnapshot(duplicateHarness.snapshot());
    const duplicateRun = await runTravel(duplicateHarness.session, {
      target: duplicatePair.userId,
      summary: VALID_HANDOFF,
      backupCurrentHeadAs: "duplicate-backup",
    });
    expect(resultDetails(duplicateRun).error).toBe("duplicate_backup_name");
    expect(structuralSnapshot(duplicateHarness.snapshot())).toEqual(duplicateBefore);
  });

  test("skips rollback when the backup target had an existing alias", async () => {
    const harness = createHarness();
    const { userId, assistantId } = appendUserAssistantPair(harness.session);
    harness.session.appendLabelChange(assistantId, "existing-alias");
    const view = sessionView(harness.session, {
      branchWithSummary() {
        throw new Error("synthetic branch failure");
      },
    });

    const run = await runTravel(view, {
      target: userId,
      summary: VALID_HANDOFF,
      backupCurrentHeadAs: "skip-rollback-done",
    });
    const details = resultDetails(run);
    const aliases = harness.snapshot().aliases[assistantId];

    expect(details.error).toBe("branch_failed");
    expect(details.backupRollbackSkipped).toBe(true);
    expect(details.backupRollbackSkipReason).toBe("prior_aliases");
    expect(aliases).toContain("existing-alias");
    expect(aliases).toContain("skip-rollback-done");
  });

  test("places backup labels on the nearest meaningful USER or AI entry", async () => {
    const harness = createHarness();
    const userId = harness.session.appendMessage({
      role: "user",
      content: [{ type: "text", text: "meaningful request" }],
      timestamp: Date.now(),
    });
    harness.session.appendMessage({
      role: "assistant",
      content: [{ type: "toolCall", id: "call-timeline", name: "acm_timeline", arguments: {} }],
      api: "test",
      provider: "test",
      model: "test",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: 0 },
      stopReason: "toolUse",
      timestamp: Date.now(),
    });
    const toolResultId = harness.session.appendMessage({
      role: "toolResult",
      toolCallId: "call-timeline",
      toolName: "acm_timeline",
      content: [{ type: "text", text: "result" }],
      isError: false,
      timestamp: Date.now(),
    });

    const run = await runTravel(harness.session, {
      target: userId,
      summary: VALID_HANDOFF,
      backupCurrentHeadAs: "meaningful-backup-done",
    });
    const details = resultDetails(run);

    expect(details.backupEntryId).toBe(userId);
    expect(details.backupResolvedFromHead).toBe(toolResultId);
    expect(harness.snapshot().aliases[userId]).toContain("meaningful-backup-done");
    expect(run.notifications.some((message) => message.includes("tool/internal traffic"))).toBe(true);
  });
});
