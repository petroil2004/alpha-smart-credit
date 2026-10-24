import {describe,it,expect,vi} from 'vitest';
import {createApi,ApiError} from './api';
import {InfoReceipts} from './info-receipts';
import {application} from './test/api-fixtures';
describe('clarification API and durable receipts',()=>{
 it('sends a raw file, encoded filename and revision and downloads bytes from the role route',async()=>{
  const fetcher=vi.fn(async(_input:RequestInfo|URL,init?:RequestInit)=>init?.method==='PUT'?new Response(JSON.stringify({...application(),info_requests:[]})):new Response('file',{headers:{'Content-Type':'text/plain'}}));
  const api=createApi(fetcher as typeof fetch).info!;const file=new File(['abc'],'Справка 1.txt',{type:'text/plain'});
  await api.upload('a','r','f',3,file);const [url,init]=fetcher.mock.calls[0];expect(String(url)).toContain(new URLSearchParams({filename:file.name,revision:'3'}).toString());expect(init?.body).toBe(file);expect(new Headers(init?.headers).get('Content-Type')).toBe('text/plain');
  const blob=await api.download('a','r','f',true);expect(blob.size).toBe(4);expect(fetcher.mock.calls[1][0]).toBe('/api/v1/staff/applications/a/info-requests/r/attachments/f');
 });
 it('does not turn a download error into a file or accept malformed JSON as a confirmed action',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({error:{code:'NOT_FOUND',message:'Файл не найден'}}),{status:404})).mockResolvedValueOnce(new Response('{}'));
  const api=createApi(fetcher).info!;await expect(api.download('a','r','f',false)).rejects.toMatchObject({status:404});await expect(api.message('a','r',false,'x',crypto.randomUUID())).rejects.toMatchObject({status:502});
 });
 it('scopes exact receipts by user, application, request and action and rejects corrupt values',()=>{
  sessionStorage.clear();const store=new InfoReceipts('u','a','r'),receipt={key:crypto.randomUUID(),body:{text:'Вопрос'}};store.save('message',receipt);expect(store.read('message')).toEqual(receipt);expect(new InfoReceipts('u2','a','r').read('message')).toBeNull();expect(new InfoReceipts('u','a','r2').read('message')).toBeNull();expect(store.read('submit')).toBeNull();
  sessionStorage.setItem('credit-info:u:a:r:submit',JSON.stringify({key:crypto.randomUUID(),body:{version:true,revision:1}}));expect(()=>store.read('submit')).toThrow(ApiError);
 });
 it('clearly blocks POST preparation if storage is unavailable',()=>{
  const store=new InfoReceipts('u','a','r');vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('blocked');});expect(()=>store.save('message',{key:crypto.randomUUID(),body:{text:'x'}})).toThrow(/хранилище/);
 });
});
