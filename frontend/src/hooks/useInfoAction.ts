import {useEffect,useRef,useState} from 'react';
import type {Application} from '../types';
import {ApiError} from '../api';
import {InfoReceipts} from '../info-receipts';
import type {InfoAction,InfoReceipt} from '../info-receipts';
export const infoError=(error:unknown)=>error instanceof ApiError?error:new ApiError(0,'UNKNOWN_ERROR','Не удалось выполнить действие. Попробуйте ещё раз.');
export function useInfoAction(store:InfoReceipts,action:InfoAction,guard:()=>Promise<void>,accept:(a:Application)=>void){
 const [state,setState]=useState(()=>{try{return {pending:store.read(action),error:null as ApiError|null};}catch(error){return {pending:null,error:infoError(error)};}});
 const [busy,setBusy]=useState(false);const locked=useRef(false),alive=useRef(true),inFlight=useRef<Promise<boolean>|null>(null);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 function run(body:()=>Promise<InfoReceipt['body']>,send:(receipt:InfoReceipt)=>Promise<Application>){
  if(locked.current)return inFlight.current??Promise.resolve(false);
  if(state.error?.code==='INVALID_INFO_RECEIPT')return Promise.resolve(false);
  locked.current=true;setBusy(true);setState(s=>({...s,error:null}));
  const operation=(async()=>{
   let receipt=state.pending;
   try{
    await guard();if(!alive.current)return false;
    if(!receipt){const value=await body();if(!alive.current)return false;receipt={key:crypto.randomUUID(),body:value};store.save(action,receipt);setState({pending:receipt,error:null});}
    await guard();if(!alive.current)return false;
    const result=await send(receipt);await guard();if(!alive.current)return false;
    store.clear(action);setState({pending:null,error:null});accept(result);return true;
   }catch(error){
    const problem=infoError(error);
    if(alive.current){
     if(problem.status>=400&&problem.status<500&&problem.status!==401){try{store.clear(action);receipt=null;}catch{/* Retain receipt if storage cannot be changed. */}}
     setState({pending:receipt,error:problem});
    }
    return false;
   }finally{locked.current=false;inFlight.current=null;if(alive.current)setBusy(false);}
  })();inFlight.current=operation;return operation;
 }
 return {...state,busy,run,reload:()=>{try{setState({pending:store.read(action),error:null});}catch(e){setState({pending:null,error:infoError(e)});}},wait:()=>inFlight.current??Promise.resolve(!state.pending&&!state.error)};
}
