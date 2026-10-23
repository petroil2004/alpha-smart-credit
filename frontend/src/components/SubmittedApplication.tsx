import type {Application} from '../types';
import {formatMoneyRub} from '../draft';
import {products} from '../products';
export function statusLabel(status: string) {
  return status === 'DRAFT' ? 'Черновик' : status === 'UNDER_REVIEW' ? 'На рассмотрении' : status === 'SUBMITTED' ? 'Отправлена' : 'Заявка';
}
const date = (value: string) => new Intl.DateTimeFormat('ru-RU',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Moscow'}).format(new Date(value));
export default function SubmittedApplication({application}:{application:Application}) {
  const snapshot=application.submission?.snapshot;
  const values=snapshot?.application ?? application;
  const calc=snapshot?.calculation;
  return <section className="form-card submitted-card" aria-label="Отправленная заявка">
    <h1>{application.status==='UNDER_REVIEW' ? 'Заявка на рассмотрении' : 'Отправленная заявка'}</h1>
    <p>Дополнительные действия пока не требуются. Если понадобятся сведения, мы сообщим здесь.</p>
    <dl className="submitted-details">
      <div><dt>Компания</dt><dd>{snapshot?.company.company_name ?? application.company_name}</dd></div>
      <div><dt>Статус</dt><dd>{statusLabel(application.status)}</dd></div>
      {application.submitted_at && <div><dt>Отправлена</dt><dd>{date(application.submitted_at)}</dd></div>}
      <div><dt>Продукт</dt><dd>{products.find(p=>p.code===values.product_code)?.title ?? 'Не указан'}</dd></div>
      <div><dt>Цель</dt><dd>{values.purpose ?? 'Не указана'}</dd></div>
      <div><dt>Сумма</dt><dd>{formatMoneyRub(values.amount_rub)}</dd></div>
      <div><dt>Срок</dt><dd>{values.term_months} мес.</dd></div>
      {calc && <><div><dt>Ставка на момент отправки</dt><dd>{calc.annual_rate_percent}% годовых</dd></div>
      <div><dt>Ежемесячный платёж</dt><dd>{formatMoneyRub(calc.monthly_payment_rub)}</dd></div>
      <div><dt>Общая сумма выплат</dt><dd>{formatMoneyRub(calc.total_payment_rub)}</dd></div>
      <div><dt>Переплата</dt><dd>{formatMoneyRub(calc.overpayment_rub)}</dd></div></>}
    </dl>
    <p className="small-note">Параметры зафиксированы при отправке. Расчёт не означает одобрения. Все данные и условия демонстрационные.</p>
    {snapshot && <p className="small-note">Сведения компании — синтетические данные банка. Подтверждение клиента не заменяет банковскую проверку.</p>}
    <h2>История заявки</h2>
    <ol className="submission-history">{application.history?.map(event=><li key={event.id}><strong>{event.to_status==='SUBMITTED' ? 'Клиент отправил заявку' : event.to_status==='UNDER_REVIEW' ? 'Система зарегистрировала заявку на рассмотрение' : statusLabel(event.to_status)}</strong><span>{date(event.occurred_at)}</span></li>)}</ol>
  </section>;
}
