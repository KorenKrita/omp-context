import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { AuthStorage, SqliteAuthCredentialStore } from "@oh-my-pi/pi-ai";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";

/**
 * OMP's SQLite credential store leaks its file handles: `AgentStorage.#close()`
 * and `AuthStorage.close()` both delegate to
 * `SqliteAuthCredentialStore.close()`, which finalizes 26 of its 34 prepared
 * statements. The 8 survivors (`#updateIfMatchesStmt`, `#deleteCachePrefixStmt`,
 * `#updateIfMatchesWithLeaseStmt`, `#deleteIfMatchesWithLeaseStmt`, and the four
 * `*CredentialRefreshLease*` statements) keep the `bun:sqlite` `Database` alive,
 * so the trailing `#db.close()` silently no-ops and `agent.db`, `agent.db-wal`,
 * and `agent.db-shm` stay open for the rest of the process.
 *
 * POSIX unlinks open files happily, so this is invisible on Linux and macOS.
 * Windows refuses to delete a directory containing open handles, which failed
 * every host-fixture test whose `finally` block removed a temp dir holding an
 * `agent.db` — five `EBUSY` failures, Windows-only, with the assertions
 * themselves passing.
 *
 * The fix is to keep credential storage out of any directory a test deletes.
 */

/** Dirs from {@link createHostTempDir}: must be removable, so failures throw. */
const strictTempDirs: string[] = [];
/** Dirs from {@link createHostAgentDir}: hold OMP's leaked `agent.db` handles. */
const leakedTempDirs: string[] = [];

/**
 * Creates a temp dir {@link cleanupHostTempDirs} must be able to delete. Nothing
 * under it may hold an OMP credential database — see this module's header. Pass
 * the result as `cwd`, session paths, and Skill fixtures.
 */
export function createHostTempDir(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  strictTempDirs.push(directory);
  return directory;
}

/**
 * Creates a temp dir for an `agentDir` that OMP will populate with the leaked
 * `agent.db` handles. Kept separate from {@link createHostTempDir} so the leak
 * cannot make a strict cleanup fail; removal here is best-effort on Windows.
 */
export function createHostAgentDir(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  leakedTempDirs.push(directory);
  return directory;
}

/**
 * Removes every directory this module created. `createHostTempDir` failures
 * propagate — an `EBUSY` there means a test reintroduced an open handle under a
 * strict temp dir, exactly the Windows regression this module exists to catch.
 * `createHostAgentDir` failures are swallowed because the open handle is OMP's,
 * not the test's; the OS reclaims the temp dir after the process exits.
 */
export function cleanupHostTempDirs(): void {
  for (const directory of strictTempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
  for (const directory of leakedTempDirs.splice(0)) {
    try {
      rmSync(directory, { recursive: true, force: true });
    } catch {
      // OMP still holds agent.db; Windows refuses the delete. Leave it to the OS.
    }
  }
}

/**
 * Credential storage backed by an in-memory SQLite database, so the leaked
 * handles have no file to pin. Use for hosts that accept an `authStorage`.
 */
export function createInMemoryAuthStorage(): AuthStorage {
  return new AuthStorage(new SqliteAuthCredentialStore(new Database(":memory:")));
}

/**
 * A registry over in-memory credentials. Unlike `discoverAuthStorage(tempDir)`,
 * this writes no `agent.db` into the temp dir, so cleanup cannot hit `EBUSY`.
 */
export function createModelRegistry(tempDir: string): ModelRegistry {
  return new ModelRegistry(createInMemoryAuthStorage(), join(tempDir, "models.yml"));
}
