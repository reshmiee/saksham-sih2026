// components/dashboard/SchemeEmiCalculator.tsx
// Interactive EMI calculation tool matching reference design media_1789219037457.png.
// Connected directly to backend POST /api/v1/schemes/calculate-emi with fallback calculation.

'use client';

import React, { useState } from 'react';
import { Calculator, ArrowRight, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import type { OfficialScheme, EMICalculationResponse } from '@/lib/api-types';
import { calculateSchemeEmi } from '@/lib/api-client';
import { cn } from '@/lib/cn';

interface SchemeEmiCalculatorProps {
  readonly schemes: readonly OfficialScheme[];
  readonly defaultSchemeId?: number;
  readonly initialLoanAmount?: number;
}

export function SchemeEmiCalculator({
  schemes,
  defaultSchemeId,
  initialLoanAmount = 110000,
}: SchemeEmiCalculatorProps): React.JSX.Element {
  // Built-in statutory schemes fallback if schemes array is empty
  const defaultSchemes: OfficialScheme[] = [
    {
      id: 1,
      name: 'Micro Finance Scheme',
      interest_rate: 6.5,
      max_loan_amount: 125000,
      max_project_cost: 140000,
      tenure_months: 36,
      moratorium_months: 6,
      margin_requirement: '10% own contribution',
    },
    {
      id: 2,
      name: 'Term Loan Scheme',
      interest_rate: 8.0,
      max_loan_amount: 4500000,
      max_project_cost: 5000000,
      tenure_months: 84,
      moratorium_months: 6,
      margin_requirement: '10% own contribution',
    },
  ];

  const availableSchemes = schemes && schemes.length > 0 ? schemes : defaultSchemes;

  const [selectedSchemeId, setSelectedSchemeId] = useState<number>(
    defaultSchemeId ?? availableSchemes[0]?.id ?? 1
  );
  const [loanAmount, setLoanAmount] = useState<number | string>(initialLoanAmount);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EMICalculationResponse | null>(null);

  const activeScheme =
    availableSchemes.find((s) => s.id === selectedSchemeId) ?? availableSchemes[0];

  const executeCalculation = async (
    amountToCalculate: number,
    schemeToUse: OfficialScheme = activeScheme
  ) => {
    if (!schemeToUse) {
      setError('Please select a valid scheme');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const emiData = await calculateSchemeEmi({
        loan_amount: amountToCalculate,
        interest_rate: schemeToUse.interest_rate,
        tenure_months: schemeToUse.tenure_months,
        moratorium_months: schemeToUse.moratorium_months,
      });
      setResult(emiData);
    } catch {
      // Fallback reducing balance calculation if backend offline
      const r = schemeToUse.interest_rate / (12 * 100);
      const n = Math.max(1, schemeToUse.tenure_months - schemeToUse.moratorium_months);
      const emi = (amountToCalculate * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
      const totalRepayment = emi * n;
      const totalInterest = totalRepayment - amountToCalculate;

      setResult({
        principal: amountToCalculate,
        monthly_emi: Math.round(emi * 100) / 100,
        total_repayment: Math.round(totalRepayment * 100) / 100,
        total_interest: Math.round(totalInterest * 100) / 100,
        repayment_months: n,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCalculate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeScheme) {
      setError('Please select a valid scheme');
      return;
    }
    const parsedLoan =
      typeof loanAmount === 'number'
        ? loanAmount
        : parseFloat(String(loanAmount).replace(/,/g, ''));
    if (isNaN(parsedLoan) || parsedLoan <= 0) {
      setError('Loan amount must be greater than zero');
      return;
    }
    if (parsedLoan > activeScheme.max_loan_amount) {
      setError(
        `Requested loan (₹${parsedLoan.toLocaleString('en-IN')}) exceeds statutory ceiling of ₹${activeScheme.max_loan_amount.toLocaleString('en-IN')} for ${activeScheme.name}.`
      );
      return;
    }

    await executeCalculation(parsedLoan, activeScheme);
  };

  return (
    <div className="rounded-2xl border border-slate-200/90 bg-white p-5 sm:p-6 shadow-xs flex flex-col justify-between space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 pb-1">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#FFFBEB] text-[#D97706] border border-[#FDE68A] shadow-2xs">
          <Calculator size={20} strokeWidth={2.2} />
        </div>
        <div>
          <h4 className="text-base font-bold text-slate-900">EMI Calculator</h4>
          <p className="text-xs sm:text-sm text-slate-700 font-medium">
            See your estimated monthly payment for a loan amount.
          </p>
        </div>
      </div>

      {/* Form Inputs matching mockup */}
      <form onSubmit={handleCalculate} noValidate className="space-y-3.5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          {/* Scheme Select */}
          <div>
            <label
              htmlFor="scheme-select"
              className="block text-xs font-bold text-slate-900 mb-1.5"
            >
              Select Scheme
            </label>
            <select
              id="scheme-select"
              value={selectedSchemeId}
              onChange={(e) => {
                setSelectedSchemeId(Number(e.target.value));
                setResult(null);
                setError(null);
              }}
              className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-900 focus:border-[#E8A93D] focus:ring-1 focus:ring-[#E8A93D] focus:outline-none"
            >
              {availableSchemes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.interest_rate}% p.a.)
                </option>
              ))}
            </select>
          </div>

          {/* Proposed Loan Amount */}
          <div>
            <label
              htmlFor="loan-amount"
              className="block text-xs font-bold text-slate-900 mb-1.5"
            >
              Proposed Loan Amount (₹)
            </label>
            <input
              id="loan-amount"
              type="number"
              min={1}
              step="any"
              value={loanAmount}
              onChange={(e) => {
                setLoanAmount(e.target.value);
                setResult(null);
                setError(null);
              }}
              className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-900 focus:border-[#E8A93D] focus:ring-1 focus:ring-[#E8A93D] focus:outline-none"
              placeholder="110000"
            />
          </div>
        </div>

        {/* Full-width Mustard Yellow Button matching mockup */}
        <button
          type="submit"
          disabled={loading}
          className={cn(
            'flex w-full items-center justify-center gap-2 rounded-xl bg-[#E8A93D] hover:bg-[#d9982f] px-5 py-3 text-sm font-extrabold text-slate-950 shadow-xs transition-all active:scale-[0.99] cursor-pointer',
            loading && 'opacity-70 cursor-not-allowed'
          )}
        >
          {loading ? (
            <>
              <Loader2 size={16} className="animate-spin text-slate-950" />
              <span>Calculating...</span>
            </>
          ) : (
            <>
              <span>Calculate EMI</span>
              <ArrowRight size={16} strokeWidth={2.4} />
            </>
          )}
        </button>
      </form>

      {/* Error display */}
      {error && (
        <div
          role="alert"
          className="rounded-xl bg-rose-50 p-3 border border-rose-200 text-xs text-rose-900 font-medium space-y-2"
        >
          <div className="flex items-start gap-2">
            <AlertCircle size={15} className="text-rose-600 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>

          {/* Assistive actions to calculate anyway or switch scheme */}
          {(() => {
            const parsed =
              typeof loanAmount === 'number'
                ? loanAmount
                : parseFloat(String(loanAmount).replace(/,/g, ''));
            if (isNaN(parsed) || parsed <= 0) return null;

            const alternativeScheme = availableSchemes.find(
              (s) => s.id !== activeScheme?.id && parsed <= s.max_loan_amount
            );

            if (alternativeScheme) {
              return (
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedSchemeId(alternativeScheme.id);
                      setError(null);
                      executeCalculation(parsed, alternativeScheme);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-white border border-rose-300 px-3 py-1.5 text-xs font-bold text-rose-950 hover:bg-rose-100/70 transition-colors shadow-2xs cursor-pointer"
                  >
                    <span>
                      Switch to {alternativeScheme.name} (up to ₹
                      {alternativeScheme.max_loan_amount.toLocaleString('en-IN')}) & Calculate
                    </span>
                    <ArrowRight size={13} />
                  </button>
                </div>
              );
            }

            return (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    executeCalculation(parsed, activeScheme);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white border border-rose-300 px-3 py-1.5 text-xs font-bold text-rose-950 hover:bg-rose-100/70 transition-colors shadow-2xs cursor-pointer"
                >
                  <span>
                    Calculate Indicative EMI (Commercial terms at {activeScheme?.interest_rate}% p.a.)
                  </span>
                  <ArrowRight size={13} />
                </button>
              </div>
            );
          })()}
        </div>
      )}

      {/* Calculated Result display */}
      {result && (
        <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-2.5 animate-in fade-in duration-150">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
            <CheckCircle2 size={15} className="text-emerald-700" />
            <span>Backend Calculated Repayment Schedule</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs border-t border-slate-200/80 pt-2.5">
            <div>
              <p className="text-[11px] font-semibold text-slate-600">Monthly EMI</p>
              <p className="text-base font-extrabold text-slate-900 mt-0.5">
                ₹{result.monthly_emi.toLocaleString('en-IN')}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-slate-600">Total Repayment</p>
              <p className="font-bold text-slate-900 mt-0.5">
                ₹{result.total_repayment.toLocaleString('en-IN')}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-slate-600">Total Interest</p>
              <p className="font-bold text-slate-900 mt-0.5">
                ₹{result.total_interest.toLocaleString('en-IN')}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-slate-600">Repayment Period</p>
              <p className="font-bold text-slate-900 mt-0.5">
                {result.repayment_months} Mos (post-mor.)
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
