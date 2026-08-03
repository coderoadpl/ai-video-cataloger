import type { AnalyzerErrorMessages } from '../lib/analyzer-error-message.js';

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
    ok: string;
    revealInFinder: string;
    revealFailed: string;
    aspectPortraitLabel: string;
    aspectPanoramaLabel: string;
    copyToClipboard: string;
    copied: string;
  };
  language: {
    stepTitle: string;
    stepDescription: string;
    uiLabel: string;
    uiHelper: string;
    outputLabel: string;
    outputHelper: string;
    tagLabel: string;
    tagHelper: string;
    optionAuto: string;
    optionEnglish: string;
    optionPolish: string;
  };
  settings: {
    languageSectionTitle: string;
    savedToast: string;
  };
  appFrame: {
    sidebarHeading: string;
    sidebarHeadingPhotos: string;
    hideSidebar: string;
    showSidebar: string;
    modeLibrary: string;
    modeAnalysis: string;
    subnavCollection: string;
    subnavPhotos: string;
    subnavPeople: string;
    subnavMap: string;
    mediaVideos: string;
    mediaPhotos: string;
    modeSwitcherLabel: string;
    subnavLabel: string;
    mediaToggleLabel: string;
    terminalTitle: string;
    terminalRaw: string;
    terminalCopy: string;
    terminalClear: string;
    terminalCollapse: string;
    terminalExpand: string;
    terminalEmpty: string;
    terminalDropped: (count: number) => string;
    terminalScrollToBottom: string;
  };
  appHeader: {
    settings: string;
    models: string;
    prerequisites: string;
  };
  batchToolbar: {
    analyzeScope: string;
    thisFolder: string;
    wholeTree: string;
    scopeToggleDisabled: string;
    batchWaitHint: string;
    processingCount: (current: number, total: number) => string;
    stop: string;
    analyzeAll: (count: number) => string;
    analyzeUpTo: (count: number) => string;
  };
  catalog: {
    noFolderSelected: string;
    openFolderHint: string;
    generatingThumbnails: string;
    lockedBy: (processName: string, pid: number) => string;
    retryLock: string;
    folderCounts: (pending: number, processed: number) => string;
    folderCountsWithDuplicates: (pending: number, processed: number, duplicates: number) => string;
    unknownFolderCounts: (videoCount: number) => string;
    duplicateBadge: string;
    duplicateTooltip: (canonicalPath: string) => string;
    largeRunWarningTitle: string;
    largeRunWarningBody: (count: number) => string;
    largeRunCommandLabel: string;
    skipped: string;
    genericScanError: string;
    scanningFolder: string;
    noVideosFound: string;
    noVideosInFolder: (subfolderCount: number) => string;
    switchToWholeTree: string;
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
    selectVideoPrompt: string;
    videoTags: string;
    videoInformation: string;
    duration: string;
    unknown: string;
    size: string;
    location: string;
    coordinates: string;
    showOnMap: string;
    summary: string;
    suggestedFilename: string;
    estimatedGeminiCost: (amount: number, model: string, pricingMode: string) => string;
    noSummaryAvailable: string;
    extractedFrames: (count: number) => string;
    frame: (index: number) => string;
    transcript: string;
    fullAiAnalysis: string;
    analyzeVideo: string;
    analyzeAction: string;
    analyzingButton: string;
    analyzeHint: string;
    processingIncomplete: string;
    incompleteHint: string;
    processingButton: string;
    continueAnalysis: string;
    processingFailed: string;
    retrying: string;
    retryAnalysis: string;
    duplicateTitle: string;
    duplicateExplanation: string;
    duplicateCanonicalLabel: string;
    analyzeAnyway: string;
    navigateToOriginal: string;
    variants: {
      title: string;
      count: (count: number) => string;
      selected: string;
      legacySettingsUnknown: string;
      configuredLabel: (analyzer: string, transcription: string, frames: string) => string;
      nativeTranscription: string;
      localTranscription: (model: string) => string;
      apiTranscription: (model: string) => string;
      transcriptionSkipped: string;
      frameCount: (count: number) => string;
      noFrames: string;
      frameExtractionDisabled: string;
      useAsSelected: string;
      selectionImpact: string;
      compare: string;
      compareTitle: string;
      backToDetails: string;
      configurationId: (configId: string) => string;
      outputLanguage: (language: string) => string;
      promptVersion: (version: number) => string;
      videoDuration: (duration: string) => string;
      estimatedCost: (amount: number) => string;
      notRecorded: string;
      newVariant: string;
      existingVariant: string;
      analysisState: (label: string, state: string) => string;
      createNewVariant: string;
      rerunExistingVariant: string;
      setFolderDefault: string;
      folderDefault: string;
      loading: string;
      loadError: string;
      retry: string;
      actionError: string;
    };
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
    multipleVariants: (count: number) => string;
    back: string;
  };
  wizard: {
    stepLabels: {
      welcome: string;
      language: string;
      analyzer: string;
      transcription: string;
      faces: string;
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
      api: string;
      harness: string;
      gemini: string;
      geminiModel: string;
      geminiPrivacy: string;
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
      nativeSkipNotice: string;
      whisperModel: string;
      installedSuffix: string;
      buildToolsWarning: (tools: string) => string;
      whisperBinaryPath: string;
      openAiApiKey: string;
      openAiApiKeyHelper: string;
    };
    faces: {
      title: string;
      localModels: string;
      peopleIndex: string;
      enableLabel: string;
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
      facesSaved: string;
      downloadFailed: string;
      downloadingLocalModel: (tag: string) => string;
      buildingManagedWhisperRuntime: string;
      downloadingWhisperModel: (model: string) => string;
      downloadingFaceModels: string;
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
    activate: string;
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
    warningsTitle: string;
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
    driveFolderDone: (path: string, done: number, skipped: number, duplicatesSkipped: number, failed: number) => string;
    driveFileSkipped: (filename: string) => string;
    driveDuplicateSkipped: (filename: string) => string;
    driveSnapshotSkipped: (folder: string) => string;
    driveRunComplete: (
      foldersDone: number,
      foldersTotal: number,
      done: number,
      skipped: number,
      duplicatesSkipped: number,
      failed: number,
      estimatedCostUsd: number | null,
      costedFiles: number,
    ) => string;
    driveBudgetCapReached: (month: string, estimatedSpendUsd: number, budgetUsd: number) => string;
    driveBatchSubmitted: (requestCount: number, reattached: boolean) => string;
    driveBatchPoll: (state: string, requestCount: number) => string;
    driveBatchCompleted: (succeeded: number, failed: number) => string;
    driveBatchUploadsRetained: (retained: number) => string;
    driveBatchOrphanJobs: (jobNames: readonly string[]) => string;
    driveBatchModelChanged: (jobModel: string, resolvedModel: string) => string;
    driveBatchWaiting: (requestCount: number) => string;
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
    analysisBusy: string;
    batchStart: (count: number) => string;
    batchCancelled: (processed: number, total: number) => string;
    batchProcessing: (current: number, total: number, filename: string) => string;
    duplicateSkipped: (filename: string) => string;
    batchComplete: string;
    successCount: (count: number) => string;
    duplicateSkippedCount: (count: number) => string;
    failedCount: (count: number) => string;
    folderTreeCompleted: string;
    driveProcessingFailed: string;
    driveProcessingDidNotFinish: string;
    driveStart: (root: string) => string;
    stoppingDrive: string;
    cancellingCurrentAndBatch: string;
    cancellingAnalysis: string;
    stepLabels: Record<string, string>;
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
    runIndexingInAnalysis: string;
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
    searchInLibrary: string;
    moreActions: (name: string) => string;
    installingModelsLog: string;
    modelsInstalledLog: string;
    installModelsFailedLog: string;
    indexingFacesLog: string;
    indexUpdatedLog: string;
    indexFacesFailedLog: string;
    renamedGroupingLog: (name: string) => string;
    renameGroupingFailedLog: string;
    mergedGroupingsLog: string;
    mergeGroupingsFailedLog: string;
    deletedGroupingLog: string;
    deleteGroupingFailedLog: string;
    deletedAllFaceDataLog: string;
    deleteAllFaceDataFailedLog: string;
  };
  map: {
    title: string;
    subtitle: string;
    loading: string;
    coverage: (located: number, total: number) => string;
    coveragePhotos: (located: number, total: number) => string;
    emptyTitle: string;
    emptyBody: string;
    canvasLabel: string;
    clusterLabel: (count: number) => string;
    zoomIn: string;
    zoomOut: string;
    resetView: string;
    openPhoto: string;
    openPreview: string;
    coordinates: string;
    source: {
      camera: string;
      timeline: string;
      manual: string;
    };
    interval: {
      visit: string;
      activity: string;
      path: string;
    };
    accuracy: (meters: number) => string;
    place: string;
    filter: {
      all: string;
      videos: string;
      photos: string;
    };
  };
  settingsModal: {
    title: string;
    selectFolderFirst: string;
    loading: string;
    secondsValue: (seconds: number) => string;
    frameCount: string;
    frameCountValue: (count: number) => string;
    frameCountHelper: string;
    transcriptionMode: string;
    transcriptionLanguage: string;
    whisperModel: string;
    customWhisperPath: string;
    customWhisperPathHelper: string;
    whisperApiBaseUrl: string;
    whisperApiBaseUrlHelper: string;
    whisperApiModel: string;
    openAiWhisperApiKey: string;
    openAiWhisperApiKeyHelper: string;
    analyzerTimeout: string;
    analyzerTimeoutHelper: string;
    facesSectionTitle: string;
    facesEnableLabel: string;
    facesHelper: string;
    geminiBatchSectionTitle: string;
    geminiBatchEnableLabel: string;
    geminiBatchHelper: string;
    geminiBudgetSectionTitle: string;
    geminiBudgetLabel: string;
    geminiBudgetHelper: string;
    geminiBudgetInvalid: string;
    geminiSpendReadout: (month: string, estimatedCostUsd: number, entries: number) => string;
    geminiSpendUnknown: string;
    skipAutoRename: string;
    runSetupWizard: string;
    reset: string;
    saving: string;
    savingKeychainHint: string;
    whisperModes: {
      local: { label: string; description: string };
      api: { label: string; description: string };
      skip: { label: string; description: string };
    };
    whisperModels: {
      tiny: { label: string; description: string };
      base: { label: string; description: string };
      small: { label: string; description: string };
      medium: { label: string; description: string };
      'large-v3': { label: string; description: string };
      'large-v3-turbo': { label: string; description: string };
    };
  };
  settingsAnalyzer: {
    aiAnalyzer: string;
    claudeCli: string;
    localOllama: string;
    openAiCompatibleApi: string;
    localModel: string;
    recommendedSuffix: string;
    installedSuffix: string;
    unsupportedHint: string;
    notDownloadedHint: string;
    baseUrl: string;
    model: string;
    apiCredential: string;
    inputPrice: string;
    outputPrice: string;
    geminiNativeVideo: string;
    geminiModel: string;
    geminiPrivacy: string;
    forgetCredential: string;
  };
  credentials: {
    savedKeychain: string;
    savedFile: string;
    clearedKeychain: string;
    clearedFile: string;
    clearedBoth: string;
    keychainRetained: string;
    keychainUnavailable: string;
    notStored: string;
    entryUnreadable: string;
    entryUnreadableRetained: string;
  };
  errors: AnalyzerErrorMessages;
  folderBar: {
    openFolder: string;
    checking: string;
    recentFolders: string;
    clearRecent: string;
  };
  videoStatus: {
    incomplete: string;
    completed: string;
    error: string;
    pending: string;
    notTracked: string;
    processing: string;
  };
  nestedDbDialog: {
    title: string;
    bodyBefore: string;
    bodyAfter: string;
  };
  batchSummary: {
    title: string;
    successful: string;
    failed: string;
    duplicatesSkipped: string;
    failedVideos: string;
    unknownError: string;
  };
  driveSummary: {
    title: string;
    folders: string;
    analyzed: string;
    skipped: string;
    duplicatesSkipped: string;
    failed: string;
    estimatedCost: (files: number) => string;
  };
  harnessModelPicker: {
    model: string;
    default: string;
    customEscapeHatch: string;
    customModelId: string;
    unvalidated: string;
    reasoningEffort: string;
    effortDefault: string;
  };
  cancelDialog: {
    batchTitle: string;
    singleTitle: string;
    batchBody: string;
    batchAlert: string;
    singleBody: string;
    singleAlert: string;
    continueProcessing: string;
    stopBatch: string;
    cancelAnalysis: string;
  };
  photos: {
    title: string;
    subtitle: string;
    rootPickerLabel: string;
    rootPickerAll: string;
    emptyNoRootsTitle: string;
    emptyNoRootsBodyBrowse: string;
    scanFolderAction: string;
    emptyNoPhotos: string;
    generateProxiesAction: string;
    proxiesPendingStrip: string;
    unknownDate: string;
    duplicatesBadge: (count: number) => string;
    missingBadge: string;
    proxyFailedTooltip: string;
    noProxyYet: string;
    viewerClose: string;
    viewerPrevious: string;
    viewerNext: string;
    detailCamera: string;
    detailLens: string;
    detailDimensions: string;
    detailExposure: string;
    detailIso: string;
    detailAperture: string;
    detailRating: string;
    detailCaptured: string;
    capturedSourceExifOffset: string;
    capturedSourceExifGpsTime: string;
    capturedSourceExifLocalAssumed: string;
    capturedSourceFileMtime: string;
    detailOwnerPath: string;
    detailAlsoAt: (count: number) => string;
    statusPhotos: (count: number) => string;
    statusPaths: (count: number) => string;
    statusProxied: (count: number) => string;
    statusProxyFailed: (count: number) => string;
    loadingPhotos: string;
    loadMore: string;
    searchPlaceholder: string;
    searchResultsLabel: (count: number) => string;
    searchNoResults: string;
    searchClear: string;
    analyzeAction: string;
    analyzeProgress: (current: number, total: number) => string;
    cancelAnalysisAction: string;
    analysisCancelled: string;
    analysisNone: string;
    analyzeUnavailable: string;
    detailDescription: string;
    detailScene: string;
    detailQuality: string;
    detailTags: string;
    detailVariant: string;
    detailVariantCount: (count: number) => string;
    variantPickerLabel: string;
    variantAutomatic: string;
    scenePeople: string;
    sceneLandscape: string;
    sceneUrban: string;
    sceneIndoor: string;
    sceneFood: string;
    sceneDocument: string;
    sceneScreenshot: string;
    sceneAnimal: string;
    sceneVehicle: string;
    sceneEvent: string;
    sceneObject: string;
    sceneOther: string;
    qualityGood: string;
    qualityBlurry: string;
    qualityDark: string;
    qualityOverexposed: string;
    qualityOther: string;
    openInAnalysis: string;
  };
  photosSidebar: {
    noFolderTitle: string;
    noFolderBody: string;
    autoScanningBody: string;
    scopeThisFolder: string;
    scopeAllFolders: string;
    badgeProxyFailed: string;
    badgeExifMissing: string;
    badgeMissing: string;
    badgeAnalyzing: string;
    loadMore: string;
    analyzeFolderAction: string;
  };
  photosWorkspace: {
    emptyTitle: string;
  };
  library: {
    title: string;
    subtitle: string;
    countHeader: (shown: number, total: number) => string;
    searchPlaceholder: string;
    recentSearches: string;
    topTags: string;
    removeRecentSearch: (label: string) => string;
    loadingLibrary: string;
    loadMore: string;
    unknownDate: string;
    emptyCatalogTitle: string;
    emptyCatalogBody: string;
    emptyCatalogAction: string;
    noMatchTitle: (query: string) => string;
    noMatchBody: string;
    noMatchNamed: (parts: string) => string;
    noMatchClearAction: string;
    offlineFolderBadge: string;
    missingBadge: string;
    openInAnalysis: string;
    copyPath: string;
    groupByDate: string;
    groupByFolder: string;
    filterTags: string;
    filterPeople: string;
    filterPlace: string;
    filterFolder: string;
    filterFrom: string;
    filterTo: string;
    filterHasGps: string;
    filterHasGpsAny: string;
    filterHasGpsWith: string;
    filterHasGpsWithout: string;
    filterClearAll: string;
    filterDatePreset: string;
    filterDatePresetAny: string;
    filterDatePresetThisYear: string;
    filterDatePresetLastYear: string;
    chipHasGps: string;
    chipNoGps: string;
    chipFolder: (displayName: string) => string;
    chipDateRange: (from: string, to: string) => string;
    chipDateFrom: (from: string) => string;
    chipDateTo: (to: string) => string;
    sortLabel: string;
    sortCapturedDesc: string;
    sortCapturedAsc: string;
    sortNameAsc: string;
    sortRelevance: string;
  };
  preview: {
    offline: string;
    missing: string;
    openInAnalysis: string;
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
    ok: 'OK',
    revealInFinder: 'Reveal in Finder',
    revealFailed: 'Could not reveal this file: it is outside every known catalog folder.',
    aspectPortraitLabel: 'Portrait orientation',
    aspectPanoramaLabel: 'Panoramic aspect ratio',
    copyToClipboard: 'Copy to clipboard',
    copied: 'Copied',
  },
  language: {
    stepTitle: 'Language',
    stepDescription: 'Choose the interface language and the language for generated descriptions and filenames. You can change both later in Settings.',
    uiLabel: 'App language',
    uiHelper: 'Language of the desktop app interface.',
    outputLabel: 'Description language',
    outputHelper: 'Language the AI writes descriptions and filenames in.',
    tagLabel: 'Tag language',
    tagHelper: 'Language the AI writes tags in. Follows the description language unless you set it.',
    optionAuto: 'Automatic (model chooses)',
    optionEnglish: 'English',
    optionPolish: 'Polish',
  },
  settings: {
    languageSectionTitle: 'Language',
    savedToast: 'Settings saved',
  },
  appFrame: {
    sidebarHeading: 'Videos',
    sidebarHeadingPhotos: 'Photos',
    hideSidebar: 'Hide',
    showSidebar: 'Show',
    modeLibrary: 'Library',
    modeAnalysis: 'Analysis',
    subnavCollection: 'Collection',
    subnavPhotos: 'Photos',
    subnavPeople: 'People',
    subnavMap: 'Map',
    mediaVideos: 'Videos',
    mediaPhotos: 'Photos',
    modeSwitcherLabel: 'App mode',
    subnavLabel: 'Library surface',
    mediaToggleLabel: 'Analysis media',
    terminalTitle: 'Terminal',
    terminalRaw: 'Raw',
    terminalCopy: 'Copy',
    terminalClear: 'Clear',
    terminalCollapse: 'Collapse',
    terminalExpand: 'Expand',
    terminalEmpty: 'No output yet. Run an analysis to see job progress here.',
    terminalDropped: (count) => `Dropped earlier lines: ${String(count)}`,
    terminalScrollToBottom: 'Scroll to bottom',
  },
  appHeader: {
    settings: 'Settings',
    models: 'Models',
    prerequisites: 'Prerequisites',
  },
  batchToolbar: {
    analyzeScope: 'Analyze scope',
    thisFolder: 'This folder',
    wholeTree: 'Whole tree',
    scopeToggleDisabled: 'This folder has no subfolders with videos.',
    batchWaitHint: 'Results usually arrive in minutes, but the API allows up to 24 hours.',
    processingCount: (current, total) => `Processing ${current} of ${total}`,
    stop: 'Stop',
    analyzeAll: (count) => `Analyze All (${count})`,
    analyzeUpTo: (count) => `Analyze All (up to ${count})`,
  },
  catalog: {
    noFolderSelected: 'No folder selected',
    openFolderHint: 'Open a folder to catalog its videos.',
    generatingThumbnails: 'Generating thumbnails…',
    lockedBy: (processName, pid) => `Catalog locked by ${processName} PID ${pid}`,
    retryLock: 'Retry',
    folderCounts: (pending, processed) => `${pending} pending · ${processed} done`,
    folderCountsWithDuplicates: (pending, processed, duplicates) =>
      `${pending} pending · ${processed} done · ${duplicates} ${duplicates === 1 ? 'duplicate' : 'duplicates'}`,
    unknownFolderCounts: (videoCount) => `${videoCount} ${videoCount === 1 ? 'video' : 'videos'}`,
    duplicateBadge: 'Duplicate',
    duplicateTooltip: (canonicalPath) => `Duplicate of ${canonicalPath}`,
    largeRunWarningTitle: 'Large folder tree',
    largeRunWarningBody: (count) => `${count} videos found. Analysis at this scale is better run from the CLI, and the initial scan may take a while.`,
    largeRunCommandLabel: 'Copy CLI command',
    skipped: 'Skipped',
    genericScanError: 'Could not scan this folder.',
    scanningFolder: 'Scanning folder…',
    noVideosFound: 'No videos found',
    noVideosInFolder: (subfolderCount) => `No videos in this folder — ${String(subfolderCount)} in subfolders.`,
    switchToWholeTree: 'Switch to Whole tree',
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
    selectVideoPrompt: 'Select a video from the list',
    videoTags: 'Video tags',
    videoInformation: 'Video Information',
    duration: 'Duration',
    unknown: 'Unknown',
    size: 'Size',
    location: 'Location',
    coordinates: 'Coordinates',
    showOnMap: 'Show on map',
    summary: 'Summary',
    suggestedFilename: 'Suggested filename:',
    estimatedGeminiCost: (amount, model, pricingMode) =>
      `Estimated Gemini cost: $${amount.toFixed(4)} USD · ${model} · ${pricingMode}`,
    noSummaryAvailable: 'No summary available. Run the analysis again to generate it.',
    extractedFrames: (count) => `Extracted Frames (${count})`,
    frame: (index) => `Frame ${index}`,
    transcript: 'Transcript',
    fullAiAnalysis: 'Full AI Analysis',
    analyzeVideo: 'Analyze Video',
    analyzeAction: 'Analyze',
    analyzingButton: 'Analyzing…',
    analyzeHint: 'This will extract frames, transcribe audio, and generate a summary using AI.',
    processingIncomplete: 'Processing Incomplete',
    incompleteHint: 'A previous processing attempt was interrupted. Click the button below to restart.',
    processingButton: 'Processing…',
    continueAnalysis: 'Continue Analysis',
    processingFailed: 'Processing Failed',
    retrying: 'Retrying…',
    retryAnalysis: 'Retry Analysis',
    duplicateTitle: 'Duplicate file',
    duplicateExplanation: 'This file has the same content as another video already in your catalog, so it is not analyzed automatically.',
    duplicateCanonicalLabel: 'Original file',
    analyzeAnyway: 'Analyze anyway',
    navigateToOriginal: 'Go to original',
    variants: {
      title: 'Analysis variants',
      count: (count) => `${count} ${count === 1 ? 'variant' : 'variants'}`,
      selected: 'Selected',
      legacySettingsUnknown: 'Settings partly unknown',
      configuredLabel: (analyzer, transcription, frames) => `${analyzer} - ${transcription} - ${frames}`,
      nativeTranscription: 'native transcript',
      localTranscription: (model) => `Local Whisper (${model})`,
      apiTranscription: (model) => `Whisper API (${model})`,
      transcriptionSkipped: 'No transcription',
      frameCount: (count) => `${count} ${count === 1 ? 'frame' : 'frames'}`,
      noFrames: 'no frames',
      frameExtractionDisabled: 'This variant does not extract frames',
      useAsSelected: 'Use as selected',
      selectionImpact: 'This changes search results and the frames, transcript, and summary files on disk.',
      compare: 'Compare variants',
      compareTitle: 'Compare analysis variants',
      backToDetails: 'Back to file details',
      configurationId: (configId) => `Configuration: ${configId}`,
      outputLanguage: (language) => `Output language: ${language}`,
      promptVersion: (version) => `Prompt version: ${version}`,
      videoDuration: (duration) => `Video duration: ${duration}`,
      estimatedCost: (amount) => `Estimated cost: $${amount.toFixed(4)} USD`,
      notRecorded: 'Not recorded',
      newVariant: 'Creates a new variant',
      existingVariant: 'Re-runs an existing variant with force',
      analysisState: (label, state) => `${label}. ${state}.`,
      createNewVariant: 'Analyze as new variant',
      rerunExistingVariant: 'Re-run existing variant',
      setFolderDefault: 'Use current configuration as folder default',
      folderDefault: 'Current configuration is the folder default',
      loading: 'Loading analysis variants…',
      loadError: 'Could not load analysis variants.',
      retry: 'Retry',
      actionError: 'Could not update the analysis variant.',
    },
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
    resultCount: (count) => `${count} ${count === 1 ? 'result' : 'results'}`,
    resultsFor: (query) => `Search results for ${query}`,
    driveNotConnected: 'drive not connected',
    fileMissing: 'file missing',
    multipleVariants: (count) => `${count} variants`,
    back: 'Back to catalog',
  },
  wizard: {
    stepLabels: {
      welcome: 'Welcome',
      language: 'Language',
      analyzer: 'Analyzer',
      transcription: 'Transcription',
      faces: 'Faces',
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
      api: 'API',
      harness: 'Agent harness',
      gemini: 'Gemini (native video)',
      geminiModel: 'Gemini model',
      geminiPrivacy: 'Gemini is the exception to local-first processing: the entire video file, including audio, is uploaded to Google. Files under about 20 MB are sent inline with the request; larger files use Google\'s Files API and are retained on Google\'s side for about 48 hours. The model produces the transcript. Cost scales with footage duration because video is charged in tokens per second, independent of resolution — expect roughly a few cents per minute. Do not use for private or confidential footage.',
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
      nativeSkipNotice: 'Gemini native video reads the audio itself, so transcription stays skipped and no Whisper download is needed.',
      whisperModel: 'Whisper model',
      installedSuffix: ' (installed)',
      buildToolsWarning: (tools) => `Building whisper needs: ${tools}.`,
      whisperBinaryPath: 'Whisper binary path',
      openAiApiKey: 'OpenAI API key',
      openAiApiKeyHelper: 'Leave blank to keep an existing OpenAI credential.',
    },
    faces: {
      title: 'Choose face indexing',
      localModels: 'Face detection and recognition run fully locally. YuNet detects faces and SFace creates embeddings; both are small on-device models.',
      peopleIndex: 'This builds the people index used by the People tab. A folder-tree run indexes faces in one extra pass after it finishes analyzing (roughly 1–2 seconds per clip); you can also run it on demand from the People tab.',
      enableLabel: 'Enable face detection and recognition',
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
      facesSaved: 'Face indexing saved',
      downloadFailed: 'Download failed',
      downloadingLocalModel: (tag) => `Downloading local model ${tag}`,
      buildingManagedWhisperRuntime: 'Building the managed whisper.cpp runtime',
      downloadingWhisperModel: (model) => `Downloading whisper model ${model}`,
      downloadingFaceModels: 'Downloading YuNet and SFace face models',
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
    activate: 'Activate',
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
    warningsTitle: 'Warnings',
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
    driveFolderDone: (path, done, skipped, duplicatesSkipped, failed) =>
      `✓ ${path}: ${String(done)} done, ${String(skipped)} skipped (${String(duplicatesSkipped)} duplicates), ${String(failed)} failed`,
    driveFileSkipped: (filename) => `↷ Skipped (already analyzed): ${filename}`,
    driveDuplicateSkipped: (filename) => `↷ Skipped duplicate: ${filename}`,
    driveSnapshotSkipped: (folder) => `⚠ Folder read-only — snapshot skipped: ${folder}`,
    driveRunComplete: (foldersDone, foldersTotal, done, skipped, duplicatesSkipped, failed, estimatedCostUsd, costedFiles) => {
      const estimate = estimatedCostUsd === null
        ? ''
        : `, estimated Gemini cost $${estimatedCostUsd.toFixed(4)} USD (${String(costedFiles)} file(s))`;
      return `=== Drive run complete: ${String(foldersDone)}/${String(foldersTotal)} folder(s), ${String(done)} done, ${String(skipped)} skipped (${String(duplicatesSkipped)} duplicates), ${String(failed)} failed${estimate} ===`;
    },
    driveBudgetCapReached: (month, estimatedSpendUsd, budgetUsd) =>
      `Gemini budget reached for ${month}: estimated spend $${estimatedSpendUsd.toFixed(4)} USD / $${budgetUsd.toFixed(2)} USD. Drive run paused.`,
    driveBatchSubmitted: (requestCount, reattached) =>
      reattached
        ? `↻ Re-attached to the batch job already running for ${String(requestCount)} file(s)`
        : `⇪ Batch submitted: ${String(requestCount)} file(s) at half price — usually minutes, up to 24h`,
    driveBatchPoll: (state, requestCount) => `… Batch ${state} (${String(requestCount)} file(s))`,
    driveBatchCompleted: (succeeded, failed) =>
      `✓ Batch results in: ${String(succeeded)} answered, ${String(failed)} failed`,
    driveBatchUploadsRetained: (retained) =>
      `! ${String(retained)} uploaded file(s) could not be deleted from Gemini; they expire on their own after 48h`,
    driveBatchOrphanJobs: (jobNames) =>
      `! This run adopts one batch job only. Other unfinished runs for this root still hold paid-for job(s): `
      + `${jobNames.join(', ')}. Re-run this root after this run finishes to collect them.`,
    driveBatchModelChanged: (jobModel, resolvedModel) =>
      `! The batch job was bought with ${jobModel}, but the configuration now resolves to ${resolvedModel}; `
      + 'its answers are recorded under the model that produced them',
    driveBatchWaiting: (requestCount) => `Batch submitted — awaiting results (${String(requestCount)} file(s))`,
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
    analysisBusy: 'Another analysis is already running. Wait for it to finish before starting a new one.',
    batchStart: (count) => `=== Starting batch analysis of ${String(count)} video(s) ===`,
    batchCancelled: (processed, total) => `Batch processing cancelled. Processed ${String(processed)} of ${String(total)} videos.`,
    batchProcessing: (current, total, filename) => `[${String(current)}/${String(total)}] Processing: ${filename}`,
    duplicateSkipped: (filename) => `↷ Skipped duplicate: ${filename}`,
    batchComplete: '=== Batch analysis complete ===',
    successCount: (count) => `Success: ${String(count)}`,
    duplicateSkippedCount: (count) => `Duplicates skipped: ${String(count)}`,
    failedCount: (count) => `Failed: ${String(count)}`,
    folderTreeCompleted: '✓ Folder tree analysis completed',
    driveProcessingFailed: 'Drive processing failed',
    driveProcessingDidNotFinish: 'Drive processing did not finish',
    driveStart: (root) => `=== Analyzing folder tree: ${root} ===`,
    stoppingDrive: 'Stopping folder tree analysis…',
    cancellingCurrentAndBatch: 'Cancelling current video and stopping batch…',
    cancellingAnalysis: 'Cancelling analysis…',
    stepLabels: {
      extracting_frames: 'Extracting frames',
      extracting_audio: 'Extracting audio',
      transcribing_audio: 'Transcribing audio',
      analyzing_with_claude: 'Analyzing with AI',
      renaming_video: 'Renaming video',
      skipping_rename: 'Finalizing',
      catalog_snapshot_skipped: 'Folder read-only — snapshot skipped',
      downloading: 'Downloading',
      runtime_setup: 'Preparing runtime',
      model_download: 'Downloading model',
      faces_scanning: 'Indexing faces',
      faces_done: 'Face indexing complete',
      faces_pass_skipped: 'Faces not indexed',
    },
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
    runIndexingInAnalysis: 'Open a folder in Analysis > Photos to index faces.',
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
    observationCount: (count) => `${count} ${count === 1 ? 'observation' : 'observations'}`,
    rename: 'Rename',
    delete: 'Delete',
    searchInLibrary: 'Search in Library',
    moreActions: (name) => `More actions for ${name}`,
    installingModelsLog: 'Installing face grouping models...',
    modelsInstalledLog: 'Face grouping models are installed',
    installModelsFailedLog: 'Failed to install face grouping models',
    indexingFacesLog: 'Indexing faces in the current folder...',
    indexUpdatedLog: 'Face grouping index is updated',
    indexFacesFailedLog: 'Failed to index faces',
    renamedGroupingLog: (name) => `Renamed grouping to ${name}`,
    renameGroupingFailedLog: 'Failed to rename grouping',
    mergedGroupingsLog: 'Merged face groupings',
    mergeGroupingsFailedLog: 'Failed to merge face groupings',
    deletedGroupingLog: 'Deleted face grouping',
    deleteGroupingFailedLog: 'Failed to delete face grouping',
    deletedAllFaceDataLog: 'Deleted all face data',
    deleteAllFaceDataFailedLog: 'Failed to delete all face data',
  },
  map: {
    title: 'Map',
    subtitle: 'Where your catalogued videos were recorded — offline, no map tiles are ever downloaded.',
    loading: 'Reading locations from the catalog…',
    coverage: (located, total) => `${located} of ${total} catalogued files have location`,
    coveragePhotos: (located, total) => `${located} of ${total} catalogued photos have location`,
    emptyTitle: 'No files with location yet',
    emptyBody: 'Location comes from GPS metadata the camera wrote into the file. Analyse a folder to add its files to the catalog; files without GPS metadata never appear here.',
    canvasLabel: 'Map of catalogued videos',
    clusterLabel: (count) => `${count} videos in this area`,
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    resetView: 'Reset view',
    openPhoto: 'Open photo',
    openPreview: 'Preview',
    coordinates: 'Coordinates',
    source: {
      camera: 'Measured (camera)',
      timeline: 'Approximate (timeline)',
      manual: 'Set by hand',
    },
    interval: {
      visit: 'place',
      activity: 'route leg',
      path: 'route point',
    },
    accuracy: (meters) => `±${meters} m`,
    place: 'Place',
    filter: {
      all: 'All',
      videos: 'Videos',
      photos: 'Photos',
    },
  },
  settingsModal: {
    title: 'Settings',
    selectFolderFirst: 'Please select a folder first to configure settings.',
    loading: 'Loading settings…',
    secondsValue: (seconds) => `${String(seconds)} seconds`,
    frameCount: 'Frame Count',
    frameCountValue: (count) => `${count} ${count === 1 ? 'frame' : 'frames'}`,
    frameCountHelper: 'Number of frames to extract from each video for analysis.',
    transcriptionMode: 'Transcription Mode',
    transcriptionLanguage: 'Transcription language',
    whisperModel: 'Whisper Model',
    customWhisperPath: 'Custom whisper.cpp path',
    customWhisperPathHelper: 'Optional. Takes precedence over the managed and system runtimes.',
    whisperApiBaseUrl: 'Whisper API base URL',
    whisperApiBaseUrlHelper: 'OpenAI-compatible Whisper API endpoint.',
    whisperApiModel: 'Whisper API model',
    openAiWhisperApiKey: 'OpenAI Whisper API key',
    openAiWhisperApiKeyHelper: 'Leave blank to keep the stored OpenAI credential.',
    analyzerTimeout: 'Analyzer timeout',
    analyzerTimeoutHelper: 'How long to wait for the AI analyzer before giving up.',
    facesSectionTitle: 'Local face grouping (experimental)',
    facesEnableLabel: 'Enable local face grouping',
    facesHelper: 'Everything stays on this Mac; face grouping is opt-in; you can delete all face data anytime.',
    geminiBatchSectionTitle: 'Gemini batch mode (whole-tree runs)',
    geminiBatchEnableLabel: 'Send whole-tree runs to the Gemini Batch API (half price)',
    geminiBatchHelper: 'Files are uploaded one by one, then the whole run waits for a single batch job. '
      + 'Results usually arrive in minutes, but Google allows up to 24 hours, so there is no per-file progress bar. '
      + 'Analyzing a single video is never batched. Quitting is safe: the run re-attaches to the same job.',
    geminiBudgetSectionTitle: 'Gemini monthly budget',
    geminiBudgetLabel: 'Monthly budget (USD)',
    geminiBudgetHelper: 'Whole-tree runs pause once this month\'s estimated Gemini spend reaches the cap. '
      + 'Leave blank for no cap. The figure is a local estimate from token counts, not a Google invoice.',
    geminiBudgetInvalid: 'Enter an amount above 0, or leave the field blank.',
    geminiSpendReadout: (month, estimatedCostUsd, entries) =>
      `Estimated spend for ${month}: $${estimatedCostUsd.toFixed(4)} USD across ${String(entries)} analyses.`,
    geminiSpendUnknown: 'Estimated spend for this month is not available yet.',
    skipAutoRename: 'Skip Auto-Rename',
    runSetupWizard: 'Run Setup Wizard',
    reset: 'Reset',
    saving: 'Saving…',
    savingKeychainHint: 'Waiting for the macOS Keychain — unlock it if it is locked.',
    whisperModes: {
      local: { label: 'Local (Whisper.cpp)', description: 'Uses local whisper.cpp binary' },
      api: { label: 'API (OpenAI)', description: 'Uses OpenAI Whisper API' },
      skip: { label: 'Skip Transcription', description: 'Do not transcribe audio' },
    },
    whisperModels: {
      tiny: { label: 'Tiny', description: 'Fastest, lowest accuracy' },
      base: { label: 'Base', description: 'Good balance of speed and accuracy' },
      small: { label: 'Small', description: 'Better accuracy, slower' },
      medium: { label: 'Medium', description: 'High accuracy, slow' },
      'large-v3': { label: 'Large v3', description: 'Best accuracy, slowest' },
      'large-v3-turbo': { label: 'Large v3 turbo', description: 'Large v3 accuracy, faster and smaller' },
    },
  },
  settingsAnalyzer: {
    aiAnalyzer: 'AI Analyzer',
    claudeCli: 'Claude (CLI)',
    localOllama: 'Local (Ollama)',
    openAiCompatibleApi: 'OpenAI-compatible API',
    localModel: 'Local model',
    recommendedSuffix: ' (recommended)',
    installedSuffix: ' — installed',
    unsupportedHint: 'This model exceeds what this machine supports.',
    notDownloadedHint: 'This model is not downloaded yet — open the Models manager to download it.',
    baseUrl: 'Base URL',
    model: 'Model',
    apiCredential: 'API credential',
    inputPrice: 'Input price per 1M tokens',
    outputPrice: 'Output price per 1M tokens',
    geminiNativeVideo: 'Gemini (native video)',
    geminiModel: 'Gemini model',
    geminiPrivacy: 'Gemini is the exception to local-first processing: the entire video file, including audio, is uploaded to Google. Files under about 20 MB are sent inline with the request; larger files use Google\'s Files API and are retained on Google\'s side for about 48 hours. The model produces the transcript. Cost scales with footage duration because video is charged in tokens per second, independent of resolution — expect roughly a few cents per minute. Do not use for private or confidential footage.',
    forgetCredential: 'Forget key',
  },
  credentials: {
    savedKeychain: 'API key saved in the macOS Keychain.',
    savedFile: 'API key saved in the config file.',
    clearedKeychain: 'Key removed from the macOS Keychain.',
    clearedFile: 'Key removed from the config file.',
    clearedBoth: 'Key removed from the macOS Keychain and the config file.',
    keychainRetained: 'The macOS Keychain still holds the key — unlock the login keychain and try again.',
    keychainUnavailable: 'The macOS Keychain could not be read, so a stored key cannot be used. Unlock the login keychain and try again — this is not the same as having no key.',
    notStored: 'No key was stored for this provider.',
    entryUnreadable: 'The credentials file entry for this provider could not be read, so nothing was removed. Fix or remove that entry by hand.',
    entryUnreadableRetained: 'The credentials file entry for this provider could not be read and was left untouched. Fix or remove that entry by hand.',
  },
  errors: {
    analyzerFailed: 'Analysis failed.',
    analyzerFailedWithCode: (code) => `Analysis failed (exit code ${String(code)}).`,
    analyzerCommandNotFound: 'Analyzer command was not found.',
    analyzerCommandNotStarted: 'Analyzer command could not be started.',
    analyzerTimedOut: 'Analysis timed out.',
    analyzerCancelled: 'Analysis was cancelled.',
    localAiUnavailable: 'Local AI runtime is unavailable.',
    modelNotInstalled: 'The selected model is not installed.',
    providerAuthFailed: 'The provider rejected the stored credential.',
    providerRateLimited: 'The provider rate limit was reached.',
    providerTimedOut: 'The provider request timed out.',
    providerRequestFailed: 'The provider request failed.',
    providerEmptyResponse: 'The provider returned an empty response.',
    rootNotFound: (path) => `Root not found: ${path}`,
  },
  folderBar: {
    openFolder: 'Open Folder',
    checking: 'Checking…',
    recentFolders: 'recent folders',
    clearRecent: 'Clear recent',
  },
  videoStatus: {
    incomplete: 'Incomplete',
    completed: 'Completed',
    error: 'Error',
    pending: 'Pending',
    notTracked: 'Not Tracked',
    processing: 'Processing',
  },
  nestedDbDialog: {
    title: 'Nested Databases Detected',
    bodyBefore: 'The selected folder contains nested ',
    bodyAfter: ' folders. This can cause data conflicts and unexpected behavior. Please remove or merge these nested databases before continuing:',
  },
  batchSummary: {
    title: 'Batch Analysis Complete',
    successful: 'successful',
    failed: 'failed',
    duplicatesSkipped: 'duplicates skipped',
    failedVideos: 'Failed videos:',
    unknownError: 'Unknown error',
  },
  driveSummary: {
    title: 'Folder Analysis Complete',
    folders: 'folders',
    analyzed: 'analyzed',
    skipped: 'skipped',
    duplicatesSkipped: 'duplicates skipped',
    failed: 'failed',
    estimatedCost: (files) => `estimated Gemini cost · ${String(files)} priced file(s)`,
  },
  harnessModelPicker: {
    model: 'Model',
    default: 'Default (CLI-configured)',
    customEscapeHatch: 'Advanced: custom model id…',
    customModelId: 'Custom model id',
    unvalidated: 'Unvalidated — this id is passed to the CLI as-is and is not checked against a known list.',
    reasoningEffort: 'Reasoning effort',
    effortDefault: 'Default',
  },
  cancelDialog: {
    batchTitle: 'Cancel Batch Processing?',
    singleTitle: 'Cancel Processing?',
    batchBody: 'Are you sure you want to cancel the batch analysis? This will stop after the current video finishes processing.',
    batchAlert: 'The current video may be left in an incomplete state. Already processed videos will keep their results.',
    singleBody: 'Are you sure you want to cancel the current video analysis?',
    singleAlert: 'This may leave the video in an incomplete state. Partial data (extracted frames, audio, etc.) may remain and you may need to re-analyze the video from the beginning.',
    continueProcessing: 'Continue Processing',
    stopBatch: 'Stop Batch',
    cancelAnalysis: 'Cancel Analysis',
  },
  photos: {
    title: 'Photos',
    subtitle: 'Browse scanned photo roots by capture day.',
    rootPickerLabel: 'Photo root',
    rootPickerAll: 'All photos',
    emptyNoRootsTitle: 'No photo folders scanned yet',
    emptyNoRootsBodyBrowse: 'Scan a folder from Analysis → Photos to start browsing here.',
    scanFolderAction: 'Scan a folder…',
    emptyNoPhotos: 'No photos found under this root.',
    generateProxiesAction: 'Generate proxies',
    proxiesPendingStrip: 'Proxies are still pending for this root.',
    unknownDate: 'Unknown date',
    duplicatesBadge: (count) => `${count} copies`,
    missingBadge: 'Missing',
    proxyFailedTooltip: 'Proxy generation failed for this photo',
    noProxyYet: 'No proxy yet',
    viewerClose: 'Close viewer',
    viewerPrevious: 'Previous photo',
    viewerNext: 'Next photo',
    detailCamera: 'Camera',
    detailLens: 'Lens',
    detailDimensions: 'Dimensions',
    detailExposure: 'Exposure',
    detailIso: 'ISO',
    detailAperture: 'Aperture',
    detailRating: 'Rating',
    detailCaptured: 'Captured',
    capturedSourceExifOffset: 'EXIF (UTC offset)',
    capturedSourceExifGpsTime: 'EXIF (GPS time)',
    capturedSourceExifLocalAssumed: 'EXIF (local time assumed)',
    capturedSourceFileMtime: 'File modified time',
    detailOwnerPath: 'Owner path',
    detailAlsoAt: (count) => `Also at: ${count} path${count === 1 ? '' : 's'}`,
    statusPhotos: (count) => `${count} photos`,
    statusPaths: (count) => `${count} paths`,
    statusProxied: (count) => `${count} proxied`,
    statusProxyFailed: (count) => `${count} proxy failed`,
    loadingPhotos: 'Loading photos…',
    loadMore: 'Load more',
    searchPlaceholder: 'Search file names, descriptions, tags, places…',
    searchResultsLabel: (count) => `${count} result${count === 1 ? '' : 's'}`,
    searchNoResults: 'No photos match this search.',
    searchClear: 'Clear search',
    analyzeAction: 'Analyze',
    analyzeProgress: (current, total) => `Analyzing ${current} of ${total}…`,
    cancelAnalysisAction: 'Cancel analysis',
    analysisCancelled: 'Analysis cancelled by user',
    analysisNone: 'Not analysed yet.',
    analyzeUnavailable: 'Select a photo whose folder has been scanned before analyzing.',
    detailDescription: 'Description',
    detailScene: 'Scene',
    detailQuality: 'Quality',
    detailTags: 'Tags',
    detailVariant: 'Analysis',
    detailVariantCount: (count) => `${count} variant${count === 1 ? '' : 's'}`,
    variantPickerLabel: 'Analysis variant',
    variantAutomatic: 'Automatic',
    scenePeople: 'People',
    sceneLandscape: 'Landscape',
    sceneUrban: 'Urban',
    sceneIndoor: 'Indoor',
    sceneFood: 'Food',
    sceneDocument: 'Document',
    sceneScreenshot: 'Screenshot',
    sceneAnimal: 'Animal',
    sceneVehicle: 'Vehicle',
    sceneEvent: 'Event',
    sceneObject: 'Object',
    sceneOther: 'Other',
    qualityGood: 'Good',
    qualityBlurry: 'Blurry',
    qualityDark: 'Dark',
    qualityOverexposed: 'Overexposed',
    qualityOther: 'Other',
    openInAnalysis: 'Open in Analysis',
  },
  photosSidebar: {
    noFolderTitle: 'No folder open',
    noFolderBody: 'Open a folder to see its photos.',
    autoScanningBody: 'Indexing photos in this folder…',
    scopeThisFolder: 'This folder',
    scopeAllFolders: 'All folders',
    badgeProxyFailed: 'Preview failed',
    badgeExifMissing: 'No EXIF',
    badgeMissing: 'File missing',
    badgeAnalyzing: 'Analyzing…',
    loadMore: 'Load more',
    analyzeFolderAction: 'Process',
  },
  photosWorkspace: {
    emptyTitle: 'Select a photo from the list',
  },
  library: {
    title: 'Library',
    subtitle: 'Browse everything ever processed, across every catalogued folder.',
    countHeader: (shown, total) => shown === total ? `${total} files` : `${shown} of ${total} files`,
    searchPlaceholder: 'Search the library…',
    recentSearches: 'Recent searches',
    topTags: 'Top tags',
    removeRecentSearch: (label: string) => `Remove ${label}`,
    loadingLibrary: 'Loading library…',
    loadMore: 'Load more',
    unknownDate: 'No date',
    emptyCatalogTitle: 'Nothing processed yet',
    emptyCatalogBody: 'Process a folder in Videos to start building your library.',
    emptyCatalogAction: 'Go to Videos',
    noMatchTitle: (query) => query.length === 0 ? 'No results' : `No results for "${query}"`,
    noMatchBody: 'Try a different search or clear the filters.',
    noMatchNamed: (parts) => `No files match ${parts}`,
    noMatchClearAction: 'Clear search',
    offlineFolderBadge: 'Drive not connected',
    missingBadge: 'Missing',
    openInAnalysis: 'Open in Analysis',
    copyPath: 'Copy path',
    groupByDate: 'Date',
    groupByFolder: 'Folder',
    filterTags: 'Tags',
    filterPeople: 'People',
    filterPlace: 'Place',
    filterFolder: 'Folder',
    filterFrom: 'From',
    filterTo: 'To',
    filterHasGps: 'GPS',
    filterHasGpsAny: 'Any',
    filterHasGpsWith: 'With GPS',
    filterHasGpsWithout: 'Without GPS',
    filterClearAll: 'Clear filters',
    filterDatePreset: 'Quick range',
    filterDatePresetAny: 'Any',
    filterDatePresetThisYear: 'This year',
    filterDatePresetLastYear: 'Last year',
    chipHasGps: 'With GPS',
    chipNoGps: 'Without GPS',
    chipFolder: (displayName) => `Folder: ${displayName}`,
    chipDateRange: (from, to) => `${from} – ${to}`,
    chipDateFrom: (from) => `From ${from}`,
    chipDateTo: (to) => `Until ${to}`,
    sortLabel: 'Sort',
    sortCapturedDesc: 'Newest first',
    sortCapturedAsc: 'Oldest first',
    sortNameAsc: 'Name',
    sortRelevance: 'Relevance',
  },
  preview: {
    offline: 'This file is on a drive that is not connected.',
    missing: 'This file is no longer at its catalogued path.',
    openInAnalysis: 'Open in Analysis',
  },
};

const plPlural = (count: number, one: string, few: string, many: string): string => {
  if (count === 1) return one;
  const lastTwo = count % 100;
  const last = count % 10;
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return few;
  return many;
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
    ok: 'OK',
    revealInFinder: 'Pokaż w Finderze',
    aspectPortraitLabel: 'Orientacja pionowa',
    aspectPanoramaLabel: 'Proporcje panoramiczne',
    revealFailed: 'Nie można pokazać tego pliku: jest poza wszystkimi znanymi folderami katalogu.',
    copyToClipboard: 'Kopiuj do schowka',
    copied: 'Skopiowano',
  },
  language: {
    stepTitle: 'Język',
    stepDescription: 'Wybierz język interfejsu oraz język generowanych opisów i nazw plików. Oba możesz później zmienić w Ustawieniach.',
    uiLabel: 'Język aplikacji',
    uiHelper: 'Język interfejsu aplikacji na komputerze.',
    outputLabel: 'Język opisów',
    outputHelper: 'Język, w którym AI pisze opisy i nazwy plików.',
    tagLabel: 'Język tagów',
    tagHelper: 'Język, w którym AI zapisuje tagi. Domyślnie taki jak język opisów.',
    optionAuto: 'Automatycznie (wybiera model)',
    optionEnglish: 'Angielski',
    optionPolish: 'Polski',
  },
  settings: {
    languageSectionTitle: 'Język',
    savedToast: 'Zapisano ustawienia',
  },
  appFrame: {
    sidebarHeading: 'Filmy',
    sidebarHeadingPhotos: 'Zdjęcia',
    hideSidebar: 'Ukryj',
    showSidebar: 'Pokaż',
    modeLibrary: 'Biblioteka',
    modeAnalysis: 'Analiza',
    subnavCollection: 'Kolekcja',
    subnavPhotos: 'Zdjęcia',
    subnavPeople: 'Osoby',
    subnavMap: 'Mapa',
    mediaVideos: 'Filmy',
    mediaPhotos: 'Zdjęcia',
    modeSwitcherLabel: 'Tryb aplikacji',
    subnavLabel: 'Sekcja biblioteki',
    mediaToggleLabel: 'Rodzaj mediów w analizie',
    terminalTitle: 'Terminal',
    terminalRaw: 'Surowe',
    terminalCopy: 'Kopiuj',
    terminalClear: 'Wyczyść',
    terminalCollapse: 'Zwiń',
    terminalExpand: 'Rozwiń',
    terminalEmpty: 'Brak danych wyjściowych. Uruchom analizę, aby zobaczyć postęp zadania.',
    terminalDropped: (count) => `Pominięte wcześniejsze wiersze: ${String(count)}`,
    terminalScrollToBottom: 'Przewiń na dół',
  },
  appHeader: {
    settings: 'Ustawienia',
    models: 'Modele',
    prerequisites: 'Wymagania',
  },
  batchToolbar: {
    analyzeScope: 'Zakres analizy',
    thisFolder: 'Ten folder',
    wholeTree: 'Całe drzewo',
    scopeToggleDisabled: 'Ten folder nie ma podfolderów z filmami.',
    batchWaitHint: 'Wyniki zwykle przychodzą w kilka minut, ale API dopuszcza do 24 godzin.',
    processingCount: (current, total) => `Przetwarzanie ${current} z ${total}`,
    stop: 'Stop',
    analyzeAll: (count) => `Analizuj wszystko (${count})`,
    analyzeUpTo: (count) => `Analizuj wszystko (do ${count})`,
  },
  catalog: {
    noFolderSelected: 'Nie wybrano folderu',
    openFolderHint: 'Otwórz folder, aby skatalogować jego filmy.',
    generatingThumbnails: 'Generowanie miniatur…',
    lockedBy: (processName, pid) => `Katalog zablokowany przez ${processName} PID ${pid}`,
    retryLock: 'Ponów',
    folderCounts: (pending, processed) => `${pending} oczekuje · ${processed} gotowe`,
    folderCountsWithDuplicates: (pending, processed, duplicates) =>
      `${pending} oczekuje · ${processed} gotowe · ${duplicates} ${plPlural(duplicates, 'duplikat', 'duplikaty', 'duplikatów')}`,
    unknownFolderCounts: (videoCount) => `${videoCount} ${plPlural(videoCount, 'film', 'filmy', 'filmów')}`,
    duplicateBadge: 'Duplikat',
    duplicateTooltip: (canonicalPath) => `Duplikat pliku ${canonicalPath}`,
    largeRunWarningTitle: 'Duże drzewo folderów',
    largeRunWarningBody: (count) => `Znaleziono ${count} filmów. Analizę w tej skali lepiej uruchomić z CLI, a początkowe skanowanie może chwilę potrwać.`,
    largeRunCommandLabel: 'Kopiuj polecenie CLI',
    skipped: 'Pominięto',
    genericScanError: 'Nie udało się przeskanować tego folderu.',
    scanningFolder: 'Skanowanie folderu…',
    noVideosFound: 'Nie znaleziono filmów',
    noVideosInFolder: (subfolderCount) => `Brak filmów w tym folderze — ${String(subfolderCount)} w podfolderach.`,
    switchToWholeTree: 'Przełącz na całe drzewo',
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
    selectVideoPrompt: 'Wybierz film z listy',
    videoTags: 'Tagi filmu',
    videoInformation: 'Informacje o filmie',
    duration: 'Czas trwania',
    unknown: 'Nieznany',
    size: 'Rozmiar',
    location: 'Lokalizacja',
    coordinates: 'Współrzędne',
    showOnMap: 'Pokaż na mapie',
    summary: 'Streszczenie',
    suggestedFilename: 'Sugerowana nazwa pliku:',
    estimatedGeminiCost: (amount, model, pricingMode) =>
      `Szacowany koszt Gemini: ${amount.toFixed(4)} USD · ${model} · ${pricingMode}`,
    noSummaryAvailable: 'Brak streszczenia. Uruchom analizę ponownie, aby je wygenerować.',
    extractedFrames: (count) => `Wyodrębnione klatki (${count})`,
    frame: (index) => `Klatka ${index}`,
    transcript: 'Transkrypcja',
    fullAiAnalysis: 'Pełna analiza AI',
    analyzeVideo: 'Analizuj film',
    analyzeAction: 'Analizuj',
    analyzingButton: 'Analizowanie…',
    analyzeHint: 'Wyodrębni klatki, przepisze audio i wygeneruje streszczenie przy użyciu AI.',
    processingIncomplete: 'Przetwarzanie nieukończone',
    incompleteHint: 'Poprzednia próba przetwarzania została przerwana. Kliknij przycisk poniżej, aby wznowić.',
    processingButton: 'Przetwarzanie…',
    continueAnalysis: 'Kontynuuj analizę',
    processingFailed: 'Przetwarzanie nie powiodło się',
    retrying: 'Ponawianie…',
    retryAnalysis: 'Ponów analizę',
    duplicateTitle: 'Plik zduplikowany',
    duplicateExplanation: 'Ten plik ma tę samą zawartość co inny film już w katalogu, więc nie jest analizowany automatycznie.',
    duplicateCanonicalLabel: 'Plik oryginalny',
    analyzeAnyway: 'Analizuj mimo to',
    navigateToOriginal: 'Przejdź do oryginału',
    variants: {
      title: 'Warianty analizy',
      count: (count) => `${count} ${plPlural(count, 'wariant', 'warianty', 'wariantów')}`,
      selected: 'Wybrany',
      legacySettingsUnknown: 'Ustawienia częściowo nieznane',
      configuredLabel: (analyzer, transcription, frames) => `${analyzer} - ${transcription} - ${frames}`,
      nativeTranscription: 'transkrypcja natywna',
      localTranscription: (model) => `Lokalny Whisper (${model})`,
      apiTranscription: (model) => `Whisper API (${model})`,
      transcriptionSkipped: 'Bez transkrypcji',
      frameCount: (count) => `${count} ${plPlural(count, 'klatka', 'klatki', 'klatek')}`,
      noFrames: 'bez klatek',
      frameExtractionDisabled: 'ten wariant nie ekstrahuje klatek',
      useAsSelected: 'Użyj jako wybranego',
      selectionImpact: 'Zmienia wyniki wyszukiwania oraz pliki klatek, transkrypcji i streszczenia na dysku.',
      compare: 'Porównaj warianty',
      compareTitle: 'Porównaj warianty analizy',
      backToDetails: 'Wróć do szczegółów pliku',
      configurationId: (configId) => `Konfiguracja: ${configId}`,
      outputLanguage: (language) => `Język wyniku: ${language}`,
      promptVersion: (version) => `Wersja promptu: ${version}`,
      videoDuration: (duration) => `Czas trwania filmu: ${duration}`,
      estimatedCost: (amount) => `Szacowany koszt: ${amount.toFixed(4)} USD`,
      notRecorded: 'Nie zapisano',
      newVariant: 'Utworzy nowy wariant',
      existingVariant: 'Ponownie uruchomi istniejący wariant z wymuszeniem',
      analysisState: (label, state) => `${label}. ${state}.`,
      createNewVariant: 'Analizuj jako nowy wariant',
      rerunExistingVariant: 'Uruchom istniejący wariant ponownie',
      setFolderDefault: 'Ustaw bieżącą konfigurację jako domyślną folderu',
      folderDefault: 'Bieżąca konfiguracja jest domyślna dla folderu',
      loading: 'Wczytywanie wariantów analizy…',
      loadError: 'Nie udało się wczytać wariantów analizy.',
      retry: 'Ponów',
      actionError: 'Nie udało się zaktualizować wariantu analizy.',
    },
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
    resultCount: (count) => `${count} ${plPlural(count, 'wynik', 'wyniki', 'wyników')}`,
    resultsFor: (query) => `Wyniki wyszukiwania dla ${query}`,
    driveNotConnected: 'dysk niepodłączony',
    fileMissing: 'brak pliku',
    multipleVariants: (count) => `${count} ${plPlural(count, 'wariant', 'warianty', 'wariantów')}`,
    back: 'Powrót do katalogu',
  },
  wizard: {
    stepLabels: {
      welcome: 'Witaj',
      language: 'Język',
      analyzer: 'Analizator',
      transcription: 'Transkrypcja',
      faces: 'Twarze',
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
      api: 'API',
      harness: 'Agent harness',
      gemini: 'Gemini (natywne wideo)',
      geminiModel: 'Model Gemini',
      geminiPrivacy: 'Gemini jest wyjątkiem od lokalnego przetwarzania: cały plik wideo, wraz z dźwiękiem, jest wysyłany do Google. Pliki poniżej ok. 20 MB trafiają bezpośrednio w żądaniu; większe korzystają z Google Files API i są przechowywane po stronie Google przez ok. 48 godzin. Transkrypcję tworzy model. Koszt rośnie wraz z długością nagrania, bo wideo jest rozliczane w tokenach na sekundę, niezależnie od rozdzielczości — orientacyjnie to kilka centów za minutę. Nie używaj do prywatnych ani poufnych nagrań.',
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
      nativeSkipNotice: 'Gemini native video sam czyta ścieżkę dźwiękową, więc transkrypcja pozostaje pominięta i pobieranie Whispera jest zbędne.',
      whisperModel: 'Model whisper',
      installedSuffix: ' (zainstalowany)',
      buildToolsWarning: (tools) => `Budowanie whisper wymaga: ${tools}.`,
      whisperBinaryPath: 'Ścieżka do pliku whisper',
      openAiApiKey: 'Klucz OpenAI API',
      openAiApiKeyHelper: 'Pozostaw puste, aby zachować istniejące dane OpenAI.',
    },
    faces: {
      title: 'Wybierz indeksowanie twarzy',
      localModels: 'Wykrywanie i rozpoznawanie twarzy działa wyłącznie lokalnie. YuNet wykrywa twarze, a SFace tworzy embeddingi; oba są małymi modelami działającymi na urządzeniu.',
      peopleIndex: 'Tworzy to indeks osób używany przez kartę Osoby. Analiza drzewa folderów indeksuje twarze w dodatkowym przebiegu po zakończeniu analizy (około 1–2 sekundy na klip); możesz też uruchomić go na żądanie z karty Osoby.',
      enableLabel: 'Włącz wykrywanie i rozpoznawanie twarzy',
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
      facesSaved: 'Zapisano indeksowanie twarzy',
      downloadFailed: 'Pobieranie nie powiodło się',
      downloadingLocalModel: (tag) => `Pobieranie modelu lokalnego ${tag}`,
      buildingManagedWhisperRuntime: 'Budowanie zarządzanego whisper.cpp runtime',
      downloadingWhisperModel: (model) => `Pobieranie modelu whisper ${model}`,
      downloadingFaceModels: 'Pobieranie modeli twarzy YuNet i SFace',
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
    activate: 'Aktywuj',
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
    warningsTitle: 'Ostrzeżenia',
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
    driveFolderDone: (path, done, skipped, duplicatesSkipped, failed) =>
      `✓ ${path}: ${String(done)} gotowe, ${String(skipped)} pominięte (${String(duplicatesSkipped)} duplikatów), ${String(failed)} błędne`,
    driveFileSkipped: (filename) => `↷ Pominięto (już przeanalizowano): ${filename}`,
    driveDuplicateSkipped: (filename) => `↷ Pominięto duplikat: ${filename}`,
    driveSnapshotSkipped: (folder) => `⚠ Folder tylko do odczytu — pominięto migawkę: ${folder}`,
    driveRunComplete: (foldersDone, foldersTotal, done, skipped, duplicatesSkipped, failed, estimatedCostUsd, costedFiles) => {
      const estimate = estimatedCostUsd === null
        ? ''
        : `, szacowany koszt Gemini ${estimatedCostUsd.toFixed(4)} USD (${String(costedFiles)} plik(i))`;
      return `=== Analiza drzewa ukończona: ${String(foldersDone)}/${String(foldersTotal)} folder(y), ${String(done)} gotowe, ${String(skipped)} pominięte (${String(duplicatesSkipped)} duplikatów), ${String(failed)} błędne${estimate} ===`;
    },
    driveBudgetCapReached: (month, estimatedSpendUsd, budgetUsd) =>
      `Osiągnięto budżet Gemini za ${month}: szacowane wydatki ${estimatedSpendUsd.toFixed(4)} USD / ${budgetUsd.toFixed(2)} USD. Analiza dysku została wstrzymana.`,
    driveBatchSubmitted: (requestCount, reattached) =>
      reattached
        ? `↻ Podpięto do już uruchomionego zadania wsadowego dla ${String(requestCount)} plik(ów)`
        : `⇪ Wysłano wsad: ${String(requestCount)} plik(i) za pół ceny — zwykle minuty, do 24 h`,
    driveBatchPoll: (state, requestCount) => `… Wsad: ${state} (${String(requestCount)} plik(i))`,
    driveBatchCompleted: (succeeded, failed) =>
      `✓ Wyniki wsadu: ${String(succeeded)} z odpowiedzią, ${String(failed)} błędnych`,
    driveBatchUploadsRetained: (retained) =>
      `! Nie udało się usunąć ${String(retained)} przesłanych plików z Gemini; wygasną same po 48 h`,
    driveBatchOrphanJobs: (jobNames) =>
      '! Ten przebieg podpina się tylko do jednego zadania wsadowego. Inne niedokończone przebiegi tego katalogu '
      + `wciąż trzymają opłacone zadania: ${jobNames.join(', ')}. Uruchom ten katalog ponownie po zakończeniu `
      + 'tego przebiegu, żeby je odebrać.',
    driveBatchModelChanged: (jobModel, resolvedModel) =>
      `! Zadanie wsadowe kupiono na modelu ${jobModel}, a konfiguracja wskazuje teraz ${resolvedModel}; `
      + 'jego odpowiedzi zapisujemy pod modelem, który je wygenerował',
    driveBatchWaiting: (requestCount) => `Wysłano wsad — czekamy na wyniki (${String(requestCount)} plik(i))`,
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
    analysisBusy: 'Inna analiza jest już w toku. Poczekaj na jej zakończenie przed rozpoczęciem nowej.',
    batchStart: (count) => `=== Rozpoczynanie analizy wsadowej ${String(count)} film(ów) ===`,
    batchCancelled: (processed, total) => `Przetwarzanie wsadowe anulowane. Przetworzono ${String(processed)} z ${String(total)} filmów.`,
    batchProcessing: (current, total, filename) => `[${String(current)}/${String(total)}] Przetwarzanie: ${filename}`,
    duplicateSkipped: (filename) => `↷ Pominięto duplikat: ${filename}`,
    batchComplete: '=== Analiza wsadowa ukończona ===',
    successCount: (count) => `Sukces: ${String(count)}`,
    duplicateSkippedCount: (count) => `Pominięte duplikaty: ${String(count)}`,
    failedCount: (count) => `Błędy: ${String(count)}`,
    folderTreeCompleted: '✓ Analiza drzewa folderów ukończona',
    driveProcessingFailed: 'Przetwarzanie dysku nie powiodło się',
    driveProcessingDidNotFinish: 'Przetwarzanie dysku nie zostało ukończone',
    driveStart: (root) => `=== Analiza drzewa folderów: ${root} ===`,
    stoppingDrive: 'Zatrzymywanie analizy drzewa folderów…',
    cancellingCurrentAndBatch: 'Anulowanie bieżącego filmu i zatrzymywanie wsadu…',
    cancellingAnalysis: 'Anulowanie analizy…',
    stepLabels: {
      extracting_frames: 'Wyodrębnianie klatek',
      extracting_audio: 'Wyodrębnianie dźwięku',
      transcribing_audio: 'Transkrypcja dźwięku',
      analyzing_with_claude: 'Analiza przez AI',
      renaming_video: 'Zmiana nazwy filmu',
      skipping_rename: 'Finalizowanie',
      catalog_snapshot_skipped: 'Folder tylko do odczytu — pominięto migawkę',
      downloading: 'Pobieranie',
      runtime_setup: 'Przygotowywanie runtime',
      model_download: 'Pobieranie modelu',
      faces_scanning: 'Indeksowanie twarzy',
      faces_done: 'Indeksowanie twarzy zakończone',
      faces_pass_skipped: 'Twarze nie zostały zindeksowane',
    },
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
    runIndexingInAnalysis: 'Otwórz folder w Analiza > Zdjęcia, aby zindeksować twarze.',
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
    observationCount: (count) => `${count} ${plPlural(count, 'obserwacja', 'obserwacje', 'obserwacji')}`,
    rename: 'Zmień nazwę',
    delete: 'Usuń',
    searchInLibrary: 'Szukaj w Bibliotece',
    moreActions: (name) => `Więcej działań dla ${name}`,
    installingModelsLog: 'Instalowanie modeli grupowania twarzy...',
    modelsInstalledLog: 'Modele grupowania twarzy zostały zainstalowane',
    installModelsFailedLog: 'Nie udało się zainstalować modeli grupowania twarzy',
    indexingFacesLog: 'Indeksowanie twarzy w bieżącym folderze...',
    indexUpdatedLog: 'Indeks grupowania twarzy został zaktualizowany',
    indexFacesFailedLog: 'Nie udało się zindeksować twarzy',
    renamedGroupingLog: (name) => `Zmieniono nazwę grupy na ${name}`,
    renameGroupingFailedLog: 'Nie udało się zmienić nazwy grupy',
    mergedGroupingsLog: 'Scalono grupy twarzy',
    mergeGroupingsFailedLog: 'Nie udało się scalić grup twarzy',
    deletedGroupingLog: 'Usunięto grupę twarzy',
    deleteGroupingFailedLog: 'Nie udało się usunąć grupy twarzy',
    deletedAllFaceDataLog: 'Usunięto wszystkie dane twarzy',
    deleteAllFaceDataFailedLog: 'Nie udało się usunąć wszystkich danych twarzy',
  },
  map: {
    title: 'Mapa',
    subtitle: 'Gdzie nagrano skatalogowane filmy — offline, kafelki mapy nigdy nie są pobierane.',
    loading: 'Wczytywanie lokalizacji z katalogu…',
    coverage: (located, total) => `${located} z ${total} skatalogowanych plików ma lokalizację`,
    coveragePhotos: (located, total) => `${located} z ${total} skatalogowanych zdjęć ma lokalizację`,
    emptyTitle: 'Brak plików z lokalizacją',
    emptyBody: 'Lokalizacja pochodzi z metadanych GPS zapisanych przez aparat. Przeanalizuj folder, aby dodać jego pliki do katalogu; pliki bez metadanych GPS nigdy się tu nie pojawią.',
    canvasLabel: 'Mapa skatalogowanych filmów',
    clusterLabel: (count) => `${count} filmów w tym obszarze`,
    zoomIn: 'Przybliż',
    zoomOut: 'Oddal',
    resetView: 'Zresetuj widok',
    openPhoto: 'Otwórz zdjęcie',
    openPreview: 'Podgląd',
    coordinates: 'Współrzędne',
    source: {
      camera: 'Zmierzone (aparat)',
      timeline: 'Przybliżone (oś czasu)',
      manual: 'Ustawione ręcznie',
    },
    interval: {
      visit: 'miejsce',
      activity: 'odcinek trasy',
      path: 'punkt trasy',
    },
    accuracy: (meters) => `±${meters} m`,
    place: 'Miejsce',
    filter: {
      all: 'Wszystko',
      videos: 'Filmy',
      photos: 'Zdjęcia',
    },
  },
  settingsModal: {
    title: 'Ustawienia',
    selectFolderFirst: 'Najpierw wybierz folder, aby skonfigurować ustawienia.',
    loading: 'Ładowanie ustawień…',
    secondsValue: (seconds) => `${String(seconds)} s`,
    frameCount: 'Liczba klatek',
    frameCountValue: (count) => `${count} ${plPlural(count, 'klatka', 'klatki', 'klatek')}`,
    frameCountHelper: 'Liczba klatek wyodrębnianych z każdego filmu do analizy.',
    transcriptionMode: 'Tryb transkrypcji',
    transcriptionLanguage: 'Język transkrypcji',
    whisperModel: 'Model Whisper',
    customWhisperPath: 'Własna ścieżka whisper.cpp',
    customWhisperPathHelper: 'Opcjonalne. Ma pierwszeństwo przed zarządzanym i systemowym runtime.',
    whisperApiBaseUrl: 'Bazowy URL API Whisper',
    whisperApiBaseUrlHelper: 'Punkt końcowy API Whisper zgodny z OpenAI.',
    whisperApiModel: 'Model API Whisper',
    openAiWhisperApiKey: 'Klucz OpenAI Whisper API',
    openAiWhisperApiKeyHelper: 'Pozostaw puste, aby zachować zapisane dane OpenAI.',
    analyzerTimeout: 'Limit czasu analizatora',
    analyzerTimeoutHelper: 'Jak długo czekać na analizator AI, zanim zostanie przerwany.',
    facesSectionTitle: 'Lokalne grupowanie twarzy (eksperymentalne)',
    facesEnableLabel: 'Włącz lokalne grupowanie twarzy',
    facesHelper: 'Wszystko pozostaje na tym Macu; grupowanie twarzy jest opcjonalne; w każdej chwili możesz usunąć wszystkie dane twarzy.',
    geminiBatchSectionTitle: 'Tryb wsadowy Gemini (analiza drzewa folderów)',
    geminiBatchEnableLabel: 'Wysyłaj analizę drzewa przez Gemini Batch API (połowa ceny)',
    geminiBatchHelper: 'Pliki lecą po kolei, a potem cały bieg czeka na jedno zadanie wsadowe. '
      + 'Wyniki zwykle są w kilka minut, ale Google dopuszcza do 24 godzin, więc nie ma paska postępu per plik. '
      + 'Analiza pojedynczego filmu nigdy nie idzie wsadowo. Zamknięcie aplikacji jest bezpieczne: bieg podepnie się do tego samego zadania.',
    geminiBudgetSectionTitle: 'Miesięczny budżet Gemini',
    geminiBudgetLabel: 'Budżet miesięczny (USD)',
    geminiBudgetHelper: 'Analiza drzewa zatrzyma się, gdy szacowane wydatki Gemini w tym miesiącu osiągną limit. '
      + 'Puste pole oznacza brak limitu. Kwota to lokalny szacunek z liczby tokenów, a nie faktura od Google.',
    geminiBudgetInvalid: 'Podaj kwotę większą od 0 albo zostaw pole puste.',
    geminiSpendReadout: (month, estimatedCostUsd, entries) =>
      `Szacowane wydatki za ${month}: ${estimatedCostUsd.toFixed(4)} USD w ${String(entries)} analizach.`,
    geminiSpendUnknown: 'Szacowane wydatki za ten miesiąc nie są jeszcze dostępne.',
    skipAutoRename: 'Pomiń automatyczną zmianę nazw',
    runSetupWizard: 'Uruchom kreatora konfiguracji',
    reset: 'Resetuj',
    saving: 'Zapisywanie…',
    savingKeychainHint: 'Czekam na pęk kluczy macOS — odblokuj go, jeśli jest zablokowany.',
    whisperModes: {
      local: { label: 'Lokalnie (Whisper.cpp)', description: 'Używa lokalnego pliku whisper.cpp' },
      api: { label: 'API (OpenAI)', description: 'Używa API OpenAI Whisper' },
      skip: { label: 'Pomiń transkrypcję', description: 'Nie transkrybuj dźwięku' },
    },
    whisperModels: {
      tiny: { label: 'Tiny', description: 'Najszybszy, najniższa dokładność' },
      base: { label: 'Base', description: 'Dobry balans szybkości i dokładności' },
      small: { label: 'Small', description: 'Lepsza dokładność, wolniejszy' },
      medium: { label: 'Medium', description: 'Wysoka dokładność, wolny' },
      'large-v3': { label: 'Large v3', description: 'Najlepsza dokładność, najwolniejszy' },
      'large-v3-turbo': { label: 'Large v3 turbo', description: 'Dokładność Large v3, szybszy i mniejszy' },
    },
  },
  settingsAnalyzer: {
    aiAnalyzer: 'Analizator AI',
    claudeCli: 'Claude (CLI)',
    localOllama: 'Lokalny (Ollama)',
    openAiCompatibleApi: 'API zgodne z OpenAI',
    localModel: 'Model lokalny',
    recommendedSuffix: ' (zalecane)',
    installedSuffix: ' — zainstalowany',
    unsupportedHint: 'Ten model przekracza możliwości tego komputera.',
    notDownloadedHint: 'Ten model nie został jeszcze pobrany — otwórz Menedżer modeli, aby go pobrać.',
    baseUrl: 'Bazowy URL',
    model: 'Model',
    apiCredential: 'Dane logowania API',
    inputPrice: 'Cena wejścia za 1M tokenów',
    outputPrice: 'Cena wyjścia za 1M tokenów',
    geminiNativeVideo: 'Gemini (natywne wideo)',
    geminiModel: 'Model Gemini',
    geminiPrivacy: 'Gemini jest wyjątkiem od lokalnego przetwarzania: cały plik wideo, wraz z dźwiękiem, jest wysyłany do Google. Pliki poniżej ok. 20 MB trafiają bezpośrednio w żądaniu; większe korzystają z Google Files API i są przechowywane po stronie Google przez ok. 48 godzin. Transkrypcję tworzy model. Koszt rośnie wraz z długością nagrania, bo wideo jest rozliczane w tokenach na sekundę, niezależnie od rozdzielczości — orientacyjnie to kilka centów za minutę. Nie używaj do prywatnych ani poufnych nagrań.',
    forgetCredential: 'Usuń klucz',
  },
  credentials: {
    savedKeychain: 'Klucz API zapisano w pęku kluczy macOS.',
    savedFile: 'Klucz API zapisano w pliku konfiguracyjnym.',
    clearedKeychain: 'Klucz usunięty z pęku kluczy macOS.',
    clearedFile: 'Klucz usunięty z pliku konfiguracyjnego.',
    clearedBoth: 'Klucz usunięty z pęku kluczy macOS i pliku konfiguracyjnego.',
    keychainRetained: 'Pęk kluczy macOS nadal przechowuje klucz — odblokuj pęk kluczy logowania i spróbuj ponownie.',
    keychainUnavailable: 'Nie udało się odczytać pęku kluczy macOS, więc zapisany klucz jest niedostępny. Odblokuj pęk kluczy logowania i spróbuj ponownie — to nie znaczy, że klucza nie ma.',
    notStored: 'Dla tego dostawcy nie zapisano żadnego klucza.',
    entryUnreadable: 'Nie udało się odczytać wpisu tego dostawcy w pliku poświadczeń, więc nic nie zostało usunięte. Popraw lub usuń ten wpis ręcznie.',
    entryUnreadableRetained: 'Nie udało się odczytać wpisu tego dostawcy w pliku poświadczeń i został on nietknięty. Popraw lub usuń ten wpis ręcznie.',
  },
  errors: {
    analyzerFailed: 'Analiza nie powiodła się.',
    analyzerFailedWithCode: (code) => `Analiza nie powiodła się (kod wyjścia ${String(code)}).`,
    analyzerCommandNotFound: 'Nie znaleziono polecenia analizatora.',
    analyzerCommandNotStarted: 'Nie udało się uruchomić polecenia analizatora.',
    analyzerTimedOut: 'Przekroczono limit czasu analizy.',
    analyzerCancelled: 'Analiza została anulowana.',
    localAiUnavailable: 'Lokalny model AI jest niedostępny.',
    modelNotInstalled: 'Wybrany model nie jest zainstalowany.',
    providerAuthFailed: 'Dostawca odrzucił zapisane poświadczenia.',
    providerRateLimited: 'Osiągnięto limit zapytań dostawcy.',
    providerTimedOut: 'Przekroczono czas odpowiedzi dostawcy.',
    providerRequestFailed: 'Żądanie do dostawcy nie powiodło się.',
    providerEmptyResponse: 'Dostawca zwrócił pustą odpowiedź.',
    rootNotFound: (path) => `Nie znaleziono folderu: ${path}`,
  },
  folderBar: {
    openFolder: 'Otwórz folder',
    checking: 'Sprawdzanie…',
    recentFolders: 'ostatnie foldery',
    clearRecent: 'Wyczyść ostatnie',
  },
  videoStatus: {
    incomplete: 'Nieukończony',
    completed: 'Ukończony',
    error: 'Błąd',
    pending: 'Oczekuje',
    notTracked: 'Nieśledzony',
    processing: 'Przetwarzanie',
  },
  nestedDbDialog: {
    title: 'Wykryto zagnieżdżone bazy danych',
    bodyBefore: 'Wybrany folder zawiera zagnieżdżone foldery ',
    bodyAfter: '. Może to powodować konflikty danych i nieoczekiwane zachowanie. Usuń lub scal te zagnieżdżone bazy danych przed kontynuowaniem:',
  },
  batchSummary: {
    title: 'Analiza wsadowa ukończona',
    successful: 'udanych',
    failed: 'nieudanych',
    duplicatesSkipped: 'pominiętych duplikatów',
    failedVideos: 'Nieudane filmy:',
    unknownError: 'Nieznany błąd',
  },
  driveSummary: {
    title: 'Analiza folderu ukończona',
    folders: 'folderów',
    analyzed: 'przeanalizowanych',
    skipped: 'pominiętych',
    duplicatesSkipped: 'pominiętych duplikatów',
    failed: 'nieudanych',
    estimatedCost: (files) => `szacowany koszt Gemini · ${String(files)} wycenionych plików`,
  },
  harnessModelPicker: {
    model: 'Model',
    default: 'Domyślny (konfiguracja CLI)',
    customEscapeHatch: 'Zaawansowane: własny identyfikator modelu…',
    customModelId: 'Własny identyfikator modelu',
    unvalidated: 'Niezweryfikowany — ten identyfikator jest przekazywany do CLI bez zmian i nie jest sprawdzany względem znanej listy.',
    reasoningEffort: 'Wysiłek rozumowania',
    effortDefault: 'Domyślny',
  },
  cancelDialog: {
    batchTitle: 'Anulować przetwarzanie wsadowe?',
    singleTitle: 'Anulować przetwarzanie?',
    batchBody: 'Czy na pewno chcesz anulować analizę wsadową? Zatrzyma się po zakończeniu przetwarzania bieżącego filmu.',
    batchAlert: 'Bieżący film może pozostać w stanie nieukończonym. Już przetworzone filmy zachowają swoje wyniki.',
    singleBody: 'Czy na pewno chcesz anulować analizę bieżącego filmu?',
    singleAlert: 'Może to pozostawić film w stanie nieukończonym. Częściowe dane (wyodrębnione klatki, audio itp.) mogą pozostać i konieczne może być ponowne przeanalizowanie filmu od początku.',
    continueProcessing: 'Kontynuuj przetwarzanie',
    stopBatch: 'Zatrzymaj wsad',
    cancelAnalysis: 'Anuluj analizę',
  },
  photos: {
    title: 'Zdjęcia',
    subtitle: 'Przeglądaj zeskanowane foldery zdjęć według dnia wykonania.',
    rootPickerLabel: 'Folder zdjęć',
    rootPickerAll: 'Wszystkie zdjęcia',
    emptyNoRootsTitle: 'Nie zeskanowano jeszcze żadnego folderu zdjęć',
    emptyNoRootsBodyBrowse: 'Zeskanuj folder w Analizie → Zdjęcia, aby zacząć tu przeglądać.',
    scanFolderAction: 'Zeskanuj folder…',
    emptyNoPhotos: 'Nie znaleziono zdjęć w tym folderze.',
    generateProxiesAction: 'Wygeneruj podglądy',
    proxiesPendingStrip: 'Podglądy dla tego folderu wciąż oczekują na wygenerowanie.',
    unknownDate: 'Nieznana data',
    duplicatesBadge: (count) => `${count} kopii`,
    missingBadge: 'Brak pliku',
    proxyFailedTooltip: 'Nie udało się wygenerować podglądu dla tego zdjęcia',
    noProxyYet: 'Podgląd jeszcze niedostępny',
    viewerClose: 'Zamknij podgląd',
    viewerPrevious: 'Poprzednie zdjęcie',
    viewerNext: 'Następne zdjęcie',
    detailCamera: 'Aparat',
    detailLens: 'Obiektyw',
    detailDimensions: 'Wymiary',
    detailExposure: 'Czas naświetlania',
    detailIso: 'ISO',
    detailAperture: 'Przysłona',
    detailRating: 'Ocena',
    detailCaptured: 'Data wykonania',
    capturedSourceExifOffset: 'EXIF (przesunięcie UTC)',
    capturedSourceExifGpsTime: 'EXIF (czas GPS)',
    capturedSourceExifLocalAssumed: 'EXIF (założony czas lokalny)',
    capturedSourceFileMtime: 'Czas modyfikacji pliku',
    detailOwnerPath: 'Ścieżka właściciela',
    detailAlsoAt: (count) => `Także w: ${count} ${plPlural(count, 'ścieżce', 'ścieżkach', 'ścieżkach')}`,
    statusPhotos: (count) => `${count} ${plPlural(count, 'zdjęcie', 'zdjęcia', 'zdjęć')}`,
    statusPaths: (count) => `${count} ${plPlural(count, 'ścieżka', 'ścieżki', 'ścieżek')}`,
    statusProxied: (count) => `${count} z podglądem`,
    statusProxyFailed: (count) => `${count} nieudanych podglądów`,
    loadingPhotos: 'Ładowanie zdjęć…',
    loadMore: 'Wczytaj więcej',
    searchPlaceholder: 'Szukaj po nazwie pliku, opisie, tagach, miejscu…',
    searchResultsLabel: (count) => `${count} ${plPlural(count, 'wynik', 'wyniki', 'wyników')}`,
    searchNoResults: 'Żadne zdjęcie nie pasuje do tego wyszukiwania.',
    searchClear: 'Wyczyść wyszukiwanie',
    analyzeAction: 'Analizuj',
    analyzeProgress: (current, total) => `Analizowanie ${current} z ${total}…`,
    cancelAnalysisAction: 'Anuluj analizę',
    analysisCancelled: 'Analiza anulowana przez użytkownika',
    analysisNone: 'Jeszcze nie przeanalizowano.',
    analyzeUnavailable: 'Wybierz zdjęcie, którego folder został już zeskanowany, aby rozpocząć analizę.',
    detailDescription: 'Opis',
    detailScene: 'Scena',
    detailQuality: 'Jakość',
    detailTags: 'Tagi',
    detailVariant: 'Analiza',
    detailVariantCount: (count) => `${count} ${plPlural(count, 'wariant', 'warianty', 'wariantów')}`,
    variantPickerLabel: 'Wariant analizy',
    variantAutomatic: 'Automatycznie',
    scenePeople: 'Ludzie',
    sceneLandscape: 'Krajobraz',
    sceneUrban: 'Miasto',
    sceneIndoor: 'Wnętrze',
    sceneFood: 'Jedzenie',
    sceneDocument: 'Dokument',
    sceneScreenshot: 'Zrzut ekranu',
    sceneAnimal: 'Zwierzę',
    sceneVehicle: 'Pojazd',
    sceneEvent: 'Wydarzenie',
    sceneObject: 'Przedmiot',
    sceneOther: 'Inne',
    qualityGood: 'Dobra',
    qualityBlurry: 'Rozmazana',
    qualityDark: 'Ciemna',
    qualityOverexposed: 'Prześwietlona',
    qualityOther: 'Inna',
    openInAnalysis: 'Otwórz w Analizie',
  },
  photosSidebar: {
    noFolderTitle: 'Brak otwartego folderu',
    noFolderBody: 'Otwórz folder, aby zobaczyć jego zdjęcia.',
    autoScanningBody: 'Indeksowanie zdjęć w tym folderze…',
    scopeThisFolder: 'Ten folder',
    scopeAllFolders: 'Wszystkie',
    badgeProxyFailed: 'Podgląd nieudany',
    badgeExifMissing: 'Brak EXIF',
    badgeMissing: 'Brak pliku',
    badgeAnalyzing: 'Analizowanie…',
    loadMore: 'Wczytaj więcej',
    analyzeFolderAction: 'Przetwórz',
  },
  photosWorkspace: {
    emptyTitle: 'Wybierz zdjęcie z listy po lewej',
  },
  library: {
    title: 'Biblioteka',
    subtitle: 'Przeglądaj wszystko, co kiedykolwiek przetworzono, ze wszystkich skatalogowanych folderów.',
    countHeader: (shown, total) => shown === total
      ? `${total} ${plPlural(total, 'plik', 'pliki', 'plików')}`
      : `${shown} z ${total} ${plPlural(total, 'pliku', 'plików', 'plików')}`,
    searchPlaceholder: 'Szukaj w bibliotece…',
    recentSearches: 'Ostatnie wyszukiwania',
    topTags: 'Najczęstsze tagi',
    removeRecentSearch: (label: string) => `Usuń ${label}`,
    loadingLibrary: 'Ładowanie biblioteki…',
    loadMore: 'Wczytaj więcej',
    unknownDate: 'Brak daty',
    emptyCatalogTitle: 'Jeszcze nic nie przetworzono',
    emptyCatalogBody: 'Przetwórz folder w zakładce Filmy, aby zacząć budować bibliotekę.',
    emptyCatalogAction: 'Przejdź do Filmów',
    noMatchTitle: (query) => query.length === 0 ? 'Brak wyników' : `Brak wyników dla „${query}”`,
    noMatchBody: 'Spróbuj innego wyszukiwania lub wyczyść filtry.',
    noMatchNamed: (parts) => `Żaden plik nie pasuje do ${parts}`,
    noMatchClearAction: 'Wyczyść wyszukiwanie',
    offlineFolderBadge: 'Dysk niepodłączony',
    missingBadge: 'Brak pliku',
    openInAnalysis: 'Otwórz w Analizie',
    copyPath: 'Kopiuj ścieżkę',
    groupByDate: 'Data',
    groupByFolder: 'Folder',
    filterTags: 'Tagi',
    filterPeople: 'Osoby',
    filterPlace: 'Miejsce',
    filterFolder: 'Folder',
    filterFrom: 'Od',
    filterTo: 'Do',
    filterHasGps: 'GPS',
    filterHasGpsAny: 'Dowolne',
    filterHasGpsWith: 'Z GPS',
    filterHasGpsWithout: 'Bez GPS',
    filterClearAll: 'Wyczyść filtry',
    filterDatePreset: 'Szybki zakres',
    filterDatePresetAny: 'Dowolny',
    filterDatePresetThisYear: 'Ten rok',
    filterDatePresetLastYear: 'Poprzedni rok',
    chipHasGps: 'Z GPS',
    chipNoGps: 'Bez GPS',
    chipFolder: (displayName) => `Folder: ${displayName}`,
    chipDateRange: (from, to) => `${from} – ${to}`,
    chipDateFrom: (from) => `Od ${from}`,
    chipDateTo: (to) => `Do ${to}`,
    sortLabel: 'Sortuj',
    sortCapturedDesc: 'Od najnowszych',
    sortCapturedAsc: 'Od najstarszych',
    sortNameAsc: 'Nazwa',
    sortRelevance: 'Trafność',
  },
  preview: {
    offline: 'Ten plik znajduje się na dysku, który nie jest podłączony.',
    missing: 'Tego pliku nie ma już w skatalogowanej lokalizacji.',
    openInAnalysis: 'Otwórz w Analizie',
  },
};

export const getDict = (locale: Locale): Dictionary => (locale === 'pl' ? pl : en);
