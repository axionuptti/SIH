import os
import cv2
import numpy as np
import requests
from requests.adapters import HTTPAdapter
import math
from concurrent.futures import ThreadPoolExecutor

CACHE_DIR = "cache/tiles"
os.makedirs(CACHE_DIR, exist_ok=True)

# Re-usable session with connection pooling for maximum concurrent tile downloading
session = requests.Session()
adapter = HTTPAdapter(pool_connections=32, pool_maxsize=32, max_retries=2)
session.mount('https://', adapter)
session.mount('http://', adapter)
SESSION_HEADERS = {'User-Agent': 'GeoAIFireSentinel/2.0 (SatelliteVisionEngine)'}

def deg2num(lat_deg, lon_deg, zoom=15):
    """Calculate XYZ tile coordinates from lat/lon."""
    lat_rad = math.radians(lat_deg)
    n = 2.0 ** zoom
    xtile = int((lon_deg + 180.0) / 360.0 * n)
    ytile = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)
    return xtile, ytile

def get_esri_tile_url(lat, lon, zoom=15):
    """Get the direct ESRI satellite imagery URL for given coordinates."""
    x, y = deg2num(lat, lon, zoom)
    return f"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{zoom}/{y}/{x}"

def get_esri_tile_image(lat, lon, zoom=15):
    """Downloads or retrieves from local disk cache ESRI satellite tile."""
    x, y = deg2num(lat, lon, zoom)
    cache_path = os.path.join(CACHE_DIR, f"{zoom}_{x}_{y}.jpg")
    
    if os.path.exists(cache_path):
        img = cv2.imread(cache_path)
        if img is not None:
            return img
            
    url = f"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{zoom}/{y}/{x}"
    try:
        resp = session.get(url, headers=SESSION_HEADERS, timeout=4)
        if resp.status_code == 200:
            image_array = np.asarray(bytearray(resp.content), dtype=np.uint8)
            img = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
            if img is not None:
                cv2.imwrite(cache_path, img)
            return img
    except Exception:
        pass
        
    return None

def analyze_terrain_metrics(img):
    """
    Analyzes high-resolution satellite tile using Computer Vision to distinguish:
    1. Industry / Factory (Rectilinear buildings, structural lines, steel/concrete roofs)
    2. Forest Canopy (Dense vegetation, organic leaf texture, minimal linear structure)
    3. Agricultural Farmland (Crops, tilled plots, regular field boundaries)
    4. Water / Offshore (Non-reflective blue/dark oceanic surfaces)
    5. Barren / Shrubland (Dry soil, scrub, rocky terrain)

    Returns: (terrain_label, greenery_pct, structure_idx)
    """
    if img is None:
        return "Barren / Shrubland", 0.0, 0.0
        
    height, width = img.shape[:2]
    total_pixels = height * width
    
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    
    # 1. Water Index (Deep blues and dark oceanic reflectance)
    mask_water = cv2.inRange(hsv, np.array([90, 30, 20]), np.array([140, 255, 200]))
    water_ratio = cv2.countNonZero(mask_water) / total_pixels
    
    # 2. Greenery Index (Living forest biomass & dense canopy)
    mask_green = cv2.inRange(hsv, np.array([30, 40, 30]), np.array([85, 255, 255]))
    green_ratio = cv2.countNonZero(mask_green) / total_pixels
    
    # 3. Metallic / Concrete Roofs (Low saturation, high brightness: S < 40, V > 120)
    mask_roof = cv2.inRange(hsv, np.array([0, 0, 120]), np.array([180, 40, 255]))
    roof_ratio = cv2.countNonZero(mask_roof) / total_pixels

    # 4. Built-Up / Concrete Pads (Low saturation, mid value: S < 50, 60 < V < 220)
    mask_built = cv2.inRange(hsv, np.array([0, 0, 60]), np.array([180, 50, 220]))
    built_ratio = cv2.countNonZero(mask_built) / total_pixels
    
    # 5. Agricultural Index (Crops, tilled soil, stubble)
    mask_agri = cv2.inRange(hsv, np.array([15, 25, 40]), np.array([30, 255, 255]))
    agri_ratio = cv2.countNonZero(mask_agri) / total_pixels
    
    # 6. Structural Edge & Straight Line Detection (Suppresses organic texture via Gaussian blur)
    blurred = cv2.GaussianBlur(gray, (7, 7), 0)
    edges = cv2.Canny(blurred, 60, 180)
    edge_ratio = cv2.countNonZero(edges) / total_pixels
    
    lines = cv2.HoughLinesP(edges, 1, np.pi/180, threshold=45, minLineLength=30, maxLineGap=6)
    n_lines = len(lines) if lines is not None else 0
    
    greenery_pct = round(green_ratio * 100.0, 1)
    structure_idx = round((n_lines / 10.0) + (roof_ratio * 50.0), 2)

    # ── Strict Ground-Truth Industry Verification ──
    # A true industrial facility requires human architecture:
    # 1. Metallic or concrete building roofs (roof_ratio >= 1.5%)
    # 2. Built-up paved yards or asphalt pads (built_ratio >= 4%)
    # 3. Orthogonal linear building edges (n_lines >= 1)
    has_industry_structures = (
        (roof_ratio >= 0.015 and built_ratio >= 0.04 and n_lines >= 1) or
        (built_ratio >= 0.12 and n_lines >= 2) or
        (n_lines >= 15 and built_ratio >= 0.05) or
        (roof_ratio >= 0.03)
    )

    if water_ratio > 0.40:
        return "Water / Offshore", greenery_pct, structure_idx
        
    if has_industry_structures:
        return "Industry / Factory", greenery_pct, structure_idx
        
    # If not industry and has vegetation -> Forest Canopy
    if green_ratio >= 0.25:
        return "Forest Canopy", greenery_pct, structure_idx
        
    # Crop plots
    if agri_ratio >= 0.25:
        return "Agricultural Farmland", greenery_pct, structure_idx
        
    # If no industry and open wildland -> Forest / Wildland Canopy
    return "Forest Canopy", greenery_pct, structure_idx

def analyze_terrain(img):
    """Backwards-compatible wrapper returning only the terrain label."""
    terrain, _, _ = analyze_terrain_metrics(img)
    return terrain

def classify_terrain_from_coordinates(lat, lon, zoom=15):
    """Classifies satellite terrain for a single coordinate."""
    img = get_esri_tile_image(lat, lon, zoom=zoom)
    terrain, greenery, struct = analyze_terrain_metrics(img)
    return {
        "terrain": terrain,
        "greenery_pct": greenery,
        "structure_idx": struct,
        "tile_url": get_esri_tile_url(lat, lon, zoom=zoom)
    }

def classify_hotspots_terrain_batch(coords_list, max_workers=20, zoom=15):
    """
    Classifies a list of (lat, lon) coordinates in parallel using a thread pool.
    Returns a list of classified terrain strings in the exact same order.
    """
    detailed = classify_hotspots_terrain_batch_detailed(coords_list, max_workers=max_workers, zoom=zoom)
    return [d["satellite_terrain"] for d in detailed]

def classify_hotspots_terrain_batch_detailed(coords_list, max_workers=20, zoom=15):
    """
    High-performance batch processor:
    1. Groups coordinates by unique (zoom, x, y) tile to avoid duplicate downloads and analysis.
    2. Downloads & analyzes unique tiles concurrently using ThreadPoolExecutor.
    3. Reconstructs ordered results for each coordinate.
    """
    if not coords_list:
        return []

    tile_to_coords = {}
    coord_to_tile_key = []
    
    for idx, (lat, lon) in enumerate(coords_list):
        try:
            lat_f = float(lat)
            lon_f = float(lon)
            x, y = deg2num(lat_f, lon_f, zoom)
            key = (zoom, x, y)
        except Exception:
            key = (zoom, 0, 0)
        
        coord_to_tile_key.append(key)
        if key not in tile_to_coords:
            tile_to_coords[key] = (lat_f, lon_f)

    unique_tiles = list(tile_to_coords.items())
    tile_analysis_cache = {}

    def _process_tile(tile_item):
        (z, x, y), (sample_lat, sample_lon) = tile_item
        cache_path = os.path.join(CACHE_DIR, f"{z}_{x}_{y}.jpg")
        tile_url = f"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        
        img = None
        if os.path.exists(cache_path):
            img = cv2.imread(cache_path)
            
        if img is None:
            try:
                resp = session.get(tile_url, headers=SESSION_HEADERS, timeout=4)
                if resp.status_code == 200:
                    image_array = np.asarray(bytearray(resp.content), dtype=np.uint8)
                    img = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
                    if img is not None:
                        cv2.imwrite(cache_path, img)
            except Exception:
                pass

        terrain, greenery, struct = analyze_terrain_metrics(img)
        return (z, x, y), {
            "satellite_terrain": terrain,
            "vision_greenery": greenery,
            "vision_structure": struct,
            "tile_url": tile_url
        }

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        for key, res in executor.map(_process_tile, unique_tiles):
            tile_analysis_cache[key] = res

    results = []
    for key in coord_to_tile_key:
        if key in tile_analysis_cache:
            results.append(tile_analysis_cache[key])
        else:
            results.append({
                "satellite_terrain": "Barren / Shrubland",
                "vision_greenery": 0.0,
                "vision_structure": 0.0,
                "tile_url": f"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{zoom}/{key[2]}/{key[1]}"
            })

    return results
