import { chromium } from "playwright";

export const DEFAULT_LIGHTPANDA_WS_ENDPOINT = "ws://127.0.0.1:9222";

export function resolveBrowserEngine(rawValue) {
  const normalized = String(rawValue ?? "").trim().toLowerCase();
  if (normalized === "playwright" || normalized === "lightpanda" || normalized === "auto") {
    return normalized;
  }
  return "auto";
}

export function resolveLightpandaWsEndpoint(rawValue) {
  const value = String(rawValue ?? "").trim();
  return value || DEFAULT_LIGHTPANDA_WS_ENDPOINT;
}

export function buildEngineAttemptOrder(preferredEngine, options = {}) {
  const allowPlaywright = options.allowPlaywright !== false;
  const allowLightpanda = options.allowLightpanda !== false;
  const preferred = resolveBrowserEngine(preferredEngine);

  if (preferred === "playwright") {
    return allowPlaywright ? ["playwright"] : [];
  }

  if (preferred === "lightpanda") {
    return allowLightpanda ? ["lightpanda"] : [];
  }

  const order = [];
  if (allowLightpanda) {
    order.push("lightpanda");
  }
  if (allowPlaywright) {
    order.push("playwright");
  }
  return order;
}

export async function connectLightpandaContext(wsEndpoint) {
  const browser = await chromium.connectOverCDP(wsEndpoint, { timeout: 15000 });
  const existingContext = browser.contexts()[0];
  if (existingContext) {
    return { browser, context: existingContext };
  }

  const context = await browser.newContext({
    acceptDownloads: true,
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    viewport: { width: 1366, height: 900 },
  });

  return { browser, context };
}
