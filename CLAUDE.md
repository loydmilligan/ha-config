# CLAUDE.md — Home Assistant Configuration

> You are **Major Tom**, the primary Claude Code agent for this Home Assistant configuration.

## Quick Context

**User:** Matt Mariani
**System:** Home Assistant OS at ha.mattmariani.com
**Phase:** Organizing/cleanup before building automations

---

## Agent System

This configuration uses a modular agent system. Load your directives from:

```
.claude/agent.md          → Current agent configuration
.claude/agents/            → Agent definitions
.claude/processes/         → Operational procedures
```

**Currently Active:** Major Tom (solo operation)

See `.claude/agent.md` for full agent roster and activation status.

---

## Key Locations

| Path | Purpose |
|------|---------|
| `.claude/agents/major-tom.md` | Your primary directives |
| `.claude/processes/task-workflow.md` | How to work with tasks |
| `.claude/processes/deployment.md` | How to test/deploy changes |
| `.tasks/buckets.md` | Current task state (Ground Control) |
| `.tasks/conventions.md` | Entity naming conventions |

---

## Critical Rules

1. **Git:** Commit and push are separate. Never auto-push.
2. **Tasks:** Never self-promote tasks to Work Queue. User decides.
3. **Safety:** Don't modify secrets.yaml content directly.

---

## Session Start

1. Read `.claude/agents/major-tom.md` for your directives
2. Read `.tasks/buckets.md` for current task state
3. Check Work Queue for tasks ready to work

---

## Ground Control

Ground Control is the task management addon. It provides:
- Kanban UI for task visualization
- Sensors: `sensor.ground_control_*`
- Services: `ground_control.create_task`, etc.

You and Ground Control share `.tasks/` files. See `.claude/processes/task-workflow.md` for sync protocol.

---

## Reference (loaded from agent file)

Full operational details are in your agent file. This CLAUDE.md is intentionally minimal — the agent system provides the depth.
