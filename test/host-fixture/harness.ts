import { afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import type { SessionEntry, SessionTreeNode } from "@oh-my-pi/pi-coding-agent/session/session-entries";
import { buildLabelMaps } from "../../src/label-journal.js";

export interface HostSessionSnapshot {
  entries: SessionEntry[];
  aliases: Record<string, string[]>;
  leafId: string | null;
  tree: Array<{ id: string; type: string; children: Array<{ id: string; type: string }> }>;
  messages: unknown[];
}

export interface HostSessionHarness {
  readonly rootDir: string;
  readonly sessionDir: string;
  readonly session: SessionManager;
  reload(): Promise<SessionManager>;
  snapshot(session?: SessionManager): HostSessionSnapshot;
  cleanup(): Promise<void>;
}

export function useHostSessionHarnesses(options: {
  beforeCleanup?: () => void | Promise<void>;
} = {}): () => HostSessionHarness {
  const active: HostSessionHarness[] = [];
  afterEach(async () => {
    await options.beforeCleanup?.();
    await Promise.all(active.splice(0).map((harness) => harness.cleanup()));
  });
  return () => {
    const harness = createHostSessionHarness();
    active.push(harness);
    return harness;
  };
}



function summarizeTree(nodes: SessionTreeNode[]): HostSessionSnapshot["tree"] {
  return nodes.map((node) => ({
    id: node.entry.id,
    type: node.entry.type,
    children: node.children.map((child) => ({ id: child.entry.id, type: child.entry.type })),
  }));
}

export function createHostSessionHarness(): HostSessionHarness {
  const rootDir = mkdtempSync(join(tmpdir(), "omp-context-host-"));
  const sessionDir = join(rootDir, "sessions");
  let current = SessionManager.create(rootDir, sessionDir);
  const sessions = new Set<SessionManager>([current]);

  return {
    rootDir,
    sessionDir,
    get session() {
      return current;
    },
    async reload() {
      await current.flush();
      const sessionFile = current.getSessionFile();
      if (!sessionFile) throw new Error("SessionManager did not create a persisted session file");
      await current.close();
      current = await SessionManager.open(sessionFile, sessionDir, undefined, {
        initialCwd: rootDir,
        suppressBreadcrumb: true,
      });
      sessions.add(current);
      return current;
    },
    snapshot(session = current) {
      const entries = session.getEntries();
      return {
        entries,
        aliases: Object.fromEntries(buildLabelMaps(entries).entryToLabels),
        leafId: session.getLeafId(),
        tree: summarizeTree(session.getTree()),
        messages: session.buildSessionContext().messages,
      };
    },
    async cleanup() {
      for (const session of sessions) {
        await session.close().catch(() => undefined);
      }
      rmSync(rootDir, { recursive: true, force: true });
    },
  };
}
