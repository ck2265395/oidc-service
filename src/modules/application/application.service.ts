import { Injectable } from '@nestjs/common';
import type { Request } from 'express';

import type { ServiceConfig } from '../../config.js';
import type { ApplicationGroupService } from '../../groups.js';
import type { ApplicationService } from '../../platform.js';
import type { DeveloperStatus } from '../../developer-identity.js';

export interface DeveloperAccessPort {
  authenticated(request: Request): Promise<{ id: string; status: DeveloperStatus } | null>;
  writeAllowed(request: Request): 'origin' | 'csrf' | true;
}

@Injectable()
export class ApplicationApiService {
  constructor(readonly config: ServiceConfig, readonly developer: DeveloperAccessPort, readonly applications: ApplicationService, readonly groups: ApplicationGroupService) {}
}
