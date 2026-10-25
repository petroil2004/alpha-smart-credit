import {useEffect,useRef,useState} from 'react';
import type {Api,Application} from '../types';
import {ApiError} from '../api';
import DecisionDialog from './DecisionDialog';

const group:{[key:string]:string}={LOW:'Низкий риск',MEDIUM:'Средний риск',HIGH:'Высокий риск',UNKNOWN:'Недостаточно данных'};
const rub=(value:string)=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(Number(value));
const recommendation:{[key:string]:string}={OFFER_REQUESTED:'Можно принять решение',RECOMMEND_DECLINE:'Рекомендован отказ',REQUEST_INFO:'Нужны уточнения',KEEP_UNDER_REVIEW:'Повторите внешнюю проверку'};
export default function ReviewPanel({api,application,onUpdated,blocked=false}:{api:Api;application:Application;onUpdated:(value:Application)=>void;blocked?:boolean}){
 const assessment=application.assessment;
 const [comment,setComment]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 const [pending,setPending]=useState<{decision:'APPROVE'|'DECLINE';comment:string;version:number;key:string}|null>(null);
 const latest=useRef(application),alive=useRef(true),sending=useRef(false);latest.current=application;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{setComment('');setError(null);},[application.id]);
 useEffect(()=>{setPending(null);},[application.id,application.version,assessment?.calculated_at]);
 async function refresh(){
  setBusy(true);setError(null);const target=application;
  try{const value=await api.assessment(target.id);if(alive.current&&latest.current.id===target.id&&latest.current.version===target.version)onUpdated({...latest.current,assessment:value});}
  catch(e){if(alive.current)setError(e instanceof ApiError?e.message:'Не удалось выполнить оценку');}
  finally{if(alive.current)setBusy(false);}
 }
 async function decide(){
  if(!pending||sending.current)return;
  sending.current=true;setBusy(true);setError(null);const target=application;
  try{const value=await api.decide(target.id,{version:pending.version,decision:pending.decision,comment:pending.comment},pending.key);if(alive.current&&latest.current.id===target.id){setPending(null);onUpdated(value);}}
  catch(e){if(alive.current)setError(e instanceof ApiError?e.message:'Не удалось сохранить решение');}
  finally{sending.current=false;if(alive.current)setBusy(false);}
 }
 const manual=assessment?.manual_review_required||assessment?.group==='MEDIUM';
 const underReview=application.status==='UNDER_REVIEW';
 const note=!underReview?'Завершите уточнение, прежде чем принимать итоговое решение.':!assessment?'Пересчитайте оценку перед принятием решения.':assessment.recommendation==='KEEP_UNDER_REVIEW'?'Решение недоступно: повторите проверку кнопкой «Повторить проверку БКИ» выше.':assessment.recommendation==='REQUEST_INFO'?'Одобрение недоступно: запросите и проверьте недостающие сведения.':assessment.recommendation==='RECOMMEND_DECLINE'?'Одобрение недоступно: не выполнены правила продукта или допустимого риска. Основания перечислены в проверке и скоринге.':manual?'Сотрудник может одобрить или отказать после ручной проверки с обязательным обоснованием.':'Сотрудник может одобрить заявку или отказать с указанием причины.';
 if(!['UNDER_REVIEW','NEEDS_INFO'].includes(application.status))return null;
 return <section className="form-card review-card">
 <details className="company-disclosure"><summary>Проверка и скоринг</summary>
 <button className="button secondary recalculate-assessment" type="button" disabled={busy||!!pending||blocked} onClick={()=>void refresh()}>{busy?'Считаем…':assessment?.recommendation==='KEEP_UNDER_REVIEW'?'Повторить проверку БКИ':'Пересчитать оценку'}</button>
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
 <p className="small-note decision-availability">{note}</p>
 <label className="field"><span>Причина решения {manual?'(обязательна для ручной оценки)':''}</span><textarea value={comment} maxLength={1000} disabled={busy||!!pending} onChange={event=>setComment(event.target.value)} /></label>
 <div className="info-actions"><button className="button primary" type="button" disabled={!underReview||blocked||busy||!!pending||assessment?.recommendation!=='OFFER_REQUESTED'||Boolean(manual&&!comment.trim())} onClick={()=>{setError(null);setPending({decision:'APPROVE',comment,version:application.version,key:crypto.randomUUID()});}}>Одобрить</button><button className="button secondary" type="button" disabled={!underReview||blocked||busy||!!pending||!assessment||!comment.trim()||assessment.recommendation==='KEEP_UNDER_REVIEW'} onClick={()=>{setError(null);setPending({decision:'DECLINE',comment,version:application.version,key:crypto.randomUUID()});}}>Отказать</button></div>
 {pending&&<DecisionDialog application={application} decision={pending.decision} comment={pending.comment} busy={busy} error={error} onCancel={()=>{setPending(null);setError(null);}} onConfirm={()=>void decide()}/>}
 {error&&!pending&&<p role="alert" className="field-error">{error}</p>}<p className="small-note">Рекомендация рассчитывается по данным и правилам продукта. Итоговое решение подтверждает сотрудник в пределах этих правил.</p></section>;
}
