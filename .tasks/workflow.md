# Task Workflow & Processing

## Overview

This document defines how work is managed on the Home Assistant configuration.
It is the single source of truth for how tasks move from idea to completion.

---

## Buckets

Every task lives in exactly one bucket at any time.

| Bucket | Purpose | Entry Criteria | Exit |
|---|---|---|---|
| **Brainstorm** | Raw ideas, "what ifs", things worth remembering but not committed to. | Anyone thinks of something. | Promoted to Planning, or discarded. |
| **Planning** | Ideas that need design/research before they can be worked. | Has enough shape to describe the desired outcome, but approach is unclear. | Promoted to a Project backlog or Work Queue when plan is clear. |
| **Cleanup** | Tech debt, deprecated items, things to remove or tidy. Not urgent. | Identified as no longer needed or below standard. | Moved to Work Queue when we explicitly decide to tackle it. |
| **Investigation** | Items that need research or physical verification before they can proceed. | Missing information blocks progress (e.g., "which room is this sensor in?"). | Resolved → moved to relevant Project or Cleanup. |
| **Work Queue** | Ready and desired to be worked. The "up next" list. | Task is fully defined, unblocked, and we've decided to do it. | Picked up → moves to Active. |
| **Active** | Currently being worked on in this session. | Pulled from Work Queue at start of work. | Completed, or returned to Work Queue if paused. |
| **Completed** | Done. Kept for historical reference with details on what was done, when, and why. | Task finished and verified. | Archived if no longer relevant. |

---

## Projects

A Project is a larger initiative that groups related tasks toward a goal.
Each project has its own file in `.tasks/projects/` with:
- **Goal**: What done looks like
- **Backlog**: Tasks specific to this project (can be in any bucket)
- **Status**: Not Started / In Progress / Complete

Projects are NOT buckets — a task belongs to a project AND lives in a bucket.

### Active Projects
- `reorg.md` — Reorganize HA: naming conventions, areas, labels, entity cleanup
- `motion-lighting.md` — Motion-activated lighting for all rooms
- `occupancy-music.md` — Occupancy-based music system
- `notifications.md` — Proper notification system

---

## Workflow Rules

1. **No work without explicit decision.** Tasks in Cleanup, Investigation, Planning, and Brainstorm are NOT worked on unless we explicitly move them to Work Queue.
2. **Work Queue is the contract.** If it's in Work Queue, it's fair game to start. If it's not, ask first.
3. **One bucket at a time.** A task doesn't straddle buckets. Move it cleanly.
4. **Projects organize, buckets prioritize.** A task can belong to a project (what it's for) and a bucket (where it is in the workflow).
5. **Claude does not self-promote tasks.** Only the user decides when something moves to Work Queue or Active.

---

## Task Format

Tasks are tracked in two places:
- **Session tasks** (via TaskCreate/TaskUpdate) — ephemeral, for tracking work within a conversation
- **Persistent tasks** (in `.tasks/` files) — survive across conversations, the durable record

When starting a session, review `.tasks/` files to load context.
When ending a session, ensure any completed or new tasks are reflected in the files.

---

## Processing a Work Session

1. Review current state: check `.tasks/` files, look at Active and Work Queue
2. Confirm with user what to work on
3. Move chosen item(s) to Active
4. Do the work
5. Mark completed or return to Work Queue if paused
6. Update project files and memories as needed
