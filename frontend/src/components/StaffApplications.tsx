import {useState} from 'react';
import type {Application} from '../types';
import {formatMoneyRub} from '../draft';
import StatusBadge,{statusLabel} from './StatusBadge';
import {products} from '../products';
export default function StaffApplications({items,busy,onOpen,onRefresh}:{items:Application[];busy:boolean;onOpen:(id:string)=>void;onRefresh:()=>void}) {
 const [tab,setTab]=useState<'current'|'completed'>('current');
 const [status,setStatus]=useState('ALL');
 const completed=(item:Application)=>['APPROVED','DECLINED'].includes(item.status);
 const group=items.filter(item=>completed(item)===(tab==='completed'));
 const visible=group.filter(item=>status==='ALL'||item.status===status);
 const statuses=tab==='current'?['UNDER_REVIEW','NEEDS_INFO']:['APPROVED','DECLINED'];
 return <section aria-label="Очередь заявок" className="applications-section staff-queue">
   <div className="list-heading"><h1>Поступившие заявки</h1><button type="button" className="button secondary" disabled={busy} onClick={onRefresh}>Обновить очередь</button></div>
   <p className="small-note">Заявок: {items.length}. В карточке можно запросить сведения, проверить балльную оценку и принять итоговое решение.</p>
   <div className="queue-controls"><div className="queue-tabs" aria-label="Раздел очереди">{(['current','completed'] as const).map(value=><button className="button secondary" type="button" key={value} aria-pressed={tab===value} onClick={()=>{setTab(value);setStatus('ALL');}}>{value==='current'?'Текущие':'Завершённые'} ({items.filter(item=>completed(item)===(value==='completed')).length})</button>)}</div>
   <label className="queue-filter">Статус<select value={status} onChange={event=>setStatus(event.target.value)}><option value="ALL">Все статусы</option>{statuses.map(value=><option key={value} value={value}>{statusLabel(value)}</option>)}</select></label></div>
   {!items.length ? <div className="empty-state"><h2>Поступивших заявок пока нет</h2><p>После отправки клиентом заявка появится здесь.</p></div> : !visible.length?<div className="empty-state"><p>Нет заявок с выбранным статусом в этом разделе.</p></div>: <div className="application-list">{visible.map(item=><article className="application-row" key={item.id}><button className="application-open staff-application-open" disabled={busy} onClick={()=>onOpen(item.id)} aria-label={`Открыть заявку ${item.id.slice(-6)}`}>
     <span className="row-main"><span className="row-topline">№ {item.id.slice(-6)} <StatusBadge status={item.status}/></span><strong className="row-title">{item.company_name}</strong><span className="row-purpose">{item.status==='NEEDS_INFO'?'Следующий шаг: ответ клиента. ':['APPROVED','DECLINED'].includes(item.status)?'Решение принято. ':'Следующий шаг: рассмотрение сотрудником. '}{products.find(p=>p.code===item.product_code)?.title}</span></span>
     <span className="row-amount"><strong>{formatMoneyRub(item.amount_rub)}</strong><small>{item.submitted_at && new Intl.DateTimeFormat('ru-RU',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Moscow'}).format(new Date(item.submitted_at))}</small></span>
   </button></article>)}</div>}
 </section>;
}
