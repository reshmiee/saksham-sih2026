"""
stress_test.py

Pydantic schemas for the Business Stress Test feature.
Enforces validation bounds on hypothetical shock inputs and defines
structured response contracts for baseline vs. stressed financial outcomes.
"""

from typing import Dict, Any, Optional
from pydantic import BaseModel, Field


class StressTestRequest(BaseModel):
    demand_shock_pct: float = Field(0.0, ge=0, le=90, description="Hypothetical demand reduction percentage")
    price_shock_pct: float = Field(0.0, ge=0, le=90, description="Hypothetical selling price reduction percentage")
    cost_shock_pct: float = Field(0.0, ge=0, le=100, description="Hypothetical operating cost increase percentage")
    additional_competitors: int = Field(0, ge=0, le=10, description="Hypothetical new competitors entering catchment")


class StressMetrics(BaseModel):
    revenue: float
    expenses: float
    profit: float
    emi: float
    cash_after_emi: float


class StressTestResponse(BaseModel):
    assessment_id: int
    baseline: StressMetrics
    stressed: StressMetrics
    resilience: str
    impact_breakdown: Dict[str, float]
    primary_vulnerability: Optional[str] = None
    breaking_point_demand_pct: Optional[float] = None
    assumptions: Dict[str, Any]
