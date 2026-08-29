Industrial fire detection ai report · MD
AI-Based Detection and Classification of Industrial Fires and Persistent Thermal Sources Using NASA FIRMS, OSM & Satellite Data
A Geospatial AI System for Distinguishing Industrial Fires, Persistent Thermal Sources, and Natural Fires
Abstract

Industrial facilities such as oil refineries, petrochemical complexes, thermal power plants, steel plants, mining operations, and LNG terminals emit continuous thermal radiation that is routinely picked up by satellite-based fire-monitoring systems such as NASA's Fire Information for Resource Management System (FIRMS). However, FIRMS and similar thermal-anomaly products report every high-temperature detection as a generic "hotspot," without distinguishing between routine industrial heat sources (gas flares, plant furnaces, cooling processes) and hazardous events such as accidental industrial fires, explosions, or gas leaks — nor between these and unrelated anomalies like agricultural burning or wildfires. This ambiguity limits the usefulness of existing systems for industrial safety monitoring and disaster response.

This report presents the design, methodology, and implementation roadmap for an AI-enabled geospatial system that fuses NASA FIRMS thermal-anomaly data, OpenStreetMap (OSM) industrial infrastructure layers, and multi-sensor satellite imagery (Sentinel-2, Sentinel-3 SLSTR, Landsat 8/9) to automatically classify thermal anomalies into industrial fires, persistent industrial thermal sources, mining activity, agricultural burning, and wildfires. The pipeline combines spatial joins, temporal-persistence analysis, and supervised machine learning (Random Forest/XGBoost and CNN-based image classification) with a PostGIS-backed GIS dashboard for real-time visualization and alerting. A complete 100-step implementation roadmap is provided, covering everything from requirement analysis to pilot deployment and future scaling.

1. Introduction
1.1 Background

Thermal-anomaly detection from satellites has become a core tool for environmental and disaster monitoring. NASA FIRMS aggregates near-real-time (NRT) active-fire data from the MODIS instruments aboard Terra/Aqua and the VIIRS instruments aboard Suomi-NPP and NOAA-20/21, delivering global hotspot detections within a few hours of satellite overpass. While extremely valuable, these products are source-agnostic: a flare stack burning continuously at a refinery, a wildfire spreading through a forest, and a farmer burning crop stubble all appear as similar "hotspot" records.

1.2 Problem Statement

Current satellite-based thermal monitoring systems cannot automatically distinguish between:

Accidental industrial fires, explosions, and gas leaks (high risk, require immediate response)
Persistent, expected industrial thermal sources (gas flares, power plants, kilns — routine, low risk)
Mining-related thermal anomalies
Agricultural burning
Wildfires / forest fires

This lack of classification limits the actionability of thermal data for industrial safety regulators, disaster-management agencies, and environmental monitoring bodies.

1.3 Motivation

Accidental industrial fires and gas leaks pose direct risks to human life, critical infrastructure, and the environment, and early, accurately-classified alerts can materially reduce response time. At the same time, filtering out well-understood persistent sources (flares, plants) prevents alert fatigue and lets responders focus on genuine anomalies. A system that fuses thermal data with land-use context (OSM) and imagery can close this gap using existing, freely available data sources.

2. Related Work / Existing Systems
NASA FIRMS (MODIS & VIIRS active fire products): Provide global near-real-time hotspot detections with attributes such as brightness temperature, Fire Radiative Power (FRP), confidence, and day/night flag — but no source classification.
VIIRS 375m active fire product: Offers higher spatial precision than MODIS (1 km), useful for smaller industrial flares.
Global gas-flaring inventories: Efforts by organizations such as NOAA and the World Bank use night-time VIIRS data to catalogue routine gas-flaring sites, demonstrating that persistence-based analysis can isolate flares from other hotspots.
Land-cover and infrastructure-aware fire classification research: A growing body of geospatial-AI work uses ancillary layers (land cover, road networks, settlement layers) to contextualize hotspots, but relatively little published work specifically targets fine-grained industrial sub-classification (fire vs flare vs kiln vs mining).

Gap identified: No widely available, open system currently combines FIRMS + OSM industrial infrastructure tags + multi-sensor imagery + ML classification into a single real-time, GIS-visualized pipeline that separates accidental industrial fires from persistent industrial sources and natural fires. This is the gap this project addresses.

3. Objectives
Automatically detect and geolocate thermal anomalies using NASA FIRMS NRT and archive data.
Classify each detection into industrial fire, persistent industrial thermal source (flare/plant/kiln), mining anomaly, agricultural burn, or wildfire.
Integrate OpenStreetMap industrial infrastructure data as contextual ground truth for classification.
Use satellite imagery (Sentinel-2/3, Landsat) to add visual/spectral context to ambiguous detections.
Build a GIS-based platform for storing, querying, and visualizing classified thermal events as map overlays.
Provide real-time alerting for likely accidental industrial fires.
4. Data Sources and Datasets
Data Source	Provider	Resolution / Frequency	Purpose
MODIS Active Fire/Thermal Anomalies	NASA FIRMS (Terra/Aqua)	~1 km, 2 obs/day	Baseline hotspot detection
VIIRS Active Fire (375m)	NASA FIRMS (Suomi-NPP, NOAA-20/21)	375 m, higher sensitivity	Precise hotspot geolocation
OpenStreetMap industrial tags	OSM Overpass API	Vector, crowd-sourced	Industrial facility polygons (landuse=industrial, power=plant, man_made=works, mines, refineries)
Sentinel-2 MSI	ESA Copernicus	10–20 m, ~5-day revisit	Optical context, land cover, burn-scar detection
Sentinel-3 SLSTR	ESA Copernicus	500 m–1 km thermal bands	Independent FRP cross-validation
Landsat 8/9	USGS / NASA	30 m, 16-day revisit	High-resolution thermal/optical validation
ESA WorldCover / land-cover raster	ESA	10 m	Land-cover classification context
Global gas-flaring inventories (optional)	NOAA / World Bank	Point locations	Training labels for persistent flares
News/disaster records (optional)	Government/media	Event-based	Ground truth for confirmed industrial fire incidents
5. Proposed System Architecture
NASA FIRMSMODIS & VIIRS Hotspots
Data Ingestion Layer
OpenStreetMapIndustrial Infrastructure
Satellite ImagerySentinel-2/3, Landsat
Preprocessing &Spatial Join Engine
Feature EngineeringThermal + Spatial +Temporal
AI/ML Classification EngineRF/XGBoost + CNN +Persistence Model
PostGIS Spatial Database
GIS VisualizationDashboard
Real-Time Alerting Module

Modules:

Data Ingestion Layer: Scheduled pulls from FIRMS NRT API, OSM Overpass API, and satellite imagery providers.
Preprocessing & Spatial Join Engine: Cleans, deduplicates, and spatially joins hotspots with OSM polygons and land cover.
Feature Engineering: Derives thermal, spatial, and temporal-persistence features per hotspot.
AI/ML Classification Engine: Multi-stage classifier separating natural vs. industrial sources, then sub-classifying industrial sources.
PostGIS Spatial Database: Stores classified events, historical detection records, and supporting layers.
GIS Visualization Dashboard: Interactive web map showing classified thermal sources as overlays.
Alerting Module: Notifies stakeholders of likely accidental industrial fires or new anomalous sources.
Classification Taxonomy
Thermal Source Class	Description	Key Distinguishing Features
Industrial Fire (Accidental)	Refinery/plant fire, explosion, gas leak ignition	High FRP, sudden onset, within/near industrial polygon, non-recurring
Persistent Flare	Routine flaring at an oil/gas facility	Regular nightly detection, low FRP variance, fixed pixel location
Thermal Power Plant	Continuous combustion/cooling processes	Persistent, moderate/stable temperature, correlated with power=plant tag
Steel/Cement/Kiln Industry	Furnace or kiln heat	Persistent daytime signature, within industrial polygon
Mining Thermal Anomaly	Coal-seam fires, mineral processing heat	Persistent, low-to-moderate FRP, correlates with mining land use
Agricultural Burning	Crop-residue burning	Seasonal, short-duration, cropland cover, spreads across field polygons
Wildfire / Forest Fire	Natural or uncontrolled vegetation fire	High spatial spread rate, forest/vegetation cover, expands over consecutive days
6. Detailed Step-by-Step Implementation Methodology (100 Steps)
Phase 1: Project Scoping & Requirement Analysis (Steps 1–8)
Define the problem statement precisely: distinguish industrial fires and persistent thermal sources from wildfires, agricultural burns, and other anomalies using satellite thermal data.
Identify end users and stakeholders (disaster-management authorities, pollution-control boards, industrial safety regulators, insurers, environmental researchers).
Define the geographic scope of the pilot (e.g., a region with dense industrial clusters) before planning national/global scaling.
Establish success criteria and KPIs (per-class classification accuracy, false-alarm rate, detection latency).
List the target thermal-source classes to be distinguished (industrial fire, persistent flare, power plant, steel/cement kiln, mining anomaly, agricultural burn, wildfire).
Identify constraints: satellite revisit time, cloud cover, OSM data completeness, compute budget, real-time vs. batch requirements.
Draft a high-level system requirements document (functional and non-functional requirements).
Set up project management structure (timeline, milestones, task tracker, version control repository).
Phase 2: Literature Review & Benchmarking (Steps 9–15)
Study NASA FIRMS documentation, including MODIS and VIIRS active-fire algorithms, confidence levels, and Fire Radiative Power (FRP) definitions.
Review existing hotspot-classification approaches that use contextual/auxiliary data (land cover, infrastructure proximity) to separate fire types.
Study the OpenStreetMap tagging schema for industrial features (landuse=industrial, power=plant, man_made=works, industrial=oil, etc.).
Review satellite thermal-band specifications for Sentinel-2, Sentinel-3 SLSTR, and Landsat 8/9.
Benchmark existing gas-flare and persistent-hotspot datasets to understand the statistical signature of "persistence."
Identify gaps in current systems (FIRMS gives no source attribution; most fire-type research targets wildfire vs. non-wildfire, not fine-grained industrial sub-classes).
Summarize findings into a literature-review section and finalize the technical approach based on identified gaps.
Phase 3: Data Acquisition (Steps 16–30)
Register for NASA FIRMS/Earthdata API access and obtain credentials for NRT and archive hotspot data.
Download historical MODIS and VIIRS hotspot archives for the study region (minimum 2–3 years) to build a training dataset.
Set up automated NRT data pulls from FIRMS (updated roughly every 3 hours) via scheduled scripts.
Query the OSM Overpass API to extract industrial polygons, power plants, mines, refineries, and LNG terminals for the study region.
Clean and store OSM data in a local vector database, resolving duplicate/overlapping tags.
Access Sentinel-2 and Sentinel-3 imagery via the Copernicus Data Space Ecosystem or Google Earth Engine.
Access Landsat 8/9 imagery via USGS Earth Explorer or Earth Engine for higher-resolution validation.
Download ESA WorldCover (or equivalent) land-cover raster for contextual classification.
Collect available ground-truth references: news reports of past industrial fire incidents, disaster databases, known flare-site inventories.
Acquire administrative-boundary and industrial-zone shapefiles from government open-data portals for the pilot region.
Set up cloud/local storage architecture (object storage plus PostgreSQL/PostGIS) for raw hotspot, vector, and raster data.
Establish a data-versioning strategy so raw and processed datasets remain reproducible.
Validate coordinate reference systems (CRS) across all datasets and standardize to a common CRS (e.g., WGS84/EPSG:4326).
Perform initial exploratory data analysis (EDA) of FIRMS hotspots to understand spatial density, seasonal patterns, and confidence distributions.
Document all data sources, licenses, and update frequencies in a data catalog.
Phase 4: Data Preprocessing & Cleaning (Steps 31–42)
Remove duplicate hotspot detections arising from overlapping satellite passes.
Filter out low-confidence FIRMS detections below an acceptable threshold, retaining a labeled subset for edge-case analysis.
Convert FIRMS points and OSM polygons into a common spatial index (e.g., geohash or H3 grid) for efficient joins.
Buffer OSM industrial polygons (e.g., 500 m–1 km) to account for geolocation uncertainty in hotspot coordinates.
Spatially join FIRMS hotspots with buffered OSM industrial polygons to flag detections occurring near known industrial infrastructure.
Join hotspots with the land-cover raster to tag each detection with its underlying land-cover class.
Compute per-location historical detection frequency to identify persistent sources.
Handle missing/inconsistent OSM tags via a rule-based fallback (nearest industrial feature within X km), flagging low-confidence matches for review.
Remove cloud-contaminated satellite scenes using cloud masks (Sentinel-2 SCL band, Landsat QA band).
Normalize brightness temperature and FRP values across sensors (MODIS vs. VIIRS) to a comparable scale.
Generate a clean, unified spatiotemporal dataset combining hotspot attributes, OSM context, land cover, and imagery metadata.
Perform a data-quality audit and log preprocessing statistics (records retained/removed, join match rates).
Phase 5: Feature Engineering (Steps 43–52)
Engineer thermal features: FRP, brightness temperature (T4/T21 and T5/T31 bands), day/night flag.
Engineer spatial features: distance to nearest industrial polygon, distance to nearest road/settlement, land-cover class, administrative zone.
Engineer temporal-persistence features: detection frequency over the past 30/90/365 days, recurrence interval, diurnal pattern (day-only, night-only, both).
Engineer spread/growth features (for wildfire vs. contained-fire distinction): rate of change in hotspot-cluster area across consecutive days.
Engineer contextual features from OSM tags: facility type (refinery, power plant, mine, LNG terminal, steel plant, cropland).
Extract image-patch features from Sentinel-2/Landsat around each hotspot (NDVI, NDBI, burn index NBR) for CNN-based context classification.
Engineer seasonal/calendar features (month, harvest-season flag) to help identify agricultural-burning patterns.
Encode categorical variables (facility type, land cover, day/night) using appropriate encodings (one-hot/embedding).
Normalize/scale continuous features and handle outliers (extreme FRP values from sensor artifacts).
Assemble the final feature matrix and run feature-importance/correlation analysis to remove redundant variables.
Phase 6: Labeling & Ground Truth Generation (Steps 53–58)
Define labeling rules: recurring, low-variance hotspots inside industrial polygons = persistent source; one-off high-FRP detections inside industrial polygons = industrial fire; hotspots in forest/vegetation with spatial spread = wildfire; hotspots in cropland during harvest season = agricultural burn.
Cross-reference known incident records (news reports, disaster databases) to label confirmed accidental industrial-fire events.
Cross-reference known gas-flaring inventories, where available, to label confirmed persistent flare locations.
Manually review and label a stratified sample of ambiguous hotspots via satellite-imagery visual inspection to build a high-quality validation set.
Split the labeled dataset into training, validation, and test sets using spatial and temporal splitting (not random splitting) to avoid data leakage between nearby/repeated detections.
Document labeling guidelines and inter-annotator agreement for the manually reviewed subset.
Phase 7: AI/ML Model Development (Steps 59–72)
Build a rule-based baseline classifier (persistence + OSM proximity + land cover) as a performance benchmark.
Develop a tabular supervised classifier (Random Forest and/or XGBoost) using the engineered feature matrix to classify each hotspot.
Tune hyperparameters (tree depth, number of estimators, learning rate) via cross-validation on the training set.
Develop a CNN-based image classifier that ingests the satellite-image patch around each hotspot to capture visual context (burn-scar shape, infrastructure footprint, vegetation).
Explore a hybrid/ensemble model combining tabular-model output with CNN image-based predictions for improved accuracy.
Develop a time-series/sequence model (LSTM or a statistical persistence test) to formally distinguish "persistent thermal source" from "one-off fire event" using multi-day/multi-month detection history at a location.
Implement class-imbalance handling (class weighting, SMOTE) since industrial-fire events are rarer than persistent flares or agricultural burns.
Build a multi-stage classification pipeline: Stage 1 — natural (wildfire/agricultural) vs. industrial; Stage 2 — within industrial, persistent source vs. accidental fire vs. specific facility type.
Implement model explainability (SHAP values or feature-importance plots) so classification decisions can be audited by domain experts.
Containerize the model-training pipeline for reproducibility (Docker with a fixed environment specification).
Set up an experiment-tracking system (e.g., MLflow) to log model versions, hyperparameters, and metrics.
Perform ablation studies to quantify the contribution of OSM data, land cover, and persistence features to overall accuracy.
Select the best-performing model configuration based on validation performance and interpretability trade-offs.
Package the final trained model(s) for inference within the production pipeline.
Phase 8: Model Evaluation & Validation (Steps 73–78)
Evaluate the final model on the held-out test set using precision, recall, F1-score, and confusion matrix per thermal-source class.
Specifically evaluate the industrial-fire-vs-wildfire distinction and persistent-source detection accuracy as primary success metrics.
Perform error analysis on misclassified cases to identify systematic weaknesses (OSM data gaps in certain regions, sensor resolution limits).
Validate model outputs against a small set of real-world historical industrial-fire incidents not used in training (case-study validation).
Conduct a false-alarm-rate assessment to ensure the system does not overwhelm end users with incorrect industrial-fire alerts.
Document evaluation results in a model-validation report with recommendations for improvement.
Phase 9: GIS Visualization & Web Platform Development (Steps 79–88)
Design the database schema for a PostGIS spatial database to store classified hotspot records, OSM context, and historical detection history.
Set up the PostGIS database and load processed/classified data along with supporting vector layers (industrial polygons, land cover, administrative boundaries).
Develop a backend API (e.g., FastAPI or Django REST) to serve classified hotspot data, filters, and historical queries to the frontend.
Develop an interactive web GIS dashboard (Leaflet, Mapbox GL, or OpenLayers) to display classified thermal sources as a map overlay.
Implement map layers/toggles for each thermal-source class with distinct color coding and icons.
Implement a time-slider/animation feature to visualize how hotspots and persistent sources evolve over time.
Add a facility-level drill-down view showing historical thermal activity, classification confidence, and linked OSM attributes for a selected location.
Implement search and filter functionality (by region, facility type, date range, confidence level) on the dashboard.
Add summary analytics panels (charts/statistics) showing detection counts per class, region, and time period.
Ensure the dashboard is responsive and optimized for both desktop and mobile access by field responders.
Phase 10: System Integration, Deployment & Alerting (Steps 89–95)
Integrate the NRT FIRMS ingestion pipeline with the classification model to enable near-real-time classification of new hotspots (roughly every 3 hours, matching FIRMS updates).
Build an automated alerting module that triggers notifications (email/SMS/webhook) when a hotspot is classified as a likely accidental industrial fire or an anomalous new persistent source.
Implement alert prioritization/severity levels based on FRP magnitude, proximity to critical infrastructure or populated areas, and classification confidence.
Deploy the full pipeline (ingestion, preprocessing, classification, database, API, dashboard) using containerization (Docker Compose or Kubernetes) for scalability.
Set up a scheduler (e.g., Apache Airflow or cron) to orchestrate the periodic end-to-end pipeline run (data pull → preprocessing → classification → database update → alert check).
Configure logging, monitoring, and error-handling across the pipeline to ensure reliability of the operational system.
Conduct a security and access-control review for the API and dashboard (authentication, rate limiting, role-based access for different stakeholder types).
Phase 11: Testing, Documentation & Future Scope (Steps 96–100)
Conduct end-to-end system testing using simulated and historical data to verify the full pipeline works correctly under realistic conditions.
Perform user-acceptance testing with representative stakeholders (disaster-management or environmental-monitoring personnel) and incorporate feedback.
Prepare complete technical documentation (architecture, data dictionary, API reference, user guide) and a final project report.
Plan a pilot deployment/case study in the selected region and evaluate real-world performance over a defined monitoring period.
Define the roadmap for future scope: multi-sensor fusion (adding SAR for smoke/cloud penetration), expansion to national/global coverage, a mobile app for field alerts, and integration with official disaster-management systems.
7. AI/ML Classification Approach (Summary)

Multi-stage design:

Stage 1 (Natural vs. Industrial): Uses land cover, seasonality, and spread-rate features to separate wildfires/agricultural burns from industrial-context detections.
Stage 2 (Industrial Sub-classification): Uses OSM facility type, temporal persistence, and FRP variance to separate persistent sources (flares, plants, kilns) from accidental industrial fires.
Image-context layer: A CNN operating on satellite-image patches supplies visual corroboration (burn scars, infrastructure footprints), feeding into an ensemble with the tabular model.
Persistence model: A time-series/statistical test formally distinguishes "recurring expected source" from "novel event," which is central to filtering out routine flares.

Core feature groups: thermal (FRP, brightness temperature, day/night), spatial (distance to industrial polygon, land cover, facility type), and temporal (recurrence frequency, diurnal pattern, spread rate).

8. GIS-Based Visualization Solution
Storage: PostgreSQL/PostGIS spatial database storing classified events, historical trails, and vector context layers.
Serving layer: REST API exposing filtered, paginated queries by class, region, date range, and confidence.
Frontend: Web-based interactive map (Leaflet/Mapbox GL) with class-based color coding, time-slider animation, facility drill-down, and analytics panels — fulfilling the requirement for GIS-based storage and map-overlay visualization of classified outputs.
9. Expected Outcomes & Deliverables
Classification engine that segregates industrial fires from forest fires, agricultural burning, and other natural or persistent thermal anomalies.
GIS-based platform for spatial data storage and visualization of classified outputs as an interactive map overlay.
Historical and real-time detection database with per-location persistence tracking.
Automated alerting for likely accidental industrial-fire events.
Full technical documentation and a validated 100-step implementation roadmap.
10. Novelty & Innovation
Fusion of open, free data sources (FIRMS + OSM + Copernicus/Landsat) — no proprietary industrial databases required, making the approach globally replicable.
Persistence-aware classification, explicitly modeling the difference between a "routine" recurring thermal signature and a "novel" event, rather than treating every hotspot independently.
Multi-stage, explainable ensemble combining tabular ML, image-based CNN context, and rule-based domain logic for auditable decisions.
11. Feasibility Analysis & Challenges
Cloud cover can obscure optical/thermal imagery, especially in monsoon-affected regions; VIIRS/MODIS thermal detection is largely independent of daylight but still affected by dense cloud.
OSM data completeness varies significantly by region — some industrial facilities may be unmapped or mistagged, requiring fallback heuristics and periodic manual QA.
Sensor resolution limits (1 km for MODIS) can cause small flares to be missed or misattributed; VIIRS 375 m partially mitigates this.
Ground-truth scarcity for confirmed accidental industrial-fire events makes supervised training harder; semi-supervised and rule-based bootstrapping approaches are needed initially.
Latency of FIRMS NRT data (~3 hours) sets a lower bound on alert responsiveness.
12. Societal & Environmental Impact

Faster, more accurate identification of accidental industrial fires can reduce response time for emergency services, protect nearby communities, and limit environmental damage. Separating routine industrial thermal sources from genuine anomalies also reduces false-alarm fatigue for regulators, while the underlying dataset supports longer-term environmental monitoring of flaring, mining, and industrial land-use patterns.

13. Technology Stack
Layer	Suggested Technologies
Data Ingestion	Python, FIRMS API, OSM Overpass API, Google Earth Engine / Copernicus Data Space
Processing & ML	Python, GeoPandas, Rasterio, Scikit-learn, XGBoost, PyTorch/TensorFlow (CNN, LSTM)
Database	PostgreSQL + PostGIS
Backend API	FastAPI / Django REST Framework
Frontend/GIS Dashboard	React/Leaflet or Mapbox GL JS
Orchestration	Apache Airflow / cron
Deployment	Docker, Docker Compose / Kubernetes
Monitoring & Experiment Tracking	MLflow, standard logging/monitoring stack
14. Future Scope
Incorporate SAR imagery (e.g., Sentinel-1) for smoke- and cloud-penetrating detection.
Extend coverage from a regional pilot to national and global scale.
Build a mobile application for field responders and community reporting.
Integrate with official disaster-management platforms for automated escalation.
Add satellite-based smoke-plume and air-quality correlation for environmental-impact scoring.
15. Conclusion

This report outlines a complete methodology for building an AI-enabled geospatial system that classifies satellite-detected thermal anomalies into industrial fires, persistent industrial sources, and natural fire events, using only freely available data (NASA FIRMS, OpenStreetMap, and open satellite imagery). The proposed multi-stage classification approach, combined with a PostGIS-backed GIS visualization platform, directly addresses the two core deliverables of segregating industrial fires from natural fires and providing map-based visualization of results. The accompanying 100-step roadmap gives a concrete, phase-by-phase path from requirement analysis through pilot deployment.

References & Key Resources
NASA FIRMS — https://firms.modaps.eosdis.nasa.gov/
NASA Earthdata — https://earthdata.nasa.gov/
OpenStreetMap / Overpass API — https://www.openstreetmap.org/ , https://overpass-api.de/
Copernicus Data Space Ecosystem (Sentinel-2/3) — https://dataspace.copernicus.eu/
USGS Earth Explorer (Landsat) — https://earthexplorer.usgs.gov/
ESA WorldCover — https://esa-worldcover.org/
Google Earth Engine — https://earthengine.google.com/