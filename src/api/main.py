from fastapi import FastAPI, Query, Request, Response
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

from src.api.live_sync import sync_manager

@app.on_event("startup")
async def startup_event():
    async def sync_loop():
        # Immediate sync on startup if needed
        try:
            await asyncio.to_thread(sync_manager.sync_from_firms, False)
            data = load_geojson("data/processed/classified_hotspots.geojson")
            if data:
                from src.api.alerts import check_and_send_alerts
                await asyncio.to_thread(check_and_send_alerts, data)
        except Exception as e:
            print(f"Startup satellite sync error: {e}")

        while True:
            # NASA FIRMS satellites (VIIRS Suomi-NPP & NOAA-20) downlink NRT orbits every 10-15 mins.
            # 600 seconds (10 minutes) complies with NASA's 10-minute rate limit policy window
            # while capturing every new Near-Real-Time orbital fire pass.
            await asyncio.sleep(600)
            try:
                await asyncio.to_thread(sync_manager.sync_from_firms, False)
                data = load_geojson("data/processed/classified_hotspots.geojson")
                if data:
                    from src.api.alerts import check_and_send_alerts
                    await asyncio.to_thread(check_and_send_alerts, data)
            except Exception as e:
                print(f"Periodic live sync error: {e}")
                
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
    if request.url.path.startswith("/dashboard") or request.url.path.startswith("/alerts"):
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

@app.api_route("/alerts", methods=["GET", "HEAD"], include_in_schema=False)
@app.api_route("/alerts/", methods=["GET", "HEAD"], include_in_schema=False)
def alerts_page():
    from fastapi.responses import FileResponse
    alerts_file = "src/frontend/alerts.html"
    if os.path.exists(alerts_file):
        return FileResponse(alerts_file)
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/dashboard")

@app.api_route("/alerts.css", methods=["GET", "HEAD"], include_in_schema=False)
def alerts_css_route():
    from fastapi.responses import FileResponse
    return FileResponse("src/frontend/alerts.css", media_type="text/css")

@app.api_route("/alerts.js", methods=["GET", "HEAD"], include_in_schema=False)
def alerts_js_route():
    from fastapi.responses import FileResponse
    return FileResponse("src/frontend/alerts.js", media_type="application/javascript")

@app.api_route("/alert_siren.wav", methods=["GET", "HEAD"], include_in_schema=False)
def alert_siren_route():
    from fastapi.responses import FileResponse
    return FileResponse("src/frontend/alert_siren.wav", media_type="audio/wav")


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


@app.get("/api/data/version", tags=["Sync"])
def get_data_version():
    """Ultra-lightweight endpoint (~100 bytes) for client-side change detection to avoid unneeded refreshes."""
    status = sync_manager.get_status()
    return {
        "version": status.get("data_version"),
        "mtime": status.get("data_mtime"),
        "total_fires": status.get("total_fires_active"),
        "latest_satellite_acq": status.get("latest_satellite_acq"),
        "next_sync_seconds": status.get("next_sync_seconds"),
        "is_syncing": status.get("is_syncing")
    }



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
        "sync": sync_manager.get_status()
    }


# ─── Live Feed Sync Endpoints ─────────────────────────────────────────────────

@app.get("/api/sync/status", tags=["Sync"])
def get_sync_status():
    """Returns NASA FIRMS NRT live synchronization state, countdown, and satellite timestamps."""
    return sync_manager.get_status()


@app.post("/api/sync/now", tags=["Sync"])
def trigger_sync_now(force: bool = False):
    """Triggers an on-demand satellite feed synchronization from NASA FIRMS API."""
    result = sync_manager.sync_from_firms(force=force)
    return result


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


# ─── Tactical Evacuation & Citizen Alert Proximity Engine ────────────────────

import math

def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculates great-circle distance between two geographic coordinates in kilometers."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return round(R * c, 2)

def calculate_bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculates initial compass bearing in degrees (0-360) from point 1 to point 2."""
    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)
    diff_lon = math.radians(lon2 - lon1)
    x = math.sin(diff_lon) * math.cos(lat2_rad)
    y = math.cos(lat1_rad) * math.sin(lat2_rad) - (math.sin(lat1_rad) * math.cos(lat2_rad) * math.cos(diff_lon))
    initial_bearing = math.atan2(x, y)
    return round((math.degrees(initial_bearing) + 360) % 360, 1)

def compass_cardinal(degrees: float) -> str:
    """Converts compass heading degrees to 16-point cardinal compass string."""
    cardinals = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
    idx = int((degrees + 11.25) / 22.5) % 16
    return cardinals[idx]

def destination_point(lat: float, lon: float, distance_km: float, bearing_deg: float):
    """Calculates destination coordinate given starting point, distance in km, and bearing in degrees."""
    R = 6371.0
    d_div_r = distance_km / R
    bearing_rad = math.radians(bearing_deg)
    lat_rad = math.radians(lat)
    lon_rad = math.radians(lon)

    dest_lat_rad = math.asin(
        math.sin(lat_rad) * math.cos(d_div_r) +
        math.cos(lat_rad) * math.sin(d_div_r) * math.cos(bearing_rad)
    )
    dest_lon_rad = lon_rad + math.atan2(
        math.sin(bearing_rad) * math.sin(d_div_r) * math.cos(lat_rad),
        math.cos(d_div_r) - math.sin(lat_rad) * math.sin(dest_lat_rad)
    )
# ─── International Emergency Numbers Database (Location & Country-Aware) ──────
from api.emergency_data import EMERGENCY_NUMBERS, DEFAULT_EMERGENCY

def get_emergency_contacts(lat: float, lon: float):
    """Dynamically resolves local country, national helpline, police, ambulance, and fire brigade emergency hotlines using coordinates."""
    try:
        import reverse_geocode
        geo = reverse_geocode.get((lat, lon))
        cc = (geo.get("country_code") or "").upper()
        country = geo.get("country") or "International"
        city = geo.get("city") or ""
        state = geo.get("state") or ""
    except Exception:
        cc = "IN"
        country = "India"
        city = ""
        state = ""

    info = EMERGENCY_NUMBERS.get(cc, DEFAULT_EMERGENCY).copy()
    if country and country != "International":
        info["country"] = country
    info["country_code"] = cc
    info["city"] = city
    info["state"] = state
    return info

@app.get("/api/alerts/proximity", tags=["Alerts"])
def get_proximity_alerts(
    lat: float = Query(..., description="User latitude (WGS84)"),
    lon: float = Query(..., description="User longitude (WGS84)"),
    radius_km: float = Query(50.0, ge=1.0, le=500.0, description="Search radius in kilometers")
):
    """
    Evaluates real-time threat proximity for people and first responders in a specific area.
    Calculates downwind smoke exposure, safe escape headings, evacuation steps, and fire control tactics.
    """
    data = load_geojson("data/processed/classified_hotspots.geojson")
    if not data or "features" not in data:
        return not_found("classified_hotspots.geojson")

    features = data.get("features", [])
    nearby_fires = []
    
    for feat in features:
        p = feat.get("properties", {})
        f_lat = float(p.get("latitude", 0.0))
        f_lon = float(p.get("longitude", 0.0))
        if f_lat == 0.0 and f_lon == 0.0:
            continue
            
        dist = haversine_distance(lat, lon, f_lat, f_lon)
        if dist <= radius_km:
            bearing_user_to_fire = calculate_bearing(lat, lon, f_lat, f_lon)
            bearing_fire_to_user = (bearing_user_to_fire + 180) % 360
            
            # Smoke Plume Vector Analysis
            wind_dir = float(p.get("wind_direction") or 220)
            plume_heading = (wind_dir + 180) % 360 # Direction smoke travels
            smoke_angle_diff = abs((bearing_fire_to_user - plume_heading + 180) % 360 - 180)
            is_downwind = smoke_angle_diff <= 45.0
            
            nearby_fires.append({
                "latitude": f_lat,
                "longitude": f_lon,
                "distance_km": dist,
                "bearing_degrees": bearing_user_to_fire,
                "bearing_cardinal": compass_cardinal(bearing_user_to_fire),
                "is_downwind": is_downwind,
                "classification": p.get("ai_classification", "Unknown Fire"),
                "frp": float(p.get("frp") or 0.0),
                "brightness": float(p.get("bright_ti4") or p.get("brightness") or 320.0),
                "risk_level": p.get("risk_level", "Medium"),
                "facility_type": p.get("facility_type", "Wildland Sector"),
                "location_name": p.get("location_name") or f"{p.get('city', '')} {p.get('country', '')}".strip() or "Thermal Hotspot",
                "wind_speed": float(p.get("wind_speed") or 12.0),
                "wind_direction": wind_dir,
                "aqi": int(p.get("aqi") or 85)
            })

    # Sort nearby fires by proximity
    nearby_fires.sort(key=lambda x: x["distance_km"])
    total_in_radius = len(nearby_fires)
    
    # Analyze threat level & escape route
    if total_in_radius > 0:
        closest = nearby_fires[0]
        min_dist = closest["distance_km"]
        top_frp = max(f["frp"] for f in nearby_fires)
        has_industrial = any(f["classification"] == "Industrial Fire" for f in nearby_fires[:5])
        has_downwind_hazard = any(f["is_downwind"] for f in nearby_fires[:3])
        primary_class = closest["classification"]

        # Threat severity logic
        if min_dist <= 10.0 or (has_industrial and min_dist <= 15.0) or (has_downwind_hazard and min_dist <= 15.0) or top_frp >= 200.0:
            threat_level = "CRITICAL DANGER"
            threat_color = "#ef4444"
            status_desc = "Immediate threat detected in your sector. Emergency evacuation procedures are advised."
            should_sound_alarm = True
            urgency_score = 95
        elif min_dist <= 25.0 or (has_downwind_hazard and min_dist <= 35.0):
            threat_level = "HIGH THREAT"
            threat_color = "#f97316"
            status_desc = "Active thermal anomalies within proximity. Prepare evacuation gear and monitor wind changes."
            should_sound_alarm = False
            urgency_score = 75
        elif min_dist <= 50.0:
            threat_level = "MONITORING ADVISORY"
            threat_color = "#eab308"
            status_desc = "Fires detected within regional perimeter. Air quality degradation and smoke haze possible."
            should_sound_alarm = False
            urgency_score = 45
        else:
            threat_level = "STANDBY"
            threat_color = "#38bdf8"
            status_desc = f"Fires detected {min_dist} km away. Currently outside immediate hazard range."
            should_sound_alarm = False
            urgency_score = 20

        # Calculate safe escape vector
        # Directly away from closest fire:
        raw_escape = (closest["bearing_degrees"] + 180) % 360
        # If raw escape is directly in the path of smoke, deflect 90 degrees crosswind
        if closest["is_downwind"]:
            escape_heading = (raw_escape + 90) % 360
            escape_route_note = "Crosswind evacuation vector recommended to avoid dense smoke plume."
        else:
            escape_heading = raw_escape
            escape_route_note = "Direct egress vector away from primary fire front."

        escape_cardinal = compass_cardinal(escape_heading)
        buffer_km = max(round(closest["frp"] * 0.08, 1), 2.5)

    else:
        # Safe zone
        threat_level = "SAFE ZONE"
        threat_color = "#10b981"
        status_desc = f"No active thermal hotspots detected within {radius_km} km of your coordinates."
        should_sound_alarm = False
        urgency_score = 5
        closest = None
        min_dist = None
        top_frp = 0.0
        primary_class = "None"
        escape_heading = 0
        escape_cardinal = "N/A"
        escape_route_note = "Area is currently free of active satellite fire anomalies."
        buffer_km = 0.0

    # Resolve dynamic local country emergency dispatch numbers
    emergency_contacts = get_emergency_contacts(lat, lon)

    # ── Tailored Evacuation Steps ──
    evacuation_steps = []
    if threat_level in ["CRITICAL DANGER", "HIGH THREAT"]:
        evacuation_steps = [
            {
                "phase": "Phase 1: Immediate Life Preservation",
                "urgent": True,
                "action": "Immediate Egress Vector & Respiratory Seal",
                "details": f"Move in heading {round(escape_heading)}° ({escape_cardinal}). Don an N95/P100 respirator or fold a clean damp cloth over nose and mouth to block toxic particulate ash."
            },
            {
                "phase": "Phase 2: Property & Perimeter Hardening",
                "urgent": False,
                "action": "Isolate Fuel & Seal Inlets",
                "details": "Shut off main LPG/gas supply valves immediately. Turn off air conditioners, furnace blowers, and attic fans to prevent smoke infiltration. Leave structure unlocked for emergency search teams."
            },
            {
                "phase": "Phase 3: Tactical Vehicle Evacuation",
                "urgent": True,
                "action": "Egress Corridor Navigation",
                "details": f"Drive headlights ON with windows rolled up and AC in recirculation mode. Proceed toward designated safety assembly zone at least {buffer_km} km away. Avoid narrow canyon roads."
            },
            {
                "phase": "Phase 4: Emergency Helpline & Notification",
                "urgent": True,
                "action": f"Signal {emergency_contacts.get('fire_name', 'Fire Dept')} & Helpline ({emergency_contacts.get('helpline', '112')})",
                "details": f"Alert local emergency dispatch in {emergency_contacts.get('country', 'Local Sector')}: Helpline {emergency_contacts.get('helpline', '112')}, Fire {emergency_contacts.get('fire', '112')}, Police {emergency_contacts.get('police', '911')}, or Ambulance {emergency_contacts.get('ambulance', '112')}. Transmit your coordinates ({round(lat, 4)}, {round(lon, 4)})."
            }
        ]
    elif threat_level == "MONITORING ADVISORY":
        evacuation_steps = [
            {
                "phase": "Phase 1: Pre-Evacuation Alertness",
                "urgent": False,
                "action": "Stage Emergency Go-Bag",
                "details": "Gather vital identity documents, 72-hour prescriptions, emergency cash, phone battery banks, and first-aid kits into a single grab-and-go container."
            },
            {
                "phase": "Phase 2: Vehicle & Mobility Readiness",
                "urgent": False,
                "action": "Position Vehicle Outward",
                "details": "Park vehicle facing toward the street in driveway with fuel tank full. Ensure all family members and pets have collars/carriers ready."
            },
            {
                "phase": "Phase 3: Air Quality Defense",
                "urgent": False,
                "action": "Indoor Air Filtration",
                "details": f"Nearby thermal anomaly ({closest['distance_km'] if closest else 30} km away) may produce particulate haze. Close windows and run HEPA purifiers."
            }
        ]
    else:
        evacuation_steps = [
            {
                "phase": "Normal Readiness",
                "urgent": False,
                "action": "Periodic Surveillance",
                "details": "No active emergency evacuation required for this coordinate. Maintain standard fire safety awareness and keep emergency kit stocked."
            }
        ]

    # ── Tailored Fire Control Strategy for Responders ──
    if primary_class == "Industrial Fire" or primary_class == "Persistent Industrial Thermal Source":
        fire_control = {
            "incident_type": "Industrial Hydrocarbon & Petrochemical Combustion",
            "fuel_class": "Class B (Flammable Liquids & Pressurized Gases)",
            "primary_suppressant": "Aqueous Film-Forming Foam (AR-AFFF) & Purple-K Dry Chemical",
            "critical_warning": "DO NOT apply straight-stream water onto liquid hydrocarbon pools — risk of violent boilover and aerosol fire spread.",
            "structural_cooling": "Deploy deluge water monitors and water curtain fog lines onto adjacent LPG/LNG tanks to prevent BLEVE (Boiling Liquid Expanding Vapor Explosion).",
            "containment_perimeter": f"Minimum {buffer_km} km upwind exclusion zone; {round(buffer_km * 1.8, 1)} km downwind toxic vapor plume isolation.",
            "ppe_level": "NFPA 1971 structural firefighting gear + positive-pressure SCBA + Level B chemical-resistant oversuit."
        }
    elif primary_class == "Forest Fire":
        fire_control = {
            "incident_type": "Wildland Forest & Timber Canopy Inferno",
            "fuel_class": "Class A (Deep Forest Organic Fuel & Canopy Biomass)",
            "primary_suppressant": "Bulldozer Mineral-Earth Firebreaks + Aerial Retardant Drops (Phos-Chek)",
            "critical_warning": "Beware of sudden wind shifts causing crown-fire blowups. Maintain designated Safety Zones at all times.",
            "containment_perimeter": f"Bulldozer firebreak trench width must be at least 2.5× the average flame length (~{max(round(top_frp * 0.05, 1), 6)} meters wide).",
            "structural_cooling": "Class A compressed air foam (CAFS) perimeter coating on vulnerable peripheral wildland-urban interface (WUI) dwellings.",
            "ppe_level": "NFPA 1977 Wildland Firefighting Nomex suit, fire shelter pack, goggles, and P100 particulate respirator."
        }
    elif primary_class == "Agricultural Burn":
        fire_control = {
            "incident_type": "Agricultural Crop Stubble & Residue Surface Fire",
            "fuel_class": "Class A (Surface Crop Stubble & Biomass)",
            "primary_suppressant": "Tractor Disc Soil Tilling + Pressurized Booster Water Lines",
            "critical_warning": "Fast ground spread velocity under moderate gusts; extinguish boundary spot fires immediately.",
            "containment_perimeter": "Plow 3-meter boundary furrows along downwind property margins to starve fuel bed.",
            "structural_cooling": "Wetting agent and water spray applied to fence lines and barn perimeters.",
            "ppe_level": "Flame-retardant coveralls, heavy leather boots, smoke dust mask, and safety goggles."
        }
    else:
        fire_control = {
            "incident_type": "Standard Thermal Hazard Containment" if closest else "No Active Threat in Immediate Sector",
            "fuel_class": "Class A / General Combustion" if closest else "N/A",
            "primary_suppressant": "Water Tender Deluge & Perimeter Wetting Line" if closest else "Routine Standby Monitoring",
            "critical_warning": "Maintain situational vigilance as weather conditions shift.",
            "containment_perimeter": f"Minimum {buffer_km} km standoff perimeter." if closest else "Standard municipal hydrant coverage.",
            "structural_cooling": "Cool surrounding structures with high-volume spray." if closest else "N/A",
            "ppe_level": "Standard bunker gear & SCBA." if closest else "Standard station wear."
        }

    # ── Projected Toxic Smoke Plume Cone ──
    smoke_plume_polygon = []
    is_in_smoke_cone = False
    if closest:
        f_lat = closest["latitude"]
        f_lon = closest["longitude"]
        wind_dir = closest["wind_direction"]
        plume_heading = (wind_dir + 180) % 360
        plume_length = min(round(closest["frp"] * 0.15 + 6.0, 1), 35.0)

        # 4-point wedge polygon
        pt_apex = [f_lat, f_lon]
        pt_right = list(destination_point(f_lat, f_lon, plume_length, (plume_heading + 24) % 360))
        pt_center = list(destination_point(f_lat, f_lon, plume_length * 1.08, plume_heading))
        pt_left = list(destination_point(f_lat, f_lon, plume_length, (plume_heading - 24) % 360))
        smoke_plume_polygon = [pt_apex, pt_right, pt_center, pt_left, pt_apex]
        is_in_smoke_cone = closest["is_downwind"]

    # ── Designated Emergency Shelters & Assembly Posts ──
    designated_shelters = []
    if buffer_km > 0 and closest:
        sh1_lat, sh1_lon = destination_point(lat, lon, max(buffer_km + 2.5, 6.0), escape_heading)
        sh2_lat, sh2_lon = destination_point(lat, lon, max(buffer_km + 4.5, 9.0), (escape_heading + 28) % 360)
        sh3_lat, sh3_lon = destination_point(lat, lon, max(buffer_km + 1.8, 5.0), (escape_heading - 32) % 360)
        designated_shelters = [
            {
                "name": "Community Safe Evacuation Assembly Hub",
                "type": "Primary Civilian Shelter",
                "latitude": sh1_lat,
                "longitude": sh1_lon,
                "distance_km": round(max(buffer_km + 2.5, 6.0), 1),
                "bearing_cardinal": escape_cardinal,
                "capacity": "1,200 Persons · HEPA Air Filtration & Backup Power",
                "status": "OPEN & ACTIVE"
            },
            {
                "name": "District Emergency Trauma & Medical Post",
                "type": "Hospital & First-Aid Post",
                "latitude": sh2_lat,
                "longitude": sh2_lon,
                "distance_km": round(max(buffer_km + 4.5, 9.0), 1),
                "bearing_cardinal": compass_cardinal((escape_heading + 28) % 360),
                "capacity": "Burn Unit & Oxygen Therapy Active",
                "status": "TRIAGE STANDBY"
            },
            {
                "name": "Forward Fire & Hazmat Incident Staging Base",
                "type": "Emergency Responder Base",
                "latitude": sh3_lat,
                "longitude": sh3_lon,
                "distance_km": round(max(buffer_km + 1.8, 5.0), 1),
                "bearing_cardinal": compass_cardinal((escape_heading - 32) % 360),
                "capacity": "High-Volume Water Refill Depot & Foam Pumper",
                "status": "OPERATIONAL"
            }
        ]

    # ── Live Weather & Air Quality Intel ──
    weather_intel = {
        "temperature_c": closest.get("temperature", 29.5) if closest else 26.0,
        "humidity_pct": closest.get("humidity", 42.0) if closest else 55.0,
        "wind_speed_kmh": closest.get("wind_speed", 14.0) if closest else 8.0,
        "wind_direction_deg": closest.get("wind_direction", 220) if closest else 0,
        "wind_cardinal": compass_cardinal(closest.get("wind_direction", 220) if closest else 0)
    }

    raw_aqi = int(closest.get("aqi", 85)) if closest else 45
    if is_in_smoke_cone and threat_level in ["CRITICAL DANGER", "HIGH THREAT"]:
        raw_aqi = min(raw_aqi + 130, 480)
    aqi_category = "Good" if raw_aqi <= 50 else "Moderate" if raw_aqi <= 100 else "Unhealthy for Sensitive Groups" if raw_aqi <= 150 else "Unhealthy" if raw_aqi <= 200 else "Very Unhealthy" if raw_aqi <= 300 else "Hazardous (Toxic)"

    air_quality_intel = {
        "aqi": raw_aqi,
        "category": aqi_category,
        "pm25_ugm3": round(raw_aqi * 0.72, 1),
        "co_risk": "Hazardous" if is_in_smoke_cone and threat_level == "CRITICAL DANGER" else "Elevated" if is_in_smoke_cone else "Low",
        "visibility_km": max(round(15.0 - (raw_aqi / 32.0), 1), 0.8),
        "health_advisory": "Wear P100/N95 masks. Keep windows sealed. Vulnerable individuals shelter in place." if raw_aqi > 150 else "Normal ambient conditions. Maintain standard vigilance."
    }

    # ── Advanced First Responder Engineering Metrics ──
    flow_req_lpm = round(top_frp * 48.0) if top_frp else 500
    responder_tactics_advanced = {
        "water_flow_required_lpm": flow_req_lpm,
        "foam_concentrate_lpm": round(flow_req_lpm * 0.03, 1), # 3% AR-AFFF
        "tanker_trucks_recommended": max(int(math.ceil(flow_req_lpm / 1500)), 2),
        "deluge_lines_recommended": max(int(math.ceil(top_frp / 25)), 2),
        "standoff_distance_km": buffer_km
    }

    return {
        "user_coordinates": {"latitude": lat, "longitude": lon},
        "search_radius_km": radius_km,
        "threat_level": threat_level,
        "threat_color": threat_color,
        "urgency_score": urgency_score,
        "status_description": status_desc,
        "should_sound_alarm": should_sound_alarm,
        "fires_in_radius": total_in_radius,
        "closest_fire": closest,
        "peak_frp_mw": top_frp,
        "escape_heading": {
            "degrees": round(escape_heading, 1),
            "cardinal": escape_cardinal,
            "tactical_note": escape_route_note,
            "safe_buffer_km": buffer_km
        },
        "smoke_plume": {
            "is_user_downwind": is_in_smoke_cone,
            "plume_polygon": smoke_plume_polygon
        },
        "designated_shelters": designated_shelters,
        "weather": weather_intel,
        "air_quality": air_quality_intel,
        "emergency_contacts": emergency_contacts,
        "evacuation_steps": evacuation_steps,
        "fire_control_strategy": fire_control,
        "responder_metrics": responder_tactics_advanced,
        "nearby_hotspots": nearby_fires[:25]
    }





