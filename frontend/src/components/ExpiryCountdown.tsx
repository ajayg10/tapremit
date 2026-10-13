'use client';

import React, { useEffect, useState } from 'react';
import { Timer, AlertOctagon } from 'lucide-react';

interface ExpiryCountdownProps {
  expiresAt: string;
  onExpire?: () => void;
}

export default function ExpiryCountdown({ expiresAt, onExpire }: ExpiryCountdownProps) {
  const [secondsRemaining, setSecondsRemaining] = useState<number>(0);

  useEffect(() => {
    const updateCountdown = () => {
      const remaining = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
      setSecondsRemaining(remaining);
      if (remaining === 0 && onExpire) {
        onExpire();
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [expiresAt, onExpire]);

  const isExpired = secondsRemaining <= 0;
  const minutes = Math.floor(secondsRemaining / 60);
  const seconds = secondsRemaining % 60;
  const formattedTime = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  if (isExpired) {
    return (
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-950/60 border border-rose-800 text-rose-300 text-xs font-semibold">
        <AlertOctagon className="w-4 h-4 text-rose-400" />
        <span>Proposal Expired (TTL Exceeded)</span>
      </div>
    );
  }

  const isWarning = secondsRemaining < 120;

  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
        isWarning
          ? 'bg-amber-950/50 border-amber-800/80 text-amber-300 animate-pulse'
          : 'bg-indigo-950/40 border-indigo-800/50 text-indigo-300'
      }`}
    >
      <Timer className={`w-4 h-4 ${isWarning ? 'text-amber-400' : 'text-indigo-400'}`} />
      <span>
        Expires in: <strong className="font-mono text-white text-sm">{formattedTime}</strong>
      </span>
    </div>
  );
}
