import { expect, test } from "@playwright/test";

test("overview, accounts and goals show seeded totals and support sidebar navigation", async ({ page }) => {
  await page.goto("/");
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Posted spending")).toBeVisible();
  await expect(page.getByText("Whole Foods Market")).toBeVisible();

  await navigation.getByRole("link", { name: "Accounts" }).click();
  await expect(page.getByRole("heading", { name: "Bank Accounts" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Credit Cards" })).toBeVisible();
  await expect(page.getByText("$42,850.00")).toBeVisible();
  await navigation.getByRole("link", { name: "Goals" }).click();
  const goal = page.getByRole("progressbar", { name: "Emergency fund" });
  await expect(goal).toHaveAttribute("value", "1000000");
  await expect(goal).toHaveAttribute("max", "1500000");
});

test("the sidebar expands on desktop and navigation fits a phone viewport", async ({ page }) => {
  await page.goto("/");
  const sidebar = page.getByRole("complementary");
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await expect(sidebar).toHaveCSS("width", "68px");
  await navigation.getByRole("link", { name: "Transactions" }).hover();
  await expect(sidebar).toHaveCSS("width", "210px");
  await page.getByRole("heading", { name: "Overview" }).hover();
  await expect(sidebar).toHaveCSS("width", "68px");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(sidebar).toHaveCSS("width", "390px");
  await navigation.getByRole("link", { name: "Transactions" }).click();
  await expect(page.getByRole("heading", { name: "Transactions" })).toBeVisible();
  expect(await page.locator("html").evaluate((root) => root.scrollWidth - root.clientWidth)).toBe(0);
});

test("transaction search, category filter and reporting month compose", async ({ page }) => {
  await page.goto("/?view=transactions");
  await expect(page).toHaveURL(/\/transactions$/);
  const category = page.getByRole("combobox", { name: "Category", exact: true });
  await page.getByRole("searchbox", { name: "Search" }).fill(" pantry ORDER ");
  await category.selectOption("Groceries");
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page.getByText("Market pantry order")).toBeVisible();
  await expect(page.getByText("Whole Foods Market")).toHaveCount(0);
  await expect(page.getByText("Neighborhood Coffee")).toHaveCount(0);
  await page.getByLabel("Reporting month").fill("2026-10");
  await page.getByRole("button", { name: "Go", exact: true }).click();
  await expect(page.getByText("October 2026")).toBeVisible();
  await expect(page.getByText("No matching transactions.")).toBeVisible();
  await expect(category).toHaveValue("Groceries");
});

test("one click opens the category chip and a new category marks the transaction reviewed", async ({ page }) => {
  await page.goto("/transactions");
  const review = page.getByRole("button", { name: "Review Whole Foods Market" });
  const chip = page.getByRole("button", { name: /^Category for Whole Foods Market/ });
  await expect(review).toBeVisible();
  await chip.click();
  const options = page.getByRole("list", { name: "Categories" });
  await expect(options).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await chip.press("Escape");
  await expect(options).toHaveCount(0);
  await expect(chip).toBeFocused();
  await chip.click();
  await options.getByRole("button", { name: "Dining", exact: true }).click();
  await expect(review).toHaveCount(0);
  await page.reload();
  await expect(chip).toHaveText("Dining");
  await expect(review).toHaveCount(0);
});

test("inline review saves a memo that remains collapsed until opened", async ({ page }) => {
  await page.goto("/transactions");
  await expect(page.getByText(/Rewards card · Pending/)).toBeVisible();
  const review = page.getByRole("button", { name: "Review Northline Outfitters" });
  await review.click();
  await expect(review).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("combobox", { name: "Category", exact: true }).last().selectOption({ label: "Transport" });
  const memoText = "Travel supplies purchased during the November trip";
  await page.getByRole("textbox", { name: "Memo (optional)" }).fill(memoText);
  await page.getByRole("button", { name: "Categorize" }).click();
  await expect(review).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "Category for Northline Outfitters, currently Transport" })).toBeVisible();
  const toggle = page.getByRole("button", { name: /memo for Northline Outfitters/ });
  await expect(page.getByText(memoText)).toHaveCount(0);
  await toggle.click();
  await expect(page.getByText(memoText)).toBeVisible();
  await toggle.press("Escape");
  await expect(page.getByText(memoText)).toHaveCount(0);
  await expect(toggle).toBeFocused();
});

test("budget categories can be added, edited and deleted with transaction reassignment", async ({ page }) => {
  await page.goto("/budget");
  await expect(page.getByLabel("Delete Housing category")).toHaveCount(0);
  const name = page.getByLabel("Category name");
  const status = page.getByRole("status");
  await name.fill("Uncategorized");
  await page.getByRole("button", { name: "Add category" }).click();
  await expect(status).toHaveText("That category name is reserved.");
  await name.fill("Test subscriptions");
  await page.getByLabel("Monthly limit", { exact: true }).fill("30");
  await page.getByRole("button", { name: "Add category" }).click();
  await expect(status).toHaveText("Category added.");
  await expect(page.getByRole("heading", { name: "Test subscriptions" })).toBeVisible();

  await page.getByRole("link", { name: "Edit categories" }).click();
  const limit = page.getByLabel("Test subscriptions monthly limit");
  await limit.fill("42.50");
  await page.getByLabel("Test subscriptions color").fill("#336699");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(status).toHaveText("Categories saved.");
  await page.getByRole("link", { name: "Edit categories" }).click();
  await expect(limit).toHaveValue("42.50");
  await expect(page.getByLabel("Test subscriptions color")).toHaveValue("#336699");

  await page.getByLabel("Delete Housing category").click();
  await page.getByRole("combobox", { name: "Move transactions to" }).selectOption({ label: "Test subscriptions" });
  await page.getByRole("button", { name: "Delete category" }).click();
  await expect(status).toHaveText("Category deleted.");
  await expect(page.getByRole("heading", { name: "Housing", exact: true })).toHaveCount(0);
  await page.goto("/transactions");
  const rent = page.getByRole("button", { name: "Category for Monthly rent, currently Test subscriptions" });
  await expect(rent).toBeVisible();
  await expect(rent).toHaveCSS("font-weight", "700");
  await expect(rent).toHaveCSS("--theme-primary", "#336699");
});

test("appearance follows the device and previews, saves and resets changes", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/settings");
  const root = page.locator("html");
  const body = page.locator("body");
  const color = page.getByRole("textbox", { name: "Primary color hex code" });
  const mode = page.getByRole("combobox");
  const reset = page.getByRole("button", { name: "Reset", exact: true });
  const save = page.getByRole("button", { name: "Save appearance" });
  await expect(root).toHaveAttribute("data-color-mode", "system");
  await expect(body).toHaveCSS("background-color", "rgb(19, 23, 21)");

  await mode.press("ArrowDown");
  await expect(page.getByRole("button", { name: "System (device default)" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(mode).toHaveText("Light");
  await expect(root).toHaveCSS("color-scheme", "light");
  await color.fill("#aabbcc");
  await expect(root).toHaveCSS("--theme-primary", "#aabbcc");
  await reset.click();
  await expect(root).toHaveCSS("--theme-primary", "#245e49");
  await expect(mode).toHaveText("System (device default)");
  await expect(save).toBeDisabled();

  await mode.click();
  await page.getByRole("option", { name: "Light" }).click();
  await color.fill("aabbcc");
  await save.click();
  await expect(root).toHaveAttribute("data-color-mode", "light");
  await page.reload();
  await expect(color).toHaveValue("#AABBCC");
  await expect(root).toHaveCSS("--theme-primary", "#aabbcc");
  await color.fill("#ffffff");
  await reset.click();
  await expect(color).toHaveValue("#AABBCC");
  await expect(root).toHaveCSS("--theme-primary", "#aabbcc");
});

test("Demo Bank can connect, sync, pause and disconnect without removing imported accounts", async ({ page }) => {
  await page.goto("/connections");
  await page.getByRole("link", { name: "Add connection" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveAccessibleName("Choose a provider");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.getByRole("link", { name: "Add connection" }).first().click();
  await dialog.getByRole("link", { name: /Demo Bank/ }).click();
  await expect(dialog).toHaveAccessibleName("Connect through Demo Bank");
  await dialog.getByRole("textbox", { name: "Bank name" }).fill("Test Credit Union");
  await dialog.getByRole("combobox").click();
  await dialog.getByRole("option", { name: "Healthy" }).click();
  await dialog.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(dialog).toHaveAccessibleName("Test Credit Union connected");
  await expect(dialog.getByText(/4 accounts and \d+ transactions? imported/)).toBeVisible();
  await dialog.getByRole("link", { name: "Done" }).click();
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect(page.getByRole("status")).toContainText("Synced:");
  await page.getByText("Recent syncs", { exact: true }).click();
  await expect(page.getByText("Manual · Succeeded").first()).toBeVisible();
  await page.getByRole("button", { name: "Turn off" }).click();
  await expect(page.getByRole("status")).toHaveText("Connection turned off.");
  await expect(page.getByRole("button", { name: "Turn on" })).toBeVisible();
  await page.getByText("Remove", { exact: true }).click();
  await page.getByRole("button", { name: "Remove connection" }).click();
  await expect(page.getByRole("status")).toHaveText("Connection removed.");
  await page.getByRole("navigation").getByRole("link", { name: "Accounts" }).click();
  await expect(page.getByText("Rainy Day Savings", { exact: true })).toBeVisible();
});

test("provider settings persist an updated sync interval", async ({ page }) => {
  await page.goto("/connections");
  await page.getByRole("link", { name: "Settings", exact: true }).and(page.locator('a[href="/connections?provider=demo"]')).click();
  const dialog = page.getByRole("dialog", { name: "Demo Bank settings" });
  await expect(dialog.getByRole("switch", { name: "Provider on" })).toBeChecked();
  await dialog.getByLabel("Sync every (minutes)").fill("120");
  await dialog.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByRole("status")).toHaveText("Settings saved.");
  await page.reload();
  await expect(page.getByText("Syncs every 2 hours", { exact: true })).toBeVisible();
});

test("Plaid sign-in can restart without saved state and resume with a saved token", async ({ page }) => {
  const redirect = "/connections?oauth_state_id=test-return";
  await page.goto(redirect);
  await expect(page.getByText("This sign-in could not be resumed.")).toBeVisible();
  await page.getByRole("link", { name: "Start again." }).click();
  await expect(page).toHaveURL(/\/connections$/);

  await page.addInitScript(() => {
    sessionStorage.setItem("nestegg.plaid-link", JSON.stringify({
      providerKey: "plaid", linkToken: "test-link-token", state: "test-state", mode: "create",
    }));
    window.Plaid = {
      create(options) {
        return {
          open() {
            document.body.dataset.plaidToken = options.token;
            document.body.dataset.plaidReturn = options.receivedRedirectUri;
            options.onExit({ error_code: "TEST_EXIT" }, {});
          },
          exit() {},
          destroy() {},
        };
      },
    };
  });
  await page.goto(redirect);
  await expect(page.locator("body")).toHaveAttribute("data-plaid-token", "test-link-token");
  await expect(page.locator("body")).toHaveAttribute("data-plaid-return", page.url());
  await expect(page.getByRole("alert").filter({ hasText: "Sign-in was not completed." })).toBeVisible();
});
