import type { ReactNode } from "react";
import type { DraftFields } from "../../types";
import type { DraftStep } from "../../draft-steps";
import { formatMoneyRub } from "../../draft";
import { products } from "../../products";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="review-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export default function DraftReview({
  fields,
  onEdit,
  busy,
}: {
  fields: DraftFields;
  onEdit: (step: DraftStep) => void;
  busy: boolean;
}) {
  const product = products.find((item) => item.code === fields.product_code);
  const overdraft = fields.product_code === "overdraft";
  return (
    <section aria-label="Сводка заявки" className="draft-review">
      <div className="review-section">
        <header>
          <h3>Потребность</h3>
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => onEdit("details")}
            aria-label="Изменить потребность"
          >
            Изменить
          </button>
        </header>
        <dl>
          <Row label="Цель">{fields.purpose.trim() || "Не указано"}</Row>
          <Row label="Сумма">{formatMoneyRub(fields.amount_rub)}</Row>
        </dl>
      </div>
      <div className="review-section">
        <header>
          <h3>Продукт</h3>
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => onEdit("product")}
            aria-label="Изменить продукт"
          >
            Изменить
          </button>
        </header>
        <dl>
          <Row label="Направление">{product?.title || "Не указано"}</Row>
        </dl>
      </div>
      <div className="review-section">
        <header>
          <h3>Параметры</h3>
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => onEdit("details")}
            aria-label="Изменить параметры"
          >
            Изменить
          </button>
        </header>
        <dl>
          {!product ? (
            <Row label="Срок">Не указано</Row>
          ) : overdraft ? (
            <>
              <Row label="Лимит">{formatMoneyRub(fields.amount_rub)}</Row>
              <Row label="Сумма использования лимита">{formatMoneyRub(fields.planned_payment_rub)}</Row>
              <Row label="Дата использования средств">{fields.planned_payment_date || "Не указано"}</Row>
              <Row label="Пользование, дней">
                {Math.round((Date.parse(fields.expected_inflow_date)-Date.parse(fields.planned_payment_date))/86400000) || "Не указано"}
              </Row>
              <Row label="Ожидаемая дата поступления">
                {fields.expected_inflow_date || "Не указано"}
              </Row>
              <Row label="Ожидаемая сумма поступления">
              {formatMoneyRub(fields.expected_inflow_amount_rub)}
              </Row>
              <Row label="Источник поступления">{fields.expected_inflow_source ? {BUYER:"Покупатель",CONTRACT:"Договор",REGULAR_REVENUE:"Обычная выручка",OTHER:"Другое"}[fields.expected_inflow_source] : "Не указан"}</Row>
            </>
          ) : (
            <><Row label="Срок, месяцев">{fields.term_months.trim() || "Не указано"}</Row>
            {fields.product_code === "equipment" && <Row label="Стоимость оборудования">{formatMoneyRub(fields.equipment_cost_rub)}</Row>}</>
          )}
        </dl>
      </div>
      <p className="review-disclaimer">
        Заявка ещё не отправлена на рассмотрение. Данные сохраняются автоматически.
        Незаполненные сведения можно добавить позже.
      </p>
    </section>
  );
}
