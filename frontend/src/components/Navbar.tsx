'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { User, SystemStatus } from '@/lib/types';
import { api } from '@/lib/api';
import { removeAuthToken } from '@/lib/auth';
import { Shield, LogOut, ArrowLeftRight, UserCircle, Activity, AlertOctagon } from 'lucide-react';

interface NavbarProps {
  user?: User | null;
}

export default function Navbar({ user }: NavbarProps) {
  const router = useRouter();
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);

  useEffect(() => {
    api.getSystemStatus()
      .then(setSystemStatus)
      .catch(() => {});
  }, []);

  const handleSignOut = () => {
    removeAuthToken();
    router.push('/');
  };

  const isPaused = systemStatus?.limits?.pauseRealTransfers;
  const isRealChain = systemStatus?.isRealChain;

  return (
    <div className="sticky top-0 z-50">
      {/* Emergency pause banner */}
      {isPaused && (
        <div className="w-full bg-rose-600 text-white font-bold text-xs py-2 px-4 text-center tracking-wide flex items-center justify-center gap-2 shadow-lg">
          <AlertOctagon className="w-4 h-4 shrink-0 animate-bounce" />
          <span>Real on-chain transfers are PAUSED by operator (PAUSE_REAL_TRANSFERS=true). Approvals will return 503 and remain safe.</span>
        </div>
      )}

      <nav className="w-full bg-[#111827]/95 backdrop-blur-md border-b border-gray-800">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          {/* Brand */}
          <Link href={user ? '/dashboard' : '/'} className="flex items-center gap-2.5 group">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 via-monad-purple to-purple-500 flex items-center justify-center shadow-lg shadow-indigo-500/20 group-hover:scale-105 transition-transform">
              <ArrowLeftRight className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-lg text-white tracking-tight">TapRemit</span>
                {systemStatus && (
                  isRealChain ? (
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-700/80 flex items-center gap-1.5 shadow-sm">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                      Monad Testnet (10143) [Live]
                    </span>
                  ) : (
                    <span className="text-[10px] font-semibold tracking-wider px-2 py-0.5 rounded-full bg-amber-950 text-amber-300 border border-amber-800/60">
                      Target network: Monad Testnet (chain adapter: mock)
                    </span>
                  )
                )}
              </div>
              <p className="text-[11px] text-gray-400 -mt-0.5">Trust-First Programmable Payments</p>
            </div>
          </Link>

          {/* System status pills & User context */}
          <div className="flex items-center gap-3">
            {systemStatus && (
              <div className="hidden lg:flex items-center gap-2 text-[11px]">
                <span className="px-2 py-1 rounded bg-gray-900 border border-gray-800 text-gray-300">
                  Asset: <strong className="text-emerald-400">{systemStatus.activeAsset}</strong>
                </span>
                <span className="px-2 py-1 rounded bg-gray-900 border border-gray-800 text-gray-300">
                  Exec: <strong className={systemStatus.adapters.executor === 'testnet' ? 'text-purple-300' : 'text-amber-400'}>{systemStatus.adapters.executor}</strong>
                </span>
                <span className="px-2 py-1 rounded bg-gray-900 border border-gray-800 text-gray-300">
                  Auth: <strong className="text-gray-400">{systemStatus.adapters.auth}</strong>
                </span>
              </div>
            )}

            {user ? (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800/80 border border-gray-700 text-sm">
                  <UserCircle className="w-4 h-4 text-indigo-400" />
                  <div className="text-left">
                    <span className="font-semibold text-white">@{user.handle}</span>
                    <span className="text-xs text-gray-400 ml-1.5 hidden sm:inline">({user.display_name})</span>
                  </div>
                </div>

                <button
                  onClick={handleSignOut}
                  title="Sign Out"
                  className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 border border-transparent hover:border-gray-700 transition"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 text-xs text-amber-400 bg-amber-950/60 border border-amber-800/50 px-2.5 py-1 rounded-full font-medium">
                  <Shield className="w-3.5 h-3.5" />
                  Demo Environment
                </span>
              </div>
            )}
          </div>
        </div>
      </nav>
    </div>
  );
}
