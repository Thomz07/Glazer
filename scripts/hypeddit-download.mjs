import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import {
  buildEngineAttemptOrder,
  connectLightpandaContext,
  resolveBrowserEngine,
  resolveLightpandaWsEndpoint,
} from "./browser-engine.mjs";

const hypedditUrl = process.argv[2];
const outputFolder = process.argv[3];
const overwriteArg = process.argv[4] ?? "false";
const preferredFilePathArg = process.argv[5] ?? "";
const headlessArg = process.argv[6] ?? "true";
const commentArg = process.argv[7] ?? "Nice!";
const nameArg = process.argv[8] ?? "Jojo";
const emailArg = process.argv[9] ?? "jouch@hippo.com";
const useAppSoundCloudArg = process.argv[10] ?? "false";
const useAppSpotifyArg = process.argv[11] ?? "false";
const profileDirArg = process.argv[12] ?? "";
const downloadStartTimeoutSecondsArg = process.argv[13] ?? "30";
const clickDelayMsArg = process.argv[14] ?? "0";
const manualSoundCloudCookiesPathArg = process.argv[15] ?? "";
const browserEngineArg = process.argv[16] ?? "auto";
const lightpandaWsEndpointArg = process.argv[17] ?? "";

if (!hypedditUrl) {
  console.error("Missing Hypeddit URL");
  process.exit(1);
}

if (!outputFolder) {
  console.error("Missing output folder");
  process.exit(1);
}

const overwriteExisting = overwriteArg === "true";
const preferredFilePath = preferredFilePathArg.trim() || null;
const headless = headlessArg === "true";
const comment = commentArg.trim() || "Nice!";
const userName = nameArg.trim() || "Jojo";
const userEmail = emailArg.trim() || "jouch@hippo.com";
const useAppSoundCloudConnection = useAppSoundCloudArg === "true";
const useAppSpotifyConnection = useAppSpotifyArg === "true";
const profileDir = profileDirArg.trim() || path.join(outputFolder, ".playwright-hypeddit-profile");
const parsedDownloadStartTimeoutSeconds = Number.parseInt(downloadStartTimeoutSecondsArg, 10);
const downloadStartTimeoutSeconds = Number.isFinite(parsedDownloadStartTimeoutSeconds)
  ? Math.min(300, Math.max(5, parsedDownloadStartTimeoutSeconds))
  : 30;
const downloadStartTimeoutMs = downloadStartTimeoutSeconds * 1000;
const parsedClickDelayMs = Number.parseInt(clickDelayMsArg, 10);
const clickDelayMs = Number.isFinite(parsedClickDelayMs)
  ? Math.min(5000, Math.max(0, parsedClickDelayMs))
  : 0;
const manualSoundCloudCookiesPath = manualSoundCloudCookiesPathArg.trim();
const browserEnginePreference = resolveBrowserEngine(browserEngineArg);
const lightpandaWsEndpoint = resolveLightpandaWsEndpoint(lightpandaWsEndpointArg);

process.stdout.write(
  `__LOG__:app_connections soundcloud=${useAppSoundCloudConnection} spotify=${useAppSpotifyConnection} headless=${headless} download_start_timeout_seconds=${downloadStartTimeoutSeconds} click_delay_ms=${clickDelayMs} browser_engine_pref=${browserEnginePreference}\n`,
);

function normalizeSameSiteValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "strict") {
    return "Strict";
  }
  if (normalized === "none") {
    return "None";
  }
  return "Lax";
}

function normalizeEpochSeconds(value) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return Math.floor(parsed);
}

function normalizePlaywrightCookie(rawCookie) {
  if (!rawCookie || typeof rawCookie !== "object") {
    return null;
  }

  const name = String(rawCookie.name ?? "").trim();
  const value = String(rawCookie.value ?? "");
  if (!name) {
    return null;
  }

  const rawDomain = String(rawCookie.domain ?? "").trim();
  const domain = rawDomain || undefined;
  const pathValue = String(rawCookie.path ?? "/").trim() || "/";
  const secure = Boolean(rawCookie.secure);
  const httpOnly = Boolean(rawCookie.httpOnly);

  const normalizedCookie = {
    name,
    value,
    secure,
    httpOnly,
    sameSite: normalizeSameSiteValue(rawCookie.sameSite),
  };

  const normalizedExpires = normalizeEpochSeconds(rawCookie.expires ?? rawCookie.expirationDate);
  if (normalizedExpires !== undefined) {
    normalizedCookie.expires = normalizedExpires;
  }

  if (domain) {
    normalizedCookie.domain = domain;
    normalizedCookie.path = pathValue;
  } else {
    const rawUrl = String(rawCookie.url ?? "").trim();
    if (!rawUrl) {
      return null;
    }
    normalizedCookie.url = rawUrl;
  }

  return normalizedCookie;
}

async function applyManualSoundCloudCookies(context, cookiesFilePath) {
  if (!cookiesFilePath) {
    return false;
  }

  if (!fs.existsSync(cookiesFilePath)) {
    process.stdout.write(`__LOG__:Manual SoundCloud cookies file missing: ${cookiesFilePath}\n`);
    return false;
  }

  try {
    const rawContent = fs.readFileSync(cookiesFilePath, "utf8");
    if (!rawContent.trim()) {
      process.stdout.write("__LOG__:Manual SoundCloud cookies file is empty.\n");
      return false;
    }

    const parsed = JSON.parse(rawContent);
    const rawCookies = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.cookies)
        ? parsed.cookies
        : [];

    const normalizedCookies = rawCookies
      .map((cookie) => normalizePlaywrightCookie(cookie))
      .filter((cookie) => {
        if (!cookie) {
          return false;
        }

        const cookieDomain = String(cookie.domain || "").toLowerCase();
        const cookieUrl = String(cookie.url || "").toLowerCase();
        return cookieDomain.includes("soundcloud.com") || cookieUrl.includes("soundcloud.com");
      });

    if (normalizedCookies.length === 0) {
      process.stdout.write("__LOG__:No usable SoundCloud cookies found in manual cookies file.\n");
      return false;
    }

    await context.addCookies(normalizedCookies);
    process.stdout.write(`__LOG__:Applied ${normalizedCookies.length} manual SoundCloud cookies.\n`);
    return true;
  } catch (error) {
    process.stdout.write(`__LOG__:Manual SoundCloud cookies ignored: ${String(error)}\n`);
    return false;
  }
}

function buildCommonLaunchOptions(isHeadless) {
  return {
    headless: isHeadless,
    acceptDownloads: true,
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    viewport: { width: 1366, height: 900 },
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-default-browser-check",
      "--disable-features=IsolateOrigins,site-per-process",
    ],
  };
}

async function launchPlaywrightContextWithBrowserFallback(profileDirectory, isHeadless) {
  const base = buildCommonLaunchOptions(isHeadless);

  const candidates = [
    { label: "chrome-channel", options: { channel: "chrome" } },
    { label: "playwright-chromium", options: {} },
  ];

  const errors = [];
  for (const candidate of candidates) {
    try {
      const context = await chromium.launchPersistentContext(profileDirectory, {
        ...base,
        ...candidate.options,
      });
      process.stdout.write(`__LOG__:Browser launch candidate selected: ${candidate.label}\n`);
      return context;
    } catch (error) {
      errors.push(`${candidate.label}: ${error?.message ?? String(error)}`);
    }
  }

  throw new Error(`Aucun navigateur compatible trouve. Details: ${errors.join(" | ")}`);
}

async function launchAutomationContext(profileDirectory, isHeadless) {
  const compatibilityIssues = [];
  if (!isHeadless) {
    compatibilityIssues.push("Lightpanda est headless-only (active headless=true).");
  }
  if (useAppSoundCloudConnection || useAppSpotifyConnection) {
    compatibilityIssues.push("Les sessions connectees des providers utilisent le profil Playwright persistant.");
  }

  const allowLightpanda = compatibilityIssues.length === 0;
  if (browserEnginePreference === "lightpanda" && !allowLightpanda) {
    throw new Error(`Lightpanda incompatible avec cette execution: ${compatibilityIssues.join(" ")}`);
  }

  const attemptOrder = buildEngineAttemptOrder(browserEnginePreference, {
    allowPlaywright: true,
    allowLightpanda,
  });

  const errors = [];

  for (const engine of attemptOrder) {
    if (engine === "lightpanda") {
      try {
        const { context } = await connectLightpandaContext(lightpandaWsEndpoint);
        process.stdout.write(`__LOG__:Browser engine selected: lightpanda (${lightpandaWsEndpoint})\n`);

        return {
          engine,
          context,
          close: async () => {
            for (const candidatePage of context.pages()) {
              try {
                if (!candidatePage.isClosed()) {
                  await candidatePage.close({ runBeforeUnload: false });
                }
              } catch {
                // Ignore page close errors.
              }
            }
          },
        };
      } catch (error) {
        errors.push(`${engine}: ${error?.message ?? String(error)}`);
        continue;
      }
    }

    try {
      const context = await launchPlaywrightContextWithBrowserFallback(profileDirectory, isHeadless);
      process.stdout.write("__LOG__:Browser engine selected: playwright\n");

      return {
        engine,
        context,
        close: async () => {
          await context.close().catch(() => {});
        },
      };
    } catch (error) {
      errors.push(`${engine}: ${error?.message ?? String(error)}`);
    }
  }

  throw new Error(`Aucun moteur navigateur compatible trouve. Details: ${errors.join(" | ")}`);
}

async function hasAuthenticatedSoundCloudSession(context) {
  const page = await context.newPage();
  try {
    await page.goto("https://soundcloud.com/you", {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await page.waitForTimeout(1200);

    const currentUrl = page.url().toLowerCase();
    if (
      currentUrl.includes("soundcloud.com/signin") ||
      currentUrl.includes("soundcloud.com/login") ||
      currentUrl.includes("soundcloud.com/connect")
    ) {
      return false;
    }

    const signInLocator = page.locator(
      'a[href*="signin"], a[href*="login"], button:has-text("Sign in"), button:has-text("Log in"), button:has-text("Se connecter")',
    );
    if (await signInLocator.count()) {
      const visible = await signInLocator.first().isVisible().catch(() => false);
      if (visible) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  } finally {
    try {
      if (!page.isClosed()) {
        await page.close({ runBeforeUnload: false });
      }
    } catch {
      // Ignore close errors.
    }
  }
}

async function hasAuthenticatedSpotifySession(context) {
  const page = await context.newPage();
  try {
    await page.goto("https://open.spotify.com/", {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await page.waitForTimeout(1200);

    const currentUrl = page.url().toLowerCase();
    if (currentUrl.includes("accounts.spotify.com") && currentUrl.includes("login")) {
      return false;
    }

    const signInLocator = page.locator(
      'a[href*="login"], button:has-text("Log in"), button:has-text("Se connecter")',
    );
    if (await signInLocator.count()) {
      const visible = await signInLocator.first().isVisible().catch(() => false);
      if (visible) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  } finally {
    try {
      if (!page.isClosed()) {
        await page.close({ runBeforeUnload: false });
      }
    } catch {
      // Ignore close errors.
    }
  }
}

async function waitForPopupByUrl(context, urlFragment, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    for (const candidatePage of context.pages()) {
      if (candidatePage.isClosed()) {
        continue;
      }
      if (candidatePage.url().toLowerCase().includes(urlFragment.toLowerCase())) {
        return candidatePage;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return null;
}

function sanitizeFileName(name) {
  return name
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

function extractFileNameFromContentDisposition(rawValue) {
  if (!rawValue) {
    return null;
  }

  const encodedMatch = rawValue.match(/filename\*=UTF-8''([^;]+)/i);
  if (encodedMatch?.[1]) {
    try {
      return decodeURIComponent(encodedMatch[1].replace(/^"|"$/g, "")).trim();
    } catch {
      // Ignore malformed encoded filenames.
    }
  }

  const plainMatch = rawValue.match(/filename=([^;]+)/i);
  if (plainMatch?.[1]) {
    return plainMatch[1].replace(/^"|"$/g, "").trim();
  }

  return null;
}

function extensionFromContentType(contentType) {
  const normalized = String(contentType || "")
    .split(";")[0]
    .trim()
    .toLowerCase();

  if (normalized === "audio/mpeg" || normalized === "audio/mp3") {
    return ".mp3";
  }
  if (normalized === "audio/wav" || normalized === "audio/x-wav" || normalized === "audio/wave") {
    return ".wav";
  }
  if (normalized === "audio/flac" || normalized === "audio/x-flac") {
    return ".flac";
  }
  if (normalized === "audio/aac") {
    return ".aac";
  }
  if (normalized === "audio/mp4" || normalized === "audio/x-m4a") {
    return ".m4a";
  }
  if (normalized === "audio/ogg") {
    return ".ogg";
  }

  return "";
}

function fileNameFromUrl(downloadUrl) {
  try {
    const parsed = new URL(downloadUrl);
    const candidate = decodeURIComponent(parsed.pathname.split("/").pop() || "").trim();
    return candidate || null;
  } catch {
    return null;
  }
}

function resolveAbsoluteUrl(candidate, baseUrl) {
  const trimmed = String(candidate || "").trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.toLowerCase().startsWith("javascript:")) {
    return null;
  }

  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return null;
  }
}

async function resolveDirectDownloadUrlFromPage(page) {
  const candidate = await page.evaluate(() => {
    const values = [];

    const pushValue = (value) => {
      if (!value) {
        return;
      }
      const normalized = String(value).trim();
      if (!normalized) {
        return;
      }
      values.push(normalized);
    };

    const downloadButton = document.querySelector("#gateDownloadButton");
    if (downloadButton) {
      pushValue(downloadButton.getAttribute("href"));
      pushValue(downloadButton.getAttribute("data-href"));
      pushValue(downloadButton.getAttribute("data-url"));
    }

    for (const anchor of Array.from(document.querySelectorAll("a[href]"))) {
      const href = anchor.getAttribute("href");
      const idValue = String(anchor.getAttribute("id") || "").toLowerCase();
      const textValue = String(anchor.textContent || "").toLowerCase();
      const hrefValue = String(href || "").toLowerCase();

      if (idValue.includes("download") || textValue.includes("download") || hrefValue.includes("download")) {
        pushValue(href);
      }
    }

    return values[0] || null;
  });

  return resolveAbsoluteUrl(candidate, page.url());
}

async function saveDirectDownloadFromUrl(context, downloadUrl) {
  const response = await context.request.get(downloadUrl, {
    timeout: 120000,
    failOnStatusCode: false,
    maxRedirects: 10,
  });

  if (!response.ok()) {
    throw new Error(`Download direct en erreur (${response.status()}) via URL fallback.`);
  }

  const headers = response.headers();
  const contentDisposition = headers["content-disposition"];
  const contentType = headers["content-type"];
  const dispositionName = extractFileNameFromContentDisposition(contentDisposition);
  const urlName = fileNameFromUrl(response.url()) || fileNameFromUrl(downloadUrl);
  const extensionFromType = extensionFromContentType(contentType);

  let suggested = sanitizeFileName(dispositionName || urlName || "track");
  if (!path.extname(suggested) && extensionFromType) {
    suggested = `${suggested}${extensionFromType}`;
  }

  let targetPath = preferredFilePath || path.join(outputFolder, suggested);
  let removedPreviousPreferredFile = false;

  if (preferredFilePath && overwriteExisting) {
    const preferredDirectory = path.dirname(preferredFilePath);
    const preferredStem = path.basename(preferredFilePath, path.extname(preferredFilePath));
    const downloadedExtension = path.extname(suggested) || extensionFromType;

    if (downloadedExtension) {
      const extensionAwareTargetPath = path.join(preferredDirectory, `${preferredStem}${downloadedExtension}`);

      if (extensionAwareTargetPath !== preferredFilePath && fs.existsSync(preferredFilePath)) {
        fs.rmSync(preferredFilePath, { force: true });
        removedPreviousPreferredFile = true;
      }

      targetPath = extensionAwareTargetPath;
    }
  }

  const existedBeforeSave = fs.existsSync(targetPath);
  if (!overwriteExisting && existedBeforeSave) {
    throw new Error(`File already exists at ${targetPath}`);
  }

  if (overwriteExisting && existedBeforeSave) {
    fs.rmSync(targetPath, { force: true });
  }

  const bodyBuffer = Buffer.from(await response.body());

  process.stdout.write("__PROGRESS__:browser_cut\n");
  process.stdout.write("__PROGRESS__:file_saving\n");

  fs.writeFileSync(targetPath, bodyBuffer);

  return {
    file_path: targetPath,
    file_name: path.basename(targetPath),
    overwrote_existing: overwriteExisting && (existedBeforeSave || removedPreviousPreferredFile),
  };
}

async function applyGateDelay(page, baseDelayMs = 0) {
  const finalDelay = Math.max(baseDelayMs, clickDelayMs);
  if (finalDelay > 0) {
    await page.waitForTimeout(finalDelay);
  }
}

async function clickLocatorReliably(locator, label) {
  const firstCandidate = locator.first();
  await firstCandidate.waitFor({ state: "attached", timeout: 15000 });

  let candidate = firstCandidate;
  const totalCandidates = await locator.count().catch(() => 1);
  const maxCandidatesToProbe = Math.max(1, Math.min(totalCandidates, 6));
  for (let index = 0; index < maxCandidatesToProbe; index += 1) {
    const probe = locator.nth(index);
    const visible = await probe.isVisible().catch(() => false);
    if (visible) {
      candidate = probe;
      break;
    }
  }

  await candidate.scrollIntoViewIfNeeded().catch(() => {});

  try {
    await candidate.click({ timeout: 6000 });
    process.stdout.write(`__LOG__:click_ok=${label}:normal\n`);
    return;
  } catch (normalError) {
    process.stdout.write(`__LOG__:click_retry=${label}:force reason=${normalError?.message ?? String(normalError)}\n`);
  }

  try {
    await candidate.click({ timeout: 6000, force: true });
    process.stdout.write(`__LOG__:click_ok=${label}:force\n`);
    return;
  } catch (forceError) {
    process.stdout.write(`__LOG__:click_retry=${label}:dom reason=${forceError?.message ?? String(forceError)}\n`);
  }

  const elementHandle = await candidate.elementHandle();
  if (!elementHandle) {
    throw new Error(`Impossible de cliquer ${label}: element introuvable.`);
  }

  await elementHandle.evaluate((element) => {
    if (typeof element.click === "function") {
      element.click();
      return;
    }

    const mouseDownEvent = new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window });
    const mouseUpEvent = new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window });
    const clickEvent = new MouseEvent("click", { bubbles: true, cancelable: true, view: window });
    element.dispatchEvent(mouseDownEvent);
    element.dispatchEvent(mouseUpEvent);
    element.dispatchEvent(clickEvent);
  });

  process.stdout.write(`__LOG__:click_ok=${label}:dom\n`);
}

async function handleEmailGate(page) {
  const nextButton = page.locator("#email_to_downloads_next").first();
  await nextButton.waitFor({ state: "visible", timeout: 30000 });

  const nameInput = page.locator("#email_name").first();
  if (await nameInput.count()) {
    await nameInput.fill(userName);
  }

  const emailInput = page.locator("#email_address").first();
  await emailInput.fill(userEmail);
  await applyGateDelay(page);
  await nextButton.click();
}

async function handleSoundCloudGate(page, context) {
  const skipper = page.locator("#skipper_sc").first();
  if (await skipper.count()) {
    await skipper.click();
    return;
  }

  const commentInput = page.locator("#sc_comment_text").first();
  if (await commentInput.count()) {
    await commentInput.fill(comment);
    await page.waitForTimeout(500);
  }

  const loginButton = page.locator("#login_to_sc").first();
  await loginButton.waitFor({ state: "visible", timeout: 30000 });
  await applyGateDelay(page);
  await loginButton.click();
  await page.waitForTimeout(1500);

  const popup = await waitForPopupByUrl(context, "soundcloud.com", 5000);
  if (!popup) {
    throw new Error("SoundCloud window not found after clicking login button");
  }

  await popup.bringToFront();
  await popup.setViewportSize({ width: 1366, height: 900 }).catch(() => {});
  await popup.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

  const approveButton = popup.locator("#submit_approval").first();
  await approveButton.waitFor({ state: "visible", timeout: 20000 });
  await approveButton.click();

  const closeDeadline = Date.now() + 15000;
  while (!popup.isClosed() && Date.now() < closeDeadline) {
    await page.waitForTimeout(100);
  }
}

async function closeSocialPopupAndStabilize(page, context, popupHostFragment, clickAction) {
  const pagesBeforeClick = new Set(context.pages().filter((candidatePage) => !candidatePage.isClosed()));
  const popupPromise = context.waitForEvent("page", { timeout: 7000 }).catch(() => null);

  await clickAction();

  let popup = await popupPromise;

  if (!popup) {
    popup = context
      .pages()
      .filter((candidatePage) => !candidatePage.isClosed() && candidatePage !== page)
      .find((candidatePage) => !pagesBeforeClick.has(candidatePage)) || null;
  }

  if (!popup) {
    popup = await waitForPopupByUrl(context, popupHostFragment, 7000);
  }

  if (!popup) {
    const remainingPages = context
      .pages()
      .filter((candidatePage) => !candidatePage.isClosed() && candidatePage !== page);
    popup = remainingPages[remainingPages.length - 1] ?? null;
  }

  if (!popup) {
    process.stdout.write(`__LOG__:Popup ${popupHostFragment} not detected, continuing gate flow.\n`);
    await page.waitForTimeout(1000);
    await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
    return;
  }

  await popup.waitForLoadState("domcontentloaded", { timeout: 7000 }).catch(() => {});
  if (!popup.isClosed()) {
    await popup.close({ runBeforeUnload: false }).catch(() => {});
  }

  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(1000);
  await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
}

async function handleInstagramGate(page, context) {
  const skipper = page.locator("#skipper_ig").first();
  if (await skipper.count()) {
    await skipper.click();
    return;
  }

  const nextButton = page.locator("#skipper_ig_next");
  const instagramButton = page.locator(
    "#instagram_status .hype-btn-instagram.undone, #instagram_status .hype-btn-instagram, #instagram_status a[href*='instagram.com']",
  );

  await instagramButton.waitFor({
    state: "attached",
    timeout: 30000,
  });

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const nextVisible = await nextButton.isVisible().catch(() => false);
    if (nextVisible) {
      break;
    }

    const hasInstagramButton = await instagramButton.count();
    if (!hasInstagramButton) {
      process.stdout.write("__LOG__:instagram_button_missing_before_next\n");
      break;
    }

    await applyGateDelay(page);
    await closeSocialPopupAndStabilize(page, context, "instagram.com", async () => {
      await clickLocatorReliably(instagramButton, `instagram_open_${attempt + 1}`);
    });

    await page.waitForTimeout(1200);
  }

  await nextButton.first().waitFor({ state: "visible", timeout: 30000 });
  await applyGateDelay(page);
  await clickLocatorReliably(nextButton, "instagram_next");
}

async function handleTikTokGate(page, context) {
  const skipper = page.locator("#skipper_tk").first();
  if (await skipper.count()) {
    await skipper.click();
    return;
  }

  const nextButton = page.locator("#skipper_tk_next");
  const tiktokButton = page.locator(
    "#tiktok_status .hype-btn-tiktok.undone, #tiktok_status .hype-btn-tiktok, #tiktok_status a[href*='tiktok.com']",
  );

  await tiktokButton.waitFor({
    state: "attached",
    timeout: 30000,
  });

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const nextVisible = await nextButton.isVisible().catch(() => false);
    if (nextVisible) {
      break;
    }

    const hasTikTokButton = await tiktokButton.count();
    if (!hasTikTokButton) {
      process.stdout.write("__LOG__:tiktok_button_missing_before_next\n");
      break;
    }

    await applyGateDelay(page);
    await closeSocialPopupAndStabilize(page, context, "tiktok.com", async () => {
      await clickLocatorReliably(tiktokButton, `tiktok_open_${attempt + 1}`);
    });

    await page.waitForTimeout(1200);
  }

  await nextButton.first().waitFor({ state: "visible", timeout: 30000 });
  await applyGateDelay(page);
  await clickLocatorReliably(nextButton, "tiktok_next");
}

async function handleFacebookGate(page) {
  const nextButton = page.locator("#fbCarouselSocialSection").first();
  await nextButton.waitFor({ state: "visible", timeout: 30000 });
  await applyGateDelay(page);
  await nextButton.click();
}

async function handleSpotifyGate(page, context) {
  const skipper = page.locator("#skipper_sp").first();
  if (await skipper.count()) {
    await skipper.click();
    return;
  }

  if (!useAppSpotifyConnection) {
    throw new Error("Spotify session app manquante pour un gate Spotify non skippable.");
  }

  const loginButton = page.locator("#login_to_sp").first();
  await loginButton.waitFor({ state: "visible", timeout: 30000 });

  const optOutOption = page.locator("#optInSectionSpotify a.optOutOption").first();
  if (await optOutOption.count()) {
    await optOutOption.click();
  }

  await applyGateDelay(page);
  await loginButton.click();
  await page.waitForTimeout(1500);

  const popup = await waitForPopupByUrl(context, "spotify.com", 5000);
  if (!popup) {
    return;
  }

  await popup.bringToFront();
  await popup.setViewportSize({ width: 1366, height: 900 }).catch(() => {});
  await popup.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

  const acceptButton = popup.locator("[data-testid='auth-accept']").first();
  if (await acceptButton.count()) {
    await acceptButton.click();
  }

  const closeDeadline = Date.now() + 15000;
  while (!popup.isClosed() && Date.now() < closeDeadline) {
    await page.waitForTimeout(100);
  }
}

async function handleDownloadGate(page, hasDownloadStarted) {
  const downloadButton = page.locator("#gateDownloadButton").first();
  await downloadButton.waitFor({ state: "visible", timeout: 30000 });

  setTimeout(() => {
    if (hasDownloadStarted() || page.isClosed()) {
      return;
    }
    void (async () => {
      try {
        await downloadButton.click();
        process.stdout.write("__LOG__:legacy_download_retry_click=performed\n");
      } catch {
        // Ignore retry click errors.
      }
    })();
  }, 10000);

  await applyGateDelay(page);
  await downloadButton.click();
}

async function runOldWorkflow(page, context, hasDownloadStarted) {
  await page.goto(hypedditUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});

  const firstDownloadButton = page.locator("#downloadProcess").first();
  try {
    await firstDownloadButton.waitFor({ state: "visible", timeout: 8000 });
  } catch {
    const currentUrl = page.url();
    throw new Error(
      `Premier bouton download introuvable (page post-download probable). URL actuelle: ${currentUrl}`,
    );
  }

  await applyGateDelay(page);
  await firstDownloadButton.click();
  await page.waitForTimeout(500);
  await page.locator("#all_steps").first().waitFor({ state: "attached", timeout: 30000 });

  const gateNames = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("#all_steps > div"))
      .map((div) => {
        const first = div.classList.item(0);
        if (first) {
          return String(first).toLowerCase();
        }

        const fallback = Array.from(div.classList || [])
          .map((item) => String(item || "").trim().toLowerCase())
          .find((item) => !!item && item !== "active" && item !== "done" && item !== "hidden");
        return fallback || "";
      })
      .filter(Boolean);
  });

  process.stdout.write(`__LOG__:legacy_workflow_gates=${gateNames.join(",")}\n`);

  const handlers = {
    email: async () => handleEmailGate(page),
    sc: async () => handleSoundCloudGate(page, context),
    ig: async () => handleInstagramGate(page, context),
    tk: async () => handleTikTokGate(page, context),
    fb: async () => handleFacebookGate(page),
    sp: async () => handleSpotifyGate(page, context),
    dw: async () => handleDownloadGate(page, hasDownloadStarted),
  };

  for (const gateName of gateNames) {
    if (hasDownloadStarted() || page.isClosed()) {
      return;
    }

    const handler = handlers[gateName];
    if (!handler) {
      throw new Error(`No handler found for gate ${gateName}`);
    }

    process.stdout.write(`__LOG__:legacy_gate_start=${gateName}\n`);
    await handler();
    process.stdout.write(`__LOG__:legacy_gate_done=${gateName}\n`);
    await page.waitForTimeout(Math.max(1000, clickDelayMs));
  }
}

(async () => {
  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(outputFolder, { recursive: true });

  const preloadPlaywrightSessions = useAppSoundCloudConnection || useAppSpotifyConnection;
  const automation = await launchAutomationContext(profileDir, headless);
  const context = automation.context;
  const activeBrowserEngine = automation.engine;

  const manualCookiesApplied = await applyManualSoundCloudCookies(context, manualSoundCloudCookiesPath);
  if (manualCookiesApplied) {
    process.stdout.write("__LOG__:Manual SoundCloud cookies loaded before gate flow.\n");
  }

  if (preloadPlaywrightSessions) {
    const missingProviders = [];

    if (useAppSoundCloudConnection) {
      const hasSoundCloudSession = await hasAuthenticatedSoundCloudSession(context);
      if (!hasSoundCloudSession) {
        missingProviders.push("soundcloud");
      }
    }

    if (useAppSpotifyConnection) {
      const hasSpotifySession = await hasAuthenticatedSpotifySession(context);
      if (!hasSpotifySession) {
        missingProviders.push("spotify");
      }
    }

    if (missingProviders.length > 0) {
      await automation.close();
      process.stdout.write(
        `__ERROR__:Session Playwright manquante pour ${missingProviders.join(", ")}. Connecte-toi depuis Reglages puis relance.\n`,
      );
      process.exit(5);
    }

    process.stdout.write("__LOG__:Using Playwright profile with preloaded sessions check enabled.\n");
  } else if (activeBrowserEngine === "lightpanda") {
    process.stdout.write("__LOG__:Using Lightpanda CDP runtime (no Playwright persistent profile preload).\n");
  } else {
    process.stdout.write("__LOG__:Using Playwright profile only (preload sessions check disabled).\n");
  }

  process.stdout.write("__PROGRESS__:browser_ready\n");

  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  process.stdout.write(`__LOG__:hypeddit_target_input=${hypedditUrl}\n`);

  let downloadStarted = false;
  const downloadPromise = page.waitForEvent("download", { timeout: downloadStartTimeoutMs }).then((download) => {
    downloadStarted = true;
    return download;
  });

  process.stdout.write("__PROGRESS__:gate_running\n");

  const workflowTask = runOldWorkflow(page, context, () => downloadStarted);

  let download;
  let directDownloadUrl = null;
  try {
    download = await downloadPromise;
    process.stdout.write("__PROGRESS__:download_started\n");
  } catch {
    await workflowTask.catch(() => {});

    if (activeBrowserEngine === "lightpanda") {
      directDownloadUrl = await resolveDirectDownloadUrlFromPage(page).catch(() => null);
      if (directDownloadUrl) {
        process.stdout.write(`__LOG__:Download event unavailable, using direct URL fallback: ${directDownloadUrl}\n`);
        process.stdout.write("__PROGRESS__:download_started\n");
      }
    }

    if (!directDownloadUrl) {
      await automation.close();
      process.stdout.write("__ERROR__:Aucun telechargement detecte (timeout).\n");
      process.exit(3);
    }
  }

  await workflowTask.catch(() => {});

  if (!download && directDownloadUrl) {
    const fallbackResult = await saveDirectDownloadFromUrl(context, directDownloadUrl);
    process.stdout.write(`__RESULT__:${JSON.stringify(fallbackResult)}\n`);
    await automation.close();
    return;
  }

  const suggested = sanitizeFileName(download.suggestedFilename() || "track.mp3");
  let targetPath = preferredFilePath || path.join(outputFolder, suggested);
  let removedPreviousPreferredFile = false;

  if (preferredFilePath && overwriteExisting) {
    const preferredDirectory = path.dirname(preferredFilePath);
    const preferredStem = path.basename(preferredFilePath, path.extname(preferredFilePath));
    const downloadedExtension = path.extname(suggested);

    if (downloadedExtension) {
      const extensionAwareTargetPath = path.join(preferredDirectory, `${preferredStem}${downloadedExtension}`);

      if (extensionAwareTargetPath !== preferredFilePath && fs.existsSync(preferredFilePath)) {
        fs.rmSync(preferredFilePath, { force: true });
        removedPreviousPreferredFile = true;
      }

      targetPath = extensionAwareTargetPath;
    }
  }

  const existedBeforeSave = fs.existsSync(targetPath);
  if (!overwriteExisting && existedBeforeSave) {
    await automation.close();
    process.stdout.write(`__ERROR__:File already exists at ${targetPath}\n`);
    process.exit(2);
  }

  if (!downloadStarted) {
    await automation.close();
    process.stdout.write("__ERROR__:Le telechargement n'est pas demarre, fermeture navigateur annulee.\n");
    process.exit(3);
  }

  const downloadFailure = await download.failure();
  if (downloadFailure) {
    await automation.close();
    process.stdout.write(`__ERROR__:Download Playwright en erreur: ${downloadFailure}\n`);
    process.exit(4);
  }

  for (const candidatePage of context.pages()) {
    try {
      if (!candidatePage.isClosed()) {
        await candidatePage.close({ runBeforeUnload: false });
      }
    } catch {
      // Ignore page close errors.
    }
  }

  process.stdout.write("__PROGRESS__:browser_cut\n");
  process.stdout.write("__PROGRESS__:file_saving\n");

  await download.saveAs(targetPath);

  process.stdout.write(`__RESULT__:${JSON.stringify({
    file_path: targetPath,
    file_name: path.basename(targetPath),
    overwrote_existing: overwriteExisting && (existedBeforeSave || removedPreviousPreferredFile),
  })}\n`);

  await automation.close();
})().catch(async (error) => {
  process.stdout.write(`__ERROR__:${error?.message ?? String(error)}\n`);
  process.exit(1);
});
