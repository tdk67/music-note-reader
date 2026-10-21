/**
 * collection_store.js
 * 
 * Local-First IndexedDB Repository for Transcribed Scores
 * Provides persistence, song renaming, deletion, versioned JSON backup export,
 * and backward-compatible import migration.
 */

const DB_NAME = "MusicNoteReaderDB";
const DB_VERSION = 1;
const STORE_NAME = "scores";
const CURRENT_SCHEMA_VERSION = "1.0.0";

class CollectionStore {
  constructor() {
    this.db = null;
    this.initPromise = this._initDb();
  }

  _initDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex("createdAt", "createdAt", { unique: false });
          store.createIndex("title", "title", { unique: false });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.error("IndexedDB open failed:", event.target.error);
        reject(event.target.error);
      };
    });
  }

  async _getStore(mode = "readonly") {
    if (!this.db) {
      await this.initPromise;
    }
    const tx = this.db.transaction(STORE_NAME, mode);
    return tx.objectStore(STORE_NAME);
  }

  /**
   * Save or update a transcribed score record
   * @param {Object} scoreRecord 
   */
  async saveScore(scoreRecord) {
    const store = await this._getStore("readwrite");
    const record = {
      id: scoreRecord.id || "score_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6),
      title: scoreRecord.title || "Untitled Score",
      createdAt: scoreRecord.createdAt || Date.now(),
      updatedAt: Date.now(),
      metadata: scoreRecord.metadata || {},
      musicxml: scoreRecord.musicxml || "",
      bpm: scoreRecord.bpm || 116,
      previewAudioUrl: scoreRecord.previewAudioUrl || null
    };

    return new Promise((resolve, reject) => {
      const request = store.put(record);
      request.onsuccess = () => resolve(record);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Get all saved scores sorted descending by createdAt
   */
  async getAllScores() {
    const store = await this._getStore("readonly");
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => {
        const list = request.result || [];
        list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        resolve(list);
      };
      request.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Get single score by id
   */
  async getScore(id) {
    const store = await this._getStore("readonly");
    return new Promise((resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Update the title of a score
   */
  async updateTitle(id, newTitle) {
    const item = await this.getScore(id);
    if (!item) throw new Error("Score not found: " + id);
    item.title = newTitle.trim() || "Untitled";
    item.updatedAt = Date.now();
    return this.saveScore(item);
  }

  /**
   * Delete score by ID
   */
  async deleteScore(id) {
    const store = await this._getStore("readwrite");
    return new Promise((resolve, reject) => {
      const request = store.delete(id);
      request.onsuccess = () => resolve(true);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Export the entire collection to a versioned JSON payload
   */
  async exportCollectionJson() {
    const scores = await this.getAllScores();
    const exportData = {
      app: "MusicNoteReader",
      schemaVersion: CURRENT_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      count: scores.length,
      scores: scores
    };
    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Backward-compatible import from JSON string
   * Handles format versioning and upgrades older formats gracefully.
   */
  async importCollectionJson(jsonString) {
    let parsed;
    try {
      parsed = JSON.parse(jsonString);
    } catch (e) {
      throw new Error("Invalid JSON file format.");
    }

    let rawList = [];
    if (Array.isArray(parsed)) {
      // Legacy unversioned list
      rawList = parsed;
    } else if (parsed && Array.isArray(parsed.scores)) {
      // Versioned schema v1.0.0
      rawList = parsed.scores;
    } else if (parsed && Array.isArray(parsed.songs)) {
      // Early draft schema
      rawList = parsed.songs;
    } else {
      throw new Error("Unrecognized collection backup format.");
    }

    let importedCount = 0;
    for (const item of rawList) {
      if (!item || !item.musicxml) continue;

      // Schema normalization & migration
      const normalized = {
        id: item.id || "score_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6),
        title: item.title || (item.metadata && item.metadata.title) || "Imported Score",
        createdAt: item.createdAt || Date.now(),
        updatedAt: Date.now(),
        metadata: item.metadata || {},
        musicxml: item.musicxml,
        bpm: item.bpm || (item.metadata && item.metadata.bpm) || 116,
        previewAudioUrl: item.previewAudioUrl || null
      };

      await this.saveScore(normalized);
      importedCount++;
    }

    return importedCount;
  }
}

// Global Singleton Instance
window.collectionStore = new CollectionStore();
