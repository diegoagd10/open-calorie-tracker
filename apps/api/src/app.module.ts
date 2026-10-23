import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { DbModule } from './db/db.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [DbModule, UsersModule, AuthModule],
})
export class AppModule {}
