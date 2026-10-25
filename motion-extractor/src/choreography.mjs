// What makes a site unique even with the same library: the choreography (who enters
// first, offsets, overlap), the motion vocabulary (reveal types, eases, durations,
// distances), the scroll staging (pins, parallax depth layers) and the interactions.
const family = (ch) => ch.replace(/\d+$/, '');
const round = (v, d = 2) => +(+v).toFixed(d);
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
const tally = (items) => {
  const m = new Map();
  for (const i of items) m.set(i, (m.get(i) || 0) + 1);
  const total = items.length || 1;
  return [...m].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count, share: round(count / total) }));
};

export function revealType(a) {
  const seg = (f) => a.segs.find((s) => family(s.ch) === f);
  const has = (f) => !!seg(f);
  const meta = a.element.meta || {};
  const y = seg('y');
  const x = seg('x');
  const sc = seg('scaleX') || seg('scaleY');
  if (has('clip')) return 'clip-reveal';
  if (has('filter')) return 'blur-in';
  if ((y || x) && meta.masked) return 'mask-slide';
  if (y && has('opacity')) return y.from > y.to ? 'fade-up' : 'fade-down';
  if (x && has('opacity')) return 'fade-side';
  if (sc) return (sc.from > sc.to ? 'scale-down' : 'scale-up') + (has('opacity') ? '-fade' : '');
  if (has('rotate')) return 'rotate-in';
  if (y) return y.from > y.to ? 'slide-up' : 'slide-down';
  if (x) return 'slide-side';
  if (has('opacity')) return 'fade';
  return 'other';
}

function propsSummary(a) {
  const h = (a.element.meta && a.element.meta.h) || null;
  return a.segs
    .map((s) => {
      const f = family(s.ch);
      if (f === 'y' || f === 'x') {
        const d = s.from - s.to;
        const p = h && f === 'y' ? ` (${Math.round((d / h) * 100)}% dell'altezza)` : '';
        return `${f} ${Math.round(s.from)}→${Math.round(s.to)}px${p}`;
      }
      if (f === 'clip') return `clip ${s.before.clip} → ${s.last.clip}`;
      if (f === 'filter') return `filter ${s.before.filter} → ${s.last.filter}`;
      return `${s.ch} ${round(s.from)}→${round(s.to)}`;
    })
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .join(', ');
}

function buildScenes(time) {
  const sorted = [...time].sort((a, b) => a.start - b.start);
  const scenes = [];
  for (const a of sorted) {
    const cur = scenes[scenes.length - 1];
    const lastStart = cur && cur.anims[cur.anims.length - 1].start;
    if (cur && cur.phase === a.phase && a.start - lastStart < 700) cur.anims.push(a);
    else scenes.push({ phase: a.phase, anims: [a] });
  }
  return scenes.map((sc, i) => {
    const t0 = sc.anims[0].start;
    for (const a of sc.anims) a.scene = { id: i + 1, offset: Math.round(a.start - t0), scroll0: sc.anims[0].scrollAtStart };
    const beats = [];
    const seenGroup = new Map();
    for (const a of sc.anims) {
      const gid = a.stagger && a.stagger.group;
      if (gid && seenGroup.has(gid)) {
        seenGroup.get(gid).count++;
        continue;
      }
      const meta = a.element.meta || {};
      const beat = {
        role: meta.role || 'shape',
        label: a.element.text ? a.element.text.slice(0, 40) : a.element.selector.split(' > ').pop(),
        selector: a.element.selector,
        offset: a.start - t0,
        duration: Math.round(a.duration),
        count: 1,
        staggerEach: a.stagger ? a.stagger.each : null,
        reveal: revealType(a),
        ease: a.ease ? (a.ease.best.err < 0.04 ? a.ease.best.name : `custom (≈${a.ease.best.name})`) : null,
        props: propsSummary(a),
      };
      if (gid) seenGroup.set(gid, beat);
      beats.push(beat);
    }
    // Total length of the beat including its stagger tail.
    for (const b of beats) b.span = b.duration + (b.staggerEach ? Math.round(b.staggerEach * 1000 * (b.count - 1)) : 0);
    const span = Math.max(...beats.map((b) => b.offset + b.span));
    const busy = beats.reduce((acc, b) => acc + b.span, 0);
    const sections = tally(sc.anims.map((a) => (a.element.meta && a.element.meta.section) || '?'));
    const roles = beats.map((b) => b.role).filter((r, j, arr) => r !== arr[j - 1]);
    const offsets = beats.slice(1).map((b, j) => b.offset - beats[j].offset);
    return {
      id: i + 1,
      phase: sc.phase,
      section: sections[0].name,
      trigger: sc.phase === 'intro' ? `al caricamento (+${(t0 / 1000).toFixed(2)}s)` : `scroll ${sc.anims[0].scrollAtStart}px · elemento a ${sc.anims[0].triggerStart}`,
      spanMs: span,
      overlap: round(busy / span),
      roleOrder: roles.join(' → '),
      medianOffsetMs: median(offsets),
      beats,
    };
  });
}

function scrollLayers(scrollAnims, vh) {
  const layers = [];
  const effects = [];
  for (const a of scrollAnims) {
    const range = a.scrollEnd - a.scrollStart;
    if (!range) continue;
    const f = family(a.ch);
    const meta = a.element.meta || {};
    if (f === 'y' || f === 'x') {
      const speed = (a.to - a.from) / range;
      layers.push({
        selector: a.element.selector,
        role: meta.role,
        axis: f,
        // On-screen speed relative to the page: 100% = moves with the scroll.
        screenSpeed: f === 'y' ? Math.round((1 - speed) * 100) : null,
        travelPx: Math.round(a.to - a.from),
        overVh: Math.round((range / vh) * 100),
        scrub: a.scrub,
      });
    } else {
      effects.push({ selector: a.element.selector, role: meta.role, property: a.ch, from: round(a.from), to: round(a.to), overVh: Math.round((range / vh) * 100), scrub: a.scrub });
    }
  }
  layers.sort((a, b) => (a.screenSpeed ?? 100) - (b.screenSpeed ?? 100));
  return { layers, effects };
}

function interactions(anims, dump) {
  const mouse = anims.filter((a) => a.kind === 'time' && a.phase === 'mouse');
  const hover = anims.filter((a) => a.kind === 'time' && a.phase === 'hover');
  const byEl = new Map();
  for (const a of mouse) {
    const k = a.element.selector;
    if (!byEl.has(k)) byEl.set(k, a);
  }
  const cursor = [];
  const mouseParallax = [];
  for (const a of byEl.values()) {
    const meta = a.element.meta || {};
    const item = { selector: a.element.selector, w: meta.w, h: meta.h, props: [...new Set(a.segs.map((s) => family(s.ch)))].join(', ') };
    if (meta.fixed && meta.w < 160 && meta.h < 160) cursor.push(item);
    else mouseParallax.push(item);
  }
  const marks = dump.marks || [];
  const hoverWindows = marks
    .map((m, i) => (m.phase === 'hover' ? { target: m.info, from: m.t, to: (marks[i + 1] || { t: Infinity }).t } : null))
    .filter(Boolean);
  const hovers = new Map();
  const add = (target, what) => {
    if (!hovers.has(target)) hovers.set(target, []);
    hovers.get(target).push(what);
  };
  for (const a of hover) {
    if (!a.hoverTarget || byEl.has(a.element.selector)) continue;
    add(a.hoverTarget, { element: a.element.selector, props: propsSummary(a), duration: Math.round(a.duration), ease: a.ease && a.ease.best.name, via: 'js' });
  }
  for (const c of dump.cssAnimations || []) {
    const w = hoverWindows.find((h) => c.t >= h.from && c.t < h.to);
    if (w && c.kind === 'CSSTransition') add(w.target, { element: c.target, props: c.name, duration: c.duration, ease: c.easing, via: 'css' });
  }
  return { cursor, mouseParallax, hover: [...hovers].map(([target, effects]) => ({ target, effects })) };
}

export function choreography(result, dump, scene) {
  const vh = dump.viewport.h;
  const anims = result.animations;
  const time = anims.filter((a) => a.kind === 'time' && (a.phase === 'intro' || a.phase === 'scroll'));
  const scroll = anims.filter((a) => a.kind === 'scroll');
  const loops = anims.filter((a) => a.kind === 'loop');
  const scenes = buildScenes(time);
  const { layers, effects } = scrollLayers(scroll, vh);
  const pins = (scene.effects.pinSpacers || []).map((p) => ({
    ...p,
    scrubbedInside: scroll.filter((a) => a.element.selector.startsWith(p.selector) || (a.element.meta && a.element.meta.section === p.selector)).map((a) => `${a.element.selector.split(' > ').pop()} ${a.ch}`),
  }));

  const fitted = time.filter((a) => a.ease);
  const yDist = time.flatMap((a) => a.segs.filter((s) => s.ch === 'y').map((s) => Math.abs(s.from - s.to)));
  const yPct = time.flatMap((a) =>
    a.segs.filter((s) => s.ch === 'y' && a.element.meta && a.element.meta.h).map((s) => Math.round((Math.abs(s.from - s.to) / a.element.meta.h) * 100)),
  );
  const allBeats = scenes.flatMap((s) => s.beats);
  const signature = {
    eases: tally(fitted.map((a) => (a.ease.best.err < 0.04 ? a.ease.best.name : 'custom'))).slice(0, 4),
    durationS: time.length
      ? { median: round(median(time.map((a) => a.duration)) / 1000), min: round(Math.min(...time.map((a) => a.duration)) / 1000), max: round(Math.max(...time.map((a) => a.duration)) / 1000) }
      : null,
    staggersS: [...new Set(time.filter((a) => a.stagger).map((a) => a.stagger.each))].sort(),
    distance: { yPxMedian: median(yDist), yPercentOfElementMedian: median(yPct) },
    reveals: tally(allBeats.map((b) => b.reveal)),
    rolesFirst: tally(scenes.map((s) => s.beats[0].role)),
    roleOrders: tally(scenes.filter((s) => s.beats.length > 1).map((s) => s.roleOrder)).slice(0, 4),
    overlapMedian: median(scenes.filter((s) => s.beats.length > 1).map((s) => s.overlap)),
    beatOffsetMedianMs: median(scenes.map((s) => s.medianOffsetMs).filter((x) => x != null)),
    scrollLinkedShare: round(scroll.length / Math.max(1, scroll.length + time.length)),
    scrubMedian: median(scroll.map((a) => (a.scrub === true ? 0 : a.scrub))),
    parallaxLayers: layers.length,
    pinnedVh: pins.reduce((acc, p) => acc + p.pinnedForVh, 0),
    loops: loops.length,
    pageVh: Math.round((dump.docHeight / vh) * 100),
    scenesPerScreen: round(scenes.length / (dump.docHeight / vh)),
  };
  return {
    signature,
    scenes,
    layers,
    scrollEffects: effects,
    pins,
    loops: loops.map((l) => ({ selector: l.element.selector, property: l.ch, speedPerSecond: l.speedPerSecond })),
    interactions: interactions(anims, dump),
  };
}
