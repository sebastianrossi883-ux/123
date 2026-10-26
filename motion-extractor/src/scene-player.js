// Each scene runs in a fresh document. Removing the frame clears listeners,
// timers, ticker callbacks and original global CSS together, without rewriting it.
export function mountScene(container, {url, height='80vh', replacements=[], onEvent}={}) {
  if(!url)throw Error('Scene URL required');
  const frame=document.createElement('iframe');frame.title='Scena originale estratta';
  frame.style.cssText='display:block;width:100%;border:0;';frame.style.height=height;
  const absolute=new URL(url,location.href);
  // Put edits in the fragment; the generated bootstrap applies them before init.
  absolute.hash=encodeURIComponent(JSON.stringify({replacements}));frame.src=absolute.href;
  const listener=event=>{if(event.source===frame.contentWindow)onEvent?.(event.data);};
  addEventListener('message',listener);container.appendChild(frame);
  return {frame,destroy(){removeEventListener('message',listener);frame.remove();}};
}