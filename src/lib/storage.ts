import { getAllLocalMangas, deleteLocalManga, LocalManga } from "./db";

export interface SavedChapter {
  id: string;
  title: string;
  pages: string[];
  targetLanguage?: string;
  timestamp: number;
  coverUrl?: string;
}

export async function getAllSavedChapters(): Promise<SavedChapter[]> {
  try {
    const list: LocalManga[] = await getAllLocalMangas();
    return list.map((m) => ({
      id: m.id,
      title: m.title,
      pages: m.pages,
      timestamp: m.createdAt,
      coverUrl: m.coverUrl,
      targetLanguage: "ar",
    }));
  } catch (err) {
    console.error("Failed to get saved chapters:", err);
    return [];
  }
}

export async function deleteSavedChapter(id: string): Promise<void> {
  return deleteLocalManga(id);
}
