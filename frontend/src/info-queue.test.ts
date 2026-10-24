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

it('independent message does not rebase dirty text over another tab',async()=>{
 const start=initial();let server={...start,info_requests:start.info_requests!.map(r=>({...r,revision:2,reply_text:'Ответ вкладки Б'}))};
 const save=vi.fn(async(a:Application,text:string)=>{if(a.info_requests![0].revision!==server.info_requests![0].revision)throw Error('VERSION_CONFLICT');server={...server,info_requests:server.info_requests!.map(r=>({...r,revision:r.revision+1,reply_text:text}))};return server;});
 const q=new InfoQueue(start,'r',save,async()=>{},()=>{},()=>{});q.setText('Несохранённый ответ вкладки А');q.accept(server);
 expect(await q.flush()).toBe(false);expect(server.info_requests![0].reply_text).toBe('Ответ вкладки Б');expect(q.text).toBe('Несохранённый ответ вкладки А');q.dispose();
});

it('upload replay does not authorise overwriting a later reply from another tab',async()=>{
 const start=initial();let server={...start,info_requests:start.info_requests!.map(r=>({...r,revision:3,reply_text:'Ответ вкладки Б'}))};
 const save=vi.fn(async(a:Application,text:string)=>{if(a.info_requests![0].revision!==server.info_requests![0].revision)throw Error('VERSION_CONFLICT');server={...server,info_requests:server.info_requests!.map(r=>({...r,revision:r.revision+1,reply_text:text}))};return server;});
 const gate=deferred();let started!:()=>void;const ready=new Promise<void>(resolve=>started=resolve);
 const q=new InfoQueue(start,'r',save,async()=>{},()=>{},()=>{});q.enqueue(async()=>{started();await gate.promise;return server;});await ready;q.setText('Ответ вкладки А');gate.resolve(server);expect(await q.flush()).toBe(false);expect(server.info_requests![0].reply_text).toBe('Ответ вкладки Б');q.dispose();
});

it('adopts a newer server reply when the queue has no local changes',()=>{
 const q=new InfoQueue(initial(),'r',async a=>a,async()=>{},()=>{},()=>{});const newer={...initial(),info_requests:initial().info_requests!.map(r=>({...r,revision:2,reply_text:'Сохранённый ответ другой вкладки'}))};q.accept(newer);expect(q.text).toBe('Сохранённый ответ другой вкладки');expect(q.dirty).toBe(false);q.dispose();
});

it('does not conflict when a message observes this queue’s own pending save',async()=>{
 const start=initial(),gate=deferred();let started!:()=>void;const ready=new Promise<void>(resolve=>started=resolve);
 const q=new InfoQueue(start,'r',async(a,text)=>{started();return gate.promise;},async()=>{},()=>{},()=>{});q.setText('Мой ответ');const done=q.flush();await ready;
 const confirmed={...start,info_requests:start.info_requests!.map(r=>({...r,revision:2,reply_text:'Мой ответ'}))};q.accept(confirmed);gate.resolve(confirmed);expect(await done).toBe(true);expect(q.dirty).toBe(false);q.dispose();
});
