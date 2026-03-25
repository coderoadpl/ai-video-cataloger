# AI Video Cataloger

A tool that automatically analyzes, transcribes, and renames video files using AI. Available as both a **graphical desktop app** (Electron) and a **command-line interface**.

## What It Does

1. **Extracts frames** from videos using FFmpeg
2. **Transcribes audio** using local Whisper (whisper.cpp)
3. **Analyzes content** with Claude Code CLI, Claude API, or LLaVA via Ollama (local)
4. **Renames files** with descriptive, date-prefixed names

## Quick Start - GUI (Recommended)

The graphical interface is the easiest way to use AI Video Cataloger. It bundles FFmpeg and whisper.cpp, so you only need Ollama for fully local AI analysis.

### Launch the GUI (Development Mode)

```bash
npm install
npm run electron:dev
```

### Build Standalone App

```bash
npm run electron:package
```

This creates a packaged `.app` (macOS) in the `dist-electron/` directory.

### GUI Features

- **First Launch Setup Wizard** - Guided configuration on first run
- **Folder Browser** - Select folders and view video files with thumbnails
- **Video Analysis** - Single or batch processing with progress indicators
- **Model Managers** - Download Whisper models and manage LLaVA models via Ollama
- **Settings Panel** - Configure analysis method, transcription options, and more
- **Prerequisites Check** - See status of all dependencies at a glance
- **Native macOS Integration** - Standard menus, keyboard shortcuts (Cmd+O, Cmd+,)

### GUI Prerequisites

The app supports three analysis methods (at least one required):
- **Claude Code CLI** (recommended): Install with `npm install -g @anthropic-ai/claude-code`
- **Claude API**: Set `ANTHROPIC_API_KEY` environment variable
- **Ollama** (local): Install from [ollama.com](https://ollama.com) for fully offline analysis

FFmpeg and whisper.cpp are bundled with the app.

---

## Command-Line Interface (CLI)

For scripting or headless environments, the CLI provides the same functionality.

### CLI Prerequisites

Install these tools before using the CLI:

```bash
# FFmpeg - video processing
brew install ffmpeg          # macOS
apt install ffmpeg           # Ubuntu

# Whisper - speech-to-text
pip install openai-whisper

# Claude Code CLI - AI analysis
npm install -g @anthropic-ai/claude-code
```

### CLI Installation

```bash
npm install
npm run build
npm link  # optional: install globally
```

### CLI Usage

```bash
# Process videos in current directory
ai-video-cataloger

# Process videos in a specific directory
ai-video-cataloger /path/to/videos

# Options
ai-video-cataloger [directory] [options]
  -f, --frames <number>    Number of frames to extract (default: 3)
  -s, --skip-rename        Generate summaries only, don't rename files
  -v, --verbose            Show detailed output
  -r, --retry-errors       Re-process previously failed videos
```

### CLI Example

```bash
$ ai-video-cataloger ~/Downloads/videos

Scanning for videos in: /Users/me/Downloads/videos
Found 2 video file(s)

[1/2] Extracting frames - meeting-recording.mp4
[1/2] Extracting audio - meeting-recording.mp4
[1/2] Transcribing audio - meeting-recording.mp4
[1/2] Analyzing with Claude - meeting-recording.mp4
[1/2] Renaming video - meeting-recording.mp4
Renamed: meeting-recording.mp4 → 2024-01-23_quarterly-planning-discussion.mp4

[2/2] ...

✓ 2 videos processed successfully
```

## Output Structure

After processing, you'll find:

```
your-videos/
├── 2024-01-23_descriptive-name.mp4     # Renamed video
├── frames/
│   └── descriptive-name/
│       ├── frame-001.jpg
│       ├── frame-002.jpg
│       └── frame-003.jpg
├── transcripts/
│   └── descriptive-name.txt            # Audio transcription
├── summaries/
│   └── descriptive-name.txt            # AI-generated summary
└── .ai-video-cataloger/
    └── catalog.db                      # SQLite progress database
```

## Features

- **Resumable**: Interrupted processing picks up where it left off
- **Error recovery**: Use `--retry-errors` to reprocess failed videos
- **Batch processing**: Handles multiple videos in one run
- **Conflict resolution**: Auto-increments filenames if duplicates exist

## Supported Formats

MP4, MOV, AVI, MKV, WebM
