import { afterEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createAgentSession, DefaultResourceLoader } from "@oh-my-pi/pi-coding-agent/extensibility/legacy-pi-coding-agent-shim";
import type { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { cleanupHostTempDirs, createHostAgentDir, createHostTempDir, createInMemoryAuthStorage } from "./host-temp.ts";

afterEach(cleanupHostTempDirs);

test("exact OMP Skills system prompt lists an absolute SKILL.md and keeps Skill bodies on demand", async () => {
  const tempDir = createHostTempDir("pi-context-skills-prompt-host-");
  let session: AgentSession | undefined;
  try {
    const skillDir = join(tempDir, "skill-pack", "context-management");
    const skillPath = join(skillDir, "SKILL.md");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(skillPath, [
      "---",
      "name: context-management",
      "description: Preserve a focused working set during complex multi-step work.",
      "---",
      "",
      "Read [target selection](references/target-selection.md) before choosing a branch.",
      "",
      "SKILL_BODY_MUST_STAY_ON_DEMAND",
    ].join("\n"));

    // `createAgentSession` opens `<agentDir>/agent.db` and never releases it
    // (see host-temp.ts), so the agent dir MUST stay outside `tempDir` —
    // otherwise strict cleanup fails with EBUSY on Windows.
    const agentDir = createHostAgentDir("pi-context-skills-prompt-agent-");
    const resourceLoader = new DefaultResourceLoader({
      cwd: tempDir,
      agentDir,
      additionalSkillPaths: [join(tempDir, "skill-pack")],
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    });
    await resourceLoader.reload();

    const loadedSkills = resourceLoader.getSkills().skills;
    expect(loadedSkills).toHaveLength(1);
    expect(loadedSkills[0]?.filePath).toBe(resolve(skillPath));

    const created = await createAgentSession({
      cwd: tempDir,
      agentDir,
      authStorage: createInMemoryAuthStorage(),
      resourceLoader,
      sessionManager: SessionManager.inMemory(join(tempDir, "session.jsonl")),
      tools: ["read"],
    });
    session = created.session;

    const prompt = session.systemPrompt.join("\n");
    expect(prompt).toContain("<skills>");
    expect(prompt).toContain("context-management: Preserve a focused working set during complex multi-step work.");
    expect(prompt).toContain("skill://<name>");
    expect(prompt).toContain("Skills are specialized knowledge. If one matches your task, you MUST read `skill://<name>` before proceeding.");
    expect(prompt).not.toContain("SKILL_BODY_MUST_STAY_ON_DEMAND");
  } finally {
    await session?.dispose();
  }
});
