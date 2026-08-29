import os
import osmnx as ox
import geopandas as gpd
import pandas as pd

# India-wide FIRMS bounding box: 68°E–97°E, 8°N–37°N
# We fetch major industrial clusters separately so OSM queries stay fast
# Each tuple: (name, north, south, east, west)
INDUSTRIAL_REGIONS = [
    # Gujarat (Jamnagar, Surat, Vadodara, Ankleshwar)
    ("Gujarat",          23.5, 20.5, 73.5, 68.0),
    # Mumbai Metropolitan Region + Pune Industrial Belt
    ("Mumbai_Pune",      19.5, 18.0, 74.5, 72.5),
    # Jharkhand + WB Steel Belt (Jamshedpur, Durgapur, Asansol)
    ("Steel_Belt",       24.0, 22.0, 88.0, 85.5),
    # Odisha mining + steel (Rourkela, Talcher, Angul)
    ("Odisha",           22.0, 19.5, 85.5, 83.0),
    # Andhra + Telangana (Visakhapatnam, Hyderabad)
    ("AP_Telangana",     18.0, 15.5, 83.5, 78.0),
    # Tamil Nadu (Chennai, Ennore, Tuticorin)
    ("Tamil_Nadu",       13.5, 8.0,  80.5, 77.0),
    # Rajasthan mining (Kota, Bhilwara, Bikaner)
    ("Rajasthan",        28.5, 24.5, 76.5, 72.0),
    # UP + Haryana industrial corridors (Noida, Panipat, Mathura)
    ("UP_Haryana",       28.8, 26.0, 78.5, 76.0),
    # Punjab (Ludhiana, Amritsar, Bathinda refinery)
    ("Punjab",           32.0, 29.5, 76.0, 73.5),
    # Assam oil fields (Digboi, Numaligarh)
    ("Assam",            27.5, 25.5, 95.0, 91.0),
]

# OSM tags for industrial/energy sources
INDUSTRIAL_TAGS = {
    'landuse': ['industrial', 'commercial'],
    'power': ['plant', 'substation'],
    'industrial': True,
    'man_made': ['works', 'petroleum_well', 'gasometer', 'chimney'],
    'amenity': 'fuel',
}

def fetch_osm_industrial_data():
    """
    Fetch industrial/energy infrastructure from OSM across major Indian industrial regions.
    Uses chunked regional queries to avoid OSM timeout errors.
    """
    print("Fetching OSM industrial data for major Indian industrial regions...")
    ox.settings.max_query_area_size = 250_000_000_000  # 250,000 sq km

    all_gdfs = []

    for region_name, north, south, east, west in INDUSTRIAL_REGIONS:
        bbox = (north, south, east, west)
        print(f"  → Querying {region_name} ({south:.1f}°N–{north:.1f}°N, {west:.1f}°E–{east:.1f}°E)...")
        try:
            gdf = ox.features_from_bbox(bbox=bbox, tags=INDUSTRIAL_TAGS)
            if not gdf.empty:
                # Keep only polygon geometries (not points/lines)
                gdf = gdf[gdf.geometry.type.isin(['Polygon', 'MultiPolygon'])].copy()
                if not gdf.empty:
                    gdf['region'] = region_name
                    all_gdfs.append(gdf)
                    print(f"     Found {len(gdf)} polygons in {region_name}")
                else:
                    print(f"     No polygon features in {region_name}")
            else:
                print(f"     No features found in {region_name}")
        except Exception as e:
            print(f"     Error querying {region_name}: {e}")
            continue

    if not all_gdfs:
        print("❌ No OSM data fetched from any region.")
        return None

    # Merge all regions
    combined = gpd.GeoDataFrame(
        pd.concat(all_gdfs, ignore_index=True),
        crs="EPSG:4326"
    )
    
    # Keep only the essential columns
    cols_to_keep = ['geometry', 'name', 'landuse', 'power', 'industrial', 'man_made', 'region']
    cols = [c for c in cols_to_keep if c in combined.columns]
    combined = combined[cols].to_crs("EPSG:4326")
    
    # Remove duplicate geometries
    combined = combined.drop_duplicates(subset='geometry')

    os.makedirs("data/raw", exist_ok=True)
    output_path = "data/raw/osm_industrial_india.geojson"
    combined.to_file(output_path, driver="GeoJSON")

    print(f"\n✅ Saved {len(combined)} total industrial polygons to {output_path}")
    print("Region breakdown:")
    if 'region' in combined.columns:
        for region, count in combined['region'].value_counts().items():
            print(f"  {region}: {count} polygons")
    
    return combined

if __name__ == "__main__":
    fetch_osm_industrial_data()
