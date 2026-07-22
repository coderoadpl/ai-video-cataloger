import { z } from 'zod';

export const WHISPER_MODEL_NAMES = ['tiny', 'base', 'small', 'medium', 'large-v3', 'large-v3-turbo'] as const;
export const whisperModelNameSchema = z.enum(WHISPER_MODEL_NAMES);
export type WhisperModelName = z.output<typeof whisperModelNameSchema>;

export interface WhisperModel {
  name: WhisperModelName;
  size: string;
  sizeMb: number;
}

export const WHISPER_MODELS: Record<WhisperModelName, WhisperModel> = {
  tiny: { name: 'tiny', size: '75MB', sizeMb: 75 },
  base: { name: 'base', size: '142MB', sizeMb: 142 },
  small: { name: 'small', size: '466MB', sizeMb: 466 },
  medium: { name: 'medium', size: '1.5GB', sizeMb: 1536 },
  'large-v3': { name: 'large-v3', size: '3.1GB', sizeMb: 3174 },
  'large-v3-turbo': { name: 'large-v3-turbo', size: '1.6GB', sizeMb: 1549 },
};

export const FILE_ARTIFACT_IDS = [
  'face-detector/yunet-2023mar',
  'face-embedder/sface-2021dec',
] as const;
export const fileArtifactIdSchema = z.enum(FILE_ARTIFACT_IDS);
export type FileArtifactId = z.output<typeof fileArtifactIdSchema>;

export interface FileArtifact {
  id: FileArtifactId;
  filename: string;
  bytes: number | null;
  sha256: string;
  url: string;
  license: string;
}

export const FILE_ARTIFACTS: Record<FileArtifactId, FileArtifact> = {
  'face-detector/yunet-2023mar': {
    id: 'face-detector/yunet-2023mar',
    filename: 'face_detection_yunet_2023mar.onnx',
    bytes: 232589,
    sha256: '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4',
    url: 'https://huggingface.co/opencv/face_detection_yunet/resolve/main/face_detection_yunet_2023mar.onnx',
    license: 'MIT',
  },
  'face-embedder/sface-2021dec': {
    id: 'face-embedder/sface-2021dec',
    filename: 'face_recognition_sface_2021dec.onnx',
    bytes: null,
    sha256: '0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79',
    url: 'https://huggingface.co/opencv/face_recognition_sface/resolve/main/face_recognition_sface_2021dec.onnx',
    license: 'Apache-2.0',
  },
};

export const LOCAL_AI_MODEL_TAGS = ['gemma3:4b', 'gemma3:12b', 'gemma3:27b', 'qwen2.5vl:7b'] as const;
export const localAiModelTagSchema = z.enum(LOCAL_AI_MODEL_TAGS);
export type LocalAiModelTag = z.output<typeof localAiModelTagSchema>;

export const LOCAL_AI_SUPPORT_LEVELS = ['ok', 'insufficient-ram', 'unsupported-platform'] as const;
export const localAiSupportLevelSchema = z.enum(LOCAL_AI_SUPPORT_LEVELS);
export type LocalAiSupportLevel = z.output<typeof localAiSupportLevelSchema>;

export interface LocalAiHardwareTier {
  tag: LocalAiModelTag;
  label: string;
  downloadGb: number;
  runRamGb: number;
  minimumRamGb: number;
  notes: string;
}

export const LOCAL_AI_HARDWARE_TIERS: Record<LocalAiModelTag, LocalAiHardwareTier> = {
  'gemma3:4b': {
    tag: 'gemma3:4b',
    label: 'Gemma 3 4B compact',
    downloadGb: 3.3,
    runRamGb: 6,
    minimumRamGb: 8,
    notes: 'Compact tier',
  },
  'gemma3:12b': {
    tag: 'gemma3:12b',
    label: 'Gemma 3 12B standard',
    downloadGb: 8.1,
    runRamGb: 11,
    minimumRamGb: 16,
    notes: 'Default/recommended',
  },
  'gemma3:27b': {
    tag: 'gemma3:27b',
    label: 'Gemma 3 27B max',
    downloadGb: 17,
    runRamGb: 22,
    minimumRamGb: 32,
    notes: 'Largest Gemma tier',
  },
  'qwen2.5vl:7b': {
    tag: 'qwen2.5vl:7b',
    label: 'Qwen 2.5 VL 7B alt vision',
    downloadGb: 6,
    runRamGb: 9,
    minimumRamGb: 16,
    notes: 'Alternate vision model',
  },
};

export interface MachineProfile {
  platform: string;
  arch: string;
  ramGb: number;
}

export const getLocalAiSupportLevel = (
  tier: LocalAiHardwareTier,
  machine: MachineProfile,
): LocalAiSupportLevel => {
  if (machine.platform !== 'darwin' || machine.arch !== 'arm64') return 'unsupported-platform';
  if (machine.ramGb < tier.minimumRamGb) return 'insufficient-ram';
  return 'ok';
};
