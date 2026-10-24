import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,it,expect,vi} from 'vitest';
import App from './App';
import {createApi} from './api';
import {application,contractServer} from './test/api-fixtures';
import {companyProfile} from './test/company-fixtures';
import type {CompanyProfile} from './types';

beforeEach(()=>{window.history.replaceState(null,'','/');sessionStorage.clear();});
function setup(profile:()=>CompanyProfile=companyProfile){
 const item=application({purpose:'Закупка',product_code:'working_capital',amount_rub:'3000000.00',term_months:36});
 const server=contractServer({loggedIn:true,applications:[item]});
 const fetcher=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>String(input)==='/api/v1/company-profile'?new Response(JSON.stringify(profile())):server.fetcher(input,init));
 const api=createApi(fetcher as typeof fetch);return {item,api,server,fetcher};
}
async function openParameters(api:ReturnType<typeof createApi>){
 render(<App api={api}/>);fireEvent.click(await screen.findByRole('button',{name:/Открыть заявку/}));
 expect(screen.queryByText('Финансовые данные за шесть месяцев')).not.toBeInTheDocument();
 fireEvent.click(await screen.findByRole('button',{name:'Перейти к шагу «Параметры»'}));
 await screen.findByRole('button',{name:'Перейти к шагу «Проверка»'});
}
it('keeps company data on the separate profile page and out of both draft steps',async()=>{
 const h=setup();await openParameters(h.api);
 expect(screen.queryByText('Финансовые данные за шесть месяцев')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Перейти к шагу «Проверка»'}));
 expect(screen.queryByText('Финансовые данные за шесть месяцев')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:/Профиль компании:/}));
 await screen.findByRole('button',{name:'Обновить сведения компании'});
 fireEvent.click(await screen.findByText('Финансовые данные за шесть месяцев',{exact:true}));expect(await screen.findByText('Апрель 2026')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'На главную'}));
 expect(await screen.findByRole('heading',{name:'Мои заявки'})).toBeInTheDocument();
});
it('returning from an updated company profile requires confirming the draft again',async()=>{
 let p=companyProfile();const h=setup(()=>p);await openParameters(h.api);
 fireEvent.click(screen.getByRole('button',{name:'Перейти к шагу «Проверка»'}));const checkbox=await screen.findByRole('checkbox',{name:/Подтверждаю актуальность/});await waitFor(()=>expect(checkbox).toBeEnabled());fireEvent.click(checkbox);
 fireEvent.click(screen.getByRole('button',{name:/Профиль компании:/}));await screen.findByRole('button',{name:'Обновить сведения компании'});
 p={...p,profile_version:'company-v2:changed'};fireEvent.click(screen.getByRole('button',{name:'Обновить сведения компании'}));
 await screen.findByRole('button',{name:'Обновить сведения компании'});fireEvent.click(screen.getByRole('button',{name:'На главную'}));
 fireEvent.click(await screen.findByRole('button',{name:/Открыть заявку/}));fireEvent.click(await screen.findByRole('button',{name:'Перейти к шагу «Проверка»'}));
 const next=await screen.findByRole('checkbox',{name:/Подтверждаю актуальность/});expect(next).not.toBeChecked();expect(screen.getByRole('button',{name:'Отправить заявку'})).toBeDisabled();
});
it('a malformed financial response blocks confirmation and can be recovered',async()=>{
 let p=companyProfile();p.finance!.months.pop();const h=setup(()=>p);render(<App api={h.api}/>);fireEvent.click(await screen.findByRole('button',{name:/Открыть заявку/}));fireEvent.click(await screen.findByRole('button',{name:'Перейти к шагу «Проверка»'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить сведения');expect(screen.getByRole('checkbox',{name:/Подтверждаю актуальность/})).toBeDisabled();p=companyProfile();fireEvent.click(screen.getByRole('button',{name:'Повторить загрузку сведений'}));await waitFor(()=>expect(screen.getByRole('checkbox',{name:/Подтверждаю актуальность/})).toBeEnabled());
});
it.each(['string bank flag','missing bank flag','reversed period','partial expenses with average','missing live details'])('blocks confirmation for damaged live data: %s',async damage=>{
 const p=companyProfile();
 if(damage==='string bank flag')Object.assign(p.details!,{is_bank_client:'false'});
 if(damage==='missing bank flag')Reflect.deleteProperty(p.details!,'is_bank_client');
 if(damage==='reversed period')p.finance!.period.end_date='2025-01-01';
 if(damage==='partial expenses with average')p.finance!.months[0].expenses_rub=null;
 if(damage==='missing live details')delete p.details;
 const h=setup(()=>p);render(<App api={h.api}/>);fireEvent.click(await screen.findByRole('button',{name:/Открыть заявку/}));fireEvent.click(await screen.findByRole('button',{name:'Перейти к шагу «Проверка»'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить сведения');
 expect(screen.getByRole('checkbox',{name:/Подтверждаю актуальность/})).toBeDisabled();
 expect(screen.getByRole('button',{name:'Отправить заявку'})).toBeDisabled();
});
it('rejects an independent role change while a company response is delayed',async()=>{
 const h=setup();let finish!:(p:CompanyProfile)=>void;const delayed=new Promise<CompanyProfile>(resolve=>finish=resolve);const api={...h.api,companyProfile:vi.fn(()=>delayed)};render(<App api={api}/>);fireEvent.click(await screen.findByRole('button',{name:/Открыть заявку/}));
 await waitFor(()=>expect(api.companyProfile).toHaveBeenCalled());await act(async()=>{await h.api.login('demo-staff-1');finish(companyProfile());});await screen.findByRole('button',{name:'Войти в кабинет'});expect(screen.queryByText('Финансовые данные за шесть месяцев')).not.toBeInTheDocument();
});
it('keeps all six predefined client choices and signs into each without registering',async()=>{
 const server=contractServer();render(<App api={createApi(server.fetcher)}/>);await screen.findByRole('button',{name:'Войти в кабинет'});
 for(let n=1;n<=6;n++){
  fireEvent.change(screen.getByLabelText('Демонстрационный профиль'),{target:{value:'demo-client-'+n}});fireEvent.click(screen.getByRole('button',{name:'Войти в кабинет'}));await screen.findByRole('heading',{name:'Мои заявки'});fireEvent.click(screen.getByRole('button',{name:'Сменить профиль'}));await screen.findByRole('button',{name:'Войти в кабинет'});
 }
 expect(screen.getAllByRole('option')).toHaveLength(7);
});

it('opens a legacy submitted application without requesting today’s profile',async()=>{
 const item=application({status:'UNDER_REVIEW'});const server=contractServer({loggedIn:true,applications:[item]});
 const api={...createApi(server.fetcher),companyProfile:vi.fn(async()=>companyProfile())};render(<App api={api}/>);fireEvent.click(await screen.findByRole('button',{name:/Открыть заявку/}));await screen.findByRole('heading',{name:'Заявка на рассмотрении'});
 expect(screen.queryByText('Финансовые данные за шесть месяцев')).not.toBeInTheDocument();expect(api.companyProfile).not.toHaveBeenCalled();
});

it.each([['working_capital','Оборотный кредит'],['equipment','Кредит на оборудование'],['overdraft','Овердрафт']])('creates a draft with the clicked product %s',async(code,title)=>{
 const server=contractServer({loggedIn:true});render(<App api={createApi(server.fetcher)}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Оформить: '+title}));
 await screen.findByRole('button',{name:'Перейти к шагу «Параметры»'});
 expect([...server.store.values()][0].product_code).toBe(code);
 expect(window.location.hash).toMatch(/^#draft\//);
});
