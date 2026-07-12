import { afterEach, describe, expect, test } from "bun:test";
import { Agent } from "@oh-my-pi/pi-agent-core";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core/types";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import type { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import type { ExtensionRunner } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/runner";
import {
  createLiveAgentSessionAdapter,
  getLiveAgentSyncRecoveryGuidance,
  type AgentSessionHostClass,
} from "./.acm-build/live-agent-session-adapter.js";
import { useHostSessionHarnesses } from "./harness.js";

const createHarness = useHostSessionHarnesses();
const originalGetContextUsage = AgentSession.prototype.getContextUsage;

afterEach(() => {
  AgentSession.prototype.getContextUsage = originalGetContextUsage;
  delete (AgentSession.prototype as Record<PropertyKey, unknown>)[Symbol.for("omp-context.live-agent-session-adapter.v1")];
});

function createSession(sessionManager: ReturnType<typeof createHarness>["session"], messages: AgentMessage[] = []) {
  const agent = new Agent({ initialState: { messages } });
  const session = new AgentSession({
    agent,
    sessionManager,
    settings: Settings.isolated({ "compaction.enabled": false }),
    modelRegistry: {} as ModelRegistry,
    extensionRunner: { hasHandlers: () => false } as unknown as ExtensionRunner,
  });
  return { agent, session };
}

describe("live AgentSession adapter against pinned OMP", () => {
  test("captures by SessionManager identity and applies rebuilt active-branch messages", () => {
    const harness = createHarness();
    harness.session.appendMessage({
      role: "user",
      content: [{ type: "text", text: "active branch" }],
      timestamp: Date.now(),
    });
    const { agent, session } = createSession(harness.session, [{ role: "user", content: "stale", timestamp: Date.now() }]);
    const adapter = createLiveAgentSessionAdapter();

    expect(adapter.installation).toEqual({ status: "ready" });
    session.getContextUsage();
    expect(adapter.schedule(harness.session, harness.session.getLeafId() ?? undefined)).toMatchObject({ status: "pending" });
    expect(adapter.apply(harness.session)).toMatchObject({ status: "applied", messageCount: 1 });
    expect(agent.state.messages).toEqual(harness.session.buildSessionContext().messages);
  });

  test("installs one wrapper and invokes the original host method exactly once per call", () => {
    const harness = createHarness();
    const { session } = createSession(harness.session);
    let calls = 0;
    class IsolatedAgentSession extends AgentSession {}
    const hostClass = IsolatedAgentSession as unknown as AgentSessionHostClass;
    hostClass.prototype.getContextUsage = function () {
      calls++;
      return originalGetContextUsage.call(session);
    };

    const first = createLiveAgentSessionAdapter({ AgentSessionClass: hostClass });
    const wrapped = hostClass.prototype.getContextUsage;
    const second = createLiveAgentSessionAdapter({ AgentSessionClass: hostClass });

    expect(hostClass.prototype.getContextUsage).toBe(wrapped);
    hostClass.prototype.getContextUsage.call(session);
    expect(calls).toBe(1);
    expect(first.schedule(harness.session).status).toBe("pending");
    expect(second.apply(harness.session).status).toBe("applied");
  });

  test("reports unavailable for an unsupported version or host shape", () => {
    const unsupportedVersion = createLiveAgentSessionAdapter({ hostVersion: "16.4.4" });
    expect(unsupportedVersion.installation).toMatchObject({ status: "unavailable", reason: "unsupported_host_version" });
    const unsupportedOutcome = unsupportedVersion.schedule({});
    expect(unsupportedOutcome).toMatchObject({ status: "unavailable" });
    expect(getLiveAgentSyncRecoveryGuidance(unsupportedOutcome)).toContain("Reload");

    const unsupportedShape = createLiveAgentSessionAdapter({
      AgentSessionClass: { prototype: {} } as AgentSessionHostClass,
    });
    expect(unsupportedShape.installation).toMatchObject({ status: "unavailable", reason: "unsupported_host_shape" });
  });

  test("records a terminal diagnostic when the associated manager cannot expose its leaf", () => {
    class IsolatedAgentSession {
      getContextUsage() { return undefined; }
    }
    const adapter = createLiveAgentSessionAdapter({
      AgentSessionClass: IsolatedAgentSession as unknown as AgentSessionHostClass,
    });
    const brokenManager = { getLeafId: () => { throw new Error("leaf unavailable"); } };
    IsolatedAgentSession.prototype.getContextUsage.call({
      sessionManager: brokenManager,
      agent: { replaceMessages() {} },
    } as never);

    expect(adapter.schedule(brokenManager)).toMatchObject({ status: "pending" });
    expect(adapter.apply(brokenManager)).toMatchObject({
      status: "failed",
      reason: "read_leaf_failed",
      message: "leaf unavailable",
    });
    expect(adapter.getStatus(brokenManager)).toMatchObject({ status: "failed", reason: "read_leaf_failed" });
  });

  test("reports skipped without an association and failed when replacement throws", () => {
    const missingManager = {};
    const adapter = createLiveAgentSessionAdapter();
    expect(adapter.schedule(missingManager)).toMatchObject({ status: "skipped", reason: "missing_association" });

    const harness = createHarness();
    const { session } = createSession(harness.session);
    session.getContextUsage();
    session.agent.replaceMessages = () => {
      throw new Error("replacement refused");
    };
    expect(adapter.schedule(harness.session)).toMatchObject({ status: "pending" });
    const failure = adapter.apply(harness.session);
    expect(failure).toMatchObject({
      status: "failed",
      reason: "replace_messages_failed",
      message: "replacement refused",
    });
    expect(getLiveAgentSyncRecoveryGuidance(failure)).toContain("Reload");
  });
});
