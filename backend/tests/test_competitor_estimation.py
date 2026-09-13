"""
Unit and Integration Tests for Competitor Discovery & Estimation Engine.
Tests:
1. Category profile and tag resolution
2. Catchment radii per category
3. Demographic density estimation when OSM mapped count is 0
4. Mapped POI integration and ground-truth verification
5. Missing village / zero demographic handling
6. Deduplication logic
7. Assess endpoint integration returning structured competitor estimation
"""

import pytest
from unittest.mock import patch, MagicMock
from sqlalchemy.orm import Session
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.db.session import SessionLocal
from backend.app.db.models import Village, BusinessCategory, Business
from backend.app.engines.competitor_engine import (
    resolve_category_profile,
    estimate_competitors_in_catchment,
    _deduplicate_competitors,
    CATEGORY_PROFILES,
)


def test_category_profile_resolution():
    # Kirana / Grocery
    key, prof = resolve_category_profile("Retail", "Kirana and daily provisions")
    assert key == "grocery"
    assert prof["radius_km"] == 2.5
    assert prof["density_typical"] == 150

    # Dairy
    key, prof = resolve_category_profile("Dairy", "Milk chilling and paneer production")
    assert key == "dairy"
    assert prof["radius_km"] == 4.0
    assert prof["density_typical"] == 320

    # Pharmacy
    key, prof = resolve_category_profile("Pharmacy", "Chemist and generic medicines")
    assert key == "pharmacy"
    assert prof["radius_km"] == 5.0
    assert prof["density_typical"] == 600

    # Mobile Repair
    key, prof = resolve_category_profile("Electronics", "Smartphone and recharge shop")
    assert key == "mobile"
    assert prof["radius_km"] == 4.0

    # Flour Mill
    key, prof = resolve_category_profile("Food Processing", "Atta chakki grinding unit")
    assert key == "mill"
    assert prof["radius_km"] == 4.5

    # Agri-input
    key, prof = resolve_category_profile("Agriculture", "Fertilizer and seeds depot")
    assert key == "agri"
    assert prof["radius_km"] == 6.0

    # Fallback to general
    key, prof = resolve_category_profile("Handicrafts", "Pottery workshop")
    assert key == "general"
    assert prof["radius_km"] == 3.0


def test_demographic_estimation_for_zero_osm_village():
    """
    Kamar village has ~2,480 households. OSM mapped = 0.
    The system should NOT return 0 competitors; it must return a defensible estimate.
    """
    db = SessionLocal()
    try:
        village = db.query(Village).filter(Village.id == 777701).first()
        if not village:
            village = Village(
                id=777701,
                block_id=1,
                name="Kamar Test",
                household_count=2480,
                population=14384,
                latitude=27.7500,
                longitude=77.4500,
            )
            db.add(village)
            db.commit()

        with patch("backend.app.engines.competitor_engine._fetch_overpass_businesses", return_value=[]):
            res = estimate_competitors_in_catchment(
                db=db,
                village=village,
                category_name="Retail",
                idea="Grocery & Kirana Store",
            )

        assert res["mapped"] == 0
        assert res["status"] == "estimated"
        # Kirana density is 1 per 120-180 households:
        # 2480 / 150 = ~16-17 (range: 14 to 21)
        assert 12 <= res["estimated"] <= 22
        assert res["estimated_min"] < res["estimated_max"]
        assert res["confidence"] == "Medium"
        assert "NSSO 73rd Round" in res["density_benchmark"]
        assert res["radius_km"] == 2.5
    except Exception:
        db.rollback()
        raise
    finally:
        db.query(Village).filter(Village.id == 777701).delete()
        db.commit()
        db.close()


def test_observed_competitors_upgrades_confidence():
    """
    When ground-truth mapped competitors exist in DB or OSM, confidence upgrades to High
    and estimated count accounts for observed businesses.
    """
    db = SessionLocal()
    try:
        village = Village(
            id=777702,
            block_id=1,
            name="Town Test",
            household_count=500,
            population=3000,
            latitude=27.5000,
            longitude=77.6800,
        )
        cat = db.query(BusinessCategory).filter(BusinessCategory.id == 7777).first()
        if not cat:
            cat = BusinessCategory(id=7777, name="Dairy")
            db.add(cat)
        db.add(village)
        db.commit()

        # Add 4 businesses in DB within 1 km
        for i in range(4):
            b = Business(
                id=777710 + i,
                name=f"Dairy Unit {i}",
                category_id=cat.id,
                village_id=village.id,
                latitude=27.5000 + (i * 0.002),
                longitude=77.6800 + (i * 0.002),
            )
            db.add(b)
        db.commit()

        with patch("backend.app.engines.competitor_engine._fetch_overpass_businesses", return_value=[]):
            res = estimate_competitors_in_catchment(
                db=db,
                village=village,
                category_name="Dairy",
                idea="Milk Chilling",
            )

        assert res["mapped"] == 4
        assert res["estimated"] >= 4
        assert res["status"] == "verified"
        assert res["confidence"] == "High"
    except Exception:
        db.rollback()
        raise
    finally:
        for i in range(4):
            db.query(Business).filter(Business.id == 777710 + i).delete()
        db.query(Village).filter(Village.id == 777702).delete()
        db.query(BusinessCategory).filter(BusinessCategory.id == 7777).delete()
        db.commit()
        db.close()


def test_deduplication_spatial_and_name():
    raw = [
        {"name": "Radhey Kirana", "latitude": 27.50000, "longitude": 77.50000},
        {"name": "Radhey Kirana Store", "latitude": 27.50010, "longitude": 77.50010},  # ~14m away
        {"name": "radhey kirana", "latitude": 27.55000, "longitude": 77.55000},        # same name
        {"name": "Sharma General Store", "latitude": 27.52000, "longitude": 77.52000}, # distinct
    ]
    deduped = _deduplicate_competitors(raw)
    assert len(deduped) == 2
    names = {d["name"] for d in deduped}
    assert "Sharma General Store" in names


def test_unavailable_when_no_village():
    db = SessionLocal()
    try:
        res = estimate_competitors_in_catchment(db=db, village=None)
        assert res["status"] == "unavailable"
        assert res["estimated"] == 0
        assert res["confidence"] == "Low"
    finally:
        db.close()


def test_assess_endpoint_returns_competitors_object():
    """
    Verifies that calling /api/v1/assess returns both competitor_count (integer)
    and competitors (rich structured object).
    """
    client = TestClient(app)
    response = client.post(
        "/api/v1/assess",
        json={
            "location": "Kamar, Mathura",
            "category": "Retail",
            "capital": 100000,
            "idea": "Kirana & Grocery Store",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert "competitor_count" in data
    assert "competitors" in data
    comp = data["competitors"]
    assert "mapped" in comp
    assert "estimated" in comp
    assert "estimated_min" in comp
    assert "estimated_max" in comp
    assert "status" in comp
    assert "confidence" in comp
    assert "methodology" in comp
    assert comp["estimated"] > 0
    assert data["competitor_count"] == comp["estimated"]
