export type Locale = 'en' | 'pl';

export interface Dictionary {
  locale: Locale;
  common: {
    save: string;
    cancel: string;
    close: string;
    back: string;
    next: string;
    saved: string;
    openSettings: string;
  };
  language: {
    stepTitle: string;
    stepDescription: string;
    uiLabel: string;
    uiHelper: string;
    outputLabel: string;
    outputHelper: string;
    optionAuto: string;
    optionEnglish: string;
    optionPolish: string;
  };
  settings: {
    languageSectionTitle: string;
    savedToast: string;
  };
  appHeader: {
    searchPlaceholder: string;
    recentSearches: string;
    topTags: string;
    removeRecentSearch: (label: string) => string;
    settings: string;
    models: string;
    prerequisites: string;
  };
  batchToolbar: {
    analyzeScope: string;
    thisFolder: string;
    wholeTree: string;
    processingCount: (current: number, total: number) => string;
    stop: string;
    analyzeAll: (count: number) => string;
  };
  catalog: {
    noFolderSelected: string;
    openFolderHint: string;
    generatingThumbnails: string;
    folderCounts: (pending: number, processed: number) => string;
    skipped: string;
    genericScanError: string;
    scanningFolder: string;
    noVideosFound: string;
    absentSectionTitle: string;
    absentLastSeen: (date: string) => string;
    forgetEntry: string;
    forgetEntryConfirmTitle: string;
    forgetEntryConfirmBody: (name: string) => string;
    forgetEntryConfirm: string;
  };
  details: {
    welcomeTitle: string;
    welcomeBody: string;
    gettingStarted: string;
    gettingStartedSteps: readonly string[];
    videoTags: string;
    videoInformation: string;
    duration: string;
    unknown: string;
    size: string;
    location: string;
    summary: string;
    suggestedFilename: string;
    noSummaryAvailable: string;
    extractedFrames: (count: number) => string;
    frame: (index: number) => string;
    transcript: string;
    fullAiAnalysis: string;
    analyzeVideo: string;
    analyzingButton: string;
    analyzeHint: string;
    processingIncomplete: string;
    incompleteHint: string;
    processingButton: string;
    continueAnalysis: string;
    processingFailed: string;
    retrying: string;
    retryAnalysis: string;
    status: {
      analyzing: string;
      completed: string;
      error: string;
      pending: string;
      framesExtracted: string;
      audioExtracted: string;
      transcribed: string;
      analyzed: string;
      notTracked: string;
    };
  };
  search: {
    genericError: string;
    searchingCatalog: string;
    noResultsFound: string;
    resultCount: (count: number) => string;
    resultsFor: (query: string) => string;
    driveNotConnected: string;
    fileMissing: string;
  };
  wizard: {
    stepLabels: {
      welcome: string;
      language: string;
      analyzer: string;
      transcription: string;
      downloads: string;
      readiness: string;
      done: string;
    };
    nextLabels: {
      getStarted: string;
      continue: string;
      installAndContinue: string;
      finish: string;
    };
    setupWizard: string;
    configureLater: string;
    back: string;
    welcome: {
      title: string;
      body: string;
      privacy: string;
    };
    analyzer: {
      title: string;
      familyLabel: string;
      local: string;
      recommendedSuffix: string;
      api: string;
      harness: string;
      localAppleSiliconWarning: string;
      localModel: string;
      recommendedForThisMac: string;
      installedSuffix: string;
      downloadGb: (gb: number) => string;
      baseUrl: string;
      model: string;
      apiKey: string;
      inputPrice: string;
      outputPrice: string;
      installed: string;
      installedVersion: (version: string) => string;
      notDetected: string;
      checking: string;
    };
    transcription: {
      title: string;
      managedLabel: string;
      managedDescription: string;
      ownLabel: string;
      ownDescription: string;
      apiLabel: string;
      apiDescription: string;
      skipLabel: string;
      skipDescription: string;
      whisperModel: string;
      installedSuffix: string;
      buildToolsWarning: (tools: string) => string;
      whisperBinaryPath: string;
      openAiApiKey: string;
      openAiApiKeyHelper: string;
    };
    downloads: {
      title: string;
      done: string;
      failed: string;
      none: string;
    };
    readiness: {
      title: string;
      checking: string;
      ready: string;
      notReady: string;
    };
    done: {
      title: string;
      incomplete: string;
      skip: string;
      ready: string;
    };
    controller: {
      noHarnessAvailable: string;
      analyzerSaved: string;
      whisperBinaryPathRequired: string;
      transcriptionSaved: string;
      downloadFailed: string;
      downloadingLocalModel: (tag: string) => string;
      buildingManagedWhisperRuntime: string;
      downloadingWhisperModel: (model: string) => string;
      whisperModelActive: (model: string) => string;
    };
    checklist: {
      dependencyNames: Record<string, string>;
      dependencyDescriptions: Record<string, string>;
      checkedSystemDependency: string;
      fixInTranscription: string;
      configuredAnalyzer: (providerId: string) => string;
      configuredAnalyzerDescription: string;
      backToAnalyzer: string;
      configuredWhisperModel: (model: string) => string;
      configuredWhisperModelDescription: string;
      useModel: (model: string) => string;
      downloadModel: (model: string) => string;
      configuredTranscriptionApi: string;
      configuredTranscriptionApiDescription: string;
    };
  };
  models: {
    managerTitle: string;
    whisperModelsTitle: string;
    checkingWhisperRuntime: string;
    runtimeStatus: (source: string | null, path: string | null) => string;
    installing: string;
    install: string;
    runtimeNotInstalled: string;
    managedBuildRequires: (tools: string) => string;
    loadingModels: string;
    retry: string;
    diskSpaceUsed: (usage: string) => string;
    active: string;
    downloaded: string;
    clickToActivate: string;
    notDownloaded: string;
    delete: string;
    download: string;
    localAiTitle: string;
    localAiDescription: string;
    yourMac: string;
    appleSilicon: string;
    recommended: string;
    loadingLocalAi: string;
    compatible: string;
    needsRam: (gb: number) => string;
    appleSiliconRequired: string;
    downloadGb: (gb: number) => string;
    downloading: string;
    deleteModelTitle: string;
    deleteModelText: (modelName: string | null) => string;
    terminal: {
      downloadingWhisper: (model: string) => string;
      whisperDownloaded: (model: string) => string;
      failedDownload: (model: string, message: string) => string;
      downloadedToast: (model: string) => string;
      settingActive: (model: string) => string;
      modelActive: (model: string) => string;
      failedActivate: (model: string, message: string) => string;
      deletingModel: (model: string) => string;
      modelDeleted: (model: string) => string;
      deletedToast: (model: string) => string;
      failedDelete: (model: string, message: string) => string;
      downloadingLocalAi: (tag: string, gb: number) => string;
      localAiReady: (tag: string) => string;
      failedLocalAiDownload: (tag: string, message: string) => string;
      removingLocalAi: (tag: string) => string;
      removedLocalAi: (tag: string) => string;
      failedLocalAiRemove: (tag: string, message: string) => string;
      buildingWhisperRuntime: string;
      whisperRuntimeReady: string;
      failedWhisperRuntimeInstall: (message: string) => string;
      unknownError: string;
    };
  };
  prerequisites: {
    title: string;
    checking: string;
    retry: string;
    allSatisfied: string;
    missingCount: (count: number) => string;
    selectedFolderConfiguration: string;
    selectedFolderReady: string;
    mustBeConfigured: (pieces: string) => string;
    systemDependencies: string;
    close: string;
    checkAgain: string;
    available: string;
    version: (version: string) => string;
    notFound: string;
    dependencyDisplayNames: Record<string, string>;
  };
  readinessNotice: {
    title: string;
    missing: (pieces: string) => string;
    openSettings: string;
    openSetupWizard: string;
  };
  processing: {
    driveRunStarted: (folders: number, files: number) => string;
    driveFolderStarted: (path: string, files: number) => string;
    driveFolderDone: (path: string, done: number, skipped: number, failed: number) => string;
    driveFileSkipped: (filename: string) => string;
    driveRunComplete: (foldersDone: number, foldersTotal: number, done: number, skipped: number, failed: number) => string;
    progressLine: (percentage: number, label: string) => string;
    fileProgressLine: (current: number, total: number, label: string, filename: string) => string;
    error: (message: string) => string;
    analysisCompleted: (filename: string) => string;
    cancelledByUser: string;
    processingFailed: string;
    processingDidNotFinish: string;
    setupIncomplete: string;
    startingAnalysis: (filename: string) => string;
    noPendingVideos: string;
    batchStart: (count: number) => string;
    batchCancelled: (processed: number, total: number) => string;
    batchProcessing: (current: number, total: number, filename: string) => string;
    batchComplete: string;
    successCount: (count: number) => string;
    failedCount: (count: number) => string;
    folderTreeCompleted: string;
    driveProcessingFailed: string;
    driveProcessingDidNotFinish: string;
    driveStart: (root: string) => string;
    stoppingDrive: string;
    cancellingCurrentAndBatch: string;
    cancellingAnalysis: string;
  };
  people: {
    disabledTitle: string;
    disabledBody: string;
    emptyTitle: string;
    emptyBody: string;
    title: string;
    subtitle: string;
    mergeSelected: string;
    indexFaces: string;
    localFaceGroupingOffTitle: string;
    localFaceGroupingOffBody: string;
    modelsMissingTitle: string;
    modelsMissingBody: string;
    installModels: string;
    noFaceGroupingsTitle: string;
    noFolderBody: string;
    runIndexingBody: string;
    dangerArea: string;
    dangerBody: string;
    deleteAllFaceData: string;
    renameGrouping: string;
    displayName: string;
    personName: (index: number) => string;
    mergeGroupings: string;
    mergeBody: (from: string, to: string) => string;
    merge: string;
    deleteFaceGrouping: string;
    deleteFaceGroupingBody: string;
    deleteAllFaceDataBody: string;
    deleteAll: string;
    loadingPeople: string;
    selectPerson: (name: string) => string;
    observationCount: (count: number) => string;
    rename: string;
    delete: string;
  };
}

export const en: Dictionary = {
  locale: 'en',
  common: {
    save: 'Save',
    cancel: 'Cancel',
    close: 'Close',
    back: 'Back',
    next: 'Next',
    saved: 'Saved',
    openSettings: 'Open Settings',
  },
  language: {
    stepTitle: 'Language',
    stepDescription: 'Choose the interface language and the language for generated descriptions and filenames. You can change both later in Settings.',
    uiLabel: 'App language',
    uiHelper: 'Language of the desktop app interface.',
    outputLabel: 'Description language',
    outputHelper: 'Language the AI writes descriptions and filenames in. Tags always stay in English.',
    optionAuto: 'Automatic (model chooses)',
    optionEnglish: 'English',
    optionPolish: 'Polish',
  },
  settings: {
    languageSectionTitle: 'Language',
    savedToast: 'Settings saved',
  },
  appHeader: {
    searchPlaceholder: 'Search catalog',
    recentSearches: 'Recent searches',
    topTags: 'Top tags',
    removeRecentSearch: (label: string) => `Remove ${label}`,
    settings: 'Settings',
    models: 'Models',
    prerequisites: 'Prerequisites',
  },
  batchToolbar: {
    analyzeScope: 'Analyze scope',
    thisFolder: 'This folder',
    wholeTree: 'Whole tree',
    processingCount: (current, total) => `Processing ${current} of ${total}`,
    stop: 'Stop',
    analyzeAll: (count) => `Analyze All (${count})`,
  },
  catalog: {
    noFolderSelected: 'No folder selected',
    openFolderHint: 'Open a folder to catalog its videos.',
    generatingThumbnails: 'Generating thumbnails…',
    folderCounts: (pending, processed) => `${pending} pending · ${processed} done`,
    skipped: 'Skipped',
    genericScanError: 'Could not scan this folder.',
    scanningFolder: 'Scanning folder…',
    noVideosFound: 'No videos found',
    absentSectionTitle: 'Previously cataloged, now absent',
    absentLastSeen: (date) => `Last seen ${date}`,
    forgetEntry: 'Forget',
    forgetEntryConfirmTitle: 'Forget catalog entry',
    forgetEntryConfirmBody: (name) => `Permanently remove ${name} from the catalog? This deletes its analysis and search data. It cannot be undone.`,
    forgetEntryConfirm: 'Forget',
  },
  details: {
    welcomeTitle: 'Welcome to AI Video Cataloger',
    welcomeBody: 'Select a folder containing videos to get started. The app analyzes your videos locally to generate summaries, transcriptions, and smart file names.',
    gettingStarted: 'Getting Started',
    gettingStartedSteps: [
      'Click "Open Folder" to select a folder with video files',
      'The sidebar will show all detected videos',
      'Select a video to view details and analysis results',
      'Click "Analyze" to process individual videos',
      'Terminal output shows real-time progress',
    ],
    videoTags: 'Video tags',
    videoInformation: 'Video Information',
    duration: 'Duration',
    unknown: 'Unknown',
    size: 'Size',
    location: 'Location',
    summary: 'Summary',
    suggestedFilename: 'Suggested filename:',
    noSummaryAvailable: 'No summary available. Run the analysis again to generate it.',
    extractedFrames: (count) => `Extracted Frames (${count})`,
    frame: (index) => `Frame ${index}`,
    transcript: 'Transcript',
    fullAiAnalysis: 'Full AI Analysis',
    analyzeVideo: 'Analyze Video',
    analyzingButton: 'Analyzing…',
    analyzeHint: 'This will extract frames, transcribe audio, and generate a summary using AI.',
    processingIncomplete: 'Processing Incomplete',
    incompleteHint: 'A previous processing attempt was interrupted. Click the button below to restart.',
    processingButton: 'Processing…',
    continueAnalysis: 'Continue Analysis',
    processingFailed: 'Processing Failed',
    retrying: 'Retrying…',
    retryAnalysis: 'Retry Analysis',
    status: {
      analyzing: 'Video is being processed…',
      completed: 'Analysis complete. Summary, transcript, and frames are available.',
      error: 'An error occurred during processing.',
      pending: 'Ready to be analyzed.',
      framesExtracted: 'Processing was interrupted at frames extraction step. Click Analyze to continue.',
      audioExtracted: 'Processing was interrupted at audio extraction step. Click Analyze to continue.',
      transcribed: 'Processing was interrupted at transcription step. Click Analyze to continue.',
      analyzed: 'Processing was interrupted at analysis step. Click Analyze to continue.',
      notTracked: 'This video has not been processed yet.',
    },
  },
  search: {
    genericError: 'Could not search the catalog.',
    searchingCatalog: 'Searching catalog…',
    noResultsFound: 'No results found',
    resultCount: (count) => `${count} result(s)`,
    resultsFor: (query) => `Search results for ${query}`,
    driveNotConnected: 'drive not connected',
    fileMissing: 'file missing',
  },
  wizard: {
    stepLabels: {
      welcome: 'Welcome',
      language: 'Language',
      analyzer: 'Analyzer',
      transcription: 'Transcription',
      downloads: 'Downloads',
      readiness: 'Readiness',
      done: 'Done',
    },
    nextLabels: {
      getStarted: 'Get started',
      continue: 'Continue',
      installAndContinue: 'Install & continue',
      finish: 'Finish',
    },
    setupWizard: 'Setup Wizard',
    configureLater: 'Configure later',
    back: 'Back',
    welcome: {
      title: 'Welcome to AI Video Cataloger',
      body: 'This guided setup configures an analyzer and transcription so your first analysis works end to end. You can change everything later in Settings.',
      privacy: 'Choose a fully local model (no account needed), an API provider, or one of your installed agent CLIs. The app itself sends nothing to the cloud. Your data — frames and transcripts — leaves this machine only if you choose to send it to your own providers: an API key you enter, or an agent CLI harness you already use (Claude Code, Codex, Cursor). A fully local model keeps everything on your Mac.',
    },
    analyzer: {
      title: 'Choose an analyzer',
      familyLabel: 'analyzer family',
      local: 'Local',
      recommendedSuffix: ' (recommended)',
      api: 'API',
      harness: 'Agent harness',
      localAppleSiliconWarning: 'Local models need Apple Silicon; pick API or a harness on this machine.',
      localModel: 'Local model',
      recommendedForThisMac: ' — recommended for this Mac',
      installedSuffix: ' (installed)',
      downloadGb: (gb) => ` · ${gb} GB download`,
      baseUrl: 'Base URL',
      model: 'Model',
      apiKey: 'API key',
      inputPrice: 'Input price / 1M tokens',
      outputPrice: 'Output price / 1M tokens',
      installed: 'Installed',
      installedVersion: (version) => `Installed · ${version}`,
      notDetected: 'Not detected',
      checking: 'Checking…',
    },
    transcription: {
      title: 'Choose transcription',
      managedLabel: 'Managed whisper.cpp',
      managedDescription: 'The app downloads and builds a local whisper runtime.',
      ownLabel: 'My own whisper binary',
      ownDescription: 'Point at an existing or GPU-optimized install.',
      apiLabel: 'OpenAI Whisper API',
      apiDescription: 'Transcribe through the OpenAI API (usage is charged).',
      skipLabel: 'Skip transcription',
      skipDescription: 'Analyze frames only, no audio transcript.',
      whisperModel: 'Whisper model',
      installedSuffix: ' (installed)',
      buildToolsWarning: (tools) => `Building whisper needs: ${tools}.`,
      whisperBinaryPath: 'Whisper binary path',
      openAiApiKey: 'OpenAI API key',
      openAiApiKeyHelper: 'Leave blank to keep an existing OpenAI credential.',
    },
    downloads: {
      title: 'Install what you chose',
      done: 'Done',
      failed: 'Failed',
      none: 'Nothing to download — your selections are already available. Continue to verify readiness.',
    },
    readiness: {
      title: 'Final check',
      checking: 'Checking your configuration…',
      ready: 'Everything is configured. You are ready to analyze videos.',
      notReady: 'Some checks need attention. Use the actions below to fix them.',
    },
    done: {
      title: 'Setup complete',
      incomplete: 'You can finish now and complete the remaining pieces from Settings or the Model Manager whenever you like.',
      skip: 'Your analyzer is ready in frames-only mode. Audio transcription will be skipped.',
      ready: 'Your analyzer and transcription are ready. Open a folder and start analyzing.',
    },
    controller: {
      noHarnessAvailable: 'No harness is available',
      analyzerSaved: 'Analyzer saved',
      whisperBinaryPathRequired: 'Whisper binary path is required',
      transcriptionSaved: 'Transcription saved',
      downloadFailed: 'Download failed',
      downloadingLocalModel: (tag) => `Downloading local model ${tag}`,
      buildingManagedWhisperRuntime: 'Building the managed whisper.cpp runtime',
      downloadingWhisperModel: (model) => `Downloading whisper model ${model}`,
      whisperModelActive: (model) => `${model} is now active`,
    },
    checklist: {
      dependencyNames: {
        ffmpeg: 'FFmpeg',
        ffprobe: 'ffprobe',
        whisper: 'Whisper runtime',
        'local-ai': 'Local AI runtime',
        'api-provider': 'API provider',
        claude: 'Agent CLI harness',
        faces: 'Face grouping engine',
      },
      dependencyDescriptions: {
        ffmpeg: 'Extracts frames and audio from your videos',
        ffprobe: 'Reads video metadata such as duration and streams',
        whisper: 'Runs local whisper.cpp transcription',
        'local-ai': 'Managed on-device AI runtime (Ollama)',
        'api-provider': 'Reaches your API provider with stored credentials',
        claude: 'Runs analysis through your agent CLI',
        faces: 'Groups faces on-device (only when enabled)',
      },
      checkedSystemDependency: 'Checked system dependency',
      fixInTranscription: 'Fix in Transcription',
      configuredAnalyzer: (providerId) => `Configured analyzer (${providerId})`,
      configuredAnalyzerDescription: 'The analyzer you selected is reachable and configured',
      backToAnalyzer: 'Back to Analyzer',
      configuredWhisperModel: (model) => `Configured whisper model (${model})`,
      configuredWhisperModelDescription: 'The transcription model you configured is installed on disk',
      useModel: (model) => `Use ${model}`,
      downloadModel: (model) => `Download ${model}`,
      configuredTranscriptionApi: 'Configured transcription (OpenAI API)',
      configuredTranscriptionApiDescription: 'The transcription API is reachable with stored credentials',
    },
  },
  models: {
    managerTitle: 'Model Manager',
    whisperModelsTitle: 'Whisper transcription models',
    checkingWhisperRuntime: 'Checking whisper.cpp runtime…',
    runtimeStatus: (source, path) => `Runtime: ${source} (${path})`,
    installing: 'Installing…',
    install: 'Install',
    runtimeNotInstalled: 'whisper.cpp runtime is not installed.',
    managedBuildRequires: (tools) => `Managed build requires ${tools}.`,
    loadingModels: 'Loading models…',
    retry: 'Retry',
    diskSpaceUsed: (usage) => `Disk space used: ${usage}`,
    active: 'Active',
    downloaded: 'Downloaded',
    clickToActivate: 'Click to activate',
    notDownloaded: 'Not downloaded',
    delete: 'Delete',
    download: 'Download',
    localAiTitle: 'Local AI models (Ollama)',
    localAiDescription: 'Used by the Local analyzer. The runtime installs and starts automatically.',
    yourMac: 'Your Mac',
    appleSilicon: 'Apple Silicon',
    recommended: 'recommended',
    loadingLocalAi: 'Loading local AI models…',
    compatible: 'Compatible',
    needsRam: (gb) => `Needs ${gb} GB RAM`,
    appleSiliconRequired: 'Apple Silicon required',
    downloadGb: (gb) => `${gb} GB download`,
    downloading: 'Downloading',
    deleteModelTitle: 'Delete model',
    deleteModelText: (modelName) => `Delete the ${modelName} Whisper model from disk? You can download it again later.`,
    terminal: {
      downloadingWhisper: (model) => `Downloading Whisper model: ${model}…`,
      whisperDownloaded: (model) => `Model ${model} downloaded successfully`,
      failedDownload: (model, message) => `Failed to download ${model}: ${message}`,
      downloadedToast: (model) => `Downloaded ${model}`,
      settingActive: (model) => `Setting active model: ${model}…`,
      modelActive: (model) => `Model ${model} is now active`,
      failedActivate: (model, message) => `Failed to activate ${model}: ${message}`,
      deletingModel: (model) => `Deleting model: ${model}…`,
      modelDeleted: (model) => `Model ${model} deleted`,
      deletedToast: (model) => `Deleted ${model}`,
      failedDelete: (model, message) => `Failed to delete ${model}: ${message}`,
      downloadingLocalAi: (tag, gb) => `Downloading local AI model ${tag} (${gb} GB)…`,
      localAiReady: (tag) => `Model ${tag} is ready`,
      failedLocalAiDownload: (tag, message) => `Failed to download ${tag}: ${message}`,
      removingLocalAi: (tag) => `Removing local AI model ${tag}…`,
      removedLocalAi: (tag) => `Removed ${tag}`,
      failedLocalAiRemove: (tag, message) => `Failed to remove ${tag}: ${message}`,
      buildingWhisperRuntime: 'Building the managed whisper.cpp runtime…',
      whisperRuntimeReady: 'Managed whisper.cpp runtime is ready',
      failedWhisperRuntimeInstall: (message) => `Failed to install whisper.cpp: ${message}`,
      unknownError: 'unknown error',
    },
  },
  prerequisites: {
    title: 'System Prerequisites',
    checking: 'Checking prerequisites…',
    retry: 'Retry',
    allSatisfied: 'All prerequisites are satisfied!',
    missingCount: (count) => `${count} prerequisite(s) missing`,
    selectedFolderConfiguration: 'Selected folder configuration',
    selectedFolderReady: 'The selected folder is ready for analysis.',
    mustBeConfigured: (pieces) => `${pieces} must be configured.`,
    systemDependencies: 'System dependencies',
    close: 'Close',
    checkAgain: 'Check Again',
    available: 'Available',
    version: (version) => `Version: ${version}`,
    notFound: 'Not found',
    dependencyDisplayNames: {
      ffmpeg: 'FFmpeg',
      whisper: 'Whisper',
      claude: 'Claude CLI',
      'local-ai': 'Local AI (managed Ollama)',
    },
  },
  readinessNotice: {
    title: 'Processing setup is incomplete',
    missing: (pieces) => `${pieces} must be configured before analysis can run.`,
    openSettings: 'Open Settings',
    openSetupWizard: 'Open Setup Wizard',
  },
  processing: {
    driveRunStarted: (folders, files) => `Scanning ${String(folders)} folder(s), ${String(files)} file(s)…`,
    driveFolderStarted: (path, files) => `→ ${path} (${String(files)} file(s))`,
    driveFolderDone: (path, done, skipped, failed) => `✓ ${path}: ${String(done)} done, ${String(skipped)} skipped, ${String(failed)} failed`,
    driveFileSkipped: (filename) => `↷ Skipped (already analyzed): ${filename}`,
    driveRunComplete: (foldersDone, foldersTotal, done, skipped, failed) =>
      `=== Drive run complete: ${String(foldersDone)}/${String(foldersTotal)} folder(s), ${String(done)} done, ${String(skipped)} skipped, ${String(failed)} failed ===`,
    progressLine: (percentage, label) => `[${String(percentage)}%] ${label}`,
    fileProgressLine: (current, total, label, filename) => `[${String(current)}/${String(total)}] ${label}: ${filename}`,
    error: (message) => `Error: ${message}`,
    analysisCompleted: (filename) => `✓ Analysis completed for ${filename}`,
    cancelledByUser: 'Cancelled by user',
    processingFailed: 'Processing failed',
    processingDidNotFinish: 'Processing did not finish',
    setupIncomplete: 'Processing setup is incomplete. Open Settings or run the Setup Wizard.',
    startingAnalysis: (filename) => `Starting analysis of ${filename}…`,
    noPendingVideos: 'No pending videos to analyze',
    batchStart: (count) => `=== Starting batch analysis of ${String(count)} video(s) ===`,
    batchCancelled: (processed, total) => `Batch processing cancelled. Processed ${String(processed)} of ${String(total)} videos.`,
    batchProcessing: (current, total, filename) => `[${String(current)}/${String(total)}] Processing: ${filename}`,
    batchComplete: '=== Batch analysis complete ===',
    successCount: (count) => `Success: ${String(count)}`,
    failedCount: (count) => `Failed: ${String(count)}`,
    folderTreeCompleted: '✓ Folder tree analysis completed',
    driveProcessingFailed: 'Drive processing failed',
    driveProcessingDidNotFinish: 'Drive processing did not finish',
    driveStart: (root) => `=== Analyzing folder tree: ${root} ===`,
    stoppingDrive: 'Stopping folder tree analysis…',
    cancellingCurrentAndBatch: 'Cancelling current video and stopping batch…',
    cancellingAnalysis: 'Cancelling analysis…',
  },
  people: {
    disabledTitle: 'Face grouping is off',
    disabledBody: 'Turn on local face grouping in Settings to group the people who appear across your videos.',
    emptyTitle: 'No people yet',
    emptyBody: 'Index the current folder to find and group faces across your videos.',
    title: 'People',
    subtitle: 'Local face grouping across indexed catalog videos.',
    mergeSelected: 'Merge selected',
    indexFaces: 'Index faces',
    localFaceGroupingOffTitle: 'Local face grouping is off',
    localFaceGroupingOffBody: 'Turn on local face grouping in Settings to group faces on this Mac.',
    modelsMissingTitle: 'Face grouping models are not installed',
    modelsMissingBody: 'Install the local model files before indexing face groupings.',
    installModels: 'Install models',
    noFaceGroupingsTitle: 'No face groupings yet',
    noFolderBody: 'Select a folder, then run ai-video-cataloger faces index <folder>.',
    runIndexingBody: 'Run indexing to create local face groupings for this folder.',
    dangerArea: 'Danger area',
    dangerBody: 'Delete all local face data if you want to remove every grouping and exemplar crop.',
    deleteAllFaceData: 'Delete all face data',
    renameGrouping: 'Rename grouping',
    displayName: 'Display name',
    personName: (index) => `Person ${String(index + 1)}`,
    mergeGroupings: 'Merge groupings',
    mergeBody: (from, to) => `Merge ${from} into ${to}? This cannot be undone.`,
    merge: 'Merge',
    deleteFaceGrouping: 'Delete face grouping',
    deleteFaceGroupingBody: "This permanently deletes this person's grouping, face observations (including embeddings), and exemplar crops. It cannot be undone.",
    deleteAllFaceDataBody: 'This permanently deletes all local face grouping data and exemplar crops. It cannot be undone.',
    deleteAll: 'Delete all',
    loadingPeople: 'Loading people...',
    selectPerson: (name) => `Select ${name}`,
    observationCount: (count) => `${count} observation(s)`,
    rename: 'Rename',
    delete: 'Delete',
  },
};

export const pl: Dictionary = {
  locale: 'pl',
  common: {
    save: 'Zapisz',
    cancel: 'Anuluj',
    close: 'Zamknij',
    back: 'Wstecz',
    next: 'Dalej',
    saved: 'Zapisano',
    openSettings: 'Otwórz ustawienia',
  },
  language: {
    stepTitle: 'Język',
    stepDescription: 'Wybierz język interfejsu oraz język generowanych opisów i nazw plików. Oba możesz później zmienić w Ustawieniach.',
    uiLabel: 'Język aplikacji',
    uiHelper: 'Język interfejsu aplikacji na komputerze.',
    outputLabel: 'Język opisów',
    outputHelper: 'Język, w którym AI pisze opisy i nazwy plików. Tagi zawsze pozostają po angielsku.',
    optionAuto: 'Automatycznie (wybiera model)',
    optionEnglish: 'Angielski',
    optionPolish: 'Polski',
  },
  settings: {
    languageSectionTitle: 'Język',
    savedToast: 'Zapisano ustawienia',
  },
  appHeader: {
    searchPlaceholder: 'Szukaj w katalogu',
    recentSearches: 'Ostatnie wyszukiwania',
    topTags: 'Najczęstsze tagi',
    removeRecentSearch: (label: string) => `Usuń ${label}`,
    settings: 'Ustawienia',
    models: 'Modele',
    prerequisites: 'Wymagania',
  },
  batchToolbar: {
    analyzeScope: 'Zakres analizy',
    thisFolder: 'Ten folder',
    wholeTree: 'Całe drzewo',
    processingCount: (current, total) => `Przetwarzanie ${current} z ${total}`,
    stop: 'Stop',
    analyzeAll: (count) => `Analizuj wszystko (${count})`,
  },
  catalog: {
    noFolderSelected: 'Nie wybrano folderu',
    openFolderHint: 'Otwórz folder, aby skatalogować jego filmy.',
    generatingThumbnails: 'Generowanie miniatur…',
    folderCounts: (pending, processed) => `${pending} oczekuje · ${processed} gotowe`,
    skipped: 'Pominięto',
    genericScanError: 'Nie udało się przeskanować tego folderu.',
    scanningFolder: 'Skanowanie folderu…',
    noVideosFound: 'Nie znaleziono filmów',
    absentSectionTitle: 'Wcześniej skatalogowane, obecnie nieobecne',
    absentLastSeen: (date) => `Ostatnio widziano ${date}`,
    forgetEntry: 'Zapomnij',
    forgetEntryConfirmTitle: 'Zapomnij wpis katalogu',
    forgetEntryConfirmBody: (name) => `Trwale usunąć ${name} z katalogu? Spowoduje to usunięcie danych analizy i wyszukiwania. Tego nie można cofnąć.`,
    forgetEntryConfirm: 'Zapomnij',
  },
  details: {
    welcomeTitle: 'Witaj w AI Video Cataloger',
    welcomeBody: 'Wybierz folder z filmami, aby rozpocząć. Aplikacja analizuje filmy lokalnie i generuje streszczenia, transkrypcje oraz inteligentne nazwy plików.',
    gettingStarted: 'Pierwsze kroki',
    gettingStartedSteps: [
      'Kliknij „Otwórz folder”, aby wybrać folder z plikami wideo',
      'Pasek boczny pokaże wszystkie wykryte filmy',
      'Wybierz film, aby zobaczyć szczegóły i wyniki analizy',
      'Kliknij „Analizuj”, aby przetworzyć pojedyncze filmy',
      'Terminal pokazuje postęp w czasie rzeczywistym',
    ],
    videoTags: 'Tagi filmu',
    videoInformation: 'Informacje o filmie',
    duration: 'Czas trwania',
    unknown: 'Nieznany',
    size: 'Rozmiar',
    location: 'Lokalizacja',
    summary: 'Streszczenie',
    suggestedFilename: 'Sugerowana nazwa pliku:',
    noSummaryAvailable: 'Brak streszczenia. Uruchom analizę ponownie, aby je wygenerować.',
    extractedFrames: (count) => `Wyodrębnione klatki (${count})`,
    frame: (index) => `Klatka ${index}`,
    transcript: 'Transkrypcja',
    fullAiAnalysis: 'Pełna analiza AI',
    analyzeVideo: 'Analizuj film',
    analyzingButton: 'Analizowanie…',
    analyzeHint: 'Wyodrębni klatki, przepisze audio i wygeneruje streszczenie przy użyciu AI.',
    processingIncomplete: 'Przetwarzanie nieukończone',
    incompleteHint: 'Poprzednia próba przetwarzania została przerwana. Kliknij przycisk poniżej, aby wznowić.',
    processingButton: 'Przetwarzanie…',
    continueAnalysis: 'Kontynuuj analizę',
    processingFailed: 'Przetwarzanie nie powiodło się',
    retrying: 'Ponawianie…',
    retryAnalysis: 'Ponów analizę',
    status: {
      analyzing: 'Film jest przetwarzany…',
      completed: 'Analiza zakończona. Streszczenie, transkrypcja i klatki są dostępne.',
      error: 'Podczas przetwarzania wystąpił błąd.',
      pending: 'Gotowe do analizy.',
      framesExtracted: 'Przetwarzanie przerwano na etapie wyodrębniania klatek. Kliknij Analizuj, aby kontynuować.',
      audioExtracted: 'Przetwarzanie przerwano na etapie wyodrębniania audio. Kliknij Analizuj, aby kontynuować.',
      transcribed: 'Przetwarzanie przerwano na etapie transkrypcji. Kliknij Analizuj, aby kontynuować.',
      analyzed: 'Przetwarzanie przerwano na etapie analizy. Kliknij Analizuj, aby kontynuować.',
      notTracked: 'Ten film nie został jeszcze przetworzony.',
    },
  },
  search: {
    genericError: 'Nie udało się przeszukać katalogu.',
    searchingCatalog: 'Przeszukiwanie katalogu…',
    noResultsFound: 'Brak wyników',
    resultCount: (count) => `${count} wynik(i)`,
    resultsFor: (query) => `Wyniki wyszukiwania dla ${query}`,
    driveNotConnected: 'dysk niepodłączony',
    fileMissing: 'brak pliku',
  },
  wizard: {
    stepLabels: {
      welcome: 'Witaj',
      language: 'Język',
      analyzer: 'Analizator',
      transcription: 'Transkrypcja',
      downloads: 'Pobieranie',
      readiness: 'Gotowość',
      done: 'Koniec',
    },
    nextLabels: {
      getStarted: 'Rozpocznij',
      continue: 'Kontynuuj',
      installAndContinue: 'Zainstaluj i kontynuuj',
      finish: 'Zakończ',
    },
    setupWizard: 'Kreator konfiguracji',
    configureLater: 'Skonfiguruj później',
    back: 'Wstecz',
    welcome: {
      title: 'Witaj w AI Video Cataloger',
      body: 'Ten kreator konfiguruje analizator i transkrypcję, aby pierwsza analiza działała od początku do końca. Wszystko możesz później zmienić w Ustawieniach.',
      privacy: 'Wybierz w pełni lokalny model (bez konta), dostawcę API albo jednego z zainstalowanych agentów CLI. Sama aplikacja niczego nie wysyła do chmury. Twoje dane — klatki i transkrypcje — opuszczają ten komputer tylko wtedy, gdy wybierzesz własnych dostawców: wpisany klucz API albo używany już harness agent CLI (Claude Code, Codex, Cursor). W pełni lokalny model trzyma wszystko na Macu.',
    },
    analyzer: {
      title: 'Wybierz analizator',
      familyLabel: 'rodzaj analizatora',
      local: 'Lokalny',
      recommendedSuffix: ' (zalecane)',
      api: 'API',
      harness: 'Agent harness',
      localAppleSiliconWarning: 'Modele lokalne wymagają Apple Silicon; na tym komputerze wybierz API albo harness.',
      localModel: 'Model lokalny',
      recommendedForThisMac: ' — zalecany dla tego Maca',
      installedSuffix: ' (zainstalowany)',
      downloadGb: (gb) => ` · ${gb} GB do pobrania`,
      baseUrl: 'Bazowy URL',
      model: 'Model',
      apiKey: 'Klucz API',
      inputPrice: 'Cena wejścia / 1M tokenów',
      outputPrice: 'Cena wyjścia / 1M tokenów',
      installed: 'Zainstalowany',
      installedVersion: (version) => `Zainstalowany · ${version}`,
      notDetected: 'Nie wykryto',
      checking: 'Sprawdzanie…',
    },
    transcription: {
      title: 'Wybierz transkrypcję',
      managedLabel: 'Zarządzany whisper.cpp',
      managedDescription: 'Aplikacja pobierze i zbuduje lokalny whisper runtime.',
      ownLabel: 'Własny plik whisper',
      ownDescription: 'Wskaż istniejącą albo zoptymalizowaną pod GPU instalację.',
      apiLabel: 'OpenAI Whisper API',
      apiDescription: 'Transkrybuj przez OpenAI API (naliczane opłaty za użycie).',
      skipLabel: 'Pomiń transkrypcję',
      skipDescription: 'Analizuj tylko klatki, bez transkrypcji audio.',
      whisperModel: 'Model whisper',
      installedSuffix: ' (zainstalowany)',
      buildToolsWarning: (tools) => `Budowanie whisper wymaga: ${tools}.`,
      whisperBinaryPath: 'Ścieżka do pliku whisper',
      openAiApiKey: 'Klucz OpenAI API',
      openAiApiKeyHelper: 'Pozostaw puste, aby zachować istniejące dane OpenAI.',
    },
    downloads: {
      title: 'Zainstaluj wybrane elementy',
      done: 'Gotowe',
      failed: 'Niepowodzenie',
      none: 'Nie ma nic do pobrania — wybrane elementy są już dostępne. Kontynuuj, aby sprawdzić gotowość.',
    },
    readiness: {
      title: 'Końcowy test',
      checking: 'Sprawdzanie konfiguracji…',
      ready: 'Wszystko skonfigurowane. Możesz analizować filmy.',
      notReady: 'Niektóre testy wymagają uwagi. Użyj akcji poniżej, aby je naprawić.',
    },
    done: {
      title: 'Konfiguracja zakończona',
      incomplete: 'Możesz zakończyć teraz i dokończyć pozostałe elementy później w Ustawieniach albo Menedżerze modeli.',
      skip: 'Analizator jest gotowy w trybie tylko klatek. Transkrypcja audio będzie pomijana.',
      ready: 'Analizator i transkrypcja są gotowe. Otwórz folder i rozpocznij analizę.',
    },
    controller: {
      noHarnessAvailable: 'Brak dostępnego harness',
      analyzerSaved: 'Zapisano analizator',
      whisperBinaryPathRequired: 'Ścieżka do pliku whisper jest wymagana',
      transcriptionSaved: 'Zapisano transkrypcję',
      downloadFailed: 'Pobieranie nie powiodło się',
      downloadingLocalModel: (tag) => `Pobieranie modelu lokalnego ${tag}`,
      buildingManagedWhisperRuntime: 'Budowanie zarządzanego whisper.cpp runtime',
      downloadingWhisperModel: (model) => `Pobieranie modelu whisper ${model}`,
      whisperModelActive: (model) => `${model} jest teraz aktywny`,
    },
    checklist: {
      dependencyNames: {
        ffmpeg: 'FFmpeg',
        ffprobe: 'ffprobe',
        whisper: 'Whisper runtime',
        'local-ai': 'Lokalny AI runtime',
        'api-provider': 'Dostawca API',
        claude: 'Agent CLI harness',
        faces: 'Silnik grupowania twarzy',
      },
      dependencyDescriptions: {
        ffmpeg: 'Wyodrębnia klatki i audio z filmów',
        ffprobe: 'Odczytuje metadane wideo, takie jak czas trwania i strumienie',
        whisper: 'Uruchamia lokalną transkrypcję whisper.cpp',
        'local-ai': 'Zarządzany lokalny AI runtime (Ollama)',
        'api-provider': 'Łączy się z dostawcą API przy użyciu zapisanych danych',
        claude: 'Uruchamia analizę przez agent CLI',
        faces: 'Grupuje twarze lokalnie (tylko po włączeniu)',
      },
      checkedSystemDependency: 'Sprawdzona zależność systemowa',
      fixInTranscription: 'Napraw w Transkrypcji',
      configuredAnalyzer: (providerId) => `Skonfigurowany analizator (${providerId})`,
      configuredAnalyzerDescription: 'Wybrany analizator jest osiągalny i skonfigurowany',
      backToAnalyzer: 'Wróć do Analizatora',
      configuredWhisperModel: (model) => `Skonfigurowany model whisper (${model})`,
      configuredWhisperModelDescription: 'Skonfigurowany model transkrypcji jest zainstalowany na dysku',
      useModel: (model) => `Użyj ${model}`,
      downloadModel: (model) => `Pobierz ${model}`,
      configuredTranscriptionApi: 'Skonfigurowana transkrypcja (OpenAI API)',
      configuredTranscriptionApiDescription: 'API transkrypcji jest osiągalne przy użyciu zapisanych danych',
    },
  },
  models: {
    managerTitle: 'Menedżer modeli',
    whisperModelsTitle: 'Modele transkrypcji Whisper',
    checkingWhisperRuntime: 'Sprawdzanie whisper.cpp runtime…',
    runtimeStatus: (source, path) => `Runtime: ${source} (${path})`,
    installing: 'Instalowanie…',
    install: 'Instaluj',
    runtimeNotInstalled: 'whisper.cpp runtime nie jest zainstalowany.',
    managedBuildRequires: (tools) => `Zarządzany build wymaga ${tools}.`,
    loadingModels: 'Ładowanie modeli…',
    retry: 'Ponów',
    diskSpaceUsed: (usage) => `Zajęte miejsce: ${usage}`,
    active: 'Aktywny',
    downloaded: 'Pobrany',
    clickToActivate: 'Kliknij, aby aktywować',
    notDownloaded: 'Niepobrany',
    delete: 'Usuń',
    download: 'Pobierz',
    localAiTitle: 'Lokalne modele AI (Ollama)',
    localAiDescription: 'Używane przez lokalny analizator. Runtime instaluje się i uruchamia automatycznie.',
    yourMac: 'Twój Mac',
    appleSilicon: 'Apple Silicon',
    recommended: 'zalecany',
    loadingLocalAi: 'Ładowanie lokalnych modeli AI…',
    compatible: 'Zgodny',
    needsRam: (gb) => `Wymaga ${gb} GB RAM`,
    appleSiliconRequired: 'Wymagany Apple Silicon',
    downloadGb: (gb) => `${gb} GB do pobrania`,
    downloading: 'Pobieranie',
    deleteModelTitle: 'Usuń model',
    deleteModelText: (modelName) => `Usunąć model Whisper ${modelName} z dysku? Możesz pobrać go ponownie później.`,
    terminal: {
      downloadingWhisper: (model) => `Pobieranie modelu Whisper: ${model}…`,
      whisperDownloaded: (model) => `Model ${model} pobrany`,
      failedDownload: (model, message) => `Nie udało się pobrać ${model}: ${message}`,
      downloadedToast: (model) => `Pobrano ${model}`,
      settingActive: (model) => `Ustawianie aktywnego modelu: ${model}…`,
      modelActive: (model) => `Model ${model} jest teraz aktywny`,
      failedActivate: (model, message) => `Nie udało się aktywować ${model}: ${message}`,
      deletingModel: (model) => `Usuwanie modelu: ${model}…`,
      modelDeleted: (model) => `Model ${model} usunięty`,
      deletedToast: (model) => `Usunięto ${model}`,
      failedDelete: (model, message) => `Nie udało się usunąć ${model}: ${message}`,
      downloadingLocalAi: (tag, gb) => `Pobieranie lokalnego modelu AI ${tag} (${gb} GB)…`,
      localAiReady: (tag) => `Model ${tag} jest gotowy`,
      failedLocalAiDownload: (tag, message) => `Nie udało się pobrać ${tag}: ${message}`,
      removingLocalAi: (tag) => `Usuwanie lokalnego modelu AI ${tag}…`,
      removedLocalAi: (tag) => `Usunięto ${tag}`,
      failedLocalAiRemove: (tag, message) => `Nie udało się usunąć ${tag}: ${message}`,
      buildingWhisperRuntime: 'Budowanie zarządzanego whisper.cpp runtime…',
      whisperRuntimeReady: 'Zarządzany whisper.cpp runtime jest gotowy',
      failedWhisperRuntimeInstall: (message) => `Nie udało się zainstalować whisper.cpp: ${message}`,
      unknownError: 'nieznany błąd',
    },
  },
  prerequisites: {
    title: 'Wymagania systemowe',
    checking: 'Sprawdzanie wymagań…',
    retry: 'Ponów',
    allSatisfied: 'Wszystkie wymagania są spełnione!',
    missingCount: (count) => `Brakujące wymagania: ${count}`,
    selectedFolderConfiguration: 'Konfiguracja wybranego folderu',
    selectedFolderReady: 'Wybrany folder jest gotowy do analizy.',
    mustBeConfigured: (pieces) => `${pieces} wymaga konfiguracji.`,
    systemDependencies: 'Zależności systemowe',
    close: 'Zamknij',
    checkAgain: 'Sprawdź ponownie',
    available: 'Dostępne',
    version: (version) => `Wersja: ${version}`,
    notFound: 'Nie znaleziono',
    dependencyDisplayNames: {
      ffmpeg: 'FFmpeg',
      whisper: 'Whisper',
      claude: 'Claude CLI',
      'local-ai': 'Lokalne AI (zarządzana Ollama)',
    },
  },
  readinessNotice: {
    title: 'Konfiguracja przetwarzania jest niepełna',
    missing: (pieces) => `${pieces} musi być skonfigurowane przed uruchomieniem analizy.`,
    openSettings: 'Otwórz ustawienia',
    openSetupWizard: 'Otwórz kreator konfiguracji',
  },
  processing: {
    driveRunStarted: (folders, files) => `Skanowanie: ${String(folders)} folder(y), ${String(files)} plik(i)…`,
    driveFolderStarted: (path, files) => `→ ${path} (${String(files)} plik(i))`,
    driveFolderDone: (path, done, skipped, failed) => `✓ ${path}: ${String(done)} gotowe, ${String(skipped)} pominięte, ${String(failed)} błędne`,
    driveFileSkipped: (filename) => `↷ Pominięto (już przeanalizowano): ${filename}`,
    driveRunComplete: (foldersDone, foldersTotal, done, skipped, failed) =>
      `=== Analiza drzewa ukończona: ${String(foldersDone)}/${String(foldersTotal)} folder(y), ${String(done)} gotowe, ${String(skipped)} pominięte, ${String(failed)} błędne ===`,
    progressLine: (percentage, label) => `[${String(percentage)}%] ${label}`,
    fileProgressLine: (current, total, label, filename) => `[${String(current)}/${String(total)}] ${label}: ${filename}`,
    error: (message) => `Błąd: ${message}`,
    analysisCompleted: (filename) => `✓ Analiza ukończona dla ${filename}`,
    cancelledByUser: 'Anulowano przez użytkownika',
    processingFailed: 'Przetwarzanie nie powiodło się',
    processingDidNotFinish: 'Przetwarzanie nie zostało ukończone',
    setupIncomplete: 'Konfiguracja przetwarzania jest niepełna. Otwórz Ustawienia albo uruchom Kreator konfiguracji.',
    startingAnalysis: (filename) => `Rozpoczynanie analizy ${filename}…`,
    noPendingVideos: 'Brak oczekujących filmów do analizy',
    batchStart: (count) => `=== Rozpoczynanie analizy wsadowej ${String(count)} film(ów) ===`,
    batchCancelled: (processed, total) => `Przetwarzanie wsadowe anulowane. Przetworzono ${String(processed)} z ${String(total)} filmów.`,
    batchProcessing: (current, total, filename) => `[${String(current)}/${String(total)}] Przetwarzanie: ${filename}`,
    batchComplete: '=== Analiza wsadowa ukończona ===',
    successCount: (count) => `Sukces: ${String(count)}`,
    failedCount: (count) => `Błędy: ${String(count)}`,
    folderTreeCompleted: '✓ Analiza drzewa folderów ukończona',
    driveProcessingFailed: 'Przetwarzanie dysku nie powiodło się',
    driveProcessingDidNotFinish: 'Przetwarzanie dysku nie zostało ukończone',
    driveStart: (root) => `=== Analiza drzewa folderów: ${root} ===`,
    stoppingDrive: 'Zatrzymywanie analizy drzewa folderów…',
    cancellingCurrentAndBatch: 'Anulowanie bieżącego filmu i zatrzymywanie wsadu…',
    cancellingAnalysis: 'Anulowanie analizy…',
  },
  people: {
    disabledTitle: 'Grupowanie twarzy jest wyłączone',
    disabledBody: 'Włącz lokalne grupowanie twarzy w Ustawieniach, aby grupować osoby pojawiające się w Twoich filmach.',
    emptyTitle: 'Brak osób',
    emptyBody: 'Zindeksuj bieżący folder, aby znaleźć i pogrupować twarze w Twoich filmach.',
    title: 'Osoby',
    subtitle: 'Lokalne grupowanie twarzy w zindeksowanych filmach katalogu.',
    mergeSelected: 'Scal wybrane',
    indexFaces: 'Indeksuj twarze',
    localFaceGroupingOffTitle: 'Lokalne grupowanie twarzy jest wyłączone',
    localFaceGroupingOffBody: 'Włącz lokalne grupowanie twarzy w Ustawieniach, aby grupować twarze na tym Macu.',
    modelsMissingTitle: 'Modele grupowania twarzy nie są zainstalowane',
    modelsMissingBody: 'Zainstaluj lokalne pliki modeli przed indeksowaniem grup twarzy.',
    installModels: 'Zainstaluj modele',
    noFaceGroupingsTitle: 'Brak grup twarzy',
    noFolderBody: 'Wybierz folder, a potem uruchom ai-video-cataloger faces index <folder>.',
    runIndexingBody: 'Uruchom indeksowanie, aby utworzyć lokalne grupy twarzy dla tego folderu.',
    dangerArea: 'Strefa ryzyka',
    dangerBody: 'Usuń wszystkie lokalne dane twarzy, jeśli chcesz usunąć każdą grupę i przykładowe wycinki.',
    deleteAllFaceData: 'Usuń wszystkie dane twarzy',
    renameGrouping: 'Zmień nazwę grupy',
    displayName: 'Nazwa wyświetlana',
    personName: (index) => `Osoba ${String(index + 1)}`,
    mergeGroupings: 'Scal grupy',
    mergeBody: (from, to) => `Scalić ${from} z ${to}? Tego nie można cofnąć.`,
    merge: 'Scal',
    deleteFaceGrouping: 'Usuń grupę twarzy',
    deleteFaceGroupingBody: 'To trwale usuwa grupę tej osoby, obserwacje twarzy (w tym embeddingi) i przykładowe wycinki. Tego nie można cofnąć.',
    deleteAllFaceDataBody: 'To trwale usuwa wszystkie lokalne dane grupowania twarzy i przykładowe wycinki. Tego nie można cofnąć.',
    deleteAll: 'Usuń wszystko',
    loadingPeople: 'Ładowanie osób...',
    selectPerson: (name) => `Wybierz ${name}`,
    observationCount: (count) => `${count} obserwacji`,
    rename: 'Zmień nazwę',
    delete: 'Usuń',
  },
};

export const getDict = (locale: Locale): Dictionary => (locale === 'pl' ? pl : en);
