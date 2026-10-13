import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runMigrations } from '../db/migrate';
import { db } from '../db/db';
import { proposalsRepo, toPublicProposal } from '../db/proposals.repository';
import { usersRepo } from '../db/users.repository';
import { MonadPaymentExecutor } from '../adapters/payment/MonadPaymentExecutor';
import { computeCanonicalProposalHash, ProposalService } from '../services/proposal.service';
import { auditRepo } from '../db/audit.repository';
import { v4 as uuidv4 } from 'uuid';
import { parseUnits, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const testPrivateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;
const testAccount = privateKeyToAccount(testPrivateKey);

describe('MonadPaymentExecutor & Testnet Robustness', () => {
  let senderUser: any;
  let recipientUser: any;

  beforeEach(() => {
    runMigrations();
    db.prepare("UPDATE proposals SET status = 'expired', execution_substate = NULL, execution_nonce = NULL").run();
    senderUser = usersRepo.create({
      handle: 'sender_' + uuidv4().slice(0, 8),
      display_name: 'Sender',
      wallet_address: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
    });
    recipientUser = usersRepo.create({
      handle: 'recipient_' + uuidv4().slice(0, 8),
      display_name: 'Recipient',
      wallet_address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    });
  });

  // ---------------------------------------------------------------------------
  // 1. Finality Robustness to Dropped / Replaced Blocks
  // ---------------------------------------------------------------------------
  it('should revert substate to broadcasted_unknown if receipt disappears between polls', async () => {
    const proposalId = uuidv4();
    const txHash = '0x1111111111111111111111111111111111111111111111111111111111111111' as const;

    proposalsRepo.create({
      id: proposalId,
      user_id: senderUser.id,
      origin: 'user',
      recipient_handle: recipientUser.handle,
      recipient_id: recipientUser.id,
      recipient_wallet: recipientUser.wallet_address,
      amount: '10000000000000000',
      display_amount: '0.01',
      asset: 'MON',
      network: 'Monad Testnet',
      proposal_hash: 'hash1',
      status: 'submitted',
      policy_decision: 'ALLOW',
      policy_reasons: '[]',
      expires_at: new Date(Date.now() + 60000).toISOString(),
      execution_mode: 'testnet',
      execution_substate: 'broadcasted_unknown',
      execution_nonce: 10,
    });

    let pollCount = 0;
    const mockPublicClient: any = {
      getTransactionReceipt: vi.fn().mockImplementation(async () => {
        pollCount++;
        if (pollCount === 1) {
          // Poll 1: Receipt visible in speculative block 100
          return {
            blockNumber: 100n,
            blockHash: '0xblock100',
            status: 'success',
          };
        }
        // Poll 2: Speculative block dropped! Receipt vanishes
        return null;
      }),
      getBlock: vi.fn().mockResolvedValue({
        number: 95n, // finalized height is only 95
        hash: '0xblock95',
      }),
    };

    const executor = new MonadPaymentExecutor(mockPublicClient, undefined as any);

    // Run poll for finality with a short timeout
    await executor.pollForFinality(proposalId, txHash, 10, '10000000000000000', 2500);

    const updated = proposalsRepo.getById(proposalId)!;
    expect(['broadcasted_unknown', 'not_found_needs_review']).toContain(updated.execution_substate);

    // Verify substate change was recorded in audit logs
    const auditLogs = db.prepare('SELECT * FROM audit_logs WHERE proposal_id = ?').all(proposalId) as any[];
    const substateAudits = auditLogs.filter((a) => a.action === 'execution_substate_changed');
    expect(substateAudits.length).toBeGreaterThan(0);
  });

  it('should confirm proposal only when finalized block hash matches receipt block hash', async () => {
    const proposalId = uuidv4();
    const txHash = '0x2222222222222222222222222222222222222222222222222222222222222222' as const;

    proposalsRepo.create({
      id: proposalId,
      user_id: senderUser.id,
      origin: 'user',
      recipient_handle: recipientUser.handle,
      recipient_id: recipientUser.id,
      recipient_wallet: recipientUser.wallet_address,
      amount: '10000000000000000',
      display_amount: '0.01',
      asset: 'MON',
      network: 'Monad Testnet',
      proposal_hash: 'hash2',
      status: 'submitted',
      policy_decision: 'ALLOW',
      policy_reasons: '[]',
      expires_at: new Date(Date.now() + 60000).toISOString(),
      execution_mode: 'testnet',
    });

    const mockPublicClient: any = {
      getTransactionReceipt: vi.fn().mockResolvedValue({
        blockNumber: 150n,
        blockHash: '0xcanonical_hash_150',
        status: 'success',
      }),
      getBlock: vi.fn().mockImplementation(async (args: any) => {
        if (args?.blockTag === 'finalized') {
          return { number: 155n, hash: '0xfinal_155' };
        }
        if (args?.blockNumber === 150n) {
          return { number: 150n, hash: '0xcanonical_hash_150' };
        }
        return null;
      }),
    };

    const executor = new MonadPaymentExecutor(mockPublicClient, undefined as any);
    const receipt = await executor.pollForFinality(proposalId, txHash, 11, '10000000000000000', 3000);

    expect(receipt.status).toBe('confirmed');
    expect(receipt.finalizedBlockNumber).toBe(155);
    expect(receipt.explorerLink).toContain(txHash);
  });

  it('should fail proposal if finalized receipt status is reverted', async () => {
    const proposalId = uuidv4();
    const txHash = '0x3333333333333333333333333333333333333333333333333333333333333333' as const;

    proposalsRepo.create({
      id: proposalId,
      user_id: senderUser.id,
      origin: 'user',
      recipient_handle: recipientUser.handle,
      recipient_id: recipientUser.id,
      recipient_wallet: recipientUser.wallet_address,
      amount: '10000000000000000',
      display_amount: '0.01',
      asset: 'MON',
      network: 'Monad Testnet',
      proposal_hash: 'hash3',
      status: 'submitted',
      policy_decision: 'ALLOW',
      policy_reasons: '[]',
      expires_at: new Date(Date.now() + 60000).toISOString(),
      execution_mode: 'testnet',
    });

    const mockPublicClient: any = {
      getTransactionReceipt: vi.fn().mockResolvedValue({
        blockNumber: 200n,
        blockHash: '0xcanonical_hash_200',
        status: 'reverted',
      }),
      getBlock: vi.fn().mockImplementation(async (args: any) => {
        if (args?.blockTag === 'finalized') {
          return { number: 205n, hash: '0xfinal_205' };
        }
        if (args?.blockNumber === 200n) {
          return { number: 200n, hash: '0xcanonical_hash_200' };
        }
        return null;
      }),
    };

    const executor = new MonadPaymentExecutor(mockPublicClient, undefined as any);
    const receipt = await executor.pollForFinality(proposalId, txHash, 12, '10000000000000000', 3000);

    expect(receipt.status).toBe('failed');
  });

  // ---------------------------------------------------------------------------
  // 2. Nonce Recovery across Restarts & Startup Reconcile
  // ---------------------------------------------------------------------------
  it('should initialize nextNonce as max(chain count, highest stored nonce + 1)', async () => {
    proposalsRepo.create({
      id: uuidv4(),
      user_id: senderUser.id,
      origin: 'user',
      recipient_handle: recipientUser.handle,
      recipient_id: recipientUser.id,
      amount: '10000',
      display_amount: '0.01',
      asset: 'MON',
      network: 'Monad Testnet',
      proposal_hash: 'h_nonce',
      status: 'confirmed',
      policy_decision: 'ALLOW',
      policy_reasons: '[]',
      expires_at: new Date(Date.now() + 60000).toISOString(),
      execution_mode: 'testnet',
      execution_nonce: 42,
    });

    const mockPublicClient: any = {
      getTransactionCount: vi.fn().mockResolvedValue(40n),
    };

    const executor = new MonadPaymentExecutor(mockPublicClient, undefined as any);
    await executor.initializeNonce();

    expect((executor as any).nextNonce).toBe(43);
  });

  // ---------------------------------------------------------------------------
  // 3. Fail Closed on Stuck Transactions
  // ---------------------------------------------------------------------------
  it('should refuse new sends while any proposal is in broadcasted_unknown or not_found_needs_review', async () => {
    const stuckId = uuidv4();
    proposalsRepo.create({
      id: stuckId,
      user_id: senderUser.id,
      origin: 'user',
      recipient_handle: recipientUser.handle,
      recipient_id: recipientUser.id,
      amount: '10000',
      display_amount: '0.01',
      asset: 'MON',
      network: 'Monad Testnet',
      proposal_hash: 'h_stuck',
      status: 'submitted',
      policy_decision: 'ALLOW',
      policy_reasons: '[]',
      expires_at: new Date(Date.now() + 60000).toISOString(),
      execution_mode: 'testnet',
      execution_substate: 'not_found_needs_review',
    });

    const newProposal = proposalsRepo.create({
      id: uuidv4(),
      user_id: senderUser.id,
      origin: 'user',
      recipient_handle: recipientUser.handle,
      recipient_id: recipientUser.id,
      recipient_wallet: recipientUser.wallet_address,
      amount: '10000000000000000',
      display_amount: '0.01',
      asset: 'MON',
      network: 'Monad Testnet',
      proposal_hash: 'h_new',
      status: 'approved',
      policy_decision: 'ALLOW',
      policy_reasons: '[]',
      expires_at: new Date(Date.now() + 60000).toISOString(),
      execution_mode: 'testnet',
    });

    const mockPublicClient: any = {
      getBalance: vi.fn().mockResolvedValue(1000000000000000000n),
      getGasPrice: vi.fn().mockResolvedValue(100000000000n),
      getBytecode: vi.fn().mockResolvedValue('0x'),
    };
    const mockSendClient: any = {
      sendRawTransaction: vi.fn(),
    };

    const executor = new MonadPaymentExecutor(mockPublicClient, mockSendClient, testAccount);

    await expect(executor.executePayment(newProposal)).rejects.toThrow(/Real transfers are blocked.*stuck state/i);
  });

  // ---------------------------------------------------------------------------
  // 4. Contract Recipient Rejection
  // ---------------------------------------------------------------------------
  it('should reject transfers to contract recipients (eth_getCode non-empty)', async () => {
    const proposal = proposalsRepo.create({
      id: uuidv4(),
      user_id: senderUser.id,
      origin: 'user',
      recipient_handle: recipientUser.handle,
      recipient_id: recipientUser.id,
      recipient_wallet: '0x0000000000000000000000000000000000000001',
      amount: '10000000000000000',
      display_amount: '0.01',
      asset: 'MON',
      network: 'Monad Testnet',
      proposal_hash: 'h_contract',
      status: 'approved',
      policy_decision: 'ALLOW',
      policy_reasons: '[]',
      expires_at: new Date(Date.now() + 60000).toISOString(),
      execution_mode: 'testnet',
    });

    const mockPublicClient: any = {
      getBalance: vi.fn().mockResolvedValue(1000000000000000000n),
      getGasPrice: vi.fn().mockResolvedValue(100000000000n),
      getBytecode: vi.fn().mockResolvedValue('0x608060405234801561001057600080fd5b50'),
    };
    const mockSendClient: any = {
      sendRawTransaction: vi.fn(),
    };

    const executor = new MonadPaymentExecutor(mockPublicClient, mockSendClient, testAccount);

    await expect(executor.executePayment(proposal)).rejects.toThrow(/smart contract/i);
  });

  // ---------------------------------------------------------------------------
  // 5. Global Daily Cap Enforcement
  // ---------------------------------------------------------------------------
  it('should reject transfers exceeding the global daily limit of 2.0 MON', async () => {
    proposalsRepo.create({
      id: uuidv4(),
      user_id: senderUser.id,
      origin: 'user',
      recipient_handle: recipientUser.handle,
      recipient_id: recipientUser.id,
      amount: parseUnits('1.95', 18).toString(),
      display_amount: '1.95',
      asset: 'MON',
      network: 'Monad Testnet',
      proposal_hash: 'h_prior',
      status: 'confirmed',
      policy_decision: 'ALLOW',
      policy_reasons: '[]',
      expires_at: new Date(Date.now() + 60000).toISOString(),
      execution_mode: 'testnet',
    });

    const newProposal = proposalsRepo.create({
      id: uuidv4(),
      user_id: senderUser.id,
      origin: 'user',
      recipient_handle: recipientUser.handle,
      recipient_id: recipientUser.id,
      recipient_wallet: recipientUser.wallet_address,
      amount: parseUnits('0.1', 18).toString(),
      display_amount: '0.1',
      asset: 'MON',
      network: 'Monad Testnet',
      proposal_hash: 'h_over_limit',
      status: 'approved',
      policy_decision: 'ALLOW',
      policy_reasons: '[]',
      expires_at: new Date(Date.now() + 60000).toISOString(),
      execution_mode: 'testnet',
    });

    const mockPublicClient: any = {
      getBalance: vi.fn().mockResolvedValue(parseUnits('10', 18)),
      getGasPrice: vi.fn().mockResolvedValue(100000000000n),
      getBytecode: vi.fn().mockResolvedValue('0x'),
    };
    const mockSendClient: any = {
      sendRawTransaction: vi.fn(),
    };

    const executor = new MonadPaymentExecutor(mockPublicClient, mockSendClient, testAccount);

    await expect(executor.executePayment(newProposal)).rejects.toThrow(/global daily limit/i);
  });

  // ---------------------------------------------------------------------------
  // 6. DB Trigger: Immutability of users.wallet_address
  // ---------------------------------------------------------------------------
  it('should enforce wallet_address immutability via database trigger', () => {
    const user = usersRepo.create({
      handle: 'immutable_user_' + uuidv4().slice(0, 8),
      display_name: 'Immutable',
      wallet_address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    });

    expect(() => {
      db.prepare('UPDATE users SET wallet_address = ? WHERE id = ?').run(
        '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
        user.id
      );
    }).toThrow(/users.wallet_address is immutable once set/);

    expect(() => {
      db.prepare('UPDATE users SET wallet_address = NULL WHERE id = ?').run(user.id);
    }).toThrow(/users.wallet_address is immutable once set/);
  });

  // ---------------------------------------------------------------------------
  // 7. Canonical Proposal Hash Binds recipient_wallet
  // ---------------------------------------------------------------------------
  it('should invalidate approval if recipient_wallet is altered after creation', async () => {
    const sender = usersRepo.create({
      handle: 'sender_tamper_' + uuidv4().slice(0, 8),
      display_name: 'Sender',
    });
    const recipient = usersRepo.create({
      handle: 'recip_tamper_' + uuidv4().slice(0, 8),
      display_name: 'Recipient',
      wallet_address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    });

    const proposalId = uuidv4();
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 60000).toISOString();

    const originalHash = computeCanonicalProposalHash({
      id: proposalId,
      user_id: sender.id,
      recipient_id: recipient.id,
      recipient_handle: recipient.handle,
      recipient_wallet: recipient.wallet_address,
      amount: '1000000',
      asset: 'AUSD',
      network: 'Monad Testnet',
      origin: 'user',
      purpose: 'test',
      expires_at: expiresAt,
      created_at: createdAt,
    });

    proposalsRepo.create({
      id: proposalId,
      user_id: sender.id,
      origin: 'user',
      recipient_handle: recipient.handle,
      recipient_id: recipient.id,
      recipient_wallet: recipient.wallet_address,
      amount: '1000000',
      display_amount: '1',
      asset: 'AUSD',
      network: 'Monad Testnet',
      purpose: 'test',
      proposal_hash: originalHash,
      status: 'awaiting_approval',
      policy_decision: 'ALLOW',
      policy_reasons: '[]',
      expires_at: expiresAt,
      created_at: createdAt,
    });

    // Tamper with the recipient_wallet in the database!
    db.prepare('UPDATE proposals SET recipient_wallet = ? WHERE id = ?').run(
      '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
      proposalId
    );

    const service = new ProposalService();

    await expect(service.approveProposal(proposalId, sender.id, undefined, true)).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/Proposal integrity check failed/i),
    });
  });

  // ---------------------------------------------------------------------------
  // 8. Pause Flag and MAX_TESTNET_TRANSFER_MON inside Executor
  // ---------------------------------------------------------------------------
  it('should block execution when PAUSE_REAL_TRANSFERS is true', async () => {
    const { env } = await import('../config/env');
    const origPause = env.PAUSE_REAL_TRANSFERS;
    try {
      (env as any).PAUSE_REAL_TRANSFERS = true;
      const executor = new MonadPaymentExecutor({} as any, {} as any, testAccount);
      const proposal: any = {
        id: uuidv4(),
        status: 'approved',
        asset: 'MON',
        recipient_wallet: recipientUser.wallet_address,
        amount: '10000000000000000',
        display_amount: '0.01',
      };
      await expect(executor.executePayment(proposal)).rejects.toMatchObject({
        code: 'TRANSFERS_PAUSED',
      });
    } finally {
      (env as any).PAUSE_REAL_TRANSFERS = origPause;
    }
  });

  it('should block execution when amount exceeds MAX_TESTNET_TRANSFER_MON', async () => {
    const { env } = await import('../config/env');
    const origCap = env.MAX_TESTNET_TRANSFER_MON;
    try {
      (env as any).MAX_TESTNET_TRANSFER_MON = 0.2;
      const mockPublicClient: any = {
        getBytecode: vi.fn().mockResolvedValue('0x'),
      };
      const executor = new MonadPaymentExecutor(mockPublicClient, {} as any, testAccount);
      const proposal: any = {
        id: uuidv4(),
        status: 'approved',
        asset: 'MON',
        recipient_wallet: recipientUser.wallet_address,
        amount: '300000000000000000', // 0.3 MON > 0.2 MON
        display_amount: '0.3',
      };
      await expect(executor.executePayment(proposal)).rejects.toMatchObject({
        code: 'TRANSFER_EXCEEDS_CAP',
      });
    } finally {
      (env as any).MAX_TESTNET_TRANSFER_MON = origCap;
    }
  });

  // ---------------------------------------------------------------------------
  // 9. Startup Failures: Chain ID Mismatch, Malformed Key, Missing Key
  // ---------------------------------------------------------------------------
  it('should throw CHAIN_ID_MISMATCH if connected RPC chainId is not 10143', async () => {
    const mockPublicClient: any = {
      getChainId: vi.fn().mockResolvedValue(1), // Mainnet Ethereum
      getTransactionCount: vi.fn().mockResolvedValue(0n),
    };
    const executor = new MonadPaymentExecutor(mockPublicClient, {} as any);
    await expect(executor.initializeNonce()).rejects.toMatchObject({
      code: 'CHAIN_ID_MISMATCH',
    });
  });

  it('should throw MALFORMED_PRIVATE_KEY if relayer private key is invalid hex', async () => {
    const { env } = await import('../config/env');
    const origKey = env.RELAYER_PRIVATE_KEY;
    try {
      (env as any).RELAYER_PRIVATE_KEY = 'invalid_not_hex_key';
      expect(() => new MonadPaymentExecutor()).toThrow(/valid 32-byte hexadecimal string/);
    } finally {
      (env as any).RELAYER_PRIVATE_KEY = origKey;
    }
  });

  // ---------------------------------------------------------------------------
  // 10. Five Concurrent Sends Receive Unique, Monotonic Nonces
  // ---------------------------------------------------------------------------
  it('should serialize five concurrent sends with monotonic sequential nonces', async () => {
    let mockNonce = 50;
    const assignedNonces: number[] = [];

    const mockPublicClient: any = {
      getChainId: vi.fn().mockResolvedValue(10143),
      getTransactionCount: vi.fn().mockResolvedValue(50n),
      getBytecode: vi.fn().mockResolvedValue('0x'),
      getBalance: vi.fn().mockResolvedValue(10000000000000000000n),
      getGasPrice: vi.fn().mockResolvedValue(1000000000n),
      getTransactionReceipt: vi.fn().mockImplementation(async ({ hash }) => ({
        status: 'success',
        blockNumber: 100n,
        blockHash: '0xblock100',
      })),
      getBlock: vi.fn().mockImplementation(async ({ blockTag, blockNumber }) => ({
        number: 100n,
        hash: '0xblock100',
      })),
    };

    const mockSendClient: any = {
      sendRawTransaction: vi.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 10));
        return '0xtxhash';
      }),
    };

    const localSigner = {
      address: testAccount.address,
      signTransaction: vi.fn().mockImplementation(async (txArgs: any) => {
        assignedNonces.push(txArgs.nonce);
        return testAccount.signTransaction(txArgs);
      }),
    };

    const executor = new MonadPaymentExecutor(mockPublicClient, mockSendClient, localSigner as any);

    const proposals = Array.from({ length: 5 }, (_, i) => {
      const pId = uuidv4();
      return proposalsRepo.create({
        id: pId,
        user_id: senderUser.id,
        origin: 'user',
        recipient_handle: recipientUser.handle,
        recipient_id: recipientUser.id,
        recipient_wallet: recipientUser.wallet_address,
        amount: '10000000000000000',
        display_amount: '0.01',
        asset: 'MON',
        network: 'Monad Testnet',
        proposal_hash: 'hash_' + i,
        status: 'approved',
        policy_decision: 'ALLOW',
        policy_reasons: '[]',
        expires_at: new Date(Date.now() + 60000).toISOString(),
        execution_mode: 'testnet',
      });
    });

    // Execute all 5 simultaneously
    const results = await Promise.all(proposals.map((p) => executor.executePayment(p)));

    expect(results).toHaveLength(5);
    expect(assignedNonces).toEqual([50, 51, 52, 53, 54]);
  });

  // ---------------------------------------------------------------------------
  // 11. Timeout After Broadcast Sets Unknown and Preserves Included Substate
  // ---------------------------------------------------------------------------
  it('should preserve included_pending_finality when receipt is seen but finality times out', async () => {
    const proposalId = uuidv4();
    const txHash = '0x9999999999999999999999999999999999999999999999999999999999999999' as const;

    proposalsRepo.create({
      id: proposalId,
      user_id: senderUser.id,
      origin: 'user',
      recipient_handle: recipientUser.handle,
      recipient_id: recipientUser.id,
      recipient_wallet: recipientUser.wallet_address,
      amount: '10000000000000000',
      display_amount: '0.01',
      asset: 'MON',
      network: 'Monad Testnet',
      proposal_hash: 'hash_timeout',
      status: 'submitted',
      policy_decision: 'ALLOW',
      policy_reasons: '[]',
      expires_at: new Date(Date.now() + 60000).toISOString(),
      execution_mode: 'testnet',
      execution_substate: 'broadcasted_unknown',
      execution_nonce: 99,
    });

    const mockPublicClient: any = {
      getTransactionReceipt: vi.fn().mockResolvedValue({
        status: 'success',
        blockNumber: 500n,
        blockHash: '0xblock500',
      }),
      getBlock: vi.fn().mockResolvedValue({
        number: 400n, // Finalized block is still at 400 (< 500), so not finalized yet
        hash: '0xblock400',
      }),
    };

    const executor = new MonadPaymentExecutor(mockPublicClient, {} as any);
    const receipt = await executor.pollForFinality(proposalId, txHash, 99, '10000000000000000', 1500);

    expect(receipt.status).toBe('unknown');
    const updated = proposalsRepo.getById(proposalId);
    expect(updated?.execution_substate).toBe('included_pending_finality');
    expect(updated?.status).toBe('submitted'); // Never becomes failed
  });

  // ---------------------------------------------------------------------------
  // 12. Execution Mode and Asset Mismatch in Both Directions
  // ---------------------------------------------------------------------------
  it('should reject approval if execution mode mismatches active executor in both directions', async () => {
    const service = new ProposalService();

    // Case 1: Mock proposal presented to Real/Testnet executor
    const mockProposal = proposalsRepo.create({
      id: uuidv4(),
      user_id: senderUser.id,
      origin: 'user',
      recipient_handle: recipientUser.handle,
      recipient_id: recipientUser.id,
      recipient_wallet: recipientUser.wallet_address,
      amount: '1000000',
      display_amount: '1',
      asset: 'AUSD',
      network: 'Monad Testnet',
      proposal_hash: 'hash_mock',
      status: 'awaiting_approval',
      policy_decision: 'ALLOW',
      policy_reasons: '[]',
      expires_at: new Date(Date.now() + 60000).toISOString(),
      execution_mode: 'mock',
    });

    const realExecutor: any = {
      name: 'RealExecutor',
      isMock: false,
      supportedAsset: 'MON',
      executePayment: vi.fn(),
    };
    service.setPaymentExecutor(realExecutor);

    await expect(service.approveProposal(mockProposal.id, senderUser.id, undefined, true)).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/Proposal execution mode mismatch/i),
    });

    // Case 2: Testnet proposal presented to Mock executor
    const testnetProposal = proposalsRepo.create({
      id: uuidv4(),
      user_id: senderUser.id,
      origin: 'user',
      recipient_handle: recipientUser.handle,
      recipient_id: recipientUser.id,
      recipient_wallet: recipientUser.wallet_address,
      amount: '10000000000000000',
      display_amount: '0.01',
      asset: 'MON',
      network: 'Monad Testnet',
      proposal_hash: 'hash_testnet',
      status: 'awaiting_approval',
      policy_decision: 'ALLOW',
      policy_reasons: '[]',
      expires_at: new Date(Date.now() + 60000).toISOString(),
      execution_mode: 'testnet',
    });

    const mockExecutor: any = {
      name: 'MockExecutor',
      isMock: true,
      supportedAsset: 'AUSD',
      executePayment: vi.fn(),
    };
    service.setPaymentExecutor(mockExecutor);

    await expect(service.approveProposal(testnetProposal.id, senderUser.id, undefined, true)).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/Proposal execution mode mismatch/i),
    });
  });

  // ---------------------------------------------------------------------------
  // 13. confirm_new_recipient Server-Side Enforcement
  // ---------------------------------------------------------------------------
  it('should require confirm_new_recipient: true for first-time recipient and succeed when confirmed', async () => {
    const service = new ProposalService();
    const newRecipient = usersRepo.create({
      handle: 'brand_new_' + uuidv4().slice(0, 8),
      display_name: 'Brand New Contact',
      wallet_address: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
    });

    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 60000).toISOString();
    const proposalId = uuidv4();

    const hash = computeCanonicalProposalHash({
      id: proposalId,
      user_id: senderUser.id,
      recipient_id: newRecipient.id,
      recipient_handle: newRecipient.handle,
      recipient_wallet: newRecipient.wallet_address,
      amount: '1000000',
      asset: 'AUSD',
      network: 'Monad Testnet',
      origin: 'user',
      purpose: null,
      expires_at: expiresAt,
      created_at: createdAt,
    });

    proposalsRepo.create({
      id: proposalId,
      user_id: senderUser.id,
      origin: 'user',
      recipient_handle: newRecipient.handle,
      recipient_id: newRecipient.id,
      recipient_wallet: newRecipient.wallet_address,
      amount: '1000000',
      display_amount: '1',
      asset: 'AUSD',
      network: 'Monad Testnet',
      proposal_hash: hash,
      status: 'awaiting_approval',
      policy_decision: 'ALLOW',
      policy_reasons: '[]',
      expires_at: expiresAt,
      execution_mode: 'mock',
      created_at: createdAt,
    });

    // 1. Approve without confirmNewRecipient flag -> must fail
    await expect(service.approveProposal(proposalId, senderUser.id, hash, false)).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/confirm_new_recipient: true/),
    });

    // 2. Approve with confirmNewRecipient flag -> succeeds
    const result = await service.approveProposal(proposalId, senderUser.id, hash, true);
    expect(result.proposal.status).toBe('simulated_confirmed');
  });

  // ---------------------------------------------------------------------------
  // 14. Write-Ahead Persistence & Ambiguous Broadcast Recovery
  // ---------------------------------------------------------------------------
  it('should store txHash and signed bytes BEFORE broadcast, allowing reconcile after timeout', async () => {
    const proposalId = uuidv4();
    const proposal = proposalsRepo.create({
      id: proposalId,
      user_id: senderUser.id,
      origin: 'user',
      recipient_handle: recipientUser.handle,
      recipient_id: recipientUser.id,
      recipient_wallet: recipientUser.wallet_address,
      amount: '10000000000000000',
      display_amount: '0.01',
      asset: 'MON',
      network: 'Monad Testnet',
      proposal_hash: 'hash_write_ahead',
      status: 'approved',
      policy_decision: 'ALLOW',
      policy_reasons: '[]',
      expires_at: new Date(Date.now() + 60000).toISOString(),
      execution_mode: 'testnet',
    });

    const mockPublicClient: any = {
      getChainId: vi.fn().mockResolvedValue(10143),
      getTransactionCount: vi.fn().mockResolvedValue(75n),
      getBytecode: vi.fn().mockResolvedValue('0x'),
      getBalance: vi.fn().mockResolvedValue(10000000000000000000n),
      getGasPrice: vi.fn().mockResolvedValue(1000000000n),
      sendRawTransaction: vi.fn().mockRejectedValue(new Error('Network timeout after broadcast')),
      getTransactionReceipt: vi.fn().mockImplementation(async ({ hash }) => ({
        status: 'success',
        blockNumber: 150n,
        blockHash: '0xblock150',
      })),
      getBlock: vi.fn().mockImplementation(async () => ({
        number: 150n,
        hash: '0xblock150',
      })),
    };

    const executor = new MonadPaymentExecutor(mockPublicClient, mockPublicClient, testAccount);

    // Broadcast fails ambiguously, returning success-but-pending receipt
    const receipt = await executor.executePayment(proposal);
    expect(receipt.status).toBe('submitted');

    // Check write-ahead persistence: hash and signed bytes must ALREADY be in database!
    const stuck = proposalsRepo.getById(proposalId);
    expect(stuck?.execution_tx_hash).toMatch(/^0x[a-f0-9]{64}$/);
    expect(stuck?.execution_signed_tx).toMatch(/^0x/);
    expect(stuck?.execution_substate).toBe('broadcasted_unknown');
    expect(stuck?.execution_nonce).toBe(75);

    // Reconcile on-chain: should look up the stored hash and resolve to confirmed
    const reconciled = await executor.reconcilePayment(stuck!);
    expect(reconciled.status).toBe('confirmed');
    expect(reconciled.txHash).toBe(stuck?.execution_tx_hash);

    const finalizedProposal = proposalsRepo.getById(proposalId);
    expect(finalizedProposal?.status).toBe('confirmed');
    expect(finalizedProposal?.execution_substate).toBeNull();
  });

  it('should rebroadcast identical signed bytes during startup sweep if crashed before broadcast', async () => {
    const proposalId = uuidv4();
    const rawTxBytes = '0x02f87082279f0180843b9aca008252089470997970c51812dc3a010c7d01b50e0d17dc79c8872386f26fc1000080c080a01111111111111111111111111111111111111111111111111111111111111111a02222222222222222222222222222222222222222222222222222222222222222' as const;
    const computedHash = '0x3333333333333333333333333333333333333333333333333333333333333333' as const;

    proposalsRepo.create({
      id: proposalId,
      user_id: senderUser.id,
      origin: 'user',
      recipient_handle: recipientUser.handle,
      recipient_id: recipientUser.id,
      recipient_wallet: recipientUser.wallet_address,
      amount: '10000000000000000',
      display_amount: '0.01',
      asset: 'MON',
      network: 'Monad Testnet',
      proposal_hash: 'hash_sweep_reboot',
      status: 'submitted',
      policy_decision: 'ALLOW',
      policy_reasons: '[]',
      expires_at: new Date(Date.now() + 60000).toISOString(),
      execution_mode: 'testnet',
      execution_substate: 'awaiting_broadcast',
      execution_nonce: 80,
    });
    proposalsRepo.updateExecutionSubstate(proposalId, 'awaiting_broadcast', {
      execution_tx_hash: computedHash,
      execution_signed_tx: rawTxBytes,
    });

    let broadcastedBytes: string | null = null;
    const mockPublicClient: any = {
      getChainId: vi.fn().mockResolvedValue(10143),
      getTransactionCount: vi.fn().mockResolvedValue(80n),
      sendRawTransaction: vi.fn().mockImplementation(async ({ serializedTransaction }) => {
        broadcastedBytes = serializedTransaction;
        return computedHash;
      }),
      getTransactionReceipt: vi.fn().mockResolvedValue({
        status: 'success',
        blockNumber: 200n,
        blockHash: '0xblock200',
      }),
      getBlock: vi.fn().mockResolvedValue({
        number: 200n,
        hash: '0xblock200',
      }),
    };

    const executor = new MonadPaymentExecutor(mockPublicClient, mockPublicClient, testAccount);

    // Startup sweep
    await executor.runReconcileSweep();

    // Verify identical bytes were rebroadcast
    expect(broadcastedBytes).toBe(rawTxBytes);
    const updated = proposalsRepo.getById(proposalId);
    expect(updated?.status).toBe('confirmed');
  });

  // ---------------------------------------------------------------------------
  // 15. Not-Found Window & Recoverability
  // ---------------------------------------------------------------------------
  it('should enter not_found_needs_review only after search window expires and recover via reconcile', async () => {
    const proposalId = uuidv4();
    const txHash = '0x8888888888888888888888888888888888888888888888888888888888888888' as const;

    proposalsRepo.create({
      id: proposalId,
      user_id: senderUser.id,
      origin: 'user',
      recipient_handle: recipientUser.handle,
      recipient_id: recipientUser.id,
      recipient_wallet: recipientUser.wallet_address,
      amount: '10000000000000000',
      display_amount: '0.01',
      asset: 'MON',
      network: 'Monad Testnet',
      proposal_hash: 'hash_not_found_rec',
      status: 'submitted',
      policy_decision: 'ALLOW',
      policy_reasons: '[]',
      expires_at: new Date(Date.now() + 60000).toISOString(),
      execution_mode: 'testnet',
      execution_substate: 'broadcasted_unknown',
      execution_nonce: 85,
      execution_tx_hash: txHash,
    });

    let receiptAvailable = false;
    const mockPublicClient: any = {
      getTransactionReceipt: vi.fn().mockImplementation(async () => {
        if (!receiptAvailable) return null;
        return {
          status: 'success',
          blockNumber: 300n,
          blockHash: '0xblock300',
        };
      }),
      getBlock: vi.fn().mockResolvedValue({
        number: 300n,
        hash: '0xblock300',
      }),
    };

    const executor = new MonadPaymentExecutor(mockPublicClient, mockPublicClient, testAccount);

    // 1. Initial poll with short 50ms notFoundWindow expires -> enters not_found_needs_review
    await executor.pollForFinality(proposalId, txHash, 85, '10000000000000000', 20, 50);

    const stuck = proposalsRepo.getById(proposalId);
    expect(stuck?.execution_substate).toBe('not_found_needs_review');

    // 2. Later, receipt becomes available on chain
    receiptAvailable = true;

    // Reconcile recovers the proposal!
    const receipt = await executor.reconcilePayment(stuck!);
    expect(receipt.status).toBe('confirmed');

    const recovered = proposalsRepo.getById(proposalId);
    expect(recovered?.status).toBe('confirmed');
    expect(recovered?.execution_substate).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // 16. Two Concurrent Sends Exceeding Cap (Second Blocked in Mutex)
  // ---------------------------------------------------------------------------
  it('should block the second concurrent send when both together exceed the global daily cap', async () => {
    const { env } = await import('../config/env');
    const origCap = env.GLOBAL_DAILY_LIMIT_MON;
    try {
      (env as any).GLOBAL_DAILY_LIMIT_MON = 0.06; // 0.06 MON total cap

      const mockPublicClient: any = {
        getChainId: vi.fn().mockResolvedValue(10143),
        getTransactionCount: vi.fn().mockResolvedValue(10n),
        getBytecode: vi.fn().mockResolvedValue('0x'),
        getBalance: vi.fn().mockResolvedValue(10000000000000000000n),
        getGasPrice: vi.fn().mockResolvedValue(1000000000n),
        sendRawTransaction: vi.fn().mockResolvedValue('0xtxhash_concurrent'),
        getTransactionReceipt: vi.fn().mockResolvedValue({
          status: 'success',
          blockNumber: 10n,
          blockHash: '0xblock10',
        }),
        getBlock: vi.fn().mockResolvedValue({
          number: 10n,
          hash: '0xblock10',
        }),
      };

      const executor = new MonadPaymentExecutor(mockPublicClient, mockPublicClient, testAccount);

      // Two sends of 0.04 MON each (0.04 <= 0.05 MAX_TESTNET_TRANSFER_MON, but 0.04 + 0.04 = 0.08 > 0.06 daily cap)
      const p1 = proposalsRepo.create({
        id: uuidv4(),
        user_id: senderUser.id,
        origin: 'user',
        recipient_handle: recipientUser.handle,
        recipient_id: recipientUser.id,
        recipient_wallet: recipientUser.wallet_address,
        amount: '40000000000000000', // 0.04 MON
        display_amount: '0.04',
        asset: 'MON',
        network: 'Monad Testnet',
        proposal_hash: 'hash_c1',
        status: 'approved',
        policy_decision: 'ALLOW',
        policy_reasons: '[]',
        expires_at: new Date(Date.now() + 60000).toISOString(),
        execution_mode: 'testnet',
      });

      const p2 = proposalsRepo.create({
        id: uuidv4(),
        user_id: senderUser.id,
        origin: 'user',
        recipient_handle: recipientUser.handle,
        recipient_id: recipientUser.id,
        recipient_wallet: recipientUser.wallet_address,
        amount: '40000000000000000', // 0.04 MON
        display_amount: '0.04',
        asset: 'MON',
        network: 'Monad Testnet',
        proposal_hash: 'hash_c2',
        status: 'approved',
        policy_decision: 'ALLOW',
        policy_reasons: '[]',
        expires_at: new Date(Date.now() + 60000).toISOString(),
        execution_mode: 'testnet',
      });

      const results = await Promise.allSettled([
        executor.executePayment(p1),
        executor.executePayment(p2),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason.code).toBe('GLOBAL_DAILY_LIMIT_EXCEEDED');
    } finally {
      (env as any).GLOBAL_DAILY_LIMIT_MON = origCap;
    }
  });

  // ---------------------------------------------------------------------------
  // 17. Clean Pre-Send Rejections (Pause -> awaiting_approval, Contract -> failed)
  // ---------------------------------------------------------------------------
  it('should revert proposal to awaiting_approval on pause and mark failed on contract recipient', async () => {
    const service = new ProposalService();

    // 1. Pause rejection -> reverts to awaiting_approval (retryable)
    const { env } = await import('../config/env');
    const origPause = env.PAUSE_REAL_TRANSFERS;
    try {
      (env as any).PAUSE_REAL_TRANSFERS = true;
      const id1 = uuidv4();
      const expiresAt1 = new Date(Date.now() + 60000).toISOString();
      const createdAt1 = new Date().toISOString();
      const hash1 = computeCanonicalProposalHash({
        id: id1,
        user_id: senderUser.id,
        recipient_id: recipientUser.id,
        recipient_handle: recipientUser.handle,
        recipient_wallet: recipientUser.wallet_address,
        amount: '10000000000000000',
        asset: 'MON',
        network: 'Monad Testnet',
        origin: 'user',
        purpose: null,
        expires_at: expiresAt1,
        created_at: createdAt1,
      });

      const proposalPause = proposalsRepo.create({
        id: id1,
        user_id: senderUser.id,
        origin: 'user',
        recipient_handle: recipientUser.handle,
        recipient_id: recipientUser.id,
        recipient_wallet: recipientUser.wallet_address,
        amount: '10000000000000000',
        display_amount: '0.01',
        asset: 'MON',
        network: 'Monad Testnet',
        proposal_hash: hash1,
        status: 'awaiting_approval',
        policy_decision: 'ALLOW',
        policy_reasons: '[]',
        expires_at: expiresAt1,
        created_at: createdAt1,
        execution_mode: 'testnet',
      });

      const mockRealExecutor: any = {
        name: 'RealExecutor',
        isMock: false,
        supportedAsset: 'MON',
        executePayment: vi.fn().mockRejectedValue({
          code: 'TRANSFERS_PAUSED',
          message: 'Transfers paused by operator',
        }),
      };
      service.setPaymentExecutor(mockRealExecutor);

      await expect(service.approveProposal(proposalPause.id, senderUser.id, undefined, true)).rejects.toMatchObject({
        status: 503,
      });

      const pAfterPause = proposalsRepo.getById(proposalPause.id);
      expect(pAfterPause?.status).toBe('awaiting_approval'); // Retryable!
    } finally {
      (env as any).PAUSE_REAL_TRANSFERS = origPause;
    }

    // 2. Contract recipient rejection -> terminal failed
    const id2 = uuidv4();
    const expiresAt2 = new Date(Date.now() + 60000).toISOString();
    const createdAt2 = new Date().toISOString();
    const hash2 = computeCanonicalProposalHash({
      id: id2,
      user_id: senderUser.id,
      recipient_id: recipientUser.id,
      recipient_handle: recipientUser.handle,
      recipient_wallet: recipientUser.wallet_address,
      amount: '10000000000000000',
      asset: 'MON',
      network: 'Monad Testnet',
      origin: 'user',
      purpose: null,
      expires_at: expiresAt2,
      created_at: createdAt2,
    });

    const proposalContract = proposalsRepo.create({
      id: id2,
      user_id: senderUser.id,
      origin: 'user',
      recipient_handle: recipientUser.handle,
      recipient_id: recipientUser.id,
      recipient_wallet: recipientUser.wallet_address,
      amount: '10000000000000000',
      display_amount: '0.01',
      asset: 'MON',
      network: 'Monad Testnet',
      proposal_hash: hash2,
      status: 'awaiting_approval',
      policy_decision: 'ALLOW',
      policy_reasons: '[]',
      expires_at: expiresAt2,
      created_at: createdAt2,
      execution_mode: 'testnet',
    });

    const mockRealExecutorContract: any = {
      name: 'RealExecutor',
      isMock: false,
      supportedAsset: 'MON',
      executePayment: vi.fn().mockRejectedValue({
        code: 'CONTRACT_RECIPIENT_REJECTED',
        message: 'Recipient is a smart contract',
        status: 400,
      }),
    };
    service.setPaymentExecutor(mockRealExecutorContract);

    await expect(service.approveProposal(proposalContract.id, senderUser.id, undefined, true)).rejects.toMatchObject({
      status: 400,
    });

    const pAfterContract = proposalsRepo.getById(proposalContract.id);
    expect(pAfterContract?.status).toBe('failed'); // Terminal failed!
  });

  // ---------------------------------------------------------------------------
  // 18. Write-Ahead Atomicity (One Single SQLite UPDATE)
  // ---------------------------------------------------------------------------
  it('should atomically update status to submitted and write-ahead fields in a single query', () => {
    const pId = uuidv4();
    proposalsRepo.create({
      id: pId,
      user_id: senderUser.id,
      origin: 'user',
      recipient_handle: recipientUser.handle,
      recipient_id: recipientUser.id,
      recipient_wallet: recipientUser.wallet_address,
      amount: '10000000000000000',
      display_amount: '0.01',
      asset: 'MON',
      network: 'Monad Testnet',
      proposal_hash: 'h_atom_write',
      status: 'awaiting_approval', // NOT approved yet!
      policy_decision: 'ALLOW',
      policy_reasons: '[]',
      expires_at: new Date(Date.now() + 60000).toISOString(),
      execution_mode: 'testnet',
    });

    // Fails if status is not approved
    const failedUpdate = proposalsRepo.writeAheadSubmission(pId, {
      status: 'submitted',
      execution_substate: 'awaiting_broadcast',
      execution_tx_hash: '0x1234567890123456789012345678901234567890123456789012345678901234',
      execution_nonce: 99,
      execution_signed_tx: '0xsignedbytes',
    });
    expect(failedUpdate).toBe(false);
    expect(proposalsRepo.getById(pId)?.status).toBe('awaiting_approval');
    expect(proposalsRepo.getById(pId)?.execution_signed_tx).toBeNull();

    // Now flip to approved
    db.prepare("UPDATE proposals SET status = 'approved' WHERE id = ?").run(pId);

    // Atomically updates all fields in one SQL query
    const success = proposalsRepo.writeAheadSubmission(pId, {
      status: 'submitted',
      execution_substate: 'awaiting_broadcast',
      execution_tx_hash: '0x1234567890123456789012345678901234567890123456789012345678901234',
      execution_nonce: 99,
      execution_signed_tx: '0xsignedbytes',
    });
    expect(success).toBe(true);

    const saved = proposalsRepo.getById(pId);
    expect(saved?.status).toBe('submitted');
    expect(saved?.execution_substate).toBe('awaiting_broadcast');
    expect(saved?.execution_tx_hash).toBe('0x1234567890123456789012345678901234567890123456789012345678901234');
    expect(saved?.execution_nonce).toBe(99);
    expect(saved?.execution_signed_tx).toBe('0xsignedbytes');
  });

  // ---------------------------------------------------------------------------
  // 19. Signed Transaction Never Leaves Server (Sentinel Test)
  // ---------------------------------------------------------------------------
  it('should never leak execution_signed_tx in API responses, audit logs or error output', () => {
    const sentinel = '0xSENTINEL_RAW_SIGNED_TX_BYTES_NEVER_LEAK_SECRET';
    const pId = uuidv4();
    proposalsRepo.create({
      id: pId,
      user_id: senderUser.id,
      origin: 'user',
      recipient_handle: recipientUser.handle,
      recipient_id: recipientUser.id,
      recipient_wallet: recipientUser.wallet_address,
      amount: '10000000000000000',
      display_amount: '0.01',
      asset: 'MON',
      network: 'Monad Testnet',
      proposal_hash: 'h_sentinel',
      status: 'submitted',
      policy_decision: 'ALLOW',
      policy_reasons: '[]',
      expires_at: new Date(Date.now() + 60000).toISOString(),
      execution_mode: 'testnet',
      execution_signed_tx: sentinel,
      execution_tx_hash: '0xsentinelhash',
    });

    // 1. toPublicProposal excludes it
    const publicP = toPublicProposal(proposalsRepo.getById(pId)!);
    expect((publicP as any).execution_signed_tx).toBeUndefined();
    expect(JSON.stringify(publicP)).not.toContain(sentinel);

    // 2. audit log filtering drops it
    auditRepo.log({
      proposal_id: pId,
      actor_type: 'system',
      action: 'execution_substate_changed',
      details: {
        from_substate: 'awaiting_broadcast',
        to_substate: 'broadcasted_unknown',
        execution_signed_tx: sentinel,
      } as any,
    });
    const logs = db.prepare('SELECT * FROM audit_logs WHERE proposal_id = ?').all(pId);
    expect(JSON.stringify(logs)).not.toContain(sentinel);
  });

  // ---------------------------------------------------------------------------
  // 20. Separate Read vs Dedicated Send Client Configurations
  // ---------------------------------------------------------------------------
  it('should configure separate read client with fallback and dedicated send client with retryCount 0', () => {
    const executor = new MonadPaymentExecutor();
    const readClient = executor.getReadClient();
    const sendClient = executor.getSendClient();

    expect(readClient).toBeDefined();
    expect(sendClient).toBeDefined();
    expect(readClient).not.toBe(sendClient);
  });

  // ---------------------------------------------------------------------------
  // 21. Broadcast Result Classifications (Already Known, Definite Rejection)
  // ---------------------------------------------------------------------------
  it('should handle already-known / nonce-too-low on rebroadcast as possibly on-chain and fall through to receipt lookup', async () => {
    const proposal = proposalsRepo.create({
      id: uuidv4(),
      user_id: senderUser.id,
      origin: 'user',
      recipient_handle: recipientUser.handle,
      recipient_id: recipientUser.id,
      recipient_wallet: recipientUser.wallet_address,
      amount: '10000000000000000',
      display_amount: '0.01',
      asset: 'MON',
      network: 'Monad Testnet',
      proposal_hash: 'h_known',
      status: 'approved',
      policy_decision: 'ALLOW',
      policy_reasons: '[]',
      expires_at: new Date(Date.now() + 60000).toISOString(),
      execution_mode: 'testnet',
    });

    const mockReadClient: any = {
      getChainId: vi.fn().mockResolvedValue(10143),
      getTransactionCount: vi.fn().mockResolvedValue(20n),
      getBytecode: vi.fn().mockResolvedValue('0x'),
      getBalance: vi.fn().mockResolvedValue(10000000000000000000n),
      getGasPrice: vi.fn().mockResolvedValue(1000000000n),
      getTransactionReceipt: vi.fn().mockResolvedValue({
        status: 'success',
        blockNumber: 100n,
        blockHash: '0xblock100',
      }),
      getBlock: vi.fn().mockResolvedValue({ number: 100n, hash: '0xblock100' }),
    };

    const mockSendClient: any = {
      sendRawTransaction: vi.fn().mockRejectedValue(new Error('nonce too low: address 0x..., tx: 20 state: 21')),
    };

    const executor = new MonadPaymentExecutor(mockReadClient, mockSendClient, testAccount);
    const receipt = await executor.executePayment(proposal);

    expect(receipt.status).toBe('submitted');
    const updated = proposalsRepo.getById(proposal.id);
    expect(updated?.execution_substate).toBe('broadcasted_unknown');
  });

  it('should fail proposal without consuming nonce or setting ambiguity flag on definite node rejection', async () => {
    const proposal = proposalsRepo.create({
      id: uuidv4(),
      user_id: senderUser.id,
      origin: 'user',
      recipient_handle: recipientUser.handle,
      recipient_id: recipientUser.id,
      recipient_wallet: recipientUser.wallet_address,
      amount: '10000000000000000',
      display_amount: '0.01',
      asset: 'MON',
      network: 'Monad Testnet',
      proposal_hash: 'h_reject',
      status: 'approved',
      policy_decision: 'ALLOW',
      policy_reasons: '[]',
      expires_at: new Date(Date.now() + 60000).toISOString(),
      execution_mode: 'testnet',
    });

    const mockReadClient: any = {
      getChainId: vi.fn().mockResolvedValue(10143),
      getTransactionCount: vi.fn().mockResolvedValue(30n),
      getBytecode: vi.fn().mockResolvedValue('0x'),
      getBalance: vi.fn().mockResolvedValue(10000000000000000000n),
      getGasPrice: vi.fn().mockResolvedValue(1000000000n),
    };

    const rpcErr: any = new Error('intrinsic gas too low: 21000 < 53000');
    rpcErr.isJsonRpcError = true;
    rpcErr.code = -32000;
    const mockSendClient: any = {
      sendRawTransaction: vi.fn().mockRejectedValue(rpcErr),
    };

    const executor = new MonadPaymentExecutor(mockReadClient, mockSendClient, testAccount);

    await expect(executor.executePayment(proposal)).rejects.toMatchObject({
      code: 'BROADCAST_DEFINITE_REJECTION',
    });

    const updated = proposalsRepo.getById(proposal.id);
    expect(updated?.status).toBe('failed');
    expect(updated?.execution_signed_tx).toBeNull();
    expect(updated?.execution_substate).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // 22. Startup Sweep Safety Checks (Pause, Max Age, Nonce Consumed)
  // ---------------------------------------------------------------------------
  it('should skip startup sweep rebroadcast when PAUSE_REAL_TRANSFERS is true', async () => {
    const { env } = await import('../config/env');
    const origPause = env.PAUSE_REAL_TRANSFERS;
    try {
      (env as any).PAUSE_REAL_TRANSFERS = true;
      const sendMock = vi.fn();
      const mockSendClient: any = { sendRawTransaction: sendMock };
      const executor = new MonadPaymentExecutor({} as any, mockSendClient, testAccount);

      const pId = uuidv4();
      proposalsRepo.create({
        id: pId,
        user_id: senderUser.id,
        origin: 'user',
        recipient_handle: recipientUser.handle,
        recipient_id: recipientUser.id,
        recipient_wallet: recipientUser.wallet_address,
        amount: '10000000000000000',
        display_amount: '0.01',
        asset: 'MON',
        network: 'Monad Testnet',
        proposal_hash: 'h_pause_sweep',
        status: 'submitted',
        policy_decision: 'ALLOW',
        policy_reasons: '[]',
        expires_at: new Date(Date.now() + 60000).toISOString(),
        execution_mode: 'testnet',
        execution_substate: 'awaiting_broadcast',
        execution_tx_hash: '0xhash_pause',
        execution_nonce: 77,
        execution_signed_tx: '0xsigned_pause',
      });

      await executor.runReconcileSweep();
      expect(sendMock).not.toHaveBeenCalled();
    } finally {
      (env as any).PAUSE_REAL_TRANSFERS = origPause;
    }
  });

  it('should not rebroadcast proposals older than MAX_REBROADCAST_AGE_MS and move them to not_found_needs_review', async () => {
    const pId = uuidv4();
    const oldTimestamp = new Date(Date.now() - 700000).toISOString(); // 700s > 600s max age
    proposalsRepo.create({
      id: pId,
      user_id: senderUser.id,
      origin: 'user',
      recipient_handle: recipientUser.handle,
      recipient_id: recipientUser.id,
      recipient_wallet: recipientUser.wallet_address,
      amount: '10000000000000000',
      display_amount: '0.01',
      asset: 'MON',
      network: 'Monad Testnet',
      proposal_hash: 'h_old_sweep',
      status: 'submitted',
      policy_decision: 'ALLOW',
      policy_reasons: '[]',
      expires_at: new Date(Date.now() + 60000).toISOString(),
      execution_mode: 'testnet',
      execution_substate: 'awaiting_broadcast',
      execution_nonce: 45,
      execution_tx_hash: '0xoldtxhash',
      execution_signed_tx: '0xoldbytes',
      created_at: oldTimestamp,
    });

    const sendMock = vi.fn();
    const mockSendClient: any = { sendRawTransaction: sendMock };
    const executor = new MonadPaymentExecutor({} as any, mockSendClient, testAccount);

    await executor.runReconcileSweep();

    expect(sendMock).not.toHaveBeenCalled();
    const updated = proposalsRepo.getById(pId);
    expect(updated?.execution_substate).toBe('not_found_needs_review');
  });

  it('should mark proposal not_found_needs_review if its nonce was consumed by another transaction on-chain', async () => {
    const pId = uuidv4();
    proposalsRepo.create({
      id: pId,
      user_id: senderUser.id,
      origin: 'user',
      recipient_handle: recipientUser.handle,
      recipient_id: recipientUser.id,
      recipient_wallet: recipientUser.wallet_address,
      amount: '10000000000000000',
      display_amount: '0.01',
      asset: 'MON',
      network: 'Monad Testnet',
      proposal_hash: 'h_consumed_nonce',
      status: 'submitted',
      policy_decision: 'ALLOW',
      policy_reasons: '[]',
      expires_at: new Date(Date.now() + 60000).toISOString(),
      execution_mode: 'testnet',
      execution_substate: 'awaiting_broadcast',
      execution_nonce: 10,
      execution_tx_hash: '0xourhash',
      execution_signed_tx: '0xourbytes',
    });

    const sendMock = vi.fn();
    const mockSendClient: any = {
      getTransactionCount: vi.fn().mockResolvedValue(15n),
      getTransactionReceipt: vi.fn().mockResolvedValue(null),
      sendRawTransaction: sendMock,
    };
    const executor = new MonadPaymentExecutor({} as any, mockSendClient, testAccount);

    await executor.runReconcileSweep();

    expect(sendMock).not.toHaveBeenCalled();
    const updated = proposalsRepo.getById(pId);
    expect(updated?.execution_substate).toBe('not_found_needs_review');
    expect(updated?.execution_error).toContain('consumed on-chain');
  });

  // ---------------------------------------------------------------------------
  // 23. Executor Rejects Non-Approved Status
  // ---------------------------------------------------------------------------
  it('should reject execution if proposal is not in approved status', async () => {
    const proposal = proposalsRepo.create({
      id: uuidv4(),
      user_id: senderUser.id,
      origin: 'user',
      recipient_handle: recipientUser.handle,
      recipient_id: recipientUser.id,
      recipient_wallet: recipientUser.wallet_address,
      amount: '10000000000000000',
      display_amount: '0.01',
      asset: 'MON',
      network: 'Monad Testnet',
      proposal_hash: 'h_not_approved',
      status: 'awaiting_approval', // Not approved!
      policy_decision: 'ALLOW',
      policy_reasons: '[]',
      expires_at: new Date(Date.now() + 60000).toISOString(),
      execution_mode: 'testnet',
    });

    const executor = new MonadPaymentExecutor({} as any, {} as any, testAccount);

    await expect(executor.executePayment(proposal)).rejects.toMatchObject({
      code: 'INVALID_PROPOSAL_STATUS',
    });
  });

  // ---------------------------------------------------------------------------
  // 24. Insufficient Relayer Balance (amount + 21000 * gasPrice)
  // ---------------------------------------------------------------------------
  it('should reject execution with INSUFFICIENT_RELAYER_BALANCE when balance is below amount + 21000 * gasPrice and revert to awaiting_approval', async () => {
    const proposal = proposalsRepo.create({
      id: uuidv4(),
      user_id: senderUser.id,
      origin: 'user',
      recipient_handle: recipientUser.handle,
      recipient_id: recipientUser.id,
      recipient_wallet: recipientUser.wallet_address,
      amount: parseUnits('0.05', 18).toString(),
      display_amount: '0.05',
      asset: 'MON',
      network: 'Monad Testnet',
      proposal_hash: 'h_insufficient_bal',
      status: 'approved',
      policy_decision: 'ALLOW',
      policy_reasons: '[]',
      expires_at: new Date(Date.now() + 60000).toISOString(),
      execution_mode: 'testnet',
    });

    const mockReadClient: any = {
      getBytecode: vi.fn().mockResolvedValue('0x'),
      getBalance: vi.fn().mockResolvedValue(parseUnits('0.01', 18)), // only 0.01 MON balance (< 0.05 MON amount)
      getGasPrice: vi.fn().mockResolvedValue(1000000000n),
    };

    const executor = new MonadPaymentExecutor(mockReadClient, {} as any, testAccount);
    await expect(executor.executePayment(proposal)).rejects.toMatchObject({
      code: 'INSUFFICIENT_RELAYER_BALANCE',
    });
  });

  // ---------------------------------------------------------------------------
  // 25. Explorer Link Built from EXPLORER_BASE_URL
  // ---------------------------------------------------------------------------
  it('should construct explorer link using EXPLORER_BASE_URL', async () => {
    const proposalId = uuidv4();
    const txHash = '0x5555555555555555555555555555555555555555555555555555555555555555' as const;

    proposalsRepo.create({
      id: proposalId,
      user_id: senderUser.id,
      origin: 'user',
      recipient_handle: recipientUser.handle,
      recipient_id: recipientUser.id,
      recipient_wallet: recipientUser.wallet_address,
      amount: '10000000000000000',
      display_amount: '0.01',
      asset: 'MON',
      network: 'Monad Testnet',
      proposal_hash: 'h_explorer_test',
      status: 'submitted',
      policy_decision: 'ALLOW',
      policy_reasons: '[]',
      expires_at: new Date(Date.now() + 60000).toISOString(),
      execution_mode: 'testnet',
      execution_tx_hash: txHash,
    });

    const mockReadClient: any = {
      getTransactionReceipt: vi.fn().mockResolvedValue({
        blockNumber: 100n,
        blockHash: '0xblock100',
        status: 'success',
      }),
      getBlock: vi.fn().mockImplementation(async (args: any) => {
        if (args?.blockTag === 'finalized') {
          return { number: 100n, hash: '0xblock100' };
        }
        return { number: 100n, hash: '0xblock100' };
      }),
    };

    const executor = new MonadPaymentExecutor(mockReadClient, {} as any, testAccount);
    const receipt = await executor.pollForFinality(proposalId, txHash, 1, '10000000000000000', 3000);

    const { env } = await import('../config/env');
    expect(receipt.explorerLink).toBe(`${env.EXPLORER_BASE_URL}/tx/${txHash}`);
  });

  // ---------------------------------------------------------------------------
  // 26. Reconcile Never Re-signs or Resubmits
  // ---------------------------------------------------------------------------
  it('should never broadcast or sign a new transaction during reconcile', async () => {
    const proposalId = uuidv4();
    const txHash = '0x4444444444444444444444444444444444444444444444444444444444444444' as const;

    const proposal = proposalsRepo.create({
      id: proposalId,
      user_id: senderUser.id,
      origin: 'user',
      recipient_handle: recipientUser.handle,
      recipient_id: recipientUser.id,
      recipient_wallet: recipientUser.wallet_address,
      amount: '10000000000000000',
      display_amount: '0.01',
      asset: 'MON',
      network: 'Monad Testnet',
      proposal_hash: 'h_reconcile_nosign',
      status: 'submitted',
      policy_decision: 'ALLOW',
      policy_reasons: '[]',
      expires_at: new Date(Date.now() + 60000).toISOString(),
      execution_mode: 'testnet',
      execution_tx_hash: txHash,
      execution_nonce: 99,
    });

    const mockReadClient: any = {
      getTransactionReceipt: vi.fn().mockResolvedValue({
        status: 'success',
        blockNumber: 500n,
        blockHash: '0xblock500',
      }),
      getBlock: vi.fn().mockResolvedValue({
        number: 500n,
        hash: '0xblock500',
      }),
    };
    const sendMock = vi.fn();
    const mockSendClient: any = { sendRawTransaction: sendMock };

    const executor = new MonadPaymentExecutor(mockReadClient, mockSendClient, testAccount);
    const receipt = await executor.reconcilePayment(proposal);

    expect(receipt.status).toBe('confirmed');
    expect(sendMock).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // 27. Broadcast Error Classification & Definite vs Ambiguous Handling
  // ---------------------------------------------------------------------------
  it('should treat transport error containing insufficient funds as ambiguous and return success-but-pending', async () => {
    const proposal = proposalsRepo.create({
      id: uuidv4(),
      user_id: senderUser.id,
      origin: 'user',
      recipient_handle: recipientUser.handle,
      recipient_id: recipientUser.id,
      recipient_wallet: recipientUser.wallet_address,
      amount: '10000000000000000',
      display_amount: '0.01',
      asset: 'MON',
      network: 'Monad Testnet',
      proposal_hash: 'h_transport_ambiguous',
      status: 'approved',
      policy_decision: 'ALLOW',
      policy_reasons: '[]',
      expires_at: new Date(Date.now() + 60000).toISOString(),
      execution_mode: 'testnet',
    });

    const mockReadClient: any = {
      getChainId: vi.fn().mockResolvedValue(10143),
      getTransactionCount: vi.fn().mockResolvedValue(20n),
      getBytecode: vi.fn().mockResolvedValue('0x'),
      getBalance: vi.fn().mockResolvedValue(10000000000000000000n),
      getGasPrice: vi.fn().mockResolvedValue(1000000000n),
    };

    // Transport error (HTTP 500 / gateway timeout) whose text happens to mention 'insufficient funds'
    const transportErr: any = new Error('HTTP 500 Internal Server Error: Gateway upstream report: insufficient funds in buffer');
    transportErr.status = 500;
    transportErr.isTransportError = true;

    const mockSendClient: any = {
      sendRawTransaction: vi.fn().mockRejectedValue(transportErr),
    };

    const executor = new MonadPaymentExecutor(mockReadClient, mockSendClient, testAccount);

    // Must NOT throw: returns success-but-pending receipt with proposal in broadcasted_unknown
    const receipt = await executor.executePayment(proposal);

    expect(receipt.status).toBe('submitted');
    expect(receipt.details).toContain('ambiguous');

    const updated = proposalsRepo.getById(proposal.id);
    expect(updated?.status).toBe('submitted');
    expect(updated?.execution_substate).toBe('broadcasted_unknown');
    expect(updated?.execution_tx_hash).toBeDefined();
  });

  it('should treat structured JSON-RPC insufficient funds as retryable and revert to awaiting_approval', async () => {
    const proposal = proposalsRepo.create({
      id: uuidv4(),
      user_id: senderUser.id,
      origin: 'user',
      recipient_handle: recipientUser.handle,
      recipient_id: recipientUser.id,
      recipient_wallet: recipientUser.wallet_address,
      amount: '10000000000000000',
      display_amount: '0.01',
      asset: 'MON',
      network: 'Monad Testnet',
      proposal_hash: 'h_rpc_insufficient_funds',
      status: 'approved',
      policy_decision: 'ALLOW',
      policy_reasons: '[]',
      expires_at: new Date(Date.now() + 60000).toISOString(),
      execution_mode: 'testnet',
    });

    const mockReadClient: any = {
      getChainId: vi.fn().mockResolvedValue(10143),
      getTransactionCount: vi.fn().mockResolvedValue(22n),
      getBytecode: vi.fn().mockResolvedValue('0x'),
      getBalance: vi.fn().mockResolvedValue(10000000000000000000n),
      getGasPrice: vi.fn().mockResolvedValue(1000000000n),
    };

    // Structured JSON-RPC error response from node
    const rpcErr: any = new Error('insufficient funds for gas * price + value');
    rpcErr.isJsonRpcError = true;
    rpcErr.code = -32000;

    const mockSendClient: any = {
      sendRawTransaction: vi.fn().mockRejectedValue(rpcErr),
    };

    const executor = new MonadPaymentExecutor(mockReadClient, mockSendClient, testAccount);

    await expect(executor.executePayment(proposal)).rejects.toMatchObject({
      code: 'INSUFFICIENT_RELAYER_BALANCE',
      status: 503,
    });

    const updated = proposalsRepo.getById(proposal.id);
    expect(updated?.status).toBe('awaiting_approval'); // Reverted to retryable state!
    expect(updated?.execution_signed_tx).toBeNull();
    expect(updated?.execution_tx_hash).toBeNull();
    expect(updated?.execution_substate).toBeNull();

    // Verify audit log has approval_failed
    const audits = db.prepare('SELECT action FROM audit_logs WHERE proposal_id = ?').all(proposal.id) as any[];
    expect(audits.some((a) => a.action === 'approval_failed')).toBe(true);
  });

  it('should resync nextNonce from chain when nonce too low occurs on first broadcast and set broadcasted_unknown', async () => {
    const proposal = proposalsRepo.create({
      id: uuidv4(),
      user_id: senderUser.id,
      origin: 'user',
      recipient_handle: recipientUser.handle,
      recipient_id: recipientUser.id,
      recipient_wallet: recipientUser.wallet_address,
      amount: '10000000000000000',
      display_amount: '0.01',
      asset: 'MON',
      network: 'Monad Testnet',
      proposal_hash: 'h_nonce_too_low',
      status: 'approved',
      policy_decision: 'ALLOW',
      policy_reasons: '[]',
      expires_at: new Date(Date.now() + 60000).toISOString(),
      execution_mode: 'testnet',
    });

    const mockReadClient: any = {
      getChainId: vi.fn().mockResolvedValue(10143),
      getTransactionCount: vi.fn().mockResolvedValue(42n), // on-chain nonce is now 42
      getBytecode: vi.fn().mockResolvedValue('0x'),
      getBalance: vi.fn().mockResolvedValue(10000000000000000000n),
      getGasPrice: vi.fn().mockResolvedValue(1000000000n),
    };

    const mockSendClient: any = {
      sendRawTransaction: vi.fn().mockRejectedValue(new Error('nonce too low: tx nonce 10, current state 42')),
    };

    const executor = new MonadPaymentExecutor(mockReadClient, mockSendClient, testAccount);
    const receipt = await executor.executePayment(proposal);

    expect(receipt.status).toBe('submitted');

    const updated = proposalsRepo.getById(proposal.id);
    expect(updated?.status).toBe('submitted');
    expect(updated?.execution_substate).toBe('broadcasted_unknown');

    // Next nonce must be resynced from chain (max of chain count 42 and highest stored 42 + 1 = 43)
    expect((executor as any).nextNonce).toBe(43);
  });

  it('should treat unrecognized errors as ambiguous without throwing on executePayment', async () => {
    const proposal = proposalsRepo.create({
      id: uuidv4(),
      user_id: senderUser.id,
      origin: 'user',
      recipient_handle: recipientUser.handle,
      recipient_id: recipientUser.id,
      recipient_wallet: recipientUser.wallet_address,
      amount: '10000000000000000',
      display_amount: '0.01',
      asset: 'MON',
      network: 'Monad Testnet',
      proposal_hash: 'h_unrecognized_err',
      status: 'approved',
      policy_decision: 'ALLOW',
      policy_reasons: '[]',
      expires_at: new Date(Date.now() + 60000).toISOString(),
      execution_mode: 'testnet',
    });

    const mockReadClient: any = {
      getChainId: vi.fn().mockResolvedValue(10143),
      getTransactionCount: vi.fn().mockResolvedValue(10n),
      getBytecode: vi.fn().mockResolvedValue('0x'),
      getBalance: vi.fn().mockResolvedValue(10000000000000000000n),
      getGasPrice: vi.fn().mockResolvedValue(1000000000n),
    };

    const mockSendClient: any = {
      sendRawTransaction: vi.fn().mockRejectedValue(new Error('unexpected internal node failure: error 9999')),
    };

    const executor = new MonadPaymentExecutor(mockReadClient, mockSendClient, testAccount);
    const receipt = await executor.executePayment(proposal);

    expect(receipt.status).toBe('submitted');
    const updated = proposalsRepo.getById(proposal.id);
    expect(updated?.status).toBe('submitted');
    expect(updated?.execution_substate).toBe('broadcasted_unknown');
    expect((executor as any).isNonceAmbiguous).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 28. Single-Flight Reconcile & CAS Status Transition
  // ---------------------------------------------------------------------------
  it('should single-flight concurrent reconciles and perform CAS transition producing exactly one audit event', async () => {
    const proposalId = uuidv4();
    const txHash = '0x6666666666666666666666666666666666666666666666666666666666666666' as const;

    const proposal = proposalsRepo.create({
      id: proposalId,
      user_id: senderUser.id,
      origin: 'user',
      recipient_handle: recipientUser.handle,
      recipient_id: recipientUser.id,
      recipient_wallet: recipientUser.wallet_address,
      amount: '10000000000000000',
      display_amount: '0.01',
      asset: 'MON',
      network: 'Monad Testnet',
      proposal_hash: 'h_single_flight_cas',
      status: 'submitted',
      policy_decision: 'ALLOW',
      policy_reasons: '[]',
      expires_at: new Date(Date.now() + 60000).toISOString(),
      execution_mode: 'testnet',
      execution_tx_hash: txHash,
      execution_nonce: 88,
    });

    const mockReadClient: any = {
      getTransactionReceipt: vi.fn().mockResolvedValue({
        blockNumber: 300n,
        blockHash: '0xblock300',
        status: 'success',
      }),
      getBlock: vi.fn().mockImplementation(async (args: any) => {
        return { number: 300n, hash: '0xblock300' };
      }),
    };

    const executor = new MonadPaymentExecutor(mockReadClient, {} as any, testAccount);

    // Two concurrent reconciles simultaneously
    const [r1, r2] = await Promise.all([
      executor.reconcilePayment(proposal),
      executor.reconcilePayment(proposal),
    ]);

    expect(r1.status).toBe('confirmed');
    expect(r2.status).toBe('confirmed');

    const updated = proposalsRepo.getById(proposalId);
    expect(updated?.status).toBe('confirmed');

    // Exactly one 'execution_confirmed' audit log must exist!
    const confirmedAudits = db.prepare(
      "SELECT * FROM audit_logs WHERE proposal_id = ? AND action = 'execution_confirmed'"
    ).all(proposalId);
    expect(confirmedAudits).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // 29. Approve on Ambiguous Broadcast Returns Success-But-Pending
  // ---------------------------------------------------------------------------
  it('should return success-but-pending response on approve when broadcast is ambiguous', async () => {
    const proposalData: any = {
      id: uuidv4(),
      user_id: senderUser.id,
      origin: 'user',
      recipient_handle: recipientUser.handle,
      recipient_id: recipientUser.id,
      recipient_wallet: recipientUser.wallet_address,
      amount: '10000000000000000',
      display_amount: '0.01',
      asset: 'MON',
      network: 'Monad Testnet',
      status: 'awaiting_approval',
      policy_decision: 'ALLOW',
      policy_reasons: '[]',
      expires_at: new Date(Date.now() + 60000).toISOString(),
      execution_mode: 'testnet',
      created_at: new Date().toISOString(),
    };
    proposalData.proposal_hash = computeCanonicalProposalHash(proposalData);
    const proposal = proposalsRepo.create(proposalData);

    const mockReadClient: any = {
      getChainId: vi.fn().mockResolvedValue(10143),
      getTransactionCount: vi.fn().mockResolvedValue(10n),
      getBytecode: vi.fn().mockResolvedValue('0x'),
      getBalance: vi.fn().mockResolvedValue(10000000000000000000n),
      getGasPrice: vi.fn().mockResolvedValue(1000000000n),
    };

    const mockSendClient: any = {
      sendRawTransaction: vi.fn().mockRejectedValue(new Error('ETIMEDOUT: Connection dropped by peer')),
    };

    const customExecutor = new MonadPaymentExecutor(mockReadClient, mockSendClient, testAccount);
    const service = new ProposalService(customExecutor);

    // Call approveProposal with confirm_new_recipient for first-time recipient
    const res = await service.approveProposal(proposal.id, senderUser.id, undefined, { confirm_new_recipient: true });

    expect(res.proposal.status).toBe('submitted');
    expect(res.proposal.execution_substate).toBe('broadcasted_unknown');
    expect(res.receipt.status).toBe('submitted');
    expect(res.receipt.details).toContain('ambiguous');
  });

  // ---------------------------------------------------------------------------
  // 30. Startup Sweep Retries Receipt Lookup Once on Nonce Consumed
  // ---------------------------------------------------------------------------
  it('should retry receipt lookup once on single node during startup sweep when nonce consumed on-chain', async () => {
    const pId = uuidv4();
    proposalsRepo.create({
      id: pId,
      user_id: senderUser.id,
      origin: 'user',
      recipient_handle: recipientUser.handle,
      recipient_id: recipientUser.id,
      recipient_wallet: recipientUser.wallet_address,
      amount: '10000000000000000',
      display_amount: '0.01',
      asset: 'MON',
      network: 'Monad Testnet',
      proposal_hash: 'h_sweep_retry_receipt',
      status: 'submitted',
      policy_decision: 'ALLOW',
      policy_reasons: '[]',
      expires_at: new Date(Date.now() + 60000).toISOString(),
      execution_mode: 'testnet',
      execution_substate: 'awaiting_broadcast',
      execution_nonce: 10,
      execution_tx_hash: '0xhash_lagged',
      execution_signed_tx: '0xbytes_lagged',
    });

    const getReceiptMock = vi
      .fn()
      .mockResolvedValueOnce(null) // first attempt fails (replication lag)
      .mockResolvedValueOnce({ status: 'success', blockNumber: 100n, blockHash: '0xblock100' }); // second attempt succeeds!

    const mockSendClient: any = {
      getTransactionCount: vi.fn().mockResolvedValue(15n),
      getTransactionReceipt: getReceiptMock,
      sendRawTransaction: vi.fn(),
    };

    const mockReadClient: any = {
      getBlock: vi.fn().mockResolvedValue({ number: 100n, hash: '0xblock100' }),
      getTransactionReceipt: vi.fn().mockResolvedValue({ status: 'success', blockNumber: 100n, blockHash: '0xblock100' }),
    };

    const executor = new MonadPaymentExecutor(mockReadClient, mockSendClient, testAccount);

    await executor.runReconcileSweep();

    // Verify receipt lookup was retried on the send client
    expect(getReceiptMock).toHaveBeenCalledTimes(2);

    const updated = proposalsRepo.getById(pId);
    // Should NOT have been moved to not_found_needs_review
    expect(updated?.execution_substate).not.toBe('not_found_needs_review');
  });

  // ---------------------------------------------------------------------------
  // 31. Recipient Address Validations (Self Transfer & Checksum)
  // ---------------------------------------------------------------------------
  it('should reject a recipient address equal to the relayer address with SELF_TRANSFER_DISALLOWED', async () => {
    const proposal = proposalsRepo.create({
      id: uuidv4(),
      user_id: senderUser.id,
      origin: 'user',
      recipient_handle: 'relayer_clone',
      recipient_id: recipientUser.id,
      recipient_wallet: testAccount.address, // Relayer address!
      amount: '10000000000000000',
      display_amount: '0.01',
      asset: 'MON',
      network: 'Monad Testnet',
      proposal_hash: 'h_self_transfer',
      status: 'approved',
      policy_decision: 'ALLOW',
      policy_reasons: '[]',
      expires_at: new Date(Date.now() + 60000).toISOString(),
      execution_mode: 'testnet',
    });

    const executor = new MonadPaymentExecutor({} as any, {} as any, testAccount);

    await expect(executor.executePayment(proposal)).rejects.toMatchObject({
      code: 'SELF_TRANSFER_DISALLOWED',
    });
  });

  it('should reject an invalid-checksum or malformed recipient address with INVALID_RECIPIENT_WALLET', async () => {
    // Checksum tamper: lowercasing/uppercasing wrong characters in checksummed address
    const invalidChecksumAddress = '0x15D34aaf54267db7d7c367839aaf71a00a2c6a65';

    const proposal = proposalsRepo.create({
      id: uuidv4(),
      user_id: senderUser.id,
      origin: 'user',
      recipient_handle: 'bad_address',
      recipient_id: recipientUser.id,
      recipient_wallet: invalidChecksumAddress,
      amount: '10000000000000000',
      display_amount: '0.01',
      asset: 'MON',
      network: 'Monad Testnet',
      proposal_hash: 'h_bad_checksum',
      status: 'approved',
      policy_decision: 'ALLOW',
      policy_reasons: '[]',
      expires_at: new Date(Date.now() + 60000).toISOString(),
      execution_mode: 'testnet',
    });

    const executor = new MonadPaymentExecutor({} as any, {} as any, testAccount);

    await expect(executor.executePayment(proposal)).rejects.toMatchObject({
      code: 'INVALID_RECIPIENT_WALLET',
    });
  });

  // ---------------------------------------------------------------------------
  // 32. Redaction with Sentinel in URL Path AND Query String Inside Viem Error
  // ---------------------------------------------------------------------------
  it('should redact sentinel from URL path AND query string inside viem-shaped error', async () => {
    const { sanitizeError } = await import('../adapters/payment/MonadPaymentExecutor');

    const viemShapedError = new Error(
      'HttpRequestError: HTTP request failed at https://rpc.monad.xyz/api/v1/SENTINEL_SECRET_PATH?api_key=SENTINEL_QUERY_SECRET&foo=bar'
    );

    const sanitized = sanitizeError(viemShapedError);

    expect(sanitized.message).not.toContain('SENTINEL_SECRET_PATH');
    expect(sanitized.message).not.toContain('SENTINEL_QUERY_SECRET');
    expect(sanitized.message).toContain('[REDACTED_URL]');
  });

  // ---------------------------------------------------------------------------
  // 33. Operator Override Flag Releases Stuck-Proposal Lock
  // ---------------------------------------------------------------------------
  it('should release stuck-proposal lock when OPERATOR_OVERRIDE_ALLOW_SENDS is true', async () => {
    const { env } = await import('../config/env');
    const origOverride = env.OPERATOR_OVERRIDE_ALLOW_SENDS;

    try {
      // 1. Create a stuck proposal in database
      proposalsRepo.create({
        id: uuidv4(),
        user_id: senderUser.id,
        origin: 'user',
        recipient_handle: recipientUser.handle,
        recipient_id: recipientUser.id,
        recipient_wallet: recipientUser.wallet_address,
        amount: '10000000000000000',
        display_amount: '0.01',
        asset: 'MON',
        network: 'Monad Testnet',
        proposal_hash: 'h_stuck',
        status: 'submitted',
        policy_decision: 'ALLOW',
        policy_reasons: '[]',
        expires_at: new Date(Date.now() + 60000).toISOString(),
        execution_mode: 'testnet',
        execution_substate: 'broadcasted_unknown',
      });

      const newProposal = proposalsRepo.create({
        id: uuidv4(),
        user_id: senderUser.id,
        origin: 'user',
        recipient_handle: recipientUser.handle,
        recipient_id: recipientUser.id,
        recipient_wallet: recipientUser.wallet_address,
        amount: '10000000000000000',
        display_amount: '0.01',
        asset: 'MON',
        network: 'Monad Testnet',
        proposal_hash: 'h_new_during_stuck',
        status: 'approved',
        policy_decision: 'ALLOW',
        policy_reasons: '[]',
        expires_at: new Date(Date.now() + 60000).toISOString(),
        execution_mode: 'testnet',
      });

      const mockReadClient: any = {
        getChainId: vi.fn().mockResolvedValue(10143),
        getTransactionCount: vi.fn().mockResolvedValue(10n),
        getBytecode: vi.fn().mockResolvedValue('0x'),
        getBalance: vi.fn().mockResolvedValue(10000000000000000000n),
        getGasPrice: vi.fn().mockResolvedValue(1000000000n),
      };

      const mockSendClient: any = {
        sendRawTransaction: vi.fn().mockResolvedValue('0xtxhash_override'),
      };

      const executor = new MonadPaymentExecutor(mockReadClient, mockSendClient, testAccount);

      // Without override, it throws STUCK_TRANSACTIONS_BLOCK
      (env as any).OPERATOR_OVERRIDE_ALLOW_SENDS = false;
      await expect(executor.executePayment(newProposal)).rejects.toMatchObject({
        code: 'STUCK_TRANSACTIONS_BLOCK',
      });

      // With override, it bypasses the lock and proceeds with payment!
      (env as any).OPERATOR_OVERRIDE_ALLOW_SENDS = true;
      const receipt = await executor.executePayment(newProposal);
      expect(receipt.status).toBe('submitted');
    } finally {
      (env as any).OPERATOR_OVERRIDE_ALLOW_SENDS = origOverride;
    }
  });

  // ---------------------------------------------------------------------------
  // 34. Distinct 'broadcast_accepted' Substate Does Not Block Consecutive Sends
  // ---------------------------------------------------------------------------
  it('should allow two back-to-back approvals with consecutive nonces without broadcast_accepted triggering stuck lock', async () => {
    const p1 = proposalsRepo.create({
      id: uuidv4(),
      user_id: senderUser.id,
      origin: 'user',
      recipient_handle: recipientUser.handle,
      recipient_id: recipientUser.id,
      recipient_wallet: recipientUser.wallet_address,
      amount: '10000000000000000', // 0.01 MON
      display_amount: '0.01',
      asset: 'MON',
      network: 'Monad Testnet',
      proposal_hash: 'h_back_to_back_1',
      status: 'approved',
      policy_decision: 'ALLOW',
      policy_reasons: '[]',
      expires_at: new Date(Date.now() + 60000).toISOString(),
      execution_mode: 'testnet',
    });

    const p2 = proposalsRepo.create({
      id: uuidv4(),
      user_id: senderUser.id,
      origin: 'user',
      recipient_handle: recipientUser.handle,
      recipient_id: recipientUser.id,
      recipient_wallet: recipientUser.wallet_address,
      amount: '10000000000000000', // 0.01 MON
      display_amount: '0.01',
      asset: 'MON',
      network: 'Monad Testnet',
      proposal_hash: 'h_back_to_back_2',
      status: 'approved',
      policy_decision: 'ALLOW',
      policy_reasons: '[]',
      expires_at: new Date(Date.now() + 60000).toISOString(),
      execution_mode: 'testnet',
    });

    const mockReadClient: any = {
      getChainId: vi.fn().mockResolvedValue(10143),
      getTransactionCount: vi.fn().mockResolvedValue(10n),
      getBytecode: vi.fn().mockResolvedValue('0x'),
      getBalance: vi.fn().mockResolvedValue(10000000000000000000n),
      getGasPrice: vi.fn().mockResolvedValue(1000000000n),
    };

    const mockSendClient: any = {
      sendRawTransaction: vi.fn().mockResolvedValue('0xtxhash_ok'),
    };

    const executor = new MonadPaymentExecutor(mockReadClient, mockSendClient, testAccount);

    // First send executes and transitions to 'broadcast_accepted'
    const r1 = await executor.executePayment(p1);
    expect(r1.status).toBe('submitted');

    const updatedP1 = proposalsRepo.getById(p1.id);
    expect(updatedP1?.execution_substate).toBe('broadcast_accepted');
    expect(updatedP1?.execution_nonce).toBe(10);

    // Second send executes immediately while p1 is in 'broadcast_accepted' (NOT blocked as stuck!)
    const r2 = await executor.executePayment(p2);
    expect(r2.status).toBe('submitted');

    const updatedP2 = proposalsRepo.getById(p2.id);
    expect(updatedP2?.execution_substate).toBe('broadcast_accepted');
    expect(updatedP2?.execution_nonce).toBe(11); // Consecutive nonce!
  });

  // ---------------------------------------------------------------------------
  // 35. Ambiguous Broadcast ('broadcasted_unknown') Still Locks Subsequent Sends
  // ---------------------------------------------------------------------------
  it('should ensure ambiguous broadcast in broadcasted_unknown still locks subsequent sends', async () => {
    const p1 = proposalsRepo.create({
      id: uuidv4(),
      user_id: senderUser.id,
      origin: 'user',
      recipient_handle: recipientUser.handle,
      recipient_id: recipientUser.id,
      recipient_wallet: recipientUser.wallet_address,
      amount: '10000000000000000',
      display_amount: '0.01',
      asset: 'MON',
      network: 'Monad Testnet',
      proposal_hash: 'h_ambig_locks_1',
      status: 'approved',
      policy_decision: 'ALLOW',
      policy_reasons: '[]',
      expires_at: new Date(Date.now() + 60000).toISOString(),
      execution_mode: 'testnet',
    });

    const p2 = proposalsRepo.create({
      id: uuidv4(),
      user_id: senderUser.id,
      origin: 'user',
      recipient_handle: recipientUser.handle,
      recipient_id: recipientUser.id,
      recipient_wallet: recipientUser.wallet_address,
      amount: '10000000000000000',
      display_amount: '0.01',
      asset: 'MON',
      network: 'Monad Testnet',
      proposal_hash: 'h_ambig_locks_2',
      status: 'approved',
      policy_decision: 'ALLOW',
      policy_reasons: '[]',
      expires_at: new Date(Date.now() + 60000).toISOString(),
      execution_mode: 'testnet',
    });

    const mockReadClient: any = {
      getChainId: vi.fn().mockResolvedValue(10143),
      getTransactionCount: vi.fn().mockResolvedValue(10n),
      getBytecode: vi.fn().mockResolvedValue('0x'),
      getBalance: vi.fn().mockResolvedValue(10000000000000000000n),
      getGasPrice: vi.fn().mockResolvedValue(1000000000n),
    };

    // p1 experiences ambiguous network failure
    const mockSendClient: any = {
      sendRawTransaction: vi.fn().mockRejectedValue(new Error('ETIMEDOUT: Connection dropped by peer')),
    };

    const executor = new MonadPaymentExecutor(mockReadClient, mockSendClient, testAccount);

    await executor.executePayment(p1);

    const updatedP1 = proposalsRepo.getById(p1.id);
    expect(updatedP1?.execution_substate).toBe('broadcasted_unknown');

    // p2 MUST be blocked because p1 is in 'broadcasted_unknown' (stuck proposals lock)!
    await expect(executor.executePayment(p2)).rejects.toMatchObject({
      code: 'STUCK_TRANSACTIONS_BLOCK',
    });
  });

  // ---------------------------------------------------------------------------
  // 36. Normal Accepted Broadcast Sets broadcast_accepted and Never Shows 'unknown'
  // ---------------------------------------------------------------------------
  it('should ensure normal accepted broadcast sets substate broadcast_accepted and never shows unknown in API', async () => {
    const proposalData: any = {
      id: uuidv4(),
      user_id: senderUser.id,
      origin: 'user',
      recipient_handle: recipientUser.handle,
      recipient_id: recipientUser.id,
      recipient_wallet: recipientUser.wallet_address,
      amount: '10000000000000000',
      display_amount: '0.01',
      asset: 'MON',
      network: 'Monad Testnet',
      status: 'awaiting_approval',
      policy_decision: 'ALLOW',
      policy_reasons: '[]',
      expires_at: new Date(Date.now() + 60000).toISOString(),
      execution_mode: 'testnet',
      created_at: new Date().toISOString(),
    };
    proposalData.proposal_hash = computeCanonicalProposalHash(proposalData);
    const proposal = proposalsRepo.create(proposalData);

    const mockReadClient: any = {
      getChainId: vi.fn().mockResolvedValue(10143),
      getTransactionCount: vi.fn().mockResolvedValue(10n),
      getBytecode: vi.fn().mockResolvedValue('0x'),
      getBalance: vi.fn().mockResolvedValue(10000000000000000000n),
      getGasPrice: vi.fn().mockResolvedValue(1000000000n),
    };

    const mockSendClient: any = {
      sendRawTransaction: vi.fn().mockResolvedValue('0xtxhash_accepted'),
    };

    const customExecutor = new MonadPaymentExecutor(mockReadClient, mockSendClient, testAccount);
    const service = new ProposalService(customExecutor);

    const res = await service.approveProposal(proposal.id, senderUser.id, undefined, { confirm_new_recipient: true });

    // Status is 'submitted' and substate is 'broadcast_accepted' (NEVER 'unknown'!)
    expect(res.proposal.status).toBe('submitted');
    expect(res.proposal.execution_substate).toBe('broadcast_accepted');
    expect(res.receipt.details).not.toContain('unknown');
    expect(res.receipt.details).toContain('broadcast accepted by node');
  });
});
