import type {Application,InfoRequest} from './types';
import {ApiError} from './api';

// Conversations may finish alongside a save. Keep newer revisions and every message.
export function mergeInfoApplication(old:Application,next:Application):Application {
 const newer=next.version>=old.version?next:old;
 const requests=new Map((old.info_requests??[]).map(r=>[r.id,r]));
 for(const incoming of next.info_requests??[]){
  const previous=requests.get(incoming.id);
  if(!previous){requests.set(incoming.id,incoming);continue;}
  const messages=new Map([...previous.messages,...incoming.messages].map(m=>[m.id,m]));
  requests.set(incoming.id,{...(incoming.revision>=previous.revision?incoming:previous),messages:[...messages.values()].sort((a,b)=>a.id-b.id)});
 }
 const assessment=old.version===next.version&&old.assessment&&next.assessment&&Date.parse(old.assessment.calculated_at)>Date.parse(next.assessment.calculated_at)?old.assessment:newer.assessment;
 return {...newer,...(assessment?{assessment}:{}),info_requests:[...requests.values()].sort((a,b)=>a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id))};
}
type Job=(application:Application)=>Promise<Application>;
export class InfoQueue {
 private current:Application;
 // Reading a conversation is not consent to rebase unsaved edits over another tab.
 private base:InfoRequest;
 private jobs:Job[]=[];
 private running:Promise<boolean>|null=null;
 private timer:ReturnType<typeof setTimeout>|undefined;
 private requested=false;
 private stopped=false;
 private disposed=false;
 text:string;
 constructor(application:Application,private rid:string,private save:(application:Application,text:string)=>Promise<Application>,private guard:()=>Promise<void>,private publish:(application:Application)=>void,private changed:()=>void,private failed:(error:unknown)=>void=()=>{}){
  this.current=application;this.base=this.request();this.text=this.base.reply_text;
 }
 private request(){return this.current.info_requests!.find(r=>r.id===this.rid)!;}
 get(){return this.current;}
 get dirty(){return this.text!==this.base.reply_text||this.jobs.length>0||this.running!==null;}
 accept(application:Application){
  const wasClean=!this.dirty;
  this.current=mergeInfoApplication(this.current,application);
  if(wasClean){this.base=this.request();this.text=this.base.reply_text;}
 }
 private forWrite():Application {
  return {...this.current,info_requests:this.current.info_requests!.map(r=>r.id===this.rid?{...r,revision:this.base.revision}:r)};
 }
 setText(text:string){this.text=text;this.changed();clearTimeout(this.timer);this.timer=setTimeout(()=>{this.requested=true;void this.pump();},1500);}
 enqueue(job:Job){this.jobs.push(job);this.changed();void this.pump();}
 private pump():Promise<boolean>{
  if(this.running)return this.running;
  if(this.disposed||this.stopped)return Promise.resolve(false);
  // Defer work one microtask so `running` is set before callbacks fire.
  this.running=Promise.resolve().then(async()=>{
   try{
    while(!this.disposed){
     const value=this.text;
     const shouldSave=this.requested&&value!==this.base.reply_text;
     const job=shouldSave?((a:Application)=>this.save(a,value)):this.jobs[0];
     if(!job)break;
     await this.guard();if(this.disposed)return false;
     const result=await job(this.forWrite());
     await this.guard();if(this.disposed)return false;
     const confirmed=result.info_requests!.find(r=>r.id===this.rid)!;
     const cleanText=this.text===this.base.reply_text;
     this.current=mergeInfoApplication(this.current,result);
     if(!shouldSave)this.jobs.shift();
     // A replayed upload can return a later state containing somebody else's edit.
     // Confirm the file, but retain the edit base and stop before overwriting that reply.
     if(!shouldSave&&!cleanText&&confirmed.revision>this.base.revision+1){
      throw new ApiError(409,'VERSION_CONFLICT','Ответ изменён в другом окне. Обновите карточку, сохранив нужный текст.');
     }
     this.base=confirmed;
     if(!shouldSave&&cleanText)this.text=this.base.reply_text;
     this.publish(this.current);this.changed();
    }
    return !this.disposed;
   }catch(error){this.stopped=true;if(!this.disposed)this.failed(error);return false;}
  }).finally(()=>{this.running=null;if(!this.disposed)this.changed();});
  this.changed();return this.running;
 }
 async flush(){clearTimeout(this.timer);this.requested=true;return this.pump();}
 retry(){this.stopped=false;return this.flush();}
 dispose(){this.disposed=true;clearTimeout(this.timer);}
}
