import type {
  AppConfig,
  InstallState,
  PreflightReport,
  PublicSettings,
} from "./types.js";

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const translations = {
  en: {
    website: "WEBSITE",
    stats: "STATS",
    readMore: "READ MORE →",
    play: "▶ PLAY",
    settings: "⚙ Settings",
    system: "System",
    skyrimPath: "Skyrim Installation Path",
    browse: "Browse…",
    language: "Language",
    launchAtLogin: "Start with Windows",
    reduceMotion: "Reduce animations",
    closeBehavior: "When closing",
    afterLaunch: "After game launch",
    exportDiagnostics: "Export diagnostics",
    runSetup: "Run setup assistant",
    repairRequired: "Repair required",
    cancel: "Cancel",
    repairAndPlay: "Repair & Play",
    welcome: "Welcome to Frostfall Launcher",
    setupIntro:
      "Let's prepare Skyrim, the managed MO2 modpack and your server connection.",
    detectSkyrim: "Detect Skyrim",
    skip: "Skip",
    finishSetup: "Finish setup",
    login: "Discord Login",
    logout: "Logout",
    save: "Save Settings",
    saved: "Saved!",
    online: "ONLINE",
    offline: "OFFLINE",
    checking: "CHECKING",
    latestNews: "LATEST NEWS",
    modlist: "MODLIST",
    installed: "installed",
    missing: "missing",
    wrongVersion: "wrong version",
    disabled: "disabled",
    optional: "optional",
    conflict: "conflict",
    auto: "AUTO",
    required: "REQ",
    repairUnavailable: "Resolve the blocking checks before playing.",
    setupComplete: "Setup saved. You can continue with Discord login and PLAY.",
    noNews: "No news available.",
    noMods: "No mod information available.",
    diagnosticsSaved: "Diagnostics exported.",
    download: "Download",
    close: "Close",
    directoryEyebrow: "SKYMP DIRECTORY",
    serverBrowserTitle: "Find a server",
    serverBrowserIntro:
      "Choose a verified server or open one of your favorites.",
    refresh: "Refresh",
    serverSearchPlaceholder: "Search by name, region or tag…",
    favoritesOnly: "Favorites only",
    onlineOnly: "Online only",
    switchServer: "← Switch server",
    toggleFavorite: "Toggle favorite",
    joinDiscord: "Join Discord server",
    directoryUnavailable: "SkyMP Directory is unavailable. Try again.",
    directoryStale:
      "Directory unavailable — known favorites are shown stale and offline.",
    emptyCatalog: "No public SkyMP servers are registered yet.",
    noFilterResults: "No servers match these filters.",
    notListed: "No longer listed",
  },
  de: {
    website: "WEBSEITE",
    stats: "STATISTIK",
    readMore: "MEHR LESEN →",
    play: "▶ SPIELEN",
    settings: "⚙ Einstellungen",
    system: "System",
    skyrimPath: "Skyrim-Installationspfad",
    browse: "Durchsuchen…",
    language: "Sprache",
    launchAtLogin: "Mit Windows starten",
    reduceMotion: "Animationen reduzieren",
    closeBehavior: "Beim Schließen",
    afterLaunch: "Nach dem Spielstart",
    exportDiagnostics: "Diagnose exportieren",
    runSetup: "Einrichtungsassistent starten",
    repairRequired: "Reparatur erforderlich",
    cancel: "Abbrechen",
    repairAndPlay: "Reparieren & spielen",
    welcome: "Willkommen beim Frostfall Launcher",
    setupIntro:
      "Wir richten Skyrim, das verwaltete MO2-Modpack und die Serververbindung ein.",
    detectSkyrim: "Skyrim erkennen",
    skip: "Überspringen",
    finishSetup: "Einrichtung abschließen",
    login: "Discord-Anmeldung",
    logout: "Abmelden",
    save: "Einstellungen speichern",
    saved: "Gespeichert!",
    online: "ONLINE",
    offline: "OFFLINE",
    checking: "PRÜFEN",
    latestNews: "NEUESTE NACHRICHTEN",
    modlist: "MODLISTE",
    installed: "installiert",
    missing: "fehlt",
    wrongVersion: "falsche Version",
    disabled: "deaktiviert",
    optional: "optional",
    conflict: "Konflikt",
    auto: "AUTO",
    required: "PFLICHT",
    repairUnavailable: "Behebe die blockierenden Prüfungen, bevor du spielst.",
    setupComplete:
      "Einrichtung gespeichert. Fahre mit Discord-Anmeldung und SPIELEN fort.",
    noNews: "Keine Nachrichten verfügbar.",
    noMods: "Keine Mod-Informationen verfügbar.",
    diagnosticsSaved: "Diagnose wurde exportiert.",
    download: "Download",
    directoryEyebrow: "SKYMP-VERZEICHNIS",
    serverBrowserTitle: "Server finden",
    serverBrowserIntro:
      "Wähle einen verifizierten Server oder öffne einen deiner Favoriten.",
    refresh: "Aktualisieren",
    serverSearchPlaceholder: "Nach Name, Region oder Tag suchen…",
    favoritesOnly: "Nur Favoriten",
    onlineOnly: "Nur online",
    switchServer: "← Server wechseln",
    toggleFavorite: "Favorit umschalten",
    joinDiscord: "Discord-Server beitreten",
    directoryUnavailable:
      "Die SkyMP Directory ist nicht erreichbar. Erneut versuchen.",
    directoryStale:
      "Directory nicht erreichbar – bekannte Favoriten werden veraltet und offline angezeigt.",
    emptyCatalog: "Noch keine öffentlichen SkyMP-Server registriert.",
    noFilterResults: "Keine Server entsprechen den Filtern.",
    notListed: "Nicht mehr gelistet",
    close: "Schließen",
  },
} as const;

let locale: "en" | "de" = "en";
let appConfig: AppConfig;
let settings: PublicSettings;
let dashboard: any = null;
let latestNewsUrl = "";
let pendingGuildInviteUrl = "";
let previousFocus: HTMLElement | null = null;

function t(key: keyof typeof translations.en): string {
  return translations[locale][key] || translations.en[key];
}
function applyLocale() {
  document.documentElement.lang = locale;
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((element) => {
    const key = element.dataset.i18n as keyof typeof translations.en;
    if (translations.en[key]) element.textContent = t(key);
  });
  $("btn-save").textContent = t("save");
  if (!$<HTMLButtonElement>("btn-connect").disabled)
    $("btn-connect").textContent = t("play");
  document.querySelector(".news-section .section-title")!.textContent =
    t("latestNews");
  document.querySelector(".modlist-section .section-title")!.textContent =
    t("modlist");
  const search = $<HTMLInputElement>("server-search");
  search.placeholder = t("serverSearchPlaceholder");
  search.setAttribute("aria-label", t("serverSearchPlaceholder"));
  $("btn-active-favorite").setAttribute("aria-label", t("toggleFavorite"));
  if (settings) renderServerBrowser();
}

function openModal(id: string) {
  previousFocus = document.activeElement as HTMLElement;
  const overlay = $(id);
  overlay.hidden = false;
  const dialog = overlay.querySelector<HTMLElement>('[role="dialog"]');
  requestAnimationFrame(() =>
    (
      dialog?.querySelector<HTMLElement>("button, input, select") || dialog
    )?.focus(),
  );
}
function closeModal(id: string) {
  $(id).hidden = true;
  previousFocus?.focus();
}
function topModal(): HTMLElement | null {
  return (
    [
      ...document.querySelectorAll<HTMLElement>(".modal-overlay:not([hidden])"),
    ].at(-1) || null
  );
}
document.addEventListener("keydown", (event) => {
  const modal = topModal();
  if (!modal) return;
  if (event.key === "Escape" && modal.id !== "modal-onboarding") {
    event.preventDefault();
    closeModal(modal.id);
    return;
  }
  if (event.key !== "Tab") return;
  const items = [
    ...modal.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]',
    ),
  ];
  if (!items.length) return;
  const first = items[0]!,
    last = items.at(-1)!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

function populateSettings(value: PublicSettings) {
  settings = value;
  locale = value.locale;
  $<HTMLInputElement>("setting-skyrim-path").value = value.skyrimPath;
  $<HTMLInputElement>("setting-modpack-path").value = value.modpackPath;
  $<HTMLSelectElement>("setting-locale").value = value.locale;
  $<HTMLSelectElement>("onboarding-locale").value = value.locale;
  $<HTMLInputElement>("setting-launch-at-login").checked = value.launchAtLogin;
  $<HTMLInputElement>("setting-reduce-motion").checked = value.reduceMotion;
  $<HTMLSelectElement>("setting-close-behavior").value = value.closeBehavior;
  $<HTMLSelectElement>("setting-after-launch").value = value.afterLaunch;
  document.documentElement.dataset.reduceMotion = String(value.reduceMotion);
  const select = $<HTMLSelectElement>("footer-server-select");
  select.replaceChildren(
    ...value.servers.map((server) => {
      const option = document.createElement("option");
      option.value = server.key;
      option.textContent = server.name;
      option.selected = server.key === value.activeServerKey;
      return option;
    }),
  );
  select.hidden = true;
  $("footer-server-name").hidden = false;
  $("footer-server-name").textContent =
    value.servers.find((server) => server.key === value.activeServerKey)
      ?.name || "—";
  const onboardingServer = $<HTMLSelectElement>("onboarding-server");
  onboardingServer.replaceChildren(
    ...value.servers.map((server) => {
      const option = document.createElement("option");
      option.value = server.key;
      option.textContent = server.name;
      option.selected = server.key === value.activeServerKey;
      return option;
    }),
  );
  renderDiscord();
  applyLocale();
  renderServerBrowser();
}

function isFavorite(key: string) {
  return settings.favoriteServerKeys.includes(key);
}

function renderServerBrowser() {
  if (!settings) return;
  const browser = $("server-browser");
  const hasSelection = Boolean(settings.activeServerKey);
  browser.hidden = hasSelection;
  document.querySelector<HTMLElement>(".main-header")!.hidden = !hasSelection;
  document.querySelector<HTMLElement>(".content-layout")!.hidden =
    !hasSelection;
  $("server-info-strip").hidden = !hasSelection;
  $("btn-connect").hidden = !hasSelection;
  if (hasSelection) return;
  const query = $<HTMLInputElement>("server-search")
    .value.trim()
    .toLocaleLowerCase();
  const favoritesOnly = $<HTMLInputElement>("server-filter-favorites").checked;
  const onlineOnly = $<HTMLInputElement>("server-filter-online").checked;
  const servers = [...settings.servers]
    .filter(
      (server) =>
        !query ||
        `${server.name} ${server.description} ${server.region} ${server.tags.join(" ")}`
          .toLocaleLowerCase()
          .includes(query),
    )
    .filter((server) => !favoritesOnly || isFavorite(server.key))
    .filter((server) => !onlineOnly || server.status.state === "online")
    .sort(
      (a, b) =>
        Number(isFavorite(b.key)) - Number(isFavorite(a.key)) ||
        Number(b.status.state === "online") -
          Number(a.status.state === "online") ||
        b.status.online - a.status.online ||
        a.name.localeCompare(b.name),
    );
  const state = $("server-browser-state");
  state.dataset.status = settings.directoryStatus;
  if (settings.directoryStatus === "unavailable")
    state.textContent = t("directoryUnavailable");
  else if (settings.directoryStatus === "stale")
    state.textContent = t("directoryStale");
  else if (!settings.servers.length) state.textContent = t("emptyCatalog");
  else if (!servers.length) state.textContent = t("noFilterResults");
  else
    state.textContent = `${servers.length} ${
      locale === "de" ? "Server" : servers.length === 1 ? "server" : "servers"
    }`;
  const grid = $("server-grid");
  grid.replaceChildren();
  for (const server of servers) {
    const card = document.createElement("article");
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `${server.name}, ${server.status.state}`);
    card.className = `server-card server-card--${server.status.state}${server.stale || !server.listed ? " server-card--stale" : ""}`;
    const title = document.createElement("h2");
    title.className = "server-card-title";
    title.textContent = server.name;
    const favorite = document.createElement("button");
    favorite.className = "server-favorite-button";
    favorite.textContent = isFavorite(server.key) ? "★" : "☆";
    favorite.setAttribute("aria-label", t("toggleFavorite"));
    favorite.addEventListener("click", async (event) => {
      event.stopPropagation();
      populateSettings(await window.electronAPI.toggleFavorite(server.key));
    });
    const description = document.createElement("div");
    description.className = "server-card-description";
    description.textContent =
      server.description || (server.listed ? "" : t("notListed"));
    const meta = document.createElement("div");
    meta.className = "server-card-meta";
    const statusChip = document.createElement("span");
    statusChip.className = `server-chip server-chip--status server-chip--${server.status.state}`;
    statusChip.textContent =
      server.status.state === "online"
        ? `${server.status.online}/${server.status.maxPlayers} online`
        : server.status.state;
    meta.append(statusChip);
    for (const label of [
      server.region,
      ...server.tags.slice(0, 3),
      ...Object.entries(server.versions || {})
        .slice(0, 1)
        .map(([key, value]) => `${key} ${value}`),
    ]) {
      if (!label) continue;
      const chip = document.createElement("span");
      chip.className = "server-chip";
      chip.textContent = label;
      meta.append(chip);
    }
    card.append(title, favorite, description, meta);
    card.addEventListener("click", async () => {
      populateSettings(await window.electronAPI.selectServer(server.key));
      await refreshModpackStatus();
      await refreshDashboard();
    });
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        card.click();
      }
    });
    grid.append(card);
  }
}

function renderDiscord() {
  const slot = $("discord-topbar-slot");
  slot.replaceChildren();
  if (settings?.discordUser) {
    const wrap = document.createElement("div");
    wrap.className = "discord-topbar-user";
    const name = document.createElement("span");
    name.className = "discord-topbar-name";
    name.textContent =
      settings.discordUser.tag || settings.discordUser.username;
    const button = document.createElement("button");
    button.className = "discord-topbar-logout";
    button.textContent = "×";
    button.title = t("logout");
    button.setAttribute("aria-label", t("logout"));
    button.addEventListener("click", async () => {
      await window.electronAPI.discordLogout();
      settings = await window.electronAPI.loadSettings();
      renderDiscord();
      await refreshDashboard();
    });
    wrap.append(name, button);
    slot.append(wrap);
  } else {
    const button = document.createElement("button");
    button.className = "btn-discord-topbar";
    button.textContent = t("login");
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = "…";
      const result = await window.electronAPI.discordLogin();
      if (result.success) {
        settings = await window.electronAPI.loadSettings();
        renderDiscord();
        await refreshDashboard();
      } else {
        $("global-status").textContent = result.error;
        button.disabled = false;
        button.textContent = t("login");
      }
    });
    slot.append(button);
  }
}

async function refreshModpackStatus() {
  const status = await window.electronAPI.modpackStatus();
  $<HTMLInputElement>("setting-modpack-path").value = status.root;
  $("modpack-status-text").textContent = !status.configured
    ? "Not configured in this launcher build"
    : status.installed
      ? `Installed ${status.currentVersion || ""}${status.nexus?.premium ? " · Nexus Premium" : ""}`
      : "Not installed";
}

function renderNews(items: any[]) {
  const grid = $("news-grid");
  grid.replaceChildren();
  latestNewsUrl = "";
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "news-card";
    empty.textContent = t("noNews");
    grid.append(empty);
  }
  for (const item of items) {
    const card = document.createElement(item.url ? "button" : "article");
    card.className = "news-card";
    const imageWrap = document.createElement("div");
    imageWrap.className = "news-card-image";
    if (item.image) {
      const image = document.createElement("img");
      image.src = item.image;
      image.alt = item.title || "";
      imageWrap.append(image);
    }
    const body = document.createElement("div");
    body.className = "news-card-body";
    const tag = document.createElement("div");
    tag.className = "news-card-tag";
    tag.textContent = item.tag || "UPDATE";
    const title = document.createElement("div");
    title.className = "news-card-title";
    title.textContent = item.title || "";
    const description = document.createElement("div");
    description.className = "news-card-desc";
    description.textContent = item.body || "";
    const date = document.createElement("div");
    date.className = "news-card-date";
    date.textContent = item.date || "";
    body.append(tag, title, description, date);
    card.append(imageWrap, body);
    if (item.url) {
      latestNewsUrl ||= item.url;
      card.addEventListener(
        "click",
        () => void window.electronAPI.openExternal(item.url),
      );
    }
    grid.append(card);
  }
  $("btn-read-more").hidden = !latestNewsUrl;
}

function renderMods(items: any[]) {
  const panel = $("modlist");
  panel.replaceChildren();
  for (const mod of items) {
    const row = document.createElement("div");
    row.className = `modlist-item${mod.enabled === false ? " modlist-item--disabled" : ""}`;
    const dot = document.createElement("span");
    dot.className = `mod-dot ${["missing", "wrongVersion", "conflict"].includes(mod.status) ? "mod-dot--disabled" : "mod-dot--enabled"}`;
    const name = document.createElement("span");
    name.className = "mod-name";
    name.textContent = mod.name || "Unknown mod";
    name.title = name.textContent;
    row.append(dot, name);
    const status = document.createElement("span");
    status.className = "mod-badge";
    status.textContent =
      t(
        (mod.status ||
          (mod.enabled === false ? "disabled" : "installed")) as any,
      ) || mod.status;
    row.append(status);
    if (mod.required) {
      const badge = document.createElement("span");
      badge.className = "mod-badge mod-badge--required";
      badge.textContent = t("required");
      row.append(badge);
    }
    if (!mod.required) {
      const badge = document.createElement("span");
      badge.className = "mod-badge";
      badge.textContent = t("optional");
      row.append(badge);
    }
    if (mod.source === "nexus" && mod.nexusId) {
      const link = document.createElement("button");
      link.className = "mod-nexus-link";
      link.textContent = "Nexus";
      link.addEventListener(
        "click",
        () =>
          void window.electronAPI.openExternal(
            `https://www.nexusmods.com/skyrimspecialedition/mods/${mod.nexusId}`,
          ),
      );
      row.append(link);
    }
    const version = document.createElement("span");
    version.className = "mod-version";
    version.textContent = mod.version ? `v${mod.version}` : "";
    row.append(version);
    panel.append(row);
  }
  $("modlist-count").textContent =
    `${items.filter((mod) => mod.enabled !== false).length} / ${items.length}`;
  if (!items.length) panel.textContent = t("noMods");
}

function renderMetrics(value: any) {
  const grid = $("metrics-grid");
  grid.replaceChildren();
  if (!value) {
    grid.textContent = "—";
    return;
  }
  const metrics = value.metrics || value;
  for (const [label, metric] of Object.entries(metrics).slice(0, 8)) {
    const card = document.createElement("div");
    card.className = "metric-card";
    const key = document.createElement("div");
    key.className = "metric-label";
    key.textContent = label.replace(/^skymp_/, "").replaceAll("_", " ");
    const data = document.createElement("div");
    data.className = "metric-value";
    data.textContent =
      typeof metric === "number" ? metric.toLocaleString() : String(metric);
    card.append(key, data);
    grid.append(card);
  }
}

async function refreshDashboard() {
  if (!settings.activeServerKey) {
    dashboard = null;
    renderServerBrowser();
    return;
  }
  $("badge-label").textContent = t("checking");
  dashboard = await window.electronAPI.fetchDashboard();
  const online =
    (dashboard?.status?.status ||
      dashboard?.status?.state ||
      dashboard?.server?.status?.state) === "online";
  $("badge-status").classList.toggle("online", online);
  $("badge-label").textContent = online ? t("online") : t("offline");
  const players = $("badge-players");
  const onlinePlayers =
    dashboard?.status?.players ??
    dashboard?.status?.online ??
    dashboard?.server?.status?.online;
  players.hidden = onlinePlayers == null;
  players.textContent = `${onlinePlayers || 0} PLAYERS`;
  const server = dashboard?.server;
  if (server) {
    $("overview-server-name").textContent = server.name;
    $("overview-server-description").textContent = server.description || "";
    $("btn-active-favorite").textContent = isFavorite(server.key) ? "★" : "☆";
    const meta = $("overview-server-meta");
    meta.replaceChildren();
    for (const label of [
      server.region,
      ...server.tags,
      ...Object.entries(server.versions || {}).map(
        ([key, value]) => `${key} ${value}`,
      ),
    ]) {
      if (!label) continue;
      const chip = document.createElement("span");
      chip.className = "server-chip";
      chip.textContent = String(label);
      meta.append(chip);
    }
    $("server-access-message").textContent = !server.listed
      ? locale === "de"
        ? "Dieser Favorit ist nicht mehr gelistet und kann nicht gestartet werden."
        : "This favorite is no longer listed and cannot be started."
      : server.stale
        ? locale === "de"
          ? "Veralteter Directory-Cache – Serverstatus unbekannt."
          : "Stale Directory cache — server status unknown."
        : dashboard?.info?.access?.allowed
          ? ""
          : dashboard?.info?.access?.reason || "";
  }
  if (dashboard?.info) {
    $("server-info-strip").hidden = false;
    $("sinfo-name").textContent = dashboard.info.name || dashboard.server.name;
    $("sinfo-capacity").textContent = dashboard.info.maxPlayers
      ? `Max ${dashboard.info.maxPlayers}`
      : "";
    $("sinfo-mode").textContent = dashboard.info.gamemode || "";
    $("sinfo-mode").hidden = !dashboard.info.gamemode;
    $("sinfo-mode-sep").hidden = !dashboard.info.gamemode;
    $("sinfo-discord").hidden = !dashboard.info.discordAuthRequired;
    $("sinfo-discord-sep").hidden = !dashboard.info.discordAuthRequired;
    $("sinfo-locked").hidden = !dashboard.info.locked;
    $("sinfo-locked-sep").hidden = !dashboard.info.locked;
  }
  renderNews(dashboard?.news || []);
  renderMods(dashboard?.mods || []);
  renderMetrics(dashboard?.metrics);
  $("news-section").hidden = !dashboard?.capabilities?.news;
  $("modlist-section").hidden = !dashboard?.capabilities?.mods;
  $("btn-stats").hidden = !dashboard?.capabilities?.metrics;
  renderServerBrowser();
}

function showPreflight(report: PreflightReport) {
  const list = $("preflight-list");
  list.replaceChildren(
    ...report.checks.map((check) => {
      const item = document.createElement("div");
      item.className = `preflight-item preflight-item--${check.status}`;
      item.textContent = `${check.status === "ok" ? "✓" : check.status === "warning" ? "!" : "×"} ${check.message}`;
      return item;
    }),
  );
  const confirm = $<HTMLButtonElement>("btn-confirm-repair");
  confirm.disabled = !report.repairable;
  confirm.textContent = report.repairable
    ? `${t("repairAndPlay")} (${(report.downloadBytes / 1024 / 1024).toFixed(1)} MB)`
    : t("repairUnavailable");
  openModal("modal-repair");
}

async function saveSettings(onboardingVersion = settings.onboardingVersion) {
  const value = await window.electronAPI.saveSettings({
    skyrimPath: $<HTMLInputElement>("setting-skyrim-path").value.trim(),
    locale: $<HTMLSelectElement>("setting-locale").value as "en" | "de",
    onboardingVersion,
    launchAtLogin: $<HTMLInputElement>("setting-launch-at-login").checked,
    reduceMotion: $<HTMLInputElement>("setting-reduce-motion").checked,
    closeBehavior: $<HTMLSelectElement>("setting-close-behavior").value as any,
    afterLaunch: $<HTMLSelectElement>("setting-after-launch").value as any,
  });
  populateSettings(value);
  return value;
}

async function initialize() {
  appConfig = await window.electronAPI.getAppConfig();
  document.title = appConfig.app.productName;
  $("launcher-name").textContent = appConfig.app.shortName;
  $("launcher-emblem").textContent = appConfig.branding.emblem;
  $("launcher-tagline").textContent = appConfig.branding.tagline;
  document.querySelectorAll<HTMLElement>("[data-href]").forEach((link) => {
    const url = (appConfig.links as any)[link.dataset.href!];
    link.hidden = !url;
    link.addEventListener(
      "click",
      () => void window.electronAPI.openExternal(url),
    );
  });
  settings = await window.electronAPI.loadSettings();
  populateSettings(settings);
  await refreshModpackStatus();
  if (settings.onboardingVersion < 2) openModal("modal-onboarding");
  await refreshDashboard();
  const update = await window.electronAPI.getUpdateState();
  $("launcher-version").textContent = update.currentVersion || "2.0.0";
  setInterval(() => void refreshDashboard(), 30_000);
}

$("btn-minimize").addEventListener("click", () =>
  window.electronAPI.minimize(),
);
$("btn-maximize").addEventListener("click", () =>
  window.electronAPI.maximize(),
);
$("btn-close").addEventListener("click", () => window.electronAPI.close());
$("btn-gear").addEventListener("click", () => openModal("modal-settings"));
$<HTMLInputElement>("server-search").addEventListener(
  "input",
  renderServerBrowser,
);
$<HTMLInputElement>("server-filter-favorites").addEventListener(
  "change",
  renderServerBrowser,
);
$<HTMLInputElement>("server-filter-online").addEventListener(
  "change",
  renderServerBrowser,
);
$("btn-directory-retry").addEventListener("click", async () =>
  populateSettings(await window.electronAPI.loadSettings()),
);
$("btn-switch-server").addEventListener("click", async () =>
  populateSettings(await window.electronAPI.showServerBrowser()),
);
$("btn-active-favorite").addEventListener("click", async () => {
  if (settings.activeServerKey)
    populateSettings(
      await window.electronAPI.toggleFavorite(settings.activeServerKey),
    );
});
$("btn-guild-invite").addEventListener("click", () => {
  if (pendingGuildInviteUrl)
    void window.electronAPI.openExternal(pendingGuildInviteUrl);
});
$("modal-close").addEventListener("click", () => closeModal("modal-settings"));
$("btn-stats").addEventListener("click", () => {
  renderMetrics(dashboard?.metrics);
  openModal("modal-metrics");
});
$("metrics-close").addEventListener("click", () => closeModal("modal-metrics"));
$("btn-read-more").addEventListener("click", () => {
  if (latestNewsUrl) void window.electronAPI.openExternal(latestNewsUrl);
});
document.querySelectorAll<HTMLElement>(".modal-overlay").forEach((overlay) =>
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay && overlay.id !== "modal-onboarding")
      closeModal(overlay.id);
  }),
);
document.querySelectorAll<HTMLButtonElement>(".modal-tab").forEach((tab) =>
  tab.addEventListener("click", () => {
    document
      .querySelectorAll(".modal-tab")
      .forEach((value) => value.classList.remove("active"));
    document
      .querySelectorAll<HTMLElement>(".tab-panel")
      .forEach((value) => (value.hidden = true));
    tab.classList.add("active");
    $(`tab-${tab.dataset.tab}`).hidden = false;
  }),
);
document
  .querySelector<HTMLElement>('[data-close="repair"]')!
  .addEventListener("click", () => closeModal("modal-repair"));
$("btn-browse").addEventListener("click", async () => {
  const value = await window.electronAPI.openFolder("skyrim");
  if (value) $<HTMLInputElement>("setting-skyrim-path").value = value;
});
$("btn-select-modpack-location").addEventListener("click", async () => {
  populateSettings(await window.electronAPI.selectModpackLocation());
  await refreshModpackStatus();
});
$("btn-nexus-login").addEventListener("click", async () => {
  const status = await window.electronAPI.nexusLogin();
  $("install-status-modpack").textContent = status.premium
    ? "Nexus Premium connected — downloads are automatic."
    : "Nexus connected — guided Slow Download queue will be used.";
  await refreshModpackStatus();
});
$("btn-save").addEventListener("click", async () => {
  await saveSettings();
  $("btn-save").textContent = t("saved");
  setTimeout(() => ($("btn-save").textContent = t("save")), 1200);
  closeModal("modal-settings");
  await refreshDashboard();
});
$("setting-locale").addEventListener("change", () => {
  locale = $<HTMLSelectElement>("setting-locale").value as any;
  $<HTMLSelectElement>("onboarding-locale").value = locale;
  applyLocale();
});
$<HTMLSelectElement>("onboarding-locale").addEventListener("change", () => {
  locale = $<HTMLSelectElement>("onboarding-locale").value as any;
  $<HTMLSelectElement>("setting-locale").value = locale;
  applyLocale();
});
$("btn-diagnostics").addEventListener("click", async () => {
  const result = await window.electronAPI.exportDiagnostics();
  if (result.success) $("global-status").textContent = t("diagnosticsSaved");
});
$("btn-onboarding").addEventListener("click", () =>
  openModal("modal-onboarding"),
);
$("btn-auto-skyrim").addEventListener("click", async () => {
  const value = await window.electronAPI.detectSkyrim();
  if (value.found) {
    $<HTMLInputElement>("setting-skyrim-path").value = value.path;
    $("onboarding-status").textContent = value.path;
  } else $("onboarding-status").textContent = "Skyrim was not detected.";
});
$("btn-onboarding-modpack").addEventListener("click", async () => {
  populateSettings(await window.electronAPI.selectModpackLocation());
  $("onboarding-status").textContent = settings.modpackPath;
});
$<HTMLSelectElement>("onboarding-server").addEventListener(
  "change",
  async (event) => {
    populateSettings(
      await window.electronAPI.selectServer(
        (event.target as HTMLSelectElement).value,
      ),
    );
    await refreshModpackStatus();
    await refreshDashboard();
  },
);
$("btn-onboarding-login").addEventListener("click", async () => {
  const button = $<HTMLButtonElement>("btn-onboarding-login");
  button.disabled = true;
  const result = await window.electronAPI.discordLogin();
  button.disabled = false;
  $("onboarding-status").textContent = result.success
    ? `✓ ${result.user.username}`
    : result.error;
  if (result.success) populateSettings(await window.electronAPI.loadSettings());
});
$("btn-onboarding-check").addEventListener("click", async () => {
  await saveSettings(settings.onboardingVersion);
  const report = await window.electronAPI.preflight();
  const list = $("onboarding-preflight");
  list.replaceChildren(
    ...report.checks.map((check) => {
      const item = document.createElement("div");
      item.className = `preflight-item preflight-item--${check.status}`;
      item.textContent = `${check.status === "ok" ? "✓" : "×"} ${check.message}`;
      return item;
    }),
  );
});
$("btn-skip-onboarding").addEventListener("click", async () => {
  await saveSettings(2);
  closeModal("modal-onboarding");
});
$("btn-finish-onboarding").addEventListener("click", async () => {
  try {
    await saveSettings(2);
    $("onboarding-status").textContent = t("setupComplete");
    setTimeout(() => closeModal("modal-onboarding"), 800);
  } catch (error) {
    $("onboarding-status").textContent = (error as Error).message;
  }
});
$<HTMLSelectElement>("footer-server-select").addEventListener(
  "change",
  async (event) => {
    populateSettings(
      await window.electronAPI.selectServer(
        (event.target as HTMLSelectElement).value,
      ),
    );
    await refreshModpackStatus();
    await refreshDashboard();
  },
);
$("btn-connect").addEventListener("click", async () => {
  const button = $<HTMLButtonElement>("btn-connect");
  button.disabled = true;
  button.textContent = "…";
  const result = await window.electronAPI.play();
  button.disabled = false;
  button.textContent = t("play");
  if (!result.success && result.preflight) showPreflight(result.preflight);
  else if (!result.success) {
    $("connect-warning").textContent = result.error || "";
    $("connect-warning").classList.add("visible");
    pendingGuildInviteUrl =
      result.errorCode === "guildMembershipRequired"
        ? result.inviteUrl || ""
        : "";
    $("btn-guild-invite").hidden = !pendingGuildInviteUrl;
    $("server-access-message").textContent =
      result.errorCode === "guildMembershipRequired"
        ? locale === "de"
          ? "Mitgliedschaft im Discord-Server erforderlich. Tritt bei und klicke danach erneut auf Spielen."
          : "Discord server membership is required. Join it, then click Play again."
        : result.error || "";
  }
});
$("btn-confirm-repair").addEventListener("click", async () => {
  $<HTMLButtonElement>("btn-confirm-repair").disabled = true;
  $("btn-cancel-repair").hidden = false;
  $("install-progress").hidden = false;
  const result = await window.electronAPI.repair();
  if (result.success) {
    closeModal("modal-repair");
    await window.electronAPI.play();
  } else {
    $("repair-status").textContent = result.error || "";
    $<HTMLButtonElement>("btn-confirm-repair").disabled = false;
  }
});
$("btn-cancel-repair").addEventListener(
  "click",
  () => void window.electronAPI.cancelInstall(),
);
$("btn-install-client").addEventListener("click", async () => {
  const report = await window.electronAPI.preflight();
  showPreflight(report);
});
$("btn-install-modpack").addEventListener("click", async () => {
  const report = await window.electronAPI.preflight();
  showPreflight(report);
});
window.electronAPI.onInstallState((state: InstallState) => {
  $("repair-status").textContent = state.message;
  $<HTMLProgressElement>("install-progress").value = state.percent || 0;
  $("btn-cancel-repair").hidden = !state.canCancel;
});
window.electronAPI.onUpdateState((state) => {
  $("launcher-version").textContent =
    state.status === "ready"
      ? `${state.currentVersion} ↑`
      : state.currentVersion || "2.0.0";
  if (state.status === "ready")
    $("launcher-version").addEventListener(
      "click",
      () => void window.electronAPI.installUpdate(),
      { once: true },
    );
});

void initialize().catch((error) => {
  $("global-status").textContent = (error as Error).message;
  console.error(error);
});
