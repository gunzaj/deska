import { expect, test } from "@playwright/test";
import { as } from "./helpers";

// W0: Settings → GitHub writes (SPEC §3.4). The e2e build is read-only, so the
// switch says so; the route is mocked to show the three states of the gate.

type Gate = {
  allowed: boolean;
  reason: string | null;
  buildAllows: boolean;
  settingOn: boolean;
  tokenAccess: "yes" | "no" | "unknown";
  tokenMessage: string | null;
};

const gate = (over: Partial<Gate> = {}): Gate => ({
  allowed: false,
  reason: "Editing is off for this deployment",
  buildAllows: true,
  settingOn: false,
  tokenAccess: "yes",
  tokenMessage: null,
  ...over,
});

test("the build's write switch off says so and disables the switch", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.route("**/api/settings/writes", (route) => route.fulfill({ json: { writes: gate({ buildAllows: false, reason: "Editing is off for this deployment" }) } }));
  await page.goto("/settings");
  const section = page.locator("#writes");
  await expect(section.getByRole("heading", { name: "GitHub writes" })).toBeVisible();
  await expect(section.getByRole("switch", { name: "GitHub writes" })).toBeDisabled();
  await expect(section).toContainText("This build is read-only");
  await context.close();
});

test("turning GitHub writes on asks the server and reflects the gate", async ({ browser }) => {
  const { context, page } = await as(browser);
  let body: unknown = null;
  await page.route("**/api/settings/writes", async (route) => {
    if (route.request().method() === "POST") {
      body = route.request().postDataJSON();
      await route.fulfill({ json: { writes: gate({ allowed: true, settingOn: true }) } });
    } else {
      await route.fulfill({ json: { writes: gate() } });
    }
  });
  await page.goto("/settings");
  const toggle = page.locator("#writes").getByRole("switch", { name: "GitHub writes" });
  await expect(toggle).toBeEnabled();
  await toggle.click();
  await expect.poll(() => body).toEqual({ on: true });
  await expect(toggle).toBeChecked();
  await expect(page.locator("[data-writes-on]")).toContainText("Writes are on");
  await context.close();
});

test("a token that can't write keeps the switch off and names why", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.route("**/api/settings/writes", (route) =>
    route.fulfill({ json: { writes: gate({ tokenAccess: "no", tokenMessage: "This token can't write: missing Organization → Projects: Read and write" }) } }),
  );
  await page.goto("/settings");
  const section = page.locator("#writes");
  await expect(section.getByRole("switch", { name: "GitHub writes" })).toBeDisabled();
  await expect(section).toContainText("This token can't write");
  await context.close();
});
