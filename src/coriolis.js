/*! coriolis 0.5.0 — weather events, drawn as dots. Canvas 2D, no dependencies. MIT. */
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
  // point i of n on a fibonacci sphere
  const fib = (i, n) => {
    const g = Math.PI * (3 - Math.sqrt(5)), y = 1 - 2 * (i + 0.5) / n, r = Math.sqrt(1 - y * y), a = i * g;
    return [r * Math.cos(a), y, r * Math.sin(a)];
  };
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
  // Optional ground: a pill of sky or sea, top colour to bottom colour. Leaves the clip set.
  function paintPill(ctx, W, size, top, bottom) {
    const half = size / 2, cx = W / 2, R = half * 0.98;
    ctx.beginPath(); ctx.roundRect(cx - W / 2 + half - R, half - R, W - 2 * (half - R), 2 * R, R); ctx.clip();
    const bg = ctx.createLinearGradient(0, 0, 0, size);
    bg.addColorStop(0, top); bg.addColorStop(1, bottom);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, size);
  }
  const DUSK = ['#0d1226', '#141a33'];   // night sky, for the storm and lightning modes
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
  const SEA = ['#0a2040', '#040c1a'];
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
    if (o.ground) paintPill(ctx, W, size, (o.sky || SEA)[0], (o.sky || SEA)[1]);
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

  /* ================================================================== clouds */
  // Cloud from the side. `form: 'puff'` is cumulus: a few cauliflower heads that drift along and
  // tumble forward, dots on noise-swollen spheres with flat bases. `form: 'roll'` is one long tube
  // turning about its own axis as it comes, the Morning Glory. Both are lit from above and in front,
  // so the tops are bright and the undersides shadowed.
  const CUMULUS = { cold: [95, 108, 135], mid: [190, 198, 215], hot: [255, 253, 248], glow: [140, 160, 200] };
  const SKY = ['#182848', '#080c18'];
  function drawClouds(ctx, size, t, dark, o = {}) {
    const W = o.w ?? size, half = size / 2, cx = W / 2;
    const ink = !!o.ink, pal = buildPal(o.palette || CUMULUS);
    const M = radiusScale(size), lite = o.lite ? 0.5 : 1;
    const roll = o.form === 'roll';
    const drift = o.drift ?? 0.04, spin = o.spin ?? (roll ? 0.4 : 0.15);
    const N = Math.round((o.n ?? 900) * countScale(size, 1.3, 20) * Math.sqrt(W / size) * lite * (ink ? 0.4 : 1));
    const rBase = (o.rBase ?? (ink ? 1.3 : 1.0)) * M, rDepth = (o.rDepth ?? (ink ? 1.1 : 1.2)) * M, rMin = 0.3;
    const dot = dotPainter(ctx, ink, dark);

    ctx.save();
    if (o.ground) paintPill(ctx, W, size, (o.sky || SKY)[0], (o.sky || SKY)[1]);
    ctx.translate(cx, half);
    ctx.globalCompositeOperation = ink ? 'source-over' : 'lighter';
    if (!ink && o.glow !== false) {   // light behind the tops
      const g = ctx.createRadialGradient(0, -size * 0.12, 0, 0, -size * 0.12, size * 0.7);
      g.addColorStop(0, rgba(pal.glow, 0.22)); g.addColorStop(1, rgba(pal.glow, 0));
      ctx.fillStyle = g; ctx.fillRect(-W, -size, 2 * W, 2 * size);
    }
    // one dot on a cloud surface: z toward the viewer, up is height on the body, both in [-1, 1]
    const paint = (x, y, z, up) => {
      if (z < -0.25) return;
      const L = clamp01(0.12 + 0.55 * up + 0.4 * z), a = (0.12 + 0.88 * L ** 1.6) * clamp01(1 + z * 2);
      dot(x, y, Math.max(rMin, rBase + rDepth * L), ink ? null : ramp(pal.ramp, L), a, ink ? 0.7 * (1 - L) : 0);
    };
    if (roll) {
      const Rt = size * (o.radius ?? 0.2);
      for (let i = 0; i < N; i++) {
        const xu = frac(E(i, 1.1) + t * drift * 0.5), x = (xu - 0.5) * 1.15 * W;
        const ph = E(i, 2.2) * TAU + t * spin;                       // rolls about its own axis
        const swell = 1 + 0.3 * (noise(x / size * 1.6 + 1.3 * Math.cos(ph), 1.3 * Math.sin(ph) + t * 0.1) * 2 - 1)
                        + 0.1 * (noise(x / size * 6 + 3 * Math.cos(ph) + 9, 3 * Math.sin(ph)) * 2 - 1);
        const rr = Rt * swell, sag = 0.05 * size * Math.sin(x / W * 4 + t * 0.15);
        paint(x, sag - rr * Math.sin(ph) * 0.9, Math.cos(ph), Math.sin(ph));
      }
    } else {
      const K = o.puffs ?? 3, n = Math.round(N / K);
      for (let k = 0; k < K; k++) {
        const Rp = size * (0.14 + 0.09 * E(k, 3.3)) * ((o.radius ?? 0.2) / 0.2);
        const xu = frac((k + 0.5) / K + E(k, 4.4) * 0.15 + t * drift * 0.5), px0 = (xu - 0.5) * 1.2 * W;
        const py0 = (E(k, 5.5) - 0.5) * 0.35 * size, ang = t * spin * (0.7 + 0.6 * E(k, 6.6)) + E(k, 7.7) * TAU;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        for (let i = 0; i < n; i++) {
          const uy = E(i, 8.8 + k) * 2 - 1, ua = E(i, 9.9 + k) * TAU, ur = Math.sqrt(1 - uy * uy);   // hashed, not a lattice
          let px = ur * Math.cos(ua), py = uy, pz = ur * Math.sin(ua);
          const y1 = py * ca - pz * sa, z1 = py * sa + pz * ca; py = y1; pz = z1;   // tumbles forward
          if (py < -0.3) py = -0.3 - (py + 0.3) * 0.2;                                // flat base
          const rr = Rp * (1 + 0.32 * (noise(px * 1.8 + k * 9 + t * 0.15, py * 1.8 + pz * 1.2) * 2 - 1)
                              + 0.12 * (noise(px * 5 + k * 3, py * 5 + pz * 4 + 7) * 2 - 1));
          paint(px0 + px * rr, py0 - py * rr, pz, py);
        }
      }
    }
    ctx.restore();
    if (o.ground) paintRim(ctx, W, size);
  }

  /* ================================================================== storm */
  // A thunderstorm at night: a cumulonimbus tower with an anvil, dim until lightning lights it from
  // inside. One flash a slot of 1/rate seconds, hashed from the slot, so a still frame and a loop both
  // work. A cloud-to-ground bolt forks to the bottom of the canvas with restrikes; the rest flicker
  // inside the cloud. Rain falls under the base.
  const NIGHT = { cold: [55, 65, 90], mid: [140, 150, 180], hot: [235, 240, 255], glow: [120, 150, 255] };
  function drawStorm(ctx, size, t, dark, o = {}) {
    const W = o.w ?? size, half = size / 2, cx = W / 2;
    const ink = !!o.ink, pal = buildPal(o.palette || NIGHT);
    const M = radiusScale(size), lite = o.lite ? 0.5 : 1;
    const anvil = o.anvil ?? 1, tower = o.tower ?? 1;
    const yBase = size * 0.22, yTop = yBase - size * 0.62 * tower;   // the cloud base and the anvil top
    const wBase = Math.min(size * 0.19, W * 0.25), wAnvil = Math.min(size * 0.62 * anvil, W * 0.47);
    // a column that swells a little as it climbs, then the anvil: flat underside, wide, flat top
    const width = v => v < 0.66 ? wBase * (0.85 + 0.35 * v)
                                : wBase * 1.08 + (wAnvil - wBase * 1.08) * smooth((v - 0.66) / 0.14) * (1 - 0.6 * smooth((v - 0.94) / 0.06));
    const N = Math.round((o.n ?? 900) * countScale(size, 1.3, 20) * lite * (ink ? 0.4 : 1));
    const rBase = (o.rBase ?? (ink ? 1.3 : 1.0)) * M, rDepth = (o.rDepth ?? (ink ? 1.0 : 1.2)) * M, rMin = 0.3;
    const dot = dotPainter(ctx, ink, dark);

    // the flash, if one is on: the last two slots can each hold one
    const P = 1 / (o.rate ?? 0.6), slot = Math.floor(t / P);
    let flash = null;
    for (const s of [slot - 1, slot]) {
      const start = s * P + E(s, 3.3) * P * 0.5, age = t - start;
      if (age < 0 || age > 0.4) continue;
      const I = Math.exp(-age * 9) + 0.6 * Math.exp(-((age - 0.12) ** 2) * 400) + 0.4 * Math.exp(-((age - 0.22) ** 2) * 500);
      flash = { s, I: Math.min(1, I), cg: E(s, 4.4) < (o.cg ?? 0.5), x: (E(s, 5.5) - 0.5) * 1.2 * wBase, y: yBase - size * (0.12 + 0.3 * E(s, 6.6)) };
    }
    let bolt = null;
    if (flash && flash.cg) {   // the channel, then three branches off it, shorter and fainter
      const s = flash.s, n = 14, y0 = yBase - size * 0.04, y1 = size * 0.47;
      bolt = [[[flash.x, y0]]];
      let x = flash.x;
      for (let j = 1; j <= n; j++) { x += (E(s, 10 + j) - 0.5) * size * 0.11; bolt[0].push([x, y0 + (y1 - y0) * j / n]); }
      for (let b = 0; b < 3; b++) {
        const j0 = 2 + Math.floor(E(s, 30 + b) * 8), dir = E(s, 40 + b) < 0.5 ? -1 : 1;
        let [bx, by] = bolt[0][j0]; const br = [[bx, by]];
        for (let j = 1; j <= 5; j++) { bx += dir * size * (0.03 + 0.05 * E(s, 50 + b * 8 + j)); by += size * 0.035 * (0.5 + E(s, 70 + b * 8 + j)); br.push([bx, by]); }
        bolt.push(br);
      }
      flash.y = yBase - size * 0.1;   // a ground strike lights the base
    }

    ctx.save();
    if (o.ground) paintPill(ctx, W, size, (o.sky || DUSK)[0], (o.sky || DUSK)[1]);
    ctx.translate(cx, half);
    ctx.globalCompositeOperation = ink ? 'source-over' : 'lighter';
    if (flash && !ink && o.glow !== false) {   // the flash lights the cloud from inside
      const g = ctx.createRadialGradient(flash.x, flash.y, 0, flash.x, flash.y, size * 0.45);
      g.addColorStop(0, rgba(pal.glow, 0.5 * flash.I)); g.addColorStop(1, rgba(pal.glow, 0));
      ctx.fillStyle = g; ctx.fillRect(-W, -size, 2 * W, 2 * size);
    }
    for (let i = 0; i < N; i++) {   // the tower: more dots up in the anvil, billowy edges
      const v = E(i, 1.1) ** 0.8, w = width(v), cirrus = v > 0.7 ? 0.65 : 1;   // the anvil is thinner cloud
      const x = (E(i, 2.2) - 0.5) * 2 * w, y = yBase - (yBase - yTop) * v;
      const edge = Math.abs(x) / w, tex = noise(x / size * 4 + t * 0.03, y / size * 4);
      const body = smooth(1 - (edge - 0.55) / 0.5 + (tex - 0.5) * 0.5);
      if (body < 0.05) continue;
      let lit = 0;
      if (flash) { const dx = x - flash.x, dy = y - flash.y; lit = flash.I * Math.exp(-(dx * dx + dy * dy) / (2 * (0.3 * size) ** 2)); }
      const heat = clamp01(0.2 + 0.2 * v + 0.9 * lit), a = body * cirrus * (0.26 + 0.14 * tex + 0.55 * lit);
      dot(x, y, Math.max(rMin, rBase + rDepth * (0.3 + 0.7 * lit)), ink ? null : ramp(pal.ramp, heat), a, ink ? 0.6 * (1 - lit) : 0);
    }
    if (o.rain !== false) {
      const nr = Math.round(N * 0.25), lit = flash ? flash.I * 0.5 : 0;
      for (let i = 0; i < nr; i++) {
        const x = (E(i, 8.8) - 0.5) * 2.2 * wBase, y = yBase + size * 0.01 + frac(E(i, 9.9) + t * 0.9) * size * 0.26;
        dot(x, y, Math.max(rMin, 0.7 * M), pal.ramp[0], 0.22 + 0.4 * lit, ink ? 0.75 : 0);
      }
    }
    if (bolt) {
      bolt.forEach((path, b) => {
        const main = b === 0, step = Math.max(1.5, 2.2 * M);
        for (let j = 1; j < path.length; j++) {
          const [ax, ay] = path[j - 1], [bx, by] = path[j], n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / step));
          for (let k = 0; k <= n; k++) { const f = k / n; dot(ax + (bx - ax) * f, ay + (by - ay) * f, Math.max(rMin, (main ? 1.3 : 0.8) * M), pal.ramp[2], flash.I * (main ? 1 : 0.55), 0); }
        }
      });
    }
    ctx.restore();
    if (o.ground) paintRim(ctx, W, size);
  }

  /* ================================================================== lightning */
  // Lightning as the subject. `form: 'fork'` is a big cloud-to-ground strike: a stepped leader feels
  // its way down in the dark, forking as it goes, then the return stroke lights the whole channel
  // white with restrikes and fades. A new bolt every 1/rate seconds, each a different shape, hashed
  // from its slot so a still frame and a loop both work. 'crawler' runs the bolt sideways along a
  // cloud base. 'sheet' lights a cloud from inside with no channel to see. 'ball' is ball lightning:
  // a glowing sphere that swells in, drifts, pulses, sheds sparks and bursts.
  const BOLT = { cold: [90, 80, 200], mid: [190, 200, 255], hot: [255, 255, 255], glow: [130, 150, 255] };
  const EMBER = { cold: [255, 120, 40], mid: [255, 200, 120], hot: [255, 250, 230], glow: [255, 160, 60] };
  function drawLightning(ctx, size, t, dark, o = {}) {
    const W = o.w ?? size, half = size / 2, cx = W / 2;
    const form = o.form || 'fork', ball = form === 'ball', sheet = form === 'sheet', across = form === 'crawler';
    const ink = !!o.ink, pal = buildPal(o.palette || (ball ? EMBER : BOLT));
    const M = radiusScale(size), lite = o.lite ? 0.5 : 1, rMin = 0.3;
    const dot = dotPainter(ctx, ink, dark);
    const glowAt = (x, y, r, a) => {
      if (ink || o.glow === false || a < 0.01) return;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba(pal.glow, a)); g.addColorStop(1, rgba(pal.glow, 0));
      ctx.fillStyle = g; ctx.fillRect(-W, -size, 2 * W, 2 * size);
    };

    ctx.save();
    if (o.ground) paintPill(ctx, W, size, (o.sky || DUSK)[0], (o.sky || DUSK)[1]);
    ctx.translate(cx, half);
    ctx.globalCompositeOperation = ink ? 'source-over' : 'lighter';

    if (ball) {
      // one life of `life` seconds: in over half a second, a wandering drift, out in a burst of sparks
      const life = o.life ?? 8, cyc = Math.floor(t / life), age = t - cyc * life, R = size * (o.radius ?? 0.09);
      const bx = (noise(t * 0.12 + cyc * 5.3, 1.5) - 0.5) * 0.7 * W, by = (noise(2.5, t * 0.1 + cyc * 3.1) - 0.5) * 0.5 * size;
      const burst = clamp01((age - (life - 1.1)) / 0.5), env = smooth(age / 0.6) * (1 - burst);
      const bright = env * (0.75 + 0.25 * Math.sin(t * 9 + 3 * Math.sin(t * 2.3)));
      glowAt(bx, by, R * 4, 0.5 * bright);
      const N = Math.round((o.n ?? 380) * countScale(size, 1.1, 12) * lite * (ink ? 0.5 : 1));
      for (let i = 0; i < N; i++) {   // the core, dense in the middle, boiling at the edge
        const a = E(i, 1.1) * TAU + t * (0.6 + E(i, 1.2)), rr = R * Math.sqrt(E(i, 2.2)) * (1 + 0.18 * (noise(Math.cos(a) * 2 + t * 0.8, Math.sin(a) * 2 + i * 0.01) - 0.5));
        const heat = clamp01(1.05 - rr / R), al = bright * (0.35 + 0.65 * heat);
        dot(bx + Math.cos(a) * rr, by + Math.sin(a) * rr, Math.max(rMin, (0.8 + 1.2 * heat) * M), ink ? null : ramp(pal.ramp, heat), al, ink ? 0.3 * (1 - heat) : 0);
      }
      const ns = Math.round(N * 0.18);
      for (let i = 0; i < ns; i++) {   // sparks, escaping outward, all at once at the burst
        const a = E(i, 3.3) * TAU, f = frac(E(i, 4.4) + t * 0.35), rr = R * (1 + 1.8 * f + 7 * burst * burst * E(i, 5.5));
        const al = (burst ? 0.9 * (1 - burst) : env * (1 - f)) * 0.8;
        dot(bx + Math.cos(a) * rr, by + Math.sin(a) * rr, Math.max(rMin, 0.7 * M), pal.ramp[1], al, ink ? 0.4 : 0);
      }
      ctx.restore();
      if (o.ground) paintRim(ctx, W, size);
      return;
    }

    // the cloud the bolt comes from: a band along the top, billowy underneath, lit near the channel
    const base = sheet ? -size * 0.12 : across ? -size * 0.22 : -size * 0.36;   // where the cloud base sits
    const P = 1 / (o.rate ?? 0.7), slot = Math.floor(t / P);
    const bolts = [];
    for (const s of [slot - 1, slot]) {   // a flash can straddle the slot boundary
      const age = t - (s * P + E(s, 3.3) * P * 0.3);
      if (age < 0 || age > 1.5) continue;
      const lead = 0.32, a = age - lead;   // the leader's time, then the return stroke's
      const I = age < lead ? 0 : Math.min(1, Math.exp(-a * 7) + 0.7 * Math.exp(-((a - 0.18) ** 2) * 300) + 0.45 * Math.exp(-((a - 0.33) ** 2) * 400)) * (age > 0.9 ? Math.exp(-(age - 0.9) * 4) : 1);
      bolts.push({ s, age, p: clamp01(age / lead), I });
    }
    const flash = bolts.reduce((m, b) => Math.max(m, b.I), 0);
    const first = bolts[0], fx = first ? (E(first.s, 1.1) - 0.5) * 0.5 * W : 0;
    const NC = Math.round((sheet ? 900 : 320) * countScale(size, 1.2, 14) * Math.sqrt(W / size) * lite * (ink ? 0.4 : 1));
    if (flash) glowAt(sheet ? fx : across ? 0 : fx, base + (sheet ? size * 0.1 : -size * 0.08), size * (sheet ? 0.7 : 0.45), (sheet ? 0.6 : 0.35) * flash);
    for (let i = 0; i < NC; i++) {
      const x = (E(i, 6.6) - 0.5) * 1.05 * W, depth = E(i, 7.7);
      const y = -size * 0.5 + (base + size * 0.5) * depth ** 0.6 + (noise(x / size * 4 + 2, depth * 3 + t * 0.03) - 0.5) * size * 0.12;
      const tex = noise(x / size * 6, y / size * 6 + 9);
      const lit = flash * Math.exp(-((x - fx) ** 2) / (2 * (0.35 * W) ** 2)) * (sheet ? 1 : 0.8);
      const heat = clamp01(0.15 + 0.1 * depth + 0.9 * lit), al = (0.18 + 0.12 * tex + 0.7 * lit);
      dot(x, y, Math.max(rMin, (0.9 + 0.6 * lit) * M), ink ? null : ramp(pal.ramp, heat), al, ink ? 0.6 * (1 - lit) : 0);
    }
    if (sheet) { ctx.restore(); if (o.ground) paintRim(ctx, W, size); return; }

    // the bolt: a channel of short steps that wander with low-frequency noise and jitter with a hash,
    // branches off it and branches off those, each point tagged with how far down the leader it sits
    for (const b of bolts) {
      const s = b.s, len = across ? W * 0.92 : size * 0.5 - base, step = len / 60;
      const head = across ? 0 : Math.PI / 2, pts = [];
      const walk = (bid, x, y, tilt, n, sc, level, a0, aSpan) => {
        for (let j = 1; j <= n; j++) {
          const ang = head + tilt + 1.1 * (noise(j * 0.12, bid * 1.7 + s * 0.31) - 0.5) * 2 * (level ? 0.7 : 1) + (E(bid, j) - 0.5) * 0.5;
          x += Math.cos(ang) * step * sc; y += Math.sin(ang) * step * sc;
          pts.push([x, y, a0 + aSpan * j / n, level]);
        }
        return pts.length - n;   // index of this walk's first point
      };
      const x0 = across ? -len / 2 : (E(s, 1.1) - 0.5) * 0.5 * W, y0 = across ? base + size * 0.05 : base;
      const m0 = walk(s * 31, x0, y0, 0, 60, 1, 0, 1);
      const nb = o.branches ?? 7;
      for (let k = 0; k < nb; k++) {
        const j = 6 + Math.floor(E(s, 20 + k) * 44), [px, py, pa] = pts[m0 + j];
        const side = E(s, 40 + k) < 0.5 ? -1 : 1, n1 = 10 + Math.floor(E(s, 60 + k) * 12);
        const b0 = walk(s * 31 + 1 + k, px, py, side * (0.5 + 0.7 * E(s, 80 + k)), n1, 0.75, 1, pa, 0.22);
        if (E(s, 100 + k) < 0.85) {   // a twig off the branch
          const j2 = 2 + Math.floor(E(s, 120 + k) * (n1 - 4)), [qx, qy, qa] = pts[b0 + j2];
          walk(s * 31 + 40 + k, qx, qy, side * (0.9 + 0.6 * E(s, 140 + k)), 4 + Math.floor(E(s, 160 + k) * 5), 0.5, 2, qa, 0.1);
        }
      }
      const lvlA = [1, 0.6, 0.38], lvlR = [1.7, 1.0, 0.7];
      for (const [x, y, along, level] of pts) {
        let al, heat, r = lvlR[level] * M;
        if (b.age < 0.32) {   // the leader: dim and cold, brightest at its advancing tip
          if (along > b.p) continue;
          const tip = clamp01(1 - (b.p - along) / 0.08);
          al = (0.18 + 0.6 * tip) * lvlA[level]; heat = 0.35 + 0.4 * tip; r *= 0.7;
        } else {              // the return stroke and its afterglow
          al = b.I * lvlA[level]; heat = clamp01(0.5 + 0.5 * b.I); r *= 0.8 + 0.5 * b.I;
        }
        if (level === 0 && !ink) dot(x, y, r * 2.1, pal.ramp[1], al * 0.14, 0);   // a soft halo along the channel
        dot(x, y, Math.max(rMin, r), ink ? null : ramp(pal.ramp, heat), al, ink ? 0.1 : 0);
      }
    }
    ctx.restore();
    if (o.ground) paintRim(ctx, W, size);
  }

  /* ================================================================== tornado */
  // A tornado from the side: a condensation funnel from the cloud base to the ground, dots riding
  // round it so the spin reads, faster where it's narrow, the whole thing snaking as it goes, and a
  // debris cloud thrown up where it meets the ground. `width` and `taper` shape it from rope to
  // wedge; `vortices` splits it into sub-vortices orbiting inside. Forms: 'tornado', 'waterspout'
  // (spray, not dust), 'dust-devil' (no cloud, a column of dust widest at the ground), 'fire-whirl'
  // (embers, rising).
  const FUNNEL = { cold: [60, 62, 75], mid: [150, 150, 160], hot: [225, 225, 230], glow: [120, 120, 140] };
  const DUST = [150, 115, 80];
  function drawTornado(ctx, size, t, dark, o = {}) {
    const W = o.w ?? size, half = size / 2, cx = W / 2;
    const form = o.form || 'tornado', devil = form === 'dust-devil', spout = form === 'waterspout', fire = form === 'fire-whirl';
    const ink = !!o.ink, pal = buildPal(o.palette || FUNNEL);
    const M = radiusScale(size), lite = o.lite ? 0.5 : 1, rMin = 0.3;
    const dot = dotPainter(ctx, ink, dark);
    const yG = size * 0.4, yB = -size * 0.36, H = yG - yB;          // the ground and the cloud base
    const R0 = size * (o.width ?? 0.16), taper = o.taper ?? 1.4;
    const prof = v => devil ? R0 * (0.25 + 0.75 * (1 - v) ** 1.2) : R0 * (0.1 + 0.9 * v ** taper);   // radius at height v, 0 ground to 1 base
    const spin = o.spin ?? 2.2, sway = o.sway ?? 0.12, nv = o.vortices ?? 1;
    const xc = v => sway * size * (noise(v * 1.5 + t * 0.22, 3.3) - 0.5) * 2 * (devil ? v : (1 - v) ** 0.7);   // snakes, pinned at the cloud
    const N = Math.round((o.n ?? 900) * countScale(size, 1.3, 20) * lite * (ink ? 0.4 : 1));
    const rBase = (o.rBase ?? (ink ? 1.2 : 0.95)) * M, rDepth = (o.rDepth ?? 1.1) * M;
    const dustCol = spout ? [200, 225, 245] : fire ? [255, 150, 60] : DUST;
    const funnelRamp = fire ? [[120, 30, 10], [255, 120, 40], [255, 230, 170]] : devil ? [[80, 60, 40], DUST, [230, 205, 170]] : pal.ramp;

    ctx.save();
    if (o.ground) paintPill(ctx, W, size, (o.sky || DUSK)[0], (o.sky || DUSK)[1]);
    ctx.translate(cx, half);
    ctx.globalCompositeOperation = ink ? 'source-over' : 'lighter';
    if (!ink && o.glow !== false) {   // the debris cloud's haze, or a fire whirl's light
      const gx = xc(0), gy = yG - size * 0.05, gc = fire ? [255, 140, 50] : pal.glow;
      const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, size * 0.35);
      g.addColorStop(0, rgba(gc, fire ? 0.45 : 0.25)); g.addColorStop(1, rgba(gc, 0));
      ctx.fillStyle = g; ctx.fillRect(-W, -size, 2 * W, 2 * size);
    }
    if (!devil) {   // the cloud base: a dark band with a ragged underside, lowest around the funnel
      const nc = Math.round(N * 0.35);
      for (let i = 0; i < nc; i++) {
        const x = (E(i, 6.6) - 0.5) * 1.05 * W, d = E(i, 7.7);
        const bulge = Math.exp(-(x * x) / (2 * (R0 * 1.8) ** 2)) * size * 0.08;   // the wall cloud
        const y = -size * 0.5 + (yB + size * 0.5 + bulge) * d ** 0.6 + (noise(x / size * 4 + 2, d * 3 + t * 0.03) - 0.5) * size * 0.1;
        const tex = noise(x / size * 6, y / size * 6 + 9);
        dot(x, y, Math.max(rMin, 0.9 * M), ink ? null : ramp(pal.ramp, 0.12 + 0.15 * d), 0.22 + 0.16 * tex, ink ? 0.7 : 0);
      }
    }
    // the funnel: dots ride round it and creep up; sub-vortices orbit the axis
    const nf = Math.round(N * (devil ? 0.55 : 0.5));
    for (let i = 0; i < nf; i++) {
      const v = frac(E(i, 1.1) + t * (fire ? 0.12 : 0.04)), r = prof(v), k = i % nv;
      const w = spin / (0.35 + r / R0);                                // faster where it's narrow
      const ph = E(i, 2.2) * TAU + w * t;
      let ax = xc(v), rr = r;
      if (nv > 1) { const oa = k / nv * TAU + t * spin * 0.6; ax += Math.cos(oa) * r * 0.55; rr = r * 0.4; }   // a sub-vortex
      const x = ax + Math.cos(ph) * rr * (1 + 0.12 * (noise(v * 6 + i * 0.001, t * 0.5) - 0.5)), y = yG - v * H, z = Math.sin(ph);
      const front = clamp01(0.5 + 0.5 * z), heat = clamp01((fire ? 0.6 : 0.18) + (fire ? 0.45 : 0.38) * front + (fire ? 0.3 * (1 - v) : 0.12 * v));
      const a = (0.12 + 0.48 * front) * (devil ? 0.8 : 1) * (fire ? 0.6 + 0.4 * (1 - v) : 1);
      dot(x, y, Math.max(rMin, rBase + rDepth * front), ink ? null : ramp(funnelRamp, heat), a, ink ? 0.2 + 0.4 * (1 - front) : 0);
    }
    // the debris cloud at the ground: a flat spinning bowl, thrown outward and up
    const nd = Math.round(N * (o.debris ?? (spout ? 0.25 : 0.4))), rd = Math.max(prof(0) * 2.6, size * 0.14);
    for (let i = 0; i < nd; i++) {
      const f = frac(E(i, 3.3) + t * 0.18), rr = rd * (0.25 + 0.75 * f), ph = E(i, 4.4) * TAU + t * spin * 0.5 / (0.4 + f);
      const x = xc(0) + Math.cos(ph) * rr, y = yG - size * (0.02 + 0.14 * E(i, 5.5) * (1 - f) ** 0.5) * (spout ? 0.6 : 1) + Math.sin(ph) * rr * 0.18;
      const a = (1 - f) * 0.55 * (0.75 + 0.25 * Math.sin(ph));
      dot(x, y, Math.max(rMin, (0.6 + 0.6 * (1 - f)) * M), dustCol, a, ink ? 0.55 : 0);
    }
    ctx.restore();
    if (o.ground) paintRim(ctx, W, size);
  }

  /* ================================================================== aurora */
  // The aurora from the ground: curtains hanging across the sky, brightest along their lower edge and
  // fading up the rays, folding and drifting sideways while the rays shimmer. `bands` curtains, the
  // first hanging lowest and brightest. The palette ramp runs up the ray: cold at the lower edge, hot
  // at the top, so green below and purple or red above.
  const AURORA = { cold: [60, 230, 130], mid: [70, 190, 190], hot: [190, 90, 230], glow: [50, 200, 130] };
  function drawAurora(ctx, size, t, dark, o = {}) {
    const W = o.w ?? size, half = size / 2, cx = W / 2;
    const ink = !!o.ink, pal = buildPal(o.palette || AURORA);
    const M = radiusScale(size), lite = o.lite ? 0.5 : 1, rMin = 0.3;
    const dot = dotPainter(ctx, ink, dark);
    const bands = o.bands ?? 2, height = o.height ?? 0.45, drift = o.drift ?? 0.06, shimmer = o.shimmer ?? 1;
    const N = Math.round((o.n ?? 1500) * countScale(size, 1.3, 20) * Math.sqrt(W / size) * lite * (ink ? 0.4 : 1));

    ctx.save();
    if (o.ground) paintPill(ctx, W, size, (o.sky || DUSK)[0], (o.sky || DUSK)[1]);
    ctx.translate(cx, half);
    ctx.globalCompositeOperation = ink ? 'source-over' : 'lighter';
    if (o.ground) {   // a few stars behind the curtain
      const ns = Math.round(30 * Math.sqrt(W * size) / 64);
      for (let i = 0; i < ns; i++) dot((E(i, 3.3) - 0.5) * W, (E(i, 4.4) - 0.5) * size, 0.5 * M, [220, 228, 255], (0.15 + 0.4 * E(i, 5.5)) * (0.7 + 0.3 * Math.sin(t + i)), ink ? 0.3 : 0);
    }
    if (!ink && o.glow !== false) {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 0.75);
      g.addColorStop(0, rgba(pal.glow, 0.3)); g.addColorStop(1, rgba(pal.glow, 0));
      ctx.fillStyle = g; ctx.fillRect(-W, -size, 2 * W, 2 * size);
    }
    for (let i = 0; i < N; i++) {
      const b = i % bands, bf = b / bands;                               // which curtain
      const u = frac(E(i, 1.1) + t * drift * (0.5 + 0.5 * bf)), h = E(i, 2.2) ** 0.6;   // along the curtain, then up the ray
      const x = (u - 0.5) * 1.1 * W;
      // the lower edge folds: slow big waves, a drifting ripple, and a wander; later bands hang higher
      const fold = Math.sin(u * 6.3 + t * 0.3 + b * 2) * 0.09 + Math.sin(u * 15 - t * 0.5 + b) * 0.04 + (noise(u * 3 + t * 0.1, b * 7) - 0.5) * 0.12;
      const y0 = size * (0.12 - 0.22 * bf + fold), H = size * height * (0.6 + 0.4 * noise(u * 4 + b * 3, t * 0.15)) * (1 - 0.3 * bf);
      const ray = 0.35 + 0.65 * noise(u * 45 + t * 0.9 * shimmer, b * 11 + t * 0.2) ** 1.5;   // bright vertical streaks that shimmer
      const y = y0 - h * H, lean = 0.05 * size * h * Math.sin(u * 9 + t * 0.4);          // rays lean a touch with the fold
      const a = (0.15 + 0.85 * (1 - h) ** 1.3) * ray * (1 - 0.4 * bf) * (0.8 + 0.2 * Math.sin(t * 0.7 + b));
      dot(x + lean, y, Math.max(rMin, (0.9 + 1.3 * (1 - h)) * M), ink ? null : ramp(pal.ramp, h), a, ink ? 0.2 + 0.5 * h : 0);
    }
    ctx.restore();
    if (o.ground) paintRim(ctx, W, size);
  }

  /* ================================================================== precip */
  // Rain, snow and hail from the side. Every drop has its own depth: nearer ones are bigger and fall
  // faster. Rain streaks as a short trail of dots and slants with `wind`; snow drifts and sways; hail
  // falls hard and bounces once at the ground. Stateless: each dot's height is a function of time.
  const RAINY = { cold: [90, 110, 140], mid: [160, 180, 210], hot: [225, 235, 250], glow: [100, 120, 160] };
  const FLAKE = [[170, 180, 200], [230, 236, 245], [255, 255, 255]];
  function drawPrecip(ctx, size, t, dark, o = {}) {
    const W = o.w ?? size, half = size / 2, cx = W / 2;
    const form = o.form || 'rain', snow = form === 'snow', hail = form === 'hail';
    const ink = !!o.ink, pal = buildPal(o.palette || RAINY);
    const M = radiusScale(size), lite = o.lite ? 0.5 : 1, rMin = 0.3;
    const dot = dotPainter(ctx, ink, dark);
    const wind = o.wind ?? (snow ? 0.15 : 0.35), density = o.density ?? 1;
    const speed = o.speed ?? (snow ? 0.12 : hail ? 0.9 : 1.1);           // canvas heights a second, up close
    const N = Math.round((o.n ?? (snow ? 500 : hail ? 420 : 700)) * density * countScale(size, 1.3, 20) * Math.sqrt(W / size) * lite * (ink ? 0.5 : 1));
    const yG = size * 0.47, span = W * 1.3;

    ctx.save();
    if (o.ground) paintPill(ctx, W, size, (o.sky || DUSK)[0], (o.sky || DUSK)[1]);
    ctx.translate(cx, half);
    ctx.globalCompositeOperation = ink ? 'source-over' : 'lighter';
    if (!ink && o.glow !== false && !snow) {   // the low grey of a wet sky
      const g = ctx.createLinearGradient(0, -half, 0, half);
      g.addColorStop(0, rgba(pal.glow, 0.25)); g.addColorStop(1, rgba(pal.glow, 0));
      ctx.fillStyle = g; ctx.fillRect(-W, -size, 2 * W, 2 * size);
    }
    for (let i = 0; i < N; i++) {
      const d = E(i, 1.1) ** 1.5, sp = speed * (0.45 + 0.75 * d);        // depth: 0 far, 1 near
      const p = frac(E(i, 2.2) + t * sp);                                  // 0 top, 1 ground
      let x = (E(i, 3.3) - 0.5) * span + wind * size * p * (0.5 + 0.5 * d), y = -half + p * (yG + half);
      if (snow) x += Math.sin(t * (0.8 + d) + i) * size * 0.03 * (0.5 + d) + (noise(i * 0.37, t * 0.2) - 0.5) * size * 0.08;
      x = ((x + span / 2) % span + span) % span - span / 2;                // wrap the wind drift
      const heat = 0.3 + 0.6 * d, r = Math.max(rMin, (snow ? 0.7 + 1.6 * d : hail ? 1.0 + 1.6 * d : 0.5 + 0.7 * d) * M);
      const col = ink ? null : ramp(snow ? FLAKE : pal.ramp, heat);
      if (hail) {   // falls hard, then one bounce at the ground
        const q = p < 0.82 ? (p / 0.82) ** 1.8 : 1 - 0.14 * Math.sin((p - 0.82) / 0.18 * Math.PI) * (0.5 + 0.5 * d);
        dot(x, -half + q * (yG + half), r, col, 0.4 + 0.5 * d, ink ? 0.1 : 0);
      } else if (snow) {
        dot(x, y, r, col, (0.35 + 0.55 * d) * (0.8 + 0.2 * Math.sin(t * 2 + i)), ink ? 0.1 : 0);
      } else {      // a streak: three dots trailing back up the fall line
        const dx = -wind * size * 0.02 * (0.5 + 0.5 * d), dy = -size * 0.022 * (0.5 + d);
        for (let k = 0; k < 3; k++) dot(x + dx * k, y + dy * k, r * (1 - 0.2 * k), col, (0.25 + 0.55 * d) * (1 - 0.3 * k), ink ? 0.15 : 0);
      }
    }
    ctx.restore();
    if (o.ground) paintRim(ctx, W, size);
  }

  /* ================================================================== registry + driver */
  const MODES = {
    cyclone: { draw: drawCyclone, defaults: CLOUD,   state: 'spinning' },
    clouds:  { draw: drawClouds,  defaults: CUMULUS, state: 'drifting' },
    storm:   { draw: drawStorm,   defaults: NIGHT,   state: 'flashing' },
    lightning: { draw: drawLightning, defaults: BOLT, state: 'striking' },
    tornado: { draw: drawTornado, defaults: FUNNEL, state: 'twisting' },
    aurora:  { draw: drawAurora,  defaults: AURORA, state: 'glowing' },
    precip:  { draw: drawPrecip,  defaults: RAINY,  state: 'falling' }
  };
  const STATE_TO_MODE = Object.fromEntries(Object.entries(MODES).map(([m, v]) => [v.state, m]));

  // Named events: a mode plus the options and palette that make it that particular thing.
  // <canvas class=wx data-wx-body=tracy>. Data attributes still override the body's options.
  const P = (cold, mid, hot, glow) => ({ cold, mid, hot, glow });
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
    'tip':      { mode: 'cyclone', opts: { ...Nh, cat: 5, eye: 0.06, bands: 4, pitch: 18 } },
    // clouds
    'cumulus':       { mode: 'clouds', opts: { form: 'puff', puffs: 3, sky: ['#274a86', '#12264d'] } },
    'morning-glory': { mode: 'clouds', opts: { form: 'roll', radius: 0.19, spin: 0.4, sky: ['#3b2a48', '#0b0d1c'] },
                       palette: P([90, 80, 110], [215, 190, 190], [255, 240, 225], [230, 150, 110]) },
    'shelf-cloud':   { mode: 'clouds', opts: { form: 'roll', radius: 0.27, spin: 0.2, drift: 0.06, sky: ['#1a2230', '#05070c'] },
                       palette: P([40, 50, 60], [120, 130, 140], [220, 225, 225], [90, 110, 120]) },
    // thunderstorms
    'thunderstorm': { mode: 'storm' },
    'supercell':    { mode: 'storm', opts: { rate: 0.8, cg: 0.6, anvil: 1.25, tower: 1.08 } },
    'hector':       { mode: 'storm', opts: { rate: 1.0, cg: 0.45, anvil: 1.15 } },
    'catatumbo':    { mode: 'storm', opts: { rate: 1.8, cg: 0.2, sky: ['#0c1024', '#1a1430'] },
                      palette: P([70, 60, 110], [160, 150, 200], [245, 240, 255], [170, 120, 255]) },
    // lightning
    'fork-lightning':  { mode: 'lightning', opts: { form: 'fork' } },
    'anvil-crawler':   { mode: 'lightning', opts: { form: 'crawler', rate: 0.5 } },
    'sheet-lightning': { mode: 'lightning', opts: { form: 'sheet', rate: 0.9 } },
    'ball-lightning':  { mode: 'lightning', opts: { form: 'ball' } },
    'megaflash':       { mode: 'lightning', opts: { form: 'crawler', rate: 0.35, branches: 10 } },
    // tornadoes
    'tornado':      { mode: 'tornado', opts: { sky: ['#2a3240', '#141a22'] } },
    'el-reno':      { mode: 'tornado', opts: { width: 0.42, taper: 0.35, spin: 1.4, sway: 0.04, vortices: 3, sky: ['#2a3240', '#141a22'] } },
    'tri-state':    { mode: 'tornado', opts: { width: 0.3, taper: 0.5, spin: 1.6, sway: 0.05, sky: ['#2a3240', '#141a22'] } },
    'joplin':       { mode: 'tornado', opts: { width: 0.24, taper: 0.7, vortices: 2, sky: ['#2a3240', '#141a22'] } },
    'bridge-creek': { mode: 'tornado', opts: { width: 0.18, taper: 1.0, spin: 3.4, sky: ['#2a3240', '#141a22'] } },
    'waterspout':   { mode: 'tornado', opts: { form: 'waterspout', width: 0.07, taper: 1.2, sway: 0.16, sky: ['#2a4a70', '#0c2038'] },
                      palette: P([130, 150, 175], [200, 215, 230], [245, 250, 255], [150, 190, 230]) },
    'dust-devil':   { mode: 'tornado', opts: { form: 'dust-devil', width: 0.12, spin: 2.6, sway: 0.2, sky: ['#4a3a2a', '#1c140c'] } },
    'fire-whirl':   { mode: 'tornado', opts: { form: 'fire-whirl', width: 0.09, taper: 1.0, spin: 3, sway: 0.15, sky: ['#1a0c08', '#0a0604'] } },
    // aurora
    'aurora-australis': { mode: 'aurora', opts: { sky: ['#04060e', '#0a1020'] } },
    'aurora-borealis':  { mode: 'aurora', opts: { sky: ['#04060e', '#0a1020'] }, palette: P([50, 230, 120], [120, 210, 110], [230, 80, 90], [60, 200, 120]) },
    'carrington':       { mode: 'aurora', opts: { bands: 3, height: 0.6, shimmer: 1.6, sky: ['#0a0408', '#1a0810'] }, palette: P([230, 90, 80], [220, 60, 120], [160, 40, 200], [220, 70, 90]) },
    'may-2024':         { mode: 'aurora', opts: { bands: 3, height: 0.55, sky: ['#06040e', '#100a20'] }, palette: P([120, 230, 150], [230, 110, 200], [180, 80, 240], [200, 100, 220]) },
    // rain and snow
    'rain':     { mode: 'precip', opts: { sky: ['#2a3038', '#151a22'] } },
    'drizzle':  { mode: 'precip', opts: { density: 0.5, speed: 0.5, wind: 0.1, sky: ['#3a4048', '#1c2028'] } },
    'monsoon':  { mode: 'precip', opts: { density: 1.8, speed: 1.4, wind: 0.6, sky: ['#1e2a30', '#0c1418'] } },
    'snow':     { mode: 'precip', opts: { form: 'snow', sky: ['#1e2634', '#0e1420'] } },
    'blizzard': { mode: 'precip', opts: { form: 'snow', density: 2, wind: 1.2, speed: 0.5, sky: ['#262c38', '#12161e'] } },
    'hail':     { mode: 'precip', opts: { form: 'hail', sky: ['#2a3038', '#151a22'] } }
  };
  // named events by family, in display order
  const GROUPS = {
    'Cyclones': ['tracy', 'yasi', 'larry', 'debbie', 'winston', 'freddy', 'alfred'],
    'Hurricanes': ['katrina', 'andrew', 'wilma', 'sandy', 'patricia', 'dorian'],
    'Typhoons': ['haiyan', 'tip'],
    'Clouds': ['cumulus', 'morning-glory', 'shelf-cloud'],
    'Thunderstorms': ['thunderstorm', 'supercell', 'hector', 'catatumbo'],
    'Lightning': ['fork-lightning', 'anvil-crawler', 'sheet-lightning', 'ball-lightning', 'megaflash'],
    'Tornadoes': ['tornado', 'el-reno', 'tri-state', 'joplin', 'bridge-creek', 'waterspout', 'dust-devil', 'fire-whirl'],
    'Aurora': ['aurora-australis', 'aurora-borealis', 'carrington', 'may-2024'],
    'Rain and snow': ['rain', 'drizzle', 'monsoon', 'snow', 'blizzard', 'hail']
  };

  const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isDark = () => {
    const st = document.documentElement.getAttribute('data-theme');
    if (st === 'dark') return true;
    if (st === 'light') return false;
    return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  };
  const FLAGS = new Set(['wxBody', 'wxMode', 'wxState', 'wxReady', 'wxInk', 'wxLite', 'wxGround', 'wxGlow']);

  // Markup contract: <canvas class=wx width=200 height=200 data-wx-body=tracy> (or data-wx-mode=cyclone).
  // Height is the preset; width lets wide things stretch. Flags: data-wx-ink, -lite, -ground (=1), -glow (=0).
  // Any other data-wx-<knob> reaches the mode as opts.knob, numbers parsed. Colours via --wx-* custom properties.
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
    const ds = canvas.dataset, own = {};
    for (const k in ds) {
      if (!k.startsWith('wx') || FLAGS.has(k) || ds[k] === '') continue;
      own[k[2].toLowerCase() + k.slice(3)] = isNaN(ds[k]) ? ds[k] : Number(ds[k]);
    }
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
    if (typeof IntersectionObserver !== 'undefined') {   // no rAF for canvases scrolled off or on hidden tabs
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
    version: '0.5.0',
    register, mount, MODES, STATE_TO_MODE, BODIES, GROUPS,
    draw: (mode, ctx, size, t, dark, opts) => MODES[mode].draw(ctx, size, t, dark, opts),
    // draw a named event: Coriolis.body('yasi', ctx, 64, t, dark, { lite: true })
    body: (name, ctx, size, t, dark, opts) => {
      const b = BODIES[name]; if (!b) throw new Error('coriolis: unknown body ' + name);
      return MODES[b.mode].draw(ctx, size, t, dark, { ...b.opts, palette: b.palette || null, ...opts });
    },
    palette: { keys: KEYS, build: buildPal, read: readPalette, parse: parseCol, ramp },
    _: { E, fib, noise, paintPill, paintRim, dotPainter }
  };
});
