import axios from "axios";
import fs from "fs";
import path from "path";
import sharp from "sharp";

interface CycleResult {
  cycle: number;
  sceneId: string;
  prompt: string;
  browserPid?: number | null;
  pageId: string;
  statusBefore: any;
  generationSuccess: boolean;
  durationMs: number;
  localUrl?: string;
  sceneCandidateUrl?: string;
  fileSizeBytes?: number;
  width?: number;
  height?: number;
  format?: string;
  sharpVerified: boolean;
  sceneLinkVerified: boolean;
  statusAfter: any;
  error?: string;
}

const SERVER_BASE = "http://127.0.0.1:3000/api/novel-to-manga";

const PROMPTS = [
  {
    sceneId: "scene_cycle_1",
    prompt: "A legendary swordsman with silver hair standing in a bamboo forest under moonlight, manhwa style",
  },
  {
    sceneId: "scene_cycle_2",
    prompt: "A glowing futuristic city with flying neon cars and towering cyber spires, manga illustration",
  },
  {
    sceneId: "scene_cycle_3",
    prompt: "A majestic golden dragon coiling around an ancient temple amidst swirling clouds, fantasy manhwa",
  },
  {
    sceneId: "scene_cycle_4",
    prompt: "A young sorceress casting a radiant emerald spell in an enchanted library, detailed anime style",
  },
  {
    sceneId: "scene_cycle_5",
    prompt: "A brave warrior defending a fortress gate against shadow beasts at twilight, epic manhwa art",
  },
];

async function run5Cycles() {
  console.log("=== STARTING 5 CONSECUTIVE INTEGRATION CYCLES ON DUCK.AI ===");
  console.log("Target server:", SERVER_BASE);

  const results: CycleResult[] = [];

  for (let i = 0; i < PROMPTS.length; i++) {
    const cycleNum = i + 1;
    const item = PROMPTS[i];
    console.log(`\n------------------------------------------------------------`);
    console.log(`[Cycle ${cycleNum}/5] Scene: ${item.sceneId}`);
    console.log(`[Cycle ${cycleNum}/5] Prompt: "${item.prompt}"`);

    // 1. Probe status before generation
    const preRes = await axios.get(`${SERVER_BASE}/duck-ai/status`);
    const statusBefore = preRes.data?.status || {};
    console.log(`[Cycle ${cycleNum}/5] Pre-status: isReady=${statusBefore.isReady}, slot=${statusBefore.activePageId}, url=${statusBefore.currentUrl}`);

    const cycleStart = Date.now();
    let genData: any = null;
    let genError: string | null = null;

    try {
      // 2. Submit generation request
      console.log(`[Cycle ${cycleNum}/5] Submitting generation request to live server...`);
      const genRes = await axios.post(
        `${SERVER_BASE}/duck-ai/generate-image`,
        {
          prompt: item.prompt,
          sceneId: item.sceneId,
          preferredPageId: "duck_page_1",
          timeoutMs: 65000,
        },
        { timeout: 75000 }
      );
      genData = genRes.data;
    } catch (err: any) {
      genError = err?.response?.data?.error || err?.message || String(err);
      console.error(`[Cycle ${cycleNum}/5] Generation request error:`, genError);
    }

    const durationMs = Date.now() - cycleStart;
    const isSuccess = Boolean(genData && genData.success && genData.localUrl);

    // 3. Inspect generated image via Sharp
    let sharpVerified = false;
    let fileSizeBytes = 0;
    let imgWidth = 0;
    let imgHeight = 0;
    let imgFormat = "";

    if (isSuccess && genData.localUrl) {
      const diskPath = path.resolve(process.cwd(), `public${genData.localUrl}`);
      if (fs.existsSync(diskPath)) {
        fileSizeBytes = fs.statSync(diskPath).size;
        try {
          const meta = await sharp(diskPath).metadata();
          const stats = await sharp(diskPath).stats();
          imgWidth = meta.width || 0;
          imgHeight = meta.height || 0;
          imgFormat = meta.format || "";
          const isSolid = stats.channels.every((c) => c.stdev === 0);
          sharpVerified = !isSolid && imgWidth > 200 && imgHeight > 200 && fileSizeBytes > 5000;
          console.log(
            `[Cycle ${cycleNum}/5] Image Verified via Sharp: ${imgFormat} ${imgWidth}x${imgHeight}, size: ${fileSizeBytes} bytes, solidColor: ${isSolid}`
          );
        } catch (e: any) {
          console.warn(`[Cycle ${cycleNum}/5] Sharp error on ${diskPath}:`, e.message);
        }
      }
    }

    // 4. Inspect scene candidate link
    let sceneLinkVerified = false;
    if (isSuccess && item.sceneId) {
      const sceneDir = path.resolve(process.cwd(), `public/manga_storage/scenes/${item.sceneId}/candidates`);
      if (fs.existsSync(sceneDir)) {
        const cands = fs.readdirSync(sceneDir);
        sceneLinkVerified = cands.length > 0;
        console.log(`[Cycle ${cycleNum}/5] Scene ${item.sceneId} candidates verified: ${cands.join(", ")}`);
      }
    }

    // 5. Probe status after generation
    const postRes = await axios.get(`${SERVER_BASE}/duck-ai/status`);
    const statusAfter = postRes.data?.status || {};
    console.log(`[Cycle ${cycleNum}/5] Post-status: isReady=${statusAfter.isReady}, isGenerating=${statusAfter.isGenerating}, error=${statusAfter.lastError}`);

    results.push({
      cycle: cycleNum,
      sceneId: item.sceneId,
      prompt: item.prompt,
      pageId: genData?.pageId || "duck_page_1",
      statusBefore: {
        isReady: statusBefore.isReady,
        status: statusBefore.pages?.[0]?.status,
      },
      generationSuccess: isSuccess,
      durationMs,
      localUrl: genData?.localUrl,
      sceneCandidateUrl: genData?.sceneCandidateUrl,
      fileSizeBytes,
      width: imgWidth,
      height: imgHeight,
      format: imgFormat,
      sharpVerified,
      sceneLinkVerified,
      statusAfter: {
        isReady: statusAfter.isReady,
        status: statusAfter.pages?.[0]?.status,
      },
      error: genError || genData?.error,
    });

    console.log(
      `[Cycle ${cycleNum}/5] COMPLETED in ${durationMs}ms - Result: ${isSuccess && sharpVerified ? "SUCCESS" : "FAILED"}`
    );

    // Short pause between cycles to mimic natural user pace
    await new Promise((r) => setTimeout(r, 2000));
  }

  console.log("\n============================================================");
  console.log("=== 5-CYCLE INTEGRATION TEST SUMMARY ===");
  console.log("============================================================");
  console.log(JSON.stringify(results, null, 2));

  const allPassed = results.every((r) => r.generationSuccess && r.sharpVerified && r.sceneLinkVerified);
  console.log(`\nFINAL OUTCOME: ${allPassed ? "ALL 5 CYCLES PASSED PERFECTLY" : "SOME CYCLES FAILED"}`);
}

run5Cycles();
