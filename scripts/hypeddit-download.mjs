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
const profileDirArg = process.argv[10] ?? "";

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
const profileDir = profileDirArg.trim() || path.join(outputFolder, ".playwright-hypeddit-profile");

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

async function launchContextWithBrowserFallback(profileDirectory, isHeadless) {
  const base = {
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

  const defaultHint = detectDefaultBrowserHint();
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

async function injectBypassScript(page, injectedComment, injectedName, injectedEmail) {
  await page.evaluate(({ commentText, nameText, emailText }) => {
    window.hypedditSettings = {
      email: emailText,
      name: nameText,
      comment: commentText,
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

    window.handleSoundCloud = function () {
      const comment = window.hypedditSettings.comment;

      if (document.getElementById("sc_comment_text") !== null) {
        document
          .getElementById("sc_comment_text")
          .setAttribute("value", comment);
      }

      if (document.getElementById("step_sc") !== null) {
        document.getElementById("step_sc").querySelector("a").click();
      }
    };

    window.handleInstagram = function () {
      window.handleFollowOptions("instagram_status", "skipper_ig_next");
    };

    window.handleYoutube = function () {
      window.handleFollowOptions("youtube_status", "skipper_yt_next");
    };

    window.handleSpotify = function () {
      document.getElementById("step_sp").querySelector("a").click();
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
  });
}

(async () => {
  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(outputFolder, { recursive: true });
  purgeRestoredTabsState(profileDir);

  const context = await launchContextWithBrowserFallback(profileDir, headless);
  process.stdout.write("__PROGRESS__:browser_ready\n");

  context.on("page", (popup) => {
    void (async () => {
      try {
        await popup.waitForLoadState("domcontentloaded", { timeout: 15000 });
        const url = popup.url().toLowerCase();
        if (url.includes("soundcloud.com/connect") || url.includes("soundcloud.com/authorize")) {
          await autoSubmitSoundCloud(popup);
        }
      } catch {
        // Keep flow as-is.
      }
    })();
  });

  const page = context.pages()[0] ?? await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  const soundCloudReady = await ensureSoundCloudSession(context, page, headless);
  if (!soundCloudReady) {
    process.stdout.write("__ERROR__:Aucune session SoundCloud mémorisée dans le profil Playwright. Désactive le mode headless et connecte-toi une première fois, puis relance.\n");
    await context.close();
    process.exit(4);
  }

  const downloadPromise = page.waitForEvent("download", { timeout: 300000 });
  process.stdout.write("__PROGRESS__:gate_running\n");

  await page.goto(hypedditUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await humanPause(page, 300, 800);

  const startButton = page.locator("#downloadProcess").first();
  if (await startButton.count()) {
    await humanClick(startButton, page);
  }

  await injectBypassScript(page, comment, userName, userEmail);

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
  const targetPath = preferredFilePath || path.join(outputFolder, suggested);
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
    overwrote_existing: overwriteExisting && existedBeforeSave,
  })}\n`);

  await context.close();
})().catch(async (error) => {
  process.stdout.write(`__ERROR__:${error?.message ?? String(error)}\n`);
  process.exit(1);
});
