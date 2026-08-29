import os
import glob
import pandas as pd
import geopandas as gpd
from shapely.geometry import Point

# Required columns that must exist in FIRMS data for inference
REQUIRED_FIRMS_COLS = ['latitude', 'longitude', 'frp', 'daynight']

# Brightness column: VIIRS uses 'bright_ti4', MODIS uses 'brightness'
BRIGHTNESS_CANDIDATES = ['bright_ti4', 'brightness']


def validate_and_normalise_firms(df: pd.DataFrame) -> pd.DataFrame:
    """
    Validate FIRMS data has required columns.
    Normalise brightness column naming.
    Filter out low-confidence detections.
    """
    # Check required columns
    missing = [c for c in REQUIRED_FIRMS_COLS if c not in df.columns]
    if missing:
        raise ValueError(f"FIRMS data missing required columns: {missing}")
    
    # Unified brightness column
    brightness_col = next((c for c in BRIGHTNESS_CANDIDATES if c in df.columns), None)
    if brightness_col is None:
        print("  ⚠️  No brightness column found. Adding default 315 K.")
        df['brightness'] = 315.0
    elif brightness_col != 'brightness':
        df['brightness'] = df[brightness_col]
    
    # Also keep bright_ti5 / bright_t31 as background brightness if available
    bg_candidates = ['bright_ti5', 'bright_t31']
    bg_col = next((c for c in bg_candidates if c in df.columns), None)
    if bg_col and 'brightness_bg' not in df.columns:
        df['brightness_bg'] = df[bg_col]
    
    # ---- Confidence filtering ----
    original_len = len(df)
    if 'confidence' in df.columns:
        if df['confidence'].dtype == object:
            # VIIRS: 'l' = low, 'n' = nominal, 'h' = high — drop low
            df = df[df['confidence'] != 'l'].copy()
        else:
            # MODIS: 0–100 integer — keep ≥ 30
            df = df[pd.to_numeric(df['confidence'], errors='coerce').fillna(0) >= 30].copy()
        
        removed = original_len - len(df)
        if removed > 0:
            print(f"  🔍 Confidence filter: removed {removed} low-confidence detections "
                  f"({100*removed/original_len:.1f}% of raw data)")
    
    # Drop any rows with NaN in critical columns
    df = df.dropna(subset=['latitude', 'longitude', 'frp'])
    
    print(f"  ✅ Validated {len(df)} hotspots (from {original_len} raw)")
    return df


def preprocess_and_join():
    print("=" * 60)
    print("Starting Data Preprocessing and Spatial Join...")
    print("=" * 60)
    
    # -----------------------------------------------------------
    # 1. Load latest FIRMS data (prefer merged multi-source file)
    # -----------------------------------------------------------
    merged_files = glob.glob("data/raw/firms_merged_*.csv")
    single_files = glob.glob("data/raw/firms_VIIRS_*.csv") + glob.glob("data/raw/firms_MODIS_*.csv")
    
    all_files = merged_files + single_files
    if not all_files:
        print("❌ No FIRMS data found in data/raw/")
        print("   Run: python src/data/ingest_firms.py")
        return
    
    latest_firms = max(all_files, key=os.path.getctime)
    df_firms = pd.read_csv(latest_firms)
    print(f"\n📂 Loaded {len(df_firms)} raw records from: {os.path.basename(latest_firms)}")
    
    if df_firms.empty:
        print("❌ FIRMS dataset is empty. Exiting.")
        return
    
    # -----------------------------------------------------------
    # 2. Validate, normalise, and filter confidence
    # -----------------------------------------------------------
    df_firms = validate_and_normalise_firms(df_firms)
    
    if df_firms.empty:
        print("❌ No valid hotspots after filtering. Exiting.")
        return

    # -----------------------------------------------------------
    # 3. Convert to GeoDataFrame
    # -----------------------------------------------------------
    geometry = [Point(xy) for xy in zip(df_firms['longitude'], df_firms['latitude'])]
    gdf_firms = gpd.GeoDataFrame(df_firms, geometry=geometry, crs="EPSG:4326")
    
    # -----------------------------------------------------------
    # 4. Load OSM / Curated Land Zones (All 5 Types)
    # -----------------------------------------------------------
    zones_path = "data/raw/zones/all_zones_india.geojson"
    
    if not os.path.exists(zones_path):
        print(f"❌ Zone data not found. Run: python src/data/ingest_land_zones.py")
        return
    
    gdf_zones = gpd.read_file(zones_path)
    print(f"\n🌍 Loaded {len(gdf_zones)} land zones from {os.path.basename(zones_path)}")
    
    if gdf_zones.empty:
        print("⚠️  Land zone data is empty. All hotspots will be marked unknown.")
        gdf_firms['is_industrial'] = False
        gdf_firms['facility_type'] = 'Unknown'
        gdf_firms['zone_type'] = 'none'
        joined_gdf = gdf_firms
    else:
        # -----------------------------------------------------------
        # 5. Project for Distance Calculations
        # -----------------------------------------------------------
        print(f"\n🔄 Projecting to UTM 44N for exact proximity calculations...")
        gdf_zones_proj = gdf_zones.to_crs("EPSG:32644")  # UTM 44N (central India)
        gdf_firms_proj = gdf_firms.to_crs("EPSG:32644")
        
        # -----------------------------------------------------------
        # 6. Spatial Join Nearest (Finds nearest zone and calculates distance)
        # -----------------------------------------------------------
        print(f"🔗 Performing spatial proximity join...")
        joined_gdf_proj = gpd.sjoin_nearest(
            gdf_firms_proj, 
            gdf_zones_proj, 
            how="left", 
            distance_col="nearest_zone_dist_m"
        )
        joined_gdf = joined_gdf_proj.to_crs("EPSG:4326")
        
        # Consider it 'inside' the zone if distance is <= 500m (our threshold buffer)
        joined_gdf['is_industrial'] = (joined_gdf['nearest_zone_dist_m'] <= 500) & (joined_gdf['zone_type'].isin(['industrial', 'mining']))
        
        # Derive facility_type for the ML model
        def classify_facility(row):
            dist = row.get('nearest_zone_dist_m', 999999)
            if dist > 500: return 'none'  # Outside threshold boundary
            
            zt = str(row.get('zone_type', ''))
            st = str(row.get('subtype', '')) if row.get('subtype') is not None else ''
            
            if zt == 'industrial':
                if 'refinery' in st: return 'oil_refinery'
                if 'steel' in st: return 'steel_plant'
                if 'power' in st: return 'power_plant'
                if 'chemical' in st: return 'chemical_plant'
                return 'industrial_generic'
            elif zt == 'mining':
                if 'coal' in st: return 'coal_mine'
                return 'mine'
            elif zt == 'agricultural':
                return 'farmland'
            elif zt == 'forest':
                return 'forest'
            elif zt == 'parks':
                return 'protected_area'
            
            return 'none'
        
        joined_gdf['facility_type'] = joined_gdf.apply(classify_facility, axis=1)
        
        # Propagate zone type and name
        if 'name_right' in joined_gdf.columns:
            joined_gdf['zone_name'] = joined_gdf['name_right'].fillna('Unknown Location')
        elif 'name' in joined_gdf.columns:
            joined_gdf['zone_name'] = joined_gdf['name'].fillna('Unknown Location')
            
        if 'zone_type_right' in joined_gdf.columns:
            joined_gdf['zone_type'] = joined_gdf['zone_type_right'].fillna('none')
        elif 'zone_type' in joined_gdf.columns:
            joined_gdf['zone_type'] = joined_gdf['zone_type'].fillna('none')
            
        # If it's further than 500m, we record the proximity but nullify the zone type so it doesn't skew aggregate stats
        joined_gdf.loc[joined_gdf['nearest_zone_dist_m'] > 500, 'zone_type'] = 'none'
        
        # Clean up columns
        cols_to_drop = [c for c in joined_gdf.columns
                        if c in ['index_right', 'name_right', 'name_left', 'name',
                                 'landuse', 'industrial', 'power', 'man_made', 'natural',
                                 'boundary', 'protect_class', 'subtype',
                                 'facility_type_right', 'facility_type_left', 
                                 'zone_type_right', 'zone_type_left', 'region',
                                 'source', 'area_sqkm', 'zone_color', 'zone_label']]
        joined_gdf = joined_gdf.drop(columns=[c for c in cols_to_drop if c in joined_gdf.columns])
    
    # -----------------------------------------------------------
    # 7. Save Processed Data
    # -----------------------------------------------------------
    os.makedirs("data/processed", exist_ok=True)
    out_path = "data/processed/merged_hotspots.geojson"
    
    if 'acq_date' in joined_gdf.columns:
        joined_gdf['acq_date'] = joined_gdf['acq_date'].astype(str)
    
    # Drop duplicate rows that can appear from one-to-many spatial joins
    joined_gdf = joined_gdf.drop_duplicates(subset=['latitude', 'longitude', 'acq_date', 'acq_time']
                                            if 'acq_time' in joined_gdf.columns
                                            else ['latitude', 'longitude', 'acq_date'])
    
    joined_gdf.to_file(out_path, driver="GeoJSON")
    
    # -----------------------------------------------------------
    # 8. Summary
    # -----------------------------------------------------------
    industrial_count = joined_gdf['is_industrial'].sum()
    total = len(joined_gdf)
    
    print(f"\n✅ Spatial join complete!")
    print(f"   Total hotspots: {total}")
    print(f"   Inside industrial/mining zones: {industrial_count} ({100*industrial_count/max(total,1):.1f}%)")
    
    if 'zone_type' in joined_gdf.columns:
        print("\n   Hotspots by Zone Type:")
        for ztype, count in joined_gdf['zone_type'].value_counts().items():
            print(f"   {ztype}: {count}")
    
    print(f"\n   Saved to {out_path}")


if __name__ == "__main__":
    preprocess_and_join()
