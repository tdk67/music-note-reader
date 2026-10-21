"""
FastAPI Server for Music Note Reader & OMR Player
-------------------------------------------------
Zero API keys. 100% local OMR and audio synthesis.
Asynchronous job processing with live progress reporting.
"""

import os
import shutil
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import FileResponse, PlainTextResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from server.omr_engine import create_job, start_job_async, get_job, JOBS_DIR, BASE_DIR
from server.synthesizer import parse_musicxml, synthesize_wav, generate_midi

VALID_INSTRUMENTS = [
    "piano", "organ", "strings", "flute", "epiano", "guitar", "music_box", "harpsichord", "trumpet", "chiptune"
]

app = FastAPI(
    title="MusicNoteReader OMR API",
    description="Local Optical Music Recognition and Audio Player API",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

STATIC_DIR = os.path.join(BASE_DIR, "static")
os.makedirs(STATIC_DIR, exist_ok=True)


@app.get("/health")
@app.get("/api/health")
async def health_check():
    """Health check endpoint for Cloud Run and container orchestrators."""
    return {"status": "ok", "service": "MusicNoteReader"}


@app.post("/api/omr/upload")
async def upload_sheet(file: UploadFile = File(...)):
    """Accepts PDF or Image (PNG, JPG), creates job and triggers async OMR pipeline."""
    filename = file.filename or "uploaded_sheet.png"
    ext = os.path.splitext(filename)[1].lower()

    if ext not in [".png", ".jpg", ".jpeg", ".pdf", ".webp"]:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file format '{ext}'. Please upload PNG, JPG, or PDF."
        )

    job_id = create_job(filename)
    job_folder = os.path.join(JOBS_DIR, job_id)
    save_path = os.path.join(job_folder, f"input{ext}")

    with open(save_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    start_job_async(job_id, save_path)

    return {
        "job_id": job_id,
        "filename": filename,
        "status": "processing",
        "message": "Upload received. Processing started."
    }




@app.post("/api/omr/sample/{sample_name}")
async def load_sample_score(sample_name: str):
    """Loads a pre-existing sample score (e.g. 'all_you_that', 'song01' or 'sample_sheet')."""
    sample_map = {
        "all_you_that": os.path.join(BASE_DIR, "samples", "all_you_that_in_this_house.png"),
        "song01": os.path.join(BASE_DIR, "samples", "song01.png"),
        "sample_sheet": os.path.join(BASE_DIR, "samples", "sample_sheet.png")
    }

    src = sample_map.get(sample_name)
    if not src or not os.path.exists(src):
        raise HTTPException(status_code=404, detail=f"Sample '{sample_name}' not found.")

    filename = os.path.basename(src)
    job_id = create_job(filename)
    job_folder = os.path.join(JOBS_DIR, job_id)
    dst = os.path.join(job_folder, filename)
    shutil.copyfile(src, dst)

    start_job_async(job_id, dst)

    return {
        "job_id": job_id,
        "filename": filename,
        "status": "processing",
        "message": f"Sample '{sample_name}' queued for processing."
    }


@app.get("/api/omr/jobs/{job_id}")
async def get_job_status(job_id: str):
    """Returns real-time progress percentage (0-100), stage description, and result."""
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    return {
        "job_id": job["job_id"],
        "filename": job["filename"],
        "status": job["status"],
        "progress": job["progress"],
        "stage": job["stage"],
        "result": job["result"],
        "error": job["error"]
    }


@app.get("/api/omr/jobs/{job_id}/musicxml")
async def get_job_musicxml(job_id: str):
    """Returns raw MusicXML content."""
    job = get_job(job_id)
    if not job or job["status"] != "completed":
        raise HTTPException(status_code=404, detail="Job not completed or not found.")

    xml_path = os.path.join(job["folder"], "score.musicxml")
    if not os.path.exists(xml_path):
        raise HTTPException(status_code=404, detail="MusicXML file missing.")

    return FileResponse(xml_path, media_type="application/xml", filename="score.musicxml")


@app.get("/api/omr/jobs/{job_id}/audio.wav")
async def get_job_wav(job_id: str, instrument: str = "piano"):
    """Streams synthesized WAV audio with the selected instrument timbre."""
    job = get_job(job_id)
    if not job or job["status"] != "completed":
        raise HTTPException(status_code=404, detail="Job not completed.")

    inst = instrument.lower() if instrument.lower() in VALID_INSTRUMENTS else "piano"
    wav_filename = f"score_{inst}.wav"
    wav_path = os.path.join(job["folder"], wav_filename)

    # Synthesize on demand if not yet rendered for this instrument
    if not os.path.exists(wav_path):
        xml_path = os.path.join(job["folder"], "score.musicxml")
        if not os.path.exists(xml_path):
            raise HTTPException(status_code=404, detail="MusicXML source missing.")
        events, _ = parse_musicxml(xml_path)
        synthesize_wav(events, wav_path, instrument=inst)

    return FileResponse(wav_path, media_type="audio/wav", filename=f"score_{inst}.wav")


@app.get("/api/omr/jobs/{job_id}/audio.mid")
async def get_job_midi(job_id: str, instrument: str = "piano"):
    """Streams standard MIDI file with the selected instrument program."""
    job = get_job(job_id)
    if not job or job["status"] != "completed":
        raise HTTPException(status_code=404, detail="Job not completed.")

    inst = instrument.lower() if instrument.lower() in VALID_INSTRUMENTS else "piano"
    mid_filename = f"score_{inst}.mid" if inst != "piano" else "score.mid"
    mid_path = os.path.join(job["folder"], mid_filename)

    if not os.path.exists(mid_path):
        xml_path = os.path.join(job["folder"], "score.musicxml")
        if not os.path.exists(xml_path):
            raise HTTPException(status_code=404, detail="MusicXML source missing.")
        events, metadata = parse_musicxml(xml_path)
        generate_midi(events, mid_path, instrument=inst, default_bpm=metadata.get("bpm", 116))

    return FileResponse(mid_path, media_type="audio/midi", filename=f"score_{inst}.mid")


# Mount static directory
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
async def serve_index():
    """Serves the main web player interface."""
    index_file = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    return HTMLResponse("<h1>Music Note Reader — Static UI initializing...</h1>")
