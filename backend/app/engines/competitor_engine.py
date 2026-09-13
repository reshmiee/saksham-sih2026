"""
competitor_engine.py

Enterprise Competitor Discovery & Estimation Engine for SAKSHAM.
Addresses rural OpenStreetMap coverage gaps by combining:
1. Category-specific catchment search radii and canonical Overpass/OSM tags
2. Multi-tier discovery: Live Overpass API querying + Local PostgreSQL/SQLite GeoDB
3. Spatial deduplication (coordinate proximity + normalized name matching)
4. Empirical demographic estimation (Census 2011 village demographics + NSSO 73rd Round
   unincorporated non-agricultural enterprise density benchmarks)
5. Transparent confidence scoring ('High', 'Medium', 'Low') with methodology notes
"""

import logging
import math
import re
import time
from typing import Any, Dict, List, Optional, Tuple
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.app.db.models import Business, BusinessCategory, Village
from backend.app.db.queries import haversine_distance_km

logger = logging.getLogger("saksham.competitor_engine")

# ─── Category Profiles & Empirical Density Benchmarks ─────────────────────────
# Ratios derived from NSSO 73rd Round (Unincorporated Non-Agricultural Enterprises in India)
# & Ministry of MSME Rural Enterprise Surveys.

CATEGORY_PROFILES: Dict[str, Dict[str, Any]] = {
    "grocery": {
        "display_name": "Grocery & Daily Retail (Kirana)",
        "keywords": ["grocery", "kirana", "general store", "provisions", "retail", "supermarket", "dukan"],
        "radius_km": 2.5,
        "density_min": 120,   # 1 per 120 households (high density)
        "density_typical": 150,
        "density_max": 180,   # 1 per 180 households (low density)
        "osm_filters": [
            '["shop"="convenience"]',
            '["shop"="general"]',
            '["shop"="supermarket"]',
            '["shop"="grocery"]',
            '["shop"="kiosk"]',
        ],
        "db_keywords": ["kirana", "grocery", "general", "store", "dukan"],
    },
    "dairy": {
        "display_name": "Dairy & Milk Products",
        "keywords": ["dairy", "milk", "doodh", "chilling", "paneer", "ghee", "cattle", "livestock"],
        "radius_km": 4.0,
        "density_min": 250,
        "density_typical": 320,
        "density_max": 400,
        "osm_filters": [
            '["shop"="dairy"]',
            '["craft"="dairy"]',
            '["amenity"="milk_shed"]',
            '["shop"="cheese"]',
        ],
        "db_keywords": ["dairy", "milk", "doodh"],
    },
    "pharmacy": {
        "display_name": "Pharmacy & Healthcare (Chemist)",
        "keywords": ["pharmacy", "chemist", "medical", "medicine", "dawakhana", "health", "clinic"],
        "radius_km": 5.0,
        "density_min": 450,
        "density_typical": 600,
        "density_max": 800,
        "osm_filters": [
            '["amenity"="pharmacy"]',
            '["shop"="chemist"]',
            '["healthcare"="pharmacy"]',
        ],
        "db_keywords": ["chemist", "pharmacy", "medical"],
    },
    "mobile": {
        "display_name": "Mobile Repair & Electronics",
        "keywords": ["mobile", "phone", "electronics", "recharge", "repair", "telecom", "computer"],
        "radius_km": 4.0,
        "density_min": 350,
        "density_typical": 500,
        "density_max": 700,
        "osm_filters": [
            '["shop"="mobile_phone"]',
            '["shop"="electronics"]',
            '["craft"="electronics_repair"]',
        ],
        "db_keywords": ["mobile", "electronics", "repair", "telecom"],
    },
    "tailoring": {
        "display_name": "Tailoring & Garments",
        "keywords": ["tailor", "tailoring", "garments", "cloth", "boutique", "stitching", "textile"],
        "radius_km": 3.5,
        "density_min": 200,
        "density_typical": 280,
        "density_max": 380,
        "osm_filters": [
            '["shop"="tailor"]',
            '["craft"="tailor"]',
            '["shop"="clothes"]',
        ],
        "db_keywords": ["tailor", "garment", "cloth", "boutique"],
    },
    "mill": {
        "display_name": "Flour Mill / Food Processing",
        "keywords": ["flour", "mill", "atta", "chakki", "grinding", "processing", "oil mill", "grain"],
        "radius_km": 4.5,
        "density_min": 250,
        "density_typical": 350,
        "density_max": 480,
        "osm_filters": [
            '["craft"="mill"]',
            '["craft"="grinding_mill"]',
            '["industrial"="flour_mill"]',
            '["man_made"="mill"]',
        ],
        "db_keywords": ["mill", "chakki", "atta", "flour"],
    },
    "agri": {
        "display_name": "Agri-input & Fertilizer Depot",
        "keywords": ["agri", "fertilizer", "seed", "pesticide", "kisan", "krishi", "agriculture", "tractor"],
        "radius_km": 6.0,
        "density_min": 400,
        "density_typical": 550,
        "density_max": 700,
        "osm_filters": [
            '["shop"="agrarian"]',
            '["shop"="fertilizer"]',
            '["shop"="trade"]',
        ],
        "db_keywords": ["fertilizer", "krishi", "kisan", "seed", "agri"],
    },
    "general": {
        "display_name": "Rural Micro-Enterprise",
        "keywords": [],
        "radius_km": 3.0,
        "density_min": 200,
        "density_typical": 300,
        "density_max": 450,
        "osm_filters": [
            '["shop"]',
            '["craft"]',
        ],
        "db_keywords": [],
    },
}

# In-memory Overpass API response cache:
# Key: (round(lat, 3), round(lon, 3), profile_key, radius_km) -> (timestamp, list_of_places)
_OVERPASS_CACHE: Dict[Tuple[float, float, str, float], Tuple[float, List[Dict[str, Any]]]] = {}
CACHE_TTL_SECONDS = 3600  # 1 hour cache


def resolve_category_profile(category_name: Optional[str], idea: Optional[str] = None) -> Tuple[str, Dict[str, Any]]:
    """
    Identifies the best matching category profile based on category name and user idea.
    Defaults to 'general' if unknown.
    """
    combined_text = f"{category_name or ''} {idea or ''}".lower()

    for key, profile in CATEGORY_PROFILES.items():
        if key == "general":
            continue
        for kw in profile["keywords"]:
            if re.search(rf"\b{re.escape(kw)}\b", combined_text):
                return key, profile

    return "general", CATEGORY_PROFILES["general"]


def _fetch_overpass_businesses(
    lat: float, lon: float, radius_km: float, profile_key: str, profile: Dict[str, Any]
) -> List[Dict[str, Any]]:
    """
    Queries live Overpass API for POIs matching the category profile tags.
    Applies timeout of 3.0 seconds, in-memory TTL caching, and graceful failure handling.
    """
    cache_key = (round(lat, 3), round(lon, 3), profile_key, radius_km)
    now = time.time()
    if cache_key in _OVERPASS_CACHE:
        cached_ts, cached_data = _OVERPASS_CACHE[cache_key]
        if now - cached_ts < CACHE_TTL_SECONDS:
            return cached_data

    radius_meters = int(radius_km * 1000)
    osm_filters = profile.get("osm_filters", ['["shop"]'])

    # Build Overpass QL union query
    queries = []
    for flt in osm_filters:
        queries.append(f"node{flt}(around:{radius_meters},{lat},{lon});")
        queries.append(f"way{flt}(around:{radius_meters},{lat},{lon});")
    
    union_body = "".join(queries)
    overpass_ql = f"[out:json][timeout:3];({union_body});out center 50;"

    discovered: List[Dict[str, Any]] = []
    try:
        import urllib.parse
        import urllib.request
        import json

        url = "https://overpass-api.de/api/interpreter"
        data = urllib.parse.urlencode({"data": overpass_ql}).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            headers={"User-Agent": "SakshamCompetitorEngine/1.0 (sih2026-rural-analytics)"},
        )
        with urllib.request.urlopen(req, timeout=3.0) as resp:
            if resp.status == 200:
                payload = json.loads(resp.read().decode("utf-8"))
                elements = payload.get("elements", [])
                for el in elements:
                    p_lat = el.get("lat") or el.get("center", {}).get("lat")
                    p_lon = el.get("lon") or el.get("center", {}).get("lon")
                    tags = el.get("tags", {})
                    name = tags.get("name") or tags.get("name:en") or tags.get("shop") or tags.get("amenity") or "Local Business"
                    if p_lat is not None and p_lon is not None:
                        discovered.append({
                            "name": name,
                            "latitude": float(p_lat),
                            "longitude": float(p_lon),
                            "source": "OpenStreetMap (Live Overpass)",
                            "category": tags.get("shop") or tags.get("amenity") or tags.get("craft") or profile_key,
                        })
    except Exception as e:
        logger.info("Overpass query skipped or timed out (%s): fallback to local geo-db", e)

    _OVERPASS_CACHE[cache_key] = (now, discovered)
    return discovered


def _fetch_local_db_businesses(
    db: Session,
    village: Village,
    radius_km: float,
    profile_key: str,
    profile: Dict[str, Any],
) -> List[Dict[str, Any]]:
    """
    Queries the local Business table within the spatial bounding box / haversine catchment.
    Filters by category or matching business names.
    """
    if village.latitude is None or village.longitude is None:
        # Fallback to village_id match
        q = db.query(Business).filter(Business.village_id == village.id)
        results = []
        for b in q.all():
            results.append({
                "name": b.name,
                "latitude": b.latitude,
                "longitude": b.longitude,
                "source": "Saksham GeoDB",
                "category": b.category.name if b.category else profile_key,
            })
        return results

    lat_deg = radius_km / 111.0
    cos_lat = max(abs(math.cos(math.radians(village.latitude))), 0.01)
    lon_deg = radius_km / (111.0 * cos_lat)

    q = db.query(Business).filter(
        Business.latitude.between(village.latitude - lat_deg, village.latitude + lat_deg),
        Business.longitude.between(village.longitude - lon_deg, village.longitude + lon_deg),
    )

    # Optional category filtering
    matching_cat_ids = []
    keywords = profile.get("db_keywords", [])
    if keywords:
        all_cats = db.query(BusinessCategory).all()
        for c in all_cats:
            c_lower = c.name.lower()
            if any(kw in c_lower for kw in keywords):
                matching_cat_ids.append(c.id)

    if matching_cat_ids:
        q = q.filter(Business.category_id.in_(matching_cat_ids))

    businesses = q.all()
    results = []
    for b in businesses:
        if b.latitude is not None and b.longitude is not None:
            dist = haversine_distance_km(village.latitude, village.longitude, b.latitude, b.longitude)
            if dist <= radius_km:
                results.append({
                    "name": b.name,
                    "latitude": b.latitude,
                    "longitude": b.longitude,
                    "source": "Saksham GeoDB",
                    "category": b.category.name if b.category else profile_key,
                    "distance_km": round(dist, 2),
                })
    return results


def _deduplicate_competitors(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Deduplicates POIs based on geographic proximity (< 40 meters) or normalized name match.
    """
    unique: List[Dict[str, Any]] = []
    for item in items:
        i_lat = item.get("latitude")
        i_lon = item.get("longitude")
        i_name = (item.get("name") or "").strip().lower()

        is_dup = False
        for u in unique:
            u_lat = u.get("latitude")
            u_lon = u.get("longitude")
            u_name = (u.get("name") or "").strip().lower()

            if i_lat is not None and i_lon is not None and u_lat is not None and u_lon is not None:
                d = haversine_distance_km(i_lat, i_lon, u_lat, u_lon)
                if d < 0.04:  # within 40m
                    is_dup = True
                    break
            if i_name and u_name and i_name == u_name:
                is_dup = True
                break

        if not is_dup:
            unique.append(item)
    return unique


def estimate_competitors_in_catchment(
    db: Session,
    village: Optional[Village],
    category_name: Optional[str] = None,
    idea: Optional[str] = None,
    radius_km: Optional[float] = None,
) -> Dict[str, Any]:
    """
    Authoritative Competitor Estimation Algorithm for SAKSHAM.
    
    1. Resolves category profile (Grocery, Dairy, Pharmacy, Mobile, etc.)
    2. Determines appropriate search catchment radius (2.5 km to 6.0 km)
    3. Multi-tier discovery:
       - Live Overpass API (OSM)
       - Saksham Local Geo-Database
       - Deduplication
    4. Demographic Estimation Model:
       - Uses Census 2011 village demographics (household_count, population)
       - Applies empirical NSSO 73rd round rural enterprise density ratios
       - Calibrates between mapped observed count and estimated statistical count
    5. Returns structured dictionary with:
       - mapped (actual observed count)
       - estimated (defensible central estimate)
       - estimated_min & estimated_max (confidence range)
       - confidence ('High', 'Medium', 'Low')
       - status ('verified', 'estimated', 'unavailable')
       - methodology and data sources
    """
    profile_key, profile = resolve_category_profile(category_name, idea)
    eff_radius = radius_km if (radius_km is not None and radius_km > 0) else profile["radius_km"]

    if village is None:
        return {
            "mapped": 0,
            "estimated": 0,
            "estimated_min": 0,
            "estimated_max": 0,
            "status": "unavailable",
            "radius_km": eff_radius,
            "category": profile["display_name"],
            "confidence": "Low",
            "density_benchmark": f"1 per {profile['density_min']}–{profile['density_max']} households",
            "methodology": "Competitor data unavailable: Location could not be resolved.",
            "data_sources": [],
            "mapped_samples": [],
        }

    # Gather observed businesses from Multi-tier sources
    observed_items: List[Dict[str, Any]] = []
    sources_used = []

    # Local DB
    local_db_items = _fetch_local_db_businesses(db, village, eff_radius, profile_key, profile)
    if local_db_items:
        observed_items.extend(local_db_items)
        sources_used.append("Saksham Mathura GeoDB")

    # Live Overpass OSM (if village has coordinates)
    if village.latitude is not None and village.longitude is not None:
        overpass_items = _fetch_overpass_businesses(village.latitude, village.longitude, eff_radius, profile_key, profile)
        if overpass_items:
            observed_items.extend(overpass_items)
            sources_used.append("OpenStreetMap Live (Overpass)")

    # Deduplicate observed businesses
    deduped_observed = _deduplicate_competitors(observed_items)
    mapped_count = len(deduped_observed)

    # ── Demographic Enterprise Density Estimation Model ──────────────────────
    households = village.household_count
    if not households and village.population:
        # Average rural household size in UP ~ 5.8 (Census 2011)
        households = max(1, round(village.population / 5.8))
    households = households or 0

    if households <= 0 and mapped_count == 0:
        return {
            "mapped": 0,
            "estimated": 0,
            "estimated_min": 0,
            "estimated_max": 0,
            "status": "unavailable",
            "radius_km": eff_radius,
            "category": profile["display_name"],
            "confidence": "Low",
            "density_benchmark": f"1 per {profile['density_min']}–{profile['density_max']} households",
            "methodology": "Competitor data unavailable: Neither observed businesses nor demographic baseline found for this settlement.",
            "data_sources": sources_used or ["None"],
            "mapped_samples": [],
        }

    # Expected count based on village demographics & NSSO enterprise density
    density_typical = profile["density_typical"]
    density_min = profile["density_min"]
    density_max = profile["density_max"]

    expected_central = max(1, round(households / density_typical)) if households > 0 else mapped_count
    expected_low = max(1, round(households / density_max)) if households > 0 else mapped_count
    expected_high = max(1, round(households / density_min)) if households > 0 else mapped_count

    if expected_low > expected_high:
        expected_low, expected_high = expected_high, expected_low

    if mapped_count > 0:
        # We have concrete ground-truth observations
        estimated = max(mapped_count, expected_central)
        est_min = max(mapped_count, expected_low)
        est_max = max(mapped_count + 1, expected_high)
        status = "verified"
        confidence = "High" if mapped_count >= 3 else "Medium"
        methodology = (
            f"Observed {mapped_count} ground-truth enterprise(s) within {eff_radius} km catchment. "
            f"Cross-referenced with Census 2011 demographics ({households:,} households) "
            f"under NSSO 73rd Round enterprise density benchmark ({profile['display_name']}: "
            f"1 per {density_min}–{density_max} households)."
        )
    else:
        # Zero OSM mapped points (typical rural coverage gap)
        # We provide a defensible demographic estimate based on household count
        estimated = expected_central
        est_min = expected_low
        est_max = expected_high
        status = "estimated"
        confidence = "Medium"
        sources_used.append("Census 2011 Rural Demographics")
        methodology = (
            f"No mapped OpenStreetMap entries found within {eff_radius} km (common rural OSM coverage gap). "
            f"Estimated total competitors: ~{estimated} (range {est_min}–{est_max}) calculated from "
            f"village baseline of {households:,} households using NSSO 73rd Round unincorporated "
            f"enterprise density benchmark (1 per {density_min}–{density_max} households)."
        )

    return {
        "mapped": mapped_count,
        "estimated": estimated,
        "estimated_min": est_min,
        "estimated_max": est_max,
        "status": status,
        "radius_km": eff_radius,
        "category": profile["display_name"],
        "confidence": confidence,
        "density_benchmark": f"1 per {density_min}–{density_max} households (NSSO 73rd Round)",
        "methodology": methodology,
        "data_sources": sources_used or ["Census 2011 Village Demographics"],
        "mapped_samples": [
            {"name": o["name"], "source": o.get("source", "GeoDB"), "category": o.get("category", "")}
            for o in deduped_observed[:5]
        ],
    }
