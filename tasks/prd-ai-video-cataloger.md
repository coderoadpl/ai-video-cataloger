# PRD: AI Video Cataloger MVP

## Introduction

A Node.js/TypeScript CLI tool that analyzes videos in a folder, transcribes them using local Whisper, generates summaries via Claude Code CLI, and renames them based on content. The tool supports resumable batch processing with a local SQLite database to track progress, allowing users to interrupt and resume processing at any time.

Target users are developers and power users comfortable with CLI tools who need to organize video collections efficiently.

## Goals

- Scan a directory for video files and process them in batch
- Extract representative frames from each video using ffmpeg
- Transcribe audio using local Whisper (no API dependency)
- Analyze video content using Claude Code CLI with frames + transcript
- Generate summary files and rename videos with descriptive names
- Track progress in SQLite to enable resume after interruption
- Validate all prerequisites (ffmpeg, whisper, claude CLI) before processing

## User Stories

### US-001: Project Setup
**Description:** As a developer, I need the project scaffolded with TypeScript and dependencies so I can start implementing features.

**Acceptance Criteria:**
- [ ] `package.json` with all required dependencies (commander, better-sqlite3, fluent-ffmpeg, execa, chalk, ora, slugify, date-fns)
- [ ] `tsconfig.json` configured for Node.js CLI tool
- [ ] Source directory structure created (`src/`, `src/services/`, `src/db/`, `src/utils/`, `src/types/`)
- [ ] Entry point `src/index.ts` with shebang for CLI execution
- [ ] `npm run build` compiles successfully
- [ ] TypeScript strict mode enabled

### US-002: Check Prerequisites on Startup
**Description:** As a user, I want the tool to verify all dependencies are installed so I get clear error messages if something is missing.

**Acceptance Criteria:**
- [ ] Check for Node.js >= 18.0.0
- [ ] Check for ffmpeg installation
- [ ] Check for Claude Code CLI (`claude` command)
- [ ] Check for local Whisper (`whisper` command)
- [ ] Display green checkmark with version for each found dependency
- [ ] Display red X with install hint for missing dependencies
- [ ] Exit with error code 1 if any required dependency is missing
- [ ] Skip prerequisite checks for `--help` and `--version` flags

### US-003: Initialize SQLite Database
**Description:** As a developer, I need a SQLite database to track video processing progress so the tool can resume after interruption.

**Acceptance Criteria:**
- [ ] Create `.ai-video-cataloger/` hidden directory in working folder
- [ ] Initialize `catalog.db` with `videos` table (id, original_path, original_name, new_name, file_hash, status, timestamps, error_message)
- [ ] Initialize `config` table for storing settings
- [ ] Database created automatically on first run
- [ ] Typecheck passes

### US-004: Scan Directory for Videos
**Description:** As a user, I want to specify a directory and have the tool find all video files so I can process them in batch.

**Acceptance Criteria:**
- [ ] Accept directory path as CLI argument (default: current directory)
- [ ] Find files with extensions: .mp4, .mov, .avi, .mkv, .webm
- [ ] Skip files already in `completed` status in database
- [ ] Display count of videos found
- [ ] Exit gracefully with message if no videos found
- [ ] Typecheck passes

### US-005: Extract Frames from Video
**Description:** As a user, I want frames extracted from each video so Claude can analyze the visual content.

**Acceptance Criteria:**
- [ ] Extract 3 frames evenly distributed across video duration (at 25%, 50%, 75%)
- [ ] Save frames as JPG to `frames/{video-name}/frame-001.jpg`, etc.
- [ ] Create frames directory if it doesn't exist
- [ ] Update video status to `frames_extracted` in database
- [ ] Show spinner/progress during extraction
- [ ] Typecheck passes

### US-006: Extract Audio from Video
**Description:** As a developer, I need to extract the audio track so Whisper can transcribe it.

**Acceptance Criteria:**
- [ ] Extract audio as temporary WAV file using ffmpeg
- [ ] Handle videos with no audio track gracefully (skip transcription)
- [ ] Store temp file path for cleanup later
- [ ] Typecheck passes

### US-007: Transcribe Audio with Local Whisper
**Description:** As a user, I want the audio transcribed so I have a text version of the video content.

**Acceptance Criteria:**
- [ ] Run local `whisper` command with extracted audio
- [ ] Use `base` model by default
- [ ] Save transcript to `transcripts/{video-name}.txt`
- [ ] Create transcripts directory if it doesn't exist
- [ ] Update video status to `transcribed` in database
- [ ] Show spinner/progress during transcription
- [ ] Typecheck passes

### US-008: Analyze Video with Claude Code CLI
**Description:** As a user, I want Claude to analyze the frames and transcript so it can understand the video content.

**Acceptance Criteria:**
- [ ] Call `claude -p` with frames and transcript content
- [ ] Prompt asks for: 2-3 sentence description + suggested filename (3-5 words, kebab-case)
- [ ] Parse Claude's response to extract description and filename suggestion
- [ ] Save full analysis to `summaries/{video-name}.txt`
- [ ] Create summaries directory if it doesn't exist
- [ ] Update video status to `analyzed` in database
- [ ] Typecheck passes

### US-009: Rename Video File
**Description:** As a user, I want videos renamed with descriptive names so I can find them easily later.

**Acceptance Criteria:**
- [ ] Rename format: `YYYY-MM-DD_suggested-slug.ext`
- [ ] Date derived from file modification time
- [ ] Slug from Claude's analysis, sanitized to kebab-case
- [ ] Handle filename conflicts by appending `-2`, `-3`, etc.
- [ ] Update transcript, summary, and frames folder names to match
- [ ] Update video status to `completed` in database
- [ ] Store new name in database for reference
- [ ] Typecheck passes

### US-010: Resume Interrupted Processing
**Description:** As a user, I want to resume processing after an interruption so I don't have to start over.

**Acceptance Criteria:**
- [ ] On startup, query database for videos not in `completed` or `error` status
- [ ] Resume each video from its last successful step
- [ ] Skip videos that are already `completed`
- [ ] Display count of videos to resume vs. new videos
- [ ] Typecheck passes

### US-011: Basic CLI Interface
**Description:** As a user, I want a simple CLI interface to run the tool with common options.

**Acceptance Criteria:**
- [ ] `ai-video-cataloger [directory]` - process videos in directory
- [ ] `--frames <n>` - number of frames to extract (default: 3)
- [ ] `--skip-rename` - only generate summaries, don't rename
- [ ] `--verbose` - show detailed output
- [ ] `--help` - show usage information
- [ ] `--version` - show version number
- [ ] Typecheck passes

### US-012: Progress Display During Processing
**Description:** As a user, I want to see progress while videos are being processed so I know the tool is working.

**Acceptance Criteria:**
- [ ] Show current video being processed (X of Y)
- [ ] Show current step (extracting frames, transcribing, analyzing, renaming)
- [ ] Use ora spinners for long-running operations
- [ ] Display summary at end (X videos processed, Y errors)
- [ ] Typecheck passes

### US-013: Error Handling and Recovery
**Description:** As a user, I want errors to be handled gracefully so one bad video doesn't stop the entire batch.

**Acceptance Criteria:**
- [ ] Catch errors for each video individually
- [ ] Update video status to `error` with error message in database
- [ ] Continue processing remaining videos after an error
- [ ] Display error summary at end of batch
- [ ] Allow re-processing errored videos on next run with `--retry-errors` flag
- [ ] Typecheck passes

### US-014: Cleanup Temporary Files
**Description:** As a developer, I need temporary files cleaned up so they don't accumulate.

**Acceptance Criteria:**
- [ ] Delete temporary audio WAV files after transcription
- [ ] Clean up on successful completion
- [ ] Clean up on error (best effort)
- [ ] Typecheck passes

## Functional Requirements

- FR-1: The CLI must check for Node.js (>=18), ffmpeg, claude CLI, and whisper before processing
- FR-2: The CLI must display clear install instructions for any missing prerequisite
- FR-3: The system must create a `.ai-video-cataloger/catalog.db` SQLite database in the working directory
- FR-4: The system must track each video's processing status: pending, frames_extracted, transcribed, analyzed, completed, error
- FR-5: The system must scan for video files with extensions: .mp4, .mov, .avi, .mkv, .webm
- FR-6: The system must extract N frames evenly distributed across each video's duration
- FR-7: The system must save frames to `frames/{video-name}/frame-NNN.jpg`
- FR-8: The system must extract audio as WAV for Whisper processing
- FR-9: The system must run local Whisper with the `base` model by default
- FR-10: The system must save transcripts to `transcripts/{video-name}.txt`
- FR-11: The system must call Claude Code CLI with frames and transcript for analysis
- FR-12: The system must save analysis/summary to `summaries/{video-name}.txt`
- FR-13: The system must rename videos to format `YYYY-MM-DD_slug.ext`
- FR-14: The system must handle filename conflicts by appending `-2`, `-3`, etc.
- FR-15: The system must update output file names when video is renamed
- FR-16: The system must resume from last successful step when restarted
- FR-17: The system must continue processing remaining videos when one fails

## Non-Goals (Out of Scope for MVP)

- Interactive settings menu (use CLI flags instead)
- OpenAI Whisper API support (local only)
- Model management commands (download, list, use)
- Database status/reset commands
- Recursive directory scanning
- Configuration file support (.videocatalogerrc)
- Web UI
- Export to JSON/CSV
- whisper.cpp support (only openai-whisper)
- Custom Whisper model selection (base model only)

## Technical Considerations

- **Database:** Use `better-sqlite3` for synchronous API (simpler code, good performance)
- **FFmpeg:** Use `fluent-ffmpeg` wrapper for frame/audio extraction
- **Process execution:** Use `execa` for running whisper and claude CLI
- **File naming:** Use `slugify` for generating safe filenames
- **Dates:** Use `date-fns` for formatting dates from file stats
- **Progress display:** Use `ora` for spinners, `chalk` for colors
- **CLI parsing:** Use `commander` for argument parsing

### Output Directory Structure
```
working-folder/
├── video1.mp4
├── .ai-video-cataloger/
│   └── catalog.db
├── transcripts/
│   └── 2024-01-15_cooking-tutorial.txt
├── summaries/
│   └── 2024-01-15_cooking-tutorial.txt
└── frames/
    └── 2024-01-15_cooking-tutorial/
        ├── frame-001.jpg
        ├── frame-002.jpg
        └── frame-003.jpg
```

### Database Schema
```sql
CREATE TABLE videos (
  id INTEGER PRIMARY KEY,
  original_path TEXT UNIQUE NOT NULL,
  original_name TEXT NOT NULL,
  new_name TEXT,
  file_hash TEXT,
  status TEXT DEFAULT 'pending',
  frames_extracted_at DATETIME,
  transcribed_at DATETIME,
  analyzed_at DATETIME,
  completed_at DATETIME,
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE config (
  key TEXT PRIMARY KEY,
  value TEXT
);
```

## Success Metrics

- Tool successfully processes a batch of 10+ videos end-to-end
- Interrupting with Ctrl+C and restarting resumes from correct step
- Videos are renamed with meaningful, content-based names
- Transcripts and summaries are accurate and useful
- Processing errors for individual videos don't stop the batch

## Open Questions

- Should we calculate file hash (MD5) to detect if a video has changed since last processing?
- What should happen if whisper fails to transcribe (no speech detected)? Skip analysis or analyze frames only?
- Should the `--verbose` flag show Claude's full response or just the suggested filename?
- What's the maximum video duration we should support before warning the user about processing time?
