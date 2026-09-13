/*! coriolis 0.1.0 — weather events, drawn as dots. Canvas 2D, no dependencies. MIT. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Coriolis = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ helpers */
  const TAU = Math.PI * 2;
  const E = (n, s) => { const t = Math.sin(n * 12.9898 + s * 78.233) * 43758.5453; return t - Math.floor(t); };
  const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const frac = v => v - Math.floor(v);
  const smooth = v => { v = clamp01(v); return v * v * (3 - 2 * v); };
  // 2-d value noise, smooth, for cloud texture
  const noise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y); let fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = E(xi, yi), b = E(xi + 1, yi), c = E(xi, yi + 1), d = E(xi + 1, yi + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  // dot-size rule shared with ephemeris, so the two libraries match on a page
  const radiusScale = size => (size / 300) ** 0.6;
  const countScale = (size, pow, cap) => Math.min(cap, Math.max(0.25, (size / 64) ** pow));

  /* ------------------------------------------------------------------ colour */
  // Four base colours make a palette: cold is low, thin cloud; hot is the highest tops; glow is the
  // soft light under the core. Read off CSS custom properties (--wx-cold … --wx-glow) or passed as
  // opts.palette = { cold, mid, hot, glow } as [r, g, b].
  const KEYS = ['cold', 'mid', 'hot', 'glow'];
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const buildPal = q => ({ ramp: [q.cold, q.mid, q.hot], glow: q.glow });
  // colour at heat h in [0,1]: cold → mid → hot
  const ramp = (r, h) => {
    const [a, b, k] = h < 0.5 ? [r[0], r[1], h * 2] : [r[1], r[2], h * 2 - 1];
    return [Math.round(a[0] + (b[0] - a[0]) * k), Math.round(a[1] + (b[1] - a[1]) * k), Math.round(a[2] + (b[2] - a[2]) * k)];
  };
  const parseCol = v => {
    v = (v || '').trim(); let m;
    if ((m = /^#([0-9a-f]{3})$/i.exec(v))) return [...m[1]].map(h => parseInt(h + h, 16));
    if ((m = /^#([0-9a-f]{6})$/i.exec(v))) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
    if ((m = /^rgba?\(([^)]+)\)$/i.exec(v))) return m[1].split(/[\s,\/]+/).slice(0, 3).map(Number);
    return null;
  };
  // A palette if any --wx-* variable reaches the element (inherited counts), else null.
  const readPalette = (el, defaults) => {
    const cs = getComputedStyle(el), q = {}; let any = false;
    for (const k of KEYS) { const c = parseCol(cs.getPropertyValue('--wx-' + k)); q[k] = c || defaults[k]; if (c) any = true; }
    return any ? q : null;
  };

  /* ------------------------------------------------------------------ shared painters */
  // One dot. Colour modes use `col`; ink uses `white` (0 = full ink, inverted on a dark ground).
  const dotPainter = (ctx, ink, dark) => (x, y, r, col, a, white) => {
    if (a < 0.02) return;
    if (a > 1) a = 1;
    if (ink) { const v = Math.round((dark ? 1 - white : white) * 255); ctx.fillStyle = `rgba(${v},${v},${v},${a.toFixed(3)})`; }
    else ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${a.toFixed(3)})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  };
  // Every mode paints its soft glow (radial gradients under the dots) only when !ink and
  // opts.glow !== false, so glow:false leaves just the dots on a clear canvas.
  // Optional sea ground: a pill of deep water under the cloud. Leaves the clip set.
  function paintSea(ctx, W, size) {
    const half = size / 2, cx = W / 2, R = half * 0.98;
    ctx.beginPath(); ctx.roundRect(cx - W / 2 + half - R, half - R, W - 2 * (half - R), 2 * R, R); ctx.clip();
    const bg = ctx.createRadialGradient(cx, half * 0.8, 0, cx, half, Math.max(R, W / 2));
    bg.addColorStop(0, '#0c2547'); bg.addColorStop(1, '#040c1a');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, size);
  }
  function paintRim(ctx, W, size) {
    const half = size / 2, cx = W / 2, R = half * 0.98;
    ctx.strokeStyle = 'rgba(150,175,220,0.18)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(cx - W / 2 + half - R + 0.5, half - R + 0.5, W - 2 * (half - R) - 1, 2 * R - 1, R - 0.5); ctx.stroke();
  }

  /* ================================================================== cyclone */
  // A tropical cyclone as the satellite sees it: a clear eye, the eyewall's ring of the tallest cloud,
  // a solid overcast over the core, and rainbands spiralling in from the edge. Cloud dots ride the
  // wind, fastest at the eyewall and slowing outward, while the band pattern turns more slowly, so
  // cells stream along the bands and into the core. `hemisphere: 'south'` spins it clockwise.
  // `cat` (1–5) is how organised it is: a category 5 has a pinhole eye and crisp symmetric bands, a
  // category 1 is a ragged lump with no eye and most of its cloud thrown to one side.
  const CLOUD = { cold: [70, 95, 135], mid: [175, 192, 215], hot: [255, 255, 255], glow: [110, 145, 200] };
  function drawCyclone(ctx, size, t, dark, o = {}) {
    const W = o.w ?? size, half = size / 2, cx = W / 2;
    const ink = !!o.ink, pal = buildPal(o.palette || CLOUD);
    const M = radiusScale(size), lite = o.lite ? 0.5 : 1;
    const cat = o.cat ?? 4, org = clamp01((cat - 1) / 4);            // 0 ragged … 1 textbook
    const dir = (o.hemisphere || 'north')[0] === 's' ? 1 : -1;       // canvas y points down, so +1 turns clockwise: the south
    // outer edge of the cloud; a wide canvas lets the bands reach past the top and bottom, cropped like a satellite window
    const R = Math.min(half * 0.96 * Math.min(1.3, Math.max(1, W / size) ** 0.5), W * 0.48) * (o.reach ?? 1);
    const Re = R * (o.eye ?? 0.08 * org);                            // eye radius (0: no clear eye)
    const Rw = Math.max(Re * 1.6, R * 0.07);                         // eyewall, where the wind peaks
    const Rc = R * (0.32 + 0.18 * org);                              // central dense overcast
    const Rwall = Re + Math.max(0.35 * Re, 0.025 * R);               // the eyewall's bright ring
    const arms = o.bands ?? (org > 0.5 ? 3 : 2);
    const k = 1 / Math.tan((o.pitch ?? 22) * Math.PI / 180);         // log-spiral tightness from the inflow angle
    const omega = o.omega ?? 1.1, inflow = o.inflow ?? 0.012;
    const Wp = dir * omega * 0.26 * t;                               // the band pattern turns slower than the wind
    const shear = E(cat, 9.1) * TAU;                                 // where a weak storm piles its cloud
    const N = Math.round((o.n ?? 1000) * countScale(size, 1.3, 20) * (R / (half * 0.96)) ** 1.5 * lite * (ink ? 0.35 : 1));
    const rBase = (o.rBase ?? (ink ? 1.25 : 1.0)) * M, rDepth = (o.rDepth ?? (ink ? 1.2 : 1.3)) * M, rMin = 0.3;

    ctx.save();
    if (o.ground) paintSea(ctx, W, size);
    ctx.translate(cx, half);
    ctx.globalCompositeOperation = ink ? 'source-over' : 'lighter';
    const dot = dotPainter(ctx, ink, dark);

    if (!ink && o.glow !== false) {   // the core's overcast glows; the bands don't
      const g = ctx.createRadialGradient(0, 0, Re, 0, 0, Rc * 1.6);
      g.addColorStop(0, rgba(pal.glow, 0.32)); g.addColorStop(0.5, rgba(pal.glow, 0.12)); g.addColorStop(1, rgba(pal.glow, 0));
      ctx.fillStyle = g; ctx.fillRect(-W, -size, 2 * W, 2 * size);
    }

    for (let i = 0; i < N; i++) {
      const u = frac(E(i, 1.1) - t * inflow);                        // spirals in, respawns at the rim
      const r = R * u ** 0.7;
      if (r < Re && E(i, 5.5) < org) continue;                       // the eye: clear in a strong storm
      const w = r < Rw ? omega : omega * (Rw / r) ** 0.85;           // wind: solid inside the eyewall, decays out
      const th = E(i, 2.2) * TAU + dir * w * t;
      const x = r * Math.cos(th), y = r * Math.sin(th);
      // rainbands: trailing log spirals in the pattern's frame, ragged with noise
      const b = frac((dir * (th - Wp) + k * Math.log(Math.max(r, Rw) / Rw)) * arms / TAU);
      const dc = Math.min(b, 1 - b) * 2;                             // 0 on a band's spine, 1 between bands
      const tex = noise(x / R * 5 + t * 0.04, y / R * 5), fine = noise(x / R * 13 + 7, y / R * 13 - t * 0.03);
      let band = smooth(1 - dc / 0.75) * (0.3 + 0.35 * org + (0.7 - 0.35 * org) * tex);
      band *= 1 - (1 - org) * 0.8 * (1 - Math.cos(th - shear)) / 2;  // a weak storm is lopsided
      const core = smooth((Rc - r) / (Rc * 0.4));                    // solid overcast, feathering out at its edge
      const wall = r >= Re && r < Rwall ? 1 : 0;
      let a = Math.max(band * (0.3 + 0.7 * (1 - u) ** 0.5), core * 0.7, wall * 0.9, 0.06 * tex) * (0.6 + 0.4 * fine);
      if (r < Re) a *= 0.25;                                         // low cloud left in a ragged eye
      const heat = clamp01(0.12 + 0.5 * band + 0.55 * core + 0.4 * wall);   // high, cold tops are white
      const col = ink ? null : ramp(pal.ramp, heat);
      dot(x, y, Math.max(rMin, rBase + rDepth * heat), col, a, ink ? 0.55 * (1 - heat) : 0);
    }
    ctx.restore();
    if (o.ground) paintRim(ctx, W, size);
  }

  /* ================================================================== registry + driver */
  const MODES = {
    cyclone: { draw: drawCyclone, defaults: CLOUD, state: 'spinning' }
  };
  const STATE_TO_MODE = Object.fromEntries(Object.entries(MODES).map(([m, v]) => [v.state, m]));

  // Named storms: a mode plus the options that make it that particular event.
  // <canvas class=wx data-wx-body=tracy>. Data attributes still override the body's options.
  const S = { hemisphere: 'south' }, Nh = { hemisphere: 'north' };
  const BODIES = {
    // cyclones (Australia, the Pacific, the Indian Ocean)
    'tracy':    { mode: 'cyclone', opts: { ...S, cat: 4, reach: 0.55, eye: 0.06, bands: 2, omega: 1.4 } },
    'yasi':     { mode: 'cyclone', opts: { ...S, cat: 5, eye: 0.09, bands: 3 } },
    'larry':    { mode: 'cyclone', opts: { ...S, cat: 4, eye: 0.07 } },
    'debbie':   { mode: 'cyclone', opts: { ...S, cat: 4, eye: 0.13, omega: 0.9 } },
    'winston':  { mode: 'cyclone', opts: { ...S, cat: 5, eye: 0.07, bands: 3, omega: 1.3 } },
    'freddy':   { mode: 'cyclone', opts: { ...S, cat: 4, eye: 0.08, bands: 3 } },
    'alfred':   { mode: 'cyclone', opts: { ...S, cat: 2 } },
    // hurricanes (the Atlantic, the eastern Pacific)
    'katrina':  { mode: 'cyclone', opts: { ...Nh, cat: 5, eye: 0.1, bands: 3 } },
    'andrew':   { mode: 'cyclone', opts: { ...Nh, cat: 5, reach: 0.65, eye: 0.05, omega: 1.4 } },
    'wilma':    { mode: 'cyclone', opts: { ...Nh, cat: 5, eye: 0.025, omega: 1.7, bands: 3 } },
    'sandy':    { mode: 'cyclone', opts: { ...Nh, cat: 1, bands: 2, pitch: 30, omega: 0.7 } },
    'patricia': { mode: 'cyclone', opts: { ...Nh, cat: 5, reach: 0.75, eye: 0.035, omega: 1.6, bands: 3 } },
    'dorian':   { mode: 'cyclone', opts: { ...Nh, cat: 5, eye: 0.08, bands: 3 } },
    // typhoons (the western Pacific)
    'haiyan':   { mode: 'cyclone', opts: { ...Nh, cat: 5, eye: 0.05, omega: 1.4, bands: 3 } },
    'tip':      { mode: 'cyclone', opts: { ...Nh, cat: 5, eye: 0.06, bands: 4, pitch: 18 } }
  };
  // named storms by basin, in display order
  const GROUPS = {
    'Cyclones': ['tracy', 'yasi', 'larry', 'debbie', 'winston', 'freddy', 'alfred'],
    'Hurricanes': ['katrina', 'andrew', 'wilma', 'sandy', 'patricia', 'dorian'],
    'Typhoons': ['haiyan', 'tip']
  };

  const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isDark = () => {
    const st = document.documentElement.getAttribute('data-theme');
    if (st === 'dark') return true;
    if (st === 'light') return false;
    return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  };
  const num = v => (v == null || v === '' ? undefined : Number(v));

  // Markup contract: <canvas class=wx width=200 height=200 data-wx-body=tracy> (or data-wx-mode=cyclone).
  // Height is the preset; width lets a storm's outer bands stretch. Flags: data-wx-ink, -lite, -ground (=1),
  // -glow (=0). Knobs: data-wx-hemisphere, -cat, -eye, -bands, -pitch, -reach, -omega. Colours via --wx-*.
  function mount(canvas) {
    if (canvas.dataset.wxReady === '1') return;
    canvas.dataset.wxReady = '1';
    const body = BODIES[canvas.dataset.wxBody] || null;
    const modeName = canvas.dataset.wxMode || (body && body.mode) || STATE_TO_MODE[canvas.dataset.wxState] || 'cyclone';
    const mode = MODES[modeName] || MODES.cyclone;
    const defaults = (body && body.palette) || mode.defaults;
    const w = parseInt(canvas.getAttribute('width') || '', 10) || 64;
    const size = parseInt(canvas.getAttribute('height') || '', 10) || w;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(size * dpr);
    canvas.style.width = w + 'px'; canvas.style.height = size + 'px';
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const ds = canvas.dataset;
    const own = { cat: num(ds.wxCat), eye: num(ds.wxEye), bands: num(ds.wxBands), pitch: num(ds.wxPitch),
                  reach: num(ds.wxReach), omega: num(ds.wxOmega), hemisphere: ds.wxHemisphere };
    for (const k in own) if (own[k] === undefined) delete own[k];
    const opts = { ...(body ? body.opts : null), ...own, w, ink: ds.wxInk === '1', lite: ds.wxLite === '1', ground: ds.wxGround === '1', glow: ds.wxGlow !== '0' };
    const paint = t => {
      opts.palette = readPalette(canvas, defaults) || (body && body.palette) || null;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, size);
      mode.draw(ctx, size, t, isDark(), opts);
    };
    if (reduced()) {   // one still frame, repainted on theme change
      paint(0.6);
      matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => paint(0.6));
      new MutationObserver(() => paint(0.6)).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      return;
    }
    let raf = 0, running = false, visible = true;
    const tick = () => { paint(performance.now() / 1000); if (running) raf = requestAnimationFrame(tick); };
    const start = () => { if (!running) { running = true; raf = requestAnimationFrame(tick); } };
    const stop = () => { running = false; cancelAnimationFrame(raf); };
    paint(0);
    if (typeof IntersectionObserver !== 'undefined') {   // no rAF for storms scrolled off or on hidden tabs
      new IntersectionObserver(([e]) => {
        visible = e.isIntersecting;
        (visible && document.visibilityState !== 'hidden') ? start() : stop();
      }).observe(canvas);
    } else start();
    document.addEventListener('visibilitychange', () => (document.visibilityState === 'hidden' ? stop() : visible && start()));
  }
  const register = root => (root || document).querySelectorAll('canvas.wx').forEach(mount);

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => register());
    else register();
  }

  return {
    version: '0.1.0',
    register, mount, MODES, STATE_TO_MODE, BODIES, GROUPS,
    draw: (mode, ctx, size, t, dark, opts) => MODES[mode].draw(ctx, size, t, dark, opts),
    // draw a named storm: Coriolis.body('yasi', ctx, 64, t, dark, { lite: true })
    body: (name, ctx, size, t, dark, opts) => {
      const b = BODIES[name]; if (!b) throw new Error('coriolis: unknown body ' + name);
      return MODES[b.mode].draw(ctx, size, t, dark, { ...b.opts, palette: b.palette || null, ...opts });
    },
    palette: { keys: KEYS, build: buildPal, read: readPalette, parse: parseCol, ramp },
    _: { E, noise, paintSea, paintRim, dotPainter }
  };
});
