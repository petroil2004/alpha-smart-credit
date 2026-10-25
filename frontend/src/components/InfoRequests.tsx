import {useEffect,useMemo,useRef,useState} from 'react';
import type {Api,Application,InfoCreate,Session} from '../types';
import {ApiError} from '../api';
import {sameSession} from '../session';
import {InfoReceipts,readUpload,writeUpload} from '../info-receipts';
import {useInfoAction,infoError} from '../hooks/useInfoAction';
import {mergeInfoApplication} from '../info-queue';
import InfoRequestPanel from './InfoRequestPanel';
export interface InfoController {flush:()=>Promise<boolean>;dirty:boolean;}
interface Props {api:Api;session:Session;application:Application;onUpdated:(a:Application)=>void;onSessionChanged:()=>void;register?:(controller:InfoController|null)=>void;}
export default function InfoRequests(props:Props){
 if(!props.api.info)return null;
 return <InfoWorkspace key={props.session.user.id+':'+props.application.id} {...props}/>;
}
function InfoWorkspace({api,session,application,onUpdated,onSessionChanged,register}:Props){
 const [current,setCurrent]=useState(application),[reset,setReset]=useState(0),[error,setError]=useState<ApiError|null>(null);
 const [question,setQuestion]=useState(''),[required,setRequired]=useState(false);
 const alive=useRef(true),latest=useRef(current),callbacks=useRef({onUpdated,onSessionChanged});callbacks.current={onUpdated,onSessionChanged};
 const children=useRef(new Map<string,InfoController>()),[dirtyChildren,setDirtyChildren]=useState(false);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{setCurrent(old=>mergeInfoApplication(old,application));},[application]);latest.current=current;
 const guard=async()=>{const actual=await api.me();if(!sameSession(session,actual)){if(alive.current)callbacks.current.onSessionChanged();throw new ApiError(401,'SESSION_CHANGED','Профиль изменился. Войдите заново.');}if(!alive.current)throw new Error('Disposed');};
 const accept=(value:Application)=>{
  if(!alive.current)return;
  if(value.id!==application.id||(session.company&&value.company_id!==session.company.id))throw new ApiError(502,'INVALID_RESPONSE','Сервис вернул другую заявку. Обновите карточку.');
  const result=mergeInfoApplication(latest.current,value);latest.current=result;setCurrent(result);callbacks.current.onUpdated(result);
 };
 const store=useMemo(()=>new InfoReceipts(session.user.id,application.id,'new'),[session.user.id,application.id]);
 const action=useInfoAction(store,'create',guard,accept);
 const open=current.info_requests?.find(r=>!r.closed_at);
 const dirty=dirtyChildren||action.busy||!!action.pending||!!question.trim();
 const flush=async()=>{const values=await Promise.all([...children.current.values()].map(c=>c.flush()));return values.every(Boolean)&&!action.pending&&!question.trim()&&!action.busy;};
 const controlRef=useRef({flush,dirty});controlRef.current={flush,dirty};
 useEffect(()=>{register?.({flush:()=>controlRef.current.flush(),dirty});return()=>register?.(null);},[register,dirty]);
 const childRegistration=(id:string,controller:InfoController|null)=>{if(controller)children.current.set(id,controller);else children.current.delete(id);const next=[...children.current.values()].some(c=>c.dirty);setDirtyChildren(previous=>previous===next?previous:next);};
 async function refresh(){
  if(dirty&&!window.confirm('Обновить карточку? Несохранённый ввод будет заменён данными сервера.'))return;
  try{
   await guard();const value=await (session.company?api.get(application.id):api.staffGet(application.id));await guard();
   // Only corrupt receipts are discarded, and only after this authorised read.
   for(const rid of ['new',...(value.info_requests??[]).map(r=>r.id)])for(const kind of ['create','submit','message','accept-financial','staff-financial-correction','staff-profile-correction','close'] as const){const receipts=new InfoReceipts(session.user.id,application.id,rid);try{receipts.read(kind);}catch(e){if(infoError(e).code==='INVALID_INFO_RECEIPT')receipts.clear(kind);else throw e;}}
   for(const r of value.info_requests??[]){try{readUpload(session.user.id,application.id,r.id);}catch(e){if(infoError(e).code==='INVALID_INFO_RECEIPT')writeUpload(session.user.id,application.id,r.id,null);else throw e;}}
   action.reload();latest.current=value;setCurrent(value);callbacks.current.onUpdated(value);setQuestion('');setError(null);setReset(n=>n+1);
  }catch(e){if(alive.current)setError(infoError(e));}
 }
 async function create(){const ok=await action.run(async()=>({version:latest.current.version,question,reason:"",document_required:required}),receipt=>api.info!.create(application.id,receipt.body as InfoCreate,receipt.key));if(ok&&alive.current){setQuestion('');setRequired(false);}}
 return <section className="info-workspace" aria-label="Уточнения по заявке">
  <div className="list-heading"><h2>Уточнения по заявке</h2><button type="button" className="text-button" onClick={()=>void refresh()}>Обновить карточку</button></div>
  {(error||action.error)&&<div role="alert" className="notice error-notice">{(error??action.error)!.message}{(error??action.error)!.status===401&&<button type="button" className="text-button" onClick={()=>{void api.login(session.user.id).then(()=>guard()).then(()=>setError(null)).catch(e=>setError(infoError(e)));}}>Войти снова</button>}</div>}
  <InfoNewRequest key={reset} visible={!session.company&&(!open&&current.status==='UNDER_REVIEW'||!!action.pending)} pending={!!action.pending} broken={action.error?.code==='INVALID_INFO_RECEIPT'} busy={action.busy} question={question} required={required} setQuestion={setQuestion} setRequired={setRequired} onCreate={()=>void create()}/>
  {current.info_requests?.map(request=><InfoRequestPanel key={reset+':'+request.id} api={api} session={session} application={current} request={request} guard={guard} accept={accept} register={controller=>childRegistration(request.id,controller)}/>)}
  {!current.info_requests?.length&&<p className="small-note">{session.company?'Здесь появится запрос сотрудника, если понадобятся дополнительные сведения.':'Уточнений по заявке пока не было.'}</p>}
 </section>;
}
function InfoNewRequest({visible,pending,broken,busy,question,required,setQuestion,setRequired,onCreate}:{visible:boolean;pending:boolean;broken:boolean;busy:boolean;question:string;required:boolean;setQuestion:(v:string)=>void;setRequired:(v:boolean)=>void;onCreate:()=>void;}){
 if(!visible)return null;
 return <section className="form-card info-card"><h3>Запросить сведения у клиента</h3><p>Объясните, какие сведения нужны и зачем. Клиент ответит в этой заявке.</p>
 {pending?<p role="status">Исход прошлого запроса не подтверждён. Повтор использует те же текст и ключ.</p>:<>
 <label className="field"><textarea aria-label="Запрос сведений" maxLength={2000} value={question} placeholder="Например, приложите выписку за сентябрь, чтобы подтвердить поступления и расходы." onChange={e=>setQuestion(e.target.value)} disabled={busy}/></label>
 <label className="info-checkbox"><input type="checkbox" checked={required} onChange={e=>setRequired(e.target.checked)} disabled={busy}/><span>Нужен документ</span></label></>}
 <button className="button primary" type="button" disabled={busy||broken||(!pending&&!question.trim())} onClick={onCreate}>{busy?'Отправляем…':pending?'Проверить запрос':'Запросить сведения'}</button>
 </section>;
}
