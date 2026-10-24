import type {Application,InfoApi} from './types';
import {ApiError} from './api';
const path=(id:string,rid?:string,staff=false)=>`/${staff?'staff/':''}applications/${encodeURIComponent(id)}/info-requests${rid?'/'+encodeURIComponent(rid):''}`;
export function createInfoApi(fetcher:typeof fetch):InfoApi {
 async function request<T>(url:string,options:RequestInit={},binary=false):Promise<T>{
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),30_000);
  try{
   const response=await fetcher('/api/v1'+url,{...options,credentials:'same-origin',signal:controller.signal});
   if(!response.ok){let body;try{body=await response.json();}catch{/* generic error below */}
    throw new ApiError(response.status,body?.error?.code??'SERVER_ERROR',body?.error?.message??'Не удалось выполнить действие. Попробуйте ещё раз.');}
   if(binary)return await response.blob() as T;
   const body=await response.json();
   if(!body || typeof body.id!=='string' || !Array.isArray(body.info_requests))throw new ApiError(502,'INVALID_RESPONSE','Не удалось подтвердить действие. Проверьте его повтором.');
   return body as T;
  }catch(error){if(error instanceof ApiError)throw error;throw new ApiError(0,'NETWORK_ERROR','Не удалось связаться с сервисом. Повторите действие.');}
  finally{clearTimeout(timeout);}
 }
 const json=(method:string,body:unknown,key?:string):RequestInit=>({method,body:JSON.stringify(body),headers:{'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})}});
 return {
  create:(id,body,key)=>request<Application>(path(id,undefined,true),json('POST',body,key)),
  save:(id,rid,revision,text)=>request<Application>(path(id,rid)+'/reply',json('PATCH',{revision,reply_text:text})),
  submit:(id,rid,body,key)=>request<Application>(path(id,rid)+'/reply/submit',json('POST',body,key)),
  message:(id,rid,staff,text,key)=>request<Application>(path(id,rid,staff)+'/messages',json('POST',{text},key)),
  upload:(id,rid,fid,revision,file)=>request<Application>(path(id,rid)+'/attachments/'+encodeURIComponent(fid)+'?'+new URLSearchParams({filename:file.name,revision:String(revision)}),{method:'PUT',body:file,headers:{'Content-Type':file.type || (file.name.toLowerCase().endsWith('.pdf')?'application/pdf':'text/plain')}}),
  detach:(id,rid,fid,revision)=>request<Application>(path(id,rid)+'/attachments/'+encodeURIComponent(fid)+'/detach',json('POST',{revision})),
  download:(id,rid,fid,staff)=>request<Blob>(path(id,rid,staff)+'/attachments/'+encodeURIComponent(fid),{},true),
 };
}
