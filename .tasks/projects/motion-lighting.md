# Project: Motion-Activated Lighting

**Status:** Not Started
**Goal:** Lights turn on/off automatically based on presence detection in every room. Uses area + label targeting (primary_lights + light_trigger) for a single generic automation pattern.

---

## Prerequisites
- HA Reorg project: all lights and triggers must be assigned to areas with correct labels
- Every room with lights needs at least one light_trigger sensor

## Backlog
- [ ] Design the automation template (one automation, targets by area + label) (bucket: Planning)
- [ ] Define per-room behavior (timeout, brightness, time-of-day adjustments) (bucket: Planning)
- [ ] Handle rooms with no motion sensor yet (Kitchen) (bucket: Planning)
- [ ] Implement and test per room (bucket: Work Queue — when ready)
- [ ] Handle edge cases: movie mode, sleep mode, manual override (bucket: Brainstorm)
