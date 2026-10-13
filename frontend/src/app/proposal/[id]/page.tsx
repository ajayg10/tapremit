'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { getStoredUser } from '@/lib/auth';
import { Proposal, User } from '@/lib/types';
import Navbar from '@/components/Navbar';
import PolicyEvaluationCard from '@/components/PolicyEvaluationCard';
import ExpiryCountdown from '@/components/ExpiryCountdown';
import {
  ShieldAlert,
  CheckCircle,
  XCircle,
  ArrowLeft,
  Bot,
  UserCheck,
  Hash,
  AlertTriangle,
  Lock,
  Ban,
  Clock,
  Copy,
  Check
} from 'lucide-react';

export default function ProposalReviewPage() {
  const params = useParams();
  const router = useRouter();
  const proposalId = params?.id as string;

  const [user, setUser] = useState<User | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [recipientName, setRecipientName] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmNewRecipient, setConfirmNewRecipient] = useState<boolean>(false);
  const [copiedAddress, setCopiedAddress] = useState<boolean>(false);

  useEffect(() => {
    const stored = getStoredUser();
    if (!stored) {
      router.push('/');
      return;
    }
    setUser(stored);

    if (proposalId) {
      loadProposal(proposalId);
    }
  }, [proposalId, router]);

  const loadProposal = async (id: string, preserveError: boolean = false) => {
    setLoading(true);
    if (!preserveError) {
      setError(null);
    }
    try {
      const data = await api.getProposal(id);
      setProposal(data);

      // Resolve recipient display name
      if (data.recipient_handle) {
        api.lookupUser(data.recipient_handle)
          .then((res) => setRecipientName(res.display_name))
          .catch(() => setRecipientName(data.recipient_handle));
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load proposal details.');
    } finally {
      setLoading(false);
    }
  };

  const requiresFirstTimeConfirmation = proposal?.policy_reasons?.some(
    (r) => r.rule === 'KNOWN_CONTACT_POLICY' && r.decision === 'REQUIRE_APPROVAL'
  ) || false;

  const handleApprove = async () => {
    if (!proposal) return;
    setActionLoading(true);
    setError(null);

    if (requiresFirstTimeConfirmation && !confirmNewRecipient) {
      setError('Please check the confirmation box: "I confirm this is a first-time recipient" before approving.');
      setActionLoading(false);
      return;
    }

    try {
      // Approve sends canonical proposal_hash and confirm_new_recipient flag
      await api.approveProposal(proposal.id, proposal.proposal_hash, confirmNewRecipient);
      router.push(`/receipt/${proposal.id}`);
    } catch (err: any) {
      setError(err.message || 'Failed to approve proposal.');
      // Refresh proposal without wiping the error banner
      loadProposal(proposal.id, true);
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    if (!proposal) return;
    setActionLoading(true);
    setError(null);

    try {
      await api.rejectProposal(proposal.id, 'Explicit human rejection from dashboard review screen');
      loadProposal(proposal.id);
    } catch (err: any) {
      setError(err.message || 'Failed to reject proposal.');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col">
        <Navbar user={user} />
        <div className="flex-1 flex items-center justify-center p-8 text-gray-400 text-sm">
          Loading proposal and policy breakdown...
        </div>
      </div>
    );
  }

  if (error && !proposal) {
    return (
      <div className="flex-1 flex flex-col">
        <Navbar user={user} />
        <div className="flex-1 max-w-xl mx-auto p-6 flex flex-col items-center justify-center text-center space-y-4">
          <div className="p-3 rounded-full bg-rose-950/60 border border-rose-800 text-rose-400">
            <XCircle className="w-8 h-8" />
          </div>
          <h2 className="text-lg font-bold text-white">Proposal Not Available</h2>
          <p className="text-xs text-gray-400">{error}</p>
          <button
            onClick={() => router.push('/dashboard')}
            className="px-4 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-xs text-white"
          >
            Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (!proposal) return null;

  const isAwaiting = proposal.status === 'awaiting_approval';
  const isSettled = ['confirmed', 'simulated_confirmed', 'submitted'].includes(proposal.status);
  const isDenied = proposal.status === 'denied';
  const isRejected = proposal.status === 'rejected';
  const isExpired = proposal.status === 'expired';

  return (
    <div className="flex-1 flex flex-col">
      <Navbar user={user} />

      <div className="flex-1 max-w-3xl w-full mx-auto p-4 sm:p-6 space-y-6">
        {/* Back navigation */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => router.push('/dashboard')}
            className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </button>

          {isAwaiting && (
            <ExpiryCountdown
              expiresAt={proposal.expires_at}
              onExpire={() => loadProposal(proposal.id)}
            />
          )}
        </div>

        {/* State Banner if not awaiting */}
        {isDenied && (
          <div className="p-4 rounded-xl bg-rose-950/70 border border-rose-800 text-rose-300 text-xs space-y-1">
            <div className="flex items-center gap-2 font-bold text-rose-200">
              <Ban className="w-4 h-4 text-rose-400" />
              Proposal Denied by Deterministic Policy Engine
            </div>
            <p className="text-gray-300">
              This instruction violated safety limits (e.g. per-transaction or rolling 24-hour daily budget). It is permanently terminal and cannot be approved.
            </p>
          </div>
        )}

        {isRejected && (
          <div className="p-4 rounded-xl bg-gray-800/80 border border-gray-700 text-gray-300 text-xs space-y-1">
            <div className="flex items-center gap-2 font-bold text-white">
              <XCircle className="w-4 h-4 text-gray-400" />
              Proposal Rejected by User
            </div>
            <p className="text-gray-400">
              You chose to reject this payment proposal. No funds were transferred.
            </p>
          </div>
        )}

        {isExpired && (
          <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-900/60 text-rose-300 text-xs space-y-1">
            <div className="flex items-center gap-2 font-bold text-rose-300">
              <Clock className="w-4 h-4" />
              Proposal Expired (TTL Timeout)
            </div>
            <p className="text-gray-400">
              This proposal was not approved within the validity window. Create a fresh proposal to try again.
            </p>
          </div>
        )}

        {isSettled && (
          <div className="p-4 rounded-xl bg-emerald-950/60 border border-emerald-800 text-emerald-300 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-400" />
              <span>This proposal was already approved and settled.</span>
            </div>
            <button
              onClick={() => router.push(`/receipt/${proposal.id}`)}
              className="px-3 py-1 rounded bg-emerald-900 hover:bg-emerald-800 text-white font-semibold text-xs"
            >
              View Receipt
            </button>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="p-3.5 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-300 text-xs flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        {/* Main Proposal Card */}
        <div className="rounded-2xl bg-gray-900 border border-gray-800 p-6 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-800 pb-4">
            <div className="flex items-center gap-2">
              <span className="p-2 rounded-lg bg-indigo-950 border border-indigo-800 text-indigo-400">
                <Bot className="w-5 h-5" />
              </span>
              <div>
                <h1 className="text-lg font-bold text-white">Review Payment Proposal</h1>
                <p className="text-xs text-gray-400">
                  Origin: <strong className="text-indigo-300">Proposed by AI agent</strong>
                </p>
              </div>
            </div>

            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-gray-800 text-gray-300 border border-gray-700">
              Status: <span className="uppercase font-mono text-white">{proposal.status}</span>
            </span>
          </div>

          {/* Amount & Recipient Details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Amount */}
            <div className="p-4 rounded-xl bg-gray-950 border border-gray-800 space-y-1">
              <span className="text-xs text-gray-500 uppercase font-semibold tracking-wider">Payment Amount</span>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-extrabold text-white">{proposal.display_amount}</span>
                <span className="text-sm font-bold text-emerald-400">{proposal.asset}</span>
              </div>
              <p className="text-[11px] text-gray-400">
                Network: <strong className="text-gray-200">{proposal.network}</strong>
              </p>
            </div>

            {/* Recipient */}
            <div className="p-4 rounded-xl bg-gray-950 border border-gray-800 space-y-1">
              <span className="text-xs text-gray-500 uppercase font-semibold tracking-wider">Resolved Recipient</span>
              <div className="flex items-center gap-2 pt-1">
                <UserCheck className="w-5 h-5 text-indigo-400" />
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-white text-sm">@{proposal.recipient_handle}</div>
                  <div className="text-xs text-gray-400">{recipientName || 'Resolved User'}</div>
                  {proposal.recipient_wallet && (
                    <div className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-gray-400 bg-gray-900 px-2 py-0.5 rounded border border-gray-800 w-fit">
                      <span>{proposal.recipient_wallet.slice(0, 6)}...{proposal.recipient_wallet.slice(-4)}</span>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(proposal.recipient_wallet!);
                          setCopiedAddress(true);
                          setTimeout(() => setCopiedAddress(false), 2000);
                        }}
                        title="Copy recipient address"
                        className="text-gray-400 hover:text-white transition"
                      >
                        {copiedAddress ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Purpose */}
          <div className="p-4 rounded-xl bg-gray-950 border border-gray-800 space-y-1">
            <span className="text-xs text-gray-500 uppercase font-semibold tracking-wider">Payment Purpose</span>
            <p className="text-sm text-gray-200">{proposal.purpose || 'No purpose declared'}</p>
          </div>

          {/* Canonical Hash Display */}
          <div className="p-4 rounded-xl bg-indigo-950/30 border border-indigo-900/50 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-indigo-300 uppercase tracking-wider flex items-center gap-1.5">
                <Hash className="w-3.5 h-3.5 text-indigo-400" />
                Cryptographic Proposal Hash
              </span>
              <span className="text-[10px] text-indigo-400/80 font-mono">SHA-256</span>
            </div>
            <p className="font-mono text-xs text-indigo-200 break-all bg-gray-950/80 p-2.5 rounded-lg border border-indigo-900/40 select-all">
              {proposal.proposal_hash}
            </p>
            <p className="text-[11px] text-gray-400 leading-relaxed">
              <Lock className="w-3 h-3 inline mr-1 text-indigo-400" />
              Approving sends this exact hash to the server. If any parameter (amount, recipient, network) was mutated after creation, the transaction is rejected instantly.
            </p>
          </div>

          {/* Policy Evaluation breakdown card */}
          <PolicyEvaluationCard
            decision={proposal.policy_decision}
            reasons={proposal.policy_reasons || []}
          />

          {/* Required First-Time Recipient Confirmation Checkbox */}
          {requiresFirstTimeConfirmation && isAwaiting && (
            <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-800/80 flex items-start gap-3">
              <input
                type="checkbox"
                id="confirm_first_time"
                checked={confirmNewRecipient}
                onChange={(e) => {
                  setConfirmNewRecipient(e.target.checked);
                  if (e.target.checked) setError(null);
                }}
                className="mt-0.5 h-4 w-4 rounded border-amber-600 bg-gray-900 text-amber-500 focus:ring-amber-500 cursor-pointer"
              />
              <label htmlFor="confirm_first_time" className="text-xs text-amber-200 cursor-pointer select-none leading-relaxed">
                <span className="font-bold text-amber-300 block mb-0.5">I confirm this is a first-time recipient</span>
                You have not transferred funds to this recipient before. Please verify the recipient handle and wallet address before authorizing the transaction.
              </label>
            </div>
          )}

          {/* Action buttons (only if awaiting approval) */}
          {isAwaiting && (
            <div className="pt-4 border-t border-gray-800 flex flex-col sm:flex-row items-center gap-3">
              <button
                type="button"
                onClick={handleReject}
                disabled={actionLoading}
                className="w-full sm:w-1/3 py-3 px-4 rounded-xl font-semibold text-xs border border-gray-700 bg-gray-800/80 hover:bg-gray-800 text-gray-300 hover:text-white transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <XCircle className="w-4 h-4 text-gray-400" />
                Reject Proposal
              </button>

              <button
                type="button"
                onClick={handleApprove}
                disabled={actionLoading || (requiresFirstTimeConfirmation && !confirmNewRecipient)}
                className="w-full sm:w-2/3 py-3 px-4 rounded-xl font-bold text-sm bg-gradient-to-r from-emerald-600 to-indigo-600 hover:from-emerald-500 hover:to-indigo-500 text-white shadow-lg shadow-emerald-600/25 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {actionLoading ? (
                  <span>Executing Payment...</span>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    Approve & Sign Hash ({proposal.display_amount} {proposal.asset})
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
