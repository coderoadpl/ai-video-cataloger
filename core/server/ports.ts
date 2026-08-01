import type {
  AppConfig,
  AppError,
  AnalyzerProviderConfig,
  CliPathEntry,
  CatalogAnalysis,
  CatalogFile,
  CatalogFolder,
  CatalogPlace,
  CatalogVariant,
  ConfigKey,
  CredentialDeletion,
  CredentialsBackendStatus,
  CapturedAtSource,
  DriveRunBatchState,
  ExifSummary,
  FaceBox,
  FaceLandmarks,
  FaceObservation,
  FileArtifact,
  FileArtifactId,
  GeminiUsageAccounting,
  GpsSource,
  PhotoExtension,
  SpendLedgerEntry,
  MachineProfile,
  Person,
  Result,
  TimelineIntervalKind,
  Video,
  WhisperEngine,
  WhisperModelName,
} from '@core/domain/index.js';

export type CatalogVideo = Video;

export interface CatalogResetSingleResult {
  before: CatalogVideo;
  after: CatalogVideo;
}

export interface CatalogRepository {
  databasePath(): string | null;
  writable(): boolean;
  listVideos(): Promise<Result<CatalogVideo[], AppError>>;
  findVideoByPath(path: string): Promise<Result<CatalogVideo | null, AppError>>;
  findVideoByHash(fileHash: string): Promise<Result<CatalogVideo | null, AppError>>;
  createVideo(input: Omit<CatalogVideo, 'id'>): Promise<Result<CatalogVideo, AppError>>;
  updateVideoStatus(
    id: number,
    status: CatalogVideo['status'],
    errorMessage: string | null,
  ): Promise<Result<CatalogVideo, AppError>>;
  updateVideoPath(id: number, path: string): Promise<Result<CatalogVideo, AppError>>;
  updateVideoNewName(id: number, newName: string): Promise<Result<CatalogVideo, AppError>>;
  clearVideos(): Promise<Result<{ cleared: number }, AppError>>;
  resetVideoByOriginalName(filename: string): Promise<Result<CatalogResetSingleResult | null, AppError>>;
}

export interface CatalogRepositoryFactory {
  open(folder: string): Promise<Result<CatalogRepository, AppError>>;
}

export interface CatalogFileRecord {
  file: CatalogFile;
  analysis: CatalogAnalysis | null;
}

export interface AnalyzedFileLocation {
  fingerprint: string;
  folderId: string;
  fileName: string;
  finalName: string | null;
  folderPath: string | null;
}

export interface CatalogTagSummary {
  name: string;
  count: number;
}

export interface CatalogTagAliasResult {
  alias: string;
  canonical: string;
  remappedFiles: number;
}

export interface CatalogSearchFilters {
  tagTermSets: string[][];
  personIds: string[];
  place: string | null;
  capturedFrom: string | null;
  capturedTo: string | null;
  hasGps: boolean | null;
  folderId: string | null;
}

export type CatalogSearchSort = 'relevance' | 'captured_desc' | 'captured_asc' | 'name_asc';

export interface CatalogSearchInput {
  match: string | null;
  rankingTerms: string[];
  filters: CatalogSearchFilters;
  sort: CatalogSearchSort;
  limit: number;
  offset: number;
}

export interface CatalogTagAlias {
  alias: string;
  canonical: string;
}

export interface TagTermExpansion {
  term: string;
  equivalents: string[];
}

export interface CatalogSearchRow {
  fingerprint: string;
  variantCount: number;
  fileName: string;
  finalName: string | null;
  description: string | null;
  snippet: string;
  tags: string[];
  folder: CatalogFolder;
  gps: { lat: number; lon: number } | null;
  missing: boolean;
  score: number;
  capturedAt: string | null;
  place: CatalogPlace | null;
}

export interface CatalogSearchResults {
  total: number;
  rows: CatalogSearchRow[];
}

export interface CatalogLocationRow {
  fingerprint: string;
  fileName: string;
  finalName: string | null;
  lat: number;
  lon: number;
  missing: boolean;
  folder: CatalogFolder;
  source: GpsSource | null;
  accuracyM: number | null;
  intervalKind: TimelineIntervalKind | null;
  place: CatalogPlace | null;
}

export interface GeoBackfillCandidate {
  fingerprint: string;
  folderId: string;
  folderPath: string;
  fileName: string;
  capturedAt: string | null;
  gpsLat: number | null;
  gpsLon: number | null;
  gpsSource: GpsSource | null;
  placeName: string | null;
}

export interface GeoBackfillLocation {
  lat: number;
  lon: number;
  source: GpsSource;
  accuracyM: number;
  intervalKind: TimelineIntervalKind;
  resolvedAt: string;
}

export interface ApplyGeoBackfillInput {
  fingerprint: string;
  capturedAt?: { at: string; source: 'container' } | undefined;
  location?: GeoBackfillLocation | undefined;
  place?: CatalogPlace | null | undefined;
}

export type ApplyGeoBackfillResult = 'written' | 'unchanged' | 'skipped_precedence';

export interface PlaceMatch {
  name: string;
  region: string | null;
  country: string | null;
  countryCode: string | null;
  distanceM: number;
  dataset: string;
}

export interface PlacesPort {
  dependency(): Promise<Result<DependencyStatus, AppError>>;
  isReady(): Promise<Result<boolean, AppError>>;
  resolve(input: { lat: number; lon: number }): Promise<Result<PlaceMatch | null, AppError>>;
}

export interface CatalogLocationsSnapshot {
  totalFiles: number;
  rows: CatalogLocationRow[];
}

export interface LibraryFacetTag {
  name: string;
  count: number;
}

export interface LibraryFacetPerson {
  personId: string;
  displayName: string | null;
  count: number;
}

export interface LibraryFacetPlace {
  name: string;
  country: string | null;
  countryCode: string | null;
  count: number;
}

export interface LibraryFacetYear {
  year: string;
  count: number;
}

export interface LibraryFacetFolder {
  folderId: string;
  displayName: string;
  currentPath: string;
  count: number;
}

export interface LibraryFacetCounts {
  total: number;
  withGps: number;
  withoutCaptureDate: number;
  missing: number;
}

export interface LibraryFacets {
  tags: LibraryFacetTag[];
  people: LibraryFacetPerson[];
  places: LibraryFacetPlace[];
  years: LibraryFacetYear[];
  folders: LibraryFacetFolder[];
  counts: LibraryFacetCounts;
}

export interface ReconcileFolderInput {
  folderId: string;
  presentFingerprints: readonly string[];
  fingerprintsPresentElsewhere?: readonly string[];
  markMissing?: boolean;
  now: number;
}

export interface ReconcileFolderResult {
  marked: number;
  cleared: number;
}

export interface ForgetEntryResult {
  fingerprint: string;
  deleted: boolean;
  folderId: string | null;
  cropPaths: string[];
}

export interface GlobalCatalogCounts {
  folders: number;
  files: number;
  analyses: number;
}

export type CatalogLockProcessName = 'gui' | 'cli';

export interface CatalogLockInfo {
  pid: number;
  processName: CatalogLockProcessName;
  startedAt: string;
  hostname: string;
}

export interface CatalogLockSnapshot {
  writable: boolean;
  owner: CatalogLockInfo | null;
  blockedBy: CatalogLockInfo | null;
  warnings: string[];
}

export interface FaceIndexCandidate {
  file: CatalogFile;
  analysis: CatalogAnalysis;
  folder: CatalogFolder;
  previousEngineVersion: number | null;
}

export interface FaceIndexScope {
  foldersMatched: number;
  filesInScope: number;
  candidates: FaceIndexCandidate[];
}

export interface FaceStatusCounts {
  people: number;
  observations: number;
  assignedObservations: number;
  unassignedObservations: number;
  filesIndexed: number;
  staleVersionFiles: number;
}

export interface ExifPort {
  read(path: string): Promise<Result<ExifSummary | null, AppError>>;
}

export interface PhotoFolderRecord {
  folderId: string;
  currentPath: string;
  displayName: string;
  firstSeenAt: string;
  lastSeenAt: string;
  defaultConfigId: string | null;
}

export interface PhotoRecord {
  fingerprint: string;
  folderId: string;
  fileName: string;
  currentPath: string;
  ext: PhotoExtension;
  size: number;
  width: number | null;
  height: number | null;
  orientation: number | null;
  cameraMake: string | null;
  cameraModel: string | null;
  lens: string | null;
  iso: number | null;
  fNumber: number | null;
  exposureTime: number | null;
  exifRating: number | null;
  capturedAt: string | null;
  capturedAtSource: CapturedAtSource | null;
  gpsLat: number | null;
  gpsLon: number | null;
  gpsSource: string | null;
  gpsAccuracyM: number | null;
  gpsIntervalKind: string | null;
  gpsResolvedAt: string | null;
  placeName: string | null;
  placeRegion: string | null;
  placeCountry: string | null;
  placeCountryCode: string | null;
  placeDistanceM: number | null;
  placeDataset: string | null;
  discoveredAt: string;
  exifReadAt: string | null;
  proxyState: 'pending' | 'done' | 'failed' | 'not_needed';
  proxyWidth: number | null;
  proxyHeight: number | null;
  thumbState: 'pending' | 'done' | 'failed';
  missingAt: number | null;
  selectedConfigId: string | null;
}

export interface PhotoSightingRecord {
  fingerprint: string;
  currentPath: string;
  folderId: string;
  size: number;
  mtimeMs: number;
  lastSeenAt: string;
}

export interface PhotoRunRecord {
  runId: string;
  root: string;
  stage: 'scan' | 'process';
  startedAt: string;
  finishedAt: string | null;
  filesTotal: number;
  filesDone: number;
  filesSkipped: number;
  filesFailed: number;
  lastActivityAt: string;
  batchJson: string | null;
}

export interface PhotosCounts {
  photos: number;
  paths: number;
  exifRead: number;
  exifFailed: number;
  missing: number;
  duplicates: number;
  proxied: number;
  proxyFailed: number;
  analysed: number;
  facesIndexed: number;
}

export interface PhotoFaceIndexCandidate {
  fingerprint: string;
  currentPath: string;
  previousEngineVersion: number | null;
}

export interface PhotoGeoBackfillCandidate {
  fingerprint: string;
  fileName: string;
  currentPath: string;
  capturedAt: string | null;
  capturedAtSource: CapturedAtSource | null;
  gpsLat: number | null;
  gpsLon: number | null;
  gpsSource: GpsSource | null;
  placeName: string | null;
}

export interface ApplyPhotoGeoBackfillInput {
  fingerprint: string;
  location?: GeoBackfillLocation | undefined;
  place?: CatalogPlace | null | undefined;
}

export interface PhotoLocationRow {
  fingerprint: string;
  fileName: string;
  lat: number;
  lon: number;
  missing: boolean;
  capturedAt: string | null;
  thumbState: 'pending' | 'done' | 'failed';
  folder: {
    folderId: string;
    currentPath: string;
    displayName: string;
  };
  source: GpsSource | null;
  accuracyM: number | null;
  intervalKind: TimelineIntervalKind | null;
  place: CatalogPlace | null;
}

export interface PhotoAnalysisCandidate {
  fingerprint: string;
  fileName: string;
  currentPath: string;
}

export interface PhotoSearchRow {
  fingerprint: string;
  fileName: string;
  currentPath: string;
  ext: PhotoExtension;
  capturedAt: string | null;
  description: string | null;
  snippet: string;
  tags: string[];
  variantCount: number;
  thumbState: 'pending' | 'done' | 'failed';
  proxyState: 'pending' | 'done' | 'failed' | 'not_needed';
  missingAt: number | null;
}

export interface PhotoVariantRecord {
  configId: string;
  label: string;
  description: string;
  scene: string;
  quality: string;
  language: string | null;
  analyzer: string | null;
  model: string | null;
  batchSize: number | null;
  createdAt: string;
  tags: string[];
  selected: boolean;
  explicit: boolean;
}

export interface PhotoAnalysisCandidates {
  candidates: PhotoAnalysisCandidate[];
  alreadyAnalysed: number;
}

export interface RecordPhotoAnalysisInput {
  fingerprint: string;
  configId: string;
  description: string;
  scene: string;
  quality: string;
  language: string;
  analyzer: string;
  model: string | null;
  batchSize: number;
  usageJson: string | null;
  tags: readonly string[];
  createdAt: string;
}

export interface PhotoProxyCandidate {
  fingerprint: string;
  sourcePath: string;
  ext: PhotoExtension;
  proxyState: 'pending' | 'done' | 'failed' | 'not_needed';
  thumbState: 'pending' | 'done' | 'failed';
}

export interface PhotoRootSummary {
  root: string;
  photos: number;
  missing: number;
  lastScanAt: string;
}

export interface PhotoListItem {
  fingerprint: string;
  fileName: string;
  currentPath: string;
  ext: PhotoExtension;
  capturedAt: string | null;
  capturedAtSource: CapturedAtSource | null;
  width: number | null;
  height: number | null;
  proxyState: 'pending' | 'done' | 'failed' | 'not_needed';
  thumbState: 'pending' | 'done' | 'failed';
  missingAt: number | null;
  sightings: number;
  analysed: boolean;
  exifReadAt: string | null;
}

export interface PhotoDetail {
  photo: PhotoRecord;
  sightings: PhotoSightingRecord[];
}

export interface PhotoProxyOutcome {
  proxyWidth: number;
  proxyHeight: number;
  thumbWidth: number | null;
  thumbHeight: number | null;
  source: 'embedded_preview' | 'full_decode' | 'downscale';
}

export interface PhotoMediaPort {
  createProxy(input: {
    sourcePath: string;
    ext: PhotoExtension;
    proxyPath: string;
    thumbPath: string;
  }): Promise<Result<PhotoProxyOutcome, AppError>>;
}

export interface PhotosStore {
  databasePath(): string;
  flush(): Promise<Result<void, AppError>>;
  checkpoint(): Promise<Result<void, AppError>>;
  dispose(): Promise<Result<void, AppError>>;
  withBatch<T>(operation: () => Promise<Result<T, AppError>>): Promise<Result<T, AppError>>;
  upsertFolder(folder: PhotoFolderRecord): Promise<Result<void, AppError>>;
  getFolder(folderId: string): Promise<Result<PhotoFolderRecord | null, AppError>>;
  getPhoto(fingerprint: string): Promise<Result<PhotoRecord | null, AppError>>;
  upsertPhoto(photo: PhotoRecord): Promise<Result<void, AppError>>;
  getSightingByPath(path: string): Promise<Result<PhotoSightingRecord | null, AppError>>;
  upsertSighting(sighting: PhotoSightingRecord): Promise<Result<void, AppError>>;
  listSightings(fingerprint: string): Promise<Result<PhotoSightingRecord[], AppError>>;
  listSightingsUnderRoot(root: string): Promise<Result<PhotoSightingRecord[], AppError>>;
  deleteSighting(fingerprint: string, path: string): Promise<Result<void, AppError>>;
  deletePhoto(fingerprint: string): Promise<Result<void, AppError>>;
  counts(root: string | null): Promise<Result<PhotosCounts, AppError>>;
  startPhotoRun(run: PhotoRunRecord): Promise<Result<void, AppError>>;
  updatePhotoRun(run: PhotoRunRecord): Promise<Result<void, AppError>>;
  listProxyCandidates(root: string): Promise<Result<PhotoProxyCandidate[], AppError>>;
  setProxyOutcome(input: {
    fingerprint: string;
    proxyState: 'done' | 'failed';
    proxyWidth: number | null;
    proxyHeight: number | null;
    thumbState: 'done' | 'failed';
  }): Promise<Result<void, AppError>>;
  listRoots(): Promise<Result<PhotoRootSummary[], AppError>>;
  listPhotosPage(input: { root: string | null; offset: number; limit: number }):
    Promise<Result<{ total: number; items: PhotoListItem[] }, AppError>>;
  getPhotoDetail(fingerprint: string): Promise<Result<PhotoDetail | null, AppError>>;
  listAnalysisCandidates(root: string, configId: string, force: boolean): Promise<Result<PhotoAnalysisCandidates, AppError>>;
  upsertAnalysisConfig(input: { configId: string; descriptorJson: string; label: string; now: string }): Promise<Result<void, AppError>>;
  recordPhotoAnalysis(input: RecordPhotoAnalysisInput): Promise<Result<void, AppError>>;
  searchPhotos(input: { match: string; rankingTerms: readonly string[]; limit: number; offset: number }):
    Promise<Result<PhotoSearchRow[], AppError>>;
  collectionPage(input: {
    match: string | null;
    rankingTerms: readonly string[];
    from: string | null;
    to: string | null;
    tagTermSets: readonly (readonly string[])[];
    sort: 'relevance' | 'captured_desc' | 'captured_asc' | 'name_asc';
    limit: number;
    offset: number;
  }): Promise<Result<{ total: number; rows: PhotoSearchRow[] }, AppError>>;
  expandPhotoTagTerms(terms: readonly string[]): Promise<Result<TagTermExpansion[], AppError>>;
  listPhotoVariants(fingerprint: string): Promise<Result<PhotoVariantRecord[], AppError>>;
  resolveSelectedConfigId(fingerprint: string): Promise<Result<string | null, AppError>>;
  setSelectedPhotoVariant(fingerprint: string, configId: string | null): Promise<Result<void, AppError>>;
  deletePhotoVariant(fingerprint: string, configId: string): Promise<Result<void, AppError>>;
  setPhotoFolderDefaultVariant(folderId: string, configId: string | null): Promise<Result<void, AppError>>;
  listPhotoFaceIndexCandidates(root: string):
    Promise<Result<{ inScope: number; candidates: PhotoFaceIndexCandidate[] }, AppError>>;
  completePhotoFaceIndex(fingerprint: string, engineVersion: number): Promise<Result<void, AppError>>;
  listPhotoGeoBackfillCandidates(input: { root: string | null }): Promise<Result<PhotoGeoBackfillCandidate[], AppError>>;
  applyPhotoGeoBackfill(input: ApplyPhotoGeoBackfillInput): Promise<Result<ApplyGeoBackfillResult, AppError>>;
  listPhotoLocations(): Promise<Result<{ totalPhotos: number; rows: PhotoLocationRow[] }, AppError>>;
}

export interface DriveRunRecord {
  runId: string;
  root: string;
  startedAt: string;
  finishedAt: string | null;
  foldersTotal: number;
  foldersDone: number;
  filesDone: number;
  filesSkipped: number;
  filesFailed: number;
  lastActivityAt: string;
  batch: DriveRunBatchState | null;
}

export interface GlobalCatalogStore {
  databasePath(): string;
  flush(): Promise<Result<void, AppError>>;
  dispose(): Promise<Result<void, AppError>>;
  lockStatus(): Promise<Result<CatalogLockSnapshot, AppError>>;
  acquireWriteLock(): Promise<Result<CatalogLockSnapshot, AppError>>;
  acquireLease(): Promise<Result<void, AppError>>;
  releaseLease(): Promise<Result<void, AppError>>;
  listFolders(): Promise<Result<CatalogFolder[], AppError>>;
  getFolder(folderId: string): Promise<Result<CatalogFolder | null, AppError>>;
  upsertFolder(folder: CatalogFolder): Promise<Result<void, AppError>>;
  getFile(fingerprint: string): Promise<Result<CatalogFile | null, AppError>>;
  upsertFile(file: CatalogFile): Promise<Result<void, AppError>>;
  getAnalysis(fingerprint: string): Promise<Result<CatalogAnalysis | null, AppError>>;
  upsertAnalysis(analysis: CatalogAnalysis): Promise<Result<void, AppError>>;
  listVariants(fingerprint: string): Promise<Result<CatalogVariant[], AppError>>;
  getVariant(fingerprint: string, configId: string): Promise<Result<CatalogVariant | null, AppError>>;
  upsertVariant(variant: CatalogVariant): Promise<Result<void, AppError>>;
  clearAnalysisVariants(fingerprint: string): Promise<Result<void, AppError>>;
  deleteVariant(fingerprint: string, configId: string): Promise<Result<void, AppError>>;
  setSelectedVariant(fingerprint: string, configId: string | null): Promise<Result<void, AppError>>;
  getExplicitSelectedConfigId(fingerprint: string): Promise<Result<string | null, AppError>>;
  getSelectedConfigId(fingerprint: string): Promise<Result<string | null, AppError>>;
  getFolderDefaultConfigId(folderId: string): Promise<Result<string | null, AppError>>;
  setFolderDefaultVariant(folderId: string, configId: string | null): Promise<Result<void, AppError>>;
  listAnalyzedFileLocations(fingerprints: readonly string[]): Promise<Result<AnalyzedFileLocation[], AppError>>;
  listFolderRecords(folderId: string): Promise<Result<CatalogFileRecord[], AppError>>;
  listTags(): Promise<Result<CatalogTagSummary[], AppError>>;
  aliasTag(input: { from: string; to: string }): Promise<Result<CatalogTagAliasResult, AppError>>;
  listTagAliases(): Promise<Result<CatalogTagAlias[], AppError>>;
  expandTagTerms(terms: readonly string[]): Promise<Result<TagTermExpansion[], AppError>>;
  search(input: CatalogSearchInput): Promise<Result<CatalogSearchResults, AppError>>;
  listLocations(): Promise<Result<CatalogLocationsSnapshot, AppError>>;
  listLibraryFacets(): Promise<Result<LibraryFacets, AppError>>;
  listGeoBackfillCandidates(input: { root: string | null }): Promise<Result<GeoBackfillCandidate[], AppError>>;
  applyGeoBackfill(input: ApplyGeoBackfillInput): Promise<Result<ApplyGeoBackfillResult, AppError>>;
  rebuildSearchIndex(): Promise<Result<{ indexed: number }, AppError>>;
  counts(): Promise<Result<GlobalCatalogCounts, AppError>>;
  reconcileFolder(input: ReconcileFolderInput): Promise<Result<ReconcileFolderResult, AppError>>;
  relocateFile(fingerprint: string, folderId: string, fileName: string): Promise<Result<void, AppError>>;
  forgetEntry(fingerprint: string): Promise<Result<ForgetEntryResult, AppError>>;
  startDriveRun(run: DriveRunRecord): Promise<Result<void, AppError>>;
  updateDriveRun(run: DriveRunRecord): Promise<Result<void, AppError>>;
  latestDriveRun(): Promise<Result<DriveRunRecord | null, AppError>>;
  unfinishedDriveRuns(root: string): Promise<Result<DriveRunRecord[], AppError>>;
  listFaceIndexCandidates(rootPath: string): Promise<Result<FaceIndexScope, AppError>>;
  completeFaceIndex(fingerprint: string, engineVersion: number): Promise<Result<void, AppError>>;
  deleteFaceObservationsForFile(fingerprint: string): Promise<Result<{ cropPaths: string[] }, AppError>>;
  listUnassignedFaceObservations(): Promise<Result<FaceObservation[], AppError>>;
  listPeople(): Promise<Result<Person[], AppError>>;
  getPerson(personId: string): Promise<Result<Person | null, AppError>>;
  upsertPerson(person: Person): Promise<Result<void, AppError>>;
  setPersonName(personId: string, displayName: string): Promise<Result<{ personId: string; displayName: string; affectedFingerprints: string[] }, AppError>>;
  listFaceObservations(input?: {
    fingerprint?: string | undefined;
    personId?: string | undefined;
  }): Promise<Result<FaceObservation[], AppError>>;
  upsertFaceObservation(observation: FaceObservation): Promise<Result<void, AppError>>;
  assignFaceObservation(obsId: string, personId: string | null): Promise<Result<void, AppError>>;
  mergePeople(input: { fromPersonId: string; toPersonId: string }): Promise<Result<{ fromPersonId: string; toPersonId: string; movedObservations: number; affectedFingerprints: string[] }, AppError>>;
  forgetPerson(personId: string): Promise<Result<{ personId: string; deleted: boolean; cropPaths: string[]; affectedFingerprints: string[] }, AppError>>;
  purgeFaces(): Promise<Result<{ peopleDeleted: number; observationsDeleted: number; cropPaths: string[] }, AppError>>;
  faceStatus(): Promise<Result<FaceStatusCounts, AppError>>;
  replaceFaceClustering(input: {
    people: readonly Person[];
    assignments: readonly { obsId: string; personId: string | null }[];
  }): Promise<Result<{
    personsDeleted: number;
    personsCreated: number;
    observationsReassigned: number;
    affectedFingerprints: string[];
  }, AppError>>;
}

export type ConfigScope = { kind: 'folder'; folder: string } | { kind: 'home' };

export interface ConfigStore {
  get(scope: ConfigScope, key: ConfigKey): Promise<Result<string | null, AppError>>;
  getAll(scope: ConfigScope): Promise<Result<Partial<Record<ConfigKey, string>>, AppError>>;
  set(scope: ConfigScope, key: ConfigKey, value: string): Promise<Result<{ previousValue: string | null }, AppError>>;
}

export interface SpendLedgerTotal {
  entries: number;
  estimatedCostUsd: number;
}

export interface SpendLedgerPort {
  append(entry: SpendLedgerEntry): Promise<Result<void, AppError>>;
  total(input: {
    provider: 'gemini';
    month?: string | undefined;
    runId?: string | undefined;
  }): Promise<Result<SpendLedgerTotal, AppError>>;
}

export interface CredentialValueConflict {
  providerId: string;
  archivePath: string;
}

export interface CredentialsStore {
  get(providerId: string): Promise<Result<string | null, AppError>>;
  set(providerId: string, credential: string): Promise<Result<void, AppError>>;
  delete?(providerId: string): Promise<Result<CredentialDeletion, AppError>>;
  legacyPlaintextProviders?(): Promise<Result<string[], AppError>>;
  credentialValueConflicts?(): Promise<Result<CredentialValueConflict[], AppError>>;
  unreadableCredentialEntries?(): Promise<Result<string[], AppError>>;
  backend?(): Promise<CredentialsBackendStatus>;
}

export type SecretsAvailability = 'available' | 'disabled' | 'unsupported' | 'unavailable';

export interface SecretsStore {
  availability(): Promise<SecretsAvailability>;
  get(account: string): Promise<Result<string | null, AppError>>;
  set(account: string, secret: string): Promise<Result<void, AppError>>;
  delete(account: string): Promise<Result<{ existed: boolean }, AppError>>;
}

export type CredentialMigrationOutcome = 'migrated' | 'value_conflict' | 'superseded';

export interface CredentialMigrationLog {
  record(providerId: string, outcome: CredentialMigrationOutcome): Promise<void>;
}

export interface DirectoryEntry {
  name: string;
  path: string;
  kind: 'file' | 'directory' | 'symlink';
}

export interface FileStat {
  size: number;
  mtimeMs: number;
}

export interface FileSystemPort {
  cwd(): string;
  resolve(path: string): string;
  dirname(path: string): string;
  basename(path: string): string;
  basenameWithoutExtension(path: string): string;
  extname(path: string): string;
  join(...segments: string[]): string;
  isDirectory(path: string): Promise<Result<boolean, AppError>>;
  isFile(path: string): Promise<Result<boolean, AppError>>;
  exists(path: string): Promise<Result<boolean, AppError>>;
  listDirectory(path: string): Promise<Result<DirectoryEntry[], AppError>>;
  stat(path: string): Promise<Result<FileStat, AppError>>;
  readTextFile(path: string): Promise<Result<string | null, AppError>>;
  writeTextFile(path: string, content: string): Promise<Result<void, AppError>>;
  ensureDirectory(path: string): Promise<Result<void, AppError>>;
  linkFile(from: string, to: string): Promise<Result<void, AppError>>;
  copyFile(from: string, to: string): Promise<Result<void, AppError>>;
  renamePath(from: string, to: string): Promise<Result<void, AppError>>;
  deleteFile(path: string): Promise<Result<void, AppError>>;
  deletePath(path: string): Promise<Result<void, AppError>>;
  partialContentHash(path: string): Promise<Result<string | null, AppError>>;
  fullContentHash(path: string): Promise<Result<string | null, AppError>>;
  isWritable(path: string): Promise<Result<boolean, AppError>>;
  tempDirectory(): string;
  homeDirectory(): string;
}

export interface FolderWatchHandle {
  close(): void;
}

export interface FolderWatcherPort {
  watch(
    root: string,
    onChange: () => void,
    onFailure?: (error: AppError) => void,
  ): Promise<Result<FolderWatchHandle, AppError>>;
}

export interface DependencyStatus {
  name: string;
  available: boolean;
  version: string | null;
  source: 'bundled' | 'configured' | 'managed' | 'system' | null;
  path: string | null;
  installHint: string;
  warning?: string | undefined;
  engine?: WhisperEngine | undefined;
}

export interface MediaProbe {
  duration: number | null;
  width: number | null;
  height: number | null;
  rotation: number | null;
  gpsLat: number | null;
  gpsLon: number | null;
  createdAtUtc: string | null;
}

export interface ExtractFramesInput {
  videoPath: string;
  outputDirectory: string;
  frameCount: number;
  signal?: AbortSignal | undefined;
}

export interface ExtractAudioInput {
  videoPath: string;
  outputPath: string;
  signal?: AbortSignal | undefined;
}

export interface AudioExtraction {
  hasAudio: boolean;
  audioPath: string | null;
}

export interface ThumbnailInput {
  videoPath: string;
  thumbnailPath: string;
  seekPercent: number;
  width: number;
  height: number;
  force: boolean;
  priority?: 'foreground' | 'background' | undefined;
}

export interface ThumbnailGeneration {
  path: string;
  generated: boolean;
  skipped: boolean;
}

export interface ThumbnailFromFrameInput {
  framePath: string;
  thumbnailPath: string;
  width: number;
  height: number;
  force: boolean;
  fit?: 'inside' | 'cover' | undefined;
  priority?: 'foreground' | 'background' | undefined;
}

export interface FaceDetection {
  bbox: FaceBox;
  landmarks: FaceLandmarks;
  score: number;
}

export type FaceFrameInput =
  | { kind: 'image-path'; frameJpegPath: string }
  | { kind: 'video-timestamp'; videoPath: string; timestampS: number; fallbackFrameJpegPath?: string | undefined };

export interface AlignedFaceCrop {
  frame: FaceFrameInput;
  detection: FaceDetection;
  width: number;
  height: number;
  data?: Uint8Array | undefined;
}

export interface FaceEnginePort {
  load(): Promise<Result<void, AppError>>;
  detect(frame: FaceFrameInput | string): Promise<Result<FaceDetection[], AppError>>;
  align(frame: FaceFrameInput | string, detection: FaceDetection): Promise<Result<AlignedFaceCrop, AppError>>;
  embed(alignedCrop: AlignedFaceCrop): Promise<Result<Float32Array, AppError>>;
  writeCrop(alignedCrop: AlignedFaceCrop, outputPath: string): Promise<Result<void, AppError>>;
  dispose(): Promise<Result<void, AppError>>;
  dependency(): Promise<Result<DependencyStatus, AppError>>;
}

export interface CliPathPort {
  commandName: string;
  ownedInstallPaths: readonly string[];
  resolveOnPath(): Promise<Result<CliPathEntry[], AppError>>;
}

export interface MediaPort {
  probe(input: { videoPath: string }): Promise<Result<MediaProbe, AppError>>;
  extractFrames(input: ExtractFramesInput): Promise<Result<{ framePaths: string[] }, AppError>>;
  extractAudio(input: ExtractAudioInput): Promise<Result<AudioExtraction, AppError>>;
  thumbnail(input: ThumbnailInput): Promise<Result<ThumbnailGeneration, AppError>>;
  thumbnailFromFrame(input: ThumbnailFromFrameInput): Promise<Result<ThumbnailGeneration, AppError>>;
  dependencies(): Promise<Result<DependencyStatus[], AppError>>;
}

export interface TranscribeInput {
  audioPath: string;
  transcriptPath: string;
  transcriptJsonPath?: string | undefined;
  mode: AppConfig['whisper_mode'];
  model: WhisperModelName;
  language: AppConfig['whisper_language'];
  apiBaseUrl?: string | undefined;
  apiModel?: string | undefined;
  binaryPath?: string | undefined;
  signal?: AbortSignal | undefined;
}

export interface TranscriptionOutput {
  transcriptPath: string;
  content: string;
  filteredSegments: number;
}

export interface TranscriberPort {
  transcribe(input: TranscribeInput): Promise<Result<TranscriptionOutput, AppError>>;
  dependency(input?: {
    mode: AppConfig['whisper_mode'];
    model: WhisperModelName;
    apiBaseUrl?: string | undefined;
    apiModel?: string | undefined;
    binaryPath?: string | undefined;
  }): Promise<Result<DependencyStatus, AppError>>;
}

export type WhisperRuntimeSource = 'configured' | 'managed' | 'system';

export interface WhisperRuntimeStatus {
  available: boolean;
  path: string | null;
  source: WhisperRuntimeSource | null;
  version: string | null;
  managedInstalled: boolean;
  buildToolsAvailable: boolean;
  missingBuildTools: string[];
  message?: string | undefined;
  engine?: WhisperEngine | undefined;
  warning?: string | undefined;
}

export interface WhisperRuntimeInstallProgress {
  phase: 'authenticating' | 'downloading' | 'patching' | 'source_fallback';
  percentage: number;
  artifact?: string | undefined;
}

export interface WhisperRuntimePort {
  status(input?: { configuredPath?: string | undefined }): Promise<Result<WhisperRuntimeStatus, AppError>>;
  install(options?: {
    signal?: AbortSignal | undefined;
    onProgress?: ((progress: WhisperRuntimeInstallProgress) => Promise<Result<void, AppError>>) | undefined;
  }): Promise<Result<{
    path: string;
    version: string;
    installed: boolean;
  }, AppError>>;
}

export interface AnalyzeInput {
  videoPath: string;
  framePaths: string[];
  transcript: string | null;
  backend: AppConfig['analyzer_backend'];
  localModel: string;
  provider?: AnalyzerProviderConfig | undefined;
  timeoutSeconds: number;
  outputLanguage: AppConfig['output_language'];
  tagLanguage: AppConfig['tag_language'];
  verbose: boolean;
  signal?: AbortSignal | undefined;
  onWarning?: ((warning: string) => void) | undefined;
}

export interface AnalyzerTranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface AnalyzerTranscript {
  text: string;
  segments: AnalyzerTranscriptSegment[];
}

export interface AnalysisOutput {
  rawResponse: string;
  usage?: GeminiUsageAccounting | undefined;
  transcript?: AnalyzerTranscript | null | undefined;
}

export interface AnalyzePhotoItem {
  fingerprint: string;
  fileName: string;
  proxyPath: string;
}

export interface AnalyzePhotosInput {
  items: AnalyzePhotoItem[];
  provider: AnalyzerProviderConfig;
  outputLanguage: AppConfig['output_language'];
  tagLanguage: AppConfig['tag_language'];
  timeoutSeconds: number;
  verbose: boolean;
  signal?: AbortSignal | undefined;
  onWarning?: ((warning: string) => void) | undefined;
}

export interface AnalyzePhotosOutput {
  rawResponse: string;
  usage?: GeminiUsageAccounting | undefined;
}

export type AnalyzerBatchJobState = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'expired';

export interface AnalyzerBatchUploadInput {
  key: string;
  videoPath: string;
  outputLanguage: AppConfig['output_language'];
  tagLanguage: AppConfig['tag_language'];
  provider: AnalyzerProviderConfig;
  timeoutSeconds: number;
  signal?: AbortSignal | undefined;
}

export interface AnalyzerBatchRequest {
  key: string;
  videoPath: string;
  fileName: string;
  fileUri: string;
  outputLanguage: AppConfig['output_language'];
  tagLanguage: AppConfig['tag_language'];
}

export interface AnalyzerBatchSubmission {
  jobName: string;
  requestCount: number;
}

export interface AnalyzerBatchResult {
  key: string;
  outcome: Result<AnalysisOutput, AppError>;
}

export interface AnalyzerBatchStatus {
  state: AnalyzerBatchJobState;
  message: string | null;
  results: AnalyzerBatchResult[] | null;
}

export interface AnalyzerBatchPort {
  uploadForBatch(input: AnalyzerBatchUploadInput): Promise<Result<AnalyzerBatchRequest, AppError>>;
  submitBatch(input: {
    provider: AnalyzerProviderConfig;
    displayName: string;
    requests: readonly AnalyzerBatchRequest[];
    signal?: AbortSignal | undefined;
  }): Promise<Result<AnalyzerBatchSubmission, AppError>>;
  findBatchByDisplayName(input: {
    provider: AnalyzerProviderConfig;
    displayName: string;
    signal?: AbortSignal | undefined;
  }): Promise<Result<string | null, AppError>>;
  batchStatus(input: {
    provider: AnalyzerProviderConfig;
    jobName: string;
    model: string;
    requestKeys: readonly string[];
    signal?: AbortSignal | undefined;
  }): Promise<Result<AnalyzerBatchStatus, AppError>>;
  releaseBatchUploads(input: {
    provider: AnalyzerProviderConfig;
    fileNames: readonly string[];
  }): Promise<Result<{ retained: number }, AppError>>;
}

export interface AnalyzerPort {
  promptVersion(provider: AnalyzerProviderConfig): number;
  analyze(input: AnalyzeInput): Promise<Result<AnalysisOutput, AppError>>;
  analyzePhotos(input: AnalyzePhotosInput): Promise<Result<AnalyzePhotosOutput, AppError>>;
  dependency(input?: {
    backend: AppConfig['analyzer_backend'];
    provider?: AnalyzerProviderConfig | undefined;
  }): Promise<Result<DependencyStatus, AppError>>;
}

export type ProviderTestResult =
  | {
      family: 'api';
      providerId: string;
      reachable: boolean;
      authenticated: boolean;
      latencyMs: number | null;
      message: string;
    }
  | {
      family: 'harness';
      providerId: string;
      available: boolean;
      version: string | null;
      latencyMs: number | null;
      message: string;
    }
  | {
      family: 'local';
      providerId: string;
      runtimeAvailable: boolean;
      modelAvailable: boolean;
      version: string | null;
      latencyMs: number | null;
      message: string;
    };

export interface ProvidersPort {
  test(config: AnalyzerProviderConfig): Promise<Result<ProviderTestResult, AppError>>;
}

export interface LocalAiRuntimeStatus {
  runtimeUp: boolean;
  runtimeVersion: string;
  installedModels: string[];
}

export interface LocalAiPullProgress {
  tag: string;
  status: string;
  completed: number | null;
  total: number | null;
  percentage: number | null;
}

export interface LocalAiRuntimePort {
  machine(): Promise<Result<MachineProfile, AppError>>;
  status(): Promise<Result<LocalAiRuntimeStatus, AppError>>;
  ensure(signal?: AbortSignal): Promise<Result<{ baseUrl: string }, AppError>>;
  pull(
    tag: string,
    options?: {
      onRuntimeReady?: (() => Promise<Result<void, AppError>>) | undefined;
      onProgress?: (progress: LocalAiPullProgress) => void;
      signal?: AbortSignal | undefined;
    },
  ): Promise<Result<{ tag: string; status: 'installed' }, AppError>>;
  rm(tag: string): Promise<Result<{ tag: string; status: 'removed' }, AppError>>;
  stopManagedDaemon(): Promise<Result<{ stopped: boolean }, AppError>>;
  dependency(): Promise<Result<DependencyStatus, AppError>>;
}

export interface WhisperDownloadProgress {
  model: WhisperModelName;
  downloadedBytes: number;
  totalBytes: number | null;
  percentage: number | null;
  speed: number | null;
}

export interface FileArtifactDownloadProgress {
  artifactId: FileArtifactId;
  downloadedBytes: number;
  totalBytes: number | null;
  percentage: number | null;
  speed: number | null;
}

export interface ModelDownloadPort {
  whisperModelPath(model: WhisperModelName): string;
  isWhisperModelDownloaded(model: WhisperModelName): Promise<Result<boolean, AppError>>;
  downloadWhisperModel(
    model: WhisperModelName,
    options: { force: boolean; onProgress?: (progress: WhisperDownloadProgress) => void; signal?: AbortSignal | undefined },
  ): Promise<Result<{ model: WhisperModelName; path: string; downloaded: boolean; skipped: boolean; sizeBytes?: number }, AppError>>;
  deleteWhisperModel(
    model: WhisperModelName,
    options: { force: boolean },
  ): Promise<Result<{ model: WhisperModelName; path: string; deleted: boolean }, AppError>>;
  fileArtifactPath(artifact: FileArtifact): string;
  isFileArtifactDownloaded(artifact: FileArtifact): Promise<Result<boolean, AppError>>;
  downloadFileArtifact(
    artifact: FileArtifact,
    options: { force: boolean; onProgress?: (progress: FileArtifactDownloadProgress) => void; signal?: AbortSignal | undefined },
  ): Promise<Result<{ artifactId: FileArtifactId; path: string; downloaded: boolean; skipped: boolean; sizeBytes?: number }, AppError>>;
}

export type JobKind =
  | 'process'
  | 'process_drive'
  | 'variant_projection'
  | 'whisper_download'
  | 'whisper_runtime_install'
  | 'local_ai_pull'
  | 'face_artifact_download'
  | 'faces_index'
  | 'faces_recluster'
  | 'faces_exemplars'
  | 'materialize'
  | 'thumbnails'
  | 'gps_backfill'
  | 'photo_scan'
  | 'photo_proxies'
  | 'photo_grid_thumbs'
  | 'photo_process'
  | 'photo_gps_backfill';
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export const JOB_CANCELLED_ERROR_MESSAGE = 'Job cancelled';
export type ProcessJobStep =
  | 'run-started'
  | 'folder-started'
  | 'folder-done'
  | 'file-skipped'
  | 'run-summary'
  | 'materialize_file'
  | 'extracting_frames'
  | 'extracting_audio'
  | 'transcribing_audio'
  | 'analyzing_with_claude'
  | 'renaming_video'
  | 'skipping_rename'
  | 'faces_scanning'
  | 'faces_extracting_frames'
  | 'faces_detecting'
  | 'faces_file_failed'
  | 'faces_clustering'
  | 'faces_done'
  | 'faces_pass_skipped'
  | 'faces_waiting'
  | 'artifact_reused'
  | 'catalog_index_skipped'
  | 'catalog_snapshot_skipped'
  | 'batch_submitted'
  | 'batch_poll'
  | 'batch_completed'
  | 'batch_uploads_retained'
  | 'batch_orphan_jobs'
  | 'batch_model_changed'
  | 'budget_cap_reached'
  | 'thumbnails_scanning'
  | 'thumbnails_file'
  | 'thumbnails_done'
  | 'gps_timeline_loaded'
  | 'gps_backfill_file'
  | 'gps_backfill_done'
  | 'photo-file'
  | 'photo-file-skipped'
  | 'photo-folder-skipped'
  | 'photo-exif-failed'
  | 'photo-run-summary'
  | 'photo-proxies-scanning'
  | 'photo-proxy'
  | 'photo-proxy-failed'
  | 'photo-proxies-skipped'
  | 'photo-proxies-summary'
  | 'photo-grid-thumbs-scanning'
  | 'photo-grid-thumb'
  | 'photo-grid-thumb-failed'
  | 'photo-grid-thumbs-summary'
  | 'photo-analysis-scanning'
  | 'photo-analysed'
  | 'photo-analysis-failed'
  | 'photo-analysis-usage'
  | 'photo-process-summary';

export interface JobProgress {
  step: ProcessJobStep | 'downloading' | 'runtime_setup' | 'model_download';
  percentage?: number;
  current?: number;
  total?: number;
  stepNumber?: number;
  totalSteps?: number;
  data?: Record<string, unknown>;
}

export interface SequencedJobProgress {
  sequence: number;
  progress: JobProgress;
}

export interface JobRecord {
  jobId: string;
  kind: JobKind;
  status: JobStatus;
  progress: JobProgress | null;
  progressEvents: SequencedJobProgress[];
  result?: unknown;
  error: AppError | null;
  createdAt: string;
  updatedAt: string;
  resourceKey?: string | undefined;
}

export interface JobExecutionContext {
  signal: AbortSignal;
  reportProgress(progress: JobProgress): Promise<Result<void, AppError>>;
}

export interface JobsPort {
  enqueue(input: {
    kind: JobKind;
    payload: unknown;
    resourceKey?: string | undefined;
    run?: (context: JobExecutionContext) => Promise<Result<unknown, AppError>>;
  }): Promise<Result<{ jobId: string }, AppError>>;
  get(jobId: string): Promise<Result<JobRecord | null, AppError>>;
  list(): Promise<Result<JobRecord[], AppError>>;
  cancel(jobId: string): Promise<Result<{ jobId: string; cancelled: boolean }, AppError>>;
  onSettled(jobId: string, callback: () => void | Promise<void>): void;
  acquireResource(key: string, signal?: AbortSignal | undefined): Promise<Result<() => void, AppError>>;
}
