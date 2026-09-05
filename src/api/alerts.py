import os
import requests
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")

# Simple in-memory cache to avoid spamming the exact same fire multiple times
# We use (lat, lon) rounded to 2 decimal places as a unique-ish ID for a fire event.
_ALERTED_FIRES = set()

def send_telegram_message(text: str):
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID or TELEGRAM_BOT_TOKEN == "your_bot_token_here":
        # Silent return if credentials not configured
        return False
        
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {
        "chat_id": TELEGRAM_CHAT_ID,
        "text": text,
        "parse_mode": "Markdown"
    }
    
    try:
        response = requests.post(url, json=payload, timeout=10)
        response.raise_for_status()
        return True
    except Exception as e:
        print(f"Failed to send Telegram alert: {e}")
        return False


def check_and_send_alerts(geojson_data: dict):
    """
    Scans the latest GeoJSON output and sends an alert for any new CRITICAL fires.
    """
    if not geojson_data or "features" not in geojson_data:
        return
        
    features = geojson_data.get("features", [])
    
    for feat in features:
        p = feat.get("properties", {})
        cls = p.get("ai_classification", "Unknown")
        
        # Only alert for critical categories
        if cls not in ["Industrial Fire", "Wildfire", "Gas Leakage (Chemical)"]:
            continue
            
        lat = float(p.get("latitude", 0.0))
        lon = float(p.get("longitude", 0.0))
        frp = p.get("frp", "N/A")
        risk = p.get("risk_level", "Critical")
        
        # Create a unique footprint key for this fire to avoid duplicate alerts
        fire_key = (round(lat, 2), round(lon, 2), cls)
        
        if fire_key not in _ALERTED_FIRES:
            # We found a new critical fire!
            _ALERTED_FIRES.add(fire_key)
            
            # Format the alert message
            icon = "🏭" if cls == "Industrial Fire" else "🌲" if cls == "Wildfire" else "⚠️"
            
            message = (
                f"🚨 **CRITICAL ALERT: {cls} DETECTED** 🚨\n\n"
                f"{icon} **Classification:** {cls}\n"
                f"📍 **Location:** `{lat}, {lon}`\n"
                f"🔥 **Intensity (FRP):** {frp} MW\n"
                f"🛡️ **AI Risk Assessment:** {risk}\n\n"
                f"👉 [View Live Dashboard](http://localhost:8001/dashboard)"
            )
            
            send_telegram_message(message)
