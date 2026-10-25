import {useEffect,useRef,useState} from 'react';
import type {Api,Application,InfoRequest,Session,ManualFinancialInput} from '../types';
import type {InfoController} from './InfoRequests';
import {InfoReceipts} from '../info-receipts';
import {useInfoAction} from '../hooks/useInfoAction';
import {formatMoneyRub} from '../draft';
const labels={income_rub:'Поступления',expenses_rub:'Операционные расходы',debt_payment_rub:'Платёж по действующим долгам'};
const blank=():ManualFinancialInput['values'][number]=>({kind:'expenses_rub',month:null,value_rub:''});
export default function ManualFinancial({api,application,request,session,guard,accept,register}:{api:Api;application:Application;request:InfoRequest;session:Session;guard:()=>Promise<void>;accept:(value:Application)=>void;register:(control:InfoController|null)=>void}) {
 const [open,setOpen]=useState(false),[reason,setReason]=useState(''),[rows,setRows]=useState([blank()]);
 const [store]=useState(()=>new InfoReceipts(session.user.id,application.id,request.id));
 const action=useInfoAction(store,'staff-financial-correction',guard,accept);
 const current=useRef(application);current.current=application;
 const dirty=!!reason.trim()||rows.some(row=>!!row.value_rub.trim()||!!row.month)||action.busy||!!action.pending;
 const control=useRef({dirty,wait:action.wait});control.current={dirty,wait:action.wait};
 useEffect(()=>{register({dirty,flush:async()=>{await control.current.wait();return !control.current.dirty;}});return()=>register(null);},[dirty,register]);
 const available=!session.company&&application.status==='UNDER_REVIEW'&&!!request.closed_at&&!!api.info?.correctFinancial;
 const change=(index:number,patch:Partial<ManualFinancialInput['values'][number]>)=>setRows(old=>old.map((row,i)=>i===index?{...row,...patch}:row));
 async function save(){
  const ok=await action.run(async()=>({version:current.current.version,reason,values:rows.map(row=>({...row,month:row.kind==='debt_payment_rub'?null:row.month,value_rub:row.value_rub.replace(/\s/g,'').replace(',','.')}))}),receipt=>api.info!.correctFinancial!(application.id,request.id,receipt.body as ManualFinancialInput,receipt.key));
  if(ok){setRows([blank()]);setReason('');setOpen(false);}
 }
 if(!available&&!request.staff_corrections?.length&&!action.error)return null;
 return <div className="manual-financial">
 {(request.staff_corrections??[]).map(correction=><div className="staff-correction" key={correction.id}><strong>Значения проверены сотрудником</strong><p>{correction.reason}</p><ul>{correction.values.map(value=><li key={value.kind+value.month}>{labels[value.kind]}{value.month?` · ${value.month}`:''}: {formatMoneyRub(value.value_rub)}</li>)}</ul><p className="small-note">{correction.actor_name??'Сотрудник банка'} · {new Date(correction.recorded_at).toLocaleString('ru-RU')}</p></div>)}
 {available&&<><button className="button secondary" type="button" aria-expanded={open||!!action.pending} disabled={action.busy} onClick={()=>setOpen(value=>!value)}>Внести данные вручную</button>
 {(open||action.pending)&&<section aria-label="Ручные финансовые данные"><p className="small-note">Укажите проверенные числа из ответа или документа клиента. Исходные сведения сохранятся. Изменения попадут в скоринг после нажатия «Сохранить и пересчитать».</p>
 {!action.pending&&<>{rows.map((row,index)=><div className="manual-financial-row" key={index}><label className="field"><span>Показатель {index+1}</span><select value={row.kind} onChange={e=>change(index,{kind:e.target.value as typeof row.kind,month:null})}>{Object.entries(labels).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label>
 {row.kind!=='debt_payment_rub'&&<label className="field"><span>Месяц {index+1}</span><select value={row.month??''} onChange={e=>change(index,{month:e.target.value||null})}><option value="">Выберите месяц</option>{application.submission?.snapshot.company.finance?.months.map(month=><option key={month.month} value={month.month}>{month.month}</option>)}</select></label>}
 <label className="field"><span>Сумма, ₽ {index+1}</span><input inputMode="decimal" value={row.value_rub} onChange={e=>change(index,{value_rub:e.target.value})}/></label>{rows.length>1&&<button className="text-button" type="button" onClick={()=>setRows(old=>old.filter((_,i)=>i!==index))}>Убрать показатель {index+1}</button>}</div>)}
 <button className="text-button" type="button" disabled={rows.length>=13} onClick={()=>setRows(old=>[...old,blank()])}>Добавить показатель</button>
 <label className="field"><span>Основание ручного уточнения</span><textarea value={reason} maxLength={1000} onChange={e=>setReason(e.target.value)} placeholder="Документ и какие сведения вы проверили"/></label></>}
 <div className="info-actions"><button type="button" className="button primary" disabled={action.busy||action.error?.code==='INVALID_INFO_RECEIPT'||(!action.pending&&(!reason.trim()||rows.some(row=>!row.value_rub.trim()||(row.kind!=='debt_payment_rub'&&!row.month))))} onClick={()=>void save()}>{action.busy?'Сохраняем…':action.pending?'Повторить сохранение':'Сохранить и пересчитать'}</button>{!action.pending&&<button type="button" className="button secondary" onClick={()=>{setRows([blank()]);setReason('');setOpen(false);}}>Отменить ввод</button>}</div>
 </section>}</>}
 {action.error&&<p role="alert" className="field-error">{action.error.message}</p>}
 </div>;
}
