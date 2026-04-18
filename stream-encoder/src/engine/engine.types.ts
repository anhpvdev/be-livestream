export type EngineStatus = 'idle' | 'running' | 'completed' | 'crashed' | 'stopped' | 'standby';

export type EncoderJobRow = {
  livestream_id: string;
  desired_state: 'running' | 'stopped';
  media_path: string | null;
  rtmp_url: string | null;
  backup_rtmp_url: string | null;
  stream_key: string | null;
  seek_to: string | null;
  seek_mode: 'normal' | 'failover' | null;
  profile_id: string | null;
  current_video_index: number | null;
  current_media_id: string | null;
  playlist_generation: number | null;
  owner_node: string | null;
  owner_epoch: number | null;
  lease_until: string | null;
};
