import type { PowerProjectCreateInput, PowerProjectCreateResult } from "./types.js";

export interface PowerProjectGateway {
  createProject(input: PowerProjectCreateInput): Promise<PowerProjectCreateResult>;
}

export class PowerProjectService {
  constructor(private readonly gateway: PowerProjectGateway) {}

  async createProject(input: PowerProjectCreateInput): Promise<PowerProjectCreateResult> {
    return await this.gateway.createProject(input);
  }
}
