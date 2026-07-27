import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createAgentSession, DefaultResourceLoader } from "@oh-my-pi/pi-coding-agent/extensibility/legacy-pi-coding-agent-shim";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";

test("exact OMP Skills system prompt lists an absolute SKILL.md and keeps Skill bodies on demand", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "pi-context-skills-prompt-host-"));
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
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

    const agentDir = join(tempDir, "agent");
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
    session?.dispose();
    rmSync(tempDir, { recursive: true, force: true });
  }
});
