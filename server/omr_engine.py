"""
OMR Asynchronous Engine & Job Manager
--------------------------------------
Handles:
- PDF-to-Image conversion using pypdfium2 (zero external dependencies).
- Background threaded OMR processing with real-time progress tracking.
- Output serialization and audio synthesis.
"""

import os
import sys
import uuid
import time
import shutil
import subprocess
import threading
from typing import Dict, Any, Optional
import pypdfium2 as pdfium

from server.synthesizer import parse_musicxml, synthesize_wav, generate_midi

# Global in-memory job registry
JOBS: Dict[str, Dict[str, Any]] = {}

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
JOBS_DIR = os.path.join(BASE_DIR, "storage", "jobs")
os.makedirs(JOBS_DIR, exist_ok=True)

# Locate homr executable robustly
HOMR_EXE = shutil.which("homr")
if not HOMR_EXE:
    candidate_paths = [
        os.path.join(sys.prefix, "Scripts", "homr.exe"),
        os.path.join(sys.prefix, "bin", "homr"),
        os.path.join(BASE_DIR, ".venv_omr_spike", "Scripts", "homr.exe"),
        os.path.join(BASE_DIR, ".venv", "Scripts", "homr.exe"),
    ]
    for p in candidate_paths:
        if os.path.exists(p):
            HOMR_EXE = p
            break
    if not HOMR_EXE:
        HOMR_EXE = "homr"


def convert_pdf_to_image(pdf_path: str, output_img_path: str, page_index: int = 0) -> str:
    """Converts a PDF page into a high-resolution 300-DPI PNG image."""
    pdf = pdfium.PdfDocument(pdf_path)
    if len(pdf) <= page_index:
        raise ValueError(f"PDF only has {len(pdf)} pages, cannot access page {page_index}")
    page = pdf[page_index]
    # Scale 2.5 produces crisp ~1800x2400 rendering ideal for OMR
    image = page.render(scale=2.5).to_pil()
    image.save(output_img_path, format="PNG")
    return output_img_path


def create_job(original_filename: str) -> str:
    """Allocates a new job ID and creates its working directory."""
    job_id = str(uuid.uuid4())
    job_folder = os.path.join(JOBS_DIR, job_id)
    os.makedirs(job_folder, exist_ok=True)

    JOBS[job_id] = {
        "job_id": job_id,
        "filename": original_filename,
        "status": "pending",
        "progress": 0,
        "stage": "Job created. Waiting to start...",
        "created_at": time.time(),
        "folder": job_folder,
        "result": None,
        "error": None
    }
    return job_id


def run_omr_pipeline_worker(job_id: str, uploaded_filepath: str):
    """Worker function executing in a background thread."""
    job = JOBS[job_id]
    job["status"] = "processing"
    job_folder = job["folder"]

    try:
        # Step 1: Format validation & PDF handling
        job["progress"] = 8
        job["stage"] = "Analyzing file format..."

        ext = os.path.splitext(uploaded_filepath)[1].lower()
        if ext == ".pdf":
            job["stage"] = "Rendering PDF page to high-res sheet image..."
            target_image = os.path.join(job_folder, "page_0.png")
            convert_pdf_to_image(uploaded_filepath, target_image)
            working_image = target_image
        else:
            working_image = uploaded_filepath

        job["progress"] = 18
        job["stage"] = "Starting neural segmentation (staff lines & notes)..."

        # Step 2: Spawn homr process and capture output lines in real time
        cmd = [HOMR_EXE, working_image]
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            cwd=job_folder
        )

        total_staves = 4
        current_staff = 0

        for line in iter(proc.stdout.readline, ""):
            line_str = line.strip()
            if not line_str:
                continue

            if "Segnet Inference time" in line_str:
                job["progress"] = 35
                job["stage"] = "Segmenting symbols, clefs, and noteheads..."

            elif "Found" in line_str and "staffs" in line_str:
                try:
                    parts = line_str.split("Found")[1].split("staffs")[0].strip()
                    total_staves = max(1, int(parts))
                except Exception:
                    pass
                job["progress"] = 45
                job["stage"] = f"Identified {total_staves} staff systems. Dewarping..."

            elif "Dewarping staff" in line_str and "done" not in line_str:
                try:
                    current_staff = int(line_str.split("staff")[1].strip())
                except Exception:
                    pass
                pct = 45 + int(38 * (current_staff / max(1, total_staves)))
                job["progress"] = min(82, pct)
                job["stage"] = f"Dewarping staff {current_staff + 1} of {total_staves}..."

            elif "Running TrOmr inference" in line_str:
                try:
                    current_staff = int(line_str.split("image")[1].strip())
                except Exception:
                    pass
                pct = 50 + int(35 * ((current_staff + 0.5) / max(1, total_staves)))
                job["progress"] = min(85, pct)
                job["stage"] = f"Transformer transcribing notes on staff {current_staff + 1}/{total_staves}..."

            elif "Writing XML" in line_str:
                job["progress"] = 88
                job["stage"] = "Assembling musical syntax and measures..."

        proc.wait()

        # Step 3: Locate generated MusicXML
        # homr outputs {basename}.musicxml in the image's directory
        expected_xml = os.path.splitext(working_image)[0] + ".musicxml"
        if not os.path.exists(expected_xml):
            # Fallback search in working folder
            xml_files = [f for f in os.listdir(job_folder) if f.endswith(".musicxml")]
            if xml_files:
                expected_xml = os.path.join(job_folder, xml_files[0])
            else:
                raise RuntimeError("OMR engine finished but no MusicXML file was produced.")

        # Standardize location
        final_xml = os.path.join(job_folder, "score.musicxml")
        shutil.copyfile(expected_xml, final_xml)

        # Step 4: Synthesize Audio (WAV & MIDI)
        job["progress"] = 92
        job["stage"] = "Synthesizing polyphonic audio & MIDI..."

        events, metadata = parse_musicxml(final_xml)
        final_wav = os.path.join(job_folder, "score.wav")
        final_mid = os.path.join(job_folder, "score.mid")

        synthesize_wav(events, final_wav, instrument="piano")
        shutil.copyfile(final_wav, os.path.join(job_folder, "score_piano.wav"))
        generate_midi(events, final_mid, instrument="piano", default_bpm=metadata.get("bpm", 116))

        with open(final_xml, "r", encoding="utf-8") as f:
            xml_content = f.read()

        job["progress"] = 100
        job["stage"] = "Complete! Ready to play."
        job["status"] = "completed"
        job["result"] = {
            "metadata": metadata,
            "musicxml": xml_content,
            "has_audio": os.path.exists(final_wav),
            "has_midi": os.path.exists(final_mid),
            "elapsed_seconds": round(time.time() - job["created_at"], 1)
        }

    except Exception as e:
        job["status"] = "failed"
        job["error"] = str(e)
        job["stage"] = f"Failed: {str(e)}"
        print(f"[Error] Job {job_id} failed: {e}", file=sys.stderr)


def start_job_async(job_id: str, uploaded_filepath: str):
    """Spawns background worker thread."""
    t = threading.Thread(
        target=run_omr_pipeline_worker,
        args=(job_id, uploaded_filepath),
        daemon=True
    )
    t.start()


def get_job(job_id: str) -> Optional[Dict[str, Any]]:
    """Retrieves job status and metadata from memory or disk cache."""
    if job_id in JOBS:
        return JOBS[job_id]

    job_folder = os.path.join(JOBS_DIR, job_id)
    xml_path = os.path.join(job_folder, "score.musicxml")
    if os.path.exists(xml_path):
        try:
            events, metadata = parse_musicxml(xml_path)
            with open(xml_path, "r", encoding="utf-8") as f:
                xml_content = f.read()

            job = {
                "job_id": job_id,
                "filename": metadata.get("title", "score.musicxml"),
                "status": "completed",
                "progress": 100,
                "stage": "Complete! Ready to play.",
                "created_at": os.path.getctime(xml_path),
                "folder": job_folder,
                "result": {
                    "metadata": metadata,
                    "musicxml": xml_content,
                    "has_audio": True,
                    "has_midi": True,
                    "elapsed_seconds": 0
                },
                "error": None
            }
            JOBS[job_id] = job
            return job
        except Exception:
            pass

    return None
