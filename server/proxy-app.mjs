import express from 'express'
import {
  getLatestFiling,
  getLatestFilingId,
} from './fcc-client.mjs'
import { enrichRows } from './shared-enrich.mjs'

export function createProxyApp() {
  const app = express()
  const sharedSecret = process.env.PROXY_SHARED_SECRET

  app.use(express.json({ limit: '10mb' }))
  app.use((request, response, next) => {
    if (!sharedSecret) {
      response.status(500).json({ error: 'PROXY_SHARED_SECRET is not configured.' })
      return
    }

    const providedSecret = request.get('x-fcc-proxy-secret')

    if (providedSecret !== sharedSecret) {
      response.status(401).json({ error: 'Unauthorized' })
      return
    }

    next()
  })

  app.get('/health', (_request, response) => {
    response.json({ ok: true, checkedAt: new Date().toISOString() })
  })

  app.get('/api/cache-status', async (_request, response) => {
    try {
      const latestFiling = await getLatestFiling()
      response.json({
        localSnapshot: null,
        remoteSnapshot: {
          processUuid: latestFiling.process_uuid,
          label: latestFiling.filing_subtype,
          filingType: latestFiling.filing_type,
        },
        checkedAt: new Date().toISOString(),
        updateAvailable: false,
      })
    } catch (error) {
      response.status(500).json({
        error: error instanceof Error ? error.message : 'Cache status failed',
      })
    }
  })

  app.post('/api/enrich', async (request, response) => {
    try {
      const rows = Array.isArray(request.body?.rows) ? request.body.rows : []
      const filingId = await getLatestFilingId()
      const results = await enrichRows(rows, filingId)
      response.json({ results })
    } catch (error) {
      response.status(500).json({
        error: error instanceof Error ? error.message : 'Enrichment failed',
      })
    }
  })

  return app
}
