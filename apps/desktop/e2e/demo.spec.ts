/// <reference lib="dom" />
// `page.evaluate` callbacks run in the window, hence the DOM types.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { launchApp } from "./fixtures.ts";

/**
 * Records the frames of the README's demo GIF: the smoke test's story at a human pace, with a
 * visible cursor. Runs only with PROBLEM_FRAMES=<folder> (see `pnpm demo:gif`, which turns them
 * into the GIF with ffmpeg). Frames are screenshots of the window, so no screen-recording
 * permission is needed (Playwright's recordVideo hangs every page call under Electron).
 */
const FRAMES = process.env.PROBLEM_FRAMES;
test.skip(!FRAMES, "Set PROBLEM_FRAMES to record the demo");
test.setTimeout(120_000);

/** Playwright's input leaves no cursor in a recording: draw one that follows the mouse. */
async function showCursor(page: Page): Promise<void> {
  await page.evaluate(() => {
    const dot = document.createElement("div");
    Object.assign(dot.style, {
      position: "fixed",
      left: "0",
      top: "0",
      width: "18px",
      height: "18px",
      marginLeft: "-9px",
      marginTop: "-9px",
      borderRadius: "50%",
      background: "rgba(255, 255, 255, 0.85)",
      boxShadow: "0 0 0 2px rgba(98, 100, 167, 0.9)",
      pointerEvents: "none",
      zIndex: "2147483647",
      transition: "transform 80ms",
    });
    document.body.append(dot);
    document.addEventListener("mousemove", (event) => {
      dot.style.left = `${event.clientX}px`;
      dot.style.top = `${event.clientY}px`;
    });
    document.addEventListener("mousedown", () => {
      dot.style.transform = "scale(0.7)";
    });
    document.addEventListener("mouseup", () => {
      dot.style.transform = "";
    });
  });
}

const pause = (page: Page, ms: number) => page.waitForTimeout(ms);

/**
 * Screenshots the window about 10 times a second until stopped, then writes `frames.txt`: an
 * ffmpeg concat list where each frame lasts until the next one was taken (real timing).
 */
function record(page: Page, dir: string): () => Promise<void> {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const frames: { file: string; at: number }[] = [];
  let running = true;
  const loop = (async () => {
    while (running) {
      const at = Date.now();
      const file = `frame${String(frames.length).padStart(5, "0")}.jpg`;
      try {
        await page.screenshot({ path: join(dir, file), type: "jpeg", quality: 90 });
        frames.push({ file, at });
      } catch {
        // The window is closing.
      }
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, 100 - (Date.now() - at))));
    }
  })();
  return async () => {
    running = false;
    await loop;
    const lines = frames.flatMap((frame, index) => {
      const next = frames[index + 1]?.at ?? frame.at + 1500;
      return [`file '${frame.file}'`, `duration ${((next - frame.at) / 1000).toFixed(3)}`];
    });
    // The concat demuxer ignores the last duration unless the last file is listed again.
    const last = frames.at(-1);
    if (last) lines.push(`file '${last.file}'`);
    writeFileSync(join(dir, "frames.txt"), `ffconcat version 1.0\n${lines.join("\n")}\n`);
  };
}

/** Glides to the element, then clicks it. */
async function click(page: Page, target: Locator): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error("Nothing to click");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 20 });
  await pause(page, 250);
  await target.click();
}

test("records the demo", async () => {
  const { app, page, repo, cleanup } = await launchApp();
  const stop = record(page, FRAMES ?? "");
  try {
    await showCursor(page);
    await page.mouse.move(700, 450);
    await pause(page, 800);

    // Add the repository.
    await click(page, page.getByRole("button", { name: "Add project" }));
    await click(
      page,
      page.getByRole("complementary", { name: "Projects" }).getByRole("button", {
        name: "Add project",
      }),
    );
    const addDialog = page.getByRole("dialog", { name: "Add project" });
    await addDialog.getByRole("textbox", { name: /Repository folder/ }).fill(repo);
    await pause(page, 600);
    await click(page, addDialog.getByRole("button", { name: "Add", exact: true }));
    await expect(addDialog).toBeHidden();
    await pause(page, 500);

    // Review a branch.
    const rail = page.getByRole("navigation", { name: "Main" });
    await click(page, rail.getByRole("button", { name: "Reviews" }));
    await click(page, page.getByRole("main").getByRole("button", { name: "New review" }));
    const newDialog = page.getByRole("dialog", { name: "New review" });
    await newDialog
      .getByRole("combobox", { name: /Branch or pull request/ })
      .pressSequentially("feature/discounts", { delay: 50 });
    await newDialog.getByRole("combobox", { name: /Base branch/ }).fill("main");
    await pause(page, 500);
    await click(page, newDialog.getByRole("button", { name: "Start review" }));

    // Claude streams its answer and reports a finding.
    const main = page.getByRole("main");
    await expect(main.getByText(/^Done ·/)).toBeVisible();
    await pause(page, 1800);

    // Triage it from the keyboard: 2 opens Findings, J selects the first.
    await page.keyboard.press("2");
    await pause(page, 900);
    await page.keyboard.press("j");
    const finding = main.getByRole("region", { name: "Finding #1" });
    await expect(finding).toBeVisible();
    await pause(page, 2500);
    await click(page, finding.getByRole("button", { name: "Accept" }));
    await pause(page, 1200);

    // The diff.
    await page.keyboard.press("3");
    await expect(main.getByRole("table", { name: "Diff of src/cart.ts" })).toBeVisible();
    await pause(page, 2200);

    // Search everything.
    await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
    await page.keyboard.type("discount", { delay: 90 });
    await expect(
      page.getByRole("listbox", { name: "Search results" }).getByRole("option", {
        name: /^Finding #1/,
      }),
    ).toBeVisible();
    await pause(page, 1500);
    await page.keyboard.press("ArrowDown");
    await pause(page, 500);
    await page.keyboard.press("Enter");
    await pause(page, 1800);

    // Activity: what finished, failed or needs you, across every review.
    await click(
      page,
      page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: /^Activity/ }),
    );
    const row = page
      .getByRole("complementary", { name: "Activity" })
      .getByRole("button", { name: /Claude finished/ });
    await expect(row).toBeVisible();
    await pause(page, 1500);
    await click(page, row);
    await expect(main.getByRole("region", { name: "Finding #1" })).toBeVisible();
    await pause(page, 2200);
  } finally {
    await stop();
    await app.close();
    cleanup();
  }
});
