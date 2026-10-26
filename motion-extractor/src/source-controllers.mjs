// Preserve source definitions; analyze lexical references, not minified names.
import {parse} from 'acorn';
import {analyze} from 'eslint-scope';
import {createHash} from 'node:crypto';
export const hash = s => createHash('sha256').update(s).digest('hex');
export function walk(n, visit) {
  if (!n?.type) return;
  visit(n);
  for (const [k,v] of Object.entries(n)) {
    if (k === 'loc' || k === 'range') continue;
    if (Array.isArray(v)) v.forEach(x => walk(x,visit));
    else if (v?.type) walk(v,visit);
  }
}
const member = n => n?.type === 'Identifier' ? [n.name] : n?.type === 'MemberExpression' ? [...member(n.object),n.computed?n.property.value:n.property.name] : [];
const engines = new Set(['gsap','ScrollTrigger','Flip','Draggable','Observer','Swiper','Lenis']);
const setup = new Set(['gsap.registerPlugin','gsap.registerEase','CustomEase.create']);
const queries = new Set(['querySelector','querySelectorAll','toArray']);
export function compileControllers(source) {
  const ast = parse(source,{ecmaVersion:'latest',sourceType:'module',ranges:true});
  const scopes = analyze(ast,{ecmaVersion:2024,sourceType:'module'});
  const refs = scopes.scopes.flatMap(s=>s.references);
  const resolved = new Map(refs.map(r=>[r.identifier,r.resolved]));
  const moduleScope = scopes.scopes.find(s=>s.type==='module');
  const variables = new Map(moduleScope.variables.map(v=>[v.name,v]));
  const declarations = ast.body.filter(n=>['FunctionDeclaration','VariableDeclaration'].includes(n.type));
  const fnNodes = declarations.filter(n=>n.type==='FunctionDeclaration');
  const nodeForVariable = new Map();
  for (const v of moduleScope.variables) {
    const def = v.defs[0]?.node;
    if (def) nodeForVariable.set(v,declarations.find(n=>n===def||(n.start<=def.start&&n.end>=def.end)));
  }
  const globals = n=>refs.filter(r=>r.identifier.start>=n.start&&r.identifier.end<=n.end&&!r.resolved).map(r=>r.identifier.name);
  const problems=[], omitted=[],included=[],imports=[];
  walk(ast,n=>{if(n.type==='ImportExpression')imports.push({specifier:n.source.type==='Literal'?n.source.value:null,expression:source.slice(n.source.start,n.source.end)});});
  const initializers=n=>{
    if (!n?.type || /Function/.test(n.type)) return;
    if (n.type==='CallExpression'||n.type==='NewExpression') {
      const api=member(n.callee).join('.');
      if (!(n.type==='NewExpression'?['URLSearchParams','Set','Map','WeakMap','WeakSet'].includes(api):api==='gsap.matchMedia')) problems.push({reason:'initializer_requires_integration',expression:source.slice(n.start,n.end)});
    }
    for(const v of Object.values(n)) {if(Array.isArray(v))v.forEach(initializers);else if(v?.type)initializers(v);}
  };
  for (const n of ast.body) {
    if (declarations.includes(n)) {included.push(n);if(n.type==='VariableDeclaration')n.declarations.forEach(d=>initializers(d.init));}
    else if(n.type==='ExpressionStatement') {
      for(const e of n.expression.type==='SequenceExpression'?n.expression.expressions:[n.expression]) {
        const api=e.type==='CallExpression'?member(e.callee).join('.'):'';
        // Keep the source's viewport CSS variable assignments as setup too.
        if(setup.has(api)||api==='document.documentElement.style.setProperty')included.push(e);
        else omitted.push({start:e.start,end:e.end,source:source.slice(e.start,e.end)});
      }
    } else problems.push({reason:'unsupported_top_level',type:n.type});
  }
  const info=new Map();
  for(const fn of fnNodes) {
    const ownRefs=refs.filter(r=>r.identifier.start>=fn.start&&r.identifier.end<=fn.end);
    const dependencies=[...new Set(ownRefs.map(r=>nodeForVariable.get(r.resolved)).filter(n=>n?.type==='FunctionDeclaration'&&n!==fn).map(n=>n.id.name))];
    const first=fn.params[0];const rootName=first?.type==='AssignmentPattern'&&first.right.name==='document'?first.left.name:null;
    const rootVariable=rootName?scopes.acquire(fn)?.variables.find(v=>v.name===rootName):null;
    const selectors=[],features=new Set();let motion=false;
    walk(fn.body,n=>{
      if(n.type==='ImportExpression')features.add('dynamic_import');
      if(n.type!=='CallExpression'&&n.type!=='NewExpression')return;
      const parts=member(n.callee),api=parts.join('.');let root=n.callee;
      while(root?.type==='MemberExpression')root=root.object;
      if(engines.has(parts[0])&&resolved.has(root)&&!resolved.get(root))motion=true;
      if(['fetch','VideoDecoder','ActiveFrame'].includes(parts[0])||api.startsWith('barba.'))features.add(api);
      if(!queries.has(parts.at(-1))||!n.arguments[0])return;
      const receiver=n.callee.object;
      const isRoot=receiver?.type==='Identifier'&&((receiver.name==='document'&&!resolved.get(receiver))||resolved.get(receiver)===rootVariable&&!!rootVariable);
      const isArray=api==='gsap.utils.toArray'&&n.arguments[1]?.type==='Identifier'&&resolved.get(n.arguments[1])===rootVariable&&!!rootVariable;
      if(!isRoot&&!isArray)return;
      const arg=n.arguments[0];let selector=arg.type==='Literal'&&typeof arg.value==='string'?arg.value:null,pattern=null;
      // A template attribute value is an association candidate, not an invented value.
      if(arg.type==='TemplateLiteral') {
        const raw=arg.quasis.map(x=>x.value.cooked).join('__DYNAMIC__');
        const broad=raw.replace(/\[([\w-]+)=(?:"|')?[^\]]*__DYNAMIC__[^\]]*\]/g,'[$1]');
        if(!broad.includes('__DYNAMIC__'))pattern=broad;
      }
      selectors.push({selector,pattern,expression:source.slice(arg.start,arg.end),dynamic:!selector,start:arg.start});
    });
    info.set(fn.id.name,{name:fn.id.name,node:fn,dependencies,selectors,directMotion:motion,rootDocument:!!rootVariable,noArguments:!fn.params.length,externalGlobals:[...new Set(globals(fn))],features:[...features]});
  }
  const closure=name=>{
    const found=new Set();const visit=n=>{if(found.has(n)||!info.has(n))return;found.add(n);info.get(n).dependencies.forEach(visit);};visit(name);return [...found];
  };
  const providers=new Map();
  for(const fn of fnNodes)walk(fn.body,n=>{
    if(n.type==='AssignmentExpression'&&n.left.type==='Identifier'&&n.right.type==='NewExpression'&&member(n.right.callee)[0]==='Lenis'&&resolved.get(n.left)===variables.get(n.left.name))providers.set(n.left.name,fn.id.name);
  });
  const controllers=[];
  for(const item of info.values()) {
    const names=closure(item.name),chain=names.map(n=>info.get(n));
    if(!chain.some(x=>x.directMotion))continue;
    const variablesUsed=new Set(chain.flatMap(x=>refs.filter(r=>r.identifier.start>=x.node.start&&r.identifier.end<=x.node.end&&r.resolved===variables.get(r.identifier.name)).map(r=>r.identifier.name)));
    const prerequisites=[...new Set([...variablesUsed].map(n=>providers.get(n)).filter(n=>n&&n!==item.name))];
    const {node,...rest}=item;
    controllers.push({...rest,start:node.start,end:node.end,sha256:hash(source.slice(node.start,node.end)),functions:names,prerequisites,directFeatures:item.features,
      features:[...new Set(chain.flatMap(x=>x.features))],
      externalGlobals:[...new Set(chain.flatMap(x=>x.externalGlobals))],
      standaloneCandidate:(item.rootDocument&&node.params.slice(1).every(p=>p.type==='AssignmentPattern')||item.noArguments)&&item.selectors.length>0,
      dependenciesSource:names.map(n=>({name:n,start:info.get(n).node.start,end:info.get(n).node.end}))});
  }
  const bindable=fnNodes.map(n=>n.id.name);
  const exports=bindable.map(n=>JSON.stringify(n)+':'+n).join(',');
  const bind=bindable.map(n=>'case '+JSON.stringify(n)+':'+n+'=callback;break;').join('');
  const runtime=problems.length?null:'(function(){\n'+included.map(n=>source.slice(n.start,n.end)+'\n;').join('\n')+
    '\nglobalThis.SourceScene={functions:{'+exports+'},bind(name,callback){if(typeof callback!=="function")throw Error("Callback required");switch(name){'+bind+'default:throw Error("Unknown source function: "+name);}}};\n})();\n';
  if(runtime)parse(runtime,{ecmaVersion:'latest',sourceType:'script'});
  return {format:'source-controllers-v1',sourceHash:hash(source),controllers,imports,functionGraph:[...info.values()].map(x=>({name:x.name,dependencies:x.dependencies,features:x.features})),runtimeIntervals:included.map(n=>({start:n.start,end:n.end,sha256:hash(source.slice(n.start,n.end))})),runtime,omitted,problems,
    limits:['Global declaration scripts only; private bundled modules require a different adapter.','A controller is a source mechanism, not a count of independent scenes.','DOM associations from dynamic selector patterns are candidates; original expressions and attributes are retained.']};
}