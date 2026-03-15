# Naming & Organization Conventions

## Areas

Areas represent **physical spaces only**. Every entity should be in the area where it physically exists.

**Fallback areas:**
- **House** — physical devices or groups that span multiple rooms or don't belong to one room (e.g., multi-room speaker groups, whole-house sensors like sun position)
- **Services** — infrastructure/system devices (servers, network gear, HA itself)
- **Pending** — devices not yet assigned to a room. Clean up names/labels so they don't imply a room.

**Rules:**
- If a device physically lives in a room, it goes in that room's area — even if its *function* is broader (e.g., 3D printer lives in Office → area is Office)
- Do NOT create areas for logical/functional groupings — use labels for that
- Sub-room zones are handled by labels (type `zone:`), not sub-areas

---

## Labels

Labels are prefixed by type to indicate their purpose:

| Prefix | Purpose | Examples |
|---|---|---|
| `role:` | What the entity does in automations | `role:primary_lights`, `role:light_trigger`, `role:primary_speaker` |
| `zone:` | Physical sub-grouping within an area (for dashboards, grouping) | `zone:3d_printer_station`, `zone:fireplace_alcove` |
| `cat:` | Category — what kind of thing it is | `cat:appliance`, `cat:infrastructure`, `cat:physical_controller` |
| `state:` | Lifecycle status | `state:deprecated`, `state:pending_investigation` |

**Rules:**
- An entity can have multiple labels across types
- `role:` labels are what automations target — be intentional about what gets them
- `zone:` labels are primarily for dashboard organization and visual grouping
- `state:` labels are temporary — remove when resolved
- Don't label entities you don't want picked up by automations with `role:` labels

---

## Entity IDs

Pattern: `domain.{area}_{function}_{location}`

| Part | Required | Description | Examples |
|---|---|---|---|
| `area` | Yes | Room/area name, snake_case | `office`, `family_room`, `hallway` |
| `function` | Yes | What it does or what it is | `occupancy`, `ceiling_light`, `temperature`, `motion` |
| `location` | Only for multiples | Compass direction or landmark within room | `ne`, `sw`, `by_door`, `rolltop` |

**Examples:**
- `light.hallway_ceiling` — only one ceiling light
- `light.office_ceiling_ne` — one of four, NE position
- `binary_sensor.office_occupancy_rolltop` — FP2 zone sensing the rolltop desk area
- `binary_sensor.family_room_occupancy_from_office` — cross-room FP2 zone
- `sensor.bathroom_temperature` — only one temp sensor

**When to use compass vs. descriptive:**
- Default to **compass** (n, s, e, w, ne, nw, se, sw) for consistency
- Use **descriptive** only when compass doesn't make sense (e.g., `rolltop`, `standing_area`, `from_office`)

**Rules:**
- Area prefix comes first — always
- Keep it short but unambiguous
- Group entities (like `office_lights` controlling `office_ceiling_1-4`) keep a logical name — individual members get position qualifiers
- For cross-room sensors, use `{target_area}_occupancy_from_{source_area}`

---

## Friendly Names

Pattern: `{Area} {Function} {Location}`

- Always include the area name (for global views and voice assistants)
- Natural casing, human readable
- Shorter than entity_id — skip redundant words

**Examples:**
- `light.hallway_ceiling` → **"Hallway Light"**
- `light.office_ceiling_ne` → **"Office Ceiling NE"**
- `binary_sensor.office_occupancy_rolltop` → **"Office Rolltop Occupancy"**
- `light.family_room_fireplace_1` → **"Family Room Fireplace 1"**
- `sensor.bathroom_temperature` → **"Bathroom Temperature"**

---

## Summary

| Concept | Mechanism | Answers the question |
|---|---|---|
| Where is it physically? | **Area** | "What room is this in?" |
| What sub-zone of the room? | **Label (`zone:`)** or entity ID location qualifier | "Where in the room?" |
| What does it do in automations? | **Label (`role:`)** | "Should this turn on with motion?" |
| What kind of thing is it? | **Label (`cat:`)** | "Show me all appliances" |
| What's its lifecycle state? | **Label (`state:`)** | "What's deprecated?" |
| How do I reference it in code? | **Entity ID** | `domain.area_function_location` |
| How does it show in the UI? | **Friendly Name** | Short, readable, includes area |
