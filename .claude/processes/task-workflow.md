# Task Workflow Process

> How agents interact with the Ground Control task management system.

## Overview

Tasks are managed in `/config/.tasks/` as markdown files with YAML frontmatter. Ground Control provides the UI; agents (primarily Major Tom) execute the work.

---

## File Locations

| File | Purpose |
|------|---------|
| `.tasks/buckets.md` | Central task registry — all tasks by bucket |
| `.tasks/projects/*.md` | Individual project files |
| `.tasks/workflow.md` | Bucket definitions and rules |
| `.tasks/conventions.md` | Entity naming conventions |

---

## Session Start Checklist

1. Read `.tasks/buckets.md` to understand current state
2. Check Work Queue for tasks ready to work
3. Check Active for any in-progress tasks
4. Load relevant project file if focusing on a project

---

## Working a Task

### 1. Claim the Task
Move from Work Queue → Active:
- Edit `buckets.md`
- Move the task line from `## Work Queue` to `## Active`
- Increment `version` (MINOR bump)
- Update `updated` date

### 2. Do the Work
Execute what the task describes.

### 3. Complete the Task
Move from Active → Completed:
- Move task line to `## Completed`
- Add date prefix: `- **YYYY-MM-DD**: Subject (project: slug)`
- Increment `version`
- Update `updated` date
- Update `task_count` in frontmatter

---

## Task Line Format

### Current Format (no task IDs yet)

**Standard task:**
```markdown
- Task subject here (project: reorg)
```

**Blocked task:**
```markdown
- Task subject (project: reorg) (blocked by: other task description)
```

**Completed task:**
```markdown
- **2026-03-15**: Task subject (project: reorg)
```

**Empty bucket:**
```markdown
— empty —
```

### Future Format (when Ground Control implements task IDs)

Task IDs (T-001, T-002, etc.) will be added by Ground Control. Format will become:
```markdown
- [T-001] Task subject here (project: reorg)
- **2026-03-15**: [T-001] Task subject (project: reorg)
```

Until then, use subject text to identify tasks.

---

## Rules to Follow

### Never Self-Promote Tasks
- Don't move tasks TO Work Queue from other buckets
- Only the user (via Ground Control or explicit request) promotes tasks
- You can suggest: "Should I move T-015 to Work Queue?"

### One Bucket at a Time
A task lives in exactly one bucket. Move it cleanly.

### Discoveries Go to Brainstorm
Found something new while working? Add it to Brainstorm:
```markdown
## Brainstorm
- New thing discovered during work (project: relevant-project)
```

### Blocked Tasks Can't Progress
Tasks with `(blocked by: T-XXX)` cannot move to Work Queue or Active until the blocker is resolved.

---

## Frontmatter Updates

When editing `.tasks/` files:

```yaml
---
version: 1.3.0      # Increment MINOR (middle number)
updated: 2026-03-15 # Today's date
task_count:
  active: 1         # Update to reflect actual counts
  work_queue: 2
  # ... etc
---
```

### Version Rules
- **PATCH** (0.0.x): Typo fixes only
- **MINOR** (0.x.0): Task added/moved/updated
- **MAJOR** (x.0.0): Structural changes

---

## Ground Control Sync

Ground Control watches `.tasks/` files for changes. When you edit:
1. Ground Control detects the change
2. Re-parses the file
3. Updates its UI and sensors

No explicit notification needed — file changes trigger sync automatically.
