/**
 * Trade Proposal Service
 *
 * Handles CRUD operations for trade proposals.
 * Stores proposals in an encrypted JSON file per account.
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
  type TradeProposal,
  type StoredTradeProposal,
  type ProposalStatus,
  type TradeProposalValidationResult,
  TradeProposalSchema,
  validateTradeProposal,
} from '../types/trade-proposal.js';
import { encrypt, decrypt, type EncryptedData } from '../storage/encryption.js';

/**
 * Stored proposal file format
 */
interface TradeProposalFile {
  version: number;
  proposals: Record<string, EncryptedData>; // key = proposal id
  metadata: {
    createdAt: string;
    updatedAt: string;
  };
}

/**
 * Configuration options for TradeProposalService
 */
export interface TradeProposalServiceOptions {
  /** Directory to store trade proposal files */
  proposalDir?: string;
  /** Master password for encryption */
  masterPassword: string;
}

/**
 * Query options for listing proposals
 */
export interface ProposalQueryOptions {
  /** Filter by status */
  status?: ProposalStatus | ProposalStatus[];
  /** Filter by underlying symbol */
  underlying?: string;
  /** Limit number of results */
  limit?: number;
  /** Sort order (newest first by default) */
  sortOrder?: 'newest' | 'oldest';
}

const DEFAULT_PROPOSAL_DIR = '.config/trade-proposals';

/**
 * TradeProposalService - Manages trade proposals for user accounts
 */
export class TradeProposalService {
  private proposals: Map<string, StoredTradeProposal[]> = new Map(); // key = accountId
  private proposalDir: string;
  private masterPassword: string;
  private initialized: boolean = false;

  constructor(options: TradeProposalServiceOptions) {
    if (!options.masterPassword || options.masterPassword.length < 8) {
      throw new Error('Master password must be at least 8 characters');
    }
    this.masterPassword = options.masterPassword;
    this.proposalDir = options.proposalDir || DEFAULT_PROPOSAL_DIR;
  }

  /**
   * Initialize the service
   * - Creates proposal directory if needed
   * - Loads existing proposals
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Ensure proposal directory exists
    if (!fs.existsSync(this.proposalDir)) {
      fs.mkdirSync(this.proposalDir, { recursive: true, mode: 0o700 });
    }

    // Load existing proposal files
    await this.loadAllProposals();

    this.initialized = true;
  }

  // ===========================================================================
  // CRUD Operations
  // ===========================================================================

  /**
   * Create a new trade proposal
   */
  async createProposal(
    accountId: string,
    proposal: TradeProposal,
    options?: {
      createdBy?: string;
      status?: ProposalStatus;
      notes?: string;
    }
  ): Promise<StoredTradeProposal> {
    // Validate the proposal
    const validation = validateTradeProposal(proposal);
    if (!validation.valid) {
      throw new Error(`Invalid trade proposal: ${validation.errors.join(', ')}`);
    }

    const now = new Date();
    const storedProposal: StoredTradeProposal = {
      id: randomUUID(),
      accountId,
      proposal,
      status: options?.status ?? 'draft',
      createdAt: now,
      updatedAt: now,
      createdBy: options?.createdBy,
      notes: options?.notes,
    };

    // Add to memory
    const accountProposals = this.proposals.get(accountId) ?? [];
    accountProposals.push(storedProposal);
    this.proposals.set(accountId, accountProposals);

    // Persist
    await this.saveAccountProposals(accountId);

    return storedProposal;
  }

  /**
   * Get a proposal by ID
   */
  getProposal(accountId: string, proposalId: string): StoredTradeProposal | null {
    const accountProposals = this.proposals.get(accountId);
    if (!accountProposals) {
      return null;
    }
    return accountProposals.find((p) => p.id === proposalId) ?? null;
  }

  /**
   * Get all proposals for an account
   */
  getAllProposals(accountId: string, options?: ProposalQueryOptions): StoredTradeProposal[] {
    let proposals = this.proposals.get(accountId) ?? [];

    // Filter by status
    if (options?.status) {
      const statuses = Array.isArray(options.status) ? options.status : [options.status];
      proposals = proposals.filter((p) => statuses.includes(p.status));
    }

    // Filter by underlying
    if (options?.underlying) {
      proposals = proposals.filter((p) => p.proposal.underlying === options.underlying);
    }

    // Sort
    const sortOrder = options?.sortOrder ?? 'newest';
    proposals = [...proposals].sort((a, b) => {
      const diff = b.createdAt.getTime() - a.createdAt.getTime();
      return sortOrder === 'newest' ? diff : -diff;
    });

    // Limit
    if (options?.limit && options.limit > 0) {
      proposals = proposals.slice(0, options.limit);
    }

    return proposals;
  }

  /**
   * Get proposals by status
   */
  getProposalsByStatus(accountId: string, status: ProposalStatus): StoredTradeProposal[] {
    return this.getAllProposals(accountId, { status });
  }

  /**
   * Get the most recent draft proposals
   */
  getDraftProposals(accountId: string, limit?: number): StoredTradeProposal[] {
    return this.getAllProposals(accountId, { status: 'draft', limit });
  }

  /**
   * Update an existing proposal
   */
  async updateProposal(
    accountId: string,
    proposalId: string,
    updates: Partial<TradeProposal>
  ): Promise<StoredTradeProposal> {
    const accountProposals = this.proposals.get(accountId);
    if (!accountProposals) {
      throw new Error(`No proposals found for account ${accountId}`);
    }

    const proposalIndex = accountProposals.findIndex((p) => p.id === proposalId);
    const existingProposal = accountProposals[proposalIndex];
    if (proposalIndex === -1 || !existingProposal) {
      throw new Error(`Proposal ${proposalId} not found`);
    }

    // Cannot update executed proposals
    if (existingProposal.status === 'executed') {
      throw new Error('Cannot update an executed proposal');
    }

    const updatedTradeProposal: TradeProposal = {
      ...existingProposal.proposal,
      ...updates,
    };

    // Validate the updated proposal
    const validation = validateTradeProposal(updatedTradeProposal);
    if (!validation.valid) {
      throw new Error(`Invalid trade proposal: ${validation.errors.join(', ')}`);
    }

    const updatedStoredProposal: StoredTradeProposal = {
      ...existingProposal,
      proposal: updatedTradeProposal,
      updatedAt: new Date(),
    };

    // Update in memory
    accountProposals[proposalIndex] = updatedStoredProposal;

    // Persist
    await this.saveAccountProposals(accountId);

    return updatedStoredProposal;
  }

  /**
   * Update proposal status
   */
  async updateStatus(
    accountId: string,
    proposalId: string,
    status: ProposalStatus,
    options?: {
      executedOrderId?: string;
      rejectionReason?: string;
      notes?: string;
    }
  ): Promise<StoredTradeProposal> {
    const accountProposals = this.proposals.get(accountId);
    if (!accountProposals) {
      throw new Error(`No proposals found for account ${accountId}`);
    }

    const proposalIndex = accountProposals.findIndex((p) => p.id === proposalId);
    const existingProposal = accountProposals[proposalIndex];
    if (proposalIndex === -1 || !existingProposal) {
      throw new Error(`Proposal ${proposalId} not found`);
    }

    // Validate status transitions
    this.validateStatusTransition(existingProposal.status, status);

    const updatedStoredProposal: StoredTradeProposal = {
      ...existingProposal,
      status,
      updatedAt: new Date(),
    };

    // Add optional fields based on status
    if (status === 'executed' && options?.executedOrderId) {
      updatedStoredProposal.executedOrderId = options.executedOrderId;
    }
    if (status === 'rejected' && options?.rejectionReason) {
      updatedStoredProposal.rejectionReason = options.rejectionReason;
    }
    if (options?.notes) {
      updatedStoredProposal.notes = options.notes;
    }

    // Update in memory
    accountProposals[proposalIndex] = updatedStoredProposal;

    // Persist
    await this.saveAccountProposals(accountId);

    return updatedStoredProposal;
  }

  /**
   * Approve a proposal
   */
  async approveProposal(accountId: string, proposalId: string, notes?: string): Promise<StoredTradeProposal> {
    return this.updateStatus(accountId, proposalId, 'approved', { notes });
  }

  /**
   * Reject a proposal
   */
  async rejectProposal(
    accountId: string,
    proposalId: string,
    reason: string,
    notes?: string
  ): Promise<StoredTradeProposal> {
    return this.updateStatus(accountId, proposalId, 'rejected', { rejectionReason: reason, notes });
  }

  /**
   * Mark a proposal as executed
   */
  async markExecuted(
    accountId: string,
    proposalId: string,
    orderId: string,
    notes?: string
  ): Promise<StoredTradeProposal> {
    return this.updateStatus(accountId, proposalId, 'executed', { executedOrderId: orderId, notes });
  }

  /**
   * Delete a proposal
   * Only draft and rejected proposals can be deleted
   */
  async deleteProposal(accountId: string, proposalId: string): Promise<boolean> {
    const accountProposals = this.proposals.get(accountId);
    if (!accountProposals) {
      return false;
    }

    const proposalIndex = accountProposals.findIndex((p) => p.id === proposalId);
    const proposal = accountProposals[proposalIndex];
    if (proposalIndex === -1 || !proposal) {
      return false;
    }

    // Can only delete draft or rejected proposals
    if (proposal.status === 'approved' || proposal.status === 'executed') {
      throw new Error(`Cannot delete ${proposal.status} proposal - archive instead`);
    }

    // Remove from array
    accountProposals.splice(proposalIndex, 1);

    // Persist
    await this.saveAccountProposals(accountId);

    return true;
  }

  // ===========================================================================
  // Validation and Utilities
  // ===========================================================================

  /**
   * Validate a proposal without saving
   */
  validateProposal(proposal: unknown): TradeProposalValidationResult {
    return validateTradeProposal(proposal);
  }

  /**
   * Check if a proposal exists
   */
  hasProposal(accountId: string, proposalId: string): boolean {
    return this.getProposal(accountId, proposalId) !== null;
  }

  /**
   * Count proposals by status
   */
  countByStatus(accountId: string): Record<ProposalStatus, number> {
    const proposals = this.proposals.get(accountId) ?? [];
    return {
      draft: proposals.filter((p) => p.status === 'draft').length,
      approved: proposals.filter((p) => p.status === 'approved').length,
      rejected: proposals.filter((p) => p.status === 'rejected').length,
      executed: proposals.filter((p) => p.status === 'executed').length,
    };
  }

  /**
   * Get statistics for an account
   */
  getStatistics(accountId: string): {
    total: number;
    byStatus: Record<ProposalStatus, number>;
    byUnderlying: Record<string, number>;
  } {
    const proposals = this.proposals.get(accountId) ?? [];
    const byUnderlying: Record<string, number> = {};

    for (const p of proposals) {
      const underlying = p.proposal.underlying;
      byUnderlying[underlying] = (byUnderlying[underlying] ?? 0) + 1;
    }

    return {
      total: proposals.length,
      byStatus: this.countByStatus(accountId),
      byUnderlying,
    };
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private validateStatusTransition(currentStatus: ProposalStatus, newStatus: ProposalStatus): void {
    // Define valid transitions
    const validTransitions: Record<ProposalStatus, ProposalStatus[]> = {
      draft: ['approved', 'rejected'],
      approved: ['executed', 'rejected'],
      rejected: ['draft'], // Can re-draft a rejected proposal
      executed: [], // Terminal state
    };

    const allowed = validTransitions[currentStatus];
    if (!allowed?.includes(newStatus)) {
      throw new Error(`Invalid status transition: ${currentStatus} -> ${newStatus}`);
    }
  }

  private getProposalFilePath(accountId: string): string {
    // Sanitize accountId for filename
    const safeAccountId = accountId.replace(/[^a-zA-Z0-9-_]/g, '_');
    return path.join(this.proposalDir, `trade-proposals-${safeAccountId}.json`);
  }

  private async loadAllProposals(): Promise<void> {
    if (!fs.existsSync(this.proposalDir)) {
      return;
    }

    const files = fs.readdirSync(this.proposalDir);
    for (const file of files) {
      if (file.startsWith('trade-proposals-') && file.endsWith('.json')) {
        await this.loadProposalFile(path.join(this.proposalDir, file));
      }
    }
  }

  private async loadProposalFile(filePath: string): Promise<void> {
    try {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const proposalFile: TradeProposalFile = JSON.parse(fileContent);

      for (const [proposalId, encryptedData] of Object.entries(proposalFile.proposals)) {
        try {
          const decrypted = decrypt(encryptedData, this.masterPassword);
          const storedProposal = JSON.parse(decrypted) as StoredTradeProposal;

          // Convert date strings back to Date objects
          storedProposal.createdAt = new Date(storedProposal.createdAt);
          storedProposal.updatedAt = new Date(storedProposal.updatedAt);

          // Convert contract expiration dates
          for (const contract of storedProposal.proposal.contracts) {
            contract.expiration = new Date(contract.expiration);
          }

          // Convert data source dates
          for (const dataSource of storedProposal.proposal.dataUsed) {
            dataSource.retrievedAt = new Date(dataSource.retrievedAt);
          }

          const accountId = storedProposal.accountId;

          // Add to proposals map
          const accountProposals = this.proposals.get(accountId) ?? [];
          accountProposals.push(storedProposal);
          this.proposals.set(accountId, accountProposals);
        } catch {
          console.error(`Failed to decrypt proposal ${proposalId}`);
        }
      }
    } catch {
      console.error(`Failed to load proposal file ${filePath}`);
    }
  }

  private async saveAccountProposals(accountId: string): Promise<void> {
    const accountProposals = this.proposals.get(accountId);
    if (!accountProposals || accountProposals.length === 0) {
      // Delete file if no proposals
      const filePath = this.getProposalFilePath(accountId);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      return;
    }

    const proposalFile: TradeProposalFile = {
      version: 1,
      proposals: {},
      metadata: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    };

    for (const proposal of accountProposals) {
      const plaintext = JSON.stringify(proposal);
      proposalFile.proposals[proposal.id] = encrypt(plaintext, this.masterPassword);
    }

    const filePath = this.getProposalFilePath(accountId);

    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    // Write with restrictive permissions using temp file
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(proposalFile, null, 2), {
      mode: 0o600,
    });
    fs.renameSync(tempPath, filePath);
  }

  /**
   * Clear all in-memory data (for shutdown/testing)
   */
  clearMemory(): void {
    this.proposals.clear();
    this.initialized = false;
  }
}

/**
 * Create TradeProposalService from environment variables
 */
export async function createTradeProposalServiceFromEnv(
  masterPasswordEnvVar: string = 'SECRETS_MASTER_PASSWORD',
  proposalDirEnvVar: string = 'TRADE_PROPOSAL_DIR'
): Promise<TradeProposalService> {
  const masterPassword = process.env[masterPasswordEnvVar];

  if (!masterPassword) {
    throw new Error(
      `Master password not found. Set the ${masterPasswordEnvVar} environment variable.`
    );
  }

  const proposalDir = process.env[proposalDirEnvVar] || DEFAULT_PROPOSAL_DIR;

  const service = new TradeProposalService({
    masterPassword,
    proposalDir,
  });

  await service.initialize();

  return service;
}
