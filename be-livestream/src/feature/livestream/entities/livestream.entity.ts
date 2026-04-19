import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { GoogleAccount } from '../../google-account/entities/google-account.entity';
import { MediaFile } from '../../media/entities/media.entity';

export enum LivestreamStatus {
  CREATED = 'created',
  READY = 'ready',
  TESTING = 'testing',
  LIVE = 'live',
  COMPLETE = 'complete',
  ERROR = 'error',
  STOPPED = 'stopped',
}

export enum PrivacyStatus {
  PUBLIC = 'public',
  UNLISTED = 'unlisted',
  PRIVATE = 'private',
}

@Entity('livestreams')
export class Livestream {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_livestreams_google_account_id')
  @Column({ type: 'uuid' })
  googleAccountId: string;

  @ManyToOne(() => GoogleAccount, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'googleAccountId' })
  googleAccount: GoogleAccount;

  @Column({ type: 'uuid', nullable: true })
  mediaFileId: string | null;

  @ManyToOne(() => MediaFile, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'mediaFileId' })
  mediaFile: MediaFile | null;

  @Column({ type: 'uuid', nullable: true })
  currentSegmentId: string | null;

  @Column({ type: 'uuid', nullable: true })
  profileId: string | null;

  /** VPS chạy luồng primary (ENGINE_NODE=primary); null = bản ghi cũ trước khi bắt buộc gán VPS */
  @Column({ type: 'uuid', name: 'primary_encoder_vps_id', nullable: true })
  primaryEncoderVpsId: string | null;

  /** VPS chạy luồng backup (ENGINE_NODE=backup); null = bản ghi cũ trước khi bắt buộc gán VPS */
  @Column({ type: 'uuid', name: 'backup_encoder_vps_id', nullable: true })
  backupEncoderVpsId: string | null;

  @Column({ type: 'varchar', length: 500 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  youtubeBroadcastId: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  youtubeStreamId: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  youtubeStreamKey: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  youtubeRtmpUrl: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  youtubeBackupRtmpUrl: string | null;

  @Index('idx_livestreams_status')
  @Column({
    type: 'enum',
    enum: LivestreamStatus,
    default: LivestreamStatus.CREATED,
  })
  status: LivestreamStatus;

  @Column({ type: 'timestamptz', nullable: true })
  scheduledStartTime: Date;

  @Column({ type: 'timestamptz', nullable: true })
  actualStartTime: Date;

  @Column({ type: 'timestamptz', nullable: true })
  actualEndTime: Date;

  @Column({
    type: 'enum',
    enum: PrivacyStatus,
    default: PrivacyStatus.UNLISTED,
  })
  privacyStatus: PrivacyStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
