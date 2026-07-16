import { describe, expect, test } from "bun:test";

const repoFile = (path: string) => Bun.file(new URL(`../${path}`, import.meta.url)).text();

describe("product documentation contract", () => {
  test("presents the user problem, product behavior, installation, and safety boundary", async () => {
    const readme = await repoFile("README.md");

    for (const claim of [
      "让 OMP agent 主动维护自己的上下文",
      "压缩即智能",
      "Semantic rebase",
      "cold start",
      "30% / 50% / 70%",
      "baseline-only",
      "不自动执行 summary、fold、rebase 或 travel",
      "acm_checkpoint",
      "acm_timeline",
      "acm_travel",
      "omp install github:KorenKrita/omp-context",
      "root 是理想候选，不是默认答案",
      "不会回滚文件、进程、浏览器、Git commit 或远端服务",
      "不会取消、替换或延迟 OMP 原生 compaction",
      "AGENTS.md",
    ]) {
      expect(readme).toContain(claim);
    }
  });

  test("keeps maintainer mechanics out of the product README", async () => {
    const readme = await repoFile("README.md");
    for (const maintainerDetail of [
      "手动同步到",
      "Host Bridge capabilities",
      "atomically replace every exact OMP version",
      "rollback journal",
      "provenance manifest",
    ]) {
      expect(readme).not.toContain(maintainerDetail);
    }
  });

  test("keeps observed-use evidence categories current", async () => {
    const dogfooding = await repoFile("docs/agents/acm-dogfooding.md");
    for (const category of [
      "missed checkpointing",
      "wrong boundary selection",
      "anchor gravity",
      "missed rebase",
      "archive drift",
      "unnecessary Skill loading",
      "exceptional recovery failure",
    ]) {
      expect(dogfooding).toContain(category);
    }
    expect(dogfooding).toContain("Observed evidence");
    expect(dogfooding).toContain("Do not change guidance from speculation");
  });
});

describe("repository agent guidance contract", () => {
  test("owns architecture, exact-host maintenance, and the pre-commit gate", async () => {
    const agents = await repoFile("AGENTS.md");

    for (const contract of [
      '`{ view: "active", limit?, verbose? }`',
      '`{ view: "checkpoints", limit?, filter? }`',
      '`{ view: "search", limit?, query }`',
      '`{ view: "tree", limit? }`',
      "src/host-bridge.ts",
      "src/travel-coordinator.ts",
      "src/live-agent-session-adapter.ts",
      "src/context-usage-nudge.ts",
      "session_stop",
      "nextTurn",
      "scripts/precommit-host-contract.mjs",
      "scripts/host-version.mjs",
      ".githooks/pre-commit",
      "每次 commit",
      "cold candidate",
      "host:promote-local",
    ]) {
      expect(agents).toContain(contract);
    }

    expect(agents).not.toContain("declarative canonical →");
  });

  test("keeps AGENTS focused on implementation contracts instead of restating CORE", async () => {
    const agents = await repoFile("AGENTS.md");
    expect(agents).toContain("CORE.md` 拥有 always-on 判断力与 cadence");
    expect(agents).toContain("TOOL-CONTRACTS.md` 拥有工具描述");
    for (const duplicatedGuidance of [
      "Goal/State/Evidence/External/Exclusions/Recover/NEXT",
      'target: "<task-chain-start>"',
      "Boundary decides whether folding is semantically appropriate",
    ]) {
      expect(agents).not.toContain(duplicatedGuidance);
    }
  });
});
