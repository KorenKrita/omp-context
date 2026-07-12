import { describe, expect, test } from "bun:test";
import type { SessionManager, ReadonlySessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@oh-my-pi/pi-coding-agent/extensibility/extensions/types";
import * as zod from "zod/v4";
import registerACMExtension from "./.acm-build/index.js";
import type { UsageLike } from "./.acm-build/lib.js";
import { GUIDANCE_CUES, RECOVERY_GUIDANCE } from "./.acm-build/generated-guidance.js";
import { type HostSessionSnapshot, useHostSessionHarnesses } from "./harness.js";
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

const createHarness = useHostSessionHarnesses();

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

function createContext(
  sessionManager: ReadonlySessionManager,
  notifications: string[],
  usage: UsageLike | undefined,
): ExtensionContext {
  const context = {
    sessionManager,
    getContextUsage: () => usage,
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
  usage: UsageLike | null = { tokens: 1200, contextWindow: 100_000, percent: 1.2 },
): Promise<TravelRun> {
  const notifications: string[] = [];
  const result = await captureTravelTool().execute(
    "travel-fixture",
    params,
    signal,
    undefined,
    createContext(sessionManager, notifications, usage ?? undefined),
  );
  return { result, notifications };
}

function resultDetails(run: TravelRun): Record<string, unknown> {
  const details = run.result.details;
  if (typeof details !== "object" || details === null) throw new Error("travel result did not include details");
  return details as Record<string, unknown>;
}

function resultText(run: TravelRun): string {
  return run.result.content.map((part) => part.type === "text" ? part.text : "").join("\n");
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

  test("leaves structure unchanged for empty, inactive, current, and non-meaningful targets", async () => {
    const emptyHarness = createHarness();
    const emptyBefore = structuralSnapshot(emptyHarness.snapshot());
    const emptyRun = await runTravel(emptyHarness.session, { target: "root", summary: VALID_HANDOFF });
    expect(resultDetails(emptyRun).error).toBe("empty_session");
    expect(structuralSnapshot(emptyHarness.snapshot())).toEqual(emptyBefore);

    const inactiveHarness = createHarness();
    const inactivePair = appendUserAssistantPair(inactiveHarness.session);
    inactiveHarness.session.resetLeaf();
    const inactiveBefore = structuralSnapshot(inactiveHarness.snapshot());
    const inactiveRun = await runTravel(inactiveHarness.session, {
      target: inactivePair.userId,
      summary: VALID_HANDOFF,
    });
    expect(resultDetails(inactiveRun).error).toBe("no_active_leaf");
    expect(structuralSnapshot(inactiveHarness.snapshot())).toEqual(inactiveBefore);

    const currentHarness = createHarness();
    const currentPair = appendUserAssistantPair(currentHarness.session);
    const currentBefore = structuralSnapshot(currentHarness.snapshot());
    const currentRun = await runTravel(currentHarness.session, {
      target: currentPair.assistantId,
      summary: VALID_HANDOFF,
    });
    expect(resultDetails(currentRun).error).toBe("already_at_target");
    expect(structuralSnapshot(currentHarness.snapshot())).toEqual(currentBefore);

    const nonMeaningfulHarness = createHarness();
    const firstCustomId = nonMeaningfulHarness.session.appendMessage({
      role: "custom",
      customType: "fixture",
      content: [{ type: "text", text: "first internal message" }],
      display: false,
      details: {},
      timestamp: Date.now(),
    });
    nonMeaningfulHarness.session.appendMessage({
      role: "custom",
      customType: "fixture",
      content: [{ type: "text", text: "second internal message" }],
      display: false,
      details: {},
      timestamp: Date.now(),
    });
    const nonMeaningfulBefore = structuralSnapshot(nonMeaningfulHarness.snapshot());
    const nonMeaningfulRun = await runTravel(nonMeaningfulHarness.session, {
      target: firstCustomId,
      summary: VALID_HANDOFF,
      backupCurrentHeadAs: "no-meaningful-backup-done",
    });
    expect(resultDetails(nonMeaningfulRun).error).toBe("no_meaningful_backup_target");
    expect(structuralSnapshot(nonMeaningfulHarness.snapshot())).toEqual(nonMeaningfulBefore);
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
    expect(resultText(run)).toContain(RECOVERY_GUIDANCE.branchRolledBack);
    const after = harness.snapshot();
    expect(after.aliases[assistantId]).toBeUndefined();
    expect(after.messages).toEqual(messagesBefore);
    expect(after.entries.some((entry) => entry.type === "branch_summary")).toBe(false);
  });

  test("commits an observed branch mutation when the host returns an invalid identifier", async () => {
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

    expect(details.error).toBeUndefined();
    expect(details.contextRefreshPending).toBe(true);
    expect(details.resultingLeafId).toBe(details.summaryEntryId);
    expect(harness.snapshot().aliases[assistantId]).toContain("partial-mutation-done");
  });

  test("marks context refresh pending when branch mutation is indeterminate", async () => {
    const harness = createHarness();
    const { userId, assistantId } = appendUserAssistantPair(harness.session);
    const view = sessionView(harness.session, {
      branchWithSummary(branchFromId, _summary, details, fromExtension) {
        return harness.session.branchWithSummary(branchFromId, "unexpected summary", details, fromExtension);
      },
    });

    const run = await runTravel(view, {
      target: userId,
      summary: VALID_HANDOFF,
      backupCurrentHeadAs: "indeterminate-branch-done",
    });
    const details = resultDetails(run);

    expect(details.error).toBe("branch_failed");
    expect(details.branchState).toBe("indeterminate");
    expect(details.contextRefreshPending).toBe(true);
    expect(details.backupRollbackSkipped).toBe(true);
    expect(harness.snapshot().aliases[assistantId]).toContain("indeterminate-branch-done");
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
    expect(resultText(run)).toContain(RECOVERY_GUIDANCE.rollbackFailed);
    expect(details.backupRollbackFailed).toBe(true);
    expect(details.remainingBackupLabel).toBe("rollback-failed-done");
    expect(details.backupEntryId).toBe(assistantId);
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

  test("rolls back a new backup while preserving prior aliases", async () => {
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
      backupCurrentHeadAs: "rollback-with-alias-done",
    });
    const details = resultDetails(run);
    const aliases = harness.snapshot().aliases[assistantId];

    expect(details.error).toBe("branch_failed");
    expect(resultText(run)).toContain(RECOVERY_GUIDANCE.branchRolledBack);
    expect(details.backupRolledBack).toBe(true);
    expect(details.backupRollbackSkipped).toBe(false);
    expect(aliases).toEqual(["existing-alias"]);
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

  test("reports raw usage and structural deltas without threshold verdicts", async () => {
    const harness = createHarness();
    const { userId } = appendUserAssistantPair(harness.session);
    const run = await runTravel(harness.session, { target: userId, summary: VALID_HANDOFF });
    const details = resultDetails(run);
    const text = run.result.content.map((part) => part.type === "text" ? part.text : "").join("\n");

    expect(details.usageBeforeTokens).toBe(1200);
    expect(typeof details.estimatedUsageAfterTokens).toBe("number");
    expect(details.tokenDelta).toBe(
      (details.estimatedUsageAfterTokens as number) - (details.usageBeforeTokens as number),
    );
    expect(details.percentagePointDelta).toBeCloseTo(
      (details.estimatedUsageAfterPercent as number) - (details.usageBeforePercent as number),
    );
    expect(details.structuralMessageDelta).toBe(
      (details.messagesAfter as number) - (details.messagesBefore as number),
    );
    expect(details.activeSummaryDepthBefore).toBe(0);
    expect(details.activeSummaryDepthAfter).toBe(1);
    expect(details.activeSummaryDepthDelta).toBe(1);
    expect(details.backupCurrentHeadAs).toBeNull();
    expect(details.backupEntryId).toBeUndefined();
    expect(details.usageAfter).toBe("pending_next_context_event");
    expect(["decreased", "increased", "equal"]).toContain(details.structuralMessageDirection);
    expect(details).not.toHaveProperty("estimatedEffect");
    expect(details).not.toHaveProperty("structuralEffect");
    expect(text).toContain(GUIDANCE_CUES.travelPhase);
    expect(text).toContain("summaryDepth=0 → 1 (delta=+1)");
    expect(text).not.toContain("estimatedEffect");
    expect(text).not.toMatch(/\b(shrunk|restored|unchanged)\b/);
  });

  test("reports stacked local folds and root rebases as factual summary-depth changes", async () => {
    const harness = createHarness();
    const firstPair = appendUserAssistantPair(harness.session);
    const firstFold = resultDetails(await runTravel(harness.session, {
      target: firstPair.userId,
      summary: VALID_HANDOFF,
    }));
    expect(firstFold).toMatchObject({
      activeSummaryDepthBefore: 0,
      activeSummaryDepthAfter: 1,
      activeSummaryDepthDelta: 1,
    });

    const secondPair = appendUserAssistantPair(harness.session);
    const stackedFold = resultDetails(await runTravel(harness.session, {
      target: secondPair.userId,
      summary: VALID_HANDOFF,
    }));
    expect(stackedFold).toMatchObject({
      activeSummaryDepthBefore: 1,
      activeSummaryDepthAfter: 2,
      activeSummaryDepthDelta: 1,
      targetIsStructuralRoot: false,
      summaryDepthNote: null,
    });

    const rootRebase = await runTravel(harness.session, {
      target: "root",
      summary: VALID_HANDOFF,
    });
    expect(resultDetails(rootRebase)).toMatchObject({
      activeSummaryDepthBefore: 2,
      activeSummaryDepthAfter: 1,
      activeSummaryDepthDelta: -1,
      targetSummaryDepth: 0,
      targetIsStructuralRoot: true,
      summaryDepthNote: "Root rebase replaced prior active handoff layers with one new handoff; resulting summary depth is 1 rather than 0.",
    });
    expect(resultText(rootRebase)).toContain("summaryDepth=2 → 1 (delta=-1)");
    expect(resultText(rootRebase)).toContain("Root rebase replaced prior active handoff layers with one new handoff; resulting summary depth is 1 rather than 0.");
  });

  test("uses null raw usage fields when context usage is unavailable", async () => {
    const harness = createHarness();
    const { userId } = appendUserAssistantPair(harness.session);
    const run = await runTravel(harness.session, { target: userId, summary: VALID_HANDOFF }, undefined, null);
    const details = resultDetails(run);
    const text = run.result.content.map((part) => part.type === "text" ? part.text : "").join("\n");

    expect(details.usageBeforeTokens).toBeNull();
    expect(details.usageBeforePercent).toBeNull();
    expect(details.estimatedUsageAfterTokens).toBeNull();
    expect(details.estimatedUsageAfterPercent).toBeNull();
    expect(details.tokenDelta).toBeNull();
    expect(details.percentagePointDelta).toBeNull();
    expect(text).toContain("unknown");
    expect(text).not.toMatch(/no saving|unchanged/i);
  });

  test("selects one canonical suffix-sensitive next cue", async () => {
    const phaseHarness = createHarness();
    const phasePair = appendUserAssistantPair(phaseHarness.session);
    const phaseRun = await runTravel(phaseHarness.session, { target: phasePair.userId, summary: VALID_HANDOFF });
    const phaseText = phaseRun.result.content.map((part) => part.type === "text" ? part.text : "").join("\n");
    expect(phaseText).toContain(GUIDANCE_CUES.travelPhase);
    expect(phaseText).not.toContain(GUIDANCE_CUES.travelTask);

    const taskHarness = createHarness();
    const taskPair = appendUserAssistantPair(taskHarness.session);
    const taskRun = await runTravel(taskHarness.session, {
      target: taskPair.userId,
      summary: VALID_HANDOFF,
      backupCurrentHeadAs: "travel-contract-done",
    });
    const taskText = taskRun.result.content.map((part) => part.type === "text" ? part.text : "").join("\n");
    expect(taskText).toContain(GUIDANCE_CUES.travelTask);
    expect(taskText).not.toContain(GUIDANCE_CUES.travelPhase);
  });

  test("uses canonical progressive recovery for collisions and host failures", async () => {
    const collisionHarness = createHarness();
    const collisionPair = appendUserAssistantPair(collisionHarness.session);
    collisionHarness.session.appendLabelChange(collisionPair.userId, "taken-backup");
    const collisionRun = await runTravel(collisionHarness.session, {
      target: collisionPair.userId,
      summary: VALID_HANDOFF,
      backupCurrentHeadAs: "taken-backup",
    });
    const collisionText = collisionRun.result.content.map((part) => part.type === "text" ? part.text : "").join("\n");
    expect(collisionText).toContain(RECOVERY_GUIDANCE.nameCollision);

    const capabilityHarness = createHarness();
    const capabilityPair = appendUserAssistantPair(capabilityHarness.session);
    const view = sessionView(capabilityHarness.session);
    const withoutAppend = {
      getEntries: view.getEntries.bind(view),
      getTree: view.getTree.bind(view),
      getBranch: view.getBranch.bind(view),
      getLeafId: view.getLeafId.bind(view),
      getEntry: view.getEntry.bind(view),
      branchWithSummary: view.branchWithSummary?.bind(view),
    };
    const before = structuralSnapshot(capabilityHarness.snapshot());
    const capabilityRun = await runTravel(withoutAppend as unknown as ReadonlySessionManager, {
      target: capabilityPair.userId,
      summary: VALID_HANDOFF,
      backupCurrentHeadAs: "missing-label-capability-done",

    });
    const capabilityText = capabilityRun.result.content.map((part) => part.type === "text" ? part.text : "").join("\n");
    expect(resultDetails(capabilityRun).error).toBe("backup_prevalidation_failed");
    expect(capabilityText).toContain(RECOVERY_GUIDANCE.hostCapability);
    expect(structuralSnapshot(capabilityHarness.snapshot())).toEqual(before);
  });


  test("reports canonical pending recovery when post-mutation message evidence fails", async () => {
    const harness = createHarness();
    const { userId } = appendUserAssistantPair(harness.session);
    let entryReads = 0;
    const view = sessionView(harness.session);
    const failAfterMutation = {
      getEntries() {
        entryReads += 1;
        if (entryReads >= 4) throw new Error("post-mutation build failed");
        return harness.session.getEntries();
      },
      getTree: view.getTree.bind(view),
      getBranch: view.getBranch.bind(view),
      getLeafId: view.getLeafId.bind(view),
      getEntry: view.getEntry.bind(view),
      appendLabelChange: view.appendLabelChange?.bind(view),
      branchWithSummary: view.branchWithSummary?.bind(view),
    };

    const run = await runTravel(failAfterMutation as unknown as ReadonlySessionManager, {
      target: userId,
      summary: VALID_HANDOFF,
    });
    const details = resultDetails(run);

    expect(details.error).toBe("build_messages_failed");
    expect(details.contextRefreshPending).toBe(true);
    expect(details.summaryEntryId).toBe(harness.snapshot().leafId);
    expect(resultText(run)).toContain(RECOVERY_GUIDANCE.refreshPending);
  });
  test("reports decreased, equal, and increased message-count directions factually", async () => {
    const decreasedHarness = createHarness();
    const decreasedFirst = appendUserAssistantPair(decreasedHarness.session);
    appendUserAssistantPair(decreasedHarness.session);
    const decreased = resultDetails(await runTravel(decreasedHarness.session, {
      target: decreasedFirst.userId,
      summary: VALID_HANDOFF,
    }));
    expect(decreased.structuralMessageDirection).toBe("decreased");
    expect(decreased.structuralMessageDelta).toBeLessThan(0);

    const equalHarness = createHarness();
    const equalPair = appendUserAssistantPair(equalHarness.session);
    const equal = resultDetails(await runTravel(equalHarness.session, {
      target: equalPair.userId,
      summary: VALID_HANDOFF,
    }));
    expect(equal.structuralMessageDirection).toBe("equal");
    expect(equal.structuralMessageDelta).toBe(0);

    const increasedHarness = createHarness();
    const increasedPair = appendUserAssistantPair(increasedHarness.session);
    increasedHarness.session.branchWithSummary(
      increasedPair.userId,
      "first branch",
      { originId: increasedPair.assistantId },
      true,
    );
    const increased = resultDetails(await runTravel(increasedHarness.session, {
      target: increasedPair.assistantId,
      summary: VALID_HANDOFF,
    }));
    expect(increased.structuralMessageDirection).toBe("increased");
    expect(increased.structuralMessageDelta).toBeGreaterThan(0);
  });

  test("reports restored off-path travel through its canonical recovery branch", async () => {
    const harness = createHarness();
    const { userId, assistantId } = appendUserAssistantPair(harness.session);
    harness.session.branchWithSummary(userId, "first branch", { originId: assistantId }, true);
    const run = await runTravel(harness.session, { target: assistantId, summary: VALID_HANDOFF });
    const text = run.result.content.map((part) => part.type === "text" ? part.text : "").join("\n");

    expect(resultDetails(run).fromOffPath).toBe(true);
    expect(text).toContain(RECOVERY_GUIDANCE.restoredHistory);
  });
});
