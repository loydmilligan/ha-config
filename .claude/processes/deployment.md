# Deployment Process

> How to test and deploy changes to Home Assistant configuration.

## Overview

Changes to HA configuration files require validation and reloading. This process ensures changes are safe before they're applied.

---

## Pre-Change Checklist

Before modifying configuration:

1. **Understand the scope** — What files will change?
2. **Check dependencies** — What might break?
3. **Plan rollback** — How to undo if needed?

---

## YAML Validation

Before reloading, validate YAML syntax:

### Using HA CLI (if available)
```bash
ha core check
```

### Manual Validation
- Check for proper indentation (spaces, not tabs)
- Verify all required fields present
- Confirm entity IDs exist

---

## Reloading Configuration

### Full Restart (rarely needed)
Only for changes to:
- `configuration.yaml` core sections
- Custom components
- Integrations that require restart

```
Settings → System → Restart
```

### Selective Reload (preferred)
For most changes, use selective reload:

| Changed | Reload Method |
|---------|---------------|
| `automations.yaml` | Settings → Automations → Reload |
| `scripts.yaml` | Settings → Scripts → Reload |
| `scenes.yaml` | Settings → Scenes → Reload |
| Input helpers | Settings → Helpers → Reload |
| Template sensors | Developer Tools → YAML → Reload Template Entities |
| Groups | Developer Tools → YAML → Reload Groups |

### Via Service Call
```yaml
service: homeassistant.reload_core_config
```

Or specific domains:
```yaml
service: automation.reload
service: script.reload
service: scene.reload
```

---

## Testing Changes

### 1. Check for Errors
After reload:
- Check Notifications for errors
- Review System Log (Settings → System → Logs)
- Verify no entities became unavailable

### 2. Functional Testing
- Trigger the automation/script manually
- Verify expected behavior
- Check state changes in Developer Tools → States

### 3. Edge Cases
- Test boundary conditions
- Verify error handling
- Check what happens if entities are unavailable

---

## Rollback Procedure

If something breaks:

### 1. Quick Rollback
```bash
git checkout -- path/to/file.yaml
```
Then reload the relevant domain.

### 2. Full Rollback
```bash
git revert HEAD --no-edit
```
Then restart HA. Prefer `git revert` over `git reset --hard` — it creates a new commit preserving history rather than destroying it.

### 3. Manual Fix
Edit the file to fix the issue, reload.

---

## Git Workflow

### After Successful Change
```bash
git add <changed-files>
git commit -m "Description of change"
# Ask user before pushing
```

### Commit Message Format
```
Short description (50 chars or less)

- Detail 1
- Detail 2

Affects: automations, scripts
```

---

## Safety Guidelines

1. **Never edit secrets.yaml directly** — Reference only
2. **Backup before major changes** — `git stash` or commit first
3. **Test in isolation** — Disable related automations if needed
4. **Monitor after deploy** — Watch logs for 5 minutes post-change

---

## Common Issues

### "Invalid config"
- YAML syntax error
- Missing required field
- Invalid entity reference

### "Entity not found"
- Typo in entity_id
- Entity not yet loaded
- Integration not configured

### "Service not available"
- Integration not loaded
- Service name changed
- Domain not supported
