import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {useState} from 'react';
import SubmittedApplication from './components/SubmittedApplication';
import ReviewPanel from './components/ReviewPanel';
import type {Api,Assessment} from './types';
import {application} from './test/api-fixtures';

it('publishes the refreshed assessment to the whole application card',async()=>{
 const before:Assessment={model_version:'demo',score:90,group:'LOW',recommendation:'KEEP_UNDER_REVIEW',reasons:[],missing:[],formal_checks:[],calculated_at:'2026-10-25T10:00:00Z'};
 const after:Assessment={...before,recommendation:'OFFER_REQUESTED',calculated_at:'2026-10-25T10:01:00Z'};
 const item=application({status:'UNDER_REVIEW',assessment:before});const onUpdated=vi.fn();
 function Card(){const [value,setValue]=useState(item);return <><span data-testid="card-recommendation">{value.assessment?.recommendation}</span><ReviewPanel api={{assessment:vi.fn(async()=>after)} as unknown as Api} application={value} onUpdated={next=>{onUpdated(next);setValue(next);}}/></>;}
 render(<Card/>);
 fireEvent.click(screen.getByText('Проверка и скоринг'));
 fireEvent.click(screen.getByRole('button',{name:'Повторить проверку БКИ'}));
 await waitFor(()=>expect(onUpdated).toHaveBeenCalledWith({...item,assessment:after}));
 expect(screen.getByTestId('card-recommendation')).toHaveTextContent('OFFER_REQUESTED');
 expect(screen.getByRole('button',{name:'Одобрить'})).toBeEnabled();
 expect(screen.queryByText('Повторите внешнюю проверку')).not.toBeInTheDocument();
});

it.each(['APPROVE','DECLINE'] as const)('sends %s only after a separate confirmation and supports cancelling',async decision=>{
 const assessment:Assessment={model_version:'demo',score:90,group:'LOW',recommendation:'OFFER_REQUESTED',reasons:[],missing:[],formal_checks:[],calculated_at:'2026-10-25T10:00:00Z'};
 const item=application({status:'UNDER_REVIEW',assessment,amount_rub:'300000.00',term_months:36,product_code:'working_capital'});
 const decide=vi.fn(async()=>({...item,status:decision==='APPROVE'?'APPROVED':'DECLINED'})),onUpdated=vi.fn();
 render(<ReviewPanel api={{decide} as unknown as Api} application={item} onUpdated={onUpdated}/>);
 fireEvent.change(screen.getByRole('textbox'),{target:{value:'Проверено сотрудником'}});
 const trigger=decision==='APPROVE'?'Одобрить':'Отказать',confirm=decision==='APPROVE'?'Подтвердить одобрение':'Подтвердить отказ';
 fireEvent.click(screen.getByRole('button',{name:trigger}));
 expect(screen.getByRole('dialog')).toBeVisible();expect(decide).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Отмена'}));expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(decide).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:trigger}));fireEvent.click(screen.getByRole('button',{name:confirm}));
 await waitFor(()=>expect(onUpdated).toHaveBeenCalledTimes(1));
 expect(decide).toHaveBeenCalledTimes(1);expect(decide).toHaveBeenCalledWith(item.id,{version:item.version,decision,comment:'Проверено сотрудником'},expect.any(String));
});

it('closes a pending confirmation when the application changes',()=>{
 const assessment:Assessment={model_version:'demo',score:90,group:'LOW',recommendation:'OFFER_REQUESTED',reasons:[],missing:[],formal_checks:[],calculated_at:'2026-10-25T10:00:00Z'};
 const item=application({status:'UNDER_REVIEW',assessment});const decide=vi.fn();
 const view=render(<ReviewPanel api={{decide} as unknown as Api} application={item} onUpdated={()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:'Одобрить'}));expect(screen.getByRole('dialog')).toBeVisible();
 view.rerender(<ReviewPanel api={{decide} as unknown as Api} application={{...item,version:item.version+1,status:'NEEDS_INFO'}} onUpdated={()=>{}}/>);
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(decide).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'Одобрить'})).toBeDisabled();
});

it('shows the staff decision reason to the client',()=>{
 const item=application({status:'DECLINED',history:[{id:1,actor_id:'demo-staff-1',actor_role:'STAFF',from_status:'UNDER_REVIEW',to_status:'DECLINED',reason_code:'STAFF_DECLINED',comment:'Платёж превышает доступный денежный поток',occurred_at:'2026-10-24T10:00:00Z',catalog_version:'2026-10-23.1',offer_version:null,check_version:null}]});
 render(<SubmittedApplication application={item}/>);
 expect(screen.getByText('Платёж превышает доступный денежный поток')).toBeVisible();
});

it('enables the decision when an accepted clarification updates the server assessment',()=>{
 const assessment:Assessment={model_version:'demo-scorecard-v0-temporary',score:null,group:'UNKNOWN',recommendation:'REQUEST_INFO',reasons:[],missing:['расходы'],formal_checks:[],calculated_at:'2026-10-24T10:00:00Z'};
 const item=application({status:'UNDER_REVIEW',assessment});
 const props={api:{} as Api,onUpdated:()=>{}};
 const view=render(<ReviewPanel {...props} application={item}/>);
 expect(screen.getByRole('button',{name:'Одобрить'})).toBeDisabled();
 view.rerender(<ReviewPanel {...props} application={{...item,assessment:{...assessment,score:100,group:'LOW',recommendation:'OFFER_REQUESTED',missing:[]}}}/>);
 expect(screen.getByRole('button',{name:'Одобрить'})).toBeEnabled();
});

it('explains low-risk refusal beside the recommendation and shows both payments',()=>{
 const assessment:Assessment={model_version:'demo',score:90,group:'LOW',recommendation:'RECOMMEND_DECLINE',reasons:[],missing:[],formal_checks:[],calculated_at:'2026-10-25T10:00:00Z',decision_reasons:['Платёж превышает допустимую нагрузку'],affordability:{kind:'MONTHLY_PAYMENT',requested_rub:'150000.00',available_rub:'120000.00'},checks:[{source:'BKI_MOCK',label:'БКИ · локальная имитация',checked_at:'2026-10-25T10:00:00Z',status:'SUCCESS',reason_code:'NO_HISTORY',summary:'Кредитной истории нет; это не просрочка',payload_version:'v1'}]};
 render(<ReviewPanel api={{} as Api} application={application({status:'UNDER_REVIEW',assessment})} onUpdated={()=>{}}/>);
 expect(screen.getByText('Платёж превышает допустимую нагрузку')).toBeInTheDocument();
 expect(screen.getByText('Платёж по заявке')).toBeInTheDocument();
 expect(screen.getByText('Допустимый новый платёж')).toBeInTheDocument();
 expect(screen.getByText('Кредитной истории нет; это не просрочка')).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Одобрить'})).toBeDisabled();
});
