import type { Application } from "../types";
import { products } from "../products";
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
}: {
  items: Application[];
  busy: boolean;
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  return (
    <>
      <section className="applications-section" aria-label="Сохранённые заявки">
        <div className="list-heading">
          <h2>
            Все заявки <span>{items.length}</span>
          </h2>
          <span className="muted">Сохранены в вашем кабинете</span>
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
              Создайте заявку — заполнить её можно позже.
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
            {items.map((item) => (
              <article className="application-row" key={item.id}>
                <div className="row-icon">
                  <Icon name="document" />
                </div>
                <div className="row-main">
                  <span className="row-topline">
                    № {item.id.slice(-6)}{" "}
                    <span className="draft-badge">Черновик</span>
                  </span>
                  <h3>
                    {products.find(
                      (product) => product.code === item.product_code,
                    )?.title || "Новая заявка"}
                  </h3>
                  <p>{item.purpose || "Расскажите о задаче вашего бизнеса"}</p>
                </div>
                <div className="row-amount">
                  <strong>{amountText(item.amount_rub)}</strong>
                  <small>
                    {new Intl.DateTimeFormat("ru-RU", {
                      day: "numeric",
                      month: "short",
                    }).format(new Date(item.updated_at))}
                  </small>
                </div>
                <button
                  className="icon-button row-open"
                  disabled={busy}
                  onClick={() => onOpen(item.id)}
                  aria-label={`Открыть заявку ${item.id.slice(-6)}`}
                >
                  <Icon name="arrow" />
                </button>
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
            <article className="direction-card" key={product.code}>
              <span className="direction-number">{product.number}</span>
              <h3>{product.title}</h3>
              <p>{product.description}</p>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
