'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { getStoredUser } from '@/lib/auth';
import { User, Proposal } from '@/lib/types';
import Navbar from '@/components/Navbar';
import {
  Sparkles,
  Send,
  History,
  AlertCircle,
  HelpCircle,
  ArrowUpRight,
  ShieldCheck,
  Coins,
  Clock,
  CheckCircle2,
  XCircle,
  Ban
} from 'lucide-react';

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [instruction, setInstruction] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [fetchingTxs, setFetchingTxs] = useState<boolean>(true);
  const [recentProposals, setRecentProposals] = useState<Proposal[]>([]);
  const [clarificationMessage, setClarificationMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Suggested instructions for judges to test different flows
  const SAMPLE_PROMPTS = [
    {
      label: 'Standard Proposal (Passes Policy)',
      prompt: 'send 5 test AUSD to @riya for design work',
      tag: 'Normal Flow',
    },
    {
      label: 'Exceeds Per-Tx Limit ($60 > $50)',
      prompt: 'send 60 AUSD to @bob_builder for urgent server costs',
      tag: 'Policy Deny',
    },
    {
      label: 'Ambiguous Prompt (Missing Details)',
      prompt: 'send some money to my friend please',
      tag: 'Clarification',
    },
  ];

  useEffect(() => {
    const stored = getStoredUser();
    if (!stored) {
      router.push('/');
      return;
    }
    setUser(stored);

    // Fetch user proposals
    loadRecentProposals();
  }, [router]);

  const loadRecentProposals = async () => {
    setFetchingTxs(true);
    try {
      const data = await api.listProposals(10);
      setRecentProposals(data.proposals);
    } catch {
      // Non-fatal, show empty list
    } finally {
      setFetchingTxs(false);
    }
  };

  const handleSubmitInstruction = async (promptToUse?: string) => {
    const text = promptToUse || instruction;
    if (!text.trim()) return;

    setLoading(true);
    setError(null);
    setClarificationMessage(null);

    try {
      const res = await api.proposePayment(text);

      if (res.type === 'PROPOSAL' && res.proposal) {
        router.push(`/proposal/${res.proposal.id}`);
      } else if (res.type === 'CLARIFICATION') {
        setClarificationMessage(res.message || 'The AI agent needs additional information to construct a valid payment proposal.');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to submit instruction to agent.');
    } finally {
      setLoading(false);
    }
  };

  // Compute simulated settled spend for display
  const settledSpent = recentProposals
    .filter((p) => ['confirmed', 'simulated_confirmed'].includes(p.status))
    .reduce((acc, p) => acc + parseFloat(p.display_amount || '0'), 0);
  const simulatedBalance = Math.max(0, 100 - settledSpent).toFixed(2);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'simulated_confirmed':
      case 'confirmed':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-800">
            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            SIMULATED CONFIRMED
          </span>
        );
      case 'awaiting_approval':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950/80 text-amber-300 border border-amber-800">
            <Clock className="w-3 h-3 text-amber-400" />
            AWAITING APPROVAL
          </span>
        );
      case 'denied':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-rose-950/80 text-rose-300 border border-rose-800">
            <Ban className="w-3 h-3 text-rose-400" />
            POLICY DENIED
          </span>
        );
      case 'rejected':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-gray-800 text-gray-400 border border-gray-700">
            <XCircle className="w-3 h-3 text-gray-400" />
            REJECTED
          </span>
        );
      case 'expired':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-rose-950/40 text-rose-400 border border-rose-900/60">
            EXPIRED
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-gray-800 text-gray-300 uppercase">
            {status}
          </span>
        );
    }
  };

  if (!user) {
    return null;
  }

  return (
    <div className="flex-1 flex flex-col">
      <Navbar user={user} />

      <div className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6 space-y-6">
        {/* Top banner: Balance card & Policy overview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Simulated Balance card */}
          <div className="md:col-span-2 rounded-2xl bg-gradient-to-br from-indigo-950/40 via-gray-900 to-gray-900 border border-indigo-900/40 p-6 relative overflow-hidden">
            <div className="absolute right-0 top-0 translate-x-4 -translate-y-4 w-36 h-36 bg-indigo-500/10 rounded-full blur-2xl"></div>

            <div className="space-y-4 relative z-10">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
                  <Coins className="w-4 h-4 text-emerald-400" />
                  Account Balance
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase bg-amber-950 text-amber-300 border border-amber-700/60">
                  SIMULATED
                </span>
              </div>

              <div>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
                    {simulatedBalance}
                  </span>
                  <span className="text-lg font-bold text-emerald-400">AUSD</span>
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  Simulated initial 100.00 AUSD test balance · Monad Testnet demo asset
                </p>
              </div>

              <div className="flex flex-wrap gap-4 pt-3 border-t border-gray-800 text-xs text-gray-400">
                <div>
                  <span className="text-gray-500">24h Limit:</span>{' '}
                  <strong className="text-gray-200">200.00 AUSD</strong>
                </div>
                <div>
                  <span className="text-gray-500">Per-Tx Limit:</span>{' '}
                  <strong className="text-gray-200">50.00 AUSD</strong>
                </div>
                <div>
                  <span className="text-gray-500">24h Spent:</span>{' '}
                  <strong className="text-indigo-400">{settledSpent.toFixed(2)} AUSD</strong>
                </div>
              </div>
            </div>
          </div>

          {/* Core Principle reminder card */}
          <div className="rounded-2xl bg-gray-900 border border-gray-800 p-6 flex flex-col justify-between space-y-3">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-indigo-400">
                <ShieldCheck className="w-5 h-5" />
                <h3 className="font-bold text-sm text-white">Trust-First Architecture</h3>
              </div>
              <p className="text-xs text-gray-400 leading-relaxed">
                The AI agent holds <strong>zero spending authority</strong>. Natural-language requests are transformed into structured proposals evaluated by a deterministic rule engine.
              </p>
            </div>
            <div className="text-[11px] font-mono p-2.5 rounded-lg bg-gray-950 border border-gray-800 text-gray-400">
              Agent proposes → Policy checks → Human signs
            </div>
          </div>
        </div>

        {/* Center: Agent instruction input box */}
        <div className="rounded-2xl bg-gray-900/90 border border-gray-800 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white">Payment Instruction Box</h2>
                <p className="text-xs text-gray-400">Instruct the agent in natural English to create a payment proposal.</p>
              </div>
            </div>
          </div>

          {/* Quick chips */}
          <div className="space-y-1.5">
            <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider block">
              Quick Judge Test Prompts:
            </span>
            <div className="flex flex-wrap gap-2">
              {SAMPLE_PROMPTS.map((sample, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    setInstruction(sample.prompt);
                    setClarificationMessage(null);
                    setError(null);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-gray-800/80 hover:bg-gray-800 border border-gray-700 hover:border-indigo-500 text-xs text-gray-200 transition text-left flex items-center gap-2 group"
                >
                  <span className="font-mono text-indigo-300">"{sample.prompt}"</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700/60 text-gray-300 font-semibold">
                    {sample.tag}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Textarea */}
          <div className="space-y-2">
            <div className="relative">
              <textarea
                rows={3}
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="e.g. send 5 test AUSD to @riya for design work"
                className="w-full p-4 rounded-xl bg-gray-950 border border-gray-800 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-indigo-500 resize-none font-sans"
              />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[11px] text-gray-500">
                Recipient must be a registered handle (@riya, @bob_builder, etc.)
              </span>

              <button
                type="button"
                onClick={() => handleSubmitInstruction()}
                disabled={loading || !instruction.trim()}
                className="px-5 py-2.5 rounded-xl font-semibold text-xs bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/30 flex items-center gap-2 transition disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <Sparkles className="w-4 h-4 animate-spin" />
                    Analyzing Instruction...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    Propose Payment
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Clarification state card */}
          {clarificationMessage && (
            <div className="p-4 rounded-xl bg-purple-950/40 border border-purple-800/60 text-xs space-y-2">
              <div className="flex items-center gap-2 text-purple-300 font-bold">
                <HelpCircle className="w-4 h-4" />
                Clarification Required by AI Agent
              </div>
              <p className="text-gray-300">{clarificationMessage}</p>
              <p className="text-gray-500 text-[11px]">
                Tip: Include amount (e.g. 5 AUSD) and recipient handle (e.g. @riya) in your prompt.
              </p>
            </div>
          )}

          {/* Error alert */}
          {error && (
            <div className="p-4 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-300 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Recent Transactions List */}
        <div className="rounded-2xl bg-gray-900/90 border border-gray-800 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-indigo-400" />
              <h3 className="font-bold text-base text-white">Recent Proposals & Transactions</h3>
            </div>
            <button
              onClick={loadRecentProposals}
              className="text-xs text-gray-400 hover:text-white transition"
            >
              Refresh
            </button>
          </div>

          {fetchingTxs ? (
            <div className="py-8 text-center text-xs text-gray-500">Loading proposals...</div>
          ) : recentProposals.length === 0 ? (
            <div className="py-8 text-center text-xs text-gray-500">
              No payment proposals yet. Use the prompt box above to create one.
            </div>
          ) : (
            <div className="divide-y divide-gray-800/80">
              {recentProposals.map((item) => (
                <div
                  key={item.id}
                  onClick={() => {
                    if (['confirmed', 'simulated_confirmed', 'submitted'].includes(item.status)) {
                      router.push(`/receipt/${item.id}`);
                    } else {
                      router.push(`/proposal/${item.id}`);
                    }
                  }}
                  className="py-3.5 flex items-center justify-between gap-4 hover:bg-gray-800/40 px-2 rounded-lg cursor-pointer transition"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-white">
                        {item.display_amount} {item.asset}
                      </span>
                      <span className="text-xs text-gray-400">to @{item.recipient_handle}</span>
                      {getStatusBadge(item.status)}
                    </div>
                    <p className="text-xs text-gray-400">
                      {item.purpose || 'No purpose specified'} ·{' '}
                      <span className="font-mono text-[11px]">
                        {new Date(item.created_at).toLocaleString()}
                      </span>
                    </p>
                  </div>

                  <ArrowUpRight className="w-4 h-4 text-gray-500 group-hover:text-white transition" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
