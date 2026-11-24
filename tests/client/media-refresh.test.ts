import { describe, expect, it } from "vitest";
import { freshMediaSrc, mediaKey } from "@/lib/client/media-refresh";

const HOST = "https://private-user-images.githubusercontent.com";

describe("a video that outlived its signed URL", () => {
  it("knows the same file under another signature", () => {
    expect(mediaKey(`${HOST}/1/clip.mp4?jwt=old`)).toBe(mediaKey(`${HOST}/1/clip.mp4?jwt=new`));
    expect(mediaKey(`${HOST}/1/clip.mp4?jwt=old`)).not.toBe(mediaKey(`${HOST}/1/other.mp4?jwt=old`));
    expect(mediaKey("not a url")).toBeNull();
  });

  it("takes the new URL of the same file, wherever it is now", () => {
    const fresh = [`${HOST}/1/other.mp4?jwt=new`, `${HOST}/1/clip.mp4?jwt=new`];
    expect(freshMediaSrc(`${HOST}/1/clip.mp4?jwt=old`, 0, 1, fresh)).toBe(`${HOST}/1/clip.mp4?jwt=new`);
  });

  it("falls back to the same position only when the videos still line up", () => {
    const stale = `${HOST}/1/a.mp4?jwt=old`;
    expect(freshMediaSrc(stale, 1, 2, [`${HOST}/2/x.mp4`, `${HOST}/2/y.mp4`])).toBe(`${HOST}/2/y.mp4`);
    expect(freshMediaSrc(stale, 1, 2, [`${HOST}/2/x.mp4`])).toBeNull();
  });

  it("has nothing to retry when the URL comes back unchanged", () => {
    const src = "https://github.com/acme/widgets/assets/1/clip.mp4";
    expect(freshMediaSrc(src, 0, 1, [src])).toBeNull();
    expect(freshMediaSrc(src, 0, 1, [])).toBeNull();
  });
});
