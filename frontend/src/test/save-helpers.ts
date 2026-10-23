import { screen } from "@testing-library/react";
import type userEvent from "@testing-library/user-event";

// Re-selecting the current wizard step triggers its normal navigation flush.
// Keeps existing error/conflict tests on the same fields while using real UI.
export async function flushStep(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { current: "step" }));
}
