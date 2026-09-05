from fastapi import FastAPI, Query
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
import json
import os
from pathlib import Path
import asyncio
import subprocess

app = FastAPI(
    title="Fire detection AI API",
    description="Real-time fire classification + land zone mapping for India",
    version="2.0.0",
)
# Triggering reload for final map cleanup

import sys

@app.on_event("startup")
async def startup_event():
    async def sync_loop():
        while True:
            try:
                proc = await asyncio.create_subprocess_exec(
                    sys.executable, "run_pipeline.py", "--skip-osm", "--skip-train", 
                    stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL
                )
                await proc.wait()
                
                # Check for new critical fires and dispatch Telegram alerts
                data = load_geojson("data/processed/classified_hotspots.geojson")
                if data:
                    from src.api.alerts import check_and_send_alerts
                    check_and_send_alerts(data)
            except Exception as e:
                print(f"Pipeline sync error: {e}")
                
            # Wait 10 minutes (600s) before fetching the next satellite overpass
            await asyncio.sleep(600)
            
    asyncio.create_task(sync_loop())

app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def add_no_cache_headers(request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/dashboard"):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

os.makedirs("src/frontend", exist_ok=True)
app.mount("/dashboard", StaticFiles(directory="src/frontend", html=True), name="frontend")

@app.get("/", include_in_schema=False)
def root_redirect():
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/dashboard")


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
        "avg_confidence": round(sum(confidences) / len(confidences), 1) if confidences else None
    }


# ─── Analytical Deck Endpoints ────────────────────────────────────────────────

@app.get("/api/analytics/history", tags=["Analytics"])
def get_fire_history():
    """Historical daily fire trend and radiative power across the world map."""
    import glob
    import pandas as pd
    from collections import defaultdict
    
    history_by_date = defaultdict(lambda: {
        'industrial': 0, 'forest': 0, 'agri': 0, 'persistent': 0, 'total': 0, 'total_frp': 0.0
    })
    
    # 1. Process classified hotspots
    data = load_geojson("data/processed/classified_hotspots.geojson")
    if data:
        for feat in data.get("features", []):
            p = feat.get("properties", {})
            d = str(p.get("acq_date", "2026-09-04")).split("T")[0]
            cls = p.get("ai_classification", "Forest Fire")
            frp = float(p.get("frp") or 0)
            entry = history_by_date[d]
            entry['total'] += 1
            entry['total_frp'] += frp
            if cls == 'Industrial Fire': entry['industrial'] += 1
            elif cls == 'Forest Fire': entry['forest'] += 1
            elif cls == 'Agricultural Burn': entry['agri'] += 1
            else: entry['persistent'] += 1

    # 2. Incorporate raw multi-day FIRMS history
    for p in sorted(glob.glob("data/raw/firms_merged_*.csv")):
        try:
            df = pd.read_csv(p)
            if 'acq_date' in df.columns:
                for _, row in df.iterrows():
                    d = str(row['acq_date']).split('T')[0]
                    if d in history_by_date and d >= '2026-09-04':
                        continue
                    entry = history_by_date[d]
                    frp = float(row.get('frp') or 15.0)
                    entry['total'] += 1
                    entry['total_frp'] += frp
                    if frp >= 50.0: entry['industrial'] += 1
                    elif frp >= 20.0: entry['forest'] += 1
                    else: entry['agri'] += 1
        except Exception:
            pass

    sorted_dates = sorted(history_by_date.keys())
    res = []
    for d in sorted_dates:
        item = history_by_date[d]
        item['date'] = d
        item['avg_frp'] = round(item['total_frp'] / max(item['total'], 1), 1)
        item['total_frp'] = round(item['total_frp'], 1)
        res.append(item)
    return res


@app.get("/api/analytics/zones", tags=["Analytics"])
def get_active_fire_zones():
    """Identifies and ranks the most active global fire zones worldwide."""
    from collections import defaultdict
    data = load_geojson("data/processed/classified_hotspots.geojson")
    if not data:
        return []

    zones = defaultdict(lambda: {
        'count': 0, 'industrial': 0, 'forest': 0, 'agri': 0, 'persistent': 0,
        'frp_list': [], 'lats': [], 'lons': [], 'sample_locations': set()
    })

    for f in data.get("features", []):
        p = f.get("properties", {})
        country = p.get("country") or "Wildland / Maritime"
        state = p.get("state") or ""
        city = p.get("city") or ""
        
        # Determine global zone cluster
        if any(c in country for c in ['Iraq', 'Iran', 'Kuwait', 'Saudi', 'United Arab Emirates', 'Qatar']):
            key = 'Persian Gulf & Mesopotamian Oil Corridor'
            region_name = 'Middle East (Iraq / Iran / Gulf)'
            zone_desc = 'High-density refinery, gas flare & industrial combustion facilities.'
        elif any(c in country for c in ['Angola', 'Congo', 'Democratic Republic of the Congo']):
            key = 'Angola & Congo Basin Forest Frontier'
            region_name = 'Central Africa'
            zone_desc = 'Heavy tropical biomass & equatorial wildfire corridor.'
        elif 'Mozambique' in country or 'Zambia' in country or 'Malawi' in country:
            key = 'Zambezi River Basin & Mozambique Savannah'
            region_name = 'Southern Africa'
            zone_desc = 'Widespread seasonal savanna wildfires with intense radiative power.'
        elif 'Namibia' in country or 'Botswana' in country:
            key = 'Kalahari Fringe & Namibia Savannah'
            region_name = 'Southern Africa'
            zone_desc = 'Fast-moving scrubland and agricultural rangeland fires.'
        elif 'Tanzania' in country or 'Kenya' in country:
            key = 'East African Rift Valley & Woodlands'
            region_name = 'East Africa'
            zone_desc = 'Woodland fires and savanna biomass combustion.'
        elif 'Indonesia' in country or 'Malaysia' in country:
            key = 'Indonesian Peatlands & Oil Palm Belt'
            region_name = 'Southeast Asia (Borneo / Papua)'
            zone_desc = 'Smoldering peatland fires and agricultural clearing.'
        elif 'Brazil' in country or 'Bolivia' in country:
            key = 'Amazon Basin & Mato Grosso Arc of Deforestation'
            region_name = 'South America'
            zone_desc = 'Rainforest clearing infernos with severe particulate smoke.'
        elif 'Australia' in country:
            key = f'Australian Bushfire Belt ({state or "Queensland"})'
            region_name = 'Oceania'
            zone_desc = 'Intense arid scrubland and eucalyptus bushfires.'
        elif 'United States' in country or 'Canada' in country:
            key = f'North American Timber & Prairie Zone ({state or "West"})'
            region_name = 'North America'
            zone_desc = 'High-temperature wildland timber fires and rangeland burns.'
        else:
            key = f'{country} Hotspot Zone'
            region_name = country
            zone_desc = 'Active regional wildfire and thermal hotspot cluster.'

        z = zones[key]
        z['zone_name'] = key
        z['region'] = region_name
        z['description'] = zone_desc
        z['count'] += 1
        if city: z['sample_locations'].add(city)
        elif state: z['sample_locations'].add(state)

        cls = p.get("ai_classification", "Forest Fire")
        if cls == 'Industrial Fire': z['industrial'] += 1
        elif cls == 'Forest Fire': z['forest'] += 1
        elif cls == 'Agricultural Burn': z['agri'] += 1
        else: z['persistent'] += 1

        frp = float(p.get("frp") or 0)
        z['frp_list'].append(frp)
        z['lats'].append(float(p.get("latitude") or 0))
        z['lons'].append(float(p.get("longitude") or 0))

    # Rank zones by industrial threat and total activity
    sorted_zones = sorted(
        zones.values(),
        key=lambda x: (x['industrial'] * 8 + x['count'] * 1.5 + (max(x['frp_list']) if x['frp_list'] else 0) * 0.1),
        reverse=True
    )

    result = []
    for z in sorted_zones[:8]: # Top 8 most active zones
        max_frp = round(max(z['frp_list']), 1) if z['frp_list'] else 0
        avg_frp = round(sum(z['frp_list']) / len(z['frp_list']), 1) if z['frp_list'] else 0
        center_lat = round(sum(z['lats']) / len(z['lats']), 3) if z['lats'] else 0
        center_lon = round(sum(z['lons']) / len(z['lons']), 3) if z['lons'] else 0
        
        # Risk level determination
        if z['industrial'] >= 10 or max_frp >= 300:
            risk = "CRITICAL INFERNO"
            risk_color = "#ef4444"
        elif z['industrial'] >= 3 or max_frp >= 150:
            risk = "HIGH HAZARD"
            risk_color = "#f97316"
        else:
            risk = "ACTIVE CLUSTER"
            risk_color = "#eab308"

        result.append({
            "zone_name": z['zone_name'],
            "region": z['region'],
            "description": z['description'],
            "total_fires": z['count'],
            "industrial_fires": z['industrial'],
            "forest_fires": z['forest'],
            "agri_fires": z['agri'],
            "persistent_sources": z['persistent'],
            "max_frp": max_frp,
            "avg_frp": avg_frp,
            "center_lat": center_lat,
            "center_lon": center_lon,
            "risk_level": risk,
            "risk_color": risk_color,
            "sample_cities": list(z['sample_locations'])[:3]
        })

    return result



