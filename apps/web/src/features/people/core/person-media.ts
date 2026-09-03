export type PeopleMedia = 'all' | 'video' | 'photo';
export type PeopleSort = 'frequent' | 'order';

export interface PeopleCountLabels {
  observationCount: (count: number) => string;
  videoObservationCount: (count: number) => string;
  photoObservationCount: (count: number) => string;
  videoFileCount: (count: number) => string;
  photoFileCount: (count: number) => string;
}

export interface PersonMediaObservations {
  observationCount: number;
  videoCount: number;
  photoCount: number;
}

export interface PersonMediaFiles extends PersonMediaObservations {
  fileCounts: {
    video: number;
    photo: number;
  };
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

export const observationCountLabel = (
  labels: PeopleCountLabels,
  person: PersonMediaObservations,
  medium: PeopleMedia,
): string => {
  switch (medium) {
    case 'video':
      return labels.videoObservationCount(person.videoCount);
    case 'photo':
      return labels.photoObservationCount(person.photoCount);
    case 'all':
      return labels.observationCount(person.observationCount);
  }
};

export const personFileCountLabel = (
  labels: PeopleCountLabels,
  person: PersonMediaFiles,
  medium: PeopleMedia,
): string => {
  const parts = [
    ...(medium === 'all' || medium === 'video'
      ? person.fileCounts.video > 0 ? [labels.videoFileCount(person.fileCounts.video)] : []
      : []),
    ...(medium === 'all' || medium === 'photo'
      ? person.fileCounts.photo > 0 ? [labels.photoFileCount(person.fileCounts.photo)] : []
      : []),
  ];
  return parts.length === 0 ? observationCountLabel(labels, person, medium) : parts.join(' · ');
};

export const totalFileCount = (person: PersonMediaFiles): number =>
  person.fileCounts.video + person.fileCounts.photo;

const fileCountForMedium = (person: PersonMediaFiles, medium: PeopleMedia): number => {
  switch (medium) {
    case 'video':
      return person.fileCounts.video;
    case 'photo':
      return person.fileCounts.photo;
    case 'all':
      return totalFileCount(person);
  }
};

const observationCountForMedium = (person: PersonMediaObservations, medium: PeopleMedia): number => {
  switch (medium) {
    case 'video':
      return person.videoCount;
    case 'photo':
      return person.photoCount;
    case 'all':
      return person.observationCount;
  }
};

export const sortPeople = <T extends PersonMediaFiles>(people: readonly T[], sort: PeopleSort, medium: PeopleMedia = 'all'): T[] => {
  const indexed = people.map((person, index) => ({ person, index }));
  if (sort === 'order') return indexed.map((entry) => entry.person);
  return indexed
    .sort((left, right) =>
      fileCountForMedium(right.person, medium) - fileCountForMedium(left.person, medium)
      || observationCountForMedium(right.person, medium) - observationCountForMedium(left.person, medium)
      || left.index - right.index)
    .map((entry) => entry.person);
};
