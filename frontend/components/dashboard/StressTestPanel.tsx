// components/dashboard/StressTestPanel.tsx
// Business Stress Test Panel for SAKSHAM micro-enterprises.
// Provides deterministic scenario analysis (not prediction) to test enterprise resilience.

'use client';

import React, { useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, AlertOctagon, Info } from 'lucide-react';
import { runStressTest } from '@/lib/api-client';
import type { StressTestResponse } from '@/lib/api-types';
import { cn } from '@/lib/cn';

interface StressTestPanelProps {
  readonly assessmentId: number;
}

function formatINR(val: number): string {
  const rounded = Math.round(val);
  if (rounded < 0) {
    return `-₹${Math.abs(rounded).toLocaleString('en-IN')}`;
  }
  return `₹${rounded.toLocaleString('en-IN')}`;
}

export function StressTestPanel({ assessmentId }: StressTestPanelProps): React.JSX.Element {
  // Scenario Inputs (default scenario: 20% demand fall, 0% price fall, 0% cost increase, 0 competitors)
  const [demand, setDemand] = useState<number>(20);
  const [price, setPrice] = useState<number>(0);
  const [cost, setCost] = useState<number>(0);
  const [competitors, setCompetitors] = useState<number>(0);

  // Execution state
  const [result, setResult] = useState<StressTestResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRunTest(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const response = await runStressTest(assessmentId, {
        demand_shock_pct: demand,
        price_shock_pct: price,
        cost_shock_pct: cost,
        additional_competitors: competitors,
      });
      setResult(response);
    } catch {
      setError('Could not run the stress test. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200/90 bg-white p-5 sm:p-6 shadow-xs space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 pb-1 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-700 border border-amber-200 shadow-2xs">
            <Activity size={20} strokeWidth={2.2} />
          </div>
          <div>
            <h3 className="text-base sm:text-lg font-black text-slate-900 tracking-tight">
              Business Stress Test
            </h3>
            <p className="text-xs text-slate-600 font-medium">
              Test how resilient this business is under adverse conditions. This is a scenario analysis, not a prediction.
            </p>
          </div>
        </div>
      </div>

      {/* Sliders Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 pt-1">
        {/* 1. Demand fall */}
        <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-4 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-slate-800">Demand fall</span>
            <span className="font-black text-slate-900 bg-white px-2 py-0.5 rounded border border-slate-200 shadow-2xs">
              {demand}%
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={40}
            step={1}
            value={demand}
            onChange={(e) => setDemand(Number(e.target.value))}
            className="w-full accent-slate-900 cursor-pointer"
            aria-label="Demand fall percentage"
          />
          <div className="flex justify-between text-[11px] text-slate-600 font-medium">
            <span>0%</span>
            <span>40%</span>
          </div>
        </div>

        {/* 2. Price fall */}
        <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-4 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-slate-800">Price fall</span>
            <span className="font-black text-slate-900 bg-white px-2 py-0.5 rounded border border-slate-200 shadow-2xs">
              {price}%
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={30}
            step={1}
            value={price}
            onChange={(e) => setPrice(Number(e.target.value))}
            className="w-full accent-slate-900 cursor-pointer"
            aria-label="Price fall percentage"
          />
          <div className="flex justify-between text-[11px] text-slate-600 font-medium">
            <span>0%</span>
            <span>30%</span>
          </div>
        </div>

        {/* 3. Cost increase */}
        <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-4 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-slate-800">Cost increase</span>
            <span className="font-black text-slate-900 bg-white px-2 py-0.5 rounded border border-slate-200 shadow-2xs">
              +{cost}%
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={50}
            step={1}
            value={cost}
            onChange={(e) => setCost(Number(e.target.value))}
            className="w-full accent-slate-900 cursor-pointer"
            aria-label="Cost increase percentage"
          />
          <div className="flex justify-between text-[11px] text-slate-600 font-medium">
            <span>0%</span>
            <span>+50%</span>
          </div>
        </div>

        {/* 4. Additional competitors */}
        <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-4 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-slate-800">Additional competitors</span>
            <span className="font-black text-slate-900 bg-white px-2 py-0.5 rounded border border-slate-200 shadow-2xs">
              +{competitors}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={5}
            step={1}
            value={competitors}
            onChange={(e) => setCompetitors(Number(e.target.value))}
            className="w-full accent-slate-900 cursor-pointer"
            aria-label="Additional competitors count"
          />
          <div className="flex justify-between text-[11px] text-slate-600 font-medium">
            <span>0</span>
            <span>+5</span>
          </div>
        </div>
      </div>

      {/* Action Row */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-1">
        <button
          type="button"
          onClick={handleRunTest}
          disabled={loading}
          className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs sm:text-sm font-bold shadow-2xs transition-all disabled:opacity-50 cursor-pointer"
        >
          {loading ? 'Running...' : 'Run stress test'}
        </button>

        {error && (
          <p className="text-xs sm:text-sm font-semibold text-rose-600 flex items-center gap-1.5">
            <AlertOctagon size={16} className="shrink-0" />
            <span>{error}</span>
          </p>
        )}
      </div>

      {/* Results Section */}
      {result && (
        <div className="space-y-5 pt-4 border-t border-slate-100">
          {/* Status and Vulnerability Header */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200/80">
            <div className="flex items-center gap-2.5">
              <span className="text-xs font-bold text-slate-700">Resilience status:</span>
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black uppercase border',
                  result.resilience === 'RESILIENT' &&
                    'bg-emerald-50 text-emerald-700 border-emerald-200',
                  result.resilience === 'SENSITIVE' &&
                    'bg-amber-50 text-amber-700 border-amber-200',
                  result.resilience === 'VULNERABLE' &&
                    'bg-rose-50 text-rose-700 border-rose-200'
                )}
              >
                {result.resilience === 'RESILIENT' && <CheckCircle2 size={14} strokeWidth={2.5} />}
                {result.resilience === 'SENSITIVE' && <AlertTriangle size={14} strokeWidth={2.5} />}
                {result.resilience === 'VULNERABLE' && <AlertOctagon size={14} strokeWidth={2.5} />}
                <span>{result.resilience}</span>
              </span>
            </div>

            {result.primary_vulnerability && (
              <div className="text-xs font-semibold text-slate-700">
                Biggest vulnerability:{' '}
                <span className="font-black text-slate-900 capitalize">
                  {result.primary_vulnerability}
                </span>
              </div>
            )}
          </div>

          {/* Baseline vs Stressed Table */}
          <div className="overflow-x-auto rounded-xl border border-slate-200/90 shadow-2xs">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead className="bg-slate-100/80 text-slate-700 border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-4 font-bold">Metric</th>
                  <th className="py-2.5 px-4 font-bold text-right">Baseline</th>
                  <th className="py-2.5 px-4 font-bold text-right">Stressed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                <tr>
                  <td className="py-2.5 px-4 font-semibold text-slate-800">Revenue</td>
                  <td className="py-2.5 px-4 text-right text-slate-700 font-medium">
                    {formatINR(result.baseline.revenue)}
                  </td>
                  <td className="py-2.5 px-4 text-right text-slate-900 font-bold">
                    {formatINR(result.stressed.revenue)}
                  </td>
                </tr>
                <tr>
                  <td className="py-2.5 px-4 font-semibold text-slate-800">Expenses</td>
                  <td className="py-2.5 px-4 text-right text-slate-700 font-medium">
                    {formatINR(result.baseline.expenses)}
                  </td>
                  <td className="py-2.5 px-4 text-right text-slate-900 font-bold">
                    {formatINR(result.stressed.expenses)}
                  </td>
                </tr>
                <tr>
                  <td className="py-2.5 px-4 font-semibold text-slate-800">Profit</td>
                  <td className="py-2.5 px-4 text-right text-slate-700 font-medium">
                    {formatINR(result.baseline.profit)}
                  </td>
                  <td
                    className={cn(
                      'py-2.5 px-4 text-right font-bold',
                      result.stressed.profit <= 0 ? 'text-rose-600' : 'text-slate-900'
                    )}
                  >
                    {formatINR(result.stressed.profit)}
                  </td>
                </tr>
                <tr className="bg-slate-50/60 font-bold">
                  <td className="py-2.5 px-4 text-slate-900">Cash after EMI</td>
                  <td className="py-2.5 px-4 text-right text-slate-800">
                    {formatINR(result.baseline.cash_after_emi)}
                  </td>
                  <td
                    className={cn(
                      'py-2.5 px-4 text-right font-black',
                      result.stressed.cash_after_emi <= 0 ? 'text-rose-600' : 'text-emerald-700'
                    )}
                  >
                    {formatINR(result.stressed.cash_after_emi)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Demand Breaking Point Callout */}
          {result.breaking_point_demand_pct !== null && result.breaking_point_demand_pct !== undefined && (
            <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-3.5 flex items-center gap-2.5 text-xs text-slate-800">
              <Info size={16} className="text-slate-600 shrink-0" strokeWidth={2.2} />
              <p className="font-semibold leading-relaxed">
                This business can tolerate roughly a {result.breaking_point_demand_pct}% demand fall before monthly cash flow turns negative, holding other assumptions at baseline.
              </p>
            </div>
          )}

          {/* Disclaimer */}
          <p className="text-[11px] text-slate-600 italic text-center sm:text-left">
            {(result.assumptions?.disclaimer as string) ??
              'Scenario analysis based on user-selected hypothetical shocks, not a forecast or prediction.'}
          </p>
        </div>
      )}
    </div>
  );
}
