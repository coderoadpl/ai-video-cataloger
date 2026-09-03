import { describe, expect, it } from 'vitest';

import { peopleForMedium, peopleMediaCounts, personFileCountLabel, sortPeople, personCountForMedium } from './person-media.js';

const person = (personId: string, videoCount: number, photoCount: number, fileCounts = { video: videoCount, photo: photoCount }) => ({
  personId,
  videoCount,
  photoCount,
  observationCount: videoCount + photoCount,
  fileCounts,
});

const enLabels = {
  observationCount: (count: number) => `${String(count)} observations`,
  videoObservationCount: (count: number) => `${String(count)} in videos`,
  photoObservationCount: (count: number) => `${String(count)} in photos`,
  videoFileCount: (count: number) => `${String(count)} videos`,
  photoFileCount: (count: number) => `${String(count)} photos`,
};

const plLabels = {
  observationCount: (count: number) => `${String(count)} obserwacji`,
  videoObservationCount: (count: number) => `${String(count)} w filmach`,
  photoObservationCount: (count: number) => `${String(count)} w zdjęciach`,
  videoFileCount: (count: number) => count === 1 ? '1 film' : `${String(count)} filmów`,
  photoFileCount: (count: number) => `${String(count)} zdjęcia`,
};

describe('personCountForMedium', () => {
  it('reports the medium count for a chip and the union for Wszystko', () => {
    const subject = person('p1', 2, 3);
    expect(personCountForMedium(subject, 'all')).toBe(5);
    expect(personCountForMedium(subject, 'video')).toBe(2);
    expect(personCountForMedium(subject, 'photo')).toBe(3);
  });
});

describe('peopleForMedium', () => {
  const people = [person('both', 1, 1), person('video-only', 2, 0), person('photo-only', 0, 4)];

  it('keeps everyone for Wszystko in the order the server returned', () => {
    expect(peopleForMedium(people, 'all').map((entry) => entry.personId)).toEqual(['both', 'video-only', 'photo-only']);
  });

  it('drops the people the medium has no observations for', () => {
    expect(peopleForMedium(people, 'video').map((entry) => entry.personId)).toEqual(['both', 'video-only']);
    expect(peopleForMedium(people, 'photo').map((entry) => entry.personId)).toEqual(['both', 'photo-only']);
  });
});

describe('peopleMediaCounts', () => {
  it('counts the people each chip would show, not their observations', () => {
    const people = [person('both', 1, 9), person('video-only', 2, 0), person('photo-only', 0, 4)];
    expect(peopleMediaCounts(people)).toEqual({ all: 3, video: 2, photo: 2 });
  });

  it('is all zeroes for an empty pool', () => {
    expect(peopleMediaCounts([])).toEqual({ all: 0, video: 0, photo: 0 });
  });
});

describe('personFileCountLabel', () => {
  it('lists only non-zero file media in the selected view', () => {
    const subject = person('p1', 12, 6, { video: 2, photo: 3 });

    expect(personFileCountLabel(enLabels, subject, 'all')).toBe('2 videos · 3 photos');
    expect(personFileCountLabel(enLabels, subject, 'video')).toBe('2 videos');
    expect(personFileCountLabel(enLabels, subject, 'photo')).toBe('3 photos');
  });

  it('falls back to the observation count when no file counts are available', () => {
    expect(personFileCountLabel(enLabels, person('p1', 2, 0, { video: 0, photo: 0 }), 'video')).toBe('2 in videos');
    expect(personFileCountLabel(plLabels, person('p1', 0, 3, { video: 0, photo: 0 }), 'photo')).toBe('3 w zdjęciach');
    expect(personFileCountLabel(plLabels, person('p1', 2, 3, { video: 0, photo: 0 }), 'all')).toBe('5 obserwacji');
  });

  it('uses Polish plural forms for file media', () => {
    expect(personFileCountLabel(plLabels, person('p1', 1, 2, { video: 1, photo: 2 }), 'all')).toBe('1 film · 2 zdjęcia');
    expect(personFileCountLabel(plLabels, person('p1', 5, 3, { video: 5, photo: 3 }), 'all')).toBe('5 filmów · 3 zdjęcia');
  });
});

describe('sortPeople', () => {
  it('sorts by distinct files, then observations, then stable original index', () => {
    const people = [
      person('first', 1, 0, { video: 1, photo: 0 }),
      person('second', 2, 1, { video: 2, photo: 1 }),
      person('third', 4, 2, { video: 2, photo: 1 }),
    ];

    expect(sortPeople(people, 'frequent').map((entry) => entry.personId)).toEqual(['third', 'second', 'first']);
    expect(sortPeople(people, 'order').map((entry) => entry.personId)).toEqual(['first', 'second', 'third']);
  });
});
