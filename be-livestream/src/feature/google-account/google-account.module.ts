import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GoogleAccount } from './entities/google-account.entity';
import { GoogleAccountController } from './google-account.controller';
import { GoogleAccountService } from './google-account.service';

@Module({
  imports: [TypeOrmModule.forFeature([GoogleAccount])],
  controllers: [GoogleAccountController],
  providers: [GoogleAccountService],
  exports: [GoogleAccountService],
})
export class GoogleAccountModule {}
