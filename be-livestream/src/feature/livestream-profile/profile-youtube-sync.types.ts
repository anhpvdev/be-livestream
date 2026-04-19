/** Trường nào đổi trên profile thì mới gọi API YouTube tương ứng. */
export type ProfileYoutubeSyncDelta = {
  /** videos.update — title / description / tags */
  video: boolean;
  /** liveBroadcasts.update — title / description / privacy */
  broadcast: boolean;
  /** thumbnails.set */
  thumbnail: boolean;
};
