# Precision Neural Optical Music Recognition (OMR) & Audio Player

A 100% local, high-precision Optical Music Recognition system, interactive score notation viewer, and audio player. Converts scanned sheet music and PDF documents into editable MusicXML, playable multi-instrument audio (WAV), and Standard MIDI files — with **zero cloud dependencies**, **no external API keys**, and **local-first persistent browser storage**.

![Precision Neural OMR Architecture](samples/all_you_that_in_this_house.png)

---

## Key Features

1. **Precision Neural OMR (TrOMR + SegNet)**
   - Utilizes `homr`'s hybrid SegNet staff/symbol segmentation and Transformer-based End-to-End sequence recognition.
   - Accurately resolves key signatures, time signatures, clefs, notes, accidentals, ties, rests, and measures across multiple staves and voices.

2. **Original Sheet Layout & Vector Score Rendering**
   - High-fidelity interactive vector sheet rendering powered by [OpenSheetMusicDisplay](https://opensheetmusicdisplay.org/) (OSMD), bundled locally without CDN dependencies.
   - Preserves original printed system breaks and line formatting (`<print new-system="yes"/>`).
   - Includes real-time **Playback Cursor Tracking** that visually advances note-by-note with audio playback, plus responsive zoom controls.

3. **Local Browser Song Library (IndexedDB)**
   - **Persistent Offline Collection**: Automatically saves all analyzed songs directly to the browser's IndexedDB (`MusicNoteReaderDB`).
   - **Instant Loading**: Revisit and play any previously scanned song instantly without having to re-upload or re-run OMR transcription.
   - **Song Management**: Rename song titles inline or from the library drawer, search/filter songs by title, and delete scores.
   - **Versioned JSON Backup & Migration**: Export entire song collections to versioned JSON (`schemaVersion: "1.0.0"`) and import with backward-compatible schema migration.

4. **Multi-Instrument Audio Synthesis & Acoustic Tuning**
   - High-quality audio synthesis with realistic acoustic envelope modeling and General MIDI mapping:
     - 🎹 **Grand Piano** (GM 1): Dynamic hammer strike attack and natural exponential harmonic decay.
     - 🎸 **Acoustic Guitar** (GM 25 Steel / GM 24 Nylon): Extended ring sustain (`1.65x`), natural string decay, and tuned velocity curve.
     - 🪈 **Concert Flute** (GM 74): Tuned velocity range (`[45, 88]`) for a warm, lyrical tone without harsh overblown breath noise.
     - ⛪ **Church Organ** (GM 20): Multi-rank pipe harmonic mixture with sustained plenum.
     - 🎻 **String Ensemble** (GM 49): Bowed strings with lush vibrato and warm harmonic spectrum.
     - ⚡ **Electric Piano** (GM 5): Rhodes-style bell-tine attack with warm sustain.
     - ✨ **Music Box / Celesta** (GM 11): Bright inharmonic metallic chimes with ringing decay.
     - 🎼 **Harpsichord** (GM 7): Plucked quill attack with crisp high overtone bite.
     - 🎺 **Trumpet** (GM 57): Expressive brass attack with bright harmonic presence.
     - 👾 **8-Bit Chiptune**: Retro square / pulse wave synthesis.

5. **Multi-Format Input & Async Processing**
   - Supports **PDF documents** (rendered to crisp 300-DPI via `pypdfium2` without external Poppler binaries) and images (**PNG, JPG, WEBP**).
   - Real-time asynchronous progress reporting (0% to 100%) tracking segmentation, dewarping, transformer inference, and synthesis stages.

6. **Cloud-Ready & Containerized Deployment**
   - Dockerized with pre-cached neural network models (`homr --init`).
   - Ready for one-click deployment to **Google Cloud Run** or any Docker/Kubernetes container platform via `deploy-cloudrun.bat` or standard `docker run`.

---

## Project Structure

```text
MusicNoteReader/
├── server/
│   ├── app.py                      # FastAPI application & REST endpoints
│   ├── omr_engine.py               # Asynchronous job worker & PDF rasterization
│   └── synthesizer.py              # Tuned multi-instrument WAV & MIDI synthesizer
├── static/
│   ├── index.html                  # Responsive player UI & slide-over library drawer
│   ├── app.css                     # Glassmorphic dark theme styles & animations
│   ├── app.js                      # Client controller, cursor tracker & player logic
│   ├── collection_store.js         # IndexedDB local storage, CRUD & JSON migration
│   └── js/
│       └── opensheetmusicdisplay.min.js  # Bundled local OSMD vector engine
├── samples/                        # Benchmark and demo sheet music images
│   ├── all_you_that_in_this_house.png
│   ├── song01.png
│   └── sample_sheet.png
├── storage/                        # [Gitignored] Runtime job artifacts (XML, WAV, MIDI)
├── Dockerfile                      # Production container image with pre-warmed models
├── deploy-cloudrun.bat             # Cloud Run build and deployment script
├── requirements.txt                # Python package dependencies
├── OMR-Background.md               # Literature review, OMR theory, and benchmarks
└── README.md                       # Project documentation
```

---

## Installation & Local Setup

### Prerequisites
- Python 3.10 – 3.12
- [uv](https://github.com/astral-sh/uv) (recommended) or standard Python `venv`

### Setup

```bash
# Clone the repository
git clone <repo-url>
cd MusicNoteReader

# Create and activate a virtual environment
uv venv
# On Windows PowerShell:
.venv\Scripts\Activate.ps1
# On Linux / macOS:
source .venv/bin/activate

# Install dependencies
uv pip install -r requirements.txt
```

---

## Running the Application Locally

Start the local server with Uvicorn:

```bash
python -m uvicorn server.app:app --host 127.0.0.1 --port 8080 --reload
```

Open your browser at:
```
http://127.0.0.1:8080
```

---

## Cloud Deployment (Google Cloud Run)

To deploy the service to Google Cloud Run:

1. Ensure Google Cloud SDK (`gcloud`) and Docker are installed and authenticated.
2. Run the deployment script:
   ```cmd
   deploy-cloudrun.bat
   ```
   Or build and deploy manually:
   ```bash
   gcloud builds submit --tag gcr.io/<PROJECT_ID>/music-note-reader
   gcloud run deploy music-note-reader \
     --image gcr.io/<PROJECT_ID>/music-note-reader \
     --platform managed \
     --region europe-west1 \
     --allow-unauthenticated \
     --memory 4Gi \
     --cpu 2 \
     --timeout 300
   ```

---

## API Reference

| Endpoint | Method | Description |
| :--- | :---: | :--- |
| `/api/omr/upload` | `POST` | Uploads a PDF or Image; allocates a background job ID. |
| `/api/omr/sample/{sample_name}` | `POST` | Queues a bundled demo sheet (`all_you_that`, `song01`, `sample_sheet`). |
| `/api/omr/jobs/{job_id}` | `GET` | Polls real-time progress (`progress`, `stage`, `status`, `result`). |
| `/api/omr/jobs/{job_id}/musicxml` | `GET` | Streams the transcribed MusicXML file. |
| `/api/omr/jobs/{job_id}/audio.wav?instrument={inst}` | `GET` | Streams synthesized audio in the selected instrument timbre. |
| `/api/omr/jobs/{job_id}/audio.mid?instrument={inst}` | `GET` | Streams standard Type-0 MIDI with the instrument's GM program. |
| `/health` | `GET` | Health check endpoint for Cloud Run and container orchestrators. |

Supported instruments for `?instrument=`:
`piano` (default), `guitar`, `flute`, `organ`, `strings`, `epiano`, `music_box`, `harpsichord`, `trumpet`, `chiptune`.

---

## Best Practices for Sheet Scans

For the highest recognition accuracy:
- **Keep Pages Flat**: Curved pages in bound books distort staff lines and cause measure bar lines to tilt. Flatten the page gently or use a document scanning tool with curvature flattening.
- **Uniform Lighting**: Avoid harsh shadows across staves.
- **Resolution**: A clear photo (1500–3000px wide) or standard 300-DPI PDF works best.

---

## Background & OMR Methodology

For an in-depth survey of Optical Music Recognition paradigms (traditional pipeline vs. modern deep learning TrOMR models) and benchmark comparisons, consult [OMR-Background.md](OMR-Background.md).
