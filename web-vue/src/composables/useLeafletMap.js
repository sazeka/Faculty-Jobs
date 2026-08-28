import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import L from 'leaflet'
import 'leaflet.markercluster'
import { overviewBoundsPoints } from '../lib/mapViewport.js'

const MAP_DEFAULT_CENTER = [39.5, -98.35]
const MAP_DEFAULT_ZOOM = 4.6
const MAX_MAP_ZOOM = 15
const MAP_ZOOM_STEP = 1
const BASE_URL = import.meta.env.BASE_URL || '/'

const stateCoords = {
  Alabama: [32.806671, -86.79113],
  Alaska: [61.370716, -152.404419],
  Arizona: [33.729759, -111.431221],
  Arkansas: [34.969704, -92.373123],
  California: [36.116203, -119.681564],
  Colorado: [39.059811, -105.311104],
  Connecticut: [41.597782, -72.755371],
  Delaware: [39.318523, -75.507141],
  Florida: [27.766279, -81.686783],
  Georgia: [33.040619, -83.643074],
  Hawaii: [21.094318, -157.498337],
  Idaho: [44.240459, -114.478828],
  Illinois: [40.349457, -88.986137],
  Indiana: [39.849426, -86.258278],
  Iowa: [42.011539, -93.210526],
  Kansas: [38.5266, -96.726486],
  Kentucky: [37.66814, -84.670067],
  Louisiana: [31.169546, -91.867805],
  Maine: [44.693947, -69.381927],
  Maryland: [39.063946, -76.802101],
  Massachusetts: [42.230171, -71.530106],
  Michigan: [43.326618, -84.536095],
  Minnesota: [45.694454, -93.900192],
  Mississippi: [32.741646, -89.678696],
  Missouri: [38.456085, -92.288368],
  Montana: [46.921925, -110.454353],
  Nebraska: [41.12537, -98.268082],
  Nevada: [38.313515, -117.055374],
  'New Hampshire': [43.452492, -71.563896],
  'New Jersey': [40.298904, -74.521011],
  'New Mexico': [34.840515, -106.248482],
  'New York': [42.165726, -74.948051],
  'North Carolina': [35.630066, -79.806419],
  'North Dakota': [47.528912, -99.784012],
  Ohio: [40.388783, -82.764915],
  Oklahoma: [35.565342, -96.928917],
  Oregon: [44.572021, -122.070938],
  Pennsylvania: [40.590752, -77.209755],
  'Rhode Island': [41.680893, -71.51178],
  'South Carolina': [33.856892, -80.945007],
  'South Dakota': [44.299782, -99.438828],
  Tennessee: [35.747845, -86.692345],
  Texas: [31.054487, -97.563461],
  Utah: [40.150032, -111.862434],
  Vermont: [44.045876, -72.710686],
  Virginia: [37.769337, -78.169968],
  Washington: [47.400902, -121.490494],
  'West Virginia': [38.491226, -80.954453],
  Wisconsin: [44.268543, -89.616508],
  Wyoming: [42.755966, -107.30249],
}

export function useLeafletMap({ jobsRef, selectedCollegeRef, hoveredCollegeRef, onSelectCollege, onSelectState, onHoverCollege }) {
  const mapEl = ref(null)
  const mapNote = ref('Loading map...')
  const hasMappableData = ref(false)
  const canZoomIn = ref(true)
  const canZoomOut = ref(true)
  const collegeCoordsReady = ref(false)

  const mapInstance = ref(null)
  const collegeCoords = {}
  let markerNodes = new Map()
  let clusterGroup = null
  let hasInitialMapFit = false
  let initialMapView = null

  function clusterSize(total) {
    if (total >= 500) return 46
    if (total >= 100) return 40
    if (total >= 25) return 34
    return 28
  }

  // Cluster bubble shows the SUM of jobs across the grouped campus markers.
  function createClusterIcon(cluster) {
    const total = cluster
      .getAllChildMarkers()
      .reduce((n, m) => n + (m.options.jobCount || 0), 0)
    const size = clusterSize(total)
    const html = `<div class="leaflet-job-marker cluster" style="--marker-size:${size}px">${total.toLocaleString()}</div>`
    return L.divIcon({ className: 'leaflet-job-icon', html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] })
  }

  function escHtml(s) {
    return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  }

  // Popup shown on marker click: university (or state) + its open positions,
  // each linking to the posting, plus a "filter catalog" action. Inline styles
  // so it never depends on a bundled stylesheet.
  function buildPopupHtml(entry) {
    const isState = entry.isStateBubble
    const heading = escHtml(isState ? entry.state : entry.college)
    const sub = isState
      ? `${entry.count.toLocaleString()} open positions · ${(entry.colleges?.length ?? 0).toLocaleString()} institutions`
      : `${entry.count.toLocaleString()} open position${entry.count === 1 ? '' : 's'}`
    const jobs = (entry.jobs || []).slice(0, 8)
    const items = jobs
      .map((j) =>
        j.url
          ? `<li style="margin:0 0 4px;"><a href="${escHtml(j.url)}" target="_blank" rel="noreferrer" style="color:#2f6f8f;text-decoration:none;">${escHtml(j.title)}</a></li>`
          : `<li style="margin:0 0 4px;">${escHtml(j.title)}</li>`
      )
      .join('')
    const extra = (entry.jobs?.length || 0) - jobs.length
    const more = extra > 0 ? `<div style="font-size:11px;color:#6b7780;margin-top:4px;">+${extra.toLocaleString()} more…</div>` : ''
    const filterLabel = isState ? `Filter catalog to ${heading} →` : 'Filter catalog to this campus →'
    return `<div style="font-family:inherit;">
      <div style="font-weight:700;font-size:13px;margin-bottom:2px;">${heading}</div>
      <div style="font-size:11px;color:#6b7780;margin-bottom:6px;">${sub}</div>
      <ul style="list-style:none;padding:0;margin:0;font-size:12px;line-height:1.35;max-height:180px;overflow:auto;">${items}</ul>
      ${more}
      <button class="fa-map-popup-filter" type="button" style="margin-top:8px;background:none;border:0;padding:0;color:#a83030;font-size:11px;cursor:pointer;font-family:inherit;">${filterLabel}</button>
    </div>`
  }

  const groupedEntries = computed(() => {
    const groupedByCollege = new Map()
    for (const job of jobsRef.value || []) {
      if (!job?.college) continue
      if (!groupedByCollege.has(job.college)) {
        groupedByCollege.set(job.college, {
          college: job.college,
          count: 0,
          tenure: 0,
          nonTenure: 0,
          state: job.state || null,
          jobs: [],
        })
      }
      const entry = groupedByCollege.get(job.college)
      entry.count += 1
      entry.jobs.push({ title: job.title || 'Untitled position', url: job.url || null })
      // Enrichment stores tenureTrack as strings ("tenure-track"/"non-tenure-track"/
      // "unknown"); older data used booleans. Support both.
      if (job.tenureTrack === 'tenure-track' || job.tenureTrack === true) entry.tenure += 1
      else if (job.tenureTrack === 'non-tenure-track' || job.tenureTrack === false) entry.nonTenure += 1
    }
    return [...groupedByCollege.values()]
  })

  function getMarkerTone(entry) {
    if (entry.tenure > 0 && entry.nonTenure === 0) return 'tenure'
    if (entry.nonTenure > 0 && entry.tenure === 0) return 'non-tenure'
    return 'default'
  }

  function createMarkerIcon(entry, size) {
    const tone = entry.isStateBubble ? 'state-bubble' : getMarkerTone(entry)
    const count = entry.count.toLocaleString()
    const html = `<div class="leaflet-job-marker ${tone}" style="--marker-size:${size}px">${count}</div>`
    return L.divIcon({
      className: 'leaflet-job-icon',
      html,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    })
  }

  function getMapPointForEntry(college, state) {
    const coord = collegeCoords[college]
    if (coord && Number.isFinite(coord.lat) && Number.isFinite(coord.lon)) return [coord.lat, coord.lon]
    const fallback = state ? stateCoords[state] : null
    if (fallback && Number.isFinite(fallback[0]) && Number.isFinite(fallback[1])) return fallback
    return null
  }

  function getActiveCollege() {
    return hoveredCollegeRef.value || selectedCollegeRef.value || null
  }

  function setMarkerActiveState(activeCollege) {
    markerNodes.forEach((entry, college) => {
      const markerEl = entry.marker.getElement()
      const pin = markerEl ? markerEl.querySelector('.leaflet-job-marker') : null
      if (pin) pin.classList.toggle('active', college === activeCollege)
    })
  }

  function applyMapZoom() {
    if (!mapInstance.value) return
    const zoom = mapInstance.value.getZoom()
    const markerScale = Math.max(0.25, Math.min(1.2, Math.pow(2, (MAP_DEFAULT_ZOOM - zoom) * 0.28)))
    const markerScaleValue = markerScale.toFixed(3)
    markerNodes.forEach((entry) => {
      const markerEl = entry.marker.getElement()
      const pin = markerEl ? markerEl.querySelector('.leaflet-job-marker') : null
      if (pin) pin.style.setProperty('--marker-zoom-scale', markerScaleValue)
    })
    canZoomOut.value = zoom > mapInstance.value.getMinZoom()
    canZoomIn.value = zoom < mapInstance.value.getMaxZoom()
  }

  function clearMarkers() {
    if (clusterGroup) clusterGroup.clearLayers()
    markerNodes.forEach((entry) => entry.marker.remove())
    markerNodes = new Map()
  }

  function renderMarkers() {
    if (!mapInstance.value) return
    clearMarkers()
    hasMappableData.value = false

    let mappedCount = 0
    const precise = []
    const stateAgg = new Map()

    for (const entry of groupedEntries.value) {
      const coord = collegeCoords[entry.college]
      if (coord && Number.isFinite(coord.lat) && Number.isFinite(coord.lon)) {
        precise.push({ ...entry, point: [coord.lat, coord.lon] })
        mappedCount += entry.count
      } else if (entry.state && stateCoords[entry.state]) {
        if (!stateAgg.has(entry.state)) {
          stateAgg.set(entry.state, { state: entry.state, count: 0, tenure: 0, nonTenure: 0, colleges: [], jobs: [] })
        }
        const s = stateAgg.get(entry.state)
        s.count += entry.count
        s.tenure += entry.tenure
        s.nonTenure += entry.nonTenure
        s.colleges.push(entry.college)
        // Cap collected titles (popup shows only a few); avoids holding thousands.
        for (const jb of entry.jobs || []) { if (s.jobs.length < 50) s.jobs.push(jb) }
        mappedCount += entry.count
      }
    }

    const mappable = [
      ...precise,
      ...[...stateAgg.values()].map(s => ({
        college: ` state:${s.state}`,
        count: s.count, tenure: s.tenure, nonTenure: s.nonTenure,
        state: s.state, isStateBubble: true,
        colleges: s.colleges, jobs: s.jobs,
        point: stateCoords[s.state],
      })),
    ]

    if (mappable.length === 0) {
      mapNote.value = 'No university coordinates available for current results.'
      hasMappableData.value = false
      applyMapZoom()
      return
    }

    hasMappableData.value = true
    mapNote.value = `Mapped ${mappedCount} of ${jobsRef.value.length} jobs to campus points${collegeCoordsReady.value ? '' : ' (loading coordinates...)'}.`

    const maxCount = Math.max(...mappable.map((g) => g.count))
    mappable
      .sort((a, b) => b.count - a.count)
      .forEach((entry) => {
        const size = Math.min(30, 16 + Math.round((entry.count / maxCount) * 14))
        const marker = L.marker(entry.point, {
          icon: createMarkerIcon(entry, size),
          keyboard: true,
          jobCount: entry.count,
          title: entry.isStateBubble
            ? `${entry.state}: ${entry.count.toLocaleString()} jobs (${entry.colleges?.length ?? '?'} institutions)`
            : `${entry.college}: ${entry.count.toLocaleString()} jobs`,
          riseOnHover: true,
        })

        // Click opens a popup with the university + its open positions. The
        // "Filter catalog" button inside is wired on popupopen (filtering
        // re-renders markers, which would close an auto-opened popup).
        marker.bindPopup(buildPopupHtml(entry), { maxWidth: 260, minWidth: 190, autoPan: true })
        marker.on('popupopen', (e) => {
          const btn = e.popup.getElement()?.querySelector('.fa-map-popup-filter')
          if (btn) btn.onclick = () => {
            mapInstance.value?.closePopup()
            entry.isStateBubble ? onSelectState?.(entry.state) : onSelectCollege(entry.college)
          }
        })
        marker.on('mouseover', () => onHoverCollege(entry.isStateBubble ? null : entry.college))
        marker.on('mouseout', () => onHoverCollege(null))
        markerNodes.set(entry.college, { marker })
        if (clusterGroup) clusterGroup.addLayer(marker)
        else marker.addTo(mapInstance.value)
      })

    if (!hasInitialMapFit && mappable.length > 0) {
      const bounds = L.latLngBounds(overviewBoundsPoints(mappable.map((g) => g.point)))
      if (bounds.isValid()) {
        // Initial fitting can happen while the responsive rail is settling.
        // Avoid Leaflet's zoom animation here: animated fitting against a
        // newly-mounted sticky container can race its internal map pane setup.
        mapInstance.value.fitBounds(bounds, { padding: [28, 28], maxZoom: 8, animate: false })
        hasInitialMapFit = true
        const center = mapInstance.value.getCenter()
        initialMapView = { center: [center.lat, center.lng], zoom: mapInstance.value.getZoom() }
      }
    }

    applyMapZoom()
    setMarkerActiveState(getActiveCollege())
  }

  function zoomInMap() {
    if (!mapInstance.value) return
    mapInstance.value.setZoom(Math.min(mapInstance.value.getMaxZoom(), mapInstance.value.getZoom() + MAP_ZOOM_STEP))
  }

  function zoomOutMap() {
    if (!mapInstance.value) return
    mapInstance.value.setZoom(Math.max(mapInstance.value.getMinZoom(), mapInstance.value.getZoom() - MAP_ZOOM_STEP))
  }

  function zoomResetMap() {
    if (!mapInstance.value) return
    if (markerNodes.size > 0) {
      const points = []
      markerNodes.forEach((entry) => {
        const latLng = entry.marker.getLatLng()
        if (latLng) points.push(latLng)
      })
      if (points.length > 0) {
        const bounds = L.latLngBounds(overviewBoundsPoints(points))
        if (bounds.isValid()) {
          mapInstance.value.fitBounds(bounds, { padding: [28, 28], maxZoom: 8, animate: true })
          return
        }
      }
    }
    if (initialMapView) {
      mapInstance.value.setView(initialMapView.center, initialMapView.zoom, { animate: true })
    } else {
      mapInstance.value.setView(MAP_DEFAULT_CENTER, MAP_DEFAULT_ZOOM, { animate: true })
    }
  }

  function clearMapSelection() {
    onSelectCollege(null)
  }

  function handleWindowResize() {
    applyMapZoom()
    if (mapInstance.value) mapInstance.value.invalidateSize()
  }

  function initMapIfReady() {
    if (!mapEl.value || mapInstance.value) return false

    mapInstance.value = L.map(mapEl.value, {
      zoomControl: false,
      minZoom: 3,
      maxZoom: MAX_MAP_ZOOM,
      doubleClickZoom: true,
    }).setView(MAP_DEFAULT_CENTER, MAP_DEFAULT_ZOOM, { animate: false })

    // Standard OpenStreetMap tiles require no API key. CARTO's former public
    // Positron endpoint now watermarks anonymous requests with "API key
    // required", which obscures the map.
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: MAX_MAP_ZOOM,
      subdomains: 'abc',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
    }).addTo(mapInstance.value)

    // Cluster overlapping campus markers; the cluster bubble sums their job counts.
    clusterGroup = L.markerClusterGroup({
      maxClusterRadius: 46,
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      chunkedLoading: true,
      iconCreateFunction: createClusterIcon,
    }).addTo(mapInstance.value)
    // Re-apply zoom scaling + active highlight once markers settle after declustering.
    clusterGroup.on('animationend', () => {
      applyMapZoom()
      setMarkerActiveState(getActiveCollege())
    })

    mapInstance.value.on('zoomend', applyMapZoom)
    window.addEventListener('resize', handleWindowResize)
    mapNote.value = 'Map ready.'
    renderMarkers()
    return true
  }

  async function loadCollegeCoords() {
    try {
      const response = await fetch(`${BASE_URL}college-coords.json`, { cache: 'no-store' })
      if (!response.ok) return
      const text = await response.text()
      let data = null
      try {
        data = JSON.parse(text)
      } catch {
        // Dev fallback can serve index.html for missing files; treat as unavailable.
        return
      }
      const entries = data?.colleges && typeof data.colleges === 'object' ? data.colleges : {}
      for (const [college, info] of Object.entries(entries)) {
        const lat = Number(info?.lat)
        const lon = Number(info?.lon)
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          collegeCoords[college] = { lat, lon }
        }
      }
      collegeCoordsReady.value = true
      renderMarkers()
    } catch {
      collegeCoordsReady.value = false
    }
  }

  onMounted(() => {
    loadCollegeCoords()
    initMapIfReady()
  })

  onBeforeUnmount(() => {
    window.removeEventListener('resize', handleWindowResize)
    clearMarkers()
    clusterGroup = null
    if (mapInstance.value) {
      mapInstance.value.remove()
      mapInstance.value = null
    }
  })

  watch(groupedEntries, () => renderMarkers())
  watch(selectedCollegeRef, () => setMarkerActiveState(getActiveCollege()))
  watch(hoveredCollegeRef, () => setMarkerActiveState(getActiveCollege()))

  return {
    mapEl,
    mapNote,
    hasMappableData,
    canZoomIn,
    canZoomOut,
    zoomInMap,
    zoomOutMap,
    zoomResetMap,
    clearMapSelection,
  }
}
