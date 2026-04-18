import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('encoder_vps')
export class EncoderVps {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  /** Base URL stream-encoder (vd: http://10.0.0.5:8080), unique — dùng làm khóa upsert webhook. */
  @Column({ type: 'varchar', length: 500, name: 'base_url', unique: true })
  baseUrl: string;

  /** Định danh instance encoder lần đăng ký gần nhất (hostname / ENGINE_NODE / ...). */
  @Column({ type: 'varchar', length: 128, name: 'encoder_node', nullable: true })
  encoderNode: string | null;

  /** Lần cuối encoder gọi webhook đăng ký / heartbeat. */
  @Column({ type: 'timestamptz', name: 'last_seen_at', nullable: true })
  lastSeenAt: Date | null;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
