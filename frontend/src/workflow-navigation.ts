export type CollectionOrigin = { collection: string; entry: string };

export function withCollection(path: string, origin?: CollectionOrigin) {
  if (!origin) return path;
  return path + (path.includes('?') ? '&' : '?') + new URLSearchParams(origin);
}

export function collectionHref(id: string, entry?: string) {
  return `#collections/${id}${entry ? '/' + entry : ''}`;
}
