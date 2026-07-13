export type SampleSource =
  | { kind: 'repo'; path: string }
  | { kind: 'url'; url: string; sha256: string }
  | { kind: 'synthetic'; speech: string };

export type WhisperMode = 'local' | 'skip';

export interface VideoSample {
  id: string;
  file: string;
  source: SampleSource;
  license: string;
  contentKeywords: string[];
  transcriptKeywords?: string[];
  whisper: WhisperMode;
}

export const SPEECH_SAMPLE_TEXT =
  'Welcome to this short cooking tutorial. Today we will make a simple pasta ' +
  'with tomato sauce. First, boil the pasta in salted water for ten minutes. ' +
  'Meanwhile, fry some garlic in olive oil and add the crushed tomatoes. ' +
  'Finally, mix the pasta with the sauce and serve it with fresh basil.';

export const SAMPLES: VideoSample[] = [
  {
    id: 'bbb',
    file: 'BigBuckBunny480p30s.mp4',
    source: { kind: 'repo', path: 'test/BigBuckBunny480p30s.mp4' },
    license: 'CC-BY 3.0 (c) Blender Foundation | peach.blender.org',
    contentKeywords: [
      'bunny',
      'rabbit',
      'hare',
      'animal',
      'forest',
      'butterfly',
      'bird',
      'squirrel',
      'rodent',
      'nature',
      'grass',
      'meadow',
      'animated',
      'animation',
      'cartoon',
      'big buck',
    ],
    whisper: 'skip',
  },
  {
    id: 'sintel',
    file: 'sintel_trailer-480p.mp4',
    source: {
      kind: 'url',
      url: 'https://download.blender.org/durian/trailer/sintel_trailer-480p.mp4',
      sha256: 'b670602fa00934ca27c4351bb0efe7ea7a07fae57284e44226025eeed7c51254',
    },
    license: 'CC-BY 3.0 (c) Blender Foundation | durian.blender.org',
    contentKeywords: [
      'girl',
      'woman',
      'warrior',
      'dragon',
      'sword',
      'blade',
      'snow',
      'mountain',
      'journey',
      'quest',
      'search',
      'fantasy',
      'sintel',
      'animated',
      'animation',
      'trailer',
      'cinematic',
    ],
    transcriptKeywords: ['searching', 'someone', 'blade', 'dark', 'past', 'matter', 'gatekeeper'],
    whisper: 'local',
  },
  {
    id: 'jellyfish',
    file: 'Jellyfish_360_10s_1MB.mp4',
    source: {
      kind: 'url',
      url: 'https://test-videos.co.uk/vids/jellyfish/mp4/h264/360/Jellyfish_360_10s_1MB.mp4',
      sha256: 'f30cc460706509ad28690d97bb6296a22f68e67c11b91f92bad5b6c5f4c2f6bd',
    },
    license: 'free test asset | test-videos.co.uk',
    contentKeywords: [
      'jellyfish',
      'jelly',
      'underwater',
      'ocean',
      'sea',
      'marine',
      'aquarium',
      'swim',
      'swimming',
      'water',
      'blue',
      'tentacle',
    ],
    whisper: 'skip',
  },
  {
    id: 'speech',
    file: 'synthetic-cooking-speech.mp4',
    source: { kind: 'synthetic', speech: SPEECH_SAMPLE_TEXT },
    license: 'generated locally for tests',
    contentKeywords: [
      'pasta',
      'cook',
      'cooking',
      'recipe',
      'tutorial',
      'tomato',
      'sauce',
      'kitchen',
      'food',
      'boil',
      'garlic',
      'test',
      'pattern',
      'color',
      'bars',
    ],
    transcriptKeywords: ['pasta', 'tomato', 'boil', 'garlic', 'sauce', 'basil', 'cooking'],
    whisper: 'local',
  },
];

export function selectedSamples(): VideoSample[] {
  const raw = process.env.E2E_SAMPLES;
  if (!raw) return SAMPLES;
  const wanted = new Set(raw.split(',').map((value) => value.trim()).filter(Boolean));
  const picked = SAMPLES.filter((sample) => wanted.has(sample.id));
  if (picked.length === 0) {
    throw new Error(`E2E_SAMPLES=${raw} matches no sample ids: ${SAMPLES.map((sample) => sample.id).join(', ')}`);
  }
  return picked;
}
