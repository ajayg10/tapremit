import {
  createPublicClient,
  http,
  fallback,
  PublicClient,
  getAddress,
  isAddress,
  parseUnits,
  formatUnits,
  keccak256,
  Hex,
} from 'viem';
import { privateKeyToAccount, PrivateKeyAccount } from 'viem/accounts';
import { monadTestnet } from 'viem/chains';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { proposalsRepo, Proposal, ProposalExecutionSubstate } from '../../db/proposals.repository';
import { auditRepo } from '../../db/audit.repository';
import { PaymentExecutor, ExecutionReceipt } from './PaymentExecutor';

class Mutex {
  private queue: Array<() => void> = [];
  private locked = false;

  async acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return () => this.release();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.locked = true;
        resolve(() => this.release());
      });
    });
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }
}

// -----------------------------------------------------------------------------
// Sanitized RPC Error Wrapper
// Ensures URLs, private keys, and sensitive tokens never escape to logs or clients
// -----------------------------------------------------------------------------
export class RpcSanitizedError extends Error {
  public code: string;
  public status: number;

  constructor(code: string, message: string, status: number = 502) {
    // Strip any URL or credential fragments from error messages (including path & query string)
    const sanitized = message
      .replace(/https?:\/\/[^\s'"]+/gi, '[REDACTED_URL]')
      .replace(/(?:\/[a-zA-Z0-9_\-\.]+)+\?[^\s'"]*/gi, '[REDACTED_URL_WITH_QUERY]')
      .replace(/\?[a-zA-Z0-9_=&%\-\.]+/gi, '[REDACTED_QUERY]')
      .replace(/0x[a-fA-F0-9]{64}/g, '[REDACTED_KEY]');
    super(sanitized);
    this.name = 'RpcSanitizedError';
    this.code = code;
    this.status = status;
    Object.setPrototypeOf(this, RpcSanitizedError.prototype);
  }
}

export function sanitizeError(err: any): { code: string; message: string } {
  if (err instanceof RpcSanitizedError) {
    return { code: err.code, message: err.message };
  }
  const rawMsg = String(err?.message || 'Unknown RPC execution error');
  const code = String(err?.code || err?.shortMessage || err?.name || 'RPC_ERROR');
  const sanitizedMsg = rawMsg
    .replace(/https?:\/\/[^\s'"]+/gi, '[REDACTED_URL]')
    .replace(/(?:\/[a-zA-Z0-9_\-\.]+)+\?[^\s'"]*/gi, '[REDACTED_URL_WITH_QUERY]')
    .replace(/\?[a-zA-Z0-9_=&%\-\.]+/gi, '[REDACTED_QUERY]')
    .replace(/0x[a-fA-F0-9]{64}/g, '[REDACTED_KEY]');

  return { code, message: sanitizedMsg };
}

export type BroadcastClassification =
  | { type: 'nonce_too_low'; message: string }
  | { type: 'already_known'; message: string }
  | { type: 'definite_rejection'; reason: 'insufficient_funds' | 'terminal'; message: string; code: string }
  | { type: 'ambiguous'; message: string; code: string };

export function classifyBroadcastError(err: any): BroadcastClassification {
  const msg = String(err?.message || '').toLowerCase();
  const name = String(err?.name || '').toLowerCase();

  // 1. Transport error check:
  // Network timeouts, socket drops, ECONNRESET, HTTP 5xx responses, viem HttpRequestError/TimeoutError
  // Transport errors are ALWAYS ambiguous even if the error text contains strings like "insufficient funds"
  const isTransport =
    err?.isTransportError === true ||
    (typeof err?.status === 'number' && err.status >= 500 && err.status <= 599) ||
    (typeof err?.cause?.status === 'number' && err.cause.status >= 500 && err.cause.status <= 599) ||
    /timeout|network|socket|econnrefused|econnreset|fetch failed|ehostunreach|gateway|service unavailable|etimedout/i.test(msg) ||
    /timeout|httprequesterror|fetcherror/i.test(name);

  if (isTransport) {
    return {
      type: 'ambiguous',
      message: err?.message || 'Transport error during broadcast',
      code: 'BROADCAST_TRANSPORT_ERROR',
    };
  }

  // 2. Structured JSON-RPC check:
  // Must be a structured JSON-RPC error response from the node (RpcRequestError or negative numeric RPC code)
  const isStructuredRpc =
    err?.isJsonRpcError === true ||
    name === 'rpcrequesterror' ||
    (typeof err?.cause?.code === 'number' && err?.cause?.code < 0) ||
    (typeof err?.code === 'number' && err?.code < 0);

  // If "nonce too low"
  if (/nonce too low/i.test(msg)) {
    return { type: 'nonce_too_low', message: err?.message || 'nonce too low' };
  }

  // If "already known" / "replacement underpriced"
  if (/already known|replacement underpriced|already imported|known transaction/i.test(msg)) {
    return { type: 'already_known', message: err?.message || 'already known' };
  }

  // 3. Definite node rejections: ONLY if structured JSON-RPC response from node
  if (isStructuredRpc) {
    if (/insufficient funds/i.test(msg)) {
      return {
        type: 'definite_rejection',
        reason: 'insufficient_funds',
        message: err?.message || 'insufficient funds',
        code: 'INSUFFICIENT_RELAYER_BALANCE',
      };
    }
    if (/invalid signature|intrinsic gas too low|exceeds block gas limit|sender not authorized/i.test(msg)) {
      return {
        type: 'definite_rejection',
        reason: 'terminal',
        message: err?.message || 'transaction rejected by node',
        code: 'TRANSACTION_REJECTED',
      };
    }
  }

  // 4. Any other or unrecognized error is ambiguous
  return {
    type: 'ambiguous',
    message: err?.message || 'Unrecognized broadcast error',
    code: 'BROADCAST_AMBIGUOUS_ERROR',
  };
}

export class MonadPaymentExecutor implements PaymentExecutor {
  public readonly name = 'MonadPaymentExecutor (Testnet Settlement)';
  public readonly isMock = false;
  public readonly supportedAsset = 'MON';

  private readClient: PublicClient;
  private sendClient: PublicClient;
  private account?: PrivateKeyAccount;
  private relayerAddress: string;

  private mutex = new Mutex();
  private nextNonce: number | null = null;
  private isNonceAmbiguous: boolean = false;
  private activeReconciles = new Map<string, Promise<ExecutionReceipt>>();

  constructor(
    customReadClient?: PublicClient,
    customSendClient?: PublicClient,
    customAccount?: PrivateKeyAccount
  ) {
    // Separate read client with fallback
    this.readClient =
      customReadClient ||
      createPublicClient({
        chain: monadTestnet,
        transport: fallback([
          http(env.RPC_PRIMARY_URL, { timeout: 10000 }),
          http(env.RPC_FALLBACK_URL, { timeout: 10000 }),
        ]),
      });

    // Dedicated send client: primary RPC only, retryCount: 0 to prevent double sends
    this.sendClient =
      customSendClient ||
      createPublicClient({
        chain: monadTestnet,
        transport: http(env.RPC_PRIMARY_URL, { retryCount: 0, timeout: 15000 }),
      });

    if (customAccount) {
      this.account = customAccount;
      this.relayerAddress = customAccount.address;
    } else if (env.RELAYER_PRIVATE_KEY) {
      const rawKey = env.RELAYER_PRIVATE_KEY.replace(/^0x/, '');
      if (rawKey.length !== 64 || !/^[0-9a-fA-F]+$/.test(rawKey)) {
        throw new RpcSanitizedError(
          'MALFORMED_PRIVATE_KEY',
          'RELAYER_PRIVATE_KEY must be a valid 32-byte hexadecimal string'
        );
      }
      const formattedKey = (`0x${rawKey}`) as Hex;
      this.account = privateKeyToAccount(formattedKey);
      this.relayerAddress = this.account.address;
    } else if (!env.MOCK_PAYMENT_EXECUTOR) {
      throw new RpcSanitizedError(
        'MISSING_PRIVATE_KEY',
        'RELAYER_PRIVATE_KEY is required in real testnet mode'
      );
    } else {
      this.relayerAddress = env.RELAYER_ADDRESS || '0x836DF4117d96B860939627B7288a0e5C51fEFD53';
    }
  }

  public getRelayerAddress(): string {
    return this.relayerAddress;
  }

  public getReadClient(): PublicClient {
    return this.readClient;
  }

  public getSendClient(): PublicClient {
    return this.sendClient;
  }

  // Helper for audit logging substate transitions
  private auditSubstateChange(
    proposalId: string,
    fromSubstate: ProposalExecutionSubstate | null,
    toSubstate: ProposalExecutionSubstate,
    nonce: number | null,
    txHash: string | null,
    details?: string
  ) {
    auditRepo.log({
      proposal_id: proposalId,
      actor_type: 'system',
      action: 'execution_substate_changed',
      details: {
        from_substate: fromSubstate || 'none',
        to_substate: toSubstate,
        nonce: nonce ?? undefined,
        tx_hash: txHash || undefined,
        details: details || undefined,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Nonce Recovery & Reconcile Sweep on Startup
  // Rule 2: nextNonce = max(chain count, highest stored nonce + 1)
  // ---------------------------------------------------------------------------
  public async initializeNonce(): Promise<void> {
    try {
      if (this.readClient.getChainId) {
        const chainId = await this.readClient.getChainId();
        if (chainId !== 10143) {
          throw new RpcSanitizedError(
            'CHAIN_ID_MISMATCH',
            `Connected RPC reported chainId ${chainId}, but Monad testnet requires 10143`
          );
        }
      }

      const chainCount = await this.readClient.getTransactionCount({
        address: getAddress(this.relayerAddress),
        blockTag: 'latest',
      });

      const highestStored = proposalsRepo.getHighestExecutionNonce();
      const calculatedNonce = Math.max(
        Number(chainCount),
        highestStored !== null ? highestStored + 1 : 0
      );

      this.nextNonce = calculatedNonce;
      this.isNonceAmbiguous = false;

      logger.info({ nextNonce: this.nextNonce, chainCount }, 'Monad relayer nonce initialized');

      // Run reconcile sweep across any pending proposals before accepting new real sends
      await this.runReconcileSweep();
    } catch (err: any) {
      const sanitized = sanitizeError(err);
      logger.error({ errCode: sanitized.code }, 'Failed to initialize relayer nonce');
      throw new RpcSanitizedError(sanitized.code, `Nonce initialization failed: ${sanitized.message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Reconcile Sweep for Unresolved Proposals
  // ---------------------------------------------------------------------------
  public async runReconcileSweep(): Promise<void> {
    const unreconciled = proposalsRepo.listUnreconciled();
    if (unreconciled.length === 0) return;

    if (env.PAUSE_REAL_TRANSFERS) {
      logger.info({ count: unreconciled.length }, 'Startup reconcile sweep skipped real rebroadcast: PAUSE_REAL_TRANSFERS is true');
      for (const p of unreconciled) {
        auditRepo.log({
          proposal_id: p.id,
          actor_type: 'system',
          action: 'reconcile_sweep_paused',
          proposal_hash: p.proposal_hash,
          details: { reason: 'PAUSE_REAL_TRANSFERS is active' },
        });
      }
      return;
    }

    logger.info({ count: unreconciled.length }, 'Running reconcile sweep for submitted proposals');

    for (const proposal of unreconciled) {
      if (!proposal.execution_tx_hash) continue;
      try {
        const ageMs = Date.now() - new Date(proposal.created_at).getTime();
        if (ageMs > env.MAX_REBROADCAST_AGE_MS) {
          proposalsRepo.updateExecutionSubstate(proposal.id, 'not_found_needs_review', {
            execution_error: `Rebroadcast skipped: proposal age (${Math.round(ageMs / 1000)}s) exceeds MAX_REBROADCAST_AGE_MS (${env.MAX_REBROADCAST_AGE_MS / 1000}s)`,
          });
          this.auditSubstateChange(
            proposal.id,
            proposal.execution_substate,
            'not_found_needs_review',
            proposal.execution_nonce,
            proposal.execution_tx_hash as `0x${string}`,
            `Rebroadcast skipped due to age (${Math.round(ageMs / 1000)}s > ${env.MAX_REBROADCAST_AGE_MS / 1000}s); marked for review`
          );
          continue;
        }

        // Check if nonce was already consumed on-chain by another transaction
        if (proposal.execution_nonce !== null) {
          // Prefer a single node (sendClient targeting primary RPC without fallback) for nonce and receipt reads
          const clientToUse = this.sendClient || this.readClient;
          const onChainCount = await clientToUse
            .getTransactionCount({
              address: getAddress(this.relayerAddress),
              blockTag: 'latest',
            })
            .catch(() => null);

          if (onChainCount !== null && BigInt(proposal.execution_nonce) < onChainCount) {
            // Nonce consumed. Check if our tx receipt exists on this same node:
            let receipt = await clientToUse
              .getTransactionReceipt({
                hash: proposal.execution_tx_hash as `0x${string}`,
              })
              .catch(() => null);

            // Retry receipt lookup once after a short delay to account for node replication lag
            if (!receipt) {
              await new Promise((r) => setTimeout(r, 500));
              receipt = await clientToUse
                .getTransactionReceipt({
                  hash: proposal.execution_tx_hash as `0x${string}`,
                })
                .catch(() => null);
            }

            if (!receipt) {
              proposalsRepo.updateExecutionSubstate(proposal.id, 'not_found_needs_review', {
                execution_error: `Nonce ${proposal.execution_nonce} was already consumed on-chain (latest count: ${onChainCount}) by another transaction; stored hash will never appear.`,
              });
              this.auditSubstateChange(
                proposal.id,
                proposal.execution_substate,
                'not_found_needs_review',
                proposal.execution_nonce,
                proposal.execution_tx_hash as `0x${string}`,
                `Nonce ${proposal.execution_nonce} consumed on-chain by another transaction; stored hash will never appear.`
              );
              continue;
            }
          }
        }

        // If proposal has stored signed bytes and was in awaiting_broadcast or broadcasted_unknown,
        // rebroadcast identical stored bytes.
        if (
          proposal.execution_signed_tx &&
          (proposal.execution_substate === 'awaiting_broadcast' || proposal.execution_substate === 'broadcasted_unknown')
        ) {
          await this.sendClient
            .sendRawTransaction({
              serializedTransaction: proposal.execution_signed_tx as Hex,
            })
            .catch((err) => {
              const msg = (err?.message || '').toLowerCase();
              if (!/already known|nonce too low|replacement underpriced|already imported|known transaction/i.test(msg)) {
                logger.warn({ proposalId: proposal.id, err: msg }, 'Rebroadcast returned error');
              }
            });
        }
        await this.reconcilePayment(proposal);
      } catch (err: any) {
        logger.warn({ proposalId: proposal.id, err: sanitizeError(err).message }, 'Reconcile sweep check failed');
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Pre-flight Validations
  // ---------------------------------------------------------------------------
  private async validatePreSend(proposal: Proposal): Promise<{
    recipientAddress: `0x${string}`;
    amountWei: bigint;
    gasPrice: bigint;
  }> {
    // 0. State source validation: must be 'approved'
    if (proposal.status !== 'approved') {
      throw new RpcSanitizedError(
        'INVALID_PROPOSAL_STATUS',
        `Proposal must be in 'approved' status to execute (current: ${proposal.status})`
      );
    }

    // 1. Circuit breaker
    if (env.PAUSE_REAL_TRANSFERS) {
      throw new RpcSanitizedError(
        'TRANSFERS_PAUSED',
        'Real testnet transfers are currently paused by operator (PAUSE_REAL_TRANSFERS=true)'
      );
    }

    // 2. Fail closed on stuck transactions (Rule 3)
    const stuck = proposalsRepo.getStuckProposals();
    if (stuck.length > 0 && !env.OPERATOR_OVERRIDE_ALLOW_SENDS) {
      throw new RpcSanitizedError(
        'STUCK_TRANSACTIONS_BLOCK',
        `Real transfers are blocked: Proposal ${stuck[0].id} is in stuck state '${stuck[0].execution_substate}'. Resolve stuck transactions or set OPERATOR_OVERRIDE_ALLOW_SENDS=true to proceed.`
      );
    }

    // 3. Check ambiguous nonce state
    if (this.isNonceAmbiguous && !env.OPERATOR_OVERRIDE_ALLOW_SENDS) {
      throw new RpcSanitizedError(
        'NONCE_AMBIGUOUS_BLOCK',
        'Real transfers are blocked: A previous broadcast returned an ambiguous result. Reconcile pending transfers before broadcasting new ones.'
      );
    }

    // 4. Asset check
    if (proposal.asset !== 'MON') {
      throw new RpcSanitizedError(
        'UNSUPPORTED_ASSET',
        `Real Monad testnet executor only supports native 'MON', received '${proposal.asset}'`
      );
    }

    // 5. Recipient validation
    if (!proposal.recipient_wallet || !isAddress(proposal.recipient_wallet)) {
      throw new RpcSanitizedError(
        'INVALID_RECIPIENT_WALLET',
        'Recipient wallet address is invalid or not registered'
      );
    }
    let recipientAddress: `0x${string}`;
    try {
      recipientAddress = getAddress(proposal.recipient_wallet);
    } catch {
      throw new RpcSanitizedError(
        'INVALID_RECIPIENT_WALLET',
        'Recipient wallet address has invalid checksum or is malformed'
      );
    }
    const relayerAddress = getAddress(this.relayerAddress);

    if (recipientAddress === relayerAddress) {
      throw new RpcSanitizedError(
        'SELF_TRANSFER_DISALLOWED',
        'Recipient address cannot be the relayer address'
      );
    }

    // 6. Contract recipient rejection (Rule 4)
    const bytecode = await this.readClient.getBytecode({ address: recipientAddress }).catch(() => null);
    if (bytecode && bytecode !== '0x') {
      throw new RpcSanitizedError(
        'CONTRACT_RECIPIENT_REJECTED',
        `Recipient ${recipientAddress} is a smart contract. Direct transfers to contracts are rejected to prevent gas limit failures.`
      );
    }

    // 7. Max single transfer safety cap
    const amountWei = BigInt(proposal.amount);
    const maxCapWei = parseUnits(env.MAX_TESTNET_TRANSFER_MON.toString(), 18);
    if (amountWei > maxCapWei) {
      throw new RpcSanitizedError(
        'TRANSFER_EXCEEDS_CAP',
        `Transfer amount (${proposal.display_amount} MON) exceeds testnet safety cap of ${env.MAX_TESTNET_TRANSFER_MON} MON`
      );
    }

    // 8. Global daily limit (Rule 5)
    const rollingGlobalWei = proposalsRepo.getRolling24hGlobalTotalAmount('MON');
    const globalLimitWei = parseUnits(env.GLOBAL_DAILY_LIMIT_MON.toString(), 18);
    if (rollingGlobalWei + amountWei > globalLimitWei) {
      throw new RpcSanitizedError(
        'GLOBAL_DAILY_LIMIT_EXCEEDED',
        `Transfer would exceed global daily limit of ${env.GLOBAL_DAILY_LIMIT_MON} MON across all relayer sends (Current 24h: ${formatUnits(rollingGlobalWei, 18)} MON)`
      );
    }

    // 9. Relayer balance covers amount + gas limit upfront: amount + gasLimit * maxFeePerGas
    // On Monad, gasPrice reads from current block state. A 1.25x buffer protects against fluctuations.
    const balance = await this.readClient.getBalance({ address: relayerAddress });
    const rawGasPrice = await this.readClient.getGasPrice();
    const gasPrice = (rawGasPrice * 125n) / 100n; // 1.25x buffer used identically for balance check and signature
    const gasLimit = 21000n;
    const maxFeePerGas = gasPrice;
    const totalRequiredWei = amountWei + (gasLimit * maxFeePerGas);

    if (balance < totalRequiredWei) {
      throw new RpcSanitizedError(
        'INSUFFICIENT_RELAYER_BALANCE',
        `Relayer balance (${formatUnits(balance, 18)} MON) is insufficient to cover amount + gasLimit * maxFeePerGas (${formatUnits(totalRequiredWei, 18)} MON)`
      );
    }

    return { recipientAddress, amountWei, gasPrice };
  }

  // ---------------------------------------------------------------------------
  // Primary Execution Method (Write-Ahead Persistence)
  // ---------------------------------------------------------------------------
  public async executePayment(proposal: Proposal): Promise<ExecutionReceipt> {
    if (!this.account) {
      throw new RpcSanitizedError('MISSING_ACCOUNT', 'Relayer signing account is not configured');
    }

    // Pre-flight checks (verifies proposal.status === 'approved', pause, balance, recipient)
    const { recipientAddress, amountWei, gasPrice } = await this.validatePreSend(proposal);

    // Mutex lock covers nonce assignment through eth_sendRawTransaction
    const unlock = await this.mutex.acquire();
    let assignedNonce: number | null = null;
    let txHash: `0x${string}` | null = null;

    try {
      // Re-check global daily limit INSIDE mutex lock to prevent concurrent races
      const rollingGlobalWei = proposalsRepo.getRolling24hGlobalTotalAmount('MON');
      const globalLimitWei = parseUnits(env.GLOBAL_DAILY_LIMIT_MON.toString(), 18);
      if (rollingGlobalWei + amountWei > globalLimitWei) {
        throw new RpcSanitizedError(
          'GLOBAL_DAILY_LIMIT_EXCEEDED',
          `Transfer would exceed global daily limit of ${env.GLOBAL_DAILY_LIMIT_MON} MON across all relayer sends (Current 24h: ${formatUnits(rollingGlobalWei, 18)} MON)`
        );
      }

      if (this.nextNonce === null) {
        await this.initializeNonce();
      }
      assignedNonce = this.nextNonce!;

      // WRITE-AHEAD PERSISTENCE:
      // 1. Sign transaction locally using viem
      // 2. Compute deterministic transaction hash via keccak256
      // 3. Atomically persist txHash, nonce, signed bytes with substate 'awaiting_broadcast' and status 'submitted'
      const serializedTransaction = await this.account.signTransaction({
        to: recipientAddress,
        value: amountWei,
        gas: 21000n,
        gasPrice,
        nonce: assignedNonce,
        chainId: monadTestnet.id,
      });
      txHash = keccak256(serializedTransaction);

      // Single atomic SQL UPDATE inside writeAheadSubmission (requires status = 'approved')
      const persisted = proposalsRepo.writeAheadSubmission(proposal.id, {
        status: 'submitted',
        execution_substate: 'awaiting_broadcast',
        execution_tx_hash: txHash,
        execution_nonce: assignedNonce,
        execution_signed_tx: serializedTransaction,
      });

      if (!persisted) {
        throw new RpcSanitizedError(
          'WRITE_AHEAD_FAILED',
          `Proposal ${proposal.id} could not be updated to submitted; invalid state or concurrent conflict`
        );
      }
      this.auditSubstateChange(proposal.id, null, 'awaiting_broadcast', assignedNonce, txHash);

      // Raw broadcast to Monad node (using dedicated send client with retryCount: 0)
      try {
        await this.sendClient.sendRawTransaction({ serializedTransaction });

        // Node accepted broadcast! Increment local nonce
        this.nextNonce = assignedNonce + 1;
        this.isNonceAmbiguous = false;
        proposalsRepo.updateExecutionSubstate(proposal.id, 'broadcasted_unknown');
        this.auditSubstateChange(proposal.id, 'awaiting_broadcast', 'broadcasted_unknown', assignedNonce, txHash);
      } catch (broadcastErr: any) {
        const sanitized = sanitizeError(broadcastErr);
        const classification = classifyBroadcastError(broadcastErr);

        if (classification.type === 'nonce_too_low') {
          // "nonce too low" on a FIRST broadcast: resync nextNonce from chain (max of chain count and highest stored + 1)
          await this.initializeNonce();
          this.isNonceAmbiguous = false;
          proposalsRepo.updateExecutionSubstate(proposal.id, 'broadcasted_unknown', {
            execution_error: sanitized.message,
          });
          this.auditSubstateChange(
            proposal.id,
            'awaiting_broadcast',
            'broadcasted_unknown',
            assignedNonce,
            txHash,
            `Broadcast returned 'nonce too low'; resynced nextNonce to ${this.nextNonce} from chain and falling through to on-chain receipt lookup`
          );
        } else if (classification.type === 'already_known') {
          this.nextNonce = Math.max(this.nextNonce ?? 0, assignedNonce + 1);
          this.isNonceAmbiguous = false;
          proposalsRepo.updateExecutionSubstate(proposal.id, 'broadcasted_unknown', {
            execution_error: sanitized.message,
          });
          this.auditSubstateChange(
            proposal.id,
            'awaiting_broadcast',
            'broadcasted_unknown',
            assignedNonce,
            txHash,
            `Broadcast returned '${sanitized.message}'; falling through to on-chain receipt lookup`
          );
        } else if (classification.type === 'definite_rejection') {
          if (classification.reason === 'insufficient_funds') {
            // Node-reported insufficient funds: retryable (back to awaiting_approval, audited), consistent with relayer-balance rule
            this.nextNonce = assignedNonce;
            this.isNonceAmbiguous = false;
            proposalsRepo.updateStatus(proposal.id, ['submitted'], 'awaiting_approval', {
              execution_tx_hash: null,
              execution_signed_tx: null,
              execution_substate: null,
              execution_nonce: null,
              execution_error: sanitized.message,
            });
            auditRepo.log({
              proposal_id: proposal.id,
              actor_type: 'system',
              action: 'approval_failed',
              proposal_hash: proposal.proposal_hash,
              details: {
                error: sanitized.message,
                code: 'INSUFFICIENT_RELAYER_BALANCE',
                reason: 'Node reported insufficient funds on broadcast; reverted to awaiting_approval',
              },
            });
            throw new RpcSanitizedError(
              'INSUFFICIENT_RELAYER_BALANCE',
              `Broadcast rejected by node: ${sanitized.message}`,
              503
            );
          } else {
            // Terminal definite rejection (invalid signature, intrinsic gas too low, etc.)
            this.nextNonce = assignedNonce;
            this.isNonceAmbiguous = false;
            proposalsRepo.updateStatus(proposal.id, ['submitted'], 'failed', {
              execution_tx_hash: null,
              execution_signed_tx: null,
              execution_substate: null,
              execution_error: sanitized.message,
            });
            auditRepo.log({
              proposal_id: proposal.id,
              actor_type: 'system',
              action: 'execution_failed',
              proposal_hash: proposal.proposal_hash,
              details: { error: sanitized.message, code: sanitized.code },
            });
            throw new RpcSanitizedError(
              'BROADCAST_DEFINITE_REJECTION',
              `Broadcast rejected by node: ${sanitized.message}`
            );
          }
        } else {
          // (d) Ambiguous failure (transport timeout, reset, HTTP 5xx, or unrecognized error):
          // Lock relayer, keep hash stored, proposal in broadcasted_unknown.
          // Approve on an ambiguous broadcast must return a success-but-pending response, NOT an error!
          this.isNonceAmbiguous = true;
          proposalsRepo.updateExecutionSubstate(proposal.id, 'broadcasted_unknown', {
            execution_error: sanitized.message,
          });
          this.auditSubstateChange(
            proposal.id,
            'awaiting_broadcast',
            'broadcasted_unknown',
            assignedNonce,
            txHash,
            `Ambiguous broadcast result: ${sanitized.message}; pending on-chain reconciliation`
          );
        }
      }
    } finally {
      // Release mutex immediately after broadcast response (or error)
      unlock();
    }

    // Non-blocking background finality polling
    this.pollForFinality(
      proposal.id,
      txHash!,
      assignedNonce,
      proposal.amount,
      env.MONAD_FINALITY_CONFIRMATION_TIMEOUT_MS,
      env.NOT_FOUND_WINDOW_MS
    ).catch(() => {});

    // Return immediately once broadcast is acknowledged or ambiguous, unblocking HTTP caller with success-but-pending response
    return {
      status: 'submitted',
      txHash: txHash!,
      network: 'Monad Testnet',
      asset: 'MON',
      amount: proposal.amount,
      isSimulated: false,
      timestamp: new Date().toISOString(),
      explorerLink: `${env.EXPLORER_BASE_URL}/tx/${txHash}`,
      details: this.isNonceAmbiguous
        ? 'Broadcast returned an ambiguous result; transfer is pending on-chain reconciliation.'
        : 'Transaction broadcasted; awaiting finality confirmation.',
    };
  }

  // ---------------------------------------------------------------------------
  // Robust Finality Polling (Rule 1)
  // - Single-flighted per proposal ID to prevent duplicate concurrent polling
  // - Re-fetches receipt on every poll
  // - If seen receipt disappears, reverts substate to broadcasted_unknown
  // - Verifies receipt.blockNumber <= finalizedBlockNumber
  // - Verifies receipt.blockHash === finalizedBlock.hash
  // - Compare-and-swap (CAS) on proposal status ensures single state transition and single audit event
  // ---------------------------------------------------------------------------
  public async pollForFinality(
    proposalId: string,
    txHash: `0x${string}`,
    nonce: number,
    amount: string,
    timeoutMs: number = env.MONAD_FINALITY_CONFIRMATION_TIMEOUT_MS,
    notFoundWindowMs: number = env.NOT_FOUND_WINDOW_MS
  ): Promise<ExecutionReceipt> {
    const existing = this.activeReconciles.get(proposalId);
    if (existing) {
      return existing;
    }

    const promise = (async () => {
      try {
        return await this.executePollForFinality(proposalId, txHash, nonce, amount, timeoutMs, notFoundWindowMs);
      } finally {
        this.activeReconciles.delete(proposalId);
      }
    })();

    this.activeReconciles.set(proposalId, promise);
    return promise;
  }

  private async executePollForFinality(
    proposalId: string,
    txHash: `0x${string}`,
    nonce: number,
    amount: string,
    timeoutMs: number,
    notFoundWindowMs: number
  ): Promise<ExecutionReceipt> {
    const startTime = Date.now();
    let seenReceipt: any = null;
    let currentSubstate: ProposalExecutionSubstate = 'broadcasted_unknown';
    const pollIntervalMs = 1000;

    while (Date.now() - startTime < timeoutMs) {
      // 1. Re-fetch receipt on every poll
      const receipt = await this.readClient
        .getTransactionReceipt({ hash: txHash })
        .catch(() => null);

      if (seenReceipt && !receipt) {
        // Receipt disappeared between polls (speculative block dropped / reorged)
        if (currentSubstate !== 'broadcasted_unknown') {
          currentSubstate = 'broadcasted_unknown';
          proposalsRepo.updateExecutionSubstate(proposalId, 'broadcasted_unknown');
          this.auditSubstateChange(
            proposalId,
            'included_pending_finality',
            'broadcasted_unknown',
            nonce,
            txHash,
            'Receipt disappeared between polls; reverting to broadcasted_unknown'
          );
        }
        seenReceipt = null;
      } else if (receipt) {
        if (!seenReceipt) {
          seenReceipt = receipt;
          currentSubstate = 'included_pending_finality';
          proposalsRepo.updateExecutionSubstate(proposalId, 'included_pending_finality');
          this.auditSubstateChange(
            proposalId,
            'broadcasted_unknown',
            'included_pending_finality',
            nonce,
            txHash
          );
        }

        // 2. Fetch finalized block height
        const finalizedBlock = await this.readClient
          .getBlock({ blockTag: 'finalized' })
          .catch(() => null);

        if (finalizedBlock && receipt.blockNumber <= finalizedBlock.number) {
          // 3. Confirm receipt blockHash matches finalized chain blockHash at that height
          const blockAtReceipt =
            receipt.blockNumber === finalizedBlock.number
              ? finalizedBlock
              : await this.readClient
                  .getBlock({ blockNumber: receipt.blockNumber })
                  .catch(() => null);

          if (blockAtReceipt && receipt.blockHash === blockAtReceipt.hash) {
            // Block is irreversibly finalized! Read status
            const isSuccess = receipt.status === 'success';
            const explorerLink = `${env.EXPLORER_BASE_URL}/tx/${txHash}`;
            const finalizedBlockNumber = Number(finalizedBlock.number);
            const finalizedBlockHash = finalizedBlock.hash;

            proposalsRepo.updateExecutionSubstate(proposalId, null);

            // Compare-and-swap on status: transition only from 'submitted'
            const transitionSuccess = proposalsRepo.updateStatus(proposalId, ['submitted'], isSuccess ? 'confirmed' : 'failed', {
              execution_tx_hash: txHash,
              execution_substate: null,
            });

            this.isNonceAmbiguous = false;

            if (transitionSuccess) {
              const currentProp = proposalsRepo.getById(proposalId);
              auditRepo.log({
                proposal_id: proposalId,
                actor_type: 'system',
                action: isSuccess ? 'execution_confirmed' : 'execution_failed',
                proposal_hash: currentProp?.proposal_hash,
                details: {
                  tx_hash: txHash,
                  network: 'Monad Testnet',
                  is_simulated: false,
                  finalized_block_number: finalizedBlockNumber,
                  finalized_block_hash: finalizedBlockHash,
                  explorer_link: explorerLink,
                  error: isSuccess ? undefined : 'Transaction reverted on-chain during execution',
                },
              });
            }

            return {
              status: isSuccess ? 'confirmed' : 'failed',
              txHash,
              network: 'Monad Testnet',
              asset: 'MON',
              amount,
              isSimulated: false,
              timestamp: new Date().toISOString(),
              finalizedBlockNumber,
              finalizedBlockHash,
              explorerLink,
              details: isSuccess
                ? `Settled and finalized on Monad testnet block #${finalizedBlockNumber}`
                : 'Transaction reverted on-chain during execution',
            };
          } else if (blockAtReceipt && receipt.blockHash !== blockAtReceipt.hash) {
            // Block replaced by canonical finalized chain! Revert substate
            currentSubstate = 'broadcasted_unknown';
            proposalsRepo.updateExecutionSubstate(proposalId, 'broadcasted_unknown');
            this.auditSubstateChange(
              proposalId,
              'included_pending_finality',
              'broadcasted_unknown',
              nonce,
              txHash,
              'Block hash mismatch against finalized block; reverting to broadcasted_unknown'
            );
            seenReceipt = null;
          }
        }
      }

      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    // Polling timeout expired before finality confirmation
    if (seenReceipt) {
      proposalsRepo.updateExecutionSubstate(proposalId, 'included_pending_finality');
      this.auditSubstateChange(
        proposalId,
        currentSubstate,
        'included_pending_finality',
        nonce,
        txHash,
        `Finality polling reached ${timeoutMs}ms limit; proposal remains included awaiting finality (resumable via reconcile)`
      );
      return {
        status: 'unknown',
        txHash,
        network: 'Monad Testnet',
        asset: 'MON',
        amount,
        isSimulated: false,
        timestamp: new Date().toISOString(),
        explorerLink: `${env.EXPLORER_BASE_URL}/tx/${txHash}`,
        details: 'Transaction included speculatively; finality pending and will be resolved by reconcile.',
      };
    } else {
      const elapsedMs = Date.now() - startTime;
      const isWindowExpired = elapsedMs >= notFoundWindowMs;

      if (isWindowExpired) {
        proposalsRepo.updateExecutionSubstate(proposalId, 'not_found_needs_review');
        this.auditSubstateChange(
          proposalId,
          currentSubstate,
          'not_found_needs_review',
          nonce,
          txHash,
          `Transaction hash not found on chain after ${notFoundWindowMs}ms search window; held for operator review`
        );
      } else {
        proposalsRepo.updateExecutionSubstate(proposalId, 'broadcasted_unknown');
        this.auditSubstateChange(
          proposalId,
          currentSubstate,
          'broadcasted_unknown',
          nonce,
          txHash,
          `Receipt not observed within ${timeoutMs}ms finality timeout; remains in broadcasted_unknown pending reconcile`
        );
      }

      return {
        status: 'unknown',
        txHash,
        network: 'Monad Testnet',
        asset: 'MON',
        amount,
        isSimulated: false,
        timestamp: new Date().toISOString(),
        explorerLink: `${env.EXPLORER_BASE_URL}/tx/${txHash}`,
        details: isWindowExpired
          ? 'Transaction hash not found on chain after search timeout. Proposal held for operator review.'
          : 'Transaction receipt not observed within finality window; pending on-chain discovery.',
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Reconcile Payment (Looks up stored hash on chain; NEVER resubmits or re-signs)
  // Single-flighted per proposal ID
  // ---------------------------------------------------------------------------
  public async reconcilePayment(proposal: Proposal): Promise<ExecutionReceipt> {
    if (!proposal.execution_tx_hash) {
      throw new RpcSanitizedError(
        'MISSING_TX_HASH',
        'Cannot reconcile proposal without an execution transaction hash'
      );
    }

    const txHash = proposal.execution_tx_hash as `0x${string}`;
    const nonce = proposal.execution_nonce || 0;

    auditRepo.log({
      proposal_id: proposal.id,
      actor_type: 'system',
      action: 'reconcile_sweep',
      details: {
        tx_hash: txHash,
        substate: proposal.execution_substate || 'unknown',
        details: 'Operator/system triggered reconcile check',
      },
    });

    // Delegated to single-flighted pollForFinality with CAS
    return await this.pollForFinality(proposal.id, txHash, nonce, proposal.amount, 5000);
  }
}
