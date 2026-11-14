/* Office lights debug card.
 *
 * Same visual language as bathroom-wasp-card.js. Layout from data/rooms/office.json
 * (160 × 124 in). It renders published HA state only; it does not decide occupancy.
 *
 * Usage:  type: custom:office-wasp-card   (best in a panel view)
 */
(() => {
  const T = {
    bg: '#0f1318', panel: '#171c23', line: '#2f3945', text: '#e8edf2', dim: '#9aa7b4',
    blue: '#6cb0ff', blueFill: '#152234', orange: '#ffb057', ink: '#0b1420',
  };
  const C = { dim: T.dim, blue: T.blue, orange: T.orange, text: T.text };

  const E = {
    presence: 'input_select.office_presence_state',
    radar: 'binary_sensor.office_presence_radar',
    floor: 'binary_sensor.everything_presence_lite_cadb3c_zone_3_occupancy',
    matt: 'binary_sensor.everything_presence_lite_cadb3c_zone_1_occupancy',
    mara: 'binary_sensor.sonoff_mmwave_occupancy',
    motion: 'binary_sensor.office_camera_motion_detected',
    answer: 'input_select.office_ai_last_answer',
    reason: 'input_text.office_ai_last_reason',
    source: 'input_text.office_ai_last_source',
    streak: 'counter.office_vision_absent_streak',
    need: 'input_number.office_vision_absences_required',
    poll: 'input_number.office_vision_poll_seconds',
    visionOn: 'input_boolean.office_vision_enabled',
    autoOff: 'input_boolean.office_lights_auto_off',
    radarAuto: 'automation.office_lights_by_radar',
    visionPoll: 'automation.office_vision_poll',
    l1: 'light.office_light_1',
    l2: 'light.office_light_2',
    l3: 'light.office_light_3',
    l4: 'light.office_light_4',
    camera: 'binary_sensor.office_camera_online',
  };

  const DEV = {
    radar: { name: 'Radar (combined)', entity: E.radar, about: 'OR of office floor, Matt\'s desk, and Mara\'s Sonoff. Either seeing someone turns the lights on; 5 min with nobody turns them off.', rules: 'R1 R2 R3' },
    floor: { name: 'Office floor', entity: E.floor, about: 'Everything Presence Lite zone 3: the room as a whole.', rules: 'R1' },
    matt: { name: 'Matt\'s desk', entity: E.matt, about: 'Everything Presence Lite zone 1.', rules: 'R1' },
    mara: { name: 'Mara\'s desk', entity: E.mara, about: 'Sonoff mmWave on the south wall, aimed at Mara\'s desk.', rules: 'R1' },
    motion: { name: 'Camera motion', entity: E.motion, about: 'Amcrest motion. Sets presence to motion and starts vision checks while the lights are on.', rules: 'R4 R5' },
    answer: { name: 'Vision answer', entity: E.answer, about: 'Last classifier result. Empty answers count toward lights-off only if not a reused frame.', rules: 'R5 R6' },
    streak: { name: 'Empty streak', entity: E.streak, about: 'Valid empty vision checks in a row. Lights off when this reaches the required count and radar + camera motion are both off.', rules: 'R6' },
    autoOff: { name: 'Auto-off flag', entity: E.autoOff, about: 'On = the automation last turned the lights off. Off = a person turned them off, which blocks radar-on for 30 min.', rules: 'R3 R7' },
    l1: { name: 'Office light 1', entity: E.l1, about: 'Hue bulb. Automations switch all four together.', rules: 'R1 R2 R6 R7' },
    l2: { name: 'Office light 2', entity: E.l2, about: 'Hue bulb.', rules: 'R1 R2' },
    l3: { name: 'Office light 3', entity: E.l3, about: 'Hue bulb.', rules: 'R1 R2' },
    l4: { name: 'Office light 4', entity: E.l4, about: 'Hue bulb.', rules: 'R1 R2' },
  };
  const INPUTS = ['radar', 'floor', 'matt', 'mara', 'motion', 'answer', 'streak', 'autoOff'];
  const OUTPUTS = ['l1', 'l2', 'l3', 'l4'];

  const STATES = [
    { id: 'motion', name: 'Motion', desc: 'Camera just saw movement; vision has not confirmed yet', color: 'blue' },
    { id: 'vision_present', name: 'Vision · present', desc: 'Classifier saw a person', color: 'blue' },
    { id: 'vision_absent', name: 'Vision · empty', desc: 'Enough empty checks; lights were turned off', color: 'dim' },
    { id: 'unknown', name: 'Unknown', desc: 'Last vision check failed; lights are not changed for this', color: 'orange' },
  ];

  const RULES = [
    ['R1', 'Radar on (floor, Matt, or Mara): lights on, if they have been off 20 s and the 30 min manual-off hold is clear.'],
    ['R2', 'Radar off for 5 min: lights off, and the auto-off flag is set.'],
    ['R3', 'Manual off sticks for 30 min. Auto-off does not: radar can turn them back on after 20 s.'],
    ['R4', 'Camera motion while lights are on: presence = motion, empty streak resets.'],
    ['R5', 'While lights are on and motion is off, vision rechecks every poll interval.'],
    ['R6', 'Enough valid empty vision answers, with radar and camera motion both off: lights off.'],
    ['R7', 'Camera motion while lights are off: backup AI snapshots can turn them on (radar is the primary on-path).'],
  ];

  // office.json: 160 × 124 in, y down. Scale 5 px/in.
  const S = 5, OX = 48, OY = 36;
  const X = (i) => Math.round(OX + i * S), Y = (i) => Math.round(OY + i * S);
  const pts = (arr) => arr.map(([x, y]) => X(x) + ',' + Y(y)).join(' ');
  const F = {
    host: { w: 1120, h: 720 },
    room: pts([[0, 0], [160, 0], [160, 124], [0, 124]]),
    matt: pts([[0, 24], [54, 24], [54, 108], [0, 108]]),
    mara: pts([[96, 66], [159, 66], [159, 123], [96, 123]]),
    ignore: pts([[0, 84], [27, 84], [27, 120], [0, 120]]),
    doors: [
      { a: [117, 0], b: [144, 0] },
      { a: [6, 6], b: [33, 3] },
      { a: [39, 124], b: [114, 124] },
    ],
    sensor: { x: X(3), y: Y(6), facing: 145, fov: 120, range: 90 },
    lights: [
      { id: 'l1', x: X(55), y: Y(40) },
      { id: 'l2', x: X(105), y: Y(40) },
      { id: 'l3', x: X(55), y: Y(85) },
      { id: 'l4', x: X(105), y: Y(85) },
    ],
    pins: [
      { id: 'radar', label: 'Radar', x: 70, y: 48, w: 168 },
      { id: 'floor', label: 'Office floor', x: 70, y: 320, w: 168 },
      { id: 'matt', label: "Matt's desk", x: 70, y: 200, w: 168 },
      { id: 'mara', label: "Mara's desk", x: 620, y: 430, w: 168 },
      { id: 'motion', label: 'Camera motion', x: 430, y: 48, w: 180 },
      { id: 'answer', label: 'Vision', x: 430, y: 100, w: 180 },
      { id: 'autoOff', label: 'Auto-off flag', x: 620, y: 48, w: 180 },
      { id: 'streak', label: 'Empty streak', x: 620, y: 100, w: 180 },
    ],
    legend: { x: 870, y: 36, w: 230 },
  };

  const LANES = [
    { key: 'radar', label: 'Radar present', color: T.blue, opacity: 1, id: E.radar, on: 'on' },
    { key: 'motion', label: 'Camera motion', color: '#cfd6de', opacity: 0.85, id: E.motion, on: 'on' },
    { key: 'vision', label: 'Vision: person', color: T.orange, opacity: 0.7, id: E.answer, on: 'person' },
    { key: 'lights', label: 'Lights on', color: T.blue, opacity: 0.45, id: E.l1, on: 'on' },
  ];
  const RANGE = [-60, 20];
  const BAD = ['unavailable', 'unknown'];

  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const dur = (s) => (s < 90 ? Math.round(s) + ' s' : s < 5400 ? Math.round(s / 60) + ' min' : Math.round(s / 3600) + ' h');

  class OfficeWaspCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this._sel = null;
      this._buf = {};
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
    connectedCallback() { this._tick = setInterval(() => this._renderLive(), 1000); }
    disconnectedCallback() { clearInterval(this._tick); }

    set hass(hass) {
      const first = !this._hass;
      this._hass = hass;
      this._record();
      if (first) this._loadHistory();
      const sig = this._signature();
      if (sig !== this._sig) { this._sig = sig; this._render(); }
    }

    _signature() {
      return Object.values(E).map((id) => {
        const s = this._hass.states[id];
        return s ? s.state + '|' + s.last_updated : '-';
      }).join(',');
    }

    st(id) { return this._hass && this._hass.states[id]; }
    s(id) { const x = this.st(id); return x ? x.state : 'unavailable'; }

    lightsOn() {
      return [E.l1, E.l2, E.l3, E.l4].some((id) => this.s(id) === 'on');
    }
    lightsOffSecs() {
      const times = [E.l1, E.l2, E.l3, E.l4].map((id) => {
        const x = this.st(id);
        return x ? (Date.now() - new Date(x.last_changed).getTime()) / 1000 : 0;
      });
      return Math.min(...times);
    }

    async _loadHistory() {
      const ids = LANES.map((l) => l.id);
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
      for (const l of LANES) {
        const s = this.st(l.id);
        if (!s) continue;
        const t = new Date(s.last_changed).getTime() / 1000;
        const b = this._buf[l.id] || (this._buf[l.id] = []);
        const last = b[b.length - 1];
        if (!last || last[1] !== s.state) b.push([t, s.state]);
        const cut = Date.now() / 1000 - 600;
        while (b.length > 2 && b[1][0] < cut) b.shift();
      }
    }

    roles() {
      const radar = this.s(E.radar) === 'on';
      const motion = this.s(E.motion) === 'on';
      const vis = this.s(E.presence);
      return {
        radar: radar ? 'driving' : 'watching',
        floor: this.s(E.floor) === 'on' ? 'driving' : 'watching',
        matt: this.s(E.matt) === 'on' ? 'driving' : 'watching',
        mara: this.s(E.mara) === 'on' ? 'driving' : 'watching',
        motion: motion ? 'driving' : 'watching',
        answer: vis === 'vision_present' || vis === 'vision_absent' ? 'driving' : 'watching',
        streak: vis === 'vision_present' || this.s(E.streak) !== '0' ? 'watching' : 'watching',
        autoOff: this.s(E.autoOff) === 'on' ? 'watching' : (this.lightsOn() ? 'watching' : 'driving'),
      };
    }

    why() {
      const radar = this.s(E.radar) === 'on';
      const on = this.lightsOn();
      const auto = this.s(E.autoOff) === 'on';
      const vis = this.s(E.presence);
      const reason = this.s(E.reason);
      if (on && radar) return 'Radar sees someone, so the lights stay on.';
      if (on && vis === 'vision_present') return 'Vision confirmed a person: ' + reason + '.';
      if (on && this.s(E.motion) === 'on') return 'Camera motion is on; vision has not confirmed empty.';
      if (on) return 'Lights are on. Radar is clear; they go off after 5 min empty, or after enough empty vision checks.';
      if (!auto && this.lightsOffSecs() < 1800) {
        const left = 1800 - this.lightsOffSecs();
        return 'Turned off by hand. Radar cannot turn them on for another ' + dur(left) + '.';
      }
      return 'Armed: radar seeing someone turns the lights on.';
    }

    values() {
      const roles = this.roles();
      const age = (id) => { const x = this.st(id); return x ? (Date.now() - new Date(x.last_changed).getTime()) / 1000 : 0; };
      const bin = (id, onWord, offWord) => {
        const v = this.s(id);
        if (BAD.includes(v)) return 'Unavailable';
        return v === 'on' ? onWord : offWord;
      };
      const V = {};
      V.radar = [bin(E.radar, 'Present', 'Empty'), roles.radar, (this.s(E.radar) === 'on' ? 'Present' : 'Empty') + ' for ' + dur(age(E.radar)) + '.'];
      V.floor = [bin(E.floor, 'Occupied', 'Empty'), roles.floor, 'Zone 3, EP Lite.'];
      V.matt = [bin(E.matt, 'Occupied', 'Empty'), roles.matt, 'Zone 1, EP Lite.'];
      V.mara = [bin(E.mara, 'Occupied', 'Empty'), roles.mara, 'Sonoff mmWave.'];
      V.motion = [bin(E.motion, 'Motion', 'Clear'), roles.motion, (this.s(E.motion) === 'on' ? 'Motion' : 'Clear') + ' for ' + dur(age(E.motion)) + '.'];
      V.answer = [this.s(E.answer), roles.answer, this.s(E.reason) + ' · ' + this.s(E.source) + '.'];
      V.streak = [this.s(E.streak) + ' of ' + Number(this.s(E.need) || 7), roles.streak, 'Valid empty checks. Poll every ' + Number(this.s(E.poll) || 30) + ' s. Vision ' + (this.s(E.visionOn) === 'on' ? 'on' : 'off') + '.'];
      V.autoOff = [this.s(E.autoOff) === 'on' ? 'Auto last off' : 'Person last off', roles.autoOff, this.s(E.autoOff) === 'on' ? 'Radar may turn lights back on after 20 s.' : '30 min hold after a manual off.'];
      for (const id of ['l1', 'l2', 'l3', 'l4']) {
        const ent = E[id], st = this.st(ent);
        let txt = 'Unavailable', role = 'unavailable';
        if (st && st.state === 'on') { txt = 'On · ' + Math.round((st.attributes.brightness || 0) / 2.55) + ' %'; role = 'on'; }
        else if (st && st.state === 'off') { txt = 'Off'; role = 'off'; }
        V[id] = [txt, role, 'Switched with the other three office bulbs.'];
      }
      for (const k of INPUTS) if (V[k][0] === 'Unavailable') V[k][1] = 'unavailable';
      return V;
    }

    look(V, id) {
      const role = V[id][1], o = { bg: T.panel, border: T.line, bs: 'solid', name: T.text, value: T.text, role };
      if (role === 'driving' || role === 'on') { o.bg = T.blueFill; o.border = T.blue; o.value = T.blue; }
      if (role === 'ignored' || role === 'unavailable') { o.bs = 'dashed'; o.border = T.dim; o.name = T.dim; o.value = T.dim; }
      o.ring = id === this._sel ? '0 0 0 2px ' + T.bg + ', 0 0 0 4px ' + T.text : '';
      o.glow = role === 'on' ? '0 0 22px 4px rgba(108,176,255,0.5)' : '';
      return o;
    }

    card(V, id) {
      const d = DEV[id], v = V[id], L = this.look(V, id), strong = L.role === 'driving' || L.role === 'on';
      return '<button type="button" class="card" data-sel="' + id + '" title="' + esc(d.about) + '" style="background:' + L.bg + ';border:2px ' + L.bs + ' ' + L.border + ';box-shadow:' + (L.ring || 'none') + '">' +
        '<span style="display:flex;justify-content:space-between;gap:8px;align-items:center"><span style="font-weight:600;color:' + L.name + '">' + esc(d.name) + '</span>' +
        '<span class="badge" style="background:' + (strong ? T.blue : 'transparent') + ';color:' + (strong ? T.ink : T.dim) + ';border:1px solid ' + (strong ? T.blue : T.dim) + '">' + esc(L.role) + '</span></span>' +
        '<span class="mono" style="font-size:15px;font-weight:600;color:' + L.value + '">' + esc(v[0]) + '</span>' +
        '<span class="dim" style="font-size:12px">' + esc(v[2]) + '</span></button>';
    }

    rulesNow() {
      const radar = this.s(E.radar) === 'on';
      const on = this.lightsOn();
      const auto = this.s(E.autoOff) === 'on';
      const visOn = this.s(E.visionOn) === 'on';
      return {
        R1: radar && on ? 'active' : 'armed',
        R2: !radar && on ? 'armed' : (!radar && !on ? 'idle' : 'idle'),
        R3: !on && !auto ? 'active' : 'armed',
        R4: this.s(E.motion) === 'on' ? 'active' : 'armed',
        R5: visOn && on && this.s(E.motion) === 'off' ? 'active' : (visOn ? 'armed' : 'idle'),
        R6: Number(this.s(E.streak) || 0) > 0 ? 'armed' : 'idle',
        R7: !on && this.s(E.motion) === 'on' ? 'active' : 'armed',
      };
    }

    nextNow() {
      const radar = this.s(E.radar) === 'on';
      const on = this.lightsOn();
      const auto = this.s(E.autoOff) === 'on';
      if (on && radar) return [['radar stays on', 'Lights stay on'], ['radar clear for 5 min', 'Lights off (auto-off flag set)'], ['enough empty vision checks and radar off', 'Lights off']];
      if (on) return [['radar sees someone', 'Lights stay on'], ['5 min with radar empty', 'Lights off'], ['empty vision streak reaches the required count', 'Lights off']];
      if (!auto && this.lightsOffSecs() < 1800) return [['wait out the 30 min hold', 'Radar can turn lights on'], ['set auto-off by turning them off from the automation', 'Radar unblocked after 20 s']];
      return [['radar sees someone', 'Lights on'], ['camera motion + vision person', 'Lights on (backup)']];
    }

    _render() {
      if (!this._hass) return;
      const V = this.values();
      const occ = this.s(E.presence);
      const stateDef = STATES.find((x) => x.id === occ) || { id: occ, name: occ, desc: '', color: 'dim' };
      const sc = C[stateDef.color];
      const rules = this.rulesNow(), next = this.nextNow();
      if (!this._sel) this._sel = INPUTS.find((k) => V[k][1] === 'driving') || 'radar';
      const occAge = this.st(E.presence) ? (Date.now() - new Date(this.st(E.presence).last_changed).getTime()) / 1000 : 0;
      const onN = [E.l1, E.l2, E.l3, E.l4].filter((id) => this.s(id) === 'on').length;

      const roomFill = this.s(E.floor) === 'on' ? '#121b27' : '#12161c';
      const roomStroke = this.s(E.radar) === 'on' ? T.blue : T.dim;
      const wedge = (() => {
        const p = F.sensor, rad = p.facing * Math.PI / 180, half = (p.fov / 2) * Math.PI / 180;
        const a1 = rad - half, a2 = rad + half;
        const x1 = p.x + Math.sin(a1) * p.range * S, y1 = p.y + Math.cos(a1) * p.range * S;
        const x2 = p.x + Math.sin(a2) * p.range * S, y2 = p.y + Math.cos(a2) * p.range * S;
        return 'M ' + p.x + ' ' + p.y + ' L ' + x1 + ' ' + y1 + ' A ' + (p.range * S) + ' ' + (p.range * S) + ' 0 0 0 ' + x2 + ' ' + y2 + ' Z';
      })();
      const zoneFill = (on) => on ? 'rgba(108,176,255,0.22)' : 'rgba(47,57,69,0.35)';
      const zoneStroke = (on) => on ? T.blue : T.line;
      const lightsSvg = F.lights.map((l) => {
        const on = V[l.id][1] === 'on';
        return '<circle cx="' + l.x + '" cy="' + l.y + '" r="16" fill="' + (on ? T.blue : 'transparent') + '" fill-opacity="' + (on ? 0.35 : 0) + '" stroke="' + (on ? T.blue : T.line) + '" stroke-width="2"/>' +
          '<text x="' + l.x + '" y="' + (l.y + 4) + '" text-anchor="middle" font-size="10" fill="' + (on ? T.blue : T.dim) + '">' + l.id.slice(1) + '</text>';
      }).join('');
      const doorsSvg = F.doors.map((d) => '<line x1="' + X(d.a[0]) + '" y1="' + Y(d.a[1]) + '" x2="' + X(d.b[0]) + '" y2="' + Y(d.b[1]) + '" stroke="' + T.text + '" stroke-width="8" stroke-linecap="round"/>').join('');
      const planSvg = '<svg width="' + F.host.w + '" height="' + F.host.h + '" xmlns="http://www.w3.org/2000/svg">' +
        '<polygon points="' + F.room + '" fill="' + roomFill + '" stroke="' + roomStroke + '" stroke-width="4"/>' +
        '<path d="' + wedge + '" fill="rgba(108,176,255,0.08)" stroke="' + T.blue + '" stroke-width="1" stroke-dasharray="4 4"/>' +
        '<polygon points="' + F.matt + '" fill="' + zoneFill(this.s(E.matt) === 'on') + '" stroke="' + zoneStroke(this.s(E.matt) === 'on') + '" stroke-width="2"/>' +
        '<polygon points="' + F.mara + '" fill="' + zoneFill(this.s(E.mara) === 'on') + '" stroke="' + zoneStroke(this.s(E.mara) === 'on') + '" stroke-width="2"/>' +
        '<polygon points="' + F.ignore + '" fill="rgba(154,167,180,0.12)" stroke="' + T.dim + '" stroke-width="1" stroke-dasharray="4 3"/>' +
        doorsSvg + lightsSvg +
        '<circle cx="' + F.sensor.x + '" cy="' + F.sensor.y + '" r="7" fill="' + T.blue + '"/>' +
        '<text x="' + X(8) + '" y="' + Y(20) + '" font-size="12" fill="' + T.dim + '" font-family="Inter,system-ui,sans-serif">EP Lite</text>' +
        '<text x="' + X(10) + '" y="' + Y(70) + '" font-size="12" fill="' + T.dim + '" font-family="Inter,system-ui,sans-serif">Matt desk</text>' +
        '<text x="' + X(108) + '" y="' + Y(92) + '" font-size="12" fill="' + T.dim + '" font-family="Inter,system-ui,sans-serif">Mara desk</text>' +
        '<text x="' + X(4) + '" y="' + Y(100) + '" font-size="11" fill="' + T.dim + '" font-family="Inter,system-ui,sans-serif">ignore</text>' +
        '</svg>';

      const pins = F.pins.map((p) => {
        const v = V[p.id], L = this.look(V, p.id);
        const sh = [L.ring, L.glow].filter(Boolean).join(', ') || 'none';
        return '<button type="button" class="pin" data-sel="' + p.id + '" title="' + esc(DEV[p.id].about) + '" style="left:' + p.x + 'px;top:' + p.y + 'px;width:' + p.w + 'px;border-radius:10px;background:' + L.bg + ';border:2px ' + L.bs + ' ' + L.border + ';box-shadow:' + sh + '">' +
          '<span style="font-weight:600;color:' + L.name + '">' + esc(p.label) + '</span><span class="mono" style="color:' + L.value + '">' + esc(v[0]) + '</span></button>';
      }).join('');

      const key = (style, text) => '<div class="key"><span class="sw" style="' + style + '"></span><span>' + text + '</span></div>';
      const legend = '<div class="abs" style="left:' + F.legend.x + 'px;top:' + F.legend.y + 'px;width:' + F.legend.w + 'px;display:flex;flex-direction:column;gap:8px;font-size:12px">' +
        '<div class="cap" style="font-size:11px">Room now</div><div style="font-size:18px;font-weight:700;color:' + sc + '">' + esc(stateDef.name) + '</div>' +
        '<b style="margin-top:6px">Radar zones</b>' +
        key('border:2px solid ' + T.blue + ';background:rgba(108,176,255,0.3)', 'Blue fill: occupied') +
        key('border:2px solid ' + T.line, 'Grey: empty') +
        key('border:1px dashed ' + T.dim, 'Dashed: ignore area') +
        '<b style="margin-top:6px">Lights</b>' +
        key('border-radius:50%;border:2px solid ' + T.blue + ';background:rgba(108,176,255,0.4)', 'Glow: on') +
        key('border-radius:50%;border:2px solid ' + T.line, 'Ring: off') +
        '<div class="dim" style="margin-top:6px">Layout from office.json (160 × 124 in). Light positions are a 2×2 guess until they are drawn in the room drawer.</div></div>';

      const statesHtml = STATES.map((x) => {
        const now = x.id === occ, c = C[x.color];
        const st = now ? 'background:' + c + ';border:2px solid ' + c + ';color:' + T.ink : 'border:2px solid ' + T.line + ';color:' + T.dim;
        return '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 12px;border-radius:10px;' + st + '"><span><b>' + esc(x.name) + '</b><br><span style="font-size:12px;opacity:.8">' + esc(x.desc) + '</span></span>' +
          '<span style="flex:none;font-size:11px;font-weight:700;text-transform:uppercase">' + (now ? 'now' : '') + '</span></div>';
      }).join('');
      const nextHtml = next.map((n) => '<div style="display:flex;flex-wrap:wrap;gap:6px 12px;padding:10px 12px;border-radius:10px;background:' + T.bg + ';border:1px solid ' + T.line + '"><span style="flex:1 1 200px"><span class="dim">If </span>' + esc(n[0]) + '</span><b style="flex:1 1 200px;color:' + T.blue + '">→ ' + esc(n[1]) + '</b></div>').join('');
      const rulesHtml = RULES.map(([id, text]) => {
        const s = rules[id] || 'idle';
        const st = s === 'active' ? 'border:1px solid ' + T.blue + ';background:' + T.blueFill : s === 'armed' ? 'border:1px dashed ' + T.dim : 'border:1px solid ' + T.line + ';color:' + T.dim;
        const fg = s === 'active' ? T.blue : s === 'armed' ? T.text : T.dim;
        return '<div style="display:flex;gap:12px;padding:10px 12px;border-radius:10px;' + st + '"><b class="mono" style="flex:none;color:' + fg + '">' + id + '</b><span style="flex:1">' + esc(text) + '</span><span style="flex:none;font-size:11px;font-weight:700;text-transform:uppercase;color:' + fg + '">' + s + '</span></div>';
      }).join('');

      const sd = DEV[this._sel], sv = V[this._sel];
      const roleText = { driving: 'Driving. It is deciding the result right now.', watching: 'Watching. Read, but not deciding anything now.', ignored: 'Ignored.', unavailable: 'Unavailable.', on: 'On.', off: 'Off.' };
      const field = (label, value, mono) => '<div><div class="dim" style="font-size:12px">' + label + '</div><div' + (mono ? ' class="mono"' : '') + '>' + esc(value) + '</div></div>';

      this.shadowRoot.innerHTML = '<style>' + CSS + '</style><div class="page">' +
        '<div class="row" style="align-items:flex-end"><div><div class="cap">Office · debug view</div><h1 style="font-size:28px">Radar, vision, lights</h1></div><div class="dim" style="font-size:13px;max-width:460px">Live. Radar turns lights on and off. Vision is the backup that can turn them off after enough empty checks. Click any card or pin to inspect it.</div></div>' +
        '<div aria-live="polite" style="display:flex;flex-wrap:wrap;gap:20px;align-items:center;justify-content:space-between;background:' + T.panel + ';border:2px solid ' + sc + ';border-radius:14px;padding:20px 24px"><div style="flex:1 1 420px"><div class="cap">Presence now · ' + esc(occ) + ' · ' + dur(occAge) + ' ago</div><div style="font-size:30px;font-weight:700;color:' + sc + '">' + esc(stateDef.name) + '</div><div style="font-size:15px"><b>Why:</b> ' + esc(this.why()) + '</div></div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">' +
        (this.s(E.radar) === 'on' ? '<div style="padding:8px 14px;border-radius:999px;background:' + T.orange + ';color:#1a1206;font-weight:600">Radar hold</div>' : '') +
        (this.lightsOn() ? '<div style="padding:8px 14px;border-radius:999px;border:1px solid ' + T.blue + ';color:' + T.blue + ';font-weight:600">Lights ' + onN + '/4 on</div>' : '<div style="padding:8px 14px;border-radius:999px;border:1px solid ' + T.line + ';font-weight:600">Lights off</div>') +
        '<div class="mono" style="padding:8px 14px;border-radius:999px;border:1px solid ' + T.line + ';font-size:13px">Vision: ' + esc(this.s(E.answer)) + '</div></div></div>' +
        '<div class="panel"><div class="row"><h2 style="font-size:16px">Floor plan</h2><span class="dim" style="font-size:13px">From room drawer office.json. Zones light up from the live radar entities.</span></div><div style="overflow-x:auto"><div style="position:relative;width:' + F.host.w + 'px;height:' + F.host.h + 'px;margin:0 auto">' + planSvg + pins + legend + '</div></div></div>' +
        '<div class="cols">' +
        '<div class="col" style="flex:1 1 300px"><div class="row"><h2 style="font-size:16px">1 · Inputs</h2><span class="dim" style="font-size:12px">radar, camera, vision</span></div>' + INPUTS.map((k) => this.card(V, k)).join('') + '</div>' +
        '<div class="col" style="flex:2 1 420px;gap:16px"><div class="row"><h2 style="font-size:16px">2 · Decision</h2><span class="dim" style="font-size:12px">what the automations believe</span></div>' +
        '<div class="panel" style="padding:16px;gap:8px"><b>Presence state</b>' + statesHtml + '</div><div class="panel" style="padding:16px;gap:8px"><b>What can happen next</b>' + nextHtml + '</div><div class="panel" style="padding:16px;gap:8px"><b>Rules</b>' + rulesHtml + '</div></div>' +
        '<div class="col" style="flex:1 1 280px"><div class="row"><h2 style="font-size:16px">3 · Outputs</h2><span class="dim" style="font-size:12px">the four Hue bulbs</span></div>' + OUTPUTS.map((k) => this.card(V, k)).join('') +
        '<div class="panel" style="padding:16px;border-color:' + T.blue + ';margin-top:10px"><div class="cap">Inspecting</div><div style="font-size:18px;font-weight:700">' + esc(sd.name) + '</div><div class="mono dim" style="font-size:13px">' + esc(sd.entity) + '</div>' + field('Reading', sv[0], true) + field('Role right now', roleText[sv[1]] || sv[1]) + field('Detail', sv[2]) + field('What it is for', sd.about) + field('Read by rules', sd.rules, true) + '</div></div>' +
        '</div>' +
        '<div class="panel"><div class="row"><h2 style="font-size:16px">Last 60 seconds</h2><span data-live="cap" style="font-size:13px;color:' + T.orange + '"></span></div><div style="overflow-x:auto"><div data-live="lanes" style="min-width:640px;display:flex;flex-direction:column;gap:8px"></div></div>' +
        '<div class="dim" style="font-size:13px">Radar is the occupancy that holds the lights. Vision only turns them off after enough empty checks, and only if radar and camera motion are both clear.</div></div>' +
        '</div>';
      this._renderLive();
    }

    _renderLive() {
      if (!this._hass || !this.shadowRoot.querySelector('[data-live="lanes"]')) return;
      const now = Date.now() / 1000, span = RANGE[1] - RANGE[0];
      const pct = (t) => Math.min(100, Math.max(0, ((t - now) - RANGE[0]) / span * 100));
      const spans = (id, want) => {
        const b = this._buf[id] || [], out = [];
        for (let i = 0; i < b.length; i++) {
          if (b[i][1] !== want) continue;
          const end = i + 1 < b.length ? b[i + 1][0] : now;
          if (end >= now + RANGE[0]) out.push([b[i][0], end]);
        }
        return out;
      };
      const lanes = LANES.map((l) => '<div style="display:flex;align-items:center;gap:12px"><div class="dim" style="flex:none;width:170px;font-size:13px">' + l.label + '</div><div style="position:relative;flex:1;height:22px;border-radius:6px;background:' + T.bg + ';border:1px solid ' + T.line + ';overflow:hidden">' +
        spans(l.id, l.on).map((s) => '<div class="abs" style="top:0;bottom:0;left:' + pct(s[0]) + '%;width:' + (pct(s[1]) - pct(s[0])) + '%;background:' + l.color + ';opacity:' + l.opacity + '"></div>').join('') +
        '<div class="abs" style="top:0;bottom:0;left:' + pct(now) + '%;width:2px;background:' + T.text + '"></div></div></div>').join('') +
        '<div style="display:flex;gap:12px"><div style="flex:none;width:170px"></div><div class="mono dim" style="position:relative;flex:1;height:18px;font-size:12px"><span class="abs" style="left:0">' + RANGE[0] + ' s</span><span class="abs" style="left:' + pct(now) + '%;transform:translateX(-50%);color:' + T.text + '">now</span><span class="abs" style="right:0">+' + RANGE[1] + ' s</span></div></div>';
      this.shadowRoot.querySelector('[data-live="lanes"]').innerHTML = lanes;
      this.shadowRoot.querySelector('[data-live="cap"]').textContent = this._hist ? '' : (this._histErr ? 'History unavailable: ' + this._histErr : 'Loading history…');
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
.pin{position:absolute;height:44px;padding:4px 10px;display:flex;flex-direction:column;justify-content:center;text-align:left;z-index:2;transition:border-color .15s ease-out,background .15s ease-out}
.pin span{font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.abs{position:absolute}
.key{display:flex;align-items:center;gap:8px}
.sw{flex:none;width:26px;height:14px}
@media (prefers-reduced-motion: reduce){.card,.pin{transition:none}}
@media (max-width:700px){.page{padding:16px}}
`;

  if (!customElements.get('office-wasp-card')) customElements.define('office-wasp-card', OfficeWaspCard);
  window.customCards = window.customCards || [];
  window.customCards.push({ type: 'office-wasp-card', name: 'Office radar/vision debug', description: 'Live debug view of the office light automations.' });
})();
