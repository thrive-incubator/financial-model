# Thrive Incubator Portfolio Simulation

Interactive Monte Carlo simulator for modeling the financial returns of the Thrive incubator's spin-out portfolio — royalty income and equity value over a 10-year horizon.

## Running

No build step. Open directly in any modern browser:

```
open thrive_incubator_portfolio_simulation.html
```

Or serve locally:

```bash
python -m http.server
```

Requires an internet connection on first load (Chart.js loads from CDN).

## Parameters

### Portfolio
- **Spin-outs per year** — how many ventures Thrive incubates annually
- **Years of operation** — how long the program runs
- **Survival rate** — % of ventures that remain active
- **Total investment** — total capital deployed across the program

### Revenue distribution (lognormal)
- **Median revenue** — central revenue estimate for mature ventures
- **Spread (sigma)** — variance of the distribution; higher = more extreme outcomes
- **Years to maturity** — lag before a spin-out starts generating revenue

### Royalty structure
Three modes: **Flat** (fixed rate), **Graduated** (tiered rates by revenue band), **Capped** (rate with a per-venture lifetime ceiling). All modes support a revenue threshold below which no royalty applies.

### Equity structure
- Thrive and GU OTC equity stakes
- Anti-dilution protection level (through Series A, B, or none)
- Dilution at exit, % of ventures reaching a liquidity event, average exit valuation

## Output metrics

| Metric | Description |
|--------|-------------|
| Annual royalty income | Steady-state royalties from all mature survivors |
| Cumulative royalty (10 yr) | Total royalty income over the simulation horizon |
| Portfolio equity value | Expected equity return from liquidity events |
| Total return | Royalty + equity, shown as absolute value and ROI multiple |

The line chart shows cumulative investment vs. cumulative royalty income year by year. The bar chart shows how surviving ventures are distributed across revenue buckets.

## Design notes

Revenues are sampled from a lognormal distribution using a deterministic seeded RNG (Box-Muller transform), so results are reproducible across page loads. The seed array has 200 values; portfolios larger than 100 ventures will cycle through the same random values.
