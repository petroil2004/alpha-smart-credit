import {render,screen,fireEvent,within} from '@testing-library/react';
import {describe,it,expect} from 'vitest';
import CompanyDataView from './components/CompanyDataView';
import {companyProfile} from './test/company-fixtures';

describe('company profile read-only view',()=>{
 it('shows six months, separate debt and server averages in disclosure panels',()=>{
  render(<CompanyDataView profile={companyProfile()}/>);
  fireEvent.click(screen.getByText('Профиль компании',{exact:true}));
  expect(screen.getByText('24.10.2023')).toBeVisible();expect(screen.getByText('36 мес.')).toBeVisible();
  fireEvent.click(screen.getByText('Финансовые данные за шесть месяцев',{exact:true}));
  expect(screen.getAllByRole('row')).toHaveLength(7);
  expect(screen.getByText('Апрель 2026')).toBeVisible();expect(screen.getByText('Сентябрь 2026')).toBeVisible();
  expect(screen.getByText('Текущие платежи по долгам, ₽/мес.').nextElementSibling).toHaveTextContent('30 000');
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
 });
 it('keeps missing values distinct from zero and does not invent an average',()=>{
  const p=companyProfile();p.finance!.months[0].expenses_rub=null;p.finance!.months[1].expenses_rub='0.00';p.finance!.average_expenses_rub=null;
  render(<CompanyDataView profile={p}/>);fireEvent.click(screen.getByText('Финансовые данные за шесть месяцев',{exact:true}));
  const rows=screen.getAllByRole('row');expect(within(rows[1]).getByText('Нет сведений')).toBeVisible();expect(within(rows[2]).getByText('0,00 ₽')).toBeVisible();expect(screen.getByText('Недостаточно данных')).toBeVisible();
 });
 it('marks missing historical fields without borrowing current company data',()=>{
  render(<CompanyDataView historical profile={{company_id:'old',company_name:'Старое имя',profile_version:'v1',source:'BANK_DATA'}}/>);
  fireEvent.click(screen.getByText('Профиль компании',{exact:true}));fireEvent.click(screen.getByText('Финансовые данные за шесть месяцев',{exact:true}));
  expect(screen.getAllByText('Не зафиксировано при отправке').length).toBeGreaterThan(0);
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
 });
});

it('preserves kopecks in large stored monetary strings',()=>{
 const p=companyProfile();p.finance!.months[0].income_rub='9999999999999999.01';render(<CompanyDataView profile={p}/>);fireEvent.click(screen.getByText('Финансовые данные за шесть месяцев',{exact:true}));expect(screen.getByText('9 999 999 999 999 999,01 ₽')).toBeVisible();
});
