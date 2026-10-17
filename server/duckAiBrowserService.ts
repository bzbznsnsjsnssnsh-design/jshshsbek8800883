import { Page } from "puppeteer";
import { DUCK_AI_URL } from "../src/types/novelToManga.ts";
import {
  duckAiProvider,
  DuckPageId,
  DuckPageSlotDto,
  DuckAiStatus,
  InternalDuckPageSlot,
  GenerateDuckAiImageOptions,
  GenerateDuckAiImageResult,
} from "./duckAiProvider.ts";

export { DUCK_AI_URL };
export type {
  DuckPageId,
  DuckPageSlotDto,
  DuckAiStatus,
  InternalDuckPageSlot,
  GenerateDuckAiImageOptions,
  GenerateDuckAiImageResult,
};

/**
 * DuckAiBrowserService:
 * Unified facade synchronized with duckAiProvider for seamless 5-slot pool,
 * active slot state, and real Puppeteer Chromium session management.
 */
export class DuckAiBrowserService {
  private static instance: DuckAiBrowserService | null = null;
  public static readonly SITE_URL = DUCK_AI_URL;

  public static getInstance(): DuckAiBrowserService {
    if (!DuckAiBrowserService.instance) {
      DuckAiBrowserService.instance = new DuckAiBrowserService();
    }
    return DuckAiBrowserService.instance;
  }

  private constructor() {}

  public getSiteUrl(): string {
    return duckAiProvider.getSiteUrl();
  }

  public isDuckAiUrl(url: string): boolean {
    return duckAiProvider.isDuckAiUrl(url);
  }

  public getPagesStatus(): DuckPageSlotDto[] {
    return duckAiProvider.getPagesStatus();
  }

  public getActiveSlot(): InternalDuckPageSlot {
    return duckAiProvider.getActiveSlot();
  }

  public setActiveSlot(pageId: DuckPageId): void {
    duckAiProvider.setActiveSlot(pageId);
  }

  public async selectPage(pageId: DuckPageId): Promise<DuckAiStatus> {
    return duckAiProvider.selectPage(pageId);
  }

  public async ensurePageReady(
    slot: InternalDuckPageSlot,
    forceNavigate: boolean = false
  ): Promise<DuckAiStatus> {
    return duckAiProvider.ensurePageReady(slot, forceNavigate);
  }

  public async checkStatus(targetPage?: Page): Promise<DuckAiStatus> {
    return duckAiProvider.checkStatus(targetPage);
  }

  public async navigateToDuckAi(force: boolean = false): Promise<DuckAiStatus> {
    return duckAiProvider.navigateToDuckAi(force);
  }

  public async resetPageConversation(
    pageId?: DuckPageId
  ): Promise<{ success: boolean; message: string }> {
    return duckAiProvider.resetPageConversation(pageId);
  }

  public async generateImage(
    params: GenerateDuckAiImageOptions
  ): Promise<GenerateDuckAiImageResult> {
    return duckAiProvider.generateImage(params);
  }
}

export const duckAiBrowserService = DuckAiBrowserService.getInstance();
