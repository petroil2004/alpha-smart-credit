import type { DraftFields } from "./types";

export type DraftStep = "product" | "details" | "review";

// The order and field ownership live together so later sections can be added
// without changing saved applications or duplicating navigation rules.
export const draftSteps: {
  id: DraftStep;
  label: string;
  title: string;
  description: string;
  fields: (keyof DraftFields)[];
}[] = [
  {
    id: "product",
    label: "Продукт",
    title: "Выберите продукт",
    description:
      "Выберите подходящее направление. Решение можно изменить позже.",
    fields: ["product_code"],
  },
  {
    id: "details",
    label: "Параметры",
    title: "Настройте условия",
    description:
      "Уточните сумму и срок, затем опишите задачу бизнеса.",
    fields: [
      "purpose",
      "amount_rub",
      "term_months",
      "usage_days",
      "expected_inflow_date",
      "expected_inflow_amount_rub",
    ],
  },
  {
    id: "review",
    label: "Проверка",
    title: "Проверьте заявку",
    description:
      "Посмотрите введённые сведения и при необходимости вернитесь к любому разделу.",
    fields: [],
  },
];
