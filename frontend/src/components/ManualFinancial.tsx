import {useEffect,useRef,useState} from 'react';
import type {Api,Application,InfoRequest,Session,ManualFinancialInput} from '../types';
import type {InfoController} from './InfoRequests';
import {InfoReceipts} from '../info-receipts';
import {useInfoAction} from '../hooks/useInfoAction';
import {formatMoneyRub} from '../draft';
const labels={income_rub:'Поступления',expenses_rub:'Операционные расходы',debt_payment_rub:'Платёж по действующим долгам'};
export default function ManualFinancial({api,application,request,session,guard,accept,register}:{api:Api;application:Application;request:InfoRequest;session:Session;guard:()=>Promise<void>;accept:(value:Application)=>void;register:(control:InfoController|null)=>void}) {
 const [open,setOpen]=useState(false),[reason,setReason]=useState(''),[rows,setRows]=useState<ManualFinancialInput['values']>([]);
 const initial=useRef<ManualFinancialInput['values']>([]);
 const [store]=useState(()=>new InfoReceipts(session.user.id,application.id,request.id));
 const action=useInfoAction(store,'staff-financial-correction',guard,accept);
 const current=useRef(application);current.current=application;
 const dirty=!!reason.trim()||(open&&JSON.stringify(rows)!==JSON.stringify(initial.current))||action.busy||!!action.pending;
 const control=useRef({dirty,wait:action.wait});control.current={dirty,wait:action.wait};
 useEffect(()=>{register({dirty,flush:async()=>{await control.current.wait();return !control.current.dirty;}});return()=>register(null);},[dirty,register]);
 const available=!session.company&&['UNDER_REVIEW','NEEDS_INFO'].includes(application.status)&&!!(request.reply_submitted_at||request.closed_at)&&!!api.info?.correctFinancial;
 function start(){
  const finance=application.submission?.snapshot.company.finance;
  const values:ManualFinancialInput['values']=finance?finance.months.flatMap(month=>(['income_rub','expenses_rub'] as const).map(kind=>({kind,month:month.month,value_rub:month[kind]??''}))):[];
  values.push({kind:'debt_payment_rub',month:null,value_rub:finance?.debt_payment_rub??''});
  const corrections=(application.info_requests??[]).flatMap(r=>[...(r.financial_accepted_at?[{recorded_at:r.financial_accepted_at,values:r.financial_values??[]}]:[]),...(r.staff_corrections??[])]).sort((a,b)=>a.recorded_at.localeCompare(b.recorded_at));
  for(const correction of corrections)for(const value of correction.values){const row=values.find(r=>r.kind===value.kind&&r.month===value.month);if(row)row.value_rub=value.value_rub;}
  initial.current=values;setRows(values);setReason('');setOpen(true);
 }
 const change=(index:number,patch:Partial<ManualFinancialInput['values'][number]>)=>setRows(old=>old.map((row,i)=>i===index?{...row,...patch}:row));
 async function save(){
  const ok=await action.run(async()=>({version:current.current.version,reason,values:rows.filter((row,index)=>row.value_rub.trim()&&row.value_rub!==initial.current[index]?.value_rub).map(row=>({...row,month:row.kind==='debt_payment_rub'?null:row.month,value_rub:row.value_rub.replace(/\s/g,'').replace(',','.')}))}),receipt=>api.info!.correctFinancial!(application.id,request.id,receipt.body as ManualFinancialInput,receipt.key));
  if(ok){setRows([]);setReason('');setOpen(false);}
 }
 if(!available&&!request.staff_corrections?.length&&!action.error)return null;
 return <div className="manual-financial">
 {(request.staff_corrections??[]).map(correction=><div className="staff-correction" key={correction.id}><strong>Значения проверены сотрудником</strong><p>{correction.reason}</p><ul>{correction.values.map(value=><li key={value.kind+value.month}>{labels[value.kind]}{value.month?` · ${value.month}`:''}: {formatMoneyRub(value.value_rub)}</li>)}</ul><p className="small-note">{correction.actor_name??'Сотрудник банка'} · {new Date(correction.recorded_at).toLocaleString('ru-RU')}</p></div>)}
 {available&&<><button className="button secondary" type="button" aria-expanded={open||!!action.pending} disabled={action.busy} onClick={()=>open?setOpen(false):start()}>Скорректировать финансовые данные</button>
 {(open||action.pending)&&<section aria-label="Ручные финансовые данные"><p className="small-note">Укажите проверенные числа из ответа или документа клиента. Исходные сведения сохранятся. Изменения попадут в скоринг после нажатия «Сохранить и пересчитать».</p>
 {!action.pending&&<><div className="score-table-scroll"><table className="company-finance-table editable-finance"><caption>Финансовые данные за шесть месяцев</caption><thead><tr><th>Месяц</th><th>Поступления, ₽</th><th>Операционные расходы, ₽</th></tr></thead><tbody>
 {rows.filter(row=>row.kind==='income_rub').map(row=><tr key={row.month}><th scope="row">{new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(row.month+'-01T00:00:00Z'))}</th>{(['income_rub','expenses_rub'] as const).map(kind=>{const index=rows.findIndex(value=>value.month===row.month&&value.kind===kind);return <td key={kind}><input aria-label={`${labels[kind]} ${row.month}`} inputMode="decimal" value={rows[index].value_rub} placeholder="Нет сведений" onChange={e=>change(index,{value_rub:e.target.value})}/></td>;})}</tr>)}
 </tbody></table></div>
 {rows.map((row,index)=>row.kind==='debt_payment_rub'?<label key={row.kind} className="field"><span>Текущие платежи по долгам, ₽/мес.</span><input inputMode="decimal" aria-label="Текущие платежи по долгам" value={row.value_rub} onChange={e=>change(index,{value_rub:e.target.value})}/></label>:null)}
 <label className="field"><span>Основание ручного уточнения</span><textarea value={reason} maxLength={1000} onChange={e=>setReason(e.target.value)} placeholder="Документ и какие сведения вы проверили"/></label></>}
 <div className="info-actions"><button type="button" className="button primary" disabled={action.busy||action.error?.code==='INVALID_INFO_RECEIPT'||(!action.pending&&(!reason.trim()||!rows.some((row,index)=>row.value_rub.trim()&&row.value_rub!==initial.current[index]?.value_rub)))} onClick={()=>void save()}>{action.busy?'Сохраняем…':action.pending?'Повторить сохранение':'Сохранить и пересчитать'}</button>{!action.pending&&<button type="button" className="button secondary" onClick={()=>{setRows([]);setReason('');setOpen(false);}}>Отменить ввод</button>}</div>
 </section>}</>}
 {action.error&&<p role="alert" className="field-error">{action.error.message}</p>}
 </div>;
}
