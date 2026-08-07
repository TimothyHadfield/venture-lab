// Absolute scores in a duel vs solitaire — are duel numbers realistic?
const fs=require('fs'),path=require('path'),vm=require('vm');
const LABDIR=require('path').join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(LABDIR,p),'utf8');
const ctx={console,localStorage:{getItem:()=>null,setItem:()=>{}},document:{readyState:'loading',addEventListener:()=>{},getElementById:()=>null}};
vm.createContext(ctx);
for(const f of['config.js','math.js','rules.js','constants.js']){let s=read('vendor/src/'+f).replace(/if \(typeof document[\s\S]*?\n}/,'').replace(/if \(typeof module[\s\S]*$/,'');if(f==='constants.js')s=s.match(/function getCards\(obj, \.\.\.keys\)\{[\s\S]*?\n\}/)[0];vm.runInContext(s,ctx);}
const L=read('lab.js').split(/\r?\n/);
vm.runInContext(L.slice(L.findIndex(l=>l.includes('function venturePotential(pile, pool')),L.findIndex(l=>l.includes('function labColorPotential'))).join('\n'),ctx);
vm.runInContext(read('computers.js'),ctx);
vm.runInContext(`
  let _seed=1; Math.random=()=>{_seed=(_seed*1664525+1013904223)>>>0;return _seed/4294967296;};
  globalThis.B={duel:playDuelGame,solo:playSoloGame,COMPUTERS,RULES,seed:n=>{_seed=n>>>0;}};
`,ctx);
const B=ctx.B;
const mean=xs=>xs.reduce((s,v)=>s+v,0)/xs.length;
const med=xs=>xs.slice().sort((a,b)=>a-b)[Math.floor(xs.length/2)];
const KEYS=['broker','patient','wageropen','lowest','random'];
const solo={},duelS={},plies=[],stalls=[];
for(const k of KEYS){solo[k]=[];duelS[k]=[];}
for(let d=0;d<40;d++){
  B.seed(500+d); const deck=B.RULES.createDrawPile();
  for(const k of KEYS){
    // each bot duels The Patient on the same deal, both seats
    const g1=B.duel(B.COMPUTERS[k],B.COMPUTERS.patient,{deck});
    const g2=B.duel(B.COMPUTERS.patient,B.COMPUTERS[k],{deck});
    duelS[k].push(g1.p1,g2.p2);
    plies.push(g1.plies); stalls.push(g1.stalls);
    B.seed(900+d); solo[k].push(B.solo(B.COMPUTERS[k]).score);
  }
}
console.log('  computer        solitaire median   duel mean score (vs The Patient)');
for(const k of KEYS)
  console.log('  '+B.COMPUTERS[k].name.padEnd(16)+String(med(solo[k])).padStart(8)+mean(duelS[k]).toFixed(1).padStart(20));
console.log('\n  duel length: '+mean(plies).toFixed(0)+' plies, '+mean(stalls).toFixed(1)+' discard draws per game');
console.log('  (real Lost Cities: an "average OK" round is ~30 points, a strong one ~50)');
