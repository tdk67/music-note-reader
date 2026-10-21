/**
 * Precision Neural OMR & Audio Player — Client Controller
 */

let currentJobId = null;
let pollTimer = null;
let elapsedTimer = null;
let jobStartTime = 0;
let osmd = null;
let currentZoom = 1.0;

// DOM Elements
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const uploadSection = document.getElementById("uploadSection");
const progressCard = document.getElementById("progressCard");
const progressBarFill = document.getElementById("progressBarFill");
const progressPct = document.getElementById("progressPct");
const progressStage = document.getElementById("progressStage");
const progressTitle = document.getElementById("progressTitle");
const elapsedTime = document.getElementById("elapsedTime");

const resultSection = document.getElementById("resultSection");
const metaTitle = document.getElementById("metaTitle");
const metaKey = document.getElementById("metaKey");
const metaTime = document.getElementById("metaTime");
const metaClef = document.getElementById("metaClef");
const metaNotes = document.getElementById("metaNotes");

const playBtn = document.getElementById("playBtn");
const playIcon = document.getElementById("playIcon");
const audioElement = document.getElementById("audioElement");
const timelineTrack = document.getElementById("timelineTrack");
const timelineFill = document.getElementById("timelineFill");
const audioCurrentTime = document.getElementById("audioCurrentTime");
const audioTotalTime = document.getElementById("audioTotalTime");

const btnDownloadWav = document.getElementById("btnDownloadWav");
const btnDownloadMid = document.getElementById("btnDownloadMid");
const btnDownloadXml = document.getElementById("btnDownloadXml");
const btnUploadAnother = document.getElementById("btnUploadAnother");
const instrumentSelect = document.getElementById("instrumentSelect");

const zoomInBtn = document.getElementById("zoomInBtn");
const zoomOutBtn = document.getElementById("zoomOutBtn");
const zoomResetBtn = document.getElementById("zoomResetBtn");

// Song Library & Collection DOM Elements
const btnToggleCollection = document.getElementById("btnToggleCollection");
const collectionOverlay = document.getElementById("collectionOverlay");
const btnCloseDrawer = document.getElementById("btnCloseDrawer");
const collectionList = document.getElementById("collectionList");
const collectionCountBadge = document.getElementById("collectionCountBadge");
const collectionSearchInput = document.getElementById("collectionSearchInput");
const btnExportCollection = document.getElementById("btnExportCollection");
const importJsonInput = document.getElementById("importJsonInput");
const btnEditTitleInline = document.getElementById("btnEditTitleInline");
const currentScoreHeading = document.getElementById("currentScoreHeading");

// Rename Modal DOM Elements
const renameModal = document.getElementById("renameModal");
const renameInput = document.getElementById("renameInput");
const btnCancelRename = document.getElementById("btnCancelRename");
const btnSaveRename = document.getElementById("btnSaveRename");

let currentActiveScore = null; // Currently loaded score record { id, title, musicxml, metadata, bpm }
let scorePendingRenameId = null;

// 1. Drag & Drop & Upload Handling
dropzone.addEventListener("click", () => fileInput.click());

dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("drag-over");
});

dropzone.addEventListener("dragleave", () => {
  dropzone.classList.remove("drag-over");
});

dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("drag-over");
  if (e.dataTransfer.files.length > 0) {
    handleFileUpload(e.dataTransfer.files[0]);
  }
});

fileInput.addEventListener("change", () => {
  if (fileInput.files.length > 0) {
    handleFileUpload(fileInput.files[0]);
  }
});

// Quick Sample Buttons
document.querySelectorAll(".sample-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    const sampleName = chip.getAttribute("data-sample");
    loadSampleScore(sampleName);
  });
});

async function handleFileUpload(file) {
  const formData = new FormData();
  formData.append("file", file);

  showProgressCard(`Uploading ${file.name}...`);

  try {
    const res = await fetch("/api/omr/upload", {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Upload failed");
    }
    const data = await res.json();
    startJobMonitoring(data.job_id);
  } catch (err) {
    showError(err.message);
  }
}

async function loadSampleScore(sampleName) {
  showProgressCard(`Loading sample ${sampleName}...`);
  try {
    const res = await fetch(`/api/omr/sample/${sampleName}`, { method: "POST" });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Sample load failed");
    }
    const data = await res.json();
    startJobMonitoring(data.job_id);
  } catch (err) {
    showError(err.message);
  }
}

// 2. Asynchronous Job Monitoring Loop
function startJobMonitoring(jobId) {
  currentJobId = jobId;
  jobStartTime = Date.now();

  if (elapsedTimer) clearInterval(elapsedTimer);
  elapsedTimer = setInterval(updateElapsedTime, 1000);

  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => pollJobStatus(jobId), 450);
}

async function pollJobStatus(jobId) {
  try {
    const res = await fetch(`/api/omr/jobs/${jobId}`);
    if (!res.ok) return;

    const job = await res.json();

    // Smooth progress update
    const pct = Math.max(0, Math.min(100, job.progress || 0));
    progressBarFill.style.width = `${pct}%`;
    progressPct.textContent = `${pct}%`;
    progressStage.textContent = job.stage || "Processing...";

    if (job.status === "completed") {
      clearInterval(pollTimer);
      clearInterval(elapsedTimer);
      progressBarFill.style.width = "100%";
      progressPct.textContent = "100%";

      setTimeout(() => {
        renderCompletedJob(job);
      }, 500);
    } else if (job.status === "failed") {
      clearInterval(pollTimer);
      clearInterval(elapsedTimer);
      showError(job.error || "OMR processing failed");
    }
  } catch (e) {
    console.warn("Polling error:", e);
  }
}

function updateElapsedTime() {
  const elapsedSec = Math.floor((Date.now() - jobStartTime) / 1000);
  const m = Math.floor(elapsedSec / 60);
  const s = elapsedSec % 60;
  elapsedTime.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function showProgressCard(title) {
  uploadSection.classList.add("hidden");
  resultSection.classList.add("hidden");
  progressCard.classList.remove("hidden");

  progressTitle.textContent = title;
  progressBarFill.style.width = "0%";
  progressPct.textContent = "0%";
  progressStage.textContent = "Connecting to local pipeline...";
  elapsedTime.textContent = "00:00";
}

function showError(msg) {
  progressTitle.textContent = "Processing Error";
  progressStage.textContent = msg;
  progressStage.style.color = "var(--rose)";
  progressPct.textContent = "!";
}

// 3. Render Transcribed Results & OpenSheetMusicDisplay
async function renderCompletedJob(job) {
  progressCard.classList.add("hidden");
  resultSection.classList.remove("hidden");

  const meta = (job.result && job.result.metadata) || {};
  const songTitle = meta.title || "Untitled Score";
  metaTitle.textContent = songTitle;
  currentScoreHeading.textContent = songTitle;

  // Key Signature display
  const fifths = meta.key_fifths || 0;
  let keyText = "C Major";
  if (fifths > 0) keyText = `${fifths}# (${fifths === 1 ? 'G' : fifths === 2 ? 'D' : 'A'} Maj)`;
  else if (fifths < 0) keyText = `${Math.abs(fifths)}b (${fifths === -1 ? 'F' : 'Bb'} Maj)`;
  metaKey.textContent = keyText;

  metaTime.textContent = meta.time_signature || "4/4";
  metaClef.textContent = meta.clef || "G2";
  metaNotes.textContent = `${meta.total_notes || 0} Notes (${meta.measures || 0} Bars)`;

  // Reset & setup instrument selector
  if (instrumentSelect) {
    instrumentSelect.value = "piano";
  }

  // Setup Download Links with instrument parameter
  updateAudioAndDownloadUrls("piano");

  playIcon.innerHTML = '<path d="M8 5v14l11-7z"/>';
  timelineFill.style.width = "0%";
  audioCurrentTime.textContent = "00:00";

  // Set BPM for cursor mapping
  currentScoreBpm = meta.bpm || 116;

  // Auto-save into IndexedDB collection
  try {
    const savedRecord = await window.collectionStore.saveScore({
      id: "job_" + job.job_id,
      title: songTitle,
      metadata: meta,
      musicxml: job.result.musicxml,
      bpm: currentScoreBpm,
      previewAudioUrl: `/api/omr/jobs/${job.job_id}/audio.wav?instrument=piano`
    });
    currentActiveScore = savedRecord;
    refreshCollectionBadge();
  } catch (err) {
    console.warn("Auto-save to collection error:", err);
  }

  // Render MusicXML using OpenSheetMusicDisplay
  renderMusicXml(job.result.musicxml);
}

let currentScoreBpm = 116;
let cursorTimestamps = [];
let currentCursorIndex = 0;

function buildCursorMap(bpm) {
  cursorTimestamps = [];
  currentCursorIndex = 0;
  if (!osmd || !osmd.cursor) return;

  try {
    osmd.cursor.reset();
    const secPerWholeNote = 240 / (bpm || 116);
    let stepCount = 0;
    const maxSteps = 4000; // Safeguard against circular or infinite staff iterations
    
    while (!osmd.cursor.iterator.EndReached && stepCount < maxSteps) {
      if (osmd.cursor.iterator.currentTimeStamp) {
        const ts = osmd.cursor.iterator.currentTimeStamp.RealValue;
        cursorTimestamps.push(ts * secPerWholeNote);
      }
      osmd.cursor.next();
      stepCount++;
    }
    osmd.cursor.reset();
    osmd.cursor.show();
  } catch (err) {
    console.warn("Cursor mapping error:", err);
  }
}

function updateCursorPosition(currentTime) {
  if (!osmd || !osmd.cursor || cursorTimestamps.length === 0) return;

  let targetIdx = 0;
  for (let i = 0; i < cursorTimestamps.length; i++) {
    if (cursorTimestamps[i] <= currentTime) {
      targetIdx = i;
    } else {
      break;
    }
  }

  if (targetIdx === currentCursorIndex) return;

  try {
    if (targetIdx > currentCursorIndex) {
      while (currentCursorIndex < targetIdx && !osmd.cursor.iterator.EndReached) {
        osmd.cursor.next();
        currentCursorIndex++;
      }
    } else {
      osmd.cursor.reset();
      currentCursorIndex = 0;
      while (currentCursorIndex < targetIdx && !osmd.cursor.iterator.EndReached) {
        osmd.cursor.next();
        currentCursorIndex++;
      }
    }
  } catch (e) {
    console.warn("Cursor step error:", e);
  }
}

function renderMusicXml(musicxmlStr) {
  const container = document.getElementById("osmd-container");
  container.innerHTML = "";

  try {
    osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay("osmd-container", {
      autoResize: true,
      backend: "svg",
      drawTitle: true,
      drawComposer: false,
      drawCredits: false,
      drawPartNames: false,
    });

    currentZoom = 1.0;
    osmd.zoom = currentZoom;

    osmd.load(musicxmlStr)
      .then(() => {
        try {
          osmd.render();
          if (osmd.cursor) {
            osmd.cursor.show();
            osmd.cursor.reset();
            buildCursorMap(currentScoreBpm);
          }
        } catch (renderErr) {
          console.warn("Primary OSMD render failed, attempting relaxed fallback render:", renderErr);
          // Relax layout rules
          osmd.EngravingRules.NewSystemAtXMLNewSystemAttribute = false;
          osmd.EngravingRules.NewPageAtXMLNewPageAttribute = false;
          osmd.render();
        }
      })
      .catch((loadErr) => {
        console.error("OSMD load rejected:", loadErr);
        container.innerHTML = `<p style="color: #64748b; padding: 2rem;">Sheet preview could not be displayed (${loadErr.message || 'Parser Error'}). Download links are available above.</p>`;
      });
  } catch (e) {
    console.error("OSMD initialization error:", e);
    container.innerHTML = `<p style="color: #64748b; padding: 2rem;">MusicXML ready. Download available below.</p>`;
  }
}

// 4. Zoom Controls for Sheet Music
zoomInBtn.addEventListener("click", () => {
  if (osmd && currentZoom < 1.8) {
    currentZoom += 0.15;
    osmd.zoom = currentZoom;
    osmd.render();
    if (osmd.cursor) {
      osmd.cursor.update();
      updateCursorPosition(audioElement.currentTime || 0);
    }
  }
});

zoomOutBtn.addEventListener("click", () => {
  if (osmd && currentZoom > 0.5) {
    currentZoom -= 0.15;
    osmd.zoom = currentZoom;
    osmd.render();
    if (osmd.cursor) {
      osmd.cursor.update();
      updateCursorPosition(audioElement.currentTime || 0);
    }
  }
});

zoomResetBtn.addEventListener("click", () => {
  if (osmd) {
    currentZoom = 1.0;
    osmd.zoom = currentZoom;
    osmd.render();
    if (osmd.cursor) {
      osmd.cursor.update();
      updateCursorPosition(audioElement.currentTime || 0);
    }
  }
});

// 5. Audio Player Controls
playBtn.addEventListener("click", () => {
  if (audioElement.paused) {
    audioElement.play().then(() => {
      playIcon.innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
      if (osmd && osmd.cursor) {
        osmd.cursor.show();
      }
    }).catch(err => {
      console.warn("Audio play error:", err);
    });
  } else {
    audioElement.pause();
    playIcon.innerHTML = '<path d="M8 5v14l11-7z"/>';
  }
});

audioElement.addEventListener("loadedmetadata", () => {
  audioTotalTime.textContent = formatSec(audioElement.duration);
});

audioElement.addEventListener("timeupdate", () => {
  if (!isNaN(audioElement.duration) && audioElement.duration > 0) {
    const pct = (audioElement.currentTime / audioElement.duration) * 100;
    timelineFill.style.width = `${pct}%`;
    audioCurrentTime.textContent = formatSec(audioElement.currentTime);
    updateCursorPosition(audioElement.currentTime);
  }
});

audioElement.addEventListener("seeked", () => {
  updateCursorPosition(audioElement.currentTime);
});

audioElement.addEventListener("ended", () => {
  playIcon.innerHTML = '<path d="M8 5v14l11-7z"/>';
  timelineFill.style.width = "0%";
  audioCurrentTime.textContent = "00:00";
  if (osmd && osmd.cursor) {
    osmd.cursor.reset();
    currentCursorIndex = 0;
  }
});

timelineTrack.addEventListener("click", (e) => {
  const rect = timelineTrack.getBoundingClientRect();
  const ratio = (e.clientX - rect.left) / rect.width;
  if (!isNaN(audioElement.duration)) {
    audioElement.currentTime = ratio * audioElement.duration;
    updateCursorPosition(audioElement.currentTime);
  }
});

function formatSec(sec) {
  if (isNaN(sec)) return "00:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// Upload Another Action
btnUploadAnother.addEventListener("click", () => {
  audioElement.pause();
  resultSection.classList.add("hidden");
  uploadSection.classList.remove("hidden");
  fileInput.value = "";
});

// Update audio and download links when instrument changes
function updateAudioAndDownloadUrls(instrument) {
  if (!currentJobId) return;
  const wavUrl = `/api/omr/jobs/${currentJobId}/audio.wav?instrument=${instrument}`;
  const midUrl = `/api/omr/jobs/${currentJobId}/audio.mid?instrument=${instrument}`;
  const xmlUrl = `/api/omr/jobs/${currentJobId}/musicxml`;

  btnDownloadWav.href = wavUrl;
  btnDownloadMid.href = midUrl;
  btnDownloadXml.href = xmlUrl;

  const wasPlaying = !audioElement.paused;
  const prevTime = audioElement.currentTime || 0;

  audioElement.src = wavUrl;
  audioElement.load();

  if (prevTime > 0 || wasPlaying) {
    const restorePlayback = () => {
      audioElement.currentTime = prevTime;
      if (wasPlaying) {
        audioElement.play().catch(() => {});
      }
      audioElement.removeEventListener("loadeddata", restorePlayback);
    };
    audioElement.addEventListener("loadeddata", restorePlayback);
  }
}

// 5. Instrument Selection Change Listener
if (instrumentSelect) {
  instrumentSelect.addEventListener("change", (e) => {
    const selectedInst = e.target.value;
    updateAudioAndDownloadUrls(selectedInst);
  });
}

// 6. Local Score Library & IndexedDB Collection Management
async function refreshCollectionBadge() {
  try {
    const scores = await window.collectionStore.getAllScores();
    if (collectionCountBadge) {
      collectionCountBadge.textContent = scores.length;
    }
  } catch (e) {
    console.warn("Badge refresh error:", e);
  }
}

async function renderCollectionDrawer(filterText = "") {
  if (!collectionList) return;
  collectionList.innerHTML = "";

  try {
    let scores = await window.collectionStore.getAllScores();
    if (filterText) {
      const q = filterText.toLowerCase();
      scores = scores.filter(s => (s.title || "").toLowerCase().includes(q));
    }

    if (scores.length === 0) {
      collectionList.innerHTML = `<div class="collection-empty">${filterText ? "No songs matched your search." : "No saved songs yet. Analyze a score or import a collection backup!"}</div>`;
      return;
    }

    scores.forEach((s) => {
      const itemEl = document.createElement("div");
      itemEl.className = "collection-item" + (currentActiveScore && currentActiveScore.id === s.id ? " active-score" : "");
      
      const meta = s.metadata || {};
      const noteCount = meta.total_notes || "—";
      const bars = meta.measures ? `${meta.measures} bars` : "";
      const dateStr = s.createdAt ? new Date(s.createdAt).toLocaleDateString() : "";

      itemEl.innerHTML = `
        <div class="item-top-row">
          <div class="item-title">${escapeHtml(s.title || "Untitled")}</div>
          <div class="item-actions">
            <button class="btn-icon-item btn-item-rename" title="Rename" data-id="${s.id}">
              <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
            </button>
            <button class="btn-icon-item btn-delete btn-item-delete" title="Delete" data-id="${s.id}">
              <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
          </div>
        </div>
        <div class="item-meta-row">
          <span class="item-badge">${noteCount} notes</span>
          ${bars ? `<span class="item-badge">${bars}</span>` : ""}
          <span style="margin-left: auto;">${dateStr}</span>
        </div>
      `;

      // Click to load score into player and sheet view
      itemEl.addEventListener("click", (e) => {
        if (e.target.closest(".item-actions")) return; // ignore button clicks
        loadScoreFromCollection(s);
        closeCollectionDrawer();
      });

      // Rename button
      const renameBtn = itemEl.querySelector(".btn-item-rename");
      renameBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openRenameModal(s.id, s.title);
      });

      // Delete button
      const deleteBtn = itemEl.querySelector(".btn-item-delete");
      deleteBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (confirm(`Delete "${s.title}" from your library?`)) {
          await window.collectionStore.deleteScore(s.id);
          if (currentActiveScore && currentActiveScore.id === s.id) {
            currentActiveScore = null;
          }
          refreshCollectionBadge();
          renderCollectionDrawer(collectionSearchInput.value);
        }
      });

      collectionList.appendChild(itemEl);
    });
  } catch (err) {
    console.error("Render collection error:", err);
  }
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Load a saved score directly from IndexedDB without server transcription
function loadScoreFromCollection(scoreRecord) {
  currentActiveScore = scoreRecord;
  currentJobId = scoreRecord.id.startsWith("job_") ? scoreRecord.id.replace("job_", "") : null;

  uploadSection.classList.add("hidden");
  progressCard.classList.add("hidden");
  resultSection.classList.remove("hidden");

  const meta = scoreRecord.metadata || {};
  metaTitle.textContent = scoreRecord.title || "Untitled";
  currentScoreHeading.textContent = scoreRecord.title || "Transcribed Music Sheet";

  // Key Signature display
  const fifths = meta.key_fifths || 0;
  let keyText = "C Major";
  if (fifths > 0) keyText = `${fifths}# (${fifths === 1 ? 'G' : fifths === 2 ? 'D' : 'A'} Maj)`;
  else if (fifths < 0) keyText = `${Math.abs(fifths)}b (${fifths === -1 ? 'F' : 'Bb'} Maj)`;
  metaKey.textContent = keyText;

  metaTime.textContent = meta.time_signature || "4/4";
  metaClef.textContent = meta.clef || "G2";
  metaNotes.textContent = `${meta.total_notes || 0} Notes (${meta.measures || 0} Bars)`;

  if (instrumentSelect) {
    instrumentSelect.value = "piano";
  }

  // Set audio sources
  if (currentJobId) {
    updateAudioAndDownloadUrls("piano");
  } else {
    // Score imported or cached without server job: create data blob URL for MusicXML download
    const xmlBlob = new Blob([scoreRecord.musicxml], { type: "application/vnd.recordare.musicxml+xml" });
    btnDownloadXml.href = URL.createObjectURL(xmlBlob);
    btnDownloadWav.removeAttribute("href");
    btnDownloadMid.removeAttribute("href");
  }

  playIcon.innerHTML = '<path d="M8 5v14l11-7z"/>';
  timelineFill.style.width = "0%";
  audioCurrentTime.textContent = "00:00";

  currentScoreBpm = scoreRecord.bpm || meta.bpm || 116;

  renderMusicXml(scoreRecord.musicxml);
}

// Drawer Controls
function openCollectionDrawer() {
  collectionOverlay.classList.remove("hidden");
  renderCollectionDrawer(collectionSearchInput.value);
}

function closeCollectionDrawer() {
  collectionOverlay.classList.add("hidden");
}

if (btnToggleCollection) {
  btnToggleCollection.addEventListener("click", openCollectionDrawer);
}

if (btnCloseDrawer) {
  btnCloseDrawer.addEventListener("click", closeCollectionDrawer);
}

if (collectionOverlay) {
  collectionOverlay.addEventListener("click", (e) => {
    if (e.target === collectionOverlay) {
      closeCollectionDrawer();
    }
  });
}

if (collectionSearchInput) {
  collectionSearchInput.addEventListener("input", (e) => {
    renderCollectionDrawer(e.target.value);
  });
}

// Rename Modal Handling
function openRenameModal(scoreId, currentTitle) {
  scorePendingRenameId = scoreId;
  renameInput.value = currentTitle || "";
  renameModal.classList.remove("hidden");
  setTimeout(() => renameInput.focus(), 50);
}

function closeRenameModal() {
  renameModal.classList.add("hidden");
  scorePendingRenameId = null;
}

if (btnCancelRename) {
  btnCancelRename.addEventListener("click", closeRenameModal);
}

if (btnSaveRename) {
  btnSaveRename.addEventListener("click", async () => {
    if (!scorePendingRenameId) return;
    const newTitle = renameInput.value.trim() || "Untitled";
    await window.collectionStore.updateTitle(scorePendingRenameId, newTitle);
    
    // If renaming current score, update UI headers
    if (currentActiveScore && currentActiveScore.id === scorePendingRenameId) {
      currentActiveScore.title = newTitle;
      metaTitle.textContent = newTitle;
      currentScoreHeading.textContent = newTitle;
    }
    
    closeRenameModal();
    renderCollectionDrawer(collectionSearchInput.value);
  });
}

// Inline Rename button from sheet viewer header
if (btnEditTitleInline) {
  btnEditTitleInline.addEventListener("click", () => {
    if (currentActiveScore) {
      openRenameModal(currentActiveScore.id, currentActiveScore.title);
    }
  });
}

// Export Collection to Versioned JSON
if (btnExportCollection) {
  btnExportCollection.addEventListener("click", async () => {
    try {
      const jsonStr = await window.collectionStore.exportCollectionJson();
      const blob = new Blob([jsonStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `music_collection_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert("Export failed: " + err.message);
    }
  });
}

// Import Collection from JSON (Backward compatible)
if (importJsonInput) {
  importJsonInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const count = await window.collectionStore.importCollectionJson(text);
      alert(`Successfully imported ${count} song(s) into your library!`);
      refreshCollectionBadge();
      renderCollectionDrawer(collectionSearchInput.value);
    } catch (err) {
      alert("Import failed: " + err.message);
    } finally {
      importJsonInput.value = "";
    }
  });
}

// Initial library badge sync
refreshCollectionBadge();
