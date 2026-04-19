/** Chuỗi tags nhập theo dấu phẩy → mảng tag (trim, bỏ rỗng). */
export function parseCommaSeparatedTags(
  raw: string | null | undefined,
): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/**
 * YouTube giới hạn ~500 ký tự cho tổng phần tags trong snippet (kể cả dấu phẩy).
 * @see https://developers.google.com/youtube/v3/docs/videos
 */
export function clipTagsForYoutubeApi(tags: string[]): string[] {
  const out: string[] = [];
  let total = 0;
  for (const t of tags) {
    const s = t.trim();
    if (!s) continue;
    const sep = out.length ? 1 : 0;
    if (total + sep + s.length > 500) break;
    out.push(s);
    total += sep + s.length;
  }
  return out;
}
