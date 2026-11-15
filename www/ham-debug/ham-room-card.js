/* Room motion-lights debug card (generic).
 *
 * Same visual language as bathroom-wasp-card.js and office-wasp-card.js, but driven by
 * config, so one card serves every room built from packages/rooms.yaml. It renders
 * published HA state only; it does not decide occupancy.
 *
 * Usage (best in a panel view):
 *   type: custom:ham-room-card
 *   room: living_room                 # helper slug: input_boolean.<room>_occupied, ...
 *   title: Living room
 *   plan: /local/ham-debug/rooms/living-room.json   # room-drawer/2 file, or the object inline
 *   activity: [binary_sensor.x, media_player.y]     # what the occupancy automation reads
 *   lights: [light.a, light.b]                      # what the lights automation switches
 *   sleep: dim                                      # dim | skip, as in the blueprint input
 */
(() => {
  const T = {
    bg: '#0f1318', panel: '#171c23', line: '#2f3945', text: '#e8edf2', dim: '#9aa7b4',
    blue: '#6cb0ff', blueFill: '#152234', orange: '#ffb057', ink: '#0b1420', purple: '#c792ea',
  };
  const BAD = ['unavailable', 'unknown'];
  const ACTIVE = ['on', 'playing'];
  const RANGE = [-900, 60]; // seconds shown on the timeline
  const FONT = 'Inter,system-ui,sans-serif';

  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const dur = (s) => (s < 90 ? Math.max(0, Math.round(s)) + ' s' : s < 5400 ? Math.round(s / 60) + ' min' : Math.round(s / 3600) + ' h');

  class HamRoomCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this._sel = null;
      this._buf = {};
      this._hist = false;
      this.shadowRoot.addEventListener('click', (e) => {
        const b = e.target.closest('[data-sel]');
        if (!b) return;
        this._sel = b.dataset.sel;
        this._render();
      });
    }

    setConfig(config) {
      if (!config || !config.room) throw new Error('ham-room-card: "room" is required');
      const r = config.room;
      this._c = config;
      this.title_ = config.title || r.replace(/_/g, ' ');
      this.activity = config.activity || [];
      this.lights = config.lights || [];
      this.sleepMode = config.sleep === 'skip' ? 'skip' : 'dim';
      this.E = {
        occupied: 'input_boolean.' + r + '_occupied',
        enabled: 'input_boolean.' + r + '_motion_lights',
        hold: 'input_number.' + r + '_vacancy_hold',
        occReason: 'input_text.' + r + '_occupancy_reason',
        lightReason: 'input_text.' + r + '_lights_reason',
        sleep: 'input_boolean.sleep_mode',
        level: 'sensor.house_light_level',
      };
      this._plan = null;
      this._planErr = null;
      if (config.plan && typeof config.plan === 'object') {
        this._plan = config.plan;
      } else if (config.plan) {
        fetch(config.plan, { cache: 'no-cache' })
          .then((res) => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
          .then((p) => { this._plan = p; this._sig = null; this._render(); })
          .catch((err) => { this._planErr = String((err && err.message) || err); this._render(); });
      }
    }

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

    // ── state helpers ──
    st(id) { return this._hass && this._hass.states[id]; }
    s(id) { const x = this.st(id); return x ? x.state : 'unavailable'; }
    age(id) { const x = this.st(id); return x ? (Date.now() - new Date(x.last_changed).getTime()) / 1000 : 0; }
    name(id) { const x = this.st(id); return (x && x.attributes.friendly_name) || id; }

    planDevices() {
      const p = this._plan;
      return p && Array.isArray(p.devices) ? p.devices : [];
    }

    // Every entity the card shows: plan devices first (numbered), then anything the
    // automations use that is not on the plan (for example the TV).
    items() {
      const out = [], seen = new Set();
      this.planDevices().forEach((d, i) => {
        out.push({ n: i + 1, key: 'd' + i, name: d.name || d.entity || d.kind, kind: d.kind || 'other', entity: d.entity || '', dev: d });
        if (d.entity) seen.add(d.entity);
      });
      let n = out.length;
      this.activity.concat(this.lights).forEach((id) => {
        if (seen.has(id)) return;
        seen.add(id);
        n += 1;
        const dom = id.split('.')[0];
        out.push({ n, key: 'x' + n, name: this.name(id), kind: dom === 'light' ? 'light' : dom === 'media_player' ? 'media' : 'motion', entity: id, dev: null });
      });
      return out;
    }

    tracked() {
      const ids = Object.values(this.E).concat(this.activity, this.lights);
      this.planDevices().forEach((d) => { if (d.entity) ids.push(d.entity); });
      return Array.from(new Set(ids));
    }

    _signature() {
      return this.tracked().map((id) => {
        const x = this._hass.states[id];
        return x ? x.state + '|' + x.last_updated : '-';
      }).join(',') + '#' + (this._plan ? 1 : 0) + (this._planErr || '');
    }

    lanes() {
      const L = this.activity.map((id) => ({ id, label: this.name(id), color: '#cfd6de', opacity: 0.85, on: ACTIVE }));
      L.push({ id: this.E.occupied, label: 'Room occupied', color: T.blue, opacity: 1, on: ['on'] });
      this.lights.slice(0, 6).forEach((id) => L.push({ id, label: this.name(id), color: T.orange, opacity: 0.7, on: ['on'] }));
      return L;
    }

    async _loadHistory() {
      const ids = this.lanes().map((l) => l.id);
      if (!ids.length) return;
      const start = new Date(Date.now() + RANGE[0] * 1000).toISOString();
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
        this._histErr = String((err && err.message) || err);
      }
    }

    _record() {
      if (!this._c) return;
      for (const l of this.lanes()) {
        const x = this.st(l.id);
        if (!x) continue;
        const t = new Date(x.last_changed).getTime() / 1000;
        const b = this._buf[l.id] || (this._buf[l.id] = []);
        const last = b[b.length - 1];
        if (!last || last[1] !== x.state) b.push([t, x.state]);
        const cut = Date.now() / 1000 + RANGE[0] - 300;
        while (b.length > 2 && b[1][0] < cut) b.shift();
      }
    }

    // ── what the automations are doing, mirrored for display ──
    model() {
      const E = this.E;
      const active = this.activity.filter((id) => ACTIVE.includes(this.s(id)));
      const occupied = this.s(E.occupied) === 'on';
      const enabled = this.s(E.enabled) === 'on';
      const sleeping = this.s(E.sleep) === 'on';
      const hold = Number(this.s(E.hold));
      const holdMin = Number.isFinite(hold) ? hold : 5;
      const quiet = this.activity.length ? Math.min(...this.activity.map((id) => this.age(id))) : 0;
      const left = Math.max(0, holdMin * 60 - quiet);
      const lightsOn = this.lights.filter((id) => this.s(id) === 'on');
      const level = this.s(E.level);
      return { active, occupied, enabled, sleeping, holdMin, quiet, left, lightsOn, level };
    }

    next(m) {
      const off = m.enabled ? 'Vacant, lights off' : 'Vacant (lights are not touched)';
      if (m.occupied && m.active.length) return [['everything goes quiet for ' + m.holdMin + ' min', off]];
      if (m.occupied) return [['nothing is seen for another ' + dur(m.left), off], ['motion, or a player starts playing', 'The countdown starts over']];
      let on = 'Occupied, lights on at ' + m.level + ' %';
      if (!m.enabled) on = 'Occupied, but lights are not touched (motion lights are switched off)';
      else if (m.sleeping && this.sleepMode === 'skip') on = 'Occupied, lights stay off (sleep mode)';
      else if (m.lightsOn.length) on = 'Occupied, lights left as they are (already on)';
      return [['motion, or a player starts playing', on]];
    }

    rules(m) {
      return [
        ['R1', 'Any activity entity on or playing: the room is occupied.', m.active.length ? 'active' : 'armed'],
        ['R2', 'Everything quiet for ' + m.holdMin + ' min: the room is vacant.', m.occupied && !m.active.length ? 'active' : 'armed'],
        ['R3', 'Vacant to occupied: lights on at the house light level, unless one is already on.', !m.enabled ? 'idle' : 'armed'],
        ['R4', 'Occupied to vacant: lights off.', !m.enabled ? 'idle' : 'armed'],
        ['R5', this.sleepMode === 'skip' ? 'Sleep mode on: the lights stay off.' : 'Sleep mode on: lights come on at 3 %.', m.sleeping ? 'active' : 'idle'],
        ['R6', 'Motion lights switched off: occupancy is still tracked, lights are not touched.', m.enabled ? 'idle' : 'active'],
      ];
    }

    reading(it) {
      if (!it.entity) return ['Not in HA', 'unbound', 'No entity is bound to this device on the plan.'];
      const x = this.st(it.entity), v = this.s(it.entity);
      if (!x || BAD.includes(v)) return ['Unavailable', 'unavailable', 'HA has no reading for it right now.'];
      const dom = it.entity.split('.')[0];
      const since = 'for ' + dur(this.age(it.entity));
      let txt = v, role = 'shown';
      if (dom === 'light') txt = v === 'on' ? 'On · ' + Math.round((x.attributes.brightness || 0) / 2.55) + ' %' : 'Off';
      else if (dom === 'event') txt = 'Last press ' + dur(this.age(it.entity)) + ' ago';
      else if (dom === 'binary_sensor' && it.kind === 'contact') txt = v === 'on' ? 'Open' : 'Closed';
      else if (dom === 'binary_sensor') txt = v === 'on' ? 'Motion' : 'Clear';
      else if (dom === 'media_player') txt = v.charAt(0).toUpperCase() + v.slice(1);
      else txt = v === 'on' ? 'On' : v === 'off' ? 'Off' : v;
      if (this.activity.includes(it.entity)) role = ACTIVE.includes(v) ? 'driving' : 'watching';
      else if (this.lights.includes(it.entity)) role = v === 'on' ? 'on' : 'off';
      return [txt, role, dom === 'event' ? '' : since];
    }

    // ── floor plan ──
    geometry() {
      const p = this._plan, corners = (p && p.room && p.room.corners) || [];
      const pts = corners.slice();
      this.planDevices().forEach((d) => pts.push([d.x, d.y]));
      (p && p.items || []).forEach((it) => (it.points || []).forEach((q) => pts.push(q)));
      if (!pts.length) return null;
      const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY), pad = 36;
      const S = Math.min(560 / w, 600 / h);
      return {
        S, corners, W: Math.round(w * S + pad * 2), H: Math.round(h * S + pad * 2),
        X: (v) => Math.round(pad + (v - minX) * S), Y: (v) => Math.round(pad + (v - minY) * S),
      };
    }

    planSvg(items, R) {
      const g = this.geometry();
      if (!g) return '<div class="dim">' + esc(this._planErr ? 'Floor plan failed to load: ' + this._planErr : (this._c.plan ? 'Loading floor plan…' : 'No floor plan configured.')) + '</div>';
      const { X, Y, S } = g, p = this._plan;
      const poly = (arr) => arr.map((q) => X(q[0]) + ',' + Y(q[1])).join(' ');
      const m = this.model();
      const uid = 'room' + this._c.room;
      const wedge = (d) => {
        const fov = d.fov || 100, range = (d.range || 170) * S;
        const x = X(d.x), y = Y(d.y), a = ((d.facing || 0) - 90) * Math.PI / 180, half = (fov / 2) * Math.PI / 180;
        const x1 = x + Math.cos(a - half) * range, y1 = y + Math.sin(a - half) * range;
        const x2 = x + Math.cos(a + half) * range, y2 = y + Math.sin(a + half) * range;
        return 'M ' + x + ' ' + y + ' L ' + x1 + ' ' + y1 + ' A ' + range + ' ' + range + ' 0 0 1 ' + x2 + ' ' + y2 + ' Z';
      };
      let shapes = '', doors = '', wedges = '', marks = '';
      (p.items || []).forEach((it) => {
        const q = it.points || [];
        if (it.kind === 'door' && q.length >= 2) {
          const mx = (q[0][0] + q[1][0]) / 2, my = (q[0][1] + q[1][1]) / 2;
          doors += '<line x1="' + X(q[0][0]) + '" y1="' + Y(q[0][1]) + '" x2="' + X(q[1][0]) + '" y2="' + Y(q[1][1]) + '" stroke="' + T.text + '" stroke-width="7" stroke-linecap="round"/>';
          if (it.name && !/^door \d+$/i.test(it.name)) doors += '<text x="' + X(mx) + '" y="' + (Y(my) - 12) + '" text-anchor="middle" font-size="11" fill="' + T.dim + '" font-family="' + FONT + '">' + esc(it.name) + '</text>';
        } else if (q.length >= 3) {
          const on = it.entity && this.s(it.entity) === 'on';
          const style = it.kind === 'zone'
            ? 'fill="' + (on ? 'rgba(108,176,255,0.22)' : 'rgba(47,57,69,0.35)') + '" stroke="' + (on ? T.blue : T.line) + '" stroke-width="2"'
            : it.kind === 'ignore'
              ? 'fill="rgba(154,167,180,0.12)" stroke="' + T.dim + '" stroke-width="1" stroke-dasharray="4 3"'
              : 'fill="rgba(154,167,180,0.10)" stroke="' + T.line + '" stroke-width="1"';
          shapes += '<polygon points="' + poly(q) + '" ' + style + '/>' +
            '<text x="' + (X(q[0][0]) + 6) + '" y="' + (Y(q[0][1]) + 16) + '" font-size="11" fill="' + T.dim + '" font-family="' + FONT + '">' + esc(it.name || '') + '</text>';
        }
      });
      items.forEach((it) => {
        const d = it.dev;
        if (!d) return;
        const r = R[it.key], role = r[1], x = X(d.x), y = Y(d.y);
        const lit = role === 'driving' || role === 'on' || (role === 'shown' && ['On', 'Open', 'Motion'].includes(r[0].split(' ')[0]));
        const dead = role === 'unavailable' || role === 'unbound';
        const sel = it.key === this._sel;
        const stroke = dead ? T.dim : lit ? (it.kind === 'contact' ? T.orange : T.blue) : T.line;
        const fill = lit ? (it.kind === 'contact' ? 'rgba(255,176,87,0.35)' : 'rgba(108,176,255,0.35)') : T.panel;
        if ((it.kind === 'motion' || it.kind === 'radar' || it.kind === 'camera') && d.facing !== undefined) {
          wedges += '<path d="' + wedge(d) + '" fill="' + (lit ? 'rgba(108,176,255,0.16)' : 'rgba(108,176,255,0.05)') + '" stroke="' + (lit ? T.blue : T.line) + '" stroke-width="1" stroke-dasharray="4 4"/>';
        }
        const glow = it.kind === 'light' && lit ? '<circle cx="' + x + '" cy="' + y + '" r="24" fill="rgba(108,176,255,0.18)"/>' : '';
        const body = it.kind === 'light'
          ? '<circle cx="' + x + '" cy="' + y + '" r="10" fill="' + fill + '" stroke="' + stroke + '" stroke-width="2"' + (dead ? ' stroke-dasharray="3 3"' : '') + '/>'
          : '<rect x="' + (x - 9) + '" y="' + (y - 9) + '" width="18" height="18" rx="' + (it.kind === 'contact' ? 3 : 6) + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="2"' + (dead ? ' stroke-dasharray="3 3"' : '') + '/>';
        marks += '<g data-sel="' + it.key + '" style="cursor:pointer"><title>' + esc(it.name + ': ' + r[0]) + '</title>' + glow +
          (sel ? '<circle cx="' + x + '" cy="' + y + '" r="16" fill="none" stroke="' + T.text + '" stroke-width="2"/>' : '') + body +
          '<text x="' + x + '" y="' + (y + 4) + '" text-anchor="middle" font-size="10" font-weight="700" fill="' + (lit ? T.text : T.dim) + '" font-family="' + FONT + '">' + it.n + '</text></g>';
      });
      return '<svg width="' + g.W + '" height="' + g.H + '" viewBox="0 0 ' + g.W + ' ' + g.H + '" xmlns="http://www.w3.org/2000/svg" style="max-width:100%;height:auto">' +
        '<defs><clipPath id="' + uid + '"><polygon points="' + poly(g.corners) + '"/></clipPath></defs>' +
        '<polygon points="' + poly(g.corners) + '" fill="' + (m.occupied ? '#121b27' : '#12161c') + '" stroke="' + (m.occupied ? T.blue : T.dim) + '" stroke-width="4"/>' +
        '<g clip-path="url(#' + uid + ')">' + wedges + '</g>' + shapes + doors + marks + '</svg>';
    }

    look(role, key) {
      const o = { bg: T.panel, border: T.line, bs: 'solid', name: T.text, value: T.text };
      if (role === 'driving' || role === 'on') { o.bg = T.blueFill; o.border = T.blue; o.value = T.blue; }
      if (role === 'unavailable' || role === 'unbound') { o.bs = 'dashed'; o.border = T.dim; o.name = T.dim; o.value = T.dim; }
      o.ring = key === this._sel ? '0 0 0 2px ' + T.bg + ', 0 0 0 4px ' + T.text : 'none';
      return o;
    }

    row(it, r) {
      const L = this.look(r[1], it.key), strong = r[1] === 'driving' || r[1] === 'on';
      return '<button type="button" class="card" data-sel="' + it.key + '" style="background:' + L.bg + ';border:2px ' + L.bs + ' ' + L.border + ';box-shadow:' + L.ring + '">' +
        '<span style="display:flex;justify-content:space-between;gap:8px;align-items:center"><span style="font-weight:600;color:' + L.name + '"><span class="num">' + it.n + '</span>' + esc(it.name) + '</span>' +
        '<span class="badge" style="background:' + (strong ? T.blue : 'transparent') + ';color:' + (strong ? T.ink : T.dim) + ';border:1px solid ' + (strong ? T.blue : T.dim) + '">' + esc(r[1]) + '</span></span>' +
        '<span class="mono" style="font-size:14px;font-weight:600;color:' + L.value + '">' + esc(r[0]) + (r[2] ? ' <span class="dim" style="font-weight:400">' + esc(r[2]) + '</span>' : '') + '</span></button>';
    }

    _render() {
      if (!this._hass || !this._c) return;
      const E = this.E, m = this.model();
      const items = this.items(), R = {};
      items.forEach((it) => { R[it.key] = this.reading(it); });
      if (!this._sel || !R[this._sel]) {
        const d = items.find((it) => R[it.key][1] === 'driving') || items[0];
        this._sel = d ? d.key : null;
      }
      const missing = [E.occupied, E.enabled, E.hold].filter((id) => !this.st(id));
      const sc = m.occupied ? T.blue : T.dim;
      const occAge = this.age(E.occupied);
      const pill = (text, style) => '<div style="padding:8px 14px;border-radius:999px;font-weight:600;' + style + '">' + esc(text) + '</div>';
      const pills =
        (m.enabled ? '' : pill('Motion lights switched off', 'background:' + T.orange + ';color:#1a1206')) +
        (m.sleeping ? pill('Sleep mode', 'border:1px solid ' + T.orange + ';color:' + T.orange) : '') +
        pill('Lights ' + m.lightsOn.length + '/' + this.lights.length + ' on', 'border:1px solid ' + (m.lightsOn.length ? T.blue : T.line) + ';color:' + (m.lightsOn.length ? T.blue : T.text)) +
        '<div data-live="count" class="mono" style="padding:8px 14px;border-radius:999px;border:1px solid ' + T.line + ';font-size:13px"></div>';

      const used = items.filter((it) => this.activity.includes(it.entity));
      const outs = items.filter((it) => this.lights.includes(it.entity));
      const rest = items.filter((it) => !used.includes(it) && !outs.includes(it));
      const nextHtml = this.next(m).map((n) => '<div style="display:flex;flex-wrap:wrap;gap:6px 12px;padding:10px 12px;border-radius:10px;background:' + T.bg + ';border:1px solid ' + T.line + '"><span style="flex:1 1 200px"><span class="dim">If </span>' + esc(n[0]) + '</span><b style="flex:1 1 200px;color:' + T.blue + '">→ ' + esc(n[1]) + '</b></div>').join('');
      const rulesHtml = this.rules(m).map(([id, text, s]) => {
        const st = s === 'active' ? 'border:1px solid ' + T.blue + ';background:' + T.blueFill : s === 'armed' ? 'border:1px dashed ' + T.dim : 'border:1px solid ' + T.line + ';color:' + T.dim;
        const fg = s === 'active' ? T.blue : s === 'armed' ? T.text : T.dim;
        return '<div style="display:flex;gap:12px;padding:10px 12px;border-radius:10px;' + st + '"><b class="mono" style="flex:none;color:' + fg + '">' + id + '</b><span style="flex:1">' + esc(text) + '</span><span style="flex:none;font-size:11px;font-weight:700;text-transform:uppercase;color:' + fg + '">' + s + '</span></div>';
      }).join('');

      const sel = items.find((it) => it.key === this._sel), sr = sel ? R[sel.key] : null;
      const roleText = {
        driving: 'Driving. It is holding the room occupied right now.', watching: 'Watching. The occupancy automation reads it; it is quiet now.',
        on: 'On. Switched by the lights automation.', off: 'Off. Switched by the lights automation.',
        shown: 'Shown only. The motion-lights automations do not read or switch it.', unavailable: 'Unavailable.', unbound: 'Not bound to an HA entity.',
      };
      const field = (label, value, mono) => '<div><div class="dim" style="font-size:12px">' + label + '</div><div' + (mono ? ' class="mono"' : '') + '>' + esc(value) + '</div></div>';
      const inspect = sel ? '<div class="panel" style="padding:16px;border-color:' + T.blue + '"><div class="cap">Inspecting · ' + sel.n + '</div><div style="font-size:18px;font-weight:700">' + esc(sel.name) + '</div><div class="mono dim" style="font-size:13px">' + esc(sel.entity || 'no entity') + '</div>' +
        field('Reading', sr[0] + (sr[2] ? ' ' + sr[2] : ''), true) + field('Role right now', roleText[sr[1]] || sr[1]) + field('Kind on the plan', sel.dev ? sel.kind : 'not on the plan') + '</div>' : '';
      const group = (title, hint, list) => list.length ? '<div class="row"><h2 style="font-size:16px">' + title + '</h2><span class="dim" style="font-size:12px">' + hint + '</span></div>' + list.map((it) => this.row(it, R[it.key])).join('') : '';

      this.shadowRoot.innerHTML = '<style>' + CSS + '</style><div class="page">' +
        '<div class="row" style="align-items:flex-end"><div><div class="cap">' + esc(this.title_) + ' · debug view</div><h1 style="font-size:28px">Motion, occupancy, lights</h1></div><div class="dim" style="font-size:13px;max-width:460px">Live. Activity marks the room occupied; quiet for the hold time marks it vacant; the lights follow those two changes. Click a number or a card to inspect it.</div></div>' +
        (missing.length ? '<div class="panel" style="border-color:' + T.orange + '"><b style="color:' + T.orange + '">Helpers missing</b><span class="mono">' + esc(missing.join(', ')) + '</span><span class="dim">This room has no block in packages/rooms.yaml yet, so only the floor plan is live.</span></div>' : '') +
        '<div aria-live="polite" style="display:flex;flex-wrap:wrap;gap:20px;align-items:center;justify-content:space-between;background:' + T.panel + ';border:2px solid ' + sc + ';border-radius:14px;padding:20px 24px"><div style="flex:1 1 420px"><div class="cap">Room now · ' + dur(occAge) + ' ago</div><div style="font-size:30px;font-weight:700;color:' + sc + '">' + (m.occupied ? 'Occupied' : 'Vacant') + '</div>' +
        '<div style="font-size:15px"><b>Occupancy:</b> ' + esc(this.s(E.occReason)) + '</div><div style="font-size:15px"><b>Lights:</b> ' + esc(this.s(E.lightReason)) + '</div></div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">' + pills + '</div></div>' +
        '<div class="cols">' +
        '<div class="panel" style="flex:1 1 420px;align-items:center"><div class="row" style="align-self:stretch"><h2 style="font-size:16px">Floor plan</h2><span class="dim" style="font-size:13px">From the room drawer. Numbers match the cards.</span></div>' + this.planSvg(items, R) + '</div>' +
        '<div class="col" style="flex:1 1 300px">' + group('1 · Inputs', 'what marks the room occupied', used) + group('3 · Outputs', 'what the automation switches', outs) + group('Also in the room', 'shown only', rest) + '</div>' +
        '<div class="col" style="flex:1 1 320px;gap:16px"><div class="row"><h2 style="font-size:16px">2 · Decision</h2><span class="dim" style="font-size:12px">what the automations will do</span></div>' +
        '<div class="panel" style="padding:16px;gap:8px"><b>What can happen next</b>' + nextHtml + '</div><div class="panel" style="padding:16px;gap:8px"><b>Rules</b>' + rulesHtml + '</div>' + inspect + '</div>' +
        '</div>' +
        '<div class="panel"><div class="row"><h2 style="font-size:16px">Last 15 minutes</h2><span data-live="cap" style="font-size:13px;color:' + T.orange + '"></span></div><div style="overflow-x:auto"><div data-live="lanes" style="min-width:640px;display:flex;flex-direction:column;gap:8px"></div></div></div>' +
        '</div>';
      this._renderLive();
    }

    _renderLive() {
      const root = this.shadowRoot;
      if (!this._hass || !this._c || !root.querySelector('[data-live="lanes"]')) return;
      const m = this.model();
      const count = root.querySelector('[data-live="count"]');
      if (count) {
        count.textContent = !m.occupied ? 'Hold ' + m.holdMin + ' min'
          : m.active.length ? 'Held by ' + m.active.length + ' input' + (m.active.length > 1 ? 's' : '')
            : 'Vacant in ' + dur(m.left);
      }
      const now = Date.now() / 1000, span = RANGE[1] - RANGE[0];
      const pct = (t) => Math.min(100, Math.max(0, ((t - now) - RANGE[0]) / span * 100));
      const spans = (id, want) => {
        const b = this._buf[id] || [], out = [];
        for (let i = 0; i < b.length; i++) {
          if (!want.includes(b[i][1])) continue;
          const end = i + 1 < b.length ? b[i + 1][0] : now;
          if (end >= now + RANGE[0]) out.push([b[i][0], end]);
        }
        return out;
      };
      const lanes = this.lanes().map((l) => '<div style="display:flex;align-items:center;gap:12px"><div class="dim" style="flex:none;width:200px;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(l.label) + '</div><div style="position:relative;flex:1;height:22px;border-radius:6px;background:' + T.bg + ';border:1px solid ' + T.line + ';overflow:hidden">' +
        spans(l.id, l.on).map((x) => '<div class="abs" style="top:0;bottom:0;left:' + pct(x[0]) + '%;width:' + (pct(x[1]) - pct(x[0])) + '%;background:' + l.color + ';opacity:' + l.opacity + '"></div>').join('') +
        '<div class="abs" style="top:0;bottom:0;left:' + pct(now) + '%;width:2px;background:' + T.text + '"></div></div></div>').join('') +
        '<div style="display:flex;gap:12px"><div style="flex:none;width:200px"></div><div class="mono dim" style="position:relative;flex:1;height:18px;font-size:12px"><span class="abs" style="left:0">' + Math.round(RANGE[0] / 60) + ' min</span><span class="abs" style="left:' + pct(now) + '%;transform:translateX(-50%);color:' + T.text + '">now</span></div></div>';
      root.querySelector('[data-live="lanes"]').innerHTML = lanes;
      root.querySelector('[data-live="cap"]').textContent = this._hist ? '' : (this._histErr ? 'History unavailable: ' + this._histErr : 'Loading history…');
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
.card{text-align:left;min-height:44px;display:flex;flex-direction:column;gap:4px;padding:10px 14px;border-radius:12px;transition:border-color .15s ease-out,background .15s ease-out}
.badge{padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
.num{display:inline-block;min-width:20px;margin-right:8px;padding:0 5px;border-radius:6px;border:1px solid ${T.line};font-size:11px;text-align:center;color:${T.dim}}
.abs{position:absolute}
@media (prefers-reduced-motion: reduce){.card{transition:none}}
@media (max-width:700px){.page{padding:16px}}
`;

  if (!customElements.get('ham-room-card')) customElements.define('ham-room-card', HamRoomCard);
  window.customCards = window.customCards || [];
  window.customCards.push({ type: 'ham-room-card', name: 'Room motion-lights debug', description: 'Live floor plan and decision view for a room built from packages/rooms.yaml.' });
})();
