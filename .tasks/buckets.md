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
- **2026-03-15**: Renamed "new_script" to "cast_lyrics_dashboard", removed duplicate cast call (project: reorg)
- **2026-03-15**: Initialized git repo with .gitignore for /config (project: reorg)
- **2026-03-15**: Created areas: Closet, Pending (project: reorg)
- **2026-03-15**: Created labels: Motion Sensor, Light Trigger (project: reorg)
- **2026-03-15**: Assigned all lights to areas with Primary/Secondary Lights labels (project: reorg)
- **2026-03-15**: Assigned all known motion/presence sensors to areas with Motion Sensor + Light Trigger labels (project: reorg)
- **2026-03-15**: Placed FP2 cross-room sensors in correct areas — office sensor 5 → Family Room, family room sensor 3 → Office (project: reorg)
- **2026-03-15**: Placed unassigned devices in Pending area (sonoff mmwave, luggage room light) (project: reorg)
- **2026-03-15**: Set up task workflow system — workflow.md, buckets, projects (meta)
- **2026-03-15**: Brainstormed naming conventions — decided: areas=physical, labels=prefixed (role:/zone:/cat:/state:), entity_ids=area_function_location, compass qualifiers (project: reorg)
- **2026-03-15**: Formalized conventions into /config/.tasks/conventions.md (project: reorg)
- **2026-03-15**: Renamed all labels to prefixed convention — role:, cat: (project: reorg)
- **2026-03-15**: Renamed all light entities to area_function_location pattern, identified compass directions (project: reorg)
- **2026-03-15**: Renamed all motion/presence/illuminance sensors to area_function pattern (project: reorg)
- **2026-03-15**: Removed light_trigger from FP2 "all zones" sensors (cross-room) (project: reorg)
- **2026-03-15**: Updated all automations.yaml references for renamed entities (project: reorg)
- **2026-03-15**: Reloaded automations and scripts in HA (project: reorg)

## Cleanup
- Disable all Bifrost entities (project: reorg)
- Evaluate Browser Mod addon removal (project: reorg)

## Investigation
- Identify rooms for square PIR sensors 2-5 (project: reorg)
- Determine actual location of luggage_room_light (project: reorg)
- Add laundry room east ceiling fixture Matter bulbs to HA (project: reorg)
- Identify which button/switch to use for laundry room lights (project: reorg)

## Planning
- Review and establish entity naming conventions (project: reorg)
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
