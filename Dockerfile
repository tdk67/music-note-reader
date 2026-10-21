# Production Dockerfile for Google Cloud Run
FROM python:3.12-slim-bookworm

# Prevent Python from writing bytecode and buffer stdout/stderr
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

# Install system dependencies for OpenCV, sound processing, and C compilation
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    portaudio19-dev \
    libsndfile1 \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download homr OMR models during build to ensure instant Cloud Run container startup
RUN homr --init

# Copy application source code, static UI, samples, and SoundFont
COPY server/ ./server/
COPY static/ ./static/
COPY samples/ ./samples/

# Ensure jobs storage and soundfonts directories are ready
RUN mkdir -p /app/storage/jobs /app/server/soundfonts

# Expose standard Cloud Run web port
EXPOSE 8080

# Start FastAPI application using Uvicorn listening on Cloud Run's dynamic $PORT
CMD exec uvicorn server.app:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1
