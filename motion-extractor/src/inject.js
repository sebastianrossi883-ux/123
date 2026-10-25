// Injected at document-start (before any site script) by Playwright's addInitScript.
// Records: elements whose inline style changes, their computed values every frame,
// the scroll position, CSS/WAAPI animations, canvas contexts, and — when GSAP is
// loaded as a global (CDN/UMD) — every gsap.to/from/fromTo/timeline call.
(() => {
  if (window.top !== window || window.__motion) return;

  const MAX_TRACKED = 120;
  const MAX_CALLS = 1000;
  const t0 = performance.now();
  const now = () => Math.round(performance.now() - t0);

  const S = (window.__motion = {
    tracked: [],
    scroll: [],
    calls: [],
    plugins: [],
    contexts: [],
    cssAnimations: [],
  });
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

  // ---- 1. Which elements are being animated (inline style mutations) ----
  function track(el) {
    if (el.__motionId || S.tracked.length >= MAX_TRACKED) return;
    if (el === document.documentElement || el === document.body) return;
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
  }
  new MutationObserver((ms) => {
    for (const m of ms) if (m.target.nodeType === 1) track(m.target);
  }).observe(document, { attributes: true, attributeFilter: ['style'], subtree: true });

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
    for (const it of S.tracked) {
      if (!it.el.isConnected) continue;
      const cs = getComputedStyle(it.el);
      const key = cs.transform + '|' + cs.opacity + '|' + cs.clipPath + '|' + cs.filter;
      if (key === it.last) continue;
      it.last = key;
      const r = it.el.getBoundingClientRect();
      // [time, scrollY, transform, opacity, clipPath, filter, rectTop, rectHeight, viewportH]
      it.rows.push([t, sy, cs.transform, +cs.opacity, cs.clipPath, cs.filter, Math.round(r.top), Math.round(r.height), vh]);
    }
    if (t - lastCssScan > 250 && document.getAnimations) {
      lastCssScan = t;
      for (const a of document.getAnimations()) {
        if (seenAnims.has(a) || S.cssAnimations.length > 300) continue;
        seenAnims.add(a);
        try {
          const timing = a.effect && a.effect.getTiming ? a.effect.getTiming() : {};
          S.cssAnimations.push({
            t,
            kind: a.constructor && a.constructor.name, // CSSAnimation / CSSTransition / Animation
            name: a.animationName || a.transitionProperty || a.id || '',
            target: a.effect && a.effect.target ? cssPath(a.effect.target) : null,
            duration: timing.duration,
            delay: timing.delay,
            easing: timing.easing,
            iterations: timing.iterations,
            keyframes: a.effect && a.effect.getKeyframes ? ser(a.effect.getKeyframes()) : null,
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
  function record(kind, owner, targets, a, b, pos) {
    if (S.calls.length >= MAX_CALLS) return;
    S.calls.push({
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

  // ---- 5. Final dump, called by the extractor after scrolling ----
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
          rows: it.rows,
        })),
      calls: S.calls,
      scrollTriggers,
      cssAnimations: S.cssAnimations,
      inlineScripts: [...document.querySelectorAll('script:not([src])')]
        .map((s) => s.textContent)
        .filter((s) => s && s.length > 20),
    };
  };
})();
