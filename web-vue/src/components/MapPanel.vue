<script setup>
import { toRef } from 'vue'
import { useLeafletMap } from '../composables/useLeafletMap'

const props = defineProps({
  jobs: { type: Array, required: true },
  selectedCollege: { type: String, default: null },
  hoveredCollege: { type: String, default: null },
})

const emit = defineEmits(['select-college', 'hover-college'])

const { mapEl, mapNote, hasMappableData, canZoomIn, canZoomOut, zoomInMap, zoomOutMap, zoomResetMap, clearMapSelection } =
  useLeafletMap({
    jobsRef: toRef(props, 'jobs'),
    selectedCollegeRef: toRef(props, 'selectedCollege'),
    hoveredCollegeRef: toRef(props, 'hoveredCollege'),
    onSelectCollege: (college) => emit('select-college', college),
    onHoverCollege: (college) => emit('hover-college', college),
  })
</script>

<template>
  <section class="panel map-panel">
    <div class="map-top-row">
      <strong>Map View</strong>
      <div class="map-actions">
        <button v-if="props.selectedCollege" type="button" @click="clearMapSelection">Clear College Filter</button>
        <button type="button" title="Zoom out" aria-label="Zoom out" :disabled="!canZoomOut" @click="zoomOutMap">−</button>
        <button type="button" title="Zoom in" aria-label="Zoom in" :disabled="!canZoomIn" @click="zoomInMap">+</button>
        <button type="button" title="Reset zoom" aria-label="Reset zoom" @click="zoomResetMap">•</button>
      </div>
    </div>
    <p class="muted map-note">{{ mapNote }}</p>
    <div ref="mapEl" class="leaflet-map"></div>
    <div v-if="!hasMappableData" class="map-empty">No mappable state data in these results.</div>
  </section>
</template>
