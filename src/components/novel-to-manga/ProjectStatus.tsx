import React from "react";

interface ProjectStatusProps {
  geminiConnected: boolean;
  flowConnected: boolean;
  imageProvider?: "google_flow" | "duck_ai";
  duckAiConnected?: boolean;
  lockedReferencesCount: number;
  totalReferencesCount: number;
  approvedPagesCount: number;
  totalPagesCount: number;
}

export default function ProjectStatus({
  geminiConnected,
  flowConnected,
  imageProvider = "google_flow",
  duckAiConnected = false,
  lockedReferencesCount,
  totalReferencesCount,
  approvedPagesCount,
  totalPagesCount,
}: ProjectStatusProps) {
  return (
    <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl px-4 py-3 mb-5">
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
        <span className="font-semibold text-slate-400">Project Status</span>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono tabular-nums">
          <div className="flex items-center gap-1.5">
            <span
              className={`h-2 w-2 rounded-full ${
                geminiConnected ? "bg-emerald-400" : "bg-amber-400"
              }`}
            />
            <span className="text-slate-300">
              Gemini Cookies: <strong className="text-emerald-400">تحليل، فهم، مراجعة</strong> ({geminiConnected ? "متصل" : "غير متصل"})
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span
              className={`h-2 w-2 rounded-full ${
                imageProvider === "duck_ai"
                  ? duckAiConnected
                    ? "bg-emerald-400"
                    : "bg-amber-400"
                  : flowConnected
                  ? "bg-emerald-400"
                  : "bg-amber-400"
              }`}
            />
            <span className="text-slate-300">
              {imageProvider === "duck_ai" ? (
                <>Duck.ai: <strong className="text-amber-400">توليد الصور</strong> ({duckAiConnected ? "متصل" : "يتطلب فحص"})</>
              ) : (
                <>Google Flow: <strong className="text-sky-400">توليد الصور فقط</strong> ({flowConnected ? "متصل" : "غير متصل"})</>
              )}
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-slate-300">
            <span className="h-2 w-2 rounded-full bg-sky-400" />
            <span>
              Visual Bible: {lockedReferencesCount} Locked ({lockedReferencesCount}/{totalReferencesCount})
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-slate-300">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span>
              Pages: {approvedPagesCount} / {totalPagesCount}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
