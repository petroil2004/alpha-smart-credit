import {useState} from 'react';
import type {Api,Application,Assessment} from '../types';
import {ApiError} from '../api';

const group:{[key:string]:string}={LOW:'Низкий риск',MEDIUM:'Средний риск',HIGH:'Высокий риск',UNKNOWN:'Недостаточно данных'};
const recommendation:{[key:string]:string}={OFFER_REQUESTED:'Можно принять решение',RECOMMEND_DECLINE:'Рекомендован отказ',REQUEST_INFO:'Нужны уточнения'};
export default function ReviewPanel({api,application,onUpdated}:{api:Api;application:Application;onUpdated:(value:Application)=>void}){
 const [assessment,setAssessment]=useState<Assessment|null>(application.assessment??null);const [comment,setComment]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);
 async function refresh(){setBusy(true);setError(null);try{setAssessment(await api.assessment(application.id));}catch(e){setError(e instanceof ApiError?e.message:'Не удалось выполнить оценку');}finally{setBusy(false);}}
 async function decide(decision:'APPROVE'|'DECLINE'){setBusy(true);setError(null);try{onUpdated(await api.decide(application.id,{version:application.version,decision,comment},crypto.randomUUID()));}catch(e){setError(e instanceof ApiError?e.message:'Не удалось сохранить решение');}finally{setBusy(false);}}
 if(!['UNDER_REVIEW','NEEDS_INFO'].includes(application.status))return null;
 return <section className="form-card review-card"><div className="list-heading"><h2>Проверка и решение</h2><button className="button secondary" type="button" disabled={busy} onClick={()=>void refresh()}>{busy?'Считаем…':'Пересчитать'}</button></div>
 {!assessment?<p className="small-note">Оценка ещё не загружена.</p>:<><dl className="submitted-details"><div><dt>Балл</dt><dd>{assessment.score??'Не рассчитан'}{assessment.score!==null?' / 100':''}</dd></div><div><dt>Группа</dt><dd>{group[assessment.group]}</dd></div><div><dt>Рекомендация</dt><dd>{recommendation[assessment.recommendation]}</dd></div></dl>
 <h3>Причины и проверки</h3><ul>{assessment.reasons.map(value=><li key={value}>{value}</li>)}{assessment.formal_checks.map(value=><li key={value}>{value}</li>)}</ul></>}
 <label className="field"><span>Причина решения {assessment?.group==='MEDIUM'?'(обязательна для среднего риска)':''}</span><textarea value={comment} maxLength={1000} onChange={event=>setComment(event.target.value)} /></label>
 <div className="info-actions"><button className="button primary" type="button" disabled={busy||assessment?.recommendation!=='OFFER_REQUESTED'} onClick={()=>void decide('APPROVE')}>Одобрить</button><button className="button secondary" type="button" disabled={busy||!comment.trim()} onClick={()=>void decide('DECLINE')}>Отказать</button></div>
 {error&&<p role="alert" className="field-error">{error}</p>}<p className="small-note">Это демонстрационная рекомендация, а не автоматическое решение банка. Итог подтверждает сотрудник.</p></section>;
}
