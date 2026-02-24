# PRD: AI Video Cataloger GUI MVP

## Introduction

Extend the existing AI Video Cataloger CLI tool (US-001 through US-027) with a graphical user interface using Electron. The GUI provides a minimal, single-window interface where users can browse folders, view video files with processing status indicators, run or rerun analysis on individual files or batches, and preview results (frames, transcripts, summaries) within the app.

The GUI wraps the existing TypeScript backend services, reusing all current functionality (frame extraction, transcription, Claude analysis, renaming) while providing a visual interface for macOS users who prefer not to use the command line.

Key additions include:
- **Bundled FFmpeg** (no user installation required)
- **In-app Whisper model downloader** with whisper.cpp runtime (no Python dependency)
- **LLaVA support via Ollama** as a local alternative to Claude for image analysis
- **Apple Silicon (ARM64) native binaries** for optimal performance

## Goals

- Provide a native-feeling macOS desktop application using Electron
- Bundle FFmpeg so users don't need to install it manually
- Provide in-app Whisper model downloading and whisper.cpp runtime
- Support LLaVA via Ollama as local alternative to Claude for image analysis
- Target Apple Silicon Macs primarily (with Intel support via universal binaries)
- Display only video files in selected folders with clear status indicators
- Allow both individual file and batch folder processing
- Expose all current CLI configuration options through a settings panel
- Show processing results (frames, transcript, summary) in-app with option to reveal in Finder
- Maintain full compatibility with existing CLI tool and database

## User Stories

### US-028: Electron Project Setup
**Description:** As a developer, I need the Electron project scaffolded alongside the existing CLI so both can share the backend services.

**Acceptance Criteria:**
- [ ] Create `electron/` directory with main process entry point
- [ ] Configure electron-builder for macOS builds (.app and .dmg)
- [ ] Target Apple Silicon (arm64) as primary, with universal binary option
- [ ] Set up IPC (Inter-Process Communication) bridge between main and renderer
- [ ] Configure TypeScript for both main and renderer processes
- [ ] Add npm scripts: `electron:dev`, `electron:build`, `electron:package`
- [ ] Renderer process uses React with TypeScript
- [ ] Reuse existing `src/services/` and `src/db/` modules in main process
- [ ] App builds and launches successfully on macOS
- [ ] Typecheck passes

### US-029: Bundle FFmpeg with Application
**Description:** As a user, I want FFmpeg bundled with the app so I don't need to install it separately.

**Acceptance Criteria:**
- [ ] Add `ffmpeg-static` package as dependency (original, mature package)
- [ ] Configure electron-builder `asarUnpack` for FFmpeg binary
- [ ] Use path replacement: `require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked')`
- [ ] Update `fluent-ffmpeg` to use bundled binary path instead of system ffmpeg
- [ ] Build includes arm64 (Apple Silicon) FFmpeg binary
- [ ] Exclude non-macOS binaries from build to reduce size
- [ ] Frame extraction works with bundled FFmpeg
- [ ] Audio extraction works with bundled FFmpeg
- [ ] Typecheck passes

### US-030: Prerequisites Verification Panel
**Description:** As a user, I want to see a clear overview of all required dependencies and their status so I know what's working and what needs attention.

**Acceptance Criteria:**
- [ ] Prerequisites panel accessible from Settings or shown on first launch
- [ ] Display checklist with status for each dependency:
  - FFmpeg: Always green (bundled)
  - Whisper (local): Check if whisper.cpp models downloaded
  - Claude CLI: Check if `claude` command exists (for Claude analysis mode)
  - Ollama: Check if `ollama` command exists and running (for LLaVA analysis mode)
  - OpenAI API Key: Check if `OPENAI_API_KEY` set (for API transcription)
- [ ] Green checkmark with version for available dependencies
- [ ] Red X with install instructions link for missing dependencies
- [ ] Yellow warning for optional dependencies
- [ ] "Check Again" button to re-verify after user installs something
- [ ] Show which analysis methods are available (Claude CLI / LLaVA / both)
- [ ] Show which transcription methods are available (Local / API / Skip)
- [ ] Typecheck passes

### US-031: Whisper Model Manager Panel
**Description:** As a user, I want to download and manage Whisper models within the app so I can use local transcription without command-line setup.

**Acceptance Criteria:**
- [ ] Model Manager panel accessible from Settings
- [ ] Display list of available whisper.cpp GGML models: tiny (75MB), base (142MB), small (466MB), medium (1.5GB), large-v3 (3.1GB)
- [ ] Show download status for each model: Not Downloaded / Downloading / Downloaded
- [ ] "Download" button for models not yet downloaded
- [ ] Download progress bar with percentage and speed (MB/s)
- [ ] "Cancel Download" button during active download
- [ ] "Delete" button for downloaded models (with confirmation)
- [ ] Display disk space used by downloaded models
- [ ] Models stored in app's user data directory (`~/Library/Application Support/AI Video Cataloger/whisper-models/`)
- [ ] Download GGML models from Hugging Face (ggerganov/whisper.cpp)
- [ ] Typecheck passes

### US-032: Integrated Whisper.cpp Runtime
**Description:** As a developer, I need the app to run transcription using whisper.cpp so users don't need Python or the Whisper CLI installed.

**Acceptance Criteria:**
- [ ] Bundle whisper.cpp macOS binary (arm64 for Apple Silicon)
- [ ] Include whisper.cpp binary in `electron/resources/bin/`
- [ ] Configure electron-builder to unpack binary from asar
- [ ] Implement `transcribeWithWhisperCpp()` function that calls bundled binary
- [ ] Pass model path and audio file to whisper.cpp
- [ ] Parse whisper.cpp output to extract transcript text
- [ ] Fall back to system `whisper` CLI if available (for users who prefer Python version)
- [ ] Settings toggle: "Use built-in Whisper" vs "Use system Whisper"
- [ ] Transcription produces same format output as current Python Whisper
- [ ] Typecheck passes

### US-033: Ollama Integration for LLaVA
**Description:** As a user, I want to use LLaVA via Ollama for local image analysis so I don't need Claude CLI or an API key.

**Acceptance Criteria:**
- [ ] Detect if Ollama is installed (`which ollama` or check `/usr/local/bin/ollama`)
- [ ] Check if Ollama is running (ping `localhost:11434`)
- [ ] **Auto-start Ollama if installed but not running** (via `ollama serve` in background)
- [ ] Check if LLaVA model is pulled (`ollama list | grep llava`)
- [ ] Add "Analysis Method" setting: Claude CLI / LLaVA (Ollama)
- [ ] Implement `analyzeWithOllama()` function using Ollama HTTP API (localhost:11434)
- [ ] Send frames as base64 images to LLaVA
- [ ] Use same prompt format as Claude analysis for consistent output
- [ ] Parse LLaVA response to extract description and filename suggestion
- [ ] Handle Ollama startup failure with clear error message
- [ ] Typecheck passes

### US-034: LLaVA Model Manager
**Description:** As a user, I want to manage LLaVA models through the app so I can download and select which model to use.

**Acceptance Criteria:**
- [ ] LLaVA section in Model Manager panel (separate from Whisper)
- [ ] Detect Ollama installation status
- [ ] "Install Ollama" button/link if not installed (links to ollama.ai)
- [ ] List available LLaVA models: llava (7B), llava:13b, llava:34b
- [ ] Show which models are pulled in Ollama
- [ ] **Detect system RAM and recommend appropriate model:**
  - 8GB RAM: Recommend llava:7b (only option that fits)
  - 16GB RAM: Recommend llava:13b
  - 32GB+ RAM: Recommend llava:34b
  - Show "Recommended" badge on appropriate model
  - Warn if user tries to pull model larger than available RAM
- [ ] "Pull Model" button triggers `ollama pull llava:variant`
- [ ] Pull progress displayed (Ollama shows its own progress, capture and display)
- [ ] "Delete Model" removes from Ollama (`ollama rm`)
- [ ] Show model sizes and RAM requirements (7B: 8GB, 13B: 16GB, 34B: 32GB)
- [ ] Settings dropdown to select active LLaVA model
- [ ] Typecheck passes

### US-035: Main Window Layout
**Description:** As a user, I want a clean single-window interface with a sidebar for files and a main panel for details.

**Acceptance Criteria:**
- [ ] Single window with minimum size 900x600px
- [ ] Left sidebar (250px width) showing folder path and file list
- [ ] Right main panel showing selected file details
- [ ] Top toolbar with folder selection and action buttons
- [ ] Native macOS title bar with traffic lights
- [ ] Window state (size, position) persisted between sessions
- [ ] Typecheck passes

### US-036: Folder Selection
**Description:** As a user, I want to select a folder to view its video files so I can choose what to process.

**Acceptance Criteria:**
- [ ] "Open Folder" button in toolbar opens native macOS folder picker
- [ ] Selected folder path displayed in toolbar
- [ ] Recent folders stored and accessible via dropdown (last 5)
- [ ] Folder selection triggers video file scan
- [ ] Last used folder restored on app launch
- [ ] Typecheck passes

### US-037: Video File List Display
**Description:** As a user, I want to see only video files in the selected folder with clear status indicators so I know what has been processed.

**Acceptance Criteria:**
- [ ] List shows only video files (.mp4, .mov, .avi, .mkv, .webm)
- [ ] Non-video files are not displayed
- [ ] Each file shows: thumbnail (first frame if available), filename, file size, duration
- [ ] Status badge on each file: None (unprocessed), Yellow (in-progress), Green (completed), Red (error)
- [ ] Files sortable by name, date modified, status
- [ ] Click to select single file, Cmd+click for multi-select
- [ ] Typecheck passes

### US-038: Video Details Panel - Unprocessed State
**Description:** As a user, I want to see basic info about an unprocessed video so I can decide whether to analyze it.

**Acceptance Criteria:**
- [ ] Display video filename and path
- [ ] Display file size and duration
- [ ] Display file modification date
- [ ] Show "Not yet analyzed" status message
- [ ] Show "Analyze" button prominently
- [ ] Typecheck passes

### US-039: Video Details Panel - Processed State
**Description:** As a user, I want to see all analysis results for a processed video so I can review the output.

**Acceptance Criteria:**
- [ ] Display generated summary/description text
- [ ] Display suggested filename (if different from current)
- [ ] Display extracted frames as thumbnail gallery (clickable to enlarge)
- [ ] Display transcript text in scrollable area
- [ ] Show processing timestamps (when analyzed)
- [ ] Show which analysis method was used (Claude / LLaVA)
- [ ] "Reveal in Finder" button for video file
- [ ] "Reveal in Finder" buttons for frames, transcript, summary folders
- [ ] "Re-analyze" button to process again
- [ ] Typecheck passes

### US-040: Video Details Panel - Error State
**Description:** As a user, I want to see error details when processing fails so I can understand what went wrong.

**Acceptance Criteria:**
- [ ] Display error message from database
- [ ] Display which step failed (frames, transcription, analysis, rename)
- [ ] Show "Retry" button to attempt processing again
- [ ] Show any partial results (e.g., frames if transcription failed)
- [ ] Typecheck passes

### US-041: Settings Panel
**Description:** As a user, I want to configure processing options so I can customize how videos are analyzed.

**Acceptance Criteria:**
- [ ] Settings accessible via menu bar (App > Settings) or Cmd+,
- [ ] Modal or slide-over panel with settings form
- [ ] **Analysis section:**
  - Analysis method: Claude CLI / LLaVA (Ollama)
  - LLaVA model dropdown (when LLaVA selected): shows pulled models
  - Claude timeout input: 30-300 seconds (default 120)
- [ ] **Transcription section:**
  - Transcription method: Local Whisper / OpenAI API / Skip
  - Whisper backend: Built-in (whisper.cpp) / System (Python)
  - Whisper model dropdown: shows downloaded models
- [ ] **Output section:**
  - Frame count slider: 1-10 (default 3)
  - Rename files toggle: on/off (default on)
- [ ] "Manage Models" button opens Model Manager
- [ ] Settings saved to database config table
- [ ] Settings apply to subsequent processing operations
- [ ] Typecheck passes

### US-042: Analyze Single Video
**Description:** As a user, I want to analyze a single selected video so I can process files one at a time.

**Acceptance Criteria:**
- [ ] "Analyze" button enabled when single unprocessed video selected
- [ ] Button starts processing pipeline for selected video
- [ ] Uses configured analysis method (Claude or LLaVA)
- [ ] Progress indicator shows current step (extracting frames, transcribing, analyzing, renaming)
- [ ] UI remains responsive during processing (async operation)
- [ ] Status badge updates in real-time as processing progresses
- [ ] Details panel updates when processing completes
- [ ] Error state shown if processing fails
- [ ] Typecheck passes

### US-043: Analyze Multiple Videos (Batch)
**Description:** As a user, I want to analyze multiple selected videos in batch so I can process several files at once.

**Acceptance Criteria:**
- [ ] "Analyze Selected" button enabled when multiple videos selected
- [ ] "Analyze All" button processes all unprocessed videos in folder
- [ ] Progress shows: "Processing 3 of 10 videos"
- [ ] Individual file status badges update as each completes
- [ ] Processing continues even if individual videos fail
- [ ] Summary notification when batch completes: "Processed 8 videos, 2 errors"
- [ ] Typecheck passes

### US-044: Cancel Processing
**Description:** As a user, I want to cancel ongoing processing so I can stop if needed.

**Acceptance Criteria:**
- [ ] "Cancel" button appears during processing
- [ ] Clicking cancel stops processing after current video completes
- [ ] Partial results preserved (whatever was completed before cancel)
- [ ] Video status updated appropriately (not left in inconsistent state)
- [ ] Typecheck passes

### US-045: Retry Failed Videos
**Description:** As a user, I want to retry failed videos so I can attempt to fix transient errors.

**Acceptance Criteria:**
- [ ] "Retry Failed" button in toolbar (visible when errors exist)
- [ ] Retries all videos with error status in current folder
- [ ] Individual retry available from video details panel
- [ ] Smart retry checks existing artifacts to resume from failure point
- [ ] Typecheck passes

### US-046: Frame Preview Modal
**Description:** As a user, I want to view extracted frames in a larger size so I can see details.

**Acceptance Criteria:**
- [ ] Clicking frame thumbnail opens modal with larger image
- [ ] Arrow keys or buttons to navigate between frames
- [ ] Escape or click outside to close modal
- [ ] Frame number indicator (1 of 3)
- [ ] Typecheck passes

### US-047: Native macOS Integration
**Description:** As a user, I want the app to feel native on macOS with proper menus and shortcuts.

**Acceptance Criteria:**
- [ ] Standard macOS menu bar (App, File, Edit, View, Window, Help)
- [ ] File > Open Folder (Cmd+O)
- [ ] App > Settings (Cmd+,)
- [ ] App > Check for Updates
- [ ] App > Quit (Cmd+Q)
- [ ] Edit menu with standard Cut/Copy/Paste for text fields
- [ ] View > Refresh (Cmd+R) to rescan folder
- [ ] Help > Prerequisites to open prerequisites panel
- [ ] Help > Model Manager to open model manager
- [ ] App icon displayed in dock
- [ ] Typecheck passes

### US-048: Processing Progress Indicator
**Description:** As a user, I want to see detailed progress during processing so I know what's happening.

**Acceptance Criteria:**
- [ ] Progress bar in toolbar during batch processing
- [ ] Current video name displayed
- [ ] Current step displayed (Extracting frames, Transcribing, Analyzing with [Claude/LLaVA], Renaming)
- [ ] Estimated progress percentage for current video
- [ ] Overall batch progress (3/10 videos)
- [ ] Typecheck passes

### US-049: Empty States
**Description:** As a user, I want helpful messages when there's nothing to display so I know what to do.

**Acceptance Criteria:**
- [ ] No folder selected: "Open a folder to get started" with Open Folder button
- [ ] Folder has no videos: "No video files found in this folder"
- [ ] No video selected: "Select a video to view details"
- [ ] All videos processed: Show summary stats instead of empty state
- [ ] Typecheck passes

### US-050: Database Compatibility
**Description:** As a developer, I need the GUI to use the same database as the CLI so users can switch between interfaces.

**Acceptance Criteria:**
- [ ] GUI reads/writes to same `.ai-video-cataloger/catalog.db` location
- [ ] Videos processed by CLI appear correctly in GUI
- [ ] Videos processed by GUI can be viewed via `ai-video-cataloger status` CLI
- [ ] No schema changes required (use existing schema)
- [ ] Typecheck passes

### US-051: First Launch Setup Wizard
**Description:** As a new user, I want a guided setup when I first launch the app so I can get started quickly.

**Acceptance Criteria:**
- [ ] Show setup wizard on first launch (track in app preferences)
- [ ] Step 1: Welcome screen explaining what the app does
- [ ] Step 2: Prerequisites check (FFmpeg bundled, analysis options, transcription options)
- [ ] Step 3: Choose analysis method:
  - Claude CLI (requires installation)
  - LLaVA via Ollama (requires Ollama + model download)
- [ ] Step 4: Choose transcription method (with explanation of each option)
- [ ] Step 5: If local options selected, prompt to download models
- [ ] Step 6: Ready to go - open folder picker
- [ ] "Skip Setup" option to go directly to main window
- [ ] Can re-run setup from Help menu
- [ ] Typecheck passes

## Functional Requirements

- FR-1: The app must be built with Electron and package as a macOS .app bundle (arm64 + universal)
- FR-2: The app must bundle FFmpeg so users don't need to install it
- FR-3: The app must bundle whisper.cpp and provide in-app model downloading
- FR-4: The app must support LLaVA via Ollama as an alternative to Claude for image analysis
- FR-5: The app must display only video files (.mp4, .mov, .avi, .mkv, .webm) in selected folders
- FR-6: The app must show status badges: unprocessed (none), in-progress (yellow), completed (green), error (red)
- FR-7: The app must allow selecting and processing individual videos
- FR-8: The app must allow batch processing of selected videos or all unprocessed videos
- FR-9: The app must display processing progress with current step and overall progress
- FR-10: The app must show extracted frames, transcript, and summary in the details panel
- FR-11: The app must provide "Reveal in Finder" functionality for all generated files
- FR-12: The app must expose settings: analysis method, transcription method, models, frame count, timeout, rename toggle
- FR-13: The app must check prerequisites and show clear status for each dependency
- FR-14: The app must use the same SQLite database as the CLI tool
- FR-15: The app must support standard macOS keyboard shortcuts
- FR-16: The app must remain responsive during processing (non-blocking operations)
- FR-17: The app must allow canceling in-progress processing
- FR-18: The app must support retrying failed videos

## Non-Goals (Out of Scope for this MVP)

- Windows or Linux support (macOS only for MVP)
- Video playback within the app
- Editing transcripts or summaries in the app
- Drag-and-drop files into the app
- Auto-watch folders for new videos
- System tray / menu bar app mode
- Multiple windows
- Dark mode toggle (follows system setting automatically)
- Recursive folder scanning
- Custom prompts for Claude or LLaVA
- Export functionality (PDF, CSV, etc.)
- Bundled Ollama (user must install separately)

**Deferred to Next MVP:**
- OpenAI Vision API for image analysis
- OpenAI Whisper API improvements/UI integration
- Cloud-based analysis options

## Design Considerations

### UI Layout

```
+------------------------------------------------------------------+
| [icon] AI Video Cataloger              [Progress: 3/10] [Cancel] |
+------------------------------------------------------------------+
| [Open Folder] /Users/me/Videos  [v Recent]  [Settings] [Refresh] |
+------------------------------------------------------------------+
|                        |                                         |
| video-001.mp4      [G] | cooking-tutorial.mp4                    |
| video-002.mp4      [ ] |                                         |
| video-003.mp4      [Y] | Status: Completed (via LLaVA)           |
| video-004.mp4      [R] | Processed: Jan 15, 2024                 |
| video-005.mp4      [ ] |                                         |
|                        | Summary:                                 |
|                        | A cooking tutorial showing how to make  |
|                        | pasta carbonara with crispy bacon...    |
|                        |                                         |
|                        | Suggested name: cooking-pasta-carbonara |
|                        |                                         |
|                        | Frames:                                  |
|                        | [img1] [img2] [img3]                    |
|                        |                                         |
|                        | Transcript:                             |
|                        | +------------------------------------+  |
|                        | | Today we're going to make a       |  |
|                        | | classic Italian pasta carbonara...|  |
|                        | +------------------------------------+  |
|                        |                                         |
|                        | [Re-analyze] [Reveal in Finder]         |
+------------------------+-----------------------------------------+

Legend: [G]=Green(complete) [Y]=Yellow(in-progress) [R]=Red(error) [ ]=None
```

### Prerequisites Panel Layout

```
+--------------------------------------------------+
|              Prerequisites                        |
+--------------------------------------------------+
|                                                  |
|  FFmpeg              [✓] Bundled v6.1            |
|                                                  |
|  ─── Analysis ───                                |
|                                                  |
|  Claude CLI          [✓] v1.2.0                  |
|                      Installed globally           |
|                                                  |
|  Ollama              [✓] Running                 |
|                      LLaVA 7B pulled             |
|                      [Manage Models]              |
|                                                  |
|  ─── Transcription ───                           |
|                                                  |
|  Whisper (built-in)  [✓] base model downloaded   |
|                      [Manage Models]              |
|                                                  |
|  OpenAI API Key      [!] Not configured          |
|                      Set OPENAI_API_KEY           |
|                                                  |
+--------------------------------------------------+
|  Available options:                              |
|  Analysis: Claude CLI, LLaVA                     |
|  Transcription: Local (whisper.cpp), Skip        |
+--------------------------------------------------+
|              [Check Again]                       |
+--------------------------------------------------+
```

### Model Manager Panel Layout

```
+--------------------------------------------------------+
|              Model Manager                               |
+--------------------------------------------------------+
|                                                        |
|  ═══ Whisper Models (whisper.cpp) ═══                  |
|                                                        |
|  tiny     75 MB    [Downloaded]   [Delete]             |
|  base     142 MB   [Download]                          |
|  small    466 MB   [Downloading... 45%] [Cancel]       |
|  medium   1.5 GB   [Download]                          |
|  large-v3 3.1 GB   [Download]                          |
|                                                        |
|  Storage: 217 MB in ~/Library/Application Support/...  |
|                                                        |
|  ═══ LLaVA Models (via Ollama) ═══                     |
|                                                        |
|  Ollama: [✓] Running (auto-started)                    |
|  System RAM: 16 GB                                     |
|                                                        |
|  llava:7b   4.7 GB   8GB RAM    [Pulled]    [Remove]   |
|  llava:13b  8.0 GB   16GB RAM   [Pull] ⭐ Recommended  |
|  llava:34b  20 GB    32GB RAM   [Pull] ⚠️ May be slow  |
|                                                        |
|  [Open Ollama Website] for more models                 |
|                                                        |
+--------------------------------------------------------+
```

### Settings Panel Layout

```
+--------------------------------------------------+
|              Settings                             |
+--------------------------------------------------+
|                                                  |
|  ═══ Analysis ═══                                |
|                                                  |
|  Method:        [▼ LLaVA (Ollama)            ]   |
|                                                  |
|  LLaVA Model:   [▼ llava:7b                  ]   |
|                                                  |
|  Claude Timeout: [120] seconds                   |
|  (used when Claude CLI selected)                 |
|                                                  |
|  ═══ Transcription ═══                           |
|                                                  |
|  Method:        [▼ Local Whisper             ]   |
|                                                  |
|  Backend:       [▼ Built-in (whisper.cpp)    ]   |
|                                                  |
|  Model:         [▼ base                      ]   |
|                                                  |
|  ═══ Output ═══                                  |
|                                                  |
|  Frame count:   [====●=====] 3                   |
|                                                  |
|  [✓] Rename files after analysis                 |
|                                                  |
|  [Manage Models]                                 |
|                                                  |
+--------------------------------------------------+
|        [Cancel]              [Save]              |
+--------------------------------------------------+
```

### Color Scheme

- Follow macOS Human Interface Guidelines
- Use system colors for native feel
- Status colors: Green (#34C759), Yellow (#FFCC00), Red (#FF3B30)

### Technology Stack

- **Framework:** Electron with React renderer
- **Styling:** Tailwind CSS or CSS Modules
- **State Management:** React Context or Zustand (minimal state)
- **IPC:** Electron's ipcMain/ipcRenderer for main-renderer communication
- **Build:** electron-builder for macOS packaging (arm64 primary)
- **FFmpeg:** ffmpeg-static with asarUnpack (mature, well-maintained)
- **Whisper:** whisper.cpp (C++, no Python, Apple Silicon optimized)
- **LLaVA:** Ollama HTTP API (localhost:11434)

## Technical Considerations

### Architecture

```
electron/
├── main/
│   ├── index.ts           # Main process entry
│   ├── ipc-handlers.ts    # IPC handlers calling backend services
│   ├── menu.ts            # macOS menu bar setup
│   ├── window.ts          # Window management
│   ├── prerequisites.ts   # Dependency checking
│   ├── model-manager.ts   # Whisper model download/management
│   └── ollama.ts          # Ollama/LLaVA integration
├── renderer/
│   ├── App.tsx            # Root React component
│   ├── components/
│   │   ├── Sidebar/
│   │   ├── VideoList/
│   │   ├── VideoDetails/
│   │   ├── Settings/
│   │   ├── Prerequisites/
│   │   ├── ModelManager/
│   │   ├── SetupWizard/
│   │   └── ProgressBar/
│   ├── hooks/
│   └── styles/
├── preload.ts             # Preload script for secure IPC
└── resources/
    └── bin/
        └── whisper        # Bundled whisper.cpp binary (arm64)

src/                       # Existing CLI code (reused)
├── services/
│   ├── analyzer.ts        # Add analyzeWithOllama() alongside Claude
│   ├── transcription.ts   # Add transcribeWithWhisperCpp()
│   └── ...
├── db/
└── types/
```

### Bundled Dependencies

**FFmpeg:**
- Use `ffmpeg-static` package (original, mature, well-maintained)
- Configure electron-builder:
  ```json
  "build": {
    "asarUnpack": [
      "node_modules/ffmpeg-static/ffmpeg"
    ],
    "mac": {
      "target": [
        { "target": "dmg", "arch": ["arm64"] },
        { "target": "dmg", "arch": ["universal"] }
      ]
    }
  }
  ```
- In code: `require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked')`

**Whisper.cpp:**
- Download pre-built arm64 binary from [whisper.cpp releases](https://github.com/ggml-org/whisper.cpp/releases)
- Include in `electron/resources/bin/whisper`
- Models downloaded to `~/Library/Application Support/AI Video Cataloger/whisper-models/`
- Model format: GGML (e.g., `ggml-base.bin`)
- Model URL: `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{model}.bin`

**LLaVA via Ollama:**
- Ollama installed separately by user (from ollama.ai)
- App communicates via HTTP API at `localhost:11434`
- Models managed through Ollama CLI (`ollama pull`, `ollama rm`)

### IPC Communication

```typescript
// Renderer requests
ipcRenderer.invoke('select-folder')              // Opens folder dialog
ipcRenderer.invoke('scan-folder', folderPath)    // Returns video list
ipcRenderer.invoke('get-video-details', id)      // Returns video record with files
ipcRenderer.invoke('process-video', id)          // Starts processing
ipcRenderer.invoke('process-batch', ids)         // Batch processing
ipcRenderer.invoke('cancel-processing')          // Cancels current operation
ipcRenderer.invoke('get-settings')               // Returns current settings
ipcRenderer.invoke('save-settings', settings)    // Saves settings

// Prerequisites & Models
ipcRenderer.invoke('check-prerequisites')        // Returns all dependency status
ipcRenderer.invoke('get-whisper-models')         // Returns whisper model list with status
ipcRenderer.invoke('download-whisper-model', m)  // Starts model download
ipcRenderer.invoke('delete-whisper-model', m)    // Deletes downloaded model
ipcRenderer.invoke('get-ollama-status')          // Check if Ollama running
ipcRenderer.invoke('get-llava-models')           // Returns pulled LLaVA models
ipcRenderer.invoke('pull-llava-model', variant)  // Triggers ollama pull
ipcRenderer.invoke('remove-llava-model', variant)// Triggers ollama rm

// Main process events
ipcMain.emit('processing-progress', progress)    // Progress updates
ipcMain.emit('processing-complete', result)      // Processing finished
ipcMain.emit('processing-error', error)          // Processing failed
ipcMain.emit('download-progress', progress)      // Model download progress
```

### Ollama API Integration

```typescript
import { execSync, spawn } from 'child_process';
import os from 'os';

// Check if Ollama is installed
const isOllamaInstalled = (): boolean => {
  try {
    execSync('which ollama', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

// Check if Ollama is running
const isOllamaRunning = async (): Promise<boolean> => {
  try {
    const response = await fetch('http://localhost:11434/api/tags');
    return response.ok;
  } catch {
    return false;
  }
};

// Auto-start Ollama if installed but not running
const ensureOllamaRunning = async (): Promise<boolean> => {
  if (await isOllamaRunning()) return true;
  if (!isOllamaInstalled()) return false;

  // Start Ollama in background
  const proc = spawn('ollama', ['serve'], {
    detached: true,
    stdio: 'ignore',
  });
  proc.unref();

  // Wait for Ollama to start (max 10 seconds)
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (await isOllamaRunning()) return true;
  }
  return false;
};

// Get system RAM and recommend LLaVA model
const getRecommendedLLaVAModel = (): { model: string; reason: string } => {
  const totalRAM = os.totalmem() / (1024 ** 3); // GB

  if (totalRAM >= 32) {
    return { model: 'llava:34b', reason: `${Math.round(totalRAM)}GB RAM detected` };
  } else if (totalRAM >= 16) {
    return { model: 'llava:13b', reason: `${Math.round(totalRAM)}GB RAM detected` };
  } else {
    return { model: 'llava:7b', reason: `${Math.round(totalRAM)}GB RAM detected` };
  }
};

// List pulled models
const listModels = async (): Promise<string[]> => {
  const response = await fetch('http://localhost:11434/api/tags');
  const data = await response.json();
  return data.models.map((m: any) => m.name);
};

// Analyze image with LLaVA
const analyzeWithLLaVA = async (
  imagePaths: string[],
  transcript: string | null,
  model: string = 'llava'
): Promise<{ description: string; filename: string }> => {
  const images = await Promise.all(
    imagePaths.map(async (p) => {
      const buffer = await fs.readFile(p);
      return buffer.toString('base64');
    })
  );

  const response = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    body: JSON.stringify({
      model,
      prompt: buildAnalysisPrompt(transcript),
      images,
      stream: false,
    }),
  });

  const data = await response.json();
  return parseAnalysisResponse(data.response);
};
```

### File Access

- Use Electron's `shell.showItemInFolder()` for Reveal in Finder
- Use `dialog.showOpenDialog()` for folder selection
- Frame images loaded via `file://` protocol in renderer
- Use `app.getPath('userData')` for model storage location

## Success Metrics

- User can process 10 videos through the GUI without errors
- App works out-of-box without installing FFmpeg
- User can download Whisper models and use local transcription without Python
- User can use LLaVA for fully local analysis (no Claude CLI needed)
- All CLI options configurable through settings panel
- Processing a video through GUI produces identical results to CLI
- App feels responsive during batch processing (no UI freezes)
- Reveal in Finder works for all generated files
- App launches in under 3 seconds on Apple Silicon Mac
- First-time setup (excluding model downloads) completes in under 2 minutes

## Open Questions

- Should settings be per-folder or global?
- What should happen when the CLI is processing in the same folder simultaneously?
- Should we add a "View Logs" option for debugging?
- Should we support automatic updates via electron-updater?

## Resolved Decisions

- **Auto-start Ollama:** Yes, if installed but not running, start via `ollama serve`
- **RAM-based model recommendation:** Yes, detect system RAM and recommend appropriate LLaVA model
- **OpenAI Vision API:** Deferred to next MVP (focus on local-first for this version)

## References

- [ffmpeg-static](https://www.npmjs.com/package/ffmpeg-static) - Static FFmpeg binaries for Node.js
- [whisper.cpp](https://github.com/ggml-org/whisper.cpp) - C++ port of Whisper (no Python dependency)
- [Ollama](https://github.com/ollama/ollama) - Run LLMs locally
- [LLaVA on Ollama](https://ollama.com/library/llava) - Vision-language model
- [Building Electron with FFmpeg](https://alexandercleasby.dev/blog/use-ffmpeg-electron) - Integration guide
- [Ollama API](https://github.com/ollama/ollama/blob/main/docs/api.md) - HTTP API documentation
