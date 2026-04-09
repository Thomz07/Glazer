import fs from "node:fs";
import { chromium } from "playwright";

const providerArg = process.argv[2] ?? "";
const profileDirArg = process.argv[3] ?? "";
const resetSessionArg = process.argv[4] ?? "false";

const provider = providerArg.trim().toLowerCase();
const profileDir = profileDirArg.trim();
const resetSession = resetSessionArg.trim().toLowerCase() === "true";

if (!provider || (provider !== "soundcloud" && provider !== "spotify")) {
  console.error("Missing or invalid provider. Use soundcloud or spotify.");
  process.exit(1);
}

if (!profileDir) {
  console.error("Missing Playwright profile directory");
  process.exit(1);
}

const MAX_WAIT_MS = 10 * 60 * 1000;
const CHECK_INTERVAL_MS = 1200;

function buildBaseLaunchOptions() {
  return {
    headless: false,
    acceptDownloads: false,
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

function getLaunchCandidates() {
  const candidates = [
    { label: "chrome-channel", options: { channel: "chrome" } },
    { label: "msedge-channel", options: { channel: "msedge" } },
  ];

  if (process.platform === "win32") {
    candidates.push(
      {
        label: "brave-executable",
        options: {
          executablePath: "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
        },
      },
      {
        label: "brave-executable-x86",
        options: {
          executablePath: "C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
        },
      },
    );
  }

  if (process.platform === "darwin") {
    candidates.push(
      {
        label: "brave-executable",
        options: {
          executablePath: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
        },
      },
      {
        label: "chrome-executable",
        options: {
          executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        },
      },
      {
        label: "edge-executable",
        options: {
          executablePath: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        },
      },
    );
  }

  candidates.push({ label: "playwright-chromium", options: {} });

  return candidates;
}

async function launchContext(profileDirectory) {
  const candidates = getLaunchCandidates();
  const errors = [];

  for (const candidate of candidates) {
    try {
      const context = await chromium.launchPersistentContext(profileDirectory, {
        ...buildBaseLaunchOptions(),
        ...candidate.options,
      });
      process.stdout.write(`__LOG__:Browser launch candidate selected: ${candidate.label}\n`);
      return context;
    } catch (error) {
      errors.push(`${candidate.label}: ${error?.message ?? String(error)}`);
    }
  }

  throw new Error(`No compatible browser found. Details: ${errors.join(" | ")}`);
}

function isSoundCloudAuthUrl(url) {
  return (
    url.includes("soundcloud.com/signin") ||
    url.includes("soundcloud.com/login") ||
    url.includes("soundcloud.com/connect") ||
    url.includes("soundcloud.com/authorize")
  );
}

function isSpotifyAuthUrl(url) {
  return url.includes("accounts.spotify.com") && url.includes("login");
}

async function hasSoundCloudSession(context, page, options = {}) {
  const shouldNavigate = Boolean(options.navigate);

  try {
    if (shouldNavigate) {
      await page.goto("https://soundcloud.com/you", {
        waitUntil: "domcontentloaded",
        timeout: 45000,
      });
      await page.waitForTimeout(1000);
    }

    const currentUrl = page.url().toLowerCase();
    if (isSoundCloudAuthUrl(currentUrl)) {
      return false;
    }

    const cookies = await context.cookies("https://soundcloud.com", "https://secure.soundcloud.com");
    const hasSessionCookie = cookies.some((cookie) =>
      /oauth|auth|session|sid|sc_[a-z_]*session/i.test(cookie.name),
    );

    if (hasSessionCookie) {
      return true;
    }

    return shouldNavigate && currentUrl.includes("soundcloud.com/you");
  } catch {
    return false;
  }
}

async function hasSpotifySession(context, page, options = {}) {
  const shouldNavigate = Boolean(options.navigate);

  try {
    if (shouldNavigate) {
      await page.goto("https://open.spotify.com/", {
        waitUntil: "domcontentloaded",
        timeout: 45000,
      });
      await page.waitForTimeout(1000);
    }

    const currentUrl = page.url().toLowerCase();
    if (isSpotifyAuthUrl(currentUrl)) {
      return false;
    }

    const loginLocator = page.locator(
      '[data-testid="login-button"], a[href*="accounts.spotify.com"][href*="login"], a[href*="/login"], button:has-text("Log in"), button:has-text("Se connecter"), button:has-text("Iniciar sesión"), button:has-text("Anmelden")',
    );
    if (await loginLocator.count()) {
      const visible = await loginLocator.first().isVisible().catch(() => false);
      if (visible) {
        return false;
      }
    }

    const connectedUiLocator = page.locator(
      '[data-testid="user-widget-link"], button[aria-label*="Profile"], button[aria-label*="Profil"], a[href*="/collection"]',
    );
    if (await connectedUiLocator.count()) {
      const visible = await connectedUiLocator.first().isVisible().catch(() => false);
      if (visible) {
        return true;
      }
    }

    const cookies = await context.cookies("https://accounts.spotify.com", "https://open.spotify.com");
    const hasSessionCookie = cookies.some((cookie) => /sp_dc|sp_key|remember|spotify/i.test(cookie.name));

    if (hasSessionCookie) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

function getLoginUrl(currentProvider) {
  if (currentProvider === "soundcloud") {
    return "https://soundcloud.com/signin";
  }

  return "https://accounts.spotify.com/login?continue=https%3A%2F%2Fopen.spotify.com%2F";
}

async function isProviderConnected(currentProvider, context, page, options = {}) {
  if (currentProvider === "soundcloud") {
    return hasSoundCloudSession(context, page, options);
  }

  return hasSpotifySession(context, page, options);
}

async function clearSoundCloudSession(context, page) {
  try {
    const soundCloudCookies = await context.cookies("https://soundcloud.com", "https://secure.soundcloud.com");
    if (soundCloudCookies.length > 0) {
      await context.addCookies(
        soundCloudCookies.map((cookie) => ({
          name: cookie.name,
          value: "",
          domain: cookie.domain,
          path: cookie.path || "/",
          expires: 1,
          httpOnly: cookie.httpOnly,
          secure: cookie.secure,
          sameSite: cookie.sameSite,
        })),
      );
    }
  } catch {
    // Ignore cookie cleanup failures; storage cleanup below can still help.
  }

  try {
    await page.goto("https://soundcloud.com/", {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await page.evaluate(async () => {
      try {
        window.localStorage?.clear();
      } catch {
      }
      try {
        window.sessionStorage?.clear();
      } catch {
      }
      try {
        if (window.indexedDB?.databases) {
          const databases = await window.indexedDB.databases();
          await Promise.all(
            databases
              .map((db) => db?.name)
              .filter(Boolean)
              .map((name) =>
                new Promise((resolve) => {
                  try {
                    const request = window.indexedDB.deleteDatabase(name);
                    request.onsuccess = () => resolve();
                    request.onerror = () => resolve();
                    request.onblocked = () => resolve();
                  } catch {
                    resolve();
                  }
                }),
              ),
          );
        }
      } catch {
      }
      try {
        if (window.caches?.keys) {
          const keys = await window.caches.keys();
          await Promise.all(keys.map((key) => window.caches.delete(key)));
        }
      } catch {
      }
    });
  } catch {
    // Ignore storage cleanup failures.
  }
}

(async () => {
  fs.mkdirSync(profileDir, { recursive: true });

  const context = await launchContext(profileDir);
  process.stdout.write("__PROGRESS__:browser_ready\n");

  const page = context.pages()[0] ?? await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  if (provider === "soundcloud" && resetSession) {
    process.stdout.write("__LOG__:Resetting SoundCloud Playwright session before login...\n");
    await clearSoundCloudSession(context, page);
  }

  const alreadyConnected = await isProviderConnected(provider, context, page, { navigate: true });
  if (!alreadyConnected) {
    const loginUrl = getLoginUrl(provider);
    await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    process.stdout.write(`__LOG__:Waiting for ${provider} authentication in Playwright window...\n`);

    const timeoutAt = Date.now() + MAX_WAIT_MS;
    while (Date.now() < timeoutAt) {
      const connected = await isProviderConnected(provider, context, page, { navigate: false });
      if (connected) {
        break;
      }
      await page.waitForTimeout(CHECK_INTERVAL_MS);
    }
  }

  const connected = await isProviderConnected(provider, context, page, { navigate: true });
  if (!connected) {
    process.stdout.write(`__ERROR__:Playwright ${provider} authentication timeout.\n`);
    await context.close();
    process.exit(2);
  }

  process.stdout.write(`__RESULT__:${JSON.stringify({ provider, connected: true })}\n`);
  await context.close();
})().catch(async (error) => {
  process.stdout.write(`__ERROR__:${error?.message ?? String(error)}\n`);
  process.exit(1);
});
