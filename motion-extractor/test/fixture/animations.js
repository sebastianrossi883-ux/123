// Same choreography for both fixtures; `gsap`, `ScrollTrigger`, `CustomEase`, `Lenis` are injected.
export function run({ gsap, ScrollTrigger, CustomEase, Lenis }) {
  gsap.registerPlugin(ScrollTrigger, CustomEase);

  const lenis = new Lenis({ lerp: 0.08, wheelMultiplier: 1.1, smoothWheel: true });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);

  CustomEase.create('site', 'M0,0 C0.7,0 0.2,1 1,1');

  // Intro: title lines slide up from their mask, staggered.
  gsap.from('.hero .line span', { yPercent: 100, duration: 1.2, ease: 'power3.out', stagger: 0.1, delay: 0.3 });

  // Cards fade up when the grid enters.
  gsap.from('.card', {
    y: 80, opacity: 0, duration: 1, ease: 'expo.out', stagger: 0.12,
    scrollTrigger: { trigger: '.cards', start: 'top 80%' },
  });

  // Parallax image tied to scroll.
  gsap.fromTo('.parallax .bg', { y: -120 }, {
    y: 120, ease: 'none',
    scrollTrigger: { trigger: '.parallax', start: 'top bottom', end: 'bottom top', scrub: 1 },
  });

  // Clip-path reveal with a custom ease.
  gsap.fromTo('.reveal', { clipPath: 'inset(0% 0% 100% 0%)' }, {
    clipPath: 'inset(0% 0% 0% 0%)', duration: 1.4, ease: 'site',
    scrollTrigger: { trigger: '.reveal', start: 'top 70%' },
  });

  // A choreographed scene: heading lines, then the paragraph overlapping, then the image.
  gsap.timeline({ scrollTrigger: { trigger: '.story', start: 'top 70%' } })
    .from('.story h2 .line span', { yPercent: 100, duration: 1, ease: 'expo.out', stagger: 0.08 })
    .from('.story p', { y: 30, opacity: 0, duration: 0.8, ease: 'power2.out' }, '-=0.6')
    .from('.story .media', { scale: 1.2, opacity: 0, duration: 1.4, ease: 'power3.out' }, '<0.15');

  // Pinned section with a scrubbed horizontal panel.
  gsap.timeline({ scrollTrigger: { trigger: '.pinned', start: 'top top', end: '+=150%', pin: true, scrub: true } })
    .to('.pinned .panel', { xPercent: -60, ease: 'none' })
    // pieces of the scrubbed timeline that jump while scrolling (not entrances)
    .to('.pinned .panel div:nth-child(2)', { opacity: 0.3, duration: 0.1 }, 0.3)
    .to('.pinned .panel div:nth-child(3)', { opacity: 0.3, duration: 0.1 }, 0.6);

  // Link whose letters roll on hover (two stacked copies), far down the page.
  document.querySelectorAll('.roll-link').forEach((link) => {
    const [cur, hov] = link.querySelectorAll('.roll-layer');
    gsap.set(hov.children, { yPercent: 110 });
    const tl = gsap.timeline({ paused: true, defaults: { duration: 0.45, ease: 'power3.inOut', stagger: 0.018 } })
      .to(cur.children, { yPercent: -110 }, 0)
      .to(hov.children, { yPercent: 0 }, 0.04);
    link.addEventListener('mouseenter', () => tl.play());
    link.addEventListener('mouseleave', () => tl.reverse());
  });

  // Marquee that runs on its own and speeds up with the scroll velocity.
  const vm = gsap.to('.vmarquee-track', { x: -1000, duration: 10, ease: 'none', repeat: -1 });
  ScrollTrigger.create({
    trigger: '.vmarquee', start: 'top bottom', end: 'bottom top',
    onUpdate: (self) => gsap.to(vm, { timeScale: 1 + Math.min(4, Math.abs(self.getVelocity()) / 400), duration: 0.2, overwrite: true, onComplete: () => gsap.to(vm, { timeScale: 1, duration: 0.8 }) }),
  });

  // Custom cursor following the mouse.
  const cx = gsap.quickTo('.cursor', 'x', { duration: 0.4, ease: 'power3' });
  const cy = gsap.quickTo('.cursor', 'y', { duration: 0.4, ease: 'power3' });
  window.addEventListener('mousemove', (e) => { cx(e.clientX); cy(e.clientY); });

  // SVG line drawing itself.
  gsap.fromTo('.line-draw path', { strokeDashoffset: 600 }, {
    strokeDashoffset: 0, duration: 1.5, ease: 'power2.inOut',
    scrollTrigger: { trigger: '.extras', start: 'top 75%' },
  });
  // Color change + per-character title.
  gsap.fromTo('.badge', { backgroundColor: '#333333', color: '#eeeeee' }, {
    backgroundColor: '#e4572e', color: '#111111', duration: 0.9, ease: 'power1.out',
    scrollTrigger: { trigger: '.extras', start: 'top 75%' },
  });
  gsap.from('.chars span', {
    yPercent: 110, opacity: 0, duration: 0.7, ease: 'back.out', stagger: 0.03,
    scrollTrigger: { trigger: '.chars', start: 'top 80%' },
  });

  // Endless marquee.
  gsap.to('.marquee-track', { xPercent: -50, duration: 20, ease: 'none', repeat: -1 });
}
