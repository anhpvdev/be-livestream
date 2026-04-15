import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum GoogleAccountStatus {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  REVOKED = 'revoked',
}

@Entity('google_accounts')
export class GoogleAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Nhãn do hệ thống khác quản lý đăng nhập; dùng để phân biệt credential trong DB. */
  @Index('idx_google_accounts_account_label', { unique: true })
  @Column({ type: 'varchar', length: 255, unique: true })
  accountLabel: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  displayName: string | null;

  /** OAuth client id (theo tài khoản), không dùng biến môi trường app-level. */
  @Column({ type: 'varchar', length: 512 })
  clientId: string;

  /** Client secret (plain text); cần khi refresh access token. */
  @Column({ type: 'text', nullable: true })
  clientSecret: string | null;

  @Column({ type: 'text' })
  accessToken: string;

  @Column({ type: 'text', nullable: true })
  refreshToken: string | null;

  @Column({ type: 'timestamptz' })
  tokenExpiresAt: Date;

  @Column({ type: 'varchar', length: 100, nullable: true })
  channelId: string | null;

  @Index('idx_google_accounts_status')
  @Column({
    type: 'enum',
    enum: GoogleAccountStatus,
    default: GoogleAccountStatus.ACTIVE,
  })
  status: GoogleAccountStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
