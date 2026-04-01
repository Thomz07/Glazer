import fs from "node:fs";
import path from "node:path";
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
const clickDelayMsArg = process.argv[14] ?? "0";

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

process.stdout.write(
  `__LOG__:app_connections soundcloud=${useAppSoundCloudConnection} spotify=${useAppSpotifyConnection} headless=${headless} download_start_timeout_seconds=${downloadStartTimeoutSeconds} click_delay_ms=${clickDelayMs}\n`,
);

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function humanPause(page, min = 120, max = 380) {
  await page.waitForTimeout(randomBetween(min, max));
}

async function debugClickPause(page) {
  if (clickDelayMs > 0) {
    await page.waitForTimeout(clickDelayMs);
  }
}

async function humanClick(locator, page) {
  await locator.scrollIntoViewIfNeeded();
  await humanPause(page, 90, 220);
  await debugClickPause(page);
  try {
    await locator.hover({ timeout: 2000 });
  } catch {
    // Continue with click attempt.
  }
  await humanPause(page, 60, 180);
  await locator.click({ timeout: 3000 });
  await debugClickPause(page);
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

async function launchContextWithBrowserFallback(profileDirectory, isHeadless) {
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

  throw new Error(`Aucun navigateur compatible trouvé. Détails: ${errors.join(" | ")}`);
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

async function injectBypassScript(
  page,
  injectedComment,
  injectedName,
  injectedEmail,
  injectedUseAppSoundCloudConnection,
  injectedUseAppSpotifyConnection,
  injectedClickDelayMs,
) {
  await page.evaluate(({ commentText, nameText, emailText, useAppSoundCloud, useAppSpotify, clickDelayInMs }) => {
    const readHiddenValue = (id) => {
      const node = document.getElementById(id);
      if (!node) {
        return "";
      }
      const value = node.value;
      return typeof value === "string" ? value.trim() : "";
    };

    const configuredSteps = readHiddenValue("nwSteps")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);

    window.hypedditSettings = {
      email: emailText,
      name: nameText,
      comment: commentText,
      use_app_soundcloud_connection: useAppSoundCloud,
      use_app_spotify_connection: useAppSpotify,
      click_delay_in_ms: Number.isFinite(Number(clickDelayInMs))
        ? Math.max(0, Number(clickDelayInMs))
        : 0,
      input_to_click_gap_ms: Number.isFinite(Number(clickDelayInMs))
        ? Math.max(260, Number(clickDelayInMs))
        : 260,
      auto_close: true,
      auto_close_timeout_in_ms: 5000,
    };

    window.hypedditGateConfig = {
      is_skippable: readHiddenValue("is_skippable") === "1",
      is_unlimited: readHiddenValue("is_unlimited") === "1",
      gate_type: readHiddenValue("gate_type"),
      nw_steps: configuredSteps,
    };

    window.__glazerQueuedClick = Promise.resolve();
    window.__glazerEmailActionLockUntil = 0;
    window.__glazerEmailNeedsPlaywrightTyping = false;
    window.__glazerEmailAttemptedInCurrentStep = false;
    window.__glazerEmailState = "idle";
    window.__glazerLastInputAt = 0;
    window.__glazerCurrentStepSignature = "";
    window.__glazerCurrentStepTokens = [];
    window.__glazerStepTokenRunAt = Object.create(null);
    window.__glazerStepActionLog = [];
    window.__glazerMaxStepActionLog = 80;
    window.__glazerRepoDone = Object.create(null);
    window.__glazerRepoCycleRunning = false;
    window.__glazerNextClicks = Object.create(null);
    window.__glazerLastDetectedChallengeType = "";
    window.__glazerFinalDownloadLockUntil = 0;
    window.__glazerRepoLoopTimer = null;

    window.recordStepAction = function (action, details) {
      const entry = {
        at: Date.now(),
        action: String(action || "unknown"),
        details: details && typeof details === "object" ? details : {},
      };

      if (!Array.isArray(window.__glazerStepActionLog)) {
        window.__glazerStepActionLog = [];
      }

      window.__glazerStepActionLog.push(entry);
      const maxEntries = Number.isFinite(Number(window.__glazerMaxStepActionLog))
        ? Math.max(10, Number(window.__glazerMaxStepActionLog))
        : 80;
      if (window.__glazerStepActionLog.length > maxEntries) {
        window.__glazerStepActionLog.splice(0, window.__glazerStepActionLog.length - maxEntries);
      }
    };

    window.buildStepSignature = function (stepElement, tokens) {
      if (!stepElement) {
        return "";
      }

      const classPart = Array.from(stepElement.classList || [])
        .map((item) => String(item).toLowerCase())
        .sort()
        .join(".");
      const tokenPart = Array.from(new Set((Array.isArray(tokens) ? tokens : [])
        .map((item) => String(item).toLowerCase())
        .filter(Boolean)))
        .sort()
        .join("|");
      const markerPart = [
        stepElement.getAttribute("id") || "",
        stepElement.getAttribute("data-step") || "",
      ]
        .filter(Boolean)
        .join("|");

      return `${tokenPart}::${classPart}::${markerPart}`;
    };

    window.canRunTokenInCurrentStep = function (token) {
      const normalizedToken = String(token || "").toLowerCase();
      if (!normalizedToken) {
        return false;
      }

      const stepSignature = window.__glazerCurrentStepSignature || "__unknown_step__";
      if (!window.__glazerStepTokenRunAt[stepSignature]) {
        window.__glazerStepTokenRunAt[stepSignature] = Object.create(null);
      }

      const tokenRuns = window.__glazerStepTokenRunAt[stepSignature];
      const now = Date.now();
      const lastRunAt = Number(tokenRuns[normalizedToken] || 0);
      const minGapMs = normalizedToken === "email"
        ? Math.max(1600, Number(window.hypedditSettings.click_delay_in_ms || 0) + 950)
        : 1200;

      if (now - lastRunAt < minGapMs) {
        return false;
      }

      tokenRuns[normalizedToken] = now;
      return true;
    };

    window.queueClick = function (targetElement, explicitDelayInMs) {
      if (targetElement === null || targetElement === undefined) {
        return;
      }

      const parsedExplicitDelay = Number(explicitDelayInMs);
      const delay = Number.isFinite(parsedExplicitDelay)
        ? Math.max(0, parsedExplicitDelay)
        : window.hypedditSettings.click_delay_in_ms;
      window.__glazerQueuedClick = window.__glazerQueuedClick.then(
        () => new Promise((resolve) => {
          const now = Date.now();
          const lastInputAt = Number(window.__glazerLastInputAt || 0);
          const elapsedSinceInput = Math.max(0, now - lastInputAt);
          const minInputGap = Number.isFinite(Number(window.hypedditSettings.input_to_click_gap_ms))
            ? Math.max(0, Number(window.hypedditSettings.input_to_click_gap_ms))
            : 0;
          const waitForInputGap = Math.max(0, minInputGap - elapsedSinceInput);
          const finalDelay = Math.max(delay, waitForInputGap);

          window.setTimeout(() => {
            try {
              targetElement.click();
            } catch {
              // Ignore click errors in queued mode.
            }
            resolve();
          }, finalDelay);
        }),
      );
    };

    window.isElementVisible = function (element) {
      if (!element) {
        return false;
      }

      const style = window.getComputedStyle(element);
      if (!style || style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
        return false;
      }

      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    window.findVisibleElementBySelector = function (selector) {
      if (!selector) {
        return null;
      }

      const candidates = Array.from(document.querySelectorAll(selector));
      for (const candidate of candidates) {
        if (window.isElementVisible(candidate)) {
          return candidate;
        }
      }

      return null;
    };

    window.setInputValue = function (inputElement, nextValue) {
      if (inputElement === null || inputElement === undefined) {
        return;
      }

      const inputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      const textareaValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;

      if (inputElement instanceof window.HTMLTextAreaElement && textareaValueSetter) {
        textareaValueSetter.call(inputElement, nextValue);
      } else if (inputValueSetter) {
        inputValueSetter.call(inputElement, nextValue);
      } else {
        inputElement.value = nextValue;
      }

      inputElement.dispatchEvent(new Event("input", { bubbles: true }));
      inputElement.dispatchEvent(new Event("change", { bubbles: true }));
      inputElement.dispatchEvent(new Event("blur", { bubbles: true }));
      window.__glazerLastInputAt = Date.now();
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

        window.queueClick(document.getElementById(skipperId));
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
          window.queueClick(carouselNext);
          return true;
        }
        return false;
      }

      window.queueClick(skipper);
      return true;
    };

    window.handleSoundCloud = function () {
      const comment = window.hypedditSettings.comment;
      const useAppSoundCloud = window.hypedditSettings.use_app_soundcloud_connection;

      if (document.getElementById("sc_comment_text") !== null) {
        window.setInputValue(document.getElementById("sc_comment_text"), comment);
      }

      if (document.getElementById("step_sc") !== null) {
        const soundCloudStep = document.getElementById("step_sc");
        if (useAppSoundCloud && window.trySkipStep("sc")) {
          return;
        }

        const soundCloudLink = soundCloudStep.querySelector("a");
        if (soundCloudLink !== null) {
          window.queueClick(soundCloudLink);
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
          window.queueClick(spotifyLink);
          return;
        }
      }

      if (useAppSpotify) {
        window.trySkipStep("sp");
        return;
      }
    };

    window.handleDownload = function () {
      window.queueClick(document.getElementById("gateDownloadButton"));

      if (window.hypedditSettings.auto_close) {
        const timeout = window.hypedditSettings.auto_close_timeout_in_ms;
        window.setTimeout(function () {
          window.open("about:blank", "_self");
          window.close();
        }, timeout);
      }
    };

    window.handleEmail = function () {
      if (window.__glazerEmailState === "awaiting_playwright" || window.__glazerEmailState === "submitted") {
        return;
      }

      const now = Date.now();
      if (now < window.__glazerEmailActionLockUntil) {
        return;
      }
      if (window.__glazerEmailAttemptedInCurrentStep) {
        return;
      }
      window.__glazerEmailActionLockUntil =
        now + Math.max(1500, (window.hypedditSettings.click_delay_in_ms || 0) + 900);

      const emailSubmitButton =
        document.getElementById("email_to_downloads_next") ||
        document.querySelector(
          '#step_email button[type="submit"], #step_email input[type="submit"], #step_email .btn-primary, #step_email [id*="next"]',
        );

      const nameInput = document.getElementById("email_name");
      const emailInput = document.getElementById("email_address");
      if (nameInput !== null && window.hypedditSettings.name) {
        window.setInputValue(nameInput, window.hypedditSettings.name);
      }
      if (emailInput !== null && window.hypedditSettings.email) {
        window.setInputValue(emailInput, window.hypedditSettings.email);
      }

      if (emailSubmitButton !== null) {
        window.__glazerEmailNeedsPlaywrightTyping = true;
        window.__glazerEmailAttemptedInCurrentStep = true;
        window.__glazerEmailState = "awaiting_playwright";
        window.recordStepAction("email_ready", { has_submit_button: true });
      } else {
        const skipped = window.trySkipStep("email");
        window.recordStepAction("email_submit_missing", { skipped });
      }
    };

    window.handleTikTok = function () {
      window.handleFollowOptions("tiktok_status", "skipper_tk_next");
    };

    window.handleFacebook = function () {
      window.queueClick(document.getElementById("fbCarouselSocialSection"));
    };

    window.handleMultiPortal = function () {
      window.handleEmail();
    };

    window.handleEmailSoundCloud = function () {
      window.handleEmail();
    };

    window.handleSoundCloudYoutube = function () {
      window.queueClick(document.getElementById("step_yt")?.previousElementSibling);
      window.handleYoutube();
    };

    window.handleDonate = function () {
      window.queueClick(document.getElementById("step_dn")?.previousElementSibling);
      window.queueClick(document.getElementById("donation_next"));
    };

    window.handleMixcloud = function () {
      window.queueClick(document.getElementById("skipper_mc"));
    };

    window.handleBandCamp = function () {
      window.queueClick(document.getElementById("skipper_bc"));
    };

    window.resolveActiveStepTokens = function (stepElement) {
      if (!stepElement) {
        return [];
      }

      const classes = Array.from(stepElement.classList || []).map((item) => String(item).toLowerCase());
      const tokens = new Set();

      const configured = Array.isArray(window.hypedditGateConfig?.nw_steps)
        ? window.hypedditGateConfig.nw_steps
        : [];
      for (const stepCode of configured) {
        if (classes.includes(stepCode)) {
          tokens.add(stepCode);
        }

        const configuredStepElement = document.getElementById(`step_${stepCode}`);
        if (configuredStepElement && stepElement.contains(configuredStepElement)) {
          tokens.add(stepCode);
        }
      }

      for (const className of classes) {
        if (className.includes("|")) {
          className
            .split("|")
            .map((item) => item.trim())
            .filter(Boolean)
            .forEach((item) => tokens.add(item));
        }
      }

      if (tokens.size === 0) {
        if (stepElement.querySelector("#step_email")) {
          tokens.add("email");
        }
        if (stepElement.querySelector("#step_sc")) {
          tokens.add("sc");
        }
        if (stepElement.querySelector("#gateDownloadButton")) {
          tokens.add("dw");
        }
      }

      return Array.from(tokens);
    };

    window.runStepToken = function (token) {
      const normalizedToken = String(token || "").toLowerCase();
      if (!normalizedToken) {
        return;
      }

      if (!window.canRunTokenInCurrentStep(normalizedToken)) {
        return;
      }

      switch (normalizedToken) {
        case "email":
          window.handleEmail();
          break;
        case "sc":
          window.handleSoundCloud();
          break;
        case "ig":
          window.handleInstagram();
          break;
        case "yt":
          window.handleYoutube();
          break;
        case "sp":
          window.handleSpotify();
          break;
        case "tk":
          window.handleTikTok();
          break;
        case "fb":
          window.handleFacebook();
          break;
        case "mc":
          window.handleMixcloud();
          break;
        case "bc":
          window.handleBandCamp();
          break;
        case "dn":
          window.handleDonate();
          break;
        case "dw":
          window.handleDownload();
          break;
        default:
          break;
      }

      window.recordStepAction("token_run", {
        token: normalizedToken,
        step_signature: window.__glazerCurrentStepSignature,
      });
    };

    window.detectVisibleChallenge = function () {
      const done = window.__glazerRepoDone || {};
      const challenges = [
        { type: "initial_download", id: "downloadProcess" },
        { type: "sc_comment", id: "sc_comment_text" },
        { type: "sc_connect", selector: "#login_to_sc, #step_sc a[href], #step_sc a" },
        { type: "ig_follow", selector: ".button-instagram-1.undone, #instagram_status a.undone" },
        { type: "tk_follow", selector: ".button-tiktok-1.undone, #tiktok_status a.undone" },
        { type: "fb_like", selector: ".button-facebook.undone, #fbCarouselSocialSection" },
        { type: "tw_follow", selector: ".button-twitter.undone" },
        { type: "yt_subscribe", selector: ".button-youtube.undone, #youtube_status a.undone" },
        { type: "sp_follow", selector: ".button-spotify.undone, #login_to_sp, #step_sp a[href], #step_sp a" },
        {
          type: "next_button",
          selector: "button.button-next:not(.hide), #myCarousel .right.carousel-control, #myCarousel .carousel-control-next, #myCarousel [data-slide='next']",
        },
        { type: "email_input", id: "email_address" },
        { type: "final_download", id: "gateDownloadButton" },
      ];

      const shouldSkip = (type) => {
        if (type === "initial_download" && done.initial_download) {
          return true;
        }
        if (type === "sc_comment" && (done.sc_comment || done.sc)) {
          return true;
        }
        if (type === "sc_connect" && done.sc) {
          return true;
        }
        if (type === "ig_follow" && done.ig) {
          return true;
        }
        if (type === "tk_follow" && done.tk) {
          return true;
        }
        if (type === "fb_like" && done.fb) {
          return true;
        }
        if (type === "tw_follow" && done.tw) {
          return true;
        }
        if (type === "yt_subscribe" && done.yt) {
          return true;
        }
        if (type === "sp_follow" && done.sp) {
          return true;
        }
        if (type === "email_input" && (done.email || window.__glazerEmailState === "submitted")) {
          return true;
        }

        return false;
      };

      for (const challenge of challenges) {
        if (shouldSkip(challenge.type)) {
          continue;
        }

        const element = challenge.id
          ? document.getElementById(challenge.id)
          : window.findVisibleElementBySelector(challenge.selector);
        if (!element || !window.isElementVisible(element)) {
          continue;
        }

        return { type: challenge.type, element };
      }

      return null;
    };

    window.handleDetectedChallenge = function (challengeType, element) {
      const done = window.__glazerRepoDone || {};

      switch (challengeType) {
        case "initial_download":
          if (element) {
            window.queueClick(element);
            done.initial_download = true;
            return true;
          }
          return false;

        case "sc_comment":
          if (element) {
            window.setInputValue(element, window.hypedditSettings.comment);
            done.sc_comment = true;
            return true;
          }
          return false;

        case "sc_connect": {
          if (window.hypedditSettings.use_app_soundcloud_connection && window.trySkipStep("sc")) {
            done.sc = true;
            return true;
          }

          const clickable = element || window.findVisibleElementBySelector("#login_to_sc, #step_sc a[href], #step_sc a");
          if (clickable) {
            window.queueClick(clickable);
            done.sc = true;
            return true;
          }

          if (window.trySkipStep("sc")) {
            done.sc = true;
            return true;
          }

          return false;
        }

        case "ig_follow":
          window.handleInstagram();
          done.ig = true;
          return true;

        case "tk_follow":
          window.handleTikTok();
          done.tk = true;
          return true;

        case "fb_like":
          window.handleFacebook();
          done.fb = true;
          return true;

        case "tw_follow":
          if (element) {
            window.queueClick(element);
          }
          window.trySkipStep("tw");
          done.tw = true;
          return true;

        case "yt_subscribe":
          window.handleYoutube();
          done.yt = true;
          return true;

        case "sp_follow":
          window.handleSpotify();
          done.sp = true;
          return true;

        case "next_button": {
          if (!element) {
            return false;
          }

          const rawKey =
            element.getAttribute("id") ||
            element.getAttribute("data-step") ||
            (element.textContent || "").trim() ||
            element.className ||
            "next";
          const nextKey = String(rawKey).slice(0, 180);
          if (window.__glazerNextClicks[nextKey]) {
            return true;
          }

          window.__glazerNextClicks[nextKey] = Date.now();
          window.queueClick(element);
          return true;
        }

        case "email_input":
          if (window.__glazerEmailState === "submitted") {
            done.email = true;
            return true;
          }
          window.handleEmail();
          return true;

        case "final_download": {
          const now = Date.now();
          if (now < window.__glazerFinalDownloadLockUntil) {
            return false;
          }

          window.__glazerFinalDownloadLockUntil =
            now + Math.max(3800, Number(window.hypedditSettings.click_delay_in_ms || 0) + 2500);
          window.handleDownload();
          return true;
        }

        default:
          return false;
      }
    };

    const targetNode = document.getElementById("myCarousel");
    if (!targetNode) {
      return;
    }

    const config = { attributes: true, childList: true, subtree: true };

    const processCurrentStep = () => {
      const stepContent = document.querySelector(".fangate-slider-content:not(.move-left)");
      if (!stepContent) {
        return;
      }

      const activeTokens = window.resolveActiveStepTokens(stepContent)
        .map((item) => String(item).toLowerCase())
        .filter(Boolean);
      const stepSignature = window.buildStepSignature(stepContent, activeTokens);
      if (!stepSignature) {
        return;
      }

      const isNewStep = stepSignature !== window.__glazerCurrentStepSignature;
      if (isNewStep) {
        window.__glazerCurrentStepSignature = stepSignature;
        window.__glazerCurrentStepTokens = activeTokens;
        window.__glazerEmailNeedsPlaywrightTyping = false;
        window.__glazerEmailAttemptedInCurrentStep = false;
        window.__glazerEmailActionLockUntil = 0;
        window.__glazerEmailState = "idle";
        window.recordStepAction("step_transition", {
          signature: stepSignature,
          tokens: activeTokens,
          gate_type: window.hypedditGateConfig?.gate_type || "",
          is_skippable: Boolean(window.hypedditGateConfig?.is_skippable),
        });
      }

      if (!activeTokens.includes("email")) {
        window.__glazerEmailNeedsPlaywrightTyping = false;
        window.__glazerEmailAttemptedInCurrentStep = false;
        window.__glazerEmailState = "idle";
      }
    };

    const callback = () => {
      processCurrentStep();
    };

    const runRepoStyleCycle = () => {
      if (window.__glazerRepoCycleRunning) {
        return;
      }

      window.__glazerRepoCycleRunning = true;
      try {
        processCurrentStep();
        const detected = window.detectVisibleChallenge();

        if (!detected) {
          window.__glazerLastDetectedChallengeType = "";
          return;
        }

        if (window.__glazerLastDetectedChallengeType !== detected.type) {
          window.__glazerLastDetectedChallengeType = detected.type;
          window.recordStepAction("repo_challenge_detected", {
            type: detected.type,
            step_signature: window.__glazerCurrentStepSignature,
          });
        }

        const handled = window.handleDetectedChallenge(detected.type, detected.element);
        if (handled) {
          window.recordStepAction("repo_challenge_handled", {
            type: detected.type,
            step_signature: window.__glazerCurrentStepSignature,
          });
        }
      } finally {
        window.__glazerRepoCycleRunning = false;
      }
    };

    const observer = new MutationObserver(callback);
    observer.observe(targetNode, config);
    processCurrentStep();

    if (window.__glazerRepoLoopTimer !== null) {
      window.clearInterval(window.__glazerRepoLoopTimer);
    }
    const cycleIntervalMs = Math.max(900, Number(window.hypedditSettings.click_delay_in_ms || 0) + 850);
    window.__glazerRepoLoopTimer = window.setInterval(runRepoStyleCycle, cycleIntervalMs);
    window.setTimeout(runRepoStyleCycle, 280);

    const _start = () => {
      if (document.getElementById("downloadProcess") !== null) {
        window.queueClick(document.getElementById("downloadProcess"));
      }
    };

    window.setTimeout(_start, 800);
  }, {
    commentText: injectedComment,
    nameText: injectedName,
    emailText: injectedEmail,
    useAppSoundCloud: injectedUseAppSoundCloudConnection,
    useAppSpotify: injectedUseAppSpotifyConnection,
    clickDelayInMs: injectedClickDelayMs,
  });
}

function startEmailTypingTestWatcher(page, userName, userEmail) {
  let active = true;
  const PER_KEY_DELAY_MS = 5;
  const WAIT_BEFORE_SHARE_CLICK_MS = 5000;

  async function shouldRun() {
    try {
      return await page.evaluate(() => ({
        needsTyping: Boolean(window.__glazerEmailNeedsPlaywrightTyping),
        emailState: typeof window.__glazerEmailState === "string"
          ? window.__glazerEmailState
          : "idle",
      }));
    } catch {
      return { needsTyping: false, emailState: "idle" };
    }
  }

  const task = (async () => {
    while (active) {
      if (page.isClosed()) {
        break;
      }

      const gateEmailState = await shouldRun();
      if (!gateEmailState.needsTyping || gateEmailState.emailState !== "awaiting_playwright") {
        await page.waitForTimeout(180);
        continue;
      }

      try {
        const nameInput = page.locator("#email_name").first();
        const emailInput = page.locator("#email_address").first();
        const submitButton = page.locator("#email_to_downloads_next").first();

        if (await nameInput.count()) {
          await nameInput.click({ timeout: 2000 });
          await page.keyboard.press("Control+A");
          await page.keyboard.press("Backspace");
          if (userName) {
            await nameInput.type(userName, { delay: PER_KEY_DELAY_MS });
          }
        }

        if (await emailInput.count()) {
          await emailInput.click({ timeout: 2000 });
          await page.keyboard.press("Control+A");
          await page.keyboard.press("Backspace");
          if (userEmail) {
            await emailInput.type(userEmail, { delay: PER_KEY_DELAY_MS });
          }
        }

        await page.waitForTimeout(WAIT_BEFORE_SHARE_CLICK_MS);

        let didClickSubmit = false;
        if (await submitButton.count()) {
          await submitButton.click({ delay: 50, timeout: 2500 });
          didClickSubmit = true;
          process.stdout.write("__LOG__:email_typing_test per_key_ms=5 pre_click_wait_ms=5000\n");
        }

        if (didClickSubmit) {
          await page.evaluate(() => {
            window.__glazerEmailNeedsPlaywrightTyping = false;
            window.__glazerEmailState = "submitted";
            if (window.__glazerRepoDone && typeof window.__glazerRepoDone === "object") {
              window.__glazerRepoDone.email = true;
            }
            if (typeof window.recordStepAction === "function") {
              window.recordStepAction("email_submitted_by_playwright", {
                mode: "typing_test_5ms_5000ms",
              });
            }
          });
        } else {
          await page.waitForTimeout(220);
        }
      } catch {
        await page.waitForTimeout(250);
      }
    }
  })();

  return {
    stop() {
      active = false;
    },
    task,
  };
}

async function emitStepTrace(page, label) {
  try {
    const serializedTrace = await page.evaluate((traceLabel) => {
      const entries = Array.isArray(window.__glazerStepActionLog)
        ? window.__glazerStepActionLog.slice(-30)
        : [];
      return JSON.stringify({ label: traceLabel, entries });
    }, String(label || "runtime"));
    process.stdout.write(`__LOG__:gate_step_trace=${serializedTrace}\n`);
  } catch {
    // Ignore trace serialization errors.
  }
}

(async () => {
  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(outputFolder, { recursive: true });
  const preloadPlaywrightSessions = useAppSoundCloudConnection || useAppSpotifyConnection;
  const context = await launchContextWithBrowserFallback(profileDir, headless);

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
      await context.close();
      process.stdout.write(
        `__ERROR__:Session Playwright manquante pour ${missingProviders.join(", ")}. Connecte-toi depuis Réglages puis relance.\n`,
      );
      process.exit(5);
    }

    process.stdout.write("__LOG__:Using Playwright profile with preloaded sessions check enabled.\n");
  } else {
    process.stdout.write("__LOG__:Using Playwright profile only (preload sessions check disabled).\n");
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

  const downloadPromise = page.waitForEvent("download", { timeout: downloadStartTimeoutMs });
  process.stdout.write("__PROGRESS__:gate_running\n");

  await page.goto(hypedditUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  process.stdout.write(`__LOG__:hypeddit_target_after_goto=${page.url()}\n`);

  const gateMeta = await page.evaluate(() => {
    const read = (id) => {
      const node = document.getElementById(id);
      if (!node) {
        return "";
      }
      const value = node.value;
      return typeof value === "string" ? value.trim() : "";
    };

    return {
      is_skippable: read("is_skippable"),
      is_unlimited: read("is_unlimited"),
      nw_steps: read("nwSteps"),
      gate_type: read("gate_type"),
      fangate_style: read("fangate_style"),
      gate_id: read("current_fangate_id"),
    };
  });
  process.stdout.write(`__LOG__:gate_meta=${JSON.stringify(gateMeta)}\n`);

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
    clickDelayMs,
  );

  const emailTypingTestWatcher = startEmailTypingTestWatcher(page, userName, userEmail);

  let download;
  try {
    download = await downloadPromise;
    process.stdout.write("__PROGRESS__:download_started\n");
  } catch {
    process.stdout.write("__ERROR__:Aucun telechargement detecte (timeout).\n");
    emailTypingTestWatcher.stop();
    await emailTypingTestWatcher.task.catch(() => {});
    await emitStepTrace(page, "download_timeout");
    await context.close();
    process.exit(3);
  }

  emailTypingTestWatcher.stop();
  await emailTypingTestWatcher.task.catch(() => {});
  await emitStepTrace(page, "download_started");

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
