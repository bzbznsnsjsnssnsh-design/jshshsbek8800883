import fs from "fs";
import path from "path";
import sharp from "sharp";
import { duckAiProvider } from "../server/duckAiProvider.ts";

async function run5SequentialTasksTest() {
  console.log("================================================================================");
  console.log("=== [PHASE 4] 5 Sequential Tasks Verification via DuckAI2API Queue Pipeline ===");
  console.log("================================================================================");

  const testScenes = [
    {
      sceneId: "test_seq_scene_1",
      title: "المشهد الأول: فارس الرياح",
      prompt: "A heroic wind warrior standing on a floating cliff at sunset, cinematic manhwa artwork",
    },
    {
      sceneId: "test_seq_scene_2",
      title: "المشهد الثاني: معبد القمر",
      prompt: "An ancient celestial pagoda illuminated by gentle blue moonlight, detailed webtoon scenery",
    },
    {
      sceneId: "test_seq_scene_3",
      title: "المشهد الثالث: تنين الرعد",
      prompt: "A majestic thunder dragon coiling around towering storm clouds, crackling azure lightning, korean manhwa style",
    },
    {
      sceneId: "test_seq_scene_4",
      title: "المشهد الرابع: بوابة البعد",
      prompt: "A mysterious glowing dimensional rift inside a cavern filled with luminous crystals, high fantasy webtoon",
    },
    {
      sceneId: "test_seq_scene_5",
      title: "المشهد الخامس: قلعة السحر",
      prompt: "A floating grand citadel above an endless ocean of golden clouds at high noon, epic manhwa illustration",
    },
  ];

  console.log(`Queueing ${testScenes.length} test scenes into duckAiProvider queue...`);
  const queuedTasks = duckAiProvider.batchQueueSceneTasks(testScenes);
  console.log(`Successfully queued ${queuedTasks.length} tasks:`);
  for (const t of queuedTasks) {
    console.log(`  - Task ${t.taskId} -> Scene ${t.sceneId} ("${t.sceneTitle}")`);
  }

  // Poll until all 5 tasks are processed
  const startTime = Date.now();
  const maxTimeoutMs = 360000; // 6 minutes max budget for 5 sequential image generations
  let pollCount = 0;

  while (Date.now() - startTime < maxTimeoutMs) {
    await new Promise((r) => setTimeout(r, 4000));
    pollCount++;

    const dashboard = duckAiProvider.getDashboardStatus();
    const completedCount = dashboard.stats.completedCount;
    const failedCount = dashboard.stats.failedCount;
    const activeCount = dashboard.stats.generatingCount;
    const waitingCount = dashboard.stats.waitingCount;

    console.log(
      `[Poll #${pollCount} +${Math.round((Date.now() - startTime) / 1000)}s] Waiting: ${waitingCount}, Active: ${activeCount}, Completed: ${completedCount}, Failed: ${failedCount}`
    );

    // Check if all 5 scenes have finished
    const finishedScenes = dashboard.recentCompleted.filter((t) =>
      testScenes.some((s) => s.sceneId === t.sceneId)
    );
    const failedScenes = dashboard.recentFailed.filter((t) =>
      testScenes.some((s) => s.sceneId === t.sceneId)
    );

    if (finishedScenes.length + failedScenes.length >= testScenes.length) {
      console.log("\nAll 5 sequential test scenes have finished processing!");
      break;
    }
  }

  const finalDashboard = duckAiProvider.getDashboardStatus();
  console.log("\n=== Final Queue & Session Diagnostics ===");
  console.log(`Ready Sessions: ${finalDashboard.stats.readyCount} / ${finalDashboard.stats.totalSessions}`);
  console.log(`Active Tasks in Flight: ${finalDashboard.activeTasks.length}`);
  console.log(`Pending Tasks in Queue: ${finalDashboard.pendingQueue.length}`);

  // Verify all 5 slots are unlocked
  for (const slot of finalDashboard.sessions) {
    console.log(
      `Slot ${slot.name} (${slot.id}): status=${slot.status}, isBusy=${slot.isBusy}, completed=${slot.completedTasksCount}, failed=${slot.failedTasksCount}, lastUsed=${slot.lastUsedAt}`
    );
    if (slot.isBusy) {
      throw new Error(`Slot ${slot.id} remains locked with isBusy=true after queue completion!`);
    }
  }

  // Verify image results for each of the 5 scenes
  console.log("\n=== Verifying Image Results & Scene Binding for 5 Scenes ===");
  const resultsSummary: Array<{
    sceneId: string;
    status: string;
    localUrl?: string;
    candidateUrl?: string;
    width?: number;
    height?: number;
    sizeBytes?: number;
    channelStdevs?: number[];
  }> = [];

  for (const scene of testScenes) {
    const completedTask = finalDashboard.recentCompleted.find((t) => t.sceneId === scene.sceneId);
    if (!completedTask) {
      const failedTask = finalDashboard.recentFailed.find((t) => t.sceneId === scene.sceneId);
      console.error(`✗ Scene ${scene.sceneId} failed or missing! Error: ${failedTask?.error}`);
      resultsSummary.push({
        sceneId: scene.sceneId,
        status: "FAILED",
      });
      continue;
    }

    if (!completedTask.imageUrl) {
      throw new Error(`Scene ${scene.sceneId} completed without imageUrl!`);
    }

    const fullLocalPath = path.resolve(process.cwd(), "public", completedTask.imageUrl.replace(/^\//, ""));
    if (!fs.existsSync(fullLocalPath)) {
      throw new Error(`Image file not found on disk at ${fullLocalPath}`);
    }

    const stat = fs.statSync(fullLocalPath);
    const buffer = fs.readFileSync(fullLocalPath);
    const meta = await sharp(buffer).metadata();
    const stats = await sharp(buffer).stats();
    const stdevs = stats.channels.map((c) => c.stdev);

    console.log(`✓ Scene ${scene.sceneId}:`);
    console.log(`    File: ${completedTask.imageUrl} (${stat.size} bytes)`);
    console.log(`    Dimensions: ${meta.width}x${meta.height} (${meta.format})`);
    console.log(`    Sharp Channel Stdevs: [${stdevs.map((s) => s.toFixed(2)).join(", ")}]`);

    // Check candidate directory linkage
    const candidateDir = path.resolve(process.cwd(), "public/manga_storage/scenes", scene.sceneId, "candidates");
    const candidateFiles = fs.existsSync(candidateDir) ? fs.readdirSync(candidateDir) : [];
    console.log(`    Linked Candidates in scene folder: ${candidateFiles.length} files (${candidateFiles.join(", ")})`);

    if (candidateFiles.length === 0) {
      throw new Error(`Candidate image was not linked into scene storage directory for ${scene.sceneId}!`);
    }

    resultsSummary.push({
      sceneId: scene.sceneId,
      status: "SUCCESS",
      localUrl: completedTask.imageUrl,
      candidateUrl: completedTask.candidateUrl,
      width: meta.width,
      height: meta.height,
      sizeBytes: stat.size,
      channelStdevs: stdevs,
    });
  }

  const successCount = resultsSummary.filter((r) => r.status === "SUCCESS").length;
  console.log(`\n================================================================================`);
  console.log(`=== 5 SEQUENTIAL TASKS TEST COMPLETED: ${successCount} / ${testScenes.length} SUCCEEDED ===`);
  console.log(`================================================================================`);

  if (successCount < testScenes.length) {
    process.exit(1);
  }
}

run5SequentialTasksTest().catch((err) => {
  console.error("5 Sequential Tasks Test Failed:", err);
  process.exit(1);
});
