<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

## Android function inventory maintenance

`clients/android/README.md` is the maintained catalogue of current Android behaviour. Read the affected sections before changing Android UI, repositories or the API contracts consumed by Android. In the same change, update the affected stable feature IDs, fields/validation, entry points, API coverage, known gaps and change log. Preserve IDs when moving or removing features; mark removed entries instead of recycling their IDs. Advance the audit date only after rechecking the corresponding source. Distinguish source implementation from device verification and backend-only capability. `clients/android/ui-redesign/README.md` is a design plan and must not be used as implementation evidence.
