# Project: HA Reorganization

**Status:** In Progress
**Goal:** Every entity has a correct area, meaningful name, consistent naming convention, and appropriate labels. The system is clean and ready for automation work.

---

## Completed
- [x] Move credentials out of configuration.yaml into secrets.yaml
- [x] Rename "new_script" to "cast_lyrics_dashboard"
- [x] Initialize git tracking
- [x] Create areas: Closet, Pending
- [x] Create labels: Motion Sensor, Light Trigger
- [x] Assign all lights to areas with Primary/Secondary labels
- [x] Assign all known motion/presence sensors to areas with labels
- [x] Place FP2 cross-room sensors in correct areas (office↔family room)
- [x] Place unassigned devices (sonoff mmwave, luggage room light) in Pending area
- [x] Brainstorm and formalize naming conventions (conventions.md)
- [x] Rename labels to prefixed convention (role:, cat:)
- [x] Rename all light entity IDs to area_function_location pattern
- [x] Rename all motion/presence sensor entity IDs to area_function pattern
- [x] Rename illuminance/temperature sensor entity IDs
- [x] Remove light_trigger from FP2 "all zones" sensors (cross-room)
- [x] Update all automations.yaml references to use new entity IDs
- [x] Identify compass directions for all multi-light rooms (office, family room, kitchen, laundry)

## Backlog
- [ ] Audit remaining 700+ unassigned entities — assign areas where appropriate (bucket: Planning)
- [ ] Identify square PIR sensors 2-5 physically (bucket: Investigation)
- [ ] Disable Bifrost entities (bucket: Cleanup)
- [ ] Remove/disable Browser Mod (bucket: Cleanup)
- [ ] Review Kitchen — no motion sensor assigned, may need one (bucket: Planning)
- [ ] Review luggage_room_light — determine actual location (bucket: Investigation)
- [ ] Assign contact sensors to rooms (bathroom, closet, washing machine, misc) (bucket: Planning)
- [ ] Assign smart plugs/switches to rooms (bucket: Planning)
- [ ] Assign media players to rooms (bucket: Planning)
- [ ] Add laundry room east ceiling fixture Matter bulbs to HA (bucket: Investigation)
- [ ] Identify button for laundry room light control (bucket: Investigation)
- [ ] Setup laundry room light button automation (bucket: Planning)
