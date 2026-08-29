import os
import pandas as pd
import numpy as np

def generate_synthetic_data(num_samples=10000):
    """
    Generate synthetic training data calibrated to real VIIRS SNPP NRT observations.
    
    FRP CALIBRATION (based on real FIRMS VIIRS data analysis):
    - Real VIIRS NRT FRP range: 0.1 – 30 MW (mean ~3.8 MW for India)
    - Industrial accidental fires can be much higher but are rare events
    - Gas leaks often show very low FRP (near-invisible thermal signature)
    
    Classes:
        0: Wildfire / Natural
        1: Persistent Flare / Industrial Plant
        2: Accidental Industrial Fire
        3: Gas Leakage (Methane/Chemical)
        4: Smoke Plume (Heavy Aerosol)
    """
    print(f"Generating {num_samples} synthetic hotspot records for training...")
    print("FRP ranges calibrated to real VIIRS NRT observations (0.1 – 35 MW).")
    
    np.random.seed(42)
    
    classes = [0, 1, 2, 3, 4]
    # Adjusted probabilities — accidental fires and leaks are rare events
    probabilities = [0.40, 0.35, 0.10, 0.08, 0.07]
    
    data = []
    
    for _ in range(num_samples):
        target = np.random.choice(classes, p=probabilities)
        
        day_night = np.random.choice([0, 1])
        
        if target == 0:  # Wildfire / Natural
            # FIXED: Real VIIRS wildfire FRP: 0.5 – 30 MW (not 5–100)
            frp = np.random.uniform(0.5, 30.0)
            # Real VIIRS bright_ti4 for fire pixels: 300–370 K
            brightness = np.random.uniform(300, 365)
            is_industrial = 0
            # Wildfires occur in ambient CH4 levels (~1800-1900 ppb)
            ch4_concentration = np.random.uniform(1800, 1900)
            # Low-moderate aerosol from smoke, not extreme
            aerosol_index = np.random.uniform(0.3, 2.5)
            # Low persistence (fires move, not fixed-point sources)
            persistence = np.random.uniform(0.0, 0.15)
            # High temperature + low humidity = fire weather
            temperature = np.random.uniform(28.0, 48.0)
            humidity = np.random.uniform(10.0, 35.0)
            wind_speed = np.random.uniform(8.0, 40.0)
            
        elif target == 1:  # Persistent Flare / Industrial Plant
            # Flares: low-moderate FRP, very consistent (0.3 – 15 MW)
            frp = np.random.uniform(0.3, 15.0)
            brightness = np.random.uniform(300, 325)
            is_industrial = 1
            # Slightly elevated CH4 near flare stacks
            ch4_concentration = np.random.uniform(1850, 1980)
            # Low aerosol — flares burn cleanly
            aerosol_index = np.random.uniform(0.05, 0.6)
            # HIGH persistence — key discriminator for industrial flares!
            persistence = np.random.uniform(0.75, 1.0)
            # Weather-independent
            temperature = np.random.uniform(15.0, 40.0)
            humidity = np.random.uniform(25.0, 85.0)
            wind_speed = np.random.uniform(0.0, 25.0)
            
        elif target == 2:  # Accidental Industrial Fire
            # Large fire in a plant: 15 – 200 MW (still realistic range)
            frp = np.random.uniform(15.0, 200.0)
            brightness = np.random.uniform(335, 420)
            is_industrial = 1
            # Explosion can release CH4 — elevated but not as high as pure leak
            ch4_concentration = np.random.uniform(1950, 2500)
            # Heavy smoke from industrial materials
            aerosol_index = np.random.uniform(2.5, 6.0)
            # LOW persistence — sudden onset, not recurring
            persistence = np.random.uniform(0.0, 0.25)
            temperature = np.random.uniform(20.0, 42.0)
            humidity = np.random.uniform(15.0, 70.0)
            wind_speed = np.random.uniform(3.0, 30.0)
            
        elif target == 3:  # Gas Leakage (Methane/Chemical)
            # Gas leaks often have LOW FRP — sometimes unignited
            frp = np.random.uniform(0.0, 5.0)
            # Low brightness — no major flame, just thermal
            brightness = np.random.uniform(280, 305)
            is_industrial = 1
            # KEY DISCRIMINATOR: Very high CH4 (2500–5000+ ppb)
            ch4_concentration = np.random.uniform(2500, 5500)
            # Low aerosol — gas leak itself doesn't produce much particulate
            aerosol_index = np.random.uniform(0.05, 0.7)
            persistence = np.random.uniform(0.0, 0.45)
            temperature = np.random.uniform(15.0, 38.0)
            humidity = np.random.uniform(25.0, 80.0)
            # Low wind allows gas buildup
            wind_speed = np.random.uniform(0.0, 12.0)
            
        else:  # Smoke Plume (class 4)
            # Smoke plumes: low FRP source, but HIGH aerosol
            frp = np.random.uniform(0.2, 8.0)
            brightness = np.random.uniform(290, 315)
            is_industrial = np.random.choice([0, 1], p=[0.6, 0.4])
            ch4_concentration = np.random.uniform(1800, 1920)
            # KEY DISCRIMINATOR: Very high aerosol index
            aerosol_index = np.random.uniform(3.5, 8.0)
            persistence = np.random.uniform(0.0, 0.3)
            temperature = np.random.uniform(20.0, 42.0)
            humidity = np.random.uniform(15.0, 65.0)
            # High wind disperses smoke widely
            wind_speed = np.random.uniform(12.0, 45.0)
            
        data.append([
            frp, brightness, is_industrial, ch4_concentration,
            aerosol_index, day_night, persistence,
            temperature, humidity, wind_speed, target
        ])
        
    df = pd.DataFrame(data, columns=[
        'frp', 'brightness', 'is_industrial', 'ch4_concentration',
        'aerosol_index', 'day_night', 'persistence',
        'temperature', 'humidity', 'wind_speed', 'target_class'
    ])
    
    os.makedirs("data/processed", exist_ok=True)
    out_path = "data/processed/synthetic_training_data.csv"
    df.to_csv(out_path, index=False)
    
    print(f"\n✅ Generated {num_samples} records → {out_path}")
    print("\nClass distribution:")
    class_names = {0: 'Wildfire', 1: 'Industrial Flare', 2: 'Accidental Fire',
                   3: 'Gas Leakage', 4: 'Smoke Plume'}
    for cls, count in df['target_class'].value_counts().sort_index().items():
        print(f"  Class {cls} ({class_names[cls]}): {count} samples ({100*count/num_samples:.1f}%)")
    
    print("\nFRP summary by class (recalibrated to real VIIRS range):")
    for cls, name in class_names.items():
        r = df[df['target_class'] == cls]['frp']
        print(f"  {name}: min={r.min():.2f}, max={r.max():.2f}, mean={r.mean():.2f} MW")

if __name__ == "__main__":
    generate_synthetic_data()
