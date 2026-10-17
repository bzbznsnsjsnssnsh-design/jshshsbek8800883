import crypto from "crypto";
import fs from "fs";
import path from "path";
import { googleFlowProvider, sanitizeTextForLog } from "./googleFlowProvider.ts";
import { geminiCookiesNovelService } from "./geminiCookiesNovelService.ts";
import { flowBrowserService } from "./flowBrowserService.ts";
import { duckAiProvider } from "./duckAiProvider.ts";
import type {
  FlowBackgroundTask,
  FlowBackgroundTaskStatus,
  SceneCandidateImage,
  FlowDisplayModelName,
  StudioSceneItem,
  StudioLocationItem,
  StudioProductionElement,
} from "../src/types/novelToManga.ts";

export interface CreateTaskParams {
  sceneId: string;
  pageId?: string;
  sceneTitle?: string;
  prompt: string;
  stylePreset: string;
  aspectRatio: string;
  modelDisplayName: FlowDisplayModelName;
  referenceFilePaths?: string[];
  projectId?: string;
  maxAttempts?: number;
}

export class FlowBackgroundTaskEngine {
  private static instance: FlowBackgroundTaskEngine | null = null;

  private tasksFilePath: string;
  private tasks = new Map<string, FlowBackgroundTask>();
  private queue: string[] = [];
  private isProcessing = false;
  private maxAttemptsDefault = 3;

  private constructor() {
    const dataDir = path.resolve(process.cwd(), "data/novel_to_manga");
    if (!fs.existsSync(dataDir)) {
      try {
        fs.mkdirSync(dataDir, { recursive: true });
      } catch (_) {}
    }
    this.tasksFilePath = path.join(dataDir, "flow_background_tasks.json");
    this.loadTasksFromDisk();
    // Start processing any recovered queued tasks on startup
    setTimeout(() => this.processQueue().catch(() => {}), 1000);
  }

  public static getInstance(): FlowBackgroundTaskEngine {
    if (!FlowBackgroundTaskEngine.instance) {
      FlowBackgroundTaskEngine.instance = new FlowBackgroundTaskEngine();
    }
    return FlowBackgroundTaskEngine.instance;
  }

  /**
   * Loads tasks from persistent storage, recovering in-flight tasks gracefully
   */
  private loadTasksFromDisk(): void {
    if (!fs.existsSync(this.tasksFilePath)) return;
    try {
      const raw = fs.readFileSync(this.tasksFilePath, "utf-8");
      const list: FlowBackgroundTask[] = JSON.parse(raw);
      if (Array.isArray(list)) {
        for (const t of list) {
          if (t && t.taskId) {
            // If the server restarted during execution, reset to QUEUED to resume without losing existing candidates
            if (t.status === "RUNNING" || t.status === "GENERATING" || t.status === "FETCHING") {
              t.status = "QUEUED";
              t.progressMessage = `تمت استعادة المهمة بعد إعادة تشغيل الخادم (${t.candidateImages?.length || 0}/4 صور محفوظة). في الانتظار...`;
              this.queue.push(t.taskId);
            } else if (t.status === "QUEUED") {
              this.queue.push(t.taskId);
            }
            this.tasks.set(t.taskId, t);
          }
        }
        console.log(`[FlowTaskEngine] Recovered ${this.tasks.size} background tasks from disk.`);
      }
    } catch (err: any) {
      console.warn("[FlowTaskEngine] Notice reading tasks file:", err?.message);
    }
  }

  /**
   * Persists tasks map to disk atomically
   */
  private saveTasksToDisk(): void {
    try {
      const list = Array.from(this.tasks.values());
      const tempPath = `${this.tasksFilePath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(list, null, 2), "utf-8");
      fs.renameSync(tempPath, this.tasksFilePath);
    } catch (err: any) {
      console.warn("[FlowTaskEngine] Warning saving tasks to disk:", err?.message);
    }
  }

  /**
   * Creates an independent background task for a scene or page
   */
  public createTask(params: CreateTaskParams): FlowBackgroundTask {
    // Check if an active/queued task already exists for this scene to prevent duplicate runs
    const existing = Array.from(this.tasks.values()).find(
      (t) =>
        t.sceneId === params.sceneId &&
        (t.status === "QUEUED" || t.status === "RUNNING" || t.status === "GENERATING" || t.status === "FETCHING")
    );
    if (existing) {
      return existing;
    }

    const taskId = `task_${params.sceneId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const nowIso = new Date().toISOString();

    const task: FlowBackgroundTask = {
      taskId,
      sceneId: params.sceneId,
      pageId: params.pageId,
      sceneTitle: params.sceneTitle || params.sceneId,
      prompt: params.prompt,
      stylePreset: params.stylePreset || "Korean Manhwa",
      aspectRatio: params.aspectRatio || "9:16",
      modelDisplayName: params.modelDisplayName || "Nano Banana 2",
      referenceFilePaths: params.referenceFilePaths || [],
      status: "QUEUED",
      progressMessage: "في طابور التوليد التلقائي لـ Google Flow...",
      candidateImages: [],
      requiredCount: 4,
      currentAttempt: 1,
      maxAttempts: params.maxAttempts || this.maxAttemptsDefault,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    this.tasks.set(taskId, task);
    this.queue.push(taskId);
    this.saveTasksToDisk();

    console.log(`[FlowTaskEngine] Created task ${taskId} for scene ${params.sceneId}. Queue length: ${this.queue.length}`);
    this.processQueue().catch((err) => {
      console.warn("[FlowTaskEngine] Queue process notice:", err?.message);
    });

    return task;
  }

  /**
   * Batch creates independent tasks for multiple scenes/pages
   */
  public createTasksBatch(batch: CreateTaskParams[]): FlowBackgroundTask[] {
    const createdList: FlowBackgroundTask[] = [];
    for (const p of batch) {
      createdList.push(this.createTask(p));
    }
    return createdList;
  }

  public getTasks(): FlowBackgroundTask[] {
    return Array.from(this.tasks.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  public getTask(taskId: string): FlowBackgroundTask | undefined {
    return this.tasks.get(taskId);
  }

  public getTaskBySceneId(sceneId: string): FlowBackgroundTask | undefined {
    return Array.from(this.tasks.values())
      .filter((t) => t.sceneId === sceneId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  }

  public cancelTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    if (task.status === "QUEUED") {
      task.status = "FAILED";
      task.error = "تم إلغاء المهمة من قبل المستخدم.";
      task.progressMessage = "ملغاة";
      this.queue = this.queue.filter((id) => id !== taskId);
      this.saveTasksToDisk();
      return true;
    }
    return false;
  }

  public retryTask(taskId: string): FlowBackgroundTask | undefined {
    const task = this.tasks.get(taskId);
    if (!task) return undefined;
    task.status = "QUEUED";
    task.error = null;
    task.securityChallengeRequired = false;
    task.securityMessage = null;
    task.progressMessage = `إعادة المحاولة... (${task.candidateImages.length}/4 صور محفوظة)`;
    task.updatedAt = new Date().toISOString();
    if (!this.queue.includes(taskId)) {
      this.queue.push(taskId);
    }
    this.saveTasksToDisk();
    this.processQueue().catch(() => {});
    return task;
  }

  /**
   * Main FIFO Queue Runner (Concurrency = 1 to protect Flow session and rate limits)
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      while (this.queue.length > 0) {
        const taskId = this.queue.shift();
        if (!taskId) continue;

        const task = this.tasks.get(taskId);
        if (!task || task.status === "COMPLETED" || task.status === "FAILED") continue;

        console.log(`[FlowTaskEngine] Starting background execution of task ${taskId} (Scene: ${task.sceneId})...`);
        await this.executeTask(task);
        this.saveTasksToDisk();
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Executes a single task, ensuring 4 distinct valid candidate images are generated & saved
   */
  private async executeTask(task: FlowBackgroundTask): Promise<void> {
    task.status = "RUNNING";
    task.updatedAt = new Date().toISOString();
    task.progressMessage = "جاري التحقق من جاهزية Duck.ai...";
    this.saveTasksToDisk();

    // 1. Verify Duck.ai Page & Captcha / Rate Limit Status
    const duckStatus = await duckAiProvider.checkStatus();
    if (duckStatus.hasCaptchaChallenge) {
      task.status = "PAUSED_SECURITY_CHECK";
      task.securityChallengeRequired = true;
      task.securityMessage =
        "تحدي التحقق البشري من DuckDuckGo نشط حالياً. يرجى فتح متصفح Duck.ai المدمج وحل التحدي ثم الضغط على 'إعادة المحاولة'.";
      task.error = "DUCK_CAPTCHA_REQUIRED: كابتشا البطة نشطة.";
      task.progressMessage = "توقفت المهمة: تتطلب حل الكابتشا في متصفح Duck.ai.";
      return;
    }

    if (duckStatus.isRateLimited) {
      task.status = "PAUSED_SECURITY_CHECK";
      task.securityChallengeRequired = true;
      task.securityMessage = "تم بلوغ حد الاستخدام في Duck.ai. توقف الطابور مؤقتاً لحين عودة الحصة.";
      task.error = "DUCK_RATE_LIMITED: تم بلوغ حد الاستخدام.";
      task.progressMessage = "توقفت المهمة: تم بلوغ حد الاستخدام العام.";
      return;
    }

    // 2. Prepare Directory for Candidates: public/manga_storage/scenes/{sceneId}/candidates/
    const sceneStorageDir = path.resolve(process.cwd(), `public/manga_storage/scenes/${task.sceneId}/candidates`);
    if (!fs.existsSync(sceneStorageDir)) {
      try {
        fs.mkdirSync(sceneStorageDir, { recursive: true });
      } catch (_) {}
    }

    const seenUrls = new Set<string>(task.candidateImages.map((c) => c.image_url));
    const seenHashes = new Set<string>();

    // Hash existing images to prevent duplication
    for (const cand of task.candidateImages) {
      if (cand.local_file_path && fs.existsSync(cand.local_file_path)) {
        try {
          const buf = fs.readFileSync(cand.local_file_path);
          const h = crypto.createHash("sha256").update(buf.subarray(0, 1024)).digest("hex");
          seenHashes.add(h);
        } catch (_) {}
      }
    }

    let cycle = 0;
    const maxCycles = 6; // Safety ceiling to prevent infinite loops

    while (task.candidateImages.length < task.requiredCount && cycle < maxCycles) {
      cycle++;
      task.status = "GENERATING";
      task.progressMessage = `جاري إرسال طلب التوليد إلى Duck.ai (تم استلام ${task.candidateImages.length}/4 صور)...`;
      task.updatedAt = new Date().toISOString();
      this.saveTasksToDisk();

      try {
        // Slight prompt perturbation on supplemental requests if needed to ensure visual variation
        const effectivePrompt =
          cycle === 1
            ? task.prompt
            : `${task.prompt}\n\nVariation Angle: Variant ${cycle}, distinct camera angle, high details, novel manhwa composition.`;

        const genRes = await duckAiProvider.generateImage({
          prompt: effectivePrompt,
          referenceImages: task.referenceFilePaths || [],
          timeoutMs: 50000,
          sceneId: task.sceneId,
        });

        if (genRes.status === "CAPTCHA_REQUIRED") {
          task.status = "PAUSED_SECURITY_CHECK";
          task.securityChallengeRequired = true;
          task.securityMessage = "تحدي DuckDuckGo نشط: يرجى حل كابتشا البطة في تبويب متصفح Duck.ai المدمج ثم الضغط على 'إعادة المحاولة'.";
          task.error = genRes.error || "CAPTCHA Challenge";
          task.progressMessage = "توقفت المهمة: تتطلب حل الكابتشا في متصفح Duck.ai.";
          return;
        }

        if (genRes.status === "LIMIT_REACHED") {
          task.status = "PAUSED_SECURITY_CHECK";
          task.securityChallengeRequired = true;
          task.securityMessage = "تم بلوغ حد الاستخدام في Duck.ai. توقف الطابور مؤقتاً لحين عودة الحصة.";
          task.error = genRes.error || "Rate limit reached";
          task.progressMessage = "توقفت المهمة: تم بلوغ حد الاستخدام العام.";
          return;
        }

        task.status = "FETCHING";
        task.progressMessage = `جاري استلام وفحص ملفات الصور المولدة (${task.candidateImages.length + 1}/4)...`;
        this.saveTasksToDisk();

        if (genRes.success && genRes.localUrl) {
          const sourcePath = path.resolve(process.cwd(), `public${genRes.localUrl}`);
          if (fs.existsSync(sourcePath)) {
            const buf = fs.readFileSync(sourcePath);
            const bufHash = crypto.createHash("sha256").update(buf.subarray(0, 1024)).digest("hex");

            if (!seenHashes.has(bufHash)) {
              seenHashes.add(bufHash);

              // Copy to scene candidates directory
              const targetCandidatePath = path.join(
                sceneStorageDir,
                `${task.sceneId}_candidate_${task.candidateImages.length + 1}.jpg`
              );
              fs.copyFileSync(sourcePath, targetCandidatePath);

              const publicUrl = `/manga_storage/scenes/${task.sceneId}/candidates/${path.basename(targetCandidatePath)}`;
              seenUrls.add(publicUrl);

              const newCandidate: SceneCandidateImage = {
                id: `${task.sceneId}_cand_${task.candidateImages.length + 1}`,
                image_url: publicUrl,
                local_file_path: targetCandidatePath,
                created_at: new Date().toISOString(),
                status: "PENDING",
                retry_count: 0,
              };

              task.candidateImages.push(newCandidate);
              console.log(`[FlowTaskEngine] Task ${task.taskId}: Added candidate ${task.candidateImages.length}/4 via Duck.ai.`);
            }
          }
        }

        // Brief delay between calls
        if (task.candidateImages.length < task.requiredCount) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      } catch (genErr: any) {
        console.error(`[FlowTaskEngine] Error in generation cycle ${cycle} for task ${task.taskId}:`, genErr);
        const errMsg = genErr?.message || String(genErr);

        if (errMsg.includes("CAPTCHA") || errMsg.includes("challenge")) {
          task.status = "PAUSED_SECURITY_CHECK";
          task.securityChallengeRequired = true;
          task.securityMessage = "يتطلب Duck.ai حل التحقق الأمني داخل المتصفح المدمج.";
          task.error = errMsg;
          task.progressMessage = "توقفت المهمة: تتطلب حل الكابتشا في المتصفح.";
          return;
        }

        task.error = errMsg;
        if (cycle >= maxCycles) break;
      }
    }

    if (task.candidateImages.length >= task.requiredCount) {
      task.status = "COMPLETED";
      task.completedAt = new Date().toISOString();
      task.progressMessage = `✓ اكتمل توليد 4 صور مرشحة بنجاح! جاهز للفحص البصري عبر زر «فحص الصور الأربع».`;
      task.error = null;
    } else if (task.candidateImages.length > 0) {
      task.status = "COMPLETED";
      task.completedAt = new Date().toISOString();
      task.progressMessage = `تم استلام ${task.candidateImages.length} من 4 صور مرشحة. يمكنك طلب التوليد مجدداً لاستكمال الباقي.`;
    } else {
      task.status = "FAILED";
      task.progressMessage = `فشل التوليد: ${task.error || "لم يتم استلام أي صورة من Google Flow"}`;
    }

    task.updatedAt = new Date().toISOString();
    this.saveTasksToDisk();
    this.syncCandidateImagesToSceneCheckpoint(task);
  }

  /**
   * Helper to update scene in a checkpoint file safely
   */
  private updateSceneInCheckpointFile(
    fullPath: string,
    task: FlowBackgroundTask,
    candidateToBind?: SceneCandidateImage
  ): boolean {
    if (!fs.existsSync(fullPath)) return false;
    try {
      const raw = fs.readFileSync(fullPath, "utf-8");
      const cp = JSON.parse(raw);
      let changed = false;

      const target = cp.state && typeof cp.state === "object" ? cp.state : cp;
      if (Array.isArray(target.scenes)) {
        target.scenes = target.scenes.map((sc: StudioSceneItem) => {
          if (sc && sc.scene_id === task.sceneId) {
            changed = true;
            if (candidateToBind) {
              return {
                ...sc,
                candidate_images: task.candidateImages,
                image_url: candidateToBind.image_url,
                local_file_path: candidateToBind.local_file_path,
                active_candidate_id: candidateToBind.id,
                approved: candidateToBind.status === "APPROVED",
                generation_status: "COMPLETED",
              };
            } else {
              return {
                ...sc,
                candidate_images: task.candidateImages,
                image_url: sc.image_url || task.candidateImages[0]?.image_url || null,
                local_file_path: sc.local_file_path || task.candidateImages[0]?.local_file_path || null,
              };
            }
          }
          return sc;
        });

        if (changed) {
          fs.writeFileSync(fullPath, JSON.stringify(cp, null, 2), "utf-8");
          console.log(`[FlowTaskEngine] Synced ${task.candidateImages.length} candidates to scene ${task.sceneId} in ${fullPath}`);
          return true;
        }
      }
    } catch (e: any) {
      console.warn(`[FlowTaskEngine] Notice updating checkpoint file ${fullPath}:`, e?.message);
    }
    return false;
  }

  /**
   * Synchronizes candidate images into the active project checkpoint for the scene
   */
  private syncCandidateImagesToSceneCheckpoint(task: FlowBackgroundTask): void {
    try {
      // 1. Primary Studio Checkpoint File
      const primaryCheckpoint = path.resolve(process.cwd(), "public", "generated", "studio_checkpoint_state.json");
      this.updateSceneInCheckpointFile(primaryCheckpoint, task);

      // 2. Secondary Studio Checkpoint Files
      const generatedDir = path.resolve(process.cwd(), "public", "generated");
      if (fs.existsSync(generatedDir)) {
        const extraFiles = fs.readdirSync(generatedDir).filter((f) => f.startsWith("studio_checkpoint_") && f.endsWith(".json"));
        for (const ef of extraFiles) {
          this.updateSceneInCheckpointFile(path.join(generatedDir, ef), task);
        }
      }

      // 3. Fallback / Alternative Checkpoints Directory
      const checkpointDir = path.resolve(process.cwd(), "data/novel_to_manga/checkpoints");
      if (fs.existsSync(checkpointDir)) {
        const files = fs.readdirSync(checkpointDir).filter((f) => f.endsWith(".json"));
        for (const f of files) {
          this.updateSceneInCheckpointFile(path.join(checkpointDir, f), task);
        }
      }
    } catch (e: any) {
      console.warn("[FlowTaskEngine] Checkpoint sync notice:", e?.message);
    }
  }

  /**
   * Audits all 4 candidate images using Gemini Vision.
   * Retains APPROVED candidates and selectively regenerates REJECTED candidates only!
   */
  public async inspectAndAutoHealCandidates(params: {
    taskId: string;
    geminiCookies?: string;
    maxHealAttempts?: number;
    sceneOverride?: StudioSceneItem;
    locationOverride?: StudioLocationItem;
    productionElements?: StudioProductionElement[];
  }): Promise<{
    task: FlowBackgroundTask;
    summary: {
      total: number;
      approvedCount: number;
      rejectedCount: number;
      healedCount: number;
    };
  }> {
    const task = this.tasks.get(params.taskId);
    if (!task) {
      throw new Error(`TASK_NOT_FOUND: المهمة (${params.taskId}) غير موجودة.`);
    }

    if (task.candidateImages.length === 0) {
      throw new Error("NO_CANDIDATE_IMAGES: لا توجد صور مرشحة لفحصها في هذه المهمة.");
    }

    task.status = "VERIFYING";
    task.progressMessage = `جاري فحص الصور الأربع (${task.candidateImages.length} صور) عبر محرك الفحص البصري...`;
    task.updatedAt = new Date().toISOString();
    this.saveTasksToDisk();

    const maxHeal = params.maxHealAttempts || 2;
    let healedCount = 0;

    const dummyScene: StudioSceneItem = params.sceneOverride || {
      scene_id: task.sceneId,
      scene_number: 1,
      title: task.sceneTitle || task.sceneId,
      description: task.prompt,
      action: task.prompt,
      dialogue: "",
      sfx: "",
      visual_prompt: task.prompt,
      location_id: "LOC_001",
      location_name: "الموقع المعتمد",
      characters: [],
      costumes_and_weapons: [],
      approved: false,
      image_url: null,
      pipeline_stage: "COMPLETED",
      current_attempt: 1,
      max_attempts: 3,
      attempts_log: [],
    };

    // 1. First Pass: Inspect all candidates
    for (let i = 0; i < task.candidateImages.length; i++) {
      const cand = task.candidateImages[i];

      // If already approved in a prior inspection, retain it untouched!
      if (cand.status === "APPROVED" && cand.audit_result?.approved) {
        continue;
      }

      task.progressMessage = `فحص الصورة ${i + 1} من ${task.candidateImages.length} مقابل مراجع المشهد...`;
      this.saveTasksToDisk();

      try {
        const verifyRes = await geminiCookiesNovelService.inspectStudioSceneWithGeminiVision({
          cookies: params.geminiCookies || "",
          scene: dummyScene,
          localImagePath: cand.local_file_path,
          promptUsed: task.prompt,
          stylePreset: task.stylePreset,
          location: params.locationOverride,
          characterReferenceFilePaths: task.referenceFilePaths || [],
        });

        const isApproved = Boolean(verifyRes.approved && verifyRes.all_required_checks_passed);

        cand.audit_result = {
          approved: isApproved,
          score: verifyRes.score || (isApproved ? 100 : 65),
          issues: verifyRes.detected_issues || verifyRes.issues || [],
          feedback: isApproved
            ? "✓ مطابقة تامة للمشهد والمراجع البصرية"
            : (verifyRes.detected_issues || verifyRes.failed_checks || []).join(" ; ") || "بحاجة لتعديل الملامح أو العناصر",
          character_match: verifyRes.checks?.character_consistency,
          costume_match: verifyRes.checks?.costume_and_weapon_accuracy,
          location_match: verifyRes.checks?.location_reference_match,
          scene_accuracy: verifyRes.checks?.action_and_composition,
          failed_checks: verifyRes.failed_checks || [],
          what_is_correct: verifyRes.what_is_correct || [],
          what_is_missing: verifyRes.what_is_missing || [],
          what_is_different: verifyRes.what_is_different || [],
          additive_correction: verifyRes.additive_correction || "",
          audited_at: new Date().toISOString(),
        };

        if (isApproved) {
          cand.status = "APPROVED";
          cand.rejection_reason = null;
          cand.correction_instruction = null;
        } else {
          cand.status = "REJECTED";
          cand.rejection_reason = (verifyRes.failed_checks || []).join(", ") || "عدم تطابق بعض المراجع";
          cand.correction_instruction =
            verifyRes.additive_correction ||
            (verifyRes.what_is_missing || []).join(" ; ") ||
            "Fix character anatomy, facial details and match visual bible reference.";
        }
      } catch (err: any) {
        console.warn(`[FlowTaskEngine] Inspection error on candidate ${cand.id}:`, err?.message);
        cand.status = "REJECTED";
        cand.rejection_reason = `خطأ أثناء الفحص: ${err?.message || "انقطاع الاتصال"}`;
      }
    }

    // 2. Second Pass: Selective Self-Healing (Regenerate ONLY the rejected candidates!)
    const rejectedIndices: number[] = [];
    task.candidateImages.forEach((c, idx) => {
      if (c.status === "REJECTED") rejectedIndices.push(idx);
    });

    if (rejectedIndices.length > 0) {
      console.log(`[FlowTaskEngine] Selective self-healing for ${rejectedIndices.length} rejected candidate(s)...`);

      for (const idx of rejectedIndices) {
        const rejectedCand = task.candidateImages[idx];
        const retryCount = (rejectedCand.retry_count || 0) + 1;

        if (retryCount > maxHeal) {
          console.log(`[FlowTaskEngine] Candidate ${rejectedCand.id} reached maximum retry limit (${maxHeal}).`);
          continue;
        }

        task.progressMessage = `إعادة توليد الصورة ${idx + 1} مع تعليمات التصحيح (محاولة تصحيح ${retryCount}/${maxHeal})...`;
        this.saveTasksToDisk();

        try {
          const correctionNote = rejectedCand.correction_instruction || "Strictly match character facial traits and outfit.";
          const correctivePrompt = `MANDATORY VISUAL FIXES: ${correctionNote}\n\n${task.prompt}\n\nCRITICAL CORRECTIONS:\n- ${correctionNote}`;
          const regenRes = await duckAiProvider.generateImage({
            prompt: correctivePrompt,
            referenceImages: task.referenceFilePaths || [],
            timeoutMs: 50000,
            sceneId: task.sceneId,
          });

          if (regenRes.success && regenRes.localUrl) {
            const sourcePath = path.resolve(process.cwd(), `public${regenRes.localUrl}`);
            const targetPath = path.resolve(
              process.cwd(),
              `public/manga_storage/scenes/${task.sceneId}/candidates/${task.sceneId}_cand_${idx + 1}_v${retryCount + 1}.jpg`
            );
            fs.copyFileSync(sourcePath, targetPath);

            const newPublicUrl = `/manga_storage/scenes/${task.sceneId}/candidates/${path.basename(targetPath)}`;

            // Inspect the new replacement image
            const reVerifyRes = await geminiCookiesNovelService.inspectStudioSceneWithGeminiVision({
              cookies: params.geminiCookies || "",
              scene: dummyScene,
              localImagePath: targetPath,
              promptUsed: correctivePrompt,
              stylePreset: task.stylePreset,
              location: params.locationOverride,
              characterReferenceFilePaths: task.referenceFilePaths || [],
            });

            const replacementApproved = Boolean(reVerifyRes.approved && reVerifyRes.all_required_checks_passed);

            // Update candidate in-place (retaining the accepted ones untouched!)
            task.candidateImages[idx] = {
              id: `${task.sceneId}_cand_${idx + 1}`,
              image_url: newPublicUrl,
              local_file_path: targetPath,
              created_at: new Date().toISOString(),
              status: replacementApproved ? "APPROVED" : "REJECTED",
              retry_count: retryCount,
              rejection_reason: replacementApproved ? null : (reVerifyRes.failed_checks || []).join(", "),
              correction_instruction: replacementApproved ? null : reVerifyRes.additive_correction || null,
              audit_result: {
                approved: replacementApproved,
                score: reVerifyRes.score || (replacementApproved ? 100 : 70),
                issues: reVerifyRes.detected_issues || reVerifyRes.issues || [],
                feedback: replacementApproved
                  ? "✓ تم التصحيح بنجاح واجتياز الفحص البصري التام"
                  : (reVerifyRes.detected_issues || []).join(" ; ") || "ما زالت بحاجة لتدقيق",
                character_match: reVerifyRes.checks?.character_consistency,
                costume_match: reVerifyRes.checks?.costume_and_weapon_accuracy,
                location_match: reVerifyRes.checks?.location_reference_match,
                scene_accuracy: reVerifyRes.checks?.action_and_composition,
                failed_checks: reVerifyRes.failed_checks || [],
                what_is_correct: reVerifyRes.what_is_correct || [],
                what_is_missing: reVerifyRes.what_is_missing || [],
                what_is_different: reVerifyRes.what_is_different || [],
                additive_correction: reVerifyRes.additive_correction || "",
                audited_at: new Date().toISOString(),
              },
            };

            if (replacementApproved) {
              healedCount++;
            }
          }
        } catch (e: any) {
          console.warn(`[FlowTaskEngine] Self-healing regeneration error on candidate ${idx + 1}:`, e?.message);
        }
      }
    }

    const approvedTotal = task.candidateImages.filter((c) => c.status === "APPROVED").length;
    const rejectedTotal = task.candidateImages.filter((c) => c.status === "REJECTED").length;

    task.status = "COMPLETED";
    task.progressMessage =
      approvedTotal === task.candidateImages.length
        ? `✓ تم فحص واعتماد جميع الصور الأربع بنجاح (100% APPROVED)!`
        : `اكتمل الفحص: ${approvedTotal} صور مقبولة و ${rejectedTotal} صور بحاجة لمراجعة إضافية.`;
    task.updatedAt = new Date().toISOString();

    this.saveTasksToDisk();
    this.syncCandidateImagesToSceneCheckpoint(task);

    return {
      task,
      summary: {
        total: task.candidateImages.length,
        approvedCount: approvedTotal,
        rejectedCount: rejectedTotal,
        healedCount,
      },
    };
  }

  /**
   * Binds a chosen candidate image as the official illustration for the scene/page
   */
  public bindWinningCandidate(
    taskId: string,
    candidateId: string
  ): { success: boolean; task?: FlowBackgroundTask; selectedCandidate?: SceneCandidateImage } {
    const task = this.tasks.get(taskId);
    if (!task) return { success: false };

    const cand = task.candidateImages.find((c) => c.id === candidateId);
    if (!cand) return { success: false };

    // Update scene checkpoint across primary and secondary storage
    try {
      const primaryCheckpoint = path.resolve(process.cwd(), "public", "generated", "studio_checkpoint_state.json");
      this.updateSceneInCheckpointFile(primaryCheckpoint, task, cand);

      const generatedDir = path.resolve(process.cwd(), "public", "generated");
      if (fs.existsSync(generatedDir)) {
        const extraFiles = fs.readdirSync(generatedDir).filter((f) => f.startsWith("studio_checkpoint_") && f.endsWith(".json"));
        for (const ef of extraFiles) {
          this.updateSceneInCheckpointFile(path.join(generatedDir, ef), task, cand);
        }
      }

      const checkpointDir = path.resolve(process.cwd(), "data/novel_to_manga/checkpoints");
      if (fs.existsSync(checkpointDir)) {
        const files = fs.readdirSync(checkpointDir).filter((f) => f.endsWith(".json"));
        for (const f of files) {
          this.updateSceneInCheckpointFile(path.join(checkpointDir, f), task, cand);
        }
      }
    } catch (_) {}

    return { success: true, task, selectedCandidate: cand };
  }
}

export const flowBackgroundTaskEngine = FlowBackgroundTaskEngine.getInstance();
