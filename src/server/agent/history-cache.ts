// src/server/agent/history-cache.ts
import fs from 'fs';
import path from 'path';
import { Content } from '@google/generative-ai';
import logger from '../logger'; // Adjust path if needed
import { resolvedProjectRoot } from '../config'; // Adjust path if needed

// Define the path for storing session files
const SESSIONS_DIR = path.join(resolvedProjectRoot, 'chat_sessions');

// Ensure the sessions directory exists
if (!fs.existsSync(SESSIONS_DIR)) {
    logger.info(`[HistoryCache] Creating session directory: ${SESSIONS_DIR}`);
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

// Type for display history items (assuming it's defined elsewhere or define here)
export interface DisplayHistoryItem {
    type: 'user' | 'model' | 'error' | 'internal';
    text: string;
}

// Structure for the data stored in each session file
interface SessionData {
    gemini_history_internal: string; // Keep serialized format
    chat_history_display: DisplayHistoryItem[];
}

// --- Serialization/Deserialization (Keep as is) ---

export function serializeHistory(history: Content[]): [string | null, string | null] {
    try {
        return [JSON.stringify(history), null];
    } catch (error: any) {
        logger.error('[HistoryCache] Failed to serialize history:', error);
        return [null, `Serialization Error: ${error.message}`];
    }
}

export function deserializeHistory(serializedHistory: string | null): Content[] | null {
    if (!serializedHistory) {
        return []; // Return empty history if null/empty string
    }
    try {
        const history = JSON.parse(serializedHistory);
        // Basic validation (check if it's an array)
        if (!Array.isArray(history)) {
            logger.error('[HistoryCache] Deserialized history is not an array.');
            return null; // Indicate corruption
        }
        // TODO: Add more robust validation of Content structure if needed
        return history;
    } catch (error: any) {
        logger.error('[HistoryCache] Failed to deserialize history:', error);
        return null; // Indicate corruption
    }
}

// --- Filesystem Operations ---

function getSessionFilePath(sessionId: string): string {
    // Basic sanitization to prevent path traversal - replace non-alphanumeric chars
    const safeSessionId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
    if (!safeSessionId) {
        throw new Error('Invalid sessionId provided.');
    }
    return path.join(SESSIONS_DIR, `${safeSessionId}.json`);
}

/**
 * Loads session data from the filesystem.
 * Returns default empty state if the session file doesn't exist.
 */
export function loadSessionData(sessionId: string): SessionData {
    const filePath = getSessionFilePath(sessionId);
    logger.debug(`[HistoryCache] Loading session data for ID: ${sessionId} from ${filePath}`);

    if (fs.existsSync(filePath)) {
        try {
            const rawData = fs.readFileSync(filePath, 'utf-8');
            const data = JSON.parse(rawData) as SessionData;
            // Basic validation
            if (!data || typeof data.gemini_history_internal !== 'string' || !Array.isArray(data.chat_history_display)) {
                 logger.warn(`[HistoryCache] Session file ${filePath} has invalid structure. Resetting.`);
                 return { gemini_history_internal: '[]', chat_history_display: [] };
            }
            logger.info(`[HistoryCache] Loaded session data for ID: ${sessionId}`);
            return data;
        } catch (error: any) {
            logger.error(`[HistoryCache] Error reading or parsing session file ${filePath}: ${error.message}. Resetting session.`);
            // Fall through to return default state on error
        }
    } else {
        logger.info(`[HistoryCache] No session file found for ID: ${sessionId}. Starting new session.`);
    }

    // Return default state for new sessions or on error
    return {
        gemini_history_internal: '[]', // Default to empty serialized array
        chat_history_display: []
    };
}

/**
 * Saves session data to the filesystem.
 */
export function saveSessionData(sessionId: string, internalHistory: string | null, displayHistory: DisplayHistoryItem[]): void {
    const filePath = getSessionFilePath(sessionId);
    logger.debug(`[HistoryCache] Saving session data for ID: ${sessionId} to ${filePath}`);

    const dataToSave: SessionData = {
        gemini_history_internal: internalHistory ?? '[]', // Ensure we save valid JSON string
        chat_history_display: displayHistory
    };

    try {
        fs.writeFileSync(filePath, JSON.stringify(dataToSave, null, 2), 'utf-8'); // Pretty print JSON
        logger.info(`[HistoryCache] Saved session data for ID: ${sessionId}`);
    } catch (error: any) {
        logger.error(`[HistoryCache] Error writing session file ${filePath}: ${error.message}`);
        // Handle write error (e.g., retry, notify user?)
    }
}

/**
 * Deletes a session file from the filesystem.
 */
export function deleteSessionData(sessionId: string): void {
    const filePath = getSessionFilePath(sessionId);
    logger.info(`[HistoryCache] Deleting session data for ID: ${sessionId} from ${filePath}`);
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            logger.info(`[HistoryCache] Deleted session file for ID: ${sessionId}`);
        } else {
             logger.warn(`[HistoryCache] Attempted to delete non-existent session file: ${filePath}`);
        }
    } catch (error: any) {
        logger.error(`[HistoryCache] Error deleting session file ${filePath}: ${error.message}`);
    }
}

/**
 * Resets a session by overwriting its file with default empty data.
 */
export function resetSessionData(sessionId: string, initialDisplayMessage?: string): void {
    logger.info(`[HistoryCache] Resetting session data for ID: ${sessionId}`);
    const initialDisplay = initialDisplayMessage ? [{ type: 'internal', text: initialDisplayMessage } as DisplayHistoryItem] : [];
    saveSessionData(sessionId, '[]', initialDisplay); // Save default empty state
}

// Remove old in-memory cache and related functions
// const historyCache = new Map<string, SessionData>();
// export function getCachedData(sid: string): SessionData { ... }
// export function saveCachedData(...) { ... }
// export function resetCacheForSid(...) { ... }
// export function deleteCacheForSid(...) { ... }
