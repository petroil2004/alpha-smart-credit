import type { ProductCode } from "./types";

export const products: {
  code: ProductCode;
  title: string;
  description: string;
  number: string;
  tone: string;
  image: string;
}[] = [
  {
    code: "working_capital",
    title: "Оборотный кредит",
    description: "Товар, материалы и текущие расходы",
    number: "01", tone: "peach", image: "/images/credit/working-capital.png",
  },
  {
    code: "equipment",
    title: "Кредит на оборудование",
    description: "Всё, что помогает бизнесу расти",
    number: "02", tone: "mint", image: "/images/credit/equipment.png",
  },
  {
    code: "overdraft",
    title: "Овердрафт",
    description: "На время до следующего поступления",
    number: "03", tone: "lilac", image: "/images/credit/overdraft.png",
  },
];
