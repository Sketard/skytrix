# Responsive Audit — Report

_Tag: `responsive-audit-2026-05-20` · Generated 2026-05-20T06:49:25.723Z_

## Coverage

- **Pages:** 11 (Track A canvas: 3, Track B CSS: 8)
- **Viewports:** 8 (360, 414, 360L, 414L, 768, 1024, 1280, 1920)
- **States captured:** initial + 6 interactive states
- **Locales:** FR (always) + EN on 4 critical pages
- **Total captures:** 192

## Mechanical summary

| Issue | Captures impacted |
|---|---|
| Horizontal overflow | 0 |
| Undersized touch targets (< 44px) | 192 |
| Truncated text (ellipsis / line-clamp active) | 24 |
| Broken images | 0 |
| `overflow:hidden` clipping content | 175 |
| Console errors | 7 |
| Failed network requests | 7 |
| a11y violations (any) | 160 |
| a11y critical/serious | 104 |

See [findings-mechanical.md](findings-mechanical.md) for per-capture detail, [axe-summary.md](axe-summary.md) for a11y aggregate, and [frames/](frames/) for screenshots.

## Next step

Visual audit pass: walk through `frames/`, classify findings into P0 (broken) / P1 (degraded) / P2 (polish), then red-team with Axel before fixing.