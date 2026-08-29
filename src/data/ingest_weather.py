import os
import json
import requests
import geopandas as gpd
import pandas as pd
from math import ceil

def fetch_weather_for_hotspots(geojson_path):
    print(f"Loading hotspots from {geojson_path} for Weather Context enrichment...")
    
    if not os.path.exists(geojson_path):
        print("GeoJSON not found.")
        return
        
    gdf = gpd.read_file(geojson_path)
    
    if gdf.empty:
        print("No hotspots to process.")
        return
        
    # Open-Meteo API allows max 100 locations per request.
    # We will chunk the requests.
    chunk_size = 90
    
    temperatures = []
    humidities = []
    wind_speeds = []
    wind_directions = []
    aqis = []
    
    print(f"Fetching real-time weather & AQI data for {len(gdf)} locations via Open-Meteo...")
    
    for i in range(0, len(gdf), chunk_size):
        chunk = gdf.iloc[i:i+chunk_size]
        
        lats = ",".join(chunk['latitude'].astype(str))
        lons = ",".join(chunk['longitude'].astype(str))
        
        weather_url = f"https://api.open-meteo.com/v1/forecast?latitude={lats}&longitude={lons}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m"
        aqi_url = f"https://air-quality-api.open-meteo.com/v1/air-quality?latitude={lats}&longitude={lons}&current=european_aqi"
        
        try:
            w_resp = requests.get(weather_url)
            a_resp = requests.get(aqi_url)
            
            if w_resp.status_code == 200 and a_resp.status_code == 200:
                w_data = w_resp.json()
                a_data = a_resp.json()
                
                # If only 1 coordinate was sent, data is a dict, otherwise it's a list
                if isinstance(w_data, dict): w_data = [w_data]
                if isinstance(a_data, dict): a_data = [a_data]
                    
                for w, a in zip(w_data, a_data):
                    wc = w.get('current', {})
                    ac = a.get('current', {})
                    
                    temperatures.append(wc.get('temperature_2m', 25.0))
                    humidities.append(wc.get('relative_humidity_2m', 50.0))
                    wind_speeds.append(wc.get('wind_speed_10m', 10.0))
                    wind_directions.append(wc.get('wind_direction_10m', 0.0))
                    aqis.append(ac.get('european_aqi', 50.0))
            else:
                print(f"Warning: Open-Meteo API error. Using fallback data.")
                for _ in range(len(chunk)):
                    temperatures.append(25.0)
                    humidities.append(50.0)
                    wind_speeds.append(10.0)
                    wind_directions.append(0.0)
                    aqis.append(50.0)
        except Exception as e:
            print(f"Error fetching data: {e}")
            for _ in range(len(chunk)):
                temperatures.append(25.0)
                humidities.append(50.0)
                wind_speeds.append(10.0)
                wind_directions.append(0.0)
                aqis.append(50.0)
                
    gdf['temperature'] = temperatures
    gdf['humidity'] = humidities
    gdf['wind_speed'] = wind_speeds
    gdf['wind_direction'] = wind_directions
    gdf['aqi'] = aqis
    
    out_path = "data/processed/merged_hotspots.geojson"
    
    # Clean up types for geojson
    for col in gdf.columns:
        if col != 'geometry' and gdf[col].dtype == 'object':
            gdf[col] = gdf[col].astype(str)
            
    gdf.to_file(out_path, driver="GeoJSON")
    print("Weather data merged successfully!")

if __name__ == "__main__":
    fetch_weather_for_hotspots("data/processed/merged_hotspots.geojson")
