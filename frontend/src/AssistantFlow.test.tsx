import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import App from './App';
import {createApi} from './api';
import {application,contractServer} from './test/api-fixtures';
import type {AssistantReply,Session} from './types';

beforeEach(()=>{window.history.replaceState(null,'','/');sessionStorage.clear();});
const reply:AssistantReply={answer:'Для покупки оборудования можно рассмотреть кредит на оборудование.',suggested_product:'equipment',products:[],catalog_version:'v1',source:'SERVER_CATALOG',model:'test',disclaimer:'Рекомендация не означает одобрения.'};
function setup(chat:()=>Promise<AssistantReply>){
 const item=application();const server=contractServer({loggedIn:true,applications:[item]});
 const assistant={status:vi.fn(async()=>({enabled:true,available:true,model:'test',reason:null})),chat:vi.fn(chat)};
 const api={...createApi(server.fetcher),assistant};return {item,server,assistant,api};
}
async function open(api:ReturnType<typeof setup>['api']){
 render(<App api={api}/>);fireEvent.click(await screen.findByRole('button',{name:/Открыть заявку/}));
 fireEvent.click(await screen.findByRole('button',{name:'Помочь с выбором'}));
 await waitFor(()=>expect(screen.getByLabelText('Сообщение помощнику')).toBeEnabled());
 fireEvent.change(screen.getByLabelText('Сообщение помощнику'),{target:{value:'Нужна печь для пекарни'}});
 fireEvent.keyDown(screen.getByRole('textbox',{name:'Сообщение помощнику'}),{key:'Enter'});
}
it('chooses the recommended product only after the client explicitly clicks it',async()=>{
 const h=setup(async()=>reply);await open(h.api);
 const choose=await screen.findByRole('button',{name:'Выбрать продукт: Кредит на оборудование'});
 expect(h.server.store.get(h.item.id)?.product_code).toBeNull();
 fireEvent.click(choose);
 expect(screen.getByRole('radio',{name:/Кредит на оборудование/})).toBeChecked();
 fireEvent.click(screen.getByRole('button',{name:'Перейти к шагу «Параметры»'}));
 await waitFor(()=>expect(h.server.store.get(h.item.id)?.product_code).toBe('equipment'));
 expect(h.assistant.chat).toHaveBeenCalledWith({application_id:h.item.id,message:'Нужна печь для пекарни',history:[]});
});
it('drops the answer when another profile has taken over the session',async()=>{
 let finish!:(value:AssistantReply)=>void;const delayed=new Promise<AssistantReply>(resolve=>finish=resolve);
 const h=setup(()=>delayed);await open(h.api);await waitFor(()=>expect(h.assistant.chat).toHaveBeenCalled());
 const staff:Session={user:{id:'demo-staff-1',name:'Сотрудник',role:'STAFF'},company:null};h.server.setSession(staff);
 await act(async()=>finish(reply));await screen.findByRole('button',{name:'Войти в кабинет'});
 expect(screen.queryByRole('button',{name:/Выбрать продукт:/})).not.toBeInTheDocument();
 expect(h.server.store.get(h.item.id)?.product_code).toBeNull();
});
it('keeps Shift+Enter as a newline and sends with plain Enter',async()=>{
 const h=setup(async()=>reply);const {default:userEvent}=await import('@testing-library/user-event');const user=userEvent.setup();
 render(<App api={h.api}/>);
 await user.click(await screen.findByRole('button',{name:/Открыть заявку/}));
 await user.click(screen.getByRole('button',{name:'Помочь с выбором'}));
 const field=screen.getByLabelText('Сообщение помощнику');await waitFor(()=>expect(field).toBeEnabled());
 await user.type(field,'Нужна печь{Shift>}{Enter}{/Shift}Для пекарни');
 expect(field).toHaveValue('Нужна печь\nДля пекарни');expect(h.assistant.chat).not.toHaveBeenCalled();
 await user.keyboard('{Enter}');
 await screen.findByRole('button',{name:'Выбрать продукт: Кредит на оборудование'});
 expect(h.assistant.chat).toHaveBeenCalledTimes(1);
 expect(screen.getByRole('heading',{name:'Выберите продукт'})).toBeInTheDocument();
});
