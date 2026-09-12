"""
test_stress_engine.py

Unit and integration test suite for the Business Stress Test feature.
Tests deterministic mathematics, scenario impact calculations, demand breaking point,
resilience classifications, edge cases, and API endpoint routing.
"""

import pytest
from fastapi.testclient import TestClient

from backend.app.engines.stress_engine import (
    StressInputs,
    run_stress_test,
    find_demand_breaking_point,
)
from backend.app.main import app
from backend.app.db.session import SessionLocal
from backend.app.db.queries import save_assessment

client = TestClient(app)

BASELINE = {
    "estimated_monthly_revenue": 60000.0,
    "estimated_monthly_profit": 25000.0,
    "monthly_emi": 6000.0,
    "competitor_count": 3,
}


def test_no_shock_matches_baseline():
    """Test 1: No shocks applied should yield baseline metrics and RESILIENT status."""
    res = run_stress_test(BASELINE, StressInputs())
    assert res["baseline"]["cash_after_emi"] == 19000.0
    assert res["stressed"]["cash_after_emi"] == 19000.0
    assert res["stressed"]["revenue"] == 60000.0
    assert res["stressed"]["expenses"] == 35000.0
    assert res["stressed"]["profit"] == 25000.0
    assert res["resilience"] == "RESILIENT"
    assert res["primary_vulnerability"] is None
    for k, v in res["impact_breakdown"].items():
        assert v == 0.0


def test_combined_shock_matches_worked_example():
    """Test 2: Combined shock scenario matches exact worked example with negative cash flow and VULNERABLE status."""
    inputs = StressInputs(
        demand_shock_pct=20,
        price_shock_pct=10,
        cost_shock_pct=15,
        additional_competitors=0,
    )
    res = run_stress_test(BASELINE, inputs)
    assert res["stressed"]["revenue"] == 43200.0
    assert res["stressed"]["expenses"] == 40250.0
    assert res["stressed"]["profit"] == 2950.0
    assert res["stressed"]["cash_after_emi"] == -3050.0
    assert res["stressed"]["cash_after_emi"] < 0
    assert res["resilience"] == "VULNERABLE"


def test_breaking_point_is_between_0_and_90():
    """Test 3: Binary search demand breaking point is between 0% and 90%."""
    bp = find_demand_breaking_point(BASELINE)
    assert bp is not None
    assert 0 < bp < 90
    assert round(bp, 1) == 32.0


def test_sensitive_resilience_classification():
    """Test SENSITIVE status when cash flow is severely squeezed below 25% of baseline but remains > 0."""
    inputs = StressInputs(demand_shock_pct=25.0)
    res = run_stress_test(BASELINE, inputs)
    assert res["stressed"]["cash_after_emi"] == 4000.0
    assert res["resilience"] == "SENSITIVE"
    assert res["primary_vulnerability"] == "demand"


def test_competitor_deflator_impact():
    """Test competitor deflator math matches 1 / (1 + 0.35 * n)."""
    inputs = StressInputs(additional_competitors=1)
    res = run_stress_test(BASELINE, inputs)
    assert res["stressed"]["revenue"] == 51250.0
    assert res["impact_breakdown"]["competition"] > 0
    assert res["primary_vulnerability"] == "competition"


def test_zero_competitors_baseline():
    """Test edge case where base competitors is 0 and 2 competitors are added."""
    base_zero_comp = dict(BASELINE, competitor_count=0)
    inputs = StressInputs(additional_competitors=2)
    res = run_stress_test(base_zero_comp, inputs)
    expected_rev = round(60000.0 / 1.7, 2)
    assert res["stressed"]["revenue"] == expected_rev
    assert res["impact_breakdown"]["competition"] > 0


def test_already_negative_baseline_cash():
    """Test edge case where enterprise already has negative cash after EMI."""
    loss_making = {
        "estimated_monthly_revenue": 30000.0,
        "estimated_monthly_profit": 5000.0,
        "monthly_emi": 8000.0,
        "competitor_count": 1,
    }
    res = run_stress_test(loss_making, StressInputs())
    assert res["resilience"] == "VULNERABLE"
    bp = find_demand_breaking_point(loss_making)
    assert bp == 0.0


def test_no_breaking_point_high_profit():
    """Test breaking point returns None when cash after EMI remains > 0 even at 90% demand shock."""
    huge_profit = {
        "estimated_monthly_revenue": 1000000.0,
        "estimated_monthly_profit": 950000.0,
        "monthly_emi": 1000.0,
        "competitor_count": 0,
    }
    bp = find_demand_breaking_point(huge_profit, max_pct=90.0)
    assert bp is None


def test_primary_vulnerability_identification():
    """Test that the shock with the greatest negative cash impact is chosen as primary."""
    inputs = StressInputs(demand_shock_pct=5.0, price_shock_pct=30.0)
    res = run_stress_test(BASELINE, inputs)
    assert res["primary_vulnerability"] == "price"
    assert res["impact_breakdown"]["price"] > res["impact_breakdown"]["demand"]


def test_stress_test_api_not_found():
    """Test API returns 404 for a non-existent assessment ID."""
    resp = client.post(
        "/api/v1/assess/99999999/stress-test",
        json={
            "demand_shock_pct": 20.0,
            "price_shock_pct": 10.0,
            "cost_shock_pct": 15.0,
            "additional_competitors": 1,
        },
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Assessment not found."


def test_stress_test_api_validation_error():
    """Test API returns 422 for out-of-bounds shock parameters."""
    resp = client.post(
        "/api/v1/assess/1/stress-test",
        json={
            "demand_shock_pct": 95.0,  # Max allowed is 90
            "price_shock_pct": 0.0,
            "cost_shock_pct": 0.0,
            "additional_competitors": 0,
        },
    )
    assert resp.status_code == 422


def test_stress_test_api_success():
    """Test API successfully simulates stress test on a persisted assessment."""
    db = SessionLocal()
    try:
        saved = save_assessment(
            db=db,
            user_id=1,
            village_id=123579,
            category_id=1,
            capital_input=6000.0,
            fit_score=78.0,
            confidence_level="High",
            project_cost=60000.0,
            max_loan_amount=54000.0,
            recommended_project_size=60000.0,
            scheme_id=1,
            status="Exploring",
            rating="Viable",
            competitor_count=3,
            business_idea="Stress test API verification",
            interest_rate=6.5,
            tenure_months=36,
            moratorium_months=3,
            monthly_emi=6000.0,
            total_repayment=216000.0,
            total_interest=16000.0,
            estimated_monthly_revenue=60000.0,
            estimated_monthly_profit=25000.0,
            repayment_burden_ratio=0.24,
            repayment_burden_category="Sustainable",
            feasibility_breakdown={"fit_score": 78.0},
            ai_insights={"recommendation": "Viable"},
        )
        saved_id = saved.id
    finally:
        db.close()

    resp = client.post(
        f"/api/v1/assess/{saved_id}/stress-test",
        json={
            "demand_shock_pct": 20.0,
            "price_shock_pct": 10.0,
            "cost_shock_pct": 15.0,
            "additional_competitors": 0,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["assessment_id"] == saved_id
    assert data["baseline"]["revenue"] == 60000.0
    assert data["baseline"]["profit"] == 25000.0
    assert data["baseline"]["emi"] == 6000.0
    assert data["baseline"]["cash_after_emi"] == 19000.0
    assert data["stressed"]["revenue"] == 43200.0
    assert data["stressed"]["cash_after_emi"] == -3050.0
    assert data["resilience"] == "VULNERABLE"
    assert data["breaking_point_demand_pct"] == 32.0
    assert "disclaimer" in data["assumptions"]

