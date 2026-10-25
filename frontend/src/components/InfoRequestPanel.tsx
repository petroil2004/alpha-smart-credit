import {useEffect,useRef,useState} from 'react';
import type {Api,Application,InfoRequest,InfoSubmit,Session} from '../types';
import type {InfoController} from './InfoRequests';
import {InfoQueue} from '../info-queue';
import {InfoReceipts,readUpload,writeUpload} from '../info-receipts';
import type {UploadReceipt} from '../info-receipts';
import {useInfoAction,infoError} from '../hooks/useInfoAction';
import ManualFinancial from "./DataCorrections";
import {ApiError} from '../api';
interface Props {api:Api;session:Session;application:Application;request:InfoRequest;guard:()=>Promise<void>;accept:(a:Application)=>void;register:(c:InfoController|null)=>void;}
const date=(value:string)=>new Intl.DateTimeFormat('ru-RU',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Moscow'}).format(new Date(value));
export default function InfoRequestPanel(props:Props){
 const {api,session,application,request}=props;const staff=!session.company;
 const callbacks=useRef(props);callbacks.current=props;
 const alive=useRef(true),[,tick]=useState(0),[error,setError]=useState<ApiError|null>(null),[message,setMessage]=useState('');
 const [manualControl,setManualControl]=useState<InfoController|null>(null);
 const [file,setFile]=useState<File|null>(null),[upload,setUpload]=useState<UploadReceipt|null>(null),[uploadBroken,setUploadBroken]=useState(false);
 const uploadRef=useRef(upload);uploadRef.current=upload;
 const [store]=useState(()=>new InfoReceipts(session.user.id,application.id,request.id));
 const [queue]=useState(()=>new InfoQueue(application,request.id,(a,text)=>api.info!.save(a.id,request.id,a.info_requests!.find(r=>r.id===request.id)!.revision,text),()=>callbacks.current.guard(),a=>callbacks.current.accept(a),()=>{if(alive.current)tick(n=>n+1);},e=>{if(alive.current)setError(infoError(e));}));
 const accept=(a:Application)=>{if(!alive.current)return;queue.accept(a);callbacks.current.accept(queue.get());tick(n=>n+1);};
 const submit=useInfoAction(store,'submit',()=>callbacks.current.guard(),accept);
 const chat=useInfoAction(store,'message',()=>callbacks.current.guard(),accept);
 const closing=useInfoAction(store,'close',()=>callbacks.current.guard(),accept);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;queue.dispose();};},[queue]);
 useEffect(()=>{queue.accept(application);tick(n=>n+1);},[application,queue]);
 useEffect(()=>{try{const value=readUpload(session.user.id,application.id,request.id);if(value&&request.attachments.some(a=>a.id===value.id)){writeUpload(session.user.id,application.id,request.id,null);setUpload(null);}else setUpload(value);}catch(e){setUploadBroken(true);setError(infoError(e));}},[]);
 const active=!request.closed_at&&application.status==='NEEDS_INFO';
 const frozen=submit.busy||!!submit.pending||closing.busy||!!closing.pending;
 const dirty=!!manualControl?.dirty||queue.dirty||!!file||!!upload||chat.busy||!!chat.pending||!!message.trim()||submit.busy||!!submit.pending||closing.busy||!!closing.pending;
 const flushRef=useRef<()=>Promise<boolean>>(async()=>true);
 flushRef.current=async()=>{const saved=staff?true:await queue.flush();const chatDone=await chat.wait();const submitDone=await submit.wait();await closing.wait();return saved&&chatDone&&submitDone&&(!manualControl||await manualControl.flush())&&!file&&!upload&&!message.trim();};
 const registerRef=useRef(props.register);registerRef.current=props.register;
 useEffect(()=>{registerRef.current({flush:()=>flushRef.current(),dirty});},[dirty]);
 useEffect(()=>()=>registerRef.current(null),[]);
 async function sendReply(){
  if(file){setError(new ApiError(422,'UPLOAD_PENDING','Сначала загрузите выбранный документ.'));return;}
  await submit.run(async()=>{
   if(!await queue.flush())throw new ApiError(0,'SAVE_PENDING','Не удалось сохранить все изменения. Повторите сохранение.');
   const item=queue.get(),r=item.info_requests!.find(x=>x.id===request.id)!;
   if(uploadRef.current)throw new ApiError(0,'UPLOAD_PENDING','Загрузка не подтверждена. Проверьте карточку или перевыберите файл.');
   if(!r.reply_text.trim()&&!r.attachments.some(a=>!a.message_id))throw new ApiError(422,'REPLY_REQUIRED','Напишите сообщение или прикрепите документ.');
   return {version:item.version,revision:r.revision};
  },receipt=>api.info!.submit(application.id,request.id,receipt.body as InfoSubmit,receipt.key));
 }
 async function closeRequest(){await closing.run(async()=>{const item=queue.get(),r=item.info_requests!.find(x=>x.id===request.id)!;return {version:item.version,revision:r.revision};},receipt=>api.info!.close!(application.id,request.id,receipt.body as InfoSubmit,receipt.key));}
 async function sendMessage(){
  const sent=message;
  const ok=await chat.run(async()=>({text:message}),receipt=>api.info!.message(application.id,request.id,staff,(receipt.body as {text:string}).text,receipt.key));
  if(ok&&alive.current)setMessage(value=>value===sent?'':value);
 }
 function chooseFile(value:File|null){
  if(!value){setFile(null);return;}
  if(!value.size||value.size>5_000_000||!(/\.(pdf|png|jpe?g)$/i.test(value.name))){setError(new ApiError(422,'FILE_INVALID','Выберите непустой PDF, PNG или JPG до 5 МБ.'));return;}
  if(upload&&(upload.name!==value.name||upload.size!==value.size||upload.type!==value.type)){setError(new ApiError(422,'FILE_MISMATCH','Для повтора выберите тот же файл, который указан в неподтверждённой загрузке.'));return;}
  setError(null);setFile(value);
 }
 function uploadFile(){
  if(!file||uploadBroken)return;
  const selected=file,receipt=upload??{id:crypto.randomUUID(),name:file.name,size:file.size,type:file.type};
  try{writeUpload(session.user.id,application.id,request.id,receipt);}catch(e){setError(infoError(e));return;}
  setUpload(receipt);setFile(null);setError(null);
  queue.enqueue(async item=>{
   let response:Application;
   try{response=await api.info!.upload(item.id,request.id,receipt.id,item.info_requests!.find(r=>r.id===request.id)!.revision,selected);}
   catch(e){const problem=infoError(e);if(problem.status>=400&&problem.status<500&&problem.status!==401&&alive.current){writeUpload(session.user.id,application.id,request.id,null);uploadRef.current=null;setUpload(null);if([413,415,422].includes(problem.status)){setError(problem);return item;}}throw e;}
   // Keep the closure and file until server acknowledgement, including a retry after timeout.
   await callbacks.current.guard();
   if(alive.current){writeUpload(session.user.id,application.id,request.id,null);uploadRef.current=null;setUpload(null);}
   return response;
  });
 }
 async function download(id:string,name:string){
  try{await callbacks.current.guard();const blob=await api.info!.download(application.id,request.id,id,staff);await callbacks.current.guard();if(!alive.current)return;
   const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(e){if(alive.current)setError(infoError(e));}
 }
 const pendingFiles=request.attachments.filter(a=>!a.message_id);
 const files=(list:typeof request.attachments)=><ul className="info-files">{list.map(a=><li key={a.id}><button className="text-button" type="button" onClick={()=>void download(a.id,a.filename)}>{a.filename}</button><span>{Math.ceil(a.size_bytes/1000)} КБ</span>{!staff&&active&&!a.message_id&&<button className="text-button" type="button" disabled={frozen} onClick={()=>queue.enqueue(item=>api.info!.detach(item.id,request.id,a.id,item.info_requests!.find(r=>r.id===request.id)!.revision))} aria-label={`Открепить ${a.filename}`}>Открепить</button>}</li>)}</ul>;
 const content=<>
  <p className="info-question">{request.question}</p>{request.reason&&<p>{request.reason}</p>}
  <p className="small-note">{date(request.created_at)} · {active?'Запрос открыт':'Запрос закрыт'}{request.document_required?' · Нужен документ':''}</p>
  <div className="info-chat"><h4>Переписка по запросу</h4>
   {staff&&!request.reply_submitted_at&&!request.closed_at&&!request.messages.some(m=>m.actor_role==='CLIENT')&&<p className="small-note">Клиент пока не добавил ответ.</p>}
   <ol className="info-messages">{request.messages.map(m=><li key={m.id}><strong>{m.actor_role==='STAFF'?'Сотрудник банка':'Клиент'}</strong><time dateTime={m.created_at}>{date(m.created_at)}</time><p>{m.text}</p>{files(request.attachments.filter(a=>a.message_id===m.id))}</li>)}</ol>
   {request.closed_at&&request.reply_text&&<div className="legacy-reply"><h4>{request.reply_submitted_at?'Неотправленный черновик':'Ответ клиента'}</h4><p className="info-text">{request.reply_text}</p>{files(pendingFiles)}</div>}
   {active&&!staff&&<>
    <label className="field"><textarea aria-label="Сообщение по запросу" placeholder={request.document_required?"Напишите ответ или вопрос сотруднику. Документы можно прикрепить ниже.":"Напишите ответ или вопрос сотруднику"} maxLength={2000} value={queue.text} disabled={frozen} onChange={e=>queue.setText(e.target.value)}/>{queue.dirty&&<small>Сохраняем…</small>}</label>
    {files(pendingFiles)}
    {request.document_required&&<div className="info-upload"><p className="small-note">PDF, PNG или JPG до 5 МБ. Не больше пяти файлов. Используйте только синтетические документы.</p>
     {upload&&<p role="status">Загрузка «{upload.name}» ещё не подтверждена. Выберите тот же файл для повтора.</p>}
     <label className="field"><span>Прикрепить документ</span><input type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" disabled={frozen||uploadBroken||request.attachments.length>=5} onChange={e=>chooseFile(e.target.files?.[0]??null)}/></label>
     {file&&<p className="small-note">Выбран: {file.name}. Загрузите его перед отправкой.</p>}
     <button type="button" className="button secondary" disabled={!file||frozen||uploadBroken} onClick={uploadFile}>Загрузить документ</button>
    </div>}
   </>}
   {active&&staff&&<label className="field"><textarea aria-label="Сообщение по запросу" placeholder="Напишите клиенту уточнение по документам или сведениям" maxLength={1000} value={message} disabled={chat.busy||!!chat.pending||frozen} onChange={e=>setMessage(e.target.value)}/></label>}
   {(active||submit.pending||chat.pending)&&<div className="info-actions">
    {!staff?<button type="button" className="button primary" disabled={submit.busy||!!file||!!upload||submit.error?.code==='INVALID_INFO_RECEIPT'||(!submit.pending&&!queue.text.trim()&&!pendingFiles.length)} onClick={()=>void sendReply()}>{submit.busy?'Отправляем…':submit.pending?'Проверить отправку ответа':'Отправить ответ'}</button>:<button className="button secondary" type="button" disabled={chat.busy||frozen||(!chat.pending&&!message.trim())} onClick={()=>void sendMessage()}>{chat.busy?'Отправляем…':chat.pending?'Проверить сообщение':'Отправить сообщение'}</button>}
   </div>}
  </div>
  <ManualFinancial api={api} application={application} request={request} session={session} guard={()=>callbacks.current.guard()} accept={accept} register={setManualControl}/>
  {staff&&(active||closing.pending)&&api.info?.close&&<div className="info-actions"><button className="button primary" type="button" disabled={closing.busy||!!message.trim()||!request.reply_submitted_at||!!manualControl?.dirty} onClick={()=>void closeRequest()}>{closing.busy?'Закрываем…':closing.pending?'Проверить закрытие':'Завершить уточнение'}</button><p className="small-note">После завершения переписка станет доступна только для чтения, а заявка вернётся на рассмотрение.</p></div>}
  {(error||submit.error||chat.error||closing.error)&&<p role="alert" className="field-error">{(error??submit.error??chat.error??closing.error)!.message}</p>}
  {!staff&&active&&error&&<button className="button secondary" type="button" onClick={()=>{setError(null);void queue.retry();}}>Повторить сохранение</button>}
 </>;
 return active||submit.pending||chat.pending||closing.pending?<section className="form-card info-card"><h3>Уточнение сведений</h3>{content}</section>:<details className="company-disclosure info-closed"><summary>Завершённый запрос · {date(request.closed_at??request.created_at)}</summary>{content}</details>;
}
