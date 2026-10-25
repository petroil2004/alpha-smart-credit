import {useEffect,useRef,useState} from 'react';
import type {ComponentProps} from 'react';
import type {CompanyDetails,ProfileCorrectionInput} from '../types';
import ManualFinancial from './ManualFinancial';
import {InfoReceipts} from '../info-receipts';
import {useInfoAction} from '../hooks/useInfoAction';
import type {InfoController} from './InfoRequests';
type Props=ComponentProps<typeof ManualFinancial>;
export default function DataCorrections(props:Props){
 const [pendingKind]=useState(()=>{const store=new InfoReceipts(props.session.user.id,props.application.id,props.request.id);for(const [action,kind] of [['staff-financial-correction','finance'],['staff-profile-correction','profile']] as const){try{if(store.read(action))return kind;}catch{return kind;}}return '';});
 const [open,setOpen]=useState(!!pendingKind),[kind,setKind]=useState<string>(pendingKind),[child,setChild]=useState<InfoController|null>(null);
 const latest=useRef(child);latest.current=child;
 useEffect(()=>{props.register({dirty:!!child?.dirty,flush:async()=>!latest.current||await latest.current.flush()});return()=>props.register(null);},[child,props.register]);
 const available=!props.session.company&&['NEEDS_INFO','UNDER_REVIEW'].includes(props.application.status)&&!!(props.request.reply_submitted_at||props.request.closed_at);
 if(!available)return <><ManualFinancial {...props}/><ProfileAudit {...props}/></>;
 return <div className="manual-financial"><button type="button" className="button secondary" disabled={!!child?.dirty} aria-expanded={open} onClick={()=>{setOpen(!open);setKind('');}}>Скорректировать данные</button>
 {open&&<><label className="field data-correction-selector"><span>Что корректируем</span><select aria-label="Что корректируем" value={kind} disabled={!!child?.dirty} onChange={e=>setKind(e.target.value)}><option value="">Выберите раздел</option><option value="finance">Финансовые данные</option><option value="profile">Профиль компании</option></select></label>
 {kind==='finance'&&<ManualFinancial {...props} embedded onDone={()=>setKind('')} register={setChild}/>}
 {kind==='profile'&&<ProfileEditor {...props} onDone={()=>setKind('')} register={setChild}/>}
 </>}
 <ProfileAudit {...props}/>
 </div>;
}
function ProfileAudit({request}:Props){return request.profile_corrections?.length?<details className="company-disclosure"><summary>Изменения профиля компании</summary>{request.profile_corrections.map(c=><div key={c.id}><p>{c.reason}</p><p className="small-note">{c.actor_name} · {new Date(c.recorded_at).toLocaleString('ru-RU')}</p></div>)}</details>:null;}
const labels={legal_form:'Организационная форма',tax_id:'ИНН',okved:'ОКВЭД',registration_date:'Дата регистрации бизнеса',registration_status:'Статус регистрации бизнеса',is_bank_client:'Клиент банка'};
type Key=keyof typeof labels;
function ProfileEditor(props:Props&{onDone:()=>void}){
 const details=props.application.verified_company?.details??props.application.submission?.snapshot.company.details;
 const values=()=>Object.fromEntries((Object.keys(labels) as Key[]).map(key=>[key,key==='is_bank_client'?(details?.[key]===null||details?.[key]===undefined?'':details[key]?'yes':'no'):details?.[key]??''])) as Record<Key,string>;
 const [initial]=useState(values),[fields,setFields]=useState(values),[reason,setReason]=useState('');
 const [store]=useState(()=>new InfoReceipts(props.session.user.id,props.application.id,props.request.id));
 const action=useInfoAction(store,'staff-profile-correction',props.guard,props.accept);
 const dirty=reason.trim()!==''||JSON.stringify(fields)!==JSON.stringify(initial)||action.busy||!!action.pending;
 const control=useRef({dirty,wait:action.wait});control.current={dirty,wait:action.wait};
 useEffect(()=>{props.register({dirty,flush:async()=>{await control.current.wait();return !control.current.dirty;}});return()=>props.register(null);},[dirty,props.register]);
 const changed=(Object.keys(labels) as Key[]).filter(key=>fields[key]!==initial[key]);
 const asOf=props.application.verified_company?.as_of_date??props.application.submission?.snapshot.company.as_of_date??props.application.submitted_at?.slice(0,10)??new Date().toISOString().slice(0,10);
 let invalid='';
 if(changed.includes('tax_id')||changed.includes('legal_form')){
  const length=fields.legal_form==='IP'?12:10;
  if(!fields.legal_form||!new RegExp('^\\d{'+length+'}$').test(fields.tax_id))invalid=`ИНН должен содержать ${length} цифр и соответствовать организационной форме.`;
 }
 if(changed.includes('okved')&&!/^\d{2}(?:\.\d{1,2}){0,2}$/.test(fields.okved))invalid='Укажите корректный ОКВЭД, например 47.11.';
 if(changed.includes('registration_date')&&(!/^\d{4}-\d{2}-\d{2}$/.test(fields.registration_date)||fields.registration_date>asOf))invalid='Дата регистрации не может быть позже даты сведений заявки.';
 if(changed.some(key=>!fields[key]))invalid='Изменённые поля не должны быть пустыми.';
 async function save(){
  const details=Object.fromEntries(changed.map(key=>[key,key==='is_bank_client'?fields[key]==='yes':fields[key]])) as Partial<CompanyDetails>;
  if(await action.run(async()=>({version:props.application.version,reason,details}),receipt=>props.api.info!.correctProfile!(props.application.id,props.request.id,receipt.body as ProfileCorrectionInput,receipt.key)))props.onDone();
 }
 return <section aria-label="Корректировка профиля компании">
 <p className="small-note">Укажите проверенные сведения для этой заявки. Возраст бизнеса и скоринг пересчитаются после сохранения.</p>
 {!action.pending&&<><div className="field-grid">{(Object.keys(labels) as Key[]).map(key=><label className="field" key={key}><span>{labels[key]}</span>
 {key==='legal_form'||key==='registration_status'||key==='is_bank_client'?<select aria-label={labels[key]} value={fields[key]} onChange={e=>setFields(old=>({...old,[key]:e.target.value}))}><option value="">Нет сведений</option>{(key==='legal_form'?[['OOO','ООО'],['IP','ИП']]:key==='registration_status'?[['ACTIVE','Действует'],['TERMINATED','Деятельность прекращена']]:[['yes','Да'],['no','Нет']]).map(([value,title])=><option key={value} value={value}>{title}</option>)}</select>:<input aria-label={labels[key]} type={key==='registration_date'?'date':'text'} max={key==='registration_date'?asOf:undefined} maxLength={key==='tax_id'?12:key==='okved'?8:10} inputMode={key==='tax_id'?'numeric':undefined} value={fields[key]} onChange={e=>{let value=e.target.value;if(key==='registration_date'&&value.split('-')[0].length>4)value=value.split('-')[0].slice(0,4)+value.slice(value.indexOf('-'));setFields(old=>({...old,[key]:value}));}}/>}
 </label>)}</div>
 <label className="field"><span>Основание корректировки профиля</span><textarea aria-label="Основание корректировки профиля" maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Какие сведения и по какому документу проверены"/></label></>}
 {invalid&&<p className="field-error">{invalid}</p>}
 <div className="info-actions"><button type="button" className="button primary" disabled={action.busy||(!action.pending&&(!reason.trim()||!changed.length||!!invalid))} onClick={()=>void save()}>{action.busy?'Сохраняем…':action.pending?'Повторить сохранение':'Сохранить и пересчитать'}</button>{!action.pending&&<button type="button" className="button secondary" onClick={props.onDone}>Отменить ввод</button>}</div>
 {action.error&&<p role="alert" className="field-error">{action.error.message}</p>}
 </section>;
}
