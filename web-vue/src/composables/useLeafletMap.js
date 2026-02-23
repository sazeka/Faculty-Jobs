import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import L from 'leaflet'

const MAP_DEFAULT_CENTER = [39.5, -98.35]
const MAP_DEFAULT_ZOOM = 4.6
const MAX_MAP_ZOOM = 15
const MAP_ZOOM_STEP = 1

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

export function useLeafletMap({ jobsRef, selectedCollegeRef, hoveredCollegeRef, onSelectCollege, onHoverCollege }) {
  const mapEl = ref(null)
  const mapNote = ref('Loading map...')
  const hasMappableData = ref(false)
  const canZoomIn = ref(true)
  const canZoomOut = ref(true)
  const collegeCoordsReady = ref(false)

  const mapInstance = ref(null)
  const collegeCoords = {}
  let markerNodes = new Map()
  let hasInitialMapFit = false
  let initialMapView = null

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
        })
      }
      const entry = groupedByCollege.get(job.college)
      entry.count += 1
      if (job.tenureTrack === true) entry.tenure += 1
      else if (job.tenureTrack === false) entry.nonTenure += 1
    }
    return [...groupedByCollege.values()]
  })

  function getMarkerTone(entry) {
    if (entry.tenure > 0 && entry.nonTenure === 0) return 'tenure'
    if (entry.nonTenure > 0 && entry.tenure === 0) return 'non-tenure'
    return 'default'
  }

  function createMarkerIcon(entry, size) {
    const tone = getMarkerTone(entry)
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
    markerNodes.forEach((entry) => entry.marker.remove())
    markerNodes = new Map()
  }

  function renderMarkers() {
    if (!mapInstance.value) return
    clearMarkers()
    hasMappableData.value = false

    let mappedCount = 0
    const mappable = []
    for (const entry of groupedEntries.value) {
      const point = getMapPointForEntry(entry.college, entry.state)
      if (!point) continue
      mappedCount += entry.count
      mappable.push({ ...entry, point })
    }

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
          title: `${entry.college}: ${entry.count.toLocaleString()} jobs`,
          riseOnHover: true,
        }).addTo(mapInstance.value)

        marker.on('click', () => onSelectCollege(entry.college))
        marker.on('mouseover', () => onHoverCollege(entry.college))
        marker.on('mouseout', () => onHoverCollege(null))
        markerNodes.set(entry.college, { marker })
      })

    if (!hasInitialMapFit && mappable.length > 0) {
      const bounds = L.latLngBounds(mappable.map((g) => g.point))
      if (bounds.isValid()) {
        mapInstance.value.fitBounds(bounds, { padding: [28, 28], maxZoom: 8 })
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
        const bounds = L.latLngBounds(points)
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
    }).setView(MAP_DEFAULT_CENTER, MAP_DEFAULT_ZOOM)

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: MAX_MAP_ZOOM,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(mapInstance.value)

    mapInstance.value.on('zoomend', applyMapZoom)
    window.addEventListener('resize', handleWindowResize)
    mapNote.value = 'Map ready.'
    renderMarkers()
    return true
  }

  async function loadCollegeCoords() {
    try {
      const response = await fetch('/college-coords.json', { cache: 'no-store' })
      if (!response.ok) return
      const data = await response.json()
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
    if (mapInstance.value) {
      mapInstance.value.remove()
      mapInstance.value = null
    }
  })

  watch(groupedEntries, () => renderMarkers(), { deep: true })
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
