import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { google } from 'googleapis';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  GoogleAccount,
  GoogleAccountStatus,
} from './entities/google-account.entity';
import { CreateGoogleAccountManualDto } from './dto/create-google-account-manual.dto';
import { UpdateGoogleAccountManualDto } from './dto/update-google-account-manual.dto';

@Injectable()
export class GoogleAccountService {
  private readonly logger = new Logger(GoogleAccountService.name);

  constructor(
    @InjectRepository(GoogleAccount)
    private readonly googleAccountRepo: Repository<GoogleAccount>,
  ) {}

  async createManual(
    dto: CreateGoogleAccountManualDto,
  ): Promise<GoogleAccount> {
    const existing = await this.googleAccountRepo.findOne({
      where: { accountLabel: dto.accountName },
    });
    if (existing) {
      throw new ConflictException(
        `Account label "${dto.accountName}" already exists`,
      );
    }


    const account = this.googleAccountRepo.create({
      accountLabel: dto.accountName,
      email: dto.email ?? null,
      displayName: dto.channelName ?? null,
      clientId: dto.clientId,
      clientSecret: dto.clientSecret,
      accessToken: dto.refreshToken,
      refreshToken: dto.refreshToken,
      tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
      channelId: dto.channelId ?? null,
      status: GoogleAccountStatus.ACTIVE,
    });

    return this.googleAccountRepo.save(account);
  }

  async updateManual(
    id: string,
    dto: UpdateGoogleAccountManualDto,
  ): Promise<GoogleAccount> {
    const account = await this.findById(id);

    if (
      dto.accountLabel !== undefined &&
      dto.accountLabel !== account.accountLabel
    ) {
      const clash = await this.googleAccountRepo.findOne({
        where: { accountLabel: dto.accountLabel },
      });
      if (clash) {
        throw new ConflictException(
          `Account label "${dto.accountLabel}" already exists`,
        );
      }
      account.accountLabel = dto.accountLabel;
    }
    if (dto.email !== undefined) account.email = dto.email;
    if (dto.displayName !== undefined) account.displayName = dto.displayName;
    if (dto.clientId !== undefined) account.clientId = dto.clientId;
    if (dto.clientSecret !== undefined) {
      const raw = dto.clientSecret.trim();
      account.clientSecret = raw ? raw : null;
    }
    if (dto.accessToken !== undefined) {
      account.accessToken = dto.accessToken;
    }
    if (dto.refreshToken !== undefined) {
      account.refreshToken =
        dto.refreshToken && dto.refreshToken.length > 0
          ? dto.refreshToken
          : null;
    }
    if (dto.tokenExpiresAt !== undefined) {
      account.tokenExpiresAt = new Date(dto.tokenExpiresAt);
    }
    if (dto.channelId !== undefined) account.channelId = dto.channelId;

    return this.googleAccountRepo.save(account);
  }

  async findAll(): Promise<GoogleAccount[]> {
    return this.googleAccountRepo.find({
      order: { createdAt: 'DESC' },
    });
  }

  async findById(id: string): Promise<GoogleAccount> {
    const account = await this.googleAccountRepo.findOne({ where: { id } });
    if (!account) {
      throw new NotFoundException(`Google account ${id} not found`);
    }
    return account;
  }

  async remove(id: string): Promise<void> {
    const account = await this.findById(id);

    if (account.refreshToken) {
      try {
        const refreshToken = account.refreshToken;
        const clientSecret = account.clientSecret ?? undefined;
        const client = new google.auth.OAuth2(account.clientId, clientSecret);
        await client.revokeToken(refreshToken);
      } catch (err) {
        this.logger.warn(
          `Failed to revoke token for ${account.accountLabel}: ${err.message}`,
        );
      }
    }

    await this.googleAccountRepo.remove(account);
  }

  async verifyAccount(id: string): Promise<{
    ok: boolean;
    accountId: string;
    accountLabel: string;
    channelId: string | null;
    channelTitle: string | null;
    tokenExpiresAt: Date;
    checkedAt: string;
    error?: string;
  }> {
    const account = await this.findById(id);
    const auth = this.getAuthenticatedClient(account);
    const youtube = google.youtube({ version: 'v3', auth });

    try {
      const { data } = await youtube.channels.list({
        mine: true,
        part: ['id', 'snippet'],
      });

      const channel = data.items?.[0];
      if (!channel?.id) {
        return {
          ok: false,
          accountId: account.id,
          accountLabel: account.accountLabel,
          channelId: null,
          channelTitle: null,
          tokenExpiresAt: account.tokenExpiresAt,
          checkedAt: new Date().toISOString(),
          error: 'Token hợp lệ nhưng không đọc được channel từ YouTube API',
        };
      }

      if (account.channelId !== channel.id) {
        account.channelId = channel.id;
        await this.googleAccountRepo.save(account);
      }

      return {
        ok: true,
        accountId: account.id,
        accountLabel: account.accountLabel,
        channelId: channel.id,
        channelTitle: channel.snippet?.title || null,
        tokenExpiresAt: account.tokenExpiresAt,
        checkedAt: new Date().toISOString(),
      };
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : 'Verify account failed';
      return {
        ok: false,
        accountId: account.id,
        accountLabel: account.accountLabel,
        channelId: account.channelId,
        channelTitle: null,
        tokenExpiresAt: account.tokenExpiresAt,
        checkedAt: new Date().toISOString(),
        error: errorMessage,
      };
    }
  }

  getDecryptedTokens(account: GoogleAccount): {
    accessToken: string;
    refreshToken: string | null;
  } {
    return {
      accessToken: account.accessToken,
      refreshToken: account.refreshToken ?? null,
    };
  }

  getAuthenticatedClient(account: GoogleAccount) {
    const { accessToken, refreshToken } = this.getDecryptedTokens(account);
    const clientSecret = account.clientSecret ?? undefined;

    const client = new google.auth.OAuth2(account.clientId, clientSecret);
    client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken ?? undefined,
    });
    return client;
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async refreshExpiredTokens(): Promise<void> {
    const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);

    const accounts = await this.googleAccountRepo
      .createQueryBuilder('account')
      .where('account.status = :status', { status: GoogleAccountStatus.ACTIVE })
      .andWhere('account.tokenExpiresAt < :threshold', {
        threshold: fiveMinutesFromNow,
      })
      .getMany();

    for (const account of accounts) {
      if (!account.refreshToken) {
        this.logger.warn(
          `Skip refresh for ${account.accountLabel}: no refresh token stored`,
        );
        continue;
      }

      const clientSecret = account.clientSecret ?? null;
      if (!clientSecret) {
        this.logger.warn(
          `Skip refresh for ${account.accountLabel}: missing client secret in DB`,
        );
        continue;
      }

      try {
        const refreshToken = account.refreshToken;
        const client = new google.auth.OAuth2(account.clientId, clientSecret);
        client.setCredentials({ refresh_token: refreshToken });

        const { credentials } = await client.refreshAccessToken();
        if (!credentials.access_token) {
          throw new Error('Google did not return access token during refresh');
        }
        account.accessToken = credentials.access_token;
        account.tokenExpiresAt = new Date(
          credentials.expiry_date || Date.now() + 3600 * 1000,
        );
        account.status = GoogleAccountStatus.ACTIVE;

        await this.googleAccountRepo.save(account);
        this.logger.log(`Refreshed token for ${account.accountLabel}`);
      } catch (err) {
        this.logger.error(
          `Failed to refresh token for ${account.accountLabel}: ${err.message}`,
        );
        account.status = GoogleAccountStatus.EXPIRED;
        await this.googleAccountRepo.save(account);
      }
    }
  }
}
