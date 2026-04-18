import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Livestream } from './livestream.entity';

export enum BroadcastSegmentStatus {
  PREPARING = 'preparing',
  ACTIVE = 'active',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

@Entity('broadcast_segments')
export class BroadcastSegment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_broadcast_segments_livestream_id')
  @Column({ type: 'uuid' })
  livestreamId: string;

  @ManyToOne(() => Livestream, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'livestreamId' })
  livestream: Livestream;

  @Column({ type: 'int' })
  segmentIndex: number;

  @Column({ type: 'varchar', length: 100 })
  youtubeBroadcastId: string;

  @Column({ type: 'varchar', length: 100 })
  youtubeStreamId: string;

  @Column({ type: 'varchar', length: 255 })
  youtubeStreamKey: string;

  @Column({ type: 'varchar', length: 500 })
  youtubeRtmpUrl: string;

  @Column({ type: 'timestamptz' })
  plannedStartAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  plannedEndAt: Date | null;

  @Index('idx_broadcast_segments_status')
  @Column({
    type: 'enum',
    enum: BroadcastSegmentStatus,
    default: BroadcastSegmentStatus.PREPARING,
  })
  status: BroadcastSegmentStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
