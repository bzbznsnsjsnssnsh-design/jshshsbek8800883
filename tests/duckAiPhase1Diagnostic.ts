import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import os from "os";

async function runPhase1Diagnostic() {
  const isolatedDir = path.join(os.tmpdir(), `duck_phase1_diag_${Date.now()}`);
  fs.mkdirSync(isolatedDir, { recursive: true });

  let browser: any = null;
  const report: any = {
    timestamp: new Date().toISOString(),
    ownership: {},
    initialReadiness: null,
    backgroundExperiment: {},
    lifecycleEvents: {},
    conclusions: [],
  };

  try {
    console.log("[Diagnostic] 1. Launching isolated Chromium on:", isolatedDir);
    const startTime = Date.now();
    browser = await puppeteer.launch({
      headless: true,
      userDataDir: isolatedDir,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--window-size=1280,800",
      ],
    });

    const pid = browser.process()?.pid ?? null;
    const ws = browser.wsEndpoint();
    report.ownership = {
      browserPid: pid,
      wsEndpoint: ws,
      launchDurationMs: Date.now() - startTime,
      initialPagesCount: (await browser.pages()).length,
    };
    console.log(`[Diagnostic] Chromium launched. PID: ${pid}, ws: ${ws}`);

    const pages = await browser.pages();
    const page = pages[0] || (await browser.newPage());

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    );

    console.log("[Diagnostic] 2. Navigating to https://duck.ai/chat...");
    const navStart = Date.now();
    await page.goto("https://duck.ai/chat", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    const navDurationMs = Date.now() - navStart;

    // Helper for in-depth condition inspection
    const probeConditions = async (targetPage: any) => {
      const isClosed = targetPage.isClosed();
      const isConnected = Boolean(browser && browser.isConnected());
      let frameDetached = false;
      try {
        const mf = targetPage.mainFrame();
        if (!mf || mf.isDetached()) frameDetached = true;
      } catch {
        frameDetached = true;
      }

      if (isClosed || !isConnected || frameDetached) {
        return {
          isClosed,
          isConnected,
          frameDetached,
          dom: null,
        };
      }

      const dom = await targetPage.evaluate(() => {
        const app = document.getElementById("app");
        const appLoader = document.getElementById("app-loader");
        const loaderStyle = appLoader ? window.getComputedStyle(appLoader) : null;
        const loaderRect = appLoader ? appLoader.getBoundingClientRect() : null;

        const isLoaderActive = Boolean(
          appLoader &&
            loaderStyle &&
            loaderStyle.display !== "none" &&
            loaderStyle.visibility !== "hidden" &&
            parseFloat(loaderStyle.opacity || "1") > 0.05 &&
            loaderRect &&
            loaderRect.width > 0 &&
            loaderRect.height > 0
        );

        const skeletons = Array.from(document.querySelectorAll(".sk-main, .sk-sidebar"));
        const skeletonVisible = skeletons.some((el) => {
          const s = window.getComputedStyle(el);
          const r = el.getBoundingClientRect();
          return s.display !== "none" && s.visibility !== "hidden" && r.width > 0;
        });

        const inputs = Array.from(
          document.querySelectorAll("textarea, div[contenteditable='true'], input[type='text']")
        );
        const inputList = inputs.map((t) => {
          const s = window.getComputedStyle(t);
          const r = t.getBoundingClientRect();
          const isVis =
            s.display !== "none" &&
            s.visibility !== "hidden" &&
            parseFloat(s.opacity || "1") > 0.05 &&
            r.width > 20 &&
            r.height > 20;
          return {
            tag: t.tagName.toLowerCase(),
            isVisible: isVis,
            isDisabled: (t as any).disabled || t.getAttribute("disabled") !== null,
            w: Math.round(r.width),
            h: Math.round(r.height),
            offsetParentIsNull: (t as HTMLElement).offsetParent === null,
          };
        });

        const buttons = Array.from(document.querySelectorAll("button, div[role='button']"));
        const visibleButtons = buttons.filter((b) => {
          const s = window.getComputedStyle(b);
          const r = b.getBoundingClientRect();
          return (
            s.display !== "none" &&
            s.visibility !== "hidden" &&
            parseFloat(s.opacity || "1") > 0.05 &&
            r.width > 0
          );
        });

        const buttonLabels = visibleButtons.slice(0, 8).map((b) => {
          return ((b as HTMLElement).innerText || b.getAttribute("aria-label") || "").trim().slice(0, 25);
        });

        const bodyText = document.body ? document.body.innerText : "";
        const isChallenge =
          bodyText.includes("Please complete the following challenge") ||
          bodyText.includes("Select all squares containing a duck") ||
          bodyText.includes("bots use DuckDuckGo too");

        const isRateLimited =
          bodyText.includes("reaches usage limits") ||
          bodyText.includes("limit reached") ||
          bodyText.includes("Too Many Requests") ||
          bodyText.includes("ERR_BN_LIMIT");

        return {
          visibilityState: document.visibilityState,
          hasFocus: typeof document.hasFocus === "function" ? document.hasFocus() : true,
          hasApp: Boolean(app),
          appChildrenCount: app ? app.children.length : 0,
          hasAppLoader: Boolean(appLoader),
          isLoaderActive,
          loaderDetails: loaderStyle
            ? {
                display: loaderStyle.display,
                visibility: loaderStyle.visibility,
                opacity: loaderStyle.opacity,
                w: loaderRect ? Math.round(loaderRect.width) : 0,
                h: loaderRect ? Math.round(loaderRect.height) : 0,
              }
            : null,
          skeletonVisible,
          totalInputs: inputs.length,
          inputs: inputList,
          totalButtons: buttons.length,
          visibleButtonsCount: visibleButtons.length,
          buttonLabels,
          isChallenge,
          isRateLimited,
        };
      });

      return {
        isClosed,
        isConnected,
        frameDetached,
        url: targetPage.url(),
        title: await targetPage.title().catch(() => ""),
        dom,
      };
    };

    // Wait up to 10s for page hydration
    console.log("[Diagnostic] 3. Probing natural hydration...");
    let probe = await probeConditions(page);
    const startWait = Date.now();
    while (Date.now() - startWait < 12000) {
      if (probe.dom?.hasApp && probe.dom?.appChildrenCount > 0 && !probe.dom?.isLoaderActive) {
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
      probe = await probeConditions(page);
    }

    report.initialReadiness = {
      navDurationMs,
      timeToReadyMs: Date.now() - startWait,
      probe,
    };
    console.log("[Diagnostic] Initial probe result:", {
      hasApp: probe.dom?.hasApp,
      appChildren: probe.dom?.appChildrenCount,
      isLoaderActive: probe.dom?.isLoaderActive,
      inputsCount: probe.dom?.inputs?.length,
      visibleButtons: probe.dom?.visibleButtonsCount,
      visibilityState: probe.dom?.visibilityState,
      hasFocus: probe.dom?.hasFocus,
    });

    // 4. Background Tab Experiment (4.2)
    console.log("[Diagnostic] 4. Executing Background Tab Experiment (4.2)...");
    const activeState = await probeConditions(page);

    // Open a second tab and bring to front
    const secondTab = await browser.newPage();
    await secondTab.goto("about:blank");
    await secondTab.bringToFront();
    await new Promise((r) => setTimeout(r, 600));

    // Probe the Duck.ai tab while in background
    const backgroundState = await probeConditions(page);

    // Bring Duck.ai tab back to front
    await page.bringToFront();
    await new Promise((r) => setTimeout(r, 600));
    const foregroundRestoredState = await probeConditions(page);

    await secondTab.close().catch(() => {});

    report.backgroundExperiment = {
      active: {
        visibilityState: activeState.dom?.visibilityState,
        hasFocus: activeState.dom?.hasFocus,
        inputsFound: activeState.dom?.inputs?.filter((i: any) => i.isVisible).length,
      },
      backgrounded: {
        visibilityState: backgroundState.dom?.visibilityState,
        hasFocus: backgroundState.dom?.hasFocus,
        inputsFound: backgroundState.dom?.inputs?.filter((i: any) => i.isVisible).length,
      },
      restored: {
        visibilityState: foregroundRestoredState.dom?.visibilityState,
        hasFocus: foregroundRestoredState.dom?.hasFocus,
        inputsFound: foregroundRestoredState.dom?.inputs?.filter((i: any) => i.isVisible).length,
      },
      finding:
        backgroundState.dom?.visibilityState === "hidden"
          ? "Chromium marks background tabs visibilityState='hidden'. While DOM remains accessible, bringToFront() restores 'visible' and ensures prompt interactability."
          : "Tab maintained visibilityState despite another tab creation.",
    };
    console.log("[Diagnostic] Background experiment:", report.backgroundExperiment);

    // 5. Lifecycle and Detached Frame checks (4.3)
    console.log("[Diagnostic] 5. Testing Frame and close handling (4.3)...");
    let closeFired = false;
    page.on("close", () => {
      closeFired = true;
    });

    await page.close();
    report.lifecycleEvents = {
      pageClosedFired: closeFired,
      pageIsClosedReported: page.isClosed(),
    };
    console.log("[Diagnostic] Page close fired:", closeFired, "page.isClosed:", page.isClosed());
  } catch (err: any) {
    report.error = err?.message || String(err);
    console.error("[Diagnostic] Error during execution:", err);
  } finally {
    if (browser) {
      console.log("[Diagnostic] Closing test browser cleanly...");
      await browser.close().catch(() => {});
    }
    try {
      fs.rmSync(isolatedDir, { recursive: true, force: true });
    } catch {}
  }

  console.log("\n=== PHASE 1 DIAGNOSTIC SUMMARY ===");
  console.log(JSON.stringify(report, null, 2));
}

runPhase1Diagnostic();
