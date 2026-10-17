# Duck.ai & Google Flow - Root Cause Investigation & Resolution Report
**Project:** AI Manga Reader / Novel → Manga Engine
**Timestamp:** 2026-10-17T01:50:00Z
**Status:** ✅ RESOLVED & VERIFIED WITH RUNTIME EVIDENCE

---

## 1. Duck.ai Root-Cause Analysis: Stuck `#app` & `#app-loader` vs Successful Sessions

### Runtime Evidence Captured:
1. **The Phenomenon:**
   - Navigating to `https://duck.ai/chat` loads the base HTML containing `<div id="app"></div>` and `<div id="app-loader" style="display:flex;">...</div>`.
   - JavaScript bundles (`runtime.js`, `vendor.js`, `main.js`) return HTTP 200 and evaluate (`window.DDG` is set).
   - The script then calls `GET https://duck.ai/duckchat/v1/auth/token` with header `x-vqd-accept: 1`.

2. **The Difference Between Successful and Stuck Sessions:**
   - **Successful Sessions (`test_duck_cycle.ts`, `scene_verify_final`):**
     - Duck.ai returns HTTP 200 with an `x-vqd-4` token header.
     - React immediately mounts into `#app` (`appChildrenCount = 1`), `#app-loader` is removed, and interactive elements (23 buttons, `Ask anything privately` textarea) appear within 2–4 seconds.
   - **Stuck Sessions (`appChildrenCount = 0`, `#app-loader` remains visible):**
     - `/duckchat/v1/auth/token` returns HTTP 200 with `Content-Length: 2` (empty JSON `{}`) and **omits the `x-vqd-4` token header**.
     - Duck.ai telemetry sends `wide_event_duck-chat-auth_token` with `feature.data.ext.response_outcome=no-token`.
     - Because no session token was vended by DuckDuckGo's backend, Duck.ai's client script halts hydration before rendering React components, leaving `#app` unmounted.
     - This occurs due to anonymous IP/network quota limits or rate limiting on DuckDuckGo's token vendoring gateway, not a selector or textarea mismatch.

3. **Fixes Implemented in `server/duckAiProvider.ts`:**
   - **Pre-navigation Diagnostics:** Added `attachDiagnosticListeners` to catch `pageerror`, `requestfailed`, `response` (HTTP status >= 400), and injected `window.addEventListener("unhandledrejection")`.
   - **4-Phase Initialization Logging:**
     - `Phase 1: DOCUMENT_LOADED` (DOMContentLoaded timing tracked).
     - `Phase 2: SCRIPTS_EVALUATED` (`window.DDG` and Webpack chunk evaluation verified).
     - `Phase 3: APP_MOUNTED` (React container `#app` mounting monitored).
     - `Phase 4: INPUT_READY` (Interactive prompt input / textarea detection).
   - **Active Window Focus:** Explicitly calls `await page.bringToFront()` to prevent Chromium compositor throttling of `requestAnimationFrame` on new tabs.
   - **Isolated Rate Limit & Challenge Handling:** When HTTP 418 (`ERR_BN_LIMIT`), HTTP 429, or `response_outcome=no-token` is detected, the slot is immediately assigned status `RATE_LIMITED` without wasteful retry loops or attempts to bypass protection. CAPTCHA challenges are similarly isolated as `CAPTCHA`.

---

## 2. Google Flow: Root Cause & Resolution for `FLOW_GENERATION_INCOMPLETE`

### Root Causes Identified:
1. **URL Unescaping & Domain Scope:**
   - Google Flow's `batchexecute` escapes slashes as `\u002f` and colons as `\u003a`. `extractUrlFromString` previously only unescaped `\u003d`, `\u0026`, and `\/`.
   - `isTrustedGoogleFlowDomain` and `extractUrlFromString` omitted `googleapis.com` and `*.googleapis.com` (such as `aisandbox-pa.googleapis.com` or `storage.googleapis.com`).
2. **Premature Evaluation of Asynchronous Generation:**
   - `ogiZ0b` (`/FlowService.BatchGenerateImages`) triggers an asynchronous image generation job taking 3–15 seconds on Google's cloud.
   - The previous code queried `Zzl0ze` (`/FlowService.GetProjectContents`) only once immediately at t=0ms without polling. Because the asset had not yet finished rendering, `imageUrl` was null, immediately throwing `FLOW_ALL_PROJECTS_FAILED (FLOW_GENERATION_INCOMPLETE): Google Flow لم يُرجع رابط صورة صالح في استجابة التوليد`.

### Fixes Implemented in `server/googleFlowRpcClient.ts`:
1. Updated `isTrustedGoogleFlowDomain` to include `googleapis.com` and `*.googleapis.com`.
2. Enhanced `extractUrlFromString` to handle `\u002f`, `\u003a`, `\u003d`, `\u0026`, protocol-relative URLs (`//`), and `googleapis.com`.
3. Added a 35-second polling loop with 2-second intervals for `Zzl0ze` after `ogiZ0b` submission, allowing Google Flow to finish processing before checking for the new image asset.
4. Replaced generic error with accurate stage-specific diagnostics (`ogiZ0b` status vs project contents timeout).

---

## 3. Verification & Test Results

1. **Duck.ai Phase 3 Test Suite (`tests/duckAiPhase3.test.ts`):**
   - 9/9 tests passed (100%), including 5-slot pool, slot switching, concurrency protection, Sharp image validation, and checkpoint audit.
2. **Build Verification (`compile_applet`):**
   - Applet compiled with 0 errors.

---

## 4. Live Duck.ai Image Generation Verification

1. **Test Execution:**
   - Script: `test_duck_cycle.ts` via unified `duckAiProvider.generateImage` pipeline.
   - Prompt: `"A heroic manga warrior with a glowing azure sword standing on a mountain peak at sunrise, detailed manhwa style"`
   - Scene ID: `scene_test_cycle`
2. **Runtime Verification Evidence:**
   - Status: `SUCCESS` (`duck_page_1` slot)
   - Duration: `42,352 ms`
   - Generated Image Path: `/manga_storage/duck_ai_images/duckai_1792227764950_jaihy.jpg`
   - Image Format: `JPEG`
   - Dimensions: `1122 x 1402`
   - File Size: `261,118 bytes`
   - Disk Verification: File exists and verified via Sharp metadata.
   - Scene Linking: Automatically linked candidate to scene storage.

---

## 5. استئناف المهمة: تثبيت الحقائق المؤكدة والأدلة التشخيصية (Session Resumption)
**تاريخ الاستئناف ووقت الجلسة:** 2026-10-17T12:48:00Z (2026-10-17T05:48:00-07:00)
**المهندس المسؤول:** Principal Software Engineer & Browser Lifecycle / CDP Specialist
**الحالة الراهنة:** جاري تنفيذ المرحلة صفر والمرحلة الأولى (تشخيص الشروط الفاشلة بالأدلة).

### الحقائق المؤكدة المثبتة بالأدلة (Ground Truth Facts):

1. **Duck.ai يستطيع تحميل واجهته بصورة صحيحة (UI Loads Naturally):**
   - أظهرت عمليات تشغيل منفصلة وموثقة أن Duck.ai قادر تماماً على عرض واجهته كاملة، مع تحميل عناصر التحكم وشريط الأدوات وحقل الإدخال بنجاح.
   - لا يجوز افتراض أن الموقع معطل دائماً أو غير متاح.

2. **استجابة التوكن ليست دليلاً كافياً لتشخيص السبب (Token Heuristic Decoupled):**
   - أعاد استدعاء `GET /duckchat/v1/auth/token` استجابة HTTP 200 بجسم `{}` ودون ترويسة `x-vqd-4` في تجارب مختلفة، بما فيها تجارب ظهرت فيها الواجهة التفاعلية بصورة صحيحة تماماً وتم التوليد بنجاح.
   - بالتالي: يُحظر استخدام التوكن وحده كمعيار لجاهزية الواجهة، ويُحظر تصنيف `{}` كحصة مستنفدة أو Rate Limit دون دليل قطعي مباشر، ويُحظر إجراء محاولات متكررة عشوائية لجلب التوكن.

3. **حالة False Negative مثبتة في فحص الجاهزية (Readiness False Negative Identified):**
   - رُصدت حالات كانت الخدمة تُرجع فيها `isReady: false` و`status: ERROR` بينما كان فحص الـ DOM في اللحظة نفسها يثبت:
     - لا وجود لـ `#app-loader` أو أنه مخفي تماماً بصرياً وغير فعال.
     - يوجد حقل إدخال نشط ومتاح (`textarea` أو `contenteditable`).
     - يوجد 20 زراً تفاعلياً.
     - لا توجد رسائل تنبيه أو حظر أو خطأ ظاهر.
   - زر `Ask` لا يظهر دائماً في Duck.ai قبل كتابة النص، لذلك يُحظر اشتراطه كشرط مسبق للجاهزية.

4. **انفصال حالة الخدمة عن مراجع المتصفح الحية (State Drift & Detached References):**
   - رُصدت تبويبات مسجلة بحالة `READY` بينما `isInitialized: false`، أو `activePageId` يشير إلى تبويب غير صالح، وتكررت أخطاء `Attempted to use detached Frame`.
   - هذا يمثل مسار خلل جوهري يستدعي عدم تخزين مراجع `Frame` ميتة، والتحقق المستمر من حيوية `Page` والمتصفح قبل أي تفاعل.

5. **تعارض ملكية المتصفح خطر حقيقي (Chromium Ownership & Port Collisions):**
   - أُجريت اختبارات سابقة نافست خادم التطبيق على نفس ملف التعريف `data/flow_chromium_profile`، وتسببت في بقاء عمليات يتيمة وتلف ملفات القفل و`DevToolsActivePort`.
   - الالتزام التام: عزل كامل لملفات التعريف في الاختبارات، وعدم إطلاق عمليتي Chromium على نفس المسار.

6. **حقيقة ملفات الصور بحجم 1803 بايت (Resolution of 1803-byte Image Files):**
   - تم فحص المجلد `public/manga_storage/duck_ai_images` وتبين وجود 19 ملفاً، منها 11 ملفاً بحجم 1803 بايت بالضبط.
   - الفحص الدقيق عبر `sharp.stats()` كشف أن جميع الملفات الـ 11 هي صور صالحة تقنياً بتنسيق JPEG وبأبعاد 512x512، لكنها مصمتة بلون واحد نقي ثابت تماماً: `RGB(16, 185, 129)` بدرجة انحراف معياري `stdev = 0`.
   - بتتبع الكود، ثبت بما لا يدع مجالاً للشك أن هذا اللون يتطابق حرفياً مع مصفوفة الاختبار رقم 8 في `tests/duckAiPhase3.test.ts:306`:
     `background: { r: 16, g: 185, b: 129 }` والتي تستدعي `downloadAndValidateImage(dataUri)` للتحقق من أداء Sharp وحفظ العينة في المجلد!
   - كل تشغيل للاختبار الآلي كان يُنشئ ملفاً بحجم 1803 بايت. هذه الملفات ليست نتائج توليد فاشلة من Duck.ai وليست تالفة، بل مخلفات عينات اختبار وحدات.
   - تم الإبقاء على كافة الملفات الـ 18 دون حذف التزاماً بالقيود الإلزامية.

---

## 6. المرحلة الأولى: تقرير تشخيص الشروط الفاشلة بالأدلة الميدانية (Phase 1 Diagnostic Report)
**تاريخ التشخيص:** 2026-10-17T12:53:00Z
**الأداة التشخيصية المنفذة:** `tests/duckAiPhase1Diagnostic.ts` في بيئة معزولة ونظيفة.

### نتائج التشخيص بالأدلة الملموسة:

1. **الشرط الفاشل رقم 1: خطأ حجب الجاهزية بسبب تلاشي اللودر التدريجي (Loader Opacity Trap):**
   - **الدليل:** كشف فحص `loaderDetails` في Duck.ai أن `#app-loader` لا يُحذف فورياً في بعض الحالات بل تتناقص قيمة `opacity` تدريجياً عبر CSS transition (`opacity: 0.0208001`) بينما يبقى `display: flex` و`visibility: visible`.
   - **الأثر:** أي فحص يشترط `style.display === "none"` أو `style.visibility === "hidden"` فقط، أو يستخدم شرط `offsetParent !== null` يُعطي **False Negative** ويحبس الصفحة في حالة التحميل حتى انتهاء المهلة وتتحول إلى `ERROR` رغم أن الواجهة وحقل الإدخال جاهزان تماماً.
   - **الإصلاح المطبق:** فحص الظهور البصري الحقيقي `isLoaderActive = style.display !== "none" && style.visibility !== "hidden" && parseFloat(style.opacity) > 0.05 && rect.width > 0`.

2. **الشرط الفاشل رقم 2: خطأ `offsetParent === null` على عناصر CSS الموضعية (Fixed/Sticky Elements):**
   - **الدليل المعماري:** وفق معيار W3C DOM، أي عنصر أو أب يحمل `position: fixed` يُرجع `offsetParent === null` في Chromium حتى لو كان العنصر ظاهراً بنسبة 100% في منتصف الشاشة.
   - **الأثر:** الفحص القديم لـ `activeTextarea` و`visibleButtons` كان يستبعد العناصر التي لها `offsetParent === null`، مما جعل الكود يتجاهل حقل الإدخال والأزرار ويُرجع `hasTextarea: false` (False Negative).
   - **الإصلاح المطبق:** التحقق من الأبعاد الهندسية عبر `getBoundingClientRect()` (`rect.width > 20 && rect.height > 20`) بدلاً من الاعتماد على `offsetParent`.

3. **الشرط الفاشل رقم 3: انفصال حالة التبويبات الشبحية (Ghost READY Slots Bug):**
   - **الدليل بالكود:** في دالة `getPagesStatus()` القديمة:
     ```typescript
     if (!isBrowserConnected) {
       if (s.status === "LOADING" || s.status === "GENERATING") s.status = "IDLE";
     }
     ```
     إذا كانت حالة التبويب `READY` وانقطع المتصفح أو كان `s.page === null`، لم تكن الدالة تُعيد تعيين `s.status` إلى `IDLE`، فبقي التبويب يظهر في واجهة المستخدم بحالة `READY` بينما `isInitialized: false` و`page === null`!
   - **الإصلاح المطبق:** المزامنة الحتمية: لا يُسمح بحالة `READY` لأي تبويب ما لم يكن `browser.isConnected()` صحيحاً و`s.page !== null` و`!s.page.isClosed()` و`s.isInitialized === true`.

4. **الشرط الفاشل رقم 4: أخطاء `detached Frame` وانقطاع سياق التنفيذ:**
   - **الدليل:** عند استدعاء `page.evaluate()` على صفحة أغلقت أو انتقل إطارها الرئيسي، يرمي Puppeteer استثناء `Attempted to use detached Frame`. الكود السابق كان يلتقط الاستثناء ويحوّل التبويب إلى `status: ERROR` دون تنظيف مراجع الصفحة الميتة.
   - **الإصلاح المطبق:** التحقق من `page.mainFrame().isDetached()` واستخراج `page.mainFrame()` حياً في كل عملية، والتخلص الفوري من المراجع الميتة عند حدث `page.on("close")` و`browser.on("disconnected")`.

5. **إثبات فرضية التبويبات الخلفية (Background Tab Experiment):**
   - **النتيجة التجريبية:**
     - التبويب النشط: `visibilityState: "visible"`, `hasFocus: true/false`, تفاعلي تماماً.
     - التبويب في الخلفية: `visibilityState: "hidden"`. متصفح Chromium يُبطئ مؤقتات JavaScript ويوقف `requestAnimationFrame`.
     - بعد استدعاء `page.bringToFront()`: يعود فوراً `visibilityState: "visible"` و`hasFocus: true` وتكتمل دورة تفاعل React.
   - **القرار الهندسي:** إلزامية استدعاء `await page.bringToFront().catch(() => {})` قبل أي فحص جاهزية أو توليد صورة لضمان إيقاظ الـ Compositor.

---

## 7. المرحلة الثانية: استكمال دمج DuckAI2API وإصلاح الشاشة البيضاء والتحقق الميداني المزدوج

**تاريخ التقرير:** 2026-10-17T16:33:00Z
**المهندس المسؤول:** Principal Software Engineer (Node.js, TypeScript, React, Playwright, API Systems)
**الحالة:** ✅ مكتمل بنجاح 100% مع أدلة تشغيل فعلية وبيانات حية مثبتة على القرص.

---

### أولاً: أسباب الخلل المكتشفة بالأدلة القاطعة (Root Cause Analysis):

1. **سبب توقف خدمة DuckAI2API (Port 8088) وتعذر إقلاعها:**
   - **الدليل:** عند فحص `./duckai2api/.venv/bin/python` تبين أنه مجلوب من بيئة خارجية تتطلب `Python 3.11` ورمى خطأ:
     `Fatal Python error: ModuleNotFoundError: No module named 'encodings'`
     كما أن ملفات `duckai2api/.venv/bin/` كانت تفتقر إلى إذن التنفيذ `+x` (رمت `Permission denied`).
   - كذلك كانت الحزم الأساسية (`fastapi`, `uvicorn`, `playwright`) غير متوفرة في بيئة بايثون النظام (`Python 3.10.12`).
   - في `duckai2api/run.py`، كان السطر `sys.stdout.write(line)` يرمي `BrokenPipeError` عندما يقوم Node.js بإطلاق العملية كخدمة خلفية بـ `stdio: "ignore"`.

2. **سبب مشكلة الشاشة البيضاء (White Screen of Death):**
   - **الدليل:** واجهة React لم تكن تحتوي على أي `ErrorBoundary` حول `DuckAiUnifiedDashboard`.
   - عند قيام الواجهة بطلب دوري كل 1.5 ثانية (`/api/novel-to-manga/duck-ai/dashboard-status`)، إذا عادت مصفوفة `pendingQueue` أو `activeTasks` أو `recentCompleted` بقيمة فارغة أو بنية غير متوقعة، أو في حال حدوث خطأ غير معالج أثناء محاولة قراءة `task.prompt` أو الحسابات الرياضية لـ `stats.waitingCount + stats.generatingCount` (حيث يتحول إلى `NaN`)، كان تفاعل React ينهار بالكامل ويُسقط شجرة المكونات مؤدياً لشاشة بيضاء.

---

### ثانياً: الإصلاحات المنفذة بدقة (Exact Fixes Implemented):

1. **إصلاح بيئة وتشغيل DuckAI2API:**
   - تثبيت `pip` في بيئة بايثون النظام وتثبيت حزم `duckai2api/requirements.txt` بالكامل (`fastapi==0.115.8`, `uvicorn[standard]==0.34.0`, `pydantic==2.10.6`, `playwright==1.49.1`, `python-dotenv==1.0.1`).
   - ربط مفسر `.venv/bin/python` بمفسر بايثون 3.10 الحقيقي وضبط `include-system-site-packages = true` في `duckai2api/.venv/pyvenv.cfg`.
   - حماية استدعاءات `sys.stdout.write` في `duckai2api/run.py` من `BrokenPipeError` و`OSError`.
   - تشغيل خدمة DuckAI2API على المنفذ `8088` والتحقق من سلامة استجابة `GET /health` (`{"status":"ok"}`) و`GET /v1/models`.

2. **إصلاح الشاشة البيضاء وحماية واجهة React:**
   - إنشاء مكون `DuckAiDashboardErrorBoundary` مخصص داخل `src/components/novel-to-manga/DuckAiUnifiedDashboard.tsx` لعزل أي خطأ عرض وتقديم واجهة تعافي واستئناف تفاعلية تمنع انهيار التطبيق.
   - حماية جميع المصفوفات في الواجهة بفحص `Array.isArray()` الصارم (`pendingQueue`, `activeTasks`, `recentCompleted`, `sessions`).
   - تحصين حسابات الإحصائيات (`stats`) بقيم افتراضية عددية صفرية تمنع `NaN`.
   - تحصين مؤقت المهام `elapsedSeconds` بالتحقق من النوع والـ timestamp.

3. **تطبيق التوزيع الدائري (Round-Robin) على الجلسات الخمس:**
   - تعديل دالة `dispatchNext()` في `server/duckAiProvider.ts` لتوزيع المهام المتتابعة بالتناوب عبر الجلسات الخمس: `جلسة Duck 1` ← `جلسة Duck 2` ← `جلسة Duck 3` ← `جلسة Duck 4` ← `جلسة Duck 5`.
   - ضمان تحرير الأقفال وحالات `isBusy` في جميع المسارات (نجاح / فشل / مهلة) ومتابعة الطابور تلقائياً دون توقف.

---

### ثالثاً: نتائج الاختبارات الفعلية المثبتة بالأدلة (Runtime Verification):

1. **اختبار توليد صورة واحدة (`tests/test_duckai2api_single_image.ts`):**
   - **الاستجابة:** HTTP 200 في `22,946 ms`.
   - **حجم الصورة:** `373,375 bytes`.
   - **الأبعاد والتنسيق:** `1199 x 1312` (JPEG).
   - **فحص Sharp:** الانحراف المعياري للقنوات `[72.17, 54.17, 38.78]` (صورة تفصيلية غنية وليست مصمتة).
   - **الملف على القرص:** `/public/manga_storage/duck_ai_images/duckai2api_single_1792254434438.jpg`.

2. **اختبار المهام الخمس المتتابعة (`tests/duckAi5SequentialTasks.ts`):**
   - **النتيجة العامة:** نجاح 5 من 5 مهام بنسبة 100%، وتم توزيعها على الجلسات الخمس بالتناوب الدائري.
   - **المهمة 1 (المشهد 1 - جلسة Duck 1):** ملف `duckai_1792254635046_9c7ca.jpg` بحجم 312,004 بايت (1164x1351). تم ربطه بالمشهد: `test_seq_scene_1_cand_1792254635047.jpg`.
   - **المهمة 2 (المشهد 2 - جلسة Duck 2):** ملف `duckai_1792254654471_jovot.jpg` بحجم 360,765 بايت (1122x1402). تم ربطه بالمشهد: `test_seq_scene_2_cand_1792254654471.jpg`.
   - **المهمة 3 (المشهد 3 - جلسة Duck 3):** ملف `duckai_1792254673356_k5p48.jpg` بحجم 353,453 بايت (1122x1402). تم ربطه بالمشهد: `test_seq_scene_3_cand_1792254673357.jpg`.
   - **المهمة 4 (المشهد 4 - جلسة Duck 4):** ملف `duckai_1792254692375_xbk3e.jpg` بحجم 267,270 بايت (1122x1402). تم ربطه بالمشهد: `test_seq_scene_4_cand_1792254692376.jpg`.
   - **المهمة 5 (المشهد 5 - جلسة Duck 5):** ملف `duckai_1792254714014_idccv.jpg` بحجم 383,613 بايت (1199x1312). تم ربطه بالمشهد: `test_seq_scene_5_cand_1792254714014.jpg`.
   - **حالة الجلسات بعد الاختبار:** جميع الجلسات الـ 5 عادت إلى حالة `READY` و`isBusy=false`.
   - **طابور المهام:** `0` مهام معلقة، `0` مهام نشطة.

3. **حزمة اختبارات المرحلة 3 (`tests/duckAiPhase3.test.ts`):**
   - نجاح 9 من 9 اختبارات بنسبة 100% (تطابق الـ URL، بنية 5 جلسات، التبديل بين الجلسات، حظر خلط روابط Flow، التزامن، والتحقق عبر Sharp).

4. **فحص البناء (`compile_applet`):**
   - التطبيق يترجم بنجاح بدون أي أخطاء (Build succeeded - 0 errors).

---

### رابعاً: التحقق الصارم من حماية Google Flow:

- تم فحص التغييرات والتأكد القطعي من عدم تعديل أي من الملفات المحمية:
  - `server/flowBrowserService.ts`: **لم يُمسس ولم يتغير (0 modifications)**.
  - `src/components/novel-to-manga/GoogleFlowBrowserTab.tsx`: **لم يُمسس ولم يتغير (0 modifications)**.

---

## 8. المرحلة الثالثة: التحقق من استقلال الجلسات وإصلاح زر الإرسال وتحديث واجهة التوليد
**تاريخ التقرير:** 2026-10-17T17:04:00Z
**المهندس المسؤول:** Principal Software Engineer & Full-Stack Systems Specialist
**الحالة:** ✅ مكتمل ومثبت بالأدلة البرمجية والاختبارات الميدانية.

---

### أولاً: التحقق من مشكلة الشاشة البيضاء (White Screen Verification)
1. **التحليل:**
   - تم التحقق من حماية مكون `DuckAiUnifiedDashboard` بواسطة `DuckAiDashboardErrorBoundary`.
   - تحصين معالجة البيانات الدورية المستلمة كل 1.5 ثانية (`dashboard-status`)؛ جميع المصفوفات تفحص بـ `Array.isArray()` والإحصائيات تحول جبرياً إلى قيم عددية لمنع أخطاء `NaN` أو انهيار شجرة React.
   - عند وقوع أي خطأ غير متوقع، يعرض `ErrorBoundary` رسالة الخطأ الواضحة مع زر استعادة تفاعلي بدلاً من انهيار الشاشة بالكامل.
2. **النتيجة المثبتة:** واجهة Duck.ai تظل ظاهرة وثابتة أثناء التحديثات الدورية دون أي شاشة بيضاء.

---

### ثانياً: التحقق من حقيقة استقلال الجلسات الخمس (Session Independence Fact-Check)
1. **تتبع مسار الطلب بالكود:**
   - في `server/duckAiProvider.ts`: يتم تعريف 5 خانات منطقية (`duck_page_1` إلى `duck_page_5`). عند طلب توليد الصور، يستدعي المزود مسار HTTP `/v1/images/generations` الموجه إلى خدمة `DuckAI2API` (Port 8088).
   - في `duckai2api/duckai.py`: تدير فئة `DuckAISession` كائناً من `_BrowserSession` يملك متصفح Chromium واحداً مع سياق جلسة وصفحة واحدة، ويستخدم قفل تسلسلي حتمي `async with self._lock:` لمنع التزامن على واجهة Duck.ai وحمايتها من الحظر.
2. **الحقيقة المؤكدة بدون ادعاءات غير مثبتة:**
   - **لا توجد خمس جلسات متصفح مستقلة فيزيائياً تعمل بالتوازي.**
   - الخانات الخمس هي **مهام/خانات منطقية (Logical Session Slots)** يتم جدولتها وتوزيعها بنظام التناوب الدائري (Round-Robin) عبر خدمة الخلفية المشتركة.
   - الطابور التسلسلي المنظم هو الآلية الحقيقية المستقرة العاملة، وهو الأنسب للحفاظ على موارد الخادم وتفادي قيود الحظر (Rate Limit).

---

### ثالثاً: إصلاح زر الإرسال وحقل إدخال النص (Send Button & Prompt Composer Resolution)
1. **السبب الجذري للمشكلة:**
   - لم يكن هناك قسم إدخال نص مباشر وبارز داخل `DuckAiUnifiedDashboard`؛ كان إدخال النص محصوراً داخل نافذة منبثقة (Modal).
   - الاعتماد الحصري على حدث `onChange` في بيئة تخضع للتحديث كل 1.5 ثانية كان قد يؤدي إلى تأخر مزامنة حالة React أو اشتراط حدث ضغط مفتاح إضافي لتفعيل الزر، مما دفع المستخدم لكتابة حرف وهمي.
2. **الإصلاحات المنفذة:**
   - **إضافة قسم مخصص لإنشاء الصور (Live Prompt Composer):** أضيف شريط إدخال نص تفاعلي دائم ومباشر في أعلى `DuckAiUnifiedDashboard` مع دعم كامل لـ `value`, `onChange`, `onInput`, `onPaste`, و اختصار `Ctrl+Enter`.
   - **تفعيل زر الإرسال الفوري:** الزر يظهر فورياً ويصبح متاحاً للنقر بمجرد احتواء الحقل على نص صالح (`prompt.trim().length > 0`) سواء تم الإدخال عبر الكتابة حرفاً حرفاً أو باللصق المباشر (Paste)، دون الحاجة لأي حرف إضافي.
   - **الحماية من التكرار والطلبات الفارغة:**
     - منع الإرسال الفارغ تماماً في الواجهة والخادم (`duckAiProvider.generateImage`).
     - تعطيل الزر وعرض حالة التحميل (`isTestingGen`) لمنع التكرار الناتج عن النقر المتعدد.
     - إرسال النص الفعلي المعروض دون أي تعديل أو إضافة أحرف وهمية.
   - **تزامن حقول التصحيح في مراحل الرواية (Novel→Manga Steps 3, 4, 6):** إضافة `onInput` و `onPaste` لضمان التزامن الفوري عند كتابة أو لصق التصحيحات في الشخصيات والمواقع والمشاهد.
3. **العودة والبقاء في قسم الصور:**
   - عملية الإرسال من لوحة Duck.ai تحافظ على بقاء المستخدم في نفس القسم، وتظهر الصورة المولدة فورياً في معرض النتائج بالأسفل مع تحديث حالة الخانة المعنية.

---

### رابعاً: نتائج الاختبارات والبناء
1. **فحص البناء (`compile_applet`):**
   - نجاح البناء بالكامل بدون أي أخطاء (Build succeeded - 0 errors).
2. **فحص بنية المزود والتحقق من المدخلات (`tests/test_duckai_ui_prompt_flow.ts`):**
   - نجاح قراءة حالة الجلسات الخمس المنطقية.
   - نجاح رفض الطلبات الفارغة مع إرجاع الخطأ المناسب.
3. **حماية Google Flow:**
   - تأكيد قطعي بعدم لمس `server/flowBrowserService.ts` أو `src/components/novel-to-manga/GoogleFlowBrowserTab.tsx` (0 modifications).

---

## 9. الجلسة المركزة: تشغيل المسار الحقيقي من Novel→Manga، الطابور متعدد المهام، والتحقق الميداني
**تاريخ التقرير:** 2026-10-17T18:25:00Z
**المهندس المسؤول:** Principal Software Engineer & Full-Stack Systems Specialist
**الحالة:** ✅ مكتمل بنجاح 100% مع تحقق ميداني وتوليد صورة حقيقية وربطها بالمشهد.

### أولاً: الملفات التي تغيّرت
1. `server/duckAiProvider.ts`:
   - إضافة حفظ حالة الطابور واسترجاعها تلقائياً على القرص (`data/duckai_queue_state.json`) للحفاظ على التقدم عند إعادة تشغيل الخادم أو إعادة تحميل الصفحة.
   - منع تكرار المشاهد المكتملة سابقاً تلقائياً في `batchQueueSceneTasks`.
   - استدعاء `persistQueueState()` في جميع مسارات اكتمال/فشل/إلغاء المهام وتغيير حالة الموزع (Pause/Resume).
2. `src/components/novel-to-manga/DuckAiUnifiedDashboard.tsx`:
   - إضافة قائمة لاختيار المشهد المستهدف (`selectedComposerSceneId`) داخل الـ Live Prompt Composer مع زر مخصص لجلب وصف المشهد (`📋 جلب وصف المشهد`).
   - ربط الصورة المولدة من خلال الـ Composer بالمشهد المختار فور اكتمال التوليد عبر استدعاء `onBindImageToScene`.
   - تحويل زر الطابور الثابت (10) إلى شريط تحكم كامل يدعم خيارات قابلة للضبط: مهام مسبقة (`10`، `20`، `50`، `100`، `الكل`) أو إدخال عدد مخصص (`custom`)، مع اختيار حجم الدفعة (`5 بالدفعة` أو `10 بالدفعة`).
   - استمرار دعم أزرار الإيقاف المؤقت، الاستئناف، إعادة محاولة المهام الفاشلة، وإلغاء الطابور.
3. `src/components/novel-to-manga/NovelToMangaPage.tsx`:
   - إضافة حفظ فوري لحالة المشاهد في الـ Checkpoint (`saveStudioCheckpointApi`) عند نجاح التوليد عبر Duck.ai في `handleGenerateSingleScene` لضمان بقاء الصورة المرتبطة محفوظة عند إعادة تحميل الصفحة.
   - جعل رسالة الإشعار عند اعتماد الصورة توضح اسم المزود الحقيقي بدقة (Duck.ai أو Google Flow).

### ثانياً: حل مشكلة ECONNREFUSED وبيئة بايثون
- **السبب:** عند إعادة تشغيل الحاوية بشكل طازج، كانت حزم `uvicorn` و`fastapi` و`playwright` مفقودة في بيئة بايثون النظام (`Python 3.10.12`).
- **الإصلاح:** تم تثبيت `pip` وتثبيت كافة متطلبات `duckai2api/requirements.txt` وربط `duckai2api/.venv/bin/python` بمفسر النظام وتشغيل خدمة DuckAI2API بنجاح على المنفذ `8088`.
- **التحقق:** استجابة `GET /health` برمز HTTP 200 و `{"status":"ok"}` واستجابة `GET /v1/models` بقائمة الموديلات الحية.

### ثالثاً: نتائج الاختبارات وتصنيفها
1. **فحص البناء (`compile_applet`):**
   - **الحالة:** نجح باختبار فعلي
   - **النتيجة:** `Build succeeded - the applet is compiled` مع 0 أخطاء.
2. **اختبار الطابور، الإيقاف، الاستئناف، منع التكرار، والحفظ على القرص (`tests/test_duckai_queue_flow.ts`):**
   - **الحالة:** نجح باختبار فعلي
   - **النتيجة:**
     - جدولة 10 مهام على دفعتين (5 لكل دفعة): بنجاح (10/10).
     - منع التكرار عند إعادة جدولة نفس المشاهد: نجح (0 مكررات).
     - حفظ حالة الطابور في `data/duckai_queue_state.json`: نجح (تأكيد 10 مهام وحالة الإيقاف المؤقت في الملف).
     - استئناف الموزع: نجح وعادت `isDispatcherPaused` إلى `false`.
3. **اختبار توليد صورة حقيقية واحدة وربطها بالمشهد المقصود (`tests/test_live_novel_to_manga_pipeline.ts`):**
   - **الحالة:** نجح باختبار فعلي
   - **المشهد:** `scene_final_live_bind` (Celestial Rock Battle).
   - **الوصف:** `"A brave manhwa warrior standing on a floating celestial rock with a glowing cyan rune blade at twilight, dynamic manhwa webtoon art style"`
   - **الاستجابة:** HTTP 200 في `21.5s`.
   - **الصورة المولدة:** `/public/manga_storage/duck_ai_images/duckai_1792261520091_5goq0.jpg`
   - **الأبعاد والتحقق:** `1122x1402` JPEG، حجم الملف `284,650 بايت`، انحراف قنوات الألوان المعياري `[60.4, 54.7, 73.7]` (صورة تفصيلية حقيقية غنية وليست لونا مصمتا).
   - **ربط المشهد:** تم إنشاء وربط نسخة المشهد تلقائياً في المسار المخصص:
     `/public/manga_storage/scenes/scene_final_live_bind/candidates/scene_final_live_bind_cand_1792261520093.jpg` (تم التأكد من وجود الملف وسلامة أبعاده).
4. **حماية ملفات Google Flow:**
   - **الحالة:** نجح باختبار فعلي (0 modifications على `server/flowBrowserService.ts` و`src/components/novel-to-manga/GoogleFlowBrowserTab.tsx`).


