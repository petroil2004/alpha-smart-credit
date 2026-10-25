import {useEffect,useRef,useState} from 'react';
import type {Api,Application,ClientSession} from '../types';
import {sameSession} from '../session';
import {ApiError} from '../api';
import {formatMoneyRub} from '../draft';
import {Icon} from './Icon';

export default function FundingPanel({api,application,session,onUpdated,onSessionChanged}:{api:Api;application:Application;session:ClientSession;onUpdated:(item:Application)=>void;onSessionChanged:()=>void}) {
 const [expanded,setExpanded]=useState(false),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const attempt=useRef<{key:string;version:number}|null>(null),lock=useRef(false);
 const mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{attempt.current=null;setConfirmed(false);setError('');},[application.version]);
 const overdraft=application.product_code==='overdraft';
 async function receive(){
  if(lock.current||!confirmed||!api.disburse)return;
  lock.current=true;setBusy(true);setError('');
  try {
   if(!sameSession(await api.me(),session)){if(mounted.current)onSessionChanged();return;}
   if(!mounted.current)return;
   attempt.current??={key:crypto.randomUUID(),version:application.version};
   const value=await api.disburse(application.id,{version:attempt.current.version,confirmed:true},attempt.current.key);
   if(!sameSession(await api.me(),session)){if(mounted.current)onSessionChanged();return;}
   if(!mounted.current)return;
   if(value.id!==application.id||value.company_id!==session.company.id)throw Error('Invalid application');
   onUpdated(value);
  }catch(e){if(mounted.current)setError(e instanceof ApiError?e.message:'Не удалось подтвердить получение. Попробуйте ещё раз.');}
  finally{lock.current=false;setBusy(false);}
 }
 if(application.status==='ISSUED'&&application.disbursement)return <section className="funding-success" aria-label="Получение финансирования"><span className="funding-success-icon"><Icon name="check" size={42}/></span><h1>{overdraft?'Овердрафт доступен':'Средства зачислены'}</h1><p className="funding-amount">{formatMoneyRub(application.disbursement.amount_rub)}</p><p>{overdraft?'Лимит открыт для оплаты расходов бизнеса.':'Финансирование поступило на демонстрационный счёт компании.'}</p><p className="small-note">Демонстрационная операция. Реальные деньги не переводились.</p></section>;
 if(application.status!=='APPROVED')return null;
 return <section className="funding-panel" aria-label="Получение финансирования"><h2>{overdraft?'Откройте одобренный лимит':'Финансирование готово к получению'}</h2><p>Одобрено: <strong>{formatMoneyRub(application.amount_rub)}</strong></p>
 {!expanded?<button type="button" className="button primary" onClick={()=>setExpanded(true)}>{overdraft?'Открыть лимит':'Получить деньги'}</button>:<><a href="/credit-terms.html" target="_blank" rel="noopener noreferrer">Полные условия финансирования ↗</a><label className="submission-confirmation"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/><span>Я согласен с одобренными параметрами заявки и подтверждаю демонстрационное получение финансирования.</span></label><button type="button" className="button primary" disabled={!confirmed||busy||!api.disburse} onClick={()=>void receive()}>{busy?'Подтверждаем…':'Подтвердить и получить'}</button></>}
 {error&&<p role="alert" className="field-error">{error}</p>}<p className="small-note">Это демонстрация получения средств, без реального перевода и юридической подписи.</p></section>;
}
