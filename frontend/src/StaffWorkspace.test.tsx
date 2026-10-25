import {render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach,it,expect,vi} from 'vitest';
import App from './App';
import ManualFinancial from './components/ManualFinancial';
import {createApi} from './api';
import {application,contractServer} from './test/api-fixtures';
import type {InfoRequest,StaffSession} from './types';
const staff:StaffSession={user:{id:'demo-staff-1',name:'Демо-сотрудник',role:'STAFF'},company:null};
beforeEach(()=>{sessionStorage.clear();window.history.replaceState(null,'','/');});
it('opens the employee profile from the header',async()=>{
 const server=contractServer();server.setSession(staff);
 const api={...createApi(server.fetcher),staffProfile:vi.fn(async()=>({account_id:staff.user.id,full_name:'Иванов Иван Иванович',position:'Кредитный аналитик',department:'Малый бизнес',city:'Москва',source:'DEMO' as const}))};
 const user=userEvent.setup();render(<App api={api}/>);
 await user.click(await screen.findByRole('button',{name:'Профиль сотрудника: Демо-сотрудник'}));
 expect(await screen.findByText('Иванов Иван Иванович')).toBeVisible();
 expect(screen.getByText('Москва')).toBeVisible();
 await user.click(screen.getByRole('button',{name:'На главную'}));
 expect(await screen.findByRole('heading',{name:'Поступившие заявки'})).toBeVisible();
});
it('lets staff explicitly enter a zero debt payment with an audit reason after a client reply',async()=>{
 const request:InfoRequest={id:'r',question:'Расходы и долги',reason:'Проверка',document_required:false,revision:3,reply_text:'Документ предоставлен',source:'SELF_REPORTED',created_at:'2026-10-25T00:00:00Z',created_by:staff.user.id,reply_by:'demo-client-1',closed_at:'2026-10-25T01:00:00Z',closed_by:'demo-client-1',messages:[],attachments:[]};
 const item=application({status:'UNDER_REVIEW',info_requests:[request]});
 const server=contractServer();server.setSession(staff);
 const api=createApi(server.fetcher),accept=vi.fn(),register=vi.fn();api.info!.correctFinancial=vi.fn(async()=>({...item,version:2}));
 const user=userEvent.setup();render(<ManualFinancial api={api} application={item} request={request} session={staff} guard={async()=>{}} accept={accept} register={register}/>);
 await user.click(screen.getByRole('button',{name:'Скорректировать финансовые данные'}));
 expect(screen.getByRole('button',{name:'Сохранить и пересчитать'})).toBeDisabled();
 await user.type(screen.getByLabelText('Текущие платежи по долгам'),'0');
 await user.type(screen.getByLabelText('Основание ручного уточнения'),'Проверено по справке клиента');
 await user.click(screen.getByRole('button',{name:'Сохранить и пересчитать'}));
 await waitFor(()=>expect(accept).toHaveBeenCalledWith({...item,version:2}));
 expect(api.info!.correctFinancial).toHaveBeenCalledWith(item.id,'r',{version:1,reason:'Проверено по справке клиента',values:[{kind:'debt_payment_rub',month:null,value_rub:'0'}]},expect.any(String));
});

it('offers finance or company profile and creates six rows when the snapshot has no finance',async()=>{
 const {default:DataCorrections}=await import('./components/DataCorrections');
 const request:InfoRequest={id:'r',question:'Уточните данные',reason:'',document_required:false,revision:3,reply_text:'',source:'SELF_REPORTED',created_at:'2026-10-25T00:00:00Z',created_by:staff.user.id,reply_by:'demo-client-1',reply_submitted_at:'2026-10-25T01:00:00Z',closed_at:null,closed_by:null,messages:[],attachments:[]};
 const item=application({status:'NEEDS_INFO',info_requests:[request]});
 const api=createApi(contractServer().fetcher),user=userEvent.setup();
 render(<DataCorrections api={api} application={item} request={request} session={staff} guard={async()=>{}} accept={vi.fn()} register={vi.fn()}/>);
 await user.click(screen.getByRole('button',{name:'Скорректировать данные'}));
 await user.selectOptions(screen.getByLabelText('Что корректируем'),'finance');
 expect(screen.getAllByRole('row')).toHaveLength(7);
 expect(screen.getAllByPlaceholderText('Нет сведений')).toHaveLength(12);
 await user.selectOptions(screen.getByLabelText('Что корректируем'),'profile');
 expect(screen.getByRole('region',{name:'Корректировка профиля компании'})).toBeVisible();
 expect(screen.getByLabelText('ИНН')).toBeVisible();
});
