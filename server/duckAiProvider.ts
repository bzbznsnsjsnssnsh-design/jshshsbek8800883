import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { AsyncLocalStorage } from "async_hooks";
import puppeteer, { Page, Browser } from "puppeteer";
import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import sharp from "sharp";
import { DUCK_AI_URL } from "../src/types/novelToManga.ts";

// Register stealth plugin for Duck.ai browser instance
puppeteerExtra.use(StealthPlugin());

export { DUCK_AI_URL };

export type DuckPageId =
  | "duck_page_1"
  | "duck_page_2"
  | "duck_page_3"
  | "duck_page_4"
  | "duck_page_5";

export type DuckSessionStatus =
  | "READY"        // جاهزة
  | "GENERATING"   // تعمل
  | "WAITING"      // تنتظر
  | "SAVING"       // تحفظ الصورة
  | "ERROR"        // فشلت
  | "CAPTCHA"      // كابتشا
  | "RATE_LIMITED" // تجاوز الحد
  | "IDLE";        // خاملة

export interface DuckPageSlotDto {
  id: DuckPageId;
  name: string;
  index: number;
  isInitialized: boolean;
  isBusy: boolean;
  status: DuckSessionStatus;
  currentUrl: string;
  pageTitle: string;
  activeTaskId: string | null;
  assignedSceneId: string | null;
  sceneTitle: string | null;
  currentPrompt: string | null;
  lastImageUrl: string | null;
  lastCandidateUrl: string | null;
  lastError: string | null;
  taskStartedAt: number | null;
  taskDurationMs: number | null;
  loadDurationMs: number | null;
  readinessDurationMs: number | null;
  lastUsedAt: string | null;
  completedTasksCount: number;
  failedTasksCount: number;
}

export interface DuckAiTask {
  taskId: string;
  sceneId: string;
  sceneTitle?: string;
  elementId?: string;
  sessionSlotId?: DuckPageId;
  batchNumber?: number;
  batchTotal?: number;
  batchSize?: number;
  prompt: string;
  referenceImages?: string[];
  referencePdfs?: string[];
  timeoutMs?: number;
  status: "WAITING" | "ASSIGNED" | "GENERATING" | "SAVING" | "COMPLETED" | "FAILED" | "CANCELLED";
  assignedSessionId?: DuckPageId;
  imageUrl?: string;
  candidateUrl?: string;
  width?: number;
  height?: number;
  format?: string;
  error?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  retryCount?: number;
  currentUrl?: string;
  pageTitle?: string;
}

export interface DuckAiStatus {
  isReady: boolean;
  currentUrl: string;
  pageTitle: string;
  hasCaptchaChallenge: boolean;
  challengeDetails: string | null;
  isRateLimited: boolean;
  rateLimitMessage: string | null;
  isGenerating: boolean;
  lastError: string | null;
  activePageId: DuckPageId;
  loadDurationMs: number | null;
  readinessDurationMs: number | null;
  checkedAt: string;
  pages?: DuckPageSlotDto[];
}

export interface DuckAiGenerateResult {
  success: boolean;
  localUrl?: string;
  originalUrl?: string;
  candidateUrl?: string;
  sceneId?: string;
  sceneTitle?: string;
  elementId?: string;
  sessionSlotId?: DuckPageId;
  batchNumber?: number;
  taskId?: string;
  prompt?: string;
  width?: number;
  height?: number;
  format?: string;
  error?: string;
  pageId?: DuckPageId;
  currentUrl?: string;
  pageTitle?: string;
  durationMs?: number;
  status:
    | "SUCCESS"
    | "CAPTCHA_REQUIRED"
    | "LIMIT_REACHED"
    | "GENERATION_TIMEOUT"
    | "INVALID_IMAGE"
    | "ERROR";
  challengeDetails?: string;
}

export type GenerateDuckAiImageResult = DuckAiGenerateResult;

export interface GenerateDuckAiImageOptions {
  prompt: string;
  referenceImages?: string[];
  referencePdfs?: string[];
  timeoutMs?: number;
  preferredPageId?: DuckPageId;
  sceneId?: string;
  sceneTitle?: string;
  elementId?: string;
  taskId?: string;
  batchNumber?: number;
}

export interface InternalDuckPageSlot {
  id: DuckPageId;
  name: string;
  index: number;
  page: Page | null;
  isInitialized: boolean;
  isBusy: boolean;
  status: DuckSessionStatus;
  currentUrl: string;
  pageTitle: string;
  activeTaskId: string | null;
  assignedSceneId: string | null;
  sceneTitle: string | null;
  currentPrompt: string | null;
  lastImageUrl: string | null;
  lastCandidateUrl: string | null;
  lastError: string | null;
  taskStartedAt: number | null;
  taskDurationMs: number | null;
  loadDurationMs: number | null;
  readinessDurationMs: number | null;
  lastUsedAt: string | null;
  completedTasksCount: number;
  failedTasksCount: number;
}

export class DuckAiProvider {
  private static instance: DuckAiProvider | null = null;
  public static readonly SITE_URL = DUCK_AI_URL;

  // Dedicated, isolated Chromium browser instance for Duck.ai (100% decoupled from Google Flow)
  private duckBrowser: Browser | null = null;
  private readonly userDataDir: string;
  private isLaunchingBrowser = false;
  private launchPromise: Promise<Browser> | null = null;

  // 5 Real Puppeteer browser pages pool
  private slots: InternalDuckPageSlot[] = [
    {
      id: "duck_page_1",
      name: "جلسة Duck 1",
      index: 0,
      page: null,
      isInitialized: false,
      isBusy: false,
      status: "IDLE",
      currentUrl: "about:blank",
      pageTitle: "",
      activeTaskId: null,
      assignedSceneId: null,
      sceneTitle: null,
      currentPrompt: null,
      lastImageUrl: null,
      lastCandidateUrl: null,
      lastError: null,
      taskStartedAt: null,
      taskDurationMs: null,
      loadDurationMs: null,
      readinessDurationMs: null,
      lastUsedAt: null,
      completedTasksCount: 0,
      failedTasksCount: 0,
    },
    {
      id: "duck_page_2",
      name: "جلسة Duck 2",
      index: 1,
      page: null,
      isInitialized: false,
      isBusy: false,
      status: "IDLE",
      currentUrl: "about:blank",
      pageTitle: "",
      activeTaskId: null,
      assignedSceneId: null,
      sceneTitle: null,
      currentPrompt: null,
      lastImageUrl: null,
      lastCandidateUrl: null,
      lastError: null,
      taskStartedAt: null,
      taskDurationMs: null,
      loadDurationMs: null,
      readinessDurationMs: null,
      lastUsedAt: null,
      completedTasksCount: 0,
      failedTasksCount: 0,
    },
    {
      id: "duck_page_3",
      name: "جلسة Duck 3",
      index: 2,
      page: null,
      isInitialized: false,
      isBusy: false,
      status: "IDLE",
      currentUrl: "about:blank",
      pageTitle: "",
      activeTaskId: null,
      assignedSceneId: null,
      sceneTitle: null,
      currentPrompt: null,
      lastImageUrl: null,
      lastCandidateUrl: null,
      lastError: null,
      taskStartedAt: null,
      taskDurationMs: null,
      loadDurationMs: null,
      readinessDurationMs: null,
      lastUsedAt: null,
      completedTasksCount: 0,
      failedTasksCount: 0,
    },
    {
      id: "duck_page_4",
      name: "جلسة Duck 4",
      index: 3,
      page: null,
      isInitialized: false,
      isBusy: false,
      status: "IDLE",
      currentUrl: "about:blank",
      pageTitle: "",
      activeTaskId: null,
      assignedSceneId: null,
      sceneTitle: null,
      currentPrompt: null,
      lastImageUrl: null,
      lastCandidateUrl: null,
      lastError: null,
      taskStartedAt: null,
      taskDurationMs: null,
      loadDurationMs: null,
      readinessDurationMs: null,
      lastUsedAt: null,
      completedTasksCount: 0,
      failedTasksCount: 0,
    },
    {
      id: "duck_page_5",
      name: "جلسة Duck 5",
      index: 4,
      page: null,
      isInitialized: false,
      isBusy: false,
      status: "IDLE",
      currentUrl: "about:blank",
      pageTitle: "",
      activeTaskId: null,
      assignedSceneId: null,
      sceneTitle: null,
      currentPrompt: null,
      lastImageUrl: null,
      lastCandidateUrl: null,
      lastError: null,
      taskStartedAt: null,
      taskDurationMs: null,
      loadDurationMs: null,
      readinessDurationMs: null,
      lastUsedAt: null,
      completedTasksCount: 0,
      failedTasksCount: 0,
    },
  ];

  private activeSlotId: DuckPageId = "duck_page_1";
  private slotLocks: Map<DuckPageId, Promise<any>> = new Map();
  private lockContext = new AsyncLocalStorage<Set<DuckPageId>>();

  // Task queue & dispatcher state
  private pendingTasks: DuckAiTask[] = [];
  private activeTasks: Map<string, DuckAiTask> = new Map();
  private completedTasks: DuckAiTask[] = [];
  private failedTasks: DuckAiTask[] = [];
  private isDispatcherPaused = false;
  private watchdogTimer: NodeJS.Timeout | null = null;
  private lastDispatchedSlotIndex = -1;
  private queueStateFilePath = path.resolve(process.cwd(), "data/duckai_queue_state.json");

  // DuckAI2API Engine Bridge
  private duckAi2ApiUrl = "http://127.0.0.1:8088";
  private isDuckAi2ApiReady = false;
  private lastHealthCheckTime = 0;

  public static getInstance(): DuckAiProvider {
    if (!DuckAiProvider.instance) {
      DuckAiProvider.instance = new DuckAiProvider();
    }
    return DuckAiProvider.instance;
  }

  private constructor() {
    this.userDataDir = path.resolve(process.cwd(), "data/duckai_chromium_profile");
    if (!fs.existsSync(this.userDataDir)) {
      try {
        fs.mkdirSync(this.userDataDir, { recursive: true });
      } catch (_) {}
    }

    const storageDir = path.resolve(process.cwd(), "public/manga_storage/duck_ai_images");
    if (!fs.existsSync(storageDir)) {
      try {
        fs.mkdirSync(storageDir, { recursive: true });
      } catch (_) {}
    }

    // Restore persistent queue state if exists
    this.loadQueueState();

    // Auto-probe DuckAI2API on startup
    this.ensureDuckAi2ApiAlive().catch(() => {});

    // Start background watchdog for deadlocks and stale tasks (> 70s)
    this.startWatchdog();
  }

  public persistQueueState(): void {
    try {
      const state = {
        pendingTasks: this.pendingTasks,
        completedTasks: this.completedTasks.slice(0, 50),
        failedTasks: this.failedTasks.slice(0, 50),
        isDispatcherPaused: this.isDispatcherPaused,
        updatedAt: Date.now(),
      };
      const dir = path.dirname(this.queueStateFilePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.queueStateFilePath, JSON.stringify(state, null, 2), "utf-8");
    } catch (e: any) {
      console.warn("[DuckAiProvider] Notice persisting queue state:", e?.message);
    }
  }

  private loadQueueState(): void {
    try {
      if (fs.existsSync(this.queueStateFilePath)) {
        const raw = fs.readFileSync(this.queueStateFilePath, "utf-8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.pendingTasks)) {
          this.pendingTasks = parsed.pendingTasks.filter((t: any) => t && t.taskId && t.prompt);
        }
        if (Array.isArray(parsed.completedTasks)) {
          this.completedTasks = parsed.completedTasks.filter((t: any) => t && t.taskId);
        }
        if (Array.isArray(parsed.failedTasks)) {
          this.failedTasks = parsed.failedTasks.filter((t: any) => t && t.taskId);
        }
        if (typeof parsed.isDispatcherPaused === "boolean") {
          this.isDispatcherPaused = parsed.isDispatcherPaused;
        }
        console.log(`[DuckAiProvider] Restored queue state: ${this.pendingTasks.length} pending, ${this.completedTasks.length} completed.`);
      }
    } catch (e: any) {
      console.warn("[DuckAiProvider] Notice loading queue state:", e?.message);
    }
  }

  /**
   * Verifies health of DuckAI2API on port 8088 or starts background service if needed
   */
  public async ensureDuckAi2ApiAlive(): Promise<boolean> {
    const now = Date.now();
    if (this.isDuckAi2ApiReady && now - this.lastHealthCheckTime < 10000) {
      return true;
    }

    try {
      const res = await fetch(`${this.duckAi2ApiUrl}/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        this.isDuckAi2ApiReady = true;
        this.lastHealthCheckTime = now;
        return true;
      }
    } catch (_) {}

    // Try to spawn if not running
    console.log("[DuckAiProvider] Starting DuckAI2API service on port 8088...");
    const pythonExe = path.resolve(process.cwd(), "duckai2api/.venv/bin/python");
    const runScript = path.resolve(process.cwd(), "duckai2api/run.py");
    if (!fs.existsSync(pythonExe)) {
      console.warn("[DuckAiProvider] Python venv not found at:", pythonExe);
      return false;
    }
    try {
      fs.chmodSync(pythonExe, 0o755);
    } catch (_) {}

    try {
      const { spawn } = await import("child_process");
      const proc = spawn(pythonExe, [runScript, "--no-browser", "--port", "8088"], {
        cwd: path.resolve(process.cwd(), "duckai2api"),
        detached: true,
        stdio: "ignore",
      });
      proc.unref();

      const pollStart = Date.now();
      while (Date.now() - pollStart < 12000) {
        await new Promise((r) => setTimeout(r, 800));
        try {
          const res = await fetch(`${this.duckAi2ApiUrl}/health`, { signal: AbortSignal.timeout(1500) });
          if (res.ok) {
            this.isDuckAi2ApiReady = true;
            this.lastHealthCheckTime = Date.now();
            console.log("[DuckAiProvider] DuckAI2API is now online and verified healthy.");
            return true;
          }
        } catch (_) {}
      }
    } catch (spawnErr: any) {
      console.error("[DuckAiProvider] Error spawning DuckAI2API:", spawnErr?.message);
    }
    return false;
  }

  private startWatchdog(): void {
    if (this.watchdogTimer) return;
    this.watchdogTimer = setInterval(() => {
      const now = Date.now();
      for (const slot of this.slots) {
        // Auto-recover if slot was busy for more than 75 seconds
        if (slot.isBusy && slot.taskStartedAt && now - slot.taskStartedAt > 75000) {
          console.warn(`[DuckAiProvider:Watchdog] Auto-releasing stale busy lock on ${slot.name} (exceeded 75s).`);
          const timedOutTaskId = slot.activeTaskId;
          slot.isBusy = false;
          slot.activeTaskId = null;
          slot.taskStartedAt = null;
          slot.status = slot.page && !slot.page.isClosed() && this.duckBrowser?.isConnected() ? "READY" : "IDLE";
          slot.lastError = "انتهت مهلة المهمة تلقائياً وتم تحرير الجلسة.";

          if (timedOutTaskId) {
            const timedOutTask = this.activeTasks.get(timedOutTaskId);
            if (timedOutTask) {
              timedOutTask.status = "FAILED";
              timedOutTask.error = "انتهت مهلة التوليد القصوى (75 ثانية).";
              timedOutTask.completedAt = now;
              this.activeTasks.delete(timedOutTaskId);
              this.failedTasks.unshift(timedOutTask);
            }
          }
        }
      }
      // Attempt to dispatch next pending tasks if ready slots are open
      if (!this.isDispatcherPaused && this.pendingTasks.length > 0) {
        this.dispatchNext();
      }
    }, 4000);

    if (this.watchdogTimer && typeof this.watchdogTimer.unref === "function") {
      this.watchdogTimer.unref();
    }
  }

  public getSiteUrl(): string {
    return DuckAiProvider.SITE_URL;
  }

  public isDuckAiUrl(url: string): boolean {
    if (!url || typeof url !== "string") return false;
    if (url.includes("flow.google.com")) return false;
    try {
      const u = new URL(url);
      const host = u.hostname.toLowerCase();
      return (
        host.endsWith("duck.ai") ||
        host === "duck.ai" ||
        (host.endsWith("duckduckgo.com") && u.pathname.includes("/chat"))
      );
    } catch {
      return (
        (url.includes("duck.ai") || url.includes("duckduckgo.com/chat")) &&
        !url.includes("flow.google.com")
      );
    }
  }

  /**
   * Cleans stale locks on Duck.ai profile
   */
  private cleanStaleLocks(dir: string): void {
    if (!fs.existsSync(dir)) return;
    const lockFiles = ["DevToolsActivePort", "SingletonLock", "SingletonSocket", "SingletonCookie", "lockfile"];
    for (const f of lockFiles) {
      const fullPath = path.join(dir, f);
      try {
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      } catch (_) {}
    }
  }

  /**
   * Launches or returns the dedicated Duck.ai Chromium browser
   */
  public async ensureDuckBrowser(): Promise<Browser> {
    if (this.duckBrowser && this.duckBrowser.isConnected()) {
      return this.duckBrowser;
    }

    if (this.launchPromise) {
      return this.launchPromise;
    }

    this.launchPromise = (async () => {
      this.isLaunchingBrowser = true;
      try {
        this.cleanStaleLocks(this.userDataDir);

        let executablePath: string | undefined;
        const candidatePaths = [
          process.env.PUPPETEER_EXECUTABLE_PATH,
          "/usr/bin/google-chrome-stable",
          "/usr/bin/google-chrome",
          "/usr/bin/chromium-browser",
          "/usr/bin/chromium",
        ].filter(Boolean) as string[];

        for (const p of candidatePaths) {
          if (fs.existsSync(p)) {
            executablePath = p;
            break;
          }
        }
        if (!executablePath) {
          executablePath = puppeteer.executablePath();
        }

        console.log(`[DuckAiProvider] Launching dedicated Chromium from ${executablePath} with profile: ${this.userDataDir}...`);

        const cacheDir = "/tmp/duckai_chromium_cache";
        if (!fs.existsSync(cacheDir)) {
          try {
            fs.mkdirSync(cacheDir, { recursive: true });
          } catch (_) {}
        }

        this.duckBrowser = await (puppeteerExtra as any).launch({
          executablePath,
          userDataDir: this.userDataDir,
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
            "--window-size=1280,800",
            "--disable-features=Translate,OptimizationHints,MediaRouter,CalculateNativeWinOcclusion",
            "--disable-breakpad",
            "--disable-hang-monitor",
            "--mute-audio",
            "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding",
            "--lang=en-US,en,ar",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-default-apps",
            "--disable-sync",
          ],
          defaultViewport: {
            width: 1280,
            height: 800,
            deviceScaleFactor: 1,
          },
          ignoreDefaultArgs: ["--enable-automation"],
        });

        this.duckBrowser!.on("disconnected", () => {
          console.warn("[DuckAiProvider:BrowserDisconnected] Dedicated Duck.ai Chromium disconnected.");
          this.duckBrowser = null;
          for (const s of this.slots) {
            s.page = null;
            s.isInitialized = false;
            s.isBusy = false;
            s.status = "IDLE";
          }
        });

        console.log("[DuckAiProvider] Dedicated Duck.ai Chromium launched successfully.");
        return this.duckBrowser!;
      } finally {
        this.isLaunchingBrowser = false;
        this.launchPromise = null;
      }
    })();

    return this.launchPromise;
  }

  /**
   * Initializes or returns a live Page instance for a slot
   */
  public async ensureSlotPage(slot: InternalDuckPageSlot): Promise<Page> {
    const browser = await this.ensureDuckBrowser();

    if (slot.page && !slot.page.isClosed()) {
      try {
        await slot.page.evaluate(() => 1);
        return slot.page;
      } catch (_) {
        slot.page = null;
        slot.isInitialized = false;
        slot.status = "IDLE";
      }
    }

    const pages = await browser.pages();
    const usedPages = new Set(
      this.slots
        .filter((s) => s.id !== slot.id && s.page && !s.page.isClosed())
        .map((s) => s.page!)
    );

    const available = pages.find((p) => !p.isClosed() && !usedPages.has(p));
    if (available && slot.index === 0) {
      slot.page = available;
    } else {
      console.log(`[DuckAiProvider] Creating new tab for ${slot.name}...`);
      slot.page = await browser.newPage();
    }

    await this.configurePage(slot.page, slot);
    this.attachDiagnosticListeners(slot, slot.page);

    slot.isInitialized = true;
    slot.currentUrl = slot.page.url();
    slot.pageTitle = await slot.page.title().catch(() => "");

    slot.page.on("close", () => {
      console.warn(`[DuckAiProvider:${slot.name}] Page closed event received.`);
      slot.page = null;
      slot.isInitialized = false;
      slot.status = "IDLE";
      slot.isBusy = false;
      slot.currentUrl = "about:blank";
      slot.pageTitle = "";
    });

    return slot.page;
  }

  private async configurePage(page: Page, slot: InternalDuckPageSlot): Promise<void> {
    try {
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
      );
    } catch (_) {}
    try {
      await page.setViewport({ width: 1280, height: 800 });
    } catch (_) {}
    try {
      await page.evaluateOnNewDocument(`
        window.__name = function(target) { return target; };
        globalThis.__name = function(target) { return target; };
        try {
          Object.defineProperty(navigator, "webdriver", { get: function() { return undefined; }, configurable: true });
        } catch(_) {}
      `);
    } catch (_) {}
  }

  private attachDiagnosticListeners(slot: InternalDuckPageSlot, targetPage?: Page): void {
    const page: any = targetPage || slot.page;
    if (!page || page.isClosed()) return;
    if (page.__duckDiagnosticAttached) return;
    page.__duckDiagnosticAttached = true;

    page.on("pageerror", (err: any) => {
      const msg = err?.message || String(err);
      console.warn(`[DuckAiProvider:${slot.name}:PAGE_ERROR] ${msg}`);
      slot.lastError = `JS Error: ${msg}`;
    });

    page.on("response", async (res: any) => {
      const status = res.status();
      const url = res.url();
      if (status === 418 || status === 429) {
        console.warn(`[DuckAiProvider:${slot.name}] Rate limit response detected (${status}) on ${url}`);
        slot.status = "RATE_LIMITED";
        slot.lastError = `تم بلوغ حد الاستخدام في Duck.ai (HTTP ${status} / ERR_BN_LIMIT).`;
      }
    });
  }

  /**
   * Serializes tasks on the same slot
   */
  public async runWithSlotLock<T>(pageId: DuckPageId, fn: () => Promise<T>): Promise<T> {
    const activeLocks = this.lockContext.getStore();
    if (activeLocks && activeLocks.has(pageId)) {
      return await fn();
    }

    const currentLock = this.slotLocks.get(pageId) || Promise.resolve();
    let releaseLock: () => void;
    const newLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    this.slotLocks.set(
      pageId,
      currentLock.then(
        () => newLock,
        () => newLock
      )
    );

    await currentLock.catch(() => {});
    const nextLocks = new Set(activeLocks || []);
    nextLocks.add(pageId);

    return this.lockContext.run(nextLocks, async () => {
      try {
        return await fn();
      } finally {
        releaseLock!();
      }
    });
  }

  /**
   * Fast, reliable DOM readiness probe
   */
  public async checkDomReadiness(page: Page): Promise<{
    isReady: boolean;
    isLoaderActive: boolean;
    hasTextarea: boolean;
    hasButtons: boolean;
    hasChallenge: boolean;
    challengeDetails: string | null;
    isRateLimited: boolean;
    rateLimitMessage: string | null;
    hasError: boolean;
    errorMessage: string | null;
    isGenerating: boolean;
  }> {
    if (!this.duckBrowser || !this.duckBrowser.isConnected() || page.isClosed()) {
      return {
        isReady: false,
        isLoaderActive: false,
        hasTextarea: false,
        hasButtons: false,
        hasChallenge: false,
        challengeDetails: null,
        isRateLimited: false,
        rateLimitMessage: null,
        hasError: true,
        errorMessage: "جلسة المتصفح غير متصلة.",
        isGenerating: false,
      };
    }

    try {
      const domData = await page.evaluate(() => {
        const appLoader = document.getElementById("app-loader");
        let isLoaderActive = false;
        if (appLoader) {
          const style = window.getComputedStyle(appLoader);
          const rect = appLoader.getBoundingClientRect();
          isLoaderActive =
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            parseFloat(style.opacity || "1") > 0.05 &&
            rect.width > 0 &&
            rect.height > 0;
        }

        const appContainer = document.getElementById("app");
        const hasApp = Boolean(appContainer);

        const bodyText = (document.body ? document.body.innerText : "").toLowerCase();
        const hasChallenge =
          bodyText.includes("challenge") ||
          bodyText.includes("select all squares containing") ||
          bodyText.includes("bots use duckduckgo too") ||
          bodyText.includes("human verification");

        const hasRateLimit =
          bodyText.includes("usage limit") ||
          bodyText.includes("limit reached") ||
          bodyText.includes("too many requests") ||
          bodyText.includes("quota limits exceeded") ||
          bodyText.includes("err_bn_limit");

        const textareas = Array.from(
          document.querySelectorAll("textarea, [contenteditable='true']")
        );
        let hasActiveInput = false;
        for (const ta of textareas) {
          const style = window.getComputedStyle(ta);
          const rect = ta.getBoundingClientRect();
          if (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            parseFloat(style.opacity || "1") > 0.1 &&
            rect.width > 20 &&
            rect.height > 15
          ) {
            hasActiveInput = true;
            break;
          }
        }

        const buttons = Array.from(document.querySelectorAll("button"));
        let visibleButtons = 0;
        for (const btn of buttons) {
          const style = window.getComputedStyle(btn);
          const rect = btn.getBoundingClientRect();
          if (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            parseFloat(style.opacity || "1") > 0.1 &&
            rect.width > 10 &&
            rect.height > 10
          ) {
            visibleButtons++;
          }
        }

        const stopBtn = document.querySelector("button[aria-label='Stop generating']") as HTMLElement;
        const isGenerating = stopBtn
          ? window.getComputedStyle(stopBtn).display !== "none" &&
            window.getComputedStyle(stopBtn).visibility !== "hidden"
          : false;

        const isReady =
          hasApp &&
          !isLoaderActive &&
          hasActiveInput &&
          visibleButtons >= 2 &&
          !hasChallenge &&
          !hasRateLimit;

        return {
          isReady,
          isLoaderActive,
          hasTextarea: hasActiveInput,
          hasButtons: visibleButtons >= 2,
          hasChallenge,
          isRateLimited: hasRateLimit,
          isGenerating,
        };
      });

      return {
        isReady: domData.isReady,
        isLoaderActive: domData.isLoaderActive,
        hasTextarea: domData.hasTextarea,
        hasButtons: domData.hasButtons,
        hasChallenge: domData.hasChallenge,
        challengeDetails: domData.hasChallenge ? "تحدي التحقق البشري من DuckDuckGo نشط." : null,
        isRateLimited: domData.isRateLimited,
        rateLimitMessage: domData.isRateLimited ? "تم بلوغ حد الاستخدام في Duck.ai." : null,
        hasError: false,
        errorMessage: null,
        isGenerating: domData.isGenerating,
      };
    } catch (err: any) {
      return {
        isReady: false,
        isLoaderActive: false,
        hasTextarea: false,
        hasButtons: false,
        hasChallenge: false,
        challengeDetails: null,
        isRateLimited: false,
        rateLimitMessage: null,
        hasError: true,
        errorMessage: err?.message || String(err),
        isGenerating: false,
      };
    }
  }

  /**
   * Waits for DOM readiness with active timeout
   */
  public async waitForTrueReadiness(
    page: Page,
    timeoutMs: number = 15000
  ): Promise<{ isReady: boolean; hasChallenge: boolean; isRateLimited: boolean; lastError: string | null }> {
    const start = Date.now();
    let lastErr: string | null = null;

    while (Date.now() - start < timeoutMs) {
      const probe = await this.checkDomReadiness(page);
      if (probe.hasChallenge) {
        return { isReady: false, hasChallenge: true, isRateLimited: false, lastError: probe.challengeDetails };
      }
      if (probe.isRateLimited) {
        return { isReady: false, hasChallenge: false, isRateLimited: true, lastError: probe.rateLimitMessage };
      }
      if (probe.isReady) {
        return { isReady: true, hasChallenge: false, isRateLimited: false, lastError: null };
      }
      lastErr = probe.errorMessage || (probe.isLoaderActive ? "Loader active" : "Waiting for textarea");
      await new Promise((r) => setTimeout(r, 600));
    }

    return { isReady: false, hasChallenge: false, isRateLimited: false, lastError: lastErr || "READINESS_TIMEOUT" };
  }

  /**
   * Prepares a slot for work, navigating to Duck.ai if not already there
   */
  public async ensurePageReady(slot: InternalDuckPageSlot, forceNavigate: boolean = false): Promise<DuckAiStatus> {
    return this.runWithSlotLock(slot.id, async () => {
      slot.status = "LOADING";
      const start = Date.now();

      try {
        const page = await this.ensureSlotPage(slot);
        await page.bringToFront().catch(() => {});
        const curUrl = page.url();
        const onSite = this.isDuckAiUrl(curUrl);

        if (onSite && !forceNavigate) {
          const quickProbe = await this.checkDomReadiness(page);
          if (quickProbe.isReady) {
            slot.status = "READY";
            slot.currentUrl = curUrl;
            slot.pageTitle = await page.title().catch(() => "");
            slot.lastError = null;
            slot.readinessDurationMs = Date.now() - start;
            return this.checkStatus(page);
          }
          const waitRes = await this.waitForTrueReadiness(page, 7000);
          if (waitRes.isReady) {
            slot.status = "READY";
            slot.currentUrl = page.url();
            slot.pageTitle = await page.title().catch(() => "");
            slot.lastError = null;
            slot.readinessDurationMs = Date.now() - start;
            return this.checkStatus(page);
          }
        }

        console.log(`[DuckAiProvider:${slot.name}] Navigating to ${DuckAiProvider.SITE_URL}...`);
        const navStart = Date.now();
        await page.goto(DuckAiProvider.SITE_URL, { waitUntil: "domcontentloaded", timeout: 20000 });
        slot.loadDurationMs = Date.now() - navStart;

        const readyState = await this.waitForTrueReadiness(page, 15000);
        slot.readinessDurationMs = Date.now() - start;
        slot.currentUrl = page.url();
        slot.pageTitle = await page.title().catch(() => "");
        slot.lastUsedAt = new Date().toISOString();

        if (readyState.hasChallenge) {
          slot.status = "CAPTCHA";
          slot.lastError = readyState.lastError;
        } else if (readyState.isRateLimited) {
          slot.status = "RATE_LIMITED";
          slot.lastError = readyState.lastError;
        } else if (readyState.isReady) {
          slot.status = "READY";
          slot.lastError = null;
          console.log(`[DuckAiProvider] ${slot.name} is READY in ${slot.readinessDurationMs}ms.`);
        } else {
          slot.status = "ERROR";
          slot.lastError = readyState.lastError || "DUCK_AI_READINESS_TIMEOUT";
        }

        return this.checkStatus(page);
      } catch (err: any) {
        slot.status = "ERROR";
        slot.lastError = err?.message || String(err);
        return this.checkStatus(slot.page || undefined);
      }
    });
  }

  /**
   * Fast, in-page conversation reset
   */
  public async resetPageConversation(pageId?: DuckPageId): Promise<{ success: boolean; message: string }> {
    const targetSlot = pageId ? this.slots.find((s) => s.id === pageId) : this.getActiveSlot();
    if (!targetSlot) {
      return { success: false, message: "الجلسة غير موجودة." };
    }

    if (targetSlot.activeTaskId) {
      this.activeTasks.delete(targetSlot.activeTaskId);
    }
    targetSlot.isBusy = false;
    targetSlot.activeTaskId = null;
    targetSlot.taskStartedAt = null;
    targetSlot.status = "READY";
    targetSlot.lastError = null;

    setImmediate(() => this.dispatchNext());
    return { success: true, message: `✓ تم تصفير حالة جلسة ${targetSlot.name} وإعادتها لحالة الاستعداد.` };
  }

  /**
   * Probes or prepares an individual slot directly
   */
  public async probeSlot(pageId: DuckPageId): Promise<DuckAiStatus> {
    const slot = this.slots.find((s) => s.id === pageId);
    if (!slot) {
      throw new Error(`الجلسة غير موجودة: ${pageId}`);
    }
    const isAlive = await this.ensureDuckAi2ApiAlive();
    slot.isInitialized = isAlive;
    slot.isBusy = false;
    slot.status = isAlive ? "READY" : "ERROR";
    slot.lastError = isAlive ? null : "تعذر الاتصال بخدمة DuckAI2API";
    slot.currentUrl = "https://duck.ai";
    slot.pageTitle = isAlive ? `Duck.ai - ${slot.name} (جاهزة)` : "Duck.ai - غير متصل";
    return {
      isReady: isAlive,
      currentUrl: slot.currentUrl,
      pageTitle: slot.pageTitle,
      hasCaptchaChallenge: false,
      challengeDetails: null,
      isRateLimited: false,
      rateLimitMessage: null,
      isGenerating: false,
      lastError: slot.lastError,
      activePageId: slot.id,
      loadDurationMs: 0,
      readinessDurationMs: 0,
      checkedAt: new Date().toISOString(),
      pages: this.getPagesStatus(),
    };
  }

  /**
   * Activates "New Image" generation mode if available
   */
  private async activateNewImageMode(page: Page): Promise<boolean> {
    try {
      return await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll("button, div[role='button']"));
        for (const b of btns) {
          const txt = (b.innerText || "").trim().toLowerCase();
          const aria = (b.getAttribute("aria-label") || "").toLowerCase();
          if (
            txt === "create image" ||
            txt === "new image" ||
            aria.includes("create image") ||
            aria.includes("new image")
          ) {
            (b as HTMLElement).click();
            return true;
          }
        }
        return false;
      });
    } catch (_) {
      return false;
    }
  }

  /**
   * Attaches reference image files to the Duck.ai conversation input
   */
  private async attachReferenceFiles(page: Page, filePaths: string[]): Promise<boolean> {
    if (!filePaths || filePaths.length === 0) return false;
    try {
      const validFiles = filePaths
        .map((fp) => (fp.startsWith("/") ? path.resolve(process.cwd(), `public${fp}`) : fp))
        .filter((fp) => fs.existsSync(fp));

      if (validFiles.length === 0) return false;

      const fileInput = await page.$("input[type='file']");
      if (fileInput) {
        await fileInput.uploadFile(...validFiles);
        await new Promise((r) => setTimeout(r, 800));
        return true;
      }
      return false;
    } catch (err) {
      console.warn("[DuckAiProvider] Error attaching reference files:", err);
      return false;
    }
  }

  /**
   * Generates a single image on a slot with strict visual validation and scene linking
   */
  public async generateImage(options: GenerateDuckAiImageOptions): Promise<DuckAiGenerateResult> {
    const {
      prompt,
      referenceImages = [],
      referencePdfs = [],
      timeoutMs = 55000,
      preferredPageId,
      sceneId,
      sceneTitle,
    } = options;

    const currentTaskId = options.taskId || `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const genStartTime = Date.now();

    const trimmedPrompt = (prompt || "").trim();
    if (!trimmedPrompt) {
      return {
        success: false,
        status: "ERROR",
        taskId: currentTaskId,
        sceneId,
        error: "لا يمكن إرسال طلب توليد صورة فارغ. يرجى كتابة وصف صالح أولاً.",
      };
    }

    // 1. Pick slot: preferred or first ready/idle slot
    let targetSlot = preferredPageId
      ? this.slots.find((s) => s.id === preferredPageId)
      : this.slots.find((s) => s.status === "READY" && !s.isBusy) ||
        this.slots.find((s) => !s.isBusy && s.status !== "CAPTCHA" && s.status !== "RATE_LIMITED") ||
        this.getActiveSlot();

    if (!targetSlot) {
      targetSlot = this.getActiveSlot();
    }

    // Mutex guard: reject if slot is currently busy
    if (targetSlot.isBusy && targetSlot.taskStartedAt && Date.now() - targetSlot.taskStartedAt > 70000) {
      console.warn(`[DuckAiProvider] Auto-releasing stale busy lock on ${targetSlot.name}.`);
      targetSlot.isBusy = false;
      targetSlot.activeTaskId = null;
      targetSlot.taskStartedAt = null;
    }

    if (targetSlot.isBusy && targetSlot.activeTaskId !== currentTaskId) {
      return {
        success: false,
        status: "ERROR",
        pageId: targetSlot.id,
        taskId: currentTaskId,
        sceneId,
        error: `الجلسة ${targetSlot.name} مشغولة حالياً بمهمة أخرى (${targetSlot.activeTaskId}).`,
      };
    }

    return this.runWithSlotLock(targetSlot.id, async () => {
      targetSlot.isBusy = true;
      targetSlot.activeTaskId = currentTaskId;
      targetSlot.assignedSceneId = sceneId || null;
      targetSlot.sceneTitle = sceneTitle || sceneId || null;
      targetSlot.currentPrompt = prompt;
      targetSlot.taskStartedAt = Date.now();
      targetSlot.status = "LOADING";
      targetSlot.currentUrl = "https://duck.ai";
      targetSlot.pageTitle = `Duck.ai - ${targetSlot.name}`;

      try {
        const isAlive = await this.ensureDuckAi2ApiAlive();
        if (!isAlive) {
          targetSlot.status = "ERROR";
          targetSlot.lastError = "تعذر الاتصال بخدمة DuckAI2API (Port 8088).";
          return {
            success: false,
            status: "ERROR",
            pageId: targetSlot.id,
            taskId: currentTaskId,
            sceneId,
            error: targetSlot.lastError,
          };
        }

        targetSlot.status = "GENERATING";
        console.log(`[DuckAiProvider] Generating image on ${targetSlot.name} via DuckAI2API... Prompt: "${prompt.slice(0, 70)}..."`);

        const apiRes = await fetch(`${this.duckAi2ApiUrl}/v1/images/generations`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-5.6-luna",
            prompt,
            n: 1,
            response_format: "b64_json",
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (!apiRes.ok) {
          const errText = await apiRes.text().catch(() => "");
          if (apiRes.status === 429 || errText.includes("ERR_BN_LIMIT") || errText.includes("rate limit")) {
            targetSlot.status = "RATE_LIMITED";
            targetSlot.lastError = `تم بلوغ الحد المسموح للاستخدام في Duck.ai (HTTP ${apiRes.status}).`;
            return {
              success: false,
              status: "LIMIT_REACHED",
              pageId: targetSlot.id,
              taskId: currentTaskId,
              sceneId,
              error: targetSlot.lastError,
            };
          }
          if (errText.includes("ERR_CHALLENGE") || errText.includes("challenge")) {
            targetSlot.status = "CAPTCHA";
            targetSlot.lastError = "طلب Duck.ai تحدي التحقق البشري (CAPTCHA).";
            return {
              success: false,
              status: "CAPTCHA_REQUIRED",
              pageId: targetSlot.id,
              taskId: currentTaskId,
              sceneId,
              error: targetSlot.lastError,
            };
          }
          throw new Error(`خطأ DuckAI2API (HTTP ${apiRes.status}): ${errText}`);
        }

        const json = await apiRes.json();
        const entry = json.data?.[0];
        if (!entry || !entry.b64_json) {
          throw new Error("لم تُرجع خدمة DuckAI2API أي بيانات صورة في الاستجابة.");
        }

        targetSlot.status = "SAVING";
        const imageBuffer = Buffer.from(entry.b64_json, "base64");

        // Strict Sharp Image Validation
        const metadata = await sharp(imageBuffer).metadata();
        const stats = await sharp(imageBuffer).stats();
        const channelStdDevs = stats.channels.map((c) => c.stdev);

        if (!metadata.width || !metadata.height || metadata.width < 200 || metadata.height < 200) {
          targetSlot.status = "READY";
          return {
            success: false,
            status: "INVALID_IMAGE",
            pageId: targetSlot.id,
            taskId: currentTaskId,
            sceneId,
            error: `أبعاد الصورة المولدة غير صالحة (${metadata.width}x${metadata.height}).`,
          };
        }

        if (channelStdDevs.every((s) => s < 2)) {
          targetSlot.status = "READY";
          return {
            success: false,
            status: "INVALID_IMAGE",
            pageId: targetSlot.id,
            taskId: currentTaskId,
            sceneId,
            error: "الملف الناتج عبارة عن صورة مصمتة بلون واحد (Solid Blank Image).",
          };
        }

        // Save generated image to storage
        const filename = `duckai_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.jpg`;
        const filePath = path.resolve(process.cwd(), "public/manga_storage/duck_ai_images", filename);
        fs.writeFileSync(filePath, imageBuffer);
        const localUrl = `/manga_storage/duck_ai_images/${filename}`;

        // Link candidate to scene directory
        let linkedSceneUrl: string | undefined = undefined;
        if (sceneId) {
          try {
            const sceneStorageDir = path.resolve(process.cwd(), `public/manga_storage/scenes/${sceneId}/candidates`);
            if (!fs.existsSync(sceneStorageDir)) {
              fs.mkdirSync(sceneStorageDir, { recursive: true });
            }
            const destName = `${sceneId}_cand_${Date.now()}.jpg`;
            const destPath = path.join(sceneStorageDir, destName);
            fs.copyFileSync(filePath, destPath);
            linkedSceneUrl = `/manga_storage/scenes/${sceneId}/candidates/${destName}`;
            console.log(`[DuckAiProvider] Successfully linked candidate to scene ${sceneId}: ${linkedSceneUrl}`);
          } catch (linkErr: any) {
            console.warn("[DuckAiProvider] Notice linking candidate to scene:", linkErr?.message);
          }
        }

        // Link candidate to element directory if applicable
        let linkedElementUrl: string | undefined = undefined;
        if (options.elementId) {
          try {
            const elDir = path.resolve(process.cwd(), "public/generated/novel-to-manga");
            if (!fs.existsSync(elDir)) {
              fs.mkdirSync(elDir, { recursive: true });
            }
            const elName = `${options.elementId}_duckai_${Date.now()}.jpg`;
            fs.copyFileSync(filePath, path.join(elDir, elName));
            linkedElementUrl = `/generated/novel-to-manga/${elName}`;
          } catch (elErr: any) {
            console.warn("[DuckAiProvider] Notice linking candidate to element:", elErr?.message);
          }
        }

        const totalDuration = Date.now() - genStartTime;
        targetSlot.status = "READY";
        targetSlot.lastError = null;
        targetSlot.lastUsedAt = new Date().toISOString();
        targetSlot.lastImageUrl = localUrl;
        targetSlot.lastCandidateUrl = linkedSceneUrl || linkedElementUrl || localUrl;
        targetSlot.taskDurationMs = totalDuration;
        targetSlot.completedTasksCount++;

        return {
          success: true,
          status: "SUCCESS",
          pageId: targetSlot.id,
          sessionSlotId: targetSlot.id,
          taskId: currentTaskId,
          sceneId,
          sceneTitle: options.sceneTitle || sceneId,
          elementId: options.elementId,
          batchNumber: options.batchNumber,
          prompt,
          currentUrl: targetSlot.currentUrl || "https://duck.ai",
          pageTitle: targetSlot.pageTitle || `Duck.ai - ${targetSlot.name}`,
          candidateUrl: linkedSceneUrl || linkedElementUrl || localUrl,
          durationMs: totalDuration,
          localUrl,
          width: metadata.width,
          height: metadata.height,
          format: metadata.format || "jpeg",
        };
      } catch (err: any) {
        targetSlot.status = "ERROR";
        targetSlot.lastError = err?.message || String(err);
        targetSlot.failedTasksCount++;
        return {
          success: false,
          status: "ERROR",
          pageId: targetSlot.id,
          sessionSlotId: targetSlot.id,
          taskId: currentTaskId,
          sceneId,
          sceneTitle: options.sceneTitle,
          elementId: options.elementId,
          batchNumber: options.batchNumber,
          prompt,
          currentUrl: targetSlot.currentUrl || "https://duck.ai",
          pageTitle: targetSlot.pageTitle || `Duck.ai - ${targetSlot.name}`,
          error: err?.message || String(err),
        };
      } finally {
        targetSlot.isBusy = false;
        targetSlot.activeTaskId = null;
        targetSlot.taskStartedAt = null;
        if (targetSlot.status === "GENERATING" || targetSlot.status === "SAVING" || targetSlot.status === "LOADING") {
          targetSlot.status = "READY";
        }
        setImmediate(() => this.dispatchNext());
      }
    });
  }

  /**
   * Downloads image data and strictly verifies image format with Sharp,
   * rejecting monochromatic/blank images via channel standard deviation
   */
  public async downloadAndValidateImage(
    imageUrl: string,
    page: Page
  ): Promise<{
    success: boolean;
    localUrl?: string;
    width?: number;
    height?: number;
    format?: string;
    error?: string;
  }> {
    const storageDir = path.resolve(process.cwd(), "public/manga_storage/duck_ai_images");
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }

    let buffer: Buffer | null = null;

    if (imageUrl.startsWith("data:image/")) {
      const base64Data = imageUrl.replace(/^data:image\/\w+;base64,/, "");
      buffer = Buffer.from(base64Data, "base64");
    } else if (imageUrl.startsWith("blob:") || imageUrl.startsWith("http")) {
      try {
        const base64FromBrowser = await Promise.race([
          page.evaluate(async (url: string) => {
            const resp = await fetch(url);
            const blob = await resp.blob();
            return new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
          }, imageUrl),
          new Promise<null>((_, reject) => setTimeout(() => reject(new Error("Timeout downloading blob")), 12000)),
        ]);

        if (base64FromBrowser && base64FromBrowser.startsWith("data:image/")) {
          const raw = base64FromBrowser.replace(/^data:image\/\w+;base64,/, "");
          buffer = Buffer.from(raw, "base64");
        }
      } catch (_) {
        try {
          const res = await fetch(imageUrl, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            },
          });
          const ab = await res.arrayBuffer();
          buffer = Buffer.from(ab);
        } catch (_) {}
      }
    }

    if (!buffer || buffer.length < 2000) {
      return { success: false, error: "تعذر تنزيل بايتات ملف الصورة أو الحجم أصغر من الحد الأدنى المقبول (2KB)." };
    }

    // Verify buffer is not an HTML error page or JSON error response
    const headerSnippet = buffer.subarray(0, 80).toString("utf8").toLowerCase();
    if (
      headerSnippet.includes("<html") ||
      headerSnippet.includes("<!doctype") ||
      (!headerSnippet.includes("<svg") && headerSnippet.includes("{\"error\""))
    ) {
      return {
        success: false,
        error: "البيانات المستلمة تمثل صفحة HTML أو رسالة خطأ وليست ملف صورة صالحاً.",
      };
    }

    try {
      const sharpInstance = sharp(buffer);
      const metadata = await sharpInstance.metadata();
      if (!metadata.format || !metadata.width || !metadata.height || metadata.width <= 0 || metadata.height <= 0) {
        return {
          success: false,
          error: "الملف ليس صورة صالحة (لا يحتوي على أبعاد موجبة أو صيغة صورة معروفة).",
        };
      }

      // Requirement 7: Reject homogeneous / blank images by analyzing channel standard deviation
      const stats = await sharpInstance.stats();
      const stdevSum = stats.channels.reduce((sum, ch) => sum + ch.stdev, 0);
      const isBlankMonochromatic = stats.channels.every((ch) => ch.stdev < 1.0) || stdevSum < 2.5;

      if (isBlankMonochromatic) {
        console.warn(`[DuckAiProvider] REJECTED homogeneous blank image: stdevSum=${stdevSum}`);
        return {
          success: false,
          error: "تم رفض الصورة لأنها مصمتة أو فارغة بصرياً بدون تفاصيل (Homogeneous / Blank Image).",
        };
      }

      const ext = metadata.format === "jpeg" ? "jpg" : metadata.format;
      const filename = `duckai_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`;
      const destPath = path.join(storageDir, filename);

      fs.writeFileSync(destPath, buffer);

      console.log(
        `[DuckAiProvider:ImageValidated] File: ${filename}, Format: ${metadata.format}, Dimensions: ${metadata.width}x${metadata.height}, Size: ${buffer.length} bytes, stdevSum: ${stdevSum.toFixed(2)}.`
      );

      return {
        success: true,
        localUrl: `/manga_storage/duck_ai_images/${filename}`,
        width: metadata.width,
        height: metadata.height,
        format: metadata.format,
      };
    } catch (sharpErr: any) {
      return {
        success: false,
        error: `فشل التحقق من سلامة ملف الصورة عبر Sharp: ${sharpErr.message}`,
      };
    }
  }

  // ==========================================================================
  // DISPATCHER & MULTI-SESSION QUEUE ENGINE
  // ==========================================================================

  /**
   * Dispatches tasks to available ready slots up to 5 concurrent sessions
   */
  public dispatchNext(): void {
    if (this.isDispatcherPaused) return;
    if (this.pendingTasks.length === 0) return;

    // Safe concurrency limit: 1 generation active at a time to prevent Duck.ai IP rate limits / bans
    if (this.activeTasks.size >= 1) return;

    // Find slots that are READY or IDLE and NOT busy via rotating round-robin
    let slot: InternalDuckPageSlot | undefined;
    for (let i = 1; i <= this.slots.length; i++) {
      const candidateIndex = (this.lastDispatchedSlotIndex + i) % this.slots.length;
      const cand = this.slots[candidateIndex];
      if ((cand.status === "READY" || cand.status === "IDLE") && !cand.isBusy) {
        slot = cand;
        this.lastDispatchedSlotIndex = candidateIndex;
        break;
      }
    }
    if (!slot) return;
    const task = this.pendingTasks.shift()!;
    task.status = "ASSIGNED";
    task.assignedSessionId = slot.id;
    task.sessionSlotId = slot.id;
    task.currentUrl = slot.currentUrl || "https://duck.ai";
    task.pageTitle = slot.pageTitle || `Duck.ai - ${slot.name}`;
    task.startedAt = Date.now();
    this.activeTasks.set(task.taskId, task);

    console.log(`[DuckAiDispatcher] Dispatching task ${task.taskId} (Scene ${task.sceneId}, Batch ${task.batchNumber || 1}) to ${slot.name}...`);

    (async () => {
      try {
        const genRes = await this.generateImage({
          prompt: task.prompt,
          referenceImages: task.referenceImages,
          referencePdfs: task.referencePdfs,
          timeoutMs: task.timeoutMs || 65000,
          preferredPageId: slot.id,
          sceneId: task.sceneId,
          sceneTitle: task.sceneTitle,
          elementId: task.elementId,
          taskId: task.taskId,
          batchNumber: task.batchNumber,
        });

        task.completedAt = Date.now();
        task.sessionSlotId = slot.id;
        task.currentUrl = genRes.currentUrl || slot.currentUrl || "https://duck.ai";
        task.pageTitle = genRes.pageTitle || slot.pageTitle || `Duck.ai - ${slot.name}`;
        this.activeTasks.delete(task.taskId);

        if (genRes.success && genRes.localUrl) {
          task.status = "COMPLETED";
          task.imageUrl = genRes.localUrl;
          task.candidateUrl = genRes.candidateUrl || genRes.localUrl;
          task.width = genRes.width;
          task.height = genRes.height;
          task.format = genRes.format;

          // Automatically link into Scene candidates directory
          if (task.sceneId) {
            try {
              const sceneStorageDir = path.resolve(process.cwd(), `public/manga_storage/scenes/${task.sceneId}/candidates`);
              if (!fs.existsSync(sceneStorageDir)) {
                fs.mkdirSync(sceneStorageDir, { recursive: true });
              }
              const sourcePath = path.resolve(process.cwd(), `public${genRes.localUrl}`);
              if (fs.existsSync(sourcePath)) {
                const destName = `${task.sceneId}_cand_${Date.now()}.jpg`;
                const destPath = path.join(sceneStorageDir, destName);
                fs.copyFileSync(sourcePath, destPath);
                task.sceneCandidateUrl = `/manga_storage/scenes/${task.sceneId}/candidates/${destName}`;
                task.candidateUrl = task.sceneCandidateUrl;
              }
            } catch (linkErr: any) {
              console.warn("[DuckAiDispatcher] Notice linking candidate to scene:", linkErr?.message);
            }
          }

          // Automatically link into Element reference directory
          if (task.elementId) {
            try {
              const elemStorageDir = path.resolve(process.cwd(), `public/manga_storage/elements/${task.elementId}`);
              if (!fs.existsSync(elemStorageDir)) {
                fs.mkdirSync(elemStorageDir, { recursive: true });
              }
              const sourcePath = path.resolve(process.cwd(), `public${genRes.localUrl}`);
              if (fs.existsSync(sourcePath)) {
                const destName = `${task.elementId}_ref_${Date.now()}.jpg`;
                const destPath = path.join(elemStorageDir, destName);
                fs.copyFileSync(sourcePath, destPath);
                task.candidateUrl = `/manga_storage/elements/${task.elementId}/${destName}`;
              }
            } catch (linkErr: any) {
              console.warn("[DuckAiDispatcher] Notice linking candidate to element:", linkErr?.message);
            }
          }

          this.completedTasks.unshift(task);
          if (this.completedTasks.length > 100) this.completedTasks.pop();
        } else {
          task.status = "FAILED";
          task.error = genRes.error || "فشل توليد الصورة.";
          this.failedTasks.unshift(task);
          if (this.failedTasks.length > 100) this.failedTasks.pop();
        }
      } catch (err: any) {
        task.status = "FAILED";
        task.error = err?.message || String(err);
        task.completedAt = Date.now();
        task.sessionSlotId = slot.id;
        this.activeTasks.delete(task.taskId);
        this.failedTasks.unshift(task);
      } finally {
        this.persistQueueState();
        setTimeout(() => this.dispatchNext(), 2000);
      }
    })();
  }

  /**
   * Batch queues tasks for a set of scenes with configurable batch sizes (e.g. 5 per batch, 10 total on 2 batches)
   */
  public batchQueueSceneTasks(
    scenes: Array<{ sceneId: string; title?: string; prompt: string; referenceImages?: string[]; elementId?: string }>,
    options?: { batchSize?: number; totalLimit?: number }
  ): DuckAiTask[] {
    const rawBatchSize = Number(options?.batchSize) || 5;
    const batchSize = Math.max(1, Math.min(rawBatchSize, 20));
    const totalLimit = options?.totalLimit ? Math.max(1, Number(options.totalLimit)) : scenes.length;
    const targetScenes = scenes.slice(0, totalLimit);
    const createdTasks: DuckAiTask[] = [];

    const totalBatches = Math.max(1, Math.ceil(targetScenes.length / batchSize));

    for (let i = 0; i < targetScenes.length; i++) {
      const s = targetScenes[i];
      if (!s.sceneId || !s.prompt) continue;
      // Skip if task already queued or active for this scene
      const alreadyQueued = this.pendingTasks.some((t) => t.sceneId === s.sceneId);
      const alreadyActive = Array.from(this.activeTasks.values()).some((t) => t.sceneId === s.sceneId);
      if (alreadyQueued || alreadyActive) continue;

      // Skip if already successfully completed in current session unless force requested
      const alreadyCompleted = this.completedTasks.some((t) => t.sceneId === s.sceneId && t.imageUrl);
      if (alreadyCompleted && !(options as any)?.forceRecreate) continue;

      const batchNumber = Math.floor(i / batchSize) + 1;

      const task: DuckAiTask = {
        taskId: `duck_task_${s.sceneId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        sceneId: s.sceneId,
        sceneTitle: s.title || s.sceneId,
        elementId: s.elementId,
        prompt: s.prompt,
        referenceImages: s.referenceImages || [],
        batchNumber,
        batchTotal: totalBatches,
        batchSize,
        status: "WAITING",
        createdAt: Date.now(),
        currentUrl: "https://duck.ai",
        pageTitle: `Duck.ai - دفعة ${batchNumber} من ${totalBatches}`,
      };

      this.pendingTasks.push(task);
      createdTasks.push(task);
    }

    this.persistQueueState();
    console.log(
      `[DuckAiDispatcher] Queued ${createdTasks.length} scene tasks across ${totalBatches} batches (batchSize: ${batchSize}). Total in queue: ${this.pendingTasks.length}.`
    );
    this.dispatchNext();
    return createdTasks;
  }

  /**
   * Retries all failed tasks
   */
  public retryFailedTasks(): number {
    const failedToRetry = [...this.failedTasks];
    this.failedTasks = [];

    for (const t of failedToRetry) {
      t.status = "WAITING";
      t.error = undefined;
      t.retryCount = (t.retryCount || 0) + 1;
      this.pendingTasks.push(t);
    }

    this.dispatchNext();
    return failedToRetry.length;
  }

  /**
   * Pauses the dispatcher
   */
  public pauseDispatcher(): boolean {
    this.isDispatcherPaused = true;
    return true;
  }

  /**
   * Resumes the dispatcher and runs pending tasks
   */
  public resumeDispatcher(): boolean {
    this.isDispatcherPaused = false;
    this.dispatchNext();
    return true;
  }

  /**
   * Cancels all pending tasks
   */
  public cancelAllTasks(): void {
    for (const t of this.pendingTasks) {
      t.status = "CANCELLED";
    }
    this.pendingTasks = [];
  }

  /**
   * Cancels a specific task by taskId
   */
  public cancelTask(taskId: string): boolean {
    const pendIdx = this.pendingTasks.findIndex((t) => t.taskId === taskId);
    if (pendIdx !== -1) {
      this.pendingTasks[pendIdx].status = "CANCELLED";
      this.pendingTasks.splice(pendIdx, 1);
      return true;
    }
    const activeTask = this.activeTasks.get(taskId);
    if (activeTask) {
      activeTask.status = "CANCELLED";
      this.activeTasks.delete(taskId);
      const slot = this.slots.find((s) => s.activeTaskId === taskId);
      if (slot) {
        slot.isBusy = false;
        slot.activeTaskId = null;
        slot.taskStartedAt = null;
        slot.status = slot.page && !slot.page.isClosed() && this.duckBrowser?.isConnected() ? "READY" : "IDLE";
        slot.lastError = "تم إلغاء المهمة يدوياً.";
      }
      setImmediate(() => this.dispatchNext());
      return true;
    }
    return false;
  }

  /**
   * Starts all 5 Duck.ai sessions in parallel and navigates them to READY state
   */
  public async startAllSessions(): Promise<DuckPageSlotDto[]> {
    console.log("[DuckAiProvider] Initializing all 5 Duck.ai slots via DuckAI2API...");
    const isAlive = await this.ensureDuckAi2ApiAlive();
    for (const slot of this.slots) {
      slot.isInitialized = isAlive;
      slot.isBusy = false;
      slot.status = isAlive ? "READY" : "ERROR";
      slot.currentUrl = "https://duck.ai";
      slot.pageTitle = isAlive ? `Duck.ai - ${slot.name} (DuckAI2API)` : "Duck.ai - غير متصل";
      slot.lastError = isAlive ? null : "خادم DuckAI2API غير متاح حالياً.";
    }
    this.dispatchNext();
    return this.getPagesStatus();
  }

  /**
   * Restarts the DuckAI2API background service and cleans stale locks
   */
  public async restartBrowser(): Promise<DuckPageSlotDto[]> {
    console.log("[DuckAiProvider] Restarting Duck.ai service and clearing locks...");
    try {
      const { execSync } = await import("child_process");
      try {
        execSync("fuser -k 8088/tcp 2>/dev/null || true");
      } catch (_) {}
    } catch (_) {}
    this.isDuckAi2ApiReady = false;
    this.lastHealthCheckTime = 0;
    this.cleanStaleLocks(this.userDataDir);
    await new Promise((r) => setTimeout(r, 1000));
    return await this.startAllSessions();
  }

  /**
   * Returns current snapshot of all 5 Duck.ai pages with live status detection
   */
  public getPagesStatus(): DuckPageSlotDto[] {
    const isReady = this.isDuckAi2ApiReady || Boolean(this.duckBrowser && this.duckBrowser.isConnected());

    return this.slots.map((s) => {
      if (!isReady && !s.isBusy) {
        if (s.status !== "CAPTCHA" && s.status !== "RATE_LIMITED" && s.status !== "ERROR") {
          s.status = "IDLE";
        }
      } else if (isReady && s.status === "IDLE" && !s.isBusy) {
        s.status = "READY";
        s.isInitialized = true;
      }
      return {
        id: s.id,
        name: s.name,
        index: s.index,
        isInitialized: s.isInitialized,
        isBusy: Boolean(s.isBusy),
        status: s.status,
        currentUrl: s.currentUrl || "https://duck.ai",
        pageTitle: s.pageTitle || `Duck.ai - ${s.name}`,
        activeTaskId: s.activeTaskId,
        assignedSceneId: s.assignedSceneId,
        sceneTitle: s.sceneTitle,
        currentPrompt: s.currentPrompt,
        lastImageUrl: s.lastImageUrl,
        lastCandidateUrl: s.lastCandidateUrl,
        lastError: s.lastError,
        taskStartedAt: s.taskStartedAt,
        taskDurationMs: s.taskDurationMs,
        loadDurationMs: s.loadDurationMs,
        readinessDurationMs: s.readinessDurationMs,
        lastUsedAt: s.lastUsedAt,
        completedTasksCount: s.completedTasksCount,
        failedTasksCount: s.failedTasksCount,
      };
    });
  }

  /**
   * Full real-time dashboard status payload
   */
  public getDashboardStatus() {
    const sessions = this.getPagesStatus();
    const readyCount = sessions.filter((s) => s.status === "READY" && !s.isBusy).length;
    const generatingCount = sessions.filter((s) => s.status === "GENERATING" || s.isBusy).length;
    const savingCount = sessions.filter((s) => s.status === "SAVING").length;
    const waitingCount = this.pendingTasks.length;
    const errorCount = sessions.filter((s) => s.status === "ERROR").length;
    const captchaCount = sessions.filter((s) => s.status === "CAPTCHA").length;

    return {
      success: true,
      browserConnected: this.isDuckAi2ApiReady || Boolean(this.duckBrowser && this.duckBrowser.isConnected()),
      isDispatcherPaused: this.isDispatcherPaused,
      sessions,
      stats: {
        totalSessions: 5,
        readyCount,
        generatingCount,
        savingCount,
        waitingCount,
        errorCount,
        captchaCount,
        completedCount: this.completedTasks.length,
        failedCount: this.failedTasks.length,
      },
      pendingQueue: this.pendingTasks,
      activeTasks: Array.from(this.activeTasks.values()),
      recentCompleted: this.completedTasks.slice(0, 15),
      recentFailed: this.failedTasks.slice(0, 15),
      checkedAt: new Date().toISOString(),
    };
  }

  public getActiveSlot(): InternalDuckPageSlot {
    const liveSlot = this.slots.find((s) => s.id === this.activeSlotId && s.page && !s.page.isClosed());
    if (liveSlot) return liveSlot;
    return this.slots.find((s) => s.id === this.activeSlotId) || this.slots[0];
  }

  public setActiveSlot(pageId: DuckPageId): void {
    const slot = this.slots.find((s) => s.id === pageId);
    if (slot) {
      this.activeSlotId = pageId;
    }
  }

  public async selectPage(pageId: DuckPageId): Promise<DuckAiStatus> {
    const slot = this.slots.find((s) => s.id === pageId);
    if (!slot) {
      throw new Error(`الصفحة المطلوبة غير موجودة: ${pageId}`);
    }
    this.activeSlotId = pageId;
    const page = await this.ensureSlotPage(slot);
    if (page && !page.isClosed()) {
      await page.bringToFront().catch(() => {});
      if (!this.isDuckAiUrl(page.url())) {
        await this.ensurePageReady(slot, true);
      }
    }
    return this.checkStatus(page);
  }

  public async checkStatus(targetPage?: Page): Promise<DuckAiStatus> {
    const activeSlot = this.getActiveSlot();
    const page = targetPage || activeSlot.page;

    if (!page || page.isClosed()) {
      return {
        isReady: false,
        currentUrl: activeSlot.currentUrl || "about:blank",
        pageTitle: activeSlot.pageTitle || "",
        hasCaptchaChallenge: false,
        challengeDetails: null,
        isRateLimited: false,
        rateLimitMessage: null,
        isGenerating: false,
        lastError: activeSlot.lastError || "جلسة Duck.ai غير متصلة حالياً.",
        activePageId: activeSlot.id,
        loadDurationMs: activeSlot.loadDurationMs,
        readinessDurationMs: activeSlot.readinessDurationMs,
        checkedAt: new Date().toISOString(),
        pages: this.getPagesStatus(),
      };
    }

    try {
      const currentUrl = page.url();
      const pageTitle = await page.title().catch(() => "");
      activeSlot.currentUrl = currentUrl;
      activeSlot.pageTitle = pageTitle;

      const domCheck = await this.checkDomReadiness(page);
      if (domCheck.hasChallenge) {
        activeSlot.status = "CAPTCHA";
        activeSlot.lastError = domCheck.challengeDetails;
      } else if (domCheck.isRateLimited) {
        activeSlot.status = "RATE_LIMITED";
        activeSlot.lastError = domCheck.rateLimitMessage;
      } else if (domCheck.hasError) {
        activeSlot.status = "ERROR";
        activeSlot.lastError = domCheck.errorMessage;
      } else if (domCheck.isGenerating) {
        activeSlot.status = "GENERATING";
      } else if (domCheck.isReady) {
        activeSlot.status = "READY";
        activeSlot.lastError = null;
      }

      return {
        isReady: domCheck.isReady && !domCheck.hasChallenge && !domCheck.isRateLimited && !domCheck.hasError,
        currentUrl,
        pageTitle,
        hasCaptchaChallenge: domCheck.hasChallenge,
        challengeDetails: domCheck.challengeDetails,
        isRateLimited: domCheck.isRateLimited,
        rateLimitMessage: domCheck.rateLimitMessage,
        isGenerating: domCheck.isGenerating,
        lastError: activeSlot.lastError,
        activePageId: activeSlot.id,
        loadDurationMs: activeSlot.loadDurationMs,
        readinessDurationMs: activeSlot.readinessDurationMs,
        checkedAt: new Date().toISOString(),
        pages: this.getPagesStatus(),
      };
    } catch (err: any) {
      activeSlot.status = "ERROR";
      activeSlot.lastError = err?.message || String(err);
      return {
        isReady: false,
        currentUrl: activeSlot.currentUrl,
        pageTitle: activeSlot.pageTitle,
        hasCaptchaChallenge: false,
        challengeDetails: null,
        isRateLimited: false,
        rateLimitMessage: null,
        isGenerating: false,
        lastError: activeSlot.lastError,
        activePageId: activeSlot.id,
        loadDurationMs: activeSlot.loadDurationMs,
        readinessDurationMs: activeSlot.readinessDurationMs,
        checkedAt: new Date().toISOString(),
        pages: this.getPagesStatus(),
      };
    }
  }

  public async navigateToDuckAi(force: boolean = false): Promise<DuckAiStatus> {
    const slot = this.getActiveSlot();
    return this.ensurePageReady(slot, force);
  }
}

export const duckAiProvider = DuckAiProvider.getInstance();
