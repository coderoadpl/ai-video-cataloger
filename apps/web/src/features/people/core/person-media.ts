export type PeopleMedia = 'all' | 'video' | 'photo';

export interface PersonMediaObservations {
  videoCount: number;
  photoCount: number;
}

export interface PeopleMediaCounts {
  all: number;
  video: number;
  photo: number;
}

export const personCountForMedium = (person: PersonMediaObservations, medium: PeopleMedia): number => {
  switch (medium) {
    case 'video':
      return person.videoCount;
    case 'photo':
      return person.photoCount;
    case 'all':
      return person.videoCount + person.photoCount;
  }
};

export const peopleForMedium = <T extends PersonMediaObservations>(people: readonly T[], medium: PeopleMedia): T[] =>
  medium === 'all' ? [...people] : people.filter((person) => personCountForMedium(person, medium) > 0);

export const peopleMediaCounts = (people: readonly PersonMediaObservations[]): PeopleMediaCounts => ({
  all: people.length,
  video: peopleForMedium(people, 'video').length,
  photo: peopleForMedium(people, 'photo').length,
});
