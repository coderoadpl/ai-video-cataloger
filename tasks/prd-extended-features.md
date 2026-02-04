# PRD: AI Video Cataloger Extended Features

## Introduction

Extend the AI Video Cataloger MVP with additional features from the original plan.md: an interactive settings menu, Whisper model management, database status/reset commands, Whisper API mode, and improved Claude analysis with timeout handling. These features make the tool more user-friendly and configurable.

## Goals

- Add interactive menu for configuring settings before processing (default behavior)
- Support multiple Whisper modes: local, OpenAI API, and skip
- Allow downloading and selecting different Whisper models
- Provide database status and reset commands
- Add timeout handling for Claude CLI to prevent hanging
- Maintain backward compatibility with existing CLI flags

## User Stories

### US-015: Interactive Settings Menu
**Description:** As a user, I want an interactive menu when I run the tool so I can configure settings before processing starts.

**Acceptance Criteria:**
- [ ] Running `ai-video-cataloger` without flags shows interactive menu
- [ ] Menu displays count of videos found in directory
- [ ] Menu options: "Start with defaults", "Configure settings", "View current settings", "Exit"
- [ ] Uses inquirer package for interactive prompts
- [ ] Add `--yes` or `-y` flag to skip menu and use defaults
- [ ] Add `--non-interactive` flag for script usage
- [ ] Typecheck passes

### US-016: Settings Configuration Submenu
**Description:** As a user, I want to configure transcription, frames, and renaming options through the menu so I can customize processing.

**Acceptance Criteria:**
- [ ] "Configure settings" opens submenu with options
- [ ] Transcription method: Local Whisper / OpenAI API / Skip transcription
- [ ] Whisper model selection (if local): tiny, base, small, medium, large-v3
- [ ] Frame count: numeric input (1-10)
- [ ] Rename videos: yes/no toggle
- [ ] Settings passed to processing pipeline
- [ ] Typecheck passes

### US-017: Whisper API Mode
**Description:** As a user, I want to use OpenAI's Whisper API instead of local Whisper so I can transcribe without installing Whisper locally.

**Acceptance Criteria:**
- [ ] Add `--whisper api` CLI flag to use OpenAI Whisper API
- [ ] Add `--whisper local` CLI flag (default) for local Whisper
- [ ] Add `--whisper skip` or `--skip-transcribe` to skip transcription entirely
- [ ] API mode requires OPENAI_API_KEY environment variable
- [ ] Display clear error if API key missing when API mode selected
- [ ] Prerequisite check skips local Whisper if using API mode
- [ ] Typecheck passes

### US-018: Model Management - List Models
**Description:** As a user, I want to see which Whisper models are available and downloaded so I can choose the right one.

**Acceptance Criteria:**
- [ ] `ai-video-cataloger models list` shows available models
- [ ] Display model name, size, and download status (downloaded/not downloaded)
- [ ] Mark currently active model
- [ ] Models: tiny (75MB), base (142MB), small (466MB), medium (1.5GB), large-v3 (3.1GB)
- [ ] Typecheck passes

### US-019: Model Management - Download Model
**Description:** As a user, I want to download a specific Whisper model so I can use higher quality transcription.

**Acceptance Criteria:**
- [ ] `ai-video-cataloger models download` shows interactive model selection
- [ ] `ai-video-cataloger models download <model-name>` downloads specific model
- [ ] Show download progress
- [ ] Store download status in database
- [ ] Handle download errors gracefully
- [ ] Typecheck passes

### US-020: Model Management - Set Active Model
**Description:** As a user, I want to select which Whisper model to use by default so I don't have to specify it each time.

**Acceptance Criteria:**
- [ ] `ai-video-cataloger models use <model-name>` sets active model
- [ ] Validate model is downloaded before setting active
- [ ] Store active model in database config table
- [ ] Processing uses active model unless overridden
- [ ] Typecheck passes

### US-021: Database Status Command
**Description:** As a user, I want to see the processing status of all videos so I can track progress.

**Acceptance Criteria:**
- [ ] `ai-video-cataloger status` shows all tracked videos
- [ ] Display: filename, status, error message (if any)
- [ ] Group by status: completed, in progress, pending, error
- [ ] Show counts for each status group
- [ ] Handle empty database gracefully
- [ ] Typecheck passes

### US-022: Database Reset Command
**Description:** As a user, I want to reset the database so I can start fresh or reprocess specific videos.

**Acceptance Criteria:**
- [ ] `ai-video-cataloger reset` prompts for confirmation then clears all data
- [ ] `ai-video-cataloger reset <filename>` resets specific video to pending
- [ ] `--force` flag skips confirmation prompt
- [ ] Display what will be reset before confirmation
- [ ] Typecheck passes

### US-023: Claude Analysis Timeout Handling
**Description:** As a user, I want the Claude analysis to have a timeout so the tool doesn't hang indefinitely.

**Acceptance Criteria:**
- [ ] Add configurable timeout for Claude CLI calls (default: 120 seconds)
- [ ] Display spinner with elapsed time during analysis
- [ ] On timeout, mark video as error with "Analysis timed out" message
- [ ] Add `--timeout <seconds>` CLI flag to override default
- [ ] Continue processing remaining videos after timeout
- [ ] Typecheck passes

### US-024: Claude Analysis Progress Streaming
**Description:** As a user, I want to see Claude's analysis output in real-time so I know it's working.

**Acceptance Criteria:**
- [ ] Stream Claude CLI output to terminal in verbose mode
- [ ] Show truncated preview of response in normal mode
- [ ] Display "Analyzing... (X seconds elapsed)" during long analyses
- [ ] Typecheck passes

## Functional Requirements

- FR-1: Add inquirer as dependency for interactive prompts
- FR-2: Add openai as dependency for Whisper API mode
- FR-3: Interactive menu is default; `--yes`/`-y` skips to defaults
- FR-4: Settings from menu override CLI flags
- FR-5: `models` subcommand with list/download/use actions
- FR-6: `status` subcommand shows video processing status
- FR-7: `reset` subcommand clears database with confirmation
- FR-8: Claude CLI calls have 120-second default timeout
- FR-9: Whisper mode stored in database config for persistence
- FR-10: Active model stored in database config table

## Non-Goals

- No web UI for browsing cataloged videos
- No recursive directory scanning (existing limitation)
- No configuration file support (.videocatalogerrc)
- No whisper.cpp support (only openai-whisper and API)
- No local vision models as Claude alternative

## Technical Considerations

- inquirer package for interactive CLI prompts
- openai package for Whisper API integration
- Commander.js subcommands for models/status/reset
- execa timeout option for Claude CLI calls
- Whisper models stored in standard cache location (~/.cache/whisper)

## Success Metrics

- Interactive menu loads in under 1 second
- Claude analysis completes or times out within configured limit
- Model download shows accurate progress percentage
- All commands respond within 2 seconds for database operations

## Open Questions

- Should settings persist between runs (save to config)?
- Should we support whisper.cpp as an alternative to openai-whisper?
- What's the ideal default timeout for Claude analysis?
