import React, { useState, useEffect } from "react";
import {
  Save,
  Trash2,
  ShieldCheck,
  Loader2,
  KeyRound,
  Database,
  Bot,
  Languages,
  Check,
  Sparkles,
  Image as ImageIcon,
  Github,
  GitBranch,
  UploadCloud,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Terminal,
  Copy,
  RefreshCw,
  FolderGit2,
  AlertCircle
} from "lucide-react";
import { globalEngine, EngineMode } from "../lib/mangaGlobalEngine";
import {
  DEFAULT_USER_FLOW_COOKIES,
  loadFlowCookies,
  loadFlowTaskModels,
  saveFlowCookies,
  saveFlowTaskModels,
  testGoogleFlowConnection,
  testGoogleFlowGeneration,
} from "../services/novelToMangaClient";
import type { FlowDisplayModelName } from "../types/novelToManga";

export const GOOGLE_FLOW_MODEL_OPTIONS: Array<{
  id: FlowDisplayModelName;
  name: string;
  badge: string;
  badgeColor: string;
  desc: string;
}> = [
  {
    id: "Nano Banana 2 Lite",
    name: "Nano Banana 2 Lite (gemini-2.5-flash-image)",
    badge: "⚡ أسرع توليد",
    badgeColor: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    desc: "أقصى سرعة لتوليد صور المواقع والمشاهد في أقل وقت ممكن (~6 ثوانٍ).",
  },
  {
    id: "Nano Banana 2",
    name: "Nano Banana 2 (gemini-3.1-flash-image)",
    badge: "🌟 متوازن",
    badgeColor: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    desc: "توازن مثالي بين السرعة وتفاصيل المشاهد متعددة المراجع.",
  },
  {
    id: "Nano Banana Pro",
    name: "Nano Banana Pro (gemini-3-pro-image)",
    badge: "🎨 فائق الدقة",
    badgeColor: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
    desc: "أعلى دقة بصرية لتثبيت المراجع وتفاصيل الشخصيات والبيئة.",
  },
];

export const GEMINI_COOKIE_OPTIONS = [
  {
    id: "3.5-flash-lite",
    name: "3.5 Flash-Lite",
    badge: "⚡ سريع",
    badgeColor: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    desc: "سرعة قصوى واستجابة فورية.",
    feature: "Extended Thinking: OFF",
  },
  {
    id: "3.5-flash-lite-extended",
    name: "3.5 Flash-Lite (Extended)",
    badge: "🧠 تفكير موسع",
    badgeColor: "bg-purple-500/15 text-purple-300 border-purple-500/30",
    desc: "تفكير موسع للمهام الدقيقة.",
    feature: "Extended Thinking: ON",
  },
  {
    id: "3.6-flash",
    name: "3.6 Flash",
    badge: "🌟 متوازن",
    badgeColor: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    desc: "متوازن للسياق الطويل والحوارات.",
    feature: "Extended Thinking: OFF",
  },
  {
    id: "3.1-pro",
    name: "3.1 Pro",
    badge: "🧠 متقدم",
    badgeColor: "bg-blue-500/15 text-blue-300 border-blue-500/30",
    desc: "للمشاكل المعقدة والاستمرارية.",
    feature: "Extended Thinking: OFF",
  },
];

export default function SettingsPage() {
  // Gemini Cookies states
  const [cookies, setCookies] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [geminiModel, setGeminiModel] = useState<string>(() => {
    return localStorage.getItem("gemini_cookie_model") || "3.6-flash";
  });

  const handleGeminiModelChange = (modelId: string) => {
    setGeminiModel(modelId);
    localStorage.setItem("gemini_cookie_model", modelId);
  };

  // Google Flow Cookies states (Novel -> Manga Image Generation)
  const [flowCookies, setFlowCookies] = useState<string>(() => loadFlowCookies());
  const [isFlowSaving, setIsFlowSaving] = useState(false);
  const [isFlowTesting, setIsFlowTesting] = useState(false);
  const [isFlowGenTesting, setIsFlowGenTesting] = useState(false);
  const [flowTestResult, setFlowTestResult] = useState<{
    success: boolean;
    message: string;
    previewUrl?: string;
  } | null>(null);
  const [flowModel, setFlowModel] = useState<FlowDisplayModelName>(() => {
    return loadFlowTaskModels().scene_generation || "Nano Banana 2 Lite";
  });

  const handleFlowModelChange = (modelName: FlowDisplayModelName) => {
    setFlowModel(modelName);
    const currentMap = loadFlowTaskModels();
    saveFlowTaskModels({
      ...currentMap,
      reference_generation: modelName,
      scene_generation: modelName,
      page_generation: modelName,
    });
  };

  // ChatGPT Cookies states
  const [gptCookies, setGptCookies] = useState("");
  const [isGptSaving, setIsGptSaving] = useState(false);
  const [isGptTesting, setIsGptTesting] = useState(false);
  const [gptTestResult, setGptTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  // Meta AI Cookies states
  const [metaAiCookies, setMetaAiCookies] = useState("");
  const [isMetaAiSaving, setIsMetaAiSaving] = useState(false);
  const [isMetaAiTesting, setIsMetaAiTesting] = useState(false);
  const [metaAiTestResult, setMetaAiTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  // Suwayomi Engine states
  const DEFAULT_SUWAYOMI_URL =
    "https://f212af09-ae8a-4d6f-be1a-59fbca80573e-00-3ctaa6lqfzq7d.sisko.replit.dev";
  const [engineMode, setEngineMode] = useState<EngineMode>("suwayomi");
  const [suwayomiUrl, setSuwayomiUrl] = useState(DEFAULT_SUWAYOMI_URL);
  const [isSuwayomiTesting, setIsSuwayomiTesting] = useState(false);
  const [suwayomiTestResult, setSuwayomiTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  // Default Reader Translator Engine
  const [translatorEngine, setTranslatorEngine] = useState<string>(() => {
    const saved = localStorage.getItem("reader_translator_engine");
    if (saved === "gemini" || saved === "gemini_cookies") {
      const c = localStorage.getItem("gemini_cookies");
      if (c && c.trim()) return "gemini_cookies";
      return "google";
    }
    if (saved === "metaai") return "metaai";
    if (saved === "google") return "google";
    const c = localStorage.getItem("gemini_cookies");
    if (c && c.trim()) return "gemini_cookies";
    return "google";
  });

  const handleTranslatorEngineChange = (engine: string) => {
    setTranslatorEngine(engine);
    localStorage.setItem("reader_translator_engine", engine);
  };

  useEffect(() => {
    const rawSaved = localStorage.getItem("gemini_cookies") || "";
    setCookies(rawSaved);

    const initialFlowCookies = loadFlowCookies();
    setFlowCookies(initialFlowCookies);

    const savedGptCookies = localStorage.getItem("gpt_cookies") || "";
    setGptCookies(savedGptCookies);

    const savedMetaCookies = localStorage.getItem("metaai_cookies") || "";
    setMetaAiCookies(savedMetaCookies);

    const savedSuw =
      localStorage.getItem("suwayomi_server_url") ||
      localStorage.getItem("suwayomi_url");
    if (
      savedSuw &&
      savedSuw.startsWith("http") &&
      savedSuw.includes("f212af09-ae8a")
    ) {
      setSuwayomiUrl(savedSuw);
    } else {
      setSuwayomiUrl(DEFAULT_SUWAYOMI_URL);
      localStorage.setItem("suwayomi_server_url", DEFAULT_SUWAYOMI_URL);
      localStorage.setItem("suwayomi_url", DEFAULT_SUWAYOMI_URL);
    }
    setEngineMode("suwayomi");
    globalEngine.setMode("suwayomi");
    fetchGitStatus();
  }, []);

  // GitHub Integration & Export states
  const [ghUsername, setGhUsername] = useState(() => localStorage.getItem("github_deploy_username") || "");
  const [ghRepo, setGhRepo] = useState(() => localStorage.getItem("github_deploy_repo") || "ai-manga-reader");
  const [ghToken, setGhToken] = useState(() => localStorage.getItem("github_deploy_token") || "");
  const [ghBranch, setGhBranch] = useState(() => localStorage.getItem("github_deploy_branch") || "main");
  const [ghCommitMsg, setGhCommitMsg] = useState("");
  const [showGhToken, setShowGhToken] = useState(false);
  const [isGhPushing, setIsGhPushing] = useState(false);
  const [copiedCli, setCopiedCli] = useState(false);
  const [showCliDetails, setShowCliDetails] = useState(false);
  const [ghResult, setGhResult] = useState<{
    success: boolean;
    message: string;
    repoUrl?: string;
    logs?: string;
  } | null>(null);
  const [gitStatus, setGitStatus] = useState<{
    isGitRepo: boolean;
    branch: string;
    lastCommit: string;
    uncommittedCount: number;
  } | null>(null);
  const [isCheckingGitStatus, setIsCheckingGitStatus] = useState(false);

  const fetchGitStatus = async () => {
    setIsCheckingGitStatus(true);
    try {
      const res = await fetch("/api/github/status");
      const data = await res.json();
      if (data.success) {
        setGitStatus({
          isGitRepo: data.isGitRepo,
          branch: data.branch,
          lastCommit: data.lastCommit,
          uncommittedCount: data.uncommittedCount,
        });
      }
    } catch (err) {
      console.error("Failed to load git status:", err);
    } finally {
      setIsCheckingGitStatus(false);
    }
  };

  const handleGithubPush = async () => {
    if (!ghUsername.trim() || !ghRepo.trim() || !ghToken.trim()) {
      setGhResult({
        success: false,
        message: "يرجى ملء جميع الحقول الإلزامية: اسم المستخدم، اسم المستودع، ورمز الـ Token.",
      });
      return;
    }

    setIsGhPushing(true);
    setGhResult(null);

    localStorage.setItem("github_deploy_username", ghUsername.trim());
    localStorage.setItem("github_deploy_repo", ghRepo.trim());
    localStorage.setItem("github_deploy_token", ghToken.trim());
    localStorage.setItem("github_deploy_branch", ghBranch.trim() || "main");

    try {
      const response = await fetch("/api/github/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: ghUsername.trim(),
          repo: ghRepo.trim(),
          token: ghToken.trim(),
          branch: ghBranch.trim() || "main",
          commitMessage: ghCommitMsg.trim() || "تحديث كود مشروع AI Manga Reader",
        }),
      });

      const data = await response.json();
      if (data.success) {
        setGhResult({
          success: true,
          message: data.message || "تم رفع المشروع بنجاح إلى GitHub!",
          repoUrl: data.repoUrl,
          logs: data.logs,
        });
        fetchGitStatus();
      } else {
        setGhResult({
          success: false,
          message: data.error || "فشل الدفع إلى GitHub.",
          logs: data.logs,
        });
      }
    } catch (e: any) {
      setGhResult({
        success: false,
        message: e.message || "حدث خطأ غير متوقع أثناء محاولة الدفع إلى GitHub.",
      });
    } finally {
      setIsGhPushing(false);
    }
  };

  const handleDownloadArchive = () => {
    window.location.href = "/api/project/export-archive";
  };

  const copyCliCommand = () => {
    const cmd = `./push_to_github.sh "${ghUsername || "<username>"}" "${ghRepo || "ai-manga-reader"}" "${ghToken || "<token>"}" "${ghBranch || "main"}"`;
    navigator.clipboard.writeText(cmd);
    setCopiedCli(true);
    setTimeout(() => setCopiedCli(false), 2500);
  };

  const handleSave = async () => {
    setIsSaving(true);
    const encoded = btoa(unescape(encodeURIComponent(cookies)));
    localStorage.setItem("gemini_cookies_encoded", encoded);
    localStorage.setItem("gemini_cookies", cookies);
    await new Promise((r) => setTimeout(r, 400));
    setIsSaving(false);
    setTestResult({
      success: true,
      message: "تم حفظ ملفات تعريف الارتباط لـ Gemini AI بنجاح!",
    });
  };

  const handleDelete = () => {
    localStorage.removeItem("gemini_cookies");
    localStorage.removeItem("gemini_cookies_encoded");
    localStorage.removeItem("gemini_cookies_status");
    setCookies("");
    setTestResult(null);
  };

  const handleTest = async () => {
    if (!cookies.trim()) {
      setTestResult({
        success: false,
        message: "يرجى إدخال ملفات تعريف الارتباط أولاً.",
      });
      return;
    }

    setIsTesting(true);
    setTestResult(null);
    try {
      const response = await fetch("/api/manga/test-cookies", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ cookies, model: geminiModel }),
      });

      const data = await response.json().catch(() => null);
      if (response.ok && data?.success !== false) {
        localStorage.setItem("gemini_cookies_status", "Connected");
        setTestResult({
          success: true,
          message: data?.message || "تم الاتصال بنجاح بـ Gemini AI!",
        });
      } else {
        setTestResult({
          success: false,
          message:
            data?.error ||
            "فشل الاتصال، تأكد من صلاحية ملفات تعريف الارتباط.",
        });
      }
    } catch (e: any) {
      setTestResult({
        success: false,
        message: e.message || "حدث خطأ غير متوقع أثناء الاتصال.",
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleFlowSave = async () => {
    setIsFlowSaving(true);
    saveFlowCookies(flowCookies);
    try {
      const data = await testGoogleFlowConnection(flowCookies);
      const realId =
        data?.diagnostics?.selected_active_project_id ||
        data?.diagnostics?.active_project_id ||
        null;
      setIsFlowSaving(false);
      setFlowTestResult({
        success: Boolean(data?.success),
        message: data?.success
          ? `تم حفظ الكوكيز وربط مشروع Google Flow الحقيقي بنجاح (${realId || "متصل"})!`
          : data?.message || "تم حفظ الكوكيز في المتصفح. يرجى التحقق من وجود مشروع Google Flow حقيقي في حسابك.",
      });
    } catch (_) {
      setIsFlowSaving(false);
      setFlowTestResult({
        success: true,
        message: "تم حفظ ملفات تعريف الارتباط لـ Google Flow بنجاح!",
      });
    }
  };

  const handleFlowDelete = () => {
    localStorage.removeItem("google_flow_cookies");
    setFlowCookies("");
    setFlowTestResult(null);
  };

  const handleFlowTest = async () => {
    if (!flowCookies.trim()) {
      setFlowTestResult({
        success: false,
        message: "يرجى إدخال ملفات تعريف الارتباط لـ Google Flow أولاً.",
      });
      return;
    }

    setIsFlowTesting(true);
    setFlowTestResult(null);
    try {
      saveFlowCookies(flowCookies);
      const data = await testGoogleFlowConnection(flowCookies);
      if (data?.success) {
        const activeCount =
          data?.diagnostics?.FLOW_ACTIVE_PROJECTS_COUNT ||
          (Array.isArray(data?.projects)
            ? data.projects.filter((p: any) => p.status === "ACTIVE").length
            : 1);
        const realProjectId =
          data?.diagnostics?.selected_active_project_id ||
          data?.diagnostics?.active_project_id ||
          "";
        setFlowTestResult({
          success: true,
          message:
            data.message ||
            `تم الاتصال بنجاح بـ Google Flow! (${activeCount} مشاريع حقيقية نشطة — المشروع النشط: ${realProjectId})`,
        });
      } else {
        setFlowTestResult({
          success: false,
          message:
            data?.message ||
            data?.error ||
            "FLOW_PROJECT_NOT_FOUND: فشل الاتصال أو لم يتم العثور على مشروع حقيقي في Google Flow.",
        });
      }
    } catch (e: any) {
      setFlowTestResult({
        success: false,
        message: e.message || "حدث خطأ غير متوقع أثناء فحص جلسة Google Flow.",
      });
    } finally {
      setIsFlowTesting(false);
    }
  };

  const handleFlowTestGeneration = async () => {
    if (!flowCookies.trim()) {
      setFlowTestResult({
        success: false,
        message: "يرجى إدخال ملفات تعريف الارتباط لـ Google Flow أولاً.",
      });
      return;
    }

    setIsFlowGenTesting(true);
    setFlowTestResult(null);
    try {
      saveFlowCookies(flowCookies);
      const res = await testGoogleFlowGeneration({
        flowCookies,
        modelDisplayName: flowModel,
      });
      if (res?.success) {
        setFlowTestResult({
          success: true,
          message:
            res.message ||
            `تم اختبار توليد الصور بنجاح داخل مشروع Google Flow الحقيقي (${res.flowProjectId || flowModel})!`,
          previewUrl: res.public_url || undefined,
        });
      } else {
        setFlowTestResult({
          success: false,
          message: res?.error || res?.message || "FLOW_GENERATION_FAILED: فشل اختبار توليد الصورة عبر Google Flow.",
        });
      }
    } catch (e: any) {
      setFlowTestResult({
        success: false,
        message: e.message || "حدث خطأ أثناء اختبار توليد الصورة.",
      });
    } finally {
      setIsFlowGenTesting(false);
    }
  };

  const handleGptSave = async () => {
    setIsGptSaving(true);
    const encoded = btoa(unescape(encodeURIComponent(gptCookies)));
    localStorage.setItem("gpt_cookies_encoded", encoded);
    localStorage.setItem("gpt_cookies", gptCookies);
    await new Promise((r) => setTimeout(r, 400));
    setIsGptSaving(false);
    setGptTestResult({
      success: true,
      message: "تم حفظ ملفات تعريف ارتباط ChatGPT بنجاح!",
    });
  };

  const handleGptDelete = () => {
    localStorage.removeItem("gpt_cookies");
    localStorage.removeItem("gpt_cookies_encoded");
    setGptCookies("");
    setGptTestResult(null);
  };

  const handleGptTest = async () => {
    if (!gptCookies.trim()) {
      setGptTestResult({
        success: false,
        message: "يرجى إدخال ملفات تعريف الارتباط لحساب ChatGPT أولاً.",
      });
      return;
    }

    setIsGptTesting(true);
    setGptTestResult(null);
    try {
      const response = await fetch("/api/manga/test-gpt-cookies", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ cookies: gptCookies }),
      });

      const data = await response.json().catch(() => null);
      if (response.ok && data?.success !== false) {
        setGptTestResult({
          success: true,
          message:
            data?.message || "تم الاتصال وحصلنا على رمز الوصول بنجاح!",
        });
      } else {
        setGptTestResult({
          success: false,
          message:
            data?.error ||
            "فشل الاتصال، تأكد من صلاحية ملفات تعريف الارتباط لحساب ChatGPT.",
        });
      }
    } catch (e: any) {
      setGptTestResult({
        success: false,
        message: e.message || "حدث خطأ غير متوقع أثناء الاتصال.",
      });
    } finally {
      setIsGptTesting(false);
    }
  };

  const handleMetaAiSave = async () => {
    setIsMetaAiSaving(true);
    localStorage.setItem("metaai_cookies", metaAiCookies);
    await new Promise((r) => setTimeout(r, 400));
    setIsMetaAiSaving(false);
    setMetaAiTestResult({
      success: true,
      message: "تم حفظ ملفات تعريف ارتباط Meta AI بنجاح!",
    });
  };

  const handleMetaAiDelete = () => {
    localStorage.removeItem("metaai_cookies");
    setMetaAiCookies("");
    setMetaAiTestResult(null);
  };

  const handleMetaAiTest = async () => {
    if (!metaAiCookies.trim()) {
      setMetaAiTestResult({
        success: false,
        message: "يرجى إدخال ملفات تعريف الارتباط لـ Meta AI أولاً.",
      });
      return;
    }

    setIsMetaAiTesting(true);
    setMetaAiTestResult(null);
    try {
      const response = await fetch("/api/manga/test-metaai-cookies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookies: metaAiCookies }),
      });
      const data = await response.json().catch(() => null);
      if (response.ok && data?.success !== false) {
        setMetaAiTestResult({
          success: true,
          message: data?.message || "تم الاتصال بـ Meta AI بنجاح!",
        });
      } else {
        setMetaAiTestResult({
          success: false,
          message: data?.error || "فشل الاتصال بـ Meta AI.",
        });
      }
    } catch (e: any) {
      setMetaAiTestResult({
        success: false,
        message: e.message || "حدث خطأ غير متوقع أثناء الاتصال.",
      });
    } finally {
      setIsMetaAiTesting(false);
    }
  };

  const handleEngineChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newMode = e.target.value as EngineMode;
    setEngineMode(newMode);
    globalEngine.setMode(newMode);
  };

  const handleSuwayomiUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSuwayomiUrl(val);
    localStorage.setItem("suwayomi_server_url", val);
    localStorage.setItem("suwayomi_url", val);
  };

  const handleTestSuwayomi = async () => {
    setIsSuwayomiTesting(true);
    setSuwayomiTestResult(null);
    try {
      const resp = await fetch("/api/suwayomi/status", {
        headers: { "x-suwayomi-url": suwayomiUrl.trim() },
      });
      const data = await resp.json();
      if (data.online) {
        setSuwayomiTestResult({
          success: true,
          message: `تم الاتصال بنجاح بخادم Suwayomi (${data.sourcesCount || 0} مصادر نشطة)`,
        });
      } else {
        setSuwayomiTestResult({
          success: false,
          message:
            data.error || data.message || "تعذر الاتصال بخادم Suwayomi.",
        });
      }
    } catch (e: any) {
      setSuwayomiTestResult({
        success: false,
        message: e.message || "فشل الاتصال بخادم Suwayomi.",
      });
    } finally {
      setIsSuwayomiTesting(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8 pb-24" dir="rtl">
      <div className="flex flex-col gap-12">
        {/* GitHub Deployment & Project Export Section */}
        <div className="flex flex-col gap-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl font-extrabold text-white tracking-tight sm:text-3xl flex items-center gap-2">
                <Github className="h-7 w-7 text-white" />
                <span>رفع ودفع المشروع إلى GitHub والتصدير</span>
              </h1>
              <p className="mt-2 text-xs text-slate-400">
                اربط مستودعك على GitHub وادفع كامل الكود بضغطة زر واحدة، أو نزّل أرشيف الكود كاملاً كملف مضغوط.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleDownloadArchive}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold transition active:scale-95 cursor-pointer shadow-sm"
                title="تنزيل نسخة نظيفة من كامل المشروع بدون node_modules"
              >
                <Download className="h-4 w-4 text-emerald-400" />
                <span>تنزيل أرشيف المشروع (.tar.gz)</span>
              </button>
            </div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 flex flex-col gap-6 shadow-xl">
            {/* Git Status Badge Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-slate-950/70 border border-slate-800/80 rounded-xl">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="flex items-center gap-1.5 text-xs text-slate-400 font-semibold">
                  <FolderGit2 className="h-4 w-4 text-emerald-400" />
                  <span>حالة المستودع:</span>
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                    مستودع Git مفعل وجاهز
                  </span>
                </span>

                <span className="flex items-center gap-1.5 text-xs text-slate-400 font-semibold">
                  <GitBranch className="h-3.5 w-3.5 text-indigo-400" />
                  <span>الفرع:</span>
                  <span className="px-2 py-0.5 rounded-md font-mono text-[11px] bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                    {gitStatus?.branch || "main"}
                  </span>
                </span>

                {gitStatus?.uncommittedCount !== undefined && (
                  <span className="text-[11px] text-slate-400">
                    ({gitStatus.uncommittedCount === 0 ? "كل الملفات محفوظة ومُلتزم بها" : `${gitStatus.uncommittedCount} ملفات معدلة جاهزة للرفع`})
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={fetchGitStatus}
                disabled={isCheckingGitStatus}
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition cursor-pointer disabled:opacity-50"
                title="إعادة فحص حالة Git"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isCheckingGitStatus ? "animate-spin text-emerald-400" : ""}`} />
                <span>تحديث الفحص</span>
              </button>
            </div>

            {/* Inputs Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* GitHub Username */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-300 flex items-center justify-between">
                  <span>اسم المستخدم في GitHub:</span>
                  <span className="text-[10px] text-slate-500 font-normal">مثال: octocat</span>
                </label>
                <input
                  type="text"
                  dir="ltr"
                  value={ghUsername}
                  onChange={(e) => setGhUsername(e.target.value)}
                  placeholder="اسم حسابك على GitHub"
                  className="w-full p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-200 focus:border-emerald-500 focus:outline-none transition"
                />
              </div>

              {/* GitHub Repository Name */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-300 flex items-center justify-between">
                  <span>اسم المستودع (Repository Name):</span>
                  <span className="text-[10px] text-slate-500 font-normal">مثال: ai-manga-reader</span>
                </label>
                <input
                  type="text"
                  dir="ltr"
                  value={ghRepo}
                  onChange={(e) => setGhRepo(e.target.value)}
                  placeholder="ai-manga-reader"
                  className="w-full p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-200 focus:border-emerald-500 focus:outline-none transition"
                />
              </div>

              {/* Personal Access Token (PAT) */}
              <div className="flex flex-col gap-1.5 md:col-span-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                    <KeyRound className="h-3.5 w-3.5 text-amber-400" />
                    <span>رمز الوصول الشخصي (GitHub Personal Access Token - PAT):</span>
                  </label>
                  <a
                    href="https://github.com/settings/tokens/new?scopes=repo&description=AI+Manga+Reader+Deploy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1 hover:underline transition"
                  >
                    <span>إنشاء رمز جديد على GitHub الآن</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>

                <div className="relative">
                  <input
                    type={showGhToken ? "text" : "password"}
                    dir="ltr"
                    value={ghToken}
                    onChange={(e) => setGhToken(e.target.value)}
                    placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    className="w-full p-3 pl-10 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-200 focus:border-emerald-500 focus:outline-none transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowGhToken(!showGhToken)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 cursor-pointer p-1"
                    title={showGhToken ? "إخفاء الرمز" : "إظهار الرمز"}
                  >
                    {showGhToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  ⚠️ <strong className="text-slate-300">ملاحظة هامة:</strong> يتطلب GitHub استخدام رمز وصول شخصي (Token يبدأ بـ <code className="text-emerald-300 font-mono">ghp_</code>) بصلاحية <code className="text-emerald-300 font-mono">repo</code> كاملة، ولا يقبل كلمات المرور التقليدية للحسابات منذ عام 2021.
                </p>
              </div>

              {/* Branch */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-300">
                  الفرع المستهدف (Branch):
                </label>
                <input
                  type="text"
                  dir="ltr"
                  value={ghBranch}
                  onChange={(e) => setGhBranch(e.target.value)}
                  placeholder="main"
                  className="w-full p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-200 focus:border-emerald-500 focus:outline-none transition"
                />
              </div>

              {/* Commit Message */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-300">
                  رسالة التحديث (Commit Message):
                </label>
                <input
                  type="text"
                  value={ghCommitMsg}
                  onChange={(e) => setGhCommitMsg(e.target.value)}
                  placeholder="تحديث كامل كود AI Manga Reader"
                  className="w-full p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none transition"
                />
              </div>
            </div>

            {/* Actions Bar */}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="button"
                onClick={handleGithubPush}
                disabled={isGhPushing || !ghUsername.trim() || !ghRepo.trim() || !ghToken.trim()}
                className="flex items-center gap-2 px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition active:scale-95 disabled:opacity-50 cursor-pointer shadow-lg shadow-emerald-600/20"
              >
                {isGhPushing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>جاري تحضير ورفع المشروع إلى GitHub...</span>
                  </>
                ) : (
                  <>
                    <UploadCloud className="h-4 w-4" />
                    <span>🚀 رفع ودفع المشروع إلى GitHub الآن</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => setShowCliDetails(!showCliDetails)}
                className="flex items-center gap-2 px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold border border-slate-700 transition active:scale-95 cursor-pointer mr-auto"
              >
                <Terminal className="h-4 w-4 text-slate-400" />
                <span>{showCliDetails ? "إخفاء أمر الطرفية (CLI)" : "عرض أمر الطرفية (Terminal CLI)"}</span>
              </button>
            </div>

            {/* CLI Command Box */}
            {showCliDetails && (
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                    <Terminal className="h-4 w-4 text-emerald-400" />
                    <span>يمكنك أيضاً تشغيل السكربت يدوياً في سطر الأوامر (Terminal):</span>
                  </span>
                  <button
                    type="button"
                    onClick={copyCliCommand}
                    className="flex items-center gap-1 px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] transition cursor-pointer"
                  >
                    {copiedCli ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                    <span>{copiedCli ? "تم النسخ!" : "نسخ الأمر"}</span>
                  </button>
                </div>

                <div className="p-3 bg-slate-900 rounded-lg text-xs font-mono text-emerald-300 overflow-x-auto select-all" dir="ltr">
                  ./push_to_github.sh "{ghUsername || "<username>"}" "{ghRepo || "ai-manga-reader"}" "{ghToken || "<token>"}" "{ghBranch || "main"}"
                </div>

                <div className="text-[11px] text-slate-400 leading-relaxed flex flex-col gap-1">
                  <span>1. تأكد من إنشاء مستودع فارغ في حسابك: <a href="https://github.com/new" target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">github.com/new</a> باسم <strong className="text-slate-300">{ghRepo || "ai-manga-reader"}</strong>.</span>
                  <span>2. السكربت يقوم تلقائياً بتهيئة Git وتخطي المجلدات الكبيرة (<code className="text-slate-300">node_modules</code> و <code className="text-slate-300">.venv</code>)، وإعداد buffers الشبكة.</span>
                </div>
              </div>
            )}

            {/* Push Execution Results */}
            {ghResult && (
              <div
                className={`p-4 rounded-xl border flex flex-col gap-3 ${
                  ghResult.success
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                    : "bg-red-500/10 border-red-500/30 text-red-300"
                }`}
              >
                <div className="flex items-start gap-3">
                  {ghResult.success ? (
                    <ShieldCheck className="h-5 w-5 mt-0.5 shrink-0 text-emerald-400" />
                  ) : (
                    <AlertCircle className="h-5 w-5 mt-0.5 shrink-0 text-red-400" />
                  )}
                  <div className="flex-1">
                    <strong className="block text-sm mb-1 font-bold">
                      {ghResult.success ? "نجحت عملية الرفع إلى GitHub!" : "تنبيه: فشل الدفع إلى GitHub"}
                    </strong>
                    <p className="text-xs leading-relaxed">{ghResult.message}</p>
                    {ghResult.repoUrl && (
                      <div className="mt-2.5">
                        <a
                          href={ghResult.repoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition shadow-sm"
                        >
                          <span>عرض المستودع على GitHub</span>
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </div>
                    )}
                  </div>
                </div>

                {ghResult.logs && (
                  <details className="mt-2 text-xs">
                    <summary className="cursor-pointer text-slate-400 hover:text-slate-200 font-semibold mb-1">
                      عرض سجلات Git التفصيلية (Logs)
                    </summary>
                    <pre className="p-3 bg-slate-950/90 rounded-lg text-[11px] font-mono text-slate-300 whitespace-pre-wrap max-h-48 overflow-y-auto" dir="ltr">
                      {ghResult.logs}
                    </pre>
                  </details>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Gemini AI Settings (Classic View) */}
        <div className="flex flex-col gap-6">
          <div>
            <h1 className="font-display text-2xl font-extrabold text-white tracking-tight sm:text-3xl flex items-center gap-2">
              <KeyRound className="h-6 w-6 text-emerald-400" />
              إعدادات Gemini AI
            </h1>
            <p className="mt-2 text-xs text-slate-500">
              قم بضبط إعدادات الوصول إلى Gemini AI باستخدام ملفات تعريف الارتباط (Cookies) للحصول على أداء فائق في الترجمة.
            </p>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 flex flex-col gap-6">
            {/* Gemini Cookie Model Selector */}
            <div className="flex flex-col gap-3">
              <label className="text-sm font-bold text-slate-300 flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-emerald-400" />
                <span>اختر نموذج Gemini المفضل (عبر الكوكيز):</span>
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {GEMINI_COOKIE_OPTIONS.map((opt) => {
                  const isSelected = geminiModel === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handleGeminiModelChange(opt.id)}
                      className={`p-3.5 rounded-xl border text-right transition flex flex-col gap-1.5 cursor-pointer ${
                        isSelected
                          ? "bg-emerald-500/15 border-emerald-500 text-white shadow-lg shadow-emerald-500/5"
                          : "bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-xs text-white">
                          {opt.name}
                        </span>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${opt.badgeColor}`}
                        >
                          {opt.badge}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400">{opt.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <label className="text-sm font-bold text-slate-300">
                مربع إدخال ملفات تعريف الارتباط (Cookies)
              </label>
              <textarea
                dir="ltr"
                value={cookies}
                onChange={(e) => setCookies(e.target.value)}
                placeholder={`# Netscape HTTP Cookie File\n\n.google.com\tTRUE\t/\tFALSE\t1792536260\t__Secure-1PSID\t...`}
                className="w-full h-64 p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-300 focus:border-emerald-500 focus:outline-none resize-y"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                {isSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save Cookies
              </button>
              <button
                type="button"
                onClick={handleTest}
                disabled={isTesting || !cookies.trim()}
                className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm border border-slate-700 transition active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                {isTesting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="h-4 w-4" />
                )}
                Test Cookies
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-red-950 hover:bg-red-900 text-red-400 font-bold text-sm border border-red-900/30 transition active:scale-95 mr-auto cursor-pointer"
              >
                <Trash2 className="h-4 w-4" />
                Delete Cookies
              </button>
            </div>

            {testResult && (
              <div
                className={`p-4 rounded-xl border flex items-start gap-3 ${
                  testResult.success
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                    : "bg-red-500/10 border-red-500/30 text-red-400"
                }`}
              >
                {testResult.success ? (
                  <ShieldCheck className="h-5 w-5 mt-0.5 shrink-0" />
                ) : (
                  <span className="h-5 w-5 mt-0.5 text-lg leading-none shrink-0">
                    ⚠️
                  </span>
                )}
                <div>
                  <strong className="block text-sm mb-1">
                    {testResult.success ? "نجاح العملية" : "تنبيه"}
                  </strong>
                  <p className="text-xs">{testResult.message}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Google Flow Cookies Settings (Classic View for Novel -> Manga) */}
        <div className="flex flex-col gap-6">
          <div>
            <h1 className="font-display text-2xl font-extrabold text-white tracking-tight sm:text-3xl flex items-center gap-2">
              <ImageIcon className="h-6 w-6 text-indigo-400" />
              إعدادات Google Flow (توليد صور الرواية → مانجا)
            </h1>
            <p className="mt-2 text-xs text-slate-500">
              قم بضبط ملفات تعريف الارتباط (Cookies) الخاصة بـ Google Flow لتوليد صور المواقع والمشاهد وصفحات المانجا بأقصى سرعة ودقة.
            </p>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 flex flex-col gap-6">
            {/* Google Flow Model Selector */}
            <div className="flex flex-col gap-3">
              <label className="text-sm font-bold text-slate-300 flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-indigo-400" />
                <span>اختر نموذج التوليد الافتراضي في Google Flow:</span>
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {GOOGLE_FLOW_MODEL_OPTIONS.map((opt) => {
                  const isSelected = flowModel === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handleFlowModelChange(opt.id)}
                      className={`p-3.5 rounded-xl border text-right transition flex flex-col gap-1.5 cursor-pointer ${
                        isSelected
                          ? "bg-indigo-500/15 border-indigo-500 text-white shadow-lg shadow-indigo-500/5"
                          : "bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-xs text-white">
                          {opt.id}
                        </span>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${opt.badgeColor}`}
                        >
                          {opt.badge}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400">{opt.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <label className="text-sm font-bold text-slate-300">
                مربع إدخال ملفات تعريف الارتباط لـ Google Flow (Cookies)
              </label>
              <textarea
                dir="ltr"
                value={flowCookies}
                onChange={(e) => setFlowCookies(e.target.value)}
                placeholder={`# Netscape HTTP Cookie File\n\n.google.com\tTRUE\t/\tTRUE\t1825356318\t__Secure-1PSID\t...\nflow.google.com\tFALSE\t/\tTRUE\t1825356617\t__Secure-OSID\t...`}
                className="w-full h-64 p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-300 focus:border-indigo-500 focus:outline-none resize-y"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleFlowSave}
                disabled={isFlowSaving}
                className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm transition active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                {isFlowSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save Flow Cookies
              </button>
              <button
                type="button"
                onClick={handleFlowTest}
                disabled={isFlowTesting || !flowCookies.trim()}
                className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm border border-slate-700 transition active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                {isFlowTesting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="h-4 w-4" />
                )}
                Test Flow Cookies
              </button>
              <button
                type="button"
                onClick={handleFlowTestGeneration}
                disabled={isFlowGenTesting || !flowCookies.trim()}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-950/80 hover:bg-emerald-900/80 text-emerald-300 font-bold text-sm border border-emerald-700/40 transition active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                {isFlowGenTesting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                اختبار توليد صورة سريع
              </button>
              <button
                type="button"
                onClick={handleFlowDelete}
                className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-red-950 hover:bg-red-900 text-red-400 font-bold text-sm border border-red-900/30 transition active:scale-95 mr-auto cursor-pointer"
              >
                <Trash2 className="h-4 w-4" />
                Delete Flow Cookies
              </button>
            </div>

            {flowTestResult && (
              <div
                className={`p-4 rounded-xl border flex flex-col gap-3 ${
                  flowTestResult.success
                    ? "bg-indigo-500/10 border-indigo-500/30 text-indigo-300"
                    : "bg-red-500/10 border-red-500/30 text-red-400"
                }`}
              >
                <div className="flex items-start gap-3">
                  {flowTestResult.success ? (
                    <ShieldCheck className="h-5 w-5 mt-0.5 shrink-0 text-emerald-400" />
                  ) : (
                    <span className="h-5 w-5 mt-0.5 text-lg leading-none shrink-0">
                      ⚠️
                    </span>
                  )}
                  <div>
                    <strong className="block text-sm mb-1">
                      {flowTestResult.success ? "نجاح فحص Google Flow" : "تنبيه"}
                    </strong>
                    <p className="text-xs">{flowTestResult.message}</p>
                  </div>
                </div>
                {flowTestResult.previewUrl && (
                  <div className="mt-1">
                    <img
                      src={flowTestResult.previewUrl}
                      alt="Flow Test Output"
                      className="h-36 w-auto rounded-lg border border-indigo-500/30 object-cover"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ChatGPT Multimodal TTS Settings (Classic View) */}
        <div className="flex flex-col gap-6">
          <div>
            <h1 className="font-display text-2xl font-extrabold text-white tracking-tight sm:text-3xl flex items-center gap-2">
              <KeyRound className="h-6 w-6 text-purple-400" />
              إعدادات ChatGPT Multimodal TTS
            </h1>
            <p className="mt-2 text-xs text-slate-500">
              قم بضبط إعدادات الوصول إلى حساب ChatGPT الخاص بك باستخدام ملفات تعريف الارتباط (Cookies) لتشغيل ميزة النطق الصوتي الفائق الواقعية والذكية.
            </p>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 flex flex-col gap-6">
            <div className="flex flex-col gap-3">
              <label className="text-sm font-bold text-slate-300">
                مربع إدخال ملفات تعريف الارتباط لـ ChatGPT (Cookies)
              </label>
              <textarea
                dir="ltr"
                value={gptCookies}
                onChange={(e) => setGptCookies(e.target.value)}
                placeholder={`# Netscape HTTP Cookie File\n\n.chatgpt.com\tTRUE\t/\tTRUE\t1799801739\toai-did\t6fabe2d1-8c3d-4414-aec2-ee11f424f8bd...`}
                className="w-full h-64 p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-300 focus:border-purple-500 focus:outline-none resize-y"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleGptSave}
                disabled={isGptSaving}
                className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-bold text-sm transition active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                {isGptSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save ChatGPT Cookies
              </button>
              <button
                type="button"
                onClick={handleGptTest}
                disabled={isGptTesting || !gptCookies.trim()}
                className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm border border-slate-700 transition active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                {isGptTesting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="h-4 w-4" />
                )}
                Test ChatGPT Cookies
              </button>
              <button
                type="button"
                onClick={handleGptDelete}
                className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-red-950 hover:bg-red-900 text-red-400 font-bold text-sm border border-red-900/30 transition active:scale-95 mr-auto cursor-pointer"
              >
                <Trash2 className="h-4 w-4" />
                Delete ChatGPT Cookies
              </button>
            </div>

            {gptTestResult && (
              <div
                className={`p-4 rounded-xl border flex items-start gap-3 ${
                  gptTestResult.success
                    ? "bg-purple-500/10 border-purple-500/30 text-purple-400"
                    : "bg-red-500/10 border-red-500/30 text-red-400"
                }`}
              >
                {gptTestResult.success ? (
                  <ShieldCheck className="h-5 w-5 mt-0.5 shrink-0" />
                ) : (
                  <span className="h-5 w-5 mt-0.5 text-lg leading-none shrink-0">
                    ⚠️
                  </span>
                )}
                <div>
                  <strong className="block text-sm mb-1">
                    {gptTestResult.success ? "نجاح العملية" : "تنبيه"}
                  </strong>
                  <p className="text-xs">{gptTestResult.message}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Meta AI Cookies Settings (Classic View) */}
        <div className="flex flex-col gap-6">
          <div>
            <h1 className="font-display text-2xl font-extrabold text-white tracking-tight sm:text-3xl flex items-center gap-2">
              <Bot className="h-6 w-6 text-blue-400" />
              إعدادات Meta AI للترجمة السريعة
            </h1>
            <p className="mt-2 text-xs text-slate-500">
              قم بإدخال ملفات تعريف الارتباط (Cookies) الخاصة بـ Meta AI لتفعيل الترجمة المجانية السريعة للفصول.
            </p>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 flex flex-col gap-6">
            <div className="flex flex-col gap-3">
              <label className="text-sm font-bold text-slate-300">
                مربع إدخال ملفات تعريف الارتباط لـ Meta AI (Cookies)
              </label>
              <textarea
                dir="ltr"
                value={metaAiCookies}
                onChange={(e) => setMetaAiCookies(e.target.value)}
                placeholder={`datr=...; abra_sess=...; wd=...`}
                className="w-full h-48 p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-300 focus:border-blue-500 focus:outline-none resize-y"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleMetaAiSave}
                disabled={isMetaAiSaving}
                className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm transition active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                {isMetaAiSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save Meta AI Cookies
              </button>
              <button
                type="button"
                onClick={handleMetaAiTest}
                disabled={isMetaAiTesting || !metaAiCookies.trim()}
                className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm border border-slate-700 transition active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                {isMetaAiTesting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="h-4 w-4" />
                )}
                Test Meta AI Cookies
              </button>
              <button
                type="button"
                onClick={handleMetaAiDelete}
                className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-red-950 hover:bg-red-900 text-red-400 font-bold text-sm border border-red-900/30 transition active:scale-95 mr-auto cursor-pointer"
              >
                <Trash2 className="h-4 w-4" />
                Delete Meta AI Cookies
              </button>
            </div>

            {metaAiTestResult && (
              <div
                className={`p-4 rounded-xl border flex items-start gap-3 ${
                  metaAiTestResult.success
                    ? "bg-blue-500/10 border-blue-500/30 text-blue-400"
                    : "bg-red-500/10 border-red-500/30 text-red-400"
                }`}
              >
                {metaAiTestResult.success ? (
                  <ShieldCheck className="h-5 w-5 mt-0.5 shrink-0" />
                ) : (
                  <span className="h-5 w-5 mt-0.5 text-lg leading-none shrink-0">
                    ⚠️
                  </span>
                )}
                <div>
                  <strong className="block text-sm mb-1">
                    {metaAiTestResult.success ? "نجاح العملية" : "تنبيه"}
                  </strong>
                  <p className="text-xs">{metaAiTestResult.message}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Default Translator Engine & Suwayomi Server Settings */}
        <div className="flex flex-col gap-6">
          <div>
            <h1 className="font-display text-2xl font-extrabold text-white tracking-tight sm:text-3xl flex items-center gap-2">
              <Languages className="h-6 w-6 text-emerald-400" />
              إعدادات الترجمة ومحرك المصادر
            </h1>
            <p className="mt-2 text-xs text-slate-500">
              اختر محرك الترجمة الافتراضي داخل القارئ واضبط رابط خادم Suwayomi للمصادر.
            </p>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 flex flex-col gap-6">
            <div className="flex flex-col gap-3">
              <label className="text-sm font-bold text-slate-300">
                نظام الترجمة الافتراضي
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  { id: "gemini_cookies", label: "Gemini AI (عبر الكوكيز)" },
                  { id: "metaai", label: "Meta AI (عبر الكوكيز)" },
                  { id: "google", label: "ترجمة Google الفورية" },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleTranslatorEngineChange(item.id)}
                    className={`p-3.5 rounded-xl border text-right text-xs font-bold flex items-center justify-between cursor-pointer transition ${
                      translatorEngine === item.id
                        ? "bg-emerald-500/15 border-emerald-500 text-white"
                        : "bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700"
                    }`}
                  >
                    <span>{item.label}</span>
                    {translatorEngine === item.id && (
                      <Check className="h-4 w-4 text-emerald-400" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div className="h-[1px] bg-slate-800" />

            <div className="flex flex-col gap-3">
              <label className="text-sm font-bold text-slate-300 flex items-center gap-2">
                <Database className="h-4 w-4 text-sky-400" />
                <span>محرك المصادر (Suwayomi Server)</span>
              </label>
              <select
                value={engineMode}
                onChange={handleEngineChange}
                className="w-full p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-300 focus:border-sky-500 focus:outline-none"
              >
                <option value="suwayomi">Suwayomi Server (2200+ مصدر)</option>
              </select>
              <input
                type="text"
                dir="ltr"
                value={suwayomiUrl}
                onChange={handleSuwayomiUrlChange}
                className="w-full p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-300 focus:border-sky-500 focus:outline-none"
              />
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleTestSuwayomi}
                  disabled={isSuwayomiTesting || !suwayomiUrl.trim()}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs transition cursor-pointer disabled:opacity-50"
                >
                  {isSuwayomiTesting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="h-4 w-4" />
                  )}
                  <span>فحص اتصال Suwayomi</span>
                </button>
              </div>
              {suwayomiTestResult && (
                <div
                  className={`p-3.5 rounded-xl border text-xs font-bold ${
                    suwayomiTestResult.success
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                      : "bg-red-500/10 border-red-500/30 text-red-400"
                  }`}
                >
                  {suwayomiTestResult.message}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
