# 🔥 Geo-AI Fire Sentinel
### Real-Time Industrial Fire Detection & Classification System for India

> **Smart India Hackathon (SIH) 2026 — Prototype**  
> AI-driven, satellite-powered anomaly detection and tactical threat classification across the Indian subcontinent.

---

## 📌 Table of Contents

1. [Project Overview](#1-project-overview)
2. [Key Features](#2-key-features)
3. [System Architecture](#3-system-architecture)
4. [Technology Stack](#4-technology-stack)
5. [Data Sources](#5-data-sources)
6. [Directory Structure](#6-directory-structure)
7. [Installation & Setup](#7-installation--setup)
8. [Configuration](#8-configuration)
9. [Running the Pipeline](#9-running-the-pipeline)
10. [Pipeline Stages Deep Dive](#10-pipeline-stages-deep-dive)
11. [Machine Learning Model](#11-machine-learning-model)
12. [Tactical Inference Engine](#12-tactical-inference-engine)
13. [API Reference](#13-api-reference)
14. [Frontend Dashboard](#14-frontend-dashboard)
15. [Land Zone System](#15-land-zone-system)
16. [Satellite Vision CV Module](#16-satellite-vision-cv-module)
17. [Persistence Scoring](#17-persistence-scoring)
18. [Weather and AQI Enrichment](#18-weather-and-aqi-enrichment)
19. [Performance and Accuracy](#19-performance-and-accuracy)
20. [Normal Baselines India](#20-normal-baselines-india)
21. [Roadmap and Future Work](#21-roadmap-and-future-work)
22. [Troubleshooting](#22-troubleshooting)
23. [License](#23-license)

---

## 1. Project Overview

**Geo-AI Fire Sentinel** is an end-to-end, production-grade geospatial intelligence platform that ingests live satellite thermal anomaly data from NASA's FIRMS (Fire Information for Resource Management System), classifies every detected hotspot using a multi-stage machine learning pipeline, and presents the results on a premium, real-time interactive web dashboard.

The system was built to solve a critical gap in India's industrial safety and disaster management infrastructure: **existing satellite fire detection provides only raw thermal anomaly data — it cannot distinguish between a routine gas flare, an accidental refinery explosion, a gas leak, or a spreading wildfire.** Geo-AI Fire Sentinel fills this gap by automatically classifying each anomaly into one of seven tactical categories and generating geometric predictions for evacuation zones, firebreak lines, and predictive fire spread.

### Problem Statement

Industrial fires, gas leaks, and wildfires pose severe risks to public safety, the environment, and critical infrastructure in India. NASA's FIRMS satellites detect thermal anomalies across the country in near real-time, but every detection — whether it's a Tata Steel blast furnace or a forest fire in Corbett — is reported identically as a "fire/hotspot." Emergency responders have no automated, reliable way to distinguish these events.

### Solution

This system combines:
- **Multi-satellite NRT ingestion** (VIIRS SNPP, NOAA-20, MODIS)
- **Spatial intelligence** via land zone proximity analysis
- **Temporal persistence scoring** (30-day recurrence)
- **Meteorological context enrichment** (temperature, wind, humidity, AQI)
- **A trained gradient boosting classifier** with visual terrain cross-verification
- **Physics-based tactical geometry generation** (Rothermel fire-spread model)
- **A real-time glassmorphic web dashboard** with live incident feeds

---

## 2. Key Features

| Feature | Description |
|---|---|
| **Multi-Satellite NRT Ingestion** | Fetches live data from 3 NASA satellites (VIIRS SNPP, NOAA-20, MODIS) covering all of India (68E-97E, 8N-37N) |
| **7-Class AI Classification** | Classifies each hotspot as: Accidental Industrial Fire, Industrial Flare, Routine Industrial Heat, Gas Leakage, Smoke Plume, Wildfire, or Natural Anomaly |
| **Physics-Based Spread Prediction** | Generates mathematically-accurate elliptical fire spread polygons using the Rothermel model with dynamic Length-to-Width ratio |
| **Tactical Mitigation Geometry** | Auto-generates firebreak line recommendations and evacuation perimeters sized by fire intensity (FRP) |
| **181-Zone Land Database** | Curated database of all major industrial, forest, national park, agricultural, and mining zones across India |
| **30-Day Persistence Scoring** | Distinguishes persistent industrial flares from one-off accidents using 30-day historical recurrence |
| **Real-Time Weather Integration** | Enriches every hotspot with live temperature, humidity, wind speed/direction, and European AQI via Open-Meteo |
| **Computer Vision Terrain Verification** | Downloads and analyzes live ESRI satellite imagery tile at each hotspot location to visually confirm terrain type |
| **Live Dashboard** | Premium glassmorphic web UI with real-time incident feeds, animated stats, Chart.js analytics, and Leaflet.js map |
| **REST API** | Full FastAPI backend with automatic OpenAPI docs at /docs |
| **Fast Mode Pipeline** | Re-runs inference in minutes using cached zone data and existing model |

---

## 3. System Architecture

```
EXTERNAL DATA SOURCES
  NASA FIRMS API (VIIRS/MODIS NRT)
  Open-Meteo API (Weather + AQI)
  ESRI World Imagery (Satellite Tiles)
         |
         v
DATA INGESTION LAYER
  ingest_firms.py       -> Multi-satellite CSV data
  ingest_weather.py     -> Real-time weather per hotspot
  satellite_vision.py   -> CV tile download and analysis
         |
         v
FEATURE ENGINEERING LAYER
  preprocess_spatial.py     -> Multi-source merge, spatial join, confidence filter
  compute_persistence.py    -> 30-day recurrence scoring
  ingest_land_zones.py      -> 181-zone polygon database
         |
         v
ML MODEL LAYER
  train.py       -> HistGradientBoosting + RandomForest training
  inference.py   -> Classification + tactical geometry generation
         |
         v
API & SERVING LAYER (FastAPI)
  GET /api/hotspots          -> classified_hotspots.geojson
  GET /api/predictive-spread -> predictive_spread.geojson
  GET /api/mitigations       -> mitigation_zones.geojson
  GET /api/zones/{type}      -> land zone polygons
  GET /dashboard             -> Static frontend
         |
         v
FRONTEND DASHBOARD
  Leaflet.js + Chart.js + Vanilla JS + CSS Glassmorphism
  14 toggleable layers, live incident feed, rich popups
```

---

## 4. Technology Stack

### Backend & ML

| Library | Version | Purpose |
|---|---|---|
| Python | 3.9+ | Core language |
| FastAPI | >= 0.104 | REST API framework with OpenAPI docs |
| Uvicorn | >= 0.24 | ASGI server |
| scikit-learn | >= 1.3 | HistGradientBoosting, RandomForest, cross-validation |
| XGBoost | >= 2.0 | Auxiliary gradient boosting |
| GeoPandas | >= 0.14 | Geospatial dataframe operations and spatial joins |
| Shapely | >= 2.0 | Geometry creation (Polygon, LineString, ellipse math) |
| PyProj | >= 3.6 | CRS transformations (EPSG:4326 to EPSG:32644 UTM 44N) |
| Rasterio | >= 1.3 | Raster data handling |
| OSMnx | >= 1.7 | OpenStreetMap feature fetching |
| Pandas | >= 2.0 | Data manipulation and CSV processing |
| NumPy | >= 1.24 | Numerical computation |
| Requests | >= 2.31 | HTTP API calls |
| OpenCV (cv2) | latest | Computer vision terrain classification |
| python-dotenv | >= 1.0 | Environment variable management |

### Frontend

| Technology | Purpose |
|---|---|
| HTML5 + Vanilla CSS | Structure and glassmorphism styling |
| Leaflet.js 1.9.4 | Interactive map rendering |
| Chart.js | Donut analytics chart |
| Google Fonts (Outfit) | Premium typography |
| ESRI World Imagery | Satellite base map tiles |
| CartoDB Dark Labels | Map label overlay |

### External APIs

| API | Usage |
|---|---|
| NASA FIRMS API | Near Real-Time satellite hotspot data (free key required) |
| Open-Meteo Weather API | Real-time weather per hotspot location (free, no key) |
| Open-Meteo Air Quality API | European AQI per hotspot (free, no key) |
| ESRI ArcGIS Online | Satellite map tiles for dashboard and CV verification |

---

## 5. Data Sources

### 5.1 NASA FIRMS (Fire Information for Resource Management System)

- **URL:** https://firms.modaps.eosdis.nasa.gov/
- **Access:** Free API key required
- **Bounding Box:** `68,8,97,37` (covers all of India: West, South, East, North)

| Satellite | Product | Resolution | Update Frequency |
|---|---|---|---|
| Suomi-NPP | VIIRS_SNPP_NRT | 375m (primary) | ~3-4 hours |
| NOAA-20 (JPSS-1) | VIIRS_NOAA20_NRT | 375m (cross-validation) | ~3-4 hours, offset ~6h |
| Terra/Aqua | MODIS_NRT | 1km (broader coverage) | ~3-4 hours |

### 5.2 Open-Meteo

- **URL:** https://open-meteo.com/ (free, no API key needed)
- **Data per hotspot:** temperature_2m, relative_humidity_2m, wind_speed_10m, wind_direction_10m, european_aqi
- **Strategy:** Bulk batches of up to 90 coordinates per HTTP request

### 5.3 Land Zone Database

- **Source 1:** Bhuvan/ISRO WFS — official Government of India geospatial data
- **Source 2:** Geofabrik OSM India extract — pre-processed, region-chunked queries
- **Source 3:** Curated hardcoded zones from FSI, MoEFCC, IBEF, Ministry of Mines official coordinates
- **Coverage:** 181+ major zones across 5 types

### 5.4 ESRI World Imagery

- **URL:** https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/
- **Usage:** High-resolution satellite tile download for CV terrain classifier (zoom level 15)

---

## 6. Directory Structure

```
Project-1/
|
+-- run_pipeline.py             # Main pipeline orchestrator (run this!)
+-- requirements.txt            # Python dependencies
+-- system_requirements.md      # SIH project requirements
+-- industrial_fire_detection_report.md  # Full technical report
+-- .env                        # API keys (never commit to git!)
|
+-- src/
|   +-- api/
|   |   +-- main.py             # FastAPI application with REST endpoints
|   |
|   +-- data/
|   |   +-- ingest_firms.py     # NASA FIRMS multi-satellite NRT ingestion
|   |   +-- ingest_land_zones.py# Land zone database builder (multi-source)
|   |   +-- ingest_osm.py       # OpenStreetMap industrial zone fetcher
|   |   +-- ingest_weather.py   # Open-Meteo weather + AQI enrichment
|   |   +-- compute_persistence.py  # 30-day hotspot persistence scorer
|   |   +-- extract_gee_features.py # Google Earth Engine blueprint (future)
|   |
|   +-- features/
|   |   +-- preprocess_spatial.py   # Spatial join, confidence filter, zone tagging
|   |   +-- generate_synthetic_data.py  # Training data generator (calibrated to VIIRS)
|   |
|   +-- models/
|   |   +-- train.py            # ML model training (HistGB + RandomForest)
|   |   +-- inference.py        # Tactical inference engine + geometry generation
|   |   +-- satellite_vision.py # OpenCV terrain classifier (CV cross-verification)
|   |   +-- saved_models/
|   |       +-- gradient_boosting_fire_classifier.pkl  # Primary model
|   |       +-- random_forest_fire_classifier.pkl      # Secondary model
|   |       +-- training_log.json                      # Training history
|   |
|   +-- frontend/
|   |   +-- index.html          # Dashboard HTML
|   |   +-- style.css           # Glassmorphism CSS design system
|   |   +-- app.js              # Map logic, API calls, rendering
|   |
|   +-- visualization/          # Jupyter notebook visualizations
|
+-- data/
    +-- raw/
    |   +-- firms_merged_YYYYMMDD.csv    # Multi-source FIRMS merged data
    |   +-- firms_VIIRS_SNPP_NRT_*.csv   # Per-satellite raw data
    |   +-- osm_industrial_india.geojson # OSM industrial polygons
    |   +-- zones/
    |       +-- all_zones_india.geojson       # Merged all zone types
    |       +-- industrial_zones_india.geojson
    |       +-- forest_zones_india.geojson
    |       +-- parks_zones_india.geojson
    |       +-- agricultural_zones_india.geojson
    |       +-- mining_zones_india.geojson
    |
    +-- processed/
        +-- merged_hotspots.geojson       # After spatial join + weather enrichment
        +-- synthetic_training_data.csv   # ML training dataset (10,000 samples)
        +-- classified_hotspots.geojson   # Final AI-classified output
        +-- predictive_spread.geojson     # Rothermel fire spread ellipses
        +-- mitigation_zones.geojson      # Firebreak lines + evacuation perimeters
```

---

## 7. Installation & Setup

### Prerequisites
- Python 3.9 or higher
- pip (Python package manager)
- A NASA FIRMS API key (free — takes ~30 seconds to get)

### Step 1: Clone the Repository
```bash
git clone <repository-url>
cd Project-1
```

### Step 2: Create a Virtual Environment
```bash
python3 -m venv venv
source venv/bin/activate   # macOS / Linux
# OR
venv\Scripts\activate      # Windows
```

### Step 3: Install Dependencies
```bash
pip install -r requirements.txt
```

> **Note for Apple Silicon (M1/M2/M3/M4):** If you encounter issues with fiona, rasterio, or gdal:
> ```bash
> brew install gdal
> pip install fiona --no-binary fiona
> pip install rasterio
> ```

### Step 4: Get Your NASA FIRMS API Key
1. Visit https://firms.modaps.eosdis.nasa.gov/api/
2. Register for a free account
3. Your API key will be emailed to you immediately

### Step 5: Configure Environment Variables
Create a `.env` file in the project root:
```bash
FIRMS_API_KEY=your_actual_api_key_here
```

---

## 8. Configuration

The `.env` file is the only required configuration:

```bash
FIRMS_API_KEY=your_nasa_firms_api_key_here
```

### Key Constants

**src/data/ingest_firms.py**
```python
BBOX = "68,8,97,37"  # India bounding box (West, South, East, North)
SOURCES = {
    "VIIRS_SNPP_NRT":   {"resolution": "375m", "priority": 1},
    "VIIRS_NOAA20_NRT": {"resolution": "375m", "priority": 2},
    "MODIS_NRT":        {"resolution": "1km",  "priority": 3},
}
```

**src/models/inference.py**
```python
FIREBREAK_LOOKAHEAD = 1.5   # Firebreak placed 1.5x spread distance ahead
EVAC_RADIUS_PER_FRP = 0.08  # km of evacuation radius per MW of FRP
EVAC_RADIUS_MIN_KM = 1.5    # Minimum evacuation zone (1.5 km)
FIRE_SPREAD_COEFF = 0.07    # km/h per MW.FRP in Rothermel model
```

**src/data/compute_persistence.py**
```python
GRID_SIZE_DEG = 0.01  # ~1.1 km grid for temporal matching
```

---

## 9. Running the Pipeline

### Quick Start (Fast Mode ~3-5 minutes)
Re-fetches live satellite data and runs inference using cached zones and model:
```bash
python run_pipeline.py
```

### Full Mode (First Time or Full Refresh ~10-15 minutes)
Fetches fresh OSM data and retrains the ML model:
```bash
python run_pipeline.py --full
```

### Custom Flags
```bash
python run_pipeline.py --full --skip-osm    # Full run, reuse existing zones
python run_pipeline.py --full --skip-train  # Full run, reuse existing model
python run_pipeline.py --skip-train         # Fast mode, skip model retrain
```

### Start the Dashboard
After the pipeline completes:
```bash
uvicorn src.api.main:app --host 0.0.0.0 --port 8000 --reload
```
Open: **http://localhost:8000/dashboard**

The dashboard auto-refreshes every **30 seconds**.

---

## 10. Pipeline Stages Deep Dive

The `run_pipeline.py` orchestrator runs 7 sequential stages, each independently logged and error-tracked:

---

### Stage 1 — Multi-Source FIRMS Ingestion
**File:** `src/data/ingest_firms.py`

Fetches live NRT thermal anomaly data from three NASA satellites simultaneously.

**Multi-source merge strategy:**
1. Normalize column names (MODIS uses `brightness`, VIIRS uses `bright_ti4`)
2. Filter low-confidence detections (VIIRS: drop `confidence='l'`; MODIS: drop `confidence < 30`)
3. Round coordinates to ~1km grid and count satellite co-detections (`cross_source_count`)
4. Keep highest-resolution source for each pixel (VIIRS > MODIS)

**Output:** `data/raw/firms_merged_YYYYMMDD.csv`

---

### Stage 2 — Land Zone Ingestion (Optional / Cached)
**File:** `src/data/ingest_land_zones.py`

Builds a comprehensive polygon database of 5 land zone types across India using 3 data sources in priority order:
1. Bhuvan/ISRO WFS (Government of India)
2. Geofabrik OSM India Extract
3. Curated hardcoded database (FSI, MoEFCC, IBEF, Ministry of Mines)

Zone types:
- **Industrial** `#818cf8` — Factories, oil refineries (Jamnagar, Digboi), power plants, SEZs
- **Forest** `#22c55e` — Reserve forests, protected forests (~21% of India's land)
- **National Parks** `#10b981` — 106 parks, sanctuaries, tiger reserves, biosphere reserves
- **Agricultural** `#f59e0b` — Cropland, paddy fields, orchards
- **Mining** `#f97316` — Coal mines, quarries (Jharkhand, Odisha, Rajasthan)

**Output:** `data/raw/zones/` (one GeoJSON per type + merged all_zones_india.geojson)

---

### Stage 3 — Spatial Preprocessing & Confidence Filter
**File:** `src/features/preprocess_spatial.py`

1. Load latest merged FIRMS CSV
2. Validate required columns (latitude, longitude, frp, daynight)
3. Normalize brightness column naming across satellite sources
4. Filter low-confidence detections
5. Convert to GeoDataFrame with point geometries (EPSG:4326)
6. Re-project to UTM Zone 44N (EPSG:32644) for accurate meter-distance calculations
7. Nearest-zone spatial join (`gpd.sjoin_nearest`) to tag each hotspot with zone info
8. Classify facility type (oil_refinery, steel_plant, power_plant, coal_mine, etc.)
9. Set `is_industrial` flag for hotspots within 500m of industrial/mining zones
10. Deduplicate one-to-many join artifacts

**Output:** `data/processed/merged_hotspots.geojson`

---

### Stage 4 — Weather + AQI Enrichment
**File:** `src/data/ingest_weather.py`

Fetches real-time meteorological data from Open-Meteo (free, no key needed) for every hotspot.

| Field | Description |
|---|---|
| temperature | 2m air temperature (Celsius) |
| humidity | Relative humidity at 2m (%) |
| wind_speed | Wind speed at 10m (km/h) |
| wind_direction | Wind direction at 10m (degrees, 0=North) |
| aqi | European Air Quality Index |

Requests are batched in chunks of 90 coordinates per API call.

**Why this matters:** Wind speed/direction drives the Rothermel spread model. AQI serves as a proxy for CH4 and aerosol index in the ML feature matrix.

**Output:** Updated `data/processed/merged_hotspots.geojson`

---

### Stage 5 — 30-Day Persistence Scoring
**File:** `src/data/compute_persistence.py`

Computes a `persistence` score [0.0 to 1.0] for each hotspot:
1. Downloads 30 days of VIIRS-SNPP historical data
2. Snaps detections to ~1.1 km grid (GRID_SIZE_DEG = 0.01 degrees)
3. Builds lookup: (lat_grid, lon_grid) to set of unique detection dates
4. For each hotspot: `persistence = days_detected_in_past_30 / 30.0`

**Interpretation:**
- `0.0` — New event (accident, wildfire, gas leak)
- `0.1-0.3` — Occasional (agricultural burns)
- `0.5-0.8` — Frequent (active industrial site)
- `0.8-1.0` — Daily (refinery flare, kiln, cement plant)

**Output:** Updated `data/processed/merged_hotspots.geojson` with `persistence` column

---

### Stage 6 — ML Model Training (Optional)
**File:** `src/models/train.py`

Trains two complementary models on a 10,000-sample synthetic dataset calibrated to real VIIRS NRT observations. See Section 11 for full details.

**Output:** `src/models/saved_models/`

---

### Stage 7 — AI Inference + Tactical Geometry Generation
**File:** `src/models/inference.py`

The core classification and tactical output stage. Applies multi-stage classification logic plus physics-based geometry generation. See Sections 12 and 13.

**Outputs:**
- `data/processed/classified_hotspots.geojson` — All hotspots with AI classification
- `data/processed/predictive_spread.geojson` — Rothermel fire spread ellipses
- `data/processed/mitigation_zones.geojson` — Firebreak lines + evacuation perimeters

---

## 11. Machine Learning Model

### Training Data Generation
**File:** `src/features/generate_synthetic_data.py`

10,000 synthetic samples calibrated to real VIIRS NRT observations:

| Class | Label | Approx Samples | Key Discriminators |
|---|---|---|---|
| 0 | Wildfire / Natural | ~4,000 | FRP 0.5-30 MW, Brightness 300-365 K, Low persistence 0-0.15 |
| 1 | Industrial Flare | ~3,500 | FRP 0.3-15 MW, HIGH persistence 0.75-1.0, is_industrial=1 |
| 2 | Accidental Industrial Fire | ~1,000 | FRP 15-200 MW, Brightness 335-420 K, Low persistence 0-0.25 |
| 3 | Gas Leakage (Chemical) | ~800 | FRP 0-5 MW (often unignited), Very high CH4 2500-5500 ppb |
| 4 | Smoke Plume | ~700 | Low FRP 0.2-8 MW, Very high aerosol index 3.5-8.0 |

### Feature Columns

```python
FEATURE_COLS = [
    'frp',               # Fire Radiative Power (MW) — thermal intensity
    'brightness',        # Brightness temperature (K) — pixel heat signature
    'is_industrial',     # Boolean: within 500m of industrial/mining zone
    'ch4_concentration', # Methane proxy: 1850 + (AQI x 0.5) + industrial bonus
    'aerosol_index',     # Aerosol proxy: AQI / 50 (range 0.05-8.0)
    'day_night',         # Acquisition time: 1=day, 0=night
    'persistence',       # 30-day recurrence score [0.0-1.0]
    'temperature',       # 2m air temperature (Celsius)
    'humidity',          # Relative humidity (%)
    'wind_speed',        # Wind speed at 10m (km/h)
]
```

### Model Architecture

**Primary: HistGradientBoostingClassifier**
```python
HistGradientBoostingClassifier(
    max_iter=500,
    max_leaf_nodes=63,       # Deep trees for complex multi-class
    learning_rate=0.05,      # Low LR + more iterations = better generalization
    min_samples_leaf=20,     # Prevents overfitting on rare classes
    l2_regularization=0.1,
    class_weight='balanced'  # Native upweighting for rare classes
)
```

**Secondary: Random Forest (comparison + feature importance)**
```python
RandomForestClassifier(
    n_estimators=200,
    max_depth=15,
    min_samples_leaf=10,
    class_weight='balanced',
    n_jobs=-1
)
```

### Validation
- Train/Test Split: 80% / 20% with `stratify=y`
- Cross-Validation: 5-Fold Stratified CV (macro F1 score)
- Class Imbalance: `compute_sample_weight('balanced')` on training samples

### Feature Importance (Top 5 by Random Forest)
1. **frp** — Most discriminating thermal signal
2. **brightness** — Raw pixel temperature separates intense fires from smoldering
3. **persistence** — Best long-term discriminator between flares and accidents
4. **ch4_concentration** — Key for gas leak detection
5. **is_industrial** — Binary zone flag provides critical spatial context

---

## 12. Tactical Inference Engine

**File:** `src/models/inference.py`

The inference pipeline applies 5 stages of classification logic beyond raw ML:

### Stage A: ML Prediction
`model.predict()` and `model.predict_proba()` for class predictions and real confidence scores.

### Stage B: Spatial Override Logic
For `Wildfire / Natural` class (0):
- In forest/parks zones → reclassify as `Wildfire`
- In industrial/mining zones → reclassify as `Routine Industrial Heat`
- Otherwise → runs Computer Vision terrain verification

### Stage C: Industrial Fire Confirmation Rule (3-Condition Gate)
```
Condition 1: is_massive_heat  = FRP > 10.0 MW AND Brightness > 352 K (79 degrees C)
Condition 2: is_sudden        = Persistence < 0.4 (not a recurring source)
Condition 3: is_verified      = Cross-source count > 1 OR confidence > 85%
```
All 3 must be met. Triggers additional CV verification. If any fails: defaults to `Routine Industrial Heat`.

### Stage D: Wildfire Confirmation
Requires brightness > 325 K (52 degrees C) for active flames. Cooler = `Natural Anomaly`.

### Stage E: Tactical Geometry Generation

**Fire Spread Ellipse (Rothermel Model)**
```
Total spread length = (wind_speed x 0.10 + frp x 0.07) km
L/W ratio = 1.0 + (0.25 x wind_speed), capped at 6.0
Focal offset = 85% head fire, 15% backing fire
36-point ellipse with cos-lat geodesic correction
```

**Firebreak Line**
```
Placed at 1.5x spread distance ahead of the fire tip
Width = 80% of spread half-width
Oriented perpendicular to wind direction
```

**Evacuation Perimeter**
```
Circular zone: radius = max(FRP x 0.08 km, 1.5 km)
Used for Accidental Industrial Fires and Gas Leakages
```

**Physical Footprints by Class**

| Class | Footprint Shape |
|---|---|
| Wildfire | Small Rothermel ellipse (current perimeter) |
| Gas Leakage | Gaussian dispersion plume (60 degree spread cone) |
| Smoke Plume | Narrow dispersal cone (15 degree half-angle) |
| Accidental Fire | Circular burn radius (FRP-scaled) |
| Industrial Flare | Small circle (0.15 km) |

---

## 13. API Reference

FastAPI generates interactive docs at:
- **Swagger UI:** http://localhost:8000/docs
- **ReDoc:** http://localhost:8000/redoc

### Fire Detection Endpoints

#### GET /api/hotspots
Returns all AI-classified hotspots as GeoJSON FeatureCollection.

Response properties per feature:
```json
{
  "ai_classification": "Accidental Industrial Fire",
  "ai_confidence": 87.3,
  "frp": 45.2,
  "brightness": 358.1,
  "risk_level": "Extreme (Explosion / Structural Hazard)",
  "mitigation_strategy": "Establish Evacuation Perimeter",
  "spread_speed_kmh": 3.14,
  "temperature": 36.5,
  "humidity": 28.0,
  "wind_speed": 14.0,
  "wind_direction": 215.0,
  "aqi": 178.0,
  "persistence": 0.07,
  "cross_source_count": 2,
  "acq_date": "2026-08-29",
  "satellite": "N21",
  "nearest_zone_dist_m": 120.5,
  "zone_name": "Jamnagar Refinery Complex",
  "is_industrial": true,
  "facility_type": "oil_refinery"
}
```

#### GET /api/predictive-spread
Returns Rothermel fire spread ellipses for wildfires, accidental fires, and smoke plumes.

#### GET /api/mitigations
Returns tactical mitigation geometry: firebreak lines (LineString) and evacuation perimeters (Polygon).

#### GET /api/stats
Returns classification summary:
```json
{
  "total": 847,
  "by_class": {"Wildfire": 312, "Routine Industrial Heat": 198},
  "avg_confidence": 74.2,
  "zone_data_available": true
}
```

### Land Zone Endpoints

#### GET /api/zones/{zone_type}
Returns GeoJSON polygons for a specific zone. Valid types: `industrial`, `forest`, `parks`, `agricultural`, `mining`

#### GET /api/zones
Returns merged GeoJSON of all zones. Optional filter: `?types=industrial,forest`

#### GET /api/zones-status
Returns availability status and feature counts for all zone types.

---

## 14. Frontend Dashboard

**Files:** `src/frontend/index.html`, `src/frontend/style.css`, `src/frontend/app.js`

### Layout
Three-panel design:
- **Left Panel (360px):** Stats grid, Chart.js donut chart, classification legend, system footer
- **Center:** Full-height Leaflet.js satellite map
- **Right Panel (320px, hideable):** Normal Baselines card + Live Incident Feed

### Map Layers (14 Toggleable)

| Layer | Description |
|---|---|
| Accidental Fires | Critical industrial accidents (red) |
| Industrial Flares | Persistent routine flares (green) |
| Routine Industrial Heat | Stable plant heat (lime) |
| Gas Leakages | Chemical/methane releases (purple) |
| Smoke Plumes | Heavy aerosol events (gray) |
| Wildfires | Active forest fires (orange) |
| Natural Anomalies | Unexplained thermal signatures (amber) |
| Spread Predictions | Rothermel fire spread ellipses |
| Tactical Mitigations | Firebreaks and evacuation perimeters |
| Industrial Zones | All major industrial areas (indigo) |
| Forest / Jungle | Reserve forests (green) |
| National Parks | Protected areas (emerald) |
| Agricultural Zones | Farmland (amber) |
| Mining / Quarries | Extraction zones (orange) |

### Zoom-Adaptive Rendering
- Zoom < 13: Circle markers (performance-optimized)
- Zoom >= 13: True polygon footprints (Rothermel ellipses, gas plumes)

### Rich Popup Cards
Each hotspot popup shows:
- AI classification + color badge
- Confidence score with animated progress bar
- Proximity alert (distance to nearest critical zone)
- Tactical risk level + mitigation strategy
- Fire Intensity (FRP in MW)
- Brightness Temperature in K and degrees C
- Spread speed (km/h)
- AQI with colour-coded severity
- Meteorological panel (temperature, wind direction/speed, humidity)
- 30-day persistence bar with label
- Satellite acquisition date, time, and satellite name

### Live Incident Feed
- Sorted by FRP intensity (highest threat first)
- Shows top 30 critical incidents
- Excludes routine heat and natural anomalies
- Click to fly-to the incident on the map
- Shows "+N% above normal" relative comparison badges

### Panel Controls
- Right panel close button (X): Hides the feed panel; map expands to full width
- "Live Feed" button: Re-opens the right panel from inside the map
- map.invalidateSize() called on toggle to prevent Leaflet rendering issues

---

## 15. Land Zone System

The land zone system is the geospatial backbone of the classification pipeline.

### 1. Offline Spatial Join (Preprocessing)
During Stage 3, every FIRMS hotspot is joined to its nearest land zone polygon using `gpd.sjoin_nearest()` in UTM 44N (meters). Provides:
- `nearest_zone_dist_m` — distance to nearest zone boundary in meters
- `zone_type` — industrial / forest / parks / agricultural / mining
- `zone_name` — specific facility or area name
- `facility_type` — oil_refinery, coal_mine, power_plant, etc.
- `is_industrial` — True if within 500m of industrial or mining zone

### 2. Real-Time Visual Overlay (Dashboard)
Frontend fetches zone GeoJSON from the API and renders transparent color overlays.

### Curated Major Zones

**National Parks and Tiger Reserves (40+):**
Corbett, Kaziranga, Bandhavgarh, Kanha, Ranthambore, Sundarbans, Nagarhole, Gir, Periyar, and all other major protected areas.

**Major Industrial Clusters (80+):**
Jamnagar Reliance Refinery, Vadodara Petrochemical Complex, Ennore Port Industrial, Visakhapatnam Steel Plant, Talcher Coal Fields, Jharia Coalfield, Singrauli Mega Power Plants, and many more.

**Forest Zones (30+):**
Western Ghats biodiversity hotspot, Central Indian forest belt, Northeastern forest cluster, Eastern Ghats.

---

## 16. Satellite Vision CV Module

**File:** `src/models/satellite_vision.py`

Provides an independent visual verification layer — does not rely on ML model or land zone database.

### When Triggered
1. ML classifies a hotspot as `Wildfire / Natural` AND it is not in a known zone
2. A hotspot passes the 3-condition Industrial Fire gate

### Process
1. **Tile Download:** Converts lat/lon to XYZ tile coordinates (zoom 15), downloads ESRI World Imagery tile
2. **Greenery Index:** HSV color thresholding for vegetation. greenery_ratio > 0.35 = Forest
3. **Structure Index:** Gaussian blur → Canny edge detection → Hough Line Transform for straight lines. structure_index > 1.5 = Industrial
4. **Classification:** Returns Industrial/Manmade, Forest/Green, or Barren/Land

### Decision Impact

| CV Result | Effect |
|---|---|
| Industrial/Manmade | Confirms Accidental Industrial Fire |
| Forest/Green | Confirms Wildfire |
| Barren/Land | Falls through to Natural Anomaly |

---

## 17. Persistence Scoring

**File:** `src/data/compute_persistence.py`

The persistence score is the temporal signature of a hotspot — how often has this exact location appeared in the past 30 days?

### Why It Matters
- Jamnagar Refinery flare: Burns 24/7. Persistence ~1.0
- Accidental factory explosion: First-time event. Persistence ~0.0
- Agricultural burn in Punjab: Seasonal. Persistence ~0.1

Without persistence, the ML model would confuse a recurring cement kiln with a critical fire.

### Score Distribution

| Range | Label | Typical Sources |
|---|---|---|
| 0.0 | New event | Accidental fire, wildfire, gas leak |
| 0.1-0.3 | Rare | Agricultural burns, sporadic events |
| 0.3-0.5 | Recurring | Smaller industrial operations |
| 0.5-0.8 | Frequent | Active factories, cement kilns |
| 0.8-1.0 | Daily / Flare | Oil refineries, gas flare stacks, power plants |

---

## 18. Weather and AQI Enrichment

**File:** `src/data/ingest_weather.py`

Real-time meteorological data from Open-Meteo (free, no key required).

### Role in the ML Pipeline

| Feature | Derived From | ML Role |
|---|---|---|
| temperature | temperature_2m | Fire weather indicator |
| humidity | relative_humidity_2m | Combustion environment |
| wind_speed | wind_speed_10m | Fire spread rate input |
| wind_direction | wind_direction_10m | Spread polygon orientation |
| ch4_concentration | AQI proxy formula | Gas leak discriminator |
| aerosol_index | AQI / 50 | Smoke plume discriminator |

### CH4 Proxy Formula
```
ch4_concentration = 1850.0 + (aqi * 0.5) + (is_industrial * 150.0)
Clipped to range: [1800, 3000] ppb
```

### Aerosol Proxy
```
aerosol_index = aqi / 50.0
Clipped to range: [0.05, 8.0]
```

### Fallback Values (API unavailable)
```
temperature  = 25.0 C
humidity     = 50.0 %
wind_speed   = 10.0 km/h
aqi          = 50.0 (Moderate)
```

---

## 19. Performance and Accuracy

### ML Model Performance (10,000-sample synthetic dataset)

| Metric | HistGradientBoosting | RandomForest |
|---|---|---|
| Test Accuracy | ~92-95% | ~89-93% |
| 5-Fold CV Macro F1 | ~0.88-0.92 | N/A |

> **Note:** Real-world accuracy may differ. The model uses AQI-based CH4 proxies due to the absence of direct Sentinel-5P TROPOMI data in the current implementation.

### Pipeline Execution Times (MacBook Air M4)

| Stage | Duration |
|---|---|
| FIRMS Ingestion (3 satellites, 5 days) | 15-60 seconds |
| Land Zone Build (first time, --full) | 5-10 minutes |
| Spatial Preprocessing + Join | 30-120 seconds |
| Weather Enrichment (~500 hotspots) | 30-90 seconds |
| Persistence Scoring (30-day fetch) | 30-60 seconds |
| Model Training (10k samples) | 20-60 seconds |
| AI Inference + Geometry Generation | 60-300 seconds |
| **Total (Fast Mode)** | **~3-8 minutes** |
| **Total (Full Mode, first run)** | **~15-25 minutes** |

---

## 20. Normal Baselines India

Reference values used in the Live Incident Feed relative comparison badges and the Baselines panel:

| Category | FRP Baseline | Temperature Threshold |
|---|---|---|
| Routine Industrial Heat | ~3.1 MW | N/A |
| Accidental Fire (Threat) | >10.0 MW | >352 K (79 degrees C+) |
| Natural Anomaly (Safe) | ~1.5 MW | N/A |
| Wildfire (Active Flame) | N/A | >325 K (52 degrees C) |

The "+N% above normal" badges in the Live Incident Feed compare each hotspot's FRP against the class-appropriate baseline.

---

## 21. Roadmap and Future Work

### Short-Term
- [ ] Integrate real Sentinel-5P TROPOMI CH4 data via GEE (blueprint in extract_gee_features.py)
- [ ] Replace AQI-proxy aerosol with real TROPOMI UV Aerosol Index
- [ ] Add Sentinel-2 MSI optical bands for burn scar detection (NBR/dNBR)
- [ ] WebSocket push updates (replace 30-second polling)
- [ ] Automated SMS/email alert dispatch for Critical/Extreme events

### Medium-Term
- [ ] Cloud deployment (AWS/GCP) with scheduled pipeline execution
- [ ] Historical trend analysis and monthly comparison dashboard
- [ ] Integration with NDMA alert systems
- [ ] Mobile-responsive dashboard
- [ ] User authentication with role-based access (public/authority/admin)

### Long-Term
- [ ] Replace synthetic training data with labeled real FIRMS + Sentinel-5P dataset
- [ ] Deep learning image classification using Sentinel-2 optical patches
- [ ] Ensemble model combining gradient boosting + vision transformer
- [ ] API integration with INCOIS, IMD, and ISRO's Bhuvan platform
- [ ] Real-time push to NDRF/SDRF control rooms

---

## 22. Troubleshooting

### "FIRMS_API_KEY not set in .env file!"
Ensure `.env` exists in project root with:
```
FIRMS_API_KEY=your_actual_key_here
```
Free key at: https://firms.modaps.eosdis.nasa.gov/api/

### "No FIRMS data found in data/raw/"
```bash
python src/data/ingest_firms.py
```

### "Zone data not found"
```bash
python src/data/ingest_land_zones.py
```
Or run the pipeline with `--full`.

### "Model not found"
```bash
python src/models/train.py
```

### Dashboard shows "Awaiting pipeline data..."
```bash
python run_pipeline.py
```

### Open-Meteo API errors
The free tier has rate limits. The pipeline auto-falls back to default values and completes successfully.

### GeoPandas / GDAL installation errors on macOS
```bash
brew install gdal proj geos
pip install --no-binary :all: fiona
pip install rasterio geopandas
```

### High memory usage during spatial join
In run_pipeline.py, change:
```python
fetch_firms_data(api_key, source=source, days=5)
# to
fetch_firms_data(api_key, source=source, days=2)
```

---

## 23. License

Developed as a prototype for **Smart India Hackathon (SIH) 2026**.

Data sources:
- **NASA FIRMS** — Public domain (NASA Open Data)
- **Open-Meteo** — CC BY 4.0
- **OpenStreetMap** — ODbL (Open Database License)
- **ESRI World Imagery** — Tiles (c) ESRI (visualization only)

---

## Acknowledgements

- **NASA FIRMS Team** — For making near real-time satellite fire data freely available
- **Open-Meteo** — For providing free, high-quality meteorological APIs
- **OpenStreetMap Contributors** — For the comprehensive global geospatial database
- **Leaflet.js, Chart.js** — For excellent open-source mapping and charting libraries
- **scikit-learn Team** — For world-class ML tooling in Python
- **GeoPandas / Shapely** — For making Python geospatial analysis accessible

---

*Built for Smart India Hackathon 2026 | Geo-AI Fire Sentinel v2.0.0*
