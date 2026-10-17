import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import puppeteer, { Browser, Page, CDPSession } from "puppeteer";
import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { WebSocket, WebSocketServer } from "ws";

// Register stealth plugin to bypass automation detection and keep Google sign-in smooth
puppeteerExtra.use(StealthPlugin());

export interface FlowBrowserStatus {
  isRunning: boolean;
  currentUrl: string;
  pageTitle: string;
  viewport: { width: number; height: number };
  activeClientsCount: number;
  hasPersistentProfile: boolean;
  userDataDir: string;
  isAutomated: boolean;
  lastError: string | null;
  hasSavedSession?: boolean;
  hasGoogleAuth?: boolean;
  savedCookiesCount?: number;
  lastSessionSavedAt?: string | null;
}

export interface BrowserActionPayload {
  type:
    | "click"
    | "move"
    | "mousedown"
    | "mouseup"
    | "resetInput"
    | "wheel"
    | "keydown"
    | "keyup"
    | "keypress"
    | "type"
    | "navigate"
    | "reload"
    | "goBack"
    | "goForward"
    | "resize"
    | "typePrompt";
  x?: number;
  y?: number;
  button?: "left" | "right" | "middle";
  deltaX?: number;
  deltaY?: number;
  key?: string;
  text?: string;
  url?: string;
  width?: number;
  height?: number;
}

class FlowBrowserService {
  private static instance: FlowBrowserService | null = null;

  private browser: Browser | null = null;
  private page: Page | null = null;
  private cdpSession: CDPSession | null = null;
  private isLaunching = false;
  private isAutomated = true;
  private lastError: string | null = null;

  private viewport = { width: 1280, height: 800 };
  private userDataDir: string;
  private sessionCookiesFile: string;
  private latestFrameBase64: string | null = null;
  private latestFrameBuffer: Buffer | null = null;
  private clients = new Set<WebSocket>();

  private screencastQuality = 52;
  private screencastActive = false;
  private lastFrameBroadcastTime = 0;
  private lastMoveCoord: { x: number; y: number } | null = null;
  private moveDispatcherTimer: NodeJS.Timeout | null = null;
  private idleShutdownTimer: NodeJS.Timeout | null = null;
  private lastViewerActivityTime = Date.now();
  private screenshotInFlightPromise: Promise<Buffer | null> | null = null;
  private debounceCookieSaveTimer: NodeJS.Timeout | null = null;

  // In-memory cache for session status to eliminate synchronous fs disk reads
  private sessionInfoCache: {
    hasSavedSession: boolean;
    hasGoogleAuth: boolean;
    cookieCount: number;
    savedAt: string | null;
  } | null = null;

  // Cached URL and page title to prevent blocking or hanging during navigation
  private cachedPageTitle: string = "";
  private cachedCurrentUrl: string = "about:blank";

  // Trailing screencast frame delivery state to guarantee final frame of click/animation is never dropped
  private pendingBroadcastTimer: NodeJS.Timeout | null = null;
  private pendingFrameData: string | null = null;
  private pendingFrameMeta: any = null;

  // Single shared launch Promise to eliminate 500ms busy loops across concurrent requests
  private launchPromise: Promise<Page> | null = null;

  // Strict serialization queue for browser actions to prevent CDP race conditions
  private actionQueue: Promise<any> = Promise.resolve();

  // Background auto-save timer for persistent sessions
  private cookieAutoSaverTimer: NodeJS.Timeout | null = null;

  private constructor() {
    this.userDataDir = path.resolve(process.cwd(), "data/flow_chromium_profile");
    this.sessionCookiesFile = path.resolve(this.userDataDir, "saved_session_cookies.json");

    if (!fs.existsSync(this.userDataDir)) {
      try {
        fs.mkdirSync(this.userDataDir, { recursive: true });
      } catch (err: any) {
        console.warn("[FlowBrowser] Warning creating profile dir:", err?.message);
      }
    }
    // Clean any orphaned lock files from prior server restarts without deleting cookies
    this.cleanStaleLocks(this.userDataDir);

    // Start high-performance non-blocking mouse dispatcher
    this.startMoveDispatcher();

    // Start auto-save heartbeat
    this.startCookieAutoSaver();
  }

  public touchViewerActivity(): void {
    this.lastViewerActivityTime = Date.now();
    if (this.idleShutdownTimer) {
      clearTimeout(this.idleShutdownTimer);
      this.idleShutdownTimer = null;
    }
    if (this.browser && this.page && this.cdpSession && !this.screencastActive) {
      this.startScreencastStream().catch(() => {});
    }
  }

  /**
   * Lightweight non-blocking mouse mover running at 25Hz to eliminate action queue congestion
   */
  private startMoveDispatcher(): void {
    if (this.moveDispatcherTimer) return;
    this.moveDispatcherTimer = setInterval(async () => {
      if (this.lastMoveCoord && this.page && !this.page.isClosed()) {
        const target = this.lastMoveCoord;
        this.lastMoveCoord = null;
        try {
          await this.page.mouse.move(target.x, target.y);
        } catch (_) {}
      }
    }, 40);
    if (this.moveDispatcherTimer && typeof this.moveDispatcherTimer.unref === "function") {
      this.moveDispatcherTimer.unref();
    }
  }

  public static getInstance(): FlowBrowserService {
    if (!FlowBrowserService.instance) {
      FlowBrowserService.instance = new FlowBrowserService();
    }
    return FlowBrowserService.instance;
  }

  /**
   * Cleans stale Chromium lock files gracefully without deleting user profile cookies
   */
  public cleanStaleLocks(dir: string, killZombies: boolean = false): void {
    if (!fs.existsSync(dir)) return;

    // Only kill processes if explicitly requested (e.g. during manual stop or cold boot)
    if (killZombies) {
      try {
        execSync(`pkill -15 -f "${dir}" || true`, { stdio: "ignore" });
      } catch (_) {}
    }

    // Only delete process lock handles, NEVER delete database files
    const lockFiles = [
      "DevToolsActivePort",
      "SingletonLock",
      "SingletonSocket",
      "SingletonCookie",
      "lockfile",
    ];

    for (const f of lockFiles) {
      const fullPath = path.join(dir, f);
      try {
        let shouldUnlink = false;
        try {
          if (fs.existsSync(fullPath)) {
            shouldUnlink = true;
          } else if (fs.lstatSync(fullPath).isSymbolicLink()) {
            shouldUnlink = true;
          }
        } catch (_) {}

        if (shouldUnlink) {
          fs.unlinkSync(fullPath);
        }
      } catch (_) {}
    }
  }

  /**
   * Attempts to reconnect to an already running Chromium instance on the active DevTools port
   */
  private async tryConnectToExistingBrowser(): Promise<Browser | null> {
    const activePortPath = path.join(this.userDataDir, "DevToolsActivePort");
    if (!fs.existsSync(activePortPath)) return null;

    try {
      const content = fs.readFileSync(activePortPath, "utf-8").trim();
      const lines = content.split("\n");
      const port = parseInt(lines[0], 10);
      if (!port || isNaN(port)) {
        this.cleanStaleLocks(this.userDataDir);
        return null;
      }

      console.log(`[FlowBrowser] Attempting to reconnect to existing browser at port ${port}...`);
      const browser = await puppeteer.connect({
        browserURL: `http://127.0.0.1:${port}`,
        defaultViewport: {
          width: this.viewport.width,
          height: this.viewport.height,
          deviceScaleFactor: 1,
        },
      });

      console.log("[FlowBrowser] Successfully reconnected to running Chromium instance!");
      return browser;
    } catch (err: any) {
      console.log("[FlowBrowser] Existing browser port unresponsive, cleaning stale locks:", err?.message);
      this.cleanStaleLocks(this.userDataDir);
      return null;
    }
  }

  private async setupPageListeners(): Promise<void> {
    if (!this.page || this.page.isClosed()) return;

    try {
      const rawUa = await this.page.evaluate(() => navigator.userAgent);
      const cleanUa =
        (rawUa || "").replace(/HeadlessChrome/g, "Chrome") ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";
      await this.page.setUserAgent(cleanUa);
    } catch (_) {
      await this.page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36"
      );
    }

    await this.page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9,ar;q=0.8",
    });

    // Remove navigator.webdriver and shim __name to allow clean execution without breaking page DOM
    try {
      await this.page.evaluateOnNewDocument(`
        window.__name = function(target) { return target; };
        globalThis.__name = function(target) { return target; };
        try {
          Object.defineProperty(navigator, "webdriver", { get: function() { return undefined; }, configurable: true });
        } catch(_) {}
      `);
    } catch (_) {}

    this.page.on("pageerror", (err: any) => {
      console.warn(`[FlowBrowser:PageError] ${err?.message || String(err)}`);
    });

    this.page.on("console", (msg) => {
      if (msg.type() === "error") {
        console.warn(`[FlowBrowser:ConsoleError] ${msg.text().slice(0, 300)}`);
      }
    });

    this.page.on("close", () => {
      console.log("[FlowBrowser] Chromium page closed.");
      this.page = null;
      this.cdpSession = null;
      this.screencastActive = false;
      this.cachedCurrentUrl = "about:blank";
      this.cachedPageTitle = "";
      this.broadcastStatus();
    });

    this.page.on("domcontentloaded", async () => {
      try {
        if (this.page && !this.page.isClosed()) {
          this.cachedCurrentUrl = this.page.url();
          this.cachedPageTitle = await Promise.race([
            this.page.title().catch(() => this.cachedPageTitle),
            new Promise<string>((r) => setTimeout(() => r(this.cachedPageTitle), 350)),
          ]);
        }
      } catch (_) {}
      this.broadcastStatus();
    });

    this.page.on("framenavigated", async (frame) => {
      // Only broadcast and trigger cookie save when the main frame navigates to eliminate subframe/ad noise
      if (this.page && frame === this.page.mainFrame()) {
        try {
          this.cachedCurrentUrl = this.page.url();
        } catch (_) {}
        this.broadcastStatus();
        if (this.debounceCookieSaveTimer) {
          clearTimeout(this.debounceCookieSaveTimer);
        }
        this.debounceCookieSaveTimer = setTimeout(() => {
          this.saveSessionCookies().catch(() => {});
        }, 1800);
      }
    });
  }

  /**
   * Resolves the best available Chromium executable path
   */
  public getChromiumExecutablePath(): string {
    const candidates = [
      "/root/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome",
      "/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell",
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
    ];

    try {
      const defaultPup = puppeteer.executablePath();
      if (defaultPup && fs.existsSync(defaultPup)) {
        return defaultPup;
      }
    } catch (_) {}

    for (const c of candidates) {
      if (fs.existsSync(c)) {
        return c;
      }
    }

    return puppeteer.executablePath();
  }

  /**
   * Saves all active browser cookies into persistent JSON snapshot (including Google auth tokens)
   */
  public async saveSessionCookies(): Promise<{ count: number; hasGoogleAuth: boolean; timestamp: number }> {
    if (!this.page || this.page.isClosed()) {
      return { count: 0, hasGoogleAuth: false, timestamp: Date.now() };
    }

    try {
      let cookies: any[] = [];
      if (this.cdpSession) {
        try {
          const res = await this.cdpSession.send("Network.getAllCookies");
          if (res && Array.isArray(res.cookies)) {
            cookies = res.cookies;
          }
        } catch (_) {}
      }

      if (cookies.length === 0) {
        cookies = await this.page.cookies();
      }

      if (!cookies || cookies.length === 0) {
        return { count: 0, hasGoogleAuth: false, timestamp: Date.now() };
      }

      // Detect official Google authentication cookies (SID, HSID, SSID, APISID, SAPISID, __Secure-*)
      const googleAuthCookieNames = [
        "SID",
        "HSID",
        "SSID",
        "APISID",
        "SAPISID",
        "__Secure-1PSID",
        "__Secure-3PSID",
        "LSID",
        "ACCOUNT_CHOOSER",
      ];

      const hasGoogleAuth = cookies.some((c) => {
        const domain = (c.domain || "").toLowerCase();
        return (
          (domain.includes("google.com") || domain.includes(".google.")) &&
          googleAuthCookieNames.includes(c.name)
        );
      });

      const tempPath = `${this.sessionCookiesFile}.tmp`;
      const dataToSave = {
        savedAt: new Date().toISOString(),
        timestamp: Date.now(),
        count: cookies.length,
        hasGoogleAuth,
        cookies,
      };

      await fs.promises.writeFile(tempPath, JSON.stringify(dataToSave, null, 2), "utf-8");
      await fs.promises.rename(tempPath, this.sessionCookiesFile);

      this.sessionInfoCache = {
        hasSavedSession: true,
        hasGoogleAuth,
        cookieCount: cookies.length,
        savedAt: dataToSave.savedAt,
      };

      return { count: cookies.length, hasGoogleAuth, timestamp: dataToSave.timestamp };
    } catch (err: any) {
      console.warn("[FlowBrowser] Error saving session cookies:", err?.message);
      return { count: 0, hasGoogleAuth: false, timestamp: Date.now() };
    }
  }

  /**
   * Restores previously saved cookies into the active browser session
   */
  public async restoreSessionCookies(): Promise<{ count: number; hasGoogleAuth: boolean }> {
    if (!this.page || this.page.isClosed()) {
      return { count: 0, hasGoogleAuth: false };
    }

    if (!fs.existsSync(this.sessionCookiesFile)) {
      return { count: 0, hasGoogleAuth: false };
    }

    try {
      const raw = fs.readFileSync(this.sessionCookiesFile, "utf-8");
      const parsed = JSON.parse(raw);
      const cookies = parsed.cookies;

      if (!Array.isArray(cookies) || cookies.length === 0) {
        return { count: 0, hasGoogleAuth: false };
      }

      if (this.cdpSession) {
        try {
          await this.cdpSession.send("Network.setCookies", { cookies });
          console.log(`[FlowBrowser] Restored ${cookies.length} session cookies via CDP Network.setCookies`);
          return { count: cookies.length, hasGoogleAuth: Boolean(parsed.hasGoogleAuth) };
        } catch (cdpErr: any) {
          console.warn("[FlowBrowser] CDP setCookies fallback to page.setCookie:", cdpErr?.message);
        }
      }

      const formatted = cookies.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path || "/",
        expires: c.expires > 0 ? c.expires : undefined,
        httpOnly: Boolean(c.httpOnly),
        secure: Boolean(c.secure),
        sameSite: c.sameSite || undefined,
      }));

      await this.page.setCookie(...formatted);
      console.log(`[FlowBrowser] Restored ${formatted.length} cookies via page.setCookie`);
      return { count: formatted.length, hasGoogleAuth: Boolean(parsed.hasGoogleAuth) };
    } catch (err: any) {
      console.warn("[FlowBrowser] Error restoring session cookies:", err?.message);
      return { count: 0, hasGoogleAuth: false };
    }
  }

  /**
   * Returns current session metadata (whether saved cookies exist, Google login status, etc.)
   */
  public async getSessionInfo(): Promise<{
    hasSavedSession: boolean;
    hasGoogleAuth: boolean;
    cookieCount: number;
    savedAt: string | null;
  }> {
    if (this.sessionInfoCache) {
      return this.sessionInfoCache;
    }

    if (!fs.existsSync(this.sessionCookiesFile)) {
      return { hasSavedSession: false, hasGoogleAuth: false, cookieCount: 0, savedAt: null };
    }
    try {
      const raw = fs.readFileSync(this.sessionCookiesFile, "utf-8");
      const parsed = JSON.parse(raw);
      this.sessionInfoCache = {
        hasSavedSession: true,
        hasGoogleAuth: Boolean(parsed.hasGoogleAuth),
        cookieCount: parsed.count || (Array.isArray(parsed.cookies) ? parsed.cookies.length : 0),
        savedAt: parsed.savedAt || null,
      };
      return this.sessionInfoCache;
    } catch {
      return { hasSavedSession: false, hasGoogleAuth: false, cookieCount: 0, savedAt: null };
    }
  }

  private startCookieAutoSaver(): void {
    if (this.cookieAutoSaverTimer) return;
    this.cookieAutoSaverTimer = setInterval(async () => {
      if (this.page && !this.page.isClosed()) {
        await this.saveSessionCookies().catch(() => {});
      }
    }, 25000);
    if (this.cookieAutoSaverTimer && typeof this.cookieAutoSaverTimer.unref === "function") {
      this.cookieAutoSaverTimer.unref();
    }
  }

  public getBrowser(): Browser | null {
    return this.browser;
  }

  public getActivePage(): Page | null {
    return this.page;
  }

  /**
   * Switches the active CDP screencast and control focus to a specific browser Page/tab
   */
  public async setActivePage(newPage: Page): Promise<void> {
    if (!newPage || newPage.isClosed()) return;
    if (newPage === this.page && this.cdpSession && this.screencastActive) return;

    try {
      if (this.cdpSession) {
        try {
          await this.cdpSession.detach();
        } catch (_) {}
        this.cdpSession = null;
      }

      this.page = newPage;
      this.cachedCurrentUrl = newPage.url();
      this.cachedPageTitle = await newPage.title().catch(() => "");

      await this.setupPageListeners();
      await this.initCdpScreencast();

      try {
        const initBuf = await this.page.screenshot({ type: "jpeg", quality: 55 });
        this.latestFrameBuffer = Buffer.from(initBuf);
        this.latestFrameBase64 = this.latestFrameBuffer.toString("base64");
      } catch (_) {}

      this.broadcastStatus();
      console.log(`[FlowBrowser] Active page switched to: ${newPage.url()}`);
    } catch (err: any) {
      console.warn("[FlowBrowser] Error switching active page:", err?.message);
    }
  }

  /**
   * Launches or returns existing real Chromium browser session
   */
  public async ensureBrowserSession(targetUrl: string = "https://duck.ai/chat"): Promise<Page> {
    if (!targetUrl || targetUrl.trim() === "" || targetUrl === "about:blank") {
      targetUrl = "https://duck.ai/chat";
    }
    if (this.browser && this.page && !this.page.isClosed()) {
      const currentUrl = this.page.url();
      const isTargetDuck = targetUrl.includes("duck.ai") || targetUrl.includes("duckduckgo.com/chat");
      const isOnDuck = currentUrl.includes("duck.ai") || currentUrl.includes("duckduckgo.com/chat");
      if (isTargetDuck && !isOnDuck) {
        console.log(`[FlowBrowser] Existing page is on "${currentUrl}", navigating to target "${targetUrl}"...`);
        try {
          await this.page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
          this.cachedCurrentUrl = this.page.url();
          this.cachedPageTitle = await this.page.title().catch(() => "");
          this.broadcastStatus();
        } catch (e: any) {
          console.warn("[FlowBrowser] Error navigating existing session to targetUrl:", e?.message);
        }
      }
      return this.page;
    }

    if (this.launchPromise) {
      return this.launchPromise;
    }

    this.launchPromise = this.internalLaunch(targetUrl);
    try {
      return await this.launchPromise;
    } finally {
      this.launchPromise = null;
    }
  }

  private async internalLaunch(targetUrl: string): Promise<Page> {
    this.isLaunching = true;
    this.lastError = null;

    try {
      // 1. Try to reconnect to an existing running browser if present
      const existing = await this.tryConnectToExistingBrowser();
      if (existing) {
        this.browser = existing;
        const pages = await this.browser.pages();
        this.page = pages.length > 0 ? pages[0] : await this.browser.newPage();
        await this.setupPageListeners();
        await this.initCdpScreencast();
        await this.restoreSessionCookies();

        const currentUrl = this.page.url();
        const isTargetDuck = targetUrl.includes("duck.ai") || targetUrl.includes("duckduckgo.com/chat");
        const isOnDuck = currentUrl.includes("duck.ai") || currentUrl.includes("duckduckgo.com/chat");
        if (isTargetDuck && !isOnDuck) {
          console.log(`[FlowBrowser] Reconnected page is on "${currentUrl}", navigating to "${targetUrl}"...`);
          try {
            await this.page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
            this.cachedCurrentUrl = this.page.url();
            this.cachedPageTitle = await this.page.title().catch(() => "");
          } catch (e: any) {
            console.warn("[FlowBrowser] Error navigating reconnected browser:", e?.message);
          }
        }

        this.broadcastStatus();
        return this.page;
      }

      // 2. Ensure no dead locks remain
      this.cleanStaleLocks(this.userDataDir);

      const executablePath = this.getChromiumExecutablePath();
      console.log(`[FlowBrowser] Launching real Chromium from ${executablePath} with profile: ${this.userDataDir}...`);

      const cacheDir = "/tmp/flow_chromium_cache";
      if (!fs.existsSync(cacheDir)) {
        try {
          fs.mkdirSync(cacheDir, { recursive: true });
        } catch (_) {}
      }

      const launchBrowser = async (profileDir: string) => {
        return await (puppeteerExtra as any).launch({
          executablePath,
          userDataDir: profileDir,
          headless: "new" as any,
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--enable-fast-unload",
            `--disk-cache-dir=${cacheDir}`,
            "--disk-cache-size=209715200",
            "--disable-blink-features=AutomationControlled",
            `--window-size=${this.viewport.width},${this.viewport.height}`,
            "--enable-features=PersistSessionCookies,VaapiVideoDecoder",
            "--disable-features=Translate,OptimizationHints,MediaRouter,DialMediaRouteProvider,CalculateNativeWinOcclusion",
            "--disable-breakpad",
            "--disable-ipc-flooding-protection",
            "--disable-hang-monitor",
            "--disable-prompt-on-repost",
            "--autoplay-policy=user-gesture-required",
            "--disable-domain-reliability",
            "--disable-component-update",
            "--mute-audio",
            "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding",
            "--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4",
            "--lang=en-US,en,ar",
            "--password-store=basic",
            "--use-mock-keychain",
            "--disable-session-crashed-bubble",
            "--disable-infobars",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-default-apps",
            "--disable-sync",
          ],
          defaultViewport: {
            width: this.viewport.width,
            height: this.viewport.height,
            deviceScaleFactor: 1,
          },
          ignoreDefaultArgs: ["--enable-automation"],
        });
      };

      try {
        this.browser = await launchBrowser(this.userDataDir);
      } catch (launchErr: any) {
        if (launchErr?.message?.includes("already running")) {
          console.warn("[FlowBrowser] 'already running' detected. Performing clean retry...");
          this.cleanStaleLocks(this.userDataDir);
          await new Promise((r) => setTimeout(r, 600));
          this.browser = await launchBrowser(this.userDataDir);
        } else {
          throw launchErr;
        }
      }

      this.browser.on("disconnected", () => {
        console.log("[FlowBrowser] Chromium process disconnected.");
        this.browser = null;
        this.page = null;
        this.cdpSession = null;
        this.screencastActive = false;
        this.latestFrameBase64 = null;
        this.cleanStaleLocks(this.userDataDir);
        this.broadcastStatus();
      });

      const pages = await this.browser.pages();
      this.page = pages.length > 0 ? pages[0] : await this.browser.newPage();
      await this.setupPageListeners();
      await this.initCdpScreencast();

      // Restore session cookies immediately before page navigation
      await this.restoreSessionCookies();

      // Navigate to initial target URL only if truly already on it (and not stuck on /about)
      const currentLoc = this.page.url();
      const isStuckOnAbout = currentLoc.includes("/about") && !targetUrl.includes("/about");
      const isAlreadyOnTarget = Boolean(
        currentLoc &&
        currentLoc !== "about:blank" &&
        !isStuckOnAbout &&
        (currentLoc.replace(/\/$/, "") === targetUrl.replace(/\/$/, "") ||
          currentLoc.startsWith(targetUrl.replace(/\/$/, "")))
      );
      if (!isAlreadyOnTarget) {
        console.log(`[FlowBrowser] Navigating to ${targetUrl}...`);
        try {
          await this.page.goto(targetUrl, {
            waitUntil: "domcontentloaded",
            timeout: 10000,
          });
        } catch (navErr: any) {
          console.warn("[FlowBrowser] Initial navigation notice (proceeding):", navErr?.message);
        }
      }

      console.log(`[FlowBrowser] Browser ready at: ${this.page.url()}`);
      if (!this.latestFrameBuffer) {
        try {
          const initBuf = await this.page.screenshot({ type: "jpeg", quality: 55 });
          this.latestFrameBuffer = Buffer.from(initBuf);
          this.latestFrameBase64 = this.latestFrameBuffer.toString("base64");
        } catch (_) {}
      }
      this.broadcastStatus();

      return this.page;
    } catch (err: any) {
      console.error("[FlowBrowser] Failed to launch Chromium:", err);
      this.lastError = err?.message || String(err);
      throw err;
    } finally {
      this.isLaunching = false;
    }
  }

  /**
   * Starts or resumes Chrome DevTools Protocol Screencast
   */
  public async startScreencastStream(): Promise<void> {
    if (!this.cdpSession || this.screencastActive) return;
    try {
      await this.cdpSession.send("Page.startScreencast", {
        format: "jpeg",
        quality: this.screencastQuality,
        maxWidth: this.viewport.width,
        maxHeight: this.viewport.height,
        everyNthFrame: 1, // Full 30 FPS responsiveness without skipped frames
      });
      this.screencastActive = true;
      console.log("[FlowBrowser] CDP Screencast stream started smoothly (25-30 FPS, quality 60).");
    } catch (err: any) {
      console.warn("[FlowBrowser] Error starting screencast:", err?.message);
    }
  }

  /**
   * Pauses Screencast when no clients are viewing to save 100% CPU on the server
   */
  public async stopScreencastStream(): Promise<void> {
    if (!this.cdpSession || !this.screencastActive) return;
    try {
      await this.cdpSession.send("Page.stopScreencast");
      console.log("[FlowBrowser] CDP Screencast paused (idle, no active viewers).");
    } catch (_) {}
    this.screencastActive = false;
  }

  /**
   * Initializes Chrome DevTools Protocol Screencast with backpressure protection and frame throttling
   */
  private async initCdpScreencast(): Promise<void> {
    if (!this.page || this.page.isClosed()) return;

    try {
      if (this.cdpSession) {
        try {
          await this.cdpSession.detach();
        } catch (_) {}
      }

      this.cdpSession = await this.page.createCDPSession();

      // Enable Network domain for cookie extraction
      try {
        await this.cdpSession.send("Network.enable");
      } catch (_) {}

      this.cdpSession.on("Page.screencastFrame", async ({ data, sessionId, metadata }) => {
        // Acknowledge frame immediately to CDP without blocking to keep Chromium compositor running at full speed
        if (this.cdpSession) {
          this.cdpSession.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
        }

        const now = Date.now();
        this.latestFrameBase64 = data;
        this.latestFrameBuffer = null; // Invalidate cached buffer so next getter lazily converts

        const minIntervalMs = 33; // ~30 FPS smooth cap
        const timeSinceLast = now - this.lastFrameBroadcastTime;

        const broadcastNow = (b64: string, ts: number) => {
          this.lastFrameBroadcastTime = ts;
          if (this.clients.size > 0) {
            const buf = Buffer.from(b64, "base64");
            this.latestFrameBuffer = buf;
            for (const client of this.clients) {
              if (client.readyState === WebSocket.OPEN && client.bufferedAmount <= 512 * 1024) {
                try {
                  client.send(buf);
                } catch (_) {}
              }
            }
          }
        };

        if (timeSinceLast >= minIntervalMs) {
          if (this.pendingBroadcastTimer) {
            clearTimeout(this.pendingBroadcastTimer);
            this.pendingBroadcastTimer = null;
          }
          this.pendingFrameData = null;
          this.pendingFrameMeta = null;
          broadcastNow(data, now);
        } else {
          // Store frame and schedule trailing broadcast so the final frame of any click or animation is NEVER lost
          this.pendingFrameData = data;
          this.pendingFrameMeta = metadata;
          if (!this.pendingBroadcastTimer) {
            const delay = Math.max(5, minIntervalMs - timeSinceLast);
            this.pendingBroadcastTimer = setTimeout(() => {
              this.pendingBroadcastTimer = null;
              if (this.pendingFrameData) {
                const b64 = this.pendingFrameData;
                this.pendingFrameData = null;
                this.pendingFrameMeta = null;
                broadcastNow(b64, Date.now());
              }
            }, delay);
          }
        }
      });

      // Keep screencast active so the latest frame is ALWAYS live in memory for both WS and HTTP viewers
      await this.startScreencastStream();
    } catch (err: any) {
      console.warn("[FlowBrowser] CDP Screencast init warning:", err?.message);
    }
  }

  /**
   * Handles user interaction actions through a sequenced FIFO queue with strict timeouts
   */
  public handleAction(action: BrowserActionPayload): Promise<{ success: boolean; error?: string }> {
    // Non-blocking mouse movement: update latest coord without blocking action queue
    if (action.type === "move" && typeof action.x === "number" && typeof action.y === "number") {
      this.lastMoveCoord = { x: action.x, y: action.y };
      return Promise.resolve({ success: true });
    }

    return new Promise((resolve) => {
      // 6-second safety timeout: guarantees actionQueue NEVER deadlocks
      let settled = false;
      const timeoutTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve({ success: false, error: "Action execution timed out" });
        }
      }, 6000);

      this.actionQueue = this.actionQueue
        .then(async () => {
          if (settled) return;
          const res = await this.executeActionInternal(action);
          if (!settled) {
            settled = true;
            clearTimeout(timeoutTimer);
            resolve(res);
          }
        })
        .catch((err) => {
          if (!settled) {
            settled = true;
            clearTimeout(timeoutTimer);
            resolve({ success: false, error: err?.message || String(err) });
          }
        });
    });
  }

  public flushPendingFrameNow(): void {
    if (this.pendingBroadcastTimer) {
      clearTimeout(this.pendingBroadcastTimer);
      this.pendingBroadcastTimer = null;
    }
    if (this.pendingFrameData) {
      const b64 = this.pendingFrameData;
      this.pendingFrameData = null;
      this.pendingFrameMeta = null;
      const b = Buffer.from(b64, "base64");
      this.latestFrameBuffer = b;
      this.lastFrameBroadcastTime = Date.now();
      for (const client of this.clients) {
        if (client.readyState === WebSocket.OPEN && client.bufferedAmount <= 512 * 1024) {
          try {
            client.send(b);
          } catch (_) {}
        }
      }
    }
  }

  /**
   * Internal execution of an action once scheduled in the queue
   */
  private async executeActionInternal(action: BrowserActionPayload): Promise<{ success: boolean; error?: string }> {
    try {
      const page = await this.ensureBrowserSession();

      switch (action.type) {
        case "click": {
          if (typeof action.x === "number" && typeof action.y === "number") {
            const button = action.button || "left";
            // 15ms delay ensures buttons/links in Google Polymer/Angular/Closure register click reliably
            await page.mouse.click(action.x, action.y, { button, delay: 15 });
          }
          break;
        }

        case "move": {
          if (typeof action.x === "number" && typeof action.y === "number") {
            await page.mouse.move(action.x, action.y);
          }
          break;
        }

        case "mousedown": {
          if (typeof action.x === "number" && typeof action.y === "number") {
            await page.mouse.move(action.x, action.y);
          }
          await page.mouse.down({ button: action.button || "left" });
          break;
        }

        case "mouseup": {
          if (typeof action.x === "number" && typeof action.y === "number") {
            await page.mouse.move(action.x, action.y);
          }
          await page.mouse.up({ button: action.button || "left" });
          break;
        }

        case "resetInput": {
          // Releases any stuck mouse buttons
          await page.mouse.up({ button: "left" }).catch(() => {});
          await page.mouse.up({ button: "right" }).catch(() => {});
          await page.mouse.up({ button: "middle" }).catch(() => {});
          break;
        }

        case "wheel": {
          const deltaX = action.deltaX || 0;
          const deltaY = action.deltaY || 0;
          await page.mouse.wheel({ deltaX, deltaY });
          break;
        }

        case "keydown": {
          if (action.key) {
            await page.keyboard.down(action.key as any);
          }
          break;
        }

        case "keyup": {
          if (action.key) {
            await page.keyboard.up(action.key as any);
          }
          break;
        }

        case "keypress": {
          if (action.key) {
            await page.keyboard.press(action.key as any);
          }
          break;
        }

        case "type": {
          if (action.text) {
            await page.keyboard.type(action.text, { delay: 5 });
          }
          break;
        }

        case "navigate": {
          if (action.url) {
            let targetUrl = action.url.trim();
            if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
              targetUrl = "https://" + targetUrl;
            }
            if (targetUrl.includes("flow.google.com")) {
              const blockedMsg = "DUCK_ROUTING_PROHIBITED: الانتقال إلى Google Flow محظور داخل متصفح Duck.ai في قسم Novel → Manga.";
              console.warn(`[FlowBrowser] ${blockedMsg}`);
              return { success: false, error: blockedMsg };
            }
            if (page.url() !== targetUrl) {
              try {
                await page.goto(targetUrl, {
                  waitUntil: "domcontentloaded",
                  timeout: 10000,
                });
              } catch (navErr: any) {
                console.warn("[FlowBrowser] Navigation notice (proceeding):", navErr?.message);
              }
              try {
                this.cachedCurrentUrl = page.url();
              } catch (_) {}
              this.broadcastStatus();
              if (this.debounceCookieSaveTimer) clearTimeout(this.debounceCookieSaveTimer);
              this.debounceCookieSaveTimer = setTimeout(() => this.saveSessionCookies().catch(() => {}), 1800);
            }
          }
          break;
        }

        case "reload": {
          try {
            await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 });
          } catch (relErr: any) {
            console.warn("[FlowBrowser] Reload notice (proceeding):", relErr?.message);
          }
          this.broadcastStatus();
          break;
        }

        case "goBack": {
          await page.goBack({ timeout: 20000 }).catch(() => {});
          this.broadcastStatus();
          break;
        }

        case "goForward": {
          await page.goForward({ timeout: 20000 }).catch(() => {});
          this.broadcastStatus();
          break;
        }

        case "resize": {
          if (action.width && action.height) {
            const nextWidth = Math.max(640, Math.min(1920, Math.round(action.width)));
            const nextHeight = Math.max(480, Math.min(1200, Math.round(action.height)));
            this.viewport = { width: nextWidth, height: nextHeight };
            await page.setViewport({ width: nextWidth, height: nextHeight });

            // Restart screencast with new dimensions
            if (this.cdpSession) {
              await this.cdpSession.send("Page.stopScreencast").catch(() => {});
              await this.cdpSession.send("Page.startScreencast", {
                format: "jpeg",
                quality: this.screencastQuality,
                maxWidth: nextWidth,
                maxHeight: nextHeight,
                everyNthFrame: 1,
              });
            }
            this.broadcastStatus();
          }
          break;
        }

        case "typePrompt": {
          if (action.text) {
            await this.injectPromptIntoFlow(action.text);
          }
          break;
        }

        default:
          return { success: false, error: `Unknown action: ${(action as any).type}` };
      }

      return { success: true };
    } catch (err: any) {
      console.error("[FlowBrowser] Error executing action:", err);
      return { success: false, error: err?.message || String(err) };
    }
  }

  /**
   * Injects prompt text into the active Google Flow prompt input box
   */
  public async injectPromptIntoFlow(promptText: string): Promise<{ success: boolean; message: string }> {
    const page = await this.ensureBrowserSession();

    try {
      const injected = await page.evaluate((textToInject) => {
        const selectors = [
          'textarea[placeholder*="Describe"]',
          'textarea[placeholder*="prompt"]',
          'textarea[aria-label*="Prompt"]',
          'textarea[aria-label*="prompt"]',
          "textarea",
          'div[contenteditable="true"]',
          'input[type="text"][placeholder*="prompt"]',
        ];

        for (const sel of selectors) {
          const el = document.querySelector(sel) as HTMLTextAreaElement | HTMLElement;
          if (el && el.offsetParent !== null) {
            el.focus();
            if ("value" in el) {
              (el as HTMLTextAreaElement).value = textToInject;
              el.dispatchEvent(new Event("input", { bubbles: true }));
              el.dispatchEvent(new Event("change", { bubbles: true }));
            } else if (el.isContentEditable) {
              el.innerText = textToInject;
              el.dispatchEvent(new Event("input", { bubbles: true }));
            }
            return { found: true, tag: el.tagName, selector: sel };
          }
        }
        return { found: false };
      }, promptText);

      if (injected.found) {
        return { success: true, message: `Prompt placed in ${injected.tag} successfully.` };
      } else {
        // Fallback: type directly using keyboard
        await page.keyboard.type(promptText, { delay: 5 });
        return { success: true, message: "Prompt typed via keyboard into active focus element." };
      }
    } catch (err: any) {
      return { success: false, message: `Failed to inject prompt: ${err.message}` };
    }
  }

  /**
   * Scans Google Flow for generated images in the DOM
   */
  public async extractGeneratedImages(): Promise<{
    success: boolean;
    images: Array<{ url: string; alt?: string; width?: number; height?: number }>;
  }> {
    if (!this.page || this.page.isClosed()) {
      return { success: false, images: [] };
    }

    try {
      const images = await this.page.evaluate(() => {
        const found: Array<{ url: string; alt?: string; width?: number; height?: number }> = [];
        const imgs = Array.from(document.querySelectorAll("img"));

        for (const img of imgs) {
          const src = img.src || img.getAttribute("src") || "";
          if (
            (src.startsWith("http") || src.startsWith("data:image/") || src.startsWith("blob:")) &&
            !src.includes("googlelogo") &&
            !src.includes("avatar") &&
            !src.includes("profile") &&
            !src.includes("favicon") &&
            !src.includes("duck.ai/dist") &&
            !src.includes("gstatic.com/images/branding")
          ) {
            const rect = img.getBoundingClientRect();
            if (rect.width >= 100 && rect.height >= 100) {
              found.push({
                url: src,
                alt: img.alt || "",
                width: Math.round(rect.width),
                height: Math.round(rect.height),
              });
            }
          }
        }

        const els = Array.from(document.querySelectorAll('[style*="background-image"]'));
        for (const el of els) {
          const style = (el as HTMLElement).style.backgroundImage;
          const match = style.match(/url\(["']?([^"']+)["']?\)/);
          if (match && match[1] && match[1].startsWith("http")) {
            const rect = el.getBoundingClientRect();
            if (rect.width >= 100 && rect.height >= 100) {
              found.push({
                url: match[1],
                alt: "Background generated image",
                width: Math.round(rect.width),
                height: Math.round(rect.height),
              });
            }
          }
        }

        return found;
      });

      return { success: true, images };
    } catch (err: any) {
      return { success: false, images: [] };
    }
  }

  /**
   * Captures the full viewport or active visual area as high-res JPEG
   */
  public async captureFullScreenshot(): Promise<Buffer | null> {
    if (!this.page || this.page.isClosed()) {
      return null;
    }

    // FAST PATH: Return real-time screencast frame directly from memory
    const cached = this.getLatestFrameBuffer();
    if (cached) return cached;

    // Deduplicate in-flight screenshot requests to prevent compositor thrashing
    if (this.screenshotInFlightPromise) {
      return this.screenshotInFlightPromise;
    }

    this.screenshotInFlightPromise = (async () => {
      try {
        const buf = await this.page!.screenshot({
          type: "jpeg",
          quality: 65,
          fullPage: false,
        });
        const result = Buffer.from(buf);
        this.latestFrameBuffer = result;
        return result;
      } catch (err: any) {
        console.warn("[FlowBrowser] Screenshot capture error:", err?.message);
        return null;
      } finally {
        this.screenshotInFlightPromise = null;
      }
    })();

    return this.screenshotInFlightPromise;
  }

  /**
   * Downloads a generated image and stores it locally inside public storage for NovelToManga
   */
  public async saveExtractedImageLocally(imageUrl: string, prefix: string = "flow_gen"): Promise<string> {
    const storageDir = path.resolve(process.cwd(), "public/manga_storage/flow_browser_images");
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }

    const filename = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
    const targetPath = path.join(storageDir, filename);

    if (imageUrl.startsWith("data:image")) {
      const base64Data = imageUrl.replace(/^data:image\/\w+;base64,/, "");
      fs.writeFileSync(targetPath, Buffer.from(base64Data, "base64"));
      return `/manga_storage/flow_browser_images/${filename}`;
    }

    try {
      const response = await fetch(imageUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        },
      });
      const arrayBuffer = await response.arrayBuffer();
      fs.writeFileSync(targetPath, Buffer.from(arrayBuffer));
      return `/manga_storage/flow_browser_images/${filename}`;
    } catch (err: any) {
      console.error("[FlowBrowser] Failed to download image directly:", err);
      const fullScreenshot = await this.captureFullScreenshot();
      if (fullScreenshot) {
        fs.writeFileSync(targetPath, fullScreenshot);
        return `/manga_storage/flow_browser_images/${filename}`;
      }
      throw new Error(`Failed to save image: ${err?.message}`);
    }
  }

  /**
   * Gets current status of the browser session and saved authentication state
   */
  public async getStatus(): Promise<FlowBrowserStatus> {
    const isRunning = Boolean(this.browser && this.page && !this.page.isClosed());
    let currentUrl = this.cachedCurrentUrl || "about:blank";

    if (isRunning && this.page) {
      try {
        currentUrl = this.page.url();
        this.cachedCurrentUrl = currentUrl;
      } catch (_) {}
    }

    const sessionInfo = await this.getSessionInfo();

    return {
      isRunning,
      currentUrl,
      pageTitle: this.cachedPageTitle || "",
      viewport: { ...this.viewport },
      activeClientsCount: this.clients.size,
      hasPersistentProfile: fs.existsSync(this.userDataDir),
      userDataDir: this.userDataDir,
      isAutomated: this.isAutomated,
      lastError: this.lastError,
      hasSavedSession: sessionInfo.hasSavedSession,
      hasGoogleAuth: sessionInfo.hasGoogleAuth,
      savedCookiesCount: sessionInfo.cookieCount,
      lastSessionSavedAt: sessionInfo.savedAt,
    };
  }

  public getLatestFrameBase64(): string | null {
    return this.latestFrameBase64;
  }

  public getLatestFrameBuffer(): Buffer | null {
    if (this.latestFrameBuffer) return this.latestFrameBuffer;
    if (this.latestFrameBase64) {
      this.latestFrameBuffer = Buffer.from(this.latestFrameBase64, "base64");
      return this.latestFrameBuffer;
    }
    return null;
  }

  public setIsAutomated(val: boolean): void {
    this.isAutomated = val;
    this.broadcastStatus();
  }

  /**
   * Registers a connected WebSocket client for live screencast frames and bidirectional events
   */
  public registerClient(ws: WebSocket): void {
    this.clients.add(ws);
    console.log(`[FlowBrowser] WebSocket client connected. Total clients: ${this.clients.size}`);

    // If an idle shutdown was pending, cancel it immediately as user is active
    if (this.idleShutdownTimer) {
      clearTimeout(this.idleShutdownTimer);
      this.idleShutdownTimer = null;
      console.log("[FlowBrowser] Active viewer connected; cancelled idle auto-shutdown.");
    }

    // If screencast was idle, immediately resume it for the new viewer!
    if (!this.screencastActive && this.cdpSession) {
      this.startScreencastStream().catch(() => {});
    }

    // Send initial status immediately along with current frame
    this.getStatus().then(async (status) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "status", status }));
        let frameBuf = this.getLatestFrameBuffer();
        if (!frameBuf && this.page && !this.page.isClosed()) {
          try {
            const buf = await this.page.screenshot({ type: "jpeg", quality: 50 });
            frameBuf = Buffer.from(buf);
            this.latestFrameBuffer = frameBuf;
            this.latestFrameBase64 = frameBuf.toString("base64");
          } catch (_) {}
        }
        if (frameBuf && ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(frameBuf);
          } catch (_) {}
        }
      }
    });

    ws.on("message", async (rawMessage) => {
      try {
        const msg = JSON.parse(rawMessage.toString());
        if (msg.type === "action" && msg.action) {
          const res = await this.handleAction(msg.action);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "action_ack", success: res.success, error: res.error }));
          }
        } else if (msg.type === "request_frame") {
          const frameBuf = this.getLatestFrameBuffer();
          if (frameBuf && ws.readyState === WebSocket.OPEN) {
            try {
              ws.send(frameBuf);
            } catch (_) {}
          }
        }
      } catch (err: any) {
        console.warn("[FlowBrowser] Error parsing client message:", err?.message);
      }
    });

    ws.on("close", () => {
      this.clients.delete(ws);
      console.log(`[FlowBrowser] WebSocket client disconnected. Remaining: ${this.clients.size}`);
      // Zero viewers left: pause screencast immediately to save 100% CPU on the server
      if (this.clients.size === 0) {
        this.stopScreencastStream().catch(() => {});
        // Schedule auto-shutdown after 15 minutes of zero active viewers to prevent memory leaks while keeping session warm
        if (!this.idleShutdownTimer && this.browser) {
          this.idleShutdownTimer = setTimeout(() => {
            if (this.clients.size === 0 && this.browser) {
              console.log("[FlowBrowser] Idle timeout reached (15m with no active viewers). Auto-stopping Chromium...");
              this.stopSession().catch(() => {});
            }
          }, 900000);
        }
      }
    });

    ws.on("error", (err) => {
      console.warn("[FlowBrowser] WebSocket error:", err?.message);
      this.clients.delete(ws);
      if (this.clients.size === 0) {
        this.stopScreencastStream().catch(() => {});
        if (!this.idleShutdownTimer && this.browser) {
          this.idleShutdownTimer = setTimeout(() => {
            if (this.clients.size === 0 && this.browser) {
              console.log("[FlowBrowser] Idle timeout reached after ws error (15m). Auto-stopping Chromium...");
              this.stopSession().catch(() => {});
            }
          }, 900000);
        }
      }
    });

    // Ensure Chromium session is running when a client connects
    this.ensureBrowserSession().catch((err) => {
      console.warn("[FlowBrowser] Background launch notice:", err?.message);
    });
  }

  public broadcastStatus(): void {
    this.getStatus().then((status) => {
      const payload = JSON.stringify({ type: "status", status });
      for (const client of this.clients) {
        if (client.readyState === WebSocket.OPEN) {
          try {
            client.send(payload);
          } catch (_) {}
        }
      }
    });
  }

  /**
   * Stops the browser session cleanly, saving cookies and releasing all memory, processes, and file locks
   */
  public async stopSession(): Promise<void> {
    console.log("[FlowBrowser] Stopping Chromium browser session and releasing all resources...");
    if (this.idleShutdownTimer) {
      clearTimeout(this.idleShutdownTimer);
      this.idleShutdownTimer = null;
    }

    try {
      // Save cookies before terminating
      await this.saveSessionCookies().catch(() => {});
    } catch (_) {}

    if (this.cdpSession) {
      try {
        await this.cdpSession.detach();
      } catch (_) {}
      this.cdpSession = null;
    }
    if (this.page) {
      try {
        await this.page.close();
      } catch (_) {}
      this.page = null;
    }
    if (this.browser) {
      try {
        await this.browser.close();
      } catch (_) {}
      this.browser = null;
    }

    this.cleanStaleLocks(this.userDataDir);
    this.screencastActive = false;
    this.latestFrameBase64 = null;
    this.isLaunching = false;
    this.broadcastStatus();
    console.log("[FlowBrowser] Browser stopped cleanly. System resources freed.");
  }

  /**
   * Restarts the browser session cleanly, preserving session cookies
   */
  public async restartSession(): Promise<void> {
    try {
      // Save cookies before terminating
      await this.saveSessionCookies().catch(() => {});

      if (this.cdpSession) {
        try {
          await this.cdpSession.detach();
        } catch (_) {}
        this.cdpSession = null;
      }
      if (this.page) {
        try {
          await this.page.close();
        } catch (_) {}
        this.page = null;
      }
      if (this.browser) {
        try {
          await this.browser.close();
        } catch (_) {}
        this.browser = null;
      }
    } catch (_) {}

    this.cleanStaleLocks(this.userDataDir);
    this.latestFrameBase64 = null;
    await this.ensureBrowserSession();
  }
}

export const flowBrowserService = FlowBrowserService.getInstance();
