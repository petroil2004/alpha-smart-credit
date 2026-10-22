import type { ReactNode } from "react";
import type { DraftFields } from "../../types";
import type { DraftStep } from "../../draft-steps";
import { normalizeMoney } from "../../draft";
import { products } from "../../products";

function moneyText(value: string) {
  try {
    const money = normalizeMoney(value);
    if (!money) return "Не указано";
    const [whole, cents] = money.split(".");
    return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ")},${cents} ₽`;
  } catch {
    return value;
  }
}

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
    <section aria-label="Сводка черновика" className="draft-review">
      <div className="review-section">
        <header>
          <h3>Потребность</h3>
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => onEdit("need")}
            aria-label="Изменить потребность"
          >
            Изменить
          </button>
        </header>
        <dl>
          <Row label="Цель">{fields.purpose.trim() || "Не указано"}</Row>
          <Row label="Сумма">{moneyText(fields.amount_rub)}</Row>
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
              <Row label="Пользование, дней">
                {fields.usage_days.trim() || "Не указано"}
              </Row>
              <Row label="Ожидаемая дата поступления">
                {fields.expected_inflow_date || "Не указано"}
              </Row>
              <Row label="Ожидаемая сумма поступления">
                {moneyText(fields.expected_inflow_amount_rub)}
              </Row>
            </>
          ) : (
            <Row label="Срок, месяцев">
              {fields.term_months.trim() || "Не указано"}
            </Row>
          )}
        </dl>
      </div>
      <p className="review-disclaimer">
        Это черновик. Сохранение не отправляет заявку на рассмотрение.
        Незаполненные сведения можно добавить позже.
      </p>
    </section>
  );
}
