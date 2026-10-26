import {parse,generate,clone,walk} from 'css-tree';
// Read source declarations, including CSS nesting. Never infer durations or
// flatten the execution CSS; expanded selectors are only DOM associations.
export function nativeCssMotions(source) {
  const ast=parse(source,{positions:true,parseValue:false});const rows=[];
  function expand(selector,parent) {
    if(!parent)return generate(selector);
    const copy=clone(selector);let nested=false;
    walk(copy,node=>{if(node.type==='NestingSelector'){nested=true;const replacement=parse(':is('+parent+')',{context:'selector'}).children.toArray()[0];for(const key of Object.keys(node))delete node[key];Object.assign(node,clone(replacement));}});
    return nested?generate(copy):':is('+parent+') '+generate(copy);
  }
  function visit(children,parents=[],conditions=[]) {
    for(const node of children||[]) {
      if(node.type==='Atrule') {
        if(/keyframes$/i.test(node.name))continue;
        if(node.block)visit(node.block.children,parents,[...conditions,'@'+node.name+(node.prelude?' '+generate(node.prelude):'')]);
      } else if(node.type==='Rule'&&node.prelude.type==='SelectorList') {
        const own=node.prelude.children.toArray();
        const selectors=parents.length?parents.flatMap(parent=>own.map(s=>expand(s,parent))):own.map(s=>expand(s));
        const declarations=new Map(node.block.children.toArray().filter(n=>n.type==='Declaration').map(n=>[n.property,generate(n.value)]));
        const animation=declarations.get('animation')||declarations.get('animation-name');
        const transition=declarations.get('transition')||declarations.get('transition-property');
        if(animation&&animation!=='none'||transition&&transition!=='none')rows.push({selector:selectors.join(','),sourceSelector:generate(node.prelude),text:source.slice(node.loc.start.offset,node.loc.end.offset),conditions,animation,transition,start:node.loc.start.offset,end:node.loc.end.offset});
        visit(node.block.children,selectors,conditions);
      }
    }
  }
  visit(ast.children);return rows;
}