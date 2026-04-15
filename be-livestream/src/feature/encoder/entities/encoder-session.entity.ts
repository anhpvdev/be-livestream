import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Livestream } from '../../livestream/entities/livestream.entity';

export enum EncoderNode {
  PRIMARY = 'primary',
  BACKUP = 'backup',
}

export enum EncoderSessionStatus {
  STARTING = 'starting',
  RUNNING = 'running',
  STOPPED = 'stopped',
  CRASHED = 'crashed',
  FAILOVER = 'failover',
}

@Entity('encoder_sessions')
export class EncoderSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_encoder_sessions_livestream_id')
  @Column({ type: 'uuid' })
  livestreamId: string;

  @ManyToOne(() => Livestream, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'livestreamId' })
  livestream: Livestream;

  @Column({ type: 'enum', enum: EncoderNode })
  encoderNode: EncoderNode;

  @Column({ type: 'varchar', length: 100, nullable: true })
  containerId: string;

  @Index('idx_encoder_sessions_status')
  @Column({
    type: 'enum',
    enum: EncoderSessionStatus,
    default: EncoderSessionStatus.STARTING,
  })
  status: EncoderSessionStatus;

  @Column({ type: 'int', nullable: true })
  ffmpegPid: number;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  stoppedAt: Date;

  @Column({ type: 'text', nullable: true })
  crashReason: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
