import {fireEvent} from '@testing-library/react';
import {ParameterFields} from './components/draft/DraftFields';
import {prepareDraftPayload} from './draft';
import {render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach,expect,it,vi} from 'vitest';
import App from './App';
import StaffApplications from './components/StaffApplications';
import {application,contractServer} from './test/api-fixtures';
import {createApi} from './api';
import {draftReadiness} from './draft-readiness';
import {fromApplication} from './draft';

beforeEach(()=>{window.history.replaceState(null,'','/');sessionStorage.clear();});
it('opens the matching application from an unread notification and marks it read',async()=>{
 const item=application({status:'NEEDS_INFO'}),server=contractServer({loggedIn:true,applications:[item]});
 let read=false;const notice={id:9,application_id:item.id,status:'NEEDS_INFO',title:'Банк запросил уточнения',message:null,occurred_at:item.updated_at,read:false};
 const notifications={list:vi.fn(async()=>({items:[{...notice,read}],unread_count:read?0:1})),read:vi.fn(async()=>{read=true;})};
 const user=userEvent.setup();render(<App api={{...createApi(server.fetcher),notifications}}/>);
 await user.click(await screen.findByRole('button',{name:'Уведомления: 1 непрочитанных'}));
 await user.click(await screen.findByRole('button',{name:/Банк запросил уточнения/}));
 expect(await screen.findByRole('heading',{name:'Нужны дополнительные сведения'})).toBeInTheDocument();
 await waitFor(()=>expect(notifications.read).toHaveBeenCalledWith(9));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Уведомления'})).toBeInTheDocument());
 expect(screen.getByRole('heading',{name:'Путь заявки'})).toBeInTheDocument();
 expect(screen.getByText('История заявки').closest('details')).not.toHaveAttribute('open');
});
it('separates completed applications and filters the active tab by status',async()=>{
 const user=userEvent.setup(),onOpen=vi.fn();
 const items=['UNDER_REVIEW','NEEDS_INFO','APPROVED','DECLINED'].map((status,index)=>application({id:`id-${index}`,company_name:`Компания ${index}`,application_number:index+1,status}));
 render(<StaffApplications items={items} busy={false} onOpen={onOpen} onRefresh={()=>{}}/>);
 expect(screen.getByText('Компания 0')).toBeVisible();expect(screen.queryByText('Компания 2')).not.toBeInTheDocument();
 await user.selectOptions(screen.getByLabelText('Статус'),'NEEDS_INFO');
 expect(screen.queryByText('Компания 0')).not.toBeInTheDocument();expect(screen.getByText('Компания 1')).toBeVisible();
 await user.click(screen.getByRole('button',{name:'Завершённые (2)'}));
 expect(screen.getByLabelText('Статус')).toHaveValue('ALL');
 await user.selectOptions(screen.getByLabelText('Статус'),'APPROVED');
 expect(screen.queryByText('Компания 3')).not.toBeInTheDocument();
 await user.click(screen.getByRole('button',{name:'Открыть заявку 000003'}));expect(onOpen).toHaveBeenCalledWith('id-2');
});
it('requires all product-specific parameters before review',()=>{
 const fields=fromApplication(application({product_code:'working_capital',purpose:'Товар',amount_rub:'500000.00',term_months:12}));
 expect(draftReadiness(fields)).toEqual({product:true,details:true});
 expect(draftReadiness({...fields,purpose:' '})).toEqual({product:true,details:false});
 expect(draftReadiness({...fields,product_code:'equipment'}).details).toBe(true);
 expect(draftReadiness({...fields,product_code:'equipment',equipment_cost_rub:'600000'}).details).toBe(true);
 const overdraft={...fields,product_code:'overdraft' as const,usage_days:'14',planned_payment_rub:'100000',planned_payment_date:'2026-10-25',expected_inflow_date:'2026-11-01',expected_inflow_amount_rub:'150000',expected_inflow_source:'BUYER' as const};
 expect(draftReadiness(overdraft).details).toBe(true);
 expect(draftReadiness({...overdraft,expected_inflow_source:''}).details).toBe(false);
 expect(draftReadiness({...overdraft,planned_payment_date:'2026-02-31'}).details).toBe(false);
});

it('caps the date year at four digits and derives overdraft days from the dates',()=>{
 const fields=fromApplication(application({product_code:'overdraft',planned_payment_date:'2026-10-25',expected_inflow_date:'2026-11-08'}));
 const change=vi.fn();render(<ParameterFields fields={fields} errors={{}} onChange={change}/>);
 expect(screen.queryByLabelText('Пользование, дней')).not.toBeInTheDocument();
 const input=screen.getByLabelText('Дата использования средств');expect(input).toHaveAttribute('maxlength','10');
 fireEvent.change(input,{target:{value:'10.11.202612'}});
 expect(change).toHaveBeenCalledWith('planned_payment_date','2026-11-10');
 expect(prepareDraftPayload(fields).payload.usage_days).toBe(14);
});

it('shows logical errors for overdraft use above the limit and insufficient repayment',async()=>{
 const {draftConstraints}=await import('./draft-constraints');
 const fields=fromApplication(application({product_code:'overdraft',amount_rub:'100000.00',planned_payment_rub:'100001.00',planned_payment_date:'2099-10-24',expected_inflow_date:'2099-11-01',expected_inflow_amount_rub:'90000.00'}));
 const catalog={catalog_version:'test',items:[{code:'overdraft',amount_min_rub:'50000.00',amount_max_rub:'2000000.00',usage_min_days:1,usage_max_days:60,annual_rate_percent:'26.00'}]} as import('./types').ProductCatalog;
 const errors=draftConstraints(fields,catalog);
 expect(errors.planned_payment_rub).toContain('не может превышать лимит');
 expect(errors.expected_inflow_amount_rub).toContain('проценты');
});
