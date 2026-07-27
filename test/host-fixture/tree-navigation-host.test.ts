import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  discoverAndLoadExtensions,
  ExtensionRunner,
  SessionManager,
} from "@oh-my-pi/pi-coding-agent";
import { createModelRegistry } from "./model-registry.ts";

async function createRunner(tempDir: string, sessionManager: SessionManager) {
  const loaded = await discoverAndLoadExtensions(
    ["./.acm-build/index.js"],
    import.meta.dir,
    join(tempDir, "empty-agent-dir"),
  );
  expect(loaded.errors).toEqual([]);
  const modelRegistry = await createModelRegistry(tempDir);
  return new ExtensionRunner(loaded.extensions, loaded.runtime, tempDir, sessionManager, modelRegistry);
}

test("OMP keeps native tree summarization when the host offers no prompt override", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "omp-context-tree-host-"));
  try {
    const sessionManager = SessionManager.inMemory(join(tempDir, "session.jsonl"));
    const rootId = sessionManager.appendMessage({ role: "user", content: "root", timestamp: Date.now() });
    sessionManager.appendMessage({ role: "user", content: "abandoned work", timestamp: Date.now() });
    const runner = await createRunner(tempDir, sessionManager);

    expect(runner.hasHandlers("session_before_tree")).toBe(false);
    const result = await runner.emit({
      type: "session_before_tree",
      preparation: {
        targetId: rootId,
        oldLeafId: sessionManager.getLeafId(),
        commonAncestorId: rootId,
        entriesToSummarize: sessionManager.getBranch().slice(1),
        userWantsSummary: true,
      },
      signal: new AbortController().signal,
    });
    expect(result).toBeUndefined();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("session_tree lifecycle cleanup runs on the exact OMP host", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "omp-context-tree-host-"));
  try {
    const sessionManager = SessionManager.inMemory(join(tempDir, "session.jsonl"));
    const rootId = sessionManager.appendMessage({ role: "user", content: "root", timestamp: Date.now() });
    sessionManager.appendMessage({ role: "user", content: "abandoned work", timestamp: Date.now() });
    const runner = await createRunner(tempDir, sessionManager);

    expect(runner.hasHandlers("session_tree")).toBe(true);
    const result = await runner.emit({
      type: "session_tree",
      newLeafId: rootId,
      oldLeafId: sessionManager.getLeafId(),
    });
    expect(result).toBeUndefined();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
