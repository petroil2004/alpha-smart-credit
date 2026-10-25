import {applicationNumber} from "../application-number";
import type { Application,ProductCode } from "../types";
import { products } from "../products";
import StatusBadge from './StatusBadge';
import { Icon } from "./Icon";

function amountText(value: string | null) {
  if (!value) return "Сумма не указана";
  const [whole, cents] = value.split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ")}${cents && cents !== "00" ? `,${cents}` : ""} ₽`;
}

export default function ApplicationsList({
  items,
  busy,
  onOpen,
  onCreate,
  onDelete,
  onChooseProduct,
}: {
  items: Application[];
  busy: boolean;
  onOpen: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onChooseProduct:(product:ProductCode)=>void;
}) {
  return (
    <>
      <section className="applications-section" aria-label="Сохранённые заявки">
        <div className="list-heading">
          <h2>Мои заявки</h2>
          <span className="muted">Заявок: {items.length}</span>
        </div>
        {!items.length ? (
          <div className="empty-state">
            <div className="empty-illustration" aria-hidden="true">
              <div className="paper">
                <Icon name="document" size={48} />
                <span className="paper-plus">+</span>
              </div>
              <span className="orbit-dot" />
            </div>
            <h3>Пока ни одной заявки</h3>
            <p>
              Новая возможность для вашего бизнеса.
              <br />
              Создайте заявку — оперативно рассмотрим её после отправки.
            </p>
            <button
              className="button secondary"
              disabled={busy}
              onClick={onCreate}
            >
              Создать заявку
              <Icon name="arrow" size={18} />
            </button>
          </div>
        ) : (
          <div className="application-list">
            {[...items].sort((a,b)=>b.updated_at.localeCompare(a.updated_at)).map((item) => (
              <article className="application-row" key={item.id}>
                <button className="application-open" disabled={busy} onClick={() => onOpen(item.id)} aria-label={`Открыть заявку ${applicationNumber(item)}`} aria-describedby={`application-details-${item.id} application-amount-${item.id}`}>
                  <span className="row-icon"><Icon name="document" /></span>
                  <span className="row-main" id={`application-details-${item.id}`}>
                    <span className="row-topline">№ {applicationNumber(item)} <StatusBadge status={item.status}/></span>
                    <span className="row-title">{products.find(product => product.code === item.product_code)?.title || "Новая заявка"}</span>
                    <span className="row-purpose">{item.purpose || "Расскажите о задаче вашего бизнеса"}</span>
                  </span>
                  <span className="row-amount" id={`application-amount-${item.id}`}>
                    <strong className={item.amount_rub?undefined:"amount-empty"}>{amountText(item.amount_rub)}</strong>
                    <small>Изм. {new Intl.DateTimeFormat("ru-RU", {day:"numeric", month:"short",hour:"2-digit",minute:"2-digit",timeZone:"Europe/Moscow"}).format(new Date(item.updated_at))}</small>
                  </span>
                  <span className="row-open"><Icon name="arrow" /></span>
                </button>
                {item.status === "DRAFT" && <button className="icon-button row-delete" disabled={busy} onClick={() => onDelete(item.id)} aria-label={`Удалить черновик ${applicationNumber(item)}`} title="Удалить черновик"><Icon name="trash" /></button>}
              </article>
            ))}
          </div>
        )}
      </section>
      <section className="directions-section">
        <div className="list-heading">
          <h2>Под вашу задачу</h2>
          <span className="muted">Три направления финансирования</span>
        </div>
        <div className="direction-grid">
          {products.map((product) => (
            <button type="button" className={`direction-card ${product.tone}`} key={product.code} disabled={busy} onClick={()=>onChooseProduct(product.code)} aria-label={`Оформить: ${product.title}`}>
              <img src={product.image} alt="" width="120" height="120" loading="lazy" />
              <h3>{product.title}</h3>
              <p>{product.description}</p>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}
