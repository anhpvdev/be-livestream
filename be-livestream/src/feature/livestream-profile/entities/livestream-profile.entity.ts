import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PrivacyStatus } from '../../livestream/entities/livestream.entity';

@Entity('livestream_profiles')
export class LivestreamProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_livestream_profiles_name')
  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  videoMediaIds: string[];

  @Column({ type: 'varchar', length: 500, nullable: true })
  livestreamTitle: string | null;

  @Column({ type: 'text', nullable: true })
  livestreamDescription: string | null;

  @Column({ type: 'text', nullable: true })
  thumbnailUrl: string | null;

  @Column({
    type: 'enum',
    enum: PrivacyStatus,
    default: PrivacyStatus.UNLISTED,
  })
  privacyStatus: PrivacyStatus;

  @Column({ type: 'varchar', length: 100, nullable: true })
  youtubeBroadcastId: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  youtubeStreamId: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  youtubeStreamKey: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  youtubeRtmpUrl: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  youtubeBackupRtmpUrl: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
