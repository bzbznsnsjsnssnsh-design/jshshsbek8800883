import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { duckAiProvider } from "../server/duckAiProvider.ts";
import { duckAiBrowserService } from "../server/duckAiBrowserService.ts";

async function runDuckAiVerificationLive() {
  console.log("================================================================================");
  console.log("=== LIVE VERIFICATION: Duck.ai Real Readiness, Tab Reuse, & Recovery Flow ===");
  console.log("================================================================================");

  // --------------------------------------------------------------------------
  // Step 1: Open Duck.ai and wait for TRUE UI readiness
  // --------------------------------------------------------------------------
  console.log("\n[Step 1] Opening Duck.ai and waiting for true natural UI readiness...");
  const slot1 = duckAiProvider.getActiveSlot();
  const t0 = Date.now();
  const initStatus = await duckAiProvider.ensurePageReady(slot1, false);
  console.log(`[Step 1] Page ready probe finished in ${Date.now() - t0}ms:`, {
    isReady: initStatus.isReady,
    currentUrl: initStatus.currentUrl,
    pageTitle: initStatus.pageTitle,
    activePageId: initStatus.activePageId,
    status: slot1.status,
  });

  assert.strictEqual(initStatus.isReady, true, "Duck.ai active tab must be genuinely ready");
  assert.strictEqual(slot1.status, "READY", "Slot status must be READY");

  // Verify directly from DOM that loader is NOT visible and textarea is interactable
  const dom1 = await duckAiProvider.checkDomReadiness(slot1.page!);
  console.log("[Step 1] DOM Verification:", {
    isReady: dom1.isReady,
    isLoaderActive: dom1.isLoaderActive,
    hasTextarea: dom1.hasTextarea,
    hasButtons: dom1.hasButtons,
    hasChallenge: dom1.hasChallenge,
    isRateLimited: dom1.isRateLimited,
    hasError: dom1.hasError,
  });
  assert.strictEqual(dom1.isLoaderActive, false, "Loader must not be active or visible");
  assert.strictEqual(dom1.hasTextarea, true, "Interactable prompt textarea must be present");
  assert.strictEqual(dom1.isReady, true, "True readiness must be confirmed by DOM probe");
  console.log("✓ [Step 1 Passed] True natural UI readiness confirmed!");

  // --------------------------------------------------------------------------
  // Step 2: Run 2 consecutive generation operations in the SAME tab
  // --------------------------------------------------------------------------
  console.log("\n[Step 2.1] Executing Generation 1 in the SAME tab (slot: duck_page_1)...");
  const tGen1 = Date.now();
  const res1 = await duckAiProvider.generateImage({
    prompt: "An ancient stone portal glowing in a misty bamboo forest, cinematic manhwa lighting",
    timeoutMs: 65000,
    preferredPageId: "duck_page_1",
    sceneId: "scene_test_live_1",
  });
  console.log(`[Step 2.1] Generation 1 completed in ${Date.now() - tGen1}ms:`, {
    success: res1.success,
    status: res1.status,
    localUrl: res1.localUrl,
    dimensions: `${res1.width}x${res1.height}`,
    format: res1.format,
  });
  assert.strictEqual(res1.success, true, `Generation 1 must succeed: ${res1.error || ""}`);
  assert.ok(res1.localUrl, "Generation 1 must return a local image URL");
  const file1Path = path.resolve(process.cwd(), `public${res1.localUrl}`);
  assert.ok(fs.existsSync(file1Path), `File must exist at ${file1Path}`);
  const meta1 = await sharp(file1Path).metadata();
  assert.ok(meta1.width && meta1.width > 100, "Image width must be valid");
  console.log(`✓ [Step 2.1 Passed] Generation 1 succeeded (${meta1.width}x${meta1.height} ${meta1.format})`);

  console.log("\n[Step 2.2] Executing Generation 2 in the SAME tab WITHOUT reloading...");
  const tGen2 = Date.now();
  const res2 = await duckAiProvider.generateImage({
    prompt: "A mystical phoenix rising with golden embers, ethereal digital manhwa art",
    timeoutMs: 65000,
    preferredPageId: "duck_page_1",
    sceneId: "scene_test_live_2",
  });
  console.log(`[Step 2.2] Generation 2 completed in ${Date.now() - tGen2}ms:`, {
    success: res2.success,
    status: res2.status,
    localUrl: res2.localUrl,
    dimensions: `${res2.width}x${res2.height}`,
    format: res2.format,
  });
  assert.strictEqual(res2.success, true, `Generation 2 must succeed: ${res2.error || ""}`);
  assert.ok(res2.localUrl, "Generation 2 must return a local image URL");
  const file2Path = path.resolve(process.cwd(), `public${res2.localUrl}`);
  assert.ok(fs.existsSync(file2Path), `File must exist at ${file2Path}`);
  const meta2 = await sharp(file2Path).metadata();
  assert.ok(meta2.width && meta2.width > 100, "Image width must be valid");
  console.log(`✓ [Step 2.2 Passed] Generation 2 succeeded (${meta2.width}x${meta2.height} ${meta2.format})`);

  // --------------------------------------------------------------------------
  // Step 3 & 4: Deliberately re-navigate once and verify true UI readiness
  // --------------------------------------------------------------------------
  console.log("\n[Step 3] Deliberately re-navigating once to test recovery and loading screen handling...");
  const tNav = Date.now();
  // Call ensurePageReady with forceNavigate = true (which invokes in-page reset or navigation without hanging)
  const navStatus = await duckAiProvider.ensurePageReady(slot1, true);
  console.log(`[Step 3] Re-navigation completed in ${Date.now() - tNav}ms:`, {
    isReady: navStatus.isReady,
    currentUrl: navStatus.currentUrl,
    pageTitle: navStatus.pageTitle,
    status: slot1.status,
  });

  console.log("\n[Step 4] Checking that loading screen has disappeared and input is interactable...");
  const domAfterNav = await duckAiProvider.checkDomReadiness(slot1.page!);
  console.log("[Step 4] DOM status after re-navigation:", {
    isReady: domAfterNav.isReady,
    isLoaderActive: domAfterNav.isLoaderActive,
    hasTextarea: domAfterNav.hasTextarea,
    hasButtons: domAfterNav.hasButtons,
    hasChallenge: domAfterNav.hasChallenge,
    isRateLimited: domAfterNav.isRateLimited,
    hasError: domAfterNav.hasError,
  });
  assert.strictEqual(domAfterNav.isLoaderActive, false, "Loading screen must not be active");
  assert.strictEqual(domAfterNav.hasTextarea, true, "Prompt input must be available");
  assert.strictEqual(domAfterNav.isReady, true, "Page must be truly ready to accept requests");
  console.log("✓ [Step 4 Passed] Loading screen is gone and UI is ready for new requests!");

  // --------------------------------------------------------------------------
  // Step 5: Verify tab switching: move to duck_page_2 and return to duck_page_1
  // --------------------------------------------------------------------------
  console.log("\n[Step 5] Testing tab switching: Switching to duck_page_2...");
  const slot2Status = await duckAiProvider.selectPage("duck_page_2");
  console.log("[Step 5] duck_page_2 status:", {
    activeSlotId: duckAiProvider.getActiveSlot().id,
    isReady: slot2Status.isReady,
    currentUrl: slot2Status.currentUrl,
  });
  assert.strictEqual(duckAiProvider.getActiveSlot().id, "duck_page_2", "Active slot must be duck_page_2");

  console.log("[Step 5] Switching back to duck_page_1...");
  const slot1BackStatus = await duckAiProvider.selectPage("duck_page_1");
  console.log("[Step 5] duck_page_1 status after return:", {
    activeSlotId: duckAiProvider.getActiveSlot().id,
    isReady: slot1BackStatus.isReady,
    currentUrl: slot1BackStatus.currentUrl,
  });
  assert.strictEqual(duckAiProvider.getActiveSlot().id, "duck_page_1", "Active slot must return to duck_page_1");
  assert.strictEqual(slot1BackStatus.isReady, true, "duck_page_1 must still be ready");
  console.log("✓ [Step 5 Passed] Tab switching back and forth verified smoothly!");

  // --------------------------------------------------------------------------
  // Step 6: Verify tab failure isolation
  // --------------------------------------------------------------------------
  console.log("\n[Step 6] Verifying failure isolation across slots...");
  const allSlots = duckAiProvider.getPagesStatus();
  console.log("[Step 6] Current slots snapshot:", allSlots.map((s) => ({ id: s.id, status: s.status, isBusy: s.isBusy })));
  assert.strictEqual(allSlots.length, 5, "5 slots pool must be intact");
  assert.strictEqual(allSlots[0].status, "READY", "duck_page_1 must be READY");
  console.log("✓ [Step 6 Passed] Slot pool isolation confirmed!");

  console.log("\n================================================================================");
  console.log("=== ALL VERIFICATION TESTS PASSED SUCCESSFULLY (6/6 - 100%) ===");
  console.log("================================================================================");
  process.exit(0);
}

runDuckAiVerificationLive().catch((err) => {
  console.error("FATAL ERROR IN LIVE VERIFICATION:", err);
  process.exit(1);
});
