import {render,screen} from '@testing-library/react';
import {expect,it} from 'vitest';
import FinancialPulse from './components/FinancialPulse';
import {companyProfile} from './test/company-fixtures';

it('renders the server score, graph and real period without inventing liquidity',()=>{
 const profile=companyProfile();profile.financial_pulse={status:'READY',model_version:'financial-pulse-v2',score:82,level:'GREEN',missing:[],metrics:{average_income_rub:'900000.00',income_change_percent:'0.00',margin_percent:'33.33',debt_load_percent:'10.00',free_flow_rub:'270000.00',margin_level:'GREEN',debt_level:'GREEN'},series:profile.finance!.months.map(row=>({month:row.month,income_rub:row.income_rub!,expenses_rub:row.expenses_rub!}))};
 render(<FinancialPulse profile={profile}/>);
 expect(screen.getByRole('img',{name:'Финансовый пульс: 82 из 100. Стабильно'})).toBeInTheDocument();
 expect(screen.getByRole('img',{name:'Поступления и операционные расходы за шесть месяцев'})).toBeInTheDocument();
 expect(screen.getByText('апрель 2026 — сентябрь 2026')).toBeInTheDocument();
 expect(screen.queryByText(/Запас ликвидности/)).not.toBeInTheDocument();
});

it('shows a useful empty state instead of drawing missing values as zeros',()=>{
 const profile=companyProfile();profile.financial_pulse={status:'INSUFFICIENT_DATA',model_version:'financial-pulse-v1',score:null,level:null,metrics:null,series:[],missing:['операционные расходы за все шесть месяцев']};
 render(<FinancialPulse profile={profile}/>);
 expect(screen.getByText('Не удалось построить финансовый пульс')).toBeInTheDocument();
 expect(screen.getByText(/Нужны: операционные расходы/)).toBeInTheDocument();
 expect(screen.queryByRole('img')).not.toBeInTheDocument();
});
