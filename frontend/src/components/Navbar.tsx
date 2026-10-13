'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { User } from '@/lib/types';
import { removeAuthToken } from '@/lib/auth';
import { Shield, LogOut, ArrowLeftRight, UserCircle } from 'lucide-react';

interface NavbarProps {
  user?: User | null;
}

export default function Navbar({ user }: NavbarProps) {
  const router = useRouter();

  const handleSignOut = () => {
    removeAuthToken();
    router.push('/');
  };

  return (
    <nav className="w-full bg-[#111827]/90 backdrop-blur-md border-b border-gray-800 sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        {/* Brand */}
        <Link href={user ? '/dashboard' : '/'} className="flex items-center gap-2.5 group">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 via-monad-purple to-purple-500 flex items-center justify-center shadow-lg shadow-indigo-500/20 group-hover:scale-105 transition-transform">
            <ArrowLeftRight className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-lg text-white tracking-tight">TapRemit</span>
              <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-purple-900/60 text-purple-300 border border-purple-700/50">
                Monad
              </span>
            </div>
            <p className="text-[11px] text-gray-400 -mt-0.5">Trust-First Programmable Payments</p>
          </div>
        </Link>

        {/* User context */}
        {user ? (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800/80 border border-gray-700 text-sm">
              <UserCircle className="w-4 h-4 text-indigo-400" />
              <div className="text-left">
                <span className="font-semibold text-white">@{user.handle}</span>
                <span className="text-xs text-gray-400 ml-1.5">({user.display_name})</span>
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
              Demo Environment (No Real Money)
            </span>
          </div>
        )}
      </div>
    </nav>
  );
}
