"""
Persistence Feature Computation
---------------------------------
Replaces the binary `is_industrial → 0.9/0.1` hack with a real temporal
recurrence metric computed from 30-day FIRMS historical data.

A persistent industrial source (flare, kiln, plant) fires at the SAME
geographic pixel repeatedly — often nightly. A wildfire moves. A gas leak
is a one-off event. This temporal signature is the most reliable way to
distinguish persistent flares from accidental fires.

Persistence score = number of days in the past 30 that FIRMS detected
a hotspot within ~1km of this coordinate, divided by 30.
Range: 0.0 (never seen before) → 1.0 (detected every single day).
"""

import os
import math
import requests
import pandas as pd
import geopandas as gpd
from dotenv import load_dotenv

load_dotenv()

FIRMS_API_BASE = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"
AREA = "world"
GRID_SIZE_DEG = 0.01  # ~1.1 km grid for matching


def fetch_historical_for_persistence(api_key: str, days: int = 1) -> pd.DataFrame:
    """
    Download FIRMS data for persistence computation.
    Capped at 1 day for global feed to prevent large payload timeouts.
    """
    url = f"{FIRMS_API_BASE}/{api_key}/VIIRS_SNPP_NRT/{AREA}/{min(days, 1)}"
    print(f"Fetching {days}-day FIRMS history for persistence analysis...")
    
    try:
        resp = requests.get(url, timeout=60)
        if resp.status_code == 200 and "Error" not in resp.text:
            df = pd.read_csv(pd.io.common.StringIO(resp.text))
            
            # Filter low-confidence
            if 'confidence' in df.columns and df['confidence'].dtype == object:
                df = df[df['confidence'] != 'l']
            
            print(f"  ✅ Retrieved {len(df)} historical records over {days} days")
            return df
        else:
            print(f"  ⚠️  Historical API returned: {resp.status_code}")
            return pd.DataFrame()
    except Exception as e:
        print(f"  ❌ Error: {e}")
        return pd.DataFrame()


def compute_persistence_scores(
    hotspots_gdf: gpd.GeoDataFrame,
    historical_df: pd.DataFrame,
    grid_size: float = GRID_SIZE_DEG,
    window_days: int = 30,
) -> pd.Series:
    """
    For each hotspot, count how many unique days in `historical_df` had a
    detection within `grid_size` degrees (~1 km). Divide by `window_days`
    to normalise to [0, 1].

    This is intentionally simple — for production, use an H3 or S2 spatial
    index for speed. For ~500 hotspots this is fast enough.
    
    Returns:
        pd.Series of persistence scores, aligned to hotspots_gdf index.
    """
    if historical_df.empty:
        print("  ⚠️  No historical data — returning persistence=0.0 for all hotspots.")
        return pd.Series(0.0, index=hotspots_gdf.index)
    
    # Snap historical detections to grid
    historical_df = historical_df.copy()
    historical_df['lat_g'] = (historical_df['latitude'] / grid_size).round() * grid_size
    historical_df['lon_g'] = (historical_df['longitude'] / grid_size).round() * grid_size
    historical_df['acq_date'] = pd.to_datetime(historical_df['acq_date'])
    
    # Build a lookup: (lat_g, lon_g) → set of unique days
    hist_lookup: dict[tuple, set] = {}
    for _, row in historical_df.iterrows():
        key = (round(row['lat_g'], 4), round(row['lon_g'], 4))
        if key not in hist_lookup:
            hist_lookup[key] = set()
        hist_lookup[key].add(row['acq_date'].date())
    
    scores = []
    for _, hotspot in hotspots_gdf.iterrows():
        lat_g = round(round(hotspot['latitude'] / grid_size) * grid_size, 4)
        lon_g = round(round(hotspot['longitude'] / grid_size) * grid_size, 4)
        
        days_detected = len(hist_lookup.get((lat_g, lon_g), set()))
        score = min(days_detected / window_days, 1.0)
        scores.append(round(score, 4))
    
    score_series = pd.Series(scores, index=hotspots_gdf.index)
    
    non_zero = (score_series > 0).sum()
    high_persistence = (score_series > 0.5).sum()
    print(f"  ✅ Persistence computed: {non_zero} hotspots have prior history")
    print(f"     High-persistence (>0.5, likely flares/plants): {high_persistence}")
    
    return score_series


def add_persistence_to_hotspots(geojson_path: str, api_key: str) -> None:
    """
    Full pipeline: load hotspots GeoJSON → fetch 30-day history →
    compute persistence scores → save updated GeoJSON.
    """
    print(f"\n📅 Computing persistence scores for {geojson_path}...")
    
    if not os.path.exists(geojson_path):
        print(f"  ❌ File not found: {geojson_path}")
        return
    
    gdf = gpd.read_file(geojson_path)
    if gdf.empty:
        print("  ⚠️  No hotspots to process.")
        return
    
    historical = fetch_historical_for_persistence(api_key, days=30)
    
    gdf['persistence'] = compute_persistence_scores(gdf, historical)
    
    # Serialise geometry-incompatible types
    for col in gdf.columns:
        if col != 'geometry' and gdf[col].dtype == 'object':
            gdf[col] = gdf[col].astype(str)
    
    gdf.to_file(geojson_path, driver="GeoJSON")
    print(f"  ✅ Persistence scores saved back to {geojson_path}")
    
    # Summary
    print("\nPersistence score distribution:")
    bins = [0.0, 0.1, 0.3, 0.5, 0.8, 1.01]
    labels = ["0 (new)", "0.1–0.3 (rare)", "0.3–0.5 (recurring)",
              "0.5–0.8 (frequent)", "0.8–1.0 (daily/flare)"]
    for i, label in enumerate(labels):
        count = ((gdf['persistence'] >= bins[i]) & (gdf['persistence'] < bins[i+1])).sum()
        print(f"  {label}: {count}")


if __name__ == "__main__":
    api_key = os.getenv("FIRMS_API_KEY")
    if not api_key:
        print("❌ Set FIRMS_API_KEY in .env")
    else:
        add_persistence_to_hotspots("data/processed/merged_hotspots.geojson", api_key)
