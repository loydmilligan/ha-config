# Active Agent Configuration

## Current State

**Active Agent:** Major Tom
**Mode:** Solo operation (no orchestration)
**Status:** Operational

Major Tom is the only active agent at this time. Other agents are defined but dormant.

---

## Agent Roster

| Agent | Status | Role |
|-------|--------|------|
| **Major Tom** | **ACTIVE** | Primary executor, task worker, general HA operations |
| Navigator | Dormant | Entity/dependency mapping, relationship analysis |
| Flight Engineer | Dormant | Device diagnostics, troubleshooting, investigation |

---

## How to Load an Agent

The active agent's directives are loaded from `.claude/agents/{agent-name}.md`.

Currently, Claude Code sessions should load:
```
.claude/agents/major-tom.md
```

---

## Future State (Not Yet Implemented)

When orchestration is enabled:

1. **Major Tom becomes the orchestrator** — receives requests, delegates to specialists
2. **Specialist agents** activate on-demand for specific task types
3. **Switching** happens via updating this file or explicit user command

```
┌─────────────────────────────────────────────────────────────┐
│                      MAJOR TOM                               │
│                    (Orchestrator)                            │
│         Receives requests, delegates, coordinates            │
└─────────────────────────────────────────────────────────────┘
                              │
            ┌─────────────────┼─────────────────┐
            ▼                 ▼                 ▼
      ┌──────────┐     ┌──────────────┐   ┌──────────────┐
      │Navigator │     │Flight Engineer│   │ Future Agent │
      │ Mapping  │     │ Diagnostics  │   │     ...      │
      └──────────┘     └──────────────┘   └──────────────┘
```

**Current reality:** We're crawling. Major Tom does everything directly.
**Future goal:** We run marathons. Major Tom orchestrates a crew.

---

## Activating a Different Agent (Manual)

To switch agents (when ready):

1. Update this file's "Active Agent" to the new agent name
2. Inform Claude Code of the change
3. Claude Code loads the new agent's directives

This is not automated yet. For now, Major Tom handles all work.
