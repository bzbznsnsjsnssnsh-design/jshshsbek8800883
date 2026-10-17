import React, { useState } from "react";
import {
  X,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Eye,
  Check,
  Star,
  ShieldCheck,
  Loader2,
  ExternalLink,
  ChevronRight,
  ChevronLeft,
  Wand2,
} from "lucide-react";
import type {
  FlowBackgroundTask,
  SceneCandidateImage,
  StudioSceneItem,
  StudioLocationItem,
  StudioProductionElement,
} from "../../types/novelToManga";
import {
  inspectAutoGeneratorCandidatesApi,
  bindAutoGeneratorCandidateApi,
  retryAutoGeneratorTaskApi,
} from "../../services/novelToMangaClient";

interface SceneCandidatesModalProps {
  isOpen: boolean;
  onClose: () => void;
  scene: StudioSceneItem;
  task?: FlowBackgroundTask | null;
  location?: StudioLocationItem;
  productionElements?: StudioProductionElement[];
  geminiCookies?: string;
  onCandidateSelected: (sceneId: string, candidate: SceneCandidateImage) => void;
  onTaskUpdated?: (updatedTask: FlowBackgroundTask) => void;
}

export function SceneCandidatesModal({
  isOpen,
  onClose,
  scene,
  task,
  location,
  productionElements,
  geminiCookies,
  onCandidateSelected,
  onTaskUpdated,
}: SceneCandidatesModalProps) {
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>(
    scene.active_candidate_id || task?.candidateImages[0]?.id || ""
  );
  const [isAuditing, setIsAuditing] = useState<boolean>(false);
  const [isBinding, setIsBinding] = useState<boolean>(false);
  const [auditNotice, setAuditNotice] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);

  if (!isOpen) return null;

  const candidates: SceneCandidateImage[] =
    task?.candidateImages && task.candidateImages.length > 0
      ? task.candidateImages
      : scene.candidate_images && scene.candidate_images.length > 0
      ? scene.candidate_images
      : [];

  const activeCandidate =
    candidates.find((c) => c.id === selectedCandidateId) || candidates[0];

  const handleInspectAllCandidates = async () => {
    if (!task?.taskId) {
      setAuditNotice({
        type: "error",
        text: "لا توجد مهمة توليد خلفية مسجلة لهذا المشهد بعد. قم بتشغيل التوليد التلقائي أولاً.",
      });
      return;
    }

    setIsAuditing(true);
    setAuditNotice({
      type: "info",
      text: "جارٍ فحص الصور الأربع بدقة ومقارنتها بمراجع المشهد عبر محرك Gemini Vision...",
    });

    try {
      const res = await inspectAutoGeneratorCandidatesApi(task.taskId, {
        geminiCookies,
        maxHealAttempts: 2,
        sceneOverride: scene,
        locationOverride: location,
        productionElements,
      });

      if (res.success && res.task) {
        if (onTaskUpdated) onTaskUpdated(res.task);
        setAuditNotice({
          type: "success",
          text:
            res.message ||
            `✓ اكتمل الفحص: ${res.summary?.approvedCount || 0} مقبولة و ${res.summary?.rejectedCount || 0} بحاجة لمراجعة. تم الحفاظ على الصور المقبولة!`,
        });
      } else {
        setAuditNotice({
          type: "error",
          text: res.error || "حدث خطأ أثناء فحص الصور.",
        });
      }
    } catch (err: any) {
      setAuditNotice({
        type: "error",
        text: err?.message || "تعذر إكمال فحص الصور.",
      });
    } finally {
      setIsAuditing(false);
    }
  };

  const handleBindCandidate = async (candidate: SceneCandidateImage) => {
    setIsBinding(true);
    try {
      if (task?.taskId) {
        const res = await bindAutoGeneratorCandidateApi(task.taskId, candidate.id);
        if (res.success && res.task) {
          if (onTaskUpdated) onTaskUpdated(res.task);
        }
      }

      onCandidateSelected(scene.scene_id, candidate);
      setSelectedCandidateId(candidate.id);
      setAuditNotice({
        type: "success",
        text: `✓ تم اعتماد الصورة بنجاح وربطها بالمشهد (${scene.scene_id}) وحفظها داخل Checkpoint!`,
      });
    } catch (err: any) {
      setAuditNotice({
        type: "error",
        text: err?.message || "تعذر اعتماد الصورة.",
      });
    } finally {
      setIsBinding(false);
    }
  };

  const approvedCount = candidates.filter((c) => c.status === "APPROVED").length;
  const rejectedCount = candidates.filter((c) => c.status === "REJECTED").length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/80 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-5xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 bg-slate-950/70 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-400">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-white">
                  معاينة وفحص الصور الأربع — {scene.title}
                </h2>
                <span className="px-2 py-0.5 rounded bg-slate-800 text-[11px] font-mono text-emerald-300">
                  {scene.scene_id}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                4 صور مرشحة مولدة آلياً عبر Google Flow مع مراجعة بصرية دقيقة وتصحيح ذاتي.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleInspectAllCandidates}
              disabled={isAuditing || candidates.length === 0}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md transition disabled:opacity-40 cursor-pointer"
            >
              {isAuditing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ShieldCheck className="h-4 w-4" />
              )}
              <span>فحص الصور الأربع وتصحيح المرفوضات</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Notice Banner */}
        {auditNotice && (
          <div
            className={`px-4 py-2.5 text-xs flex items-center justify-between border-b ${
              auditNotice.type === "success"
                ? "bg-emerald-950/60 border-emerald-500/40 text-emerald-200"
                : auditNotice.type === "error"
                ? "bg-rose-950/60 border-rose-500/40 text-rose-200"
                : "bg-sky-950/60 border-sky-500/40 text-sky-200"
            }`}
          >
            <span>{auditNotice.text}</span>
            <button
              type="button"
              onClick={() => setAuditNotice(null)}
              className="text-[11px] underline opacity-80 hover:opacity-100 cursor-pointer"
            >
              إغلاق
            </button>
          </div>
        )}

        {/* Content Body */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 flex flex-col lg:flex-row gap-6">
          {/* Left Column: Big Preview & Audit Findings */}
          <div className="flex-1 flex flex-col gap-4">
            <div className="relative w-full aspect-[16/10] sm:aspect-[16/9] rounded-xl bg-slate-950 border border-slate-800 overflow-hidden flex items-center justify-center">
              {activeCandidate ? (
                <>
                  <img
                    src={activeCandidate.image_url}
                    alt={activeCandidate.id}
                    className="w-full h-full object-contain"
                  />
                  {/* Status Overlay */}
                  <div className="absolute top-3 right-3 flex items-center gap-1.5 flex-wrap">
                    <span
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold border backdrop-blur-md shadow-md ${
                        activeCandidate.status === "APPROVED"
                          ? "bg-emerald-950/90 border-emerald-500/50 text-emerald-300"
                          : activeCandidate.status === "REJECTED"
                          ? "bg-rose-950/90 border-rose-500/50 text-rose-300"
                          : "bg-slate-900/90 border-slate-700 text-slate-300"
                      }`}
                    >
                      {activeCandidate.status === "APPROVED"
                        ? "✓ معتمدة (APPROVED)"
                        : activeCandidate.status === "REJECTED"
                        ? "✗ بحاجة لتصحيح (REJECTED)"
                        : "قيد المراجعة (PENDING)"}
                    </span>

                    {(scene.active_candidate_id === activeCandidate.id ||
                      scene.image_url === activeCandidate.image_url) && (
                      <span className="px-2.5 py-1 rounded-lg bg-amber-500/20 border border-amber-500/50 text-amber-300 text-xs font-bold backdrop-blur-md flex items-center gap-1">
                        <Star className="h-3.5 w-3.5 fill-current" />
                        <span>الصورة الرسمية المعتمدة للمشهد</span>
                      </span>
                    )}
                  </div>

                  {/* Bottom Action Bar over Image */}
                  <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between p-2.5 rounded-xl bg-slate-950/85 backdrop-blur-md border border-slate-800/80">
                    <div className="text-xs font-mono text-slate-300">
                      معرف الصورة: <strong>{activeCandidate.id}</strong>
                      {activeCandidate.audit_result?.score !== undefined && (
                        <span className="mr-2 text-emerald-400">
                          (الدرجة: {activeCandidate.audit_result.score}%)
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleBindCandidate(activeCandidate)}
                      disabled={isBinding}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow transition cursor-pointer disabled:opacity-50"
                    >
                      {isBinding ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                      <span>اعتماد هذه الصورة كصورة نهائية للمشهد</span>
                    </button>
                  </div>
                </>
              ) : (
                <div className="text-center p-6 text-slate-500">
                  <AlertTriangle className="h-8 w-8 mx-auto mb-2 opacity-40 text-amber-400" />
                  <p className="text-xs">لم يتم استلام صور مرشحة بعد.</p>
                </div>
              )}
            </div>

            {/* Audit Details Box */}
            {activeCandidate?.audit_result && (
              <div className="p-4 rounded-xl bg-slate-950/90 border border-slate-800 text-xs space-y-2.5">
                <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                  <span className="font-bold text-slate-200">
                    تقرير الفحص البصري للمرشح (Gemini Vision Audit Report):
                  </span>
                  <span
                    className={`font-mono font-bold ${
                      activeCandidate.audit_result.approved
                        ? "text-emerald-400"
                        : "text-amber-400"
                    }`}
                  >
                    {activeCandidate.audit_result.approved
                      ? `✓ PASS (Score: ${activeCandidate.audit_result.score ?? 100}%)`
                      : `✗ REVIEW (Score: ${activeCandidate.audit_result.score ?? 65}%)`}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                  <div className="p-2 rounded bg-slate-900 border border-slate-800/80">
                    <span className="text-slate-400 block">ثبات الشخصية:</span>
                    <strong
                      className={
                        activeCandidate.audit_result.character_match
                          ? "text-emerald-400"
                          : "text-rose-400"
                      }
                    >
                      {activeCandidate.audit_result.character_match ? "✓ مطابقة" : "✗ غير مطابقة"}
                    </strong>
                  </div>
                  <div className="p-2 rounded bg-slate-900 border border-slate-800/80">
                    <span className="text-slate-400 block">الزي والسلاح:</span>
                    <strong
                      className={
                        activeCandidate.audit_result.costume_match
                          ? "text-emerald-400"
                          : "text-rose-400"
                      }
                    >
                      {activeCandidate.audit_result.costume_match ? "✓ مطابقة" : "✗ غير مطابقة"}
                    </strong>
                  </div>
                  <div className="p-2 rounded bg-slate-900 border border-slate-800/80">
                    <span className="text-slate-400 block">تطابق الموقع:</span>
                    <strong
                      className={
                        activeCandidate.audit_result.location_match
                          ? "text-emerald-400"
                          : "text-rose-400"
                      }
                    >
                      {activeCandidate.audit_result.location_match ? "✓ مطابقة" : "✗ غير مطابقة"}
                    </strong>
                  </div>
                  <div className="p-2 rounded bg-slate-900 border border-slate-800/80">
                    <span className="text-slate-400 block">تكوين المشهد:</span>
                    <strong
                      className={
                        activeCandidate.audit_result.scene_accuracy
                          ? "text-emerald-400"
                          : "text-rose-400"
                      }
                    >
                      {activeCandidate.audit_result.scene_accuracy ? "✓ مطابقة" : "✗ غير مطابقة"}
                    </strong>
                  </div>
                </div>

                {activeCandidate.audit_result.feedback && (
                  <p className="text-slate-300 text-[11px] leading-relaxed">
                    <strong>الملاحظات البصرية:</strong> {activeCandidate.audit_result.feedback}
                  </p>
                )}

                {activeCandidate.audit_result.additive_correction && (
                  <div className="p-2.5 rounded-lg bg-amber-950/40 border border-amber-500/40 text-[11px] font-mono text-amber-200">
                    <strong>+ تعليمات التصحيح الذاتي:</strong> {activeCandidate.audit_result.additive_correction}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right Column: 4 Candidates Grid Selector & Queue Summary */}
          <div className="w-full lg:w-80 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-300">
                الصور المرشحة الأربع ({candidates.length}/4):
              </h3>
              <div className="flex items-center gap-2 text-[11px] font-mono">
                <span className="text-emerald-400">✓ {approvedCount}</span>
                <span className="text-rose-400">✗ {rejectedCount}</span>
              </div>
            </div>

            {/* 4 Thumbnails */}
            <div className="grid grid-cols-2 gap-2.5">
              {[0, 1, 2, 3].map((slotIdx) => {
                const cand = candidates[slotIdx];
                const isSelected = cand && cand.id === selectedCandidateId;
                const isWinning =
                  cand &&
                  (scene.active_candidate_id === cand.id || scene.image_url === cand.image_url);

                return (
                  <div
                    key={slotIdx}
                    onClick={() => cand && setSelectedCandidateId(cand.id)}
                    className={`relative aspect-[9/14] sm:aspect-[9/13] rounded-xl border-2 overflow-hidden transition cursor-pointer flex flex-col justify-between ${
                      isSelected
                        ? "border-emerald-500 ring-2 ring-emerald-500/40 shadow-lg"
                        : "border-slate-800 hover:border-slate-700 bg-slate-950"
                    }`}
                  >
                    {cand ? (
                      <>
                        <img
                          src={cand.image_url}
                          alt={cand.id}
                          className="w-full h-full object-cover"
                        />
                        {/* Top Badges */}
                        <div className="absolute top-1.5 right-1.5 left-1.5 flex items-center justify-between gap-1">
                          <span className="px-1.5 py-0.5 rounded bg-slate-950/80 text-[10px] font-mono font-bold text-slate-200">
                            #{slotIdx + 1}
                          </span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                              cand.status === "APPROVED"
                                ? "bg-emerald-950/90 text-emerald-300 border border-emerald-500/40"
                                : cand.status === "REJECTED"
                                ? "bg-rose-950/90 text-rose-300 border border-rose-500/40"
                                : "bg-slate-900/90 text-slate-300"
                            }`}
                          >
                            {cand.status === "APPROVED"
                              ? "✓ PASS"
                              : cand.status === "REJECTED"
                              ? "✗ FIX"
                              : "PENDING"}
                          </span>
                        </div>

                        {/* Active Badge */}
                        {isWinning && (
                          <div className="absolute bottom-1.5 left-1.5 right-1.5 p-1 rounded bg-amber-500/90 text-slate-950 font-bold text-[9px] text-center flex items-center justify-center gap-1">
                            <Star className="h-2.5 w-2.5 fill-current" />
                            <span>المعتمدة</span>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center p-3 text-center text-slate-600 bg-slate-950/60">
                        <Wand2 className="h-6 w-6 opacity-30 mb-1" />
                        <span className="text-[10px] font-mono">صورة #{slotIdx + 1}</span>
                        <span className="text-[9px] text-slate-500 mt-1">قيد التوليد...</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Task Details Info */}
            {task && (
              <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 text-xs space-y-1.5">
                <div className="text-slate-400">
                  معرف المهمة: <strong className="font-mono text-emerald-400 text-[11px]">{task.taskId}</strong>
                </div>
                <div className="text-slate-400">
                  الحالة:{" "}
                  <strong
                    className={`font-mono text-[11px] ${
                      task.status === "COMPLETED"
                        ? "text-emerald-400"
                        : task.status === "FAILED"
                        ? "text-rose-400"
                        : "text-amber-400"
                    }`}
                  >
                    {task.status}
                  </strong>
                </div>
                <div className="text-slate-400 text-[11px]">
                  رسالة التقدم: <span className="text-slate-300">{task.progressMessage}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
