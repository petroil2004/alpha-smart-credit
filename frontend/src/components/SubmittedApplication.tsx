import type {Application} from '../types';
import {formatMoneyRub} from '../draft';
import CompanyDataView from './CompanyDataView';
import {products} from '../products';
import StatusBadge,{statusLabel} from './StatusBadge';
export {statusLabel} from './StatusBadge';
const date = (value: string) => new Intl.DateTimeFormat('ru-RU',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Moscow'}).format(new Date(value));
export default function SubmittedApplication({application,staff=false}:{application:Application;staff?:boolean}) {
  const snapshot=application.submission?.snapshot;
  const values=snapshot?.application ?? application;
  const calc:any=snapshot?.calculation;
  const decision=application.history?.slice().reverse().find(event=>event.reason_code==='STAFF_APPROVED'||event.reason_code==='STAFF_DECLINED');
  return <section className="form-card submitted-card" aria-label="Отправленная заявка">
    <h1>{application.status==='ISSUED'?'Финансирование оформлено':application.status==='NEEDS_INFO'?'Нужны дополнительные сведения':application.status==='UNDER_REVIEW' ? 'Заявка на рассмотрении' : application.status==='APPROVED'?'Заявка одобрена':application.status==='DECLINED'?'По заявке принято решение':'Отправленная заявка'}</h1>
    <p>{application.status==='ISSUED'?'Клиент подтвердил получение финансирования. Демонстрационная операция завершена.':application.status==='NEEDS_INFO'?(staff?'Ждём ответ клиента на запрос ниже.':'Ответьте на запрос банка ниже и отправьте сведения на рассмотрение.'):application.status==='APPROVED'?(staff?'Вы подтвердили положительное решение.':'Сотрудник подтвердил положительное решение по демонстрационной заявке.'):application.status==='DECLINED'?(staff?'Вы подтвердили отказ.':'Сотрудник принял итоговое решение с указанной причиной в истории заявки.'):staff?'Изучите заявку. При необходимости запросите сведения ниже.':'Дополнительные действия пока не требуются. Если понадобятся сведения, мы сообщим здесь.'}</p>
    {decision?.comment&&<p className="decision-comment"><strong>Причина решения: </strong>{decision.comment}</p>}
    {application.status==='APPROVED'&&<h2>Одобренные условия</h2>}
    <dl className="submitted-details">
      {staff&&<div><dt>Компания</dt><dd>{snapshot?.company.company_name ?? application.company_name}</dd></div>}
      <div><dt>Статус</dt><dd><StatusBadge status={application.status}/></dd></div>
      {application.submitted_at && <div><dt>Отправлена</dt><dd>{date(application.submitted_at)}</dd></div>}
      <div><dt>Продукт</dt><dd>{products.find(p=>p.code===values.product_code)?.title ?? 'Не указан'}</dd></div>
      <div><dt>Цель</dt><dd>{values.purpose ?? 'Не указана'}</dd></div>
      <div><dt>{values.product_code==='overdraft'?'Лимит овердрафта':'Сумма'}</dt><dd>{formatMoneyRub(values.amount_rub)}</dd></div>
      {values.product_code==='overdraft'?<><div><dt>Сумма использования лимита</dt><dd>{formatMoneyRub(values.planned_payment_rub)}</dd></div><div><dt>Срок использования</dt><dd>{values.usage_days} дн.</dd></div><div><dt>К возврату по расчёту</dt><dd>{formatMoneyRub(calc?.due_rub ?? null)}</dd></div></>:<><div><dt>Срок</dt><dd>{values.term_months} мес.</dd></div></>}
      {calc && <><div><dt>Ставка на момент отправки</dt><dd>{calc.annual_rate_percent}% годовых</dd></div>
      {calc.monthly_payment_rub&&<div><dt>Ежемесячный платёж</dt><dd>{formatMoneyRub(calc.monthly_payment_rub)}</dd></div>}
      {calc.total_payment_rub&&<div><dt>Общая сумма выплат</dt><dd>{formatMoneyRub(calc.total_payment_rub)}</dd></div>}
      {calc.overpayment_rub&&<div><dt>Переплата</dt><dd>{formatMoneyRub(calc.overpayment_rub)}</dd></div>}</>}
    </dl>
    <p className="small-note">{['APPROVED','ISSUED'].includes(application.status)?'Одобренные параметры зафиксированы. Операции демонстрационные.':'Параметры зафиксированы при отправке. Расчёт не означает одобрения.'} Все данные и условия демонстрационные.</p>
    {staff && snapshot && <p className="small-note">Сведения компании — синтетические данные банка. Подтверждение клиента не заменяет банковскую проверку.</p>}
    {staff&&<CompanyDataView profile={application.verified_company??snapshot?.company} historical/>}
    <details className="company-disclosure"><summary>История заявки</summary>
    <ol className="submission-history">{application.history?.map(event=><li key={event.id}><strong>{({STAFF_PROFILE_CORRECTED:'Сотрудник скорректировал профиль компании',STAFF_FINANCIAL_CORRECTED:'Сотрудник уточнил финансовые показатели',FINANCIAL_INFO_ACCEPTED:'Сотрудник принял финансовые сведения',INFO_REQUESTED:'Сотрудник запросил сведения',INFO_REPLY_SAVED:'Клиент сохранил черновик ответа',INFO_REPLY_SUBMITTED:'Клиент отправил ответ в чат',INFO_REQUEST_CLOSED:'Сотрудник завершил уточнение',INFO_MESSAGE:'Добавлено сообщение по запросу',INFO_FILE_ATTACHED:'Клиент прикрепил документ',INFO_FILE_DETACHED:'Клиент открепил документ'} as Record<string,string>)[event.reason_code]??(event.to_status==='SUBMITTED' ? 'Клиент отправил заявку' : event.to_status==='UNDER_REVIEW' ? 'Система зарегистрировала заявку на рассмотрение' : statusLabel(event.to_status))}</strong><span>{date(event.occurred_at)}</span></li>)}</ol></details>
    {staff&&!['UNDER_REVIEW','NEEDS_INFO'].includes(application.status)&&application.assessment&&<details className="company-disclosure assessment-summary"><summary>Результат проверки</summary><p>{application.assessment.score===null?'Не рассчитан: '+application.assessment.missing.join(', '):`Балл: ${application.assessment.score}/100 · ${application.assessment.group==='LOW'?'низкий':application.assessment.group==='MEDIUM'?'средний':'высокий'} риск`}</p><ul>{application.assessment.reasons.map(reason=><li key={reason}>{reason}</li>)}</ul></details>}
  </section>;
}
