import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach,expect,it} from 'vitest';
import App from './App';
import {createApi} from './api';
import {application,contractServer,session} from './test/api-fixtures';
import type {Session} from './types';
const staff:Session={user:{id:'demo-staff-1',name:'Демо-сотрудник',role:'STAFF'},company:null};
beforeEach(()=>{window.history.replaceState(null,'','/');sessionStorage.clear();});
async function submittedServer(){
 const item=application({product_code:'working_capital',purpose:'Исходная цель',amount_rub:'3000000.00',term_months:36});
 const server=contractServer({loggedIn:true,applications:[item]});
 const api=createApi(server.fetcher);
 await api.submit(item.id,{version:1,profile_version:'profile-v1',catalog_version:'2026-10-23.1',confirmed:true},crypto.randomUUID());
 server.setSession(staff);
 return {item,server,api};
}
it('staff sees queue and frozen snapshot',async()=>{
 const h=await submittedServer();
 h.server.store.set(h.item.id,{...h.server.store.get(h.item.id)!,purpose:'Поздняя подмена'});
 const user=userEvent.setup();render(<App api={h.api}/>);
 expect(await screen.findByRole('heading',{name:'Поступившие заявки'})).toBeInTheDocument();
 await user.click(screen.getByRole('button',{name:/Открыть заявку/}));
 expect(await screen.findByText('Исходная цель')).toBeInTheDocument();
 expect(screen.queryByText('Поздняя подмена')).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:/Изменить|Отправить|Удалить|Новая заявка/})).not.toBeInTheDocument();
});
it('staff cannot create draft and can log in through demo selector',async()=>{
 const h=contractServer();const user=userEvent.setup();render(<App api={createApi(h.fetcher)}/>);
 await user.selectOptions(await screen.findByLabelText('Демонстрационный профиль'),'demo-staff-1');
 await user.click(screen.getByRole('button',{name:'Войти в кабинет'}));
 expect(await screen.findByRole('heading',{name:'Поступившие заявки'})).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Новая заявка'})).not.toBeInTheDocument();
 expect(screen.getByRole('heading',{name:'Поступивших заявок пока нет'})).toBeInTheDocument();
});
it('role switch drops delayed response',async()=>{
 const h=await submittedServer();let release!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;});
 const api={...h.api,staffGet:async(id:string)=>{const result=await h.api.staffGet(id);await gate;return result;}};
 const user=userEvent.setup();render(<App api={api}/>);
 await user.click(await screen.findByRole('button',{name:/Открыть заявку/}));
 h.server.setSession(session);await act(async()=>release());
 expect(await screen.findByRole('button',{name:'Войти в кабинет'})).toBeInTheDocument();
 expect(screen.queryByText('Исходная цель')).not.toBeInTheDocument();
});
it('client direct link never uses staff access',async()=>{
 const h=await submittedServer();h.server.setSession({...session,user:{id:'demo-client-2',name:'Клиент 2',role:'CLIENT'},company:{id:'demo-company-2',name:'Другая компания'}});
 window.history.replaceState(null,'',`/#draft/${h.item.id}`);
 render(<App api={h.api}/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('Заявка не найдена');
 expect(screen.queryByText('Исходная цель')).not.toBeInTheDocument();
 expect(h.server.fetcher.mock.calls.some(([url])=>String(url).includes('/staff/'))).toBe(false);
});
it('same_company_different_user_invalidates_session',async()=>{
 const item=application();const h=contractServer({loggedIn:true,applications:[item]});
 const user=userEvent.setup();render(<App api={createApi(h.fetcher)}/>);
 await user.click(await screen.findByRole('button',{name:/Открыть заявку/}));
 await user.click(screen.getByRole('button',{name:'Перейти к шагу «Параметры»'}));
 fireEvent.change(screen.getByLabelText('На что нужны средства'),{target:{value:'Нельзя сохранить чужим пользователем'}});
 h.setSession({...session,user:{...session.user,id:'another-user'}});
 await user.click(screen.getByRole('button',{name:'Перейти к шагу «Продукт»'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Войти в кабинет'})).toBeInTheDocument());
 expect(h.store.get(item.id)?.purpose).toBeNull();
});
