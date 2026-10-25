// Runtime of motion-kit.js (prepended with window.MOTION_DNA by kit.mjs).
// Animates any page tagged with data-attributes using only the measured DNA.
(() => {
  const DNA = window.MOTION_DNA;
  const { gsap, ScrollTrigger, SplitText, CustomEase, Lenis } = window;
  if (!gsap || !ScrollTrigger) {
    console.error('[motion-kit] mancano gsap e ScrollTrigger: caricali prima di motion-kit.js');
    return;
  }
  gsap.registerPlugin(...[ScrollTrigger, SplitText, CustomEase].filter(Boolean));
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const num = (v, d) => (v == null || v === '' || Number.isNaN(parseFloat(v)) ? d : parseFloat(v));
  const stats = { elements: 0, scenes: 0, warnings: 0 };
  const warn = (...a) => {
    stats.warnings++;
    console.warn('[motion-kit]', ...a);
  };

  for (const [name, path] of Object.entries(DNA.customEases || {})) {
    if (CustomEase) CustomEase.create(name, path);
  }
  const easeOf = (e) => (DNA.customEases && DNA.customEases[e] && !CustomEase ? 'power2.out' : e);

  function start() {
    if (reduce) {
      document.querySelectorAll('[data-motion]').forEach((el) => gsap.set(el, { clearProps: 'all' }));
      console.info('[motion-kit] prefers-reduced-motion: animazioni disattivate');
      return;
    }
    if (DNA.lenis && Lenis) {
      const lenis = new Lenis(DNA.lenis);
      lenis.on('scroll', ScrollTrigger.update);
      gsap.ticker.add((t) => lenis.raf(t * 1000));
      gsap.ticker.lagSmoothing(0);
      window.motionKitLenis = lenis;
    }

    const roleOf = (el) => {
      if (el.dataset.role) return el.dataset.role;
      if (el.matches('h1, h2, h3, h4, h5, h6')) return 'heading';
      if (el.matches('img, video, picture, figure, canvas, svg')) return 'media';
      if (el.matches('a, button')) return 'button';
      if (el.matches('p, li, blockquote, span')) return 'text';
      return 'shape';
    };

    // Targets of one element: split lines/chars/words, or the element itself.
    function targetsOf(el, preset) {
      const split = el.dataset.split;
      if (split) {
        if (!SplitText) {
          warn('data-split richiede SplitText', el);
        } else {
          const type = split === 'chars' ? 'lines, chars' : split;
          const s = new SplitText(el, { type, mask: preset.mask ? (split === 'chars' ? 'lines' : split) : undefined });
          return s[split];
        }
      }
      if (preset.mask && el.parentElement && getComputedStyle(el.parentElement).overflow === 'visible') {
        const wrap = document.createElement('span');
        wrap.style.cssText = 'display:block;overflow:hidden';
        el.parentNode.insertBefore(wrap, el);
        wrap.appendChild(el);
      }
      return [el];
    }

    function tweenOf(el) {
      const name = el.dataset.motion;
      const p = DNA.presets[name];
      if (!p) {
        warn(`preset "${name}" inesistente. Disponibili: ${Object.keys(DNA.presets).join(', ')}`, el);
        return null;
      }
      const targets = targetsOf(el, p);
      const from = { ...p.from };
      const to = { ...p.to };
      if (p.draw) {
        const paths = el.matches('path, line, polyline, circle, rect') ? [el] : [...el.querySelectorAll('path, line, polyline, circle, rect')];
        paths.forEach((pt) => {
          const len = pt.getTotalLength ? pt.getTotalLength() : 1000;
          pt.style.strokeDasharray = len;
          pt.style.strokeDashoffset = len;
        });
        targets.splice(0, targets.length, ...paths);
        to.strokeDashoffset = 0;
      }
      stats.elements += targets.length;
      return {
        targets,
        from,
        to: {
          ...to,
          duration: num(el.dataset.duration, p.duration),
          ease: easeOf(el.dataset.ease || p.ease),
          stagger: targets.length > 1 ? num(el.dataset.stagger, p.stagger) : 0,
        },
        role: roleOf(el),
        span: num(el.dataset.duration, p.duration) + (targets.length - 1) * num(el.dataset.stagger, p.stagger),
      };
    }

    function buildScene(container, timelineVars) {
      const items = [...container.querySelectorAll('[data-motion]')].filter((el) => el.closest('[data-scene], [data-intro]') === container);
      if (container.dataset.motion) items.unshift(container);
      const tl = gsap.timeline(timelineVars);
      let at = 0;
      let prev = null;
      for (const el of items) {
        const tw = tweenOf(el);
        if (!tw) continue;
        if (prev) {
          const key = `${prev.role}>${tw.role}`;
          at += DNA.scene.pairOffsets[key] ?? DNA.scene.step;
        }
        const pos = el.dataset.at != null ? num(el.dataset.at, at) : at;
        tl.fromTo(tw.targets, tw.from, tw.to, pos);
        at = pos;
        prev = tw;
      }
      stats.scenes++;
      return tl;
    }

    document.querySelectorAll('[data-intro]').forEach((c) => buildScene(c, { delay: num(c.dataset.delay, DNA.intro.delay) }));
    document.querySelectorAll('[data-scene]').forEach((c) =>
      buildScene(c, { scrollTrigger: { trigger: c, start: c.dataset.start || DNA.scene.start } }),
    );
    document.querySelectorAll('[data-motion]').forEach((el) => {
      if (el.closest('[data-scene], [data-intro]')) return;
      const tw = tweenOf(el);
      if (tw) gsap.fromTo(tw.targets, tw.from, { ...tw.to, scrollTrigger: { trigger: el, start: el.dataset.start || DNA.single.start } });
    });

    // Parallax: on-screen speed in % of the scroll speed (100 = moves with the page).
    document.querySelectorAll('[data-parallax]').forEach((el) => {
      const speed = num(el.dataset.parallax, DNA.parallax.speed) / 100;
      const box = el.parentElement || el;
      const travel = () => (1 - speed) * (window.innerHeight + box.offsetHeight);
      gsap.fromTo(el, { y: () => -travel() / 2 }, {
        y: () => travel() / 2, ease: 'none',
        scrollTrigger: { trigger: box, start: 'top bottom', end: 'bottom top', scrub: DNA.parallax.scrub || true, invalidateOnRefresh: true },
      });
      stats.elements++;
    });

    // Pinned sections.
    document.querySelectorAll('[data-pin-horizontal]').forEach((sec) => {
      const track = sec.querySelector('[data-track]');
      if (!track) return warn('data-pin-horizontal senza [data-track] dentro', sec);
      const len = num(sec.dataset.pinHorizontal, DNA.pin.lengthVh);
      gsap.to(track, {
        x: () => -(track.scrollWidth - sec.clientWidth), ease: 'none',
        scrollTrigger: { trigger: sec, start: 'top top', end: () => `+=${(len / 100) * window.innerHeight}`, pin: true, scrub: DNA.pin.scrub || true, invalidateOnRefresh: true },
      });
      stats.elements++;
    });
    document.querySelectorAll('[data-pin]').forEach((sec) => {
      const len = num(sec.dataset.pin, DNA.pin.lengthVh);
      ScrollTrigger.create({ trigger: sec, start: 'top top', end: () => `+=${(len / 100) * window.innerHeight}`, pin: true });
    });

    // Marquee: content duplicated inside, moves at the measured px/s.
    document.querySelectorAll('[data-marquee]').forEach((el) => {
      const speed = num(el.dataset.marquee, DNA.marquee.speed);
      const half = el.scrollWidth / 2;
      gsap.to(el, { x: -half, duration: half / speed, ease: 'none', repeat: -1 });
      stats.elements++;
    });

    // Cursor.
    const cursor = document.querySelector('[data-cursor]');
    if (cursor && DNA.cursor) {
      const size = DNA.cursor.size || 18;
      Object.assign(cursor.style, {
        position: 'fixed', top: 0, left: 0, width: size + 'px', height: size + 'px', margin: `-${size / 2}px 0 0 -${size / 2}px`,
        borderRadius: '50%', background: '#fff', mixBlendMode: 'difference', pointerEvents: 'none', zIndex: 9999,
      });
      const qx = gsap.quickTo(cursor, 'x', { duration: DNA.cursor.duration, ease: 'power3' });
      const qy = gsap.quickTo(cursor, 'y', { duration: DNA.cursor.duration, ease: 'power3' });
      window.addEventListener('mousemove', (e) => { qx(e.clientX); qy(e.clientY); });
    }

    // Hover presets.
    document.querySelectorAll('[data-hover]').forEach((el) => {
      const h = (DNA.hovers || []).find((x) => x.name === el.dataset.hover) || (DNA.hovers || [])[0];
      if (!h) return warn('nessun hover misurato nel sito d’origine', el);
      const back = Object.fromEntries(Object.keys(h.to).map((k) => [k, gsap.getProperty(el, k)]));
      el.addEventListener('mouseenter', () => gsap.to(el, { ...h.to, duration: h.duration, ease: easeOf(h.ease), overwrite: 'auto' }));
      el.addEventListener('mouseleave', () => gsap.to(el, { ...back, duration: h.duration, ease: easeOf(h.ease), overwrite: 'auto' }));
    });

    ScrollTrigger.refresh();
    console.info(`[motion-kit] ${stats.elements} elementi in ${stats.scenes} scene${stats.warnings ? `, ${stats.warnings} avvisi` : ''} — DNA da ${DNA.source}`);
    window.motionKit = { DNA, stats, refresh: () => ScrollTrigger.refresh() };
  }

  // Split text after fonts load, so lines are measured with the real font.
  const ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  const go = () => ready.then(start);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
  else go();
})();
