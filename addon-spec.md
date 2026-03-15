# HA Task Management Addon — Specification

## Overview

A Home Assistant custom integration that surfaces a file-based task management system (`.tasks/`) as HA entities and a dashboard panel. The goal is to manage projects, tasks, and workflow buckets from within the HA UI rather than only through file editing or Claude Code sessions.

This system **already exists and is actively in use** — Claude Code reads and writes the `.tasks/` files during work sessions. The addon's job is to provide a UI and entities on top of the existing file structure, and to keep both in sync.

---

## What Already Exists (Current State as of 2026-03-15)

### File Structure — ALREADY CREATED AND IN USE

```
/config/.tasks/
├── workflow.md              # Process rules, bucket definitions, workflow rules
├── conventions.md           # Entity naming/labeling conventions (reference doc)
├── buckets.md               # *** THE MAIN FILE *** — all tasks organized by bucket
├── addon-spec.md            # This spec file
└── projects/
    ├── reorg.md             # Project: HA Reorganization (IN PROGRESS)
    ├── motion-lighting.md   # Project: Motion-Activated Lighting (NOT STARTED)
    ├── occupancy-music.md   # Project: Occupancy-Based Music (NOT STARTED)
    └── notifications.md     # Project: Notification System (NOT STARTED)
```

### Current File Formats — ALREADY IN USE

**`buckets.md`** is the central task registry. Current actual content structure:

```markdown
# Task Buckets

## Active
*(Currently being worked on)*

— empty —

## Work Queue
*(Ready and desired to be worked next)*

— empty —

## Completed
*(Historical record)*

- **2026-03-15**: Moved Amcrest credentials from configuration.yaml to secrets.yaml (project: reorg)
- **2026-03-15**: Renamed "new_script" to "cast_lyrics_dashboard" (project: reorg)
[...17 completed items total...]

## Cleanup
- Disable all Bifrost entities (project: reorg)
- Evaluate Browser Mod addon removal (project: reorg)

## Investigation
- Identify rooms for square PIR sensors 2-5 (project: reorg)
- Determine actual location of luggage_room_light (project: reorg)
- Add laundry room east ceiling fixture Matter bulbs to HA (project: reorg)
- Identify which button/switch to use for laundry room lights (project: reorg)

## Planning
- Audit remaining unassigned entities for area assignment (project: reorg)
- Review Kitchen — needs a motion sensor? (project: reorg)
- Assign contact sensors, smart plugs, media players to rooms (project: reorg)
- Setup laundry room light button automation — blocked by button identification (project: reorg)
- Design motion-lighting automation template (project: motion-lighting)
- Define per-room lighting behavior (project: motion-lighting)
- Assign speakers to areas with labels (project: occupancy-music)
- Audit current notification methods (project: notifications)

## Brainstorm
- Motion lighting edge cases: movie mode, sleep mode, manual override (project: motion-lighting)
- Multi-room music scenarios (project: occupancy-music)
- "Left the room briefly" grace period for music (project: occupancy-music)
- Notification test scenarios: laundry done, door open, etc. (project: notifications)
- Build HA addon for task management dashboard — spec at /config/addon-spec.md (meta)
```

**Project files** (`projects/*.md`) have this format:

```markdown
# Project: HA Reorganization

**Status:** In Progress
**Goal:** Every entity has a correct area, meaningful name, consistent naming convention...

---

## Completed
- [x] Move credentials out of configuration.yaml into secrets.yaml
- [x] Rename "new_script" to "cast_lyrics_dashboard"
[...]

## Backlog
- [ ] Audit remaining 700+ unassigned entities (bucket: Planning)
- [ ] Identify square PIR sensors 2-5 physically (bucket: Investigation)
[...]
```

### Buckets — ALREADY DEFINED

There are exactly 7 buckets. They are a fixed set, not user-configurable:

| Bucket | Purpose | Color Suggestion |
|---|---|---|
| `brainstorm` | Raw ideas, "what ifs", not committed to | Purple |
| `planning` | Needs design/research before actionable | Blue |
| `cleanup` | Tech debt, deprecated items, things to tidy | Gray |
| `investigation` | Needs research or physical verification to proceed | Orange |
| `work_queue` | Ready and desired to be worked — the "up next" list | Green |
| `active` | Currently being worked on in this session | Yellow |
| `completed` | Done — kept with date and detail for historical reference | Dark Green |

### Workflow Rules — ALREADY DEFINED AND ENFORCED

1. **No work without explicit decision.** Tasks in Cleanup, Investigation, Planning, and Brainstorm are NOT worked on unless explicitly moved to Work Queue.
2. **Work Queue is the contract.** If it's in Work Queue, it's fair game to start. If it's not, ask first.
3. **One bucket at a time.** A task doesn't straddle buckets. Move it cleanly.
4. **Projects organize, buckets prioritize.** A task belongs to a project (what it's for) AND a bucket (where it is in the workflow).
5. **Claude does not self-promote tasks.** Only the user decides when something moves to Work Queue or Active.
6. Tasks can move forward: brainstorm → planning → work_queue → active → completed
7. Exception: cleanup and investigation can move to work_queue or back to planning
8. Active tasks can return to work_queue (paused)
9. Tasks with unresolved `blocked_by` cannot move to work_queue or active

### Projects — ALREADY CREATED

| Slug | Name | Status | File |
|---|---|---|---|
| `reorg` | HA Reorganization | In Progress | `projects/reorg.md` |
| `motion-lighting` | Motion-Activated Lighting | Not Started | `projects/motion-lighting.md` |
| `occupancy-music` | Occupancy-Based Music | Not Started | `projects/occupancy-music.md` |
| `notifications` | Notification System | Not Started | `projects/notifications.md` |

### Work Already Completed (17 items, all on 2026-03-15)

1. Moved Amcrest credentials from configuration.yaml to secrets.yaml
2. Renamed "new_script" to "cast_lyrics_dashboard", removed duplicate cast call
3. Initialized git repo with .gitignore for /config
4. Created HA areas: Closet, Pending
5. Created HA labels: Motion Sensor, Light Trigger
6. Assigned all lights to areas with Primary/Secondary Lights labels
7. Assigned all known motion/presence sensors to areas with labels
8. Placed FP2 cross-room sensors in correct areas (office↔family room)
9. Placed unassigned devices in Pending area (sonoff mmwave, luggage room light)
10. Set up task workflow system — workflow.md, buckets, projects
11. Brainstormed naming conventions — decided: areas=physical, labels=prefixed, entity_ids=area_function_location
12. Formalized conventions into /config/.tasks/conventions.md
13. Renamed all 8 labels to prefixed convention (role:, cat:)
14. Renamed ~40 light entities to area_function_location pattern with compass qualifiers
15. Renamed all motion/presence/illuminance sensors to area_function pattern
16. Removed light_trigger from FP2 "all zones" sensors (cross-room)
17. Updated all automations.yaml references for renamed entities and reloaded HA

---

## Data Model

### Task
A task is a single work item. Properties:

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | Yes | Auto-generated unique ID (e.g., `T-001`) |
| `subject` | string | Yes | Brief title (imperative form, e.g., "Disable all Bifrost entities") |
| `description` | string | No | Detailed description, context, acceptance criteria |
| `bucket` | enum | Yes | One of the 7 buckets listed above |
| `project` | string | No | Project slug (e.g., `reorg`, `motion-lighting`) or `none`/empty |
| `created_date` | date | Yes | When the task was created |
| `completed_date` | date | No | When moved to completed (null if not completed) |
| `blocked_by` | list[string] | No | Task IDs that block this task |
| `tags` | list[string] | No | Freeform tags for filtering |

### Project
A project groups related tasks toward a goal. Properties:

| Field | Type | Required | Description |
|---|---|---|---|
| `slug` | string | Yes | URL-safe identifier (e.g., `reorg`) |
| `name` | string | Yes | Human-readable name (e.g., "HA Reorganization") |
| `status` | enum | Yes | `not_started`, `in_progress`, `complete` |
| `goal` | string | Yes | What "done" looks like |
| `description` | string | No | Additional context and details |

---

## What the Addon Needs to Do

### 1. Parse Existing Files

The addon must be able to read the current markdown format of `buckets.md` and `projects/*.md`. All files include **YAML frontmatter** (delimited by `---`) followed by markdown content.

#### YAML Frontmatter Schema

Every `.tasks/` markdown file has YAML frontmatter with these common fields:

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | string | Yes | Document title |
| `type` | enum | Yes | One of: `workflow`, `reference`, `buckets`, `project` |
| `version` | string | Yes | Semantic version (MAJOR.MINOR.PATCH) — increment MINOR for content changes, MAJOR for structural changes |
| `created` | date | Yes | Date the file was first created (YYYY-MM-DD) |
| `updated` | date | Yes | Date of last modification (YYYY-MM-DD) |
| `description` | string | Yes | One-line summary of the document's purpose |

**Additional fields by type:**

**`type: buckets`** (buckets.md):
| Field | Type | Description |
|---|---|---|
| `task_count` | object | Keys are bucket names, values are integer counts. Kept in sync with content. |

**`type: project`** (projects/*.md):
| Field | Type | Description |
|---|---|---|
| `slug` | string | URL-safe project identifier (e.g., `reorg`) |
| `status` | enum | `not_started`, `in_progress`, `complete` |
| `goal` | string | What "done" looks like |
| `task_count` | object | Keys: `completed`, `backlog` — integer counts |

#### Example Frontmatter — buckets.md

```yaml
---
title: Task Buckets
type: buckets
version: 1.2.0
created: 2026-03-15
updated: 2026-03-15
description: Current state of all tasks organized by workflow bucket
task_count:
  active: 0
  work_queue: 0
  completed: 17
  cleanup: 2
  investigation: 4
  planning: 9
  brainstorm: 5
---
```

#### Example Frontmatter — project file

```yaml
---
title: "Project: HA Reorganization"
type: project
slug: reorg
version: 1.2.0
created: 2026-03-15
updated: 2026-03-15
status: in_progress
goal: Every entity has a correct area, meaningful name, consistent naming convention...
task_count:
  completed: 17
  backlog: 12
---
```

#### Versioning Rules

- **PATCH** (0.0.x): Typo fixes, wording clarifications, no functional change
- **MINOR** (0.x.0): Task added/removed/moved, counts updated, content changes
- **MAJOR** (x.0.0): Structural changes to the file format, new sections, schema changes
- The addon should update `version` and `updated` when writing changes
- The addon can use `version` to detect external changes (compare cached version vs file version)

#### Markdown Content Parsing Rules

After the frontmatter:
- `buckets.md` sections are `## Bucket Name` headers
- Tasks are `- ` prefixed lines under each section
- Completed tasks have `**YYYY-MM-DD**: ` prefix before the description
- Project association is `(project: slug)` suffix on task lines
- `— empty —` indicates an empty bucket
- Project files have `## Completed` and `## Backlog` sections
- Completed items use `- [x]` prefix, backlog items use `- [ ]` prefix
- Backlog items have `(bucket: BucketName)` suffix

### 2. Write Back to Files

When tasks are created, moved, or updated via the addon UI or services, write changes back to the markdown files so Claude Code sessions can read the current state.

### 3. Create HA Entities

#### Sensors

| Entity | Type | Description |
|---|---|---|
| `sensor.tasks_active_count` | Number | Count of tasks in Active bucket |
| `sensor.tasks_work_queue_count` | Number | Count of tasks in Work Queue |
| `sensor.tasks_total_open` | Number | All non-completed tasks |
| `sensor.tasks_completed_count` | Number | Total completed tasks |
| `sensor.tasks_blocked_count` | Number | Tasks with unresolved blockers |
| `sensor.project_{slug}_status` | String | Status of each project (not_started/in_progress/complete) |
| `sensor.project_{slug}_open_tasks` | Number | Open task count per project |
| `sensor.project_{slug}_progress` | Number | Percentage complete (completed / total for that project) |

#### Binary Sensors

| Entity | Type | Description |
|---|---|---|
| `binary_sensor.tasks_has_active` | Boolean | True if any task is in Active |
| `binary_sensor.tasks_has_blocked` | Boolean | True if any task is blocked |

#### Services

| Service | Parameters | Description |
|---|---|---|
| `task_manager.create_task` | subject, description, bucket, project | Create a new task |
| `task_manager.update_task` | task_id, bucket, subject, description | Update a task |
| `task_manager.move_task` | task_id, target_bucket | Move task between buckets (enforce workflow rules) |
| `task_manager.complete_task` | task_id | Move task to completed with timestamp |
| `task_manager.delete_task` | task_id | Remove a task |
| `task_manager.create_project` | name, goal, description | Create a new project |
| `task_manager.update_project` | slug, status, goal | Update project status/details |

### 4. Provide a Dashboard Panel

Register a sidebar panel with:

**Kanban Board View**
- Columns for each bucket (brainstorm through active — completed is separate)
- Cards show: subject, project tag (color-coded), blocked indicator
- Drag-and-drop between columns (enforce workflow rules — reject invalid moves)
- Filter by project

**Project View**
- List of projects with status badge, progress bar, open/completed task counts
- Click into a project to see all its tasks across buckets
- Goal and description displayed

**Completed / History View**
- Chronological list of completed tasks
- Filterable by project and date range
- Shows completion date and original project

**Task Detail**
- Click a card to see full description
- Edit subject, description, bucket, project, blocked_by
- View blocked-by chain

---

## Technical Recommendations

- **Type:** HA custom integration (not a standalone addon) — this allows native entity and service creation
- **File watching:** Use a file watcher (e.g., `watchdog`) on `/config/.tasks/` to detect external changes from Claude Code sessions. Re-parse and update entities when files change.
- **Sync direction:** Bidirectional — addon writes to files when UI changes happen, reads from files when external changes are detected
- **No separate database:** The markdown files ARE the database. No SQLite, no JSON sidecar needed for v1.
- **Panel:** Custom frontend panel (JS/Lit) registered via the integration
- **Structured data migration (future):** If the markdown format becomes limiting, consider adding a `.tasks/data.json` sidecar that the addon manages as the source of truth, with markdown files rendered from it for human/Claude readability. But start with markdown-only for simplicity and compatibility.
