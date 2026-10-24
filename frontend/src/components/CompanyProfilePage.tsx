import {useEffect,useState} from 'react';
import type {Api,ClientSession,CompanyProfile} from '../types';
import {sameSession} from '../session';
import {validateCompanyProfile} from '../company-profile';
import CompanyDataView from './CompanyDataView';

export default function CompanyProfilePage({api,session,onSessionChanged}:{api:Api;session:ClientSession;onSessionChanged:()=>void}){
 const [profile,setProfile]=useState<CompanyProfile|null>(null),[error,setError]=useState(false),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
  let active=true;setProfile(null);setError(false);
  (async()=>{
   const before=await api.me();if(!active)return;
   if(!sameSession(before,session)){onSessionChanged();return;}
   const value=await api.companyProfile();const after=await api.me();if(!active)return;
   if(!sameSession(after,session)||value.company_id!==session.company.id){onSessionChanged();return;}
   validateCompanyProfile(value);setProfile(value);
  })().catch(()=>{if(active)setError(true);});
  return()=>{active=false;};
 },[api,session.user.id,session.company.id,attempt]);
 return <section className="form-card company-profile-page">
  <h1>Профиль компании</h1><p>{session.company.name}</p>
  <p className="small-note">Сведения о бизнесе и финансах, которые банк использует при рассмотрении заявки. Все данные демонстрационные.</p>
  {error?<p role="alert">Не удалось загрузить сведения компании.</p>:!profile?<p role="status">Загружаем сведения…</p>:<CompanyDataView profile={profile}/>}
  <button type="button" className="button secondary" disabled={!profile&&!error} onClick={()=>setAttempt(n=>n+1)}>{error?'Повторить загрузку сведений':'Обновить сведения компании'}</button>
 </section>;
}
