export type MapMediaKind = 'video' | 'photo';
export type MapMediaFilter = 'all' | MapMediaKind;

export const MAP_MEDIA_FILTERS: readonly MapMediaFilter[] = ['all', 'video', 'photo'];

interface MediaTagged {
  media: MapMediaKind;
}

export const filterByMedia = <T extends MediaTagged>(items: readonly T[], filter: MapMediaFilter): T[] =>
  filter === 'all' ? [...items] : items.filter((item) => item.media === filter);

export const countByMedia = (items: readonly MediaTagged[]): { video: number; photo: number } => ({
  video: items.filter((item) => item.media === 'video').length,
  photo: items.filter((item) => item.media === 'photo').length,
});
