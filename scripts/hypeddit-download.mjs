import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";

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

process.stdout.write(
  `__LOG__:app_connections soundcloud=${useAppSoundCloudConnection} spotify=${useAppSpotifyConnection} headless=${headless} download_start_timeout_seconds=${downloadStartTimeoutSeconds}\n`,
);

function purgeRestoredTabsState(profileDirectory) {
  const targets = [
    path.join(profileDirectory, "Default", "Sessions"),
    path.join(profileDirectory, "Default", "Session Storage"),
    path.join(profileDirectory, "Default", "Last Session"),
    path.join(profileDirectory, "Default", "Last Tabs"),
    path.join(profileDirectory, "Default", "Current Session"),
    path.join(profileDirectory, "Default", "Current Tabs"),
  ];

  for (const target of targets) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors to keep download flow resilient.
    }
  }
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function humanPause(page, min = 120, max = 380) {
  await page.waitForTimeout(randomBetween(min, max));
}

async function humanClick(locator, page) {
  await locator.scrollIntoViewIfNeeded();
  await humanPause(page, 90, 220);
  try {
    await locator.hover({ timeout: 2000 });
  } catch {
    // Continue with click attempt.
  }
  await humanPause(page, 60, 180);
  await locator.click({ timeout: 3000 });
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

async function launchContextWithBrowserFallback(profileDirectory, isHeadless, defaultHint = "") {
  const base = buildCommonLaunchOptions(isHeadless);

  const candidates = [
    {
      label: "chrome-channel",
      options: { channel: "chrome" },
    },
    {
      label: "brave-executable",
      options: { executablePath: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" },
    },
    {
      label: "chrome-executable",
      options: { executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" },
    },
    {
      label: "edge-executable",
      options: { executablePath: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" },
    },
    {
      label: "playwright-chromium",
      options: {},
    },
  ];

  if (defaultHint) {
    process.stdout.write(`__LOG__:Default browser hint detected: ${defaultHint}\n`);
  }

  const preferredOrder = rankCandidatesByDefaultBrowser(candidates, defaultHint);

  const errors = [];
  for (const candidate of preferredOrder) {
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

  throw new Error(`Aucun navigateur compatible trouvé. Détails: ${errors.join(" | ")}`);
}

function detectDefaultBrowserHint() {
  const fromEnv = (process.env.BROWSER || "").toLowerCase().trim();
  if (fromEnv) {
    return fromEnv;
  }

  if (process.platform === "darwin") {
    try {
      const bundleId = execFileSync(
        "osascript",
        ["-e", 'id of application (path to default application for URL "https://hypeddit.com")'],
        { encoding: "utf8" },
      )
        .trim()
        .toLowerCase();
      return bundleId;
    } catch {
      return "";
    }
  }

  return "";
}

function rankCandidatesByDefaultBrowser(candidates, defaultHint) {
  if (!defaultHint) {
    return candidates;
  }

  const scoreFor = (label) => {
    const l = label.toLowerCase();
    if ((defaultHint.includes("brave") || defaultHint.includes("com.brave.browser")) && l.includes("brave")) {
      return 100;
    }
    if ((defaultHint.includes("chrome") || defaultHint.includes("com.google.chrome")) && l.includes("chrome")) {
      return 100;
    }
    if ((defaultHint.includes("edge") || defaultHint.includes("com.microsoft.edgemac")) && l.includes("edge")) {
      return 100;
    }
    if ((defaultHint.includes("chromium") || defaultHint.includes("com.chromium")) && l.includes("chromium")) {
      return 100;
    }
    return 0;
  };

  return [...candidates].sort((a, b) => scoreFor(b.label) - scoreFor(a.label));
}

function scoreBrowserAgainstHint(browserName, defaultHint) {
  if (!defaultHint) {
    return 0;
  }

  const normalized = browserName.toLowerCase();
  if ((defaultHint.includes("brave") || defaultHint.includes("com.brave.browser")) && normalized.includes("brave")) {
    return 100;
  }
  if ((defaultHint.includes("chrome") || defaultHint.includes("com.google.chrome")) && normalized.includes("chrome")) {
    return 100;
  }
  if ((defaultHint.includes("edge") || defaultHint.includes("com.microsoft.edgemac")) && normalized.includes("edge")) {
    return 100;
  }
  if ((defaultHint.includes("chromium") || defaultHint.includes("com.chromium")) && normalized.includes("chromium")) {
    return 100;
  }

  return 0;
}

function getSystemChromiumUserDataCandidates(defaultHint) {
  const candidates = [];

  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA ?? "";
    if (localAppData) {
      candidates.push(
        { browser: "chrome", userDataDir: path.join(localAppData, "Google", "Chrome", "User Data") },
        { browser: "edge", userDataDir: path.join(localAppData, "Microsoft", "Edge", "User Data") },
        { browser: "brave", userDataDir: path.join(localAppData, "BraveSoftware", "Brave-Browser", "User Data") },
      );
    }
  } else if (process.platform === "darwin") {
    const home = process.env.HOME ?? "";
    if (home) {
      candidates.push(
        { browser: "chrome", userDataDir: path.join(home, "Library", "Application Support", "Google", "Chrome") },
        { browser: "edge", userDataDir: path.join(home, "Library", "Application Support", "Microsoft Edge") },
        { browser: "brave", userDataDir: path.join(home, "Library", "Application Support", "BraveSoftware", "Brave-Browser") },
      );
    }
  } else {
    const home = process.env.HOME ?? "";
    if (home) {
      candidates.push(
        { browser: "chrome", userDataDir: path.join(home, ".config", "google-chrome") },
        { browser: "edge", userDataDir: path.join(home, ".config", "microsoft-edge") },
        { browser: "brave", userDataDir: path.join(home, ".config", "BraveSoftware", "Brave-Browser") },
        { browser: "chromium", userDataDir: path.join(home, ".config", "chromium") },
      );
    }
  }

  return candidates
    .filter((candidate) => fs.existsSync(candidate.userDataDir))
    .sort((left, right) => scoreBrowserAgainstHint(right.browser, defaultHint) - scoreBrowserAgainstHint(left.browser, defaultHint));
}

function readLastUsedProfileName(userDataDir) {
  const localStatePath = path.join(userDataDir, "Local State");
  try {
    const raw = fs.readFileSync(localStatePath, "utf8");
    const parsed = JSON.parse(raw);
    const lastUsed = parsed?.profile?.last_used;
    if (typeof lastUsed === "string" && lastUsed.trim()) {
      return lastUsed.trim();
    }
  } catch {
    // Ignore parsing errors and fallback to Default.
  }

  return "Default";
}

function listCandidateProfileNames(userDataDir) {
  const names = new Set();
  names.add(readLastUsedProfileName(userDataDir));
  names.add("Default");

  const localStatePath = path.join(userDataDir, "Local State");
  try {
    const raw = fs.readFileSync(localStatePath, "utf8");
    const parsed = JSON.parse(raw);
    const infoCache = parsed?.profile?.info_cache;
    if (infoCache && typeof infoCache === "object") {
      for (const key of Object.keys(infoCache)) {
        names.add(key);
      }
    }
  } catch {
    // Ignore parsing errors and keep filesystem fallback.
  }

  try {
    const entries = fs.readdirSync(userDataDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (entry.name === "Default" || /^Profile\s+\d+$/i.test(entry.name)) {
        names.add(entry.name);
      }
    }
  } catch {
    // Ignore filesystem listing errors.
  }

  return [...names].filter((name) => fs.existsSync(path.join(userDataDir, name)));
}

function getSystemBrowserLaunchCandidates(browserName) {
  if (browserName === "chrome") {
    return [{ label: "chrome-channel", options: { channel: "chrome" } }];
  }

  if (browserName === "edge") {
    return [{ label: "msedge-channel", options: { channel: "msedge" } }];
  }

  if (browserName === "brave") {
    if (process.platform === "win32") {
      return [{
        label: "brave-executable",
        options: {
          executablePath: "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
        },
      }];
    }

    if (process.platform === "darwin") {
      return [{
        label: "brave-executable",
        options: {
          executablePath: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
        },
      }];
    }

    return [{
      label: "brave-executable",
      options: {
        executablePath: "/usr/bin/brave-browser",
      },
    }];
  }

  if (browserName === "chromium") {
    return [{ label: "playwright-chromium", options: {} }];
  }

  return [];
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

async function tryLaunchWithSystemProfileSession(defaultHint, isHeadless, needSoundCloudSession) {
  const browserCandidates = getSystemChromiumUserDataCandidates(defaultHint);
  for (const browserCandidate of browserCandidates) {
    const profileNames = listCandidateProfileNames(browserCandidate.userDataDir);
    const launchCandidates = getSystemBrowserLaunchCandidates(browserCandidate.browser);

    for (const profileName of profileNames) {
      for (const launchCandidate of launchCandidates) {
        const options = {
          ...buildCommonLaunchOptions(isHeadless),
          ...launchCandidate.options,
          args: [
            ...buildCommonLaunchOptions(isHeadless).args,
            `--profile-directory=${profileName}`,
          ],
        };

        try {
          const context = await chromium.launchPersistentContext(browserCandidate.userDataDir, options);
          const soundCloudReady = needSoundCloudSession
            ? await hasAuthenticatedSoundCloudSession(context)
            : true;

          if (soundCloudReady) {
            process.stdout.write(
              `__LOG__:Using system browser profile ${browserCandidate.browser}/${profileName} via ${launchCandidate.label}\n`,
            );
            return context;
          }

          await context.close();
        } catch (error) {
          process.stdout.write(
            `__LOG__:System profile launch failed ${browserCandidate.browser}/${profileName}/${launchCandidate.label}: ${error?.message ?? String(error)}\n`,
          );
        }
      }
    }
  }

  return null;
}

function copyPathIfAvailable(sourcePath, destinationPath) {
  if (!fs.existsSync(sourcePath)) {
    return false;
  }

  try {
    const stats = fs.statSync(sourcePath);
    if (stats.isDirectory()) {
      fs.mkdirSync(destinationPath, { recursive: true });
      fs.cpSync(sourcePath, destinationPath, { recursive: true, force: true });
      return true;
    }

    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath);
    return true;
  } catch {
    return false;
  }
}

function seedPlaywrightProfileFromSystemSession(targetProfileDir, defaultHint) {
  const candidates = getSystemChromiumUserDataCandidates(defaultHint);
  for (const candidate of candidates) {
    const profileName = readLastUsedProfileName(candidate.userDataDir);
    const sourceProfileDir = path.join(candidate.userDataDir, profileName);
    if (!fs.existsSync(sourceProfileDir)) {
      continue;
    }

    let copied = false;
    copied = copyPathIfAvailable(
      path.join(candidate.userDataDir, "Local State"),
      path.join(targetProfileDir, "Local State"),
    ) || copied;

    const copyPlan = [
      [path.join(sourceProfileDir, "Network", "Cookies"), path.join(targetProfileDir, "Default", "Network", "Cookies")],
      [path.join(sourceProfileDir, "Cookies"), path.join(targetProfileDir, "Default", "Cookies")],
      [path.join(sourceProfileDir, "Preferences"), path.join(targetProfileDir, "Default", "Preferences")],
      [path.join(sourceProfileDir, "Local Storage", "leveldb"), path.join(targetProfileDir, "Default", "Local Storage", "leveldb")],
      [path.join(sourceProfileDir, "Session Storage"), path.join(targetProfileDir, "Default", "Session Storage")],
    ];

    for (const [sourcePath, destinationPath] of copyPlan) {
      copied = copyPathIfAvailable(sourcePath, destinationPath) || copied;
    }

    if (copied) {
      process.stdout.write(
        `__LOG__:Seeded Playwright profile from ${candidate.browser} profile=${profileName}\n`,
      );
      return true;
    }
  }

  return false;
}

function sanitizeFileName(name) {
  return name
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

async function autoSubmitSoundCloud(page) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const button = page.locator('button[type="submit"], input[type="submit"]');
    if (await button.count()) {
      await humanClick(button.first(), page);
      return;
    }
    await page.waitForTimeout(200);
  }
}

async function hasSoundCloudSession(context) {
  try {
    const cookies = await context.cookies("https://soundcloud.com", "https://secure.soundcloud.com");
    return cookies.some((cookie) => /oauth|auth|session|sid|sc_[a-z_]*session/i.test(cookie.name));
  } catch {
    return false;
  }
}

async function ensureSoundCloudSession(context, page, isHeadless) {
  if (await hasSoundCloudSession(context)) {
    return true;
  }

  if (isHeadless) {
    return false;
  }

  await page.goto("https://soundcloud.com/signin", { waitUntil: "domcontentloaded", timeout: 60000 });

  const timeoutAt = Date.now() + 180000;
  while (Date.now() < timeoutAt) {
    if (await hasSoundCloudSession(context)) {
      return true;
    }
    await page.waitForTimeout(1000);
  }

  return false;
}

async function injectBypassScript(
  page,
  injectedComment,
  injectedName,
  injectedEmail,
  injectedUseAppSoundCloudConnection,
  injectedUseAppSpotifyConnection,
) {
  await page.evaluate(({ commentText, nameText, emailText, useAppSoundCloud, useAppSpotify }) => {
    window.hypedditSettings = {
      email: emailText,
      name: nameText,
      comment: commentText,
      use_app_soundcloud_connection: useAppSoundCloud,
      use_app_spotify_connection: useAppSpotify,
      auto_close: true,
      auto_close_timeout_in_ms: 5000,
    };

    window.handleFollowOptions = function (containerElementId, skipperId) {
      if (document.getElementById(containerElementId) !== null) {
        document
          .getElementById(containerElementId)
          .querySelectorAll("a")
          .forEach((accountItem) => {
            accountItem.classList.remove("undone");
            accountItem.classList.add("done");
          });

        document.getElementById(skipperId).click();
      }
    };

    window.findSkipperForStep = function (stepCode) {
      const exact = document.getElementById(`skipper_${stepCode}_next`);
      if (exact !== null) {
        return exact;
      }

      const sidebar = document.querySelector(`#skipper[data-step="${stepCode}"]`);
      if (sidebar !== null) {
        return sidebar;
      }

      const legacy = document.getElementById(`skipper_${stepCode}`);
      if (legacy !== null) {
        return legacy;
      }

      const generic = document.querySelector(
        `[id^="skipper_"][id*="_${stepCode}"], [id^="skipper_"][id*="${stepCode}_"]`,
      );
      if (generic !== null) {
        return generic;
      }

      const relatedStep = document.getElementById(`step_${stepCode}`);
      if (relatedStep !== null) {
        const localSkipper = relatedStep
          .closest(".fangate-slider-content")
          ?.querySelector('[id^="skipper"], .skip, [data-action="skip"]');
        if (localSkipper !== null && localSkipper !== undefined) {
          return localSkipper;
        }
      }

      const textBasedSkip = Array.from(document.querySelectorAll("button, a"))
        .find((element) => /skip|passer|suivant|next/i.test((element.textContent ?? "").trim()));
      if (textBasedSkip !== undefined) {
        return textBasedSkip;
      }

      return null;
    };

    window.trySkipStep = function (stepCode) {
      const skipper = window.findSkipperForStep(stepCode);
      if (skipper === null) {
        const carouselNext = document.querySelector(
          "#myCarousel .right.carousel-control, #myCarousel .carousel-control-next, #myCarousel [data-slide='next']",
        );
        if (carouselNext !== null) {
          carouselNext.click();
          return true;
        }
        return false;
      }

      skipper.click();
      return true;
    };

    window.handleSoundCloud = function () {
      const comment = window.hypedditSettings.comment;
      const useAppSoundCloud = window.hypedditSettings.use_app_soundcloud_connection;

      if (document.getElementById("sc_comment_text") !== null) {
        document
          .getElementById("sc_comment_text")
          .setAttribute("value", comment);
      }

      if (document.getElementById("sc_comment_text") !== null) {
        document.getElementById("sc_comment_text").value = comment;
      }

      if (document.getElementById("step_sc") !== null) {
        const soundCloudStep = document.getElementById("step_sc");
        if (useAppSoundCloud && window.trySkipStep("sc")) {
          return;
        }

        const soundCloudLink = soundCloudStep.querySelector("a");
        if (soundCloudLink !== null) {
          soundCloudLink.click();
          return;
        }

        if (useAppSoundCloud) {
          window.trySkipStep("sc");
        }
      }
    };

    window.handleInstagram = function () {
      window.handleFollowOptions("instagram_status", "skipper_ig_next");
    };

    window.handleYoutube = function () {
      window.handleFollowOptions("youtube_status", "skipper_yt_next");
    };

    window.handleSpotify = function () {
      const useAppSpotify = window.hypedditSettings.use_app_spotify_connection;

      if (useAppSpotify && window.trySkipStep("sp")) {
        return;
      }

      const spotifyStep = document.getElementById("step_sp");
      if (spotifyStep !== null) {
        const spotifyLink = spotifyStep.querySelector("a");
        if (spotifyLink !== null) {
          spotifyLink.click();
          return;
        }
      }

      if (useAppSpotify) {
        window.trySkipStep("sp");
        return;
      }
    };

    window.handleDownload = function () {
      document.getElementById("gateDownloadButton").click();

      if (window.hypedditSettings.auto_close) {
        const timeout = window.hypedditSettings.auto_close_timeout_in_ms;
        window.setTimeout(function () {
          window.open("about:blank", "_self");
          window.close();
        }, timeout);
      }
    };

    window.handleEmail = function () {
      const email = window.hypedditSettings.email;
      const name = window.hypedditSettings.name;

      if (document.getElementById("email_name") !== null) {
        document.getElementById("email_name").setAttribute("value", name);
      }

      if (document.getElementById("email_address") !== null) {
        document
          .getElementById("email_address")
          .setAttribute("value", email);
        document.getElementById("email_address").value = email;
      }

      document.getElementById("email_to_downloads_next").click();
    };

    window.handleTikTok = function () {
      window.handleFollowOptions("tiktok_status", "skipper_tk_next");
    };

    window.handleFacebook = function () {
      document.getElementById("fbCarouselSocialSection").click();
    };

    window.handleMultiPortal = function () {
      document.getElementById("step_email").previousElementSibling.click();
      window.handleEmail();
    };

    window.handleEmailSoundCloud = function () {
      document.getElementById("step_email").previousElementSibling.click();
      window.handleEmail();
    };

    window.handleSoundCloudYoutube = function () {
      document.getElementById("step_yt").previousElementSibling.click();
      window.handleYoutube();
    };

    window.handleDonate = function () {
      document.getElementById("step_dn").previousElementSibling.click();
      document.getElementById("donation_next").click();
    };

    window.handleMixcloud = function () {
      document.getElementById("skipper_mc").click();
    };

    window.handleBandCamp = function () {
      document.getElementById("skipper_bc").click();
    };

    const targetNode = document.getElementById("myCarousel");
    if (!targetNode) {
      return;
    }

    const config = { attributes: true, childList: true, subtree: true };

    let prevStepContent = null;
    const callback = (mutationList) => {
      for (const mutation of mutationList) {
        if (mutation.type === "attributes") {
          const stepContent = document.querySelector(
            ".fangate-slider-content:not(.move-left)"
          );

          if (!stepContent) {
            continue;
          }

          if (stepContent !== prevStepContent) {
            const stepClassList = stepContent.classList;

            if (stepClassList.contains("tk|ig")) {
              window.handleTikTok();
            }

            if (stepClassList.contains("sp|ig|email")) {
              window.handleMultiPortal();
            }

            if (stepClassList.contains("email|sc")) {
              window.handleEmailSoundCloud();
            }

            if (stepClassList.contains("sc|yt")) {
              window.handleSoundCloudYoutube();
            }

            if (stepClassList.contains("dn")) {
              window.handleDonate();
            }

            if (stepClassList.contains("sc")) {
              window.handleSoundCloud();
            }

            if (stepClassList.contains("ig")) {
              window.handleInstagram();
            }

            if (stepClassList.contains("dw")) {
              window.handleDownload();
            }

            if (stepClassList.contains("yt")) {
              window.handleYoutube();
            }

            if (stepClassList.contains("sp")) {
              window.handleSpotify();
            }

            if (stepClassList.contains("email")) {
              window.handleEmail();
            }

            if (stepClassList.contains("tk")) {
              window.handleTikTok();
            }

            if (stepClassList.contains("fb")) {
              window.handleFacebook();
            }

            if (stepClassList.contains("mc")) {
              window.handleMixcloud();
            }

            if (stepClassList.contains("bc")) {
              window.handleBandCamp();
            }
          }

          prevStepContent = stepContent;
        }
      }
    };

    const observer = new MutationObserver(callback);
    observer.observe(targetNode, config);

    const _start = () => {
      if (document.getElementById("downloadProcess") !== null) {
        document.getElementById("downloadProcess").click();
      }
    };

    window.setTimeout(_start, 800);
  }, {
    commentText: injectedComment,
    nameText: injectedName,
    emailText: injectedEmail,
    useAppSoundCloud: injectedUseAppSoundCloudConnection,
    useAppSpotify: injectedUseAppSpotifyConnection,
  });
}

(async () => {
  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(outputFolder, { recursive: true });
  const usePlaywrightSessionFromSettings = useAppSoundCloudConnection || useAppSpotifyConnection;
  if (!usePlaywrightSessionFromSettings) {
    purgeRestoredTabsState(profileDir);
  }

  const defaultBrowserHint = detectDefaultBrowserHint();
  let context = null;

  if (usePlaywrightSessionFromSettings) {
    context = await launchContextWithBrowserFallback(profileDir, headless, defaultBrowserHint);

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
      await context.close();
      process.stdout.write(
        `__ERROR__:Session Playwright manquante pour ${missingProviders.join(", ")}. Connecte-toi depuis Réglages puis relance.\n`,
      );
      process.exit(5);
    }

    process.stdout.write("__LOG__:Using Playwright profile session from settings.\n");
  } else {
    context = await tryLaunchWithSystemProfileSession(
      defaultBrowserHint,
      headless,
      false,
    );

    if (!context) {
      const seeded = seedPlaywrightProfileFromSystemSession(profileDir, defaultBrowserHint);
      process.stdout.write(
        `__LOG__:system_profile_seeded=${seeded}\n`,
      );

      context = await launchContextWithBrowserFallback(profileDir, headless, defaultBrowserHint);
    }
  }

  process.stdout.write("__PROGRESS__:browser_ready\n");

  context.on("page", (popup) => {
    void (async () => {
      try {
        await popup.waitForLoadState("domcontentloaded", { timeout: 15000 });
        const url = popup.url().toLowerCase();
        if (
          url.includes("soundcloud.com/connect") ||
          url.includes("soundcloud.com/authorize") ||
          url.includes("accounts.spotify.com/authorize")
        ) {
          await autoSubmitSoundCloud(popup);
        }
      } catch {
        // Keep flow as-is.
      }
    })();
  });

  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  process.stdout.write(`__LOG__:hypeddit_target_input=${hypedditUrl}\n`);

  const soundCloudReady = useAppSoundCloudConnection
    ? true
    : await ensureSoundCloudSession(context, page, headless);
  if (!soundCloudReady) {
    process.stdout.write("__ERROR__:Aucune session SoundCloud mémorisée dans le profil Playwright. Désactive le mode headless et connecte-toi une première fois, puis relance.\n");
    await context.close();
    process.exit(4);
  }

  const downloadPromise = page.waitForEvent("download", { timeout: downloadStartTimeoutMs });
  process.stdout.write("__PROGRESS__:gate_running\n");

  await page.goto(hypedditUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  process.stdout.write(`__LOG__:hypeddit_target_after_goto=${page.url()}\n`);
  await humanPause(page, 300, 800);

  const startButton = page.locator("#downloadProcess").first();
  if (await startButton.count()) {
    await humanClick(startButton, page);
  }

  await injectBypassScript(
    page,
    comment,
    userName,
    userEmail,
    useAppSoundCloudConnection,
    useAppSpotifyConnection,
  );

  let download;
  try {
    download = await downloadPromise;
    process.stdout.write("__PROGRESS__:download_started\n");
  } catch {
    process.stdout.write("__ERROR__:Aucun telechargement detecte (timeout).\n");
    await context.close();
    process.exit(3);
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
    process.stdout.write(`__ERROR__:File already exists at ${targetPath}\n`);
    await context.close();
    process.exit(2);
  }

  for (const candidatePage of context.pages()) {
    try {
      if (!candidatePage.isClosed()) {
        await candidatePage.close({ runBeforeUnload: false });
      }
    } catch {
      // Ignore page close errors; download can still proceed.
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

  await context.close();
})().catch(async (error) => {
  process.stdout.write(`__ERROR__:${error?.message ?? String(error)}\n`);
  process.exit(1);
});
