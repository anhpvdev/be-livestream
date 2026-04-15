import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Livestream } from './livestream.entity';
import { EncoderSession } from '../../encoder/entities/encoder-session.entity';

@Entity('livestream_progress')
export class LivestreamProgress {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_progress_livestream_id')
  @Column({ type: 'uuid' })
  livestreamId: string;

  @ManyToOne(() => Livestream, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'livestreamId' })
  livestream: Livestream;

  @Column({ type: 'uuid' })
  encoderSessionId: string;

  @ManyToOne(() => EncoderSession, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'encoderSessionId' })
  encoderSession: EncoderSession;

  @Column({ type: 'bigint', default: 0 })
  currentTimestampMs: number;

  @Column({ type: 'varchar', length: 20, default: '00:00:00.000' })
  currentTimestampStr: string;

  @Column({ type: 'bigint', nullable: true })
  bytesProcessed: number;

  @Column({ type: 'bigint', nullable: true })
  framesProcessed: number;

  @Column({ type: 'varchar', length: 20, nullable: true })
  currentBitrate: string;

  @Index('idx_progress_updated_at')
  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
