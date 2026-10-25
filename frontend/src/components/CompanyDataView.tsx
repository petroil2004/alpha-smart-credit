import type {CompanyProfile} from '../types';
import {formatMoneyRub} from '../draft';
const unknown='Нет сведений';
const money=(value:string|null)=>value===null?unknown:formatMoneyRub(value);
function date(value:string|null|undefined){
 if(!value)return unknown;
 const parsed=new Date(value+'T00:00:00Z');
 return Number.isNaN(parsed.getTime())?unknown:new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'UTC'}).format(parsed);
}
function month(value:string){
 const name=new Intl.DateTimeFormat('ru-RU',{month:'long',timeZone:'UTC'}).format(new Date(value+'-01T00:00:00Z'));
 return name[0].toUpperCase()+name.slice(1)+' '+value.slice(0,4);
}
function source(value:string|null){return value==='BANK_DATA'?null:<small className="value-source">{value==='STAFF_VERIFIED'?'Проверено сотрудником':value==='SELF_REPORTED'?'Со слов клиента':value==='MOCK_CHECK'?'Имитация проверки':'Источник не указан'}</small>;}
export default function CompanyDataView({profile,historical=false,pending=false}:{profile?:CompanyProfile;historical?:boolean;pending?:boolean}){
 const details=profile?.details,finance=profile?.finance;
 const absent=historical?'Не зафиксировано при отправке':pending?'Загружаем сведения…':'Нет сведений в наборе';
 return <div className="company-data-view">
  <details className="company-disclosure"><summary>Профиль компании</summary>
   {details?<>
    <dl className="company-data-list">
     <div><dt>Организационная форма</dt><dd>{details.legal_form==='OOO'?'ООО':details.legal_form==='IP'?'ИП':unknown}</dd></div>
     <div><dt>ИНН</dt><dd>{details.tax_id??unknown}</dd></div>
     <div><dt>ОКВЭД</dt><dd>{details.okved??unknown}</dd></div>
     <div><dt>Дата регистрации бизнеса</dt><dd>{date(details.registration_date)}</dd></div>
     <div><dt>Возраст бизнеса на дату сведений</dt><dd>{details.business_age_months===null?unknown:details.business_age_months+' мес.'}</dd></div>
     <div><dt>Статус регистрации бизнеса</dt><dd>{details.registration_status==='ACTIVE'?'Действует':details.registration_status==='TERMINATED'?'Деятельность прекращена':unknown}</dd></div>
     <div><dt>Клиент банка</dt><dd>{details.is_bank_client===null?unknown:details.is_bank_client?'Да':'Нет'}</dd></div>
    </dl>
    <p className="small-note">{details.registry_source==='STAFF_VERIFIED'?'Регистрационные сведения проверены сотрудником по материалам уточнения. Все данные синтетические.':'ИНН, ОКВЭД и статус — из локальной имитации ФНС; финансовые сведения синтетические. Реального обращения во внешние сервисы нет.'}</p>
    <p className="small-note">Дата сведений: {date(profile?.as_of_date)}. Набор подготовлен: {date(profile?.prepared_on)}.</p>
   </>:<p className="small-note">{absent}</p>}
  </details>
  <details className="company-disclosure"><summary>Финансовые данные за шесть месяцев</summary>
   {finance?<>
    <p className="small-note">Период: {date(finance.period.start_date)} — {date(finance.period.end_date)}. Все суммы в рублях.</p>
    <p className="small-note">Если не указано иначе — синтетические данные банка. Операционные расходы не включают платежи по долгам.</p>
    <table className="company-finance-table"><caption className="visually-hidden">Поступления и операционные расходы компании</caption><thead><tr><th scope="col">Месяц</th><th scope="col">Поступления</th><th scope="col">Операционные расходы</th></tr></thead>
     <tbody>{finance.months.map(row=><tr key={row.month}><th scope="row">{month(row.month)}</th><td data-label="Поступления">{money(row.income_rub)}{row.income_rub!==null&&source(row.income_source)}</td><td data-label="Операционные расходы">{money(row.expenses_rub)}{row.expenses_rub!==null&&source(row.expenses_source)}</td></tr>)}</tbody>
    </table>
    {finance.months.some(row=>row.income_rub===null||row.expenses_rub===null)&&<p className="small-note">В периоде есть неизвестные значения. Пропуск не означает нулевую сумму.</p>}
    <dl className="company-data-list">
     <div><dt>Средние поступления, ₽/мес.</dt><dd>{finance.average_income_rub===null?'Недостаточно данных':money(finance.average_income_rub)}</dd></div>
     <div><dt>Средние операционные расходы, ₽/мес.</dt><dd>{finance.average_expenses_rub===null?'Недостаточно данных':money(finance.average_expenses_rub)}</dd></div>
     <div><dt>Текущие платежи по долгам, ₽/мес.</dt><dd>{money(finance.debt_payment_rub)}{finance.debt_payment_rub!==null&&source(finance.debt_source)}</dd></div>
    </dl>
    <p className="small-note">Платежи по долгам на {date(finance.debt_as_of)}. Среднее показано только для полного ряда из шести месяцев. Это сводка данных, без оценки риска или одобрения.</p>
    {historical&&<p className="small-note">Исходные данные зафиксированы при отправке заявки. Подтверждённые сотрудником поправки учтены в этой карточке.</p>}
   </>:<p className="small-note">{absent}</p>}
  </details>
 </div>;
}
