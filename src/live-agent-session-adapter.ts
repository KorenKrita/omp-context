import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core/types";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { buildSessionMessages } from "./host-bridge.js";
import { fixOrphanedToolUse } from "./message-sanitizer.js";

export const SUPPORTED_AGENT_SESSION_HOST_VERSION = "16.4.5";
const INSTALLATION_SYMBOL = Symbol.for("omp-context.live-agent-session-adapter.v1");

interface LiveAgentSession {
  readonly sessionManager: object;
  readonly agent: {
    replaceMessages(messages: AgentMessage[]): void;
  };
}

export interface AgentSessionHostClass {
  readonly prototype: {
    getContextUsage(this: LiveAgentSession, ...args: unknown[]): unknown;
    [INSTALLATION_SYMBOL]?: InstallationState;
  };
}

export type AgentSessionSyncOutcome =
  | { status: "unavailable"; reason: "unsupported_host_version" | "unsupported_host_shape" | "host_version_unreadable"; message: string }
  | { status: "pending"; preferredLeafId?: string }
  | { status: "applied"; leafId: string | null; messageCount: number }
  | { status: "failed"; reason: "build_messages_failed" | "replace_messages_failed"; message: string }
  | { status: "skipped"; reason: "missing_association" | "not_pending" | "stale_leaf"; message: string };

interface InstallationState {
  readonly originalGetContextUsage: AgentSessionHostClass["prototype"]["getContextUsage"];
  readonly sessions: WeakMap<object, WeakRef<LiveAgentSession>>;
  readonly pending: WeakMap<object, string | undefined>;
  readonly outcomes: WeakMap<object, AgentSessionSyncOutcome>;
}

export interface LiveAgentSessionAdapter {
  readonly installation: AgentSessionSyncOutcome;
  schedule(sessionManager: object, preferredLeafId?: string): AgentSessionSyncOutcome;
  apply(sessionManager: object): AgentSessionSyncOutcome;
  getStatus(sessionManager: object): AgentSessionSyncOutcome;
  clear(sessionManager: object): void;
}

export interface LiveAgentSessionAdapterOptions {
  AgentSessionClass?: AgentSessionHostClass;
  hostVersion?: string;
}

export function readInstalledAgentSessionHostVersion(): string | undefined {
  try {
    const require = createRequire(`${import.meta.dir}/package.json`);
    const resolved = require.resolve("@oh-my-pi/pi-coding-agent/package.json");
    // Bun may prefix a resolved path repeatedly when this source is bundled for host fixtures.
    const manifestPath = resolved.replace(/^(?:file:)+/, "");
    const hostPackage = JSON.parse(readFileSync(manifestPath, "utf8")) as { version?: unknown };
    return typeof hostPackage.version === "string" ? hostPackage.version : undefined;
  } catch {
    return undefined;
  }
}

function unavailable(
  reason: Extract<AgentSessionSyncOutcome, { status: "unavailable" }>["reason"],
  message: string,
): AgentSessionSyncOutcome {
  return { status: "unavailable", reason, message };
}

function install(HostClass: AgentSessionHostClass): InstallationState | AgentSessionSyncOutcome {
  const prototype = HostClass?.prototype;
  if (!prototype || typeof prototype.getContextUsage !== "function") {
    return unavailable("unsupported_host_shape", "AgentSession.getContextUsage is unavailable");
  }

  const existing = Object.prototype.hasOwnProperty.call(prototype, INSTALLATION_SYMBOL)
    ? prototype[INSTALLATION_SYMBOL]
    : undefined;
  if (existing) return existing;

  const originalGetContextUsage = prototype.getContextUsage;
  const state: InstallationState = {
    originalGetContextUsage,
    sessions: new WeakMap(),
    pending: new WeakMap(),
    outcomes: new WeakMap(),
  };
  Object.defineProperty(prototype, INSTALLATION_SYMBOL, {
    value: state,
    configurable: true,
  });
  prototype.getContextUsage = function (this: LiveAgentSession, ...args: unknown[]) {
    if (this && typeof this.sessionManager === "object" && this.sessionManager !== null) {
      state.sessions.set(this.sessionManager, new WeakRef(this));
    }
    return originalGetContextUsage.apply(this, args);
  };
  return state;
}

function readLeafId(sessionManager: object): string | null {
  const candidate = sessionManager as { getLeafId?: () => string | null };
  return typeof candidate.getLeafId === "function" ? candidate.getLeafId() : null;
}

/**
 * Installs the narrow pinned-host adapter. Tree mutations remain owned by Host Bridge;
 * this adapter only replaces the live AgentSession message array after a caller schedules it.
 */
export function createLiveAgentSessionAdapter(
  options: LiveAgentSessionAdapterOptions = {},
): LiveAgentSessionAdapter {
  const hostVersion = options.hostVersion ?? readInstalledAgentSessionHostVersion();
  const HostClass = options.AgentSessionClass ?? AgentSession as unknown as AgentSessionHostClass;
  let installation: InstallationState | AgentSessionSyncOutcome;
  if (!hostVersion) {
    installation = unavailable("host_version_unreadable", "Could not determine the installed OMP host version");
  } else if (hostVersion !== SUPPORTED_AGENT_SESSION_HOST_VERSION) {
    installation = unavailable(
      "unsupported_host_version",
      `AgentSession synchronization supports OMP ${SUPPORTED_AGENT_SESSION_HOST_VERSION}, found ${hostVersion}`,
    );
  } else {
    installation = install(HostClass);
  }

  if (!("originalGetContextUsage" in installation)) {
    return {
      installation,
      schedule: () => installation as AgentSessionSyncOutcome,
      apply: () => installation as AgentSessionSyncOutcome,
      getStatus: () => installation as AgentSessionSyncOutcome,
      clear: () => undefined,
    };
  }

  const state = installation;
  const initialStatus: AgentSessionSyncOutcome = {
    status: "skipped",
    reason: "not_pending",
    message: "No AgentSession synchronization is pending",
  };
  return {
    installation: initialStatus,
    schedule(sessionManager, preferredLeafId) {
      const session = state.sessions.get(sessionManager)?.deref();
      if (!session) {
        const outcome: AgentSessionSyncOutcome = {
          status: "skipped",
          reason: "missing_association",
          message: "No live AgentSession is associated with this SessionManager",
        };
        state.outcomes.set(sessionManager, outcome);
        return outcome;
      }
      const outcome: AgentSessionSyncOutcome = preferredLeafId
        ? { status: "pending", preferredLeafId }
        : { status: "pending" };
      state.pending.set(sessionManager, preferredLeafId);
      state.outcomes.set(sessionManager, outcome);
      return outcome;
    },
    apply(sessionManager) {
      if (!state.pending.has(sessionManager)) {
        const outcome: AgentSessionSyncOutcome = {
          status: "skipped",
          reason: "not_pending",
          message: "No AgentSession synchronization is pending",
        };
        state.outcomes.set(sessionManager, outcome);
        return outcome;
      }
      const preferredLeafId = state.pending.get(sessionManager);
      state.pending.delete(sessionManager);
      const currentLeafId = readLeafId(sessionManager);
      if (preferredLeafId && currentLeafId !== preferredLeafId) {
        const outcome: AgentSessionSyncOutcome = {
          status: "skipped",
          reason: "stale_leaf",
          message: `Pending synchronization targeted ${preferredLeafId}, current leaf is ${currentLeafId ?? "none"}`,
        };
        state.outcomes.set(sessionManager, outcome);
        return outcome;
      }
      const session = state.sessions.get(sessionManager)?.deref();
      if (!session) {
        const outcome: AgentSessionSyncOutcome = {
          status: "skipped",
          reason: "missing_association",
          message: "The associated live AgentSession is no longer available",
        };
        state.outcomes.set(sessionManager, outcome);
        return outcome;
      }
      const messagesResult = buildSessionMessages(
        sessionManager as Parameters<typeof buildSessionMessages>[0],
      );
      if (!messagesResult.ok) {
        const outcome: AgentSessionSyncOutcome = {
          status: "failed",
          reason: "build_messages_failed",
          message: messagesResult.message,
        };
        state.outcomes.set(sessionManager, outcome);
        return outcome;
      }
      const messages = fixOrphanedToolUse(messagesResult.value);
      try {
        session.agent.replaceMessages(messages);
        const outcome: AgentSessionSyncOutcome = {
          status: "applied",
          leafId: currentLeafId,
          messageCount: messages.length,
        };
        state.outcomes.set(sessionManager, outcome);
        return outcome;
      } catch (error) {
        const outcome: AgentSessionSyncOutcome = {
          status: "failed",
          reason: "replace_messages_failed",
          message: error instanceof Error ? error.message : String(error),
        };
        state.outcomes.set(sessionManager, outcome);
        return outcome;
      }
    },
    getStatus(sessionManager) {
      return state.outcomes.get(sessionManager) ?? initialStatus;
    },
    clear(sessionManager) {
      state.pending.delete(sessionManager);
      state.outcomes.delete(sessionManager);
    },
  };
}
