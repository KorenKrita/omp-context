import { afterEach, describe, expect, test } from "bun:test";
import { Agent } from "@oh-my-pi/pi-agent-core";
import type { AgentMessage, AssistantMessage, ToolResultMessage } from "@oh-my-pi/pi-agent-core/types";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import type { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionHandler,
  ToolDefinition,
} from "@oh-my-pi/pi-coding-agent/extensibility/extensions/types";
import type { ExtensionRunner } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/runner";
import * as zod from "zod/v4";
import registerAcmExtension, { fixOrphanedToolUse } from "./.acm-build/index.js";
import { createLiveAgentSessionAdapter } from "./.acm-build/live-agent-session-adapter.js";
import { registerAcmLifecycle } from "./.acm-build/runtime-lifecycle.js";
import { AcmSessionRuntime } from "./.acm-build/runtime.js";
import { registerTimelineTool } from "./.acm-build/timeline-tool.js";
import { registerTravelTool } from "./.acm-build/travel-tool.js";
import { useHostSessionHarnesses } from "./harness.js";

const TOOL_CALL_ID = "travel-live-sync";
const HANDOFF = [
  "Goal: exercise live travel synchronization",
  "State: travel completed",
  "Evidence: pinned host prompt-loop fixture",
  "External: none",
  "Exclusions: none",
  "Recover: live-sync-done",
  "NEXT: continue from the traveled branch",
].join("\n");

const createHarness = useHostSessionHarnesses();
const originalGetContextUsage = AgentSession.prototype.getContextUsage;

afterEach(() => {
  AgentSession.prototype.getContextUsage = originalGetContextUsage;
  delete (AgentSession.prototype as Record<PropertyKey, unknown>)[Symbol.for("omp-context.live-agent-session-adapter.v1")];
});

function assistantText(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "test",
    provider: "test",
    model: "test",
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: 0 },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function travelToolCall(): AssistantMessage {
  return {
    ...assistantText(""),
    content: [{
      type: "toolCall",
      id: TOOL_CALL_ID,
      name: "acm_travel",
      arguments: { target: "root", summary: HANDOFF },
    }],
    stopReason: "toolUse",
  };
}

function hasToolCall(messages: readonly AgentMessage[], toolCallId: string): boolean {
  return messages.some((message) => message.role === "assistant" && Array.isArray(message.content) &&
    message.content.some((part) => part.type === "toolCall" && part.id === toolCallId));
}

function resultDetails(result: Awaited<ReturnType<ToolDefinition["execute"]>>): Record<string, unknown> {
  if (typeof result.details !== "object" || result.details === null) throw new Error("missing travel details");
  return result.details as Record<string, unknown>;
}

function createLiveExtensionFixture(
  harness: ReturnType<typeof createHarness>,
  initialMessages: AgentMessage[],
) {
  const handlers = new Map<string, ExtensionHandler<never>[]>();
  let travelTool: ToolDefinition | undefined;
  let timelineTool: ToolDefinition | undefined;
  let context: ExtensionContext;
  const api = {
    zod,
    registerTool(tool: ToolDefinition) {
      if (tool.name === "acm_travel") travelTool = tool;
      if (tool.name === "acm_timeline") timelineTool = tool;
    },
    on(event: string, handler: ExtensionHandler<never>) {
      const current = handlers.get(event) ?? [];
      current.push(handler);
      handlers.set(event, current);
    },
  } as unknown as ExtensionAPI;
  registerAcmExtension(api);

  const extensionRunner = {
    hasHandlers(type: string) {
      return (handlers.get(type)?.length ?? 0) > 0;
    },
    async emit(event: { type: string }) {
      let result: unknown;
      for (const handler of handlers.get(event.type) ?? []) result = await handler(event as never, context);
      return result;
    },
  } as unknown as ExtensionRunner;
  const agent = new Agent({ initialState: { messages: initialMessages } });
  const session = new AgentSession({
    agent,
    sessionManager: harness.session,
    settings: Settings.isolated({ "compaction.enabled": false }),
    modelRegistry: {} as ModelRegistry,
    extensionRunner,
  });
  context = {
    sessionManager: harness.session,
    getContextUsage: () => session.getContextUsage(),
    ui: { notify() {} },
  } as unknown as ExtensionContext;
  session.getContextUsage();
  if (!travelTool || !timelineTool) throw new Error("ACM tools were not registered");
  return { agent, context, handlers, session, timelineTool, travelTool };
}

async function emitToolEnd(
  handlers: Map<string, ExtensionHandler<never>[]>,
  context: ExtensionContext,
  toolCallId: string,
): Promise<void> {
  for (const handler of handlers.get("tool_execution_end") ?? []) {
    await handler({ type: "tool_execution_end", toolCallId, toolName: "acm_travel" } as never, context);
  }
}

describe("successful travel synchronizes the pinned live AgentSession", () => {
  test("applies after matching tool_execution_end while preserving the in-flight tool pair", async () => {
    const harness = createHarness();
    const rootId = harness.session.appendMessage({
      role: "user",
      content: [{ type: "text", text: "old branch root" }],
      timestamp: Date.now(),
    });
    const oldAssistantId = harness.session.appendMessage(assistantText("x".repeat(200_000)));
    const staleMessages: AgentMessage[] = [
      ...(harness.session.buildSessionContext().messages as AgentMessage[]),
      travelToolCall(),
    ];

    const handlers = new Map<string, ExtensionHandler<never>[]>();
    let travelTool: ToolDefinition | undefined;
    let timelineTool: ToolDefinition | undefined;
    let context: ExtensionContext;
    const api = {
      zod,
      registerTool(tool: ToolDefinition) {
        if (tool.name === "acm_travel") travelTool = tool;
        if (tool.name === "acm_timeline") timelineTool = tool;
      },
      on(event: string, handler: ExtensionHandler<never>) {
        const current = handlers.get(event) ?? [];
        current.push(handler);
        handlers.set(event, current);
      },
    } as unknown as ExtensionAPI;
    registerAcmExtension(api);

    const extensionRunner = {
      hasHandlers(type: string) {
        return (handlers.get(type)?.length ?? 0) > 0;
      },
      async emit(event: { type: string }) {
        let result: unknown;
        for (const handler of handlers.get(event.type) ?? []) result = await handler(event as never, context);
        return result;
      },
    } as unknown as ExtensionRunner;
    const agent = new Agent({ initialState: { messages: staleMessages } });
    const session = new AgentSession({
      agent,
      sessionManager: harness.session,
      settings: Settings.isolated({ "compaction.enabled": false }),
      modelRegistry: {} as ModelRegistry,
      extensionRunner,
    });
    context = {
      sessionManager: harness.session,
      getContextUsage: () => session.getContextUsage(),
      ui: { notify() {} },
    } as unknown as ExtensionContext;

    const usageBefore = session.getContextUsage();
    expect(travelTool).toBeDefined();
    const result = await travelTool!.execute(
      TOOL_CALL_ID,
      { target: rootId, summary: HANDOFF, backupCurrentHeadAs: "live-sync-done" },
      undefined,
      undefined,
      context,
    );
    expect(resultDetails(result)).toMatchObject({
      contextRefreshState: "pending",
      liveAgentSessionSyncState: "pending",
    });
    expect(agent.state.messages).toEqual(staleMessages);

    const toolResult: ToolResultMessage = {
      role: "toolResult",
      toolCallId: TOOL_CALL_ID,
      toolName: "acm_travel",
      content: [{ type: "text", text: "Travel complete" }],
      isError: false,
      timestamp: Date.now(),
    };
    const inFlightContext = [...staleMessages, toolResult];
    agent.emitExternalEvent({
      type: "tool_execution_end",
      toolCallId: TOOL_CALL_ID,
      toolName: "acm_travel",
      result: { content: toolResult.content },
      isError: false,
    });
    await Bun.sleep(0);

    const rebuilt = fixOrphanedToolUse(harness.session.buildSessionContext().messages as AgentMessage[]);
    expect(agent.state.messages).toEqual(rebuilt);
    expect(hasToolCall(inFlightContext, TOOL_CALL_ID)).toBe(true);
    expect(inFlightContext.some((message) => message.role === "toolResult" && message.toolCallId === TOOL_CALL_ID)).toBe(true);
    expect(hasToolCall(harness.session.buildSessionContext().messages as AgentMessage[], TOOL_CALL_ID)).toBe(false);
    expect(harness.session.getEntry(oldAssistantId)).toBeDefined();
    expect(harness.session.getEntries().some((entry) => entry.type === "label" && entry.label === "live-sync-done")).toBe(true);

    const contextHandlers = handlers.get("context") ?? [];
    let providerContext: AgentMessage[] = agent.state.messages;
    for (const handler of contextHandlers) {
      const response = await handler({ type: "context", messages: providerContext } as never, context) as { messages?: AgentMessage[] } | undefined;
      if (response?.messages) providerContext = response.messages;
    }
    expect(providerContext).toEqual(rebuilt);
    const usageAfter = session.getContextUsage();
    expect(usageAfter?.tokens ?? Number.POSITIVE_INFINITY).toBeLessThan(usageBefore?.tokens ?? 0);

    expect(timelineTool).toBeDefined();
    const timeline = await timelineTool!.execute(
      "timeline-after-live-sync",
      { view: "active" },
      undefined,
      undefined,
      context,
    );
    const timelineText = timeline.content.map((part) => part.type === "text" ? part.text : "").join("\n");
    expect(timelineText).toContain("Live Agent Sync:  applied");
  });

  test("converges to the newest leaf when a later travel supersedes pending work", async () => {
    const harness = createHarness();
    const rootId = harness.session.appendMessage({
      role: "user",
      content: [{ type: "text", text: "repeated travel root" }],
      timestamp: Date.now(),
    });
    harness.session.appendMessage(assistantText("first abandoned path"));
    const fixture = createLiveExtensionFixture(
      harness,
      harness.session.buildSessionContext().messages as AgentMessage[],
    );

    await fixture.travelTool.execute(
      "travel-first",
      { target: rootId, summary: HANDOFF, backupCurrentHeadAs: "repeated-first-done" },
      undefined,
      undefined,
      fixture.context,
    );
    const firstSummaryLeaf = harness.session.getLeafId();
    harness.session.appendMessage(assistantText("second abandoned path"));
    await fixture.travelTool.execute(
      "travel-second",
      { target: rootId, summary: HANDOFF.replace("travel completed", "second travel completed"), backupCurrentHeadAs: "repeated-second-done" },
      undefined,
      undefined,
      fixture.context,
    );
    const latestLeaf = harness.session.getLeafId();
    expect(latestLeaf).not.toBe(firstSummaryLeaf);

    await emitToolEnd(fixture.handlers, fixture.context, "travel-first");
    expect(fixture.agent.state.messages).not.toEqual(
      fixOrphanedToolUse(harness.session.buildSessionContext().messages as AgentMessage[]),
    );
    await emitToolEnd(fixture.handlers, fixture.context, "travel-second");

    const rebuilt = fixOrphanedToolUse(harness.session.buildSessionContext().messages as AgentMessage[]);
    expect(fixture.agent.state.messages).toEqual(rebuilt);
    expect(JSON.stringify(rebuilt)).toContain("second travel completed");
    expect(JSON.stringify(rebuilt)).not.toContain("first abandoned path");
    expect(JSON.stringify(rebuilt)).not.toContain("second abandoned path");
    expect(harness.session.getEntries().some((entry) => entry.id === firstSummaryLeaf)).toBe(true);
  });

  test("isolates concurrent parent and subagent sessions by SessionManager identity", async () => {
    const parentHarness = createHarness();
    const parentRootId = parentHarness.session.appendMessage({
      role: "user",
      content: [{ type: "text", text: "shared working directory parent root" }],
      timestamp: Date.now(),
    });
    parentHarness.session.appendMessage(assistantText("parent abandoned path"));
    const parentFixture = createLiveExtensionFixture(
      parentHarness,
      parentHarness.session.buildSessionContext().messages as AgentMessage[],
    );

    const subagentHarness = createHarness();
    const subagentRootId = subagentHarness.session.appendMessage({
      role: "user",
      content: [{ type: "text", text: "shared working directory subagent root" }],
      timestamp: Date.now(),
    });
    subagentHarness.session.appendMessage(assistantText("subagent abandoned path"));
    const subagentFixture = createLiveExtensionFixture(
      subagentHarness,
      subagentHarness.session.buildSessionContext().messages as AgentMessage[],
    );
    const subagentMessagesBeforeTravel = [...subagentFixture.agent.state.messages];

    await parentFixture.travelTool.execute(
      "parent-travel",
      {
        target: parentRootId,
        summary: HANDOFF.replace("travel completed", "parent travel completed"),
        backupCurrentHeadAs: "parent-session-archive",
      },
      undefined,
      undefined,
      parentFixture.context,
    );
    await subagentFixture.travelTool.execute(
      "subagent-travel",
      {
        target: subagentRootId,
        summary: HANDOFF.replace("travel completed", "subagent travel completed"),
        backupCurrentHeadAs: "subagent-session-archive",
      },
      undefined,
      undefined,
      subagentFixture.context,
    );

    await emitToolEnd(parentFixture.handlers, parentFixture.context, "parent-travel");
    const rebuiltParent = fixOrphanedToolUse(
      parentHarness.session.buildSessionContext().messages as AgentMessage[],
    );
    expect(parentFixture.agent.state.messages).toEqual(rebuiltParent);
    expect(JSON.stringify(parentFixture.agent.state.messages)).toContain("parent travel completed");
    expect(JSON.stringify(parentFixture.agent.state.messages)).not.toContain("subagent travel completed");
    expect(subagentFixture.agent.state.messages).toEqual(subagentMessagesBeforeTravel);

    const subagentTimelinePending = await subagentFixture.timelineTool.execute(
      "subagent-timeline-pending",
      { view: "active" },
      undefined,
      undefined,
      subagentFixture.context,
    );
    expect(subagentTimelinePending.content.map((part) => part.type === "text" ? part.text : "").join("\n"))
      .toContain("Live Agent Sync:  pending");

    await emitToolEnd(subagentFixture.handlers, subagentFixture.context, "subagent-travel");
    const rebuiltSubagent = fixOrphanedToolUse(
      subagentHarness.session.buildSessionContext().messages as AgentMessage[],
    );
    expect(subagentFixture.agent.state.messages).toEqual(rebuiltSubagent);
    expect(JSON.stringify(subagentFixture.agent.state.messages)).toContain("subagent travel completed");
    expect(JSON.stringify(subagentFixture.agent.state.messages)).not.toContain("parent travel completed");
    expect(parentFixture.agent.state.messages).toEqual(rebuiltParent);

    const parentTimelineApplied = await parentFixture.timelineTool.execute(
      "parent-timeline-applied",
      { view: "active" },
      undefined,
      undefined,
      parentFixture.context,
    );
    expect(parentTimelineApplied.content.map((part) => part.type === "text" ? part.text : "").join("\n"))
      .toContain("Live Agent Sync:  applied");
  });

  test("restores an off-path checkpoint and expands live state to that branch", async () => {
    const harness = createHarness();
    const rootId = harness.session.appendMessage({
      role: "user",
      content: [{ type: "text", text: "restore branch root" }],
      timestamp: Date.now(),
    });
    const rawBranchId = harness.session.appendMessage(assistantText("recoverable raw branch detail"));
    const fixture = createLiveExtensionFixture(
      harness,
      harness.session.buildSessionContext().messages as AgentMessage[],
    );

    await fixture.travelTool.execute(
      "travel-shrink",
      { target: rootId, summary: HANDOFF, backupCurrentHeadAs: "raw-branch-archive" },
      undefined,
      undefined,
      fixture.context,
    );
    const shrunkenLeaf = harness.session.getLeafId();
    await emitToolEnd(fixture.handlers, fixture.context, "travel-shrink");
    expect(JSON.stringify(fixture.agent.state.messages)).not.toContain("recoverable raw branch detail");

    const restoreSummary = HANDOFF.replace("travel completed", "raw branch restored");
    await fixture.travelTool.execute(
      "travel-restore",
      { target: "raw-branch-archive", summary: restoreSummary, backupCurrentHeadAs: "shrunken-branch-archive" },
      undefined,
      undefined,
      fixture.context,
    );
    await emitToolEnd(fixture.handlers, fixture.context, "travel-restore");

    const restored = fixOrphanedToolUse(harness.session.buildSessionContext().messages as AgentMessage[]);
    expect(fixture.agent.state.messages).toEqual(restored);
    expect(JSON.stringify(restored)).toContain("recoverable raw branch detail");
    expect(JSON.stringify(restored)).toContain("raw branch restored");
    expect(harness.session.getEntry(rawBranchId)).toBeDefined();
    expect(harness.session.getEntry(shrunkenLeaf!)).toBeDefined();
  });

  test("reconstructs the active traveled branch after persistence and resume", async () => {
    const harness = createHarness();
    const rootId = harness.session.appendMessage({
      role: "user",
      content: [{ type: "text", text: "persistent travel root" }],
      timestamp: Date.now(),
    });
    harness.session.appendMessage(assistantText("discarded before resume"));
    const fixture = createLiveExtensionFixture(
      harness,
      harness.session.buildSessionContext().messages as AgentMessage[],
    );
    await fixture.travelTool.execute(
      "travel-before-resume",
      { target: rootId, summary: HANDOFF.replace("travel completed", "persisted travel state"), backupCurrentHeadAs: "resume-archive" },
      undefined,
      undefined,
      fixture.context,
    );
    await emitToolEnd(fixture.handlers, fixture.context, "travel-before-resume");
    const beforeReload = harness.snapshot();

    const reloaded = await harness.reload();
    const resumedMessages = reloaded.buildSessionContext().messages as AgentMessage[];
    const resumedAgent = new Agent({ initialState: { messages: resumedMessages } });
    const resumedSession = new AgentSession({
      agent: resumedAgent,
      sessionManager: reloaded,
      settings: Settings.isolated({ "compaction.enabled": false }),
      modelRegistry: {} as ModelRegistry,
      extensionRunner: { hasHandlers: () => false } as unknown as ExtensionRunner,
    });
    resumedSession.getContextUsage();

    expect(harness.snapshot(reloaded).leafId).toBe(beforeReload.leafId);
    expect(harness.snapshot(reloaded).tree).toEqual(beforeReload.tree);
    expect(resumedAgent.state.messages).toEqual(resumedMessages);
    expect(JSON.stringify(resumedAgent.state.messages)).toContain("persisted travel state");
    expect(JSON.stringify(resumedAgent.state.messages)).not.toContain("discarded before resume");
  });

  test("preserves the traveled branch and persistent provider context when live replacement fails", async () => {
    const harness = createHarness();
    const rootId = harness.session.appendMessage({
      role: "user",
      content: [{ type: "text", text: "failure branch root" }],
      timestamp: Date.now(),
    });
    const abandonedId = harness.session.appendMessage(assistantText("abandoned live state"));
    const handlers = new Map<string, ExtensionHandler<never>[]>();
    let travelTool: ToolDefinition | undefined;
    let timelineTool: ToolDefinition | undefined;
    const api = {
      zod,
      registerTool(tool: ToolDefinition) {
        if (tool.name === "acm_travel") travelTool = tool;
        if (tool.name === "acm_timeline") timelineTool = tool;
      },
      on(event: string, handler: ExtensionHandler<never>) {
        const current = handlers.get(event) ?? [];
        current.push(handler);
        handlers.set(event, current);
      },
    } as unknown as ExtensionAPI;
    registerAcmExtension(api);

    const staleMessages = harness.session.buildSessionContext().messages as AgentMessage[];
    const agent = new Agent({ initialState: { messages: staleMessages } });
    const session = new AgentSession({
      agent,
      sessionManager: harness.session,
      settings: Settings.isolated({ "compaction.enabled": false }),
      modelRegistry: {} as ModelRegistry,
      extensionRunner: { hasHandlers: () => false } as unknown as ExtensionRunner,
    });
    const notifications: string[] = [];
    const context = {
      sessionManager: harness.session,
      getContextUsage: () => session.getContextUsage(),
      ui: { notify(message: string) { notifications.push(message); } },
    } as unknown as ExtensionContext;
    session.getContextUsage();
    session.agent.replaceMessages = () => {
      throw new Error("replacement refused by fixture");
    };

    const result = await travelTool!.execute(
      "travel-failure",
      { target: rootId, summary: HANDOFF, backupCurrentHeadAs: "live-sync-failure-done" },
      undefined,
      undefined,
      context,
    );
    expect(resultDetails(result)).toMatchObject({ liveAgentSessionSyncState: "pending" });
    for (const handler of handlers.get("tool_execution_end") ?? []) {
      await handler({
        type: "tool_execution_end",
        toolCallId: "travel-failure",
        toolName: "acm_travel",
      } as never, context);
    }

    expect(agent.state.messages).toEqual(staleMessages);
    expect(harness.session.getEntry(abandonedId)).toBeDefined();
    expect(harness.session.getEntries().some((entry) => entry.type === "label" && entry.label === "live-sync-failure-done")).toBe(true);
    expect(harness.session.getEntries().some((entry) => entry.type === "branch_summary")).toBe(true);
    expect(hasToolCall(harness.session.buildSessionContext().messages as AgentMessage[], "travel-failure")).toBe(false);

    let providerContext = staleMessages;
    for (const handler of handlers.get("context") ?? []) {
      const response = await handler({ type: "context", messages: providerContext } as never, context) as { messages?: AgentMessage[] } | undefined;
      if (response?.messages) providerContext = response.messages;
    }
    expect(providerContext).toEqual(fixOrphanedToolUse(harness.session.buildSessionContext().messages as AgentMessage[]));

    const timeline = await timelineTool!.execute("timeline-after-failure", { view: "active" }, undefined, undefined, context);
    const timelineText = timeline.content.map((part) => part.type === "text" ? part.text : "").join("\n");
    expect(timelineText).toContain("Live Agent Sync:  failed");
    expect(timelineText).toContain("replacement refused by fixture");
    expect(timelineText).toContain("Reload the session");
    expect(notifications).toEqual([]);
  });

  test("keeps travel functional and reports reload guidance when the pinned live adapter is unavailable", async () => {
    const harness = createHarness();
    const rootId = harness.session.appendMessage({
      role: "user",
      content: [{ type: "text", text: "unsupported host root" }],
      timestamp: Date.now(),
    });
    harness.session.appendMessage(assistantText("fold this unsupported-host path"));
    const handlers = new Map<string, ExtensionHandler<never>[]>();
    let travelTool: ToolDefinition | undefined;
    let timelineTool: ToolDefinition | undefined;
    const api = {
      zod,
      registerTool(tool: ToolDefinition) {
        if (tool.name === "acm_travel") travelTool = tool;
        if (tool.name === "acm_timeline") timelineTool = tool;
      },
      on(event: string, handler: ExtensionHandler<never>) {
        const current = handlers.get(event) ?? [];
        current.push(handler);
        handlers.set(event, current);
      },
    } as unknown as ExtensionAPI;
    const runtime = new AcmSessionRuntime(createLiveAgentSessionAdapter({ hostVersion: "16.4.4" }));
    registerTravelTool(api, runtime);
    registerTimelineTool(api, runtime);
    registerAcmLifecycle(api, runtime);
    const context = {
      sessionManager: harness.session,
      getContextUsage: () => undefined,
      ui: { notify() {} },
    } as unknown as ExtensionContext;
    const staleMessages = harness.session.buildSessionContext().messages as AgentMessage[];

    const result = await travelTool!.execute(
      "travel-unavailable",
      { target: rootId, summary: HANDOFF, backupCurrentHeadAs: "live-sync-unavailable-done" },
      undefined,
      undefined,
      context,
    );
    expect(resultDetails(result)).toMatchObject({
      contextRefreshState: "pending",
      liveAgentSessionSyncState: "unavailable",
    });
    const resultText = result.content.map((part) => part.type === "text" ? part.text : "").join("\n");
    expect(resultText).toContain("Reload the session");

    let providerContext = staleMessages;
    for (const handler of handlers.get("context") ?? []) {
      const response = await handler({ type: "context", messages: providerContext } as never, context) as { messages?: AgentMessage[] } | undefined;
      if (response?.messages) providerContext = response.messages;
    }
    expect(providerContext).toEqual(fixOrphanedToolUse(harness.session.buildSessionContext().messages as AgentMessage[]));

    const timeline = await timelineTool!.execute("timeline-unavailable", { view: "active" }, undefined, undefined, context);
    const timelineText = timeline.content.map((part) => part.type === "text" ? part.text : "").join("\n");
    expect(timelineText).toContain("Live Agent Sync:  unavailable");
    expect(timelineText).toContain("Reload the session");
  });
});
