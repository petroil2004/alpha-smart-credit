import {describe,it,expect,vi} from 'vitest';
import {InfoQueue} from './info-queue';
import {application} from './test/api-fixtures';
import type {Application} from './types';
const initial=()=>({...application(),status:'NEEDS_INFO',info_requests:[{id:'r',question:'Вопрос',reason:'Причина',document_required:false,source:'SELF_REPORTED',created_at:'2026-10-24T00:00:00Z',created_by:'staff',reply_by:null,closed_by:null,revision:1,reply_text:'',closed_at:null,attachments:[],messages:[]}]} as Application);
const deferred=()=>{let resolve!:(value:Application)=>void;const promise=new Promise<Application>(r=>resolve=r);return {resolve,promise};};
describe('clarification save queue',()=>{
 it('waits for upload and newest text before final submission can use revision',async()=>{
  const gate=deferred();const calls:string[]=[];
  const q=new InfoQueue(initial(),'r',async(a,text)=>{calls.push(text);return {...a,info_requests:a.info_requests!.map(r=>({...r,reply_text:text,revision:r.revision+1}))};},async()=>{},()=>{},()=>{});
  q.enqueue(async a=>{calls.push('file');await gate.promise;return {...a,info_requests:a.info_requests!.map(r=>({...r,revision:2}))};});
  await Promise.resolve();q.setText('Новый ответ');const done=q.flush();let finished=false;void done.then(()=>finished=true);
  await Promise.resolve();expect(finished).toBe(false);gate.resolve(initial());expect(await done).toBe(true);
  expect(calls).toEqual(['file','Новый ответ']);expect(q.get().info_requests![0].revision).toBe(3);q.dispose();
 });
 it('keeps new text while older save completes and retries a failed file with same closure',async()=>{
  const gate=deferred();let first=true;const save=vi.fn(async(a:Application,text:string)=>{if(first){first=false;await gate.promise;}return {...a,info_requests:a.info_requests!.map(r=>({...r,reply_text:text,revision:r.revision+1}))};});
  const q=new InfoQueue(initial(),'r',save,async()=>{},()=>{},()=>{});q.setText('Старый');const one=q.flush();await Promise.resolve();q.setText('Новый');gate.resolve(initial());expect(await one).toBe(true);expect(q.text).toBe('Новый');expect(save).toHaveBeenCalledTimes(2);
  const file=vi.fn().mockRejectedValueOnce(Error('offline')).mockImplementation(async(a:Application)=>a);q.enqueue(file);expect(await q.flush()).toBe(false);expect(q.dirty).toBe(true);expect(await q.retry()).toBe(true);expect(file).toHaveBeenCalledTimes(2);q.dispose();
 });
 it('does not publish a late response after disposal or failed session guard',async()=>{
  const gate=deferred(),changed=vi.fn();const q=new InfoQueue(initial(),'r',async()=>gate.promise,async()=>{},changed,()=>{});q.setText('Ответ');const done=q.flush();await Promise.resolve();q.dispose();gate.resolve(initial());expect(await done).toBe(false);expect(changed).not.toHaveBeenCalled();
 });
});

it('merges a conversation response without regressing revision or newer local text',async()=>{
 const {mergeInfoApplication}=await import('./info-queue');
 const old=initial();const newer={...old,info_requests:old.info_requests!.map(r=>({...r,revision:3,reply_text:'Новое'}))};
 const late={...old,info_requests:old.info_requests!.map(r=>({...r,messages:[{id:1,text:'Вопрос',actor_id:'c',actor_role:'CLIENT',created_at:r.created_at}]}))};
 const result=mergeInfoApplication(newer,late);expect(result.info_requests![0].revision).toBe(3);expect(result.info_requests![0].reply_text).toBe('Новое');expect(result.info_requests![0].messages).toHaveLength(1);
});
