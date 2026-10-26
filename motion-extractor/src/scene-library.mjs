import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parse,serialize} from 'parse5';
import {parseHTML} from 'linkedom';
import {compileControllers,hash} from './source-controllers.mjs';
import {nativeCssMotions} from './native-css.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const write=async(file,text)=>{await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,text);};
const json=x=>JSON.stringify(x,null,2)+'\n';
const safe=s=>s.replace(/[^a-zA-Z0-9_-]+/g,'_');
const attr=(node,key)=>node.attrs?.find(a=>a.name===key)?.value;
const walk=(node,visit)=>{visit(node);for(const child of node.childNodes||[])walk(child,visit);};
const htmlEscape=s=>s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
export async function sourceIndexFor(directory) {
  try {return JSON.parse(await fs.readFile(path.join(directory,'originali/INDICE.json'),'utf8'));}
  catch(e) {if(e.code!=='ENOENT')throw e;}
  return JSON.parse(await fs.readFile(path.join(directory,'scene-istanze.json'),'utf8')).sources;
}
// Text bodies are shared by hash; page associations and original parameter values remain distinct.
export async function buildSceneLibrary(plan) {
  const started=performance.now(),out=path.resolve(plan.out);
  try {await fs.access(out);throw Error('Use a new output directory: '+out);}catch(e){if(e.code!=='ENOENT')throw e;}
  const sources=new Map();
  for(const directory of plan.archives) {
    for(const entry of await sourceIndexFor(directory)) {const text=await fs.readFile(path.join(directory,entry.file),'utf8');const key=entry.url+'#'+hash(text);if(!sources.has(key))sources.set(key,{...entry,text});}
  }
  const candidates=[];
  for(const s of sources.values()) {
    if(s.type!=='script'||plan.sourceUrl&&!s.url.includes(plan.sourceUrl))continue;
    try {const compiled=compileControllers(s.text);if(compiled.controllers.some(c=>c.standaloneCandidate))candidates.push({source:s,compiled});}catch{}
  }
  candidates.sort((a,b)=>b.compiled.controllers.length-a.compiled.controllers.length);
  if(!candidates.length)throw Error('No supported global source controllers. Original bundles require another adapter.');
  const {source,compiled}=candidates[0];
  if(!compiled.runtime)throw Error('Source setup needs integration: '+json(compiled.problems));
  const shared=[];
  for(const s of sources.values()) {
    const ext=s.type==='stylesheet'?'css':s.type==='document'?'html':'js';
    const original='originali/'+hash(s.text)+'.'+ext;
    await write(path.join(out,original),s.text);
    let served=original;
    if(s.type==='stylesheet') {
      // Keep original CSS separately. Only resource addresses change in the execution copy.
      const css=s.text.replace(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/g,(all,q,url)=>/^(data:|#)/.test(url)?all:'url('+JSON.stringify(new URL(url,s.url).href)+')');
      served='risorse/'+hash(css)+'.css';await write(path.join(out,served),css);
    }
    shared.push({url:s.url,type:s.type,file:original,served,sha256_decoded_utf8:hash(s.text)});
  }
  await write(path.join(out,'originali/INDICE.json'),json(shared));
  await write(path.join(out,'runtime-originale.js'),compiled.runtime);
  await fs.copyFile(path.join(here,'scene-player.js'),path.join(out,'scene-player.js'));
  const vendorNames=['gsap.min.js','ScrollTrigger.min.js','SplitText.min.js','CustomEase.min.js','Flip.min.js','lenis.min.js','swiper-bundle.min.js','lottie.min.js','ActiveFrame.js'];
  const modules=compiled.imports.filter(i=>i.specifier).map(i=>({specifier:i.specifier,source:shared.find(s=>s.url===i.specifier)})).filter(i=>i.source);
  const importMap=Object.fromEntries(modules.map(i=>[i.specifier,'../../'+i.source.served]));
  const vendors=vendorNames.map(name=>shared.find(s=>s.url.split('?')[0].endsWith('/'+name))).filter(Boolean);
  const entries=[],pageRows=[];
    for(const pageSpec of plan.pages) {
      const html=await fs.readFile(pageSpec.file,'utf8'),tree=parse(html);
      // No source bootstrap, forms or external scripts execute while associating DOM.
      walk(tree,n=>{if(n.childNodes)n.childNodes=n.childNodes.filter(c=>c.tagName!=='script'||['application/json','application/ld+json'].includes(attr(c,'type')));});
      const styles=[];walk(tree,n=>{if(n.tagName==='style')styles.push(serialize(n));});
      let bodyAttrs=[],htmlAttrs=[];
      walk(tree,n=>{if(n.tagName==='body')bodyAttrs=n.attrs;if(n.tagName==='html')htmlAttrs=n.attrs;});
      const id=safe(new URL(pageSpec.url).pathname)||'home';
      const css=[];walk(tree,n=>{if(n.tagName==='link'&&attr(n,'rel')==='stylesheet') {const url=new URL(attr(n,'href'),pageSpec.url).href;const local=shared.find(s=>s.url===url);css.push(local?'../../'+local.served:url);}});
      // DOM association needs no assets; blocking them here saves network and disk.
      const {document}=parseHTML(serialize(tree));
      const pageStyles=shared.filter(s=>s.type==='stylesheet');
      const cssRules=[],cssErrors=[];
      const cssInputs=[...styles.map((text,i)=>({text,origin:pageSpec.url+'#inline-style-'+i})),...await Promise.all(pageStyles.map(async s=>({text:await fs.readFile(path.join(out,s.file),'utf8'),origin:s.url})))];
      for(const input of cssInputs){try{cssRules.push(...nativeCssMotions(input.text).map(rule=>({...rule,origin:input.origin})));}catch(e){cssErrors.push({origin:input.origin,error:String(e)});}}
      const nativeControllers=[...new Map(cssRules.map(rule=>[rule.selector+rule.text+rule.conditions.join('|'),rule])).values()].map(rule=>({
        kind:'css',name:'CSS_'+hash(rule.selector+rule.text+rule.conditions.join('|')).slice(0,12),selectors:[{selector:rule.selector.replace(/::(?:before|after|marker)/g,'').replace(/:(?:hover|focus-visible|focus-within|focus|active|visited)\b/g,''),expression:rule.selector,cssStateSelector:rule.selector}],
        cssRule:rule,sha256:hash(rule.text),standaloneCandidate:true,prerequisites:[],dependencies:[],functions:[],features:[],rootDocument:false,
      }));
      const pageControllers=[...compiled.controllers.filter(c=>c.standaloneCandidate),...nativeControllers];
      const bindings=((controllers,document)=>{
        const selectorFor=el=>{const parts=[];while(el&&el!==document.body){const all=[...el.parentElement.children];parts.unshift(el.tagName.toLowerCase()+':nth-child('+(all.indexOf(el)+1)+')');el=el.parentElement;}return 'body'+(parts.length?'>'+parts.join('>'):'');};
        return controllers.map(controller=>{
          const roots=new Set(),selectors=[];
          for(const q of controller.selectors) {
            const sel=q.selector||q.pattern;if(!sel)continue;
            try {const found=[...document.querySelectorAll(sel)];found.forEach(el=>roots.add(el));selectors.push({...q,count:found.length,actors:found.map(el=>({path:selectorFor(el),tag:el.tagName.toLowerCase(),attributes:Object.fromEntries([...el.attributes].map(a=>[a.name,a.value]))}))});}
            catch(e){selectors.push({...q,error:String(e)});}
          }
          const prune=node=>{
            if(roots.has(node))return node.cloneNode(true);
            if(node.nodeType!==1)return null;
            const children=[...node.childNodes].map(prune).filter(Boolean);if(!children.length)return null;
            const copy=node.cloneNode(false);children.forEach(c=>copy.append(c));return copy;
          };
          const fragment=prune(document.body);
          return {name:controller.name,selectors,actors:roots.size,body:fragment?.innerHTML||'',scope:'Original selected subtrees and ancestor shells. Full original HTML is retained for layout relationships outside this fragment.'};
        });
      })(pageControllers,document);
      pageRows.push({url:pageSpec.url,id,inlineStyles:styles.length,cssErrors,originalHtml:'originali/'+hash(html)+'.html'});
      await write(path.join(out,'originali/'+hash(html)+'.html'),html);
      for(const binding of bindings) {
        if(!binding.actors)continue;
        const controller=pageControllers.find(c=>c.name===binding.name),prefix='scene/'+id+'--'+safe(controller.name);
        const effectiveNames=new Set();
        const visit=name=>{if(effectiveNames.has(name)||Object.hasOwn(plan.hooks||{},name))return;effectiveNames.add(name);compiled.functionGraph.find(c=>c.name===name)?.dependencies.forEach(visit);};visit(controller.name);
        // Features are collected directly from source bodies of the active dependency closure.
        const featureNodes=compiled.functionGraph.filter(c=>effectiveNames.has(c.name));
        const activeFeatures=[...new Set(featureNodes.flatMap(c=>c.features))];
        const unsupported=activeFeatures.some(f=>['dynamic_import','VideoDecoder.isConfigSupported','barba.init','ActiveFrame'].includes(f));
        const sceneVendors=controller.kind==='css'?[]:vendors;
        const recipe={format:'source-scene-v1',page:pageSpec.url,controller,source:controller.kind==='css'?{type:'source_css_rule',note:'Original rule text and declaration values; nesting expanded only for DOM association. Complete CSS remains unchanged.',files:pageStyles.map(s=>'../../'+s.file)}:{url:source.url,file:'../../originali/'+compiled.sourceHash+'.js',sha256:compiled.sourceHash},
          context:{html:'../../originali/'+hash(html)+'.html',css,inlineStyles:styles.length,associations:binding.selectors,scope:binding.scope},
          runtime:'../../runtime-originale.js',modules:importMap,vendors:sceneVendors.map(v=>'../../'+v.served),prerequisites:controller.prerequisites,
          hooks:plan.hooks||{},activeFunctions:[...effectiveNames],activeFeatures,before:plan.before||[],status:unsupported?'requires_external_media_or_module':'generated_not_exercised',
          integration:{isolation:'iframe',inputs:'Original events and ScrollTrigger; no fitted curves or statistical presets.',replacementFields:['textContent','src','alt'],externalAssets:'Original image/font/JSON/media addresses may remain remote. No video is copied.'}};
        const attributes=attrs=>attrs.map(a=>' '+a.name+'="'+htmlEscape(a.value)+'"').join('');
        const absoluteBody=binding.body.replace(/\b(src|href|poster)="([^"]+)"/g,(all,key,value)=>/^(#|data:|mailto:|tel:|javascript:)/.test(value)?all:key+'="'+htmlEscape(new URL(value,pageSpec.url).href)+'"');
        const importScript=modules.length?'<script type="importmap">'+JSON.stringify({imports:importMap}).replace(/</g,'\\u003c')+'</script>':'';
        const head=importScript+'<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+css.map(href=>'<link rel="stylesheet" href="'+htmlEscape(href)+'">').join('')+styles.map(s=>'<style>'+s+'</style>').join('');
        const bootstrap=`(async()=>{const state=window.sceneState={status:'loading',controller:${JSON.stringify(controller.name)},errors:[]};try{await document.fonts.ready;const edits=location.hash?JSON.parse(decodeURIComponent(location.hash.slice(1))).replacements||[]:[];for(const edit of edits){for(const el of document.querySelectorAll(edit.selector)){if(edit.textContent!==undefined)el.textContent=edit.textContent;if(edit.src!==undefined){el.setAttribute('src',edit.src);el.removeAttribute('srcset');}if(edit.alt!==undefined)el.setAttribute('alt',edit.alt);}}if(${controller.kind!=='css'}){const api=SourceScene;for(const [name,event]of Object.entries(${JSON.stringify(plan.hooks||{})})){api.bind(name,()=>{dispatchEvent(new CustomEvent(event));parent.postMessage({type:event,controller:state.controller},location.origin);});}for(const name of ${JSON.stringify([...new Set([...(plan.before||[]),...controller.prerequisites])])}){await api.functions[name]();}await api.functions[state.controller](${controller.rootDocument?'document':''});}state.status='initialized';parent.postMessage({type:'scene-initialized',controller:state.controller},location.origin);}catch(e){state.status='error';state.errors.push(String(e));throw e;}})();`;
        const body='<!doctype html><html'+attributes(htmlAttrs)+'><head>'+head+'</head><body'+attributes(bodyAttrs)+'>'+absoluteBody+sceneVendors.map(v=>'<script src="../../'+v.served+'"></script>').join('')+(controller.kind==='css'?'':'<script src="../../runtime-originale.js"></script>')+'<script src="avvio.js"></script></body></html>';
        await write(path.join(out,prefix,'scena.html'),body);
        await write(path.join(out,prefix,'struttura.html'),binding.body);
        await write(path.join(out,prefix,'avvio.js'),bootstrap);
        await write(path.join(out,prefix,'scena.json'),json(recipe));
        await write(path.join(out,prefix,controller.kind==='css'?'regola-originale.css.txt':'controller-originale.js.txt'),controller.kind==='css'?controller.cssRule.text:source.text.slice(controller.start,controller.end));
        entries.push({id:id+'--'+controller.name,page:pageSpec.url,controller:controller.name,kind:controller.kind||'javascript',actors:binding.actors,status:recipe.status,file:prefix+'/scena.html',recipe:prefix+'/scena.json'});
      }
    }
  const {runtime,...sourceIndex}=compiled;
  await write(path.join(out,'CONTROLLER.json'),json(sourceIndex));
  const index={format:'source-scene-library-v1',source:source.url,sourceHash:compiled.sourceHash,sourceVersions:shared.filter(s=>s.url===source.url).map(s=>s.sha256_decoded_utf8),pages:pageRows,entries,
    timings:{packagingSeconds:(performance.now()-started)/1000,includes:'Read existing acquisitions, compile original controller, associate DOM, generate executable examples and library; no fresh site acquisition or interaction verification.'},
    limits:['Generated examples are not proof of visual parity or complete interaction coverage.','Reduced DOM can change geometry; original complete HTML and all CSS are retained.','WebGL, frame decoding and dynamic imports are exported as original source requiring media/module integration.','Profile-dependent formulas remain in original JS/CSS; responsive behavior must be exercised.']};
  await write(path.join(out,'LIBRERIA.json'),json(index));
  await write(path.join(out,'index.html'),'<!doctype html><meta charset="utf-8"><title>Scene originali</title><style>body{font:16px system-ui;padding:24px;max-width:1000px}a{display:block;margin:8px 0}</style><h1>Scene estratte automaticamente</h1><p>Ogni collegamento apre un controller originale con struttura e stili associati. Le voci con media/moduli esterni richiedono integrazione.</p>'+entries.map(e=>'<a href="'+e.file+'">'+htmlEscape(e.id)+' — '+e.actors+' attori associati — '+e.status+'</a>').join(''));
  await write(path.join(out,'PER_IA.md'),`# Libreria delle scene originali\n\nIngresso: LIBRERIA.json. Ogni voce collega scena.html eseguibile, struttura.html, scena.json e controller originale. runtime-originale.js conserva le definizioni condivise e le curve della fonte. Le associazioni dinamiche sono candidate esplicite, con attributi dell'istanza.\n\nPer montare un esempio: importa mountScene da scene-player.js e chiama mountScene(contenitore,{url:URL_SCENA,height:'80vh',replacements:[{selector:SELETTORE_ORIGINALE,textContent:TESTO_TUO}]}); destroy() rimuove il riquadro e il suo stato. Gli stili sono isolati dal documento ospite. Immagini/font/JSON possono essere remoti. Servire con HTTP locale.\n\nPer integrazione diretta nel DOM del sito destinatario: usa la struttura, gli attributi e le funzioni della ricetta. La rimozione dell'iframe richiede di adattare CSS globale, geometria e ciclo di vita al sito ospite; non è automatizzata da questo player.\n\nIl controller originale determina sequenze, durate, condizioni e formule. Non sostituire le istanze con mediane o preset. I passaggi nella pagina originale e i controller non esercitati sono indicati nei metadati; numero di attori o esempi non equivale a copertura completa.\n`);
  return index;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const index=await buildSceneLibrary(JSON.parse(await fs.readFile(process.argv[2],'utf8')));
  console.log(json({pages:index.pages.length,examples:index.entries.length,timings:index.timings}));
}