import React, { useState } from "react";
import {
  Sparkles,
  Layers,
  Play,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ChevronDown,
  ChevronUp,
  Eye,
  ExternalLink,
} from "lucide-react";
import type { FlowBackgroundTask } from "../../types/novelToManga";

interface AutoGeneratorTaskBarProps {
  tasks: FlowBackgroundTask[];
  isLoading: boolean;
  onRetryTask: (taskId: string) => void;
  onCancelTask: (taskId: string) => void;
  onOpenCandidatesModal: (sceneId: string, task?: FlowBackgroundTask) => void;
  onBatchGenerateAll: () => void;
  onOpenFlowBrowserTab?: () => void;
}

export function AutoGeneratorTaskBar({
  tasks,
  isLoading,
  onRetryTask,
  onCancelTask,
  onOpenCandidatesModal,
  onBatchGenerateAll,
  onOpenFlowBrowserTab,
}: AutoGeneratorTaskBarProps) {
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  const activeTasks = tasks.filter(
    (t) => t.status === "RUNNING" || t.status === "GENERATING" || t.status === "FETCHING" || t.status === "QUEUED"
  );
  const pausedTasks = tasks.filter((t) => t.status === "PAUSED_SECURITY_CHECK");
  const completedTasks = tasks.filter((t) => t.status === "COMPLETED");
  const failedTasks = tasks.filter((t) => t.status === "FAILED");

  if (tasks.length === 0) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:w-[460px] z-40">
      <div className="bg-slate-900/95 border border-emerald-500/40 rounded-2xl shadow-2xl backdrop-blur-md overflow-hidden text-xs">
        {/* Bar Header */}
        <div
          onClick={() => setIsExpanded((v) => !v)}
          className="p-3 bg-slate-950/80 flex items-center justify-between gap-3 cursor-pointer select-none hover:bg-slate-950 transition"
        >
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <div className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400">
                <Sparkles className="h-4 w-4" />
              </div>
              {activeTasks.length > 0 && (
                <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                </span>
              )}
            </div>

            <div>
              <div className="flex items-center gap-2 font-bold text-white">
                <span>Duck.ai Auto Generator</span>
                <span className="px-1.5 py-0.2 rounded bg-slate-800 text-[10px] font-mono text-emerald-300">
                  {tasks.length} مهام
                </span>
              </div>
              <div className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5">
                {activeTasks.length > 0 ? (
                  <span className="text-amber-300 flex items-center gap-1 font-semibold">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>جاري التوليد ({activeTasks.length} نشطة)...</span>
                  </span>
                ) : pausedTasks.length > 0 ? (
                  <span className="text-rose-300 flex items-center gap-1 font-semibold">
                    <AlertTriangle className="h-3 w-3" />
                    <span>توقف لحل كابتشا البطة أو حد الاستخدام</span>
                  </span>
                ) : (
                  <span className="text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    <span>جاهز — {completedTasks.length} مهام مكتملة بنجاح</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="p-1 text-slate-400 hover:text-white transition"
            >
              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Expanded Task List Drawer */}
        {isExpanded && (
          <div className="max-h-72 overflow-y-auto divide-y divide-slate-800/80 p-1">
            {pausedTasks.length > 0 && (
              <div className="p-2.5 bg-rose-950/40 border-b border-rose-500/30 text-rose-200 space-y-1.5">
                <div className="flex items-center gap-1.5 font-bold text-[11px]">
                  <AlertTriangle className="h-3.5 w-3.5 text-rose-400" />
                  <span>تنبيه كابتشا أو حد استخدام Duck.ai:</span>
                </div>
                <p className="text-[11px] leading-relaxed">
                  يطلب الموقع حل كابتشا البطة أو الانتظار لانتهاء تقييد المعدل. يرجى التفاعل عبر تبويب «متصفح Duck.ai» داخل التطبيق.
                </p>
                {onOpenFlowBrowserTab && (
                  <button
                    type="button"
                    onClick={onOpenFlowBrowserTab}
                    className="flex items-center gap-1 px-2.5 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white font-bold text-[10px] cursor-pointer"
                  >
                    <ExternalLink className="h-3 w-3" />
                    <span>فتح متصفح Duck.ai المدمج</span>
                  </button>
                )}
              </div>
            )}

            {tasks.map((task) => {
              const candCount = task.candidateImages?.length || 0;
              const isRunning =
                task.status === "RUNNING" ||
                task.status === "GENERATING" ||
                task.status === "FETCHING";

              return (
                <div
                  key={task.taskId}
                  className="p-2.5 flex items-center justify-between gap-3 hover:bg-slate-800/40 transition"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white truncate max-w-[170px]">
                        {task.sceneTitle || task.sceneId}
                      </span>
                      <span
                        className={`px-1.5 py-0.2 rounded text-[10px] font-mono font-bold ${
                          task.status === "COMPLETED"
                            ? "bg-emerald-950 text-emerald-300 border border-emerald-500/40"
                            : isRunning
                            ? "bg-amber-950 text-amber-300 border border-amber-500/40"
                            : task.status === "PAUSED_SECURITY_CHECK"
                            ? "bg-rose-950 text-rose-300 border border-rose-500/40"
                            : "bg-slate-800 text-slate-300"
                        }`}
                      >
                        {task.status}
                      </span>
                    </div>

                    <p className="text-[10px] text-slate-400 truncate mt-0.5">
                      {task.progressMessage || `${candCount}/4 صور مرشحة جاهزة`}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* View candidates button */}
                    <button
                      type="button"
                      onClick={() => onOpenCandidatesModal(task.sceneId, task)}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold cursor-pointer"
                      title="عرض وفحص الصور الأربع"
                    >
                      <Eye className="h-3 w-3 text-emerald-400" />
                      <span>{candCount}/4</span>
                    </button>

                    {/* Retry button */}
                    {(task.status === "FAILED" ||
                      task.status === "PAUSED_SECURITY_CHECK" ||
                      candCount < 4) && (
                      <button
                        type="button"
                        onClick={() => onRetryTask(task.taskId)}
                        className="p-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 transition cursor-pointer"
                        title="إعادة المحاولة ومتابعة التوليد"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
