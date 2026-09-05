from fastapi import FastAPI, Query
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

@app.on_event("startup")
async def startup_event():
    async def sync_loop():
        while True:
            try:
                proc = await asyncio.create_subprocess_exec(
                    sys.executable, "run_pipeline.py", "--skip-osm", "--skip-train", 
                    stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL
                )
                await proc.wait()
                
                # Check for new critical fires and dispatch Telegram alerts
                data = load_geojson("data/processed/classified_hotspots.geojson")
                if data:
                    from src.api.alerts import check_and_send_alerts
                    check_and_send_alerts(data)
            except Exception as e:
                print(f"Pipeline sync error: {e}")
                
            # Wait 10 minutes (600s) before fetching the next satellite overpass
            await asyncio.sleep(600)
            
    asyncio.create_task(sync_loop())

app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs("src/frontend", exist_ok=True)
app.mount("/dashboard", StaticFiles(directory="src/frontend", html=True), name="frontend")

@app.get("/", include_in_schema=False)
def root_redirect():
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/dashboard")


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
        "avg_confidence": round(sum(confidences) / len(confidences), 1) if confidences else None
    }



