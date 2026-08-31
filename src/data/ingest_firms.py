import os
import requests
import pandas as pd
from datetime import datetime, timedelta
from dotenv import load_dotenv

load_dotenv()

# NASA FIRMS API Base URL
FIRMS_API_BASE = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"
FIRMS_HIST_BASE = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"

# India Bounding Box (West, South, East, North)
BBOX = "68,8,97,37"

# Multi-source configuration — each adds complementary detection capability
SOURCES = {
    "VIIRS_SNPP_NRT":   {"resolution": "375m", "priority": 1, "desc": "Suomi-NPP VIIRS (primary, 375m)"},
    "VIIRS_NOAA20_NRT": {"resolution": "375m", "priority": 2, "desc": "NOAA-20 VIIRS (cross-validation, 375m)"},
    "MODIS_NRT":        {"resolution": "1km",  "priority": 3, "desc": "Terra/Aqua MODIS (broader coverage, 1km)"},
}

def fetch_firms_data(api_key, source="VIIRS_SNPP_NRT", days=1):
    """
    Fetch active fire / thermal anomaly data from NASA FIRMS NRT API.
    
    Sources:
        VIIRS_SNPP_NRT    — 375m, Suomi-NPP (primary)
        VIIRS_NOAA20_NRT  — 375m, NOAA-20 (provides ~6h offset, doubles coverage)
        MODIS_NRT         — 1km, Terra+Aqua (wider FOV, catches large events)
    """
    url = f"{FIRMS_API_BASE}/{api_key}/{source}/{BBOX}/{days}"
    print(f"  Fetching {SOURCES.get(source, {}).get('desc', source)}...")
    
    try:
        response = requests.get(url, timeout=30)
        
        if response.status_code == 429 or "rate limit" in response.text.lower():
            print(f"  ⚠️  RATE LIMIT REACHED for {source}. NASA API limits exceeded.")
            return None
            
        if response.status_code == 200:
            if "Error" in response.text or len(response.text.strip()) < 50:
                print(f"  ⚠️  FIRMS returned error or empty response for {source}: {response.text[:100]}")
                return None
            
            os.makedirs("data/raw", exist_ok=True)
            file_path = f"data/raw/firms_{source}_{datetime.now().strftime('%Y%m%d')}.csv"
            with open(file_path, 'w') as f:
                f.write(response.text)
            
            df = pd.read_csv(file_path)
            print(f"  ✅ {source}: {len(df)} hotspots (saved to {os.path.basename(file_path)})")
            return df
        else:
            print(f"  ❌ HTTP {response.status_code} for {source}: {response.text[:100]}")
            return None
    except Exception as e:
        print(f"  ❌ Error fetching {source}: {e}")
        return None


def fetch_firms_historical(api_key, source="VIIRS_SNPP_NRT", days_back=30):
    """
    Fetch historical FIRMS data for persistence analysis.
    Returns the last `days_back` days of data for computing recurrence.
    Limited to 30 days per the free FIRMS API tier.
    """
    days = min(days_back, 30)  # FIRMS API max is 30 days for free tier
    url = f"{FIRMS_HIST_BASE}/{api_key}/{source}/{BBOX}/{days}"
    print(f"  Fetching {days}-day historical data from {source} for persistence analysis...")
    
    try:
        response = requests.get(url, timeout=60)
        if response.status_code == 200 and "Error" not in response.text:
            df = pd.read_csv(pd.io.common.StringIO(response.text))
            print(f"  ✅ Historical: {len(df)} records over {days} days")
            return df
        else:
            print(f"  ⚠️  Historical fetch failed: {response.status_code}")
            return None
    except Exception as e:
        print(f"  ❌ Error fetching historical FIRMS data: {e}")
        return None


def merge_multi_source(dfs_by_source: dict) -> pd.DataFrame:
    """
    Merge FIRMS data from multiple sensors.
    
    Strategy:
        1. Standardise column names (MODIS vs VIIRS differ slightly)
        2. Tag each record with its source
        3. Deduplicate by spatial proximity (~1km grid) — keep highest-confidence record
        4. Count how many sources detected the same pixel (cross_source_count)
    """
    normalised = []
    
    col_remap = {
        # MODIS uses 'brightness', VIIRS uses 'bright_ti4'
        'brightness':  'brightness',
        'bright_ti4':  'brightness',
        'bright_t31':  'brightness_bg',
        'bright_ti5':  'brightness_bg',
    }
    
    for source, df in dfs_by_source.items():
        if df is None or df.empty:
            continue
        df = df.copy()
        df['source'] = source
        
        # Rename brightness columns to a unified name
        for old, new in col_remap.items():
            if old in df.columns and new not in df.columns:
                df = df.rename(columns={old: new})
        
        # Ensure required columns exist
        for col in ['latitude', 'longitude', 'frp', 'confidence', 'daynight']:
            if col not in df.columns:
                df[col] = None
        
        # Filter out low-confidence detections (noise, sunglint)
        # VIIRS: confidence is 'l'/'n'/'h' — drop 'l'
        # MODIS: confidence is 0–100 integer — keep >= 30
        if df['confidence'].dtype == object:
            df = df[df['confidence'] != 'l']
        else:
            df = df[pd.to_numeric(df['confidence'], errors='coerce').fillna(0) >= 30]
        
        normalised.append(df)
    
    if not normalised:
        return pd.DataFrame()
    
    merged = pd.concat(normalised, ignore_index=True)
    
    # Round coordinates to ~1km grid for deduplication
    merged['lat_1km'] = (merged['latitude'] * 100).round() / 100
    merged['lon_1km'] = (merged['longitude'] * 100).round() / 100
    
    # Count how many distinct sources detected each ~1km pixel
    cross_count = (
        merged.groupby(['lat_1km', 'lon_1km', 'acq_date'])['source']
        .nunique()
        .reset_index()
        .rename(columns={'source': 'cross_source_count'})
    )
    merged = merged.merge(cross_count, on=['lat_1km', 'lon_1km', 'acq_date'], how='left')
    
    # For each ~1km pixel, keep the highest-resolution source record
    # Priority: VIIRS_SNPP > VIIRS_NOAA20 > MODIS
    priority_map = {s: info['priority'] for s, info in SOURCES.items()}
    merged['source_priority'] = merged['source'].map(priority_map).fillna(99)
    
    deduped = (
        merged.sort_values('source_priority')
        .drop_duplicates(subset=['lat_1km', 'lon_1km', 'acq_date'], keep='first')
        .drop(columns=['lat_1km', 'lon_1km', 'source_priority'])
    )
    
    print(f"\n📡 Multi-source merge complete:")
    print(f"   Total records before dedup: {len(merged)}")
    print(f"   After dedup (highest-res kept): {len(deduped)}")
    if 'cross_source_count' in deduped.columns:
        multi = (deduped['cross_source_count'] > 1).sum()
        print(f"   Multi-sensor confirmed detections: {multi} ({100*multi/max(len(deduped),1):.1f}%)")
    
    return deduped


if __name__ == "__main__":
    api_key = os.getenv("FIRMS_API_KEY")
    if not api_key or api_key == "your_nasa_firms_api_key_here":
        print("❌ Please set your FIRMS_API_KEY in the .env file.")
    else:
        print("🛰️  Fetching multi-source FIRMS data for India...")
        dfs = {}
        for source in SOURCES:
            dfs[source] = fetch_firms_data(api_key, source=source, days=1)
        
        merged = merge_multi_source(dfs)
        if not merged.empty:
            out_path = f"data/raw/firms_merged_{datetime.now().strftime('%Y%m%d')}.csv"
            merged.to_csv(out_path, index=False)
            print(f"\n✅ Merged data saved to {out_path}")
            print(f"   Total unique hotspots: {len(merged)}")
