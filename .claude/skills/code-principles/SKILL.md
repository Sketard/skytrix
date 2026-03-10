---
name: code-principles
description: Fundamental software principles - SOLID, DRY, Occam's Razor, Miller's Law, YAGNI. Use when applying design principles, refactoring code, resolving principle conflicts, or reviewing code complexity.
---

# Code Principles

## Priority When Principles Conflict

1. **Safety First** (security, data integrity)
2. **YAGNI** (don't build what's not needed now)
3. **Occam's Razor / KISS** (simplest solution)
4. **SOLID** (clean architecture)
5. **DRY** (no duplication)
6. **Miller's Law** (cognitive load limits)

---

## Quick Decision Questions

| Question | Principle |
|----------|-----------|
| Is there a simpler way? | Occam's Razor |
| Can a new team member understand this in < 1 minute? | Miller's Law |
| Am I duplicating knowledge or intent? | DRY |
| Is this needed right now? | YAGNI |
| Does this class have a single clear reason to change? | SRP |

---

## Rules

| Principle | Rule |
|-----------|------|
| **DRY** | Abstract on 3rd duplication (Rule of Three) — 2x = note it, 3x = refactor |
| **SOLID** | Interface only when 2nd implementation appears |
| **YAGNI** | Build only if the problem exists now |
| **Readable** | New team member understands in < 1 minute |

---

## Miller's Law Thresholds

| Element | Max | Ideal |
|---------|-----|-------|
| Function parameters | 5 | 3 |
| Class public methods | 7 | 5 |
| Conditional branches | 5 | 3 |
| Function length (lines) | 20 | 5-15 |
| Nesting depth | 3 | 2 |
