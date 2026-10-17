import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Globe,
  RefreshCw,
  ArrowLeft,
  ArrowRight,
  Maximize2,
  Minimize2,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Play,
  Pause,
  Key,
  Copy,
  Check,
  Send,
  Camera,
  Monitor,
  ShieldCheck,
  Save,
  MousePointer,
  RotateCcw,
  Power,
} from "lucide-react";
import type {
  StudioSceneItem,
  StudioProductionElement,
  StudioLocationItem,
  StudioStylePreset,
  StudioAspectRatio,
} from "../../types/novelToManga";
import {
  fetchFlowBrowserStatusApi,
  launchFlowBrowserApi,
  navigateFlowBrowserApi,
  sendFlowBrowserActionApi,
  injectFlowBrowserPromptApi,
  extractFlowBrowserImagesApi,
  bindFlowBrowserImageToSceneApi,
  restartFlowBrowserApi,
  stopFlowBrowserApi,
  toggleFlowBrowserAutomationApi,
  saveFlowBrowserSessionApi,
  restoreFlowBrowserSessionApi,
  importFlowBrowserSessionApi,
  fetchFlowBrowserSessionInfoApi,
  type FlowBrowserStatusData,
  fetchDuckAiPagesApi,
  selectDuckAiPageApi,
  resetDuckAiPageApi,
  fetchDuckAiStatusApi,
  navigateDuckAiApi,
  type DuckPageSlotDto,
  type DuckAiStatusData,
  DUCK_AI_URL,
} from "../../services/novelToMangaClient";

interface GoogleFlowBrowserTabProps {
  scenes: StudioSceneItem[];
  productionElements: StudioProductionElement[];
  locations: StudioLocationItem[];
  selectedStyle: StudioStylePreset;
  selectedAspectRatio: StudioAspectRatio;
  onBindImageToScene: (sceneId: string, imageUrl: string) => void;
  onNavigateToTab?: (tabId: string) => void;
  isVisible?: boolean;
}

export function GoogleFlowBrowserTab({
  scenes,
  productionElements,
  locations,
  selectedStyle,
  selectedAspectRatio,
  onBindImageToScene,
  onNavigateToTab,
  isVisible = true,
}: GoogleFlowBrowserTabProps) {
  // Browser state
  const [status, setStatus] = useState<FlowBrowserStatusData | null>(null);
  const [urlInput, setUrlInput] = useState<string>("https://duck.ai/chat");
  const [currentUrl, setCurrentUrl] = useState<string>("https://duck.ai/chat");
  const [pageTitle, setPageTitle] = useState<string>("");
  const [isConnecting, setIsConnecting] = useState<boolean>(true);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isNavigating, setIsNavigating] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fps, setFps] = useState<number>(0);
  const [isAutomated, setIsAutomated] = useState<boolean>(true);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // 5 Real Duck.ai Browser Pages State
  const [duckPages, setDuckPages] = useState<DuckPageSlotDto[]>([]);
  const [activeDuckPageId, setActiveDuckPageId] = useState<string>("duck_page_1");
  const [duckAiStatus, setDuckAiStatus] = useState<DuckAiStatusData | null>(null);
  const [isSwitchingPage, setIsSwitchingPage] = useState<boolean>(false);
  const [isResettingChat, setIsResettingChat] = useState<boolean>(false);

  // Session & Login persistence state
  const [isSavingSession, setIsSavingSession] = useState<boolean>(false);
  const [isRestoringSession, setIsRestoringSession] = useState<boolean>(false);
  const [sessionNotice, setSessionNotice] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState<boolean>(false);
  const [manualCookiesInput, setManualCookiesInput] = useState<string>("");
  const [isImportingCookies, setIsImportingCookies] = useState<boolean>(false);

  // Quick typing bar
  const [quickText, setQuickText] = useState<string>("");

  // Scene & Novel Bridge state
  const [selectedSceneId, setSelectedSceneId] = useState<string>(
    scenes.length > 0 ? scenes[0].scene_id : ""
  );
  const [extractedImages, setExtractedImages] = useState<
    Array<{ url: string; alt?: string; width?: number; height?: number }>
  >([]);
  const [isScanningImages, setIsScanningImages] = useState<boolean>(false);
  const [isBindingImage, setIsBindingImage] = useState<boolean>(false);
  const [bindingNotice, setBindingNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [hasCopiedPrompt, setHasCopiedPrompt] = useState<boolean>(false);
  const [isTypingPrompt, setIsTypingPrompt] = useState<boolean>(false);

  // Click & interaction visual feedback
  const [clickRipple, setClickRipple] = useState<{ x: number; y: number; id: number } | null>(null);

  // Canvas & Streaming refs
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const frameCountRef = useRef<number>(0);
  const lastFpsTimestampRef = useRef<number>(Date.now());
  const fallbackPollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hasReceivedFrameRef = useRef<boolean>(false);
  const isDecodingFrameRef = useRef<boolean>(false);
  const pendingFrameRef = useRef<string | null>(null);
  const lastUserInteractionTimeRef = useRef<number>(Date.now());
  const rateLimitBackoffUntilRef = useRef<number>(0);

  // Pointer tracking for single-click vs dragging
  const pointerDownRef = useRef<{ x: number; y: number; time: number; button: "left" | "right" | "middle" } | null>(null);
  const isDraggingRef = useRef<boolean>(false);
  const lastMoveSentRef = useRef<number>(0);

  // Track the active scene object
  const activeScene = scenes.find((s) => s.scene_id === selectedSceneId) || scenes[0];

  // Build curated prompt for Google Flow based on the active scene and Visual Bible
  const buildCuratedFlowPrompt = useCallback(
    (scene: StudioSceneItem | undefined): string => {
      if (!scene) return "";

      const parts: string[] = [];

      // Style line
      parts.push(`Art Style: ${selectedStyle}, aspect ratio ${selectedAspectRatio}, ultra detailed, masterpiece, highly cinematic lighting.`);

      // Visual Bible Character References attached
      if (Array.isArray(scene.character_ids) && scene.character_ids.length > 0) {
        const attachedChars = productionElements.filter((el) =>
          scene.character_ids.includes(el.id)
        );
        if (attachedChars.length > 0) {
          const charLines = attachedChars.map((c) => {
            const desc = c.canonical_description || c.description || c.name;
            return `Character [${c.name}]: ${desc}`;
          });
          parts.push(charLines.join("\n"));
        }
      }

      // Visual Bible Location Reference attached
      if (scene.location_id) {
        const attachedLoc = locations.find((l) => l.location_id === scene.location_id);
        if (attachedLoc) {
          const locName = attachedLoc.canonical_name || (attachedLoc as any).location_name || attachedLoc.location_id;
          const locDesc = (attachedLoc as any).canonical_description || attachedLoc.descriptionArabic || "";
          parts.push(`Environment / Location [${locName}]: ${locDesc}`);
        }
      }

      // Scene Action & Dialogue
      parts.push(`Scene Action: ${scene.visual_prompt || scene.base_prompt || scene.description || scene.title}`);
      if (scene.dialogue) {
        parts.push(`Context Dialogue: "${scene.dialogue}"`);
      }
      parts.push("Render high detail, clean lineart, no extraneous text, no artifacts.");

      return parts.join("\n\n");
    },
    [productionElements, locations, selectedStyle, selectedAspectRatio]
  );

  const currentCuratedPrompt = buildCuratedFlowPrompt(activeScene);

  // Single persistent Image instance for fallback base64 decoding
  const persistentImgRef = useRef<HTMLImageElement | null>(null);
  const pendingBlobRef = useRef<Blob | null>(null);

  // Fast off-thread ImageBitmap decoder for binary Blob frames (0% main-thread JSON parsing, hardware accelerated)
  const renderBlobFrameOnCanvas = useCallback((blob: Blob) => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    if (isDecodingFrameRef.current) {
      pendingBlobRef.current = blob;
      return;
    }
    isDecodingFrameRef.current = true;

    const processNextBlob = () => {
      isDecodingFrameRef.current = false;
      if (pendingBlobRef.current) {
        const nextBlob = pendingBlobRef.current;
        pendingBlobRef.current = null;
        renderBlobFrameOnCanvas(nextBlob);
      }
    };

    if (typeof window.createImageBitmap === "function") {
      createImageBitmap(blob)
        .then((bitmap) => {
          if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
          }
          ctx.drawImage(bitmap, 0, 0);
          bitmap.close();

          hasReceivedFrameRef.current = true;
          setIsConnecting(false);
          setIsNavigating(false);

          frameCountRef.current++;
          const now = Date.now();
          if (now - lastFpsTimestampRef.current >= 1500) {
            const calculatedFps = Math.round((frameCountRef.current * 1000) / (now - lastFpsTimestampRef.current));
            setFps((prev) => (Math.abs(prev - calculatedFps) >= 2 ? calculatedFps : prev));
            frameCountRef.current = 0;
            lastFpsTimestampRef.current = now;
          }
          processNextBlob();
        })
        .catch(() => {
          processNextBlob();
        });
    } else {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        if (canvas.width !== img.width || canvas.height !== img.height) {
          canvas.width = img.width;
          canvas.height = img.height;
        }
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        hasReceivedFrameRef.current = true;
        setIsConnecting(false);
        setIsNavigating(false);
        processNextBlob();
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        processNextBlob();
      };
      img.src = url;
    }
  }, []);

  // Render a base64 JPEG onto the canvas with single-decode pipeline & requestAnimationFrame
  const renderFrameOnCanvas = useCallback((base64Data: string) => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    if (isDecodingFrameRef.current) {
      pendingFrameRef.current = base64Data;
      return;
    }

    if (!persistentImgRef.current) {
      persistentImgRef.current = new Image();
    }

    isDecodingFrameRef.current = true;
    const img = persistentImgRef.current;

    img.onload = () => {
      requestAnimationFrame(() => {
        if (canvas.width !== img.width || canvas.height !== img.height) {
          canvas.width = img.width;
          canvas.height = img.height;
        }
        ctx.drawImage(img, 0, 0);

        hasReceivedFrameRef.current = true;
        setIsConnecting(false);
        setIsNavigating(false);

        frameCountRef.current++;
        const now = Date.now();
        if (now - lastFpsTimestampRef.current >= 1000) {
          setFps(frameCountRef.current);
          frameCountRef.current = 0;
          lastFpsTimestampRef.current = now;
        }

        isDecodingFrameRef.current = false;
        if (pendingFrameRef.current) {
          const nextData = pendingFrameRef.current;
          pendingFrameRef.current = null;
          renderFrameOnCanvas(nextData);
        }
      });
    };

    img.onerror = () => {
      isDecodingFrameRef.current = false;
      pendingFrameRef.current = null;
    };

    img.src = `data:image/jpeg;base64,${base64Data}`;
  }, []);

  // Establish WebSocket connection to backend for live screencast & interaction
  const connectWebSocket = useCallback(() => {
    try {
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch (_) {}
      }

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const host = window.location.host;
      const wsUrl = `${protocol}//${host}/api/flow-browser/ws`;

      console.log(`[FlowBrowserClient] Connecting WebSocket to ${wsUrl}...`);
      const ws = new WebSocket(wsUrl);
      ws.binaryType = "blob";
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("[FlowBrowserClient] WebSocket connected.");
        setIsConnected(true);
        setErrorMessage(null);
        if (fallbackPollTimerRef.current) {
          clearInterval(fallbackPollTimerRef.current);
          fallbackPollTimerRef.current = null;
        }
      };

      ws.onmessage = (event) => {
        try {
          if (event.data instanceof Blob) {
            renderBlobFrameOnCanvas(event.data);
            return;
          }
          const msg = JSON.parse(event.data);
          if (msg.type === "frame" && msg.data) {
            renderFrameOnCanvas(msg.data);
          } else if (msg.type === "status" && msg.status) {
            setStatus((prev) => {
              if (
                prev?.isRunning === msg.status.isRunning &&
                prev?.currentUrl === msg.status.currentUrl &&
                prev?.hasGoogleAuth === msg.status.hasGoogleAuth &&
                prev?.isAutomated === msg.status.isAutomated
              ) {
                return prev;
              }
              return msg.status;
            });
            setCurrentUrl((prev) => (prev === msg.status.currentUrl ? prev : msg.status.currentUrl));
            setPageTitle((prev) => (prev === msg.status.pageTitle ? prev : msg.status.pageTitle));
            setIsAutomated((prev) => (prev === msg.status.isAutomated ? prev : msg.status.isAutomated));
          }
        } catch (_) {}
      };

      ws.onclose = () => {
        console.log("[FlowBrowserClient] WebSocket closed.");
        setIsConnected(false);
        startHttpPollingFallback();
      };

      ws.onerror = (err) => {
        console.warn("[FlowBrowserClient] WebSocket notice:", err);
        setIsConnected(false);
        startHttpPollingFallback();
      };
    } catch (e: any) {
      console.warn("[FlowBrowserClient] WebSocket init error:", e?.message);
      startHttpPollingFallback();
    }
  }, [renderFrameOnCanvas]);

  // High-performance HTTP screenshot polling fallback (runs if WebSocket proxy closes)
  const isPollingRef = useRef<boolean>(false);

  const startHttpPollingFallback = () => {
    if (fallbackPollTimerRef.current) return;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;

    const pollFrame = async () => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        if (fallbackPollTimerRef.current) {
          clearTimeout(fallbackPollTimerRef.current);
          fallbackPollTimerRef.current = null;
        }
        return;
      }

      // If we are under backoff (e.g. rate limit encountered), wait before next poll
      if (Date.now() < rateLimitBackoffUntilRef.current) {
        fallbackPollTimerRef.current = setTimeout(pollFrame, 3500);
        return;
      }

      // Do not poll if tab is hidden to conserve bandwidth and prevent proxy rate limits
      if (!isVisible) {
        return;
      }

      if (!isPollingRef.current) {
        isPollingRef.current = true;
        try {
          const res = await fetch("/api/flow-browser/screenshot?format=json");
          if (res.status === 429) {
            console.warn("[FlowBrowserClient] HTTP 429 Rate exceeded detected, backing off 6s...");
            rateLimitBackoffUntilRef.current = Date.now() + 6000;
          } else if (res.ok) {
            const text = await res.text();
            if (text.startsWith("{")) {
              const data = JSON.parse(text);
              if (data?.frame) {
                renderFrameOnCanvas(data.frame);
                setIsConnected(true);
                setIsConnecting(false);
              }
            }
          }
        } catch (_) {
        } finally {
          isPollingRef.current = false;
        }
      }

      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        // Adaptive polling: 1400ms if active user interaction recently (within 5s), otherwise 2400ms
        const recentlyActive = Date.now() - lastUserInteractionTimeRef.current < 5000;
        const delay = recentlyActive ? 1400 : 2400;
        fallbackPollTimerRef.current = setTimeout(pollFrame, delay);
      }
    };

    pollFrame();
  };

  // Instant frame load on mount and connect
  useEffect(() => {
    let isMounted = true;

    async function init() {
      // 1. Immediately request the latest frame from in-memory cache (takes ~2-4ms)
      fetch("/api/flow-browser/screenshot?format=json")
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.frame && isMounted) {
            renderFrameOnCanvas(data.frame);
            setIsConnecting(false);
          }
        })
        .catch(() => {});

      // 2. Connect WebSocket immediately to stream frames without waiting for HTTP roundtrip
      connectWebSocket();

      try {
        const res = await launchFlowBrowserApi(DUCK_AI_URL);
        if (isMounted && res.success) {
          setStatus(res.status);
          setCurrentUrl(res.url);
          setUrlInput((prev) => (prev ? prev : res.url));
        }
      } catch (err: any) {
        if (isMounted && !hasReceivedFrameRef.current) {
          setErrorMessage(err?.message || "فشل الاتصال بمتصفح Chromium");
        }
      } finally {
        if (isMounted) {
          setIsConnecting(false);
        }
      }
    }

    init();

    // Fast 1.5s safety timeout: guarantees connecting spinner NEVER hangs
    const safetyTimer = setTimeout(() => {
      if (isMounted) setIsConnecting(false);
    }, 1500);

    return () => {
      isMounted = false;
      clearTimeout(safetyTimer);
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch (_) {}
      }
      if (fallbackPollTimerRef.current) {
        clearTimeout(fallbackPollTimerRef.current);
      }
    };
  }, [connectWebSocket, renderFrameOnCanvas]);

  // Instant response when the user switches to this tab
  useEffect(() => {
    if (!isVisible) return;

    // Immediately fetch latest in-memory frame (takes ~2-4ms from RAM)
    fetch("/api/flow-browser/screenshot?format=json")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.frame) {
          renderFrameOnCanvas(data.frame);
          setIsConnected(true);
          setIsConnecting(false);
        }
      })
      .catch(() => {});

    // Ensure WebSocket is active and request latest frame
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      connectWebSocket();
    } else {
      try {
        wsRef.current.send(JSON.stringify({ type: "request_frame" }));
      } catch (_) {}
    }

    setIsConnecting(false);
    // Fetch live Duck.ai pages status
    fetchDuckAiPagesApi()
      .then((res) => {
        if (res.success && res.pages) {
          setDuckPages(res.pages);
          if (res.activePageId) setActiveDuckPageId(res.activePageId);
        }
      })
      .catch(() => {});
  }, [isVisible, connectWebSocket, renderFrameOnCanvas]);

  const loadDuckPages = useCallback(async () => {
    try {
      const res = await fetchDuckAiPagesApi();
      if (res.success && res.pages) {
        setDuckPages(res.pages);
        if (res.activePageId) setActiveDuckPageId(res.activePageId);
      }
    } catch (_) {}
  }, []);

  const handleSelectDuckPage = async (pageId: string) => {
    setIsSwitchingPage(true);
    setActiveDuckPageId(pageId);
    try {
      const res = await selectDuckAiPageApi(pageId);
      if (res.success && res.status) {
        setDuckAiStatus(res.status);
        if (res.status.pages) setDuckPages(res.status.pages);
        setCurrentUrl(res.status.currentUrl);
        setUrlInput(res.status.currentUrl);
        setPageTitle(res.status.pageTitle || "");
      }
      await loadDuckPages();
    } catch (err: any) {
      setErrorMessage(err?.message || String(err));
    } finally {
      setIsSwitchingPage(false);
    }
  };

  const handleResetConversation = async () => {
    setIsResettingChat(true);
    try {
      const res = await resetDuckAiPageApi(activeDuckPageId);
      if (res.success) {
        setSessionNotice({ type: "success", text: res.message || "✓ تم تصفير المحادثة بنجاح." });
      }
    } catch (err: any) {
      setSessionNotice({ type: "error", text: err?.message || "فشل تصفير المحادثة." });
    } finally {
      setIsResettingChat(false);
    }
  };

  const handleNavigateDuckAiDirectly = async (force: boolean = false) => {
    setIsNavigating(true);
    setErrorMessage(null);
    try {
      const res = await navigateDuckAiApi(force);
      if (res.success && res.status) {
        setDuckAiStatus(res.status);
        if (res.status.pages) setDuckPages(res.status.pages);
        setCurrentUrl(res.status.currentUrl);
        setUrlInput(res.status.currentUrl);
        setPageTitle(res.status.pageTitle || "");
        setSessionNotice({
          type: "success",
          text: `✓ Duck.ai جاهز الآن (استغرق التحميل: ${res.status.readinessDurationMs || 0}ms)`,
        });
      } else {
        const errText = res.error || "تعذر فتح واجهة Duck.ai أو التحقق من الجاهزية.";
        setErrorMessage(errText);
        setSessionNotice({ type: "error", text: `فشل فتح Duck.ai: ${errText}` });
      }
    } catch (err: any) {
      const errText = err?.message || "فشل فتح Duck.ai";
      setErrorMessage(errText);
      setSessionNotice({ type: "error", text: `فشل فتح Duck.ai: ${errText}` });
    } finally {
      setIsNavigating(false);
    }
  };

  // Send action via WebSocket or HTTP fallback
  const sendAction = useCallback(async (action: any) => {
    try {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "action", action }));
      } else {
        await sendFlowBrowserActionApi(action);
      }
    } catch (e: any) {
      console.warn("[FlowBrowserClient] Send action error:", e?.message);
    }
  }, []);

  // Precise coordinate transformation with letterboxing & pillarboxing compensation
  const getCanvasCoordinates = (
    e: React.PointerEvent<HTMLCanvasElement> | React.MouseEvent<HTMLCanvasElement>
  ) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const cw = canvas.width || 1280;
    const ch = canvas.height || 800;
    const canvasRatio = cw / ch;
    const elementRatio = rect.width / rect.height;

    let renderWidth = rect.width;
    let renderHeight = rect.height;
    let offsetX = 0;
    let offsetY = 0;

    // Compensate for CSS object-contain letterboxing/pillarboxing
    if (elementRatio > canvasRatio) {
      // Horizontal bars on left/right
      renderHeight = rect.height;
      renderWidth = renderHeight * canvasRatio;
      offsetX = (rect.width - renderWidth) / 2;
    } else {
      // Vertical bars on top/bottom
      renderWidth = rect.width;
      renderHeight = renderWidth / canvasRatio;
      offsetY = (rect.height - renderHeight) / 2;
    }

    const clientXInContent = e.clientX - rect.left - offsetX;
    const clientYInContent = e.clientY - rect.top - offsetY;

    // Constrain within the actual web viewport
    const clampedX = Math.max(0, Math.min(renderWidth, clientXInContent));
    const clampedY = Math.max(0, Math.min(renderHeight, clientYInContent));

    const x = Math.round((clampedX / renderWidth) * cw);
    const y = Math.round((clampedY / renderHeight) * ch);

    return {
      x,
      y,
      visualX: e.clientX - rect.left,
      visualY: e.clientY - rect.top,
    };
  };

  // Pointer Handlers: Clean Single Click Detection & Dragging without Duplicate Events
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    containerRef.current?.focus();
    const coords = getCanvasCoordinates(e);
    if (!coords) return;

    const button: "left" | "right" | "middle" =
      e.button === 2 ? "right" : e.button === 1 ? "middle" : "left";

    pointerDownRef.current = {
      x: coords.x,
      y: coords.y,
      time: Date.now(),
      button,
    };
    isDraggingRef.current = false;
    lastUserInteractionTimeRef.current = Date.now();
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pointerDownRef.current) return;
    const coords = getCanvasCoordinates(e);
    if (!coords) return;

    lastUserInteractionTimeRef.current = Date.now();
    const dist = Math.hypot(coords.x - pointerDownRef.current.x, coords.y - pointerDownRef.current.y);

    // If movement exceeds threshold, transition into dragging
    if (dist > 6 && !isDraggingRef.current) {
      isDraggingRef.current = true;
      sendAction({
        type: "mousedown",
        x: pointerDownRef.current.x,
        y: pointerDownRef.current.y,
        button: pointerDownRef.current.button,
      });
    }

    if (isDraggingRef.current) {
      const now = Date.now();
      if (now - lastMoveSentRef.current > 120) {
        lastMoveSentRef.current = now;
        sendAction({ type: "move", x: coords.x, y: coords.y });
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    lastUserInteractionTimeRef.current = Date.now();
    if (!pointerDownRef.current) return;
    const coords = getCanvasCoordinates(e);
    const targetX = coords ? coords.x : pointerDownRef.current.x;
    const targetY = coords ? coords.y : pointerDownRef.current.y;
    const button = pointerDownRef.current.button;

    if (isDraggingRef.current) {
      sendAction({ type: "mouseup", x: targetX, y: targetY, button });
      isDraggingRef.current = false;
    } else {
      // Single clean user click
      sendAction({ type: "click", x: targetX, y: targetY, button });

      // Visual feedback ripple
      if (coords) {
        const rippleId = Date.now();
        setClickRipple({ x: coords.visualX, y: coords.visualY, id: rippleId });
        setTimeout(() => {
          setClickRipple((curr) => (curr?.id === rippleId ? null : curr));
        }, 400);
      }
    }

    pointerDownRef.current = null;
  };

  const handlePointerLeave = () => {
    if (pointerDownRef.current) {
      if (isDraggingRef.current) {
        sendAction({ type: "mouseup" });
      }
      pointerDownRef.current = null;
      isDraggingRef.current = false;
      sendAction({ type: "resetInput" });
    }
  };

  const handleCanvasWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    sendAction({
      type: "wheel",
      deltaX: Math.round(e.deltaX),
      deltaY: Math.round(e.deltaY),
    });
  };

  // Keyboard Handlers
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (["Tab", "Enter", "Backspace", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
      e.preventDefault();
      sendAction({ type: "keypress", key: e.key });
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      sendAction({ type: "type", text: e.key });
    }
  };

  // Navigation actions
  const handleNavigate = async (targetUrl?: string) => {
    const dest = targetUrl || urlInput;
    if (dest && dest.includes("flow.google.com")) {
      const msg = "الانتقال إلى Google Flow (flow.google.com) محظور داخل متصفح Duck.ai في قسم Novel → Manga. الموقع المعتمد لتوليد الصور هو Duck.ai فقط.";
      setErrorMessage(msg);
      setSessionNotice({ type: "error", text: msg });
      return;
    }
    setIsConnecting(true);
    setErrorMessage(null);
    try {
      const res = await navigateFlowBrowserApi(dest);
      if (res.success && res.status) {
        setStatus(res.status);
        setCurrentUrl(res.status.currentUrl);
        setUrlInput(res.status.currentUrl);
        setPageTitle(res.status.pageTitle);
      } else if (res.error) {
        setErrorMessage(res.error);
        setSessionNotice({ type: "error", text: res.error });
      }
    } catch (err: any) {
      setErrorMessage(err?.message || "فشل الانتقال");
    } finally {
      setIsConnecting(false);
    }
  };

  const handleReload = () => sendAction({ type: "reload" });
  const handleGoBack = () => sendAction({ type: "goBack" });
  const handleGoForward = () => sendAction({ type: "goForward" });

  const handleSendQuickText = async () => {
    if (!quickText.trim()) return;
    await sendAction({ type: "type", text: quickText });
    setQuickText("");
  };

  const [isStoppingBrowser, setIsStoppingBrowser] = useState<boolean>(false);

  const handleRestartBrowser = async () => {
    setIsConnecting(true);
    try {
      const res = await restartFlowBrowserApi();
      if (res.success) {
        setStatus(res.status);
        setCurrentUrl(res.status.currentUrl);
        setUrlInput(res.status.currentUrl);
        connectWebSocket();
      }
    } catch (err: any) {
      setErrorMessage(err?.message || "فشلت إعادة تشغيل المتصفح");
    } finally {
      setIsConnecting(false);
    }
  };

  const handleStopBrowser = async () => {
    setIsStoppingBrowser(true);
    try {
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch (_) {}
      }
      if (fallbackPollTimerRef.current) {
        clearInterval(fallbackPollTimerRef.current);
        fallbackPollTimerRef.current = null;
      }
      const res = await stopFlowBrowserApi();
      if (res.success) {
        setStatus(res.status);
        setIsConnected(false);
        setSessionNotice({
          type: "success",
          text: "✓ تم إيقاف متصفح Chromium وحفظ الجلسة وتحرير موارد الذاكرة والملفات بنجاح.",
        });
      }
    } catch (err: any) {
      setErrorMessage(err?.message || "فشل إيقاف المتصفح");
    } finally {
      setIsStoppingBrowser(false);
    }
  };

  const handleStartBrowser = async () => {
    setIsConnecting(true);
    setErrorMessage(null);
    try {
      const res = await launchFlowBrowserApi(currentUrl || DUCK_AI_URL);
      if (res.success) {
        setStatus(res.status);
        setCurrentUrl(res.url);
        setUrlInput(res.url);
        connectWebSocket();
      }
    } catch (err: any) {
      setErrorMessage(err?.message || "فشل تشغيل متصفح Chromium");
    } finally {
      setIsConnecting(false);
    }
  };

  const handleToggleAutomation = async () => {
    const nextState = !isAutomated;
    setIsAutomated(nextState);
    await toggleFlowBrowserAutomationApi(nextState);
  };

  // Reset stuck mouse / focus
  const handleResetInput = async () => {
    await sendAction({ type: "resetInput" });
    setSessionNotice({
      type: "info",
      text: "تم تحرير مؤشر الفأرة وإلغاء أي تعليق للتفاعل بنجاح.",
    });
    setTimeout(() => setSessionNotice(null), 3000);
  };

  // Explicit Session Save & Restore Handlers
  const handleSaveSession = async () => {
    setIsSavingSession(true);
    setSessionNotice({
      type: "info",
      text: "جارٍ فحص واستخراج ملفات تعريف الارتباط من متصفح Chromium...",
    });
    try {
      const res = await saveFlowBrowserSessionApi();
      if (res.success) {
        setStatus(res.status);
        setSessionNotice({
          type: "success",
          text: res.message || "✓ تم حفظ جلسة المتصفح وحساب Google بنجاح! لن يُطلب منك تسجيل الدخول مرة أخرى.",
        });
      } else {
        const isRateExceeded =
          res.error?.includes("Rate exceeded") ||
          res.error?.includes("تجاوز معدل") ||
          res.error?.includes("429");
        if (isRateExceeded) {
          setSessionNotice({
            type: "info",
            text: "تم تجاوز معدل الطلبات مؤقتًا من خوادم السحابة. جارٍ إعادة المحاولة تلقائيًا بعد 3 ثوانٍ...",
          });
          setTimeout(async () => {
            try {
              const retryRes = await saveFlowBrowserSessionApi();
              if (retryRes.success) {
                setStatus(retryRes.status);
                setSessionNotice({
                  type: "success",
                  text: retryRes.message || "✓ تم حفظ جلسة المتصفح بنجاح!",
                });
              } else {
                setSessionNotice({
                  type: "error",
                  text: retryRes.error || "تعذر حفظ الجلسة. يمكنك أيضاً استخدام زر «لصق الكوكيز يدوياً».",
                });
              }
            } catch (retryErr: any) {
              setSessionNotice({
                type: "error",
                text: retryErr?.message || "تعذر حفظ الجلسة. يرجى الانتظار بضع ثوانٍ.",
              });
            } finally {
              setIsSavingSession(false);
            }
          }, 3200);
          return;
        }

        setSessionNotice({
          type: "error",
          text: res.error || "تعذر حفظ الجلسة.",
        });
      }
    } catch (err: any) {
      setSessionNotice({
        type: "error",
        text: `خطأ في حفظ الجلسة: ${err?.message}`,
      });
    } finally {
      setIsSavingSession(false);
    }
  };

  const handleImportCookies = async () => {
    if (!manualCookiesInput.trim()) {
      setSessionNotice({
        type: "error",
        text: "يرجى لصق نص الكوكيز أولاً.",
      });
      return;
    }

    setIsImportingCookies(true);
    setSessionNotice({
      type: "info",
      text: "جارٍ فحص وتطبيق الكوكيز...",
    });

    try {
      const res = await importFlowBrowserSessionApi(manualCookiesInput.trim());
      if (res.success) {
        setStatus(res.status);
        setIsImportModalOpen(false);
        setManualCookiesInput("");
        setSessionNotice({
          type: "success",
          text: res.message || "✓ تم استيراد وتطبيق الكوكيز بنجاح!",
        });
      } else {
        setSessionNotice({
          type: "error",
          text: res.error || "فشل استيراد الكوكيز. تأكد من صحة التنسيق.",
        });
      }
    } catch (err: any) {
      setSessionNotice({
        type: "error",
        text: `خطأ في استيراد الكوكيز: ${err?.message}`,
      });
    } finally {
      setIsImportingCookies(false);
    }
  };

  const handleRestoreSession = async () => {
    setIsRestoringSession(true);
    setSessionNotice(null);
    try {
      const res = await restoreFlowBrowserSessionApi();
      if (res.success) {
        setStatus(res.status);
        setSessionNotice({
          type: "success",
          text: res.message || "✓ تمت استعادة ملفات تعريف الارتباط المحفوظة بنجاح.",
        });
      } else {
        setSessionNotice({
          type: "error",
          text: res.error || "تعذر استعادة الجلسة.",
        });
      }
    } catch (err: any) {
      setSessionNotice({
        type: "error",
        text: `خطأ في استعادة الجلسة: ${err?.message}`,
      });
    } finally {
      setIsRestoringSession(false);
    }
  };

  // Helper: Auto-type curated scene prompt into Google Flow
  const handleAutoTypePromptIntoFlow = async () => {
    if (!currentCuratedPrompt.trim()) return;
    setIsTypingPrompt(true);
    setBindingNotice(null);
    try {
      const res = await injectFlowBrowserPromptApi(currentCuratedPrompt);
      if (res.success) {
        setBindingNotice({
          type: "success",
          text: "✓ تم إرسال وصف المشهد والمراجع إلى Google Flow بنجاح!",
        });
      } else {
        setBindingNotice({
          type: "error",
          text: `تعذر تحديد حقل الوصف تلقائيًا: ${res.message}. يمكنك استخدام زر النسخ ولصق الوصف يدويًا.`,
        });
      }
    } catch (err: any) {
      setBindingNotice({
        type: "error",
        text: `خطأ في إرسال الوصف: ${err?.message}`,
      });
    } finally {
      setIsTypingPrompt(false);
    }
  };

  const handleCopyPrompt = () => {
    navigator.clipboard.writeText(currentCuratedPrompt);
    setHasCopiedPrompt(true);
    setTimeout(() => setHasCopiedPrompt(false), 2000);
  };

  // Scanner: Extract real generated images from Google Flow DOM
  const handleScanGeneratedImages = async () => {
    setIsScanningImages(true);
    setBindingNotice(null);
    try {
      const res = await extractFlowBrowserImagesApi();
      if (res.success && res.images.length > 0) {
        setExtractedImages(res.images);
        setBindingNotice({
          type: "success",
          text: `✓ تم العثور على ${res.images.length} صورة مولدة داخل Google Flow!`,
        });
      } else {
        setBindingNotice({
          type: "error",
          text: "لم يتم العثور على صور جديدة مكتملة في Google Flow حتى الآن. انتظر اكتمال التوليد وحاول مجددًا.",
        });
      }
    } catch (err: any) {
      setBindingNotice({
        type: "error",
        text: `فشل فحص الصور: ${err?.message}`,
      });
    } finally {
      setIsScanningImages(false);
    }
  };

  // Binding: Save extracted image and bind to scene
  const handleBindImage = async (imageUrl: string) => {
    if (!selectedSceneId) return;
    setIsBindingImage(true);
    setBindingNotice(null);
    try {
      const res = await bindFlowBrowserImageToSceneApi({
        imageUrl,
        sceneId: selectedSceneId,
      });
      if (res.success && res.localUrl) {
        onBindImageToScene(selectedSceneId, res.localUrl);
        setBindingNotice({
          type: "success",
          text: `✓ تم حفظ وتثبيت الصورة بنجاح على ${activeScene?.title || selectedSceneId}!`,
        });
      }
    } catch (err: any) {
      setBindingNotice({
        type: "error",
        text: `فشل حفظ وربط الصورة: ${err?.message}`,
      });
    } finally {
      setIsBindingImage(false);
    }
  };

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className={`flex flex-col gap-4 text-slate-100 outline-none ${
        isFullscreen ? "fixed inset-0 z-50 bg-slate-950 p-4 overflow-y-auto" : "w-full"
      }`}
      dir="rtl"
    >
      {/* Header & Status Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/90 pb-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-amber-500/20 text-amber-300">
              <span className="text-base">🦆</span>
            </span>
            <h2 className="text-base sm:text-lg font-extrabold text-white">
              متصفح Duck.ai الحقيقي (5 صفحات متصفح حقيقية)
            </h2>
            <span className="text-xs text-slate-500 font-mono">·</span>
            <span
              className={`text-xs font-semibold ${
                isConnected ? "text-emerald-400" : isConnecting ? "text-amber-400" : "text-rose-400"
              }`}
            >
              {isConnected ? "بث تفاعلي حي متصل" : isConnecting ? "جاري الاتصال..." : "منفصل"}
            </span>
            {fps > 0 && (
              <span className="text-[11px] text-slate-400 font-mono">
                ({fps} FPS)
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400">
            المزوّد الوحيد المعتمد لتوليد الصور داخل Novel → Manga عبر الرابط: <span className="text-amber-300 font-mono">https://duck.ai/chat</span> مع 5 صفحات متصفح حقيقية.
          </p>
        </div>

        {/* Quick Toolbar */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => handleNavigateDuckAiDirectly(true)}
            disabled={isNavigating}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold transition cursor-pointer shadow-sm disabled:opacity-50"
            title="فتح صفحة Duck.ai أو تحديث الجاهزية"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isNavigating ? "animate-spin" : ""}`} />
            <span>{isNavigating ? "جاري الفتح..." : "فتح / تحديث Duck.ai"}</span>
          </button>

          <button
            type="button"
            onClick={handleResetConversation}
            disabled={isResettingChat}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-slate-200 transition cursor-pointer disabled:opacity-50"
            title="بدء محادثة جديدة داخل الصفحة نفسها بدون إعادة تحميل"
          >
            <span>💬</span>
            <span>{isResettingChat ? "جاري التصفير..." : "New Chat"}</span>
          </button>

          <button
            type="button"
            onClick={handleResetInput}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-semibold text-slate-300 transition cursor-pointer"
            title="تحرير مؤشر الفأرة وإلغاء أي تعليق للنقر أو السحب"
          >
            <MousePointer className="h-3.5 w-3.5 text-amber-400" />
            <span>تحرير المؤشر</span>
          </button>

          <button
            type="button"
            onClick={handleToggleAutomation}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer border ${
              isAutomated
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                : "bg-slate-900 border-slate-800 text-slate-400"
            }`}
            title="تبديل التحكم الآلي / اليدوي"
          >
            {isAutomated ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            <span>{isAutomated ? "آلي" : "يدوي"}</span>
          </button>

          <button
            type="button"
            onClick={handleRestartBrowser}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-semibold text-slate-300 transition cursor-pointer"
            title="إعادة تشغيل جلسة Chromium"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>إعادة تشغيل</span>
          </button>

          <button
            type="button"
            onClick={() => setIsFullscreen((prev) => !prev)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-semibold text-slate-300 transition cursor-pointer"
            title="ملء الشاشة"
          >
            {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            <span>{isFullscreen ? "تصغير" : "ملء الشاشة"}</span>
          </button>
        </div>
      </div>

      {/* 🦆 5 Real Chromium Browser Pages Tab Bar */}
      <div className="bg-slate-900/95 border border-slate-800 rounded-xl p-2 flex flex-col gap-2">
        <div className="flex items-center justify-between text-xs px-1">
          <div className="flex items-center gap-2">
            <span className="font-bold text-white flex items-center gap-1.5">
              <span>🗂️</span>
              <span>صفحات Duck.ai الخمس الحقيقية (Real Chromium Tabs):</span>
            </span>
            <span className="text-[11px] text-slate-400">
              (الصفحة النشطة: <span className="text-amber-300 font-mono font-bold">{activeDuckPageId}</span>)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onNavigateToTab?.("duck_dashboard")}
              className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold text-[11px] flex items-center gap-1 transition cursor-pointer shadow-sm"
              title="فتح لوحة تحكم Duck.ai الموحدة التي تعرض الجلسات الخمس ونتائجها في شاشة واحدة دون التنقل بين الصفحات"
            >
              <span>🦆</span>
              <span>لوحة تحكم Duck.ai الموحدة (5 جلسات) ↗</span>
            </button>
            <button
              type="button"
              onClick={loadDuckPages}
              className="text-[11px] text-slate-400 hover:text-white flex items-center gap-1 transition cursor-pointer"
            >
              <RefreshCw className="h-3 w-3" />
              <span>تحديث الصفحات</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {[
            { id: "duck_page_1", label: "Duck Page 1", num: 1 },
            { id: "duck_page_2", label: "Duck Page 2", num: 2 },
            { id: "duck_page_3", label: "Duck Page 3", num: 3 },
            { id: "duck_page_4", label: "Duck Page 4", num: 4 },
            { id: "duck_page_5", label: "Duck Page 5", num: 5 },
          ].map((tab) => {
            const pageData = duckPages.find((p) => p.id === tab.id);
            const isSelected = activeDuckPageId === tab.id;
            const status = pageData?.status || "IDLE";
            const isInitialized = Boolean(pageData?.isInitialized);

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleSelectDuckPage(tab.id)}
                disabled={isSwitchingPage}
                className={`p-2 rounded-lg border text-right transition cursor-pointer flex flex-col gap-1 ${
                  isSelected
                    ? "bg-amber-500/15 border-amber-500/60 text-white shadow-md ring-1 ring-amber-500/30"
                    : "bg-slate-950/70 border-slate-800 hover:border-slate-700 text-slate-300 hover:bg-slate-950"
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className="font-bold text-xs flex items-center gap-1">
                    <span>🦆</span>
                    <span>{tab.label}</span>
                  </span>
                  <span
                    className={`h-2 w-2 rounded-full ${
                      status === "READY"
                        ? "bg-emerald-400 animate-pulse"
                        : status === "GENERATING" || status === "LOADING"
                        ? "bg-amber-400 animate-ping"
                        : status === "CAPTCHA"
                        ? "bg-rose-500"
                        : status === "RATE_LIMITED"
                        ? "bg-purple-500"
                        : "bg-slate-600"
                    }`}
                  />
                </div>

                <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                  <span
                    className={`px-1 rounded text-[9px] font-bold ${
                      status === "READY"
                        ? "bg-emerald-950 text-emerald-300"
                        : status === "CAPTCHA"
                        ? "bg-rose-950 text-rose-300"
                        : status === "RATE_LIMITED"
                        ? "bg-purple-950 text-purple-300"
                        : "bg-slate-800 text-slate-400"
                    }`}
                  >
                    {status}
                  </span>
                  <span>{pageData?.readinessDurationMs ? `${(pageData.readinessDurationMs / 1000).toFixed(1)}s` : isInitialized ? "نشطة" : "جاهزة للفتح"}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* CAPTCHA / Rate Limit Alert Banners */}
      {status?.lastError && status.lastError.includes("كابتشا") && (
        <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-500/50 text-xs flex items-center justify-between gap-3 text-rose-200">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-rose-400 shrink-0" />
            <div>
              <strong className="block text-rose-100 font-bold">تحدي DuckDuckGo للتحقق البشري (Duck Challenge):</strong>
              <span>يطلب الموقع تحديد مربعات البطة. انقر مباشرة داخل شاشة المتصفح أدناه لحل التحدي.</span>
            </div>
          </div>
        </div>
      )}

      {duckAiStatus?.isRateLimited && (
        <div className="p-3 rounded-xl bg-purple-950/60 border border-purple-500/50 text-xs flex items-center justify-between gap-3 text-purple-200">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-purple-400 shrink-0" />
            <div>
              <strong className="block text-purple-100 font-bold">حد الاستخدام العام (Rate Limit):</strong>
              <span>تم بلوغ الحد المسموح للاستخدام في Duck.ai. تم تعليق المهام مؤقتاً لحين انتهاء التقييد.</span>
            </div>
          </div>
        </div>
      )}

      {/* Browser Navigation Toolbar */}
      <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center gap-2 flex-wrap text-xs">
        {/* Navigation Buttons */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={handleGoBack}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
            title="رجوع"
          >
            <ArrowRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleGoForward}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
            title="تقدم"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleReload}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
            title="تحديث الصفحة"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>

        {/* Quick Shortcut Buttons */}
        {/* Quick Shortcut Buttons */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => handleNavigate("https://duck.ai/chat")}
            className="px-2.5 py-1.5 rounded-lg bg-amber-950/60 hover:bg-amber-900/80 border border-amber-500/40 text-amber-300 font-semibold transition cursor-pointer flex items-center gap-1"
            title="الانتقال إلى https://duck.ai/chat"
          >
            <span>🦆</span>
            <span>https://duck.ai/chat</span>
          </button>
        </div>

        {/* Address / URL Bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleNavigate();
          }}
          className="flex-1 min-w-[200px] flex items-center gap-2"
        >
          <div className="relative flex-1 flex items-center">
            <Globe className="absolute right-3 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://duck.ai/chat"
              className="w-full pr-9 pl-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 text-xs font-mono focus:border-emerald-500 focus:outline-none"
              dir="ltr"
            />
          </div>
          <button
            type="submit"
            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition cursor-pointer shrink-0"
          >
            الانتقال
          </button>
        </form>

        {/* Status info */}
        <div className="flex items-center gap-2 shrink-0 text-slate-400 text-[11px] font-mono">
          <span className="truncate max-w-[200px]" title={pageTitle || currentUrl}>
            {pageTitle || currentUrl}
          </span>
        </div>
      </div>

      {/* Main Grid: Interactive Chromium Canvas (Left/Top) + Novel & Visual Bible Bridge (Right/Bottom) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Column: Real Chromium Viewport Stream */}
        <div className="lg:col-span-8 flex flex-col gap-2.5">
          <div className="relative rounded-2xl bg-black border border-slate-800 overflow-hidden shadow-2xl flex items-center justify-center min-h-[460px] aspect-[16/10]">
            {/* Real Canvas with CDP Stream and Direct Click Support */}
            <canvas
              ref={canvasRef}
              width={1280}
              height={800}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerLeave}
              onWheel={handleCanvasWheel}
              onContextMenu={(e) => e.preventDefault()}
              className="w-full h-full object-contain cursor-pointer select-none"
              style={{ touchAction: "none" }}
            />

            {/* Click Ripple Indicator for instant visual feedback */}
            {clickRipple && (
              <span
                key={clickRipple.id}
                className="absolute pointer-events-none rounded-full border-2 border-emerald-400 bg-emerald-400/30 animate-ping"
                style={{
                  left: clickRipple.x - 12,
                  top: clickRipple.y - 12,
                  width: 24,
                  height: 24,
                }}
              />
            )}

            {/* Stopped / Idle Browser State Overlay */}
            {!status?.isRunning && !isConnecting && (
              <div className="absolute inset-0 bg-slate-950/95 flex flex-col items-center justify-center gap-3.5 p-6 text-center z-20">
                <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
                  <Monitor className="h-8 w-8" />
                </div>
                <div className="flex flex-col gap-1 max-w-md">
                  <span className="text-sm font-bold text-slate-100">
                    متصفح Duck.ai متوقف حالياً لتوفير موارد الذاكرة والنظام
                  </span>
                  <span className="text-xs text-slate-400 leading-relaxed">
                    تم تحرير موارد المتصفح وإغلاق ملفات القفل بأمان. جميع الكوكيز وبيانات الجلسة محفوظة. اضغط أدناه لتشغيل المتصفح فوراً عند الحاجة.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleStartBrowser}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs transition shadow-lg shadow-amber-950/40 cursor-pointer"
                >
                  <Play className="h-4 w-4" />
                  <span>بدء تشغيل Duck.ai</span>
                </button>
              </div>
            )}

            {/* Loading / Connecting Overlay (Transparent pointer-events-none once a frame arrives) */}
            {isConnecting && !hasReceivedFrameRef.current && (
              <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm flex flex-col items-center justify-center gap-3 text-center p-6 z-20">
                <RefreshCw className="h-8 w-8 text-amber-400 animate-spin" />
                <span className="text-sm font-semibold text-white">
                  جاري تشغيل جلسة Chromium الحقيقية والاتصال بـ Duck.ai...
                </span>
                <span className="text-xs text-slate-400 max-w-sm">
                  يتم إعداد ملف تعريف المتصفح وبث الشاشة الحي عبر Chrome DevTools Protocol.
                </span>
              </div>
            )}

            {/* Error Overlay */}
            {errorMessage && !isConnected && !hasReceivedFrameRef.current && (
              <div className="absolute inset-0 bg-slate-950/90 flex flex-col items-center justify-center gap-3 p-6 text-center">
                <AlertTriangle className="h-8 w-8 text-rose-400" />
                <span className="text-sm font-bold text-rose-300">
                  انقطع الاتصال بمتصفح Chromium
                </span>
                <span className="text-xs text-slate-400 max-w-md">{errorMessage}</span>
                <button
                  type="button"
                  onClick={handleRestartBrowser}
                  className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs transition cursor-pointer"
                >
                  إعادة المحاولة والاتصال
                </button>
              </div>
            )}
          </div>

          {/* Quick Typing Helper Bar for typing text directly into the focused field on Flow */}
          <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center gap-2 text-xs">
            <span className="text-slate-400 font-semibold shrink-0">
              إدخال نص للمتصفح:
            </span>
            <input
              type="text"
              value={quickText}
              onChange={(e) => setQuickText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSendQuickText();
                }
              }}
              placeholder="اكتب أي نص أو رابط هنا لإرساله فورًا إلى الحقل النشط في Duck.ai..."
              className="flex-1 px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:border-amber-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={handleSendQuickText}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold transition cursor-pointer shrink-0"
            >
              <Send className="h-3.5 w-3.5 text-amber-400" />
              <span>إرسال</span>
            </button>
          </div>
        </div>

        {/* Right Column: Novel → Manga Scene & Visual Bible Integration Bridge */}
        <div className="lg:col-span-4 flex flex-col gap-4">
          {/* Scene Selector & Bridge Card */}
          <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 flex flex-col gap-3.5">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-amber-400" />
                <h3 className="text-xs sm:text-sm font-bold text-white">
                  ربط المشاهد بـ Duck.ai
                </h3>
              </div>
              <span className="text-xs text-slate-400 font-mono">
                {scenes.length} مشاهد متاحة
              </span>
            </div>

            {/* Scene Selector Dropdown */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold text-slate-300">
                اختر المشهد المطلوب تجهيزه:
              </label>
              <select
                value={selectedSceneId}
                onChange={(e) => setSelectedSceneId(e.target.value)}
                className="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
              >
                {scenes.map((sc, i) => (
                  <option key={sc.scene_id} value={sc.scene_id}>
                    {sc.title || `مشهد ${i + 1} (${sc.scene_id})`}
                  </option>
                ))}
              </select>
            </div>

            {/* Selected Scene Context Summary */}
            {activeScene && (
              <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80 flex flex-col gap-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-emerald-300">
                    {activeScene.title}
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 text-slate-400">
                    {selectedAspectRatio} · {selectedStyle}
                  </span>
                </div>

                <p className="text-[11px] text-slate-300 line-clamp-3 leading-relaxed">
                  {activeScene.description || activeScene.visual_prompt}
                </p>

                {/* Character & Location Lock Badges */}
                <div className="flex items-center gap-1.5 flex-wrap pt-1 text-[10px]">
                  {Array.isArray(activeScene.character_ids) &&
                    activeScene.character_ids.map((cId) => {
                      const c = productionElements.find((el) => el.id === cId);
                      return (
                        <span
                          key={cId}
                          className="px-2 py-0.5 rounded bg-emerald-950/50 text-emerald-300 border border-emerald-500/30"
                        >
                          شخصية: {c?.name || cId}
                        </span>
                      );
                    })}

                  {activeScene.location_id && (
                    <span className="px-2 py-0.5 rounded bg-indigo-950/50 text-indigo-300 border border-indigo-500/30">
                      موقع:{" "}
                      {locations.find((l) => l.location_id === activeScene.location_id)?.canonical_name ||
                        (locations.find((l) => l.location_id === activeScene.location_id) as any)?.location_name ||
                        activeScene.location_id}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Curated Prompt Box with Actions */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-300">
                  الوصف المجهز لـ Duck.ai:
                </span>
                <button
                  type="button"
                  onClick={handleCopyPrompt}
                  className="flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300 cursor-pointer"
                >
                  {hasCopiedPrompt ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  <span>{hasCopiedPrompt ? "تم النسخ" : "نسخ الوصف"}</span>
                </button>
              </div>

              <textarea
                value={currentCuratedPrompt}
                readOnly
                rows={4}
                className="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-slate-300 font-mono leading-relaxed resize-none focus:outline-none"
                dir="ltr"
              />

              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleAutoTypePromptIntoFlow}
                  disabled={isTypingPrompt}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs transition cursor-pointer disabled:opacity-50"
                  title="كتابة الوصف تلقائيًا في حقل Duck.ai"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>{isTypingPrompt ? "جاري الإرسال..." : "إرسال إلى Duck.ai"}</span>
                </button>

                <button
                  type="button"
                  onClick={handleCopyPrompt}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs transition cursor-pointer"
                >
                  <Copy className="h-3.5 w-3.5" />
                  <span>نسخ الوصف</span>
                </button>
              </div>
            </div>

            {/* Notice if any */}
            {bindingNotice && (
              <div
                className={`p-2.5 rounded-xl text-xs flex items-center gap-2 ${
                  bindingNotice.type === "success"
                    ? "bg-emerald-950/60 border border-emerald-500/40 text-emerald-300"
                    : "bg-rose-950/60 border border-rose-500/40 text-rose-300"
                }`}
              >
                {bindingNotice.type === "success" ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                ) : (
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                )}
                <span>{bindingNotice.text}</span>
              </div>
            )}
          </div>

          {/* Result Detector & Image Extraction Card */}
          <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 flex flex-col gap-3.5">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
              <div className="flex items-center gap-2">
                <Camera className="h-4 w-4 text-emerald-400" />
                <h3 className="text-xs sm:text-sm font-bold text-white">
                  التقاط وربط الصورة المولدة
                </h3>
              </div>
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              بعد ظهور نتيجة التوليد الحقيقية في صفحة Duck.ai، اضغط الزر أدناه لفحص الصورة وتحميلها وربطها بالمشهد المحدد.
            </p>

            <button
              type="button"
              onClick={handleScanGeneratedImages}
              disabled={isScanningImages}
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs transition cursor-pointer disabled:opacity-50"
            >
              <Camera className="h-4 w-4" />
              <span>{isScanningImages ? "جاري الفحص في Duck.ai..." : "🔍 فحص الصور المولدة في Duck.ai"}</span>
            </button>

            {/* Extracted Images List */}
            {extractedImages.length > 0 && (
              <div className="flex flex-col gap-2.5 pt-2">
                <span className="text-[11px] font-semibold text-slate-300">
                  الصور المكتشفة ({extractedImages.length}):
                </span>
                <div className="grid grid-cols-2 gap-2 max-h-56 overflow-y-auto p-1">
                  {extractedImages.map((img, idx) => (
                    <div
                      key={idx}
                      className="group relative rounded-xl bg-slate-950 border border-slate-800 overflow-hidden flex flex-col"
                    >
                      <img
                        src={img.url}
                        alt={img.alt || `Duck.ai Image ${idx + 1}`}
                        className="w-full h-24 object-cover"
                        referrerPolicy="no-referrer"
                      />
                      <div className="p-1.5 flex flex-col gap-1 bg-slate-950/90 text-[10px]">
                        <span className="text-slate-400 font-mono truncate">
                          {img.width ? `${img.width}x${img.height}` : "Duck.ai Image"}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleBindImage(img.url)}
                          disabled={isBindingImage}
                          className="w-full py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] transition cursor-pointer"
                        >
                          تثبيت للمشهد
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Active scene current image preview if bound */}
            {activeScene?.image_url && (
              <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2">
                  <img
                    src={activeScene.image_url}
                    alt={activeScene.title}
                    className="h-10 w-10 rounded-lg object-cover border border-emerald-500/40 bg-slate-950"
                  />
                  <div className="flex flex-col">
                    <span className="text-emerald-300 font-bold text-[11px]">
                      صورة المشهد مثبتة ✓
                    </span>
                    <span className="text-slate-400 text-[10px]">
                      جاهز للاستعراض في تبويب Pages
                    </span>
                  </div>
                </div>

                {onNavigateToTab && (
                  <button
                    type="button"
                    onClick={() => onNavigateToTab("pages")}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold cursor-pointer"
                  >
                    عرض في Pages
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Manual Cookies Import Modal */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-5 flex flex-col gap-4 text-xs">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-indigo-500/20 text-indigo-400">
                  <Key className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-sm">استيراد كوكيز أو جلسة Duck.ai يدوياً</h3>
                  <p className="text-[11px] text-slate-400">حل فوري لتخطي أي قيود على سرعة الطلبات أو تعليق المتصفح</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsImportModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-slate-300 font-medium">
                الصق ملفات تعريف الارتباط (Netscape format أو JSON أو Header):
              </label>
              <textarea
                value={manualCookiesInput}
                onChange={(e) => setManualCookiesInput(e.target.value)}
                placeholder={`# الصق كوكيز duck.ai هنا...\n# يدعم كوكيز إضافة Cookie-Editor أو رأس Cookie المنسوخ`}
                rows={8}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-200 font-mono text-[11px] focus:outline-none focus:border-indigo-500 resize-none"
                dir="ltr"
              />
              <p className="text-[10px] text-slate-400 leading-normal">
                💡 يمكنك نسخ الكوكيز من إضافة المتصفح (مثل Cookie-Editor) أثناء فتحك لموقع duck.ai ولصقها هنا مباشرة.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsImportModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleImportCookies}
                disabled={isImportingCookies || !manualCookiesInput.trim()}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold cursor-pointer disabled:opacity-50"
              >
                {isImportingCookies ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                <span>{isImportingCookies ? "جارٍ الحفظ والتحقق..." : "تطبيق وحفظ الكوكيز"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
