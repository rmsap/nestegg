import { expect, test } from "@playwright/test";

test("new goals get funded automatically from their selected accounts", async ({ page }) => {
  await page.goto("/goals");
  await page.getByRole("link", { name: "Cash buffer for Everyday checking", exact: true }).click();
  const buffer = page.getByRole("dialog", { name: "Cash buffer" });
  await buffer.getByRole("spinbutton", { name: "Cash buffer amount" }).fill("4750");
  await buffer.getByRole("button", { name: "Save buffer" }).click();
  await expect(page.getByText("$100.00 available to assign")).toBeVisible();

  async function createGoal(name: string, target: string, account: string) {
    await page.getByRole("link", { name: "New goal" }).click();
    const dialog = page.getByRole("dialog", { name: "New savings goal" });
    await dialog.getByRole("textbox", { name: "Goal name" }).fill(name);
    await dialog.getByRole("spinbutton", { name: "Target amount" }).fill(target);
    await dialog.getByRole("combobox", { name: "Bank account" }).selectOption({ label: account });
    await dialog.getByRole("button", { name: "Create goal" }).click();
    await expect(dialog).toHaveCount(0);
  }

  await createGoal("Weekend trip", "250.50", "Everyday checking · $100.00 available");
  const trip = page.getByRole("progressbar", { name: "Weekend trip" });
  await expect(trip).toHaveAttribute("max", "25050");
  await expect(trip).toHaveAttribute("value", "10000");
  await expect(page.getByText("$150.50 to go")).toBeVisible();

  await createGoal("Car repair", "300", "High-yield savings · $4,200.00 available");
  await page.reload();
  await expect(page.getByRole("progressbar", { name: "Car repair" })).toHaveAttribute("value", "30000");
  await expect(trip).toHaveAttribute("value", "10000");
  await expect(page.getByText("$4,750.00 cash buffer")).toBeVisible();

  const card = page.locator("section").filter({ has: page.getByRole("heading", { name: "Weekend trip" }) });
  await card.getByRole("link", { name: "Edit goal" }).click();
  const edit = page.getByRole("dialog", { name: "Edit goal" });
  await expect(edit.getByRole("combobox", { name: "Bank account" })).toHaveValue("1");
  await edit.getByRole("combobox", { name: "Goal type" }).selectOption("refillable");
  await edit.getByRole("button", { name: "Save goal" }).click();
  await expect(card.getByText("Refillable · Everyday checking")).toBeVisible();
});
