// Spectator interface: almanac bar, civilisation ledgers, dossier tabs,
// inspector, tech tree, encyclopedia, minimap, toasts and input handling.
import { CFG } from '../config.js';
import { TECHS, ERAS } from '../data/technologies.js';
import { STRUCTURES, STRUCT_CATS } from '../data/structures.js';
import { PROFESSIONS } from '../data/professions.js';
import { SCALES, NB, BELIEFS, ADOPT_THRESHOLD, BAN_THRESHOLD } from '../data/beliefs.js';
import { RESOURCES } from '../data/resources.js';
import { TERRAIN, DEPOSITS } from '../world/terrain.js';
import { ROAD_NAMES, RAIL, BRIDGE } from '../world/world.js';
import { S, A } from '../sim/people.js';
import { ZOOMS } from '../render/renderer.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'k' : n >= 100 ? Math.round(n).toString() : n >= 10 ? n.toFixed(0) : n.toFixed(1));
const STATE_NAMES = ['idle', 'walking', 'working', 'harvesting', 'building', 'sleeping', 'at leisure', 'fighting', 'waiting', 'aboard a vehicle', 'in jail'];
const ACT_NAMES = {};
for (const [k, v] of Object.entries(A)) ACT_NAMES[v] = k.toLowerCase().replace('_', ' ');
export const SPEEDS = [
  { label: '❚❚', tps: 0, title: 'Pause' },
  { label: '½×', tps: 12 }, { label: '1×', tps: 30 }, { label: '3×', tps: 90 }, { label: '10×', tps: 300 },
  { label: '30×', tps: 900 }, { label: '100×', tps: 3000 }, { label: 'MAX', tps: 1e9, title: 'As fast as your machine allows' },
];
const TABS = ['Chronicle', 'Technology', 'Beliefs', 'Professions', 'Structures', 'Economy', 'Diplomacy', 'Census'];
const CHRON_FILTERS = [['all', 'All'], ['war', 'War'], ['tech', 'Science'], ['belief', 'Beliefs & laws'], ['treaty', 'Diplomacy'], ['build', 'Building'], ['disaster', 'Disasters'], ['great', 'People']];
const KIND_GROUP = { war: 'war', conquest: 'war', rebellion: 'war', peace: 'treaty', treaty: 'treaty', diplomacy: 'treaty', trade: 'treaty', incident: 'treaty', espionage: 'war', tech: 'tech', era: 'tech', belief: 'belief', law: 'belief', government: 'belief', prophet: 'belief', build: 'build', wonder: 'build', expansion: 'build', transport: 'build', disaster: 'disaster', unrest: 'disaster', great: 'great', death: 'great', culture: 'great', migration: 'great', good: 'disaster' };
const TOAST_KINDS = new Set(['war', 'peace', 'conquest', 'wonder', 'era', 'rebellion', 'great', 'prophet', 'government']);

export class UI {
  constructor(app, sim, renderer, controller) {
    this.app = app; this.sim = sim; this.r = renderer; this.ctl = controller;
    this.tab = 'Chronicle';
    this.chronFilter = 'all';
    this.econCiv = 0;
    this.search = '';
    this.follow = false;
    this.lastPanel = 0;
    this.build();
    this.bind();
    sim.onChronicle = (e) => this.onChronicle(e);
  }

  // ---------------------------------------------------------------- DOM
  build() {
    this.app.innerHTML = `
      <canvas id="view" aria-label="Living map of the continent"></canvas>
      <header id="topbar">
        <div class="brand"><h1>Pixel Continent</h1><small>every pixel is a person</small></div>
        <div class="almanac" aria-live="off"><div class="dial" title="Time of day"><i id="sun"></i></div><span id="date">Year 1</span><span class="pop" id="totpop"></span></div>
        <div class="spacer"></div>
        <div class="seg" id="speeds" role="group" aria-label="Simulation speed">${SPEEDS.map((s, k) => `<button data-speed="${k}" title="${s.title || s.label + ' speed'}" aria-pressed="false">${s.label}</button>`).join('')}</div>
        <div class="ctl">
          <select id="colorMode" title="Colour each person-pixel by" aria-label="Colour people">
            <option value="civ">People: civilisation</option><option value="profession">People: profession</option><option value="belief">People: belief</option>
            <option value="happiness">People: happiness</option><option value="health">People: health</option><option value="age">People: age</option>
          </select>
          <select id="beliefScale" hidden title="Belief scale">${SCALES.map((s, k) => `<option value="${k}">${esc(s.neg.name)} ↔ ${esc(s.pos.name)}</option>`).join('')}</select>
          <select id="overlay" title="Map overlay" aria-label="Map overlay">
            <option value="none">Map: borders</option><option value="territory">Map: territory</option><option value="traffic">Map: traffic</option>
            <option value="fertility">Map: soil</option><option value="resources">Map: minerals</option><option value="pollution">Map: pollution</option>
          </select>
          <button class="iconbtn" id="btnNight" aria-pressed="true" title="Day/night cycle (N)">Night</button>
          <button class="iconbtn" id="btnLabels" aria-pressed="true" title="Town &amp; army labels (L)">Labels</button>
          <button class="iconbtn" id="btnDirector" aria-pressed="false" title="Director: the camera chases the story (V)">Director</button>
          <button class="iconbtn" id="btnHelp" title="How to watch (H)">Guide</button>
        </div>
      </header>
      <aside id="ledger" class="panel" aria-label="Civilisations"></aside>
      <aside id="dossier" class="panel" aria-label="Dossier">
        <div class="tabs" role="tablist">${TABS.map((t) => `<button role="tab" data-tab="${t}" aria-selected="${t === this.tab}">${t}</button>`).join('')}</div>
        <div class="tabbody" id="tabbody"></div>
      </aside>
      <section id="inspector" class="panel" hidden></section>
      <div id="minimapWrap" class="panel"><canvas id="minimap" width="280" height="175" aria-label="Minimap"></canvas></div>
      <div id="legendbar" class="panel" hidden></div>
      <div id="toasts"></div>
      <div id="tooltip" hidden></div>
      <div id="modal" hidden></div>
      <nav id="mobilebar"><button class="btn" id="mbCivs">Civilisations</button><button class="btn" id="mbDossier">Dossier</button></nav>`;
    this.canvas = $('#view');
  }

  bind() {
    const r = this.r;
    $('#speeds').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) this.ctl.setSpeed(+b.dataset.speed); });
    $('#colorMode').addEventListener('change', (e) => { r.colorMode = e.target.value; $('#beliefScale').hidden = r.colorMode !== 'belief'; this.clearColors(); this.legend(); });
    $('#beliefScale').addEventListener('change', (e) => { r.beliefScale = +e.target.value; this.legend(); });
    $('#overlay').addEventListener('change', (e) => { r.overlay = e.target.value; });
    $('#btnNight').addEventListener('click', (e) => { r.night = !r.night; e.target.setAttribute('aria-pressed', r.night); });
    $('#btnLabels').addEventListener('click', (e) => { r.showLabels = !r.showLabels; e.target.setAttribute('aria-pressed', r.showLabels); });
    $('#btnHelp').addEventListener('click', () => this.showHelp());
    $('#btnDirector').addEventListener('click', () => this.toggleDirector());
    $('#mbCivs').addEventListener('click', () => { $('#ledger').classList.toggle('open'); $('#dossier').classList.remove('open'); });
    $('#mbDossier').addEventListener('click', () => { $('#dossier').classList.toggle('open'); $('#ledger').classList.remove('open'); });
    $('.tabs').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-tab]');
      if (!b) return;
      this.tab = b.dataset.tab;
      for (const x of document.querySelectorAll('.tabs button')) x.setAttribute('aria-selected', x.dataset.tab === this.tab);
      this.tabDom = null;
      this.renderTab(true);
    });
    $('#ledger').addEventListener('click', (e) => {
      const card = e.target.closest('.civ');
      if (!card) return;
      const civ = this.sim.civs[+card.dataset.civ];
      const t = this.sim.towns[civ.capital];
      if (t) this.flyTo(t.cx, t.cy, 4);
    });
    $('#tabbody').addEventListener('click', (e) => this.onTabClick(e));
    $('#tabbody').addEventListener('input', (e) => { if (e.target.id === 'search') { this.search = e.target.value.toLowerCase(); this.renderTab(true, true); } });
    $('#tabbody').addEventListener('change', (e) => { if (e.target.id === 'econCiv') { this.econCiv = +e.target.value; this.renderTab(true); } });
    $('#inspector').addEventListener('click', (e) => this.onInspectorClick(e));
    $('#modal').addEventListener('click', (e) => {
      if (e.target.id === 'modal' || e.target.closest('[data-close]')) { $('#modal').hidden = true; return; }
      if (e.target.closest('[data-newworld]') && this.onNewWorld) { this.onNewWorld(1 + ((Math.random() * 99999) | 0)); return; }
      const l = e.target.closest('[data-ency]');
      if (l) this.showEncyclopedia(l.dataset.ency);
    });
    // minimap
    const mm = $('#minimap');
    const mmMove = (e) => {
      const rect = mm.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width * this.sim.world.W, y = (e.clientY - rect.top) / rect.height * this.sim.world.H;
      r.cam.x = x; r.cam.y = y; this.follow = false;
    };
    let mmDown = false;
    mm.addEventListener('pointerdown', (e) => { mmDown = true; mmMove(e); mm.setPointerCapture(e.pointerId); });
    mm.addEventListener('pointermove', (e) => { if (mmDown) mmMove(e); });
    mm.addEventListener('pointerup', () => { mmDown = false; });
    // map interaction
    const cv = this.canvas;
    const pointers = new Map();
    let drag = null, pinch = null;
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, moved: 0 };
      if (pointers.size === 2) { const p = [...pointers.values()]; pinch = { d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) }; drag = null; }
    });
    cv.addEventListener('pointermove', (e) => {
      const rect = cv.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pointers.size === 2) {
        const p = [...pointers.values()];
        const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
        if (d > pinch.d * 1.35) { r.zoomAt((p[0].x + p[1].x) / 2 - rect.left, (p[0].y + p[1].y) / 2 - rect.top, 1); pinch.d = d; }
        else if (d < pinch.d / 1.35) { r.zoomAt((p[0].x + p[1].x) / 2 - rect.left, (p[0].y + p[1].y) / 2 - rect.top, -1); pinch.d = d; }
        return;
      }
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        drag.moved += Math.abs(dx) + Math.abs(dy);
        if (drag.moved > 4) { r.pan(dx, dy); cv.classList.add('dragging'); this.follow = false; }
        drag.x = e.clientX; drag.y = e.clientY;
        $('#tooltip').hidden = true;
      } else if (e.pointerType === 'mouse') this.hover(sx, sy, e.clientX, e.clientY);
    });
    const up = (e) => {
      const rect = cv.getBoundingClientRect();
      if (drag && drag.moved <= 4 && pointers.size === 1) this.pick(e.clientX - rect.left, e.clientY - rect.top);
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (!pointers.size) drag = null;
      cv.classList.remove('dragging');
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', () => { $('#tooltip').hidden = true; });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = cv.getBoundingClientRect();
      this.wheelAcc = (this.wheelAcc || 0) + e.deltaY;
      if (Math.abs(this.wheelAcc) > 40) { r.zoomAt(e.clientX - rect.left, e.clientY - rect.top, this.wheelAcc < 0 ? 1 : -1); this.wheelAcc = 0; }
    }, { passive: false });
    this._onKey = (e) => this.onKey(e);
    this._onKeyUp = (e) => { this.keys && this.keys.delete(e.key.toLowerCase()); };
    window.addEventListener('keydown', this._onKey);
    window.addEventListener('keyup', this._onKeyUp);
    this.keys = new Set();
  }

  destroy() {
    window.removeEventListener('keydown', this._onKey);
    window.removeEventListener('keyup', this._onKeyUp);
    this.sim.onChronicle = null;
  }

  layout() {
    const tb = $('#topbar');
    if (tb) this.app.style.setProperty('--top', tb.offsetHeight + 'px');
  }

  legend() {
    const r = this.r, el = $('#legendbar');
    const grad = (a, b, l, rr) => `<span>${esc(l)}</span><i style="background:linear-gradient(90deg,${a},${b})"></i><span>${esc(rr)}</span>`;
    let html = '';
    switch (r.colorMode) {
      case 'belief': { const sc = SCALES[r.beliefScale]; html = grad('rgb(30,170,255)', 'rgb(255,30,30)', sc.neg.name, sc.pos.name); break; }
      case 'happiness': html = grad('rgb(255,60,60)', 'rgb(0,255,60)', 'miserable', 'content'); break;
      case 'health': html = grad('rgb(255,0,90)', 'rgb(0,255,90)', 'dying', 'healthy') + '<span style="color:rgb(150,255,60)">■ plague</span>'; break;
      case 'age': html = grad('rgb(255,220,120)', 'rgb(55,100,255)', 'newborn', '80 years'); break;
      case 'profession': html = '<span>Each profession has its own colour — hover a person to see who they are.</span>'; break;
    }
    el.innerHTML = html;
    el.hidden = !html;
  }

  clearColors() { const P = this.sim.people; P.color.fill(0); }

  onKey(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    const k = e.key.toLowerCase();
    const r = this.r;
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { this.keys.add(k); this.follow = false; e.preventDefault(); return; }
    if (k === ' ') { e.preventDefault(); this.ctl.togglePause(); return; }
    if (k >= '1' && k <= '8') { this.ctl.setSpeed(+k - 1); return; }
    if (k === '+' || k === '=') r.zoomAt(this.canvas.clientWidth / 2, this.canvas.clientHeight / 2, 1);
    else if (k === '-' || k === '_') r.zoomAt(this.canvas.clientWidth / 2, this.canvas.clientHeight / 2, -1);
    else if (k === 'f') { if (r.selected >= 0) this.follow = !this.follow; }
    else if (k === 'escape') { r.selected = -1; r.selectedBuilding = -1; this.follow = false; $('#inspector').hidden = true; $('#modal').hidden = true; }
    else if (k === 't') { r.overlay = r.overlay === 'territory' ? 'none' : 'territory'; $('#overlay').value = r.overlay; }
    else if (k === 'n') $('#btnNight').click();
    else if (k === 'l') $('#btnLabels').click();
    else if (k === 'h' || k === '?') this.showHelp();
    else if (k === 'v') this.toggleDirector();
    else if (k === 'g') this.showTechTree();
  }

  keyPan(dtSec) {
    if (!this.keys.size) return;
    const sp = 600 * dtSec;
    let dx = 0, dy = 0;
    if (this.keys.has('a') || this.keys.has('arrowleft')) dx += sp;
    if (this.keys.has('d') || this.keys.has('arrowright')) dx -= sp;
    if (this.keys.has('w') || this.keys.has('arrowup')) dy += sp;
    if (this.keys.has('s') || this.keys.has('arrowdown')) dy -= sp;
    this.r.pan(dx, dy);
  }

  flyTo(x, y, zi) {
    this.r.cam.x = x; this.r.cam.y = y;
    if (zi !== undefined) this.r.cam.zi = Math.max(this.r.cam.zi, ZOOMS.indexOf(zi) >= 0 ? ZOOMS.indexOf(zi) : zi);
    this.follow = false;
  }

  // ---------------------------------------------------------------- picking
  pick(sx, sy) {
    const sim = this.sim, P = sim.people, r = this.r;
    const [wx, wy] = r.screenToWorld(sx, sy);
    const rad = Math.max(1.2, 6 / r.zoom);
    let best = -1, bd = rad * rad;
    sim.spatial.query(wx, wy, rad + 1, (i) => {
      if (P.civ[i] < 0 || P.state[i] === S.INSIDE) return false;
      const d = (P.x[i] + 0.5 - wx) ** 2 + (P.y[i] + 0.5 - wy) ** 2;
      if (d < bd) { bd = d; best = i; }
      return false;
    });
    if (best >= 0) { r.selected = best; r.selectedBuilding = -1; sim.selected = best; this.showInspector(); return; }
    const w = sim.world;
    if (w.inb(wx | 0, wy | 0)) {
      const id = w.bld[(wy | 0) * w.W + (wx | 0)] - 1;
      if (id >= 0) { r.selectedBuilding = id; r.selected = -1; this.follow = false; this.showInspector(); return; }
    }
    r.selected = -1; r.selectedBuilding = -1; this.follow = false;
    $('#inspector').hidden = true;
  }

  hover(sx, sy, cx, cy) {
    const sim = this.sim, w = sim.world, r = this.r;
    const [wx, wy] = r.screenToWorld(sx, sy);
    const tip = $('#tooltip');
    if (!w.inb(wx | 0, wy | 0)) { tip.hidden = true; return; }
    const i = (wy | 0) * w.W + (wx | 0);
    const parts = [];
    // a person under the cursor?
    if (r.zoom >= 3) {
      const P = sim.people;
      let who = -1, bd = 0.9;
      sim.spatial.query(wx, wy, 2, (j) => {
        if (P.civ[j] < 0 || P.state[j] === S.INSIDE) return false;
        const d = (P.x[j] + 0.5 - wx) ** 2 + (P.y[j] + 0.5 - wy) ** 2;
        if (d < bd) { bd = d; who = j; }
        return false;
      });
      if (who >= 0) {
        const adult = P.age[who] >= CFG.ADULT_AGE;
        const role = adult ? PROFESSIONS[P.prof[who]].name : 'child';
        parts.push(`<b style="color:${sim.civs[P.civ[who]].css}">${esc(sim.personName(who))}</b> · ${esc(role)}, ${Math.floor(P.age[who])} · ${esc(STATE_NAMES[P.state[who]] || '')}`);
      }
    }
    const bid = w.bld[i] - 1;
    if (bid >= 0 && sim.buildings[bid]) {
      const b = sim.buildings[bid];
      parts.push(`<b>${esc(b.def.name)}</b>${b.built ? '' : ` <span class="muted">(${Math.round(b.progress * 100)}% built)</span>`}`);
    }
    parts.push(esc(TERRAIN[w.ter[i]].name));
    const d = w.dep[i];
    if (d && w.amt[i] > 0) parts.push(esc(DEPOSITS[d].name));
    const rd = w.road[i];
    if (rd & 7) parts.push(ROAD_NAMES[rd & 7]);
    if (rd & RAIL) parts.push('Railway');
    if (rd & BRIDGE) parts.push('Bridge');
    const o = w.ownerAt(wx | 0, wy | 0);
    if (o >= 0) parts.push(`<span style="color:${sim.civs[o].css}">${esc(sim.civs[o].name)}</span>`);
    tip.innerHTML = parts.join(' · ');
    tip.hidden = false;
    const rect = this.app.getBoundingClientRect();
    tip.style.left = Math.min(cx - rect.left + 14, rect.width - 290) + 'px';
    tip.style.top = (cy - rect.top + 14) + 'px';
  }

  // ---------------------------------------------------------------- frame
  update(nowMs) {
    const sim = this.sim, r = this.r;
    this.directorTick(nowMs);
    if (this.follow && r.selected >= 0 && sim.people.civ[r.selected] >= 0) { r.cam.x = sim.people.x[r.selected]; r.cam.y = sim.people.y[r.selected]; }
    // almanac every frame (cheap)
    const hh = Math.floor(sim.tod * 24), mm = Math.floor((sim.tod * 24 - hh) * 60);
    const dayInSeason = (sim.day % CFG.DAYS_PER_SEASON) + 1;
    $('#date').innerHTML = `Year ${sim.year} · <span class="season">${CFG.SEASONS[sim.season]}</span> · day ${dayInSeason} · ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    const ang = sim.tod * Math.PI * 2 - Math.PI / 2;
    const sun = $('#sun');
    sun.style.transform = `translate(${Math.cos(ang) * 7}px, ${Math.sin(ang) * 7}px)`;
    sun.style.background = sim.tod > 0.25 && sim.tod < 0.8 ? 'var(--brass-2)' : '#cfd8e6';
    if (nowMs - this.lastPanel < 600) return;
    this.lastPanel = nowMs;
    const pace = this.pace || 0;
    $('#totpop').textContent = `${fmt(sim.people.count)} people${pace > 0.004 ? ` · ${pace >= 1 ? pace.toFixed(1) + ' yr/s' : Math.round(pace * 12 * 10) / 10 + ' days/s'}` : ''}`;
    for (const b of document.querySelectorAll('#speeds button')) b.setAttribute('aria-pressed', +b.dataset.speed === this.ctl.speed);
    this.renderLedger();
    this.renderTab(false);
    if (!$('#inspector').hidden) this.showInspector();
    this.r.drawMinimap($('#minimap'));
  }

  // ---------------------------------------------------------------- ledger
  renderLedger() {
    const sim = this.sim;
    const html = sim.civs.map((c) => {
      const res = c.researching >= 0 ? TECHS[c.researching] : null;
      const cost = res ? sim.research.cost(c, res) : 1;
      const rels = sim.civs.filter((o) => o !== c && o.alive && c.contact[o.id]).map((o) => {
        const p = sim.diplomacy.pair(c.id, o.id);
        const cls = p.war ? 'war' : p.alliance ? 'peace' : p.trade ? 'trade' : '';
        const label = p.war ? 'at war with' : p.alliance ? 'allied with' : p.trade ? 'trades with' : 'at peace with';
        return `<span class="chip ${cls}" title="Relations ${c.relations[o.id].toFixed(0)}">${label} ${esc(o.adjective || o.name)} · ${c.relations[o.id].toFixed(0)}</span>`;
      }).join('');
      const adopted = c.adoptedList();
      return `<div class="civ${c.alive ? '' : ' fallen'}" data-civ="${c.id}" title="Click to view the capital">
        <div class="head"><span class="swatch" style="background:${c.css}"></span><span class="name">${esc(c.name)}</span></div>
        <div class="chips"><span class="chip gov">${esc(c.alive ? c.government : 'Fallen')}</span><span class="chip">${esc(ERAS[c.era])}</span>${c.goldenAge > 0 ? '<span class="chip gov">Golden Age</span>' : ''}</div>
        <div class="stats">
          <div class="stat"><b>${fmt(c.pop)}</b><span>people</span></div>
          <div class="stat"><b>${c.towns.length}</b><span>towns</span></div>
          <div class="stat"><b>${c.techCount}</b><span>techs</span></div>
          <div class="stat"><b>${c.soldiers}</b><span>soldiers</span></div>
          <div class="stat"><b>${Math.round(c.happiness)}</b><span>content</span></div>
          <div class="stat"><b>${fmt(c.researchRate * c.mod.research)}</b><span>science/d</span></div>
          <div class="stat"><b>${fmt(c.culture)}</b><span>culture</span></div>
          <div class="stat"><b>${fmt(c.stockTotal[sim.RES_COINS])}</b><span>coins</span></div>
        </div>
        ${res ? `<div class="research">Researching <em>${esc(res.name)}</em><div class="bar"><i style="width:${Math.min(100, c.researchPts / cost * 100).toFixed(1)}%;background:${c.css}"></i></div></div>` : ''}
        <div class="chips">${rels}</div>
        <div class="chips">${adopted.slice(0, 10).map((b) => `<span class="chip belief">${esc(b)}</span>`).join('')}${adopted.length > 10 ? `<span class="chip">+${adopted.length - 10}</span>` : ''}</div>
        ${c.bans.size ? `<div class="chips">${[...c.bans].slice(0, 6).map((b) => `<span class="chip ban" title="Outlawed">⊘ ${esc(banName(b))}</span>`).join('')}${c.bans.size > 6 ? `<span class="chip ban">+${c.bans.size - 6}</span>` : ''}</div>` : ''}
      </div>`;
    }).join('');
    $('#ledger').innerHTML = html;
  }

  // ---------------------------------------------------------------- tabs
  renderTab(force, keepTools) {
    const body = $('#tabbody');
    const fn = this['tab' + this.tab];
    if (!fn) return;
    if (!force && this.tab !== 'Chronicle' && this.tab !== 'Census' && this.tab !== 'Diplomacy' && this.tab !== 'Economy' && (this.tabTick || 0) % 3 !== 0) { this.tabTick = (this.tabTick || 0) + 1; return; }
    this.tabTick = (this.tabTick || 0) + 1;
    const scroll = body.scrollTop;
    if (keepTools && body.querySelector('#tabcontent')) {
      body.querySelector('#tabcontent').innerHTML = fn.call(this, true);
    } else {
      body.innerHTML = fn.call(this, false);
      const s = body.querySelector('#search');
      if (s) { s.value = this.search; }
    }
    if (this.tab === 'Census') this.drawCharts();
    body.scrollTop = scroll;
  }

  tools(extra = '') {
    return `<div class="tabtools"><input id="search" type="search" placeholder="Filter…" aria-label="Filter list" value="${esc(this.search)}">${extra}</div>`;
  }

  tabChronicle() {
    const sim = this.sim;
    const filt = this.chronFilter;
    const list = sim.chronicleLog.filter((e) => filt === 'all' || KIND_GROUP[e.kind] === filt).slice(-220).reverse();
    return `<div class="tabtools">${CHRON_FILTERS.map(([k, l]) => `<button class="filter" data-cfilter="${k}" aria-pressed="${k === filt}">${l}</button>`).join('')}</div>
      <ol class="chron">${list.map((e) => {
        const civ = sim.civs[e.civ];
        const loc = e.x !== undefined ? ` class="loc" data-x="${e.x}" data-y="${e.y}"` : '';
        return `<li${loc}><span class="yr">${civ ? `<i style="background:${civ.css}"></i>` : '<i style="background:#777"></i>'}Y${e.year}</span><span class="k-${e.kind}">${esc(e.text)}</span></li>`;
      }).join('')}</ol>`;
  }

  tabTechnology(inner) {
    const sim = this.sim;
    const q = this.search;
    let html = '';
    for (let era = 0; era < ERAS.length; era++) {
      const techs = TECHS.filter((t) => t.era === era && (!q || t.name.toLowerCase().includes(q)));
      if (!techs.length) continue;
      html += `<tr class="group"><td colspan="${1 + sim.civs.length}">${esc(ERAS[era])}</td></tr>`;
      for (const t of techs) {
        html += `<tr><td><button class="link" data-ency="tech:${t.id}">${esc(t.name)}</button></td>${sim.civs.map((c) => {
          const has = c.techs[t.idx];
          const res = c.researching === t.idx;
          const banned = c.bans.has('tech:' + t.id);
          return `<td class="n" style="color:${has ? c.css : 'var(--text-3)'}">${has ? 'Y' + Math.max(1, Math.round(c.techYear[t.idx])) : res ? '…' : banned ? '⊘' : '·'}</td>`;
        }).join('')}</tr>`;
      }
    }
    const table = `<table class="data"><thead><tr><th>Technology</th>${sim.civs.map((c) => `<th class="n" style="color:${c.css}">${esc((c.adjective || c.name).slice(0, 8))}</th>`).join('')}</tr></thead><tbody>${html}</tbody></table>`;
    if (inner) return table;
    return this.tools('<button class="btn primary" data-open="techtree">Open tech tree</button>') + `<div id="tabcontent">${table}</div>`;
  }

  tabBeliefs(inner) {
    const sim = this.sim;
    const q = this.search;
    const rows = SCALES.filter((s) => !q || (s.neg.name + s.pos.name + s.key).toLowerCase().includes(q)).map((s) => {
      const marks = sim.civs.filter((c) => c.alive).map((c) => `<span class="mark" style="left:${50 + c.beliefAvg[s.idx] / 2}%;background:${c.css}" title="${esc(c.name)}: ${c.beliefAvg[s.idx].toFixed(0)}"></span>`).join('');
      const negOn = sim.civs.some((c) => c.adopted[s.idx] < 0), posOn = sim.civs.some((c) => c.adopted[s.idx] > 0);
      return `<div class="scale"><button class="link l ${negOn ? 'on' : ''}" data-ency="belief:${s.key}-">${esc(s.neg.name)}</button>
        <div class="track"><span class="zone" style="left:0;width:${50 - ADOPT_THRESHOLD / 2}%"></span><span class="zone" style="right:0;width:${50 - ADOPT_THRESHOLD / 2}%"></span>${marks}</div>
        <button class="link r ${posOn ? 'on' : ''}" data-ency="belief:${s.key}+">${esc(s.pos.name)}</button></div>`;
    }).join('');
    const inner_ = `<p class="muted" style="font-size:12px;margin:0 0 6px">Each marker is a civilisation's average across its people. Past the shaded zones a belief is adopted; beyond ±${BAN_THRESHOLD} its bans become law.</p>${rows}`;
    if (inner) return inner_;
    return this.tools() + `<div id="tabcontent">${inner_}</div>`;
  }

  tabProfessions(inner) {
    const sim = this.sim;
    const q = this.search;
    const cats = [...new Set(PROFESSIONS.map((p) => p.cat))];
    let html = '';
    for (const cat of cats) {
      const ps = PROFESSIONS.filter((p) => p.cat === cat && (!q || p.name.toLowerCase().includes(q)));
      if (!ps.length) continue;
      html += `<tr class="group"><td colspan="${1 + sim.civs.length}">${esc(cat[0].toUpperCase() + cat.slice(1))}</td></tr>`;
      for (const p of ps) {
        const counts = sim.civs.map((c) => c.profCount[p.idx]);
        const zero = counts.every((n) => n <= 0);
        html += `<tr class="${zero ? 'zero' : ''}"><td><button class="link" data-ency="prof:${p.id}">${esc(p.name)}</button></td>${counts.map((n, k) => `<td class="n" style="color:${n > 0 ? sim.civs[k].css : ''}">${n > 0 ? n : '·'}</td>`).join('')}</tr>`;
      }
    }
    const table = `<table class="data"><thead><tr><th>Profession</th>${sim.civs.map((c) => `<th class="n" style="color:${c.css}">${esc((c.adjective || c.name).slice(0, 8))}</th>`).join('')}</tr></thead><tbody>${html}</tbody></table>`;
    if (inner) return table;
    return this.tools() + `<div id="tabcontent">${table}</div>`;
  }

  tabStructures(inner) {
    const sim = this.sim;
    const q = this.search;
    let html = '';
    for (const cat of STRUCT_CATS) {
      const ss = STRUCTURES.filter((s) => s.cat === cat && (!q || s.name.toLowerCase().includes(q)));
      if (!ss.length) continue;
      html += `<tr class="group"><td colspan="${1 + sim.civs.length}">${esc(cat[0].toUpperCase() + cat.slice(1))}</td></tr>`;
      for (const s of ss) {
        const counts = sim.civs.map((c) => c.structCount[s.idx]);
        const zero = counts.every((n) => n <= 0);
        html += `<tr class="${zero ? 'zero' : ''}"><td><button class="link" data-ency="struct:${s.id}">${esc(s.name)}</button></td>${sim.civs.map((c, k) => {
          const n = counts[k];
          const banned = c.bans.has(s.id);
          const avail = c.structureAvailable(s);
          return `<td class="n" style="color:${n > 0 ? c.css : ''}" title="${banned ? 'Outlawed' : avail ? 'Available' : 'Not yet discovered'}">${banned ? '⊘' : n > 0 ? n : avail ? '○' : '·'}</td>`;
        }).join('')}</tr>`;
      }
    }
    const table = `<table class="data"><thead><tr><th>Structure</th>${sim.civs.map((c) => `<th class="n" style="color:${c.css}">${esc((c.adjective || c.name).slice(0, 8))}</th>`).join('')}</tr></thead><tbody>${html}</tbody></table>`;
    if (inner) return table;
    return this.tools('<span class="muted" style="font-size:11px">○ available · ⊘ outlawed</span>') + `<div id="tabcontent">${table}</div>`;
  }

  tabEconomy(inner) {
    const sim = this.sim;
    const c = sim.civs[this.econCiv] || sim.civs[0];
    const q = this.search;
    let prod = new Float32Array(RESOURCES.length), cons = new Float32Array(RESOURCES.length);
    for (const tid of c.towns) { const t = sim.towns[tid]; if (!t) continue; for (let r = 0; r < RESOURCES.length; r++) { prod[r] += t.prod[r]; cons[r] += t.cons[r]; } }
    const rows = RESOURCES.filter((r) => !q || r.name.toLowerCase().includes(q)).map((r) => {
      const st = c.stockTotal[r.idx];
      const zero = st < 0.5 && prod[r.idx] < 0.05;
      return `<tr class="${zero ? 'zero' : ''}"><td><span style="display:inline-block;width:8px;height:8px;background:${r.color};margin-right:6px;border-radius:1px"></span>${esc(r.name)}</td><td class="n">${fmt(st)}</td><td class="n">${fmt(prod[r.idx])}</td><td class="n">${fmt(cons[r.idx])}</td><td class="n">${sim.economy.price(c.id, r.idx).toFixed(1)}</td></tr>`;
    }).join('');
    const shortage = (t) => RESOURCES.map((r) => [r, t.want[r.idx] > 0 ? (t.want[r.idx] - t.stock[r.idx]) / t.want[r.idx] * Math.log2(2 + r.base) : 0])
      .filter((x) => x[1] > 0.6 && !x[0].food).sort((a, b) => b[1] - a[1]).slice(0, 2).map((x) => x[0].name).join(', ');
    const towns = c.towns.map((tid) => sim.towns[tid]).filter(Boolean).map((t) => `<tr><td><button class="link" data-town="${t.id}">${t.isCapital ? '★ ' : ''}${esc(t.name)}</button></td><td class="n">${t.pop}</td><td class="n">${t.housingCap}</td><td class="n">${t.foodDays.toFixed(0)}d</td><td class="n">${Math.round(t.happiness)}</td><td class="muted" style="font-size:11px">${esc(shortage(t))}</td></tr>`).join('');
    const table = `<h3>Towns</h3><table class="data"><thead><tr><th>Town</th><th class="n">People</th><th class="n">Homes</th><th class="n">Food</th><th class="n">Mood</th><th>Short of</th></tr></thead><tbody>${towns}</tbody></table>
      <h3>Stockpiles</h3><table class="data"><thead><tr><th>Resource</th><th class="n">Stock</th><th class="n">Made/d</th><th class="n">Used/d</th><th class="n">Price</th></tr></thead><tbody>${rows}</tbody></table>`;
    if (inner) return table;
    return this.tools(`<select id="econCiv" aria-label="Civilisation">${sim.civs.map((x) => `<option value="${x.id}" ${x.id === c.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`) + `<div id="tabcontent">${table}</div>`;
  }

  tabDiplomacy() {
    const sim = this.sim;
    const civs = sim.civs;
    let html = '<h3>Relations</h3><table class="data"><thead><tr><th></th>' + civs.map((c) => `<th class="n" style="color:${c.css}">${esc((c.adjective || c.name).slice(0, 8))}</th>`).join('') + '</tr></thead><tbody>';
    for (const a of civs) {
      html += `<tr><td style="color:${a.css}">${esc(a.name)}</td>` + civs.map((b) => {
        if (a === b) return '<td class="n muted">—</td>';
        if (!a.contact[b.id]) return '<td class="n muted" title="No contact">?</td>';
        const v = a.relations[b.id];
        const col = v > 30 ? 'var(--good)' : v < -30 ? 'var(--bad)' : 'var(--text)';
        return `<td class="n" style="color:${col}">${v.toFixed(0)}</td>`;
      }).join('') + '</tr>';
    }
    html += '</tbody></table><h3>Treaties & wars</h3>';
    const pairs = [...sim.diplomacy.pairs.values()].filter((p) => civs[p.a] && civs[p.b] && civs[p.a].contact[p.b]);
    if (!pairs.length) html += '<p class="muted">No contact yet. Scouts, traders and settlers will meet eventually.</p>';
    for (const p of pairs) {
      const a = civs[p.a], b = civs[p.b];
      const chips = [];
      if (p.war) chips.push(`<span class="chip war">War since Y${Math.floor(p.warStart / CFG.TICKS_PER_YEAR) + 1}</span>`);
      if (p.trade) chips.push('<span class="chip trade">Trade agreement</span>');
      if (p.nonAggression) chips.push('<span class="chip peace">Non-aggression</span>');
      if (p.openBorders) chips.push('<span class="chip peace">Open borders</span>');
      if (p.alliance) chips.push('<span class="chip peace">Alliance</span>');
      if (!p.war && sim.tick < p.truceUntil) chips.push('<span class="chip">Truce</span>');
      html += `<div style="margin:6px 0 10px"><div><span style="color:${a.css}">${esc(a.name)}</span> <span class="muted">&amp;</span> <span style="color:${b.css}">${esc(b.name)}</span></div>
        <div class="chips">${chips.join('') || '<span class="chip">Neutral</span>'}</div>
        <div class="muted" style="font-size:12px;margin-top:4px">Trade volume ${fmt(p.tradeVolume)} · grudge ${p.grudge.toFixed(0)} · casualties ${p.casualties[0]} / ${p.casualties[1]} · border tension ${sim.borderTension(p.a, p.b).toFixed(2)}</div></div>`;
    }
    html += '<h3>Military</h3><table class="data"><thead><tr><th>Civilisation</th><th class="n">Soldiers</th><th class="n">Power</th><th class="n">Weariness</th><th class="n">Armies</th></tr></thead><tbody>' +
      civs.map((c) => `<tr><td style="color:${c.css}">${esc(c.name)}</td><td class="n">${c.soldiers}</td><td class="n">${fmt(c.milPower || 0)}</td><td class="n">${c.warWeariness.toFixed(0)}</td><td class="n">${sim.military.armies.filter((a) => a.civ === c.id).length}</td></tr>`).join('') + '</tbody></table>';
    return html;
  }

  tabCensus() {
    return `<div class="legend" id="chartLegend"></div>
      <h3>Population</h3><canvas class="chart" id="chPop"></canvas>
      <h3>Technologies known</h3><canvas class="chart" id="chTech"></canvas>
      <h3>Soldiers</h3><canvas class="chart" id="chSold"></canvas>
      <h3>Contentment</h3><canvas class="chart" id="chHappy"></canvas>
      <h3>Structures</h3><canvas class="chart" id="chBld"></canvas>`;
  }

  drawCharts() {
    const sim = this.sim;
    $('#chartLegend').innerHTML = sim.civs.map((c) => `<span><i style="background:${c.css}"></i>${esc(c.name)}</span>`).join('');
    const hist = sim.history;
    const draw = (id, key) => {
      const cv = $('#' + id);
      if (!cv) return;
      const dpr = window.devicePixelRatio || 1;
      const w = cv.clientWidth, h = cv.clientHeight;
      cv.width = w * dpr; cv.height = h * dpr;
      const ctx = cv.getContext('2d');
      ctx.scale(dpr, dpr);
      const padL = 38, padB = 16, padT = 6;
      let max = 1;
      for (const s of hist) for (const c of s.civs) max = Math.max(max, c[key] || 0);
      const niceMax = niceCeil(max);
      ctx.font = '10px ' + getComputedStyle(document.body).getPropertyValue('--f-mono');
      ctx.fillStyle = '#62706f'; ctx.strokeStyle = 'rgba(58,73,85,0.5)'; ctx.lineWidth = 1;
      for (let k = 0; k <= 4; k++) {
        const y = padT + (h - padT - padB) * (1 - k / 4);
        ctx.beginPath(); ctx.moveTo(padL, y + 0.5); ctx.lineTo(w, y + 0.5); ctx.stroke();
        ctx.textAlign = 'right'; ctx.fillText(fmt(niceMax * k / 4), padL - 4, y + 3);
      }
      if (hist.length < 2) { ctx.textAlign = 'left'; ctx.fillText('Charts fill in as the years pass.', padL + 6, h / 2); return; }
      const n = hist.length;
      ctx.textAlign = 'center';
      ctx.fillText('Y' + hist[0].year, padL + 10, h - 3); ctx.fillText('Y' + hist[n - 1].year, w - 14, h - 3);
      sim.civs.forEach((c, ci) => {
        ctx.strokeStyle = c.css; ctx.lineWidth = 1.6; ctx.beginPath();
        let started = false;
        hist.forEach((s, k) => {
          const v = s.civs[ci] ? s.civs[ci][key] || 0 : null;
          if (v === null) return;
          const x = padL + (w - padL - 4) * (k / (n - 1)), y = padT + (h - padT - padB) * (1 - v / niceMax);
          if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
        });
        ctx.stroke();
        const last = hist[n - 1].civs[ci];
        if (last) { const y = padT + (h - padT - padB) * (1 - (last[key] || 0) / niceMax); ctx.fillStyle = c.css; ctx.beginPath(); ctx.arc(w - 4, y, 2.5, 0, 6.3); ctx.fill(); }
      });
    };
    draw('chPop', 'pop'); draw('chTech', 'techs'); draw('chSold', 'soldiers'); draw('chHappy', 'happy'); draw('chBld', 'buildings');
  }

  onTabClick(e) {
    const f = e.target.closest('[data-cfilter]');
    if (f) { this.chronFilter = f.dataset.cfilter; this.renderTab(true); return; }
    const ency = e.target.closest('[data-ency]');
    if (ency) { this.showEncyclopedia(ency.dataset.ency); return; }
    if (e.target.closest('[data-open="techtree"]')) { this.showTechTree(); return; }
    const town = e.target.closest('[data-town]');
    if (town) { const t = this.sim.towns[+town.dataset.town]; if (t) this.flyTo(t.cx, t.cy, 4); return; }
    const li = e.target.closest('li.loc');
    if (li) this.flyTo(+li.dataset.x, +li.dataset.y, 6);
  }

  toggleDirector() {
    this.director = !this.director;
    $('#btnDirector').setAttribute('aria-pressed', this.director);
    this.directorNext = 0;
  }

  // Director mode: cut to the latest dramatic event, otherwise follow a random citizen.
  directorTick(now) {
    if (!this.director) return;
    const sim = this.sim, r = this.r, P = sim.people;
    if (this.pendingShot && now > (this.directorHold || 0)) {
      const e = this.pendingShot; this.pendingShot = null;
      r.cam.x = e.x; r.cam.y = e.y; r.cam.zi = Math.max(r.cam.zi, 5);
      this.follow = false; r.selected = -1;
      this.directorHold = now + 9000; this.directorNext = now + 12000;
      return;
    }
    if (now < (this.directorNext || 0)) return;
    this.directorNext = now + 15000;
    for (let k = 0; k < 50; k++) {
      const i = (Math.random() * P.hwm) | 0;
      if (P.civ[i] < 0 || P.age[i] < CFG.ADULT_AGE || P.state[i] === S.SLEEP) continue;
      r.selected = i; r.selectedBuilding = -1; this.follow = true; r.cam.zi = 7;
      this.showInspector();
      break;
    }
  }

  onChronicle(e) {
    if (this.director && e.x !== undefined && (TOAST_KINDS.has(e.kind) || e.kind === 'disaster' || e.kind === 'expansion' || e.kind === 'transport')) this.pendingShot = e;
    if (!TOAST_KINDS.has(e.kind)) return;
    const box = $('#toasts');
    const el = document.createElement('div');
    el.className = 'toast ' + (e.kind === 'war' || e.kind === 'conquest' || e.kind === 'rebellion' ? 'war' : e.kind === 'peace' ? 'peace' : '');
    el.textContent = `Year ${e.year} — ${e.text}`;
    box.prepend(el);
    while (box.children.length > 3) box.lastChild.remove();
    setTimeout(() => el.remove(), 6500);
  }

  // ---------------------------------------------------------------- inspector
  showInspector() {
    const sim = this.sim, P = sim.people, r = this.r;
    const el = $('#inspector');
    el.hidden = false;
    if (r.selected >= 0) {
      const i = r.selected;
      if (P.civ[i] < 0) {
        const d = sim.selectedDeath;
        el.innerHTML = `<h2>${d ? esc(d.name) : 'This person'}</h2><p class="muted">Died${d ? ` aged ${Math.floor(d.age)} — ${esc(d.cause)}` : ''}.</p><div class="actions"><button class="btn" data-act="close">Close</button></div>`;
        return;
      }
      const civ = sim.civs[P.civ[i]];
      const prof = PROFESSIONS[P.prof[i]];
      const town = sim.towns[P.town[i]];
      const home = P.home[i] >= 0 ? sim.buildings[P.home[i]] : null;
      const work = P.work[i] >= 0 ? sim.buildings[P.work[i]] : null;
      const adult = P.age[i] >= CFG.ADULT_AGE;
      const role = !adult ? (P.age[i] < 5 ? 'Infant' : 'Child') : P.age[i] >= CFG.ELDER_AGE && !work ? 'Elder' : prof.name;
      let task = STATE_NAMES[P.state[i]] || 'idle';
      if (P.state[i] === S.MOVE) task = `walking → ${ACT_NAMES[P.act[i]] || 'somewhere'}`;
      if (P.army[i] >= 0) task += ' (in an army)';
      const beliefs = [];
      for (let s = 0; s < NB; s++) beliefs.push([s, P.b(i, s)]);
      beliefs.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
      const partner = P.partner[i] >= 0 && P.civ[P.partner[i]] >= 0 ? sim.personName(P.partner[i]) : null;
      const kids = P.flags[i] >> 5;
      el.innerHTML = `<div class="title"><span class="swatch" style="background:${civ.css}"></span><h2>${esc(sim.personName(i))}</h2></div>
        <div class="muted" style="font-size:13px">${esc(role)} of ${esc(town ? town.name : 'the wilds')} · ${P.sex[i] ? 'woman' : 'man'}, ${Math.floor(P.age[i])} · ${esc(civ.name)}${P.flags[i] & 16 ? ' · <span style="color:var(--brass-2)">celebrated</span>' : ''}</div>
        <dl class="kv"><dt>Doing</dt><dd>${esc(task)}</dd>
          ${work ? `<dt>Works at</dt><dd>${esc(work.def.name)}</dd>` : ''}
          <dt>Home</dt><dd>${home ? esc(home.def.name) : 'homeless'}</dd>
          ${P.carryAmt[i] > 0 ? `<dt>Carrying</dt><dd>${P.carryAmt[i].toFixed(0)} ${esc(RESOURCES[P.carryRes[i]].name)}</dd>` : ''}
          ${partner ? `<dt>Partner</dt><dd>${esc(partner)}</dd>` : ''}
          ${kids ? `<dt>Children</dt><dd>${kids}</dd>` : ''}
          ${P.sick[i] > 0 ? '<dt>Illness</dt><dd style="color:var(--bad)">infected with plague</dd>' : ''}
          ${P.flags[i] & 2 ? '<dt>Status</dt><dd style="color:var(--bad)">wanted for theft</dd>' : ''}</dl>
        <div class="meters">${meter('Health', P.health[i], 'var(--good)')}${meter('Fed', P.food[i], 'var(--brass)')}${meter('Content', P.happy[i], 'var(--info)')}${meter('Loyalty', P.loyalty[i], '#b98be0')}${meter('Education', P.edu[i], '#6fc3c3')}${meter('Skill', P.skill[i], '#c9a36b')}</div>
        <h3>Strongest convictions</h3>
        <div class="pbelief">${beliefs.slice(0, 7).map(([s, v]) => `<span>${esc(v >= 0 ? SCALES[s].pos.name : SCALES[s].neg.name)} <span class="muted num">${v > 0 ? '+' : ''}${v}</span></span><div class="track"><span class="mark" style="left:${50 + v / 2}%;background:${civ.css}"></span></div>`).join('')}</div>
        <div class="actions"><button class="btn ${this.follow ? 'primary' : ''}" data-act="follow">${this.follow ? 'Following' : 'Follow'} (F)</button><button class="btn" data-act="prof">About ${esc(prof.name)}</button><button class="btn" data-act="close">Close</button></div>`;
      return;
    }
    const b = r.selectedBuilding >= 0 ? sim.buildings[r.selectedBuilding] : null;
    if (!b) { el.hidden = true; return; }
    const civ = sim.civs[b.civ];
    const town = sim.towns[b.town];
    const workers = {};
    for (const w of b.workers) { const n = PROFESSIONS[P.prof[w]].name; workers[n] = (workers[n] || 0) + 1; }
    const slots = Object.entries(b.slots).map(([pid, n]) => `${PROFESSIONS[pid].name} ${b.workers.filter((w) => P.prof[w] === +pid).length}/${n}`).join(', ');
    let extra = '';
    if (b.def.center && town) {
      const top = RESOURCES.map((r_) => [r_, town.stock[r_.idx]]).filter((x) => x[1] >= 1).sort((a, b_) => b_[1] - a[1]).slice(0, 12);
      extra = `<h3>${esc(town.name)} stores</h3><div class="chips">${top.map(([r_, n]) => `<span class="chip" title="${esc(r_.name)}"><span style="display:inline-block;width:7px;height:7px;background:${r_.color};margin-right:4px"></span>${esc(r_.name)} ${fmt(n)}</span>`).join('')}</div>`;
    }
    el.innerHTML = `<div class="title"><span class="swatch" style="background:${civ.css}"></span><h2>${esc(b.def.name)}</h2></div>
      <div class="muted" style="font-size:13px">${esc(town ? town.name : '')} · ${esc(civ.name)}${b.banned ? ' · <span style="color:var(--bad)">outlawed</span>' : ''}</div>
      <dl class="kv"><dt>State</dt><dd>${b.built ? (b.fire > 0 ? '<span style="color:var(--bad)">on fire!</span>' : 'standing') : `under construction ${Math.round(b.progress * 100)}% · ${b.builders} builders`}</dd>
        <dt>Condition</dt><dd>${Math.round(b.hp)} / ${b.maxHp}</dd>
        ${b.capacity ? `<dt>Residents</dt><dd>${b.residents.length} / ${b.capacity}</dd>` : ''}
        ${slots ? `<dt>Jobs</dt><dd>${esc(slots)}</dd>` : ''}
        ${b.def.recipes ? `<dt>Makes</dt><dd>${b.def.recipes.map((rc) => recipeText(rc)).join('<br>')}</dd>` : ''}</dl>
      <p style="font-size:13px;margin:8px 0 0">${esc(b.def.desc || '')}</p>${extra}
      <div class="actions"><button class="btn" data-act="struct">Encyclopedia</button><button class="btn" data-act="close">Close</button></div>`;
  }

  onInspectorClick(e) {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    const r = this.r, sim = this.sim;
    switch (a.dataset.act) {
      case 'close': r.selected = -1; r.selectedBuilding = -1; this.follow = false; $('#inspector').hidden = true; break;
      case 'follow': this.follow = !this.follow; this.showInspector(); break;
      case 'prof': this.showEncyclopedia('prof:' + PROFESSIONS[sim.people.prof[r.selected]].id); break;
      case 'struct': { const b = sim.buildings[r.selectedBuilding]; if (b) this.showEncyclopedia('struct:' + b.def.id); break; }
    }
  }

  // ---------------------------------------------------------------- modals
  modal(title, body, narrow = true) {
    const m = $('#modal');
    m.innerHTML = `<div class="sheet ${narrow ? 'narrow' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header><h2>${esc(title)}</h2><button class="btn" data-close>Close</button></header><div class="body">${body}</div></div>`;
    m.hidden = false;
    return m;
  }

  showHelp() {
    const n = { S: STRUCTURES.length, T: TECHS.length, B: BELIEFS.length, P: PROFESSIONS.length, R: RESOURCES.length };
    this.modal('How to watch', `
      <p>Every pixel moving on this map is one person. Two peoples wake on opposite shores of a continent and build everything themselves: they forage, farm, mine, trade, pray, argue, invent, fall in love, fall ill, go to war and make peace. You are the spectator.</p>
      <p>The world holds <b>${n.S} structures</b>, <b>${n.T} technologies</b> across ten eras, <b>${n.B} beliefs</b> on 50 opposing scales, <b>${n.P} professions</b> and <b>${n.R} resources</b>. Every person carries their own position on all 50 belief scales; those convictions steer what they do: which job they take, whether they pray, steal, emigrate, enlist or share food. When a civilisation's average passes a threshold it adopts the belief, which changes its laws, what it builds, what it researches, and what it outlaws.</p>
      <h3>Controls</h3>
      <div class="helpgrid">
        <div><span class="kbd">Drag</span> / <span class="kbd">WASD</span> pan the map</div>
        <div><span class="kbd">Wheel</span> / <span class="kbd">+</span> <span class="kbd">−</span> / pinch zoom (pixel-exact steps)</div>
        <div><span class="kbd">Click</span> a pixel to inspect a person or building</div>
        <div><span class="kbd">F</span> follow the selected person</div>
        <div><span class="kbd">Space</span> pause · <span class="kbd">1</span>–<span class="kbd">8</span> speed</div>
        <div><span class="kbd">T</span> territory · <span class="kbd">N</span> night · <span class="kbd">L</span> labels</div>
        <div><span class="kbd">G</span> technology tree · <span class="kbd">Esc</span> deselect</div>
        <div><span class="kbd">V</span> Director: the camera chases the story</div>
        <div>Click a civilisation card to fly to its capital</div>
      </div>
      <h3>Reading the map</h3>
      <h3>This world</h3>
      <p>Continent seed <span class="num">${this.seed}</span>. <button class="btn primary" data-newworld>Generate a new continent</button></p>
      <p>People take their civilisation's colour, shaded by trade: soldiers glow brightest, children are paler, the sick turn green and celebrated figures gold. Footpaths appear wherever people keep walking; road builders pave the busiest ones, and later come bridges, railways, ships and aircraft. At night the windows light up. Use the <i>People</i> menu to colour everyone by profession, a belief scale, happiness, health or age.</p>`);
  }

  showTechTree() {
    const sim = this.sim;
    const cols = ERAS.map((e, era) => {
      const ts = TECHS.filter((t) => t.era === era);
      return `<div style="display:flex;flex-direction:column;gap:6px"><div class="era">${esc(e)}</div>${ts.map((t) => `<div class="tech ${sim.civs.some((c) => c.bans.has('tech:' + t.id)) ? 'banned' : ''}" data-ency="tech:${t.id}" data-tid="${t.id}" title="${esc(t.desc || '')}">${esc(t.name)}<div class="dots">${sim.civs.map((c) => `<i style="background:${c.techs[t.idx] ? c.css : c.researching === t.idx ? 'transparent' : 'transparent'};border-color:${c.researching === t.idx ? c.css : ''}" title="${esc(c.name)}"></i>`).join('')}</div></div>`).join('')}</div>`;
    }).join('');
    const m = this.modal('Technology tree', `<p class="muted" style="font-size:13px">Filled squares: known. Outlined: being researched. Dashed border: outlawed by someone. Click any technology for details.</p><div class="techwrap" id="techwrap"><svg class="techsvg" id="techsvg"></svg><div class="techgrid">${cols}</div></div>`, false);
    // prerequisite lines
    requestAnimationFrame(() => {
      const wrap = $('#techwrap', m), svg = $('#techsvg', m);
      const grid = wrap.querySelector('.techgrid');
      svg.setAttribute('width', grid.scrollWidth); svg.setAttribute('height', grid.scrollHeight);
      const pos = {};
      const wr = grid.getBoundingClientRect();
      for (const el of grid.querySelectorAll('[data-tid]')) { const r = el.getBoundingClientRect(); pos[el.dataset.tid] = { x: r.left - wr.left, y: r.top - wr.top, w: r.width, h: r.height }; }
      let d = '';
      for (const t of TECHS) for (const q of t.req) {
        const a = pos[q], b = pos[t.id];
        if (!a || !b) continue;
        const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2;
        const mx = (x1 + x2) / 2;
        d += `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2} `;
      }
      svg.innerHTML = `<path d="${d}" fill="none" stroke="rgba(214,162,72,0.28)" stroke-width="1"/>`;
    });
  }

  showEncyclopedia(key) {
    const sim = this.sim;
    const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    const civStates = (fn) => `<div class="chips">${sim.civs.map((c) => `<span class="chip" style="color:${c.css}">${esc(c.adjective || c.name)}: ${esc(fn(c))}</span>`).join('')}</div>`;
    if (kind === 'tech') {
      const t = TECHS.find((x) => x.id === id);
      const unlocksS = STRUCTURES.filter((s) => s.tech === t.id);
      const unlocksP = PROFESSIONS.filter((p) => p.tech === t.id);
      const leadsTo = TECHS.filter((x) => x.req.includes(t.id));
      this.modal(t.name, `<p class="muted">${esc(ERAS[t.era])} · costs about ${Math.round(sim.research.cost(sim.civs[0], t))} research points</p><p>${esc(t.desc || '')}</p>
        ${t.req.length ? `<h3>Requires</h3><div class="chips">${t.req.map((r) => `<button class="chip link" data-ency="tech:${r}">${esc(TECHS.find((x) => x.id === r).name)}</button>`).join('')}</div>` : ''}
        ${t.needs.length ? `<h3>Needs access to</h3><div class="chips">${t.needs.map((n) => `<span class="chip">${esc(RESOURCES.find((r) => r.id === n).name)}</span>`).join('')}</div>` : ''}
        ${unlocksS.length ? `<h3>Unlocks structures</h3><div class="chips">${unlocksS.map((s) => `<button class="chip link" data-ency="struct:${s.id}">${esc(s.name)}</button>`).join('')}</div>` : ''}
        ${unlocksP.length ? `<h3>Unlocks professions</h3><div class="chips">${unlocksP.map((p) => `<button class="chip link" data-ency="prof:${p.id}">${esc(p.name)}</button>`).join('')}</div>` : ''}
        ${Object.keys(t.fx).length ? `<h3>Effects</h3><div class="chips">${Object.entries(t.fx).map(([k, v]) => `<span class="chip">${esc(k)} ${v > 0 ? '+' : ''}${v}</span>`).join('')}</div>` : ''}
        ${Object.keys(t.flags).length ? `<h3>Enables</h3><div class="chips">${Object.entries(t.flags).map(([k, v]) => `<span class="chip">${esc(flagName(k, v))}</span>`).join('')}</div>` : ''}
        ${leadsTo.length ? `<h3>Leads to</h3><div class="chips">${leadsTo.map((x) => `<button class="chip link" data-ency="tech:${x.id}">${esc(x.name)}</button>`).join('')}</div>` : ''}
        <h3>Status</h3>${civStates((c) => (c.techs[t.idx] ? `known since year ${Math.max(1, Math.round(c.techYear[t.idx]))}` : c.bans.has('tech:' + t.id) ? 'outlawed' : c.researching === t.idx ? 'researching' : 'unknown'))}`);
    } else if (kind === 'struct') {
      const s = STRUCTURES.find((x) => x.id === id);
      const jobs = Object.entries(s.jobs).map(([k, n]) => (k[0] === '@' ? `${n} × best ${k.slice(1)}` : `${n} × ${PROFESSIONS.find((p) => p.id === k).name}`));
      this.modal(s.name, `<p class="muted">${esc(s.cat)} · ${s.size[0]}×${s.size[1]} px · ${s.tech ? 'requires ' + esc(TECHS.find((t) => t.id === s.tech).name) : 'available from the start'}</p><p>${esc(s.desc || '')}</p>
        <h3>Cost</h3><div class="chips">${Object.entries(s.cost).map(([k, n]) => `<span class="chip">${n} ${esc(RESOURCES.find((r) => r.id === k).name)}</span>`).join('')}<span class="chip">${s.work} work</span></div>
        ${jobs.length ? `<h3>Jobs</h3><div class="chips">${jobs.map((j) => `<span class="chip">${esc(j)}</span>`).join('')}</div>` : ''}
        ${s.housing ? `<h3>Housing</h3><p>${s.housing} residents</p>` : ''}
        ${s.recipes ? `<h3>Production</h3><p>${s.recipes.map((rc) => recipeText(rc)).join('<br>')}</p>` : ''}
        ${s.field ? `<h3>Fields</h3><p>Yields ${esc(s.field.out)} by season and soil fertility.</p>` : ''}
        ${s.harvest ? `<h3>Harvests</h3><p>${s.harvest.animals ? 'Wild game' : s.harvest.dep.map((d) => DEPOSITS[d].name).join(', ')} within ${s.harvest.radius} px.</p>` : ''}
        ${s.aura && s.aura.beliefs ? `<h3>Influences beliefs within ${s.aura.radius} px</h3><div class="chips">${Object.entries(s.aura.beliefs).map(([k, v]) => { const sc = SCALES.find((x) => x.key === k); return `<span class="chip">→ ${esc(v > 0 ? sc.pos.name : sc.neg.name)}</span>`; }).join('')}</div>` : ''}
        <h3>Standing</h3>${civStates((c) => (c.bans.has(s.id) ? `outlawed (${c.banReasons[s.id] || ''})` : `${c.structCount[s.idx]} built`))}`);
    } else if (kind === 'prof') {
      const p = PROFESSIONS.find((x) => x.id === id);
      const where = STRUCTURES.filter((s) => s.jobs[p.id] || (p.branch && s.jobs['@' + p.branch]));
      this.modal(p.name, `<p class="muted">${esc(p.cat)}${p.tech ? ' · requires ' + esc(TECHS.find((t) => t.id === p.tech).name) : ''}</p><p>${esc(p.desc || '')}</p>
        ${where.length ? `<h3>Works at</h3><div class="chips">${where.map((s) => `<button class="chip link" data-ency="struct:${s.id}">${esc(s.name)}</button>`).join('')}</div>` : ''}
        ${Object.keys(p.fx).length ? `<h3>Produces per shift</h3><div class="chips">${Object.entries(p.fx).map(([k, v]) => `<span class="chip">${esc(k)} ${v}</span>`).join('')}</div>` : ''}
        ${Object.keys(p.aff).length ? `<h3>Attracts people who lean towards</h3><div class="chips">${Object.entries(p.aff).map(([k, v]) => { const sc = SCALES.find((x) => x.key === k); return `<span class="chip">${esc(v > 0 ? sc.pos.name : sc.neg.name)}</span>`; }).join('')}</div>` : ''}
        ${Object.keys(p.inf).length ? `<h3>Shapes the worker (and listeners) towards</h3><div class="chips">${Object.entries(p.inf).map(([k, v]) => { const sc = SCALES.find((x) => x.key === k); return `<span class="chip">${esc(v > 0 ? sc.pos.name : sc.neg.name)}</span>`; }).join('')}</div>` : ''}
        ${p.mil ? `<h3>Combat</h3><div class="chips"><span class="chip">attack ${p.mil.atk}</span><span class="chip">defence ${p.mil.def}</span><span class="chip">range ${p.mil.range}</span><span class="chip">speed ×${p.mil.speed}</span>${p.mil.siege ? `<span class="chip">siege ×${p.mil.siege}</span>` : ''}</div>` : ''}
        ${p.equip ? `<h3>Equipment</h3><div class="chips">${Object.entries(p.equip).map(([k, n]) => `<span class="chip">${n} ${esc(k)}</span>`).join('')}</div>` : ''}
        <h3>Workforce</h3>${civStates((c) => `${Math.max(0, c.profCount[p.idx])}${c.bans.has(p.id) ? ' (outlawed)' : ''}`)}`);
    } else if (kind === 'belief') {
      const key2 = id.slice(0, -1), sign = id.slice(-1) === '+' ? 1 : -1;
      const sc = SCALES.find((x) => x.key === key2);
      const pole = sign > 0 ? sc.pos : sc.neg, other = sign > 0 ? sc.neg : sc.pos;
      this.modal(pole.name, `<p class="muted">Belief scale: ${esc(sc.neg.name)} ↔ ${esc(sc.pos.name)} · opposite of <button class="link" data-ency="belief:${key2}${sign > 0 ? '-' : '+'}">${esc(other.name)}</button></p>
        <h3>How believers behave</h3><p>${esc(pole.fx)}</p>
        ${Object.keys(pole.mods || {}).length ? `<h3>When a civilisation adopts it</h3><div class="chips">${Object.entries(pole.mods).map(([k, v]) => `<span class="chip">${esc(k)} ${v > 0 ? '+' : ''}${v}</span>`).join('')}</div>` : ''}
        ${(pole.bans || []).length ? `<h3>Strong believers outlaw</h3><div class="chips">${pole.bans.map((b) => `<span class="chip ban">⊘ ${esc(banName(b))}</span>`).join('')}</div>` : ''}
        ${Object.keys(pole.ai || {}).length ? `<h3>Builders favour</h3><div class="chips">${Object.entries(pole.ai).map(([k, v]) => `<span class="chip">${esc(k)} ${v > 0 ? '↑' : '↓'}</span>`).join('')}</div>` : ''}
        <h3>Where each civilisation stands</h3>${civStates((c) => `${c.beliefAvg[sc.idx] > 0 ? '+' : ''}${c.beliefAvg[sc.idx].toFixed(0)}${c.adopted[sc.idx] === sign ? ' · adopted' : ''}`)}`);
    }
  }
}

function meter(label, v, col) {
  const x = Math.max(0, Math.min(100, v));
  return `<span>${label}</span><div class="bar"><i style="width:${x}%;background:${col}"></i></div><span class="num muted">${Math.round(x)}</span>`;
}
function recipeText(rc) {
  const i = Object.entries(rc.in).map(([k, n]) => `${n} ${k.replace('_', ' ')}`).join(' + ');
  const o = rc.power ? `${rc.power} power` : Object.entries(rc.out).map(([k, n]) => `${n} ${k.replace('_', ' ')}`).join(' + ') || 'good cheer';
  return `${esc(i)} → ${esc(o)}${rc.tech ? ` <span class="muted">(${esc(TECHS.find((t) => t.id === rc.tech).name)})</span>` : ''}`;
}
function banName(b) {
  if (b.startsWith('tech:')) { const t = TECHS.find((x) => x.id === b.slice(5)); return t ? t.name + ' research' : b; }
  const s = STRUCTURES.find((x) => x.id === b);
  if (s) return s.name;
  const p = PROFESSIONS.find((x) => x.id === b);
  return p ? p.name + 's' : b;
}
function flagName(k, v) {
  return ({ cart: 'Carts', horses: 'Horses & riders', ships: `Ships (tier ${v})`, bridge: 'Bridges', roadLevel: ['', 'Footpaths', 'Stone roads', 'Paved roads', 'Highways'][v], rail: 'Railways', power: 'Electric power', flight: 'Aircraft', trucks: 'Trucks', honey: 'Honey' })[k] || k;
}
function niceCeil(x) {
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= x) return m * p;
  return 10 * p;
}
