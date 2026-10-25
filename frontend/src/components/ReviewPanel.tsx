import {useEffect,useState} from 'react';
import type {Api,Application,Assessment} from '../types';
import {ApiError} from '../api';

const group:{[key:string]:string}={LOW:'Низкий риск',MEDIUM:'Средний риск',HIGH:'Высокий риск',UNKNOWN:'Недостаточно данных'};
const rub=(value:string)=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(Number(value));
const recommendation:{[key:string]:string}={OFFER_REQUESTED:'Можно принять решение',RECOMMEND_DECLINE:'Рекомендован отказ',REQUEST_INFO:'Нужны уточнения',KEEP_UNDER_REVIEW:'Повторите внешнюю проверку'};
export default function ReviewPanel({api,application,onUpdated,blocked=false}:{api:Api;application:Application;onUpdated:(value:Application)=>void;blocked?:boolean}){
 const [assessment,setAssessment]=useState<Assessment|null>(application.assessment??null);const [comment,setComment]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);
 useEffect(()=>{setAssessment(application.assessment??null);},[application.id,application.assessment]);
 async function refresh(){setBusy(true);setError(null);try{setAssessment(await api.assessment(application.id));}catch(e){setError(e instanceof ApiError?e.message:'Не удалось выполнить оценку');}finally{setBusy(false);}}
 async function decide(decision:'APPROVE'|'DECLINE'){setBusy(true);setError(null);try{onUpdated(await api.decide(application.id,{version:application.version,decision,comment},crypto.randomUUID()));}catch(e){setError(e instanceof ApiError?e.message:'Не удалось сохранить решение');}finally{setBusy(false);}}
 if(!['UNDER_REVIEW','NEEDS_INFO'].includes(application.status))return null;
 return <section className="form-card review-card">
 <details className="company-disclosure"><summary>Проверка и скоринг</summary>
 <button className="button secondary recalculate-assessment" type="button" disabled={busy} onClick={()=>void refresh()}>{busy?'Считаем…':'Пересчитать оценку'}</button>
 {assessment&&!assessment.checks&&<p className="small-note">Пересчитайте оценку, чтобы обновить проверки и условия рассмотрения.</p>}
 {!assessment?<p className="small-note">Оценка ещё не загружена.</p>:<><dl className="submitted-details"><div><dt>Балл</dt><dd>{assessment.score??'Не рассчитан'}{assessment.score!==null?' / 100':''}</dd></div><div><dt>Группа</dt><dd>{group[assessment.group]}</dd></div><div><dt>Рекомендация</dt><dd>{assessment.recommendation==='OFFER_REQUESTED'&&assessment.manual_review_required?'Нужна ручная оценка':recommendation[assessment.recommendation]}</dd></div></dl>
 <div className="assessment-explanation"><p>Балл оценивает устойчивость бизнеса. Рекомендация также учитывает условия заявки и результаты проверок.</p><ul>{(assessment.decision_reasons??assessment.reasons.filter(value=>!value.includes(' → '))).map(value=><li key={value}>{value}</li>)}</ul>
 {assessment.affordability&&<dl className="submitted-details"><div><dt>{assessment.affordability.kind==='MONTHLY_PAYMENT'?'Платёж по заявке':'Запрошенный лимит'}</dt><dd>{rub(assessment.affordability.requested_rub)}</dd></div><div><dt>{assessment.affordability.kind==='MONTHLY_PAYMENT'?'Допустимый новый платёж':'Допустимый лимит'}</dt><dd>{rub(assessment.affordability.available_rub)}</dd></div></dl>}</div>
 {assessment.checks&&<div className="assessment-checks">{assessment.checks.map(check=><article className="assessment-check" key={check.source}><strong>{check.label}</strong><p>{check.summary}</p><small>{new Date(check.checked_at).toLocaleString('ru-RU')} · {check.payload_version}</small></article>)}</div>}
 {assessment.criteria&&assessment.criteria.length>0&&<><p className="small-note">Демонстрационная формула: балл = сумма (коэффициент показателя × вес). До 100 баллов; от 80 — низкий риск, от 50 — средний, ниже — высокий. Регистрация бизнеса и доступный платёж проверяются отдельно.</p><div className="score-table-scroll"><table className="score-criteria"><caption>Как рассчитан скоринг</caption><thead><tr><th>Показатель</th><th>Данные</th><th>Коэффициент</th><th>Вес</th><th>Баллы</th></tr></thead><tbody>{assessment.criteria.map(row=><tr key={row.label}><th scope="row">{row.label}</th><td>{row.input}</td><td>{row.factor}</td><td>{row.weight}</td><td>{row.points}</td></tr>)}</tbody></table></div></>}
 <h3>Проверки компании и условий</h3><ul>{assessment.formal_checks.map(value=><li key={value}>{value}</li>)}</ul></>}
 </details>
 <h2 className="decision-heading">Решение по заявке</h2>
 {blocked&&<p className="small-note">Сохраните или отмените введённые уточнения перед принятием решения.</p>}
 <label className="field"><span>Причина решения {assessment?.manual_review_required||assessment?.group==='MEDIUM'?'(обязательна для ручной оценки)':''}</span><textarea value={comment} maxLength={1000} onChange={event=>setComment(event.target.value)} /></label>
 <div className="info-actions"><button className="button primary" type="button" disabled={blocked||busy||assessment?.recommendation!=='OFFER_REQUESTED'||Boolean(assessment.manual_review_required&&!comment.trim())} onClick={()=>void decide('APPROVE')}>Одобрить</button><button className="button secondary" type="button" disabled={blocked||busy||!comment.trim()||assessment?.recommendation==='KEEP_UNDER_REVIEW'} onClick={()=>void decide('DECLINE')}>Отказать</button></div>
 {error&&<p role="alert" className="field-error">{error}</p>}<p className="small-note">Это демонстрационная рекомендация, а не автоматическое решение банка. Итог подтверждает сотрудник.</p></section>;
}
