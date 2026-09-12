"""
stress_engine.py

Deterministic Business Stress Testing Engine for SAKSHAM micro-enterprises.
Provides 100% deterministic scenario analysis (not prediction/forecasting)
to evaluate enterprise resilience under hypothetical adverse shocks:
- Demand decreases
- Selling price decreases
- Operating cost increases
- Additional competitors entering the market
"""

from dataclasses import dataclass
from typing import Dict, Any, Optional


@dataclass
class StressInputs:
    demand_shock_pct: float = 0.0
    price_shock_pct: float = 0.0
    cost_shock_pct: float = 0.0
    additional_competitors: int = 0


def run_stress_test(
    baseline: Dict[str, Any],
    stress: StressInputs,
) -> Dict[str, Any]:
    """
    Simulates hypothetical adverse scenarios on an existing assessment baseline.
    Scenario analysis only — not a forecast or prediction.
    """
    revenue = float(baseline.get("estimated_monthly_revenue") or 0.0)
    profit = float(baseline.get("estimated_monthly_profit") or 0.0)
    emi = float(baseline.get("monthly_emi") or 0.0)
    base_competitors = max(0, int(baseline.get("competitor_count") or 0))

    expenses = revenue - profit

    # Competitor deflator matching financial_engine: 1 / (1 + 0.35 * n)
    comp_before = 1.0 / (1.0 + 0.35 * base_competitors)
    new_competitors = base_competitors + max(0, stress.additional_competitors)
    comp_after = 1.0 / (1.0 + 0.35 * new_competitors)
    competition_factor = (comp_after / comp_before) if comp_before > 0.0 else 1.0

    # Shock factors
    demand_factor = max(0.0, 1.0 - stress.demand_shock_pct / 100.0)
    price_factor = max(0.0, 1.0 - stress.price_shock_pct / 100.0)
    cost_factor = 1.0 + stress.cost_shock_pct / 100.0

    # Stressed metrics
    stressed_revenue = revenue * demand_factor * price_factor * competition_factor
    stressed_expenses = expenses * cost_factor
    stressed_profit = stressed_revenue - stressed_expenses
    stressed_cash_after_emi = stressed_profit - emi

    baseline_cash_after_emi = profit - emi

    # Isolated impact calculation (individual shock impact holding other factors at baseline)
    def isolated(
        demand_factor: float = 1.0,
        price_factor: float = 1.0,
        cost_factor: float = 1.0,
        competition_factor: float = 1.0,
    ) -> float:
        r = revenue * demand_factor * price_factor * competition_factor
        e = expenses * cost_factor
        return (r - e) - emi

    impacts = {
        "demand": baseline_cash_after_emi - isolated(demand_factor=demand_factor),
        "price": baseline_cash_after_emi - isolated(price_factor=price_factor),
        "cost": baseline_cash_after_emi - isolated(cost_factor=cost_factor),
        "competition": baseline_cash_after_emi - isolated(competition_factor=competition_factor),
    }

    # Primary vulnerability: shock with largest positive impact (reduction in cash after EMI)
    positive_impacts = {k: v for k, v in impacts.items() if v > 0.0}
    if positive_impacts:
        primary_vulnerability = max(positive_impacts, key=positive_impacts.get)
    else:
        primary_vulnerability = None

    # Resilience classification
    if stressed_profit <= 0.0 or stressed_cash_after_emi <= 0.0:
        resilience = "VULNERABLE"
    elif stressed_cash_after_emi < (0.25 * baseline_cash_after_emi):
        resilience = "SENSITIVE"
    else:
        resilience = "RESILIENT"

    return {
        "baseline": {
            "revenue": round(revenue, 2),
            "expenses": round(expenses, 2),
            "profit": round(profit, 2),
            "emi": round(emi, 2),
            "cash_after_emi": round(baseline_cash_after_emi, 2),
        },
        "stressed": {
            "revenue": round(stressed_revenue, 2),
            "expenses": round(stressed_expenses, 2),
            "profit": round(stressed_profit, 2),
            "emi": round(emi, 2),
            "cash_after_emi": round(stressed_cash_after_emi, 2),
        },
        "resilience": resilience,
        "impact_breakdown": {
            k: round(v, 2) for k, v in impacts.items()
        },
        "primary_vulnerability": primary_vulnerability,
        "assumptions": {
            "demand_shock_pct": stress.demand_shock_pct,
            "price_shock_pct": stress.price_shock_pct,
            "cost_shock_pct": stress.cost_shock_pct,
            "additional_competitors": stress.additional_competitors,
            "disclaimer": (
                "Scenario analysis based on user-selected hypothetical "
                "shocks, not a forecast or prediction."
            ),
        },
    }


def find_demand_breaking_point(
    baseline: Dict[str, Any],
    max_pct: float = 90.0,
    tolerance: float = 0.5,
) -> Optional[float]:
    """
    Finds the smallest demand-shock percentage at which monthly cash after EMI
    becomes non-positive (<= 0), holding other variables at baseline.
    Uses binary search between 0 and max_pct.
    """
    base_res = run_stress_test(baseline, StressInputs(demand_shock_pct=0.0))
    if base_res["stressed"]["cash_after_emi"] <= 0.0:
        return 0.0

    max_res = run_stress_test(baseline, StressInputs(demand_shock_pct=max_pct))
    if max_res["stressed"]["cash_after_emi"] > 0.0:
        return None

    lo = 0.0
    hi = float(max_pct)

    while (hi - lo) > tolerance:
        mid = (lo + hi) / 2.0
        res = run_stress_test(baseline, StressInputs(demand_shock_pct=mid))
        if res["stressed"]["cash_after_emi"] > 0.0:
            lo = mid
        else:
            hi = mid

    return round(hi, 1)
