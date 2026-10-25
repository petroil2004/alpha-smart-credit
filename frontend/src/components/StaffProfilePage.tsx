import {useEffect,useState} from 'react';
import type {Api,StaffSession,StaffProfile} from '../types';
import {sameSession} from '../session';
export default function StaffProfilePage({api,session,onSessionChanged}:{api:Api;session:StaffSession;onSessionChanged:()=>void}) {
 const [profile,setProfile]=useState<StaffProfile|null>(null),[error,setError]=useState(false);
 useEffect(()=>{
  let active=true;
  (async()=>{
   const before=await api.me();if(!active)return;
   if(!sameSession(before,session)){onSessionChanged();return;}
   const value=await api.staffProfile?.(),after=await api.me();if(!active)return;
   if(!sameSession(after,session)){onSessionChanged();return;}
   if(!value||value.account_id!==session.user.id)throw Error('Invalid profile');
   setProfile(value);
  })().catch(()=>{if(active)setError(true);});
  return()=>{active=false;};
 },[api,session.user.id]);
 return <section className="staff-profile-page"><h1>Профиль сотрудника</h1>{error?<p role="alert">Не удалось загрузить профиль. Вернитесь в очередь и откройте его заново.</p>:!profile?<p role="status">Загружаем профиль…</p>:<dl className="submitted-details">{[['ФИО',profile.full_name],['Должность',profile.position],['Отдел',profile.department],['Город',profile.city]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}</section>;
}
