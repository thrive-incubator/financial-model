# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Single-file interactive web app for Monte Carlo portfolio simulation of spin-out ventures from the Thrive incubator. Models royalty income + equity value returns over a 10-year horizon.

**Main file:** `thrive_incubator_portfolio_simulation.html`

## Running

No build process. Open directly in a browser or serve locally:

```bash
python -m http.server
```

External dependency: Chart.js 4.4.1 loaded from CDN.

## Architecture

Everything lives in one HTML file: inline CSS, JavaScript, and HTML. The main `calc()` function is triggered on any input change and drives the entire simulation.

### Data Flow

```
User inputs (sliders/dropdowns)
  → calc()
  → Monte Carlo simulation (venture generation → survival filtering → lognormal revenue sampling)
  → Financial calculations (royalties + equity)
  → 10-year cumulative curve construction
  → Update DOM metrics + Chart.js charts
```

### Key Simulation Components

**Random number generation:** Deterministic via a seeded `SEED_RANDOMS` array (200 values). Box-Muller transform converts these to standard normals for lognormal revenue sampling.

**Revenue sampling:** Lognormal distribution — `revenue = exp(mu + sigma * z)` where `mu = log(median_revenue)`.

**Royalty calculation (`royaltyForVenture`):** Three modes:
- *Flat:* Fixed % on revenue above threshold
- *Graduated:* Tiered rates ($0–2M @ 3%, $2–10M @ 5%, >$10M @ 7%)
- *Capped:* Rate with per-venture lifetime cap

**Equity valuation:** `effective_equity = base_equity * (1 - dilution)` with anti-dilution protection options (None / Series A at 50% / Series B at 75%).

**10-year curves:** Ventures reach maturity at `matY` years; annual royalties aggregate from that point. Cumulative investment is tracked in parallel.

### Output

- 4 KPI metric cards (annual royalty, cumulative 10yr royalty, equity value, total return / ROI)
- Line chart: cumulative investment (red) vs cumulative royalties (green)
- Bar chart: venture distribution across revenue buckets
- "Current hypotheses" text summary of all active parameters
- Buttons to send prompts to Claude API (term sheet drafting, presentation strategy)
