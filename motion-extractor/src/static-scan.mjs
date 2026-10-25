// Static analysis of the site's JavaScript. Minification renames variables but keeps
// object keys and string literals, so `{yPercent:100, ease:"expo.out", scrollTrigger:{...}}`
// is still readable. We find those object literals and pretty-print them.
import beautify from 'js-beautify';

const PATTERNS = [
  { tag: 'ScrollTrigger', re: /\bscrollTrigger\s*:\s*\{/g },
  { tag: 'ScrollTrigger', re: /\bstart\s*:\s*["'`](?:top|bottom|center|left|right|\d)[^"'`]{0,30}["'`]/g },
  { tag: 'scrub', re: /\bscrub\s*:\s*(?:!0|true|\d*\.?\d+)/g },
  { tag: 'pin', re: /\bpin\s*:\s*(?:!0|true|["'`])/g },
  { tag: 'ease', re: /\bease\s*:\s*["'`][\w.()\d,\s-]{3,40}["'`]/g },
  { tag: 'CustomEase', re: /["'`]M\s*0[ ,]+0\s*[CLc][^"'`]{10,600}["'`]/g },
  { tag: 'SplitText', re: /\btype\s*:\s*["'`](?:chars|words|lines)(?:\s*,\s*(?:chars|words|lines))*["'`]/g },
  { tag: 'stagger', re: /\bstagger\s*:/g },
  { tag: 'clipPath', re: /\bclipPath\s*:\s*["'`]/g },
  { tag: 'Lenis', re: /\b(?:smoothWheel|wheelMultiplier|syncTouch|touchMultiplier)\s*:/g },
  { tag: 'Lenis', re: /\blerp\s*:\s*\d*\.?\d+/g },
  { tag: 'ScrollSmoother', re: /\bsmooth\s*:\s*\d*\.?\d+\s*,[^}]{0,80}effects\s*:/g },
  { tag: 'Shader', re: /gl_FragColor|gl_FragCoord|gl_Position|texture2D\s*\(/g, string: true },
];

// Signs that a snippet is library internals rather than the site's own animation code.
const LIBRARY_HINTS = [
  /GreenSock|gsap\.com\/standard-license/,
  /_pt\b|_ptLookup|_gsap\.|_tTime|_dur\b|_ts\b/,
  /prototype\.|getRawSequence|_parseEase/,
  /wrapper\s*:\s*window\s*,\s*content\s*:/, // Lenis constructor defaults
  /scrollTo\(|virtualScroll|isTouchDevice/,
];

// Site code passes literals (selectors, named eases, durations, start strings);
// library internals pass variables. A snippet needs at least one of these to be kept.
const APP_SIGNALS = [
  /["'`][.#\[][\w-]/,
  /\bease\s*:\s*["'`]\w+\.\w+/,
  /\bstart\s*:\s*["'`]/,
  /\blerp\s*:\s*\d*\.\d/,
  /["'`]M\s*0[ ,]+0/,
  /\b(?:duration|stagger)\s*:\s*(?:\d*\.\d*[1-9]|[1-9])/,
  /\b(?:x|y|xPercent|yPercent|scale|rotation|opacity)\s*:\s*["'`-]?\d/,
];
const LIBRARY_ONLY = /isStart|isFromStart|totalProgress|inherit\s*:\s*!1/;

const MAX_SNIPPET = 2500;

function enclosingObject(text, idx) {
  let depth = 0;
  let i = idx;
  for (; i >= 0 && idx - i < 6000; i--) {
    const c = text[i];
    if (c === '}') depth++;
    else if (c === '{') {
      if (depth === 0) break;
      depth--;
    }
  }
  if (i < 0 || text[i] !== '{') return null;
  let start = i;
  depth = 0;
  let end = start;
  for (; end < text.length && end - start < 12000; end++) {
    const c = text[end];
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) break;
  }
  // Pull in the call that owns the object: `x.to(el,` / `.fromTo(a,{…},` / `new X({`
  const before = text.slice(Math.max(0, start - 160), start);
  const call = before.match(/(?:[\w$.]+\.(?:to|from|fromTo|set|timeline|create|add)|new\s+[\w$.]+)\s*\([^;]{0,140}$/);
  if (call) start = start - before.length + call.index;
  return [start, Math.min(end + 2, text.length)];
}

function enclosingString(text, idx) {
  let i = idx;
  while (i > 0 && idx - i < 20000 && !/["'`]/.test(text[i])) i--;
  const q = text[i];
  let end = idx;
  while (end < text.length && end - idx < 20000 && !(text[end] === q && text[end - 1] !== '\\')) end++;
  return [i, end + 1];
}

export function scanScript(text, source) {
  if (!text || text.length > 15_000_000) return [];
  const ranges = [];
  for (const { tag, re, string } of PATTERNS) {
    re.lastIndex = 0;
    let m;
    let hits = 0;
    while ((m = re.exec(text)) && hits++ < 400) {
      const r = string ? enclosingString(text, m.index) : enclosingObject(text, m.index);
      if (r) ranges.push({ start: r[0], end: r[1], tags: new Set([tag]) });
    }
  }
  ranges.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) {
      last.end = Math.max(last.end, r.end);
      r.tags.forEach((t) => last.tags.add(t));
    } else merged.push({ ...r, tags: new Set(r.tags) });
  }
  const out = [];
  for (const r of merged) {
    let code = text.slice(r.start, r.end);
    if (LIBRARY_HINTS.some((h) => h.test(code))) continue;
    if (!r.tags.has('Shader') && (LIBRARY_ONLY.test(code) || !APP_SIGNALS.some((h) => h.test(code)))) continue;
    const truncated = code.length > MAX_SNIPPET;
    if (truncated) code = code.slice(0, MAX_SNIPPET);
    const tags = [...r.tags];
    const pretty = tags.includes('Shader')
      ? code.replace(/\\n/g, '\n')
      : beautify.js(code, { indent_size: 2, brace_style: 'collapse,preserve-inline' });
    out.push({ source, offset: r.start, tags, code: pretty + (truncated ? '\n/* … troncato … */' : '') });
  }
  return out;
}

export function findSourceMapUrl(text, scriptUrl) {
  const m = text.slice(-2000).match(/\/\/[#@]\s*sourceMappingURL=(\S+)\s*$/);
  if (!m) return null;
  if (m[1].startsWith('data:')) return m[1];
  try { return new URL(m[1], scriptUrl).href; } catch { return null; }
}

// Original (pre-bundling) sources that contain animation code, minus node_modules.
export function animationSourcesFromMap(map) {
  const out = [];
  const sources = map.sources || [];
  const contents = map.sourcesContent || [];
  sources.forEach((path, i) => {
    const body = contents[i];
    if (!body || /node_modules|\/gsap\/|\/lenis\//.test(path)) return;
    if (/\bgsap\b|ScrollTrigger|\bLenis\b|lenis|SplitText|CustomEase|useGSAP|\.to\(|\.fromTo\(/.test(body)) {
      out.push({ path, body });
    }
  });
  return out;
}
