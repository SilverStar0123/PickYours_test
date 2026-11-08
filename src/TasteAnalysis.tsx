import React, { useEffect, useState } from 'react';
import type { Lang } from './i18n';
import type { Group } from './types';
import { loadAgencies } from './csv';
import { avatarUri, onImgError } from './assets';
import { validateSimilarData } from './similarTaste';
import type { SimilarData, Character } from './similarTaste';
import './tasteAnalysis.css';
export const tasteTitle = { ko:'취향 분석', en:'Taste insights', ja:'好み分析' };
const texts = {
 ko:{ intro:'좋아하는 캐릭터로 발견하는 또 다른 취향', all:'전체', ko:'한국어 이용자', ja:'일본어 이용자', en:'영어 이용자', choose:'좋아하는 캐릭터를 골라주세요', unit:'유닛 선택', character:'캐릭터 선택', prompt:'캐릭터를 선택하면 함께 선택되는 취향을 보여드려요.', heading:'함께 발견한 취향 · TOP 3', description:'이 캐릭터를 고른 사람들의 선택에서 찾은 조합이에요.', equal:'카드는 순위를 매기지 않고 이름순으로 보여드려요.', empty:'아직 조건을 충족하는 조합이 부족해요.', emptyHint:'취향이 비슷한 캐릭터가 없다는 뜻은 아니에요. 기록이 더 쌓이면 결과가 달라질 수 있어요.', partial:'현재 분석 기준을 충족한 조합만 보여드려요.', date:'데이터 추출일', method:'어떻게 찾았나요?', methodText:'같은 두 유닛에 응답한 기록끼리 비교하고, 각 캐릭터의 평소 선택률을 고려해 함께 선택되는 경향을 찾았어요. 현재는 언어 기록 여부와 관계없이 전체 데이터를 사용해요. 성격이나 캐릭터의 가치를 평가하는 결과는 아니에요.', excluded:'선택지가 한 명뿐인 유닛은 분석에서 제외했어요.', loading:'취향을 불러오는 중…', error:'분석 데이터를 불러오지 못했어요.', retry:'다시 시도' },
 en:{intro:'Discover another connection through your favorite character',all:'All',ko:'Korean UI',ja:'Japanese UI',en:'English UI',choose:'Choose your favorite character',unit:'Unit',character:'Character',prompt:'Choose a character to explore co-selection patterns.',heading:'Shared taste · TOP 3',description:'Connections found in the choices of people who selected this character.',equal:'Cards are shown by name, without rank numbers.',empty:'Not enough qualifying combinations yet.',emptyHint:'This does not mean there are no shared tastes. Results may change as more records become available.',partial:'Only combinations meeting the analysis criteria are shown.',date:'Data exported',method:'How does it work?',methodText:'We compare records answering both units and account for each character’s baseline selection rate. Currently, all records are used regardless of recorded language. This does not assess personality or a character’s worth.',excluded:'Units with only one choice are excluded.',loading:'Loading connections…',error:'Could not load analysis data.',retry:'Retry'},
 ja:{intro:'好きなキャラクターから、もうひとつの好みを発見',all:'全体',ko:'韓国語利用者',ja:'日本語利用者',en:'英語利用者',choose:'好きなキャラクターを選んでください',unit:'ユニット',character:'キャラクター',prompt:'キャラクターを選ぶと、一緒に選ばれる傾向を紹介します。',heading:'一緒に見つけた好み · TOP 3',description:'このキャラクターを選んだ人たちの選択から見つけた組み合わせです。',equal:'順位を付けず、名前順で表示します。',empty:'条件を満たす組み合わせがまだ不足しています。',emptyHint:'似た好みがないという意味ではありません。記録が増えると結果が変わる可能性があります。',partial:'分析条件を満たした組み合わせのみ表示しています。',date:'データ抽出日',method:'分析方法',methodText:'両方のユニットに回答した記録を比較し、各キャラクターの通常の選択率を考慮しています。現在は言語の記録に関係なく全体のデータを使用しています。性格やキャラクターの価値を評価するものではありません。',excluded:'選択肢が1名のユニットは分析対象外です。',loading:'読み込み中…',error:'分析データを読み込めませんでした。',retry:'再試行'}
};
export default function TasteAnalysis({lang}:{lang:Lang}) {
 const t=texts[lang];
 const [data,setData]=useState<SimilarData|null>(null),[groups,setGroups]=useState<Group[]>([]);
 const [unit,setUnit]=useState(''),[id,setId]=useState('');
 const [error,setError]=useState(false),[retry,setRetry]=useState(0);
 useEffect(()=>{
  let active=true;const controller=new AbortController();setError(false);setData(null);
  fetch(`${process.env.PUBLIC_URL || '.'}/similar-taste.json`,{signal:controller.signal,cache:'no-cache'})
   .then(r=>{if(!r.ok)throw Error();return r.json();}).then(validateSimilarData)
   .then(d=>{if(active)setData(d);}).catch(()=>{if(active)setError(true);});
  void loadAgencies().then(a=>{if(active)setGroups(a.flatMap(x=>x.groups));}).catch(()=>{});
  return()=>{active=false;controller.abort();};
 },[retry]);
 const groupFor=(u:string)=>groups.find(g=>g.id===u);
 const memberFor=(c:Character)=>groupFor(c.unit)?.members.find(m=>m.id===c.id||m.name===c.name);
 const name=(c:Character)=>memberFor(c)?.names?.[lang]||c.name;
 const unitName=(u:string)=>groupFor(u)?.names?.[lang]||groupFor(u)?.name||u;
 const catalog=data?.groups.all.characters||[];
 const units=Array.from(new Set(catalog.map(c=>c.unit))).sort((a,b)=>unitName(a).localeCompare(unitName(b),lang));
 const options=catalog.filter(c=>c.unit===unit).sort((a,b)=>name(a).localeCompare(name(b),lang));
 const chosen=catalog.find(c=>c.id===id);
 const profile=data?.groups.all.characters.find(c=>c.id===id);
 // Keep the computed top three, but present them alphabetically, without a podium.
 const recommendations=[...(profile?.recommendations||[])].sort((a,b)=>name(a).localeCompare(name(b),lang)||a.id.localeCompare(b.id));
 const portrait=(c:Character)=> <img src={memberFor(c)?.img||avatarUri(c.name)} onError={onImgError(avatarUri(c.name))} alt="" loading="lazy"/>;
 return <section className="taste-page">
  <header className="taste-hero"><span className="taste-eyebrow">PICK YOUR STAR · CONNECTIONS</span><h1>{tasteTitle[lang]}</h1><p>{t.intro}</p></header>
  {error?<div className="taste-state" role="alert"><p>{t.error}</p><button onClick={()=>setRetry(n=>n+1)}>{t.retry}</button></div>:!data?<p className="taste-state" role="status">{t.loading}</p>:<>
   <div className="taste-picker"><h2>{t.choose}</h2><div><label>{t.unit}<select value={unit} onChange={e=>{setUnit(e.target.value);setId('');}}><option value="">—</option>{units.map(u=><option key={u} value={u}>{unitName(u)}</option>)}</select></label><label>{t.character}<select value={id} disabled={!unit} onChange={e=>setId(e.target.value)}><option value="">—</option>{options.map(c=><option key={c.id} value={c.id}>{name(c)}</option>)}</select></label></div></div>
   {!chosen?<p className="taste-state">{t.prompt}</p>:<div className="taste-results" aria-live="polite">
    <div className="taste-chosen">{portrait(chosen)}<div><span>{unitName(chosen.unit)}</span><h2>{name(chosen)}</h2></div></div>
    <header className="taste-result-heading"><h2>{t.heading}</h2><p>{t.description}</p></header>
    {recommendations.length?<><div className="taste-grid">{recommendations.map(c=><article className="taste-card" key={c.id}>{portrait(c)}<p>{unitName(c.unit)}</p><h3>{name(c)}</h3></article>)}</div><p className="taste-note">{t.equal}</p>{recommendations.length<3&&<p className="taste-note">{t.partial}</p>}</>:<div className="taste-state"><h3>{t.empty}</h3><p>{t.emptyHint}</p></div>}
   </div>}
   <footer className="taste-footer"><p>{t.date} · {data.dataExportedOn}</p><details><summary>{t.method}</summary><p>{t.methodText}</p><p>{t.excluded}</p></details></footer>
  </>}
 </section>;
}
