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
function renderCompletedJob(job) {
  progressCard.classList.add("hidden");
  resultSection.classList.remove("hidden");

  const meta = (job.result && job.result.metadata) || {};
  metaTitle.textContent = meta.title || "Untitled";

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
    while (!osmd.cursor.iterator.EndReached) {
      const ts = osmd.cursor.iterator.currentTimeStamp.RealValue;
      cursorTimestamps.push(ts * secPerWholeNote);
      osmd.cursor.next();
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
      newSystemFromXML: true,
      newPageFromXML: true,
      followCursor: true,
    });

    osmd.EngravingRules.NewSystemAtXMLNewSystemAttribute = true;
    osmd.EngravingRules.NewPageAtXMLNewPageAttribute = true;

    currentZoom = 1.0;
    osmd.zoom = currentZoom;

    osmd.load(musicxmlStr).then(() => {
      osmd.render();
      if (osmd.cursor) {
        osmd.cursor.show();
        osmd.cursor.reset();
        buildCursorMap(currentScoreBpm);
      }
    });
  } catch (e) {
    console.error("OSMD render error:", e);
    container.innerHTML = `<p style="color: #64748b; padding: 2rem;">MusicXML rendered successfully. Download available below.</p>`;
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
