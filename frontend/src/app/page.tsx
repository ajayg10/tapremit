'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { DEMO_USERS, getStoredUser } from '@/lib/auth';
import Navbar from '@/components/Navbar';
import { ArrowRight, KeyRound, Shield, Sparkles, UserCheck, AlertCircle } from 'lucide-react';

export default function SignInPage() {
  const router = useRouter();
  const [selectedHandle, setSelectedHandle] = useState<string>('alice_agent');
  const [customHandle, setCustomHandle] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);

  useEffect(() => {
    const user = getStoredUser();
    if (user) {
      setCurrentUser(user);
    }
  }, []);

  const handleSignIn = async (handleToUse?: string) => {
    const target = handleToUse || (customHandle.trim() ? customHandle.trim() : selectedHandle);
    if (!target) return;

    setLoading(true);
    setError(null);

    try {
      await api.loginDemo(target);
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Authentication failed. Please verify the handle.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col">
      <Navbar />

      <div className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <div className="max-w-md w-full space-y-6">
          {/* Header */}
          <div className="text-center space-y-2">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-950/80 text-amber-300 border border-amber-800">
              <KeyRound className="w-3.5 h-3.5" />
              Demo Authentication Active
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              Sign In to TapRemit
            </h1>
            <p className="text-sm text-gray-400">
              Select a seeded demo account to test the AI payment proposal flow without hardware passkeys.
            </p>
          </div>

          {/* Active session shortcut */}
          {currentUser && (
            <div className="p-4 rounded-xl bg-indigo-950/40 border border-indigo-800/60 flex items-center justify-between">
              <div>
                <span className="text-xs text-indigo-300 font-medium">Logged in as</span>
                <p className="text-sm font-bold text-white">@{currentUser.handle}</p>
              </div>
              <button
                onClick={() => router.push('/dashboard')}
                className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1 shadow-md shadow-indigo-600/30 transition"
              >
                Go to Dashboard
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Error alert */}
          {error && (
            <div className="p-3.5 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-300 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          {/* Seeded accounts cards */}
          <div className="space-y-3">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider block">
              1-Click Demo Accounts:
            </span>

            <div className="space-y-2">
              {DEMO_USERS.map((user) => {
                const isSelected = selectedHandle === user.handle && !customHandle;
                return (
                  <button
                    key={user.handle}
                    type="button"
                    onClick={() => {
                      setSelectedHandle(user.handle);
                      setCustomHandle('');
                    }}
                    className={`w-full text-left p-3.5 rounded-xl border transition-all flex items-center justify-between ${
                      isSelected
                        ? 'bg-indigo-950/70 border-indigo-500 shadow-md shadow-indigo-950/50'
                        : 'bg-gray-900/80 border-gray-800 hover:border-gray-700'
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white text-sm">@{user.handle}</span>
                        <span className="text-xs text-gray-400">({user.name})</span>
                        {user.badge && (
                          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                            user.badge === 'Recommended'
                              ? 'bg-indigo-900 text-indigo-200 border border-indigo-700'
                              : 'bg-gray-800 text-gray-300'
                          }`}>
                            {user.badge}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400">{user.description}</p>
                    </div>

                    <div className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ml-3 ${
                      isSelected ? 'border-indigo-400 bg-indigo-600' : 'border-gray-600'
                    }`}>
                      {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-white"></span>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom handle option */}
          <div className="space-y-2 pt-2 border-t border-gray-800">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block">
              Or Enter Custom Handle:
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-gray-500 font-mono text-sm">@</span>
              <input
                type="text"
                value={customHandle}
                onChange={(e) => {
                  setCustomHandle(e.target.value);
                  setError(null);
                }}
                placeholder="custom_handle"
                className="w-full pl-8 pr-4 py-2 rounded-xl bg-gray-900 border border-gray-800 text-white text-sm focus:outline-none focus:border-indigo-500 font-mono"
              />
            </div>
          </div>

          {/* Action button */}
          <button
            onClick={() => handleSignIn()}
            disabled={loading}
            className="w-full py-3 px-4 rounded-xl font-semibold text-sm bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white shadow-lg shadow-indigo-600/25 flex items-center justify-center gap-2 transition disabled:opacity-50"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 animate-spin" />
                Signing In...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <UserCheck className="w-4 h-4" />
                Sign In as @{customHandle.trim() || selectedHandle}
              </span>
            )}
          </button>

          {/* Security notice */}
          <p className="text-[11px] text-gray-500 text-center leading-relaxed">
            <Shield className="w-3 h-3 inline mr-1 text-gray-400" />
            Hackathon prototype. Mock auth bypasses FIDO2 authenticator challenges. Zero real private keys or funds involved.
          </p>
        </div>
      </div>
    </div>
  );
}
