import type {Application} from '../types';
import {formatMoneyRub} from '../draft';
import {statusLabel} from './SubmittedApplication';
import {products} from '../products';
export default function StaffApplications({items,busy,onOpen,onRefresh}:{items:Application[];busy:boolean;onOpen:(id:string)=>void;onRefresh:()=>void}) {
 return <section aria-label="Очередь заявок" className="applications-section staff-queue">
   <div className="list-heading"><h1>Поступившие заявки</h1><button type="button" className="button secondary" disabled={busy} onClick={onRefresh}>Обновить очередь</button></div>
   <p className="small-note">Заявок: {items.length}. При необходимости запросите сведения в карточке заявки. Решения по кредиту пока не реализованы.</p>
   {!items.length ? <div className="empty-state"><h2>Поступивших заявок пока нет</h2><p>После отправки клиентом заявка появится здесь.</p></div> : <div className="application-list">{items.map(item=><article className="application-row" key={item.id}><button className="application-open staff-application-open" disabled={busy} onClick={()=>onOpen(item.id)} aria-label={`Открыть заявку ${item.id.slice(-6)}`}>
     <span className="row-main"><span className="row-topline">№ {item.id.slice(-6)} · {statusLabel(item.status)}</span><strong className="row-title">{item.company_name}</strong><span className="row-purpose">{item.status==='NEEDS_INFO'?'Следующий шаг: ответ клиента. ':'Следующий шаг: рассмотрение сотрудником. '}{products.find(p=>p.code===item.product_code)?.title}</span></span>
     <span className="row-amount"><strong>{formatMoneyRub(item.amount_rub)}</strong><small>{item.submitted_at && new Intl.DateTimeFormat('ru-RU',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Moscow'}).format(new Date(item.submitted_at))}</small></span>
   </button></article>)}</div>}
 </section>;
}
