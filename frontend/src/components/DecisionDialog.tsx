import {useEffect,useId,useRef} from 'react';
import type {Application} from '../types';
import {applicationNumber} from '../application-number';
import {formatMoneyRub} from '../draft';
import {products} from '../products';

export default function DecisionDialog({application,decision,comment,busy,error,onCancel,onConfirm}:{application:Application;decision:'APPROVE'|'DECLINE';comment:string;busy:boolean;error:string|null;onCancel:()=>void;onConfirm:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),cancel=useRef<HTMLButtonElement>(null),title=useId(),description=useId();
 const approve=decision==='APPROVE';
 useEffect(()=>{
  const element=dialog.current!,previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
  element.showModal();cancel.current?.focus();
  return()=>{element.close();if(previous?.isConnected)previous.focus();};
 },[]);
 return <dialog ref={dialog} className="delete-dialog decision-dialog" aria-labelledby={title} aria-describedby={description} onCancel={event=>{event.preventDefault();if(!busy)onCancel();}}>
  <span className={`delete-dialog-symbol ${approve?'decision-approve-symbol':''}`} aria-hidden="true">{approve?'✓':'!'}</span>
  <h2 id={title}>{approve?'Подтвердить одобрение?':'Подтвердить отказ?'}</h2>
  <div id={description}><p>Заявка № {applicationNumber(application)} · {application.company_name??application.submission?.snapshot.company.company_name}</p>
   <p>{products.find(product=>product.code===application.product_code)?.title} · {formatMoneyRub(application.amount_rub)}{application.term_months?` · ${application.term_months} мес.`:''}</p>
   {comment.trim()&&<p className="decision-confirm-comment"><strong>Причина решения: </strong>{comment}</p>}
   <p>{approve?'Клиент получит одобренные условия и сможет подтвердить оформление.':'Клиент получит отказ с указанной причиной.'} После подтверждения изменить решение в кабинете нельзя.</p>
  </div>
  {error&&<p className="delete-dialog-error" role="alert">{error}</p>}
  <div className="delete-dialog-actions"><button ref={cancel} className="button secondary" type="button" disabled={busy} onClick={onCancel}>Отмена</button><button className="button primary" type="button" disabled={busy} onClick={onConfirm}>{busy?'Сохраняем…':approve?'Подтвердить одобрение':'Подтвердить отказ'}</button></div>
 </dialog>;
}
