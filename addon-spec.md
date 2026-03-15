# HA Task Management Addon — Specification

## Overview

A Home Assistant addon that surfaces the file-based task management system (`.tasks/`) as HA entities and a dashboard panel. The goal is to manage projects, tasks, and workflow buckets from within the HA UI rather than only through file editing or Claude Code sessions.

---

## Source of Truth

All task data lives in `/config/.tasks/` as markdown files:

```
/config/.tasks/
├── workflow.md          # Process rules and bucket definitions
├── conventions.md       # Naming/organization conventions (reference, not task data)
├── buckets.md           # Current state of all tasks by bucket
└── projects/
    ├── reorg.md         # Project: HA Reorganization
    ├── motion-lighting.md
    ├── occupancy-music.md
    └── notifications.md
```

The addon should read/write these files as its data store (no separate database). This keeps Claude Code and the addon in sync.

---

## Data Model

### Task
A task is a single work item. Properties:

| Field | Type | Description |
|---|---|---|
| `id` | string | Auto-generated unique ID |
| `subject` | string | Brief title (imperative form) |
| `description` | string | Detailed description, context, acceptance criteria |
| `bucket` | enum | One of: `brainstorm`, `planning`, `cleanup`, `investigation`, `work_queue`, `active`, `completed` |
| `project` | string | Project slug (e.g., `reorg`, `motion-lighting`) or `none` |
| `created_date` | date | When the task was created |
| `completed_date` | date | When moved to completed (null if not) |
| `blocked_by` | list[string] | Task IDs that block this task |
| `tags` | list[string] | Freeform tags for filtering |

### Project
A project groups related tasks toward a goal. Properties:

| Field | Type | Description |
|---|---|---|
| `slug` | string | URL-safe identifier (e.g., `reorg`) |
| `name` | string | Human-readable name |
| `status` | enum | `not_started`, `in_progress`, `complete` |
| `goal` | string | What "done" looks like |
| `description` | string | Context and details |

### Bucket
A bucket represents a workflow stage. Fixed set:

| Bucket | Purpose | Color Suggestion |
|---|---|---|
| `brainstorm` | Raw ideas, not committed | Purple |
| `planning` | Needs design/research before actionable | Blue |
| `cleanup` | Tech debt, deprecations, tidying | Gray |
| `investigation` | Needs research or physical verification | Orange |
| `work_queue` | Ready and desired to be worked | Green |
| `active` | Currently being worked on | Yellow |
| `completed` | Done, kept for history | Dark Green |

---

## Workflow Rules (enforce in addon)

1. Tasks can only move forward in the pipeline: brainstorm → planning → work_queue → active → completed
2. Exception: cleanup and investigation can move to work_queue or back to planning
3. Active tasks returned to work_queue (paused) is allowed
4. Tasks with unresolved `blocked_by` cannot move to work_queue or active
5. A task belongs to exactly one bucket at a time
6. A task can belong to zero or one project
7. Completed tasks retain their project association and completion date for history

---

## Desired HA Entities

### Sensors

| Entity | Type | Description |
|---|---|---|
| `sensor.tasks_active_count` | Number | Count of tasks in Active bucket |
| `sensor.tasks_work_queue_count` | Number | Count of tasks in Work Queue |
| `sensor.tasks_total_open` | Number | All non-completed tasks |
| `sensor.tasks_completed_count` | Number | Total completed tasks |
| `sensor.tasks_blocked_count` | Number | Tasks with unresolved blockers |
| `sensor.project_{slug}_status` | String | Status of each project |
| `sensor.project_{slug}_open_tasks` | Number | Open task count per project |
| `sensor.project_{slug}_progress` | Number | Percentage complete (completed / total) |

### Binary Sensors

| Entity | Type | Description |
|---|---|---|
| `binary_sensor.tasks_has_active` | Boolean | True if any task is in Active |
| `binary_sensor.tasks_has_blocked` | Boolean | True if any task is blocked |

### Services

| Service | Parameters | Description |
|---|---|---|
| `task_manager.create_task` | subject, description, bucket, project | Create a new task |
| `task_manager.update_task` | task_id, bucket, subject, description | Update a task |
| `task_manager.move_task` | task_id, target_bucket | Move task between buckets |
| `task_manager.complete_task` | task_id | Move task to completed with timestamp |
| `task_manager.delete_task` | task_id | Remove a task |
| `task_manager.create_project` | name, goal, description | Create a new project |
| `task_manager.update_project` | slug, status, goal | Update project |

---

## Dashboard Panel

The addon should register a panel (sidebar item) with:

### Kanban Board View
- Columns for each bucket (brainstorm → active)
- Cards show: subject, project tag, blocked indicator
- Drag-and-drop between columns (respecting workflow rules)
- Color-coded by project
- Filter by project

### Project View
- List of projects with status, progress bar, task counts
- Click into a project to see all its tasks across buckets
- Goal and description displayed

### Completed / History View
- Chronological list of completed tasks
- Filterable by project and date range
- Shows completion date and original project

### Task Detail
- Click a card to see full description
- Edit subject, description, bucket, project, blocked_by
- View blocked-by chain

---

## File Format

The addon needs to parse and write the existing markdown format. Current format for `buckets.md`:

```markdown
## Active
*(Currently being worked on)*

- Task description here (project: project_slug)

## Work Queue
*(Ready and desired to be worked next)*

- Another task (project: reorg)

## Completed
*(Historical record)*

- **2026-03-15**: Completed task description (project: reorg)
```

Current format for project files (`projects/reorg.md`):

```markdown
# Project: HA Reorganization

**Status:** In Progress
**Goal:** Every entity has a correct area...

## Completed
- [x] Task that was done

## Backlog
- [ ] Task still to do (bucket: Planning)
```

### Recommended Enhancement

To support richer data (IDs, dates, tags, blocked_by), consider adding YAML frontmatter to task entries or migrating to a structured format within the markdown. Example:

```markdown
## Active

- **[T-012]** Setup motion lighting automation (project: motion-lighting)
  - Created: 2026-03-15
  - Blocked by: T-008
  - Tags: automation, lighting
```

Or alternatively, keep the markdown human-readable and add a `.tasks/data.json` sidecar file for structured data that the addon manages. The markdown files become the "rendered view" that Claude Code and humans read.

---

## Technical Notes

- **Addon type:** Should be a HA custom integration (not a standalone addon) to create entities and services natively
- **File watching:** Use a file watcher on `/config/.tasks/` to detect external changes (from Claude Code sessions)
- **Sync:** When files change externally, re-parse and update entities. When entities change via services, write back to files.
- **No database:** The markdown/JSON files ARE the database. No SQLite, no separate state.
- **Panel:** Use a custom panel (JS frontend) registered via the integration

---

## Current Task Inventory (as of 2026-03-15)

### Projects
1. **reorg** — HA Reorganization (In Progress)
2. **motion-lighting** — Motion-Activated Lighting (Not Started)
3. **occupancy-music** — Occupancy-Based Music (Not Started)
4. **notifications** — Notification System (Not Started)

### Tasks by Bucket
- **Active:** Label renames, entity renames (reorg)
- **Cleanup:** Bifrost entities, Browser Mod (reorg)
- **Investigation:** Square PIR sensors 2-5, laundry room button, laundry room Matter bulbs (reorg)
- **Planning:** Naming conventions, entity audit, kitchen motion sensor, contact sensors, smart plugs, media players, laundry automation, motion-lighting design, occupancy-music design, notifications audit (various)
- **Brainstorm:** Motion lighting edge cases, multi-room music, notification scenarios (various)
- **Completed:** 10 items from 2026-03-15 (reorg, meta)
