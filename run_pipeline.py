#!/usr/bin/env python3
"""
Geo-AI Fire Sentinel — Complete Pipeline Orchestrator
======================================================
Run this single file to execute the full data pipeline:

    python run_pipeline.py [--full] [--skip-osm] [--skip-train]

Flags:
    --full        Include OSM re-fetch and model re-training (slow, ~10 min)
    --skip-osm    Skip OSM data fetch (use existing osm_industrial_india.geojson)
    --skip-train  Skip model re-training (use existing saved model)
    --help        Show this help message

Default (no flags): Fast mode — re-fetches FIRMS + weather, re-runs inference only.

Pipeline stages:
    Stage 1: Fetch FIRMS data (VIIRS SNPP + NOAA-20 + MODIS)
    Stage 2: [Optional] Fetch land zones (National Parks, Forests, etc.)
    Stage 3: Preprocess & spatial join
    Stage 4: Enrich with weather + AQI (Open-Meteo)
    Stage 5: Compute 30-day persistence scores
    Stage 6: [Optional] Re-train ML model
    Stage 7: Run AI inference + tactical geometry generation

After this completes, start the dashboard:
    uvicorn src.api.main:app --host 0.0.0.0 --port 8000
    Then open: http://localhost:8000/dashboard
"""

import os
import sys
import time
import argparse
from datetime import datetime

# Ensure we run from the project root
PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(PROJECT_ROOT)
sys.path.insert(0, PROJECT_ROOT)


def log(msg: str, level: str = "INFO"):
    ts = datetime.now().strftime("%H:%M:%S")
    icons = {"INFO": "ℹ️ ", "OK": "✅", "WARN": "⚠️ ", "ERR": "❌", "HEAD": "═"}
    icon = icons.get(level, "  ")
    print(f"[{ts}] {icon}  {msg}")


def separator(title: str):
    print()
    print("═" * 60)
    print(f"  {title}")
    print("═" * 60)


def stage(n: int, title: str, fn, *args, **kwargs):
    separator(f"Stage {n}: {title}")
    t0 = time.time()
    try:
        fn(*args, **kwargs)
        elapsed = time.time() - t0
        log(f"Stage {n} completed in {elapsed:.1f}s", "OK")
        return True
    except SystemExit:
        return False
    except Exception as e:
        log(f"Stage {n} FAILED: {e}", "ERR")
        import traceback
        traceback.print_exc()
        return False


def run_pipeline(full: bool = False, skip_osm: bool = False, skip_train: bool = False):
    from dotenv import load_dotenv
    load_dotenv()

    api_key = os.getenv("FIRMS_API_KEY")
    if not api_key or api_key == "your_nasa_firms_api_key_here":
        log("FIRMS_API_KEY not set in .env file!", "ERR")
        log("Get your free key at: https://firms.modaps.eosdis.nasa.gov/api/", "INFO")
        sys.exit(1)

    log("Starting Geo-AI Fire Sentinel pipeline...", "INFO")
    log(f"Mode: {'FULL (OSM + Training)' if full else 'FAST (FIRMS + Inference only)'}", "INFO")
    log(f"API Key: {api_key[:8]}...", "INFO")
    print()

    pipeline_start = time.time()
    failed_stages = []

    # ── Stage 1: FIRMS Multi-Source Ingestion ────────────────────────────────
    from src.data.ingest_firms import fetch_firms_data, merge_multi_source, SOURCES
    def _stage1():
        dfs = {}
        for source in SOURCES:
            dfs[source] = fetch_firms_data(api_key, source=source, days=5)
        merged = merge_multi_source(dfs)
        if not merged.empty:
            from datetime import datetime as dt
            out = f"data/raw/firms_merged_{dt.now().strftime('%Y%m%d')}.csv"
            merged.to_csv(out, index=False)
            log(f"Merged {len(merged)} hotspots saved to {out}", "OK")
        else:
            raise RuntimeError("No FIRMS data returned from any source")

    if not stage(1, "Multi-Source FIRMS Ingestion (VIIRS SNPP + NOAA-20 + MODIS)", _stage1):
        failed_stages.append(1)

    # ── Stage 2: Land Zones (Optional / Slow) ───────────────────────────────
    zones_file = "data/raw/zones/all_zones_india.geojson"
    if full and not skip_osm:
        def _run_land_zones():
            import subprocess
            subprocess.run([sys.executable, "src/data/ingest_land_zones.py"], check=True)
        if not stage(2, "Land Zone Ingestion", _run_land_zones):
            failed_stages.append(2)
    elif os.path.exists(zones_file):
        log("Stage 2: Land Zones — using existing dataset (skip with no --full)", "INFO")
    else:
        log("Stage 2: Land Zones — file not found, building curated zones...", "WARN")
        def _run_land_zones():
            import subprocess
            subprocess.run([sys.executable, "src/data/ingest_land_zones.py"], check=True)
        if not stage(2, "Land Zone Build", _run_land_zones):
            failed_stages.append(2)

    # ── Stage 3: Spatial Preprocessing & Confidence Filter ───────────────────
    from src.features.preprocess_spatial import preprocess_and_join
    if not stage(3, "Spatial Preprocessing + Confidence Filter", preprocess_and_join):
        failed_stages.append(3)

    # ── Stage 4: Weather + AQI Enrichment ────────────────────────────────────
    from src.data.ingest_weather import fetch_weather_for_hotspots
    if not stage(4, "Weather + AQI Enrichment (Open-Meteo)", 
                 fetch_weather_for_hotspots, "data/processed/merged_hotspots.geojson"):
        failed_stages.append(4)

    # ── Stage 5: Persistence Scoring ─────────────────────────────────────────
    from src.data.compute_persistence import add_persistence_to_hotspots
    if not stage(5, "30-Day Persistence Scoring",
                 add_persistence_to_hotspots, "data/processed/merged_hotspots.geojson", api_key):
        failed_stages.append(5)
        log("Persistence stage failed — inference will use fallback values", "WARN")

    # ── Stage 6: Model Training (Optional) ───────────────────────────────────
    model_path = "src/models/saved_models/gradient_boosting_fire_classifier.pkl"
    if full and not skip_train:
        log("Regenerating synthetic training data...", "INFO")
        from src.features.generate_synthetic_data import generate_synthetic_data
        generate_synthetic_data(num_samples=10000)
        from src.models.train import train_model
        if not stage(6, "ML Model Training (HistGradientBoosting + RandomForest)", train_model):
            failed_stages.append(6)
    elif os.path.exists(model_path):
        log(f"Stage 6: Using existing trained model at {model_path}", "INFO")
    else:
        log("Stage 6: No trained model found. Training now...", "WARN")
        from src.features.generate_synthetic_data import generate_synthetic_data
        generate_synthetic_data(num_samples=10000)
        from src.models.train import train_model
        if not stage(6, "ML Model Training (first-time)", train_model):
            failed_stages.append(6)

    # ── Stage 7: AI Inference + Tactical Geometry ────────────────────────────
    from src.models.inference import run_inference
    if not stage(7, "AI Inference + Tactical Geometry Generation", run_inference):
        failed_stages.append(7)

    # ── Summary ──────────────────────────────────────────────────────────────
    total_elapsed = time.time() - pipeline_start
    print()
    print("═" * 60)
    print("  PIPELINE COMPLETE")
    print("═" * 60)
    log(f"Total time: {total_elapsed:.1f}s  ({total_elapsed/60:.1f} min)", "INFO")

    if failed_stages:
        log(f"⚠️  Stages with errors: {failed_stages}", "WARN")
        log("The dashboard may still work with partial data.", "WARN")
    else:
        log("All stages completed successfully!", "OK")

    print()
    log("Start the dashboard with:", "INFO")
    print()
    print("    uvicorn src.api.main:app --host 0.0.0.0 --port 8000 --reload")
    print()
    print("    Then open: http://localhost:8000/dashboard")
    print()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Geo-AI Fire Sentinel — Complete Pipeline Orchestrator",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--full",       action="store_true",
                        help="Include OSM re-fetch and model re-training (~10 min)")
    parser.add_argument("--skip-osm",  action="store_true",
                        help="Skip OSM data fetch (use existing file)")
    parser.add_argument("--skip-train", action="store_true",
                        help="Skip model re-training (use existing model)")
    args = parser.parse_args()

    run_pipeline(full=args.full, skip_osm=args.skip_osm, skip_train=args.skip_train)
