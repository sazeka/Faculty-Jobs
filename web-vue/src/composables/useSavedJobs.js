import { onMounted, ref } from 'vue'
import { STORAGE_KEYS } from '../config/appConfig'

function parseStoredArray(key) {
  try {
    const data = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

export function useSavedJobs() {
  const savedJobs = ref(new Set())

  function persistSavedJobs() {
    localStorage.setItem(STORAGE_KEYS.savedJobs, JSON.stringify([...savedJobs.value]))
  }

  function isSavedJob(url) {
    return Boolean(url) && savedJobs.value.has(url)
  }

  function toggleSavedJob(url) {
    if (!url || url === '#') return
    const next = new Set(savedJobs.value)
    if (next.has(url)) next.delete(url)
    else next.add(url)
    savedJobs.value = next
    persistSavedJobs()
  }

  onMounted(() => {
    savedJobs.value = new Set(parseStoredArray(STORAGE_KEYS.savedJobs))
  })

  return {
    savedJobs,
    isSavedJob,
    toggleSavedJob,
  }
}
