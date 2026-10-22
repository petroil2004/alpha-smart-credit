import type { ProductCode } from "./types";

export const products: {
  code: ProductCode;
  title: string;
  description: string;
  number: string;
}[] = [
  {
    code: "working_capital",
    title: "Оборотный кредит",
    description: "Товар, материалы и текущие расходы",
    number: "01",
  },
  {
    code: "equipment",
    title: "Кредит на оборудование",
    description: "Всё, что помогает бизнесу расти",
    number: "02",
  },
  {
    code: "overdraft",
    title: "Овердрафт",
    description: "На время до следующего поступления",
    number: "03",
  },
];
