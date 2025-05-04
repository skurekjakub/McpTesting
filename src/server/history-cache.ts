import { Content } from '@google/generative-ai';

// Define types (can be shared or refined later)
export interface DisplayHistoryItem {
    type: 'user' | 'model' | 'error' | 'system' | 'internal';
    text: string;
}
export type DisplayHistory = DisplayHistoryItem[];
export type SerializedHistory = any[]; // Use 'any' for now, refine if needed based on Content structure
export type DeserializedHistory = Content[];

interface CachedData {
    gemini_history_internal: SerializedHistory;
    chat_history_display: DisplayHistory;
}

// In-memory cache (replace with file/db cache for persistence if needed)
const historyCache = new Map<string, CachedData>();

// --- Serialization/Deserialization Helpers ---
// Basic serialization (adjust if Content has complex objects)
export function serializeHistory(history: DeserializedHistory): [SerializedHistory, boolean] {
    try {
        // Assuming Content objects are serializable as-is or via a method if available
        // For simplicity, we'll assume direct serialization works for now.
        // If Content objects have methods or complex types, proper serialization is needed.
        const serialized = JSON.parse(JSON.stringify(history)); // Basic deep copy/serialization
        return [serialized, false];
    } catch (error: unknown) {
        console.error("Error serializing history:", error);
        return [[], true]; // Return empty list and error flag
    }
}

// Basic deserialization (adjust if Content needs specific construction)
export function deserializeHistory(serializedData: SerializedHistory): DeserializedHistory | null {
    try {
        // Assuming the serialized data directly maps back to Content structure.
        // If specific class instantiation or validation is needed, implement here.
        return JSON.parse(JSON.stringify(serializedData)); // Basic deep copy/deserialization
    } catch (error: unknown) {
        console.error("Error deserializing history:", error);
        return null; // Indicate failure
    }
}

// --- Cache Interaction Functions ---

export function getCachedData(sid: string): CachedData {
    const data = historyCache.get(sid);
    if (data) {
        // Ensure defaults if keys are missing (shouldn't happen with save logic)
        data.gemini_history_internal = data.gemini_history_internal ?? [];
        data.chat_history_display = data.chat_history_display ?? [];
        return data;
    }
    // Return default structure if not found
    return { gemini_history_internal: [], chat_history_display: [] };
}

export function saveCachedData(
    sid: string,
    internal_history_serialized: SerializedHistory,
    display_history: DisplayHistory
): boolean {
    try {
        const dataToSave: CachedData = {
            gemini_history_internal: internal_history_serialized,
            chat_history_display: display_history
        };
        historyCache.set(sid, dataToSave);
        // console.log(`[${sid}] Saved cache. Internal: ${internal_history_serialized.length}, Display: ${display_history.length}`);
        return true;
    } catch (error: unknown) {
        console.error(`[${sid}] Failed to save data to cache:`, error);
        return false;
    }
}

export function resetCacheForSid(sid: string, errorMessage?: string): void {
    try {
        const displayHist: DisplayHistory = [];
        if (errorMessage) {
            displayHist.push({ type: "error", text: errorMessage });
        }
        const dataToSave: CachedData = {
            gemini_history_internal: [],
            chat_history_display: displayHist
        };
        historyCache.set(sid, dataToSave);
        console.log(`[${sid}] Reset cache entry.`);
    } catch (error: unknown) {
        console.error(`[${sid}] Failed to reset cache entry:`, error);
    }
}

export function deleteCacheForSid(sid: string): void {
    try {
        historyCache.delete(sid);
        console.log(`[${sid}] Deleted cache entry for ${sid}.`);
    } catch (error: unknown) {
        console.error(`[${sid}] Failed to delete cache entry for ${sid}:`, error);
    }
}
