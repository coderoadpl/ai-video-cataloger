export const gradientIndexFor = (name: string): number => {
  let sum = 0;
  for (let index = 0; index < name.length; index += 1) sum += name.charCodeAt(index);
  return sum % 6;
};

export const middleEllipsis = (name: string, max: number): string => {
  if (name.length <= max) return name;
  const keep = max - 1;
  const headLength = Math.ceil(keep / 2);
  const tailLength = Math.floor(keep / 2);
  return `${name.slice(0, headLength)}…${name.slice(name.length - tailLength)}`;
};
