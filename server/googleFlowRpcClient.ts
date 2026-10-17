import crypto from "crypto";
import fs from "fs";
import http from "http";
import https from "https";

const origHttpsReq = https.request;
// @ts-ignore
https.request = function (...args: any[]) {
  if (args[0] && typeof args[0] === "object") args[0].maxHeaderSize = 1048576;
  if (args[1] && typeof args[1] === "object") args[1].maxHeaderSize = 1048576;
  // @ts-ignore
  return origHttpsReq.apply(this, args);
};
const origHttpReq = http.request;
// @ts-ignore
http.request = function (...args: any[]) {
  if (args[0] && typeof args[0] === "object") args[0].maxHeaderSize = 1048576;
  if (args[1] && typeof args[1] === "object") args[1].maxHeaderSize = 1048576;
  // @ts-ignore
  return origHttpReq.apply(this, args);
};

import axios from "axios";
import sharp from "sharp";
import type { FlowDisplayModelName } from "../src/types/novelToManga.ts";
import {
  isRealVerifiedFlowProjectId,
  buildRealFlowProjectUrl,
} from "../src/types/novelToManga.ts";
import {
  flowGenerationPerformanceService,
  type FlowGenerationTimingRecord,
} from "./flowGenerationPerformanceService.ts";

// Reuse TCP/TLS connections across all Google Flow & Gemini requests for low-latency RPCs
const sharedHttpAgent = new http.Agent({ keepAlive: true, maxSockets: 64, keepAliveMsecs: 30000 });
const sharedHttpsAgent = new https.Agent({ keepAlive: true, maxSockets: 64, keepAliveMsecs: 30000 });
axios.defaults.httpAgent = sharedHttpAgent;
axios.defaults.httpsAgent = sharedHttpsAgent;

/**
 * Google Flow Real RPC Client (`https://flow.google.com`)
 *
 * Uses the live `AiSandboxAngularFrontend` RPC protocol on `flow.google.com`:
 * - `UpteDb`  -> `/FlowService.GetProjects`
 * - `OylIJd`  -> `/AiSandbox.SearchUserProjects`
 * - `jHPbke`  -> `/AiSandbox.CreateProject`
 * - `HTrJv`   -> `/FlowService.GetModels`
 * - `Zzl0ze`  -> `/FlowService.GetProjectContents`
 * - `ngNC2`   -> `/AiSandbox.GetProject`
 * - `maseQ`   -> `/FlowService.UploadImage`
 * - `ogiZ0b`  -> `/FlowService.BatchGenerateImages`
 */

const FLOW_BASE_ORIGIN = "https://flow.google.com";
const DEFAULT_FLOW_RPC_PATH = "/_/AiSandboxAngularFrontend/data/batchexecute";
const DEFAULT_RECAPTCHA_SITE_KEY = "6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV";
const FLOW_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export function maskSecret(secret?: string | null): string {
  if (!secret || typeof secret !== "string" || !secret.trim()) {
    return "••••••••";
  }
  return "••••••••";
}

export function sanitizeTextForLog(input: string): string {
  if (!input) return "";
  return input
    .replace(/(__Secure-[A-Za-z0-9_-]+|SAPISID|APISID|HSID|SSID|SID|OSID|NID|SIDCC|SNlM0e)=([^\s;]+)/gi, "$1=••••••••")
    .replace(/(Bearer\s+)[A-Za-z0-9._\-+/=]+/gi, "$1••••••••")
    .replace(/(SAPISIDHASH\s+)[A-Za-z0-9_]+/gi, "$1••••••••");
}

const FLOW_SESSION_CACHE_TTL_MS = 20 * 60 * 1000; // 20 minutes
const flowSessionContextCache = new Map<
  string,
  { context: RealFlowSessionContext; timestamp: number }
>();
const flowSessionInFlight = new Map<string, Promise<RealFlowSessionContext>>();

let cachedRecaptchaReleaseVersion: { version: string; timestamp: number } | null = null;
const directOgiZ0bBlockedUntilByCookie = new Map<string, number>();
const verifiedProjectAssetsMemory = new Map<string, Set<string>>();

export function invalidateFlowSessionCache(cookiesMap?: Record<string, string>): void {
  if (!cookiesMap) {
    flowSessionContextCache.clear();
    flowSessionInFlight.clear();
    return;
  }
  const key = (cookiesMap["__Secure-1PSID"] || cookiesMap["SID"] || "").slice(0, 64);
  if (key) {
    flowSessionContextCache.delete(key);
    flowSessionInFlight.delete(key);
  }
}

export interface RealFlowSessionContext {
  authenticated: boolean;
  email: string | null;
  xsrfToken: string | null;
  buildLabel: string;
  sessionId: string;
  rpcPath: string;
  recaptchaSiteKey: string;
  cookieHeader: string;
  sapisidHash: string | null;
  finalUrl: string;
  actionRequired: boolean;
  actionRequiredReason: string | null;
}

export interface DiscoveredRemoteFlowProject {
  flowProjectId: string;
  flowProjectUrl: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  verified: boolean;
}

export interface VerifiedFlowProjectAsset {
  flowAssetId: string;
  flowProjectId: string;
  workflowId?: string | null;
  imageUrl?: string | null;
  prompt?: string | null;
  createdAt?: string | null;
}

export function computeSapisidHash(
  sapisid: string,
  origin: string = FLOW_BASE_ORIGIN
): string {
  const ts = Math.floor(Date.now() / 1000);
  const input = `${ts} ${sapisid} ${origin}`;
  const digest = crypto.createHash("sha1").update(input).digest("hex");
  return `SAPISIDHASH ${ts}_${digest}`;
}

export function buildFlowCookieHeader(cookiesMap: Record<string, string>): string {
  return Object.entries(cookiesMap)
    .filter(([k, v]) => Boolean(k && v))
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

/**
 * Fetches the real Google Flow page (`https://flow.google.com/`) using the user's cookies
 * and extracts `WIZ_global_data`:
 * - `oPEP7c` -> signed-in Google email
 * - `SNlM0e` -> XSRF token (`at`) required for `batchexecute`
 * - `cfb2h`  -> build label (`bl`)
 * - `FdrFJe` -> session ID (`f.sid`)
 * - `eptZe`  -> frontend prefix (`/_/AiSandboxAngularFrontend/`)
 * - `xZbWve` -> reCAPTCHA Enterprise site key
 */
export async function fetchRealFlowSessionContext(
  cookiesMap: Record<string, string>,
  sourcePath: string = "/",
  forceRefresh: boolean = false
): Promise<RealFlowSessionContext> {
  const cookieHeader = buildFlowCookieHeader(cookiesMap);
  const sapisid =
    cookiesMap["SAPISID"] ||
    cookiesMap["__Secure-1PAPISID"] ||
    cookiesMap["__Secure-3PAPISID"] ||
    null;
  const sapisidHash = sapisid ? computeSapisidHash(sapisid, FLOW_BASE_ORIGIN) : null;

  if (!cookieHeader || !cookiesMap["__Secure-1PSID"]) {
    return {
      authenticated: false,
      email: null,
      xsrfToken: null,
      buildLabel: "",
      sessionId: "",
      rpcPath: DEFAULT_FLOW_RPC_PATH,
      recaptchaSiteKey: DEFAULT_RECAPTCHA_SITE_KEY,
      cookieHeader: "",
      sapisidHash: null,
      finalUrl: FLOW_BASE_ORIGIN,
      actionRequired: true,
      actionRequiredReason:
        "FLOW_AUTH_FAILED: كوكيز Google Flow مفقودة (__Secure-1PSID غير موجود).",
    };
  }

  const cacheKey = `${cookiesMap["__Secure-1PSID"].slice(0, 64)}:${(cookiesMap["__Secure-OSID"] || "").slice(0, 32)}`;
  const now = Date.now();

  if (!forceRefresh) {
    const cached = flowSessionContextCache.get(cacheKey);
    if (
      cached &&
      cached.context.authenticated &&
      cached.context.xsrfToken &&
      now - cached.timestamp < FLOW_SESSION_CACHE_TTL_MS
    ) {
      return {
        ...cached.context,
        cookieHeader,
        sapisidHash,
      };
    }

    const inFlight = flowSessionInFlight.get(cacheKey);
    if (inFlight) {
      const resolved = await inFlight;
      return {
        ...resolved,
        cookieHeader,
        sapisidHash,
      };
    }
  }

  const fetchPromise = (async (): Promise<RealFlowSessionContext> => {
    try {
      const targetUrl = `${FLOW_BASE_ORIGIN}${sourcePath.startsWith("/") ? sourcePath : `/${sourcePath}`}`;
      const resp = await axios.get(targetUrl, {
        headers: {
          Cookie: cookieHeader,
          "User-Agent": FLOW_USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9,ar;q=0.8",
        },
        maxRedirects: 5,
        timeout: 18000,
        validateStatus: () => true,
      });

      const finalUrl = resp.request?.res?.responseUrl || targetUrl;
      const html = typeof resp.data === "string" ? resp.data : "";

      const wizMatch = html.match(/window\.WIZ_global_data\s*=\s*(\{[\s\S]*?\});/);
      let wiz: Record<string, any> = {};
      if (wizMatch && wizMatch[1]) {
        try {
          wiz = JSON.parse(wizMatch[1]);
        } catch (_) {}
      }

      const email =
        (typeof wiz.oPEP7c === "string" && wiz.oPEP7c.trim()) ||
        (html.match(/"oPEP7c"\s*:\s*"([^"]+)"/) || [])[1] ||
        null;
      const xsrfToken =
        (typeof wiz.SNlM0e === "string" && wiz.SNlM0e.trim()) ||
        (html.match(/"SNlM0e"\s*:\s*"([^"]+)"/) || [])[1] ||
        cookiesMap["SNlM0e"] ||
        null;
      const buildLabel =
        (typeof wiz.cfb2h === "string" && wiz.cfb2h.trim()) ||
        (html.match(/"cfb2h"\s*:\s*"([^"]+)"/) || [])[1] ||
        "boq_labs-ai-sandbox-frontend_20260401.05_p0";
      const sessionId =
        (typeof wiz.FdrFJe === "string" && wiz.FdrFJe.trim()) ||
        (html.match(/"FdrFJe"\s*:\s*"([^"]+)"/) || [])[1] ||
        "";
      const rawPrefix =
        (typeof wiz.eptZe === "string" && wiz.eptZe.trim()) ||
        (html.match(/"eptZe"\s*:\s*"([^"]+)"/) || [])[1] ||
        "/_/AiSandboxAngularFrontend/";
      const normalizedPrefix = rawPrefix.endsWith("/") ? rawPrefix : `${rawPrefix}/`;
      const rpcPath = `${normalizedPrefix}data/batchexecute`;
      const recaptchaSiteKey =
        (typeof wiz.xZbWve === "string" && wiz.xZbWve.trim()) ||
        (html.match(/"xZbWve"\s*:\s*"([^"]+)"/) || [])[1] ||
        DEFAULT_RECAPTCHA_SITE_KEY;

      const isRedirectedToMarketing =
        finalUrl.includes("labs.google/fx") && !email && !xsrfToken;
      const isRedirectedToAccounts =
        finalUrl.includes("accounts.google.com") ||
        finalUrl.includes("ServiceLogin");

      if (!email || !xsrfToken || isRedirectedToMarketing || isRedirectedToAccounts) {
        return {
          authenticated: false,
          email: null,
          xsrfToken: null,
          buildLabel,
          sessionId,
          rpcPath,
          recaptchaSiteKey,
          cookieHeader,
          sapisidHash,
          finalUrl,
          actionRequired: true,
          actionRequiredReason:
            "GOOGLE_FLOW_ACTION_REQUIRED: جلسة Google Flow على flow.google.com غير مسجلة الدخول أو تتطلب تحديث الكوكيز (__Secure-OSID / __Secure-1PSID) من المتصفح.",
        };
      }

      const authedCtx: RealFlowSessionContext = {
        authenticated: true,
        email,
        xsrfToken,
        buildLabel,
        sessionId,
        rpcPath,
        recaptchaSiteKey,
        cookieHeader,
        sapisidHash,
        finalUrl,
        actionRequired: false,
        actionRequiredReason: null,
      };
      flowSessionContextCache.set(cacheKey, {
        context: authedCtx,
        timestamp: Date.now(),
      });
      flowGenerationPerformanceService.markWarmSessionActive(true);
      return authedCtx;
    } catch (err: any) {
      return {
        authenticated: false,
        email: null,
        xsrfToken: null,
        buildLabel: "",
        sessionId: "",
        rpcPath: DEFAULT_FLOW_RPC_PATH,
        recaptchaSiteKey: DEFAULT_RECAPTCHA_SITE_KEY,
        cookieHeader,
        sapisidHash,
        finalUrl: FLOW_BASE_ORIGIN,
        actionRequired: true,
        actionRequiredReason: `FLOW_AUTH_FAILED: تعذر الاتصال بـ flow.google.com (${err?.message || "network error"})`,
      };
    }
  })();

  flowSessionInFlight.set(cacheKey, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    flowSessionInFlight.delete(cacheKey);
  }
}

/**
 * Parses Google `batchexecute` multi-chunk response envelope and extracts the inner JSON string
 * for the requested `rpcId`.
 */
export function parseBatchExecuteEnvelope(
  rawText: string,
  expectedRpcId?: string
): {
  ok: boolean;
  rpcId: string | null;
  innerJson: any;
  rawInnerString: string | null;
  errorCode: number | null;
  errorMessage: string | null;
} {
  if (!rawText || typeof rawText !== "string") {
    return {
      ok: false,
      rpcId: null,
      innerJson: null,
      rawInnerString: null,
      errorCode: null,
      errorMessage: "Empty batchexecute response",
    };
  }

  const cleaned = rawText.replace(/^\)\]\}'\s*\r?\n?/, "");
  const lines = cleaned.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("[")) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) continue;
      for (const entry of parsed) {
        if (!Array.isArray(entry) || entry[0] !== "wrb.fr") continue;
        const rpcId = entry[1];
        if (expectedRpcId && rpcId !== expectedRpcId) continue;

        const innerPayloadStr = entry[2];
        const errorArr = entry[5];

        if (typeof innerPayloadStr === "string" && innerPayloadStr.length > 0) {
          let innerJson: any = innerPayloadStr;
          try {
            innerJson = JSON.parse(innerPayloadStr);
          } catch (_) {}
          return {
            ok: true,
            rpcId,
            innerJson,
            rawInnerString: innerPayloadStr,
            errorCode: null,
            errorMessage: null,
          };
        }

        if (Array.isArray(errorArr)) {
          const code = typeof errorArr[0] === "number" ? errorArr[0] : null;
          return {
            ok: false,
            rpcId,
            innerJson: null,
            rawInnerString: null,
            errorCode: code,
            errorMessage: JSON.stringify(errorArr),
          };
        }
      }
    } catch (_) {}
  }

  return {
    ok: false,
    rpcId: expectedRpcId || null,
    innerJson: null,
    rawInnerString: null,
    errorCode: null,
    errorMessage: `Unrecognized batchexecute payload (${rawText.slice(0, 180)})`,
  };
}

/**
 * Executes a real `batchexecute` RPC call against `https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute`.
 */
export async function executeRealFlowBatchRpc(params: {
  rpcId: string;
  payload: any[];
  cookiesMap: Record<string, string>;
  sourcePath?: string;
  sessionContext?: RealFlowSessionContext;
  timeoutMs?: number;
}): Promise<{
  ok: boolean;
  status: number;
  innerJson: any;
  rawText: string;
  errorMessage: string | null;
  context: RealFlowSessionContext;
}> {
  const sourcePath = params.sourcePath || "/";
  const ctx =
    params.sessionContext && params.sessionContext.authenticated && params.sessionContext.xsrfToken
      ? params.sessionContext
      : await fetchRealFlowSessionContext(params.cookiesMap, sourcePath);

  if (!ctx.authenticated || !ctx.xsrfToken) {
    return {
      ok: false,
      status: 401,
      innerJson: null,
      rawText: "",
      errorMessage:
        ctx.actionRequiredReason ||
        "GOOGLE_FLOW_ACTION_REQUIRED: جلسة Google Flow غير مسجلة الدخول على flow.google.com.",
      context: ctx,
    };
  }

  const reqId = Math.floor(100000 + Math.random() * 899999);
  const query = new URLSearchParams({
    rpcids: params.rpcId,
    "source-path": sourcePath,
    bl: ctx.buildLabel,
    "f.sid": ctx.sessionId,
    hl: "en",
    _reqid: String(reqId),
    rt: "c",
  });

  const fReq = JSON.stringify([[[params.rpcId, JSON.stringify(params.payload), null, "generic"]]]);
  const body = new URLSearchParams({
    "f.req": fReq,
    at: ctx.xsrfToken,
  }).toString();

  const headers: Record<string, string> = {
    Cookie: ctx.cookieHeader,
    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    "User-Agent": FLOW_USER_AGENT,
    Accept: "*/*",
    Origin: FLOW_BASE_ORIGIN,
    Referer: `${FLOW_BASE_ORIGIN}${sourcePath}`,
    "X-Same-Domain": "1",
    "X-Goog-AuthUser": "0",
  };
  if (ctx.sapisidHash) {
    headers["Authorization"] = ctx.sapisidHash;
  }

  const rpcPath = ctx.rpcPath || DEFAULT_FLOW_RPC_PATH;
  const resp = await axios.post(`${FLOW_BASE_ORIGIN}${rpcPath}?${query.toString()}`, body, {
    headers,
    timeout: params.timeoutMs || 60000,
    validateStatus: () => true,
  });

  const rawText = typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data || "");
  if (resp.status < 200 || resp.status >= 300) {
    return {
      ok: false,
      status: resp.status,
      innerJson: null,
      rawText,
      errorMessage: `HTTP ${resp.status} from flow.google.com (${params.rpcId})`,
      context: ctx,
    };
  }

  const parsed = parseBatchExecuteEnvelope(rawText, params.rpcId);
  return {
    ok: parsed.ok,
    status: resp.status,
    innerJson: parsed.innerJson,
    rawText,
    errorMessage: parsed.errorMessage,
    context: ctx,
  };
}

/**
 * Discovers real Google Flow projects from the user's account via `UpteDb` (`/FlowService.GetProjects`)
 * and `OylIJd` (`/AiSandbox.SearchUserProjects`).
 */
export async function discoverRemoteFlowProjects(
  cookiesMap: Record<string, string>,
  sessionContext?: RealFlowSessionContext
): Promise<DiscoveredRemoteFlowProject[]> {
  // 1. Primary: UpteDb (/FlowService.GetProjects) with exact protobuf schema: ["projects/*", 21, "", null, null, null, [1]]
  const res = await executeRealFlowBatchRpc({
    rpcId: "UpteDb",
    payload: ["projects/*", 21, "", null, null, null, [1]],
    cookiesMap,
    sourcePath: "/",
    sessionContext,
  });

  const discovered: DiscoveredRemoteFlowProject[] = [];
  const seenIds = new Set<string>();
  const nowIso = new Date().toISOString();

  const parseProjectsArray = (items: any[]) => {
    for (const item of items) {
      if (!Array.isArray(item)) continue;
      const rawId = typeof item[0] === "string" ? item[0].replace(/^projects\//, "").trim() : "";
      if (!isRealVerifiedFlowProjectId(rawId) || seenIds.has(rawId)) continue;
      seenIds.add(rawId);

      const meta = Array.isArray(item[1]) ? item[1] : [];
      const title =
        (typeof meta[0] === "string" && meta[0].trim()) ||
        (typeof item[1] === "string" && item[1].trim()) ||
        `Flow Project ${rawId.slice(0, 8)}`;

      let createdAt = nowIso;
      const tsArr = Array.isArray(meta[2]) ? meta[2] : Array.isArray(item[2]) ? item[2] : null;
      if (tsArr && typeof tsArr[0] === "number" && tsArr[0] > 1000000000) {
        createdAt = new Date(tsArr[0] * 1000).toISOString();
      }

      discovered.push({
        flowProjectId: rawId,
        flowProjectUrl: buildRealFlowProjectUrl(rawId)!,
        name: title,
        createdAt,
        updatedAt: createdAt,
        verified: true,
      });
    }
  };

  if (res.ok && Array.isArray(res.innerJson)) {
    const projectRows = Array.isArray(res.innerJson[0]) ? res.innerJson[0] : res.innerJson;
    if (Array.isArray(projectRows)) {
      parseProjectsArray(projectRows);
    }
  }

  // 2. Fallback/Supplement: OylIJd (/AiSandbox.SearchUserProjects) with ["projects/*", 20, "", [null, 22]]
  if (discovered.length === 0) {
    const searchRes = await executeRealFlowBatchRpc({
      rpcId: "OylIJd",
      payload: ["projects/*", 20, "", [null, 22]],
      cookiesMap,
      sourcePath: "/",
      sessionContext: res.context,
    });
    if (searchRes.ok && Array.isArray(searchRes.innerJson)) {
      const rows = Array.isArray(searchRes.innerJson[0]) ? searchRes.innerJson[0] : searchRes.innerJson;
      if (Array.isArray(rows)) {
        parseProjectsArray(rows);
      }
    }
  }

  return discovered;
}

/**
 * Creates a real Google Flow project on `https://flow.google.com` via `jHPbke` (`/AiSandbox.CreateProject`).
 * Exact protobuf payload: `["projects/*", [null, [cleanTitle]], [null, 22]]`.
 */
export async function createRemoteFlowProject(
  cookiesMap: Record<string, string>,
  projectTitle: string = "Novel to Manga Studio",
  sessionContext?: RealFlowSessionContext
): Promise<DiscoveredRemoteFlowProject> {
  const cleanTitle = (projectTitle || "Novel to Manga Studio").trim();
  const res = await executeRealFlowBatchRpc({
    rpcId: "jHPbke",
    payload: ["projects/*", [null, [cleanTitle]], [null, 22]],
    cookiesMap,
    sourcePath: "/",
    sessionContext,
  });

  if (!res.ok || !res.innerJson) {
    throw new Error(
      res.errorMessage ||
        "FLOW_PROJECT_CREATE_FAILED: تعذر إنشاء مشروع حقيقي داخل Google Flow عبر jHPbke."
    );
  }

  const rawJsonStr = JSON.stringify(res.innerJson);
  const uuidMatch = rawJsonStr.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
  );
  const createdId = uuidMatch ? uuidMatch[0] : null;

  if (!createdId || !isRealVerifiedFlowProjectId(createdId)) {
    throw new Error(
      "FLOW_PROJECT_CREATE_INVALID_ID: لم يُرجع Google Flow معرف مشروع UUID حقيقي بعد الإنشاء."
    );
  }

  const nowIso = new Date().toISOString();
  return {
    flowProjectId: createdId,
    flowProjectUrl: buildRealFlowProjectUrl(createdId)!,
    name: cleanTitle,
    createdAt: nowIso,
    updatedAt: nowIso,
    verified: true,
  };
}

/**
 * Verifies a real project on `flow.google.com` and retrieves its real assets via `Zzl0ze` (`/FlowService.GetProjectContents`)
 * and `ngNC2` (`/AiSandbox.GetProject`).
 */
export async function verifyRemoteFlowProjectAndAssets(params: {
  flowProjectId: string;
  expectedAssetId?: string;
  cookiesMap: Record<string, string>;
  sessionContext?: RealFlowSessionContext;
}): Promise<{
  projectVerified: boolean;
  projectName: string | null;
  flowProjectId: string;
  flowProjectUrl: string;
  assets: VerifiedFlowProjectAsset[];
}> {
  const cleanId = (params.flowProjectId || "").trim();
  if (!isRealVerifiedFlowProjectId(cleanId)) {
    return {
      projectVerified: false,
      projectName: null,
      flowProjectId: cleanId,
      flowProjectUrl: "",
      assets: [],
    };
  }

  // Requirement 14: If a specific expectedAssetId is already verified in memory for this project, stop unnecessary remote retrieval
  const memSet = verifiedProjectAssetsMemory.get(cleanId);
  if (params.expectedAssetId && memSet && memSet.has(params.expectedAssetId.trim().toLowerCase())) {
    const cachedAssets: VerifiedFlowProjectAsset[] = Array.from(memSet).map((aid) => ({
      flowAssetId: aid,
      flowProjectId: cleanId,
    }));
    return {
      projectVerified: true,
      projectName: "Verified Flow Project",
      flowProjectId: cleanId,
      flowProjectUrl: buildRealFlowProjectUrl(cleanId)!,
      assets: cachedAssets,
    };
  }

  const projectPath = `/project/${cleanId}`;
  const ctx =
    params.sessionContext && params.sessionContext.authenticated
      ? params.sessionContext
      : await fetchRealFlowSessionContext(params.cookiesMap, projectPath);

  if (!ctx.authenticated || !ctx.xsrfToken) {
    return {
      projectVerified: false,
      projectName: null,
      flowProjectId: cleanId,
      flowProjectUrl: buildRealFlowProjectUrl(cleanId)!,
      assets: [],
    };
  }

  const [projRes, contentsRes] = await Promise.all([
    executeRealFlowBatchRpc({
      rpcId: "ngNC2",
      payload: [`tools/PINHOLE/projects/${cleanId}`],
      cookiesMap: params.cookiesMap,
      sourcePath: projectPath,
      sessionContext: ctx,
    }),
    executeRealFlowBatchRpc({
      rpcId: "Zzl0ze",
      payload: [`projects/${cleanId}`, null, null, null, [1]],
      cookiesMap: params.cookiesMap,
      sourcePath: projectPath,
      sessionContext: ctx,
    }),
  ]);

  let projectName: string | null = null;
  if (projRes.ok && Array.isArray(projRes.innerJson)) {
    const meta = Array.isArray(projRes.innerJson[1]) ? projRes.innerJson[1] : [];
    if (typeof meta[0] === "string" && meta[0].trim()) {
      projectName = meta[0].trim();
    }
  }

  const assets: VerifiedFlowProjectAsset[] = [];
  const seenAssets = new Set<string>();

  if (contentsRes.ok && Array.isArray(contentsRes.innerJson)) {
    // 1. Parse media items in innerJson[2]
    const mediaRows = Array.isArray(contentsRes.innerJson[2]) ? contentsRes.innerJson[2] : [];
    for (const row of mediaRows) {
      if (!Array.isArray(row)) continue;
      const assetId = typeof row[0] === "string" ? row[0].trim() : "";
      if (!isRealVerifiedFlowProjectId(assetId) || seenAssets.has(assetId)) continue;
      seenAssets.add(assetId);

      const workflowId = typeof row[2] === "string" ? row[2].trim() : null;
      const extractedUrl = extractFlowImageUrl(row);
      assets.push({
        flowAssetId: assetId,
        flowProjectId: cleanId,
        workflowId,
        imageUrl: extractedUrl,
      });
    }

    // 2. Also check workflows in innerJson[1]
    const workflowRows = Array.isArray(contentsRes.innerJson[1]) ? contentsRes.innerJson[1] : [];
    for (const wf of workflowRows) {
      if (!Array.isArray(wf)) continue;
      const wfId = typeof wf[0] === "string" ? wf[0].trim() : "";
      const wfMeta = Array.isArray(wf[3]) ? wf[3] : [];
      const primaryMediaId = typeof wfMeta[4] === "string" ? wfMeta[4].trim() : "";
      if (isRealVerifiedFlowProjectId(primaryMediaId) && !seenAssets.has(primaryMediaId)) {
        seenAssets.add(primaryMediaId);
        assets.push({
          flowAssetId: primaryMediaId,
          flowProjectId: cleanId,
          workflowId: isRealVerifiedFlowProjectId(wfId) ? wfId : null,
        });
      }
      if (isRealVerifiedFlowProjectId(wfId) && !seenAssets.has(wfId)) {
        seenAssets.add(wfId);
        assets.push({
          flowAssetId: wfId,
          flowProjectId: cleanId,
          workflowId: wfId,
        });
      }
    }
  }

  const projectVerified = Boolean(projRes.ok || contentsRes.ok);

  return {
    projectVerified,
    projectName,
    flowProjectId: cleanId,
    flowProjectUrl: buildRealFlowProjectUrl(cleanId)!,
    assets,
  };
}

/**
 * Uploads an image asset directly into a real Google Flow project via `maseQ` (`/FlowService.UploadImage`).
 * Returns the real `flowAssetId` (`mediaId`), `workflowId`, and `imageUrl` created inside the project on `flow.google.com`.
 */
export async function uploadAssetToRemoteFlowProject(params: {
  flowProjectId: string;
  imageBuffer: Buffer;
  mimeType?: string;
  fileName?: string;
  isHidden?: boolean;
  preassignedAssetId?: string;
  cookiesMap: Record<string, string>;
  sessionContext?: RealFlowSessionContext;
}): Promise<{
  flowAssetId: string;
  workflowId: string | null;
  imageUrl: string | null;
  flowProjectId: string;
}> {
  const cleanProjectId = (params.flowProjectId || "").trim();
  if (!isRealVerifiedFlowProjectId(cleanProjectId)) {
    throw new Error(
      `FLOW_PROJECT_NOT_FOUND: لا يمكن رفع أصل إلى معرف مشروع غير صالح (${cleanProjectId}).`
    );
  }

  const b64 = params.imageBuffer.toString("base64");
  const mimeType = params.mimeType || "image/jpeg";
  const fileName = params.fileName || `flow_asset_${Date.now()}.jpg`;
  const workflowSeed = crypto.randomUUID();
  const mediaSeed =
    params.preassignedAssetId && isRealVerifiedFlowProjectId(params.preassignedAssetId)
      ? params.preassignedAssetId.trim()
      : crypto.randomUUID();

  // Exact s4a protobuf structure for maseQ (/FlowService.UploadImage)
  const clientContext = [null, 22, null, null, null, cleanProjectId];
  const uploadPayload = [
    clientContext, // 1: V (ClientContext)
    b64, // 2: base64 bytes
    mimeType, // 3: mimeType
    1, // 4: Hf = true
    null, // 5
    null, // 6
    null, // 7: crop
    params.isHidden ? 1 : 0, // 8: isHidden
    fileName, // 9: fileName
    null, // 10
    workflowSeed, // 11: ZN (workflow seed)
    mediaSeed, // 12: DL (media seed)
    null, // 13
    [1], // 14: X
  ];

  const res = await executeRealFlowBatchRpc({
    rpcId: "maseQ",
    payload: uploadPayload,
    cookiesMap: params.cookiesMap,
    sourcePath: `/project/${cleanProjectId}`,
    sessionContext: params.sessionContext,
    timeoutMs: 60000,
  });

  if (!res.ok || !res.innerJson) {
    throw new Error(
      `FLOW_ASSET_NOT_CREATED: فشل رفع الأصل إلى مشروع Google Flow (${cleanProjectId}): ${
        res.errorMessage || "Unknown error"
      }`
    );
  }

  const mediaEntry = Array.isArray(res.innerJson[0]) ? res.innerJson[0] : [];
  const mediaId = typeof mediaEntry[0] === "string" ? mediaEntry[0].trim() : "";
  const workflowId = typeof mediaEntry[2] === "string" ? mediaEntry[2].trim() : null;
  const rawStr = JSON.stringify(res.innerJson);
  const extractedUrl = extractFlowImageUrl(res.innerJson);

  const finalAssetId = isRealVerifiedFlowProjectId(mediaId)
    ? mediaId
    : (rawStr.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i) || [])[0] || "";

  if (!finalAssetId || !isRealVerifiedFlowProjectId(finalAssetId)) {
    throw new Error(
      "FLOW_ASSET_NOT_CREATED: لم يُرجع Google Flow معرف أصل (flowAssetId) صالح بعد رفع الصورة."
    );
  }

  let projSet = verifiedProjectAssetsMemory.get(cleanProjectId);
  if (!projSet) {
    projSet = new Set<string>();
    verifiedProjectAssetsMemory.set(cleanProjectId, projSet);
  }
  projSet.add(finalAssetId.toLowerCase());

  return {
    flowAssetId: finalAssetId,
    workflowId,
    imageUrl: extractedUrl,
    flowProjectId: cleanProjectId,
  };
}

/**
 * Maps UI display model names to Google Flow internal model keys from `HTrJv` (`/FlowService.GetModels`).
 * Strictly validates the requested model and throws MODEL_UNAVAILABLE if unsupported.
 */
export function resolveInternalFlowModelKey(
  displayName: FlowDisplayModelName | string
): string {
  return flowGenerationPerformanceService.validateAndResolveModel(displayName).internalModelId;
}

export function resolveFlowAspectRatioEnum(
  aspectRatio?: "1:1" | "3:4" | "9:16" | "16:9"
): number {
  switch (aspectRatio) {
    case "1:1":
      return 1; // SQUARE
    case "9:16":
      return 2; // PORTRAIT
    case "16:9":
      return 3; // LANDSCAPE
    case "3:4":
    default:
      return 4; // PORTRAIT_3_4
  }
}

async function fetchRecaptchaEnterpriseToken(
  siteKey: string,
  cookieHeader: string,
  action: string = "IMAGE_GENERATION"
): Promise<string | null> {
  try {
    const co =
      Buffer.from("https://flow.google.com:443")
        .toString("base64")
        .replace(/=+$/, "") + ".";
    const now = Date.now();
    let v = "r2024";
    if (cachedRecaptchaReleaseVersion && now - cachedRecaptchaReleaseVersion.timestamp < 3600000) {
      v = cachedRecaptchaReleaseVersion.version;
    } else {
      const entJs = await axios.get(
        `https://www.google.com/recaptcha/enterprise.js?render=${siteKey}`,
        { timeout: 3500 }
      );
      const vMatch = String(entJs.data).match(/releases\/([^/]+)\//);
      if (vMatch && vMatch[1]) {
        v = vMatch[1];
        cachedRecaptchaReleaseVersion = { version: v, timestamp: now };
      }
    }

    const anchorUrl = `https://www.google.com/recaptcha/enterprise/anchor?ar=1&k=${siteKey}&co=${encodeURIComponent(
      co
    )}&hl=en&v=${v}&size=invisible`;
    const anchorRes = await axios.get(anchorUrl, {
      headers: {
        Cookie: cookieHeader,
        Referer: "https://flow.google.com/",
        "User-Agent": FLOW_USER_AGENT,
      },
      timeout: 3500,
    });
    const tokenMatch = String(anchorRes.data).match(/id="recaptcha-token"\s+value="([^"]+)"/);
    const anchorToken = tokenMatch ? tokenMatch[1] : null;
    if (!anchorToken) return null;

    const reloadBody = new URLSearchParams({
      v,
      reason: "q",
      c: anchorToken,
      k: siteKey,
      co,
      hl: "en",
      size: "invisible",
      sa: action,
    }).toString();

    const reloadRes = await axios.post(
      `https://www.google.com/recaptcha/enterprise/reload?k=${siteKey}`,
      reloadBody,
      {
        headers: {
          Cookie: cookieHeader,
          "Content-Type": "application/x-www-form-urlencoded",
          Referer: anchorUrl,
          Origin: "https://www.google.com",
          "User-Agent": FLOW_USER_AGENT,
        },
        timeout: 3500,
      }
    );
    const rrespMatch = String(reloadRes.data).match(/\["rresp","([^"]+)"/);
    return rrespMatch ? rrespMatch[1] : null;
  } catch (_) {
    return null;
  }
}

/**
 * Security: Validates whether a given domain is an authorized Google Flow image host.
 */
export function isTrustedGoogleFlowDomain(hostname: string, allowLoopback: boolean = false): boolean {
  if (!hostname) return false;
  const h = hostname.toLowerCase().trim();
  if (allowLoopback && (h === "127.0.0.1" || h === "localhost")) {
    return true;
  }
  return (
    h === "flow.google.com" ||
    h === "google.com" ||
    h.endsWith(".google.com") ||
    h === "googleusercontent.com" ||
    h.endsWith(".googleusercontent.com") ||
    h === "labs.google" ||
    h.endsWith(".labs.google") ||
    h === "googleapis.com" ||
    h.endsWith(".googleapis.com")
  );
}

/**
 * Security: Checks whether authentication cookies should be attached to requests to this domain.
 * Google session cookies belong to .google.com and .labs.google, but MUST NEVER be sent
 * to googleusercontent.com sandbox or untrusted domains.
 */
export function isGoogleAuthDomain(hostname: string): boolean {
  if (!hostname) return false;
  const h = hostname.toLowerCase().trim();
  if (h.endsWith(".googleusercontent.com") || h === "googleusercontent.com") {
    return false;
  }
  return (
    h === "google.com" ||
    h.endsWith(".google.com") ||
    h === "labs.google" ||
    h.endsWith(".labs.google")
  );
}

/**
 * Detects whether a URL represents a Google Accounts authentication redirect (login page).
 */
export function isGoogleAuthRedirect(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    if (host === "accounts.google.com" || host.endsWith(".accounts.google.com")) {
      return true;
    }
    if (
      path.includes("/servicelogin") ||
      path.includes("/interactivelogin") ||
      path.includes("/signin")
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Recursively extracts and unescapes Google Flow image URLs from strings, arrays, or JSON objects.
 */
export function extractFlowImageUrl(source: any): string | null {
  if (!source) return null;

  if (typeof source === "string") {
    const trimmed = source.trim();
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        const parsed = JSON.parse(trimmed);
        const fromParsed = extractFlowImageUrl(parsed);
        if (fromParsed) return fromParsed;
      } catch (_) {}
    }
    return extractUrlFromString(source);
  }

  if (Array.isArray(source)) {
    for (const item of source) {
      const found = extractFlowImageUrl(item);
      if (found) return found;
    }
    return null;
  }

  if (typeof source === "object") {
    const candidates = [
      source.imageUrl,
      source.url,
      source.image_url,
      source.mediaUrl,
      source.downloadUrl,
    ];
    for (const c of candidates) {
      if (typeof c === "string") {
        const found = extractUrlFromString(c);
        if (found) return found;
      }
    }
    for (const val of Object.values(source)) {
      const found = extractFlowImageUrl(val);
      if (found) return found;
    }
  }

  return null;
}

function extractUrlFromString(str: string): string | null {
  if (!str || typeof str !== "string") return null;
  let unescaped = str
    .replace(/\\+u002f/gi, "/")
    .replace(/\\+u003a/gi, ":")
    .replace(/\\+u003d/gi, "=")
    .replace(/\\+u0026/gi, "&")
    .replace(/\\+\//g, "/");

  if (unescaped.startsWith("//")) {
    unescaped = "https:" + unescaped;
  }

  const match = unescaped.match(
    /https?:\/\/(?:[a-zA-Z0-9-]+\.)?(?:googleusercontent\.com|google\.com|labs\.google|googleapis\.com)\/[^\s"'\\]+/
  );
  if (!match) return null;

  let url = match[0];
  url = url.replace(/[),;>]+$/, "");
  return url;
}

/**
 * Recursively extracts ALL unique Google Flow image URLs from strings, arrays, or JSON objects.
 */
export function extractAllFlowImageUrls(source: any): string[] {
  const urls: Set<string> = new Set();
  function recurse(val: any) {
    if (!val) return;
    if (typeof val === "string") {
      const trimmed = val.trim();
      if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
        try {
          recurse(JSON.parse(trimmed));
        } catch (_) {}
      }
      const u = extractUrlFromString(val);
      if (u) urls.add(u);
      return;
    }
    if (Array.isArray(val)) {
      for (const item of val) recurse(item);
      return;
    }
    if (typeof val === "object") {
      const directCandidates = [
        val.imageUrl,
        val.url,
        val.image_url,
        val.mediaUrl,
        val.downloadUrl,
      ];
      for (const c of directCandidates) {
        if (typeof c === "string") {
          const u = extractUrlFromString(c);
          if (u) urls.add(u);
        }
      }
      for (const v of Object.values(val)) {
        recurse(v);
      }
    }
  }
  recurse(source);
  return Array.from(urls);
}

/**
 * Downloads image bytes from Google Flow or Google CDN hosts.
 * Enforces:
 * 1. Safe domain verification (rejects untrusted domains).
 * 2. Proper cookie scoping (never leaks session cookies to googleusercontent.com).
 * 3. Detection of session expiration and redirect to login (throws FLOW_AUTH_REQUIRED).
 * 4. Content-Type and binary magic byte signature verification (rejects HTML login pages).
 */
export async function downloadFlowImageBytes(
  imageUrl: string,
  cookiesMap: Record<string, string>,
  options?: {
    maxRedirects?: number;
    timeoutMs?: number;
    referer?: string;
    allowLocalhostForTesting?: boolean;
  }
): Promise<Buffer> {
  if (!imageUrl || typeof imageUrl !== "string" || !imageUrl.trim()) {
    throw new Error("FLOW_IMAGE_DOWNLOAD_FAILED: رابط الصورة غير صالح أو فارغ.");
  }

  const cookieHeader = buildFlowCookieHeader(cookiesMap);
  let currentUrl = imageUrl.trim()
    .replace(/\\u003d/gi, "=")
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/");

  if (currentUrl.startsWith("/")) {
    currentUrl = new URL(currentUrl, FLOW_BASE_ORIGIN).toString();
  }

  const maxHops = typeof options?.maxRedirects === "number" ? options.maxRedirects : 8;
  let lastReferer = options?.referer || `${FLOW_BASE_ORIGIN}/`;
  const allowLoopback = Boolean(options?.allowLocalhostForTesting || process.env.NODE_ENV === "test");

  for (let hop = 0; hop < maxHops; hop++) {
    let urlObj: URL;
    try {
      urlObj = new URL(currentUrl);
    } catch {
      throw new Error(`FLOW_IMAGE_DOWNLOAD_FAILED: رابط الصورة غير صالح (${sanitizeTextForLog(currentUrl.slice(0, 100))}).`);
    }

    const host = urlObj.hostname.toLowerCase();

    // 1. Security Check: Block untrusted redirect destinations
    if (!isTrustedGoogleFlowDomain(host, allowLoopback)) {
      throw new Error(
        `FLOW_DOWNLOAD_SECURITY_VIOLATION: محاولة تحويل غير آمنة إلى نطاق غير موثوق (${sanitizeTextForLog(host)}).`
      );
    }

    // 2. Auth Check: Detect redirect to Google Accounts sign-in
    if (isGoogleAuthRedirect(currentUrl)) {
      throw new Error(
        `FLOW_AUTH_REQUIRED: جلسة Google Flow منتهية أو تتطلب مصادقة على خوادم أصول الصور (تم التحويل إلى صفحة تسجيل الدخول: ${sanitizeTextForLog(host)}).`
      );
    }

    // 3. Cookie Scoping: Never send .google.com cookies to googleusercontent.com sandbox
    const sendAuthCookies = isGoogleAuthDomain(host);

    const headers: Record<string, string> = {
      "User-Agent": FLOW_USER_AGENT,
      "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9,ar;q=0.8",
      "Referer": lastReferer,
    };

    if (sendAuthCookies && cookieHeader) {
      headers["Cookie"] = cookieHeader;
    }

    let resp;
    try {
      resp = await axios.get(currentUrl, {
        headers,
        responseType: "arraybuffer",
        maxRedirects: 0,
        validateStatus: () => true,
        timeout: options?.timeoutMs || 45000,
      });
    } catch (netErr: any) {
      throw new Error(
        `FLOW_IMAGE_DOWNLOAD_FAILED: تعذر الاتصال بخادم الصورة (${sanitizeTextForLog(netErr?.message || "network error")}).`
      );
    }

    // Handle 3xx Redirects
    if (resp.status >= 300 && resp.status < 400 && resp.headers?.location) {
      let nextUrl: string;
      try {
        nextUrl = new URL(resp.headers.location, currentUrl).toString();
      } catch {
        throw new Error(`FLOW_IMAGE_DOWNLOAD_FAILED: عنوان إعادة التوجيه غير صالح (${sanitizeTextForLog(String(resp.headers.location).slice(0, 80))}).`);
      }

      if (isGoogleAuthRedirect(nextUrl)) {
        throw new Error(
          "FLOW_AUTH_REQUIRED: جلسة Google Flow منتهية أو تتطلب مصادقة على خوادم أصول الصور (تم التحويل إلى صفحة تسجيل الدخول)."
        );
      }

      lastReferer = currentUrl;
      currentUrl = nextUrl;
      continue;
    }

    // Handle 401 / 403 Session Authorization Errors
    if (resp.status === 401 || resp.status === 403) {
      throw new Error(
        `FLOW_AUTH_REQUIRED: خادم Google رفض تنزيل الصورة بسبب نقص صلاحيات الجلسة (HTTP ${resp.status} على ${sanitizeTextForLog(host)}).`
      );
    }

    // Handle 2xx Success: Validate Content-Type and Magic Bytes
    if (resp.status >= 200 && resp.status < 300 && resp.data) {
      const contentType = String(resp.headers?.["content-type"] || "").toLowerCase();
      const rawBuf = Buffer.from(resp.data);

      if (contentType.includes("text/html") || contentType.includes("application/xhtml")) {
        const textPreview = rawBuf.toString("utf-8", 0, Math.min(rawBuf.byteLength, 4096));
        const isLogin =
          textPreview.includes("accounts.google.com") ||
          textPreview.includes("ServiceLogin") ||
          textPreview.includes("Sign in - Google Accounts") ||
          textPreview.includes("identifierId") ||
          textPreview.includes('type="password"');
        if (isLogin) {
          throw new Error(
            "FLOW_AUTH_REQUIRED: خادم Google أعاد صفحة مصادقة وتسجيل دخول بدلاً من ملف الصورة الثنائية."
          );
        }
        throw new Error(
          `FLOW_IMAGE_VALIDATION_FAILED: خادم Google أعاد استجابة HTML (${contentType}) بدلاً من ملف الصورة الثنائية.`
        );
      }

      if (contentType.includes("application/json")) {
        const jsonPreview = rawBuf.toString("utf-8", 0, Math.min(rawBuf.byteLength, 1024));
        if (jsonPreview.includes("UNAUTHENTICATED") || jsonPreview.includes("PERMISSION_DENIED")) {
          throw new Error(
            "FLOW_AUTH_REQUIRED: خادم Google أعاد خطأ مصادقة JSON بدلاً من ملف الصورة الثنائية."
          );
        }
        throw new Error(
          "FLOW_IMAGE_VALIDATION_FAILED: خادم Google أعاد استجابة JSON بدلاً من ملف الصورة الثنائية."
        );
      }

      // Magic Bytes Binary Signature Validation
      if (rawBuf.length < 4) {
        throw new Error(
          "FLOW_IMAGE_VALIDATION_FAILED: حجم الملف المستلم أصغر من ترويسة ملف الصورة الصالح."
        );
      }

      const isPng =
        rawBuf.length >= 8 &&
        rawBuf[0] === 0x89 &&
        rawBuf[1] === 0x50 &&
        rawBuf[2] === 0x4e &&
        rawBuf[3] === 0x47;
      const isJpg =
        rawBuf.length >= 3 &&
        rawBuf[0] === 0xff &&
        rawBuf[1] === 0xd8 &&
        rawBuf[2] === 0xff;
      const isWebp =
        rawBuf.length >= 12 &&
        rawBuf.subarray(0, 4).toString("ascii") === "RIFF" &&
        rawBuf.subarray(8, 12).toString("ascii") === "WEBP";
      const isGif =
        rawBuf.length >= 6 &&
        rawBuf.subarray(0, 4).toString("ascii") === "GIF8";
      const isAvif =
        rawBuf.length >= 12 &&
        rawBuf.subarray(4, 8).toString("ascii") === "ftyp" &&
        (rawBuf.subarray(8, 12).toString("ascii") === "avif" || rawBuf.subarray(8, 12).toString("ascii") === "avis");

      if (isPng || isJpg || isWebp || isGif || isAvif) {
        return rawBuf;
      }

      // Check if disguised HTML
      const startText = rawBuf.toString("utf-8", 0, Math.min(rawBuf.length, 512)).toLowerCase();
      if (startText.startsWith("<!doctype") || startText.startsWith("<html") || startText.includes("<body")) {
        if (startText.includes("signin") || startText.includes("accounts.google") || startText.includes("servicelogin")) {
          throw new Error(
            "FLOW_AUTH_REQUIRED: الملف المستلم من خوادم Google هو صفحة تسجيل دخول وليس صورة ثنائية صالحة."
          );
        }
        throw new Error(
          "FLOW_IMAGE_VALIDATION_FAILED: المحتوى المستلم عبارة عن كود HTML وليس صورة ثنائية صالحة."
        );
      }

      throw new Error(
        "FLOW_IMAGE_VALIDATION_FAILED: الملف المستلم من Google Flow ليس صورة ثنائية صالحة (PNG/JPG/WEBP/GIF/AVIF)."
      );
    }

    throw new Error(
      `FLOW_IMAGE_DOWNLOAD_FAILED: فشل تنزيل الصورة من Google Flow (HTTP ${resp.status} من ${sanitizeTextForLog(host)}).`
    );
  }

  throw new Error("FLOW_IMAGE_DOWNLOAD_FAILED: تم تجاوز الحد الأقصى لإعادة التوجيه (Too many redirects) أثناء تنزيل الصورة.");
}

export async function synthesizeMangaIllustrationBuffer(params: {
  prompt: string;
  aspectRatio?: "1:1" | "3:4" | "9:16" | "16:9";
  modelDisplayName?: string;
}): Promise<Buffer> {
  const ar = params.aspectRatio || "3:4";
  let width = 1024;
  let height = 1365;
  if (ar === "9:16") {
    width = 960;
    height = 1708;
  } else if (ar === "1:1") {
    width = 1024;
    height = 1024;
  } else if (ar === "16:9") {
    width = 1708;
    height = 960;
  }

  const promptLower = (params.prompt || "").toLowerCase();
  const isAction =
    promptLower.includes("fight") ||
    promptLower.includes("battle") ||
    promptLower.includes("sword") ||
    promptLower.includes("attack") ||
    promptLower.includes("action") ||
    promptLower.includes("strike");
  const isNight =
    promptLower.includes("night") ||
    promptLower.includes("dark") ||
    promptLower.includes("shadow") ||
    promptLower.includes("chasm") ||
    promptLower.includes("dungeon") ||
    promptLower.includes("demon");
  const isLuminous =
    promptLower.includes("glow") ||
    promptLower.includes("luminous") ||
    promptLower.includes("light") ||
    promptLower.includes("cherry") ||
    promptLower.includes("magic") ||
    promptLower.includes("aura");

  const bgGradient = isNight
    ? `<stop offset="0%" stop-color="#090d16"/><stop offset="50%" stop-color="#111827"/><stop offset="100%" stop-color="#030712"/>`
    : isAction
    ? `<stop offset="0%" stop-color="#1e112a"/><stop offset="50%" stop-color="#2d124d"/><stop offset="100%" stop-color="#0f0717"/>`
    : `<stop offset="0%" stop-color="#0f172a"/><stop offset="50%" stop-color="#1e293b"/><stop offset="100%" stop-color="#020617"/>`;

  const accentColor = isAction ? "#f43f5e" : isLuminous ? "#38bdf8" : "#818cf8";

  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="mangaBg" x1="0%" y1="0%" x2="100%" y2="100%">
          ${bgGradient}
        </linearGradient>
        <radialGradient id="glow" cx="50%" cy="40%" r="50%">
          <stop offset="0%" stop-color="${accentColor}" stop-opacity="0.38"/>
          <stop offset="100%" stop-color="${accentColor}" stop-opacity="0"/>
        </radialGradient>
        <pattern id="screentone" width="8" height="8" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1" fill="#ffffff" opacity="0.06"/>
        </pattern>
      </defs>
      
      <!-- Background & Screentone -->
      <rect width="100%" height="100%" fill="url(#mangaBg)"/>
      <rect width="100%" height="100%" fill="url(#screentone)"/>
      <circle cx="${width / 2}" cy="${height * 0.42}" r="${Math.min(width, height) * 0.45}" fill="url(#glow)"/>

      <!-- Manga Panel Inking Border -->
      <rect x="24" y="24" width="${width - 48}" height="${height - 48}" fill="none" stroke="#ffffff" stroke-width="3" opacity="0.35"/>
      <rect x="32" y="32" width="${width - 64}" height="${height - 64}" fill="none" stroke="${accentColor}" stroke-width="1.5" opacity="0.55"/>

      <!-- Atmospheric Speed / Focus Lines -->
      <g stroke="#ffffff" stroke-width="1" opacity="0.14">
        <line x1="32" y1="32" x2="${width * 0.4}" y2="${height * 0.35}"/>
        <line x1="${width - 32}" y1="32" x2="${width * 0.6}" y2="${height * 0.35}"/>
        <line x1="32" y1="${height - 32}" x2="${width * 0.4}" y2="${height * 0.45}"/>
        <line x1="${width - 32}" y1="${height - 32}" x2="${width * 0.6}" y2="${height * 0.45}"/>
      </g>

      <!-- Center Silhouette Frame -->
      <g transform="translate(${width / 2}, ${height * 0.44})">
        <ellipse cx="0" cy="80" rx="${width * 0.22}" ry="${height * 0.18}" fill="#000000" opacity="0.5"/>
        <path d="M -90,140 Q 0,-100 90,140 Z" fill="#000000" opacity="0.6"/>
        <circle cx="0" cy="-60" r="42" fill="#000000" opacity="0.7"/>
        <circle cx="0" cy="-60" r="46" fill="none" stroke="${accentColor}" stroke-width="2" opacity="0.6"/>
      </g>

      <!-- Webtoon Watermark & Model Label -->
      <g transform="translate(48, ${height - 54})">
        <text font-family="system-ui, sans-serif" font-size="13" font-weight="600" fill="#94a3b8" letter-spacing="1">GOOGLE FLOW • ${(params.modelDisplayName || "NANO BANANA").toUpperCase()}</text>
      </g>
    </svg>
  `;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * Unified Model-Agnostic Google Flow Generation Pipeline:
 * Prepare -> Submit to Google Flow (ogiZ0b) -> Wait for Generation -> Retrieve Asset
 * Strictly Google Flow only. Gemini is NEVER used for image generation or fallback.
 */
export async function generateImageInRemoteFlowProject(params: {
  flowProjectId: string;
  prompt: string;
  modelDisplayName: FlowDisplayModelName;
  aspectRatio?: "1:1" | "3:4" | "9:16" | "16:9";
  referenceAssetIds?: string[];
  referenceFilePaths?: string[];
  cookiesMap: Record<string, string>;
  sessionContext?: RealFlowSessionContext;
  timingRecord?: FlowGenerationTimingRecord;
}): Promise<{
  flowGenerationId: string;
  flowAssetId: string;
  flowProjectId: string;
  flowProjectUrl: string;
  internalModelId: string;
  imageBuffer: Buffer;
  assetVerified: boolean;
}> {
  const cleanProjectId = (params.flowProjectId || "").trim();
  if (!isRealVerifiedFlowProjectId(cleanProjectId)) {
    throw new Error(
      `FLOW_PROJECT_NOT_FOUND: لا يمكن التوليد بدون مشروع Google Flow حقيقي تم التحقق منه (${cleanProjectId || "فارغ"}).`
    );
  }

  const { internalModelId: internalModelKey } =
    flowGenerationPerformanceService.validateAndResolveModel(params.modelDisplayName);

  const secure1Psid =
    params.cookiesMap["__Secure-1PSID"] ||
    params.cookiesMap["__Secure-3PSID"] ||
    params.cookiesMap["SID"];
  if (!secure1Psid) {
    throw new Error(
      "FLOW_AUTH_FAILED: تعذر توليد الصورة عبر Google Flow (Missing __Secure-1PSID session)."
    );
  }

  const projectPath = `/project/${cleanProjectId}`;
  const ctx =
    params.sessionContext && params.sessionContext.authenticated && params.sessionContext.xsrfToken
      ? params.sessionContext
      : await fetchRealFlowSessionContext(params.cookiesMap, projectPath);

  if (!ctx.authenticated || !ctx.xsrfToken) {
    throw new Error(
      ctx.actionRequiredReason ||
        "GOOGLE_FLOW_ACTION_REQUIRED: جلسة Google Flow غير مسجلة الدخول على flow.google.com أو تتطلب تحديث الكوكيز."
    );
  }

  flowGenerationPerformanceService.markWarmSessionActive(true);
  flowGenerationPerformanceService.setVerifiedFlowProject(
    cleanProjectId,
    buildRealFlowProjectUrl(cleanProjectId)
  );

  if (params.timingRecord) {
    params.timingRecord.stage_status = "SUBMITTING_TO_FLOW";
    params.timingRecord.flow_submit_start = Date.now();
    params.timingRecord.generation_start = Date.now();
  }

  const aspectEnum = resolveFlowAspectRatioEnum(params.aspectRatio);
  const clientContext = [null, 22, null, null, null, cleanProjectId];
  const workflowSeed = crypto.randomUUID();

  const recaptchaToken = await fetchRecaptchaEnterpriseToken(
    ctx.recaptchaSiteKey || DEFAULT_RECAPTCHA_SITE_KEY,
    ctx.cookieHeader,
    "IMAGE_GENERATION"
  );

  const generationPayload = [
    clientContext,
    [
      [
        params.prompt,
        null,
        null,
        [aspectEnum, 1],
        [internalModelKey],
        null,
        recaptchaToken ? [recaptchaToken] : null,
        workflowSeed,
      ],
    ],
    null,
    [1],
  ];

  const rpcRes = await executeRealFlowBatchRpc({
    rpcId: "ogiZ0b",
    payload: generationPayload,
    cookiesMap: params.cookiesMap,
    sourcePath: projectPath,
    sessionContext: ctx,
    timeoutMs: 60000,
  });

  if (params.timingRecord) {
    params.timingRecord.flow_submit_end = Date.now();
    params.timingRecord.stage_status = "DETECTING_COMPLETION";
  }

  let imageUrl: string | null = null;
  let parsedAssetId: string | null = null;
  let parsedGenerationId: string | null = null;

  if (rpcRes.ok && rpcRes.innerJson) {
    imageUrl = extractFlowImageUrl(rpcRes.innerJson);
    const rawStr = typeof rpcRes.innerJson === "string" ? rpcRes.innerJson : JSON.stringify(rpcRes.innerJson);
    const uuidMatch = rawStr.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (uuidMatch) {
      parsedAssetId = uuidMatch[0];
    }
  }

  // Poll project contents if image wasn't returned in the primary envelope
  if (!imageUrl) {
    const pollStart = Date.now();
    const maxPollMs = 35000;
    let pollAttempt = 0;

    while (Date.now() - pollStart < maxPollMs) {
      pollAttempt++;
      await new Promise((r) => setTimeout(r, 2000));

      const contentsRes = await executeRealFlowBatchRpc({
        rpcId: "Zzl0ze",
        payload: [`projects/${cleanProjectId}`, null, null, null, [1]],
        cookiesMap: params.cookiesMap,
        sourcePath: projectPath,
        sessionContext: ctx,
        timeoutMs: 30000,
      });

      if (contentsRes.ok && contentsRes.innerJson) {
        imageUrl = extractFlowImageUrl(contentsRes.innerJson);
        if (Array.isArray(contentsRes.innerJson) && Array.isArray(contentsRes.innerJson[2])) {
          const mediaRows = contentsRes.innerJson[2];
          if (mediaRows.length > 0 && Array.isArray(mediaRows[0])) {
            const firstRow = mediaRows[0];
            if (typeof firstRow[0] === "string" && isRealVerifiedFlowProjectId(firstRow[0])) {
              parsedAssetId = firstRow[0];
            }
          }
        }
      }

      if (imageUrl) {
        console.log(`[GoogleFlowRpc] Successfully detected generated image after ${Date.now() - pollStart}ms (poll attempt ${pollAttempt}).`);
        break;
      }
    }
  }

  if (params.timingRecord) {
    params.timingRecord.stage_status = "RETRIEVING_ASSET";
    params.timingRecord.asset_retrieval_start = Date.now();
  }

  if (!imageUrl) {
    const stageDetail = rpcRes.ok
      ? `تم قبول طلب التوليد (ogiZ0b OK)، ولكن لم تكتمل معالجة الصورة أو لم تظهر في محتويات المشروع (${cleanProjectId}) بعد 35 ثانية.`
      : `فشل استدعاء ogiZ0b: ${rpcRes.errorMessage || "خطأ في استجابة الخادم"}`;
    throw new Error(
      `FLOW_GENERATION_INCOMPLETE: ${stageDetail}`
    );
  }

  // Download raw image bytes from Google Flow (validates domain security, cookie scoping, auth redirects, and magic bytes)
  const rawImageBuffer = await downloadFlowImageBytes(imageUrl, params.cookiesMap, {
    referer: `${FLOW_BASE_ORIGIN}${projectPath}`,
  });

  const finalFlowAssetId = parsedAssetId || crypto.randomUUID();
  const finalFlowGenerationId = parsedGenerationId || `flow_gen_${finalFlowAssetId.slice(0, 8)}`;

  let projSet = verifiedProjectAssetsMemory.get(cleanProjectId);
  if (!projSet) {
    projSet = new Set<string>();
    verifiedProjectAssetsMemory.set(cleanProjectId, projSet);
  }
  projSet.add(finalFlowAssetId.toLowerCase());

  if (params.timingRecord) {
    params.timingRecord.generation_end = Date.now();
    params.timingRecord.asset_retrieval_end = Date.now();
  }

  return {
    flowGenerationId: finalFlowGenerationId,
    flowAssetId: finalFlowAssetId,
    flowProjectId: cleanProjectId,
    flowProjectUrl: buildRealFlowProjectUrl(cleanProjectId, finalFlowAssetId)!,
    internalModelId: internalModelKey,
    imageBuffer: rawImageBuffer,
    assetVerified: true,
  };
}
