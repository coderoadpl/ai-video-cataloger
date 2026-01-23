# AI Video Cataloger - Implementation Plan

## Overview
A Node.js/TypeScript CLI tool that analyzes videos in a folder, transcribes them, generates summaries, and renames them based on content. Supports resumable processing with a local database.

## Core Features
1. **Video Analysis** - Extract frames and send to Claude Code CLI for content understanding
2. **Transcription** - Local Whisper by default, with API option
3. **Summary Generation** - Create .txt file with video summary
4. **Smart Renaming** - Rename videos using format: `YYYY-MM-DD_descriptive-slug.ext`
5. **Organized Output** - Transcripts, summaries, and frames in dedicated subdirectories
6. **Resumable Processing** - SQLite database tracks progress, can resume after interruption
7. **Model Management** - Download and select local Whisper model versions
8. **Prerequisite Checking** - Validate all dependencies on startup
9. **Interactive Menu** - Configure settings interactively or use defaults

## Output Directory Structure

```
working-folder/
├── video1.mp4                          # Original (or renamed) video
├── video2.mp4
├── .ai-video-cataloger/                # Hidden folder for tool data
│   ├── catalog.db                      # SQLite database for progress tracking
│   └── config.json                     # Local configuration
├── transcripts/
│   ├── 2024-01-15_cooking-tutorial.txt
│   └── 2024-01-16_travel-vlog.txt
├── summaries/
│   ├── 2024-01-15_cooking-tutorial.txt
│   └── 2024-01-16_travel-vlog.txt
└── frames/
    ├── 2024-01-15_cooking-tutorial/
    │   ├── frame-001.jpg
    │   ├── frame-002.jpg
    │   └── frame-003.jpg
    └── 2024-01-16_travel-vlog/
        ├── frame-001.jpg
        └── ...
```

## Project Architecture

```
ai-video-cataloger/
├── src/
│   ├── index.ts              # CLI entry point
│   ├── cli.ts                # Command parsing (Commander.js)
│   ├── services/
│   │   ├── prerequisites.ts  # Check for required dependencies
│   │   ├── video-scanner.ts  # Find video files in directory
│   │   ├── frame-extractor.ts # Extract frames using ffmpeg
│   │   ├── audio-extractor.ts # Extract audio track using ffmpeg
│   │   ├── transcriber.ts    # Local Whisper + API support
│   │   ├── vision-analyzer.ts # Call Claude Code CLI with frames
│   │   ├── summarizer.ts     # Generate summary from analysis
│   │   ├── renamer.ts        # Rename files with conflict handling
│   │   └── model-manager.ts  # Download/manage Whisper models
│   ├── db/
│   │   ├── database.ts       # SQLite database setup
│   │   └── progress.ts       # Progress tracking queries
│   ├── utils/
│   │   ├── ffmpeg.ts         # ffmpeg wrapper utilities
│   │   ├── file-utils.ts     # File operations helpers
│   │   └── slug.ts           # Generate URL-safe slugs
│   └── types/
│       └── index.ts          # TypeScript interfaces
├── package.json
├── tsconfig.json
└── .env.example              # API keys template (optional)
```

## Prerequisite Checking (on startup)

The CLI should check for all required dependencies immediately after launching and before any processing begins.

### Prerequisites to Check

```typescript
// src/services/prerequisites.ts

interface PrerequisiteCheck {
  name: string;
  command: string;        // Command to run
  versionFlag: string;    // Flag to get version (e.g., '--version')
  minVersion?: string;    // Minimum required version (optional)
  required: boolean;      // Is this mandatory?
  installHint: string;    // How to install if missing
}

const prerequisites: PrerequisiteCheck[] = [
  {
    name: 'Node.js',
    command: 'node',
    versionFlag: '--version',
    minVersion: '18.0.0',
    required: true,
    installHint: 'Install from https://nodejs.org/ (v18 or higher required)'
  },
  {
    name: 'ffmpeg',
    command: 'ffmpeg',
    versionFlag: '-version',
    required: true,
    installHint: 'Install with: brew install ffmpeg (macOS) or apt install ffmpeg (Linux)'
  },
  {
    name: 'Claude Code CLI',
    command: 'claude',
    versionFlag: '--version',
    required: true,
    installHint: 'Install with: npm install -g @anthropic-ai/claude-code'
  },
  {
    name: 'Whisper (local)',
    command: 'whisper',
    versionFlag: '--help',  // whisper doesn't have --version
    required: false,        // Only required if using local mode
    installHint: 'Install with: pip install openai-whisper (or brew install whisper-cpp for whisper.cpp)'
  }
];
```

### Check Flow

```typescript
async function checkPrerequisites(options: { whisperMode: 'local' | 'api' }): Promise<void> {
  console.log(chalk.blue('Checking prerequisites...\n'));

  const results: { name: string; status: 'ok' | 'missing' | 'outdated'; version?: string; hint?: string }[] = [];

  for (const prereq of prerequisites) {
    // Skip whisper check if using API mode
    if (prereq.name === 'Whisper (local)' && options.whisperMode === 'api') {
      continue;
    }

    try {
      const { stdout } = await execa(prereq.command, [prereq.versionFlag]);
      const version = parseVersion(stdout);

      if (prereq.minVersion && compareVersions(version, prereq.minVersion) < 0) {
        results.push({ name: prereq.name, status: 'outdated', version, hint: prereq.installHint });
      } else {
        results.push({ name: prereq.name, status: 'ok', version });
      }
    } catch {
      results.push({ name: prereq.name, status: 'missing', hint: prereq.installHint });
    }
  }

  // Display results
  for (const result of results) {
    if (result.status === 'ok') {
      console.log(chalk.green(`✓ ${result.name}`) + chalk.gray(` (${result.version})`));
    } else if (result.status === 'missing') {
      console.log(chalk.red(`✗ ${result.name} - not found`));
      console.log(chalk.yellow(`  → ${result.hint}`));
    } else if (result.status === 'outdated') {
      console.log(chalk.yellow(`⚠ ${result.name} - outdated (${result.version})`));
      console.log(chalk.yellow(`  → ${result.hint}`));
    }
  }

  // Exit if any required prerequisite is missing
  const missing = results.filter(r => r.status === 'missing' && isRequired(r.name));
  if (missing.length > 0) {
    console.log(chalk.red('\n✗ Missing required dependencies. Please install them and try again.'));
    process.exit(1);
  }

  console.log(chalk.green('\n✓ All prerequisites satisfied\n'));
}
```

### When to Check

- **Always on startup** - Before any command runs
- **Skip for help/version** - `--help` and `--version` should work without checks
- **Mode-aware** - Only check for local Whisper if not using `--whisper api`

## Interactive Settings Menu

When launching without flags (or with `--interactive`), the CLI displays an interactive menu to configure settings before processing.

### Menu Flow

```
┌─────────────────────────────────────────────────────────────┐
│                   AI Video Cataloger                        │
│                                                             │
│  Found 12 video files in /path/to/folder                    │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  > Start with defaults                              │    │
│  │    Configure settings                               │    │
│  │    View current settings                            │    │
│  │    Exit                                             │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### Settings Configuration Menu

```
┌─────────────────────────────────────────────────────────────┐
│                   Configure Settings                        │
│                                                             │
│  Transcription                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  > Local Whisper (default)                          │    │
│  │    OpenAI Whisper API                               │    │
│  │    Skip transcription                               │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  Whisper Model (if local)                                   │
│  ┌─────────────────────────────────────────────────────┐    │
│  │    tiny (75 MB, fastest)                            │    │
│  │  > base (142 MB, default)                           │    │
│  │    small (466 MB)                                   │    │
│  │    medium (1.5 GB)                                  │    │
│  │    large-v3 (3.1 GB, best quality)                  │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  Frame Extraction                                           │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Frames per video: [3]  (1-10)                      │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  File Renaming                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  > Rename videos based on content                   │    │
│  │    Keep original names                              │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  > Save and start processing                        │    │
│  │    Back to main menu                                │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### View Current Settings

```
┌─────────────────────────────────────────────────────────────┐
│                   Current Settings                          │
│                                                             │
│  Transcription:     Local Whisper                           │
│  Whisper Model:     base (142 MB)                           │
│  Frames per video:  3                                       │
│  Rename videos:     Yes                                     │
│  Output directory:  ./                                      │
│                                                             │
│  Press any key to return...                                 │
└─────────────────────────────────────────────────────────────┘
```

### Implementation

```typescript
// src/services/interactive-menu.ts

import inquirer from 'inquirer';
import chalk from 'chalk';

interface Settings {
  whisperMode: 'local' | 'api' | 'skip';
  whisperModel: 'tiny' | 'base' | 'small' | 'medium' | 'large-v3';
  frameCount: number;
  renameVideos: boolean;
}

const defaultSettings: Settings = {
  whisperMode: 'local',
  whisperModel: 'base',
  frameCount: 3,
  renameVideos: true,
};

export async function showMainMenu(videoCount: number, directory: string): Promise<Settings | null> {
  console.clear();
  console.log(chalk.bold.blue('\n  AI Video Cataloger\n'));
  console.log(chalk.gray(`  Found ${videoCount} video files in ${directory}\n`));

  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { name: 'Start with defaults', value: 'defaults' },
        { name: 'Configure settings', value: 'configure' },
        { name: 'View current settings', value: 'view' },
        { name: 'Exit', value: 'exit' },
      ],
    },
  ]);

  switch (action) {
    case 'defaults':
      return defaultSettings;
    case 'configure':
      return await configureSettings();
    case 'view':
      await viewSettings(defaultSettings);
      return showMainMenu(videoCount, directory);
    case 'exit':
      return null;
  }
}

async function configureSettings(): Promise<Settings> {
  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'whisperMode',
      message: 'Transcription method:',
      choices: [
        { name: 'Local Whisper (default)', value: 'local' },
        { name: 'OpenAI Whisper API', value: 'api' },
        { name: 'Skip transcription', value: 'skip' },
      ],
    },
    {
      type: 'list',
      name: 'whisperModel',
      message: 'Whisper model:',
      when: (ans) => ans.whisperMode === 'local',
      choices: [
        { name: 'tiny (75 MB, fastest)', value: 'tiny' },
        { name: 'base (142 MB, default)', value: 'base' },
        { name: 'small (466 MB)', value: 'small' },
        { name: 'medium (1.5 GB)', value: 'medium' },
        { name: 'large-v3 (3.1 GB, best quality)', value: 'large-v3' },
      ],
      default: 'base',
    },
    {
      type: 'number',
      name: 'frameCount',
      message: 'Frames to extract per video (1-10):',
      default: 3,
      validate: (val) => val >= 1 && val <= 10 ? true : 'Enter a number between 1 and 10',
    },
    {
      type: 'confirm',
      name: 'renameVideos',
      message: 'Rename videos based on content?',
      default: true,
    },
  ]);

  return {
    whisperMode: answers.whisperMode,
    whisperModel: answers.whisperModel || 'base',
    frameCount: answers.frameCount,
    renameVideos: answers.renameVideos,
  };
}

function viewSettings(settings: Settings): void {
  console.log(chalk.bold('\n  Current Settings\n'));
  console.log(`  Transcription:     ${settings.whisperMode}`);
  if (settings.whisperMode === 'local') {
    console.log(`  Whisper Model:     ${settings.whisperModel}`);
  }
  console.log(`  Frames per video:  ${settings.frameCount}`);
  console.log(`  Rename videos:     ${settings.renameVideos ? 'Yes' : 'No'}`);
  console.log();
}
```

### CLI Entry Point Integration

```typescript
// In src/cli.ts

async function main() {
  // 1. Check prerequisites first
  await checkPrerequisites({ whisperMode: 'local' });

  // 2. Scan for videos
  const videos = await scanForVideos(targetDirectory);

  if (videos.length === 0) {
    console.log(chalk.yellow('No video files found in directory.'));
    process.exit(0);
  }

  // 3. Show interactive menu (unless --yes flag provided)
  let settings: Settings;
  if (options.yes || options.nonInteractive) {
    settings = defaultSettings;
  } else {
    const result = await showMainMenu(videos.length, targetDirectory);
    if (result === null) {
      console.log('Exiting...');
      process.exit(0);
    }
    settings = result;
  }

  // 4. Process videos with chosen settings
  await processVideos(videos, settings);
}
```

### Dependencies for Interactive Menu
- **inquirer** - Interactive command-line prompts
- **chalk** - Terminal styling (already included)

### CLI Flags to Control Menu

```bash
# Show interactive menu (default)
ai-video-cataloger

# Skip menu, use defaults
ai-video-cataloger --yes
ai-video-cataloger -y

# Non-interactive mode (for scripts)
ai-video-cataloger --non-interactive

# Override specific settings via flags (skips that question in menu)
ai-video-cataloger --frames 5 --whisper api
```

## Database Schema (SQLite)

```sql
-- Track processing status of each video
CREATE TABLE videos (
  id INTEGER PRIMARY KEY,
  original_path TEXT UNIQUE NOT NULL,
  original_name TEXT NOT NULL,
  new_name TEXT,
  file_hash TEXT,                    -- MD5 hash to detect file changes
  status TEXT DEFAULT 'pending',     -- pending, frames_extracted, transcribed, analyzed, renamed, completed, error
  frames_extracted_at DATETIME,
  transcribed_at DATETIME,
  analyzed_at DATETIME,
  renamed_at DATETIME,
  completed_at DATETIME,
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Store configuration
CREATE TABLE config (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Track which models are downloaded
CREATE TABLE models (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,         -- e.g., 'whisper-base', 'whisper-large-v3'
  type TEXT NOT NULL,                -- 'whisper' or 'vision' (for future)
  path TEXT,
  size_mb INTEGER,
  downloaded_at DATETIME,
  is_active BOOLEAN DEFAULT FALSE
);
```

## Dependencies
- **commander** - CLI argument parsing
- **inquirer** - Interactive command-line prompts
- **fluent-ffmpeg** - Video/audio processing
- **better-sqlite3** - SQLite database (sync API, fast)
- **openai** - Whisper API client (optional)
- **execa** - Run Claude Code CLI and local Whisper
- **date-fns** - Date formatting
- **slugify** - Generate clean file names
- **dotenv** - Environment variable management
- **ora** - CLI spinners for progress
- **chalk** - Colored output
- **node-fetch** - Download models
- **semver** - Version comparison for prerequisite checks

## CLI Interface

```bash
# Basic usage - shows interactive menu
ai-video-cataloger

# Process specific directory
ai-video-cataloger /path/to/videos

# Skip interactive menu, use defaults
ai-video-cataloger --yes               # or -y
ai-video-cataloger --non-interactive   # For scripts

# Processing options (can be combined with --yes or interactive menu)
ai-video-cataloger --frames 5          # Number of frames to extract (default: 3)
ai-video-cataloger --whisper api       # Use Whisper API instead of local (default: local)
ai-video-cataloger --skip-rename       # Only generate summaries, don't rename
ai-video-cataloger --skip-transcribe   # Skip transcription
ai-video-cataloger --verbose           # Detailed output

# Model management
ai-video-cataloger models list         # List available Whisper models
ai-video-cataloger models download     # Download a model (interactive selection)
ai-video-cataloger models download base # Download specific model
ai-video-cataloger models use large-v3 # Set active model
ai-video-cataloger models status       # Show current model and disk usage

# Database/progress management
ai-video-cataloger status              # Show processing status of all videos
ai-video-cataloger reset               # Reset database (start fresh)
ai-video-cataloger reset video.mp4     # Reset status for specific video

# Skip prerequisite check (for help/version)
ai-video-cataloger --help              # No prereq check
ai-video-cataloger --version           # No prereq check
```

## Available Whisper Models

| Model | Size | VRAM | Relative Speed |
|-------|------|------|----------------|
| tiny | 75 MB | ~1 GB | ~32x |
| base | 142 MB | ~1 GB | ~16x |
| small | 466 MB | ~2 GB | ~6x |
| medium | 1.5 GB | ~5 GB | ~2x |
| large-v3 | 3.1 GB | ~10 GB | 1x |

Default: `base` (good balance of speed/accuracy)

## Processing Pipeline

For each video file:

1. **Check Prerequisites** - Validate ffmpeg, Claude CLI, Whisper (if local mode)
2. **Check Database** - Skip if already completed, resume from last step if interrupted
3. **Scan** - Find video files (.mp4, .mov, .avi, .mkv, .webm)
4. **Hash** - Calculate file hash to detect changes
5. **Extract Frames** - Use ffmpeg to extract N evenly-spaced frames → save to `frames/{video-name}/`
6. **Update Status** → `frames_extracted`
7. **Extract Audio** - Use ffmpeg to extract audio track as temp .wav file
8. **Transcribe** - Run local Whisper (or API) → save to `transcripts/{video-name}.txt`
9. **Update Status** → `transcribed`
10. **Analyze** - Call Claude Code CLI with frames + transcription for content analysis
11. **Summarize** - Generate summary text → save to `summaries/{video-name}.txt`
12. **Update Status** → `analyzed`
13. **Rename** - Rename video to `YYYY-MM-DD_slug.ext` (handle conflicts with -2, -3, etc.)
14. **Update Status** → `renamed`
15. **Rename Outputs** - Rename transcript, summary, frames folder to match new video name
16. **Update Status** → `completed`
17. **Cleanup** - Remove temp audio file

## Key Implementation Details

### Frame Extraction
```typescript
// Extract N frames evenly distributed across video
function getTimestamps(duration: number, frameCount: number): number[] {
  const step = duration / (frameCount + 1);
  return Array.from({ length: frameCount }, (_, i) => step * (i + 1));
}
// For 3 frames in 60s video: [15, 30, 45] seconds
```

### Local Whisper Integration
```typescript
// Using whisper.cpp via command line
const result = await execa('whisper', [
  audioPath,
  '--model', modelPath,
  '--output-format', 'txt',
  '--output-dir', transcriptsDir
]);
```

### Claude Code CLI Integration
```typescript
// Call Claude Code with image files and transcript
const result = await execa('claude', [
  '-p',  // Print mode (non-interactive)
  `Analyze these ${frameCount} video frames and the transcription below.
   Describe the video content in 2-3 sentences.
   Then suggest a short descriptive filename (3-5 words, kebab-case, no date).

   Transcription:
   ${transcriptContent}`,
  ...framePaths.flatMap(p => ['--files', p])
]);
```

### Naming Convention
- Format: `YYYY-MM-DD_descriptive-slug.ext`
- Date from file modification time
- Slug from Claude's analysis (3-5 words, kebab-case)
- Conflict resolution: append `-2`, `-3`, etc.

### Resumable Processing
```typescript
// On startup, check existing progress
const pendingVideos = db.prepare(`
  SELECT * FROM videos
  WHERE status != 'completed' AND status != 'error'
  ORDER BY created_at
`).all();

// Resume from last successful step
for (const video of pendingVideos) {
  if (video.status === 'pending') await extractFrames(video);
  if (video.status === 'frames_extracted') await transcribe(video);
  if (video.status === 'transcribed') await analyze(video);
  // ... etc
}
```

## Files to Create

1. `package.json` - Project config with dependencies
2. `tsconfig.json` - TypeScript configuration
3. `src/index.ts` - Entry point with shebang for CLI
4. `src/cli.ts` - Commander.js setup with all commands
5. `src/services/prerequisites.ts` - Check for required dependencies
6. `src/services/interactive-menu.ts` - Interactive settings menu
7. `src/db/database.ts` - SQLite database initialization
8. `src/db/progress.ts` - Progress tracking functions
9. `src/services/video-scanner.ts` - Find videos in directory
10. `src/services/frame-extractor.ts` - Extract frames with ffmpeg
11. `src/services/audio-extractor.ts` - Extract audio with ffmpeg
12. `src/services/transcriber.ts` - Local Whisper + API support
13. `src/services/vision-analyzer.ts` - Claude Code CLI integration
14. `src/services/summarizer.ts` - Generate summary text
15. `src/services/renamer.ts` - File renaming logic
16. `src/services/model-manager.ts` - Download/manage Whisper models
17. `src/utils/ffmpeg.ts` - ffmpeg helpers
18. `src/utils/file-utils.ts` - File utilities
19. `src/utils/slug.ts` - Slug generation
20. `src/types/index.ts` - TypeScript types
21. `.env.example` - Environment template (optional, for API mode)

## Prerequisites
- Node.js 18+
- ffmpeg installed on system
- Claude Code CLI installed and configured
- Whisper.cpp or OpenAI Whisper installed (for local mode)

## Verification
1. Run `npm install` to install dependencies
2. Run `npm run build` to compile TypeScript
3. Run `ai-video-cataloger models download base` to get Whisper model
4. Create test directory with sample videos
5. Run `ai-video-cataloger ./test-videos --verbose`
6. Interrupt with Ctrl+C mid-process, then re-run to verify resume works
7. Verify: transcripts/, summaries/, frames/ directories created with correct files

## Nice-to-Have (Future)
- Local vision models (LLaVA) as alternative to Claude Code
- Recursive directory scanning with `--recursive` flag
- Progress bar for batch processing
- Configuration file support (.videocatalogerrc)
- Web UI for browsing cataloged videos
- Export database to JSON/CSV
