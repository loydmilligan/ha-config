/* Bathroom "wasp in a box" debug card (ha-manager #19, design v3).
 *
 * Ported from Claude Design's approved mockup (bathroom-debug-handoff/reference/preview.html).
 * It renders ONLY what the automation publishes:
 *   input_select.bathroom_occupancy, input_text.bathroom_last_reason / _last_rule,
 *   sensor.bathroom_debug_view (roles, rules, next), timer.bathroom_untrusted_window,
 *   binary_sensor.bathroom_shower / _light_hold, switch.bathroom_fan_and_lights,
 *   binary_sensor.bathroom_switchbot_lights_measured / _mismatch.
 * Raw sensors are shown as readings only. Occupancy is never recomputed here.
 *
 * Usage:  type: custom:bathroom-wasp-card   (best in a panel view)
 */
(() => {
  const T = {
    bg: '#0f1318', panel: '#171c23', line: '#2f3945', text: '#e8edf2', dim: '#9aa7b4',
    blue: '#6cb0ff', blueFill: '#152234', orange: '#ffb057', ink: '#0b1420',
  };
  const C = { dim: T.dim, blue: T.blue, orange: T.orange, text: T.text };

  const E = {
    occ: 'input_select.bathroom_occupancy',
    reason: 'input_text.bathroom_last_reason',
    rule: 'input_text.bathroom_last_rule',
    view: 'sensor.bathroom_debug_view',
    win: 'timer.bathroom_untrusted_window',
    hold: 'timer.bathroom_presence_hold',
    shower: 'binary_sensor.bathroom_shower',
    lightHold: 'binary_sensor.bathroom_light_hold',
    door: 'binary_sensor.bathroom_contact_sensor_contact',
    pir: 'binary_sensor.square_multi_sensor_occupancy',
    hum: 'sensor.indoor_outdoor_meter_97c8_humidity',
    base: 'sensor.bathroom_humidity_baseline',
    onLine: 'sensor.bathroom_shower_on_threshold',
    offLine: 'sensor.bathroom_shower_off_threshold',
    lux: 'sensor.square_multi_sensor_illuminance',
    temp: 'sensor.indoor_outdoor_meter_97c8_temperature',
    temp2: 'sensor.square_multi_sensor_temperature',
    tap: 'event.4_button_circular_smart_button_action',
    delay: 'input_number.bathroom_pir_clear_delay',
    sb: 'switch.bathroom_fan_and_lights',
    sbRaw: 'switch.bathroom',
    measured: 'binary_sensor.bathroom_switchbot_lights_measured',
    mismatch: 'binary_sensor.bathroom_switchbot_mismatch',
    sync: 'input_boolean.bathroom_switchbot_lux_sync',
    bulb: 'light.bathroom_ceiling_light',
  };

  // Static descriptions (what each element is for). Roles come from the automation.
  const DEV = {
    door: { name: 'Door contact', entity: E.door, role: 'door', about: 'The box lid. Closed with someone moving inside means someone is inside until it opens.', rules: 'R1 R2 R3 R4' },
    pir: { name: 'PIR motion', entity: E.pir, role: 'pir', about: 'Hue motion sensor. Reads detected for 7 to 10 s after motion stops, so a reading right after the door closes may be left over.', rules: 'R1 R2 R2c R3 R7' },
    delay: { name: 'Untrusted window', entity: E.win, role: 'window', about: 'Starts when the door closes with motion showing. Motion is not trusted until it ends (input_number.bathroom_pir_clear_delay).', rules: 'R2 R2c R3' },
    hum: { name: 'Humidity', entity: E.hum, role: 'humidity', about: 'SwitchBot meter by the shower. Above the shower line it holds the light. It never turns the light on.', rules: 'R5' },
    base: { name: 'Humidity baseline', entity: E.base, role: 'baseline', about: '20th percentile of the last 3 h. Shower starts at baseline + on offset, ends at baseline + off offset.', rules: 'R5' },
    lux: { name: 'Luminosity', entity: E.lux, role: 'illuminance', about: 'Hue motion sensor. Tells whether the SwitchBot lights are really on (used when sync is on).', rules: 'sync' },
    temp: { name: 'Temperature (meter)', entity: E.temp, role: 'temperatures', about: 'Same sensor as humidity. Data only: no rule reads it yet.', rules: 'none' },
    temp2: { name: 'Temperature (PIR)', entity: E.temp2, role: 'temperatures', about: 'Hue motion sensor. Data only: the near-minus-far difference is logged as a possible shower signal.', rules: 'none' },
    tap: { name: 'Hue Tap', entity: E.tap, role: 'tap', about: '1: everything on/off, 2: Hue bulb, 3: SwitchBot, 4: all off. Manual off sticks until the room is vacant.', rules: 'manual' },
    sb: { name: 'SwitchBot: fan + lights', entity: E.sb, about: 'One press flips the exhaust fan, the second ceiling light and the vanity light together. Blind unless sync reads the light sensor.', rules: 'fan R6' },
    bulb: { name: 'Hue bulb', entity: E.bulb, about: 'The automatic light. On the instant occupancy leaves vacant; off after the delay once nothing holds it.', rules: 'R1 R6' },
  };
  const INPUTS = ['door', 'pir', 'delay', 'hum', 'base', 'lux', 'temp', 'temp2', 'tap'];
  const OUTPUTS = ['sb', 'bulb'];

  const STATES = [
    { id: 'vacant', name: 'Vacant', desc: 'Nobody believed to be inside', color: 'dim' },
    { id: 'presence', name: 'Presence', desc: 'Door open, following motion', color: 'blue' },
    { id: 'uncertain', name: 'Uncertain', desc: 'Door just closed, motion not trusted yet', color: 'orange' },
    { id: 'locked', name: 'Occupied · locked', desc: 'Someone inside until the door opens', color: 'blue' },
  ];
  // Reachable next states: a fixed function of the published state (the v3 transition table).
  const CAN = {
    vacant: ['presence', 'uncertain', 'locked'],
    presence: ['uncertain', 'vacant', 'locked'],
    uncertain: ['locked', 'vacant', 'presence'],
    locked: ['presence', 'vacant'],
  };
  const RULES = [
    ['R1', 'Door open: the door opening or motion means presence; a hold follows when motion clears.'],
    ['R2', 'Door closes with motion showing: not trusted for the window.'],
    ['R3', 'Motion still showing when the window ends, or fresh motion behind a closed door: locked.'],
    ['R4', 'Locked ignores motion clearing. The door opening ends it.'],
    ['R5', 'Shower on: the light is held.'],
    ['R6', 'Light off after the delay once nothing holds it (5 min after R2c, else 1 min).'],
    ['R7', 'Locked with no motion and no shower for the lock timeout: false lock.'],
  ];

  // Real layout from room-drawer (room-bathroom.json): 125 x 68 in, scaled 6.24 px/in.
  const S = 6.24, OX = 40, OY = 40, X = (i) => Math.round(OX + i * S), Y = (i) => Math.round(OY + i * S);
  const F = {
    host: { w: 1120, h: 528 },
    room: { x: X(0), y: Y(0), w: Math.round(125 * S), h: Math.round(68 * S) },
    doorGap: { x: X(87), y: Y(68) - 4, w: Math.round(27 * S), h: 8 },
    doorClosed: { x: X(87), y: Y(68) - 5, w: Math.round(27 * S), h: 10 },
    doorOpen: { x: X(114) - 10, y: Y(68) - Math.round(27 * S), w: 10, h: Math.round(27 * S) },
    shower: { x: X(0) + 4, y: Y(3), w: Math.round(33 * S), h: Math.round(65 * S) - 4 },
    fixtures: [
      { label: 'Toilet', x: X(42), y: Y(3), w: Math.round(20 * S), h: Math.round(28 * S), radius: '8px 8px 40px 40px' },
      { label: 'Vanity', x: X(69), y: Y(3), w: Math.round(54 * S), h: Math.round(18 * S), radius: '8px' },
      { label: 'Sink', x: X(87), y: Y(3) + 22, w: Math.round(20 * S), h: Math.round(18 * S) - 30, radius: '40%' },
    ],
    pirZone: { x: 440, y: 300, w: 290, h: 150 },
    pins: [
      { id: 'hum', label: 'Humidity', x: 52, y: 92, w: 190, radius: 10, text: 'short' },
      { id: 'temp', label: 'Temperature (meter)', x: 52, y: 144, w: 190, radius: 10, text: 'short' },
      { id: 'sb', label: 'Exhaust fan', x: 252, y: 252, w: 122, radius: 10, text: 'fan' },
      { id: 'sb', label: 'Ceiling light (SB)', x: 380, y: 252, w: 132, radius: 22, text: 'light' },
      { id: 'bulb', label: 'Hue bulb', x: 518, y: 252, w: 112, radius: 22, text: 'short' },
      { id: 'sb', label: 'Vanity light (SB)', x: 600, y: 118, w: 170, radius: 22, text: 'light' },
      { id: 'lux', label: 'Luminosity', x: 642, y: 196, w: 168, radius: 10, text: 'short' },
      { id: 'temp2', label: 'Temperature (PIR)', x: 642, y: 252, w: 168, radius: 10, text: 'short' },
      { id: 'pir', label: 'PIR motion', x: 642, y: 396, w: 168, radius: 10, text: 'short' },
      { id: 'tap', label: 'Hue Tap', x: 300, y: 400, w: 132, radius: 10, text: 'short' },
      { id: 'door', label: 'Door contact', x: 600, y: 476, w: 168, radius: 10, text: 'full' },
      { id: 'delay', label: 'Untrusted window', x: 330, y: 476, w: 200, radius: 22, text: 'full' },
      { id: 'base', label: 'Humidity baseline', x: 52, y: 476, w: 240, radius: 22, text: 'full' },
    ],
    legend: { x: 852, y: 40, w: 236 },
  };
  const ROOM = {
    vacant: { border: T.dim, bs: 'solid', bg: '#12161c', shadow: 'none' },
    presence: { border: T.blue, bs: 'solid', bg: '#121b27', shadow: 'none' },
    uncertain: { border: T.orange, bs: 'dashed', bg: '#1d1912', shadow: 'none' },
    locked: { border: T.blue, bs: 'solid', bg: '#121b27', shadow: 'inset 0 0 0 6px ' + T.blue },
  };

  const LANES = [
    { key: 'door', label: 'Door closed', color: '#cfd6de', opacity: 0.85 },
    { key: 'pir', label: 'Motion detected', color: T.blue, opacity: 1 },
    { key: 'win', label: 'Untrusted window', color: T.orange, opacity: 0.8 },
    { key: 'shower', label: 'Shower hold', color: T.orange, opacity: 0.45 },
  ];
  const RANGE = [-60, 20];

  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const dur = (s) => (s < 90 ? Math.round(s) + ' s' : s < 5400 ? Math.round(s / 60) + ' min' : Math.round(s / 3600) + ' h');
  const BAD = ['unavailable', 'unknown'];

  class BathroomWaspCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this._sel = null;
      this._buf = {}; // entity_id -> [[epochSec, state], ...]
      this._hist = false;
      this.shadowRoot.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-sel]');
        if (!b) return;
        this._sel = b.dataset.sel;
        this._render();
      });
    }
    setConfig(config) { this._config = config || {}; }
    getCardSize() { return 20; }
    connectedCallback() {
      this._tick = setInterval(() => this._renderLive(), 1000);
    }
    disconnectedCallback() { clearInterval(this._tick); }

    set hass(hass) {
      const first = !this._hass;
      this._hass = hass;
      this._record();
      if (first) this._loadHistory();
      const sig = this._signature();
      if (sig !== this._sig) { this._sig = sig; this._render(); }
    }

    // Only re-render when something this card shows actually changed.
    _signature() {
      return Object.values(E).map((id) => {
        const s = this._hass.states[id];
        return s ? s.state + '|' + s.last_updated : '-';
      }).join(',');
    }

    st(id) { return this._hass && this._hass.states[id]; }
    s(id) { const x = this.st(id); return x ? x.state : 'unavailable'; }

    async _loadHistory() {
      const ids = [E.door, E.pir, E.win, E.shower];
      const start = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      try {
        const r = await this._hass.callWS({
          type: 'history/history_during_period', start_time: start, entity_ids: ids,
          minimal_response: true, no_attributes: true, significant_changes_only: false,
        });
        for (const id of ids) {
          const rows = (r[id] || []).map((x) => [x.lc || x.lu, x.s]);
          const live = this._buf[id] || [];
          this._buf[id] = rows.concat(live.filter((l) => !rows.length || l[0] > rows[rows.length - 1][0]));
        }
        this._hist = true;
        this._renderLive();
      } catch (err) {
        this._histErr = String(err && err.message || err);
      }
    }

    _record() {
      for (const id of [E.door, E.pir, E.win, E.shower]) {
        const s = this.st(id);
        if (!s) continue;
        const t = new Date(s.last_changed).getTime() / 1000;
        const b = this._buf[id] || (this._buf[id] = []);
        const last = b[b.length - 1];
        if (!last || last[1] !== s.state || t > last[0] + 0.001) {
          if (!last || last[1] !== s.state) b.push([t, s.state]);
        }
        const cut = Date.now() / 1000 - 600;
        while (b.length > 2 && b[1][0] < cut) b.shift();
      }
    }

    // ---------- live readings (no decisions made here) ----------
    winLeft() {
      const w = this.st(E.win);
      if (!w || w.state !== 'active' || !w.attributes.finishes_at) return null;
      return Math.max(0, (new Date(w.attributes.finishes_at).getTime() - Date.now()) / 1000);
    }

    values() {
      const h = this._hass, roles = (this.st(E.view) || { attributes: {} }).attributes.roles || {};
      const age = (id) => { const x = this.st(id); return x ? (Date.now() - new Date(x.last_changed).getTime()) / 1000 : 0; };
      const role = (k) => roles[DEV[k].role] || 'watching';
      const num = (id, unit, digits) => {
        const v = this.s(id);
        if (BAD.includes(v)) return 'Unavailable';
        const n = Number(v);
        return (isNaN(n) ? v : (digits != null ? n.toFixed(digits) : n)) + (unit ? ' ' + unit : '');
      };
      const V = {};
      const door = this.s(E.door);
      V.door = [BAD.includes(door) ? 'Unavailable' : door === 'on' ? 'Open' : 'Closed', role('door'), (door === 'on' ? 'Open' : 'Closed') + ' for ' + dur(age(E.door)) + '.'];
      const pir = this.s(E.pir);
      V.pir = [BAD.includes(pir) ? 'Unavailable' : pir === 'on' ? 'Detected' : 'Clear', role('pir'), (pir === 'on' ? 'Detected' : 'Clear') + ' for ' + dur(age(E.pir)) + '.'];
      const left = this.winLeft(), wlen = Number(this.s(E.delay)) || 12;
      V.delay = [left != null ? Math.ceil(left) + ' s left of ' + wlen + ' s' : wlen + ' s · not running', left != null ? 'driving' : role('delay'), 'Window length ' + wlen + ' s.'];
      V.hum = [num(E.hum, '%'), role('hum'), 'Shower line ' + num(E.onLine, '%') + ', ends at ' + num(E.offLine, '%') + '.'];
      V.base = [num(E.base, '%') + ' · line ' + num(E.onLine, '%') + ' / ' + num(E.offLine, '%'), role('base'), 'Baseline, shower-on line and shower-off line together, so a drifting baseline is visible.'];
      V.lux = [num(E.lux, 'lx'), role('lux'), 'SwitchBot lights measured ' + this.s(E.measured) + '.'];
      V.temp = [num(E.temp, '°F', 1), role('temp'), 'No rule reads it.'];
      V.temp2 = [num(E.temp2, '°F', 1), role('temp2'), 'No rule reads it.'];
      const tap = this.st(E.tap);
      const tapTxt = tap && !BAD.includes(tap.state) ? (tap.attributes.event_type || 'press') + ', ' + dur((Date.now() - new Date(tap.state).getTime()) / 1000) + ' ago' : 'No press yet';
      V.tap = [tapTxt, role('tap'), 'Last button pressed.'];
      // Outputs
      const sb = this.s(E.sb), sync = this.s(E.sync) === 'on', mism = this.s(E.mismatch) === 'on';
      const sbWord = BAD.includes(sb) ? 'Unavailable' : sb === 'on' ? 'On' : 'Off';
      V.sb = [sbWord + (sync ? ' (measured)' : ' (assumed)') + (mism ? ' · lux disagrees' : ''), sb === 'on' ? 'on' : 'off',
        (sync ? 'State comes from the light sensor.' : 'Assumed: last command. The light sensor says ' + this.s(E.measured) + '.') + (mism ? ' Mismatch for over a minute.' : '')];
      V.sb.mismatch = mism;
      const bulb = this.st(E.bulb);
      let bulbTxt = 'Unavailable (wall switch off?)', bulbRole = 'off';
      if (bulb && bulb.state === 'on') { bulbTxt = 'On · ' + Math.round((bulb.attributes.brightness || 0) / 2.55) + ' %'; bulbRole = 'on'; }
      else if (bulb && bulb.state === 'off') bulbTxt = 'Off';
      const lh = this.s(E.lightHold) === 'on';
      V.bulb = [bulbTxt, bulbRole, lh ? 'Light hold is on: it cannot turn off now.' : 'Light hold is off: it turns off after the delay.'];
      for (const k of INPUTS) if (V[k][0] === 'Unavailable') V[k][1] = 'unavailable';
      return V;
    }

    look(V, id) {
      const role = V[id][1], o = { bg: T.panel, border: T.line, bs: 'solid', name: T.text, value: T.text, role };
      if (role === 'driving' || role === 'on') { o.bg = T.blueFill; o.border = T.blue; o.value = T.blue; }
      if (role === 'ignored' || role === 'unavailable') { o.bs = 'dashed'; o.border = T.dim; o.name = T.dim; o.value = T.dim; }
      if (id === 'sb' && V.sb.mismatch) { o.border = T.orange; o.bs = 'dashed'; o.value = T.orange; }
      o.ring = id === this._sel ? '0 0 0 2px ' + T.bg + ', 0 0 0 4px ' + T.text : '';
      o.glow = role === 'on' ? '0 0 22px 4px rgba(108,176,255,0.5)' : '';
      return o;
    }

    card(V, id) {
      const d = DEV[id], v = V[id], L = this.look(V, id), strong = L.role === 'driving' || L.role === 'on';
      return '<button type="button" class="card" data-sel="' + id + '" title="' + esc(d.about) + '" style="background:' + L.bg + ';border:2px ' + L.bs + ' ' + L.border + ';box-shadow:' + (L.ring || 'none') + '">' +
        '<span style="display:flex;justify-content:space-between;gap:8px;align-items:center"><span style="font-weight:600;color:' + L.name + '">' + esc(d.name) + '</span>' +
        '<span class="badge" style="background:' + (strong ? T.blue : 'transparent') + ';color:' + (strong ? T.ink : T.dim) + ';border:1px solid ' + (strong ? T.blue : T.dim) + '">' + esc(L.role) + '</span></span>' +
        '<span class="mono" ' + (id === 'delay' ? 'data-live="delay" ' : '') + 'style="font-size:15px;font-weight:600;color:' + L.value + '">' + esc(v[0]) + '</span>' +
        '<span class="dim" style="font-size:12px">' + esc(v[2]) + '</span></button>';
    }

    // ---------- render ----------
    _render() {
      if (!this._hass) return;
      const V = this.values();
      const occ = this.s(E.occ), known = STATES.some((x) => x.id === occ);
      const stateDef = STATES.find((x) => x.id === occ) || { id: occ, name: 'Unknown', desc: '', color: 'dim' };
      const sc = C[stateDef.color];
      const view = this.st(E.view) || { attributes: {} };
      const rules = view.attributes.rules || {}, next = view.attributes.next || [];
      const shower = this.s(E.shower) === 'on';
      if (!this._sel) this._sel = INPUTS.find((k) => V[k][1] === 'driving') || 'door';
      const lastRule = this.s(E.rule), occAge = this.st(E.occ) ? (Date.now() - new Date(this.st(E.occ).last_changed).getTime()) / 1000 : 0;
      const why = known ? this.s(E.reason) : 'Unknown since restart: waiting for the automation to publish a state.';

      // Floor plan
      const R = ROOM[occ] || ROOM.vacant, sbOn = V.sb[1] === 'on';
      const doorClosed = V.door[0] === 'Closed', pv = V.pir, det = pv[0] === 'Detected';
      let Z;
      if (det && occ === 'uncertain') Z = [T.orange, 'dashed', 'rgba(255,176,87,0.16)', T.orange, 'Motion · not trusted yet'];
      else if (det && pv[1] === 'ignored') Z = [T.dim, 'dashed', 'rgba(154,167,180,0.10)', T.dim, 'Motion · ignored (locked)'];
      else if (det) Z = [T.blue, 'solid', 'rgba(108,176,255,0.20)', T.blue, 'Motion · trusted'];
      else if (pv[1] === 'ignored') Z = [T.dim, 'dashed', 'transparent', T.dim, 'No motion · ignored (locked)'];
      else if (pv[1] === 'unavailable') Z = [T.dim, 'dashed', 'transparent', T.dim, 'PIR unavailable'];
      else Z = [T.line, 'dashed', 'transparent', T.dim, 'No motion'];
      const box = (o, style, inner) => '<div class="abs" style="left:' + o.x + 'px;top:' + o.y + 'px;width:' + o.w + 'px;height:' + o.h + 'px;' + style + '">' + (inner || '') + '</div>';
      const leaf = this.look(V, 'door').value;
      const plan = box(F.room, 'border-radius:6px;border:4px ' + R.bs + ' ' + R.border + ';background:' + R.bg + ';box-shadow:' + R.shadow) +
        box(F.doorGap, 'background:' + T.panel) +
        box(F.shower, 'border-radius:8px;border:2px solid ' + (shower ? T.orange : T.line) + ';background:' + (shower ? 'rgba(255,176,87,0.22)' : 'transparent')) +
        '<div class="abs" style="left:' + (F.shower.x + 10) + 'px;top:' + (F.shower.y + 8) + 'px;font-size:12px;font-weight:600;color:' + (shower ? T.orange : T.dim) + '">Shower' + (shower ? ' · shower detected' : '') + '</div>' +
        F.fixtures.map((f) => box(f, 'padding:4px 8px;border-radius:' + f.radius + ';border:1px solid ' + T.line + ';font-size:12px;color:' + T.dim, f.label)).join('') +
        box(F.pirZone, 'border-radius:50%;border:2px ' + Z[1] + ' ' + Z[0] + ';background:' + Z[2]) +
        '<div class="abs" style="left:' + F.pirZone.x + 'px;top:' + (F.pirZone.y + 64) + 'px;width:' + (F.pirZone.w - 90) + 'px;text-align:center;font-size:13px;font-weight:600;color:' + Z[3] + '">' + Z[4] + '</div>' +
        box(doorClosed ? F.doorClosed : F.doorOpen, 'border-radius:3px;background:' + leaf) +
        F.pins.map((p) => {
          const v = V[p.id], L = this.look(V, p.id), first = v[0].split(' · ')[0];
          let txt;
          if (p.text === 'full') txt = v[0];
          else if (p.text === 'light') txt = sbOn ? 'On' : 'Off';
          else if (p.text === 'fan') txt = sbOn ? 'Running' : 'Off';
          else txt = (L.role === 'on' || L.role === 'off') ? first : first + ' · ' + L.role;
          const sh = [L.ring, L.glow].filter(Boolean).join(', ') || 'none';
          return '<button type="button" class="pin" data-sel="' + p.id + '" title="' + esc(DEV[p.id].about) + '" style="left:' + p.x + 'px;top:' + p.y + 'px;width:' + p.w + 'px;border-radius:' + p.radius + 'px;background:' + L.bg + ';border:2px ' + L.bs + ' ' + L.border + ';box-shadow:' + sh + '">' +
            '<span style="font-weight:600;color:' + L.name + '">' + esc(p.label) + '</span><span class="mono" ' + (p.id === 'delay' ? 'data-live="delay" ' : '') + 'style="color:' + L.value + '">' + esc(txt) + '</span></button>';
        }).join('');
      const key = (style, text) => '<div class="key"><span class="sw" style="' + style + '"></span><span>' + text + '</span></div>';
      const legend = '<div class="abs" style="left:' + F.legend.x + 'px;top:' + F.legend.y + 'px;width:' + F.legend.w + 'px;display:flex;flex-direction:column;gap:8px;font-size:12px">' +
        '<div class="cap" style="font-size:11px">Room now</div><div style="font-size:18px;font-weight:700;color:' + sc + '">' + esc(stateDef.name) + '</div>' +
        '<b style="margin-top:6px">Room outline</b>' + key('border:3px solid ' + T.dim, 'Grey, solid: vacant') + key('border:3px solid ' + T.blue, 'Blue, solid: presence') + key('border:3px dashed ' + T.orange, 'Orange, dashed: uncertain') + key('border:3px solid ' + T.blue + ';background:' + T.blue, 'Blue, filled edge: locked') +
        '<b style="margin-top:6px">Zones</b>' + key('border:2px solid ' + T.orange + ';background:rgba(255,176,87,0.3)', 'Orange shower: shower hold') + key('border-radius:50%;border:2px solid ' + T.blue + ';background:rgba(108,176,255,0.3)', 'Blue oval: trusted motion') + key('border-radius:50%;border:2px dashed ' + T.orange + ';background:rgba(255,176,87,0.2)', 'Orange oval: not trusted yet') +
        '<b style="margin-top:6px">Sensors and devices</b>' + key('border-radius:4px;border:2px solid ' + T.blue + ';background:' + T.blueFill, 'Blue: driving, or on (glows)') + key('border-radius:4px;border:2px solid ' + T.line, 'Plain: watching, or off') + key('border-radius:4px;border:2px dashed ' + T.dim, 'Dashed: ignored or unavailable') +
        '<div class="dim" style="margin-top:6px">SB = the SwitchBot circuit: one press drives all three SB pins.</div></div>';

      // Decision column
      const can = CAN[occ] || [];
      const statesHtml = STATES.map((x) => {
        const now = x.id === occ, nx = can.includes(x.id), c = C[x.color];
        const st = now ? 'background:' + c + ';border:2px solid ' + c + ';color:' + T.ink : nx ? 'border:2px dashed ' + T.text : 'border:2px solid ' + T.line + ';color:' + T.dim;
        return '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 12px;border-radius:10px;' + st + '"><span><b>' + esc(x.name) + '</b><br><span style="font-size:12px;opacity:.8">' + esc(x.desc) + '</span></span>' +
          '<span style="flex:none;font-size:11px;font-weight:700;text-transform:uppercase">' + (now ? 'now' : nx ? 'possible next' : 'not reachable') + '</span></div>';
      }).join('');
      const nextHtml = next.map((n) => '<div style="display:flex;flex-wrap:wrap;gap:6px 12px;padding:10px 12px;border-radius:10px;background:' + T.bg + ';border:1px solid ' + T.line + '"><span style="flex:1 1 200px"><span class="dim">If </span>' + esc(n[0]) + '</span><b style="flex:1 1 200px;color:' + T.blue + '">→ ' + esc(n[1]) + '</b></div>').join('') || '<div class="dim">Nothing published.</div>';
      const rulesHtml = RULES.map(([id, text]) => {
        const s = rules[id] || 'idle', fired = lastRule === id || (id === 'R2' && lastRule === 'R2c');
        const st = s === 'active' ? 'border:1px solid ' + T.blue + ';background:' + T.blueFill : s === 'armed' ? 'border:1px dashed ' + T.dim : 'border:1px solid ' + T.line + ';color:' + T.dim;
        const fg = s === 'active' ? T.blue : s === 'armed' ? T.text : T.dim;
        return '<div style="display:flex;gap:12px;padding:10px 12px;border-radius:10px;' + st + '"><b class="mono" style="flex:none;color:' + fg + '">' + id + '</b><span style="flex:1">' + esc(text) +
          (fired ? ' <span class="mono" style="color:' + T.orange + '">· last fired' + (lastRule === 'R2c' ? ' (R2c, ambiguous exit)' : '') + '</span>' : '') + '</span><span style="flex:none;font-size:11px;font-weight:700;text-transform:uppercase;color:' + fg + '">' + s + '</span></div>';
      }).join('');

      const sd = DEV[this._sel], sv = V[this._sel];
      const roleText = { driving: 'Driving. It is deciding the result right now.', watching: 'Watching. Read, but not deciding anything now.', ignored: 'Ignored. Deliberately not trusted in this state.', unavailable: 'Unavailable. Rules that need it cannot use it.', on: 'On.', off: 'Off.' };
      const field = (label, value, mono) => '<div><div class="dim" style="font-size:12px">' + label + '</div><div' + (mono ? ' class="mono"' : '') + '>' + esc(value) + '</div></div>';

      const bulbChip = V.bulb[0], sbChip = V.sb[0];
      this.shadowRoot.innerHTML = '<style>' + CSS + '</style><div class="page">' +
        '<div class="row" style="align-items:flex-end"><div><div class="cap">Bathroom · debug view</div><h1 style="font-size:28px">Wasp in a box</h1></div><div class="dim" style="font-size:13px;max-width:460px">Live. Everything here is what the automation published; raw sensors are readings only. Click any card or pin to inspect it.</div></div>' +
        '<div aria-live="polite" style="display:flex;flex-wrap:wrap;gap:20px;align-items:center;justify-content:space-between;background:' + T.panel + ';border:2px solid ' + sc + ';border-radius:14px;padding:20px 24px"><div style="flex:1 1 420px"><div class="cap">Occupancy now · ' + esc(lastRule) + ' · ' + dur(occAge) + ' ago</div><div style="font-size:30px;font-weight:700;color:' + sc + '">' + esc(stateDef.name) + '</div><div style="font-size:15px"><b>Why:</b> ' + esc(why) + '</div></div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">' +
        (shower ? '<div style="padding:8px 14px;border-radius:999px;background:' + T.orange + ';color:#1a1206;font-weight:600">Shower hold active</div>' : '') +
        (this.s(E.lightHold) === 'on' ? '<div style="padding:8px 14px;border-radius:999px;border:1px solid ' + T.blue + ';color:' + T.blue + ';font-weight:600">Light held</div>' : '') +
        '<div class="mono" style="padding:8px 14px;border-radius:999px;border:1px solid ' + T.line + ';font-size:13px">Hue: ' + esc(bulbChip) + '</div>' +
        '<div class="mono" style="padding:8px 14px;border-radius:999px;border:1px ' + (V.sb.mismatch ? 'dashed ' + T.orange + ';color:' + T.orange : 'solid ' + T.line) + ';font-size:13px">Fan + lights: ' + esc(sbChip) + '</div></div></div>' +
        '<div class="panel"><div class="row"><h2 style="font-size:16px">Floor plan</h2><span class="dim" style="font-size:13px">Real layout (room drawer, 125 × 68 in). Click a sensor to inspect it.</span></div><div style="overflow-x:auto"><div style="position:relative;width:' + F.host.w + 'px;height:' + F.host.h + 'px;margin:0 auto">' + plan + legend + '</div></div></div>' +
        '<div class="cols">' +
        '<div class="col" style="flex:1 1 300px"><div class="row"><h2 style="font-size:16px">1 · Inputs</h2><span class="dim" style="font-size:12px">sensors and helpers</span></div>' + INPUTS.map((k) => this.card(V, k)).join('') + '</div>' +
        '<div class="col" style="flex:2 1 420px;gap:16px"><div class="row"><h2 style="font-size:16px">2 · Decision</h2><span class="dim" style="font-size:12px">what the automation believes</span></div>' +
        '<div class="panel" style="padding:16px;gap:8px"><b>States</b>' + statesHtml + '</div><div class="panel" style="padding:16px;gap:8px"><b>What can happen next</b>' + nextHtml + '</div><div class="panel" style="padding:16px;gap:8px"><b>Rules</b>' + rulesHtml + '</div></div>' +
        '<div class="col" style="flex:1 1 280px"><div class="row"><h2 style="font-size:16px">3 · Outputs</h2><span class="dim" style="font-size:12px">what gets switched</span></div>' + OUTPUTS.map((k) => this.card(V, k)).join('') +
        '<div class="panel" style="padding:16px;border-color:' + T.blue + ';margin-top:10px"><div class="cap">Inspecting</div><div style="font-size:18px;font-weight:700">' + esc(sd.name) + '</div><div class="mono dim" style="font-size:13px">' + esc(sd.entity) + '</div>' + field('Reading', sv[0], true) + field('Role right now', roleText[sv[1]] || sv[1]) + field('Detail', sv[2]) + field('What it is for', sd.about) + field('Read by rules', sd.rules, true) + '</div></div>' +
        '</div>' +
        '<div class="panel"><div class="row"><h2 style="font-size:16px">Last 60 seconds</h2><span data-live="cap" style="font-size:13px;color:' + T.orange + '"></span></div><div style="overflow-x:auto"><div data-live="lanes" style="min-width:640px;display:flex;flex-direction:column;gap:8px"></div></div>' +
        '<div class="dim" style="font-size:13px">The orange band starts when the door closes with motion showing and lasts for the window. "Detected" inside it may be the leftover reading of someone who just left, so it is not trusted. Motion still showing when it ends, or fresh motion with the door closed, locks the room.</div></div>' +
        '</div>';
      this._renderLive();
    }

    // Once a second: countdowns and the timeline only (keeps focus and hover intact).
    _renderLive() {
      if (!this._hass || !this.shadowRoot.querySelector('[data-live="lanes"]')) return;
      const left = this.winLeft(), wlen = Number(this.s(E.delay)) || 12;
      const dtxt = left != null ? Math.ceil(left) + ' s left of ' + wlen + ' s' : wlen + ' s · not running';
      this.shadowRoot.querySelectorAll('[data-live="delay"]').forEach((el) => { el.textContent = dtxt; });

      const now = Date.now() / 1000, span = RANGE[1] - RANGE[0];
      const pct = (t) => Math.min(100, Math.max(0, ((t - now) - RANGE[0]) / span * 100));
      const spans = (id, on) => {
        const b = this._buf[id] || [], out = [];
        for (let i = 0; i < b.length; i++) {
          if (!on(b[i][1])) continue;
          const end = i + 1 < b.length ? b[i + 1][0] : now;
          if (end >= now + RANGE[0]) out.push([b[i][0], end]);
        }
        return out;
      };
      const L = {
        door: spans(E.door, (s) => s === 'off'),
        pir: spans(E.pir, (s) => s === 'on'),
        win: (() => {
          const w = spans(E.win, (s) => s === 'active');
          if (left == null) return w;
          const last = w[w.length - 1];
          if (last && last[1] >= now - 1) last[1] = now + left;
          else w.push([now + left - wlen, now + left]); // running but not in history yet
          return w;
        })(),
        shower: spans(E.shower, (s) => s === 'on'),
      };
      const lanes = LANES.map((l) => '<div style="display:flex;align-items:center;gap:12px"><div class="dim" style="flex:none;width:170px;font-size:13px">' + l.label + '</div><div style="position:relative;flex:1;height:22px;border-radius:6px;background:' + T.bg + ';border:1px solid ' + T.line + ';overflow:hidden">' +
        L[l.key].map((s) => '<div class="abs" style="top:0;bottom:0;left:' + pct(s[0]) + '%;width:' + (pct(s[1]) - pct(s[0])) + '%;background:' + l.color + ';opacity:' + l.opacity + '"></div>').join('') +
        '<div class="abs" style="top:0;bottom:0;left:' + pct(now) + '%;width:2px;background:' + T.text + '"></div></div></div>').join('') +
        '<div style="display:flex;gap:12px"><div style="flex:none;width:170px"></div><div class="mono dim" style="position:relative;flex:1;height:18px;font-size:12px"><span class="abs" style="left:0">' + RANGE[0] + ' s</span><span class="abs" style="left:' + pct(now) + '%;transform:translateX(-50%);color:' + T.text + '">now</span><span class="abs" style="right:0">+' + RANGE[1] + ' s</span></div></div>';
      this.shadowRoot.querySelector('[data-live="lanes"]').innerHTML = lanes;

      const rule = this.s(E.rule), occ = this.st(E.occ), ago = occ ? now - new Date(occ.last_changed).getTime() / 1000 : 0;
      let cap = '';
      if (left != null) cap = 'Untrusted window: ' + Math.ceil(left) + ' s left';
      else if (rule === 'R2c' && ago < 600) cap = 'Motion cleared inside the window → not trusted (' + dur(ago) + ' ago)';
      else if (rule === 'R3' && ago < 600) cap = 'Motion outlasted the window → locked (' + dur(ago) + ' ago)';
      else if (!this._hist) cap = this._histErr ? 'History unavailable: ' + this._histErr : 'Loading history…';
      this.shadowRoot.querySelector('[data-live="cap"]').textContent = cap;
    }
  }

  const CSS = `
:host{display:block}
*{box-sizing:border-box}
.page{background:${T.bg};color:${T.text};font:14px/1.45 Inter,system-ui,sans-serif;max-width:1360px;margin:0 auto;padding:32px;display:flex;flex-direction:column;gap:20px;border-radius:12px}
button{font:inherit;color:inherit;cursor:pointer;background:none}
button:focus-visible{outline:2px solid #fff;outline-offset:2px}
h1,h2{margin:0}
.cap{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${T.dim}}
.dim{color:${T.dim}}.mono{font-family:'JetBrains Mono',ui-monospace,monospace}
.panel{background:${T.panel};border:1px solid ${T.line};border-radius:12px;padding:16px 20px;display:flex;flex-direction:column;gap:10px}
.row{display:flex;flex-wrap:wrap;gap:8px;align-items:baseline;justify-content:space-between}
.cols{display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start}
.col{min-width:0;display:flex;flex-direction:column;gap:10px}
.card{text-align:left;min-height:44px;display:flex;flex-direction:column;gap:4px;padding:12px 14px;border-radius:12px;transition:border-color .15s ease-out,background .15s ease-out}
.badge{padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
.pin{position:absolute;height:44px;padding:4px 10px;display:flex;flex-direction:column;justify-content:center;text-align:left;transition:border-color .15s ease-out,background .15s ease-out}
.pin span{font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.abs{position:absolute}
.key{display:flex;align-items:center;gap:8px}
.sw{flex:none;width:26px;height:14px}
@media (prefers-reduced-motion: reduce){.card,.pin{transition:none}}
@media (max-width:700px){.page{padding:16px}}
`;

  if (!customElements.get('bathroom-wasp-card')) customElements.define('bathroom-wasp-card', BathroomWaspCard);
  window.customCards = window.customCards || [];
  window.customCards.push({ type: 'bathroom-wasp-card', name: 'Bathroom wasp-in-a-box debug', description: 'Live debug view of the bathroom v3 automation.' });
})();
