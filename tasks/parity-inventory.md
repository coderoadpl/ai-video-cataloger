# AI Video Cataloger Feature Inventory

Repo: the `ai-video-cataloger` checkout root.

Ignored: `node_modules`, `dist*`, `release`, `build`, `test-results`.

## 1. CLI Surface

Source: `src/index.ts`, `src/services/**`.

### Global CLI

- Binary name: `ai-video-cataloger` from `package.json`.
- Version: read from `package.json` in `src/index.ts`.
- Description: CLI for video analysis, local Whisper transcription, Claude/local analysis, content-based renaming.
- There is no wired default/root processing action in current `src/index.ts`; all active surfaces are subcommands.
- Supported video extensions for `process` and `thumbnail`: `.mp4`, `.mov`, `.avi`, `.mkv`, `.webm` in `src/index.ts`.
- Fatal top-level uncaught error prints `Fatal error:` and exits `1` in `src/index.ts`.

### `models`

Source: `src/index.ts`, `src/services/models.ts`, `src/services/local-ai-models.ts`.

- `models`: parent command, description “Manage Whisper and local AI models”.
- `models list [--json]`
  - Lists Whisper models and, in human mode only, local AI models.
  - Uses global home database, not cwd: `initDatabase(homedir())`.
  - Whisper models: `tiny` 75MB, `base` 142MB, `small` 466MB, `medium` 1.5GB, `large-v3` 3.1GB.
  - Post-parity addition: `large-v3-turbo` 1.6GB is a sanctioned deviation, owner-approved 2026-07-19.
  - Download status checks:
    - `~/.ai-video-cataloger/models/whisper/ggml-{name}.bin`
    - `~/.ai-video-cataloger/models/whisper/{name}.bin`
    - legacy `~/.cache/whisper/{name}.pt`
  - Active model from config key `whisper_model`, default `base`.
  - JSON: emits `started` command `models_list`, raw `{models}`, `completed {models}`.
  - Exit: normal `0`; fatal `1`.
- `models requirements [--json]`
  - Shows local AI model hardware tiers and runtime status.
  - JSON: `started models_requirements`, `completed { machine, runtimeUp, runtimeVersion, tiers }`.
  - Exit: normal `0`.
- `models pull <tag> [--json]`
  - Downloads local AI model via managed/system Ollama.
  - Starts/installs managed runtime if needed.
  - Blocks known unsupported tiers on non-Apple-Silicon or insufficient RAM.
  - Unknown tags are allowed through to Ollama.
  - JSON: `started models_pull`, `progress runtime_setup`, `progress model_download`, `completed {tag,status:'installed'}` or `error`.
  - Exit: `0` success, `1` failure.
- `models rm <tag> [--json]`
  - Removes local AI model from a running runtime only.
  - Does not start runtime.
  - JSON: `started models_rm`, `completed {tag,status:'removed'}` or `error`.
  - Exit: `0` success, `1` failure.
- `models daemon-stop [--json]`
  - Stops managed Ollama only; never touches user-owned system daemon.
  - JSON: `completed {stopped:boolean}`.
  - Exit: normal `0`.
- `models use <model-name> [--json]`
  - Valid models: `tiny`, `base`, `small`, `medium`, `large-v3`.
  - Stores `whisper_model` in global home database config.
  - Does not require model to be downloaded.
  - JSON: `started models_use`, raw result, `completed`.
  - Error code: `INVALID_MODEL`.
  - Exit: `0` success, `1` invalid.
- `models download <model-name> [--force] [--json]`
  - Downloads GGML Whisper model from Hugging Face to `~/.ai-video-cataloger/models/whisper/ggml-{model}.bin`.
  - Uses temp file `*.tmp`, then rename.
  - `--force` re-downloads if present.
  - Human mode shows progress bar and speed.
  - JSON: `started models_download`, `progress downloading`, raw result, `completed`.
  - Error codes: `INVALID_MODEL`, `DOWNLOAD_ERROR`.
  - Exit: `0` success/skipped, `1` error.
- `models delete <model-name> [--force] [--json]`
  - Deletes `~/.ai-video-cataloger/models/whisper/ggml-{model}.bin`.
  - Human mode without `--force`: prints confirmation-required message, returns deleted false, handler exits `0`.
  - JSON mode without `--force`: errors with `CONFIRMATION_REQUIRED`.
  - Error codes: `INVALID_MODEL`, `MODEL_NOT_FOUND`, `CONFIRMATION_REQUIRED`, `DELETE_ERROR`.
  - Exit: `0` success or human no-force skip, `1` error.

### `status`

Source: `src/index.ts`, `src/services/status.ts`.

- `status [--json]`
  - Initializes database in cwd.
  - Groups videos as Completed, In Progress, Pending, Error.
  - In-progress statuses: `frames_extracted`, `audio_extracted`, `transcribed`, `analyzed`.
  - JSON: `started status`, raw `{videos, summary}`, `completed {videos, summary}`.
  - Video JSON fields: `path`, `originalName`, `newName`, `status`, `statusLabel`, `errorMessage`, `createdAt`, `updatedAt`.
  - Exit: normal `0`.

### `reset`

Source: `src/index.ts`, `src/services/reset.ts`.

- `reset [filename] [--force] [--json]`
  - Without filename: clears all video records; preserves config.
  - With filename: resets one video by `original_name` to `pending`, clears `error_message` and `new_name`.
  - Human mode prompts unless `--force`.
  - JSON mode requires `--force` when an actual reset is needed.
  - `reset --json --force`: `started reset_all`, raw `{cleared, byStatus, configPreserved}`, `completed`.
  - Empty DB JSON: raw/completed `{cleared:0,message:'No video records in database'}`.
  - `reset <filename> --json --force`: `started reset_single`, raw/completed `{filename, previousStatus, newStatus:'pending', previousError}`.
  - Error codes: `FORCE_REQUIRED`, `VIDEO_NOT_FOUND`, `RESET_FAILED`.
  - Exit: `0` success/no-op, `1` cancelled/error.

### `process`

Source: `src/index.ts`, `src/services/frames.ts`, `src/services/audio.ts`, `src/services/transcription.ts`, `src/services/analyzer.ts`, `src/services/renamer.ts`.

- `process <video-path>`
- Flags:
  - `-f, --frames <number>` default `3`; parsed with `parseInt`.
  - `-s, --skip-rename` default `false`.
  - `-v, --verbose` default `false`.
  - `-t, --timeout <seconds>` default `120`; parsed with `parseInt`.
  - `-w, --whisper <mode>` default `local`; valid `local`, `api`, `skip`.
  - `--whisper-model <model>` default `base`; intended valid models `tiny`, `base`, `small`, `medium`, `large-v3`.
  - `--analyzer <backend>` valid `claude`, `local`; default resolves from per-folder config or `claude`.
  - `--local-model <tag>` default resolves from per-folder config or `gemma3:12b`.
  - `--json`.
- Validation:
  - Missing path: `FILE_NOT_FOUND`, exit `1`.
  - Unsupported extension: `INVALID_FILE_TYPE`, exit `1`.
  - Path not file: `NOT_A_FILE`, exit `1`.
  - `--whisper api` without `OPENAI_API_KEY`: `MISSING_API_KEY`, exit `1`.
  - Prerequisite failure: `PREREQUISITES_FAILED`, exit `1`.
- Per-folder DB:
  - Initializes database in video parent directory.
  - New video records use content hash from `src/utils/hash.ts`.
  - Existing records matched by exact original path.
- Analyzer resolution:
  - CLI flag > per-folder config > defaults.
  - Keys: `analyzer_backend`, `local_model`.
  - Local analyzer bumps timeout to `300` only when timeout was not explicitly passed.
- JSON:
  - `started process_single` with video path and options.
  - `progress` events for five steps:
    - `extracting_frames` 20%
    - `extracting_audio` 40%
    - `transcribing_audio` 60%
    - `analyzing_with_claude` 80% even when local analyzer is selected
    - `renaming_video` or `skipping_rename` 100%
  - Progress includes `current`, `total`, `data.video`, `data.stepNumber`, `data.totalSteps`.
  - `completed {video,path,status:'completed'}`.
  - Processing errors use `CodedError.code` when available, otherwise `PROCESSING_ERROR`.
- Pipeline:
  - `pending`: extract frames.
  - `frames_extracted`: extract audio.
  - `audio_extracted`: transcribe unless transcript exists.
  - `transcribed`: analyze.
  - `analyzed`: rename unless `--skip-rename`, then mark completed.
- Resume/smart retry:
  - Error records inspect existing frames/transcript.
  - Enough frames plus transcript resumes at analysis.
  - Enough frames only resumes at audio/transcription.
  - Partial frame count less than requested re-extracts.
- Exit: `0` success, `1` validation/prereq/processing error.

### `thumbnail`

Source: `src/index.ts`, `src/services/thumbnail.ts`.

- `thumbnail <video-path> [--force] [--json]`
- Validates file existence, video extension, and file type like `process`.
- Generates `.ai-video-cataloger/thumbnails/{video-base}.jpg`.
- Thumbnail is frame at 25% duration, scaled `128x72`.
- Skips existing thumbnail unless `--force`.
- JSON: `started thumbnail`, `completed {video,path,thumbnailPath,generated,skipped}`.
- Error codes: `FILE_NOT_FOUND`, `INVALID_FILE_TYPE`, `NOT_A_FILE`, `THUMBNAIL_ERROR`.
- Exit: `0` success/skipped, `1` error.

### `config`

Source: `src/index.ts`, `src/services/config.ts`, `src/db/database.ts`.

- `config get [key] [--json]`
  - Initializes database/config in cwd.
  - Without key: returns all known config values plus defaults.
  - With key: returns one value/default/description.
  - JSON all: `started config_get {key:null}`, raw `{config,defaults}`, `completed`.
  - JSON key: `started config_get {key}`, raw result, `completed`.
  - Error code: `UNKNOWN_CONFIG_KEY`.
  - Exit: `0` success, `1` unknown key.
- `config set <key> <value> [--json]`
  - Validates key and value; writes `.ai-video-cataloger/config.json`.
  - JSON: `started config_set`, `completed {key,value,previousValue}`.
  - Error codes: `UNKNOWN_CONFIG_KEY`, `INVALID_CONFIG_VALUE`.
  - Exit: `0` success, `1` invalid.

### `check`

Source: `src/index.ts`, `src/services/nested-check.ts`.

- `check [folder] [--json]`
- Defaults to cwd.
- Validates folder exists and is directory.
- Recursively scans for nested `.ai-video-cataloger` folders below root.
- Skips root-level `.ai-video-cataloger`, hidden dirs, `node_modules`, `__pycache__`.
- JSON: `started check`, `completed {hasNestedDatabases,nestedPaths,basePath,scannedDirectories}`.
- Validation errors: `FOLDER_NOT_FOUND`, `NOT_A_DIRECTORY`.
- Nested DB helper error code for blocking flows: `NESTED_DATABASES_FOUND`.
- Exit: `0` no nested DBs, `1` nested DBs or validation error.

### `scan`

Source: `src/index.ts`, `src/services/folder-scan.ts`.

- `scan <folder> [--json]`
- Validates folder exists and is directory.
- Non-recursively lists supported video files.
- Initializes DB in target folder, creating `.ai-video-cataloger` if possible.
- For each video:
  - path, filename, byte size, formatted size.
  - ffprobe duration and formatted duration.
  - partial content hash.
  - status from DB by path, falling back to content hash for renamed files.
  - artifacts: frames, transcript, structured summary, summary path, thumbnail path/mtime, new filename.
- JSON: `started scan`, raw result, `completed result`.
- Result summary: `total`, `tracked`, `pending`, `inProgress`, `completed`, `error`, `notTracked`.
- Validation errors: `FOLDER_NOT_FOUND`, `NOT_A_DIRECTORY`; read error: `READ_ERROR`.
- Exit: `0` success, `1` validation error.

### `doctor`

Source: `src/index.ts`, `src/services/doctor.ts`.

- `doctor [--json]`
- Checks:
  - ffmpeg/ffprobe availability.
  - Whisper availability.
  - Claude CLI availability.
  - Local AI managed/system Ollama feasibility/status.
- JSON: `started doctor`, `completed {dependencies,machine,recommendedLocalModel,allAvailable}`.
- Dependencies fields: `name`, `available`, `version`, `source`, `path`, `installHint`.
- Exit: `0` if all dependencies available, `1` if any unavailable.

### Interactive Menu Behavior

Source: `src/services/menu.ts`, exported via `src/services/index.ts`.

- Current code defines but does not invoke it from `src/index.ts`.
- `runInteractiveMenu(directory, defaultSettings)` loops until start/retry/exit.
- Counts videos non-recursively using same extensions.
- Main choices:
  - Start processing.
  - Retry failed videos, shown only if DB has status `error`.
  - Configure settings.
  - View current settings.
  - Exit.
- Settings submenu:
  - Transcription method: local Whisper, OpenAI API, skip.
  - Whisper model if local: tiny/base/small/medium/large-v3.
  - Frame count number prompt, valid 1-10.
  - Rename videos yes/no; stored in returned `skipRename`.
- `displayCurrentSettings` shows frames, rename yes/no, transcription mode, local model, timeout, retry failed.
- Return values:
  - `start`: settings with `retryErrors:false`.
  - `retry`: settings with `retryErrors:true`.
  - `exit`: `null`.

### JSON/NDJSON Event Types

Source: `src/services/json-output.ts`.

- Event types: `started`, `progress`, `completed`, `error`.
- Common field: `timestamp` ISO string.
- `started`: `{type:'started', timestamp, command, data?}`.
- `progress`: `{type:'progress', timestamp, step, percentage?, current?, total?, data?}`.
- `completed`: `{type:'completed', timestamp, data?}`.
- `error`: `{type:'error', timestamp, message, code?, data?}`.
- Some commands also output raw JSON data lines via `outputJson`; those lines do not have `type`.
- Renderer parses all JSON-looking stdout lines but only structured events with `type` are treated as events.

## 2. GUI Surface

Source: `electron/renderer/**`.

### App Shell

- `electron/renderer/src/App.tsx`
  - Composes all hooks and panels.
  - Hidden e2e state node: `data-testid="analysis-state"` with `data-analyzing`, `data-batch-processing`.
  - Modals mounted globally: nested DB, cancel confirmation, batch summary, settings, model manager, prerequisites.
- `electron/renderer/src/components/layout/app-layout.tsx`
  - Full app layout with resizable/collapsible sidebar and terminal.
  - Sidebar default/min/max: 280/200/400 px.
  - Terminal default/min/max: 200/100/500 px.
  - Terminal toolbar: JSON visibility toggle, copy log, clear log, collapse/expand.
  - Sidebar toolbar: hide/show sidebar.
- `electron/renderer/src/components/layout/resizable-panel.tsx`
  - Mouse-resizable horizontal/vertical panels.
  - Collapsed state sets width/height to 0.

### Header and Folder UI

- `electron/renderer/src/components/app-header.tsx`
  - Shows app title and version.
  - Buttons: Open Folder, Settings, Models, Prerequisites.
- `electron/renderer/src/components/folder-bar.tsx`
  - Split button for Open Folder.
  - Recent folder dropdown, click-outside closing.
  - Displays folder basename and full path in recent list.

### Sidebar

- `electron/renderer/src/components/sidebar-panel.tsx`
  - Empty state when no folder selected.
  - Folder header with basename/path.
  - “Generating thumbnails...” status.
  - Batch toolbar.
  - Video list.
- `electron/renderer/src/components/batch-toolbar.tsx`
  - Analyze All button for pending/not-tracked videos.
  - Batch progress: current/total, current filename, progress bar, Stop button.

### Video List

- `electron/renderer/src/components/video-list.tsx`
  - Loading state: “Scanning folder...”.
  - Empty state: “No videos found”.
  - Scrollable list of videos.
  - Thumbnail via `media://` with fallback film icon.
  - Status badges:
    - completed: Done.
    - error: Error plus error message.
    - pending: Pending.
    - intermediate: Incomplete.
    - currently analyzing: Processing spinner.
    - not_tracked: no badge.
  - Metadata shown per item: duration and size.
  - Selection by row click.

### Main Panel

- `electron/renderer/src/components/main-panel.tsx`
  - Welcome/getting started screen when no selected video.
  - Selected-video screen with optional progress overlay.
  - Progress overlay: step label, step number, percentage, progress bar, Cancel button.
- `electron/renderer/src/components/video-details/index.tsx`
  - Header with thumbnail, filename, path, status badge.
  - Metadata card.
  - Status description.
  - Status-specific actions.
  - Artifacts section.
- `electron/renderer/src/components/video-details/metadata-card.tsx`
  - Duration, size, location.
- `electron/renderer/src/components/video-details/status-info.tsx`
  - Status labels/descriptions for completed/error/pending/intermediate/not tracked/processing.
- `electron/renderer/src/components/video-details/status-actions.tsx`
  - Pending/not-tracked: Analyze Video.
  - Incomplete: warning card and Continue Analysis.
  - Error: failure card and Retry Analysis.
- `electron/renderer/src/components/video-details/artifacts-section.tsx`
  - Summary card with description and suggested filename.
  - Missing-summary empty state for analyzed/completed without summary.
  - Extracted frame gallery with main frame and selectable thumbnails.
  - Transcript card with scrollable text.
  - Collapsible Full AI Analysis details.

### Settings Modal

- `electron/renderer/src/components/settings-modal.tsx`
  - Requires current folder.
  - Loads config via `config get --json` with cwd=current folder.
  - Saves each changed key via `config set <key> <value> --json`.
  - Tracks unsaved changes and original values.
  - Controls:
    - Frame Count slider 1-10.
    - Transcription Mode select: local, api, skip.
    - Whisper Model select when local: tiny/base/small/medium/large-v3.
    - AI Analyzer section.
    - Skip Auto-Rename switch.
    - Reset, Cancel, Save.
- `electron/renderer/src/components/settings-options.ts`
  - GUI defaults mirror CLI defaults.
- `electron/renderer/src/components/settings-analyzer-section.tsx`
  - Backend select: Claude CLI or Local Ollama.
  - Local model select from hardware tiers.
  - Disables unsupported models.
  - Hints when selected model is unsupported or not installed.

### Model Manager Modal

- `electron/renderer/src/components/model-manager-modal/index.tsx`
  - Opens with Whisper model list via `models list --json`.
  - Shows total disk space used by downloaded Whisper models.
  - Download Whisper model with progress.
  - Click downloaded non-active model to activate.
  - Delete downloaded model through confirmation dialog.
  - Embeds Local AI section.
- `electron/renderer/src/components/model-manager-modal/model-row.tsx`
  - Status icon, active badge, download button, delete button, progress bar.
- `electron/renderer/src/components/model-manager-modal/delete-model-dialog.tsx`
  - Confirms deleting a Whisper model.
- `electron/renderer/src/components/model-manager-modal/types.ts`
  - Whisper size constants.

### Local AI Section

- `electron/renderer/src/components/local-ai/local-ai-section.tsx`
  - Shows machine summary: Apple Silicon/platform/arch and RAM.
  - Shows recommended model.
  - Lists local AI tiers with compatibility badges.
  - Download button for supported, missing tiers.
  - Delete button for installed tiers.
  - Progress bar for model pull.
- `electron/renderer/src/hooks/use-local-ai-models.ts`
  - Drives `models requirements`, `models pull`, `models rm`.

### Prerequisites Modal

- `electron/renderer/src/components/prerequisites-modal.tsx`
  - Runs `doctor --json` on open.
  - Shows loading, error/retry, or dependency list.
  - Summary banner for all satisfied vs missing count.
  - Dependency rows: status icon, name, source badge, version/path/hint.
  - Check Again button.
  - Help link shown if missing prerequisites.

### Terminal

- `electron/renderer/src/components/terminal-log.tsx`
  - Virtualized log with `@tanstack/react-virtual`.
  - ANSI rendering via pre-parsed segments.
  - JSON-line filtering.
  - Copy visible log as plain text.
  - Clear button if header enabled.
  - Auto-scroll unless user scrolls up.
  - “Scroll to bottom” button.
- `electron/renderer/src/hooks/use-terminal-log.ts`
  - Ring buffer max 5000 lines.
  - Tracks dropped line count.
  - Parses ANSI once at append time.
- `electron/renderer/src/hooks/use-terminal-prefs.ts`
  - Persists terminal collapsed and size in localStorage.
  - Defaults terminal collapsed in production, open in development.
  - `showJson` is in-memory only.

### Dialogs

- `electron/renderer/src/components/dialogs/nested-db-dialog.tsx`
  - Blocks folder open when nested `.ai-video-cataloger` directories are found.
  - Lists nested paths.
- `electron/renderer/src/components/dialogs/cancel-confirmation-dialog.tsx`
  - Single cancel warning: may leave incomplete state and partial artifacts.
  - Batch cancel warning: stop batch; current video may be incomplete; completed videos keep results.
- `electron/renderer/src/components/dialogs/batch-summary-dialog.tsx`
  - Shows success and failed counts.
  - Lists failed videos and errors.

### Renderer Hooks

- `electron/renderer/src/hooks/use-folder.ts`
  - Loads current/recent folders from IPC.
  - Opens native folder picker.
  - Runs `check` before accepting folders.
  - Sets current folder and recent list.
- `electron/renderer/src/hooks/use-catalog.ts`
  - Runs `scan`.
  - Replaces video list wholesale on every refresh.
  - Uses `contentHash` as stable selection key, fallback `path:{path}`.
- `electron/renderer/src/hooks/use-video-loader.ts`
  - Refreshes catalog, then generates missing thumbnails sequentially.
  - Cancels prior thumbnail generation when folder changes.
  - Refreshes once after thumbnail generation.
- `electron/renderer/src/hooks/use-batch-processor.ts`
  - Single analysis via `process`.
  - Batch analysis loops pending/not-tracked videos sequentially.
  - Continues past failures.
  - Cancellation via `AbortController` and CLI kill.
  - Builds progress state from CLI `progress` events.
- `electron/renderer/src/hooks/use-cli-command.ts`
  - Only renderer module that calls `electronAPI.cli`.
  - Always spawns CLI in JSON mode.
  - Filters all stdout/stderr/json/exit events by spawnId.
  - Cleans listeners after completion.
- `electron/renderer/src/hooks/use-menu-events.ts`
  - Subscribes to native menu event channels once and calls latest handlers.

## 3. IPC Bridge

Source: `electron/preload/preload.ts`, `electron/main/ipc-handlers.ts`, `electron/main/menu.ts`.

### Exposed APIs

- `contextBridge.exposeInMainWorld('electronAPI', electronAPI)` in `electron/preload/preload.ts`.
- `contextBridge.exposeInMainWorld('menuAPI', menuAPI)` in `electron/preload/preload.ts`.

### App and Window Channels

- `electronAPI.platform`: renderer reads `process.platform`; no IPC.
- `electronAPI.getAppVersion()` -> invoke `app:getVersion`; renderer to main; returns string.
- `electronAPI.closeWindow()` -> send `window:close`; renderer to main; no payload.
- `electronAPI.minimizeWindow()` -> send `window:minimize`; renderer to main; no payload.
- `electronAPI.maximizeWindow()` -> send `window:maximize`; renderer to main; toggles maximize/unmaximize.

### Folder Channels

- `folder.showPicker()` -> invoke `folder:showPicker`; renderer to main; returns `string | null`; opens native directory picker.
- `folder.getCurrent()` -> invoke `folder:getCurrent`; returns `string | null`.
- `folder.setCurrent(folderPath:string)` -> invoke `folder:setCurrent`; validates absolute existing directory, sets current, updates recent menu.
- `folder.getRecent()` -> invoke `folder:getRecent`; returns `string[]`.
- `folder.removeRecent(folderPath:string)` -> invoke `folder:removeRecent`; removes and updates menu.
- `folder.clearRecent()` -> invoke `folder:clearRecent`; clears store and menu.

### CLI Channels

- `cli.spawn(args:string[], options:{cwd?:string,json?:boolean})` -> invoke `cli:spawn`; returns `{spawnId:string,pid:number|undefined}`.
- `cli.kill(spawnId:string)` -> invoke `cli:kill`; returns boolean.
- `cli.killByPid(pid:number)` -> invoke `cli:killByPid`; returns boolean.
- `cli.killAll()` -> invoke `cli:killAll`; returns void.
- `cli.getActiveCount()` -> invoke `cli:getActiveCount`; returns number.
- `cli.onStdout(cb)` listens to main-to-renderer `cli:stdout`; payload `(spawnId,line)`.
- `cli.onStderr(cb)` listens to `cli:stderr`; payload `(spawnId,error)`.
- `cli.onJson(cb)` listens to `cli:json`; payload `(spawnId,jsonEvent)`.
- `cli.onExit(cb)` listens to `cli:exit`; payload `(spawnId,code,signal)`.

### Menu Event Channels

Source: `electron/main/menu.ts`, `electron/preload/preload.ts`.

- `menu:openFolder`: main to renderer; no payload.
- `menu:openRecentFolder`: main to renderer; payload `folderPath:string`.
- `menu:clearRecentFolders`: main to renderer; no payload.
- `menu:toggleTerminal`: main to renderer; no payload.
- `menu:toggleSidebar`: main to renderer; no payload.
- `menu:showSettings`: main to renderer; no payload.
- `menu:showPrerequisites`: main to renderer; no payload.
- `menu:showModelManager`: main to renderer; no payload.

### IPC Security

- `electron/main/ipc-handlers.ts` uses `isTrustedSender`.
- Only the first BrowserWindow’s `webContents` is accepted.
- Unauthorized invoke handlers throw or return safe default.
- `folder:setCurrent` accepts only absolute paths that stat as directories.

## 4. Services

Source: each file in `src/services/**`.

- `src/services/analyzer-config.ts`: Resolves analyzer backend, local model, and timeout from CLI flags, per-folder config, and defaults.
- `src/services/analyzer.ts`: Orchestrates frame/transcript collection, provider analysis, debug log, response parsing, summary writing, and status update.
- `src/services/audio.ts`: Detects audio tracks and extracts mono 16k WAV audio to temp storage with ffmpeg.
- `src/services/config.ts`: Defines config schema, validation, get/set helpers, and CLI config display behavior.
- `src/services/doctor.ts`: Checks dependency/runtime status for ffmpeg, Whisper, Claude CLI, and local AI.
- `src/services/env-filter.ts`: Removes debugger/Electron/VS Code/Claude nesting environment vars for subprocesses.
- `src/services/ffmpeg-setup.ts`: Resolves bundled ffmpeg/ffprobe via npm packages, falls back to system binaries, configures fluent-ffmpeg.
- `src/services/folder-scan.ts`: Scans a folder for videos, DB status, metadata, artifacts, and scan summaries.
- `src/services/frames.ts`: Extracts evenly spaced video frames to `frames/{video-base}/frame-NNN.jpg`.
- `src/services/hw-requirements.ts`: Defines local AI model hardware tiers and Apple Silicon/RAM support logic.
- `src/services/index.ts`: Barrel export for service modules.
- `src/services/json-output.ts`: NDJSON event model, emitters, human-output guards, and `CodedError`.
- `src/services/local-ai-models.ts`: CLI-facing local AI requirements/list/pull/remove/daemon-stop behavior.
- `src/services/menu.ts`: Unwired interactive CLI menu and settings prompts.
- `src/services/models.ts`: Whisper model list/download/delete/active-model management.
- `src/services/nested-check.ts`: Detects nested `.ai-video-cataloger` directories and emits blocking errors.
- `src/services/ollama-client.ts`: Minimal Ollama HTTP client for list, pull, delete, and multimodal chat.
- `src/services/ollama-setup.ts`: Managed Ollama runtime download, checksum verification, install, start, probe, stop.
- `src/services/prerequisites.ts`: Processing-time prerequisite checks for Node, ffmpeg, Claude CLI, and Whisper.
- `src/services/renamer.ts`: Renames videos and associated artifacts with date-prefixed unique filenames.
- `src/services/reset.ts`: Clears all records or resets one video to pending with confirmation/JSON handling.
- `src/services/scanner.ts`: Simple non-recursive video-file finder utility.
- `src/services/status.ts`: Builds and displays status/group summaries for tracked videos.
- `src/services/summary-format.ts`: Writes/reads structured summary JSON and generated human-readable TXT.
- `src/services/thumbnail.ts`: Generates cached 128x72 thumbnails at 25% video duration.
- `src/services/transcription.ts`: Transcribes extracted audio via local Whisper or OpenAI Whisper API, or skips.
- `src/services/whisper-setup.ts`: Resolves Whisper binary/model directories and Whisper availability.
- `src/services/analyzer-providers/claude-cli.ts`: Claude Code CLI analyzer provider using `claude --add-dir <dir> -p <prompt>`.
- `src/services/analyzer-providers/ollama.ts`: Local multimodal analyzer provider using managed/system Ollama.
- `src/services/analyzer-providers/response-format.ts`: Shared `DESCRIPTION:`/`FILENAME:` prompt contract and parser.
- `src/services/analyzer-providers/types.ts`: Analyzer provider interfaces and backend types.

## 5. Data

### SQLite Schema

Source: `src/db/database.ts`.

Database file: `{workingDir}/.ai-video-cataloger/catalog.db`.

Tables:

- `videos`
  - `id INTEGER PRIMARY KEY AUTOINCREMENT`
  - `original_path TEXT NOT NULL UNIQUE`
  - `original_name TEXT NOT NULL`
  - `new_name TEXT`
  - `file_hash TEXT NOT NULL`
  - `status TEXT NOT NULL DEFAULT 'pending'`
  - `created_at TEXT NOT NULL DEFAULT (datetime('now'))`
  - `updated_at TEXT NOT NULL DEFAULT (datetime('now'))`
  - `error_message TEXT`
- `config`
  - `key TEXT PRIMARY KEY`
  - `value TEXT NOT NULL`

Note: current config read/write uses `.ai-video-cataloger/config.json`; the SQLite `config` table still exists but is not used by `getConfig`/`setConfig`.

### Video Status Values

Source: `src/types/index.ts`.

- `pending`
- `frames_extracted`
- `audio_extracted`
- `transcribed`
- `analyzed`
- `completed`
- `error`

Renderer additionally uses `not_tracked`.

### Config Keys Stored

Source: `src/services/config.ts`, `src/db/database.ts`.

Persisted in `{folder}/.ai-video-cataloger/config.json` as string values.

- `whisper_model`: `tiny|base|small|medium|large-v3`; default `base`.
- `whisper_mode`: `local|api|skip`; default `local`.
- `frames`: number 1-10; default `3`.
- `timeout`: number 30-600 seconds; default `120`.
- `skip_rename`: boolean accepted as `true/false`, `yes/no`, `1/0`; default `false`.
- `analyzer_backend`: `claude|local`; default `claude`.
- `local_model`: string; default `gemma3:12b`.

### Per-Folder On-Disk Layout

Sources: `src/db/database.ts`, `src/services/frames.ts`, `src/services/transcription.ts`, `src/services/summary-format.ts`, `src/services/thumbnail.ts`, `src/services/analyzer.ts`, `src/services/renamer.ts`.

For a video folder:

- `.ai-video-cataloger/catalog.db`: sql.js SQLite DB.
- `.ai-video-cataloger/config.json`: folder config.
- `.ai-video-cataloger/thumbnails/{video-base}.jpg`: cached 128x72 thumbnails.
- `frames/{video-base}/frame-001.jpg`, `frame-002.jpg`, etc.: extracted analysis frames.
- `transcripts/{video-base}.txt`: transcript text.
- `summaries/{video-base}.json`: structured summary source of truth.
- `summaries/{video-base}.txt`: generated human-readable summary.
- `summaries/{video-base}-debug.log`: analyzer debug log with frame paths and raw response.
- Temporary audio: `${os.tmpdir()}/ai-video-cataloger/audio/{video-base}.wav`; removed best-effort after transcription.

### User Home Layout

Sources: `src/services/whisper-setup.ts`, `src/services/models.ts`, `src/services/ollama-setup.ts`.

- `~/.ai-video-cataloger/bin/whisper`: expected bundled Whisper binary location.
- `~/.ai-video-cataloger/models/whisper/ggml-{model}.bin`: Whisper GGML models.
- `~/.ai-video-cataloger/models/ollama`: private Ollama model directory for managed runtime.
- `~/.ai-video-cataloger/runtime/ollama-v0.31.1/ollama`: managed Ollama binary and extracted release.
- `~/.ai-video-cataloger/ollama-runtime.json`: managed runtime state `{port,pid,version}`.
- `~/.ai-video-cataloger/ollama.log`: managed runtime log.
- `~/.ai-video-cataloger/.ai-video-cataloger/catalog.db` and config may be created by global model commands because `initDatabase(homedir())` uses the standard DB subdirectory under home.
- Legacy model lookup: `~/.cache/whisper/{model}.pt`.

### Electron UserData Layout

Sources: `electron/main/folder-store.ts`, `electron/main/window-state.ts`.

Stored under `app.getPath('userData')`:

- `folder-store.json`: `{currentFolder:string|null,recentFolders:string[]}`; max recent folders 10.
- `window-state.json`: `{x?,y?,width,height,isMaximized?}`; default 1200x800, min accepted 900x600.

### Renderer LocalStorage

Source: `electron/renderer/src/hooks/use-terminal-prefs.ts`.

- `ai-video-cataloger:terminal-collapsed`: boolean string.
- `ai-video-cataloger:terminal-size`: number string.
- JSON visibility is not persisted.

## 6. Bundled / Managed Runtimes

### ffmpeg / ffprobe

Source: `src/services/ffmpeg-setup.ts`.

- ffmpeg resolved first from `ffmpeg-static`.
- ffprobe resolved first from `@ffprobe-installer/ffprobe`.
- Falls back to system commands `ffmpeg` and `ffprobe`.
- `configureFfmpeg()` sets fluent-ffmpeg paths once.
- Availability:
  - bundled if package path exists.
  - system if `ffmpeg -version` / `ffprobe -version` succeeds.
- Version:
  - `ffmpeg -version`, parse `ffmpeg version (\S+)`.
- No app-level download/verification logic beyond package install behavior.
- Used by frames, audio, scan, thumbnails.

### Whisper

Source: `src/services/whisper-setup.ts`, `src/services/models.ts`, `src/services/transcription.ts`.

- Binary resolution:
  - bundled preferred: `~/.ai-video-cataloger/bin/whisper`.
  - fallback: system `whisper`.
- Availability:
  - bundled path exists, or `whisper --help` succeeds.
- Version:
  - runs `whisper --help`, attempts regex version, otherwise `installed`.
- Model storage:
  - primary `~/.ai-video-cataloger/models/whisper/ggml-{model}.bin`.
  - direct `~/.ai-video-cataloger/models/whisper/{model}.bin`.
  - legacy `~/.cache/whisper/{model}.pt` for downloaded status.
- Model downloads:
  - Hugging Face `ggerganov/whisper.cpp`.
  - temp file then rename.
  - progress every 500ms.
  - no checksum verification in current code.
- Transcription local command:
  - `whisper <audioPath> --model <model> --output_dir <transcriptsDir> --output_format txt`.
- API transcription:
  - OpenAI client with `audio.transcriptions.create({file, model:'whisper-1'})`.
  - Requires `OPENAI_API_KEY`.
  - Handles API errors 401, 429, 413.

### Managed Ollama / Local AI

Sources: `src/services/ollama-setup.ts`, `src/services/ollama-client.ts`, `src/services/local-ai-models.ts`, `src/services/hw-requirements.ts`.

- Pinned version: `v0.31.1`.
- Release URL: `https://github.com/ollama/ollama/releases/download/v0.31.1/ollama-darwin.tgz`.
- SHA256 verification: `0c4f92389fcc1f651c17282e2eaffd68c8d3d06e1f7b307604102ad0e09a10c9`.
- Resolution/start order:
  - Prefer user-owned system daemon at `http://127.0.0.1:11434`.
  - Else reuse managed daemon from `~/.ai-video-cataloger/ollama-runtime.json` if probe succeeds.
  - Else download/extract/start managed runtime.
- Installation:
  - Downloads tarball to `download.tmp.tgz`.
  - Computes sha256.
  - Extracts whole archive to `~/.ai-video-cataloger/runtime/ollama-v0.31.1`.
  - Expects binary at `.../ollama`.
- Managed start:
  - Random port `9000-9999`.
  - Env `OLLAMA_HOST=127.0.0.1:{port}`.
  - Env `OLLAMA_MODELS=~/.ai-video-cataloger/models/ollama`.
  - Detached child process, stdio to `~/.ai-video-cataloger/ollama.log`.
  - Probes `/api/version` up to 30 seconds.
  - Writes state file.
- Stop:
  - `process.kill(pid, 'SIGTERM')` for managed state only.
  - Removes state file.
- Pull model:
  - POST `/api/pull`, streaming newline JSON.
  - Progress from `completed / total`.
  - Error maps:
    - 404 unknown model -> `MODEL_NOT_INSTALLED`.
    - runtime/server errors -> `OLLAMA_UNAVAILABLE`.
- Delete model:
  - DELETE `/api/delete`, 404 -> `MODEL_NOT_INSTALLED`.
- Chat vision:
  - POST `/api/chat` with one user message containing prompt and base64 images.
  - `stream:false`.
  - Empty response -> `OLLAMA_UNAVAILABLE`.

### Hardware Requirements Matrix

Source: `src/services/hw-requirements.ts`.

Local AI support is Apple Silicon only.

| Tag | Label | Download | Run RAM | Minimum machine RAM | Notes |
|---|---:|---:|---:|---:|---|
| `gemma3:4b` | Gemma 3 4B compact | 3.3 GB | 6 GB | 8 GB | Compact tier |
| `gemma3:12b` | Gemma 3 12B standard | 8.1 GB | 11 GB | 16 GB | Default/recommended |
| `gemma3:27b` | Gemma 3 27B max | 17 GB | 22 GB | 32 GB | Largest Gemma tier |
| `qwen2.5vl:7b` | Qwen 2.5 VL 7B alt vision | 6.0 GB | 9 GB | 16 GB | Alternate vision model |

Support levels:

- `ok`: Apple Silicon and enough RAM.
- `insufficient-ram`: Apple Silicon but below tier minimum.
- `unsupported-platform`: any non-Apple-Silicon platform.

## 7. Settings

### CLI / Folder Config

Sources: `src/services/config.ts`, `electron/renderer/src/components/settings-modal.tsx`.

- `frames`
  - CLI flag: `--frames`, default `3`.
  - Config key default `3`, valid 1-10.
  - GUI: slider 1-10.
  - Persisted: folder `.ai-video-cataloger/config.json`.
- `whisper_mode`
  - CLI flag: `--whisper`, default `local`.
  - Values `local`, `api`, `skip`.
  - GUI select.
  - Persisted: folder config.
- `whisper_model`
  - CLI flag: `--whisper-model`, default `base`.
  - Values `tiny`, `base`, `small`, `medium`, `large-v3`.
  - GUI select shown only when mode local.
  - Persisted: folder config and also global active model for `models use`.
- `timeout`
  - CLI flag: `--timeout`, default `120`.
  - Config key valid 30-600, default `120`.
  - GUI has no visible timeout control in current `settings-modal.tsx`, although it loads/saves if changed in state.
  - Local analyzer default becomes `300` when timeout not explicit.
- `skip_rename`
  - CLI flag: `--skip-rename`, default `false`.
  - GUI switch labeled Skip Auto-Rename.
  - Persisted: folder config.
- `analyzer_backend`
  - CLI flag: `--analyzer`.
  - Values `claude`, `local`.
  - Default `claude`.
  - GUI AI Analyzer select.
  - Persisted: folder config.
- `local_model`
  - CLI flag: `--local-model`.
  - Default `gemma3:12b`.
  - GUI local model select from tiers.
  - Persisted: folder config.

Important current behavior:

- In `src/index.ts`, `process` only reads per-folder config for analyzer backend/model/timeout. It does not currently read `frames`, `whisper_mode`, `whisper_model`, or `skip_rename` config in the process command path.
- GUI saves those keys, but single/batch analysis calls bare `process <path>`; therefore analyzer settings are honored through config, while some other saved settings appear not to affect processing unless CLI flags are passed elsewhere.

### GUI Preferences

Sources: `electron/main/folder-store.ts`, `electron/main/window-state.ts`, `electron/renderer/src/hooks/use-terminal-prefs.ts`.

- Recent folders:
  - Max 10.
  - Persisted in Electron userData `folder-store.json`.
- Current folder:
  - Persisted in `folder-store.json`.
- Window size/position/maximized:
  - Persisted in userData `window-state.json`.
  - Default 1200x800; BrowserWindow min 900x600.
- Terminal collapsed:
  - localStorage `ai-video-cataloger:terminal-collapsed`.
  - Default collapsed in production, open in development.
- Terminal size:
  - localStorage `ai-video-cataloger:terminal-size`.
  - Default 200.
- Terminal JSON visibility:
  - In-memory `showJson`, default `false`.

## 8. Packaging

Sources: `package.json`, `electron-builder.config.js`, `scripts/stage-cli.sh`, `electron/main/cli-spawner.ts`.

### Build Scripts

- `npm run build`: `tsc`.
- `npm run electron:build`: builds renderer, main, preload.
- `npm run electron:package`: `electron:build`, `package:stage`, `electron-builder`.
- `npm run package:stage`: builds CLI and runs `scripts/stage-cli.sh`.
- Renderer build: `cd electron/renderer && vite build`.
- Main/preload build: TypeScript project builds into `dist-electron`.

### electron-builder

- `appId`: `com.ai-video-cataloger.app`.
- `productName`: `AI Video Cataloger`.
- Output dir: `release`.
- Build resources dir: `build`.
- Files included: `dist-electron/**/*`.
- Extra resources:
  - `.cli-stage` copied to `resources/cli`.
  - Excludes `package-lock.json`.
- mac targets:
  - `dir` arm64.
  - `dmg` arm64.
- mac category: `public.app-category.utilities`.
- `darkModeSupport: true`.
- `hardenedRuntime: true`.
- `gatekeeperAssess: false`.
- Entitlements: `build/entitlements.mac.plist`.
- DMG layout includes app icon and `/Applications` link.

### CLI Staging

Source: `scripts/stage-cli.sh`.

- Removes and recreates `.cli-stage`.
- Copies root `package.json`, `package-lock.json`, and compiled `dist`.
- Runs `npm ci --omit=dev --no-audit --no-fund` inside `.cli-stage`.
- Production dependencies are included; postinstall scripts run so `ffmpeg-static` can install binary.

### Packaged CLI Spawning

Source: `electron/main/cli-spawner.ts`.

- Dev CLI path: `process.cwd()/dist/index.js`, run with `node`.
- Production CLI path: `process.resourcesPath/cli/dist/index.js`.
- Production runtime: Electron’s own Node using `process.execPath` with `ELECTRON_RUN_AS_NODE=1`.
- Default cwd: `app.getPath('home')` unless folder-scoped command provides cwd.
- Env filtering removes Electron, Node debug, VS Code, and `CLAUDECODE`.
- PATH extended with `/opt/homebrew/bin` and `/usr/local/bin`.

## 9. Tests

### E2E Parity Scenarios

Source: `test/e2e/scenarios.spec.ts`.

Runs identical scenario specs against two drivers:

- CLI driver: `test/e2e/drivers/cli-driver.ts`.
- GUI driver: `test/e2e/drivers/gui-driver.ts`.

Scenarios:

- S1 happy path per selected known-content sample:
  - Analyze sample.
  - Assert content-based rename matches `YYYY-MM-DD_slug.ext`.
  - Summary exists and mentions expected keyword.
  - Frames exist.
  - Transcript exists for samples expecting transcript.
  - Catalog status completed and `new_name` set.
  - Revert renames from catalog.
- S2 corrupt video:
  - Pipeline fails.
  - Original file untouched.
  - Catalog not completed.
  - No bogus summaries.
- S3 cancel mid-run:
  - Cancel after processing starts.
  - No rename.
  - Not completed.
  - Re-analyze completes.
- S4 batch:
  - Good videos complete.
  - Corrupt video fails.
  - Queue continues.
  - Two renamed videos and one untouched corrupt video.
  - Catalog has two completed rows and corrupt not completed.

E2E preflight: `test/e2e/preflight.ts`.

- Requires built CLI.
- Requires Electron build for GUI project.
- Verifies Claude CLI installed and authenticated with real prompt.
- Requires local Whisper for samples needing local whisper.
- Requires macOS `say` for synthetic speech fixture.
- For `E2E_ANALYZER=local`, requires reachable Ollama runtime and installed model.

Analyzer mode: `test/e2e/analyzer-mode.ts`.

- Default `E2E_ANALYZER=claude`.
- `E2E_ANALYZER=local`, `E2E_LOCAL_MODEL` default `gemma3:12b`.
- CLI driver adds `--analyzer local --local-model <model>`.
- GUI driver presets folder config.

### CLI Command Tests

Source: `test/commands/**`.

- `check.test.ts`: no nested DB, nested detection, folder not found, not directory, JSON shape.
- `config.test.ts`: get all/key, set string/number/boolean, unknown key, invalid enum/range/boolean.
- `doctor.test.ts`: dependency status, missing dependency reporting, JSON shape, no throw.
- `json-flag-placement.test.ts`: `--json` after subcommand for `check` and `scan`.
- `models-global-cwd.test.ts`: models list works from arbitrary cwd without touching it.
- `models-local-ai.test.ts`: requirements JSON/human, list exits cleanly, pull validation rejects unsupported tiers.
- `models.test.ts`: list JSON/human, use valid/invalid, download already-present/invalid, delete force/not-found/start event.
- `process.test.ts`: missing file, non-video, directory, prereq failure, missing API key, JSON structure.
- `reset.test.ts`: reset all, empty DB, JSON force behavior, reset single, not found, JSON structure.
- `scan.test.ts`: list videos, empty folder, no existing DB, folder errors, JSON shape.
- `status.test.ts`: grouped status, empty DB, JSON structure, error messages.
- `thumbnail.test.ts`: file errors, existing thumbnail skip, force regenerate, JSON structure.

### Unit / Integration Tests

- `test/analyzer-config.test.ts`: analyzer precedence/default timeout/local timeout/invalid config fallback.
- `test/hw-requirements.test.ts`: tier matrix and recommendations.
- `test/media-scope.test.ts`: `media://` scoping, symlinks, traversal, extension allowlist, size limit, null root.
- `test/ollama-client.test.ts`: model list/install detection, pull progress, pull/delete/chat error mapping.
- `test/summary-format.test.ts`: paths, atomic JSON write, TXT render, read validation and invalid cases.
- `test/architecture.test.ts`: renderer state architecture invariants and deleted legacy channels/summary parsing.
- `electron/renderer/src/hooks/use-catalog.test.tsx`: selection survives rename, list replacement no ghosts, thumbnail mtime URL change, clear missing selection.
- `electron/renderer/src/hooks/use-cli-command.test.ts`: spawnId isolation, abort kills own spawn, JSON mode/stderr forwarding.
- `electron/renderer/src/hooks/use-terminal-log.test.tsx`: 5000-line ring buffer, ANSI segment storage, parse-once behavior.
- `electron/renderer/src/components/local-ai/local-ai-section.test.tsx`: local AI tier badges, download progress, refresh, settings warning.

## 10. Rewrite-Critical Behavior

### Error Recovery and Resume

Sources: `src/index.ts`, `src/services/frames.ts`, `src/services/transcription.ts`, `src/services/summary-format.ts`.

- Pipeline status is step-based and persisted after each step.
- Re-running an interrupted video resumes from DB status.
- Error retry uses artifact inspection:
  - Enough frames plus transcript: resume analysis.
  - Enough frames only: resume after frame extraction.
  - Partial frames below requested count: restart extraction.
- Existing transcript skips transcription.
- Temp audio is cleaned after transcription.
- Missing or invalid summary JSON prevents rename from `analyzed` resume and emits `ANALYSIS_PARSE_FAILED`.

### Conflict Handling

Source: `src/services/renamer.ts`.

- Suggested filename is sanitized to kebab-case; fallback slug `video`.
- New filename format: `{yyyy-MM-dd}_{slug}{ext}` using video mtime.
- If target exists, appends `-2`, `-3`, etc.
- Renames associated artifacts:
  - frames directory.
  - transcript TXT.
  - summary TXT.
  - summary JSON.
  - thumbnail JPG.
- DB stores `new_name` and status `completed`.
- Note: `updateVideoPath` exists in DB service but `renameVideo` currently updates only `new_name` and status, not `original_path`.

### Analysis Contract

Sources: `src/services/analyzer-providers/response-format.ts`, `src/services/analyzer.ts`.

- Providers must output:
  - `DESCRIPTION: ...`
  - `FILENAME: ...`
- Parser supports multi-line description.
- Filename is normalized to lowercase kebab-case.
- Missing filename throws `ANALYSIS_PARSE_FAILED`.
- Missing description falls back to first 500 chars of response.
- Summary JSON is the source of truth; TXT is generated from it.
- Debug log is written before parsing so failures preserve raw response.

### Claude Provider

Source: `src/services/analyzer-providers/claude-cli.ts`.

- Prompt includes transcript if present, otherwise notes no audio/transcript.
- Frames included as `file://` URLs.
- Runs `claude --add-dir <videoDir> -p <prompt>`.
- Clears Claude project conversation history for video directory under `~/.claude/projects/-<path-with-dashes>` to avoid corrupted/oversized context SIGTRAP.
- Uses filtered env.
- Verbose mode streams stdout/stderr and prints prompt/frame paths.

### Local Analyzer Provider

Source: `src/services/analyzer-providers/ollama.ts`.

- Ensures runtime.
- Checks selected model installed before chat.
- Reads frames as base64 images.
- Uses same response contract as Claude.
- Error code for missing model: `MODEL_NOT_INSTALLED`.

### Folder Safety

Sources: `src/services/nested-check.ts`, `electron/renderer/src/hooks/use-folder.ts`.

- GUI blocks opening folders containing nested `.ai-video-cataloger` directories.
- CLI `check` exits nonzero on nested DBs.
- Rationale shown to user: avoid conflicting tracking databases.
- Scan itself is non-recursive, but nested DB guard recurses.

### Media Security

Sources: `electron/main/media-protocol.ts`, `electron/main/media-scope.ts`.

- Custom `media://local/{encodeURIComponent(absPath)}` scheme.
- Only image extensions `.jpg`, `.jpeg`, `.png`, `.webp`.
- Requires current folder scope.
- Resolves realpaths for root and requested file.
- Rejects traversal/symlink escape outside root.
- Rejects non-files and files over 20 MB.
- Malformed URLs return 403.

### CLI Spawner / GUI Backend

Sources: `electron/main/cli-spawner.ts`, `electron/renderer/src/hooks/use-cli-command.ts`.

- Renderer never directly implements processing; it shells out to CLI.
- JSON flag insertion is subcommand-aware: `[cmd, '--json', ...args]`.
- Raw stdout is always forwarded to terminal even in JSON mode.
- JSON events are parsed additionally for UI progress.
- Abort kills the spawned process via `cli.kill(spawnId)`.
- Active processes are cleaned up on app quit.

### Menus and Shortcuts

Sources: `electron/main/menu.ts`, `electron/preload/preload.ts`, `electron/renderer/src/hooks/use-menu-events.ts`.

- macOS app menu:
  - About.
  - Settings `Cmd+,`.
  - Services, hide/show, quit.
- File:
  - Open Folder `CmdOrCtrl+O`.
  - Recent Folders submenu.
  - Clear Recent.
  - Close/Quit.
- Edit:
  - Undo/redo/cut/copy/paste/delete/select all.
  - macOS paste-and-match-style and speech submenu.
- View:
  - Toggle Terminal Log `CmdOrCtrl+T`.
  - Toggle Sidebar `CmdOrCtrl+B`.
  - Reload/force reload/devtools.
  - Zoom controls.
  - Fullscreen.
- Window:
  - Minimize/zoom/front/window roles.
- Help:
  - Prerequisites.
  - Model Manager.
  - Learn More opens Claude Code GitHub URL.

### First Launch / Empty States

Sources: `electron/renderer/src/components/main-panel.tsx`, `electron/renderer/src/components/sidebar-panel.tsx`.

- No formal multi-step first-launch wizard exists.
- First screen is a welcome/getting-started panel when no video selected.
- Sidebar says no folder selected and instructs Open Folder.
- Settings modal asks user to select a folder first.
- Model Manager and Prerequisites are globally available before folder selection.

### Known Compatibility Details

- GUI relies on CLI `scan` completed event data as single source of catalog truth.
- Selection survives renames through content hash.
- Lists are replaced wholesale after scan to avoid stale ghost entries.
- Thumbnail mtime is used as cache buster in renderer URLs.
- Terminal log can hide raw JSON while still preserving it in the buffer.
- Local AI read-only status commands do not start/download runtime; pull/analyze are the start points.
- `config.ts` currently contains a duplicated `const keyDef = CONFIG_KEYS[key];` inside `displayConfigKey`; this is source behavior to be aware of during rewrite parity review.
