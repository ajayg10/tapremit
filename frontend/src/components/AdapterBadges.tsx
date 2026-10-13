'use client';

import React, { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { SystemStatus } from '@/lib/types';
import { Bot, ShieldCheck, KeyRound, Cpu } from 'lucide-react';

export default function AdapterBadges() {
  const [status, setStatus] = useState<SystemStatus | null>(null);

  useEffect(() => {
    let mounted = true;
    api.getSystemStatus()
      .then((data) => {
        if (mounted) setStatus(data);
      })
      .catch(() => {
        // Fallback default mock values if backend not reachable yet
        if (mounted) {
          setStatus({
            adapters: { auth: 'mock', llm: 'mock', executor: 'mock', chain: 'mock' },
            limits: { perTxLimitAusd: 50, dailyLimitAusd: 200, proposalTtlSeconds: 900 },
            network: { name: 'Monad Testnet', chainId: 10143, asset: 'AUSD' },
          });
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="w-full bg-[#0d121f] border-b border-gray-800 text-xs py-2 px-4">
      <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-gray-400 uppercase tracking-wider text-[10px]">Active Adapters:</span>
          
          {/* LLM Adapter */}
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-medium bg-indigo-950/80 text-indigo-300 border border-indigo-700/50">
            <Bot className="w-3 h-3 text-indigo-400" />
            LLM: <strong className="text-white">{status?.adapters.llm === 'mock' ? 'Mock (Deterministic)' : 'Real'}</strong>
          </span>

          {/* Executor Adapter */}
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-medium bg-emerald-950/80 text-emerald-300 border border-emerald-700/50">
            <Cpu className="w-3 h-3 text-emerald-400" />
            Executor: <strong className="text-white">{status?.adapters.executor === 'mock' ? 'Mock (Simulated)' : 'Testnet'}</strong>
          </span>

          {/* Auth Adapter */}
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-medium bg-amber-950/80 text-amber-300 border border-amber-700/50">
            <KeyRound className="w-3 h-3 text-amber-400" />
            Auth: <strong className="text-white">{status?.adapters.auth === 'mock' ? 'Demo Auth' : 'WebAuthn Passkey'}</strong>
          </span>
        </div>

        {/* Network & Limits */}
        <div className="flex items-center gap-3 text-gray-400">
          <span className="hidden sm:inline-flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-monad-light" />
            Policy Limits: max <span className="text-white font-medium">{status?.limits.perTxLimitAusd ?? 50} AUSD/tx</span> · <span className="text-white font-medium">{status?.limits.dailyLimitAusd ?? 200} AUSD/day</span>
          </span>
          <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-purple-950/60 text-purple-300 border border-purple-800/40">
            Monad Testnet (10143)
          </span>
        </div>
      </div>
    </div>
  );
}
