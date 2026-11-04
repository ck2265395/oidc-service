import { randomUUID } from 'node:crypto';

import { Injectable, type OnModuleInit } from '@nestjs/common';

import type { RuntimeMode } from '../../../infrastructure/config/config.schema.js';
import { hashAdminPassword } from './admin-authentication.service.js';

interface BootstrapRepository { createLocalDefault(id: string, username: string, passwordHash: string): Promise<boolean>; }

@Injectable()
export class AdminBootstrapService implements OnModuleInit {
  constructor(private readonly mode: RuntimeMode, private readonly repository: BootstrapRepository, private readonly makeId: () => string = randomUUID) {}
  async onModuleInit(): Promise<void> {
    if (this.mode !== 'development') return;
    await this.repository.createLocalDefault(this.makeId(), 'admin', hashAdminPassword('123456'));
  }
}
