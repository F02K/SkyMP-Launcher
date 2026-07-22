import { test, expect, _electron as electron } from "@playwright/test";
import axe from "axe-core";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("first-run onboarding is keyboard accessible in English and German", async () => {
  const server = http.createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    const pathname = request.url || "";
    if (pathname.endsWith("/launcher/servers"))
      return response.end(
        JSON.stringify({
          items: [
            {
              key: "default",
              name: "Test Server",
              address: "127.0.0.1",
              port: 7777,
            },
          ],
        }),
      );
    if (pathname.includes("/status"))
      return response.end(JSON.stringify({ status: "online", players: 3 }));
    if (pathname.endsWith("/news"))
      return response.end(JSON.stringify({ items: [] }));
    if (pathname.endsWith("/mods"))
      return response.end(JSON.stringify({ items: [] }));
    if (pathname.endsWith("/metrics"))
      return response.end(JSON.stringify({ metrics: {} }));
    if (pathname.includes("/servers/default"))
      return response.end(
        JSON.stringify({ name: "Test Server", maxPlayers: 100 }),
      );
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not found" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "frostfall-e2e-"));
  const port = (server.address() as { port: number }).port;
  const application = await electron.launch({
    args: [".", `--user-data-dir=${userData}`, "--disable-gpu"],
    env: {
      ...process.env,
      API_URL: `http://127.0.0.1:${port}`,
      E2E: "1",
      E2E_USER_DATA: userData,
    },
  });
  try {
    const page = await application.firstWindow();
    await expect(page).toHaveTitle(/Launcher/);
    await expect(page.locator("#modal-onboarding")).toBeVisible();
    await expect(page.locator("#onboarding-server")).toHaveValue("default");
    const fonts = await page.evaluate(async () => {
      await document.fonts.ready;
      return {
        body: document.fonts.check('400 15px "Barlow Condensed"'),
        heading: document.fonts.check('600 13px "Cinzel"'),
      };
    });
    expect(fonts).toEqual({ body: true, heading: true });
    const layout = await page.evaluate(() => {
      const modal = document.querySelector("#modal-onboarding .modal-box");
      const control = document.querySelector("#onboarding-locale");
      const actions = document.querySelector(
        "#modal-onboarding .onboarding-actions",
      );
      if (!modal || !control || !actions) throw new Error("Layout is missing");
      const modalRect = modal.getBoundingClientRect();
      return {
        actionsGap: Number.parseFloat(getComputedStyle(actions).gap),
        controlHeight: control.getBoundingClientRect().height,
        horizontalOverflow:
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
        modalBottom: modalRect.bottom,
        modalLeft: modalRect.left,
        modalRight: modalRect.right,
        modalTop: modalRect.top,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
      };
    });
    expect(layout.horizontalOverflow).toBe(false);
    expect(layout.controlHeight).toBeGreaterThanOrEqual(40);
    expect(layout.actionsGap).toBeGreaterThanOrEqual(12);
    expect(layout.modalLeft).toBeGreaterThanOrEqual(24);
    expect(layout.modalTop).toBeGreaterThanOrEqual(24);
    expect(layout.modalRight).toBeLessThanOrEqual(layout.viewportWidth - 24);
    expect(layout.modalBottom).toBeLessThanOrEqual(layout.viewportHeight - 24);
    await page.locator("#onboarding-locale").selectOption("de");
    await expect(page.locator("#onboarding-title")).toContainText("Willkommen");
    await page.evaluate(axe.source);
    const accessibility = await page.evaluate(() =>
      (
        window as unknown as {
          axe: { run(): Promise<{ violations: Array<{ impact?: string }> }> };
        }
      ).axe.run(),
    );
    expect(
      accessibility.violations.filter(
        (item: { impact?: string }) => item.impact === "critical",
      ),
    ).toEqual([]);
    await page.keyboard.press("Tab");
    await expect(page.locator("#modal-onboarding")).toBeVisible();
  } finally {
    await application.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
