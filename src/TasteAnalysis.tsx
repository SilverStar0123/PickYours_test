import React, { useEffect, useState } from 'react';
import type { Lang } from './i18n';
import type { Group } from './types';
import { loadAgencies } from './csv';
import { avatarUri, onImgError } from './assets';
import './tasteAnalysis.css';

export const tasteTitle = { ko: '취향 분석', en: 'Taste insights', ja: '好み分析' };
const text = {
 ko: { intro:'유닛마다 가장 많이 선택된 캐릭터를 만나보세요.', all:'전체', ko:'한국어 이용자', ja:'일본어 이용자', en:'영어 이용자', records:'분석 기록', date:'데이터 추출일', unknown:'언어 미기록', heading:'유닛별 최다 선택 캐릭터', note:'선택률은 해당 유닛에 응답한 기록 기준입니다. 유닛 인원수가 다르므로 전체 캐릭터 인기 순위가 아닙니다.', language:'언어는 제출 화면의 언어이며 국적이 아닙니다. 언어 미기록은 전체에만 포함됩니다.', sample:'이 사이트에 제출된 익명 통계 표본입니다. 실제 사람 수나 전체 팬덤을 대표하지 않습니다.', sort:'정렬', rate:'선택률 높은 순', unit:'유닛 이름순', search:'유닛·캐릭터 검색', count:'선택', answered:'유효 응답', tie:'공동 1위', solo:'선택지 1명', small:'응답 30개 미만 · 해석에 주의', loading:'분석 결과를 불러오는 중…', error:'분석 데이터를 불러오지 못했어요.', retry:'다시 시도', empty:'표시할 결과가 없어요.', method:'집계 기준', future:'함께 선택된 TOP 3는 조합 분석 데이터가 준비되면 추가됩니다.' },
 en: { intro:'Meet the most selected characters in each unit.', all:'All', ko:'Korean UI', ja:'Japanese UI', en:'English UI', records:'Records', date:'Data exported', unknown:'Language unrecorded', heading:'Most selected by unit', note:'Percentages use responses to each unit. Unit sizes differ; this is not an overall character popularity ranking.', language:'Language refers to the submission UI, not nationality. Unrecorded language is included only in All.', sample:'An anonymous sample submitted to this site, not a count of unique people or the entire fandom.', sort:'Sort', rate:'Selection rate', unit:'Unit name', search:'Search unit or character', count:'Selected', answered:'Responses', tie:'Joint leader', solo:'One choice', small:'Fewer than 30 responses · interpret cautiously', loading:'Loading insights…', error:'Could not load analysis data.', retry:'Retry', empty:'No results to display.', method:'About these numbers', future:'Co-selection TOP 3 will be added when pair analysis is available.' },
 ja: { intro:'ユニットごとに最も選ばれたキャラクターを紹介します。', all:'全体', ko:'韓国語利用者', ja:'日本語利用者', en:'英語利用者', records:'分析記録数', date:'データ抽出日', unknown:'言語未記録', heading:'ユニット別・最多選択キャラクター', note:'選択率は各ユニットへの回答数が基準です。人数が異なるため、全キャラクターの人気順位ではありません。', language:'言語は送信時の画面言語で、国籍ではありません。言語未記録は全体にのみ含めます。', sample:'当サイトに送信された匿名統計の標本です。実人数やファン全体を表すものではありません。', sort:'並び順', rate:'選択率の高い順', unit:'ユニット名順', search:'ユニット・キャラクター検索', count:'選択数', answered:'有効回答数', tie:'同率1位', solo:'選択肢1名', small:'回答30件未満・解釈に注意', loading:'分析結果を読み込み中…', error:'分析データを読み込めませんでした。', retry:'再試行', empty:'表示する結果がありません。', method:'集計について', future:'同時選択TOP 3は組み合わせ分析の準備後に追加します。' }
};
type Leader = { unit: string; characters: string[]; count: number; answered: number; percentage: number };
type Segment = 'all' | Lang;
type Dataset = { schemaVersion: number; dataExportedOn: string; missingLanguageCount: number; groups: Record<Segment, {recordCount: number; unitLeaders: Leader[]}> };
export function validateTasteData(value: any): Dataset {
 if (value?.schemaVersion !== 1 || typeof value.dataExportedOn !== 'string' || !Number.isInteger(value.missingLanguageCount) || value.missingLanguageCount < 0) throw new Error('Invalid analysis');
 for (const key of ['all','ko','ja','en']) {
  const group = value.groups?.[key];
  if (!group || !Number.isInteger(group.recordCount) || group.recordCount < 0 || !Array.isArray(group.unitLeaders)) throw new Error('Invalid group');
  const seen = new Set<string>();
  for (const row of group.unitLeaders) {
   if (typeof row.unit !== 'string' || seen.has(row.unit) || !Array.isArray(row.characters) || !row.characters.length || !row.characters.every((s: unknown) => typeof s === 'string') || !Number.isInteger(row.count) || row.count < 0 || !Number.isInteger(row.answered) || row.answered <= 0 || row.count > row.answered || row.answered > group.recordCount || !Number.isFinite(row.percentage) || row.percentage < 0 || row.percentage > 100 || Math.abs(row.percentage - row.count / row.answered * 100) > .051) throw new Error('Invalid row');
   seen.add(row.unit);
  }
 }
 return value;
}
export default function TasteAnalysis({lang}: {lang: Lang}) {
 const t = text[lang];
 const [data,setData] = useState<Dataset | null>(null);
 const [groups,setGroups] = useState<Group[]>([]);
 const [segment,setSegment] = useState<Segment>('all');
 const [sort,setSort] = useState('rate');
 const [search,setSearch] = useState('');
 const [error,setError] = useState(false);
 const [retry,setRetry] = useState(0);
 useEffect(() => {
  const controller = new AbortController(); let active = true;
  setError(false); setData(null);
  fetch(`${process.env.PUBLIC_URL || '.'}/taste-analysis.json`, { signal: controller.signal, cache:'no-cache' })
   .then(r => { if (!r.ok) throw new Error('Missing data'); return r.json(); })
   .then(validateTasteData).then(d => { if(active) setData(d); }).catch(() => { if(active) setError(true); });
  void loadAgencies().then(a => { if(active) setGroups(a.flatMap(x => x.groups)); }).catch(() => {});
  return () => { active=false; controller.abort(); };
 }, [retry]);
 const groupFor = (unit: string) => groups.find(g => g.id === unit);
 const memberFor = (unit: string, name: string) => groupFor(unit)?.members.find(m => m.name === name || m.id === `${unit}::${name}`);
 const unitName = (unit: string) => groupFor(unit)?.names?.[lang] || groupFor(unit)?.name || unit;
 const memberName = (unit: string, name: string) => memberFor(unit,name)?.names?.[lang] || name;
 const selected = data?.groups[segment];
 const rows = [...(selected?.unitLeaders || [])].filter(r => [r.unit,unitName(r.unit),...r.characters,...r.characters.map(n=>memberName(r.unit,n))].join(' ').toLowerCase().includes(search.trim().toLowerCase())).sort((a,b) => sort === 'rate' ? b.percentage-a.percentage || a.unit.localeCompare(b.unit) : unitName(a.unit).localeCompare(unitName(b.unit),lang));
 const number = (n: number) => n.toLocaleString(lang);
 return <section className="taste-page">
  <header className="taste-hero"><span className="taste-eyebrow">PICK YOUR STAR · INSIGHTS</span><h1>{tasteTitle[lang]}</h1><p>{t.intro}</p></header>
  {error ? <div className="taste-state" role="alert"><p>{t.error}</p><button onClick={()=>setRetry(x=>x+1)}>{t.retry}</button></div> : !data ? <p className="taste-state" role="status">{t.loading}</p> : <>
   <div className="taste-segments" aria-label={tasteTitle[lang]}>{(['all','ko','ja','en'] as Segment[]).map(key=><button key={key} aria-pressed={segment===key} onClick={()=>setSegment(key)}>{t[key]} <span>{number(data.groups[key].recordCount)}</span></button>)}</div>
   <div className="taste-metrics"><div><span>{t.records} · {t[segment]}</span><strong>{number(selected!.recordCount)}</strong></div><div><span>{t.date}</span><strong>{data.dataExportedOn}</strong></div><div><span>{t.unknown} · {t.all}</span><strong>{number(data.missingLanguageCount)}</strong></div></div>
   <div className="taste-toolbar"><h2>{t.heading}</h2><div><input aria-label={t.search} placeholder={t.search} value={search} onChange={e=>setSearch(e.target.value)}/><select aria-label={t.sort} value={sort} onChange={e=>setSort(e.target.value)}><option value="rate">{t.rate}</option><option value="unit">{t.unit}</option></select></div></div>
   <p className="taste-note">{t.note}</p>
   <div className="taste-grid">{rows.map(row=><article className="taste-card" key={row.unit}>
    <div className="taste-card-top"><h3>{unitName(row.unit)}</h3>{row.characters.length>1 && <span>{t.tie}</span>}{groupFor(row.unit)?.members.length===1 && <span>{t.solo}</span>}</div>
    {row.characters.map(name=>{const member=memberFor(row.unit,name); return <div className="taste-member" key={name}><img src={member?.img || avatarUri(name)} onError={onImgError(avatarUri(name))} alt="" loading="lazy"/><h4>{memberName(row.unit,name)}</h4></div>;})}
    <div className="taste-rate"><strong>{row.percentage.toFixed(1)}<small>%</small></strong><span>{t.count} {number(row.count)} / {t.answered} {number(row.answered)}</span></div>
    <div className="taste-bar" aria-hidden="true"><span style={{width:`${row.percentage}%`}}/></div>
    {row.answered<30 && <p className="taste-small">{t.small}</p>}
   </article>)}</div>
   {!rows.length && <p className="taste-state">{t.empty}</p>}
   <aside className="taste-method"><h2>{t.method}</h2><p>{t.language}</p><p>{t.sample}</p><p>{t.future}</p></aside>
  </>}
 </section>;
}
