import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum EncoderDesiredState {
  RUNNING = 'running',
  STOPPED = 'stopped',
}

@Entity('encoder_jobs')
export class EncoderJob {
  @PrimaryColumn({ type: 'uuid', name: 'livestream_id' })
  livestreamId: string;

  @Index('idx_encoder_jobs_desired_state')
  @Column({ type: 'varchar', length: 16, name: 'desired_state' })
  desiredState: EncoderDesiredState;

  @Column({ type: 'text', name: 'media_path', nullable: true })
  mediaPath: string | null;

  @Column({ type: 'text', name: 'rtmp_url', nullable: true })
  rtmpUrl: string | null;

  @Column({ type: 'text', name: 'backup_rtmp_url', nullable: true })
  backupRtmpUrl: string | null;

  @Column({ type: 'text', name: 'stream_key', nullable: true })
  streamKey: string | null;

  /** Thời điểm seek trong clip (ffmpeg), runtime do worker; có thể set khi failover explicit. */
  @Column({ type: 'varchar', length: 32, name: 'seek_to', nullable: true })
  seekTo: string | null;

  @Column({
    type: 'varchar',
    length: 16,
    name: 'seek_mode',
    default: 'normal',
  })
  seekMode: string;

  @Column({ type: 'uuid', name: 'profile_id', nullable: true })
  profileId: string | null;

  @Column({ type: 'int', name: 'current_video_index', default: 0 })
  currentVideoIndex: number;

  @Column({ type: 'uuid', name: 'current_media_id', nullable: true })
  currentMediaId: string | null;

  @Column({ type: 'int', name: 'playlist_generation', default: 0 })
  playlistGeneration: number;

  @Column({ type: 'varchar', length: 128, name: 'active_node', nullable: true })
  activeNode: string | null;

  @Column({ type: 'bigint', name: 'current_timestamp_ms', nullable: true })
  currentTimestampMs: number | null;

  @Column({
    type: 'varchar',
    length: 20,
    name: 'current_timestamp_str',
    nullable: true,
  })
  currentTimestampStr: string | null;

  /** Thời điểm wall-clock khi owner bắt đầu phát media hiện tại (worker ghi, phục vụ tính seek khi failover). */
  @Column({ type: 'timestamptz', name: 'start_current_media_at', nullable: true })
  startCurrentMediaAt: Date | null;

  @Column({ type: 'timestamptz', name: 'last_heartbeat_at', nullable: true })
  lastHeartbeatAt: Date | null;

  @Column({ type: 'varchar', length: 128, name: 'owner_node', nullable: true })
  ownerNode: string | null;

  @Column({ type: 'int', name: 'owner_epoch', nullable: true })
  ownerEpoch: number | null;

  @Column({ type: 'timestamptz', name: 'lease_until', nullable: true })
  leaseUntil: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
