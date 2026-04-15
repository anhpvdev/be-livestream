import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum MediaFileStatus {
  UPLOADING = 'uploading',
  READY = 'ready',
  ERROR = 'error',
}

export enum MediaFileKind {
  VIDEO = 'video',
  IMAGE = 'image',
  AUDIO = 'audio',
}

@Entity('media_files')
export class MediaFile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_media_files_name')
  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 500 })
  originalName: string;

  @Column({ type: 'varchar', length: 1000, unique: true })
  storageKey: string;

  @Column({ type: 'varchar', length: 100 })
  mimeType: string;

  @Index('idx_media_files_kind')
  @Column({
    type: 'enum',
    enum: MediaFileKind,
    default: MediaFileKind.VIDEO,
  })
  kind: MediaFileKind;

  @Column({ type: 'bigint' })
  sizeBytes: number;

  @Column({ type: 'float', nullable: true })
  durationSeconds: number;

  @Column({ type: 'varchar', length: 20, nullable: true })
  resolution: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  codec: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  thumbnailKey: string;

  @Index('idx_media_files_status')
  @Column({
    type: 'enum',
    enum: MediaFileStatus,
    default: MediaFileStatus.UPLOADING,
  })
  status: MediaFileStatus;

  @Index('idx_media_files_created_at')
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
