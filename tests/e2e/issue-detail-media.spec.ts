import { expect, test } from "@playwright/test";
import { as } from "./helpers";

// Improvement 2: the description is distinct, its images open larger, its videos
// are playable and its links open; the side panel can be resized.
test("a description stands out and its media works", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.route("**/api/issues/101", async (route) => {
    const res = await route.fetch();
    const json = await res.json();
    json.bodyHtml = [
      "<p>See the screenshot and the recording.</p>",
      '<p><a href="https://github.com/acme/widgets/issues/1"><img src="https://github.com/acme/widgets/assets/1/shot.png" alt="Screenshot"></a></p>',
      '<video src="https://github.com/acme/widgets/assets/1/clip.mp4" controls playsinline preload="metadata"></video>',
      '<p><a href="https://github.com/acme/widgets/issues/1" target="_blank" rel="noreferrer noopener">Open issue 1</a></p>',
    ].join("");
    await route.fulfill({ response: res, json, headers: { ...res.headers(), etag: "" } });
  });
  await page.goto("/backlog?issue=101");
  const panel = page.getByRole("complementary", { name: "Issue #101" });
  const description = panel.locator("[data-issue-description]");
  await expect(description).toBeVisible();
  await expect(description).toHaveCSS("box-shadow", /rgb/);

  // The video keeps the attributes that make it playable.
  const video = description.locator("video");
  await expect(video).toHaveAttribute("controls", "");
  await expect(video).toHaveAttribute("playsinline", "");
  await expect(video).toHaveAttribute("preload", "metadata");

  // A GitHub link opens in a new page.
  const link = description.getByRole("link", { name: "Open issue 1" });
  await expect(link).toHaveAttribute("target", "_blank");
  const [popup] = await Promise.all([page.waitForEvent("popup"), link.click()]);
  expect(popup.url()).toContain("https://github.com/acme/widgets/issues/1");
  await popup.close();

  // An image opens larger instead of following its GitHub link.
  const image = description.locator("img");
  await image.click();
  const dialog = page.getByRole("dialog", { name: "Image: Screenshot" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("img")).toHaveAttribute("src", "https://github.com/acme/widgets/assets/1/shot.png");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/issue=101/);

  // Dragging the panel's left edge widens it and leaves the list usable.
  const before = await panel.boundingBox();
  const handle = page.getByRole("separator", { name: "Resize issue panel" });
  const hb = await handle.boundingBox();
  expect(before && hb).toBeTruthy();
  await page.mouse.move(hb!.x + 2, hb!.y + hb!.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb!.x - 120, hb!.y + hb!.height / 2, { steps: 6 });
  await page.mouse.up();
  const after = await panel.boundingBox();
  expect(after!.width).toBeGreaterThan(before!.width + 100);
  await expect(page.getByRole("heading", { name: "Backlog" })).toBeVisible();
  await context.close();
});
