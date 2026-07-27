import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import {
  loadExtensions,
  ExtensionRunner,
  SessionManager,
} from "@oh-my-pi/pi-coding-agent";
import { cleanupHostTempDirs, createHostTempDir, createModelRegistry } from "./host-temp.ts";

afterEach(cleanupHostTempDirs);

async function createRunner(tempDir: string, sessionManager: SessionManager) {
  const loaded = await loadExtensions(
    [join(import.meta.dir, ".acm-build/index.js")],
    import.meta.dir,
  );
  expect(loaded.errors).toEqual([]);
  return new ExtensionRunner(
    loaded.extensions,
    loaded.runtime,
    tempDir,
    sessionManager,
    createModelRegistry(tempDir),
  );
}

test("OMP keeps native tree summarization when the host offers no prompt override", async () => {
  const tempDir = createHostTempDir("omp-context-tree-host-");
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
});

test("session_tree lifecycle cleanup runs on the exact OMP host", async () => {
  const tempDir = createHostTempDir("omp-context-tree-host-");
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
});
