import { test, expect, _electron as electron } from "@playwright/test";
import axe from "axe-core";
import crypto from "node:crypto";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("first-run onboarding is keyboard accessible in English and German", async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const server = http.createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    const pathname = request.url || "";
    if (pathname === "/api/servers" || pathname.startsWith("/api/servers?")) {
      const raw = JSON.stringify({
        items: [
          {
            serverId: "default",
            descriptor: {
              contract: "directory-managed",
              name: "Test Server",
              description: "",
              gameAddress: "127.0.0.1:7777",
              publicBackendUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
              region: "test",
              tags: [],
              versions: {},
              visibility: "public",
              maxPlayers: 100,
            },
            status: { state: "online", online: 3, maxPlayers: 100 },
            lastHeartbeatAt: Date.now(),
          },
        ],
        generatedAt: Date.now(),
      });
      response.setHeader(
        "x-skymp-signature",
        crypto.sign(null, Buffer.from(raw), privateKey).toString("base64url"),
      );
      return response.end(raw);
    }
    if (pathname === "/api/launcher/servers/default/status")
      return response.end(JSON.stringify({ status: "online", players: 3 }));
    if (pathname === "/api/launcher/servers/default/news")
      return response.end(JSON.stringify({ items: [] }));
    if (pathname === "/api/launcher/servers/default/mods")
      return response.end(JSON.stringify({ items: [] }));
    if (pathname === "/api/launcher/servers/default/metrics")
      return response.end(JSON.stringify({ metrics: {} }));
    if (pathname === "/api/launcher/servers/default")
      return response.end(
        JSON.stringify({
          name: "Test Server",
          maxPlayers: 100,
          capabilities: {
            authentication: "directory-discord",
            news: true,
            mods: true,
            metrics: false,
            clientDistribution: false,
            modpack: false,
          },
          access: { sessionValid: false, allowed: false },
        }),
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
      DIRECTORY_URL: `http://127.0.0.1:${port}`,
      DIRECTORY_PUBLIC_KEY: publicKey
        .export({ format: "der", type: "spki" })
        .toString("base64"),
      E2E: "1",
      E2E_USER_DATA: userData,
    },
  });
  try {
    const page = await application.firstWindow();
    await expect(page).toHaveTitle(/Launcher/);
    await expect(page.locator("#modal-onboarding")).toBeVisible();
    await expect(page.locator("#onboarding-server")).toHaveValue("default");
    await expect(page.locator("#onboarding-locale")).toHaveValue("en");
    await expect(page.locator("#server-browser h1")).toHaveText(
      "Find a server",
    );
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
    await expect(page.locator("#server-browser h1")).toHaveText(
      "Server finden",
    );
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
    await page.locator("#btn-skip-onboarding").click();
    await expect(page.locator("#server-browser")).toBeVisible();
    await expect(page.locator(".content-layout")).toBeHidden();
    await expect(page.locator("#news-section")).toBeHidden();
    await expect(page.locator("#modlist-section")).toBeHidden();
    await expect(page.locator("#server-grid .server-card")).toContainText(
      "Test Server",
    );
    const favoriteFilter = page.locator("#server-filter-favorites");
    await expect(favoriteFilter).toHaveCSS("appearance", "none");
    const checkboxSize = await favoriteFilter.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    expect(checkboxSize).toEqual({ width: 20, height: 20 });
    await favoriteFilter.check();
    await expect(favoriteFilter).toBeChecked();
    await expect(page.locator("#server-grid .server-card")).toHaveCount(0);
    await favoriteFilter.uncheck();
    await expect(page.locator("#server-grid .server-card")).toHaveCount(1);
    await expect(page.locator("#footer-server-name")).toHaveText("—");
    await page.locator("#server-grid .server-card").click();
    await expect(page.locator("#server-browser")).toBeHidden();
    await expect(page.locator(".content-layout")).toBeVisible();
    await expect(page.locator("#news-section")).toBeVisible();
    await expect(page.locator("#modlist-section")).toBeVisible();
    await expect(page.locator("#overview-server-name")).toHaveText(
      "Test Server",
    );
    const overviewLayout = await page.evaluate(() => {
      const overview = document.querySelector("#server-overview-header")!;
      const news = document.querySelector("#news-section")!;
      const mods = document.querySelector("#modlist-section")!;
      const overviewRect = overview.getBoundingClientRect();
      const newsRect = news.getBoundingClientRect();
      const modsRect = mods.getBoundingClientRect();
      return {
        overviewWidth: overviewRect.width,
        columnsWidth: modsRect.right - newsRect.left,
      };
    });
    expect(overviewLayout.overviewWidth).toBeGreaterThanOrEqual(
      overviewLayout.columnsWidth,
    );
    await page.locator("#btn-switch-server").click();
    await expect(page.locator("#server-browser")).toBeVisible();
    await expect(page.locator(".content-layout")).toBeHidden();
    await expect(page.locator("#news-section")).toBeHidden();
    await expect(page.locator("#modlist-section")).toBeHidden();
  } finally {
    await application.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test("an authoritative empty catalog shows the dedicated server-browser state", async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const server = http.createServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    const raw = JSON.stringify({ items: [], generatedAt: Date.now() });
    response.setHeader(
      "x-skymp-signature",
      crypto.sign(null, Buffer.from(raw), privateKey).toString("base64url"),
    );
    response.end(raw);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const userData = fs.mkdtempSync(
    path.join(os.tmpdir(), "frostfall-empty-e2e-"),
  );
  const port = (server.address() as { port: number }).port;
  const application = await electron.launch({
    args: [".", `--user-data-dir=${userData}`, "--disable-gpu"],
    env: {
      ...process.env,
      DIRECTORY_URL: `http://127.0.0.1:${port}`,
      DIRECTORY_PUBLIC_KEY: publicKey
        .export({ format: "der", type: "spki" })
        .toString("base64"),
      E2E: "1",
      E2E_USER_DATA: userData,
    },
  });
  try {
    const page = await application.firstWindow();
    await expect(page.locator("#modal-onboarding")).toBeVisible();
    await page.locator("#onboarding-locale").selectOption("en");
    await page.locator("#btn-skip-onboarding").click();
    await expect(page.locator("#server-browser-state")).toContainText(
      "No public SkyMP servers are registered yet.",
    );
    await expect(page.locator("#server-grid .server-card")).toHaveCount(0);
  } finally {
    await application.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
