import { LANGUAGE_DISPLAY_NAMES } from '@core/domain/config.js';

export const retrievalBriefing =
  'Write for retrieval: months from now someone will look for this clip with a handful of remembered words, so every line has to carry the details that separate it from a hundred similar ones. Read the text that is visible in the frames - signs, placards, banners, shop and street names, vehicle registrations, printed or on-screen dates, screens, labels, numbers - and use what you can actually read. Prefer named, concrete specifics (which subject, which place, which action) over generic scene language. Apply these evidence gates: Use proper nouns and quoted signage only when they are legibly readable on screen or clearly and audibly spoken; otherwise use a generic descriptor such as "boat exhibit placard", never a guess. If no speech is present, explicitly state that there is no speech; never invent utterances, languages, or lyrics. Make setting and location claims only when visually supported; never reframe the visible setting as a different place. Describe uncertain audio generically as music or ambience, without language or genre claims unless unambiguous. Never invent names or facts, and never guess at text that is too small or too blurred to read.';

export const descriptionInstruction =
  '2-4 sentences on what the video actually shows: the concrete subject, the place, what happens, and the distinctive text or names you verified from the frames or the audio, quoted as they appear. Open with what makes this clip identifiable instead of the category it belongs to. Do not speculate beyond what you can see or hear.';

export const filenameInstruction =
  'a lowercase kebab-case filename (no dates, no extension) built so a future search lands on this exact clip: most distinctive verifiable detail first - proper names, text you read, place, subject, action. The filename must not lead with any proper noun or quoted signage that fails the legibly-readable-or-clearly-spoken evidence gate. Three words when that is honestly all the clip offers, up to eight when the content earns them. Never use filler words such as video, clip, footage, recording, scene or movie, and never settle for a generic label like museum-exhibit or boat-display when anything more specific is visible.';

export const tagsInstruction =
  '3-8 comma-separated kebab-case tags that work as search handles: concrete objects, place type, activity, and notable text or proper nouns you read in frame. Prefer the specific over the generic and never tag the medium itself (video, clip, footage).';

export const outputLanguageInstruction = (outputLanguage: string): string =>
  outputLanguage === 'auto'
    ? ''
    : `\n\nWrite the DESCRIPTION and the FILENAME in ${LANGUAGE_DISPLAY_NAMES[outputLanguage] ?? outputLanguage}. Keep the TAGS in ASCII kebab-case English regardless of the description language.`;
