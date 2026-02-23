import { onMounted, ref } from 'vue'

export function useJobsData() {
  const jobs = ref([])
  const status = ref('Loading jobs...')
  const scrapedAt = ref(null)
  const loadError = ref('')
  const baseUrl = import.meta.env.BASE_URL || '/'

  async function loadJobs() {
    loadError.value = ''
    status.value = 'Loading jobs...'
    try {
      const response = await fetch(`${baseUrl}jobs.json`, { cache: 'no-store' })
      if (!response.ok) throw new Error(`jobs.json returned ${response.status}`)
      const payload = await response.json()
      jobs.value = Array.isArray(payload?.jobs) ? payload.jobs : []
      scrapedAt.value = payload?.scrapedAt || null
      status.value = `Loaded ${jobs.value.length.toLocaleString()} jobs`
    } catch (error) {
      jobs.value = []
      status.value = 'Failed to load jobs'
      loadError.value = error?.message || String(error)
    }
  }

  onMounted(() => {
    loadJobs()
  })

  return {
    jobs,
    status,
    scrapedAt,
    loadError,
    loadJobs,
  }
}
