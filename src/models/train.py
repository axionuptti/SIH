import os
import json
import pandas as pd
import numpy as np
from datetime import datetime
from sklearn.ensemble import HistGradientBoostingClassifier, GradientBoostingClassifier
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split, StratifiedKFold, cross_val_score
from sklearn.metrics import classification_report, accuracy_score, confusion_matrix
from sklearn.utils.class_weight import compute_sample_weight
import joblib

CLASS_MAP = {
    0: 'Wildfire / Natural',
    1: 'Industrial Flare',
    2: 'Accidental Industrial Fire',
    3: 'Gas Leakage (Chemical)',
    4: 'Smoke Plume',
}

FEATURE_COLS = [
    'frp', 'brightness', 'is_industrial', 'ch4_concentration',
    'aerosol_index', 'day_night', 'persistence',
    'temperature', 'humidity', 'wind_speed'
]

def train_model():
    print("=" * 60)
    print("Fire detection AI — Model Training")
    print("=" * 60)
    
    # 1. Load Training Data
    data_path = "data/processed/synthetic_training_data.csv"
    if not os.path.exists(data_path):
        print("❌ Training data not found. Run: python src/features/generate_synthetic_data.py")
        return
        
    df = pd.read_csv(data_path)
    print(f"\n📊 Loaded {len(df)} training samples")
    print("Class distribution:")
    for cls, count in df['target_class'].value_counts().sort_index().items():
        print(f"  Class {cls} ({CLASS_MAP[cls]}): {count} ({100*count/len(df):.1f}%)")
    
    # 2. Feature / Target Split
    missing_cols = [c for c in FEATURE_COLS if c not in df.columns]
    if missing_cols:
        print(f"❌ Missing feature columns: {missing_cols}")
        return
    
    X = df[FEATURE_COLS].copy()
    y = df['target_class'].astype(int)
    
    # 3. Stratified Train/Test Split (preserves class ratios)
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    
    # 4. Class weights to handle imbalance
    # Accidental fires (class 2) and Gas Leaks (class 3) are rare — upweight them
    sample_weights = compute_sample_weight('balanced', y_train)
    
    # 5. Primary Model: HistGradientBoostingClassifier
    print(f"\n🧠 Training HistGradientBoostingClassifier...")
    model = HistGradientBoostingClassifier(
        random_state=42,
        max_iter=500,           # More iterations for better convergence
        max_leaf_nodes=63,      # Deeper trees for complex multi-class
        learning_rate=0.05,     # Lower LR + more iterations = better generalisation
        min_samples_leaf=20,    # Prevent overfitting on rare classes
        l2_regularization=0.1,
        class_weight='balanced',  # Native class balancing
    )
    model.fit(X_train, y_train, sample_weight=sample_weights)
    
    # 6. Evaluate
    preds = model.predict(X_test)
    proba = model.predict_proba(X_test)
    acc = accuracy_score(y_test, preds)
    
    print(f"\n📈 Test Accuracy: {acc * 100:.2f}%")
    print("\nClassification Report:")
    print(classification_report(y_test, preds,
                                target_names=[CLASS_MAP[i] for i in sorted(CLASS_MAP)]))
    
    print("Confusion Matrix:")
    cm = confusion_matrix(y_test, preds)
    print(cm)
    
    # 7. Cross-validation score
    print("\n🔄 5-Fold Cross-Validation (on full dataset)...")
    cv_model = HistGradientBoostingClassifier(
        random_state=42, max_iter=300, class_weight='balanced'
    )
    cv_scores = cross_val_score(cv_model, X, y, cv=5, scoring='f1_macro')
    print(f"  Macro F1 CV scores: {cv_scores.round(3)}")
    print(f"  Mean ± Std: {cv_scores.mean():.3f} ± {cv_scores.std():.3f}")
    
    # 8. Secondary Model: Random Forest (for comparison and ensemble)
    print(f"\n🌲 Training Random Forest (secondary model)...")
    rf_model = RandomForestClassifier(
        n_estimators=200,
        max_depth=15,
        min_samples_leaf=10,
        class_weight='balanced',
        random_state=42,
        n_jobs=-1,
    )
    rf_model.fit(X_train, y_train, sample_weight=sample_weights)
    rf_preds = rf_model.predict(X_test)
    rf_acc = accuracy_score(y_test, rf_preds)
    print(f"  Random Forest Test Accuracy: {rf_acc * 100:.2f}%")
    
    # Feature importances from RF (HistGB doesn't expose them directly)
    print("\n📊 Feature Importances (Random Forest):")
    importances = rf_model.feature_importances_
    for name, imp in sorted(zip(FEATURE_COLS, importances), key=lambda x: -x[1]):
        bar = '█' * int(imp * 50)
        print(f"  {name:<25} {imp:.4f} {bar}")
    
    # 9. Save Models
    os.makedirs("src/models/saved_models", exist_ok=True)
    
    gb_path = "src/models/saved_models/gradient_boosting_fire_classifier.joblib"
    rf_path = "src/models/saved_models/random_forest_fire_classifier.joblib"
    
    joblib.dump(model, gb_path)
    joblib.dump(rf_model, rf_path)
    
    # 10. Save Metadata Log (never overwrite — append)
    metadata = {
        "timestamp": datetime.now().isoformat(),
        "training_samples": len(df),
        "feature_cols": FEATURE_COLS,
        "class_map": CLASS_MAP,
        "gradient_boosting": {
            "test_accuracy": round(acc, 4),
            "cv_f1_macro_mean": round(cv_scores.mean(), 4),
            "cv_f1_macro_std": round(cv_scores.std(), 4),
            "hyperparams": {
                "max_iter": 500,
                "max_leaf_nodes": 63,
                "learning_rate": 0.05,
                "class_weight": "balanced",
            }
        },
        "random_forest": {
            "test_accuracy": round(rf_acc, 4),
            "feature_importances": {
                name: round(float(imp), 4)
                for name, imp in zip(FEATURE_COLS, importances)
            }
        },
        "class_distribution": df['target_class'].value_counts().to_dict(),
    }
    
    log_path = "src/models/saved_models/training_log.json"
    history = []
    if os.path.exists(log_path):
        with open(log_path, 'r') as f:
            history = json.load(f)
    history.append(metadata)
    with open(log_path, 'w') as f:
        json.dump(history, f, indent=2)
    
    print(f"\n✅ Models saved:")
    print(f"   Gradient Boosting → {gb_path}")
    print(f"   Random Forest     → {rf_path}")
    print(f"   Training log      → {log_path}")
    print(f"\n🎯 Summary: GB={acc*100:.1f}% | RF={rf_acc*100:.1f}% | CV-F1={cv_scores.mean():.3f}")

if __name__ == "__main__":
    train_model()
