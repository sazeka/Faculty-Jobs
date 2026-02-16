# Faculty Atlas Map Visual Spec

## 1) Design Intent
The map should feel like an extension of the current Faculty Atlas interface: editorial, warm, and legible. It acts as a discovery surface for location-based browsing, while job cards remain the detail surface.

## 2) Existing Brand Alignment
- Keep current typography: `Fraunces` for headline accents and `Manrope` for interface/content.
- Keep current palette direction: parchment background, deep ink text, terracotta accent, muted greens.
- Preserve rounded geometry and soft elevation used in cards/filters.

## 3) Map Placement and Layout
### Desktop (>= 961px)
- Use a two-pane shell:
  - Left pane: results list and filters (`360px` fixed, scrollable).
  - Right pane: map (`min-height: calc(100vh - 220px)`, sticky top offset `14px`).
- Place map directly under status bar so users can read count + location context together.

### Mobile (<= 960px)
- Default to list-first.
- Add segmented toggle at top of results area:
  - `List` (default)
  - `Map`
- In `Map` mode:
  - Map height: `46vh` minimum, full width.
  - Collapsible bottom sheet with top 3 visible jobs, draggable to reveal more.

## 4) Visual Tokens
Use these tokens (aligned with current CSS variables):

```css
:root {
  --map-water: #dfe8e8;
  --map-land: #f6f1e8;
  --map-road: #d8d1c5;
  --map-boundary: #c9c0b2;

  --map-marker-default: #c45c38;
  --map-marker-default-ring: rgba(196, 92, 56, 0.22);

  --map-marker-tenure: #396326;
  --map-marker-tenure-ring: rgba(57, 99, 38, 0.22);

  --map-marker-nontenure: #5f6d6f;
  --map-marker-nontenure-ring: rgba(95, 109, 111, 0.20);

  --map-marker-postdoc: #20574d;
  --map-marker-postdoc-ring: rgba(32, 87, 77, 0.22);

  --map-cluster-bg: #213234;
  --map-cluster-ink: #fff9f3;

  --map-panel-bg: rgba(255, 253, 249, 0.94);
  --map-panel-border: #d8d1c5;
  --map-shadow: 0 14px 30px rgba(35, 29, 19, 0.16);
}
```

## 5) Basemap Styling
- Use a desaturated/light basemap with low visual noise.
- Suppress bright POI labels and transit icons.
- Keep state boundaries visible but subtle.
- Avoid satellite imagery.
- Recommended visual target:
  - High contrast for markers and popovers.
  - Low contrast for roads/terrain.

## 6) Marker System
### Marker Types
- Default faculty role: terracotta (`--map-marker-default`).
- Tenure-track role: green (`--map-marker-tenure`).
- Non-tenure role: slate (`--map-marker-nontenure`).
- Postdoc/research trainee: deep teal (`--map-marker-postdoc`).

### Marker Form
- Shape: 14px circular core with 2px white stroke.
- Halo: 24px soft ring using role-specific ring token.
- Hover: scale to `1.12`, ring opacity +12%.
- Active/selected: scale `1.18`, add 2nd outer ring (`1px` solid `#fff9f3`).

### Density and Clustering
- Cluster when markers are within 44px.
- Cluster badge:
  - Background `--map-cluster-bg`.
  - Text `--map-cluster-ink`.
  - 30px circle, semibold count.
- On cluster click: smooth zoom and spiderfy or split.

## 7) Popover Card (Map Tooltip)
- Width: `280px` desktop, `min(92vw, 320px)` mobile.
- Background: `--map-panel-bg` with 8px backdrop blur.
- Border: `1px solid --map-panel-border`.
- Radius: `14px`.
- Shadow: `--map-shadow`.
- Content hierarchy:
  - Title in `Fraunces`, 16px.
  - University + city/state in `Manrope`, 13px muted.
  - Pills for role/track.
  - CTA row: `View job` primary link + `Save` secondary action.

## 8) Map/List Coordination
- Hover job card -> highlight marker and raise z-index.
- Hover marker -> highlight corresponding job card.
- Click job card -> pan map to marker with 220ms ease and open popover.
- Click marker -> scroll list to job card and apply "selected" state.
- Keep selected job synchronized through filter/sort changes when still visible.

## 9) Motion Spec
- Initial map reveal: 180ms fade + 200ms translateY(4px).
- Marker enter after filter change:
  - Stagger 12ms each, max 180ms total.
- Prefer `ease-out` curves.
- Respect reduced motion:
  - Disable stagger and scale transitions when `prefers-reduced-motion: reduce`.

## 10) Accessibility
- Marker hit area minimum: `32x32px`.
- Keyboard:
  - Tab cycles through visible markers and list cards.
  - Enter/Space opens popover.
- ARIA:
  - Marker button label format: `"{title}, {university}, {city}, {state}"`.
- Ensure WCAG AA contrast for labels and controls over map surface.

## 11) Data and Edge Cases
- Jobs lacking coordinates:
  - Keep in list with a `Location pending` pill.
  - Optional fallback geocode at city/state level.
- Same-campus duplicates:
  - Slight marker jitter (`<= 8px`) at max zoom or stacked count badge.
- Out-of-US jobs:
  - Include in map extent only when present; otherwise default to contiguous U.S. view.

## 12) Recommended Implementation Sequence
1. Add map container and list/map responsive shell.
2. Integrate geocoded lat/lng in normalized job model.
3. Render clustered markers by track type.
4. Sync selection state between list and map.
5. Add popover card and keyboard navigation.
6. Tune animations and reduced-motion behavior.

## 13) Acceptance Criteria
- Visual cohesion with existing Faculty Atlas palette/type/shape.
- Marker color semantics are clear without legend dependency.
- List/map synchronization works both directions.
- Mobile map mode is usable with one hand and preserves quick return to list.
- No major performance degradation with current dataset size.
