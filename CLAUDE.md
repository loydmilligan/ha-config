# CLAUDE.md — Home Assistant Configuration

## User

Matt Mariani. Runs Home Assistant OS at ha.mattmariani.com.
Music/media focus — Lyric Scroll, Music Assistant, Beatify, Chromecast integrations.
Currently in an organizing/cleanup phase before building out automations.

## Git Rules

- **Never auto-push.** Commit and push are always separate steps. After committing, ask "Want me to push?" before pushing to remote.
- Remote: `https://github.com/loydmilligan/ha-config.git` (private)
- Secrets, databases, logs, and cache are gitignored.

## Task Workflow

All task and project management lives in `/config/.tasks/`:

- **`workflow.md`** — Bucket definitions, workflow rules, session processing, git workflow
- **`buckets.md`** — Current state of all tasks by bucket
- **`projects/`** — One file per project (reorg, motion-lighting, occupancy-music, notifications)

**At session start:** Read `buckets.md` and relevant project files to load context.
**At session end:** Update files to reflect completed or new tasks.

### Key Rules

- **Only the user moves tasks to Work Queue or Active.** Never self-promote tasks.
- **Don't work cleanup or investigation tasks unless explicitly asked.** Present them as options, wait for go-ahead.
- Buckets: Brainstorm → Planning → Work Queue → Active → Completed (also: Cleanup, Investigation)
- All `.tasks/` markdown files have YAML frontmatter with version, dates, and metadata.

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

## Deprecated — Do Not Use

- **Bifrost**: All `bifrost_*` entities are no longer in use. On the cleanup list.
- **Browser Mod**: Experiment for Lyric Scroll that didn't work. All `browser_mod_*` entities are orphaned. On the cleanup list.
- Never include these in automations or area assignments.

## HA API Access

- Websocket API available at `ws://supervisor/core/websocket`
- Auth token: `$HASSIO_TOKEN` environment variable
- Use for entity registry, area registry, label registry, and service calls.

## Reference Files

- `/config/.tasks/conventions.md` — Full naming/labeling conventions
- `/config/.tasks/workflow.md` — Task workflow process and rules
- `/config/.tasks/buckets.md` — Current task state
- `/config/addon-spec.md` — Spec for task management HA addon (in development)
