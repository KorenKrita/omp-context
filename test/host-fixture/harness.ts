import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import type { SessionEntry, SessionTreeNode } from "@oh-my-pi/pi-coding-agent/session/session-entries";

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

function collectAliases(entries: SessionEntry[]): Record<string, string[]> {
  const labelOwner = new Map<string, string>();
  const aliases = new Map<string, string[]>();
  for (const entry of entries) {
    if (entry.type !== "label") continue;
    const current = aliases.get(entry.targetId) ?? [];
    if (entry.label === undefined) {
      for (const label of current) labelOwner.delete(label);
      aliases.delete(entry.targetId);
      continue;
    }
    const previousOwner = labelOwner.get(entry.label);
    if (previousOwner && previousOwner !== entry.targetId) {
      const remaining = (aliases.get(previousOwner) ?? []).filter((label) => label !== entry.label);
      if (remaining.length === 0) aliases.delete(previousOwner);
      else aliases.set(previousOwner, remaining);
    }
    labelOwner.set(entry.label, entry.targetId);
    if (!current.includes(entry.label)) aliases.set(entry.targetId, [...current, entry.label]);
  }
  return Object.fromEntries([...aliases.entries()].map(([id, labels]) => [id, [...labels]]));
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
        aliases: collectAliases(entries),
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
