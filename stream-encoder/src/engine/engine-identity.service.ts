import { Injectable } from '@nestjs/common';
import { resolveEngineNodeIdentity } from './engine-node-identity';

@Injectable()
export class EngineIdentityService {
  readonly nodeId: string;

  constructor() {
    this.nodeId = resolveEngineNodeIdentity();
  }
}
