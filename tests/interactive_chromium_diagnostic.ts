import { chromium } from "playwright";
import fs from "fs";
import path from "path";

async function runInteractiveDiagnostic() {
  console.log("=== [CHROMIUM INTERACTIVE DIAGNOSTIC] Launching Chromium Browser ===");
  const chromePath = "/root/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome";
  console.log(`Using Chromium executable: ${chromePath}`);
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromePath,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "ar",
  });

  const page = await context.newPage();

  const consoleLogs: Array<{ type: string; text: string }> = [];
  const pageErrors: string[] = [];
  const failedRequests: Array<{ url: string; error: string; status?: number }> = [];

  page.on("console", (msg) => {
    const text = msg.text();
    const type = msg.type();
    consoleLogs.push({ type, text });
    if (type === "error") {
      console.error(`[Browser Console Error]: ${text}`);
    } else if (text.includes("Duck") || text.includes("Novel") || text.includes("Error")) {
      console.log(`[Browser Console ${type}]: ${text}`);
    }
  });

  page.on("pageerror", (err) => {
    console.error(`[Browser PageError]: ${err.message}\n${err.stack}`);
    pageErrors.push(`${err.message}\n${err.stack}`);
  });

  page.on("requestfailed", (req) => {
    const failure = req.failure()?.errorText || "unknown";
    failedRequests.push({ url: req.url(), error: failure });
    console.warn(`[Browser Request Failed]: ${req.url()} (${failure})`);
  });

  page.on("response", (res) => {
    if (res.status() >= 400) {
      failedRequests.push({ url: res.url(), error: `HTTP ${res.status()}`, status: res.status() });
      console.warn(`[Browser HTTP Error]: ${res.status()} ${res.url()}`);
    }
  });

  const screenshotsDir = path.resolve(process.cwd(), "public/diagnostic_screens");
  if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });

  console.log("1. Navigating to http://localhost:3000 ...");
  await page.goto("http://localhost:3000", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(screenshotsDir, "01_home_screen.jpg") });

  console.log("2. Navigating to 'الرواية ⬅ مانجا 1.1' (NovelToManga) ...");
  // Click navigation button for novel-to-manga
  const novelNavBtn = await page.locator('button:has-text("الرواية ⬅ مانجا 1.1"), [data-view="novel-to-manga"]').first();
  if (await novelNavBtn.count() > 0) {
    await novelNavBtn.click();
  } else {
    // Fallback: evaluate view switch
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const match = btns.find((b) => b.textContent?.includes("الرواية ⬅ مانجا"));
      if (match) match.click();
    });
  }

  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(screenshotsDir, "02_novel_to_manga_page.jpg") });

  // Check if root has children or is blank
  const bodyText = await page.evaluate(() => document.body.innerText.trim());
  const rootChildren = await page.evaluate(() => document.getElementById("root")?.children.length || 0);
  console.log(`NovelToManga view loaded. Root children count: ${rootChildren}, Body text length: ${bodyText.length}`);

  if (rootChildren === 0 || bodyText.length === 0) {
    console.error("WHITE SCREEN DETECTED on NovelToManga initial load!");
  } else {
    console.log("✓ NovelToManga loaded successfully without white screen.");
  }

  console.log("3. Switching to Duck.ai Unified Dashboard tab...");
  // Find tab button for Duck.ai Dashboard
  const duckTabBtn = page.locator('button:has-text("لوحة تحكم Duck.ai"), button:has-text("Duck.ai")').first();
  if (await duckTabBtn.count() > 0) {
    await duckTabBtn.click();
  } else {
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const match = btns.find((b) => b.textContent?.includes("Duck.ai"));
      if (match) match.click();
    });
  }

  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(screenshotsDir, "03_duckai_dashboard.jpg") });

  // Check DuckAi Dashboard elements
  const hasComposer = await page.locator("#duckai-main-prompt-input").count();
  const hasSendBtn = await page.locator("#duckai-composer-send-btn").count();
  console.log(`Duck.ai Dashboard elements: hasComposer=${hasComposer}, hasSendBtn=${hasSendBtn}`);

  console.log("4. Testing prompt typing and paste into Live Prompt Composer...");
  const promptInput = page.locator("#duckai-main-prompt-input");
  await promptInput.fill("A warrior with an azure blade on a misty mountain, detailed manhwa");
  await page.waitForTimeout(500);

  const sendBtnDisabled = await page.locator("#duckai-composer-send-btn").isDisabled();
  const sendBtnText = await page.locator("#duckai-composer-send-btn").innerText();
  console.log(`Send Button status: disabled=${sendBtnDisabled}, text="${sendBtnText}" (Expected: disabled=false)`);

  await page.screenshot({ path: path.join(screenshotsDir, "04_duckai_prompt_typed.jpg") });

  console.log("5. Testing rapid tab switching to verify React resilience...");
  // Switch to PIPELINE
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const match = btns.find((b) => b.textContent?.includes("الخطوات الرئيسية") || b.textContent?.includes("خطوات الإنتاج"));
    if (match) match.click();
  });
  await page.waitForTimeout(1000);

  // Switch back to DUCK_DASHBOARD
  if (await duckTabBtn.count() > 0) {
    await duckTabBtn.click();
  }
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(screenshotsDir, "05_duckai_after_tab_switch.jpg") });

  console.log("=== DIAGNOSTIC SUMMARY ===");
  console.log(`Total Console Errors: ${consoleLogs.filter((l) => l.type === "error").length}`);
  console.log(`Total PageErrors (Uncaught Exceptions): ${pageErrors.length}`);
  console.log(`Total Failed Requests: ${failedRequests.length}`);

  if (pageErrors.length > 0) {
    console.error("PAGE ERRORS RECORDED:");
    pageErrors.forEach((e, idx) => console.error(`${idx + 1}: ${e}`));
  }

  await browser.close();
  console.log("=== Interactive Chromium Diagnostic Completed ===");
  process.exit(pageErrors.length > 0 ? 1 : 0);
}

runInteractiveDiagnostic().catch((err) => {
  console.error("Diagnostic execution error:", err);
  process.exit(1);
});
