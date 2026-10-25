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

  // Endless marquee.
  gsap.to('.marquee-track', { xPercent: -50, duration: 20, ease: 'none', repeat: -1 });
}
