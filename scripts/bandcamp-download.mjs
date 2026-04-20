import fs from "node:fs";
import path from "node:path";

const bandcampUrl = process.argv[2];
const outputFolder = process.argv[3];
const overwriteArg = process.argv[4] ?? "false";
const preferredFilePathArg = process.argv[5] ?? "";
const preferredFormatArg = process.argv[6] ?? "mp3-320";
const emailTimeoutSecondsArg = process.argv[7] ?? "60";
const fallbackToStreamArg = process.argv[8] ?? "true";

if (!bandcampUrl) {
  console.error("Missing Bandcamp URL");
  process.exit(1);
}

if (!outputFolder) {
  console.error("Missing output folder");
  process.exit(1);
}

const overwriteExisting = overwriteArg === "true";
const preferredFilePath = preferredFilePathArg.trim() || null;
const preferredFormat = preferredFormatArg.trim().toLowerCase() || "mp3-320";
const parsedTimeout = Number.parseInt(emailTimeoutSecondsArg, 10);
const emailTimeoutSeconds = Number.isFinite(parsedTimeout)
  ? Math.min(180, Math.max(15, parsedTimeout))
  : 60;
const fallbackToStream = fallbackToStreamArg !== "false";

const MIME_TO_EXTENSION = {
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/x-wav": ".wav",
  "audio/wav": ".wav",
  "audio/flac": ".flac",
  "audio/x-flac": ".flac",
  "audio/aac": ".aac",
  "audio/mp4": ".m4a",
  "audio/x-m4a": ".m4a",
  "audio/aiff": ".aiff",
  "audio/x-aiff": ".aiff",
  "audio/ogg": ".ogg",
  "application/zip": ".zip",
};

function emitProgress(phase) {
  process.stdout.write(`__PROGRESS__:${phase}\n`);
}

function emitLog(message) {
  process.stdout.write(`__LOG__:${message}\n`);
}

function emitError(message) {
  process.stdout.write(`__ERROR__:${message}\n`);
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#38;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function sanitizeFileName(name) {
  const trimmed = name.trim();
  if (!trimmed) {
    return "track";
  }
  return trimmed.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").replace(/\s+/g, " ").trim() || "track";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseContentDispositionFilename(value) {
  if (!value) {
    return null;
  }

  const encodedMatch = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (encodedMatch && encodedMatch[1]) {
    try {
      return decodeURIComponent(encodedMatch[1].replace(/^"|"$/g, "")).trim();
    } catch {
      // Ignore malformed values.
    }
  }

  const plainMatch = value.match(/filename=([^;]+)/i);
  if (plainMatch && plainMatch[1]) {
    return plainMatch[1].replace(/^"|"$/g, "").trim();
  }

  return null;
}

function extensionFromContentType(contentType) {
  const normalized = (contentType || "").split(";")[0].trim().toLowerCase();
  return MIME_TO_EXTENSION[normalized] || "";
}

function getTralbumDataFromPage(html) {
  const tralbumMatch = html.match(/data-tralbum="([\s\S]*?)"/i);
  if (!tralbumMatch || !tralbumMatch[1]) {
    throw new Error("Bandcamp page parsing failed: data-tralbum not found.");
  }

  const decoded = decodeHtmlEntities(tralbumMatch[1]);
  return JSON.parse(decoded);
}

function getPagedataBlobFromPage(html) {
  const pagedataMatch = html.match(/id="pagedata"[^>]*data-blob="([\s\S]*?)"/i);
  if (!pagedataMatch || !pagedataMatch[1]) {
    throw new Error("Bandcamp download page parsing failed: data-blob not found.");
  }

  const decoded = decodeHtmlEntities(pagedataMatch[1]);
  return JSON.parse(decoded);
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while fetching ${url}`);
  }
  return response.text();
}

async function downloadToTarget(url, suggestedFileName, outputDir) {
  emitProgress("download_started");
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while downloading file`);
  }

  const disposition = response.headers.get("content-disposition");
  const contentType = response.headers.get("content-type");
  const dispositionName = parseContentDispositionFilename(disposition);
  const extensionFromType = extensionFromContentType(contentType);

  let targetPath;
  if (preferredFilePath) {
    targetPath = path.resolve(preferredFilePath);
  } else {
    const fallbackName = sanitizeFileName(suggestedFileName || "track");
    const finalName = dispositionName ? sanitizeFileName(dispositionName) : fallbackName;
    targetPath = path.join(outputDir, finalName);
  }

  if (!path.extname(targetPath) && extensionFromType) {
    targetPath = `${targetPath}${extensionFromType}`;
  }

  if (fs.existsSync(targetPath)) {
    if (!overwriteExisting) {
      throw new Error(`File already exists at ${targetPath}`);
    }
    fs.unlinkSync(targetPath);
  }

  emitProgress("file_saving");
  const arrayBuffer = await response.arrayBuffer();
  fs.writeFileSync(targetPath, Buffer.from(arrayBuffer));

  return {
    filePath: targetPath,
    fileName: path.basename(targetPath),
    overwroteExisting: overwriteExisting && !!preferredFilePath,
  };
}

function chooseAvailableFormat(downloads, preferred) {
  if (downloads[preferred]) {
    return preferred;
  }

  const fallbackOrder = [
    "flac",
    "wav",
    "aiff-lossless",
    "alac",
    "aac-hi",
    "mp3-320",
    "mp3-v0",
    "vorbis",
    "mp3-128",
  ];

  for (const key of fallbackOrder) {
    if (downloads[key]) {
      return key;
    }
  }

  return Object.keys(downloads)[0] || null;
}

async function resolveFreeDownloadUrl(downloadPageUrl, requestedFormat) {
  const html = await fetchText(downloadPageUrl);
  const blob = getPagedataBlobFromPage(html);
  const item = blob?.download_items?.[0];
  const downloads = item?.downloads;
  if (!downloads || typeof downloads !== "object") {
    throw new Error("No downloadable formats found on Bandcamp download page.");
  }

  const selectedFormat = chooseAvailableFormat(downloads, requestedFormat);
  if (!selectedFormat) {
    throw new Error("No supported download format available.");
  }

  const selected = downloads[selectedFormat];
  const originalUrl = String(selected?.url || "").trim();
  if (!originalUrl) {
    throw new Error(`Bandcamp format '${selectedFormat}' has no URL.`);
  }

  const statUrl = originalUrl.replace("/download/", "/statdownload/");
  const statResponse = await fetch(`${statUrl}?${new URLSearchParams({ ".vrs": "1" }).toString()}`, {
    headers: {
      accept: "application/json",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    },
  });

  if (!statResponse.ok) {
    throw new Error(`Bandcamp statdownload request failed: HTTP ${statResponse.status}`);
  }

  const statJson = await statResponse.json();
  const resultState = String(statJson?.result || "").toLowerCase();
  if (resultState === "ok" && statJson?.download_url) {
    return {
      selectedFormat,
      downloadUrl: String(statJson.download_url),
    };
  }

  if (resultState === "err" && statJson?.retry_url) {
    return {
      selectedFormat,
      downloadUrl: String(statJson.retry_url),
    };
  }

  throw new Error("Bandcamp statdownload did not provide a usable URL.");
}

async function createTemporaryMailbox() {
  const response = await fetch("https://www.1secmail.com/api/v1/?action=genRandomMailbox&count=1");
  if (!response.ok) {
    throw new Error(`1secmail mailbox creation failed: HTTP ${response.status}`);
  }

  const payload = await response.json();
  const address = Array.isArray(payload) ? String(payload[0] || "").trim() : "";
  if (!address.includes("@")) {
    throw new Error("1secmail returned an invalid mailbox address.");
  }

  const [login, domain] = address.split("@");
  return { address, login, domain };
}

async function pollBandcampEmail(mailbox, timeoutSeconds) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutSeconds * 1000) {
    const listUrl = `https://www.1secmail.com/api/v1/?${new URLSearchParams({
      action: "getMessages",
      login: mailbox.login,
      domain: mailbox.domain,
    }).toString()}`;

    const listResponse = await fetch(listUrl);
    if (!listResponse.ok) {
      await sleep(1000);
      continue;
    }

    const messages = await listResponse.json();
    if (Array.isArray(messages) && messages.length > 0) {
      const candidate = messages.find((message) => {
        const from = String(message?.from || "").toLowerCase();
        return from.includes("@email.bandcamp.com") || from.includes("bandcamp");
      }) || messages[0];

      const messageId = String(candidate?.id || "").trim();
      if (!messageId) {
        await sleep(1000);
        continue;
      }

      const readUrl = `https://www.1secmail.com/api/v1/?${new URLSearchParams({
        action: "readMessage",
        login: mailbox.login,
        domain: mailbox.domain,
        id: messageId,
      }).toString()}`;
      const readResponse = await fetch(readUrl);
      if (!readResponse.ok) {
        await sleep(1000);
        continue;
      }

      const mail = await readResponse.json();
      const htmlBody = String(mail?.htmlBody || mail?.body || "");
      const hrefMatch = htmlBody.match(/https?:\/\/[^\s"'<>]+/i);
      if (hrefMatch && hrefMatch[0]) {
        return hrefMatch[0];
      }
    }

    await sleep(1000);
  }

  throw new Error("Bandcamp email not received before timeout.");
}

async function requestEmailDownloadLink(pageUrl, tralbumData) {
  const itemId = String(tralbumData?.id || "").trim();
  const itemType = String(tralbumData?.item_type || "").trim();
  if (!itemId || !itemType) {
    throw new Error("Bandcamp item metadata missing for email download.");
  }

  const parsed = new URL(pageUrl);
  const downloadRequestUrl = `https://${parsed.host}/email_download`;

  const mailbox = await createTemporaryMailbox();
  emitLog(`Temporary mailbox created: ${mailbox.address}`);

  const form = new URLSearchParams({
    encoding_name: preferredFormat,
    item_id: itemId,
    item_type: itemType,
    address: mailbox.address,
    country: "US",
    postcode: "0",
  });

  const response = await fetch(downloadRequestUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      accept: "application/json, text/javascript, */*; q=0.01",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    },
    body: form,
  });

  if (!response.ok) {
    throw new Error(`Bandcamp email request failed: HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (!payload?.ok) {
    throw new Error(`Bandcamp email request rejected: ${JSON.stringify(payload)}`);
  }

  return pollBandcampEmail(mailbox, emailTimeoutSeconds);
}

async function run() {
  try {
    const outputDir = path.resolve(outputFolder);
    fs.mkdirSync(outputDir, { recursive: true });

    emitProgress("gate_running");
    const pageHtml = await fetchText(bandcampUrl);
    const tralbumData = getTralbumDataFromPage(pageHtml);
    const artist = String(tralbumData?.artist || "").trim() || "bandcamp";
    const title = String(tralbumData?.current?.title || tralbumData?.title || "").trim() || "track";

    let result;

    const freeDownloadPage = String(tralbumData?.freeDownloadPage || "").trim();
    if (freeDownloadPage) {
      emitLog("Bandcamp free download detected.");
      const { selectedFormat, downloadUrl } = await resolveFreeDownloadUrl(freeDownloadPage, preferredFormat);
      emitLog(`Selected free format: ${selectedFormat}`);
      result = await downloadToTarget(downloadUrl, `${sanitizeFileName(artist)} - ${sanitizeFileName(title)}`, outputDir);
    } else if (tralbumData?.current?.require_email) {
      emitLog("Bandcamp email download detected.");
      const downloadPageUrl = await requestEmailDownloadLink(bandcampUrl, tralbumData);
      const { selectedFormat, downloadUrl } = await resolveFreeDownloadUrl(downloadPageUrl, preferredFormat);
      emitLog(`Selected email format: ${selectedFormat}`);
      result = await downloadToTarget(downloadUrl, `${sanitizeFileName(artist)} - ${sanitizeFileName(title)}`, outputDir);
    } else if (fallbackToStream) {
      const trackInfo = Array.isArray(tralbumData?.trackinfo) ? tralbumData.trackinfo : [];
      const firstTrack = trackInfo.find((track) => track && track.file && track.file["mp3-128"]);
      const fallbackUrl = String(firstTrack?.file?.["mp3-128"] || "").trim();
      if (!fallbackUrl) {
        throw new Error("No free/email download found and no mp3-128 fallback available.");
      }

      emitLog("Bandcamp stream fallback used (mp3-128).");
      result = await downloadToTarget(fallbackUrl, `${sanitizeFileName(artist)} - ${sanitizeFileName(title)}.mp3`, outputDir);
    } else {
      throw new Error("No free or email Bandcamp download available for this track.");
    }

    emitProgress("browser_cut");
    process.stdout.write(`__RESULT__:${JSON.stringify({
      file_path: result.filePath,
      file_name: result.fileName,
      overwrote_existing: result.overwroteExisting,
    })}\n`);
    process.exit(0);
  } catch (error) {
    emitError(String(error?.message || error));
    process.exit(1);
  }
}

void run();
