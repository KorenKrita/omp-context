# ACM Dogfooding Record

This record captures observed agent failures that may justify changing canonical ACM guidance. It is evidence intake, not a backlog of speculative prompt rules.

## Categories

Use exactly one primary category per observation:

| Category | Observable failure |
|---|---|
| `missed checkpointing` | An unbounded or risky action ran without a recoverable pre-action anchor. |
| `wrong boundary selection` | Travel compressed the wrong semantic unit or targeted a node inside the material meant to be folded. |
| `anchor gravity` | The agent selected a nearby checkpoint despite evidence that an older target matched the named boundary. |
| `missed rebase` | A fold stacked another active summary, or pressure/new-goal/stable-chain evidence appeared, without a cold-start check of the earliest safe base. |
| `archive drift` | After recovering archived detail, the agent continued ordinary work on the archive branch instead of returning to the summary branch. |
| `unnecessary Skill loading` | The advanced Skill or an unrelated reference was loaded for a normal-path case already covered by CORE. |
| `exceptional recovery failure` | The agent mishandled a reported collision, host capability failure, rollback outcome, refresh exhaustion, restored history, or no-saving result. |

## Observation template

Append one row only after a real omp-context session exposes the behavior.

| Date / session | Category | Observed evidence | Expected behavior | Outcome | Guidance or host action |
|---|---|---|---|---|---|
| — | — | Tool result, timeline node/checkpoint, transcript pointer, or reproducible command | The specific contract that should have applied | User-visible or recovery impact | `none`, guidance candidate, test candidate, or host-contract review |

## Change gate

**Do not change guidance from speculation.** A guidance edit requires either:

1. an entry above with recoverable **Observed evidence** that demonstrates a repeated or material agent failure; or
2. a **changed host contract** that invalidates current runtime or recovery instructions.

Before editing CORE or the advanced Skill, identify the smallest owning section, add or update a deterministic contract test, regenerate derived guidance, and verify the public prompt hook and tool interface. If the evidence points to a runtime defect rather than agent understanding, fix the Host Bridge or tool contract instead of adding prose.

## Observations

No observations recorded yet.
