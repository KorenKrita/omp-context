import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core/types";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@oh-my-pi/pi-coding-agent/extensibility/extensions/types";
import type { ReadonlySessionManager, SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import * as zod from "zod/v4";
import registerACMExtension from "../../src/index.js";
import { HostBridge } from "../../src/host-bridge.js";
import { resolveTargetId } from "../../src/lib.js";
import { createHostSessionHarness, type HostSessionHarness } from "./harness.js";

const active: HostSessionHarness[] = [];
const VALID_HANDOFF = [
  "Goal: verify lifecycle cleanup",
  "State: summary branch selected",
  "Evidence: real SessionManager fixture",
  "External: none",
  "Exclusions: abandoned raw branch",
  "Recover: fixture root",
  "NEXT: continue after lifecycle event",
].join("\n");

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;

interface CapturedRuntime {
  handlers: Map<string, Handler[]>;
  tools: Map<string, ToolDefinition>;
}

function createHarness(): HostSessionHarness {
  const harness = createHostSessionHarness();
  active.push(harness);
  return harness;
}

afterEach(async () => {
  setSystemTime();
  await Promise.all(active.splice(0).map((harness) => harness.cleanup()));
});

function captureRuntime(): CapturedRuntime {
  const handlers = new Map<string, Handler[]>();
  const tools = new Map<string, ToolDefinition>();
  const api = {
    zod,
    on(name: string, handler: Handler) {
      const existing = handlers.get(name) ?? [];
      existing.push(handler);
      handlers.set(name, existing);
    },
    registerTool(tool: ToolDefinition) {
      tools.set(tool.name, tool);
    },
  };
  registerACMExtension(api as unknown as ExtensionAPI);
  return { handlers, tools };
}

function handler(runtime: CapturedRuntime, name: string): Handler {
  const captured = runtime.handlers.get(name)?.[0];
  if (!captured) throw new Error(`${name} handler was not registered`);
  return captured;
}

function runtimeContext(
  sessionManager: ReadonlySessionManager,
  notifications: string[] = [],
): ExtensionContext {
  return {
    sessionManager,
    getContextUsage: () => ({ tokens: 1_200, contextWindow: 100_000, percent: 1.2 }),
    ui: {
      notify(message: string) {
        notifications.push(message);
      },
    },
  } as unknown as ExtensionContext;
}

function appendAssistantText(session: SessionManager, value: string): string {
  return session.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: value }],
    api: "test",
    provider: "test",
    model: "test",
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: 0 },
    stopReason: "stop",
    timestamp: Date.now(),
  });
}

function appendInitialBranch(session: SessionManager): { userId: string; assistantId: string } {
  const userId = session.appendMessage({
    role: "user",
    content: [{ type: "text", text: "root request" }],
    timestamp: Date.now(),
  });
  const assistantId = appendAssistantText(session, "abandoned raw investigation");
  return { userId, assistantId };
}

async function runTravel(
  runtime: CapturedRuntime,
  sessionManager: ReadonlySessionManager,
  target: string,
): Promise<unknown> {
  const tool = runtime.tools.get("acm_travel");
  if (!tool) throw new Error("acm_travel was not registered");
  return tool.execute(
    "compaction-lifecycle-fixture",
    { target, summary: VALID_HANDOFF },
    undefined,
    undefined,
    runtimeContext(sessionManager),
  );
}

function replacementMessages(result: unknown): AgentMessage[] | undefined {
  if (typeof result !== "object" || result === null || !("messages" in result)) return undefined;
  const messages = result.messages;
  return Array.isArray(messages) ? messages as AgentMessage[] : undefined;
}

function controllableSessionView(session: SessionManager) {
  let failBuild = false;
  const view = {
    getEntries() {
      if (failBuild) throw new Error("fixture lifecycle build failed");
      return session.getEntries();
    },
    getTree: session.getTree.bind(session),
    getBranch: session.getBranch.bind(session),
    getLeafId: session.getLeafId.bind(session),
    getEntry: session.getEntry.bind(session),
    appendLabelChange: session.appendLabelChange.bind(session),
    branchWithSummary: session.branchWithSummary.bind(session),
  };
  // The fixture exposes the exact ReadonlySessionManager surface consumed by the extension.
  const readonlyView = view as unknown as ReadonlySessionManager;
  return {
    view: readonlyView,
    failBuild(value: boolean) {
      failBuild = value;
    },
  };
}

describe("native compaction lifecycle with real OMP SessionManager", () => {
  test("creates unique label-journal checkpoints that remain resolvable after compaction", async () => {
    setSystemTime(new Date("2026-07-11T12:34:56.000Z"));
    const harness = createHarness();
    const { userId, assistantId } = appendInitialBranch(harness.session);
    const runtime = captureRuntime();
    const beforeCompact = handler(runtime, "session_before_compact");
    const ctx = runtimeContext(harness.session);

    expect(await beforeCompact({ signal: undefined }, ctx)).toBeUndefined();
    expect(await beforeCompact({ signal: undefined }, ctx)).toBeUndefined();

    const labelsBefore = harness.session.getEntries().filter(
      (entry) => entry.type === "label" && entry.label?.startsWith("pre-compact-2026-07-11-12-34-56"),
    );
    expect(labelsBefore).toHaveLength(2);
    expect(new Set(labelsBefore.map((entry) => entry.label)).size).toBe(2);
    expect(labelsBefore.every((entry) => entry.targetId === assistantId)).toBe(true);

    const compactionId = harness.session.appendCompaction(
      "native compacted history",
      "native compacted history",
      userId,
      8_000,
      { source: "fixture" },
    );
    expect(harness.session.getLeafId()).toBe(compactionId);

    const bridge = new HostBridge(harness.session);
    const maps = bridge.buildLabelMaps();
    for (const entry of labelsBefore) {
      expect(entry.type).toBe("label");
      if (entry.type !== "label" || !entry.label) continue;
      expect(resolveTargetId(harness.session, bridge.getTree(), entry.label, bridge.getBranchIds(), maps)).toEqual({
        id: assistantId,
        fromOffPath: false,
      });
    }
  });

  test("native compaction clears pending refresh and retry state without replacing compaction", async () => {
    const harness = createHarness();
    const { userId } = appendInitialBranch(harness.session);
    const controlled = controllableSessionView(harness.session);
    const runtime = captureRuntime();
    const ctx = runtimeContext(controlled.view);

    await runTravel(runtime, controlled.view, userId);
    controlled.failBuild(true);
    const stale = [{ role: "user", content: [{ type: "text", text: "host-owned stale context" }] }];
    expect(replacementMessages(await handler(runtime, "context")({ messages: stale }, ctx))).toEqual(stale);

    controlled.failBuild(false);
    const beforeCompact = handler(runtime, "session_before_compact");
    expect(await beforeCompact({ signal: undefined }, ctx)).toBeUndefined();
    const compactionId = harness.session.appendCompaction(
      "native compaction remains host-owned",
      undefined,
      userId,
      9_000,
    );
    expect(await handler(runtime, "session_compact")({
      compactionEntry: harness.session.getEntry(compactionId),
      fromExtension: false,
    }, ctx)).toBeUndefined();

    controlled.failBuild(false);
    expect(await handler(runtime, "context")({ messages: stale }, ctx)).toBeUndefined();
    expect(harness.session.getLeafId()).toBe(compactionId);
  });

  test("session start and shutdown clear refresh state for only their SessionManager", async () => {
    const first = createHarness();
    const second = createHarness();
    const firstBranch = appendInitialBranch(first.session);
    const secondBranch = appendInitialBranch(second.session);
    const runtime = captureRuntime();
    const context = handler(runtime, "context");
    const staleFirst = [{ role: "user", content: [{ type: "text", text: "stale first" }] }];
    const staleSecond = [{ role: "user", content: [{ type: "text", text: "stale second" }] }];

    await runTravel(runtime, first.session, firstBranch.userId);
    expect(await context({ messages: staleSecond }, runtimeContext(second.session))).toBeUndefined();
    expect(JSON.stringify(replacementMessages(await context(
      { messages: staleFirst },
      runtimeContext(first.session),
    )))).toContain("summary branch selected");

    expect(await handler(runtime, "session_start")(
      { reason: "resume" },
      runtimeContext(first.session),
    )).toBeUndefined();
    expect(await context({ messages: staleFirst }, runtimeContext(first.session))).toBeUndefined();

    await runTravel(runtime, second.session, secondBranch.userId);
    expect(await handler(runtime, "session_shutdown")(
      { reason: "switch" },
      runtimeContext(second.session),
    )).toBeUndefined();
    expect(await context({ messages: staleSecond }, runtimeContext(second.session))).toBeUndefined();
  });
});
