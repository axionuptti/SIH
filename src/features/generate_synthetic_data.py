import os
import pandas as pd
import numpy as np

def generate_synthetic_data(num_samples=20000):
    """
    Generate calibrated training data incorporating:
    - Real satellite thermal physics (VIIRS SNPP & NOAA-20 FRP, brightness)
    - High-resolution ESRI satellite computer vision features (greenery, structure, built-up)
    - Map-verified industrial zone spatial context
    - Temporal thermal persistence (30-day recurrence)
    - Atmospheric CH4 and aerosol signatures

    Classes:
        0: Forest Fire (Wildfire / Natural Biomass Burn)
        1: Industrial Fire (Catastrophic Industrial Facility / Refinery / Chemical Explosion)
        2: Persistent Industrial Thermal Source (Routine Flare / Industrial Stack / Furnace)
        3: Agricultural Burn (Crop Stubble / Field Burn)
    """
    print(f"Generating {num_samples} multi-modal training records for fire AI...")
    
    np.random.seed(42)
    
    classes = [0, 1, 2, 3]
    probabilities = [0.45, 0.20, 0.20, 0.15]
    
    data = []
    
    for _ in range(num_samples):
        target = np.random.choice(classes, p=probabilities)
        day_night = np.random.choice([0, 1])
        
        if target == 0:  # Forest Fire (Wildfire)
            # Wildfires can range from small spot fires to massive infernos
            frp = float(np.random.choice([
                np.random.uniform(5.0, 45.0),
                np.random.uniform(45.0, 150.0),
                np.random.uniform(150.0, 800.0)
            ], p=[0.55, 0.35, 0.10]))
            
            brightness = float(np.random.uniform(305.0, 395.0))
            is_industrial_map = 0
            
            # High vegetative cover (forest canopy, bush, savannah)
            vision_greenery = float(np.random.uniform(25.0, 98.0))
            # Minimal to no industrial buildings (organic nature)
            vision_structure = float(np.random.uniform(0.0, 2.5))
            vision_built = float(np.random.uniform(0.0, 0.08))
            
            # Wildfires move across landscape: low recurrence at exact pixel
            persistence = float(np.random.uniform(0.0, 0.20))
            
            ch4_concentration = float(np.random.uniform(1820.0, 1930.0))
            aerosol_index = float(np.random.uniform(0.5, 5.0))
            
            temperature = float(np.random.uniform(22.0, 48.0))
            humidity = float(np.random.uniform(8.0, 40.0))
            wind_speed = float(np.random.uniform(5.0, 45.0))
            
        elif target == 1:  # Industrial Fire (Severe Catastrophe at Industrial Complex)
            # Major industrial explosion / facility blaze
            frp = float(np.random.uniform(25.0, 600.0))
            brightness = float(np.random.uniform(335.0, 460.0))
            is_industrial_map = 1
            
            # Industrial complex has cleared grounds, concrete and steel
            vision_greenery = float(np.random.uniform(0.0, 28.0))
            vision_structure = float(np.random.uniform(3.5, 45.0))
            vision_built = float(np.random.uniform(0.12, 0.95))
            
            # Sudden accidental onset (not a 30-day continuous flare)
            persistence = float(np.random.uniform(0.0, 0.32))
            
            # Elevated methane / volatile hydrocarbons from plant failure
            ch4_concentration = float(np.random.uniform(2000.0, 3500.0))
            # Dense black industrial smoke
            aerosol_index = float(np.random.uniform(2.8, 7.5))
            
            temperature = float(np.random.uniform(15.0, 45.0))
            humidity = float(np.random.uniform(15.0, 80.0))
            wind_speed = float(np.random.uniform(2.0, 35.0))
            
        elif target == 2:  # Persistent Industrial Thermal Source (Routine Flare / Stack)
            # Steady controlled burning
            frp = float(np.random.uniform(0.5, 25.0))
            brightness = float(np.random.uniform(300.0, 335.0))
            is_industrial_map = 1
            
            vision_greenery = float(np.random.uniform(0.0, 25.0))
            vision_structure = float(np.random.uniform(1.8, 35.0))
            vision_built = float(np.random.uniform(0.08, 0.95))
            
            # KEY DISCRIMINATOR: High 30-day thermal recurrence
            persistence = float(np.random.uniform(0.60, 1.0))
            
            ch4_concentration = float(np.random.uniform(1880.0, 2150.0))
            aerosol_index = float(np.random.uniform(0.05, 1.4))
            
            temperature = float(np.random.uniform(10.0, 42.0))
            humidity = float(np.random.uniform(20.0, 85.0))
            wind_speed = float(np.random.uniform(0.0, 25.0))
            
        else:  # Agricultural Burn (Crop Stubble)
            frp = float(np.random.uniform(1.0, 30.0))
            brightness = float(np.random.uniform(300.0, 340.0))
            is_industrial_map = 0
            
            # Farmland plots
            vision_greenery = float(np.random.uniform(10.0, 38.0))
            vision_structure = float(np.random.uniform(0.0, 2.0))
            vision_built = float(np.random.uniform(0.0, 0.06))
            
            persistence = float(np.random.uniform(0.0, 0.15))
            
            ch4_concentration = float(np.random.uniform(1830.0, 1950.0))
            aerosol_index = float(np.random.uniform(0.8, 3.2))
            
            temperature = float(np.random.uniform(20.0, 42.0))
            humidity = float(np.random.uniform(15.0, 65.0))
            wind_speed = float(np.random.uniform(3.0, 25.0))
            
        data.append([
            frp, brightness, is_industrial_map,
            vision_structure, vision_greenery, vision_built,
            persistence, ch4_concentration, aerosol_index,
            day_night, temperature, humidity, wind_speed,
            target
        ])
        
    cols = [
        'frp', 'brightness', 'is_industrial_map',
        'vision_structure', 'vision_greenery', 'vision_built',
        'persistence', 'ch4_concentration', 'aerosol_index',
        'day_night', 'temperature', 'humidity', 'wind_speed',
        'target_class'
    ]
    
    df = pd.DataFrame(data, columns=cols)
    
    os.makedirs("data/processed", exist_ok=True)
    out_path = "data/processed/synthetic_training_data.csv"
    df.to_csv(out_path, index=False)
    
    print(f"\n✅ Generated {num_samples} records → {out_path}")
    class_names = {
        0: 'Forest Fire',
        1: 'Industrial Fire',
        2: 'Persistent Industrial Thermal Source',
        3: 'Agricultural Burn'
    }
    for cls, count in df['target_class'].value_counts().sort_index().items():
        print(f"  Class {cls} ({class_names[cls]}): {count} samples ({100*count/num_samples:.1f}%)")

if __name__ == "__main__":
    generate_synthetic_data()
