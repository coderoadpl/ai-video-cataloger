# AI Video Cataloger

CLI tool that automatically analyzes, transcribes, and renames video files using AI.

## What It Does

1. **Extracts frames** from videos using FFmpeg
2. **Transcribes audio** using local Whisper
3. **Analyzes content** with Claude Code CLI
4. **Renames files** with descriptive, date-prefixed names

## Prerequisites

Install these tools before using:

```bash
# FFmpeg - video processing
brew install ffmpeg          # macOS
apt install ffmpeg           # Ubuntu

# Whisper - speech-to-text
pip install openai-whisper

# Claude Code CLI - AI analysis
npm install -g @anthropic-ai/claude-code
```

## Installation

```bash
npm install
npm run build
npm link  # optional: install globally
```

## Usage

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

## Example

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
