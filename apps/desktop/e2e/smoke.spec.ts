/// <reference lib="dom" />
// `page.waitForFunction` callbacks run in the window, hence the DOM types.
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { APP_DIR, launchApp } from "./fixtures.ts";

// PROBLEM_SCREENSHOTS=<folder> refreshes the README images (docs/screenshots).
const SHOTS = process.env.PROBLEM_SCREENSHOTS ?? join(APP_DIR, "test-results", "screenshots");

/** Saves a screenshot once Fluent's open/close animations have settled. */
async function shot(page: Page, name: string): Promise<void> {
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== "running"),
  );
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

test("adds a project, reviews a branch, and accepts what Claude found", async () => {
  const { app, page, repo, cleanup } = await launchApp();
  try {
    // No projects yet: add the repository.
    await page.getByRole("button", { name: "Add project" }).click();
    await page
      .getByRole("complementary", { name: "Projects" })
      .getByRole("button", { name: "Add project" })
      .click();
    const addDialog = page.getByRole("dialog", { name: "Add project" });
    await addDialog.getByRole("textbox", { name: /Repository folder/ }).fill(repo);
    await addDialog.getByRole("button", { name: "Add", exact: true }).click();
    await expect(addDialog).toBeHidden();

    // Review the feature branch.
    await page
      .getByRole("navigation", { name: "Main" })
      .getByRole("button", { name: "Reviews" })
      .click();
    await page.getByRole("main").getByRole("button", { name: "New review" }).click();
    const newDialog = page.getByRole("dialog", { name: "New review" });
    await newDialog
      .getByRole("combobox", { name: /Branch or pull request/ })
      .fill("feature/discounts");
    await newDialog.getByRole("combobox", { name: /Base branch/ }).fill("main");
    await newDialog.getByRole("button", { name: "Start review" }).click();
    await expect(newDialog).toBeHidden();

    // The scripted Claude streams its answer and reports one finding.
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { name: "feature/discounts" })).toBeVisible();
    await expect(main.getByText("One problem stands out in the discount logic.")).toBeVisible();
    await expect(main.getByRole("tab", { name: /Findings\s*1/ })).toBeVisible();
    // The turn ends cleanly: the tool call went through the app's permission hook.
    await expect(main.getByText(/^Done ·/)).toBeVisible();
    await expect(main.getByText(/^Failed/)).toHaveCount(0);
    await shot(page, "conversation");

    // Read it (keyboard: 2 opens Findings, J selects the first) and accept it.
    await page.keyboard.press("2");
    await page.keyboard.press("j");
    const finding = main.getByRole("region", { name: "Finding #1" });
    await expect(finding.getByText("Discount is applied twice")).toBeVisible();
    await expect(finding.getByText("How to reproduce")).toBeVisible();
    await shot(page, "findings");
    await finding.getByRole("button", { name: "Accept" }).click();
    await expect(finding.getByRole("button", { name: "Reopen" })).toBeVisible();

    // The change itself.
    await main.getByRole("tab", { name: "Changes" }).click();
    await expect(main.getByRole("table", { name: "Diff of src/cart.ts" })).toBeVisible();
    await shot(page, "changes");

    // Search finds the finding; the shortcuts list opens on "?".
    await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
    await page.keyboard.type("discount");
    const results = page.getByRole("listbox", { name: "Search results" });
    await expect(results.getByRole("option", { name: /^Finding #1/ })).toBeVisible();
    await shot(page, "search");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await main.getByRole("tab", { name: "Changes" }).focus();
    await page.keyboard.press("?");
    const shortcuts = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(shortcuts).toBeVisible();
    await shot(page, "shortcuts");
    await shortcuts.getByRole("button", { name: "Close" }).click();

    // The light theme applies at once.
    await page
      .getByRole("navigation", { name: "Main" })
      .getByRole("button", { name: "Settings" })
      .click();
    await page.getByRole("radio", { name: "Teams light" }).check();
    await page
      .getByRole("navigation", { name: "Main" })
      .getByRole("button", { name: "Reviews" })
      .click();
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await shot(page, "light");
  } finally {
    await app.close();
    cleanup();
  }
});
