export type GhostTag = {
  id?: string;
  name?: string;
  slug?: string;
  visibility?: string;
};

export type GhostAuthor = {
  id?: string;
  name?: string;
  profile_image?: string | null;
};

export type GhostPost = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  custom_excerpt: string | null;
  feature_image: string | null;
  feature_image_alt: string | null;
  published_at: string;
  reading_time: number;
  url: string;
  tags?: GhostTag[];
  authors?: GhostAuthor[];
};

type PostsResponse = { posts: GhostPost[] };

const API_URL = import.meta.env.VITE_GHOST_API_URL as string | undefined;
const CONTENT_KEY = import.meta.env.VITE_GHOST_CONTENT_KEY as string | undefined;

export function isGhostConfigured(): boolean {
  return Boolean(API_URL && CONTENT_KEY);
}

export async function fetchLatestPosts(limit = 3): Promise<GhostPost[]> {
  if (!API_URL || !CONTENT_KEY) return [];
  const params = new URLSearchParams({
    key: CONTENT_KEY,
    limit: String(limit),
    fields: 'id,title,slug,excerpt,custom_excerpt,feature_image,feature_image_alt,published_at,reading_time,url',
    include: 'tags,authors',
    order: 'published_at desc',
  });
  const res = await fetch(`${API_URL}/ghost/api/content/posts/?${params}`);
  if (!res.ok) throw new Error(`Ghost API returned ${res.status}`);
  const data = (await res.json()) as PostsResponse;
  return data.posts ?? [];
}

export function formatRelativeDate(iso: string): string {
  try {
    const then = new Date(iso).getTime();
    const now = Date.now();
    const diffSec = Math.floor((now - then) / 1000);

    const units: [number, Intl.RelativeTimeFormatUnit][] = [
      [60, 'second'],
      [60, 'minute'],
      [24, 'hour'],
      [7, 'day'],
      [4.34524, 'week'],
      [12, 'month'],
      [Number.POSITIVE_INFINITY, 'year'],
    ];

    let value = diffSec;
    let unit: Intl.RelativeTimeFormatUnit = 'second';
    for (const [divisor, u] of units) {
      if (Math.abs(value) < divisor) {
        unit = u;
        break;
      }
      value = Math.round(value / divisor);
    }
    return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(-value, unit);
  } catch {
    return new Date(iso).toLocaleDateString();
  }
}

export function pickDisplayTag(tags?: GhostTag[]): string | undefined {
  const publicTag = tags?.find(tag => {
    const name = tag.name?.trim() ?? '';
    const slug = tag.slug?.trim() ?? '';
    return tag.visibility !== 'internal' && !name.startsWith('#Import') && !slug.startsWith('hash-import');
  });
  return publicTag?.name?.trim();
}
