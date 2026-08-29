# System Requirements Document
**Project:** AI-Based Detection and Classification of Industrial Fires and Persistent Thermal Sources
**Context:** Smart India Hackathon (SIH) Prototype

## 1. Introduction
This document defines the high-level functional and non-functional requirements for a geospatial AI system designed to classify satellite-detected thermal anomalies.

## 2. Target Audience & Stakeholders
* **Primary:** SIH Judges / Evaluators
* **Secondary (Simulated):** Disaster-management authorities, pollution-control boards, and industrial safety regulators.

## 3. Scope
* **Geographic Pilot Region:** A region with high industrial and refining density suitable for a prototype (e.g., Jamnagar/Gujarat in India or the Texas Gulf Coast).
* **System Focus:** Distinguish between accidental industrial fires, persistent industrial sources (flares, kilns), mining anomalies, agricultural burns, and wildfires.

## 4. Functional Requirements
1. **Data Ingestion:** Fetch NRT and archive thermal anomalies from NASA FIRMS.
2. **Context Integration:** Query OpenStreetMap (OSM) for industrial infrastructure boundaries.
3. **Classification:** A multi-stage AI model must classify hotspots into predefined categories.
4. **Visualization:** A local GIS dashboard to visualize classified anomalies as map overlays.

## 5. Non-Functional Requirements
1. **Accuracy:** Target a classification accuracy of **90%**.
2. **Performance (Latency):** End-to-end processing latency should be minimized (optimizing the ~3 hour FIRMS delay).
3. **Environment:** Must run locally on a **MacBook Air M4** (Apple Silicon) without relying on heavy cloud compute for inference.
4. **Modularity:** Code must be structured well to allow future cloud deployment.
