import type {Application} from '../types';
import {formatMoneyRub} from '../draft';
import CompanyDataView from './CompanyDataView';
import {products} from '../products';
export function statusLabel(status: string) {
  return status === 'DRAFT' ? 'Черновик' : status === 'NEEDS_INFO' ? 'Нужны сведения' : status === 'UNDER_REVIEW' ? 'На рассмотрении' : status === 'APPROVED' ? 'Одобрена' : status === 'DECLINED' ? 'Отказ' : status === 'SUBMITTED' ? 'Отправлена' : 'Заявка';
}
const date = (value: string) => new Intl.DateTimeFormat('ru-RU',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Moscow'}).format(new Date(value));
export default function SubmittedApplication({application,staff=false}:{application:Application;staff?:boolean}) {
  const snapshot=application.submission?.snapshot;
  const values=snapshot?.application ?? application;
  const calc:any=snapshot?.calculation;
  return <section className="form-card submitted-card" aria-label="Отправленная заявка">
    <h1>{application.status==='NEEDS_INFO'?'Нужны дополнительные сведения':application.status==='UNDER_REVIEW' ? 'Заявка на рассмотрении' : application.status==='APPROVED'?'Заявка одобрена':application.status==='DECLINED'?'По заявке принято решение':'Отправленная заявка'}</h1>
    <p>{application.status==='NEEDS_INFO'?(staff?'Ждём ответ клиента на запрос ниже.':'Ответьте на запрос банка ниже и отправьте сведения на рассмотрение.'):application.status==='APPROVED'?(staff?'Вы подтвердили положительное решение.':'Сотрудник подтвердил положительное решение по демонстрационной заявке.'):application.status==='DECLINED'?(staff?'Вы подтвердили отказ.':'Сотрудник принял итоговое решение с указанной причиной в истории заявки.'):staff?'Изучите заявку. При необходимости запросите сведения ниже.':'Дополнительные действия пока не требуются. Если понадобятся сведения, мы сообщим здесь.'}</p>
    <dl className="submitted-details">
      <div><dt>Компания</dt><dd>{snapshot?.company.company_name ?? application.company_name}</dd></div>
      <div><dt>Статус</dt><dd>{statusLabel(application.status)}</dd></div>
      {application.submitted_at && <div><dt>Отправлена</dt><dd>{date(application.submitted_at)}</dd></div>}
      <div><dt>Продукт</dt><dd>{products.find(p=>p.code===values.product_code)?.title ?? 'Не указан'}</dd></div>
      <div><dt>Цель</dt><dd>{values.purpose ?? 'Не указана'}</dd></div>
      <div><dt>Сумма</dt><dd>{formatMoneyRub(values.amount_rub)}</dd></div>
      {values.product_code==='overdraft'?<><div><dt>Лимит</dt><dd>{formatMoneyRub(values.amount_rub)}</dd></div><div><dt>Планируемая оплата</dt><dd>{formatMoneyRub(values.planned_payment_rub)}</dd></div><div><dt>Срок использования</dt><dd>{values.usage_days} дн.</dd></div><div><dt>К возврату по расчёту</dt><dd>{formatMoneyRub(calc?.due_rub ?? null)}</dd></div></>:<><div><dt>Срок</dt><dd>{values.term_months} мес.</dd></div>{values.product_code==='equipment'&&<div><dt>Стоимость оборудования</dt><dd>{formatMoneyRub(values.equipment_cost_rub)}</dd></div>}</>}
      {calc && <><div><dt>Ставка на момент отправки</dt><dd>{calc.annual_rate_percent}% годовых</dd></div>
      {calc.monthly_payment_rub&&<div><dt>Ежемесячный платёж</dt><dd>{formatMoneyRub(calc.monthly_payment_rub)}</dd></div>}
      {calc.total_payment_rub&&<div><dt>Общая сумма выплат</dt><dd>{formatMoneyRub(calc.total_payment_rub)}</dd></div>}
      {calc.overpayment_rub&&<div><dt>Переплата</dt><dd>{formatMoneyRub(calc.overpayment_rub)}</dd></div>}</>}
    </dl>
    <p className="small-note">Параметры зафиксированы при отправке. Расчёт не означает одобрения. Все данные и условия демонстрационные.</p>
    {snapshot && <p className="small-note">Сведения компании — синтетические данные банка. Подтверждение клиента не заменяет банковскую проверку.</p>}
    <CompanyDataView profile={snapshot?.company} historical/>
    <h2>История заявки</h2>
    <ol className="submission-history">{application.history?.map(event=><li key={event.id}><strong>{({INFO_REQUESTED:'Сотрудник запросил сведения',INFO_REPLY_SAVED:'Клиент сохранил черновик ответа',INFO_REPLY_SUBMITTED:'Клиент отправил ответ на рассмотрение',INFO_MESSAGE:'Добавлено сообщение по запросу',INFO_FILE_ATTACHED:'Клиент прикрепил документ',INFO_FILE_DETACHED:'Клиент открепил документ'} as Record<string,string>)[event.reason_code]??(event.to_status==='SUBMITTED' ? 'Клиент отправил заявку' : event.to_status==='UNDER_REVIEW' ? 'Система зарегистрировала заявку на рассмотрение' : statusLabel(event.to_status))}</strong><span>{date(event.occurred_at)}</span></li>)}</ol>
    {application.assessment&&<section className="assessment-summary"><h2>Результат проверки</h2><p>{application.assessment.score===null?'Не рассчитан: '+application.assessment.missing.join(', '):`Балл: ${application.assessment.score}/100 · ${application.assessment.group==='LOW'?'низкий':application.assessment.group==='MEDIUM'?'средний':'высокий'} риск`}</p><ul>{application.assessment.reasons.map(reason=><li key={reason}>{reason}</li>)}</ul></section>}
  </section>;
}
