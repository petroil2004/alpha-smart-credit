import {beforeEach,expect,it,vi} from 'vitest';
import {readAttempt,saveAttempt,clearAttempt} from './submission';
const attempt={key:'10000000-0000-4000-8000-000000000001',body:{version:2,profile_version:'v1',catalog_version:'v1',confirmed:true as const}};
beforeEach(()=>sessionStorage.clear());
it('preserves exact retry scoped by user and application',()=>{
 saveAttempt('u','a',attempt); expect(readAttempt('u','a')).toEqual(attempt);expect(readAttempt('other','a')).toBeNull();clearAttempt('u','a');expect(readAttempt('u','a')).toBeNull();
});
it('rejects corrupt stored receipt and reports unavailable storage',()=>{
 saveAttempt('u','a',attempt);
 const key=sessionStorage.key(0)!;sessionStorage.setItem(key,'{"key":"bad","body":{}}');expect(()=>readAttempt('u','a')).toThrow();
 const spy=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('denied');});
 try{expect(()=>saveAttempt('u','b',attempt)).toThrow(/сохранить.*повтора/i);}finally{spy.mockRestore();}
});
