import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { StressTestPanel } from '@/components/dashboard/StressTestPanel';
import * as apiClient from '@/lib/api-client';

describe('StressTestPanel Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders title, description, default sliders, and run button', () => {
    render(<StressTestPanel assessmentId={42} />);

    expect(screen.getByText('Business Stress Test')).toBeInTheDocument();
    expect(
      screen.getByText(
        /Test how resilient this business is under adverse conditions/i
      )
    ).toBeInTheDocument();

    expect(screen.getByText('Demand fall')).toBeInTheDocument();
    expect(screen.getByText('20%')).toBeInTheDocument();

    expect(screen.getByText('Price fall')).toBeInTheDocument();
    expect(screen.getByText('Cost increase')).toBeInTheDocument();
    expect(screen.getByText('Additional competitors')).toBeInTheDocument();

    expect(
      screen.getByRole('button', { name: /run stress test/i })
    ).toBeInTheDocument();
  });

  it('allows changing slider values', () => {
    render(<StressTestPanel assessmentId={42} />);

    const demandSlider = screen.getByLabelText('Demand fall percentage') as HTMLInputElement;
    fireEvent.change(demandSlider, { target: { value: '35' } });
    expect(demandSlider.value).toBe('35');
    expect(screen.getByText('35%')).toBeInTheDocument();

    const priceSlider = screen.getByLabelText('Price fall percentage') as HTMLInputElement;
    fireEvent.change(priceSlider, { target: { value: '15' } });
    expect(priceSlider.value).toBe('15');
    expect(screen.getByText('15%')).toBeInTheDocument();

    const costSlider = screen.getByLabelText('Cost increase percentage') as HTMLInputElement;
    fireEvent.change(costSlider, { target: { value: '25' } });
    expect(costSlider.value).toBe('25');
    expect(screen.getByText('+25%')).toBeInTheDocument();

    const compSlider = screen.getByLabelText('Additional competitors count') as HTMLInputElement;
    fireEvent.change(compSlider, { target: { value: '3' } });
    expect(compSlider.value).toBe('3');
    expect(screen.getByText('+3')).toBeInTheDocument();
  });

  it('executes stress test and displays result table, badge, and breaking point', async () => {
    const mockResult: apiClient.StressTestResponse = {
      assessment_id: 42,
      baseline: {
        revenue: 60000,
        expenses: 35000,
        profit: 25000,
        emi: 6000,
        cash_after_emi: 19000,
      },
      stressed: {
        revenue: 43200,
        expenses: 40250,
        profit: 2950,
        emi: 6000,
        cash_after_emi: -3050,
      },
      resilience: 'VULNERABLE',
      impact_breakdown: {
        demand: 9600,
        price: 5400,
        cost: 5250,
        competition: 0,
      },
      primary_vulnerability: 'demand',
      breaking_point_demand_pct: 32.0,
      assumptions: {
        demand_shock_pct: 20,
        price_shock_pct: 10,
        cost_shock_pct: 15,
        additional_competitors: 0,
        disclaimer:
          'Scenario analysis based on user-selected hypothetical shocks, not a forecast or prediction.',
      },
    };

    const spy = vi.spyOn(apiClient, 'runStressTest').mockResolvedValue(mockResult);

    render(<StressTestPanel assessmentId={42} />);

    const runBtn = screen.getByRole('button', { name: /run stress test/i });
    fireEvent.click(runBtn);

    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith(42, {
        demand_shock_pct: 20,
        price_shock_pct: 0,
        cost_shock_pct: 0,
        additional_competitors: 0,
      });
    });

    await waitFor(() => {
      expect(screen.getByText('VULNERABLE')).toBeInTheDocument();
    });

    expect(screen.getByText(/Biggest vulnerability:/i)).toBeInTheDocument();
    expect(screen.getByText('demand')).toBeInTheDocument();

    // Table rows
    expect(screen.getByText('₹60,000')).toBeInTheDocument();
    expect(screen.getByText('₹43,200')).toBeInTheDocument();
    expect(screen.getByText('₹19,000')).toBeInTheDocument();
    expect(screen.getByText('-₹3,050')).toBeInTheDocument();

    // Demand breaking point
    expect(
      screen.getByText(
        /This business can tolerate roughly a 32% demand fall before monthly cash flow turns negative/i
      )
    ).toBeInTheDocument();

    // Disclaimer
    expect(
      screen.getByText(
        /Scenario analysis based on user-selected hypothetical shocks, not a forecast or prediction/i
      )
    ).toBeInTheDocument();
  });

  it('displays error message on execution failure', async () => {
    vi.spyOn(apiClient, 'runStressTest').mockRejectedValue(
      new Error('Network error')
    );

    render(<StressTestPanel assessmentId={42} />);

    const runBtn = screen.getByRole('button', { name: /run stress test/i });
    fireEvent.click(runBtn);

    await waitFor(() => {
      expect(
        screen.getByText(
          'Could not run the stress test. Check your connection and try again.'
        )
      ).toBeInTheDocument();
    });
  });
});
