import { screen } from "@testing-library/react";
import type userEvent from "@testing-library/user-event";

// Re-selecting the current wizard step triggers its normal navigation flush.
// Keeps existing error/conflict tests on the same fields while using real UI.
export async function flushStep(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { current: "step" }));
}

// Product selection is now required before opening parameters.
export async function openParameters(user: ReturnType<typeof userEvent.setup>) {
  const choices=screen.queryAllByRole('radio');
  if(choices.length&&!choices.some(input=>(input as HTMLInputElement).checked))
    await user.click(screen.getByRole('radio',{name:/Оборотный кредит/}));
  await user.click(screen.getByRole('button',{name:'Перейти к шагу «Параметры»'}));
}
