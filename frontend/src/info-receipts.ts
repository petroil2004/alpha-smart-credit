import {ApiError} from './api';
import type {InfoCreate,InfoSubmit} from './types';
export type InfoAction='create'|'submit'|'message'|'accept-financial'|'staff-financial-correction'|'close';
export interface InfoReceipt {key:string;body:InfoCreate|InfoSubmit|{text:string}|{};}
const prefix=(user:string,app:string,rid:string)=>`credit-info:${encodeURIComponent(user)}:${encodeURIComponent(app)}:${encodeURIComponent(rid)}:`;
const uuid=(value:unknown)=>typeof value==='string'&&/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value);
const positive=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>0;
export class InfoReceipts {
 constructor(private user:string,private app:string,private rid:string){}
 private key(action:string){return prefix(this.user,this.app,this.rid)+action;}
 read(action:InfoAction):InfoReceipt|null {
  let raw;try{raw=sessionStorage.getItem(this.key(action));}catch{throw this.unavailable();}
  if(raw===null)return null;
  try{
   const value=JSON.parse(raw),b=value.body;
   const valid=action==='create'?b&&[4,5].includes(Object.keys(b).length)&&positive(b.version)&&typeof b.question==='string'&&b.question.trim()&&b.question.length<=2000&&typeof b.reason==='string'&&b.reason.length<=1000&&typeof b.document_required==='boolean':(action==='submit'||action==='close')?b&&[2,3].includes(Object.keys(b).length)&&positive(b.version)&&positive(b.revision):action==='staff-financial-correction'?b&&Object.keys(b).length===3&&positive(b.version)&&typeof b.reason==='string'&&b.reason.trim()&&b.reason.length<=1000&&Array.isArray(b.values)&&b.values.length>0&&b.values.length<=13&&b.values.every((v:any)=>v&&['income_rub','expenses_rub','debt_payment_rub'].includes(v.kind)&&(v.month===null||typeof v.month==='string')&&typeof v.value_rub==='string'):action==='accept-financial'?b&&Object.keys(b).length===0:b&&Object.keys(b).length===1&&typeof b.text==='string'&&b.text.trim()&&b.text.length<=1000;
   if(!uuid(value.key)||!valid)throw Error();return value;
  }catch{throw new ApiError(0,'INVALID_INFO_RECEIPT','Данные повтора повреждены. Проверьте сохранённую карточку для восстановления.');}
 }
 save(action:InfoAction,receipt:InfoReceipt){try{sessionStorage.setItem(this.key(action),JSON.stringify(receipt));}catch{throw this.unavailable();}}
 clear(action:InfoAction){try{sessionStorage.removeItem(this.key(action));}catch{throw this.unavailable();}}
 private unavailable(){return new ApiError(0,'INFO_STORAGE_UNAVAILABLE','Разрешите хранилище браузера, чтобы безопасно повторять действия.');}
}

export interface UploadReceipt {id:string;name:string;size:number;type:string;}
export function uploadStorageKey(user:string,app:string,rid:string){return prefix(user,app,rid)+'upload';}
export function readUpload(user:string,app:string,rid:string):UploadReceipt|null {
 try{const raw=sessionStorage.getItem(uploadStorageKey(user,app,rid));if(!raw)return null;const value=JSON.parse(raw);
 if(!uuid(value.id)||typeof value.name!=='string'||!Number.isSafeInteger(value.size)||value.size<1||value.size>5_000_000||typeof value.type!=='string')throw Error();return value;
 }catch{throw new ApiError(0,'INVALID_INFO_RECEIPT','Не удалось прочитать данные загрузки. Обновите карточку для восстановления.');}
}
export function writeUpload(user:string,app:string,rid:string,value:UploadReceipt|null){
 try{const key=uploadStorageKey(user,app,rid);if(value)sessionStorage.setItem(key,JSON.stringify(value));else sessionStorage.removeItem(key);}
 catch{throw new ApiError(0,'INFO_STORAGE_UNAVAILABLE','Не удалось сохранить данные повтора загрузки. Разрешите хранилище браузера.');}
}
