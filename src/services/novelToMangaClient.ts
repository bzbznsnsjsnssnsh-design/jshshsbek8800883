import type {
  FlowAuthStatus,
  FlowConnectionStatus,
  FlowDisplayModelName,
  FlowErrorEntry,
  FlowHistoryEntry,
  FlowSessionStatus,
  FlowTaskModelMap,
  GeminiCookieModelId,
  GeminiNovelTaskType,
  GeminiTaskModelMap,
  GoogleFlowModelDescriptor,
  GoogleFlowProject,
  NovelChapterBlock,
  PageGenerationMode,
  ProductionElementType,
  StudioAspectRatio,
  StudioCheckpointState,
  StudioElementVerificationResult,
  StudioLocationItem,
  StudioLocationType,
  StudioPipelineTelemetry,
  StudioProductionElement,
  StudioSceneItem,
  StudioStylePreset,
  StudioStyleSettings,
  ManhwaPagePlan,
  ManhwaPageLayoutType,
  ChapterManhwaLayoutPlan,
  ChapterScenePerPageLayoutPlan,
  FlowBackgroundTask,
  SceneCandidateImage,
} from "../types/novelToManga";
import {
  DEFAULT_FLOW_TASK_MODELS,
  DEFAULT_GEMINI_TASK_MODELS,
} from "../types/novelToManga";

export const DEFAULT_USER_FLOW_COOKIES = "";

function getStoredGeminiCookies(): string {
  try {
    return localStorage.getItem("gemini_cookies") || "";
  } catch {
    return "";
  }
}

export function loadFlowCookies(): string {
  try {
    return (
      localStorage.getItem("google_flow_cookies") ||
      localStorage.getItem("flow_cookies") ||
      ""
    );
  } catch {
    return "";
  }
}

export function saveFlowCookies(cookies: string): void {
  try {
    localStorage.setItem("google_flow_cookies", cookies);
    localStorage.setItem("flow_cookies", cookies);
  } catch {}
}

export function loadFlowProjects(): GoogleFlowProject[] {
  try {
    const raw =
      localStorage.getItem("google_flow_projects") ||
      localStorage.getItem("flow_projects");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveFlowProjects(projects: GoogleFlowProject[]): void {
  try {
    localStorage.setItem("google_flow_projects", JSON.stringify(projects));
    localStorage.setItem("flow_projects", JSON.stringify(projects));
  } catch {}
}

export function loadFlowTaskModels(): FlowTaskModelMap {
  try {
    const raw = localStorage.getItem("flow_task_models");
    return raw
      ? { ...DEFAULT_FLOW_TASK_MODELS, ...JSON.parse(raw) }
      : { ...DEFAULT_FLOW_TASK_MODELS };
  } catch {
    return { ...DEFAULT_FLOW_TASK_MODELS };
  }
}

export function saveFlowTaskModels(models: FlowTaskModelMap): void {
  try {
    localStorage.setItem("flow_task_models", JSON.stringify(models));
  } catch {}
}

export function loadGeminiTaskModels(): GeminiTaskModelMap {
  try {
    const raw = localStorage.getItem("gemini_task_models");
    return raw
      ? { ...DEFAULT_GEMINI_TASK_MODELS, ...JSON.parse(raw) }
      : { ...DEFAULT_GEMINI_TASK_MODELS };
  } catch {
    return { ...DEFAULT_GEMINI_TASK_MODELS };
  }
}

export function saveGeminiTaskModels(models: GeminiTaskModelMap): void {
  try {
    localStorage.setItem("gemini_task_models", JSON.stringify(models));
  } catch {}
}

export function loadPreferredGeminiModel(): GeminiCookieModelId {
  try {
    return (
      (localStorage.getItem("preferred_gemini_model") as GeminiCookieModelId) ||
      (localStorage.getItem("gemini_cookie_model") as GeminiCookieModelId) ||
      "3.6-flash"
    );
  } catch {
    return "3.6-flash";
  }
}

export function savePreferredGeminiModel(model: GeminiCookieModelId): void {
  try {
    localStorage.setItem("preferred_gemini_model", model);
    localStorage.setItem("gemini_cookie_model", model);
  } catch {}
}

// ============================================================================
// CONCURRENCY QUEUE RUNNER
// ============================================================================

export async function runParallelQueueWithLimit<T, R>(
  items: T[],
  limit: number,
  taskFn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (!items || items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let currentIndex = 0;
  const executing: Promise<void>[] = [];

  const worker = async (): Promise<void> => {
    while (currentIndex < items.length) {
      const idx = currentIndex++;
      results[idx] = await taskFn(items[idx], idx);
    }
  };

  const poolSize = Math.max(1, Math.min(limit || 2, items.length));
  for (let i = 0; i < poolSize; i++) {
    executing.push(worker());
  }

  await Promise.all(executing);
  return results;
}

// ============================================================================
// GOOGLE FLOW SESSION & PROJECT APIS
// ============================================================================

export async function fetchGoogleFlowStatus(rawSession?: string) {
  const session = rawSession ?? loadFlowCookies();
  const res = await fetch("/api/google-flow/status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rawSession: session, flowCookies: session }),
  });
  return await res.json();
}

export async function testGoogleFlowConnection(rawSession?: string, projectId?: string) {
  const session = rawSession ?? loadFlowCookies();
  const res = await fetch("/api/google-flow/test-connection", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rawSession: session, flowCookies: session, projectId }),
  });
  return await res.json();
}

export async function testGoogleFlowUpload(payload: {
  flowCookies?: string;
  rawSession?: string;
  projectId?: string;
}) {
  const session = payload.flowCookies || payload.rawSession || loadFlowCookies();
  const res = await fetch("/api/google-flow/test-upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rawSession: session, flowCookies: session, projectId: payload.projectId }),
  });
  return await res.json();
}

export async function testGoogleFlowGeneration(payload: {
  flowCookies?: string;
  rawSession?: string;
  projectId?: string;
  modelDisplayName?: string;
}) {
  const session = payload.flowCookies || payload.rawSession || loadFlowCookies();
  const res = await fetch("/api/google-flow/test-generation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rawSession: session,
      flowCookies: session,
      projectId: payload.projectId,
      modelDisplayName: payload.modelDisplayName,
    }),
  });
  return await res.json();
}

export async function discoverGoogleFlowModels(rawSession?: string) {
  const session = rawSession ?? loadFlowCookies();
  const res = await fetch("/api/google-flow/discover-models", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rawSession: session, flowCookies: session }),
  });
  return await res.json();
}

export async function addGoogleFlowProject(payload: {
  name?: string;
  rawSession?: string;
  enabled?: boolean;
}) {
  const session = payload.rawSession ?? loadFlowCookies();
  const res = await fetch("/api/google-flow/projects/add", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: payload.name,
      rawSession: session,
      enabled: payload.enabled,
    }),
  });
  return await res.json();
}

export async function verifyAssetInGoogleFlowApi(payload: any) {
  const session = payload.rawSession || payload.flowCookies || loadFlowCookies();
  const res = await fetch("/api/google-flow/verify-asset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rawSession: session,
      ...payload,
    }),
  });
  return await res.json();
}

// ============================================================================
// NOVEL TO MANGA STUDIO APIS
// ============================================================================

export async function generateStudioScriptApi(payload: {
  projectTitle: string;
  novelText: string;
  targetSceneCount?: number;
  modelId?: string;
  geminiCookies?: string;
  [key: string]: any;
}) {
  const geminiCookies = payload.geminiCookies || getStoredGeminiCookies();
  const res = await fetch("/api/novel-to-manga/studio/script", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      geminiCookies,
      ...payload,
    }),
  });
  return await res.json();
}

export async function extractLocationsAndElementsFromScriptApi(payload: {
  scriptText: string;
  existingScenes?: StudioSceneItem[];
  existingLocations?: StudioLocationItem[];
  existingElements?: StudioProductionElement[];
  modelId?: string;
  geminiCookies?: string;
  [key: string]: any;
}) {
  const geminiCookies = payload.geminiCookies || getStoredGeminiCookies();
  const res = await fetch("/api/novel-to-manga/studio/extract-from-script", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      geminiCookies,
      ...payload,
    }),
  });
  return await res.json();
}

// Production Elements
export async function generateStudioElementPromptApi(payload: any) {
  const geminiCookies = payload.geminiCookies || getStoredGeminiCookies();
  const res = await fetch("/api/novel-to-manga/studio/element/generate-prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      geminiCookies,
      ...payload,
    }),
  });
  return await res.json();
}

export async function generateStudioElementsPromptsBatchApi(payload: any) {
  const geminiCookies = payload.geminiCookies || getStoredGeminiCookies();
  const res = await fetch("/api/novel-to-manga/studio/elements/generate-prompts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      geminiCookies,
      ...payload,
    }),
  });
  return await res.json();
}

export async function generateStudioElementImageApi(payload: any) {
  const flowCookies = payload.flowCookies || payload.rawSession || loadFlowCookies();
  const geminiCookies = payload.geminiCookies || getStoredGeminiCookies();
  const res = await fetch("/api/novel-to-manga/studio/element/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      flowCookies,
      rawSession: flowCookies,
      geminiCookies,
      ...payload,
    }),
  });
  return await res.json();
}

export async function verifyStudioElementImageApi(payload: any) {
  const geminiCookies = payload.geminiCookies || getStoredGeminiCookies();
  const res = await fetch("/api/novel-to-manga/studio/element/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      geminiCookies,
      ...payload,
    }),
  });
  return await res.json();
}

export async function lockStudioElementApi(payload: any) {
  const res = await fetch("/api/novel-to-manga/studio/element/lock", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return await res.json();
}

// Locations
export async function generateStudioLocationPromptApi(payload: any) {
  const geminiCookies = payload.geminiCookies || getStoredGeminiCookies();
  const res = await fetch("/api/novel-to-manga/studio/location/generate-prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      geminiCookies,
      ...payload,
    }),
  });
  return await res.json();
}

export async function generateStudioLocationsPromptsBatchApi(payload: any) {
  const geminiCookies = payload.geminiCookies || getStoredGeminiCookies();
  const res = await fetch("/api/novel-to-manga/studio/locations/generate-prompts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      geminiCookies,
      ...payload,
    }),
  });
  return await res.json();
}

export async function generateStudioLocationImageApi(payload: any) {
  const flowCookies = payload.flowCookies || payload.rawSession || loadFlowCookies();
  const geminiCookies = payload.geminiCookies || getStoredGeminiCookies();
  const res = await fetch("/api/novel-to-manga/studio/location/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      flowCookies,
      rawSession: flowCookies,
      geminiCookies,
      ...payload,
    }),
  });
  return await res.json();
}

export async function verifyStudioLocationImageApi(payload: any) {
  const geminiCookies = payload.geminiCookies || getStoredGeminiCookies();
  const res = await fetch("/api/novel-to-manga/studio/location/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      geminiCookies,
      ...payload,
    }),
  });
  return await res.json();
}

export async function lockStudioLocationApi(payload: any) {
  const res = await fetch("/api/novel-to-manga/studio/location/lock", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return await res.json();
}

export async function lockAllStudioReferencesApi(payload?: any) {
  const res = await fetch("/api/novel-to-manga/studio/references/lock-all", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
  return await res.json();
}

// Scenes
export async function generateAndVerifyStudioSceneApi(payload: any) {
  const flowCookies = payload.flowCookies || payload.rawSession || loadFlowCookies();
  const geminiCookies = payload.geminiCookies || getStoredGeminiCookies();
  const res = await fetch("/api/novel-to-manga/studio/generate-scene", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      flowCookies,
      rawSession: flowCookies,
      geminiCookies,
      ...payload,
    }),
  });
  return await res.json();
}

export async function verifyStudioSceneImageApi(payload: any) {
  const geminiCookies = payload.geminiCookies || getStoredGeminiCookies();
  const res = await fetch("/api/novel-to-manga/studio/scene/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      geminiCookies,
      ...payload,
    }),
  });
  return await res.json();
}

// Studio Checkpoints & Telemetry
export async function loadStudioCheckpointApi() {
  const res = await fetch("/api/novel-to-manga/studio/checkpoint", {
    headers: { Accept: "application/json" },
  });
  return await res.json();
}

export async function saveStudioCheckpointApi(state: any) {
  const res = await fetch("/api/novel-to-manga/studio/checkpoint", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state || {}),
  });
  return await res.json();
}

export async function getStudioTelemetryApi(): Promise<StudioPipelineTelemetry> {
  const res = await fetch("/api/novel-to-manga/studio/telemetry", {
    headers: { Accept: "application/json" },
  });
  const data = await res.json();
  return data.telemetry || data;
}

export async function getStudioPerformanceReportApi() {
  const res = await fetch("/api/novel-to-manga/studio/performance-report", {
    headers: { Accept: "application/json" },
  });
  return await res.json();
}

export async function runStudioPerformanceBenchmarkApi(payload?: any) {
  const rawSession = payload?.rawSession || loadFlowCookies();
  const res = await fetch("/api/novel-to-manga/studio/performance-benchmark", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rawSession,
      ...payload,
    }),
  });
  return await res.json();
}

export async function getBackgroundVerificationStatusApi(targetId: string) {
  const res = await fetch(
    `/api/novel-to-manga/studio/background-verification/${encodeURIComponent(targetId)}`,
    {
      headers: { Accept: "application/json" },
    }
  );
  return await res.json();
}

export async function runStudioFullPipelineApi(payload: any) {
  const rawSession = payload.rawSession || payload.flowCookies || loadFlowCookies();
  const geminiCookies = payload.geminiCookies || getStoredGeminiCookies();
  const res = await fetch("/api/novel-to-manga/studio/run-full-pipeline", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rawSession,
      geminiCookies,
      ...payload,
    }),
  });
  return await res.json();
}

// Manhwa Pages Layout Engine APIs
export async function planChapterManhwaPagesApi(payload: {
  chapter_id?: string;
  chapter_title?: string;
  scenes?: StudioSceneItem[];
  blocks?: NovelChapterBlock[];
  elements?: StudioProductionElement[];
  locations?: StudioLocationItem[];
  preferred_style?: string;
  page_mode?: PageGenerationMode;
  aspect_ratio?: string;
  [key: string]: any;
}) {
  const res = await fetch("/api/manhwa-pages/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return await res.json();
}

export async function verifyManhwaPageApi(payload: any) {
  const geminiCookies = payload.geminiCookies || getStoredGeminiCookies();
  const res = await fetch("/api/manhwa-pages/verify-page", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      geminiCookies,
      ...payload,
    }),
  });
  return await res.json();
}

export async function replanManhwaPageLayoutApi(payload: {
  page: ManhwaPagePlan;
  new_layout_type: ManhwaPageLayoutType;
  [key: string]: any;
}) {
  const res = await fetch("/api/manhwa-pages/replan-layout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return await res.json();
}

// ============================================================================
// REAL CHROMIUM GOOGLE FLOW BROWSER CLIENT APIS
// ============================================================================

export interface FlowBrowserStatusData {
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

async function safeFetchJson<T = any>(
  input: RequestInfo | URL,
  init?: RequestInit,
  retries: number = 2,
  backoffMs: number = 1500
): Promise<T> {
  let lastError: any = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(input, init);
      const text = await res.text();

      const isRateLimited =
        res.status === 429 ||
        text.includes("Rate exceeded") ||
        text.includes("Too Many Requests");

      if (isRateLimited) {
        if (attempt < retries) {
          console.warn(`[safeFetchJson] Rate limit detected (attempt ${attempt + 1}/${retries + 1}), retrying in ${backoffMs}ms...`);
          await new Promise((r) => setTimeout(r, backoffMs));
          backoffMs *= 1.5;
          continue;
        }
        throw new Error("تم تجاوز معدل الطلبات مؤقتًا (Rate exceeded). يرجى الانتظار 3 ثوانٍ قبل المحاولة مجددًا.");
      }

      if (!text || text.trim() === "") {
        return {} as T;
      }

      try {
        return JSON.parse(text) as T;
      } catch (_jsonErr) {
        if (text.includes("Rate exceeded")) {
          throw new Error("تم تجاوز معدل الطلبات مؤقتًا (Rate exceeded). يرجى الانتظار 3 ثوانٍ قبل المحاولة مجددًا.");
        }
        if (!res.ok) {
          throw new Error(`خطأ استجابة (${res.status}): ${text.slice(0, 120)}`);
        }
        throw new Error(`استجابة غير صالحة من الخادم: ${text.slice(0, 80)}`);
      }
    } catch (err: any) {
      lastError = err;
      const isRetryable =
        err?.message?.includes("Rate exceeded") ||
        err?.message?.includes("Failed to fetch") ||
        err?.name === "TimeoutError";

      if (attempt < retries && isRetryable) {
        await new Promise((r) => setTimeout(r, backoffMs));
        backoffMs *= 1.5;
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error("فشل الاتصال بالخادم.");
}

export const DUCK_AI_URL = "https://duck.ai/chat";

export async function fetchFlowBrowserStatusApi(): Promise<{
  success: boolean;
  status: FlowBrowserStatusData;
  error?: string;
}> {
  try {
    return await safeFetchJson("/api/flow-browser/status", { signal: AbortSignal.timeout(8000) });
  } catch (err: any) {
    return { success: false, status: {} as any, error: err?.message || String(err) };
  }
}

export async function launchFlowBrowserApi(url: string = DUCK_AI_URL): Promise<{
  success: boolean;
  url: string;
  status: FlowBrowserStatusData;
  error?: string;
}> {
  try {
    return await safeFetchJson("/api/flow-browser/launch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: url || DUCK_AI_URL }),
      signal: AbortSignal.timeout(28000),
    });
  } catch (err: any) {
    return { success: false, url, status: {} as any, error: err?.message || String(err) };
  }
}

export async function navigateFlowBrowserApi(url: string, signal?: AbortSignal): Promise<{
  success: boolean;
  status: FlowBrowserStatusData;
  error?: string;
}> {
  try {
    return await safeFetchJson("/api/flow-browser/navigate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal: signal || AbortSignal.timeout(15000),
    });
  } catch (err: any) {
    return { success: false, status: {} as any, error: err?.message || String(err) };
  }
}

export async function sendFlowBrowserActionApi(action: any): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    return await safeFetchJson("/api/flow-browser/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action),
      signal: AbortSignal.timeout(10000),
    });
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

export async function injectFlowBrowserPromptApi(prompt: string): Promise<{
  success: boolean;
  message: string;
  error?: string;
}> {
  try {
    return await safeFetchJson("/api/flow-browser/type-prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err: any) {
    return { success: false, message: "", error: err?.message || String(err) };
  }
}

export async function extractFlowBrowserImagesApi(): Promise<{
  success: boolean;
  images: Array<{ url: string; alt?: string; width?: number; height?: number }>;
  error?: string;
}> {
  try {
    return await safeFetchJson("/api/flow-browser/extract-images", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15000),
    });
  } catch (err: any) {
    return { success: false, images: [], error: err?.message || String(err) };
  }
}

export async function bindFlowBrowserImageToSceneApi(payload: {
  imageUrl: string;
  sceneId?: string;
  elementId?: string;
  locationId?: string;
}): Promise<{
  success: boolean;
  localUrl: string;
  sceneId?: string;
  elementId?: string;
  locationId?: string;
  message: string;
  error?: string;
}> {
  try {
    return await safeFetchJson("/api/flow-browser/bind-image-to-scene", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    });
  } catch (err: any) {
    return { success: false, localUrl: "", message: "", error: err?.message || String(err) };
  }
}

export async function restartFlowBrowserApi(): Promise<{
  success: boolean;
  status: FlowBrowserStatusData;
  message: string;
  error?: string;
}> {
  try {
    return await safeFetchJson("/api/flow-browser/restart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(28000),
    });
  } catch (err: any) {
    return { success: false, status: {} as any, message: "", error: err?.message || String(err) };
  }
}

export async function stopFlowBrowserApi(): Promise<{
  success: boolean;
  status: FlowBrowserStatusData;
  message: string;
  error?: string;
}> {
  try {
    return await safeFetchJson("/api/flow-browser/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15000),
    });
  } catch (err: any) {
    return { success: false, status: {} as any, message: "", error: err?.message || String(err) };
  }
}

export async function toggleFlowBrowserAutomationApi(enabled: boolean): Promise<{
  success: boolean;
  isAutomated: boolean;
  error?: string;
}> {
  try {
    return await safeFetchJson("/api/flow-browser/automation-toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (err: any) {
    return { success: false, isAutomated: enabled, error: err?.message || String(err) };
  }
}

export async function saveFlowBrowserSessionApi(): Promise<{
  success: boolean;
  count: number;
  hasGoogleAuth: boolean;
  timestamp: number;
  status: FlowBrowserStatusData;
  message: string;
  error?: string;
}> {
  try {
    return await safeFetchJson("/api/flow-browser/save-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15000),
    });
  } catch (err: any) {
    return {
      success: false,
      count: 0,
      hasGoogleAuth: false,
      timestamp: Date.now(),
      status: {} as any,
      message: "",
      error: err?.message || String(err),
    };
  }
}

export async function importFlowBrowserSessionApi(rawCookies: string): Promise<{
  success: boolean;
  count: number;
  hasGoogleAuth: boolean;
  status: FlowBrowserStatusData;
  message: string;
  error?: string;
}> {
  try {
    return await safeFetchJson("/api/flow-browser/import-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawCookies }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err: any) {
    return {
      success: false,
      count: 0,
      hasGoogleAuth: false,
      status: {} as any,
      message: "",
      error: err?.message || String(err),
    };
  }
}

export async function fetchFlowBrowserSessionInfoApi(): Promise<{
  success: boolean;
  sessionInfo: {
    hasSavedSession: boolean;
    hasGoogleAuth: boolean;
    cookieCount: number;
    savedAt: string | null;
  };
  status: FlowBrowserStatusData;
  error?: string;
}> {
  try {
    return await safeFetchJson("/api/flow-browser/session-info", { signal: AbortSignal.timeout(8000) });
  } catch (err: any) {
    return {
      success: false,
      sessionInfo: { hasSavedSession: false, hasGoogleAuth: false, cookieCount: 0, savedAt: null },
      status: {} as any,
      error: err?.message || String(err),
    };
  }
}

export async function restoreFlowBrowserSessionApi(): Promise<{
  success: boolean;
  count: number;
  hasGoogleAuth: boolean;
  status: FlowBrowserStatusData;
  message: string;
  error?: string;
}> {
  try {
    return await safeFetchJson("/api/flow-browser/restore-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(12000),
    });
  } catch (err: any) {
    return {
      success: false,
      count: 0,
      hasGoogleAuth: false,
      status: {} as any,
      message: "",
      error: err?.message || String(err),
    };
  }
}

// ============================================================================
// AUTO MANGA GENERATOR & 4-CANDIDATES BACKGROUND TASK CLIENT APIS
// ============================================================================

export async function createAutoGeneratorTaskApi(payload: {
  sceneId: string;
  pageId?: string;
  sceneTitle?: string;
  prompt: string;
  stylePreset?: string;
  aspectRatio?: string;
  modelDisplayName?: string;
  referenceFilePaths?: string[];
  projectId?: string;
  maxAttempts?: number;
}): Promise<{
  success: boolean;
  task?: FlowBackgroundTask;
  message?: string;
  error?: string;
}> {
  try {
    return await safeFetchJson("/api/novel-to-manga/auto-generator/create-task", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

export async function createAutoGeneratorTasksBatchApi(tasks: Array<{
  sceneId: string;
  pageId?: string;
  sceneTitle?: string;
  prompt: string;
  stylePreset?: string;
  aspectRatio?: string;
  modelDisplayName?: string;
  referenceFilePaths?: string[];
  projectId?: string;
  maxAttempts?: number;
}>): Promise<{
  success: boolean;
  tasks?: FlowBackgroundTask[];
  count?: number;
  message?: string;
  error?: string;
}> {
  try {
    return await safeFetchJson("/api/novel-to-manga/auto-generator/create-tasks-batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tasks }),
    });
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

export async function fetchAutoGeneratorTasksApi(): Promise<{
  success: boolean;
  tasks: FlowBackgroundTask[];
  error?: string;
}> {
  try {
    return await safeFetchJson("/api/novel-to-manga/auto-generator/tasks");
  } catch (err: any) {
    return { success: false, tasks: [], error: err?.message || String(err) };
  }
}

export async function fetchAutoGeneratorTaskApi(taskId: string): Promise<{
  success: boolean;
  task?: FlowBackgroundTask;
  error?: string;
}> {
  try {
    return await safeFetchJson(`/api/novel-to-manga/auto-generator/task/${encodeURIComponent(taskId)}`);
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

export async function fetchAutoGeneratorTaskBySceneApi(sceneId: string): Promise<{
  success: boolean;
  task?: FlowBackgroundTask | null;
  error?: string;
}> {
  try {
    return await safeFetchJson(`/api/novel-to-manga/auto-generator/task-by-scene/${encodeURIComponent(sceneId)}`);
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

export async function inspectAutoGeneratorCandidatesApi(
  taskId: string,
  payload?: {
    geminiCookies?: string;
    maxHealAttempts?: number;
    sceneOverride?: any;
    locationOverride?: any;
    productionElements?: any[];
  }
): Promise<{
  success: boolean;
  task?: FlowBackgroundTask;
  summary?: {
    total: number;
    approvedCount: number;
    rejectedCount: number;
    healedCount: number;
  };
  message?: string;
  error?: string;
}> {
  try {
    return await safeFetchJson(
      `/api/novel-to-manga/auto-generator/task/${encodeURIComponent(taskId)}/inspect-candidates`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload || {}),
      }
    );
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

export async function bindAutoGeneratorCandidateApi(
  taskId: string,
  candidateId: string
): Promise<{
  success: boolean;
  task?: FlowBackgroundTask;
  selectedCandidate?: SceneCandidateImage;
  message?: string;
  error?: string;
}> {
  try {
    return await safeFetchJson(
      `/api/novel-to-manga/auto-generator/task/${encodeURIComponent(taskId)}/bind-candidate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId }),
      }
    );
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

export async function retryAutoGeneratorTaskApi(taskId: string): Promise<{
  success: boolean;
  task?: FlowBackgroundTask;
  message?: string;
  error?: string;
}> {
  try {
    return await safeFetchJson(
      `/api/novel-to-manga/auto-generator/task/${encodeURIComponent(taskId)}/retry`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

export async function cancelAutoGeneratorTaskApi(taskId: string): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    return await safeFetchJson(
      `/api/novel-to-manga/auto-generator/task/${encodeURIComponent(taskId)}/cancel`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

// ============================================================================
// DUCK.AI CLIENT APIS (Phase 2 - 5 Real Browser Pages & Performance)
// ============================================================================

export interface DuckPageSlotDto {
  id: "duck_page_1" | "duck_page_2" | "duck_page_3" | "duck_page_4" | "duck_page_5";
  name: string;
  index: number;
  isInitialized: boolean;
  isBusy?: boolean;
  status: "READY" | "GENERATING" | "WAITING" | "SAVING" | "LOADING" | "CAPTCHA" | "RATE_LIMITED" | "IDLE" | "ERROR";
  currentUrl: string;
  pageTitle: string;
  activeTaskId: string | null;
  assignedSceneId: string | null;
  sceneTitle?: string | null;
  currentPrompt?: string | null;
  lastImageUrl?: string | null;
  lastCandidateUrl?: string | null;
  lastError: string | null;
  taskStartedAt?: number | null;
  taskDurationMs?: number | null;
  loadDurationMs: number | null;
  readinessDurationMs: number | null;
  lastUsedAt: string | null;
  completedTasksCount?: number;
  failedTasksCount?: number;
}

export interface DuckAiTaskDto {
  taskId: string;
  sceneId: string;
  sceneTitle?: string;
  elementId?: string;
  sessionSlotId?: string;
  batchNumber?: number;
  batchTotal?: number;
  batchSize?: number;
  prompt: string;
  referenceImages?: string[];
  referencePdfs?: string[];
  status: "WAITING" | "ASSIGNED" | "GENERATING" | "SAVING" | "COMPLETED" | "FAILED" | "CANCELLED";
  assignedSessionId?: string;
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

export interface DuckAiDashboardData {
  success: boolean;
  browserConnected: boolean;
  isDispatcherPaused: boolean;
  sessions: DuckPageSlotDto[];
  stats: {
    totalSessions: number;
    readyCount: number;
    generatingCount: number;
    savingCount: number;
    waitingCount: number;
    errorCount: number;
    captchaCount: number;
    completedCount: number;
    failedCount: number;
  };
  pendingQueue: DuckAiTaskDto[];
  activeTasks: DuckAiTaskDto[];
  recentCompleted: DuckAiTaskDto[];
  recentFailed: DuckAiTaskDto[];
  checkedAt: string;
}

export interface DuckAiStatusData {
  isReady: boolean;
  currentUrl: string;
  pageTitle: string;
  hasCaptchaChallenge: boolean;
  challengeDetails: string | null;
  isRateLimited: boolean;
  rateLimitMessage: string | null;
  isGenerating: boolean;
  lastError: string | null;
  activePageId?: string;
  loadDurationMs?: number | null;
  readinessDurationMs?: number | null;
  checkedAt: string;
  pages?: DuckPageSlotDto[];
}

export async function fetchDuckAiStatusApi(): Promise<{
  success: boolean;
  status?: DuckAiStatusData;
  error?: string;
}> {
  try {
    return await safeFetchJson("/api/novel-to-manga/duck-ai/status");
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

export async function fetchDuckAiPagesApi(): Promise<{
  success: boolean;
  activePageId?: string;
  pages?: DuckPageSlotDto[];
  error?: string;
}> {
  try {
    return await safeFetchJson("/api/novel-to-manga/duck-ai/pages");
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

export async function selectDuckAiPageApi(pageId: string): Promise<{
  success: boolean;
  message?: string;
  status?: DuckAiStatusData;
  error?: string;
}> {
  try {
    return await safeFetchJson(`/api/novel-to-manga/duck-ai/pages/${pageId}/select`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

export async function resetDuckAiPageApi(pageId: string): Promise<{
  success: boolean;
  message?: string;
  error?: string;
}> {
  try {
    return await safeFetchJson(`/api/novel-to-manga/duck-ai/pages/${pageId}/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

export async function probeDuckAiPageApi(pageId: string): Promise<{
  success: boolean;
  message?: string;
  status?: DuckAiStatusData;
  error?: string;
}> {
  try {
    return await safeFetchJson(`/api/novel-to-manga/duck-ai/pages/${pageId}/probe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

export async function navigateDuckAiApi(force: boolean = false): Promise<{
  success: boolean;
  status?: DuckAiStatusData;
  message?: string;
  error?: string;
}> {
  try {
    return await safeFetchJson("/api/novel-to-manga/duck-ai/navigate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force }),
    });
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

export async function generateDuckAiImageApi(params: {
  prompt: string;
  sceneId?: string;
  sceneTitle?: string;
  elementId?: string;
  batchNumber?: number;
  taskId?: string;
  referenceImages?: string[];
  referencePdfs?: string[];
  timeoutMs?: number;
  preferredPageId?: string;
}): Promise<{
  success: boolean;
  localUrl?: string;
  originalUrl?: string;
  width?: number;
  height?: number;
  format?: string;
  sceneId?: string;
  sceneTitle?: string;
  elementId?: string;
  sessionSlotId?: string;
  batchNumber?: number;
  currentUrl?: string;
  pageTitle?: string;
  prompt?: string;
  sceneCandidateUrl?: string;
  candidateUrl?: string;
  pageId?: string;
  durationMs?: number;
  provider?: string;
  status: string;
  challengeDetails?: string;
  error?: string;
}> {
  try {
    return await safeFetchJson("/api/novel-to-manga/duck-ai/generate-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
  } catch (err: any) {
    return {
      success: false,
      status: "ERROR",
      error: err?.message || String(err),
    };
  }
}

// 🦆 5-SESSION DASHBOARD CLIENT APIS
export async function fetchDuckAiDashboardStatusApi(): Promise<DuckAiDashboardData> {
  try {
    const res = await safeFetchJson("/api/novel-to-manga/duck-ai/dashboard-status");
    return res as DuckAiDashboardData;
  } catch (err: any) {
    return {
      success: false,
      browserConnected: false,
      isDispatcherPaused: false,
      sessions: [],
      stats: {
        totalSessions: 5,
        readyCount: 0,
        generatingCount: 0,
        savingCount: 0,
        waitingCount: 0,
        errorCount: 0,
        captchaCount: 0,
        completedCount: 0,
        failedCount: 0,
      },
      pendingQueue: [],
      activeTasks: [],
      recentCompleted: [],
      recentFailed: [],
      checkedAt: new Date().toISOString(),
    };
  }
}

export async function startAllDuckAiSessionsApi(): Promise<{
  success: boolean;
  message?: string;
  sessions?: DuckPageSlotDto[];
  error?: string;
}> {
  try {
    return await safeFetchJson("/api/novel-to-manga/duck-ai/sessions/start-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

export async function restartDuckAiBrowserApi(): Promise<{
  success: boolean;
  message?: string;
  sessions?: DuckPageSlotDto[];
  error?: string;
}> {
  try {
    return await safeFetchJson("/api/novel-to-manga/duck-ai/sessions/restart-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

export async function pauseDuckAiDispatcherApi(): Promise<{
  success: boolean;
  isDispatcherPaused?: boolean;
  message?: string;
  error?: string;
}> {
  try {
    return await safeFetchJson("/api/novel-to-manga/duck-ai/dispatcher/pause", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

export async function resumeDuckAiDispatcherApi(): Promise<{
  success: boolean;
  isDispatcherPaused?: boolean;
  message?: string;
  error?: string;
}> {
  try {
    return await safeFetchJson("/api/novel-to-manga/duck-ai/dispatcher/resume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

export async function batchQueueDuckAiScenesApi(
  scenes: Array<{ sceneId: string; title?: string; prompt: string; referenceImages?: string[]; elementId?: string }>,
  options?: { batchSize?: number; totalLimit?: number }
): Promise<{
  success: boolean;
  count?: number;
  batchCount?: number;
  tasks?: DuckAiTaskDto[];
  message?: string;
  error?: string;
}> {
  try {
    return await safeFetchJson("/api/novel-to-manga/duck-ai/tasks/batch-scenes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scenes,
        batchSize: options?.batchSize,
        totalLimit: options?.totalLimit,
      }),
    });
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

export async function retryFailedDuckAiTasksApi(): Promise<{
  success: boolean;
  count?: number;
  message?: string;
  error?: string;
}> {
  try {
    return await safeFetchJson("/api/novel-to-manga/duck-ai/tasks/retry-failed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

export async function cancelAllDuckAiTasksApi(): Promise<{
  success: boolean;
  message?: string;
  error?: string;
}> {
  try {
    return await safeFetchJson("/api/novel-to-manga/duck-ai/tasks/cancel-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

export async function cancelDuckAiTaskApi(taskId: string): Promise<{
  success: boolean;
  message?: string;
  error?: string;
}> {
  try {
    return await safeFetchJson(`/api/novel-to-manga/duck-ai/tasks/${taskId}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

export async function flagCheckpointApi(name: string, metadata?: Record<string, any>): Promise<{
  success: boolean;
  checkpoint?: any;
  message?: string;
  error?: string;
}> {
  try {
    return await safeFetchJson("/api/novel-to-manga/checkpoint/flag", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, metadata }),
    });
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

export async function fetchCheckpointsApi(): Promise<{
  success: boolean;
  checkpoints?: Array<{
    name: string;
    createdAt: string;
    phase: string;
    buildStatus: string;
    filePath: string;
  }>;
  error?: string;
}> {
  try {
    return await safeFetchJson("/api/novel-to-manga/checkpoint/flags");
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

export async function getCheckpointApi(name: string): Promise<{
  success: boolean;
  checkpoint?: any;
  error?: string;
}> {
  try {
    return await safeFetchJson(`/api/novel-to-manga/checkpoint/flag/${encodeURIComponent(name)}`);
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}
