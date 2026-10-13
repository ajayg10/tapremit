import readline from 'readline';
import { isAddress, getAddress, parseUnits, formatUnits } from 'viem';
import { env } from '../config/env';
import { MonadPaymentExecutor, sanitizeError } from '../adapters/payment/MonadPaymentExecutor';
import { proposalsRepo } from '../db/proposals.repository';
import { runMigrations } from '../db/migrate';
import { v4 as uuidv4 } from 'uuid';

async function main() {
  console.log('====================================================');
  console.log('        TapRemit Monad Testnet Manual Transfer      ');
  console.log('====================================================\n');

  // 1. Interactive terminal check (Requirement 7)
  if (!process.stdin.isTTY) {
    console.error('❌ Refusing to run: Interactive terminal (TTY) is required.');
    process.exit(1);
  }

  // 2. Circuit breaker check (Requirement 7)
  if (env.PAUSE_REAL_TRANSFERS) {
    console.error('❌ Refusing to run: PAUSE_REAL_TRANSFERS is active in configuration.');
    process.exit(1);
  }

  // 3. Relayer key check
  if (!env.RELAYER_PRIVATE_KEY) {
    console.error('❌ Missing RELAYER_PRIVATE_KEY in environment.');
    process.exit(1);
  }

  // Ensure DB schema is up to date
  runMigrations();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (query: string): Promise<string> =>
    new Promise((resolve) => rl.question(query, resolve));

  try {
    const executor = new MonadPaymentExecutor();
    const relayerAddress = executor.getRelayerAddress();

    console.log(`📡 Network: Monad Testnet (Chain ID: 10143)`);
    console.log(`👛 Relayer Address: ${relayerAddress}`);
    console.log(`🛡️  Safety Cap: Max ${env.MAX_TESTNET_TRANSFER_MON} MON per transfer\n`);

    const recipientInput = (await question('Enter recipient address (0x...): ')).trim();
    if (!isAddress(recipientInput)) {
      console.error('❌ Invalid recipient address format.');
      rl.close();
      process.exit(1);
    }
    const recipient = getAddress(recipientInput);

    if (recipient === getAddress(relayerAddress)) {
      console.error('❌ Recipient cannot be the relayer address.');
      rl.close();
      process.exit(1);
    }

    const amountInput = (await question('Enter amount in MON (e.g. 0.01): ')).trim();
    const amountNum = parseFloat(amountInput);
    if (isNaN(amountNum) || amountNum <= 0) {
      console.error('❌ Invalid amount. Must be a positive number.');
      rl.close();
      process.exit(1);
    }

    // Enforce max safety cap (Requirement 7)
    if (amountNum > env.MAX_TESTNET_TRANSFER_MON) {
      console.error(
        `❌ Refusing to run: Amount (${amountNum} MON) exceeds safety cap of ${env.MAX_TESTNET_TRANSFER_MON} MON.`
      );
      rl.close();
      process.exit(1);
    }

    const amountWei = parseUnits(amountNum.toString(), 18).toString();

    console.log('\n--- TRANSFER SUMMARY ---');
    console.log(`Network:   Monad Testnet (10143)`);
    console.log(`From:      ${relayerAddress}`);
    console.log(`To:        ${recipient}`);
    console.log(`Amount:    ${amountNum} MON (${amountWei} wei)`);
    console.log(`Gas Limit: 21,000 (standard native transfer)`);
    console.log('------------------------\n');

    const confirmation = (await question('Type "CONFIRM" to broadcast transaction: ')).trim();
    rl.close();

    if (confirmation !== 'CONFIRM') {
      console.log('⚠️ Transfer cancelled by operator.');
      process.exit(0);
    }

    console.log('\n🚀 Broadcasting to Monad testnet...');

    // Create an operational proposal record to track this transfer
    const proposalId = uuidv4();
    const proposal = proposalsRepo.create({
      id: proposalId,
      user_id: 'operator',
      origin: 'user',
      recipient_handle: 'manual_operator',
      recipient_id: 'operator',
      recipient_wallet: recipient,
      amount: amountWei,
      display_amount: amountNum.toString(),
      asset: 'MON',
      network: 'Monad Testnet',
      purpose: 'Manual operator testnet transfer',
      proposal_hash: 'manual_' + proposalId,
      status: 'submitted',
      policy_decision: 'ALLOW',
      policy_reasons: JSON.stringify([{ rule: 'MANUAL_OPERATOR', decision: 'ALLOW' }]),
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      execution_mode: 'testnet',
    });

    const receipt = await executor.executePayment(proposal);

    // Print explorer link ONLY after broadcast succeeds (Requirement 7)
    console.log('\n✅ Broadcast succeeded!');
    console.log(`🔗 MonadVision Explorer: ${receipt.explorerLink}`);
    console.log(`Tx Hash: ${receipt.txHash}`);
    console.log(`Status:  ${receipt.status.toUpperCase()}`);

    if (receipt.finalizedBlockNumber) {
      console.log(`Finalized Block: #${receipt.finalizedBlockNumber}`);
      console.log(`Finalized Hash:  ${receipt.finalizedBlockHash}`);
    }

    console.log('\n🎉 Transfer settlement cycle complete.');
  } catch (err: any) {
    const sanitized = sanitizeError(err);
    console.error(`\n❌ Transfer failed [${sanitized.code}]: ${sanitized.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
