# RetIQ — Retirement Planner

**A privacy-first retirement planning app that runs entirely in your browser.**

No accounts. No cloud. No subscriptions. Your financial data never leaves your device.

🔗 **[retirementiq.app](https://retirementiq.app)** · 📖 **[User Manual](https://retirementiq.app/manual.html)** · 🛡 **[Security & Privacy](https://retirementiq.app/security.html)** · ✅ **[Validation Report](https://retirementiq.app/validation.html)**

---

## What Is RetIQ?

RetIQ is a comprehensive retirement planning tool that models your financial future year by year — income, taxes, Social Security, Medicare, withdrawals, Roth conversions, and more — all computed client-side in JavaScript. Nothing is sent to a server. Everything runs in your browser.

It's built as a single HTML file with no external dependencies beyond self-hosted fonts and Chart.js (bundled). Install it as a Progressive Web App and it works fully offline.

## Features

**Planning Engine** — Year-by-year projection from current age through end of plan. Multi-account modeling (Pre-Tax, Roth, Cash/HYS, Brokerage) with independent return rates. Full spouse integration with independent retirement ages, income, and benefits. Inflation-adjusted and nominal views.

**Tax Modeling** — 2025 federal brackets (MFJ and single), all 50 states + DC, capital gains brackets, NIIT, SS taxation (up to 85%), and OBBB Act 2025 updates. Taxable income computed from all sources every year.

**Social Security & Medicare** — PIA calculation with 2025 bend points, FRA by birth year, early/delayed claiming adjustments, spousal and survivor benefits, SSDI with automatic FRA conversion. Medicare Part B/D premiums with IRMAA surcharges.

**Optimization** — Monte Carlo simulation (1,000 scenarios), Roth conversion optimizer with multi-year tax impact analysis, Strategy Report Card testing 7–9 alternatives, scenario comparison, and maximum sustainable spending solver.

**4-Bucket Withdrawal System** — Cash/HYS, Brokerage, Pre-Tax, and Roth as fully independent buckets with configurable withdrawal priority. Cash withdrawals are tax-free (principal return); brokerage triggers capital gains; pre-tax is ordinary income; Roth is tax-free.

**Additional Modeling** — Pensions with COLA, SSDI for both spouses, pre-retirement healthcare gap costs, long-term care, QCD/charity, liabilities (mortgage, alimony, student loans), expense phases, legacy goals, and other retirement income streams.

**Privacy & Security** — Zero telemetry, no analytics, no cookies, no tracking, no accounts. Self-hosted fonts (no Google CDN). Strict Content Security Policy enforced by your browser. All data in localStorage on your device. See the full [Privacy & Security Transparency](https://retirementiq.app/security.html) page for a verifiable audit.

## Validation

RetIQ includes 218 automated tests that verify every calculation against authoritative sources:

- **IRS:** Rev. Proc. 2024-40 (2025 brackets, deductions, capital gains), Pub 590-B (RMD tables), Pub 915 (SS taxation), Notice 2024-80 (contribution limits, QCD), IRC §1411 (NIIT)
- **SSA:** 2025 bend points and wage base, FRA schedules, early reduction and delayed credit rates
- **CMS:** 2025 Medicare Part B/D premiums, IRMAA brackets and surcharges
- **SECURE Act 2.0:** RMD start ages (§107), super catch-up contributions (§109)
- **OBBB Act 2025:** Senior standard deduction (§102), updated bracket structure (P.L. 119-21)
- **HHS/ACA:** 2025 Federal Poverty Level guidelines, ACA Premium Tax Credit applicable percentage tables (enhanced and original), ARPA/IRA subsidy extensions

The full report — with every test name, expected value, actual result, tolerance, source citation, and pass/fail status — is viewable inside the app under the **Validation** tab or at [retirementiq.app/validation.html](https://retirementiq.app/validation.html).

## Privacy Architecture

RetIQ makes **zero network requests** during normal use (data entry, projections, Monte Carlo). The only external contacts are:

| When | Domain | Data Sent |
|------|--------|-----------|
| License activation | Cloudflare Worker | License key only |
| Purchase (if you buy Pro) | Stripe checkout | Redirect — no financial data from RetIQ |
| PWA update check | retirementiq.app | Standard HTTP request |

Your financial data — income, balances, expenses, tax info, Social Security — **never leaves your browser**. A strict Content Security Policy is enforced at the browser level, preventing the app from contacting unauthorized domains even if the code were modified.

You can verify all of this yourself with browser DevTools. See [Security & Privacy Transparency](https://retirementiq.app/security.html) for step-by-step instructions.

## Tech Stack

- **Single-file HTML app** with embedded CSS and JavaScript
- **Chart.js** for interactive visualizations
- **Self-hosted WOFF2 fonts** (DM Sans, JetBrains Mono) — no external CDN
- **Service Worker** for PWA offline support and asset caching
- **Cloudflare Pages** for static hosting
- **Cloudflare Worker** for license verification (3 endpoints, no financial data)
- **Stripe** for payment processing (checkout redirect only)

## Project Structure

```
retiq/
├── app-index.html          # The app (single-file, ~350 KB source)
├── service-worker.js       # PWA service worker
├── manifest.webmanifest    # PWA manifest
├── fonts/                  # Self-hosted WOFF2 fonts (7 files)
├── icons/                  # PWA icons
├── features.html           # Feature list
├── manual.html             # User manual (24 sections)
├── security.html           # Privacy & security transparency page
├── validation.html         # Validation report (218 tests)
├── privacy.html            # Privacy policy
├── terms.html              # Terms of service
├── index.html              # Landing page
├── offline.html            # PWA offline fallback
├── success.html            # Post-purchase page
├── robots.txt              # Search engine directives
├── build.js                # Build script (minification via esbuild)
├── build.sh                # Build + deploy wrapper
├── test-validation.js      # Validation test runner (Node.js)
└── retiq-deploy/           # Production build output → Cloudflare Pages
    ├── app/                # Minified app + service worker + fonts + icons
    └── *.html              # Minified site pages
```

## Building

```bash
npm install          # Install esbuild
./build.sh           # Build only (output in retiq-deploy/)
./build.sh deploy    # Build + deploy to Cloudflare Pages
```

The build script minifies JavaScript, CSS, and HTML via esbuild, copies static assets (fonts, icons), and verifies the output is valid. The production build is typically ~30% smaller than source.

## Running Tests

```bash
# Validation tests (218 tests against IRS/SSA/CMS/HHS sources)
node test-validation.js
```

Tests run via Node.js against the calculation engine extracted from app-index.html. All 218 tests must pass before deployment.

## License

This project is licensed under the **[Business Source License 1.1](./LICENSE)** (BSL 1.1).

You are free to view, copy, modify, and redistribute the code for **non-production use**. Production use requires a license purchase at [retirementiq.app](https://retirementiq.app).

Each version automatically converts to a GPL-compatible open-source license four years after its release date.

## Links

- **App:** [retirementiq.app](https://retirementiq.app)
- **Manual:** [retirementiq.app/manual.html](https://retirementiq.app/manual.html)
- **Features:** [retirementiq.app/features.html](https://retirementiq.app/features.html)
- **Security:** [retirementiq.app/security.html](https://retirementiq.app/security.html)
- **Validation:** [retirementiq.app/validation.html](https://retirementiq.app/validation.html)
