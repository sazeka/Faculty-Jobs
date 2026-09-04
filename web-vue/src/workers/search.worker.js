import { normalizeSearchText, queryFullTextSearchIndex } from '../../../scripts/lib/jobs-search-index.js'

let indexPromise = null

async function loadIndex(baseUrl) {
  if (!indexPromise) {
    indexPromise = fetch(`${baseUrl}data/jobs-search-index.json`, { cache: 'no-cache' })
      .then((response) => {
        if (!response.ok) throw new Error(`jobs-search-index.json returned ${response.status}`)
        return response.json()
      })
      .catch((error) => { indexPromise = null; throw error })
  }
  return indexPromise
}

self.addEventListener('message', async (event) => {
  const { id, baseUrl, terms } = event.data || {}
  try {
    const index = await loadIndex(baseUrl || '/')
    const matches = queryFullTextSearchIndex(index, terms || [])
    self.postMessage({
      id,
      matches: [...matches.entries()].map(([term, ids]) => [normalizeSearchText(term), [...ids]]),
    })
  } catch (error) {
    self.postMessage({ id, error: error?.message || String(error) })
  }
})
