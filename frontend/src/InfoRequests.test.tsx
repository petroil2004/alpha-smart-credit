import {fireEvent,render,screen,waitFor,act} from '@testing-library/react';
import {beforeEach,describe,it,expect,vi} from 'vitest';
import InfoRequests from './components/InfoRequests';
import App from './App';
import {createApi} from './api';
import type {Application,Session} from './types';
import {application} from './test/api-fixtures';
const client:Session={user:{id:'demo-client-1',name:'Клиент',role:'CLIENT'},company:{id:'demo-company-1',name:'Демо'}};
const staff:Session={user:{id:'demo-staff-1',name:'Сотрудник',role:'STAFF'},company:null};
function server(role:Session,required=false){
 let item:Application={...application(),status:'UNDER_REVIEW',info_requests:[],history:[]};let messageId=0;const receipts=new Set<string>();let gate:Promise<void>|null=null;
 const calls:{path:string;body:any;key:string|null}[]=[];
 const fetcher=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const path=String(input),method=init?.method??'GET';
  const body=typeof init?.body==='string'?JSON.parse(init.body):init?.body;
  calls.push({path,body,key:new Headers(init?.headers).get('Idempotency-Key')});
  if(path==='/api/v1/me')return new Response(JSON.stringify(role));
  if(method==='GET')return new Response(JSON.stringify(item));
  const key=new Headers(init?.headers).get('Idempotency-Key');if(key&&receipts.has(key))return new Response(JSON.stringify(item));if(key)receipts.add(key);
  if(path.endsWith('/info-requests'))item={...item,status:'NEEDS_INFO',version:item.version+1,info_requests:[{...body,id:'r',revision:1,reply_text:'',source:'SELF_REPORTED',created_at:'2026-10-24T00:00:00Z',created_by:staff.user.id,closed_at:null,closed_by:null,reply_by:null,messages:[],attachments:[]}]};
  else {
   const r=item.info_requests![0];
   if(method==='PATCH'){if(gate)await gate;item={...item,info_requests:[{...r,revision:r.revision+1,reply_text:body.reply_text}]};}
   else if(path.endsWith('/messages'))item={...item,info_requests:[{...r,messages:[...r.messages,{id:++messageId,text:body.text,actor_role:role.user.role,actor_id:role.user.id,created_at:'2026-10-24T01:00:00Z'}]}]};
   else if(path.includes('/attachments/')&&method==='PUT'){if(gate)await gate;item={...item,info_requests:[{...r,revision:r.revision+1,attachments:[{id:path.split('/attachments/')[1].split('?')[0],filename:'test.pdf',message_id:null,size_bytes:3,content_type:'application/pdf',actor_id:role.user.id,created_at:r.created_at}]}]};}
   else if(path.endsWith('/reply/submit')){const id=++messageId;item={...item,version:item.version+1,info_requests:[{...r,revision:r.revision+1,reply_text:'',reply_submitted_at:'2026-10-24T02:00:00Z',messages:[...r.messages,{id,text:r.reply_text,actor_role:'CLIENT',actor_id:client.user.id,created_at:r.created_at}],attachments:r.attachments.map(a=>({...a,message_id:a.message_id??id}))}]};}
  }
  return new Response(JSON.stringify(item));
 });
 const open=()=>{item={...item,status:'NEEDS_INFO',info_requests:[{id:'r',revision:1,question:'Уточните расходы',reason:'Для рассмотрения заявки',document_required:required,reply_text:'',source:'SELF_REPORTED',created_at:'2026-10-24T00:00:00Z',created_by:staff.user.id,reply_by:null,closed_at:null,closed_by:null,attachments:[],messages:[]}]};};
 return {api:createApi(fetcher as typeof fetch),calls,get item(){return item;},open,hold:(p:Promise<void>)=>gate=p,fetcher};
}
beforeEach(()=>{sessionStorage.clear();});
const props={onUpdated:vi.fn(),onSessionChanged:vi.fn()};
describe('information request UI',()=>{
 it('staff explicitly publishes question, reason and document requirement',async()=>{
  const s=server(staff);render(<InfoRequests api={s.api} session={staff} application={s.item} {...props}/>);
  fireEvent.change(screen.getByLabelText('Запрос сведений'),{target:{value:'Уточните расходы'}});

  fireEvent.click(screen.getByLabelText('Нужен документ'));
  fireEvent.click(screen.getByRole('button',{name:'Запросить сведения'}));
  await waitFor(()=>expect(s.item.status).toBe('NEEDS_INFO'));
  expect(s.item.info_requests![0].document_required).toBe(true);
  expect(s.calls.find(c=>c.path.endsWith('/info-requests'))?.key).toMatch(/^[a-f\d-]{36}$/);
 });
 it('waits for latest save before explicit response submission; chat remains independent',async()=>{
  const s=server(client);s.open();let release!:()=>void;s.hold(new Promise<void>(r=>release=r));
  render(<InfoRequests api={s.api} session={client} application={s.item} {...props}/>);
  fireEvent.change(screen.getByLabelText('Сообщение по запросу'),{target:{value:'Расходы уточнены'}});
  fireEvent.click(screen.getByRole('button',{name:'Отправить ответ'}));
  await waitFor(()=>expect(s.calls.some(c=>c.path.endsWith('/reply'))).toBe(true));
  expect(s.calls.some(c=>c.path.endsWith('/reply/submit'))).toBe(false);
  await act(async()=>release());await waitFor(()=>expect(s.item.info_requests![0].reply_submitted_at).toBeTruthy());
  expect(s.calls.find(c=>c.path.endsWith('/reply/submit'))?.body.revision).toBe(2);
 });
 it('waits for selected file upload before submitting required documents',async()=>{
  const s=server(client,true);s.open();let release!:()=>void;s.hold(new Promise<void>(r=>release=r));
  render(<InfoRequests api={s.api} session={client} application={s.item} {...props}/>);
  fireEvent.change(screen.getByLabelText('Сообщение по запросу'),{target:{value:'Справка приложена'}});
  fireEvent.change(screen.getByLabelText('Прикрепить документ'),{target:{files:[new File(['abc'],'test.pdf',{type:'application/pdf'})]}});
  fireEvent.click(screen.getByRole('button',{name:'Загрузить документ'}));
  expect(screen.getByRole('button',{name:'Отправить ответ'})).toBeDisabled();
  await waitFor(()=>expect(s.calls.some(c=>c.path.includes('/attachments/'))).toBe(true));
  expect(s.item.status).toBe('NEEDS_INFO');await act(async()=>release());await waitFor(()=>expect(screen.getByRole('button',{name:'Отправить ответ'})).not.toBeDisabled());fireEvent.click(screen.getByRole('button',{name:'Отправить ответ'}));
  await waitFor(()=>expect(s.item.info_requests![0].reply_submitted_at).toBeTruthy());
  expect(s.calls.find(c=>c.path.endsWith('/reply/submit'))?.body.revision).toBe(3);
 });
});


describe('recovery and lifecycle',()=>{
 it('autosaves after 1500ms without sending the reply',async()=>{
  vi.useFakeTimers();try{
   const s=server(client);s.open();render(<InfoRequests api={s.api} session={client} application={s.item} {...props}/>);
   fireEvent.change(screen.getByLabelText('Сообщение по запросу'),{target:{value:'Сохранить черновик'}});
   await act(async()=>{await vi.advanceTimersByTimeAsync(1499);});expect(s.calls.some(c=>c.path.endsWith('/reply'))).toBe(false);
   await act(async()=>{await vi.advanceTimersByTimeAsync(1);});expect(s.item.info_requests![0].reply_text).toBe('Сохранить черновик');expect(s.item.status).toBe('NEEDS_INFO');
  }finally{vi.useRealTimers();}
 });
 it('retains exact message receipt across remount after a lost response',async()=>{
  const s=server(staff);s.open();let lose=true;
  const fetcher=async(input:RequestInfo|URL,init?:RequestInit)=>{const response=await s.fetcher(input,init);if(String(input).endsWith('/messages')&&lose){lose=false;throw Error('lost');}return response;};
  const api=createApi(fetcher as typeof fetch);const first=render(<InfoRequests api={api} session={staff} application={s.item} {...props}/>);
  fireEvent.change(screen.getByLabelText('Сообщение по запросу'),{target:{value:'Какой документ?'}});fireEvent.click(screen.getByRole('button',{name:'Отправить сообщение'}));
  await screen.findByRole('button',{name:'Проверить сообщение'});first.unmount();
  render(<InfoRequests api={api} session={staff} application={s.item} {...props}/>);fireEvent.click(screen.getByRole('button',{name:'Проверить сообщение'}));
  await waitFor(()=>expect(screen.queryByRole('button',{name:'Проверить сообщение'})).not.toBeInTheDocument());
  const calls=s.calls.filter(c=>c.path.endsWith('/messages'));expect(calls).toHaveLength(2);expect(calls[0].key).toBe(calls[1].key);expect(calls[0].body).toEqual(calls[1].body);expect(s.item.info_requests![0].messages).toHaveLength(1);
 });
 it('shows a pending initial request even when it has already reached the client',async()=>{
  const s=server(staff);let lose=true;const api=createApi((async(input:RequestInfo|URL,init?:RequestInit)=>{const response=await s.fetcher(input,init);if(String(input).endsWith('/info-requests')&&lose){lose=false;throw Error('lost');}return response;}) as typeof fetch);
  const first=render(<InfoRequests api={api} session={staff} application={s.item} {...props}/>);
  fireEvent.change(screen.getByLabelText('Запрос сведений'),{target:{value:'Расходы'}});fireEvent.click(screen.getByRole('button',{name:'Запросить сведения'}));
  await screen.findByRole('button',{name:'Проверить запрос'});first.unmount();render(<InfoRequests api={api} session={staff} application={s.item} {...props}/>);
  fireEvent.click(screen.getByRole('button',{name:'Проверить запрос'}));await waitFor(()=>expect(screen.queryByRole('button',{name:'Проверить запрос'})).not.toBeInTheDocument());expect(s.item.info_requests).toHaveLength(1);
 });
 it('offers an accessible retry of final submission after reload into a closed request',async()=>{
  const s=server(client);s.open();let lose=true;const api=createApi((async(input:RequestInfo|URL,init?:RequestInit)=>{const response=await s.fetcher(input,init);if(String(input).endsWith('/reply/submit')&&lose){lose=false;throw Error('lost');}return response;}) as typeof fetch);
  const first=render(<InfoRequests api={api} session={client} application={s.item} {...props}/>);fireEvent.change(screen.getByLabelText('Сообщение по запросу'),{target:{value:'Уточнено'}});fireEvent.click(screen.getByRole('button',{name:'Отправить ответ'}));
  await screen.findByRole('button',{name:'Проверить отправку ответа'});first.unmount();render(<InfoRequests api={api} session={client} application={s.item} {...props}/>);
  expect(screen.getByRole('button',{name:'Проверить отправку ответа'})).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'Проверить отправку ответа'}));await waitFor(()=>expect(screen.queryByRole('button',{name:'Проверить отправку ответа'})).not.toBeInTheDocument());expect(s.item.status).toBe('NEEDS_INFO');
 });
 it('recovers corrupted local receipts through an authorised GET',async()=>{
  const s=server(staff);sessionStorage.setItem(`credit-info:${staff.user.id}:${s.item.id}:new:create`,'broken');vi.spyOn(window,'confirm').mockReturnValue(true);
  render(<InfoRequests api={s.api} session={staff} application={s.item} {...props}/>);expect(screen.getByRole('alert')).toHaveTextContent('повреждены');
  fireEvent.click(screen.getByRole('button',{name:'Обновить карточку'}));await waitFor(()=>expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  fireEvent.change(screen.getByLabelText('Запрос сведений'),{target:{value:'Уточните'}});fireEvent.click(screen.getByRole('button',{name:'Запросить сведения'}));await waitFor(()=>expect(s.item.status).toBe('NEEDS_INFO'));
 });
 it('keeps input on conflict and stops automatic retries until explicit recovery',async()=>{
  const s=server(client);s.open();const api=createApi((async(input:RequestInfo|URL,init?:RequestInit)=>String(input).endsWith('/reply')?new Response(JSON.stringify({error:{code:'VERSION_CONFLICT',message:'Сведения изменились'}}),{status:409}):s.fetcher(input,init)) as typeof fetch);
  render(<InfoRequests api={api} session={client} application={s.item} {...props}/>);fireEvent.change(screen.getByLabelText('Сообщение по запросу'),{target:{value:'Мой ответ'}});fireEvent.click(screen.getByRole('button',{name:'Отправить ответ'}));
  await screen.findByRole('alert');expect(screen.getByLabelText('Сообщение по запросу')).toHaveValue('Мой ответ');expect(s.item.status).toBe('NEEDS_INFO');expect(s.calls.some(c=>c.path.endsWith('/reply/submit'))).toBe(false);
 });
 it('ignores a late save after the profile changes and after disposal',async()=>{
  const s=server(client);s.open();let release!:()=>void;const gate=new Promise<void>(r=>release=r);let changed=false;
  const api=createApi((async(input:RequestInfo|URL,init?:RequestInit)=>{if(String(input)==='/api/v1/me'&&changed)return new Response(JSON.stringify(staff));if(init?.method==='PATCH')await gate;return s.fetcher(input,init);}) as typeof fetch);
  const updated=vi.fn(),scope=vi.fn();render(<InfoRequests api={api} session={client} application={s.item} onUpdated={updated} onSessionChanged={scope}/>);fireEvent.change(screen.getByLabelText('Сообщение по запросу'),{target:{value:'Мой ответ'}});fireEvent.click(screen.getByRole('button',{name:'Отправить ответ'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Отправляем…'})).toBeDisabled());changed=true;await act(async()=>release());await waitFor(()=>expect(scope).toHaveBeenCalled());expect(updated).not.toHaveBeenCalled();
 });
});


it('flushes response before leaving the application and warns about an unsaved message',async()=>{
 window.history.replaceState(null,'','/');const s=server(client);s.open();let release!:()=>void;s.hold(new Promise<void>(r=>release=r));
 const api=createApi((async(input:RequestInfo|URL,init?:RequestInit)=>String(input)==='/api/v1/applications'&&!init?.method?new Response(JSON.stringify({items:[s.item]})):s.fetcher(input,init)) as typeof fetch);
 render(<App api={api}/>);fireEvent.click(await screen.findByRole('button',{name:/Открыть заявку/}));
 fireEvent.change(await screen.findByLabelText('Сообщение по запросу'),{target:{value:'Ответ перед уходом'}});
 const unload=new Event('beforeunload',{cancelable:true});window.dispatchEvent(unload);expect(unload.defaultPrevented).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'Все заявки'}));await waitFor(()=>expect(s.calls.some(c=>c.path.endsWith('/reply'))).toBe(true));expect(screen.getByLabelText('Сообщение по запросу')).toBeInTheDocument();
 await act(async()=>release());await screen.findByRole('heading',{name:'Мои заявки'});expect(s.item.info_requests![0].reply_text).toBe('Ответ перед уходом');
 fireEvent.click(screen.getByRole('button',{name:/Открыть заявку/}));fireEvent.change(await screen.findByLabelText('Сообщение по запросу'),{target:{value:'Неотправленный вопрос'}});
 fireEvent.click(screen.getByRole('button',{name:'Все заявки'}));expect(screen.getByLabelText('Сообщение по запросу')).toHaveValue('Неотправленный вопрос');
});

it('a rejected file can be replaced without keeping a broken upload receipt',async()=>{
 const s=server(client,true);s.open();let reject=true;
 const api=createApi((async(input:RequestInfo|URL,init?:RequestInit)=>{if(init?.method==='PUT'&&reject){reject=false;return new Response(JSON.stringify({error:{code:'FILE_FORMAT',message:'Содержимое не похоже на PDF'}}),{status:415});}return s.fetcher(input,init);}) as typeof fetch);
 render(<InfoRequests api={api} session={client} application={s.item} {...props}/>);
 fireEvent.change(screen.getByLabelText('Прикрепить документ'),{target:{files:[new File(['fake'],'bad.pdf',{type:'application/pdf'})]}});fireEvent.click(screen.getByRole('button',{name:'Загрузить документ'}));await screen.findByText('Содержимое не похоже на PDF');
 fireEvent.change(screen.getByLabelText('Прикрепить документ'),{target:{files:[new File(['abc'],'test.pdf',{type:'application/pdf'})]}});fireEvent.click(screen.getByRole('button',{name:'Загрузить документ'}));await waitFor(()=>expect(s.item.info_requests![0].attachments).toHaveLength(1));expect(screen.queryByText(/Загрузка «bad.pdf»/)).not.toBeInTheDocument();
});

it('restores an acknowledged upload after a lost response and reload',async()=>{
 const s=server(client,true);s.open();const api=createApi((async(input:RequestInfo|URL,init?:RequestInit)=>{const response=await s.fetcher(input,init);if(init?.method==='PUT')throw Error('lost');return response;}) as typeof fetch);
 const view=render(<InfoRequests api={api} session={client} application={s.item} {...props}/>);fireEvent.change(screen.getByLabelText('Прикрепить документ'),{target:{files:[new File(['abc'],'test.pdf',{type:'application/pdf'})]}});fireEvent.click(screen.getByRole('button',{name:'Загрузить документ'}));await screen.findByRole('alert');view.unmount();
 render(<InfoRequests api={api} session={client} application={s.item} {...props}/>);await screen.findByRole('button',{name:'test.pdf'});expect(screen.queryByText(/ещё не подтверждена/)).not.toBeInTheDocument();expect(s.item.info_requests![0].attachments).toHaveLength(1);
});

it.each([staff])('keeps a visible message retry after closure for $user.role',async role=>{
 const s=server(role);s.open();let lose=true;const api=createApi((async(input:RequestInfo|URL,init?:RequestInit)=>{const response=await s.fetcher(input,init);if(String(input).endsWith('/messages')&&lose){lose=false;throw Error('lost');}return response;}) as typeof fetch);
 const first=render(<InfoRequests api={api} session={role} application={s.item} {...props}/>);
 fireEvent.change(screen.getByLabelText('Сообщение по запросу'),{target:{value:'Вопрос с потерянным подтверждением'}});fireEvent.click(screen.getByRole('button',{name:'Отправить сообщение'}));await screen.findByRole('button',{name:'Проверить сообщение'});first.unmount();
 s.item.status='UNDER_REVIEW';s.item.info_requests![0].closed_at='2026-10-24T02:00:00Z';const register=vi.fn();render(<InfoRequests api={api} session={role} application={s.item} {...props} register={register}/>);
 const retry=screen.getByRole('button',{name:'Проверить сообщение'});expect(retry).toBeVisible();expect(screen.queryByRole('button',{name:'Отправить сообщение'})).not.toBeInTheDocument();fireEvent.click(retry);
 await waitFor(()=>expect(screen.queryByRole('button',{name:'Проверить сообщение'})).not.toBeInTheDocument());expect(s.item.info_requests![0].messages).toHaveLength(1);await waitFor(()=>expect(register.mock.calls.at(-1)?.[0]?.dirty).toBe(false));
});
