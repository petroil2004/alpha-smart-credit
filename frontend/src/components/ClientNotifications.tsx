import {applicationNumber} from "../application-number";
import {useEffect,useId,useRef,useState} from 'react';
import type {Api,ClientNotification,ClientSession,NotificationList} from '../types';
import {sameSession} from '../session';
import {Icon} from './Icon';
import StatusBadge from './StatusBadge';

export default function ClientNotifications({api,session,busy,onOpen,onSessionChanged}:{
  api:Api;session:ClientSession;busy:boolean;
  onOpen:(notification:ClientNotification)=>Promise<boolean>;onSessionChanged:()=>void;
}) {
  const [open,setOpen]=useState(false),[data,setData]=useState<NotificationList>({items:[],unread_count:0});
  const [error,setError]=useState(false),[opening,setOpening]=useState(false),[attempt,setAttempt]=useState(0);
  const root=useRef<HTMLDivElement>(null),generation=useRef(0),id=useId();
  const service=api.notifications;
  useEffect(()=>{
    const current=++generation.current;let pending=false;
    async function load(){
      if(!service||pending||document.visibilityState==='hidden')return;
      pending=true;
      try {
        const before=await api.me();if(current!==generation.current)return;
        if(!sameSession(before,session)){onSessionChanged();return;}
        const value=await service.list(),after=await api.me();
        if(current!==generation.current)return;
        if(!sameSession(after,session)){onSessionChanged();return;}
        setData(value);setError(false);
      }catch{if(current===generation.current)setError(true);}
      finally{pending=false;}
    }
    void load();const timer=setInterval(()=>void load(),30000);
    const focus=()=>void load();window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);
    return()=>{generation.current++;clearInterval(timer);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);};
  },[api,service,session.user.id,session.company.id,attempt]);
  useEffect(()=>{
    if(!open)return;
    const outside=(event:MouseEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setOpen(false);root.current?.querySelector<HTMLButtonElement>('.notification-toggle')?.focus();}};
    document.addEventListener('mousedown',outside);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('mousedown',outside);document.removeEventListener('keydown',escape);};
  },[open]);
  async function visit(item:ClientNotification){
    const current=generation.current;setOpening(true);
    try{
      if(await onOpen(item)&&current===generation.current){setOpen(false);setAttempt(n=>n+1);}
    }catch{if(current===generation.current)setError(true);}
    finally{setOpening(false);}
  }
  return <div className="notifications" ref={root}>
    <button className="icon-button notification-toggle" type="button" aria-label={`Уведомления${data.unread_count?`: ${data.unread_count} непрочитанных`:''}`} aria-expanded={open} aria-controls={id} onClick={()=>{setOpen(value=>!value);setAttempt(n=>n+1);}}><Icon name="bell"/>{data.unread_count>0&&<span className="notification-dot"/>}</button>
    {open&&<section id={id} className="notifications-panel" aria-label="Уведомления клиента"><h2>Уведомления</h2>
      {error&&<p role="alert">Не удалось обновить уведомления. <button type="button" className="text-button" onClick={()=>setAttempt(n=>n+1)}>Повторить</button></p>}
      {!data.items.length&&!error&&<p className="small-note">Здесь появятся изменения статусов ваших заявок.</p>}
      <ul>{data.items.map(item=><li key={item.id}><button type="button" className={`notification-item ${item.read?'':'is-unread'}`} disabled={busy||opening} onClick={()=>void visit(item)}><strong>{item.title}</strong><span>Заявка № {applicationNumber({id:item.application_id,application_number:item.application_number})}</span><StatusBadge status={item.status}/>{item.message&&<span>{item.message}</span>}<time dateTime={item.occurred_at}>{new Date(item.occurred_at).toLocaleString('ru-RU')}</time></button></li>)}</ul>
    </section>}
  </div>;
}
