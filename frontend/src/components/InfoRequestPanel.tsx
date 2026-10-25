import {useEffect,useRef,useState} from 'react';
import type {Api,Application,FinancialValue,InfoRequest,InfoSubmit,Session} from '../types';
import type {InfoController} from './InfoRequests';
import {InfoQueue} from '../info-queue';
import {InfoReceipts,readUpload,writeUpload} from '../info-receipts';
import type {UploadReceipt} from '../info-receipts';
import {useInfoAction,infoError} from '../hooks/useInfoAction';
import {ApiError} from '../api';
interface Props {api:Api;session:Session;application:Application;request:InfoRequest;guard:()=>Promise<void>;accept:(a:Application)=>void;register:(c:InfoController|null)=>void;}
const date=(value:string)=>new Intl.DateTimeFormat('ru-RU',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Moscow'}).format(new Date(value));
export default function InfoRequestPanel(props:Props){
 const {api,session,application,request}=props;const staff=!session.company;
 const callbacks=useRef(props);callbacks.current=props;
 const alive=useRef(true),[,tick]=useState(0),[error,setError]=useState<ApiError|null>(null),[message,setMessage]=useState('');
 const [financialKind,setFinancialKind]=useState<FinancialValue['kind']>('expenses_rub'),[financialMonth,setFinancialMonth]=useState(''),[financialValue,setFinancialValue]=useState('');
 const [file,setFile]=useState<File|null>(null),[upload,setUpload]=useState<UploadReceipt|null>(null),[uploadBroken,setUploadBroken]=useState(false);
 const uploadRef=useRef(upload);uploadRef.current=upload;
 const [store]=useState(()=>new InfoReceipts(session.user.id,application.id,request.id));
 const [queue]=useState(()=>new InfoQueue(application,request.id,(a,text)=>api.info!.save(a.id,request.id,a.info_requests!.find(r=>r.id===request.id)!.revision,text),()=>callbacks.current.guard(),a=>callbacks.current.accept(a),()=>{if(alive.current)tick(n=>n+1);},e=>{if(alive.current)setError(infoError(e));}));
 const accept=(a:Application)=>{if(!alive.current)return;queue.accept(a);callbacks.current.accept(queue.get());tick(n=>n+1);};
 const submit=useInfoAction(store,'submit',()=>callbacks.current.guard(),accept);
 const chat=useInfoAction(store,'message',()=>callbacks.current.guard(),accept);
 const financial=useInfoAction(store,'accept-financial',()=>callbacks.current.guard(),accept);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;queue.dispose();};},[queue]);
 useEffect(()=>{queue.accept(application);tick(n=>n+1);},[application,queue]);
 useEffect(()=>{try{const value=readUpload(session.user.id,application.id,request.id);if(value&&request.attachments.some(a=>a.id===value.id)){writeUpload(session.user.id,application.id,request.id,null);setUpload(null);}else setUpload(value);}catch(e){setUploadBroken(true);setError(infoError(e));}},[]);
 const active=!request.closed_at&&application.status==='NEEDS_INFO';
 const frozen=submit.busy||!!submit.pending;
 const dirty=queue.dirty||!!file||!!upload||chat.busy||!!chat.pending||!!message.trim()||submit.busy||!!submit.pending;
 const flushRef=useRef<()=>Promise<boolean>>(async()=>true);
 flushRef.current=async()=>{const saved=staff?true:await queue.flush();const chatDone=await chat.wait();const submitDone=await submit.wait();return saved&&chatDone&&submitDone&&!file&&!upload&&!message.trim();};
 const registerRef=useRef(props.register);registerRef.current=props.register;
 useEffect(()=>{registerRef.current({flush:()=>flushRef.current(),dirty});},[dirty]);
 useEffect(()=>()=>registerRef.current(null),[]);
 async function sendReply(){
  if(file){setError(new ApiError(422,'UPLOAD_PENDING','Сначала загрузите выбранный документ.'));return;}
  await submit.run(async()=>{
   if(!await queue.flush())throw new ApiError(0,'SAVE_PENDING','Не удалось сохранить все изменения. Повторите сохранение.');
   const item=queue.get(),r=item.info_requests!.find(x=>x.id===request.id)!;
   if(uploadRef.current)throw new ApiError(0,'UPLOAD_PENDING','Загрузка не подтверждена. Проверьте карточку или перевыберите файл.');
   if(!r.reply_text.trim())throw new ApiError(422,'REPLY_REQUIRED','Напишите ответ на запрос.');
   if(r.document_required&&!r.attachments.length)throw new ApiError(422,'DOCUMENT_REQUIRED','Загрузите запрошенный документ.');
   if(r.financial_required&&(!financialValue.trim()||(financialKind!=='debt_payment_rub'&&!financialMonth)))throw new ApiError(422,'FINANCIAL_REQUIRED','Добавьте финансовое значение и его месяц.');
   return {version:item.version,revision:r.revision,financial_values:r.financial_required?[{kind:financialKind,month:financialKind==='debt_payment_rub'?null:financialMonth,value_rub:financialValue.trim(),source:'CLIENT_CONFIRMED'}]:[]};
  },receipt=>api.info!.submit(application.id,request.id,receipt.body as InfoSubmit,receipt.key));
 }
 async function acceptFinancial(){await financial.run(async()=>({}),receipt=>api.info!.acceptFinancial(application.id,request.id,receipt.key));}
 async function sendMessage(){
  const sent=message;
  const ok=await chat.run(async()=>({text:message}),receipt=>api.info!.message(application.id,request.id,staff,(receipt.body as {text:string}).text,receipt.key));
  if(ok&&alive.current)setMessage(value=>value===sent?'':value);
 }
 function chooseFile(value:File|null){
  if(!value){setFile(null);return;}
  if(!value.size||value.size>5242880||!(/\.(pdf|txt)$/i.test(value.name))){setError(new ApiError(422,'FILE_INVALID','Выберите непустой PDF или TXT до 5 МиБ.'));return;}
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
 const content=<>
  <p className="info-question">{request.question}</p><p><strong>Зачем нужны сведения:</strong> {request.reason}</p>
  <p className="small-note">{date(request.created_at)} · {request.document_required?'Нужен текстовый ответ и документ':'Нужен текстовый ответ'} · {active?'Запрос открыт':'Ответ отправлен'}</p>
  <div className="info-reply"><h4>Ответ клиента</h4><p className="small-note">Со слов клиента. Эти сведения ещё не проверены банком.</p>
   {!staff&&active?<label className="field"><span>Ответ на запрос</span><textarea aria-label="Ответ на запрос" maxLength={2000} value={queue.text} disabled={frozen} onChange={e=>queue.setText(e.target.value)}/><small>{queue.dirty?'Сохраняем изменения…':'Изменения сохранены'}</small></label>:<p className="info-text">{request.reply_text||'Клиент пока не добавил ответ.'}</p>}
   {staff&&active&&<p className="small-note">Черновик ответа. Клиент ещё не отправил его на рассмотрение.</p>}
   {!staff&&active&&request.financial_required&&<div className="financial-reply"><h4>Уточнение финансовых показателей</h4><p className="small-note">Укажите показатель, месяц и сумму из документа. Сотрудник проверит число и подтвердит его для перерасчёта. Сам файл автоматически не распознаётся.</p><label className="field"><span>Показатель</span><select value={financialKind} onChange={e=>setFinancialKind(e.target.value as FinancialValue['kind'])}><option value="expenses_rub">Операционные расходы</option><option value="income_rub">Поступления</option><option value="debt_payment_rub">Платёж по действующим долгам</option></select></label>{financialKind!=='debt_payment_rub'&&<label className="field"><span>Месяц</span><select value={financialMonth} onChange={e=>setFinancialMonth(e.target.value)}><option value="">Выберите месяц</option>{application.submission?.snapshot.company.finance?.months.map(row=><option key={row.month} value={row.month}>{row.month}</option>)}</select></label>}<label className="field"><span>Сумма, ₽</span><input inputMode="decimal" value={financialValue} onChange={e=>setFinancialValue(e.target.value)} placeholder="Например, 570000.00"/></label></div>}
   {staff&&!active&&request.financial_values?.length&&<div className="financial-reply"><h4>Уточнение финансовых показателей</h4><ul>{request.financial_values.map((value,index)=><li key={index}>{value.kind} {value.month??'текущий'}: {value.value_rub} ₽ ({value.source==='CLIENT_DOCUMENT'?'документ':'клиент'})</li>)}</ul>{request.financial_accepted_at?<p className="small-note">Сотрудник принял эти значения для расчёта.</p>:<button className="button secondary" disabled={financial.busy} type="button" onClick={()=>void acceptFinancial()}>{financial.busy?'Принимаем…':'Принять для расчёта'}</button>}</div>}
   <h4>Документы</h4>
   {!request.attachments.length&&<p className="small-note">Документы пока не прикреплены.</p>}
   <ul className="info-files">{request.attachments.map(a=><li key={a.id}><button className="text-button" type="button" onClick={()=>void download(a.id,a.filename)}>{a.filename}</button><span>{Math.ceil(a.size_bytes/1024)} КБ</span>{!staff&&active&&<button className="text-button" type="button" disabled={frozen} onClick={()=>queue.enqueue(item=>api.info!.detach(item.id,request.id,a.id,item.info_requests!.find(r=>r.id===request.id)!.revision))} aria-label={`Открепить ${a.filename}`}>Открепить</button>}</li>)}</ul>
   {!staff&&active&&<div className="info-upload"><p className="small-note">Только синтетические PDF/TXT до 5 МиБ. Не больше пяти файлов.</p>
    {upload&&<p role="status">Загрузка «{upload.name}» ещё не подтверждена. После перезагрузки проверьте карточку или выберите тот же файл для повтора.</p>}
    <label className="field"><span>Документ PDF или TXT</span><input type="file" accept=".pdf,.txt,application/pdf,text/plain" disabled={frozen||uploadBroken||request.attachments.length>=5} onChange={e=>chooseFile(e.target.files?.[0]??null)}/></label>
    {file&&<p className="small-note">Выбран: {file.name}. Файл ещё не загружен.</p>}
    <button type="button" className="button secondary" disabled={!file||frozen||uploadBroken} onClick={uploadFile}>Загрузить документ</button>
   </div>}
  </div>
  <div className="info-chat"><h4>Переписка по запросу</h4><p className="small-note">Сообщения не отправляют ответ на рассмотрение.</p>
   <ol className="info-messages">{request.messages.map(m=><li key={m.id}><strong>{m.actor_role==='STAFF'?'Сотрудник банка':'Клиент'}</strong><time dateTime={m.created_at}>{date(m.created_at)}</time><p>{m.text}</p></li>)}</ol>
   {(active||chat.pending)&&<><label className="field"><span>Сообщение по запросу</span><textarea maxLength={1000} value={message} disabled={!active||chat.busy||!!chat.pending} onChange={e=>setMessage(e.target.value)}/></label>
    {chat.pending&&<p role="status">Исход сообщения не подтверждён. Повтор отправит тот же текст.</p>}
    <button className="button secondary" type="button" disabled={chat.busy||(!chat.pending&&!message.trim())||chat.error?.code==='INVALID_INFO_RECEIPT'} onClick={()=>void sendMessage()}>{chat.busy?'Отправляем…':chat.pending?'Проверить сообщение':'Отправить сообщение'}</button></>}
  </div>
  {(error||submit.error||chat.error)&&<div role="alert" className="notice error-notice"><div><p>{(error??submit.error??chat.error)!.message}</p>
   {(error??submit.error??chat.error)?.status===401&&<button className="text-button" type="button" onClick={()=>{void (async()=>{try{await api.login(session.user.id);await callbacks.current.guard();if(alive.current){setError(null);await queue.retry();}}catch(e){if(alive.current)setError(infoError(e));}})();}}>Войти снова</button>}
   {!staff&&active&&error&&<button className="text-button" type="button" onClick={()=>{setError(null);void queue.retry();}}>Повторить сохранение</button>}
  </div></div>}
  {!staff&&(active||submit.pending)&&<div className="info-actions"><button type="button" className="button primary" disabled={submit.busy||submit.error?.code==='INVALID_INFO_RECEIPT'||(!submit.pending&&(!queue.text.trim()||(request.financial_required&&(!financialValue.trim()||(financialKind!=='debt_payment_rub'&&!financialMonth)))))} onClick={()=>void sendReply()}>{submit.busy?'Отправляем…':submit.pending?'Проверить отправку ответа':'Отправить ответ'}</button><p className="small-note">Только эта кнопка завершит запрос и вернёт заявку сотруднику.</p></div>}
 </>;
 return active||submit.pending||chat.pending?<section className="form-card info-card"><h3>{!active?(submit.pending?'Проверьте отправку ответа':'Проверьте отправку сообщения'):staff?'Ждём ответ клиента':'Банк запросил сведения'}</h3>{content}</section>:<details className="form-card info-card"><summary>Завершённый запрос · {date(request.closed_at??request.created_at)}</summary>{content}</details>;
}
