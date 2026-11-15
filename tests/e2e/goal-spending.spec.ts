import { expect, test } from "@playwright/test";

test("a card purchase counts immediately against a goal without a payment step", async ({ page }) => {
  await page.goto("/goals");
  await page.getByRole("link", { name: "New goal" }).click();
  const create = page.getByRole("dialog", { name: "New savings goal" });
  await create.getByRole("textbox", { name: "Goal name" }).fill("Visit family");
  await create.getByRole("spinbutton", { name: "Target amount" }).fill("100");
  await create.getByRole("combobox", { name: "Bank account" }).selectOption({ label: "Everyday checking · $4,850.00 available" });
  await create.getByRole("button", { name: "Create goal" }).click();
  const card = page.locator("section").filter({ has: page.getByRole("heading", { name: "Visit family" }) });
  await card.getByRole("button", { name: "Start spending" }).click();
  await expect(card.getByText("$100.00 left to spend")).toBeVisible();

  await page.goto("/transactions");
  await page.getByRole("button", { name: "Use goal funds for Metro transit" }).click();
  await page.getByRole("combobox", { name: "Savings goal" }).selectOption({ label: "Visit family · $100.00 saved" });
  await page.getByRole("button", { name: "Use goal funds", exact: true }).click();
  await expect(page.getByRole("button", { name: "Goal funds for Metro transit" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Category for Metro transit, currently Transport" })).toBeVisible();

  await page.goto("/goals");
  await expect(card.getByText("$68.00 left to spend")).toBeVisible();
  await expect(card.getByText("$32.00 spent")).toBeVisible();
  await expect(page.getByText("$68.00 reserved", { exact: true })).toBeVisible();
  await card.getByRole("link", { name: "Close goal" }).click();
  await page.getByRole("dialog", { name: "Close goal" }).getByRole("button", { name: "Close goal" }).click();
  await expect(card.getByText("Closed", { exact: true })).toBeVisible();
  await expect(card.getByText("$32.00 spent")).toBeVisible();
  await expect(page.getByText("$32.00 reserved", { exact: true })).toHaveCount(0);
});
