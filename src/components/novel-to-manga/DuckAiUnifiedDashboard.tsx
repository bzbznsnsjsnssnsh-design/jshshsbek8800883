import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Play,
  Pause,
  RefreshCw,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Sparkles,
  Layers,
  StopCircle,
  Eye,
  ExternalLink,
  ShieldCheck,
  Send,
  Loader2,
  Trash2,
  Check,
} from "lucide-react";
import type {
  StudioSceneItem,
  StudioProductionElement,
  StudioLocationItem,
  StudioStylePreset,
  StudioAspectRatio,
} from "../../types/novelToManga";
import {
  fetchDuckAiDashboardStatusApi,
  startAllDuckAiSessionsApi,
  restartDuckAiBrowserApi,
  pauseDuckAiDispatcherApi,
  resumeDuckAiDispatcherApi,
  batchQueueDuckAiScenesApi,
  retryFailedDuckAiTasksApi,
  cancelAllDuckAiTasksApi,
  cancelDuckAiTaskApi,
  resetDuckAiPageApi,
  probeDuckAiPageApi,
  generateDuckAiImageApi,
  type DuckPageSlotDto,
  type DuckAiTaskDto,
  type DuckAiDashboardData,
  DUCK_AI_URL,
} from "../../services/novelToMangaClient";

export interface DuckAiUnifiedDashboardProps {
  scenes: StudioSceneItem[];
  productionElements?: StudioProductionElement[];
  locations?: StudioLocationItem[];
  selectedStyle?: StudioStylePreset;
  selectedAspectRatio?: StudioAspectRatio;
  onBindImageToScene?: (sceneId: string, imageUrl: string) => void;
  onNavigateToScenes?: () => void;
}

function DuckAiUnifiedDashboardInner({
  scenes = [],
  productionElements = [],
  locations = [],
  selectedStyle = "Korean Manhwa",
  selectedAspectRatio = "9:16",
  onBindImageToScene,
  onNavigateToScenes,
}: DuckAiUnifiedDashboardProps) {
  const [dashboardData, setDashboardData] = useState<DuckAiDashboardData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isStartingAll, setIsStartingAll] = useState<boolean>(false);
  const [isRestartingBrowser, setIsRestartingBrowser] = useState<boolean>(false);
  const [isQueueingBatch, setIsQueueingBatch] = useState<boolean>(false);
  const [isTestingGen, setIsTestingGen] = useState<boolean>(false);
  const [actionNotice, setActionNotice] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);
  const [testPromptInput, setTestPromptInput] = useState<string>("");
  const [showTestModal, setShowTestModal] = useState<boolean>(false);
  const [selectedSlotForAction, setSelectedSlotForAction] = useState<string | null>(null);
  const [busySlotActionIds, setBusySlotActionIds] = useState<Record<string, boolean>>({});

  const isMountedRef = useRef<boolean>(true);

  // Poll real-time status every 1.5 seconds automatically without user manual reload
  const fetchStatus = useCallback(async (isInitial = false) => {
    try {
      const data = await fetchDuckAiDashboardStatusApi();
      if (isMountedRef.current) {
        setDashboardData(data);
        if (isInitial) setIsLoading(false);
      }
    } catch (_) {
      if (isMountedRef.current && isInitial) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    fetchStatus(true);
    const interval = setInterval(() => {
      fetchStatus(false);
    }, 1500);

    return () => {
      isMountedRef.current = false;
      clearInterval(interval);
    };
  }, [fetchStatus]);

  // Notice helper
  const showNotice = (type: "success" | "error" | "info", text: string, duration = 4000) => {
    setActionNotice({ type, text });
    setTimeout(() => {
      if (isMountedRef.current) setActionNotice((curr) => (curr?.text === text ? null : curr));
    }, duration);
  };

  // Global Actions
  const handleStartAllSessions = async () => {
    setIsStartingAll(true);
    showNotice("info", "جاري تهيئة وتجهيز جلسات Duck.ai الخمس في الخلفية...");
    try {
      const res = await startAllDuckAiSessionsApi();
      if (res.success) {
        showNotice("success", res.message || "✓ تم تشغيل جلسات Duck.ai الخمس بنجاح.");
      } else {
        showNotice("error", res.error || "فشل تشغيل الجلسات.");
      }
      await fetchStatus();
    } catch (err: any) {
      showNotice("error", err?.message || "خطأ أثناء تشغيل الجلسات.");
    } finally {
      setIsStartingAll(false);
    }
  };

  const handleRestartBrowser = async () => {
    if (!confirm("هل أنت متأكد من إعادة تشغيل متصفح Duck.ai المستقل بالكامل؟ سيتم إغلاق العمليات وتنظيف ملفات القفل.")) return;
    setIsRestartingBrowser(true);
    showNotice("info", "جاري إعادة تشغيل متصفح Duck.ai Chromium وتنظيف الأقفال...");
    try {
      const res = await restartDuckAiBrowserApi();
      if (res.success) {
        showNotice("success", res.message || "✓ تمت إعادة تشغيل المتصفح والجلسات بنجاح.");
      } else {
        showNotice("error", res.error || "فشلت إعادة تشغيل المتصفح.");
      }
      await fetchStatus();
    } catch (err: any) {
      showNotice("error", err?.message || "خطأ أثناء إعادة التشغيل.");
    } finally {
      setIsRestartingBrowser(false);
    }
  };

  const handleToggleDispatcher = async () => {
    const isPaused = dashboardData?.isDispatcherPaused;
    showNotice("info", isPaused ? "جاري استئناف إرسال المهام..." : "جاري إيقاف إرسال المهام...");
    try {
      if (isPaused) {
        const res = await resumeDuckAiDispatcherApi();
        if (res.success) showNotice("success", "✓ تم استئناف إرسال المهام إلى الجلسات الجاهزة.");
      } else {
        const res = await pauseDuckAiDispatcherApi();
        if (res.success) showNotice("info", "✓ تم إيقاف إرسال المهام مؤقتاً.");
      }
      await fetchStatus();
    } catch (err: any) {
      showNotice("error", err?.message || "فشل تغيير حالة الموزع.");
    }
  };

  const handleRetryFailed = async () => {
    showNotice("info", "جاري إعادة محاولة المهام الفاشلة...");
    try {
      const res = await retryFailedDuckAiTasksApi();
      if (res.success) {
        showNotice("success", `✓ ${res.message || `تمت جدولة ${res.count || 0} من المهام الفاشلة.`}`);
      } else {
        showNotice("error", res.error || "فشلت إعادة محاولة المهام.");
      }
      await fetchStatus();
    } catch (err: any) {
      showNotice("error", err?.message || "خطأ أثناء إعادة المحاولة.");
    }
  };

  const handleCancelAllPending = async () => {
    if (!confirm("هل أنت متأكد من إلغاء جميع المهام المنتظرة في الطابور؟")) return;
    try {
      const res = await cancelAllDuckAiTasksApi();
      if (res.success) {
        showNotice("info", "تم إلغاء كافة المهام المنتظرة في الطابور.");
      }
      await fetchStatus();
    } catch (err: any) {
      showNotice("error", err?.message || "خطأ أثناء إلغاء المهام.");
    }
  };

  const handleBatchQueueScenes = async () => {
    const validScenes = scenes.filter((s) => Boolean(s && s.scene_id));
    if (validScenes.length === 0) {
      showNotice("error", "لا توجد مشاهد مسجلة في المشروع الحالي لجدولتها.");
      return;
    }

    setIsQueueingBatch(true);
    showNotice("info", `جاري جدولة ${validScenes.length} مشاهد للتوليد المتوازي عبر جلسات Duck.ai الخمس...`);
    try {
      const payload = validScenes.map((s) => {
        const matchedLoc = locations.find((l) => l.location_id === s.location_id);
        const refPaths: string[] = [];
        if (matchedLoc?.local_file_path) refPaths.push(matchedLoc.local_file_path);
        for (const el of productionElements) {
          if (el.local_file_path && s.character_ids?.includes(el.id)) {
            refPaths.push(el.local_file_path);
          }
        }

        const promptText =
          s.visual_prompt ||
          s.current_prompt ||
          s.base_prompt ||
          s.description ||
          `Scene ${s.scene_number || 1}: Korean manhwa scene, high detail, masterpiece.`;

        return {
          sceneId: s.scene_id,
          title: s.title || `مشهد ${s.scene_number || 1}`,
          prompt: promptText,
          referenceImages: refPaths,
        };
      });

      const res = await batchQueueDuckAiScenesApi(payload);
      if (res.success) {
        showNotice("success", `✓ ${res.message || `تمت إضافة ${res.count} مشاهد إلى طابور التوليد المتوازي!`}`);
      } else {
        showNotice("error", res.error || "فشلت جدولة المشاهد.");
      }
      await fetchStatus();
    } catch (err: any) {
      showNotice("error", err?.message || "خطأ أثناء جدولة المشاهد.");
    } finally {
      setIsQueueingBatch(false);
    }
  };

  // Slot-Specific Actions
  const handleResetSlot = async (slotId: string) => {
    setBusySlotActionIds((prev) => ({ ...prev, [slotId]: true }));
    try {
      const res = await resetDuckAiPageApi(slotId);
      if (res.success) {
        showNotice("success", res.message || `✓ تم تصفير محادثة ${slotId} وتحرير الجلسة بنجاح.`);
      } else {
        showNotice("error", res.error || "فشل تصفير الجلسة.");
      }
      await fetchStatus();
    } catch (err: any) {
      showNotice("error", err?.message || "خطأ في تصفير الجلسة.");
    } finally {
      setBusySlotActionIds((prev) => ({ ...prev, [slotId]: false }));
    }
  };

  const handleProbeSlot = async (slotId: string) => {
    setBusySlotActionIds((prev) => ({ ...prev, [slotId]: true }));
    showNotice("info", `جاري فحص وتجهيز ${slotId}...`);
    try {
      const res = await probeDuckAiPageApi(slotId);
      if (res.success) {
        showNotice("success", `✓ ${slotId} جاهزة للاستخدام الآن!`);
      } else {
        showNotice("error", res.error || `تعذر تجهيز ${slotId}.`);
      }
      await fetchStatus();
    } catch (err: any) {
      showNotice("error", err?.message || `خطأ في فحص ${slotId}.`);
    } finally {
      setBusySlotActionIds((prev) => ({ ...prev, [slotId]: false }));
    }
  };

  const handleCancelTask = async (taskId: string) => {
    try {
      const res = await cancelDuckAiTaskApi(taskId);
      if (res.success) {
        showNotice("info", `تم إلغاء المهمة ${taskId}.`);
      }
      await fetchStatus();
    } catch (err: any) {
      showNotice("error", err?.message || "خطأ أثناء إلغاء المهمة.");
    }
  };

  const [selectedTargetSlot, setSelectedTargetSlot] = useState<string>("");
  const [selectedComposerSceneId, setSelectedComposerSceneId] = useState<string>("");
  const [queueTaskCountPreset, setQueueTaskCountPreset] = useState<number | "custom">(10);
  const [customQueueTaskCount, setCustomQueueTaskCount] = useState<string>("25");
  const [queueBatchSize, setQueueBatchSize] = useState<number>(5);

  const handleSelectComposerScene = (sceneId: string) => {
    setSelectedComposerSceneId(sceneId);
    if (sceneId) {
      const sc = scenes.find((s) => s.scene_id === sceneId);
      if (sc) {
        const candidatePrompt =
          sc.visual_prompt ||
          sc.current_prompt ||
          sc.base_prompt ||
          sc.description ||
          `Scene ${sc.scene_number || 1}: Korean manhwa scene, high detail, masterpiece.`;
        if (!testPromptInput.trim()) {
          setTestPromptInput(candidatePrompt);
        }
      }
    }
  };

  const handleImportScenePrompt = () => {
    if (!selectedComposerSceneId) return;
    const sc = scenes.find((s) => s.scene_id === selectedComposerSceneId);
    if (sc) {
      const candidatePrompt =
        sc.visual_prompt ||
        sc.current_prompt ||
        sc.base_prompt ||
        sc.description ||
        `Scene ${sc.scene_number || 1}: Korean manhwa scene, high detail, masterpiece.`;
      setTestPromptInput(candidatePrompt);
      showNotice("info", `تم استيراد وصف المشهد (${sc.title || sc.scene_id}). يمكنك تعديله وإرساله.`);
    }
  };

  const handleQuickTestGeneration = async (forcedPrompt?: string) => {
    const rawPrompt = typeof forcedPrompt === "string" ? forcedPrompt : testPromptInput;
    const promptToSend = rawPrompt.trim();
    if (!promptToSend) {
      showNotice("error", "يرجى كتابة وصف صالح للصورة أولاً قبل الضغط على زر الإرسال.");
      return;
    }
    if (isTestingGen) return; // Prevent double click duplicate requests

    setIsTestingGen(true);
    const targetSceneObj = selectedComposerSceneId ? scenes.find((s) => s.scene_id === selectedComposerSceneId) : null;
    showNotice(
      "info",
      `جاري إرسال طلب التوليد إلى Duck.ai (${selectedTargetSlot || "توزيع دائري تلقائي"})${
        targetSceneObj ? ` للمشهد "${targetSceneObj.title || targetSceneObj.scene_id}"` : ""
      }...`
    );
    try {
      const res = await generateDuckAiImageApi({
        prompt: promptToSend,
        timeoutMs: 65000,
        preferredPageId: (selectedTargetSlot as any) || undefined,
        sceneId: selectedComposerSceneId || undefined,
        sceneTitle: targetSceneObj?.title || selectedComposerSceneId || undefined,
      });

      if (res.success && res.localUrl) {
        const chosenUrl = res.sceneCandidateUrl || res.localUrl;
        if (selectedComposerSceneId && onBindImageToScene) {
          onBindImageToScene(selectedComposerSceneId, chosenUrl);
          showNotice(
            "success",
            `✓ تم التوليد بنجاح عبر ${res.pageId || "Duck.ai"} في ${((res.durationMs || 0) / 1000).toFixed(1)} ثانية، وتم ربط الصورة وحفظها على المشهد (${selectedComposerSceneId}) مباشرة!`
          );
        } else {
          showNotice(
            "success",
            `✓ تم التوليد بنجاح عبر ${res.pageId || "Duck.ai"} في ${((res.durationMs || 0) / 1000).toFixed(1)} ثانية! تم التحقق وتحديث المعرض.`
          );
        }
        setShowTestModal(false);
      } else if (res.status === "LIMIT_REACHED") {
        showNotice("error", "تم بلوغ حد الاستخدام المؤقت (Rate Limit) في Duck.ai.");
      } else if (res.status === "CAPTCHA_REQUIRED") {
        showNotice("error", "تحدي التحقق البشري (CAPTCHA) مطلوب في Duck.ai.");
      } else {
        showNotice("error", `فشل التوليد: ${res.error || res.status}`);
      }
      await fetchStatus();
    } catch (err: any) {
      showNotice("error", err?.message || "حدث خطأ أثناء التوليد التجريبي.");
    } finally {
      setIsTestingGen(false);
    }
  };

  const handleBatchQueueConfigurable = async () => {
    const validScenes = scenes.filter((s) => Boolean(s && s.scene_id));
    if (validScenes.length === 0) {
      showNotice("error", "لا توجد مشاهد مسجلة في المشروع الحالي لجدولتها.");
      return;
    }

    let targetCount =
      queueTaskCountPreset === "custom"
        ? Math.max(1, parseInt(customQueueTaskCount, 10) || 10)
        : queueTaskCountPreset;

    targetCount = Math.min(targetCount, validScenes.length);
    const targetSubset = validScenes.slice(0, targetCount);

    setIsQueueingBatch(true);
    showNotice(
      "info",
      `جاري جدولة ${targetSubset.length} مشاهد (دفعات من ${queueBatchSize} صور) بالتناوب عبر جلسات Duck.ai...`
    );
    try {
      const payload = targetSubset.map((s) => {
        const matchedLoc = locations.find((l) => l.location_id === s.location_id);
        const refPaths: string[] = [];
        if (matchedLoc?.local_file_path) refPaths.push(matchedLoc.local_file_path);
        for (const el of productionElements) {
          if (el.local_file_path && s.character_ids?.includes(el.id)) {
            refPaths.push(el.local_file_path);
          }
        }
        const promptText =
          s.visual_prompt ||
          s.current_prompt ||
          s.base_prompt ||
          s.description ||
          `Scene ${s.scene_number || 1}: Korean manhwa scene, high detail, masterpiece.`;
        return {
          sceneId: s.scene_id,
          title: s.title || `مشهد ${s.scene_number || 1}`,
          prompt: promptText,
          referenceImages: refPaths,
        };
      });

      const res = await batchQueueDuckAiScenesApi(payload, {
        batchSize: queueBatchSize,
        totalLimit: targetCount,
      });

      if (res.success) {
        showNotice(
          "success",
          `✓ تم إطلاق الطابور الذكي (${res.count || targetSubset.length} مهمة على ${res.batchCount || Math.ceil(targetSubset.length / queueBatchSize)} دفعات)! التنفيذ يتوالى تلقائياً عبر الجلسات الخمس.`
        );
      } else {
        showNotice("error", res.error || "فشلت جدولة الدفعات.");
      }
      await fetchStatus();
    } catch (err: any) {
      showNotice("error", err?.message || "خطأ أثناء جدولة الطابور الذكي.");
    } finally {
      setIsQueueingBatch(false);
    }
  };

  const defaultSessions: DuckPageSlotDto[] = [
    { id: "duck_page_1", name: "جلسة Duck 1", index: 0, isInitialized: false, isBusy: false, status: "IDLE", currentUrl: "about:blank", pageTitle: "", activeTaskId: null, assignedSceneId: null, sceneTitle: null, currentPrompt: null, lastImageUrl: null, lastCandidateUrl: null, lastError: null, taskStartedAt: null, taskDurationMs: null, loadDurationMs: null, readinessDurationMs: null, lastUsedAt: null, completedTasksCount: 0, failedTasksCount: 0 },
    { id: "duck_page_2", name: "جلسة Duck 2", index: 1, isInitialized: false, isBusy: false, status: "IDLE", currentUrl: "about:blank", pageTitle: "", activeTaskId: null, assignedSceneId: null, sceneTitle: null, currentPrompt: null, lastImageUrl: null, lastCandidateUrl: null, lastError: null, taskStartedAt: null, taskDurationMs: null, loadDurationMs: null, readinessDurationMs: null, lastUsedAt: null, completedTasksCount: 0, failedTasksCount: 0 },
    { id: "duck_page_3", name: "جلسة Duck 3", index: 2, isInitialized: false, isBusy: false, status: "IDLE", currentUrl: "about:blank", pageTitle: "", activeTaskId: null, assignedSceneId: null, sceneTitle: null, currentPrompt: null, lastImageUrl: null, lastCandidateUrl: null, lastError: null, taskStartedAt: null, taskDurationMs: null, loadDurationMs: null, readinessDurationMs: null, lastUsedAt: null, completedTasksCount: 0, failedTasksCount: 0 },
    { id: "duck_page_4", name: "جلسة Duck 4", index: 3, isInitialized: false, isBusy: false, status: "IDLE", currentUrl: "about:blank", pageTitle: "", activeTaskId: null, assignedSceneId: null, sceneTitle: null, currentPrompt: null, lastImageUrl: null, lastCandidateUrl: null, lastError: null, taskStartedAt: null, taskDurationMs: null, loadDurationMs: null, readinessDurationMs: null, lastUsedAt: null, completedTasksCount: 0, failedTasksCount: 0 },
    { id: "duck_page_5", name: "جلسة Duck 5", index: 4, isInitialized: false, isBusy: false, status: "IDLE", currentUrl: "about:blank", pageTitle: "", activeTaskId: null, assignedSceneId: null, sceneTitle: null, currentPrompt: null, lastImageUrl: null, lastCandidateUrl: null, lastError: null, taskStartedAt: null, taskDurationMs: null, loadDurationMs: null, readinessDurationMs: null, lastUsedAt: null, completedTasksCount: 0, failedTasksCount: 0 },
  ];

  const sessions = (Array.isArray(dashboardData?.sessions) && dashboardData.sessions.length > 0)
    ? dashboardData.sessions
    : defaultSessions;

  const stats = {
    totalSessions: 5,
    readyCount: Number(dashboardData?.stats?.readyCount) || 0,
    generatingCount: Number(dashboardData?.stats?.generatingCount) || 0,
    savingCount: Number(dashboardData?.stats?.savingCount) || 0,
    waitingCount: Number(dashboardData?.stats?.waitingCount) || 0,
    errorCount: Number(dashboardData?.stats?.errorCount) || 0,
    captchaCount: Number(dashboardData?.stats?.captchaCount) || 0,
    completedCount: Number(dashboardData?.stats?.completedCount) || 0,
    failedCount: Number(dashboardData?.stats?.failedCount) || 0,
  };

  const getStatusBadge = (status: string, isBusy?: boolean) => {
    if (isBusy || status === "GENERATING") {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500/20 border border-amber-500/50 text-amber-300 animate-pulse">
          <Loader2 className="h-3 w-3 animate-spin text-amber-400" />
          <span>تعمل (GENERATING)</span>
        </span>
      );
    }
    if (status === "READY") {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/20 border border-emerald-500/50 text-emerald-300">
          <CheckCircle2 className="h-3 w-3 text-emerald-400" />
          <span>جاهزة (READY)</span>
        </span>
      );
    }
    if (status === "SAVING") {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-purple-500/20 border border-purple-500/50 text-purple-300">
          <Loader2 className="h-3 w-3 animate-spin text-purple-400" />
          <span>تحفظ الصورة (SAVING)</span>
        </span>
      );
    }
    if (status === "WAITING") {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-sky-500/20 border border-sky-500/50 text-sky-300">
          <Clock className="h-3 w-3 text-sky-400" />
          <span>تنتظر (WAITING)</span>
        </span>
      );
    }
    if (status === "CAPTCHA") {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-500/20 border border-rose-500/50 text-rose-300">
          <AlertTriangle className="h-3 w-3 text-rose-400" />
          <span>كابتشا (CAPTCHA)</span>
        </span>
      );
    }
    if (status === "RATE_LIMITED") {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-purple-900/40 border border-purple-500/50 text-purple-200">
          <AlertTriangle className="h-3 w-3 text-purple-400" />
          <span>تجاوز الحد (RATE_LIMITED)</span>
        </span>
      );
    }
    if (status === "ERROR") {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-950/60 border border-rose-600/50 text-rose-300">
          <AlertTriangle className="h-3 w-3 text-rose-400" />
          <span>فشلت (ERROR)</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-slate-800 border border-slate-700 text-slate-400">
        <span className="h-2 w-2 rounded-full bg-slate-500" />
        <span>خاملة (IDLE)</span>
      </span>
    );
  };

  return (
    <div className="flex flex-col gap-6 text-slate-100 w-full" dir="rtl">
      {/* 🦆 Top Header: Unified 5-Session Control Dashboard */}
      <div className="p-5 sm:p-6 rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900/95 to-slate-950 border border-amber-500/30 shadow-2xl relative overflow-hidden">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 relative z-10">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="p-2 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-300 text-lg shadow-inner">
                🦆
              </span>
              <h2 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
                لوحة تحكم Duck.ai الموحدة — 5 جلسات متزامنة ومستقلة
              </h2>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
                5 Independent Tabs • Max Concurrency 5
              </span>
              <span className="px-2 py-0.5 rounded bg-slate-800 text-[10px] font-mono text-slate-300">
                {dashboardData?.browserConnected ? "Chromium متصل ✓" : "Chromium غير متصل ✗"}
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed max-w-3xl">
              إدارة 5 جلسات تصفح حقيقية متوازية على خادم Chromium المستقل الخاص بـ Duck.ai (
              <span className="text-amber-300 font-mono">https://duck.ai/chat</span>). تعمل الجلسات الخمس معاً في نفس الوقت، وتستلم كل جلسة مشهداً محدداً بمعرف ثابت، وتتحقق من سلامة الصورة وتحفظها تلقائياً.
            </p>
          </div>

          {/* Quick Stats Summary Chips */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs font-mono">
            <div className="p-2 rounded-xl bg-emerald-950/40 border border-emerald-500/30 flex flex-col">
              <span className="text-emerald-400 font-extrabold text-base">{stats.readyCount}</span>
              <span className="text-[10px] text-emerald-300">جاهزة (READY)</span>
            </div>
            <div className="p-2 rounded-xl bg-amber-950/40 border border-amber-500/30 flex flex-col">
              <span className="text-amber-400 font-extrabold text-base">{stats.generatingCount}</span>
              <span className="text-[10px] text-amber-300">تعمل (BUSY)</span>
            </div>
            <div className="p-2 rounded-xl bg-sky-950/40 border border-sky-500/30 flex flex-col">
              <span className="text-sky-400 font-extrabold text-base">{stats.waitingCount}</span>
              <span className="text-[10px] text-sky-300">في الطابور (QUEUE)</span>
            </div>
            <div className="p-2 rounded-xl bg-slate-900 border border-slate-800 flex flex-col">
              <span className="text-white font-extrabold text-base">{stats.completedCount}</span>
              <span className="text-[10px] text-slate-400">مكتملة (DONE)</span>
            </div>
          </div>
        </div>

        {/* Global Action Buttons Bar (Requirement 8) */}
        <div className="mt-5 pt-4 border-t border-slate-800/80 flex items-center justify-between gap-3 flex-wrap text-xs">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={handleStartAllSessions}
              disabled={isStartingAll}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold transition cursor-pointer shadow-md shadow-amber-950/40 disabled:opacity-50"
              title="تهيئة وتشغيل الجلسات الخمس معاً في الخلفية ونقلها إلى حالة الجاهزية"
            >
              {isStartingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              <span>{isStartingAll ? "جاري تهيئة الجلسات الخمس..." : "⚡ تشغيل الجلسات الخمس في الخلفية"}</span>
            </button>

            {/* Separate Pause & Resume Buttons */}
            <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-950/80 border border-slate-800">
              <button
                type="button"
                onClick={async () => {
                  showNotice("info", "جاري إيقاف إرسال المهام مؤقتاً...");
                  const res = await pauseDuckAiDispatcherApi();
                  if (res.success) showNotice("info", "✓ تم إيقاف إرسال المهام مؤقتاً. المهام المتبقية محفوظة بترتيبها.");
                  await fetchStatus();
                }}
                disabled={dashboardData?.isDispatcherPaused}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                  dashboardData?.isDispatcherPaused
                    ? "bg-slate-900 text-slate-500 opacity-60 cursor-not-allowed"
                    : "bg-amber-950/80 hover:bg-amber-900 border border-amber-500/50 text-amber-300"
                }`}
                title="إيقاف مؤقت: لا تُرسل أي مهمة جديدة وتبقى المهام المتبقية محفوظة بترتيبها"
              >
                <Pause className="h-3.5 w-3.5 text-amber-400" />
                <span>إيقاف مؤقت</span>
              </button>

              <button
                type="button"
                onClick={async () => {
                  showNotice("info", "جاري استئناف إرسال المهام...");
                  const res = await resumeDuckAiDispatcherApi();
                  if (res.success) showNotice("success", "✓ تم استئناف إرسال المهام من النقطة التي توقفت عندها.");
                  await fetchStatus();
                }}
                disabled={!dashboardData?.isDispatcherPaused}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                  !dashboardData?.isDispatcherPaused
                    ? "bg-slate-900 text-slate-500 opacity-60 cursor-not-allowed"
                    : "bg-emerald-800 hover:bg-emerald-700 border border-emerald-400 text-white"
                }`}
                title="استئناف: يستمر التنفيذ من النقطة التي توقف عندها دون إعادة ما اكتمل"
              >
                <Play className="h-3.5 w-3.5 text-emerald-300" />
                <span>استئناف</span>
              </button>

              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 text-slate-400">
                {dashboardData?.isDispatcherPaused ? "متوقف ⏸" : "نشط ▶"}
              </span>
            </div>

            <button
              type="button"
              onClick={handleRetryFailed}
              disabled={stats.failedCount === 0}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 font-bold transition cursor-pointer disabled:opacity-40"
              title="إعادة جدولة جميع المهام التي فشلت سابقاً"
            >
              <RotateCcw className="h-3.5 w-3.5 text-amber-400" />
              <span>إعادة محاولة الفشل ({stats.failedCount})</span>
            </button>

            {/* Multi-Task Configurable Queue Controller (Presets 10, 20, 50, 100, All, Custom) */}
            <div className="flex items-center gap-2 p-1.5 rounded-xl bg-slate-950/90 border border-slate-800 flex-wrap">
              <span className="text-[11px] font-bold text-slate-300 flex items-center gap-1">
                <Layers className="h-3.5 w-3.5 text-amber-400" />
                <span>طابور المهام:</span>
              </span>

              {/* Preset Count Pills */}
              <div className="flex items-center gap-1">
                {[10, 20, 50, 100].map((cnt) => (
                  <button
                    key={cnt}
                    type="button"
                    onClick={() => setQueueTaskCountPreset(cnt)}
                    className={`px-2 py-1 rounded-lg text-[10px] font-mono font-bold transition cursor-pointer ${
                      queueTaskCountPreset === cnt
                        ? "bg-amber-600 text-white shadow"
                        : "bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800"
                    }`}
                  >
                    {cnt}
                  </button>
                ))}
                {scenes.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setQueueTaskCountPreset(scenes.length)}
                    className={`px-2 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                      queueTaskCountPreset === scenes.length
                        ? "bg-amber-600 text-white shadow"
                        : "bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800"
                    }`}
                  >
                    الكل ({scenes.length})
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setQueueTaskCountPreset("custom")}
                  className={`px-2 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                    queueTaskCountPreset === "custom"
                      ? "bg-amber-600 text-white shadow"
                      : "bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800"
                  }`}
                >
                  مخصص
                </button>
              </div>

              {/* Custom count input */}
              {queueTaskCountPreset === "custom" && (
                <input
                  type="number"
                  min={1}
                  max={Math.max(1, scenes.length)}
                  value={customQueueTaskCount}
                  onChange={(e) => setCustomQueueTaskCount(e.target.value)}
                  placeholder="عدد"
                  className="w-14 px-2 py-1 rounded-lg bg-slate-900 border border-slate-700 text-[10px] font-mono text-amber-300 text-center focus:outline-none focus:border-amber-500"
                />
              )}

              {/* Batch Size Selector */}
              <select
                value={queueBatchSize}
                onChange={(e) => setQueueBatchSize(Number(e.target.value) || 5)}
                className="px-2 py-1 rounded-lg bg-slate-900 border border-slate-800 text-[10px] font-mono text-slate-300 cursor-pointer focus:outline-none"
                title="حجم الدفعة المقسمة بالتناوب على الجلسات"
              >
                <option value={5}>5 بالدفعة</option>
                <option value={10}>10 بالدفعة</option>
              </select>

              {/* Queue Launch Button */}
              <button
                type="button"
                onClick={handleBatchQueueConfigurable}
                disabled={isQueueingBatch || scenes.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-amber-600 to-indigo-600 hover:from-amber-500 hover:to-indigo-500 text-white text-xs font-bold transition cursor-pointer shadow-md disabled:opacity-50"
                title="إطلاق الطابور بالعدد المحدد وجدولته بالتناوب الدائري الآمن"
              >
                {isQueueingBatch ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5 text-amber-300" />}
                <span>
                  {isQueueingBatch
                    ? "جاري الجدولة..."
                    : `🚀 إطلاق الطابور (${
                        queueTaskCountPreset === "custom"
                          ? customQueueTaskCount || 10
                          : Math.min(queueTaskCountPreset, scenes.length || queueTaskCountPreset)
                      } مشهد)`}
                </span>
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setShowTestModal(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-teal-900/60 hover:bg-teal-800/80 border border-teal-500/40 text-teal-200 font-semibold transition cursor-pointer"
              title="اختبار توليد صورة واحدة فورياً على جلسة جاهزة"
            >
              <Sparkles className="h-3.5 w-3.5 text-teal-400" />
              <span>توليد صورة تجريبية</span>
            </button>

            <button
              type="button"
              onClick={handleRestartBrowser}
              disabled={isRestartingBrowser}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white transition cursor-pointer disabled:opacity-50"
              title="إعادة تشغيل عملية Chromium المخصصة لـ Duck.ai"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRestartingBrowser ? "animate-spin" : ""}`} />
              <span>إعادة تشغيل المتصفح</span>
            </button>

            {stats.waitingCount > 0 && (
              <button
                type="button"
                onClick={handleCancelAllPending}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-950/60 hover:bg-rose-900/80 border border-rose-500/40 text-rose-300 font-semibold transition cursor-pointer"
                title="إلغاء جميع المهام المنتظرة في الطابور"
              >
                <StopCircle className="h-3.5 w-3.5 text-rose-400" />
                <span>إلغاء الطابور ({stats.waitingCount})</span>
              </button>
            )}
          </div>
        </div>

        {/* Action Notice Banner */}
        {actionNotice && (
          <div
            className={`mt-4 p-3 rounded-xl border text-xs flex items-center justify-between gap-3 ${
              actionNotice.type === "success"
                ? "bg-emerald-950/80 border-emerald-500/50 text-emerald-200"
                : actionNotice.type === "error"
                ? "bg-rose-950/80 border-rose-500/50 text-rose-200"
                : "bg-sky-950/80 border-sky-500/50 text-sky-200"
            }`}
          >
            <div className="flex items-center gap-2">
              {actionNotice.type === "success" ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
              ) : actionNotice.type === "error" ? (
                <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0" />
              ) : (
                <Clock className="h-4 w-4 text-sky-400 shrink-0" />
              )}
              <span>{actionNotice.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setActionNotice(null)}
              className="text-slate-400 hover:text-white font-mono cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        {/* 🎨 Dedicated Interactive Image Creation Section (قسم إنشاء وتوليد الصور المباشر) */}
        <div className="mt-4 p-4 rounded-2xl bg-slate-900/90 border border-amber-500/40 flex flex-col gap-3.5 shadow-xl" dir="rtl">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/30">
                <Sparkles className="h-4 w-4" />
              </div>
              <div className="flex flex-col">
                <span className="font-extrabold text-sm sm:text-base text-white">
                  إنشاء وتوليد صورة مباشرة عبر Duck.ai (Live Prompt Composer)
                </span>
                <span className="text-[11px] text-slate-400">
                  اكتب أو الصق وصف المشهد، وسيصبح زر الإرسال نشطاً فورياً لتنفيذ الطلب والتحقق عبر Sharp دون مغادرة القسم
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2.5 flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-slate-300 font-semibold">المشهد المستهدف:</span>
                <select
                  value={selectedComposerSceneId}
                  onChange={(e) => handleSelectComposerScene(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-emerald-300 font-mono focus:border-emerald-500 focus:outline-none cursor-pointer max-w-[200px] truncate"
                >
                  <option value="">صورة عامة (بدون ربط بمشهد)</option>
                  {scenes
                    .filter((s) => Boolean(s && s.scene_id))
                    .map((sc, idx) => (
                      <option key={sc.scene_id} value={sc.scene_id}>
                        مشهد {sc.scene_number || idx + 1}: {sc.title || sc.scene_id}
                      </option>
                    ))}
                </select>
              </div>

              {selectedComposerSceneId && (
                <button
                  type="button"
                  onClick={handleImportScenePrompt}
                  className="px-2.5 py-1.5 rounded-lg bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-500/50 text-[11px] font-bold text-emerald-300 cursor-pointer transition shadow-sm"
                  title="استيراد وصف هذا المشهد مباشرة إلى حقل الإدخال"
                >
                  📋 جلب وصف المشهد
                </button>
              )}

              <div className="flex items-center gap-1.5">
                <span className="text-xs text-slate-400 font-semibold">توجيه الجلسة:</span>
                <select
                  value={selectedTargetSlot}
                  onChange={(e) => setSelectedTargetSlot(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-amber-300 font-mono focus:border-amber-500 focus:outline-none cursor-pointer"
                >
                  <option value="">توزيع تلقائي (Round-Robin)</option>
                  <option value="duck_page_1">جلسة Duck 1</option>
                  <option value="duck_page_2">جلسة Duck 2</option>
                  <option value="duck_page_3">جلسة Duck 3</option>
                  <option value="duck_page_4">جلسة Duck 4</option>
                  <option value="duck_page_5">جلسة Duck 5</option>
                </select>
              </div>
            </div>
          </div>

          {/* Prompt Input Field */}
          <div className="relative">
            <textarea
              id="duckai-main-prompt-input"
              value={testPromptInput}
              onChange={(e) => setTestPromptInput(e.target.value)}
              onInput={(e) => setTestPromptInput((e.target as HTMLTextAreaElement).value)}
              onPaste={(e) => {
                const text = e.clipboardData.getData("text");
                if (text) {
                  setTestPromptInput(text);
                }
              }}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                  e.preventDefault();
                  if (testPromptInput.trim() && !isTestingGen) {
                    handleQuickTestGeneration();
                  }
                }
              }}
              placeholder="اكتب وصف الصورة هنا بالإنجليزية أو العربية (مثال: A heroic warrior with glowing azure sword on a mountain peak at sunrise, detailed manhwa style)..."
              rows={3}
              dir="ltr"
              className="w-full p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500/50 focus:outline-none transition leading-relaxed"
            />
          </div>

          {/* Action Footer: Quick Chips + Character Count + Prominent Send Button */}
          <div className="flex items-center justify-between flex-wrap gap-2.5 pt-1 border-t border-slate-800/80">
            <div className="flex items-center gap-2 flex-wrap text-[11px]">
              <span className="text-slate-400 font-semibold">نماذج سريعة:</span>
              <button
                type="button"
                onClick={() => setTestPromptInput("A heroic manhwa warrior with a glowing azure sword standing on a mountain peak at sunrise, masterpiece, detailed")}
                className="px-2 py-0.5 rounded bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 text-[10px] cursor-pointer transition font-mono"
              >
                + Heroic Warrior
              </button>
              <button
                type="button"
                onClick={() => setTestPromptInput("An ancient mystical fantasy temple deep inside an enchanted forest, glowing runes and lanterns, anime background art")}
                className="px-2 py-0.5 rounded bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 text-[10px] cursor-pointer transition font-mono"
              >
                + Ancient Temple
              </button>
              <span className="text-slate-500 font-mono text-[10px] mr-2">
                {testPromptInput.length} حرف · (Ctrl + Enter للإرسال)
              </span>
            </div>

            <div className="flex items-center gap-2">
              {testPromptInput.length > 0 && (
                <button
                  type="button"
                  onClick={() => setTestPromptInput("")}
                  disabled={isTestingGen}
                  className="px-3 py-2 rounded-xl text-xs text-slate-400 hover:text-white transition cursor-pointer"
                >
                  مسح
                </button>
              )}

              <button
                type="button"
                id="duckai-composer-send-btn"
                onClick={() => handleQuickTestGeneration()}
                disabled={!testPromptInput.trim() || isTestingGen}
                className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-xs transition cursor-pointer shadow-lg ${
                  !testPromptInput.trim() || isTestingGen
                    ? "bg-slate-800 text-slate-500 border border-slate-700/50 cursor-not-allowed opacity-60"
                    : "bg-amber-600 hover:bg-amber-500 text-white shadow-amber-950/60 border border-amber-400/40 hover:scale-[1.02] active:scale-[0.98]"
                }`}
                title={!testPromptInput.trim() ? "أدخل نصاً في الحقل أولاً لتفعيل زر الإرسال" : "إرسال الطلب والتوليد فوراً"}
              >
                {isTestingGen ? (
                  <Loader2 className="h-4 w-4 animate-spin text-amber-300" />
                ) : (
                  <Send className="h-4 w-4 text-white" />
                )}
                <span>{isTestingGen ? "جاري التوليد والفحص..." : selectedComposerSceneId ? "إرسال وتوليد وربط بالمشهد" : "إرسال وتوليد الصورة"}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 🦆 Requirement 2 & 4: THE 5 SESSIONS IN ONE UNIFIED DASHBOARD */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <span className="font-extrabold text-sm sm:text-base text-white">
              جلسات Duck.ai الخمس المباشرة (5 Real Chromium Slots):
            </span>
            <span className="text-xs text-slate-400 font-mono">
              (يتم تحديث الحالة تلقائياً كل 1.5 ثانية)
            </span>
          </div>
          <button
            type="button"
            onClick={() => fetchStatus(false)}
            className="text-xs text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer transition"
          >
            <RefreshCw className="h-3 w-3" />
            <span>تحديث يدوي</span>
          </button>
        </div>

        {/* 5-Session Responsive Grid: All 5 slots visible on the same screen! */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3.5 items-stretch">
          {sessions.map((slot: DuckPageSlotDto) => {
            const isSlotBusy = Boolean(slot.isBusy) || slot.status === "GENERATING" || slot.status === "SAVING";
            const isActionBusy = Boolean(busySlotActionIds[slot.id]);
            const elapsedSeconds = slot.taskStartedAt
              ? Math.max(0, Math.floor((Date.now() - slot.taskStartedAt) / 1000))
              : null;

            return (
              <div
                key={slot.id}
                className={`p-4 rounded-2xl border flex flex-col justify-between gap-3.5 transition-all shadow-lg ${
                  isSlotBusy
                    ? "bg-slate-900/95 border-amber-500/60 ring-1 ring-amber-500/30"
                    : slot.status === "READY"
                    ? "bg-slate-900/90 border-emerald-500/40 hover:border-emerald-500/60"
                    : slot.status === "CAPTCHA"
                    ? "bg-rose-950/40 border-rose-500/60"
                    : slot.status === "ERROR"
                    ? "bg-rose-950/30 border-rose-800/50"
                    : "bg-slate-900/60 border-slate-800"
                }`}
              >
                {/* Slot Header */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-base">🦆</span>
                      <strong className="text-xs font-bold text-white truncate" title={slot.name}>
                        {slot.name}
                      </strong>
                    </div>
                    <span className="font-mono text-[10px] text-slate-500 uppercase shrink-0">
                      #{slot.index + 1}
                    </span>
                  </div>

                  {/* Live Status Badge */}
                  <div>{getStatusBadge(slot.status, slot.isBusy)}</div>
                </div>

                {/* Active Task / Scene Info */}
                <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80 flex flex-col gap-2 text-xs">
                  {slot.assignedSceneId ? (
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-400">المشهد المرتبط:</span>
                        <strong className="text-emerald-300 font-mono font-bold">
                          {slot.assignedSceneId}
                        </strong>
                      </div>
                      {slot.sceneTitle && (
                        <span className="text-[11px] text-slate-200 line-clamp-1 font-semibold" title={slot.sceneTitle}>
                          {slot.sceneTitle}
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="text-[11px] text-slate-500 text-center py-0.5">
                      لا يوجد مشهد نشط حالياً
                    </div>
                  )}

                  {slot.activeTaskId && (
                    <div className="flex items-center justify-between text-[10px] font-mono border-t border-slate-800/60 pt-1.5 text-slate-400">
                      <span>المهمة:</span>
                      <span className="truncate max-w-[110px] text-sky-300" title={slot.activeTaskId}>
                        {slot.activeTaskId}
                      </span>
                    </div>
                  )}

                  {elapsedSeconds !== null && (
                    <div className="flex items-center justify-between text-[10px] font-mono text-amber-300">
                      <span>المدة المنقضية:</span>
                      <span className="font-bold">{elapsedSeconds} ثانية</span>
                    </div>
                  )}

                  {slot.currentPrompt && isSlotBusy && (
                    <div className="text-[10px] text-slate-400 line-clamp-2 italic border-t border-slate-800/60 pt-1.5" dir="ltr">
                      &quot;{slot.currentPrompt}&quot;
                    </div>
                  )}

                  {slot.lastError && (
                    <div className="text-[10px] text-rose-300 bg-rose-950/50 p-1.5 rounded border border-rose-800/40 line-clamp-2">
                      {slot.lastError}
                    </div>
                  )}
                </div>

                {/* Last Generated Image Thumbnail Preview */}
                {slot.lastImageUrl ? (
                  <div className="rounded-xl overflow-hidden border border-slate-800 bg-slate-950 relative aspect-[9/13] group">
                    <img
                      src={slot.lastImageUrl}
                      alt={slot.assignedSceneId || "Last result"}
                      className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                    />
                    <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/90 via-black/60 to-transparent flex flex-col gap-0.5 text-[10px]">
                      <div className="flex items-center justify-between text-white font-bold">
                        <span>{slot.assignedSceneId || "صورة سابقة"}</span>
                        <span className="text-emerald-400 font-mono">Sharp ✓</span>
                      </div>
                      {slot.lastCandidateUrl && onBindImageToScene && slot.assignedSceneId && (
                        <button
                          type="button"
                          onClick={() => onBindImageToScene(slot.assignedSceneId!, slot.lastCandidateUrl!)}
                          className="mt-1 w-full py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] cursor-pointer transition"
                        >
                          اعتماد كصورة للمشهد
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-800 bg-slate-950/40 p-3 text-center flex flex-col items-center justify-center min-h-[90px] text-slate-600">
                    <span className="text-xl mb-1 opacity-50">🖼️</span>
                    <span className="text-[10px]">بانتظار إنتاج أول صورة</span>
                  </div>
                )}

                {/* Slot Counters & Timing */}
                <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 border-t border-slate-800/80 pt-2">
                  <span title="المهام الناجحة">
                    ✓ <strong className="text-emerald-400">{slot.completedTasksCount || 0}</strong>
                  </span>
                  <span title="المهام الفاشلة">
                    ✗ <strong className="text-rose-400">{slot.failedTasksCount || 0}</strong>
                  </span>
                  <span>
                    {slot.readinessDurationMs ? `${(slot.readinessDurationMs / 1000).toFixed(1)}s جاهزية` : slot.isInitialized ? "نشطة" : "جاهزة للفتح"}
                  </span>
                </div>

                {/* Slot Action Buttons */}
                <div className="grid grid-cols-2 gap-1.5 pt-1">
                  <button
                    type="button"
                    onClick={() => handleProbeSlot(slot.id)}
                    disabled={isSlotBusy || isActionBusy}
                    className="py-1.5 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[11px] font-semibold transition cursor-pointer flex items-center justify-center gap-1 disabled:opacity-40"
                    title="التحقق من جاهزية الواجهة والتجهيز"
                  >
                    {isActionBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3 text-emerald-400" />}
                    <span>فحص</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleResetSlot(slot.id)}
                    disabled={isActionBusy}
                    className="py-1.5 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[11px] font-semibold transition cursor-pointer flex items-center justify-center gap-1 disabled:opacity-40"
                    title="تصفير المحادثة وتحرير حالة الانشغال وإعادة تعيين الجلسة"
                  >
                    <RotateCcw className="h-3 w-3 text-amber-400" />
                    <span>تصفير</span>
                  </button>
                </div>

                {isSlotBusy && slot.activeTaskId && (
                  <button
                    type="button"
                    onClick={() => handleCancelTask(slot.activeTaskId!)}
                    className="w-full py-1 rounded-lg bg-rose-950 hover:bg-rose-900 border border-rose-800/50 text-rose-300 text-[10px] font-bold cursor-pointer transition flex items-center justify-center gap-1"
                  >
                    <StopCircle className="h-3 w-3" />
                    <span>إلغاء المهمة الحالية</span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 🦆 Task Queue & Live Pipeline Strip */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left: Pending & Active Task Queue (6 Cols) */}
        <div className="lg:col-span-6 p-4 sm:p-5 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-sm text-white flex items-center gap-1.5">
                <Clock className="h-4 w-4 text-sky-400" />
                <span>طابور المهام المنتظرة والنشطة ({stats.waitingCount + stats.generatingCount}):</span>
              </span>
            </div>
            {dashboardData?.pendingQueue && dashboardData.pendingQueue.length > 0 && (
              <button
                type="button"
                onClick={handleCancelAllPending}
                className="text-[11px] text-rose-400 hover:text-rose-300 cursor-pointer"
              >
                إلغاء كافة المهام
              </button>
            )}
          </div>

          {/* Active Running Tasks */}
          {Array.isArray(dashboardData?.activeTasks) && dashboardData.activeTasks.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-bold text-amber-300">المهام الجاري تنفيذها حالياً:</span>
              <div className="space-y-1.5">
                {dashboardData.activeTasks.map((task: DuckAiTaskDto) => (
                  <div
                    key={task.taskId}
                    className="p-2.5 rounded-xl bg-amber-950/30 border border-amber-500/40 text-xs flex items-center justify-between gap-3"
                  >
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <div className="flex items-center gap-2">
                        <strong className="text-white">{task.sceneTitle || task.sceneId}</strong>
                        <span className="px-1.5 py-0.2 rounded bg-amber-900 text-amber-200 font-mono text-[10px]">
                          {task.assignedSessionId || "Session"}
                        </span>
                      </div>
                      <span className="text-slate-400 text-[11px] truncate max-w-sm" dir="ltr">
                        {task.prompt}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleCancelTask(task.taskId)}
                      className="p-1 rounded bg-rose-950 text-rose-300 hover:bg-rose-900 text-[10px] shrink-0 cursor-pointer"
                      title="إلغاء المهمة"
                    >
                      إلغاء
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Pending Tasks Queue */}
          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-bold text-slate-300">
              في قائمة الانتظار ({Array.isArray(dashboardData?.pendingQueue) ? dashboardData.pendingQueue.length : 0}):
            </span>
            {Array.isArray(dashboardData?.pendingQueue) && dashboardData.pendingQueue.length > 0 ? (
              <div className="space-y-1.5 max-h-60 overflow-y-auto">
                {dashboardData.pendingQueue.map((task: DuckAiTaskDto, idx: number) => (
                  <div
                    key={task.taskId}
                    className="p-2 rounded-xl bg-slate-950 border border-slate-800 text-xs flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-slate-500 text-[10px]">#{idx + 1}</span>
                      <strong className="text-slate-200 text-[11px] truncate">{task.sceneTitle || task.sceneId}</strong>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCancelTask(task.taskId)}
                      className="text-[10px] text-slate-400 hover:text-rose-400 font-mono cursor-pointer"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-slate-950/60 border border-dashed border-slate-800 text-center text-xs text-slate-500">
                لا توجد مهام تنتظر في الطابور حالياً. يمكنك استخدام زر «جدولة مشاهد الرواية» لبدء التوليد.
              </div>
            )}
          </div>
        </div>

        {/* Right: Completed Images & Scene Linking (6 Cols) */}
        <div className="lg:col-span-6 p-4 sm:p-5 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="font-extrabold text-sm text-white flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              <span>الصور المكتملة حديثاً والمربوطة بالمشاهد ({dashboardData?.recentCompleted?.length || 0}):</span>
            </span>
            {onNavigateToScenes && (
              <button
                type="button"
                onClick={onNavigateToScenes}
                className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1 cursor-pointer font-semibold"
              >
                <span>الانتقال للمشاهد (خطوة 5)</span>
                <ExternalLink className="h-3 w-3" />
              </button>
            )}
          </div>

          {Array.isArray(dashboardData?.recentCompleted) && dashboardData.recentCompleted.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-96 overflow-y-auto">
              {dashboardData.recentCompleted.map((task: DuckAiTaskDto) => (
                <div
                  key={task.taskId}
                  className="rounded-xl overflow-hidden border border-slate-800 bg-slate-950 flex flex-col group"
                >
                  <div className="relative aspect-[9/13] overflow-hidden bg-black">
                    {task.imageUrl ? (
                      <img
                        src={task.imageUrl}
                        alt={task.sceneId}
                        className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-600 text-xs">
                        لا توجد معاينة
                      </div>
                    )}
                    <span className="absolute top-1 right-1 px-1.5 py-0.5 rounded bg-black/80 font-mono text-[9px] text-emerald-300 font-bold border border-emerald-500/40">
                      {task.sceneId}
                    </span>
                  </div>

                  <div className="p-2 flex flex-col gap-1.5 text-[10px]">
                    <span className="text-white font-semibold truncate" title={task.sceneTitle || task.sceneId}>
                      {task.sceneTitle || task.sceneId}
                    </span>
                    <span className="text-slate-400 font-mono text-[9px]">
                      {task.width && task.height ? `${task.width}x${task.height} ${task.format || "JPEG"}` : "Sharp Verified"}
                    </span>
                    {task.candidateUrl && onBindImageToScene && (
                      <button
                        type="button"
                        onClick={() => onBindImageToScene(task.sceneId, task.candidateUrl!)}
                        className="w-full py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer transition text-center"
                      >
                        اعتماد للمشهد
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-8 rounded-xl bg-slate-950/60 border border-dashed border-slate-800 text-center text-xs text-slate-500 flex flex-col items-center justify-center min-h-[160px]">
              <span className="text-2xl mb-1.5 opacity-40">🎨</span>
              <span>لم تكتمل أي مهمة توليد في الجلسة الحالية بعد.</span>
            </div>
          )}
        </div>
      </div>

      {/* Quick Test Modal */}
      {showTestModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="w-full max-w-lg p-5 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col gap-4 text-right">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <strong className="text-base text-white flex items-center gap-2">
                <span>🦆</span>
                <span>توليد صورة تجريبية فورية عبر Duck.ai</span>
              </strong>
              <button
                type="button"
                onClick={() => setShowTestModal(false)}
                className="text-slate-400 hover:text-white font-mono cursor-pointer"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-300">
              سيتم إرسال هذا الوصف إلى إحدى جلسات Duck.ai الجاهزة، والتحقق الصارم من بايتات الصورة عبر Sharp.
            </p>

            <textarea
              value={testPromptInput}
              onChange={(e) => setTestPromptInput(e.target.value)}
              onInput={(e) => setTestPromptInput((e.target as HTMLTextAreaElement).value)}
              onPaste={(e) => {
                const text = e.clipboardData.getData("text");
                if (text) setTestPromptInput(text);
              }}
              placeholder="A brave heroic warrior standing in an ancient mystical temple, glowing runes, detailed korean manhwa style"
              rows={3}
              className="w-full p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-200 focus:border-amber-500 focus:outline-none"
              dir="ltr"
            />

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowTestModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => handleQuickTestGeneration()}
                disabled={!testPromptInput.trim() || isTestingGen}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs cursor-pointer disabled:opacity-50"
              >
                {isTestingGen ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                <span>{isTestingGen ? "جاري التوليد والفحص..." : "بدء التوليد الفوري"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class DuckAiDashboardErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[DuckAiDashboardErrorBoundary] Caught render error:", error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  override render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 rounded-2xl bg-slate-900 border border-rose-500/40 text-slate-100 flex flex-col gap-4 text-right shadow-2xl" dir="rtl">
          <div className="flex items-center gap-2.5 text-rose-400">
            <span className="p-2 rounded-xl bg-rose-500/20 text-rose-300">⚠️</span>
            <strong className="text-base font-bold">تم عزل خطأ غير متوقع في لوحة تحكم Duck.ai</strong>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            تم اعتراض الاستثناء بنجاح لمنع انهيار الواجهة أو ظهور شاشة بيضاء. تبقى جلسات المتصفح وخادم DuckAI2API قيد التشغيل بأمان.
          </p>
          <div className="p-3 rounded-xl bg-slate-950 font-mono text-xs text-rose-300 border border-slate-800 break-words" dir="ltr">
            {this.state.error?.message || String(this.state.error)}
          </div>
          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={this.handleReset}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs cursor-pointer transition"
            >
              إعادة تحميل لوحة التحكم
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function DuckAiUnifiedDashboard(props: DuckAiUnifiedDashboardProps) {
  return (
    <DuckAiDashboardErrorBoundary>
      <DuckAiUnifiedDashboardInner {...props} />
    </DuckAiDashboardErrorBoundary>
  );
}
