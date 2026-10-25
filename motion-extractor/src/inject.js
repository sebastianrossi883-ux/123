// Injected at document-start (before any site script) by Playwright's addInitScript.
// Records: elements whose inline style changes, their computed values every frame,
// the scroll position, CSS/WAAPI animations, canvas contexts, and — when GSAP is
// loaded as a global (CDN/UMD) — every gsap.to/from/fromTo/timeline call.
(() => {
  if (window.top !== window || window.__motion) return;

  const MAX_TRACKED = 400;
  const MAX_CALLS = 3000;
  const t0 = performance.now();
  const now = () => Math.round(performance.now() - t0);

  const S = (window.__motion = {
    tracked: [],
    scroll: [],
    calls: [],
    plugins: [],
    contexts: [],
    cssAnimations: [],
    marks: [],
  });
  window.__motionMark = (phase, info) => S.marks.push({ t: now(), phase, info: info || null });
  let nextId = 1;

  function cssPath(el) {
    if (!(el instanceof Element)) return String(el);
    const parts = [];
    while (el && el.nodeType === 1 && parts.length < 5) {
      let p = el.tagName.toLowerCase();
      if (el.id && !/^\d/.test(el.id)) {
        parts.unshift(p + '#' + CSS.escape(el.id));
        break;
      }
      const cls = [...el.classList]
        .filter((c) => !/^(is-|has-|lenis|pin-spacer|active|visible)/.test(c))
        .slice(0, 2);
      if (cls.length) p += '.' + cls.map((c) => CSS.escape(c)).join('.');
      const parent = el.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === el.tagName);
        if (same.length > 1) p += `:nth-of-type(${same.indexOf(el) + 1})`;
      }
      parts.unshift(p);
      el = parent;
    }
    return parts.join(' > ');
  }

  function ser(v, depth = 0) {
    if (v == null || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v;
    if (typeof v === 'function') {
      const src = Function.prototype.toString.call(v);
      return 'ƒ ' + (v.name ? v.name + ' ' : '') + src.slice(0, 160);
    }
    if (v instanceof Element) return cssPath(v);
    if (v === window) return 'window';
    if (v === document) return 'document';
    if (Array.isArray(v) || v instanceof NodeList || v instanceof HTMLCollection) {
      return depth > 2 ? '[…]' : [...v].slice(0, 12).map((x) => ser(x, depth + 1));
    }
    if (typeof v === 'object') {
      if (depth > 3) return '{…}';
      const o = {};
      for (const k of Object.keys(v)) {
        if (k.startsWith('_')) continue;
        try { o[k] = ser(v[k], depth + 1); } catch (e) {}
      }
      return o;
    }
    return String(v);
  }

  // Only elements near the viewport (one screen above/below) are sampled: on heavy pages sampling
  // everything every frame slows the page down, and motion far off screen is not seen anyway.
  // Checked with the element's own rect every 250ms (an IntersectionObserver would call "hidden"
  // the text that sits inside an overflow:hidden mask, i.e. exactly what mask reveals animate).
  const near = new WeakSet();
  let lastNearCheck = -1e9;
  function updateNear(t) {
    if (t - lastNearCheck < 250) return;
    lastNearCheck = t;
    const vh = innerHeight;
    for (const it of S.tracked) {
      const r = it.el.getBoundingClientRect();
      if (r.bottom > -vh && r.top < vh * 2) near.add(it.el);
      else near.delete(it.el);
    }
  }

  // ---- 1. Which elements are being animated (inline style mutations) ----
  function track(el) {
    if (el.__motionId || S.tracked.length >= MAX_TRACKED) return;
    if (el === document.documentElement) return;
    el.__motionId = nextId++;
    S.tracked.push({
      id: el.__motionId,
      el,
      selector: cssPath(el),
      tag: el.tagName.toLowerCase(),
      text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60),
      firstSeen: now(),
      rows: [],
      last: '',
    });
    near.add(el);
  }
  new MutationObserver((ms) => {
    for (const m of ms) if (m.target.nodeType === 1) track(m.target);
  }).observe(document, { attributes: true, attributeFilter: ['style', 'class'], subtree: true });

  // ---- 2. Per-frame sampling of computed values ----
  let lastScroll = null;
  let lastCssScan = 0;
  const seenAnims = new WeakSet();
  function sample() {
    const t = now();
    const sy = Math.round(window.scrollY);
    if (sy !== lastScroll) {
      S.scroll.push([t, sy]);
      lastScroll = sy;
    }
    const vh = window.innerHeight;
    updateNear(t);
    for (const it of S.tracked) {
      if (!it.el.isConnected || (!near.has(it.el) && it.rows.length)) continue;
      const cs = getComputedStyle(it.el);
      const key = [cs.transform, cs.opacity, cs.clipPath, cs.filter, cs.width, cs.height, cs.backgroundColor, cs.color, cs.borderRadius, cs.strokeDashoffset, cs.letterSpacing].join('|');
      if (key === it.last) continue;
      it.last = key;
      it.lastChange = t;
      const r = it.el.getBoundingClientRect();
      // [time, scrollY, transform, opacity, clipPath, filter, rectTop, rectHeight, viewportH,
      //  width, height, backgroundColor, color, borderRadius, strokeDashoffset, letterSpacing]
      it.rows.push([t, sy, cs.transform, +cs.opacity, cs.clipPath, cs.filter, Math.round(r.top), Math.round(r.height), vh,
        cs.width, cs.height, cs.backgroundColor, cs.color, cs.borderRadius, cs.strokeDashoffset, cs.letterSpacing]);
    }
    if (t - lastCssScan > 250 && document.getAnimations) {
      lastCssScan = t;
      for (const a of document.getAnimations()) {
        if (seenAnims.has(a) || S.cssAnimations.length > 1500) continue;
        seenAnims.add(a);
        // CSS animations/transitions (e.g. triggered by an `.is-visible` class) get sampled too.
        if (a.effect && a.effect.target instanceof Element) track(a.effect.target);
        try {
          const timing = a.effect && a.effect.getTiming ? a.effect.getTiming() : {};
          const frames = a.effect && a.effect.getKeyframes ? a.effect.getKeyframes() : [];
          S.cssAnimations.push({
            t,
            // when it really started (the scan runs every 250ms), in the same clock as the samples
            start: a.startTime != null ? Math.round(a.startTime - t0) : t,
            targetId: a.effect && a.effect.target ? a.effect.target.__motionId || null : null,
            kind: a.constructor && a.constructor.name, // CSSAnimation / CSSTransition / Animation
            name: a.animationName || a.transitionProperty || a.id || '',
            target: a.effect && a.effect.target ? cssPath(a.effect.target) : null,
            duration: timing.duration,
            delay: timing.delay,
            // CSS @keyframes carry their timing function on the keyframes, transitions on the timing
            easing: timing.easing && timing.easing !== 'linear' ? timing.easing : (frames[0] && frames[0].easing) || 'linear',
            iterations: timing.iterations,
            keyframes: S.cssAnimations.length < 300 ? ser(frames) : null,
            scrollDriven: !!(a.timeline && a.timeline.constructor && /Scroll|View/.test(a.timeline.constructor.name)),
          });
        } catch (e) {}
      }
    }
    requestAnimationFrame(sample);
  }
  requestAnimationFrame(sample);

  // ---- 3. Canvas contexts (WebGL = shader effects that GSAP alone can't do) ----
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const ctx = origGetContext.call(this, type, ...rest);
    if (ctx && !this.__motionCtx) {
      this.__motionCtx = type;
      S.contexts.push({ type, w: this.width, h: this.height });
    }
    return ctx;
  };

  // ---- 4. GSAP global hook (works when GSAP is loaded via <script>/CDN) ----
  function targetIds(targets) {
    try {
      const g = window.gsap;
      const els = g && g.utils ? g.utils.toArray(targets) : [];
      return els.filter((e) => e instanceof Element).slice(0, 60).map((e) => (track(e), e.__motionId || null)).filter(Boolean);
    } catch (e) {
      return [];
    }
  }
  function record(kind, owner, targets, a, b, pos) {
    if (S.calls.length >= MAX_CALLS) return;
    S.calls.push({
      ids: targets == null ? [] : targetIds(targets),
      t: now(),
      scroll: Math.round(window.scrollY),
      kind,
      timeline: owner && owner.__motionTl ? owner.__motionTl : null,
      targets: ser(targets),
      vars: ser(a),
      toVars: b === undefined ? undefined : ser(b),
      position: pos === undefined ? undefined : ser(pos),
    });
  }
  let tlId = 1;
  function patchGsap(g) {
    if (!g || g.__motionPatched) return;
    g.__motionPatched = true;
    for (const m of ['to', 'from', 'fromTo', 'set']) {
      const orig = g[m];
      if (typeof orig !== 'function') continue;
      g[m] = function (targets, a, b) {
        record('gsap.' + m, null, targets, a, m === 'fromTo' ? b : undefined);
        return orig.apply(this, arguments);
      };
    }
    const origTl = g.timeline;
    g.timeline = function (vars) {
      const tl = origTl.apply(this, arguments);
      tl.__motionTl = tlId++;
      record('gsap.timeline', tl, null, vars);
      return tl;
    };
    const proto = g.core && g.core.Timeline && g.core.Timeline.prototype;
    if (proto) {
      for (const m of ['to', 'from', 'fromTo']) {
        const orig = proto[m];
        proto[m] = function (targets, a, b, c) {
          if (m === 'fromTo') record('tl.fromTo', this, targets, a, b, c);
          else record('tl.' + m, this, targets, a, undefined, b);
          return orig.apply(this, arguments);
        };
      }
    }
    const origReg = g.registerPlugin;
    g.registerPlugin = function (...plugins) {
      for (const p of plugins) S.plugins.push((p && (p.name || p.prototype?.constructor?.name)) || '?');
      return origReg.apply(this, plugins);
    };
  }
  function hookGlobal(name, onSet) {
    let value;
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: true,
        get: () => value,
        set: (v) => {
          value = v;
          try { onSet(v); } catch (e) {}
        },
      });
    } catch (e) {}
  }
  hookGlobal('gsap', patchGsap);
  hookGlobal('ScrollTrigger', (ST) => {
    if (!ST || ST.__motionPatched || typeof ST.create !== 'function') return;
    ST.__motionPatched = true;
    const orig = ST.create;
    ST.create = function (vars) {
      record('ScrollTrigger.create', null, null, vars);
      return orig.apply(this, arguments);
    };
  });

  // ---- 5. Role of an animated element in the page (for the choreography) ----
  function sectionOf(el) {
    const sec = el.closest('section, header, footer, article, [class*="section"]');
    if (sec && sec !== document.body) return sec;
    let a = el;
    while (a.parentElement && a.parentElement !== document.body && a.parentElement.tagName !== 'MAIN') a = a.parentElement;
    return a;
  }
  function meta(el) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const text = (el.textContent || '').trim();
    const fs = parseFloat(cs.fontSize);
    const bg = cs.backgroundImage;
    const isMedia =
      el.matches('img, video, picture, canvas, svg') ||
      (bg !== 'none' && !/^(linear|radial|conic)-gradient/.test(bg)) ||
      (!!el.querySelector('img, video, picture, canvas') && text.length < 20);
    let role = 'shape';
    if (el.closest('h1, h2, h3, h4, h5, h6, [role="heading"]')) role = 'heading';
    else if (isMedia) role = 'media';
    else if (el.closest('a, button')) role = 'button';
    else if (text) role = fs >= 32 ? 'heading' : 'text';
    else if (r.width * r.height > innerWidth * innerHeight * 0.15) role = 'media';
    const p = el.parentElement;
    let masked = false;
    if (p) {
      const pcs = getComputedStyle(p);
      const pr = p.getBoundingClientRect();
      masked = /hidden|clip/.test(pcs.overflow + pcs.overflowX + pcs.overflowY) && pr.height < r.height * 1.6 && pr.height > 0;
    }
    const sec = sectionOf(el);
    return {
      role,
      masked,
      fixed: cs.position === 'fixed',
      w: Math.round(r.width),
      h: Math.round(r.height),
      fontSize: Math.round(fs),
      section: cssPath(sec),
      sectionTop: Math.round(sec.getBoundingClientRect().top + scrollY),
    };
  }

  // ---- 6. Scenography: typography, palette, sections, layout, effects ----
  const hex = (c) => {
    const m = c && c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    if (a < 0.1) return null;
    return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  };
  const bump = (map, k, w) => k != null && map.set(k, (map.get(k) || 0) + w);
  const top = (map, n) => [...map].sort((a, b) => b[1] - a[1]).slice(0, n);

  function effectiveBg(el) {
    for (let a = el; a; a = a.parentElement) {
      const c = hex(getComputedStyle(a).backgroundColor);
      if (c) return c;
    }
    return '#ffffff';
  }

  // Rect without the element's own translate (so a half-finished parallax doesn't skew positions).
  function layoutRect(el) {
    const r = el.getBoundingClientRect();
    const t = getComputedStyle(el).transform;
    let tx = 0;
    let ty = 0;
    if (t && t !== 'none') {
      const n = t.slice(t.indexOf('(') + 1, -1).split(',').map(Number);
      [tx, ty] = t.startsWith('matrix3d') ? [n[12], n[13]] : [n[4], n[5]];
    }
    return { left: r.left - tx, top: r.top - ty, width: r.width, height: r.height };
  }

  const LAYOUT_SEL = 'h1, h2, h3, h4, h5, h6, p, li, blockquote, figure, img, video, picture, canvas, svg, a, button, input, label';
  const TEXT_TAGS = /^(H[1-6]|P|LI|BLOCKQUOTE|A|BUTTON|LABEL)$/;
  // Every meaningful element of a section with its position inside the section.
  function layoutOf(sec) {
    const sr = layoutRect(sec);
    const picked = [];
    const cands = [...sec.querySelectorAll(LAYOUT_SEL), ...S.tracked.map((t) => t.el).filter((e) => sec.contains(e) && e !== sec)];
    for (const el of cands) {
      if (picked.includes(el) || picked.length >= 80) continue;
      // Text inside an already listed text block is part of it, unless it is animated on its own.
      if (!el.__motionId && picked.some((p) => TEXT_TAGS.test(p.tagName) && p.contains(el))) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = layoutRect(el);
      if (r.width < 4 || r.height < 4) continue;
      picked.push(el);
    }
    return picked
      .map((el) => {
        const r = layoutRect(el);
        const cs = getComputedStyle(el);
        const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
        const hasText = text.length > 0 && !el.matches('img, video, picture, canvas, svg');
        return {
          motionId: el.__motionId || null,
          selector: cssPath(el),
          tag: el.tagName.toLowerCase(),
          text: text.slice(0, 50),
          x: Math.round(r.left - sr.left),
          y: Math.round(r.top - sr.top),
          w: Math.round(r.width),
          h: Math.round(r.height),
          pageY: Math.round(r.top + scrollY),
          xVw: +(((r.left - sr.left) / innerWidth) * 100).toFixed(1),
          wVw: +((r.width / innerWidth) * 100).toFixed(1),
          font: hasText
            ? `${cs.fontFamily.split(',')[0].replace(/["']/g, '').trim()} ${Math.round(parseFloat(cs.fontSize))}px/${cs.lineHeight === 'normal' ? 'normal' : (parseFloat(cs.lineHeight) / parseFloat(cs.fontSize)).toFixed(2)} ${cs.fontWeight}${cs.letterSpacing !== 'normal' ? ` ls ${(parseFloat(cs.letterSpacing) / parseFloat(cs.fontSize)).toFixed(3)}em` : ''}${cs.textTransform !== 'none' ? ' ' + cs.textTransform : ''}`
            : null,
          color: hasText ? hex(cs.color) : null,
          bg: hex(cs.backgroundColor) || (cs.backgroundImage !== 'none' ? cs.backgroundImage.slice(0, 60) : null),
          radius: cs.borderRadius !== '0px' ? cs.borderRadius : null,
          position: cs.position !== 'static' ? cs.position : null,
          z: cs.zIndex !== 'auto' ? cs.zIndex : null,
          overflowHidden: /hidden|clip/.test(cs.overflow),
          src: el.currentSrc || el.getAttribute('src') || null,
        };
      })
      .sort((a, b) => a.y - b.y || a.x - b.x);
  }

  const headingText = (h) => (h ? (h.innerText || h.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60) : '');

  // How long a pinned element stays pinned, in vh of scroll.
  function pinLengthVh(sp) {
    const vh = innerHeight;
    const child = sp.firstElementChild || sp;
    const g = window.gsap;
    const ST = window.ScrollTrigger || (g && g.core && g.core.globals && g.core.globals().ScrollTrigger);
    if (ST && ST.getAll) {
      const st = ST.getAll().find((x) => x.pin === child || x.pin === sp);
      if (st && st.end > st.start) return Math.round(((st.end - st.start) / vh) * 100);
    }
    const diff = sp.getBoundingClientRect().height - child.getBoundingClientRect().height;
    if (diff > 5) return Math.round((diff / vh) * 100);
    // pinSpacing: false → pinned while its (taller) container scrolls past
    const parent = sp.parentElement;
    const extra = parent ? parent.getBoundingClientRect().height - child.getBoundingClientRect().height : 0;
    return Math.max(0, Math.round((extra / vh) * 100));
  }

  function scenography() {
    const vw = innerWidth;
    const vh = innerHeight;
    // Typography, weighted by number of characters.
    const type = new Map();
    const families = new Map();
    const textColors = new Map();
    let upper = 0;
    let chars = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    let count = 0;
    while ((n = walker.nextNode()) && count++ < 6000) {
      const len = n.textContent.trim().length;
      const el = n.parentElement;
      if (len < 2 || !el || el.closest('script, style, noscript')) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const fam = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim();
      const size = Math.round(parseFloat(cs.fontSize));
      const key = `${fam}|${size}|${cs.fontWeight}`;
      if (!type.has(key)) {
        type.set(key, {
          family: fam, size, vw: +((size / vw) * 100).toFixed(2), weight: cs.fontWeight,
          lineHeight: cs.lineHeight === 'normal' ? 'normal' : +(parseFloat(cs.lineHeight) / size).toFixed(2),
          letterSpacing: cs.letterSpacing === 'normal' ? 0 : +(parseFloat(cs.letterSpacing) / size).toFixed(3),
          transform: cs.textTransform, italic: cs.fontStyle === 'italic', chars: 0,
          sample: n.textContent.trim().slice(0, 40), tag: el.tagName.toLowerCase(),
        });
      }
      type.get(key).chars += len;
      bump(families, fam, len);
      bump(textColors, hex(cs.color), len);
      chars += len;
      if (cs.textTransform === 'uppercase') upper += len;
    }
    // Backgrounds weighted by area; layout + effects in the same pass.
    const bgs = new Map();
    const radii = new Map();
    const blend = new Map();
    const gridCols = new Map();
    const containerWidths = new Map();
    let backdrop = 0;
    let filters = 0;
    let overlays = [];
    const els = document.querySelectorAll('body *');
    for (let i = 0; i < els.length && i < 6000; i++) {
      const el = els[i];
      const cs = getComputedStyle(el);
      if (cs.display === 'none') continue;
      const r = el.getBoundingClientRect();
      const area = Math.min(r.width, vw) * Math.min(r.height, vh * 3);
      bump(bgs, hex(cs.backgroundColor), area);
      if (cs.borderRadius !== '0px' && area > 2000) bump(radii, cs.borderRadius, 1);
      if (cs.mixBlendMode !== 'normal') bump(blend, cs.mixBlendMode, 1);
      if (cs.backdropFilter && cs.backdropFilter !== 'none') backdrop++;
      if (cs.filter !== 'none') filters++;
      if (cs.display === 'grid' && cs.gridTemplateColumns !== 'none') bump(gridCols, cs.gridTemplateColumns.split(' ').length, 1);
      if (r.width > 500 && r.width < vw - 40 && Math.abs(r.left - (vw - r.right)) < 4) bump(containerWidths, Math.round(r.width), 1);
      if (cs.position === 'fixed' && r.width >= vw * 0.9 && r.height >= vh * 0.9 && cs.pointerEvents === 'none') {
        overlays.push({ selector: cssPath(el), opacity: cs.opacity, blend: cs.mixBlendMode, bg: cs.backgroundImage.slice(0, 80) });
      }
    }
    bump(bgs, effectiveBg(document.body), vw * vh);

    // Top-level sections: descend through single wrappers (#app, main, smooth-scroll content…).
    let root = document.body;
    for (let d = 0; d < 6; d++) {
      const kids = [...root.children].filter((c) => c.getBoundingClientRect().height > 10 && !/SCRIPT|STYLE/.test(c.tagName));
      const big = kids.filter((c) => c.getBoundingClientRect().height > document.documentElement.scrollHeight * 0.85);
      if (kids.length <= 3 && big.length === 1) root = big[0];
      else break;
    }
    const sections = [...root.children]
      .map((sec) => (sec.classList.contains('pin-spacer') && sec.firstElementChild ? [sec.firstElementChild, sec] : [sec, null]))
      .filter(([sec]) => sec.getBoundingClientRect().height > 50 && !/SCRIPT|STYLE/.test(sec.tagName))
      .map(([sec, spacer]) => {
        const r = sec.getBoundingClientRect();
        const cs = getComputedStyle(sec);
        const words = (sec.innerText || '').split(/\s+/).filter(Boolean).length;
        return {
          selector: cssPath(sec),
          top: Math.round(r.top + scrollY),
          heightVh: Math.round((r.height / vh) * 100),
          pinnedForVh: spacer ? pinLengthVh(spacer) : 0,
          bg: effectiveBg(sec),
          color: hex(cs.color),
          display: cs.display,
          paddingX: +((parseFloat(cs.paddingLeft) / vw) * 100).toFixed(1),
          paddingY: +((parseFloat(cs.paddingTop) / vh) * 100).toFixed(1),
          headings: sec.querySelectorAll('h1, h2, h3, h4').length,
          media: sec.querySelectorAll('img, video, picture, canvas, svg').length,
          words,
          firstHeading: headingText(sec.querySelector('h1, h2, h3')),
          gridColumns: cs.display === 'grid' ? cs.gridTemplateColumns : null,
          widthPx: Math.round(r.width),
          heightPx: Math.round(r.height),
          elements: layoutOf(sec),
        };
      });

    const media = [...document.querySelectorAll('img, video')].map((m) => m.getBoundingClientRect()).filter((r) => r.width > 100);
    const ratios = new Map();
    media.forEach((r) => bump(ratios, (r.width / r.height).toFixed(2), 1));
    const cursorNone = getComputedStyle(document.documentElement).cursor === 'none' || getComputedStyle(document.body).cursor === 'none';

    return {
      viewport: { w: vw, h: vh },
      fonts: {
        families: top(families, 6).map(([family, c]) => ({ family, share: +(c / chars).toFixed(2) })),
        loaded: [...new Set([...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/["']/g, '')))],
        scale: [...type.values()].sort((a, b) => b.size - a.size).slice(0, 14),
        uppercaseShare: chars ? +(upper / chars).toFixed(2) : 0,
      },
      colors: {
        backgrounds: top(bgs, 8).map(([c, a]) => ({ color: c, weight: a })),
        text: top(textColors, 6).map(([c, w]) => ({ color: c, weight: w })),
      },
      layout: {
        containerWidths: top(containerWidths, 3).map(([w, c]) => ({ px: w, vw: +((w / vw) * 100).toFixed(1), count: c })),
        gridColumns: top(gridCols, 4).map(([cols, c]) => ({ cols, count: c })),
        radii: top(radii, 4).map(([r, c]) => ({ radius: r, count: c })),
        mediaRatios: top(ratios, 4).map(([r, c]) => ({ ratio: +r, count: c })),
        mediaCount: media.length,
      },
      sections,
      effects: {
        blendModes: top(blend, 4).map(([m, c]) => ({ mode: m, count: c })),
        backdropFilters: backdrop,
        filters,
        overlays,
        customCursor: cursorNone,
        pinSpacers: [...document.querySelectorAll('.pin-spacer')].map((sp) => ({
          selector: cssPath(sp.firstElementChild || sp),
          pinnedForVh: pinLengthVh(sp),
        })),
      },
    };
  }
  window.__motionScene = scenography;

  // For adaptive pauses: ids moving right now (loops, ambient motion) and how long the rest has been still.
  window.__motionMovingIds = (withinMs) => {
    const t = now();
    return S.tracked.filter((it) => it.lastChange && t - it.lastChange < withinMs).map((it) => it.id);
  };
  window.__motionNow = now;
  // How many (non-ambient) elements changed since `since`: 0 = only the scroll moved.
  window.__motionActivity = (ignore, since) => {
    const skip = new Set(ignore || []);
    return S.tracked.filter((it) => !skip.has(it.id) && it.lastChange > since).length;
  };
  window.__motionQuiet = (ignore) => {
    const t = now();
    const skip = new Set(ignore || []);
    let last = S.scroll.length ? S.scroll[S.scroll.length - 1][0] : 0;
    for (const it of S.tracked) if (!skip.has(it.id) && it.lastChange > last) last = it.lastChange;
    return t - last;
  };

  // Start sampling an element (and its children) before the extractor hovers it.
  window.__motionTrack = (selector) => {
    try {
      const el = document.querySelector(selector);
      if (el) [el, ...el.querySelectorAll('*')].slice(0, 12).forEach(track);
    } catch (e) {}
  };

  // Interactive elements visible in the first viewport, for the hover test.
  window.__motionHoverTargets = (max) =>
    [...document.querySelectorAll('a, button, [role="button"]')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 20 && r.height > 12 && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
      })
      .slice(0, max)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { selector: cssPath(el), x: r.left + r.width / 2, y: r.top + r.height / 2, text: (el.textContent || '').trim().slice(0, 30) };
      });

  // ---- 7. Final dump, called by the extractor after scrolling ----
  function describeAnim(a) {
    if (!a) return null;
    if (a.getChildren) {
      return {
        type: 'timeline',
        duration: a.duration(),
        children: a.getChildren(true, true, false).slice(0, 60).map((c) => ({
          start: +c.startTime().toFixed(3),
          duration: +c.duration().toFixed(3),
          targets: ser(c.targets()),
          vars: ser(c.vars),
        })),
      };
    }
    return { type: 'tween', duration: a.duration(), targets: ser(a.targets && a.targets()), vars: ser(a.vars) };
  }

  window.__motionDump = () => {
    const g = window.gsap;
    const ST = window.ScrollTrigger || (g && g.core && g.core.globals && g.core.globals().ScrollTrigger);
    let scrollTriggers = null;
    if (ST && ST.getAll) {
      scrollTriggers = ST.getAll().map((st) => ({
        trigger: ser(st.trigger),
        start: st.start,
        end: st.end,
        varsStart: ser(st.vars.start),
        varsEnd: ser(st.vars.end),
        scrub: ser(st.vars.scrub),
        pin: ser(st.vars.pin),
        toggleActions: st.vars.toggleActions,
        animation: describeAnim(st.animation),
      }));
    }
    const html = document.documentElement;
    return {
      title: document.title,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      docHeight: html.scrollHeight,
      libs: {
        gsapVersions: window.gsapVersions || null,
        gsapGlobal: !!g,
        scrollTriggerGlobal: !!window.ScrollTrigger,
        plugins: S.plugins,
        lenisVersion: window.lenisVersion || null,
        lenisHtmlClass: /\blenis\b/.test(html.className),
        threeRevision: window.__THREE__ || null,
        locomotive: !!document.querySelector('[data-scroll-container]'),
        barba: !!(window.barba || document.querySelector('[data-barba]')),
        swup: !!window.swup,
        pinSpacers: document.querySelectorAll('.pin-spacer').length,
        canvases: document.querySelectorAll('canvas').length,
        contexts: S.contexts,
      },
      scroll: S.scroll,
      tracked: S.tracked
        .filter((it) => it.rows.length > 1)
        .map((it) => ({
          id: it.id,
          selector: it.selector,
          tag: it.tag,
          text: it.text,
          firstSeen: it.firstSeen,
          animatedByGsap: !!it.el._gsap,
          meta: it.el.isConnected ? meta(it.el) : null,
          rows: it.rows,
        })),
      calls: S.calls,
      marks: S.marks,
      scrollTriggers,
      cssAnimations: S.cssAnimations,
      inlineScripts: [...document.querySelectorAll('script:not([src])')]
        .map((s) => s.textContent)
        .filter((s) => s && s.length > 20),
    };
  };
})();
