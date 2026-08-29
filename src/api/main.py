from fastapi import FastAPI, Query
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
import json
import os
from pathlib import Path

app = FastAPI(
    title="Geo-AI Fire Sentinel API",
    description="Real-time fire classification + land zone mapping for India",
    version="2.0.0",
)

app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs("src/frontend", exist_ok=True)
app.mount("/dashboard", StaticFiles(directory="src/frontend", html=True), name="frontend")

@app.get("/", include_in_schema=False)
def root_redirect():
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/dashboard")

ZONES_DIR = "data/raw/zones"

# ─── Helper ──────────────────────────────────────────────────────────────────

_GEOJSON_CACHE = {}

def load_geojson(path: str):
    if os.path.exists(path):
        mtime = os.path.getmtime(path)
        if path in _GEOJSON_CACHE and _GEOJSON_CACHE[path]["mtime"] == mtime:
            return _GEOJSON_CACHE[path]["data"]
            
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
            
        _GEOJSON_CACHE[path] = {"mtime": mtime, "data": data}
        return data
    return None


def not_found(resource: str, run_cmd: str = None):
    msg = f"Data not found: {resource}"
    if run_cmd:
        msg += f". Run: {run_cmd}"
    return {"error": msg}


# ─── Fire Detection Endpoints ─────────────────────────────────────────────────

@app.get("/api/hotspots", tags=["Fire"])
def get_hotspots():
    """Classified AI hotspots with confidence scores and tactical metadata."""
    data = load_geojson("data/processed/classified_hotspots.geojson")
    return data or not_found("classified_hotspots.geojson", "python src/models/inference.py")


@app.get("/api/predictive-spread", tags=["Fire"])
def get_predictive_spread():
    """AI-generated predictive fire spread polygons (hazard cones)."""
    data = load_geojson("data/processed/predictive_spread.geojson")
    return data or not_found("predictive_spread.geojson", "python src/models/inference.py")


@app.get("/api/mitigations", tags=["Fire"])
def get_mitigations():
    """Tactical mitigation zones: firebreak lines and evacuation perimeters."""
    data = load_geojson("data/processed/mitigation_zones.geojson")
    return data or not_found("mitigation_zones.geojson", "python src/models/inference.py")


@app.get("/api/stats", tags=["Fire"])
def get_stats():
    """Quick classification summary — total counts and avg confidence."""
    data = load_geojson("data/processed/classified_hotspots.geojson")
    if not data:
        return not_found("classified_hotspots.geojson")
    
    features = data.get("features", [])
    counts: dict = {}
    confidences: list = []
    
    for feat in features:
        p = feat.get("properties", {})
        cls = p.get("ai_classification", "Unknown")
        counts[cls] = counts.get(cls, 0) + 1
        try:
            confidences.append(float(p["ai_confidence"]))
        except (KeyError, TypeError, ValueError):
            pass
    
    return {
        "total": len(features),
        "by_class": counts,
        "avg_confidence": round(sum(confidences) / len(confidences), 1) if confidences else None,
        "zone_data_available": os.path.exists(os.path.join(ZONES_DIR, "all_zones_india.geojson")),
    }


# ─── Land Zone Endpoints ──────────────────────────────────────────────────────

ZONE_TYPES = {
    "industrial": {
        "file": "industrial_zones_india.geojson",
        "label": "Industrial Zones",
        "color": "#818cf8",
    },
    "forest": {
        "file": "forest_zones_india.geojson",
        "label": "Forest / Jungle",
        "color": "#22c55e",
    },
    "parks": {
        "file": "parks_zones_india.geojson",
        "label": "National Parks & Wildlife Sanctuaries",
        "color": "#10b981",
    },
    "agricultural": {
        "file": "agricultural_zones_india.geojson",
        "label": "Agricultural / Farmland",
        "color": "#f59e0b",
    },
    "mining": {
        "file": "mining_zones_india.geojson",
        "label": "Mining & Quarry Areas",
        "color": "#f97316",
    },
}


@app.get("/api/zones/{zone_type}", tags=["Land Zones"])
def get_zone(zone_type: str):
    """
    Returns polygon GeoJSON for a specific land zone type.
    
    zone_type: industrial | forest | parks | agricultural | mining
    
    Run `python src/data/ingest_land_zones.py` to fetch zone data.
    """
    if zone_type not in ZONE_TYPES:
        return {
            "error": f"Unknown zone type '{zone_type}'",
            "valid_types": list(ZONE_TYPES.keys()),
        }
    
    config = ZONE_TYPES[zone_type]
    
    # Check new zones directory first
    zone_path = os.path.join(ZONES_DIR, config["file"])
    
    # Fallback: legacy industrial zone files
    if not os.path.exists(zone_path) and zone_type == "industrial":
        for legacy in [
            "data/raw/osm_industrial_india.geojson",
            "data/raw/osm_industrial_jamnagar.geojson",
        ]:
            if os.path.exists(legacy):
                data = load_geojson(legacy)
                # Tag with zone metadata
                if data and "features" in data:
                    for feat in data["features"]:
                        feat.setdefault("properties", {}).update({
                            "zone_type": "industrial",
                            "zone_label": config["label"],
                            "zone_color": config["color"],
                        })
                return data
    
    data = load_geojson(zone_path)
    if data:
        return data
    
    return not_found(
        config["file"],
        f"python src/data/ingest_land_zones.py --type {zone_type}"
    )


@app.get("/api/zones", tags=["Land Zones"])
def get_all_zones(
    types: str = Query(
        default=None,
        description="Comma-separated zone types to include (default: all available)"
    )
):
    """
    Returns merged GeoJSON of all available land zones, or a filtered subset.
    
    types: comma-separated list — e.g. ?types=industrial,forest,parks
    
    Run `python src/data/ingest_land_zones.py` to populate zone data.
    """
    requested = [t.strip() for t in types.split(",")] if types else list(ZONE_TYPES.keys())
    invalid = [t for t in requested if t not in ZONE_TYPES]
    if invalid:
        return {"error": f"Unknown zone types: {invalid}", "valid": list(ZONE_TYPES.keys())}
    
    # Try the merged file first (if all types requested)
    if set(requested) == set(ZONE_TYPES.keys()):
        merged_path = os.path.join(ZONES_DIR, "all_zones_india.geojson")
        data = load_geojson(merged_path)
        if data:
            return data
    
    # Otherwise merge requested types on the fly
    all_features = []
    available = []
    missing = []
    
    for zone_type in requested:
        config = ZONE_TYPES[zone_type]
        zone_path = os.path.join(ZONES_DIR, config["file"])
        data = load_geojson(zone_path)
        if data and "features" in data:
            all_features.extend(data["features"])
            available.append(zone_type)
        else:
            # Fallback for industrial
            if zone_type == "industrial":
                for legacy in ["data/raw/osm_industrial_india.geojson",
                               "data/raw/osm_industrial_jamnagar.geojson"]:
                    legacy_data = load_geojson(legacy)
                    if legacy_data and "features" in legacy_data:
                        for feat in legacy_data["features"]:
                            feat.setdefault("properties", {}).update({
                                "zone_type": "industrial",
                                "zone_label": config["label"],
                                "zone_color": config["color"],
                            })
                        all_features.extend(legacy_data["features"])
                        available.append(zone_type)
                        break
                else:
                    missing.append(zone_type)
            else:
                missing.append(zone_type)
    
    return {
        "type": "FeatureCollection",
        "name": "India Land Zones (merged)",
        "metadata": {
            "available_types": available,
            "missing_types": missing,
            "total_features": len(all_features),
            "hint": "Run python src/data/ingest_land_zones.py to fetch missing zones" if missing else None,
        },
        "features": all_features,
    }


@app.get("/api/zones-status", tags=["Land Zones"])
def get_zones_status():
    """Check which zone data files are available and their sizes."""
    status = {}
    for zone_type, config in ZONE_TYPES.items():
        path = os.path.join(ZONES_DIR, config["file"])
        if os.path.exists(path):
            size_mb = round(os.path.getsize(path) / 1_048_576, 2)
            # Count features quickly
            try:
                with open(path) as f:
                    data = json.load(f)
                n_features = len(data.get("features", []))
            except Exception:
                n_features = None
            status[zone_type] = {
                "available": True,
                "file": path,
                "size_mb": size_mb,
                "feature_count": n_features,
                "label": config["label"],
                "color": config["color"],
            }
        else:
            status[zone_type] = {
                "available": False,
                "label": config["label"],
                "color": config["color"],
                "fetch_cmd": f"python src/data/ingest_land_zones.py --type {zone_type}",
            }
    return status
