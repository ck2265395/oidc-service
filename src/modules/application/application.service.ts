import { Injectable } from '@nestjs/common';
import type { Request } from 'express';

import type { ServiceConfig } from '../../infrastructure/config/config.schema.js';
import type { ApplicationGroupService } from './domain/groups.js';
import type { ApplicationService } from './application/application-management.service.js';
import type { DeveloperStatus } from '../developer/domain/developer-identity.js';

export interface DeveloperAccessPort {
  authenticated(request: Request): Promise<{ id: string; status: DeveloperStatus } | null>;
  writeAllowed(request: Request): 'origin' | 'csrf' | true;
}

@Injectable()
export class ApplicationApiService {
  constructor(readonly config: ServiceConfig, readonly developer: DeveloperAccessPort, readonly applications: ApplicationService, readonly groups: ApplicationGroupService) {}
}
