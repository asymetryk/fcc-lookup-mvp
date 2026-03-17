import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  getLatestFiling,
} from './fcc-client.mjs'
import { readCacheMetadata } from './cache-store.mjs'
import { refreshLocalCacheSnapshot } from './cache-refresh.mjs'
import { enrichRows } from './shared-enrich.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const distDir = path.join(rootDir, 'dist')

const app = express()
const port = Number(process.env.PORT ?? 8787)

app.use(express.json({ limit: '10mb' }))

app.get('/api/cache-status', async (_request, response) => {
  try {
    const [metadata, latestFiling] = await Promise.all([
      readCacheMetadata(),
      getLatestFiling(),
    ])

    const localSnapshot = metadata.localSnapshot
    const updateAvailable =
      !localSnapshot ||
      localSnapshot.processUuid !== latestFiling.process_uuid

    response.json({
      localSnapshot,
      remoteSnapshot: {
        processUuid: latestFiling.process_uuid,
        label: latestFiling.filing_subtype,
        filingType: latestFiling.filing_type,
      },
      checkedAt: new Date().toISOString(),
      updateAvailable,
    })
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Cache status failed',
    })
  }
})

app.post('/api/cache-refresh', async (_request, response) => {
  try {
    const snapshot = await refreshLocalCacheSnapshot()
    response.json({ snapshot })
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Cache refresh failed',
    })
  }
})

app.post('/api/enrich', async (request, response) => {
  const rows = Array.isArray(request.body?.rows) ? request.body.rows : []

  try {
    const latestFiling = await getLatestFiling()
    const results = await enrichRows(rows, latestFiling.process_uuid)

    response.json({ results })
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Enrichment failed',
    })
  }
})

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(distDir))

  app.get('*', (_request, response) => {
    response.sendFile(path.join(distDir, 'index.html'))
  })
}

app.listen(port, () => {
  console.log(`FCC Lookup server listening on http://localhost:${port}`)
})
