import { describe, expect, test } from "bun:test";

const repoFile = (path: string) => Bun.file(new URL(`../${path}`, import.meta.url)).text();

describe("maintainer documentation contract", () => {
  test("documents canonical ownership, exact host support, and one-way manual synchronization", async () => {
    const readme = await repoFile("README.md");

    for (const fact of [
      "`omp-context` 是唯一 canonical ACM",
      "magic-acm-context",
      "bun run sync:acm",
      "--canonical-root",
      "--consumer-root",
      "preflight",
      "changed-file",
      "post-copy verification",
      "no changes",
      "不会执行任何 Git 操作",
      "分别提交",
      "支持的 OMP 版本：`16.4.2`",
      "guarded SessionManager",
      "agent.state.messages",
    ]) {
      expect(readme).toContain(fact);
    }

    expect(readme).toContain("skills/context-management/CORE.md");
    expect(readme).toContain("skills/context-management/SKILL.md");
    expect(readme).toContain("ACM extension 负责注入 CORE");
    expect(readme).toContain("Magic Context 只负责外围组合材料");
  });

  test("states guidance maintenance facts without duplicating the normal agent contract", async () => {
    const readme = await repoFile("README.md");

    expect(readme).toContain("七槽 handoff 是 agent completion criterion");
    expect(readme).toContain("不是 runtime 对语义正确性的证明");
    expect(readme).toContain("高 context pressure 只触发 boundary check，不会自动授权 travel");
    expect(readme).toContain("observed failure");
    expect(readme).toContain("changed host contract");
    expect(readme).toContain("docs/agents/acm-dogfooding.md");

    for (const duplicatedNormalRule of [
      "## 时间旅行",
      "## Fold gate",
      "Goal: <",
      "Checkpoint at these events",
      "Fold only when all three",
    ]) {
      expect(readme).not.toContain(duplicatedNormalRule);
    }
  });

  test("keeps a lightweight observed-use record with distinct failure categories", async () => {
    const dogfooding = await repoFile("docs/agents/acm-dogfooding.md");
    for (const category of [
      "missed checkpointing",
      "wrong boundary selection",
      "anchor gravity",
      "archive drift",
      "unnecessary Skill loading",
      "exceptional recovery failure",
    ]) {
      expect(dogfooding).toContain(category);
    }
    expect(dogfooding).toContain("Observed evidence");
    expect(dogfooding).toContain("Do not change guidance from speculation");
    expect(dogfooding).toContain("changed host contract");
  });
});

describe("repository agent guidance contract", () => {
  test("documents the strict timeline API and current canonical artifacts", async () => {
    const agents = await repoFile("AGENTS.md");

    for (const contract of [
      '`{ view: "active", limit?, verbose? }`',
      '`{ view: "checkpoints", limit?, filter? }`',
      '`{ view: "search", limit?, query }`',
      '`{ view: "tree", limit? }`',
      "src/host-bridge.ts",
      "src/generated-guidance.ts",
      "skills/context-management/CORE.md",
      "references/target-selection.md",
      "references/archive-recovery.md",
      "references/exceptional-recovery.md",
    ]) {
      expect(agents).toContain(contract);
    }

    for (const staleContract of [
      "`list_checkpoints: true`",
      "`full_tree: true`",
      "references/playbook.md",
      "timeline 模式",
      "`setEntryLabel(sm, entryId, label)`",
      "成功 tool result 会附带当前 context usage 和 **fold candidates**",
      "`list_checkpoints` 按",
      "timeline / `full_tree`",
    ]) {
      expect(agents).not.toContain(staleContract);
    }
  });

  test("keeps AGENTS focused on implementation contracts instead of restating CORE", async () => {
    const agents = await repoFile("AGENTS.md");

    expect(agents).toContain("normal-path agent guidance 的唯一可编辑来源");
    for (const duplicatedGuidance of [
      "working set / boundary / handoff / archive / anchor gravity",
      "Goal/State/Evidence/External/Exclusions/Recover/NEXT",
      'target: "<task-chain-start>"',
      "Boundary decides whether folding is semantically appropriate",
    ]) {
      expect(agents).not.toContain(duplicatedGuidance);
    }
  });
});
