// Turns the raw per-frame samples recorded by inject.js into animations:
// which properties moved, from → to, duration, easing (fitted against GSAP's eases),
// stagger, and whether the motion is time-based or tied to the scroll (scrub).
import { gsap } from 'gsap';

const EASE_NAMES = [
  'none',
  ...['power1', 'power2', 'power3', 'power4', 'expo', 'circ', 'sine', 'back'].flatMap((e) => [
    `${e}.out`, `${e}.in`, `${e}.inOut`,
  ]),
  'back.out(1.2)', 'back.out(2.5)', 'back.inOut(1.4)',
];
const EASES = EASE_NAMES.map((name) => ({ name, fn: gsap.parseEase(name) }));

// Smallest change that counts as a real animation, per channel family.
const MIN_AMPLITUDE = {
  x: 3, y: 3, scaleX: 0.02, scaleY: 0.02, rotate: 2, opacity: 0.05, clip: 2, filter: 0.5,
  width: 3, height: 3, bg: 8, color: 8, radius: 1, dash: 2, ls: 0.2,
};
// Channels kept as CSS strings (several numbers each) rather than a single number.
export const RAW = new Set(['clip', 'filter', 'bg', 'color', 'radius']);
const family = (ch) => ch.replace(/\d+$/, '');
const numbers = (s) => (s && s !== 'none' ? (s.slice(s.indexOf('(')).match(/-?\d*\.?\d+(?:e-?\d+)?/g) || []).map(Number) : []);

function parseTransform(s) {
  if (!s || s === 'none') return { x: 0, y: 0, scaleX: 1, scaleY: 1, rotate: 0 };
  const n = numbers(s);
  const [a, b, c, d, tx, ty] = s.startsWith('matrix3d') ? [n[0], n[1], n[4], n[5], n[12], n[13]] : n;
  return { x: tx, y: ty, scaleX: Math.hypot(a, b), scaleY: Math.hypot(c, d), rotate: (Math.atan2(b, a) * 180) / Math.PI };
}

const px = (s) => (s && /^-?[\d.]+px$/.test(s) ? parseFloat(s) : undefined);

function parseRows(rows, scrollAt) {
  return rows.map(([t, s, transform, opacity, clip, filter, top, h, vh, width, height, bg, color, radius, dash, ls]) => {
    const ch = { ...parseTransform(transform), opacity };
    numbers(clip).forEach((v, i) => (ch['clip' + i] = v));
    numbers(filter).forEach((v, i) => (ch['filter' + i] = v));
    if (width !== undefined) {
      if (px(width) !== undefined) ch.width = px(width);
      if (px(height) !== undefined) ch.height = px(height);
      numbers(bg).forEach((v, i) => (ch['bg' + i] = v));
      numbers(color).forEach((v, i) => (ch['color' + i] = v));
      numbers('(' + radius).forEach((v, i) => (ch['radius' + i] = v));
      if (px(dash) !== undefined || /^-?[\d.]+$/.test(dash || '')) ch.dash = parseFloat(dash);
      if (px(ls) !== undefined) ch.ls = px(ls);
    }
    return { t, s: scrollAt ? scrollAt(t) : s, ch, clip, filter, bg, color, radius, top, h, vh };
  });
}

// Scroll changes grouped into bursts (one burst ≈ one wheel step + smoothing).
// The real ease/duration of an animation when we can know it: the GSAP call that targeted the
// element (sites loading GSAP from a <script>) or the CSS transition/animation that moved it.
function exactTimings(dump) {
  const calls = new Map();
  const tlDefaults = new Map();
  const tlScrub = new Set();
  for (const c of dump.calls || []) {
    if (c.kind !== 'gsap.timeline') continue;
    tlDefaults.set(c.timeline, (c.vars && c.vars.defaults) || {});
    if (c.vars && c.vars.scrollTrigger && c.vars.scrollTrigger.scrub) tlScrub.add(c.timeline);
  }
  for (const c of dump.calls || []) {
    if (!/^(gsap|tl)\.(to|from|fromTo)$/.test(c.kind)) continue;
    for (const id of c.ids || []) {
      if (!calls.has(id)) calls.set(id, []);
      calls.get(id).push(c);
    }
  }
  const css = new Map();
  for (const c of dump.cssAnimations || []) {
    if (!c.targetId || !(c.duration > 0) || c.iterations === 'Infinity') continue;
    if (!css.has(c.targetId)) css.set(c.targetId, []);
    css.get(c.targetId).push(c);
  }
  return (id, start, measured) => {
    const plausible = (d) => d > 0 && Math.abs(d * 1000 - measured) <= Math.max(120, d * 1000 * 0.35);
    const g = (calls.get(id) || []).filter((c) => c.t <= start + 40);
    const latest = g[g.length - 1];
    if (latest) {
      const v = latest.toVars || latest.vars || {};
      // a piece of a scrubbed timeline moving in jerks while scrolling: not an entrance
      if ((latest.timeline != null && tlScrub.has(latest.timeline)) || (v.scrollTrigger && v.scrollTrigger.scrub)) return { scrubbed: true };
    }
    for (let i = g.length - 1; i >= 0; i--) {
      const c = g[i];
      const v = c.toVars || c.vars || {};
      if (v.scrollTrigger && v.scrollTrigger.scrub) continue;
      const defs = c.timeline != null ? tlDefaults.get(c.timeline) || {} : {};
      const duration = typeof v.duration === 'number' ? v.duration : typeof defs.duration === 'number' ? defs.duration : 0.5;
      const ease = typeof v.ease === 'string' ? v.ease : typeof defs.ease === 'string' ? defs.ease : 'power1.out';
      const st = v.stagger ?? defs.stagger;
      const stagger = typeof st === 'number' ? st : st && typeof st.each === 'number' ? st.each : null;
      if (plausible(duration)) return { source: 'gsap', ease, duration, stagger };
    }
    const k = (css.get(id) || []).find((c) => Math.abs(c.start + (c.delay || 0) - start) < 150 && plausible(c.duration / 1000));
    if (k) return { source: 'css', ease: k.easing, duration: k.duration / 1000 };
    return null;
  };
}

function withExact(fit, exact) {
  if (!exact) return fit;
  return {
    best: { name: exact.ease, err: 0 },
    alternatives: fit ? [fit.best, ...fit.alternatives].slice(0, 2) : [],
    customEase: fit ? fit.customEase : null,
    exact: exact.source,
    exactDuration: exact.duration,
    exactStagger: exact.stagger ?? null,
  };
}

// CSS timing functions → something GSAP understands (a name, or a CustomEase path).
const CSS_KEYWORDS = { ease: [0.25, 0.1, 0.25, 1], 'ease-in': [0.42, 0, 1, 1], 'ease-out': [0, 0, 0.58, 1], 'ease-in-out': [0.42, 0, 0.58, 1] };
export function gsapEase(name) {
  if (!name) return { ease: 'power2.out' };
  if (name === 'linear') return { ease: 'none' };
  const kw = CSS_KEYWORDS[name];
  const m = name.match(/^cubic-bezier\(([^)]+)\)$/);
  const p = kw || (m && m[1].split(',').map((v) => +v.trim()));
  if (p) return { ease: null, path: `M0,0 C${p[0]},${p[1]} ${p[2]},${p[3]} 1,1`, css: name };
  return { ease: name };
}

export function scrollBursts(scroll) {
  const bursts = [];
  // The first entry is the initial position, not a scroll.
  for (const [t, s] of scroll.slice(1)) {
    const b = bursts[bursts.length - 1];
    if (b && t - b.tEnd < 300) {
      b.tEnd = t;
      b.sTo = s;
    } else bursts.push({ tStart: t, tEnd: t, sTo: s });
  }
  return bursts;
}

function segmentsFor(prows, ch) {
  const segs = [];
  let cur = null;
  for (let i = 1; i < prows.length; i++) {
    const a = prows[i - 1].ch[ch];
    const b = prows[i].ch[ch];
    if (a === undefined || b === undefined || Math.abs(b - a) < 1e-4) continue;
    if (cur && prows[i].t - cur.rows[cur.rows.length - 1].t <= 150) {
      cur.rows.push(prows[i]);
    } else {
      cur = { ch, before: prows[i - 1], rows: [prows[i]] };
      segs.push(cur);
    }
  }
  return segs
    .map((sg) => {
      const start = Math.max(sg.before.t, sg.rows[0].t - 17);
      const from = sg.before.ch[ch];
      const last = sg.rows[sg.rows.length - 1];
      const to = last.ch[ch];
      const excursion = Math.max(...sg.rows.map((r) => Math.abs(r.ch[ch] - from)));
      return { ch, start, end: last.t, from, to, excursion, before: sg.before, last, rows: sg.rows };
    })
    .filter((sg) => sg.excursion >= MIN_AMPLITUDE[family(sg.ch)]);
}

// Every frame where the channel changed, with the scroll burst it belongs to
// (the burst that started last before it) and the time since the scroll last moved.
function movingSteps(prows, ch, bursts) {
  const out = [];
  let bi = -1;
  for (let i = 1; i < prows.length; i++) {
    const a = prows[i - 1].ch[ch];
    const b = prows[i].ch[ch];
    if (a === undefined || b === undefined || Math.abs(b - a) < 1e-4) continue;
    const t = prows[i].t;
    while (bi + 1 < bursts.length && bursts[bi + 1].tStart <= t) bi++;
    const sinceScroll = bi < 0 ? Infinity : Math.max(0, t - bursts[bi].tEnd);
    out.push({ t, dv: Math.abs(b - a), burst: bi, sinceScroll, row: prows[i], prev: prows[i - 1] });
  }
  return out;
}

// Share of the still moments (while the element was observed: it is only sampled near the viewport)
// in which it moves as fast at the end as at the start: ~1 for loops. A scrub catching up with the
// scroll also moves while the page is still, but it slows down to a stop.
function movesInStillTails(moves, gaps, longIsEnough = true) {
  if (!moves.length) return 0;
  const from = moves[0].t;
  const to = moves[moves.length - 1].t;
  const seen = gaps.filter(([a, b]) => a >= from - 50 && b <= to + 50);
  // one still moment is enough evidence only if it is long (≥1.5s): nothing driven by scroll lasts that
  if (seen.length < 2 && !(longIsEnough && seen.length === 1 && seen[0][1] - seen[0][0] >= 1500)) return 0;
  const sum = (a, b) => moves.reduce((acc, m) => (m.t >= a && m.t <= b ? acc + m.dv : acc), 0);
  const steady = seen.filter(([a, b]) => {
    const head = sum(a, a + 250);
    const tail = sum(b - 250, b);
    // still moving at the end of a long still moment (a scrub has caught up by then), or as fast
    // at the end as at the start
    return tail > 0 && ((longIsEnough && b - a >= 1500) || tail >= head * 0.5);
  });
  return steady.length / seen.length;
}

function scrollLinked(el, ch, segs, moves, bursts) {
  const first = moves[0];
  const last = moves[moves.length - 1];
  const lastPerBurst = new Map();
  for (const m of moves) if (m.burst >= 0) lastPerBurst.set(m.burst, m.t);
  const lags = [...lastPerBurst].map(([b, t]) => t - bursts[b].tEnd).filter((x) => x >= 0);
  const lag = median(lags);
  const r0 = first.prev;
  const docTop = r0.top + r0.s - (r0.ch.y || 0);
  return {
    kind: 'scroll', element: el, ch,
    from: r0.ch[ch], to: last.row.ch[ch], fromRow: r0, toRow: last.row,
    scrollStart: first.row.s, scrollEnd: last.row.s,
    triggerStart: `top ${pct(docTop - first.row.s, r0.vh)}%`,
    triggerEnd: `top ${pct(docTop - last.row.s, r0.vh)}%`,
    scrub: lag < 80 ? true : round(lag / 1000, 1),
    scrubLagMs: Math.round(lag),
    // Value at evenly spaced scroll positions (as seen on screen, scrub lag included).
    samples: evenly(moves, 10).map((m) => ({ scroll: m.row.s, t: m.t, value: m.row.ch[ch], clip: m.row.clip, filter: m.row.filter, bg: m.row.bg, color: m.row.color, radius: m.row.radius })),
  };
}

function evenly(list, n) {
  if (list.length <= n) return list;
  return Array.from({ length: n }, (_, i) => list[Math.round((i / (n - 1)) * (list.length - 1))]);
}

function fitEase(seg) {
  const span = seg.to - seg.from;
  const dur = seg.end - seg.start;
  if (Math.abs(span) < 1e-6 || dur < 30) return null;
  const pts = [[0, 0], ...seg.rows.map((r) => [(r.t - seg.start) / dur, (r.ch[seg.ch] - seg.from) / span])];
  const scored = EASES.map(({ name, fn }) => {
    const err = Math.sqrt(pts.reduce((acc, [u, p]) => acc + (fn(u) - p) ** 2, 0) / pts.length);
    return { name, err: +err.toFixed(4) };
  }).sort((a, b) => a.err - b.err);
  const step = Math.max(1, Math.floor(pts.length / 24));
  const path = pts.filter((_, i) => i % step === 0).concat([[1, 1]]);
  const customEase = 'M0,0 ' + path.slice(1).map(([u, p]) => `L${u.toFixed(3)},${p.toFixed(3)}`).join(' ');
  return { best: scored[0], alternatives: scored.slice(1, 3), customEase };
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
const round = (v, d = 2) => +(+v).toFixed(d);
const pct = (top, vh) => Math.round((top / vh) * 100);

export function propsFor(ch, value, row) {
  const f = family(ch);
  if (f === 'clip') return { clipPath: roundCss(row.clip) };
  if (f === 'filter') return { filter: roundCss(row.filter) };
  if (f === 'bg') return { backgroundColor: row.bg };
  if (f === 'color') return { color: row.color };
  if (f === 'radius') return { borderRadius: row.radius };
  if (f === 'dash') return { strokeDashoffset: round(value, 1) };
  if (f === 'ls') return { letterSpacing: `${round(value, 2)}px` };
  if (f === 'width' || f === 'height') return { [f]: `${Math.round(value)}px` };
  if (ch === 'rotate') return { rotation: round(value, 1) };
  if (ch === 'opacity') return { opacity: round(value, 2) };
  if (ch === 'y' || ch === 'x') {
    // A translate that is a round multiple of the element's own size is almost always xPercent/yPercent.
    const size = ch === 'y' ? row.h : null;
    if (size) {
      const p = (value / size) * 100;
      if (Math.abs(p) >= 10 && Math.abs(p - Math.round(p / 10) * 10) < 1) return { [ch + 'Percent']: Math.round(p / 10) * 10 };
    }
    return { [ch]: Math.round(value) };
  }
  return { [ch]: round(value, family(ch).startsWith('scale') ? 2 : 3) };
}

const roundCss = (s) => s.replace(/-?\d*\.\d+/g, (n) => String(round(n, 1)));

// from and to must use the same unit: if one side became yPercent, convert the other.
export function sameUnits(from, to, row) {
  for (const k of ['x', 'y']) {
    const kp = k + 'Percent';
    const size = row.h;
    if (kp in from && k in to && size) { to[kp] = Math.round((to[k] / size) * 100); delete to[k]; }
    if (kp in to && k in from && size) { from[kp] = Math.round((from[k] / size) * 100); delete from[k]; }
  }
}

export function mergeScale(obj) {
  if ('scaleX' in obj && 'scaleY' in obj && Math.abs(obj.scaleX - obj.scaleY) < 0.01) {
    obj.scale = obj.scaleX;
    delete obj.scaleX;
    delete obj.scaleY;
  }
  return obj;
}

export function analyze(dump) {
  const allMarks = dump.marks || [];
  const marks = allMarks.filter((m) => m.phase !== 'step' && m.phase !== 'ambient');
  // elements already moving with the page at rest, before any scroll: loops / ambient motion
  const ambientIds = new Set((allMarks.find((m) => m.phase === 'ambient') || {}).info || []);
  const mouseStart = (allMarks.find((m) => m.phase === 'mouse') || {}).t ?? null;
  // Sites that scroll a transformed container (Locomotive, custom smooth scroll) never move
  // window.scrollY: use the wheel distance the extractor sent as a virtual scroll position.
  const steps = allMarks.filter((m) => m.phase === 'step');
  const virtualScroll = dump.scroll.length < 3 && steps.length >= 3;
  const scrollAt = virtualScroll
    ? (t) => {
        let v = 0;
        for (const m of steps) if (m.t <= t) v = m.info;
        return v;
      }
    : null;
  const scroll = virtualScroll ? [[0, 0], ...steps.map((m) => [m.t, m.info])] : dump.scroll;
  // One burst per wheel step the extractor sent (smooth scrolling never fully stops between short
  // pauses, so splitting the scroll series on gaps would merge steps). Older dumps: split on gaps.
  const bursts = steps.length
    ? steps
        .map((m, i) => {
          const next = steps[i + 1] ? steps[i + 1].t : Infinity;
          const inside = scroll.filter(([t]) => t >= m.t && t < next);
          if (!inside.length) return null;
          const last = inside[inside.length - 1];
          return { tStart: m.t, tEnd: virtualScroll ? m.t + 150 : last[0], sTo: last[1] };
        })
        .filter(Boolean)
    : scrollBursts(scroll);
  const phaseAt = (t) => {
    let m = null;
    for (const k of marks) if (k.t <= t) m = k;
    return m ? { phase: m.phase === 'settle' ? 'hover' : m.phase, info: m.info } : { phase: 'intro', info: null };
  };
  // Moments the page scroll is really still (and the intro): loops keep moving at the same speed there.
  const stillTails = (virtualScroll
    ? bursts.map((b, i) => [i ? bursts[i - 1].tEnd : 0, b.tStart])
    : scroll.map(([t], i) => [i ? scroll[i - 1][0] : 0, t])
  ).filter(([from, to]) => to - from > 600);
  const animations = [];
  const exactFor = exactTimings(dump);

  for (const el of dump.tracked) {
    const prows = parseRows(el.rows, scrollAt);
    const channels = [...new Set(prows.flatMap((r) => Object.keys(r.ch)))];
    const timeSegs = [];

    for (const ch of channels) {
      const segs = segmentsFor(prows, ch);
      if (!segs.length) continue;
      const moves = movingSteps(prows, ch, bursts);
      const movingTime = segs.reduce((acc, sg) => acc + sg.end - sg.start, 0);
      const burstsWithMotion = new Set(moves.map((m) => m.burst).filter((b) => b >= 0));

      // a loop already runs before the mouse test starts (the cursor only moves during it)
      const preMouse = mouseStart == null ? 0 : moves.filter((m) => m.t > mouseStart - 1500 && m.t <= mouseStart).length;
      const ambientLoop = ambientIds.has(el.id) && movingTime > 3000 && preMouse >= 10;
      if (ambientLoop || (movingTime > 6000 && movesInStillTails(moves, stillTails, !virtualScroll) > 0.8)) {
        // median frame-to-frame speed: robust to the jump of a marquee wrapping around
        const speeds = moves.map((m) => ((m.row.ch[ch] - m.prev.ch[ch]) / Math.max(1, m.row.t - m.prev.t)) * 1000);
        const typical = median(speeds.map(Math.abs));
        const steady = speeds.filter((v) => Math.abs(v) <= typical * 5);
        animations.push({
          kind: 'loop', element: el, ch,
          speedPerSecond: round(median(steady), 2),
        });
      } else if (burstsWithMotion.size >= 3) {
        animations.push(scrollLinked(el, ch, segs, moves, bursts));
      } else {
        timeSegs.push(...segs);
      }
    }

    // Channels of the same element moving together = one tween with several properties.
    timeSegs.sort((a, b) => a.start - b.start);
    const groups = [];
    for (const sg of timeSegs) {
      const g = groups.find((g) => Math.abs(g.start - sg.start) < 60);
      if (g) g.segs.push(sg);
      else groups.push({ start: sg.start, segs: [sg] });
    }
    for (const g of groups) {
      const main = g.segs.reduce((a, b) =>
        Math.abs(b.to - b.from) / MIN_AMPLITUDE[family(b.ch)] > Math.abs(a.to - a.from) / MIN_AMPLITUDE[family(a.ch)] ? b : a,
      );
      const duration = Math.max(...g.segs.map((s) => s.end - s.start));
      // Instant jumps are gsap.set / immediateRender of .from() / pin offsets, not animations.
      if (duration < 60) continue;
      // Seconds of constant-speed motion with no end in sight = a marquee/loop, not an entrance.
      const linear = g.segs.find((s) => ['x', 'y', 'rotate'].includes(s.ch));
      if (linear && duration > 4000) {
        const fit = fitEase(linear);
        if (fit && fit.best.name === 'none' && fit.best.err < 0.03) {
          animations.push({ kind: 'loop', element: el, ch: linear.ch, speedPerSecond: round(((linear.to - linear.from) / (linear.end - linear.start)) * 1000, 2) });
          continue;
        }
      }
      const r0 = main.rows[0];
      const { phase, info } = phaseAt(g.start);
      animations.push({
        kind: 'time', element: el,
        start: g.start, duration,
        phase, hoverTarget: info,
        onLoad: phase === 'intro',
        triggerStart: `top ${pct(r0.top - (r0.ch.y || 0), r0.vh)}%`,
        scrollAtStart: r0.s,
        segs: g.segs,
        ...(() => {
          const ex = exactFor(el.id, g.start, duration);
          return ex && ex.scrubbed ? { scrubbed: true, ease: fitEase(main) } : { ease: withExact(fitEase(main), ex) };
        })(),
      });
    }
  }

  detectStagger(animations.filter((a) => a.kind === 'time'));
  // the site's own stagger value, when its GSAP call says it, replaces the measured one
  const groups = new Map();
  for (const a of animations) if (a.stagger) (groups.get(a.stagger.group) || groups.set(a.stagger.group, []).get(a.stagger.group)).push(a);
  for (const list of groups.values()) {
    const exact = list.map((a) => a.ease && a.ease.exactStagger).find((v) => v > 0);
    if (exact) list.forEach((a) => Object.assign(a.stagger, { each: exact, measured: a.stagger.each }));
  }
  return { bursts: bursts.length, virtualScroll, animations };
}

function signature(a) {
  return a.phase + '|' + a.segs.map((s) => `${s.ch}:${Math.round(s.from)}>${Math.round(s.to)}`).sort().join(',');
}

function detectStagger(timeAnims) {
  const bySig = new Map();
  for (const a of timeAnims) {
    const k = signature(a);
    if (!bySig.has(k)) bySig.set(k, []);
    bySig.get(k).push(a);
  }
  let groupId = 1;
  for (const list of bySig.values()) {
    list.sort((a, b) => a.start - b.start);
    let cluster = [list[0]];
    const flush = () => {
      if (cluster.length >= 2) {
        const deltas = cluster.slice(1).map((a, i) => a.start - cluster[i].start);
        let mean = deltas.reduce((x, y) => x + y, 0) / deltas.length;
        const sd = Math.sqrt(deltas.reduce((x, d) => x + (d - mean) ** 2, 0) / deltas.length);
        let regular = mean > 5 && sd < Math.max(14, mean * 0.3);
        if (!regular && cluster.length >= 4) {
          // Many elements → frames get coarse; a linear fit of start time vs index is robust to that jitter.
          const n = cluster.length;
          const xs = cluster.map((_, i) => i);
          const ys = cluster.map((a) => a.start);
          const mx = (n - 1) / 2;
          const my = ys.reduce((x, y) => x + y, 0) / n;
          const sxy = xs.reduce((acc, x, i) => acc + (x - mx) * (ys[i] - my), 0);
          const sxx = xs.reduce((acc, x) => acc + (x - mx) ** 2, 0);
          const slope = sxy / sxx;
          const ssRes = ys.reduce((acc, y, i) => acc + (y - (my + slope * (i - mx))) ** 2, 0);
          const ssTot = ys.reduce((acc, y) => acc + (y - my) ** 2, 0);
          if (slope > 5 && ssTot > 0 && 1 - ssRes / ssTot > 0.9) {
            regular = true;
            mean = slope;
          }
        }
        if (regular) {
          const id = groupId++;
          cluster.forEach((a, i) => {
            a.stagger = { group: id, index: i, size: cluster.length, each: round(mean / 1000, 3) };
          });
        }
      }
    };
    for (const a of list.slice(1)) {
      const prev = cluster[cluster.length - 1];
      if (a.start - prev.start < 400 && Math.abs(a.duration - cluster[0].duration) < cluster[0].duration * 0.2) cluster.push(a);
      else {
        flush();
        cluster = [a];
      }
    }
    flush();
  }
}

// ---------- GSAP code reconstruction ----------
const js = (o) =>
  '{ ' + Object.entries(o).map(([k, v]) => `${k}: ${typeof v === 'string' && !v.startsWith('__raw:') ? JSON.stringify(v) : String(v).replace(/^__raw:/, '')}`).join(', ') + ' }';

export function recreate(result) {
  const lines = [
    '// Bozza ricostruita dai valori misurati: è un punto di partenza, non il codice originale.',
    '// Selettori, start/end e scrub sono approssimati: controllali guardando il video.',
    "import { gsap } from 'gsap';",
    "import { ScrollTrigger } from 'gsap/ScrollTrigger';",
    "import { CustomEase } from 'gsap/CustomEase';",
    'gsap.registerPlugin(ScrollTrigger, CustomEase);',
    '',
  ];
  let customId = 1;
  const easeExpr = (fit) => {
    if (!fit) return 'power2.out';
    const g = gsapEase(fit.best.name);
    if (g.path) {
      const name = `css-${customId++}`;
      lines.push(`CustomEase.create(${JSON.stringify(name)}, ${JSON.stringify(g.path)}); // ${g.css} (dal CSS del sito)`);
      return name;
    }
    if (fit.best.err < 0.04) return fit.best.name;
    const name = `measured-${customId++}`;
    lines.push(`CustomEase.create(${JSON.stringify(name)}, ${JSON.stringify(fit.customEase)}); // più vicina: ${fit.best.name} (err ${fit.best.err})`);
    return name;
  };

  const done = new Set();
  for (const a of result.animations) {
    if (done.has(a)) continue;
    if (a.kind === 'loop') {
      lines.push(`// Loop continuo su ${JSON.stringify(a.element.selector)} (${a.ch}, ${a.speedPerSecond}/s): probabile marquee`);
      lines.push(`gsap.to(${JSON.stringify(a.element.selector)}, { ${a.ch === 'rotate' ? 'rotation' : a.ch}: "+=${Math.round(a.speedPerSecond * 10)}", duration: 10, ease: "none", repeat: -1 });`, '');
      continue;
    }
    if (a.kind === 'scroll') {
      const from = mergeScale(propsFor(a.ch, a.from, a.fromRow));
      const to = mergeScale(propsFor(a.ch, a.to, a.toRow));
      sameUnits(from, to, a.fromRow);
      const st = { trigger: a.element.selector, start: a.triggerStart, end: a.triggerEnd, scrub: '__raw:' + a.scrub };
      lines.push(`// scroll-linked: scroll ${a.scrollStart}px → ${a.scrollEnd}px, ritardo misurato ${a.scrubLagMs}ms`);
      lines.push(`gsap.fromTo(${JSON.stringify(a.element.selector)}, ${js(from)}, ${js({ ...to, ease: 'none', scrollTrigger: '__raw:' + js(st) })});`, '');
      continue;
    }
    if (a.phase === 'mouse' || a.phase === 'hover') {
      done.add(a);
      const what = a.phase === 'mouse' ? 'reagisce al mouse' : `hover su ${a.hoverTarget}`;
      lines.push(`// ${what}: ${JSON.stringify(a.element.selector)} (${a.segs.map((s) => s.ch).join(', ')}) — vedi dna.json → interactions`, '');
      continue;
    }
    let members = [a];
    if (a.stagger) {
      members = result.animations.filter((b) => b.stagger && b.stagger.group === a.stagger.group);
    }
    members.forEach((m) => done.add(m));
    const from = {};
    const to = {};
    for (const sg of a.segs) {
      Object.assign(from, propsFor(sg.ch, sg.from, sg.before));
      Object.assign(to, propsFor(sg.ch, sg.to, sg.last));
    }
    mergeScale(from);
    mergeScale(to);
    sameUnits(from, to, a.segs[0].before);
    const seconds = a.ease && a.ease.exactDuration ? a.ease.exactDuration : round(a.duration / 1000, 2);
    const vars = { ...to, duration: '__raw:' + seconds, ease: easeExpr(a.ease) };
    if (a.stagger) vars.stagger = '__raw:' + a.stagger.each;
    if (a.onLoad) vars.delay = '__raw:' + round(a.start / 1000, 2);
    else vars.scrollTrigger = '__raw:' + js({ trigger: a.element.selector, start: a.triggerStart });
    const targets = members.length > 1 ? `[\n  ${members.map((m) => JSON.stringify(m.element.selector)).join(',\n  ')}\n]` : JSON.stringify(a.element.selector);
    const label = a.element.text ? ` "${a.element.text.slice(0, 40)}"` : '';
    lines.push(`// ${a.onLoad ? 'intro al caricamento' : 'entra allo scroll'}${label}${a.ease ? ` · easing ${a.ease.best.name} (err ${a.ease.best.err})` : ''}`);
    lines.push(`gsap.fromTo(${targets}, ${js(from)}, ${js(vars)});`, '');
  }
  return lines.join('\n');
}
