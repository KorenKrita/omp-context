# ACM Agent Guidance Delivery

Status: ready-for-agent

## Problem Statement

The effective user of ACM is the coding agent, but the standalone plugin currently exposes the operating discipline only as a model-invoked Skill while the integrated plugin embeds a separate copy into the system prompt. The two delivery paths can drift, and an agent must sometimes recognize that it needs context-management guidance before it has loaded the guidance that teaches that recognition.

The existing guidance has strong domain concepts—working set, boundary, handoff, archive, chain, burst, and anchor gravity—but its normal path, advanced branches, examples, tool descriptions, standalone Skill, and integrated system prompt are not produced from one source of truth. Loading the current monolithic playbook also discloses unrelated branches together.

## Solution

Make the ACM Skill package the single source of truth while separating delivery by information hierarchy:

- An always-on CORE defines the normal process, lightweight state transitions, hard semantic invariants, fixed seven-slot handoff contract, pressure-triggered boundary check, and three representative examples.
- The ACM extension itself appends CORE through OMP's public `before_agent_start` hook in both repositories.
- A single model-invoked `context-management` Skill routes only advanced branches.
- Advanced reference is split by cognitive task: target selection, archive recovery, and exceptional recovery.
- Tool descriptions are short derivatives of the same canonical guidance rather than independent prose.
- The integrated plugin adds Magic Context material around the same ACM CORE instead of maintaining a second full ACM prompt.
- Successful tool results use progressive disclosure: current facts and one next cue; exceptional results disclose the relevant recovery path.

The resulting process is predictable without requiring every advanced scenario to remain in the system prompt.

## User Stories

1. As an agent starting multi-step work, I want the normal ACM contract already present, so that I checkpoint before any optional Skill discovery.
2. As an agent entering a new phase, I want a clear transition rule, so that I preserve recoverability before the phase's first action.
3. As an agent about to run an unbounded burst, I want the CORE to identify the burst boundary, so that I create an anchor before the output arrives.
4. As an agent under high context pressure, I want pressure to trigger a boundary check rather than authorize arbitrary travel, so that live working-set detail remains available.
5. As an agent deciding whether to travel, I want the fold gate expressed through boundary, NEXT, and raw recoverability, so that I use the same process each run.
6. As an agent choosing a target, I want anchor gravity named explicitly, so that proximity does not replace boundary reasoning.
7. As an agent writing a handoff, I want the seven canonical slots, so that every state dimension is accounted for.
8. As an agent with no external side effects or exclusions, I want to write `none`, so that absence is distinguishable from omission.
9. As an agent completing a burst, I want a representative burst example, so that I understand how to preserve an extract without retaining the raw trail.
10. As an agent abandoning a failed direction, I want a representative failed-direction example, so that rejected work moves into Exclusions while surviving facts remain in State and Evidence.
11. As an agent finishing a task chain, I want a representative task-chain example, so that final-answer state, external effects, archive recovery, and NEXT are preserved together.
12. As an agent on the normal path, I want to avoid loading advanced references, so that the information hierarchy stays legible.
13. As an agent with a non-obvious target, I want the Skill description to invoke the target-selection branch, so that I load only the relevant advanced guidance.
14. As an agent managing interleaved fronts, I want target selection guidance grouped with its caveats, so that I do not choose an anchor belonging to another front.
15. As an agent missing a checkpoint, I want the target-selection reference to explain raw node fallback, so that missing labels do not block a fold.
16. As an agent recovering an archived detail, I want a dedicated round-trip procedure, so that I return to the summary branch instead of drifting into the archive.
17. As an agent handling a travel failure, I want exceptional recovery guidance disclosed only then, so that normal tool results remain short.
18. As an agent seeing a checkpoint-name collision, I want the exceptional branch to prescribe a semantic disambiguation, so that I do not invent generic names.
19. As an agent using the standalone plugin, I want the same ACM CORE as the integrated plugin, so that repository choice does not change the operating process.
20. As an agent using the integrated plugin, I want Magic Context to compose with ACM rather than duplicate it, so that both context systems remain distinct and compatible.
21. As an agent receiving a successful checkpoint result, I want only the created anchor, usage evidence, and one next cue, so that the result does not restate the entire Skill.
22. As an agent receiving a successful travel result, I want factual branch and context evidence, so that I can verify the transition without being given a hidden semantic verdict.
23. As an agent receiving an exceptional result, I want the recovery instructions adjacent to the failure, so that the relevant branch is available at the moment of need.
24. As a maintainer editing the ACM process, I want one canonical text source, so that a behavior change is a one-place edit.
25. As a maintainer, I want CORE sections marked for generation, so that the system prompt and tool descriptions can be derived mechanically.
26. As a maintainer, I want the Skill body to route advanced branches rather than repeat CORE, so that reading the Skill does not reload the normal contract.
27. As a maintainer, I want reference files organized by cognitive task rather than scenario taxonomy, so that one pointer discloses one coherent branch.
28. As a maintainer, I want the three representative examples to remain always-on, so that they provide transferable usage patterns across unfamiliar scenarios.
29. As a maintainer, I want prose pruned for duplication, sediment, no-ops, and avoidable negation, so that each line continues to change agent behavior.
30. As a maintainer, I want README guidance to link to the canonical contract rather than restate it, so that human documentation cannot become a second behavioral authority.
31. As a maintainer, I want the standalone and integrated prompt composition tested with pre-existing system segments, so that ACM injection never drops another extension's prompt.
32. As a maintainer, I want duplicate markers detected, so that CORE is injected exactly once even when multiple composition paths are present.
33. As a maintainer, I want real usage observations to drive future prompt changes, so that unobserved weak-model failure scenarios do not accumulate speculative rules.
34. As a maintainer, I want static contract tests to prove source parity, so that agent-understanding changes are reviewable without a nondeterministic model-evaluation environment.

## Implementation Decisions

- The ACM Skill package is the authoritative source for all agent guidance.
- The package contains one always-on CORE, one model-invoked advanced Skill, and three advanced references organized by cognitive task.
- The advanced Skill is invoked only for non-obvious target selection, interleaved fronts, missing anchors, archive round trips, or exceptional recovery.
- The normal path is expressed as a lightweight state-transition table. It is an agent decision model, not persisted runtime state.
- CORE retains the leading words working set, boundary, handoff, archive, chain, burst, and anchor gravity.
- CORE includes three representative examples: burst, failed direction, and finished task chain.
- The handoff contract remains fixed at Goal, State, Evidence, External, Exclusions, Recover, and NEXT. Every slot appears; empty categories use `none`.
- Slot presence is an agent completion criterion. Runtime validation may check structure and non-empty values but must not claim to prove semantic completeness or that NEXT is executable.
- High context pressure triggers a boundary search. It does not independently authorize travel.
- The ACM extension registers one public `before_agent_start` handler that appends CORE to the existing system prompt.
- Prompt injection preserves every pre-existing system segment in order and appends a stable, versioned ACM marker exactly once.
- The integrated plugin reuses the same ACM injection path. Its Magic Context composition adds only its own foreword, Magic Context section, and closing material.
- Generated prompt content and tool-description fragments derive from marked canonical sections. Generated artifacts must not become editable sources of truth.
- Normal tool success output contains observed facts and one next cue. Exceptional output includes the recovery branch relevant to that failure.
- Human-facing README content covers installation, architecture, support policy, known limits, and maintenance. It does not duplicate the agent operating contract.
- Guidance changes are evaluated through static contracts and observed real-session failures, not a new stochastic model benchmark.

## Testing Decisions

- The highest test seam is OMP's public `before_agent_start` extension boundary.
- Prompt-composition tests use a captured extension handler and assert that arbitrary existing system-prompt segments remain byte-for-byte present and in order.
- Prompt-composition tests assert that the ACM marker and CORE appear exactly once when the handler is called with no prior marker, an existing marker, and a prompt already composed by another extension.
- Prompt-composition tests assert that the standalone and integrated plugins inject the same canonical ACM CORE.
- Generation tests assert that every generated prompt/tool fragment matches its marked canonical source and that regeneration is idempotent.
- Skill contract tests assert that the advanced Skill does not repeat the normal CORE and that every context pointer names a checkable branch condition.
- Reference contract tests assert that target selection, archive recovery, and exceptional recovery each remain independently loadable and do not duplicate the normal contract.
- Handoff tests assert the presence and ordering of all seven canonical slots in CORE and representative examples.
- Tool-description tests assert concise normal-path descriptions and progressive exceptional guidance without duplicating the full Skill.
- Tests should exercise observable composed output and registered handler behavior rather than source-code substrings when a higher seam is available.
- Real-session validation remains dogfooding: record concrete failures such as missed checkpointing, wrong boundary selection, archive drift, or unnecessary Skill loading before changing guidance.

## Out of Scope

- Splitting context management into multiple model-invoked Skills.
- Injecting the complete advanced playbook into every system prompt.
- Building a stochastic multi-model guidance benchmark.
- Runtime enforcement of semantic boundary correctness.
- Runtime proof that NEXT is genuinely executable.
- Repeating the full agent operating contract in README.
- Changing Magic Context's own behavior beyond prompt composition.
- Requesting new OMP upstream APIs.

## Further Notes

- This specification preserves the Predictability intent of the existing Skill rather than replacing it with a smaller but weaker prompt.
- The seven-slot contract is retained because it drives exhaustive legwork; percentage thresholds are rejected because they substitute false precision for semantic judgment.
- The source package may use separate Markdown files internally, but they remain one model-invoked Skill package and one guidance authority.
- The implementation must create or update the repository's implementation notes with these user-decided choices before code changes begin.
