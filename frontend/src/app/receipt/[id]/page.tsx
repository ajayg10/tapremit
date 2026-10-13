'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { getStoredUser } from '@/lib/auth';
import { Proposal, TimelineEvent, User } from '@/lib/types';
import Navbar from '@/components/Navbar';
import AuditTimeline from '@/components/AuditTimeline';
import {
  CheckCircle2,
  ArrowLeft,
  FileText,
  ShieldCheck,
  Cpu,
  Clock,
  Sparkles,
  ExternalLink
} from 'lucide-react';

export default function ReceiptTimelinePage() {
  const params = useParams();
  const router = useRouter();
  const proposalId = params?.id as string;

  const [user, setUser] = useState<User | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stored = getStoredUser();
    if (!stored) {
      router.push('/');
      return;
    }
    setUser(stored);

    if (proposalId) {
      loadReceiptAndTimeline(proposalId);
    }
  }, [proposalId, router]);

  const loadReceiptAndTimeline = async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getTimeline(id);
      setProposal(data.proposal);
      setTimeline(data.timeline);
    } catch (err: any) {
      setError(err.message || 'Failed to load receipt and timeline.');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col">
        <Navbar user={user} />
        <div className="flex-1 flex items-center justify-center p-8 text-gray-400 text-sm">
          Loading receipt and cryptographic audit chain...
        </div>
      </div>
    );
  }

  if (error || !proposal) {
    return (
      <div className="flex-1 flex flex-col">
        <Navbar user={user} />
        <div className="flex-1 max-w-xl mx-auto p-6 flex flex-col items-center justify-center text-center space-y-4">
          <p className="text-sm text-rose-400">{error || 'Receipt not found.'}</p>
          <button
            onClick={() => router.push('/dashboard')}
            className="px-4 py-2 rounded-xl bg-gray-800 text-white text-xs"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const isSimulated = proposal.status === 'simulated_confirmed' || (proposal.execution_tx_hash?.startsWith('sim_'));

  return (
    <div className="flex-1 flex flex-col">
      <Navbar user={user} />

      <div className="flex-1 max-w-3xl w-full mx-auto p-4 sm:p-6 space-y-6">
        {/* Navigation */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => router.push('/dashboard')}
            className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </button>

          <span className="text-xs text-gray-500 font-mono">
            ID: {proposal.id.slice(0, 8)}...
          </span>
        </div>

        {/* Receipt Header Card */}
        <div className="rounded-2xl bg-gradient-to-br from-gray-900 via-gray-900 to-indigo-950/30 border border-gray-800 p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-950/80 border border-emerald-700/80 flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-emerald-400" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-white">Payment Receipt</h1>
                <p className="text-xs text-gray-400">
                  Approved by Human · Settled by Payment Executor
                </p>
              </div>
            </div>

            {/* SIMULATED label requirement */}
            {isSimulated ? (
              <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-amber-950 text-amber-300 border border-amber-700 flex items-center gap-1.5 shadow-sm shadow-amber-950">
                <Cpu className="w-3.5 h-3.5 text-amber-400" />
                SIMULATED EXECUTION
              </span>
            ) : (
              <span className="px-3 py-1 rounded-full text-xs font-bold uppercase bg-emerald-950 text-emerald-300 border border-emerald-700">
                ON-CHAIN CONFIRMED
              </span>
            )}
          </div>

          {/* Prominent Simulated disclaimer if mock */}
          {isSimulated && (
            <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-800/60 text-xs text-amber-300 space-y-1">
              <div className="font-semibold flex items-center gap-1.5">
                <span>⚠️ Simulated Prototype Notice:</span>
              </div>
              <p className="text-amber-200/80 text-[11px] leading-relaxed">
                This transaction was executed in <strong>Mock Mode</strong>. The receipt hash is labelled simulated (<code className="font-mono">{proposal.execution_tx_hash || 'sim_0x...'}</code>). No real tokens or private keys were touched on Monad testnet.
              </p>
            </div>
          )}

          {/* Summary Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
            <div className="p-3.5 rounded-xl bg-gray-950 border border-gray-800">
              <span className="text-[11px] text-gray-500 uppercase font-semibold">Amount</span>
              <div className="text-lg font-bold text-white mt-0.5">
                {proposal.display_amount || proposal.amount} <span className="text-emerald-400">{proposal.asset}</span>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-gray-950 border border-gray-800">
              <span className="text-[11px] text-gray-500 uppercase font-semibold">Recipient</span>
              <div className="text-base font-bold text-white mt-0.5">
                @{proposal.recipient_handle}
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-gray-950 border border-gray-800">
              <span className="text-[11px] text-gray-500 uppercase font-semibold">Network</span>
              <div className="text-sm font-semibold text-purple-300 mt-0.5">
                {proposal.network}
              </div>
            </div>
          </div>

          {/* Tx Reference */}
          {proposal.execution_tx_hash && (
            <div className="p-3 rounded-xl bg-gray-950 border border-gray-800 text-xs flex flex-wrap items-center justify-between gap-2">
              <span className="text-gray-400 font-medium">Execution Reference / Tx:</span>
              <span className="font-mono text-gray-300 text-[11px]">
                {proposal.execution_tx_hash}
              </span>
            </div>
          )}
        </div>

        {/* Audit Timeline Section */}
        <div className="rounded-2xl bg-gray-900/90 border border-gray-800 p-6 space-y-5">
          <div className="flex items-center justify-between border-b border-gray-800 pb-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-indigo-400" />
              <h2 className="text-base font-bold text-white">Full Audit Timeline & Provenance</h2>
            </div>
            <span className="text-xs text-gray-400 font-medium">
              {timeline.length} logged events
            </span>
          </div>

          <AuditTimeline timeline={timeline} proposalHash={proposal.proposal_hash} />
        </div>

        {/* Quick action: Return to Dashboard */}
        <div className="flex justify-center pt-2">
          <button
            onClick={() => router.push('/dashboard')}
            className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-md shadow-indigo-600/25 transition"
          >
            Create Another Payment Proposal
          </button>
        </div>
      </div>
    </div>
  );
}
