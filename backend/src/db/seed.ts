import { v4 as uuidv4 } from 'uuid';
import { runMigrations } from './migrate';
import { usersRepo } from './users.repository';
import { proposalsRepo } from './proposals.repository';
import { auditRepo } from './audit.repository';
import { computeCanonicalProposalHash } from '../services/proposal.service';

export function seedDemoData() {
  runMigrations();

  console.log('🌱 Seeding demo accounts and contacts...');

  // 1. Alice (Primary demo user / sender)
  let alice = usersRepo.getByHandle('alice_agent');
  if (!alice) {
    alice = usersRepo.create({
      handle: 'alice_agent',
      display_name: 'Alice',
      phone: '+14155552671',
    });
    console.log('  Created user: @alice_agent (Primary Demo Sender)');
  }

  // 2. Riya (Known Contact — has prior settled transaction)
  let riya = usersRepo.getByHandle('riya');
  if (!riya) {
    riya = usersRepo.create({
      handle: 'riya',
      display_name: 'Riya Patel',
      phone: '+14155552672',
    });
    console.log('  Created user: @riya (Known Contact)');
  }

  // 3. Bob (First-Time Recipient — no prior transactions)
  let bob = usersRepo.getByHandle('bob_builder');
  if (!bob) {
    bob = usersRepo.create({
      handle: 'bob_builder',
      display_name: 'Bob Miller',
      phone: '+14155552673',
    });
    console.log('  Created user: @bob_builder (First-Time Recipient)');
  }

  // 4. Charlie (Additional Contact)
  let charlie = usersRepo.getByHandle('charlie');
  if (!charlie) {
    charlie = usersRepo.create({
      handle: 'charlie',
      display_name: 'Charlie Zhang',
      phone: '+14155552674',
    });
    console.log('  Created user: @charlie (Additional Contact)');
  }

  // 5. Check if historical transaction exists between Alice and Riya
  const aliceProposals = proposalsRepo.listByUserId(alice.id, 10);
  if (aliceProposals.length === 0) {
    const historicalId = uuidv4();
    const createdAt = new Date(Date.now() - 3600 * 1000 * 2).toISOString(); // 2 hours ago
    const expiresAt = new Date(Date.now() + 3600 * 1000 * 22).toISOString();
    const amount = '10000000'; // 10 AUSD
    const displayAmount = '10';

    const hash = computeCanonicalProposalHash({
      id: historicalId,
      user_id: alice.id,
      recipient_id: riya.id,
      recipient_handle: riya.handle,
      amount,
      asset: 'AUSD',
      network: 'Monad Testnet',
      origin: 'agent',
      purpose: 'UI design wireframes sprint 1',
      expires_at: expiresAt,
      created_at: createdAt,
    });

    const historicalProposal = proposalsRepo.create({
      id: historicalId,
      user_id: alice.id,
      origin: 'agent',
      recipient_handle: riya.handle,
      recipient_id: riya.id,
      amount,
      display_amount: displayAmount,
      asset: 'AUSD',
      network: 'Monad Testnet',
      purpose: 'UI design wireframes sprint 1',
      proposal_hash: hash,
      status: 'simulated_confirmed',
      policy_decision: 'REQUIRE_APPROVAL',
      policy_reasons: JSON.stringify([
        { rule: 'ASSET_WHITELIST', decision: 'ALLOW', reason: 'Asset is supported (AUSD).' },
        { rule: 'AMOUNT_BOUNDS', decision: 'ALLOW', reason: 'Amount is within valid positive bounds.' },
        { rule: 'PER_TX_LIMIT', decision: 'ALLOW', reason: 'Within per-transaction limit of 50 AUSD.' },
        { rule: 'DAILY_ROLLING_LIMIT', decision: 'ALLOW', reason: 'Within rolling 24-hour limit.' },
      ]),
      expires_at: expiresAt,
      created_at: createdAt,
    });

    // Populate audit chain for the historical transaction
    auditRepo.log({
      proposal_id: historicalProposal.id,
      actor_type: 'agent',
      action: 'instruction_received',
      details: { instruction_length: 38, has_idempotency_key: false },
    });

    auditRepo.log({
      proposal_id: historicalProposal.id,
      actor_type: 'agent',
      action: 'proposal_created',
      proposal_hash: hash,
      details: {
        provider: 'MockLLMAdapter',
        recipient_handle: riya.handle,
        amount: displayAmount,
        asset: 'AUSD',
      },
    });

    auditRepo.log({
      proposal_id: historicalProposal.id,
      actor_type: 'policy_engine',
      action: 'policy_evaluated',
      proposal_hash: hash,
      details: { decision: 'REQUIRE_APPROVAL', reasons_count: 4, outcomes: ['ALLOW', 'ALLOW', 'ALLOW', 'ALLOW'] },
    });

    auditRepo.log({
      proposal_id: historicalProposal.id,
      actor_type: 'user',
      actor_id: alice.id,
      action: 'approved',
      proposal_hash: hash,
      details: {
        approval_method: 'explicit_human_confirmation',
        amount: displayAmount,
        asset: 'AUSD',
        recipient_handle: riya.handle,
      },
    });

    auditRepo.log({
      proposal_id: historicalProposal.id,
      actor_type: 'system',
      action: 'execution_submitted',
      proposal_hash: hash,
      details: { executor: 'MockPaymentExecutor' },
    });

    auditRepo.log({
      proposal_id: historicalProposal.id,
      actor_type: 'system',
      action: 'execution_simulated_confirmed',
      proposal_hash: hash,
      details: {
        tx_hash: 'sim_0x_historical_seed_7721',
        network: 'Monad Testnet',
        is_simulated: true,
      },
    });

    console.log('  Seeded 1 confirmed transaction (@alice_agent -> @riya: 10 AUSD)');
  }

  console.log('✅ Demo seeding complete.');
  console.log('\nAvailable Demo Accounts for Judges:');
  console.log('  1. @alice_agent  (Sender with 10 AUSD prior activity)');
  console.log('  2. @riya         (Known contact recipient)');
  console.log('  3. @bob_builder  (First-time recipient)');
  console.log('  4. @charlie      (Contractor contact)\n');
}

if (require.main === module) {
  seedDemoData();
}
