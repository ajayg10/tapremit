'use client';

import React from 'react';
import { RuleOutcome } from '@/lib/types';
import { CheckCircle2, AlertTriangle, XCircle, ShieldCheck } from 'lucide-react';

interface PolicyEvaluationCardProps {
  decision: 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY';
  reasons: RuleOutcome[];
}

export default function PolicyEvaluationCard({ decision, reasons }: PolicyEvaluationCardProps) {
  const getDecisionBadge = () => {
    switch (decision) {
      case 'REQUIRE_APPROVAL':
        return {
          icon: <AlertTriangle className="w-4 h-4 text-amber-400" />,
          label: 'Requires Human Approval',
          color: 'bg-amber-950/60 text-amber-300 border-amber-800/60',
          desc: 'Agent has zero spending authority. Policy mandates explicit human confirmation before funds can move.',
        };
      case 'ALLOW':
        return {
          icon: <CheckCircle2 className="w-4 h-4 text-emerald-400" />,
          label: 'Policy Checks Passed',
          color: 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60',
          desc: 'Instruction complies with all safety policies, within bounds.',
        };
      case 'DENY':
      default:
        return {
          icon: <XCircle className="w-4 h-4 text-rose-400" />,
          label: 'Policy Denied',
          color: 'bg-rose-950/60 text-rose-300 border-rose-800/60',
          desc: 'One or more safety rules were violated. This proposal cannot be executed.',
        };
    }
  };

  const badge = getDecisionBadge();

  return (
    <div className="rounded-xl bg-gray-900/90 border border-gray-800 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-indigo-400" />
          <h3 className="font-semibold text-white text-base">Deterministic Policy Evaluation</h3>
        </div>
        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${badge.color}`}>
          {badge.icon}
          {badge.label}
        </span>
      </div>

      <p className="text-xs text-gray-400">{badge.desc}</p>

      {/* Rules breakdown table */}
      <div className="space-y-2 pt-2 border-t border-gray-800/80">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Individual Safety Rules ({reasons.length}):
        </span>

        <div className="grid gap-2">
          {reasons.map((rule, idx) => {
            const isDeny = rule.decision === 'DENY';
            const isRequire = rule.decision === 'REQUIRE_APPROVAL';
            return (
              <div
                key={idx}
                className={`p-3 rounded-lg border text-xs flex items-start justify-between gap-3 ${
                  isDeny
                    ? 'bg-rose-950/20 border-rose-900/40'
                    : isRequire
                    ? 'bg-amber-950/20 border-amber-900/40'
                    : 'bg-gray-800/50 border-gray-700/50'
                }`}
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-medium text-gray-200">{rule.rule}</span>
                  </div>
                  <p className="text-gray-400">{rule.reason}</p>
                </div>

                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider shrink-0 ${
                    isDeny
                      ? 'bg-rose-900/60 text-rose-300 border border-rose-700/60'
                      : isRequire
                      ? 'bg-amber-900/60 text-amber-300 border border-amber-700/60'
                      : 'bg-emerald-900/60 text-emerald-300 border border-emerald-700/60'
                  }`}
                >
                  {rule.decision}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
