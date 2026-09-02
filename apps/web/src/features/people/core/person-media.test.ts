import { describe, expect, it } from 'vitest';

import { peopleForMedium, peopleMediaCounts, personCountForMedium } from './person-media.js';

const person = (personId: string, videoCount: number, photoCount: number) => ({ personId, videoCount, photoCount });

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
