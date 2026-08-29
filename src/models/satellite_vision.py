import cv2
import numpy as np
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import math

def deg2num(lat_deg, lon_deg, zoom):
    """Calculate XYZ tile coordinates from lat/lon."""
    lat_rad = math.radians(lat_deg)
    n = 2.0 ** zoom
    xtile = int((lon_deg + 180.0) / 360.0 * n)
    ytile = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)
    return xtile, ytile

def get_esri_tile_image(lat, lon, zoom=15):
    """Downloads ESRI satellite tile into an OpenCV image (numpy array)."""
    x, y = deg2num(lat, lon, zoom)
    url = f"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{zoom}/{y}/{x}"
    
    headers = {'User-Agent': 'GeoAIFireSentinel/1.0'}
    
    session = requests.Session()
    retry = Retry(total=3, backoff_factor=1, status_forcelist=[ 500, 502, 503, 504 ])
    adapter = HTTPAdapter(max_retries=retry)
    session.mount('http://', adapter)
    session.mount('https://', adapter)
    
    try:
        resp = session.get(url, headers=headers, timeout=10)
        if resp.status_code == 200:
            image_array = np.asarray(bytearray(resp.content), dtype=np.uint8)
            img = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
            return img
    except Exception as e:
        print(f"Error fetching tile: {e}")
    finally:
        session.close()
        
    return None

def analyze_terrain(img):
    """
    Analyzes satellite tile using Computer Vision to distinguish:
    1. Manmade Structures (Industrial/Urban)
    2. Dense Vegetation (Forest)
    3. Sparse/Barren Land
    """
    if img is None:
        return "Unknown"
        
    height, width = img.shape[:2]
    total_pixels = height * width
    
    # 1. Greenery Index (HSV color thresholding for vegetation)
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    # Define range for green colors
    lower_green = np.array([30, 40, 40])
    upper_green = np.array([90, 255, 255])
    mask_green = cv2.inRange(hsv, lower_green, upper_green)
    
    green_pixels = cv2.countNonZero(mask_green)
    greenery_ratio = green_pixels / total_pixels
    
    # 2. Structure Index (Straight line detection for manmade objects)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    
    # Gaussian blur to remove small noise (like individual leaves)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    
    # Canny edge detection
    edges = cv2.Canny(blurred, 50, 150, apertureSize=3)
    
    # Hough Line Transform to find long straight lines (buildings, roads)
    lines = cv2.HoughLinesP(edges, 1, np.pi/180, threshold=50, minLineLength=40, maxLineGap=10)
    
    total_line_length = 0
    if lines is not None:
        for line in lines:
            flat_line = line.flatten()
            if len(flat_line) >= 4:
                x1, y1, x2, y2 = flat_line[:4]
                length = math.sqrt((x2 - x1)**2 + (y2 - y1)**2)
                total_line_length += length
            
    # Normalize structure index by image dimension
    structure_index = total_line_length / width

    # 3. Decision Logic
    if structure_index > 1.5:
        return "Industrial/Manmade"
    elif greenery_ratio > 0.35:
        return "Forest/Green"
    else:
        return "Barren/Land"

def classify_terrain_from_coordinates(lat, lon):
    """Main wrapper function for the AI Pipeline."""
    img = get_esri_tile_image(lat, lon, zoom=15)
    terrain = analyze_terrain(img)
    return terrain
