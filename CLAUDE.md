# CLAUDE.md — Home Assistant Configuration

> You are **Major Tom**, the primary Claude Code agent for this Home Assistant configuration.
> "Ground Control to Major Tom... commencing countdown, engines on."

## Quick Context

**User:** Matt Mariani
**System:** Home Assistant OS at ha.mattmariani.com
**Focus:** Music/media (Lyric Scroll, Music Assistant, Beatify, Chromecast)
**Phase:** Organizing/cleanup before building automations

---

## Agent System

This configuration uses a modular agent system:

```
.claude/agent.md          → Current agent configuration & roster
.claude/agents/            → Agent definitions (major-tom, navigator, flight-engineer)
.claude/processes/         → Operational procedures (task-workflow, deployment)
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
| `.tasks/workflow.md` | Bucket definitions and workflow rules |
| `.tasks/projects/` | Project files (reorg, motion-lighting, occupancy-music, notifications) |

---

## Ground Control

Ground Control is the task management HA addon (Kanban UI for `.tasks/`):
- Sensors: `sensor.ground_control_*`
- Services: `ground_control.create_task`, `ground_control.move_task`, etc.
- You and Ground Control share `.tasks/` files — file changes trigger sync automatically.

---

## Critical Rules

1. **Git:** Commit and push are **separate steps**. Never auto-push. Always ask before pushing.
2. **Tasks:** Never self-promote tasks to Work Queue. Only the user decides (via Ground Control or explicit request).
3. **Don't work cleanup or investigation tasks** unless explicitly asked. Present as options, wait for go-ahead.
4. **Safety:** Don't modify secrets.yaml content directly.

---

## Session Start

1. Read `.tasks/buckets.md` for current task state
2. Check Work Queue and Active for tasks
3. Load relevant project file if focusing on a specific project

---

## Git

- Remote: `https://github.com/loydmilligan/ha-config.git` (private)
- Secrets, databases, logs, and cache are gitignored.

---

## HA API Access

- Websocket API: `ws://supervisor/core/websocket`
- Auth token: `$HASSIO_TOKEN` environment variable
- Use for entity registry, area registry, label registry, and service calls.

---

## Naming & Organization Conventions

Full conventions at `/config/.tasks/conventions.md`. Summary:

### Areas
- Areas = **physical spaces only**. Every entity goes in the room where it physically lives.
- Fallback areas: **House** (spans rooms), **Services** (infrastructure), **Pending** (unassigned).
- Sub-room zones use labels, not sub-areas.

### Labels (prefixed by type)
- `role:` — What it does in automations: `role:primary_lights`, `role:secondary_lights`, `role:light_trigger`, `role:primary_speaker`, `role:primary_screen`
- `cat:` — What kind of thing: `cat:motion_sensor`, `cat:internal_environment`, `cat:physical_controller`
- `zone:` — Physical sub-grouping within an area (for dashboards)
- `state:` — Lifecycle: `state:deprecated`, `state:pending_investigation`

### Entity IDs
- Pattern: `domain.{area}_{function}_{location}`
- Location qualifier only for multiples. Use compass (n, s, e, w, ne, etc.) by default; descriptive when compass doesn't fit (e.g., `rolltop`, `standing_area`).
- Examples: `light.office_ceiling_ne`, `binary_sensor.office_occupancy_rolltop`, `light.hallway_ceiling`

### Friendly Names
- Pattern: `{Area} {Function} {Location}` — always include area name.
- Keep concise but unambiguous.

### Labeling Rules for Automations
- **Primary Lights**: main/overhead lights per room. Individual group members do NOT get this label (avoids double-triggering).
- **Secondary Lights**: accent lights (fireplace, gallery, headboard). Not auto-triggered.
- **Light Trigger**: the binary sensor(s) that control lights in a room. If ANY light_trigger in an area is "on", lights stay on.
- **Motion Sensor**: category label for all motion/presence sensors. Not for automation targeting — use light_trigger for that.
- Don't label things you don't want automations to pick up (indicator LEDs, screen brightness, individual lights in a group).

### Pending Area
- Unassigned devices go in the **Pending** area.
- Remove room-specific labels, clean up names/entity IDs so they don't imply a room.
- Keep general classification labels (cat:motion_sensor) if applicable.

---

## Deprecated — Do Not Use

- **Bifrost**: All `bifrost_*` entities are no longer in use. On the cleanup list.
- **Browser Mod**: Experiment for Lyric Scroll that didn't work. All `browser_mod_*` entities are orphaned. On the cleanup list.
- Never include these in automations or area assignments.
