import { chromium } from "playwright";

const playlistUrl = process.argv[2];
const headlessArg = process.argv[3] ?? "true";
const headless = headlessArg === "true";

if (!playlistUrl) {
  console.error("Missing playlist URL");
  process.exit(1);
}

function normalizeUrl(href) {
  if (!href) return null;
  const absolute = href.startsWith("http://") || href.startsWith("https://")
    ? href
    : href.startsWith("/")
      ? `https://soundcloud.com${href}`
      : null;
  if (!absolute) return null;

  try {
    const parsed = new URL(absolute);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return absolute.split("?")[0].replace(/\/$/, "");
  }
}

(async () => {
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(playlistUrl, { waitUntil: "domcontentloaded", timeout: 60000 });

  try {
    const closeModal = page.locator('button.modal__closeButton[title="Close"]');
    if (await closeModal.count()) {
      await closeModal.first().click({ timeout: 2500 });
      await page.waitForTimeout(250);
    }

    const acceptButton = page.getByRole("button", { name: /accept|accepter|I Accept/i });
    if (await acceptButton.count()) {
      await acceptButton.first().click({ timeout: 2500 });
    }
  } catch {
    // ignore cookie banner issues
  }

  let previousCount = -1;
  let lastReportedCount = -1;

  for (let attempt = 0; attempt < 120; attempt += 1) {
    await page.evaluate(() => {
      window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" });
    });
    await page.waitForTimeout(1000);

    await page.evaluate(() => {
      window.scrollBy({ top: -250, behavior: "instant" });
      window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" });
    });
    await page.waitForTimeout(900);

    const count = await page.locator("a.trackItem__trackTitle").count();
    if (count !== lastReportedCount) {
      process.stdout.write(`__PROGRESS__:${count}\n`);
      lastReportedCount = count;
    }

    if (count === previousCount) {
      break;
    }

    previousCount = count;
  }

  const tracks = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll("div.trackItem"));

    return nodes
      .map((node) => {
        const titleAnchor = node.querySelector("a.trackItem__trackTitle");
        const artistAnchor = node.querySelector("a.trackItem__username");
        if (!titleAnchor) return null;

        const title = (titleAnchor.textContent ?? "").trim();
        const permalink_url = titleAnchor.getAttribute("href");
        const artist = (artistAnchor?.textContent ?? "").trim();

        if (!title) return null;

        return {
          title,
          artist: artist || null,
          permalink_url,
        };
      })
      .filter(Boolean);
  });

  const normalized = tracks.map((track) => ({
    ...track,
    permalink_url: normalizeUrl(track.permalink_url),
  }));

  process.stdout.write(`__RESULT__:${JSON.stringify(normalized)}\n`);

  await context.close();
  await browser.close();
})().catch((error) => {
  console.error(error?.message ?? String(error));
  process.exit(1);
});
