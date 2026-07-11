import type { UsageLike } from "./lib.js";
import { ContextRefreshRegistry } from "./lib.js";

/** Per-extension state shared only by ACM modules that participate in session lifecycle. */
export class AcmSessionRuntime {
  readonly contextRefresh = new ContextRefreshRegistry();
  private readonly cachedUsage = new WeakMap<object, UsageLike>();
  private readonly refreshTargets = new WeakMap<object, string>();

  scheduleRefresh(session: object, preferredLeafId?: string): void {
    this.contextRefresh.markPending(session);
    if (preferredLeafId) this.refreshTargets.set(session, preferredLeafId);
    else this.refreshTargets.delete(session);
  }

  getRefreshTarget(session: object): string | undefined {
    return this.refreshTargets.get(session);
  }

  setUsage(session: object, usage: UsageLike): void {
    this.cachedUsage.set(session, usage);
  }

  getUsage(session: object): UsageLike | undefined {
    return this.cachedUsage.get(session);
  }

  clear(session: object): void {
    this.contextRefresh.clear(session);
    this.refreshTargets.delete(session);
    this.cachedUsage.delete(session);
  }
}
