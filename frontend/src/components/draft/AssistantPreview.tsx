import {useEffect,useId,useRef,useState} from 'react';
import type {Api,AssistantMessage,AssistantReply,ClientSession,ProductCode} from '../../types';
import {sameSession} from '../../session';
import {products} from '../../products';

type Props={open:boolean;onToggle:()=>void;api:Api;session:ClientSession;applicationId:string;onSelect:(code:ProductCode)=>void;onSessionChanged:()=>void};
const unavailable='Помощник временно недоступен. Можно выбрать продукт вручную и продолжить оформление.';
export default function AssistantPreview(props:Props){
 const panelId=useId(),requestId=useRef(0);
 const [checking,setChecking]=useState(false),[available,setAvailable]=useState(false),[attempt,setAttempt]=useState(0);
 const [sending,setSending]=useState(false),[text,setText]=useState(''),[error,setError]=useState<string|null>(null);
 const [messages,setMessages]=useState<AssistantMessage[]>([]),[reply,setReply]=useState<AssistantReply|null>(null);
 useEffect(()=>{
  let active=true;setSending(false);
  if(!props.open)return;
  setChecking(true);setAvailable(false);setError(null);
  (async()=>{
   const state=await props.api.assistant?.status();if(active)setAvailable(state?.available===true);
  })().catch(()=>{if(active)setAvailable(false);}).finally(()=>{if(active)setChecking(false);});
  return()=>{active=false;requestId.current++;};
 },[props.open,props.api,attempt,props.applicationId]);
 async function send(){
  const service=props.api.assistant,message=text.trim();if(!service||!message||sending)return;
  const id=++requestId.current;setSending(true);setError(null);setReply(null);
  try{
   const before=await props.api.me();if(id!==requestId.current)return;
   if(!sameSession(before,props.session)){props.onSessionChanged();return;}
   const history=messages.slice(-6).map(item=>({...item,content:item.content.slice(0,1200)}));
   while(history.length&&history.reduce((sum,item)=>sum+item.content.length,0)+message.length>4000)history.shift();
   const result=await service.chat({application_id:props.applicationId,message,history});
   if(id!==requestId.current)return;
   const after=await props.api.me();if(id!==requestId.current)return;
   if(!sameSession(after,props.session)){props.onSessionChanged();return;}
   if(result.source!=='SERVER_CATALOG'||typeof result.answer!=='string'||(result.suggested_product!==null&&!products.some(product=>product.code===result.suggested_product)))throw Error('Invalid assistant response');
   setMessages(current=>[...current,{role:'user' as const,content:message},{role:'assistant' as const,content:result.answer}].slice(-20));
   setReply(result);setText('');
  }catch{if(id===requestId.current)setError('Не удалось получить ответ. Повторите сообщение или выберите продукт вручную.');}
  finally{if(id===requestId.current)setSending(false);}
 }
 return <div className={`assistant-preview ${props.open?'is-open':''}`}>
  <div className="assistant-invitation"><div><strong>Не уверены, что выбрать?</strong><p>Поможем сравнить варианты финансирования.</p></div>
   <button type="button" className="button assistant-toggle" aria-expanded={props.open} aria-controls={panelId} onClick={props.onToggle}>{props.open?'Свернуть помощника':'Помочь с выбором'}</button>
  </div>
  {props.open&&<section id={panelId} className="assistant-panel" aria-label="Помощник по финансированию">
   <h3>Помощник по финансированию</h3>
   {checking?<p role="status">Проверяем подключение помощника…</p>:!available?<div className="assistant-placeholder"><p>{unavailable}</p><button type="button" className="text-button" onClick={()=>setAttempt(n=>n+1)}>Проверить подключение</button></div>:<p className="small-note">Опишите задачу бизнеса. Помощник предложит продукт; окончательный выбор за вами.</p>}
   <div role="log" aria-label="Диалог с помощником" aria-live="polite">{messages.map((item,index)=><p className={`assistant-message assistant-message-${item.role}`} key={index}><strong>{item.role==='user'?'Вы':'Помощник'}: </strong>{item.content}</p>)}</div>
   {reply?.suggested_product&&<button type="button" className="button secondary" onClick={()=>props.onSelect(reply.suggested_product!)}>Выбрать продукт: {products.find(product=>product.code===reply.suggested_product)?.title}</button>}
   {reply&&<p className="small-note">{reply.disclaimer}</p>}
   <label className="field"><span>Сообщение помощнику</span><textarea value={text} onChange={event=>setText(event.target.value)} disabled={!available||checking||sending} rows={2} maxLength={1200} placeholder="Например, хочу купить печь для пекарни"/></label>
   <button type="button" className="button secondary" disabled={!available||checking||sending||!text.trim()} onClick={()=>void send()}>{sending?'Помощник отвечает…':'Отправить сообщение'}</button>
   {error&&<p role="alert" className="field-error">{error}</p>}
  </section>}
 </div>;
}
