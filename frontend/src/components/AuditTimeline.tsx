'use client';

import React from 'react';
import { TimelineEvent } from '@/lib/types';
import { Bot, User, ShieldAlert, Cpu, CheckCircle2, Clock } from 'lucide-react';

interface AuditTimelineProps {
  timeline: TimelineEvent[];
  proposalHash?: string;
}

export default function AuditTimeline({ timeline, proposalHash }: AuditTimelineProps) {
  const getActorIcon = (actor: string) => {
    switch (actor) {
      case 'agent':
        return <Bot className="w-4 h-4 text-indigo-400" />;
      case 'policy_engine':
        return <ShieldAlert className="w-4 h-4 text-purple-400" />;
      case 'user':
        return <User className="w-4 h-4 text-amber-400" />;
      case 'system':
      default:
        return <Cpu className="w-4 h-4 text-emerald-400" />;
    }
  };

  const getActorLabel = (actor: string) => {
    switch (actor) {
      case 'agent':
        return 'AI Agent';
      case 'policy_engine':
        return 'Policy Engine';
      case 'user':
        return 'Human Approver';
      case 'system':
      default:
        return 'System / Settlement';
    }
  };

  return (
    <div className="space-y-4">
      {/* Integrity banner */}
      <div className="p-3.5 rounded-xl bg-gray-900 border border-gray-800 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span className="text-gray-300 font-medium">Append-Only Cryptographic Audit Trail Verified</span>
        </div>
        {proposalHash && (
          <span className="text-gray-400 font-mono text-[11px] truncate max-w-[200px]" title={proposalHash}>
            Hash: {proposalHash.slice(0, 10)}...{proposalHash.slice(-8)}
          </span>
        )}
      </div>

      {/* Chronological event list */}
      <div className="relative pl-6 space-y-6 before:content-[''] before:absolute before:left-2.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-gray-800">
        {timeline.map((event, idx) => {
          const isSettled = event.action.includes('confirmed') || event.action.includes('submitted');
          return (
            <div key={idx} className="relative group">
              {/* Dot */}
              <div className="absolute -left-6 top-1 w-5 h-5 rounded-full bg-gray-950 border-2 border-indigo-500/60 flex items-center justify-center">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>
              </div>

              {/* Event card */}
              <div className="p-4 rounded-xl bg-gray-900/80 border border-gray-800 text-xs space-y-2 hover:border-gray-700 transition">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="p-1 rounded bg-gray-800 border border-gray-700">
                      {getActorIcon(event.actor)}
                    </span>
                    <span className="font-semibold text-gray-200">{getActorLabel(event.actor)}</span>
                    <span className="px-2 py-0.5 rounded font-mono text-[10px] bg-gray-800/80 text-gray-400">
                      {event.action}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* SIMULATED label requirement */}
                    {event.isSimulated && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase bg-amber-950/80 text-amber-300 border border-amber-800">
                        SIMULATED
                      </span>
                    )}
                    <span className="text-[11px] text-gray-400 flex items-center gap-1 font-mono">
                      <Clock className="w-3 h-3" />
                      {new Date(event.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                </div>

                <p className="text-gray-300 text-xs leading-relaxed">{event.humanDescription}</p>

                {event.isSimulated && isSettled && (
                  <div className="pt-2 border-t border-gray-800/80 text-[11px] text-amber-400/90 font-medium">
                    ⚠️ Mock settlement: MockPaymentExecutor issued simulated receipt. No funds or on-chain assets moved.
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
