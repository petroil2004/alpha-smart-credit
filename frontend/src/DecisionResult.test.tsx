import {render,screen} from '@testing-library/react';
import {expect,it} from 'vitest';
import SubmittedApplication from './components/SubmittedApplication';
import ReviewPanel from './components/ReviewPanel';
import type {Api,Assessment} from './types';
import {application} from './test/api-fixtures';

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
