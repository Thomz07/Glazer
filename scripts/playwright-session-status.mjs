import fs from "node:fs";
import { chromium } from "playwright";

const providerArg = process.argv[2] ?? "";
const profileDirArg = process.argv[3] ?? "";

const provider = providerArg.trim().toLowerCase();
const profileDir = profileDirArg.trim();

if (!provider || (provider !== "soundcloud" && provider !== "spotify")) {
  console.error("Missing or invalid provider. Use soundcloud or spotify.");
  process.exit(1);
}

if (!profileDir) {
  console.error("Missing Playwright profile directory");
  process.exit(1);
}

function buildBaseLaunchOptions() {
  return {
    headless: true,
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

async function isProviderConnected(currentProvider, context, page, options = {}) {
  if (currentProvider === "soundcloud") {
    return hasSoundCloudSession(context, page, options);
  }

  return hasSpotifySession(context, page, options);
}

(async () => {
  fs.mkdirSync(profileDir, { recursive: true });

  const context = await launchContext(profileDir);
  const page = context.pages()[0] ?? await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  const connected = await isProviderConnected(provider, context, page, { navigate: true });
  process.stdout.write(`__RESULT__:${JSON.stringify({ provider, connected })}\n`);
  await context.close();
})().catch(async (error) => {
  process.stdout.write(`__ERROR__:${error?.message ?? String(error)}\n`);
  process.exit(1);
});
