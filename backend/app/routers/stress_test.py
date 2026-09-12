"""
stress_test.py

FastAPI router for Business Stress Test scenario analysis.
Read-only simulation on an existing persisted assessment.
Does NOT recalculate or overwrite baseline assessment data.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.app.db.session import get_db
from backend.app.db.queries import get_assessment_by_id
from backend.app.schemas.stress_test import (
    StressTestRequest,
    StressTestResponse,
    StressMetrics,
)
from backend.app.engines.stress_engine import (
    StressInputs,
    run_stress_test,
    find_demand_breaking_point,
)

router = APIRouter(
    prefix="/api/v1/assess",
    tags=["Business Stress Test"],
)


@router.post(
    "/{assessment_id}/stress-test",
    response_model=StressTestResponse,
    summary="Run deterministic stress test on an existing assessment",
)
def stress_test_assessment(
    assessment_id: int,
    payload: StressTestRequest,
    db: Session = Depends(get_db),
):
    """
    Executes a what-if stress scenario on an existing assessment baseline.
    Computes stressed revenue, expenses, profit, cash after EMI, isolated shock impacts,
    and demand breaking point using 100% deterministic mathematics.
    """
    assessment = get_assessment_by_id(db, assessment_id)
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found.")

    baseline = {
        "estimated_monthly_revenue": assessment.estimated_monthly_revenue or 0.0,
        "estimated_monthly_profit": assessment.estimated_monthly_profit or 0.0,
        "monthly_emi": assessment.monthly_emi or 0.0,
        "competitor_count": assessment.competitor_count or 0,
    }

    stress_inputs = StressInputs(
        demand_shock_pct=payload.demand_shock_pct,
        price_shock_pct=payload.price_shock_pct,
        cost_shock_pct=payload.cost_shock_pct,
        additional_competitors=payload.additional_competitors,
    )

    result = run_stress_test(baseline, stress_inputs)
    breaking_point = find_demand_breaking_point(baseline)

    return StressTestResponse(
        assessment_id=assessment_id,
        baseline=StressMetrics(**result["baseline"]),
        stressed=StressMetrics(**result["stressed"]),
        resilience=result["resilience"],
        impact_breakdown=result["impact_breakdown"],
        primary_vulnerability=result["primary_vulnerability"],
        breaking_point_demand_pct=breaking_point,
        assumptions=result["assumptions"],
    )
