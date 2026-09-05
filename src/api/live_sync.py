"""
Live Feed Sync Engine for NASA FIRMS NRT API
---------------------------------------------
Complies strictly with NASA FIRMS API rate limits:
- Base limit: 5,000 transactions per 10-minute interval per MAP_KEY.
- Satellite orbital period: VIIRS downlinks processed Near-Real-Time every 10-15 mins.
- Sync cadence: 10 minutes (600s) automated cycle to prevent rate-limit throttling
  while keeping fire hotspots synced with the latest satellite overpass.
"""

import os
import io
import json
import time
import requests
import pandas as pd
from datetime import datetime, timezone
from pathlib import Path
import reverse_geocode
from global_land_mask import globe
from dotenv import load_dotenv

load_dotenv()

FIRMS_API_BASE = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"
AREA = "world"
SYNC_INTERVAL_SECONDS = 600  # 10 minutes (per NASA 10-min rate limit policy)
HEAVY_FIRE_MIN_FRP = 25.0    # Retain severe & heavy fires (FRP >= 25.0 MW)
PROCESSED_GEOJSON_PATH = "data/processed/classified_hotspots.geojson"

SOURCES = [
    {"source": "VIIRS_SNPP_NRT", "name": "Suomi-NPP VIIRS (375m)", "priority": 1},
    {"source": "VIIRS_NOAA20_NRT", "name": "NOAA-20 VIIRS (375m)", "priority": 2},
]

class LiveSyncManager:
    def __init__(self):
        self.last_sync_time = None
        self.latest_acq_utc = "Fetching..."
        self.total_fires_synced = 0
        self.is_syncing = False
        self.last_error = None
        self.sync_count = 0
        
        # Load initial count if file exists
        if os.path.exists(PROCESSED_GEOJSON_PATH):
            try:
                with open(PROCESSED_GEOJSON_PATH, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    self.total_fires_synced = len(data.get("features", []))
                    # Check latest acquisition from file
                    features = data.get("features", [])
                    if features:
                        latest_date = max((f["properties"].get("acq_date", "") for f in features), default="")
                        latest_time = max((f["properties"].get("acq_time", 0) for f in features if f["properties"].get("acq_date") == latest_date), default=0)
                        if latest_date:
                            time_str = str(latest_time).padStart(4, '0') if hasattr(latest_time, 'padStart') else f"{int(latest_time):04d}"
                            self.latest_acq_utc = f"{latest_date.split('T')[0]} {time_str[:2]}:{time_str[2:]} UTC"
            except Exception:
                pass

    def get_api_key(self):
        key = os.getenv("FIRMS_API_KEY", "").strip()
        if not key or key == "your_nasa_firms_api_key_here":
            raise ValueError("NASA FIRMS_API_KEY is not configured in .env file.")
        return key

    def get_status(self):
        elapsed = (time.time() - self.last_sync_time.timestamp()) if self.last_sync_time else None
        next_sync = max(0, int(SYNC_INTERVAL_SECONDS - elapsed)) if elapsed is not None else 0
        
        return {
            "status": "syncing" if self.is_syncing else ("active" if self.last_sync_time else "ready"),
            "is_syncing": self.is_syncing,
            "last_sync_utc": self.last_sync_time.strftime("%Y-%m-%d %H:%M:%S UTC") if self.last_sync_time else "Initial Startup",
            "latest_satellite_acq": self.latest_acq_utc,
            "total_fires_active": self.total_fires_synced,
            "sync_interval_seconds": SYNC_INTERVAL_SECONDS,
            "next_sync_seconds": next_sync,
            "sync_count": self.sync_count,
            "api_policy": "NASA FIRMS NRT (5,000 requests / 10-minute interval)",
            "sensors": [s["name"] for s in SOURCES],
            "last_error": self.last_error
        }

    def sync_from_firms(self, force: bool = False):
        """
        Ingests the live global active fire feed from NASA FIRMS.
        Rate-limit throttled: will not hit NASA API faster than allowed unless force=True.
        """
        if self.is_syncing:
            return {"status": "in_progress", "message": "A sync is already executing."}

        now = time.time()
        if not force and self.last_sync_time:
            elapsed = now - self.last_sync_time.timestamp()
            if elapsed < SYNC_INTERVAL_SECONDS:
                remaining = int(SYNC_INTERVAL_SECONDS - elapsed)
                return {
                    "status": "cached",
                    "message": f"NASA feed is up to date. Next overpass sync in {remaining}s.",
                    "next_sync_seconds": remaining,
                    "latest_satellite_acq": self.latest_acq_utc,
                    "total_fires": self.total_fires_synced
                }

        self.is_syncing = True
        self.last_error = None
        try:
            api_key = self.get_api_key()
            dfs = []

            for src in SOURCES:
                source_id = src["source"]
                url = f"{FIRMS_API_BASE}/{api_key}/{source_id}/{AREA}/1"
                try:
                    resp = requests.get(url, timeout=35)
                    if resp.status_code == 429:
                        self.last_error = f"Rate limited by NASA on {source_id}"
                        continue
                    if resp.status_code == 200 and len(resp.text.strip()) > 50 and "Error" not in resp.text:
                        df = pd.read_csv(io.StringIO(resp.text))
                        if 'frp' in df.columns:
                            df['frp'] = pd.to_numeric(df['frp'], errors='coerce').fillna(0)
                            df = df[df['frp'] >= HEAVY_FIRE_MIN_FRP].copy()
                            df['source'] = source_id
                            df['source_priority'] = src["priority"]
                            dfs.append(df)
                except Exception as e:
                    self.last_error = f"Error fetching {source_id}: {str(e)}"

            if not dfs:
                # If NASA request failed or returned empty, retain current processed data
                self.is_syncing = False
                return {
                    "status": "fallback",
                    "message": "Could not retrieve new records from NASA. Retaining cached feed.",
                    "last_error": self.last_error
                }

            combined = pd.concat(dfs, ignore_index=True)
            
            # Deduplicate by ~1km spatial-temporal grid
            combined['lat_1km'] = (combined['latitude'] * 100).round() / 100
            combined['lon_1km'] = (combined['longitude'] * 100).round() / 100
            
            deduped = (
                combined.sort_values('source_priority')
                .drop_duplicates(subset=['lat_1km', 'lon_1km', 'acq_date'], keep='first')
                .drop(columns=['lat_1km', 'lon_1km', 'source_priority'])
            )

            # Determine latest acquisition date & time from NASA feed
            max_date = str(deduped['acq_date'].max()).split('T')[0]
            max_time_series = deduped[deduped['acq_date'] == max_date]['acq_time']
            max_time = int(max_time_series.max()) if not max_time_series.empty else 0
            time_str = f"{max_time:04d}"
            self.latest_acq_utc = f"{max_date} {time_str[:2]}:{time_str[2:]} UTC"

            # Reverse geocode all coordinates in batch for instantaneous UI display
            coords = list(zip(deduped['latitude'], deduped['longitude']))
            try:
                geo_results = reverse_geocode.search(coords)
                location_names = []
                countries = []
                states = []
                cities = []
                for r in geo_results:
                    c = r.get('city', '')
                    s = r.get('state', '')
                    country = r.get('country', '')
                    parts = [p for p in [c, s, country] if p]
                    loc_str = ', '.join(parts) if parts else country or 'Global Wildland'
                    location_names.append(loc_str)
                    countries.append(country)
                    states.append(s)
                    cities.append(c)
                deduped['location_name'] = location_names
                deduped['country'] = countries
                deduped['state'] = states
                deduped['city'] = cities
            except Exception:
                deduped['location_name'] = [f"Region ({lat:.2f}°, {lon:.2f}°)" for lat, lon in zip(deduped['latitude'], deduped['longitude'])]
                deduped['country'] = ""
                deduped['state'] = ""
                deduped['city'] = ""

            # Tactical Classification & Physics Modeling
            features = []
            for _, row in deduped.iterrows():
                lat = float(row['latitude'])
                lon = float(row['longitude'])
                frp = float(row.get('frp', 0))
                b4 = float(row.get('bright_ti4', 300))
                daynight = str(row.get('daynight', 'D'))
                acq_d = str(row.get('acq_date', max_date))
                acq_t = int(row.get('acq_time', 0))
                sat = str(row.get('satellite', 'N20'))
                conf = str(row.get('confidence', 'nominal'))

                # Tactical Classification rules complying with environmental physics & user mandate:
                # 1. Check if coordinate is in the Ocean / Sea / Maritime waters
                is_on_land = bool(globe.is_land(lat, lon))
                has_map_data = bool(row.get('country') or row.get('city'))
                loc_raw = row.get('location_name', '')

                # ─────────────────────────────────────────────────────────────
                # RULE 1: Ocean / Sea / Water Body
                # ─────────────────────────────────────────────────────────────
                # There are NO forests or crops in open water. Thermal detections in
                # the ocean / sea are offshore oil platforms, drilling rigs, flare stacks,
                # or maritime energy operations -> MUST be Persistent Industrial Thermal Source!
                if not is_on_land:
                    cls = "Persistent Industrial Thermal Source"
                    ai_conf = 0.96
                    terrain = "Water / Offshore Marine Platform"
                    risk = "Routine Operational"
                    strat = "Continuous Offshore Flare Monitoring · Standard Maritime Operations"
                    speed = 0.0
                    fac_type = "Offshore Oil/Gas Platform & Flare Rig"
                    zone_type = "Maritime Energy Extraction Field"
                    cntry = row.get('country', '')
                    if cntry:
                        loc_str = f"Offshore Energy Platform, {cntry} Waters"
                    else:
                        loc_str = f"Offshore Energy Platform ({lat:.2f}°, {lon:.2f}°)"

                # ─────────────────────────────────────────────────────────────
                # RULE 2: No Map Data / Remote Unclassified Coordinates
                # ─────────────────────────────────────────────────────────────
                # If there is no map data, cannot classify as forest fire or accidental industrial fire.
                # Must be kept under Persistent Industrial Thermal Source (ongoing/regular work).
                elif not has_map_data:
                    cls = "Persistent Industrial Thermal Source"
                    ai_conf = 0.88
                    terrain = "Unmapped Industrial Sector"
                    risk = "Routine Operational"
                    strat = "Routine Thermal Tracking & Satellite Emissions Monitoring"
                    speed = 0.0
                    fac_type = "Continuous Industrial Thermal Work"
                    zone_type = "Persistent Thermal Operation"
                    loc_str = f"Industrial Thermal Zone ({lat:.2f}°, {lon:.2f}°)"

                # ─────────────────────────────────────────────────────────────
                # RULE 3: Regular Ongoing Industrial Works (Happening Regularly)
                # ─────────────────────────────────────────────────────────────
                # Refineries, petrochemical complexes, flare stacks, smelters, steel mills,
                # cement kilns, and continuous industrial facilities operate 24/7.
                # Any detection verified on an industrial site or with nighttime industrial thermal signatures:
                # - If catastrophic emergency hazard spike (FRP >= 120 MW and B4 >= 365 K) -> Industrial Fire
                # - All regular ongoing industrial operations -> Persistent Industrial Thermal Source
                elif (row.get('is_industrial', False) or row.get('is_industrial_map', False) or 
                      (b4 >= 355.0 and daynight == 'N') or 
                      (b4 >= 360.0 and frp >= 60.0)):
                    if frp >= 120.0 and b4 >= 365.0:
                        cls = "Industrial Fire"
                        ai_conf = round(min(0.98, 0.88 + (frp / 600.0) * 0.10), 2)
                        terrain = "Industry / Factory"
                        risk = "Critical Hazard"
                        strat = "Emergency Hazmat Deployment & Flare Isolation"
                        speed = round(min(14.0, 3.5 + frp * 0.04), 2)
                        fac_type = "Critical Industrial Fire Hazard"
                        zone_type = "High-Risk Industrial Hazard Sector"
                        loc_str = loc_raw or f"Industrial Fire Zone ({lat:.2f}°, {lon:.2f}°)"
                    else:
                        cls = "Persistent Industrial Thermal Source"
                        ai_conf = round(min(0.96, 0.84 + (frp / 500.0) * 0.11), 2)
                        terrain = "Industry / Factory"
                        risk = "Controlled Operational"
                        strat = "Log Emissions & Routine Operational Monitoring"
                        speed = round(min(5.0, 1.0 + frp * 0.02), 2)
                        fac_type = "Regular Operational Industrial Facility"
                        zone_type = "Continuous Industrial Complex"
                        loc_str = loc_raw or f"Industrial Facility ({lat:.2f}°, {lon:.2f}°)"

                # ─────────────────────────────────────────────────────────────
                # RULE 5: Wildfire / Forest Fire (Vegetation strictly on Land)
                # ─────────────────────────────────────────────────────────────
                elif frp >= 40.0:
                    cls = "Forest Fire"
                    ai_conf = round(min(0.95, 0.78 + (frp / 400.0) * 0.16), 2)
                    terrain = "Forest Canopy"
                    risk = "High" if frp >= 90.0 else "Medium"
                    strat = "Aerial Retardant Drop & Bulldoze Firebreak"
                    speed = round(min(22.0, 4.0 + frp * 0.05), 2)
                    fac_type = "Wildland Sector"
                    zone_type = "Natural Forest Vegetation"
                    loc_str = loc_raw or f"Wildland Region ({lat:.2f}°, {lon:.2f}°)"

                # ─────────────────────────────────────────────────────────────
                # RULE 6: Agricultural Burn (Crop residue strictly on Land)
                # ─────────────────────────────────────────────────────────────
                else:
                    cls = "Agricultural Burn"
                    ai_conf = round(min(0.91, 0.72 + (frp / 100.0) * 0.18), 2)
                    terrain = "Agricultural Farmland"
                    risk = "Low"
                    strat = "Controlled Perimeter Burn Monitoring"
                    speed = round(min(6.0, 1.0 + frp * 0.02), 2)
                    fac_type = "Agricultural Sector"
                    zone_type = "Cultivated Crop Field"
                    loc_str = loc_raw or f"Farmland Region ({lat:.2f}°, {lon:.2f}°)"

                is_industrial_entity = (cls in ["Industrial Fire", "Persistent Industrial Thermal Source"])

                feat = {
                    "type": "Feature",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [lon, lat]
                    },
                    "properties": {
                        "latitude": lat,
                        "longitude": lon,
                        "bright_ti4": b4,
                        "scan": float(row.get('scan', 0.4)),
                        "track": float(row.get('track', 0.4)),
                        "acq_date": acq_d,
                        "acq_time": acq_t,
                        "satellite": sat,
                        "instrument": "VIIRS",
                        "confidence": conf,
                        "version": str(row.get('version', '2.0NRT')),
                        "bright_ti5": float(row.get('bright_ti5', 285.0)),
                        "frp": frp,
                        "daynight": daynight,
                        "brightness": b4,
                        "brightness_bg": float(row.get('bright_ti5', 285.0)),
                        "is_industrial": is_industrial_entity,
                        "facility_type": fac_type,
                        "zone_type": zone_type,
                        "temperature": 28.5,
                        "humidity": 45.0,
                        "wind_speed": 14.2,
                        "wind_direction": 220,
                        "aqi": 115 if is_industrial_entity else 85,
                        "persistence": 0.85 if is_industrial_entity else 0.20,
                        "satellite_terrain": terrain,
                        "vision_greenery": 5.0 if not is_on_land else (12.0 if is_industrial_entity else 65.0),
                        "vision_structure": 9.0 if is_industrial_entity else 1.2,
                        "vision_built": 0.50 if is_industrial_entity else 0.05,
                        "tile_url": f"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/15/{lat}/{lon}",
                        "is_industrial_map": is_industrial_entity,
                        "ai_classification": cls,
                        "ai_confidence": ai_conf,
                        "spread_speed_kmh": speed,
                        "risk_level": risk,
                        "mitigation_strategy": strat,
                        "location_name": loc_str,
                        "country": row.get('country', ''),
                        "state": row.get('state', ''),
                        "city": row.get('city', '')
                    }
                }
                features.append(feat)

            # Preserve confirmed persistent ground-truth industrial facilities from previous catalogue
            # (e.g. Jamnagar, Jurong, Houston, Ras Tanura) ensuring they are marked under Persistent Industrial Thermal Source
            if os.path.exists(PROCESSED_GEOJSON_PATH):
                try:
                    with open(PROCESSED_GEOJSON_PATH, "r", encoding="utf-8") as f_prev:
                        prev_data = json.load(f_prev)
                        for pf in prev_data.get("features", []):
                            p = pf.get("properties", {})
                            p_lat = round(p.get("latitude", 0), 3)
                            p_lon = round(p.get("longitude", 0), 3)
                            p_land = bool(globe.is_land(p_lat, p_lon))
                            
                            # Standardize classification for persistent facilities
                            if not p_land or p.get("ai_classification") in ["Industrial Fire", "Persistent Industrial Thermal Source"]:
                                if not p_land:
                                    p["ai_classification"] = "Persistent Industrial Thermal Source"
                                    p["satellite_terrain"] = "Water / Offshore Marine Platform"
                                    p["facility_type"] = "Offshore Oil/Gas Platform & Flare Rig"
                                    p["zone_type"] = "Maritime Energy Extraction Field"
                                    p["risk_level"] = "Routine Operational"
                                    p["mitigation_strategy"] = "Continuous Offshore Flare Monitoring · Standard Maritime Operations"
                                elif p.get("frp", 0) < 120.0:
                                    p["ai_classification"] = "Persistent Industrial Thermal Source"
                                    p["facility_type"] = p.get("facility_type") if p.get("facility_type") and p.get("facility_type") != "Unknown" else "Regular Operational Industrial Facility"
                                    p["zone_type"] = p.get("zone_type") if p.get("zone_type") and p.get("zone_type") != "Unknown" else "Continuous Industrial Complex"
                                    p["risk_level"] = "Controlled Operational"
                                    p["mitigation_strategy"] = "Log Emissions & Routine Operational Monitoring"

                                already_has = any(
                                    round(f["properties"]["latitude"], 3) == p_lat and 
                                    round(f["properties"]["longitude"], 3) == p_lon
                                    for f in features
                                )
                                if not already_has:
                                    features.append(pf)
                except Exception:
                    pass

            geojson_doc = {
                "type": "FeatureCollection",
                "name": "classified_hotspots",
                "crs": {
                    "type": "name",
                    "properties": {
                        "name": "urn:ogc:def:crs:OGC:1.3:CRS84"
                    }
                },
                "features": features
            }

            # Atomic save to prevent half-written files
            os.makedirs(os.path.dirname(PROCESSED_GEOJSON_PATH), exist_ok=True)
            tmp_path = f"{PROCESSED_GEOJSON_PATH}.tmp"
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(geojson_doc, f)
            os.replace(tmp_path, PROCESSED_GEOJSON_PATH)

            self.last_sync_time = datetime.now(timezone.utc)
            self.total_fires_synced = len(features)
            self.sync_count += 1
            self.is_syncing = False

            return {
                "status": "success",
                "message": f"Successfully synced {len(features)} active fires from NASA FIRMS NRT.",
                "latest_satellite_acq": self.latest_acq_utc,
                "total_fires": self.total_fires_synced,
                "sync_time_utc": self.last_sync_time.strftime("%Y-%m-%d %H:%M:%S UTC")
            }

        except Exception as e:
            self.is_syncing = False
            self.last_error = str(e)
            return {
                "status": "error",
                "message": f"Sync failed: {str(e)}"
            }

# Singleton instance for the application
sync_manager = LiveSyncManager()
