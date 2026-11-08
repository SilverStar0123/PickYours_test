const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const {JSDOM}=require('jsdom');
const dom=new JSDOM('<div id="root"></div>',{url:'https://example.test/PickYourStar/#/taste'});
Object.assign(global,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
Object.defineProperty(global,'navigator',{value:dom.window.navigator,configurable:true});
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2019,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText,f);
require.extensions['.css']=()=>{};
const original=Module._load;Module._load=function(id,parent,main){if(id==='./csv'&&parent.filename.endsWith('TasteAnalysis.tsx'))return {loadAgencies:async()=>[]};return original.call(this,id,parent,main)};
const data=JSON.parse(fs.readFileSync(path.join(__dirname,'../public/taste-analysis.json'),'utf8'));
let requests=0,fail=false;
global.fetch=async(url)=>{assert.ok(url.endsWith('/taste-analysis.json'));requests++;return {ok:!fail,json:async()=>data}};
const React=require('react'),{createRoot}=require('react-dom/client'),{act,Simulate}=require('react-dom/test-utils');
const {default:Page,validateTasteData}=require('../src/TasteAnalysis.tsx');
validateTasteData(data);
const invalid=JSON.parse(JSON.stringify(data));invalid.groups.all.unitLeaders[0].percentage=123;assert.throws(()=>validateTasteData(invalid));
const root=createRoot(document.getElementById('root'));
const flush=async fn=>act(async()=>{fn?.();await Promise.resolve()});
(async()=>{
 await flush(()=>root.render(React.createElement(Page,{lang:'ko'})));
 assert.equal(document.querySelectorAll('.taste-card').length,data.groups.all.unitLeaders.length);
 assert.ok(document.body.textContent.includes('6,118'));
 assert.ok(document.body.textContent.includes('4,558'));
 for(const [i,key]of ['all','ko','ja','en'].entries()){
  await flush(()=>document.querySelectorAll('.taste-segments button')[i].click());
  const cards=[...document.querySelectorAll('.taste-card')];
  const expected=[...data.groups[key].unitLeaders].sort((a,b)=>b.percentage-a.percentage||a.unit.localeCompare(b.unit));
  assert.equal(cards.length,expected.length);
  for(let n=0;n<cards.length;n++){
   assert.ok(cards[n].textContent.includes(expected[n].percentage.toFixed(1)+'%'));
   assert.ok(cards[n].textContent.includes(expected[n].unit));
   expected[n].characters.forEach(c=>assert.ok(cards[n].textContent.includes(c)));
  }
 }
 assert.equal(requests,1,'language segments do not re-fetch');
 await flush(()=>Simulate.change(document.querySelector('input'),{target:{value:'no-such-character'}}));
 assert.equal(document.querySelectorAll('.taste-card').length,0);
 await flush(()=>root.render(React.createElement(Page,{lang:'ja'})));
 assert.ok(document.body.textContent.includes('表示する結果がありません'));
 await flush(()=>root.unmount());
 fail=true;const second=createRoot(document.getElementById('root'));
 await flush(()=>second.render(React.createElement(Page,{lang:'ko'})));
 assert.ok(document.querySelector('[role=alert]'));
 fail=false;await flush(()=>document.querySelector('[role=alert] button').click());
 assert.ok(document.querySelector('.taste-card'));
 await flush(()=>second.unmount());dom.window.close();
 console.log('PASS: supplied data validation, all language counts and percentages, filtering, UI language, error and retry, one static data request');
})().catch(e=>{console.error(e);process.exitCode=1});
