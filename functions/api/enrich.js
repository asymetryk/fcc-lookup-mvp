import { getLatestFiling } from '../_shared/fcc.js'
import { enrichRows } from '../_shared/enrich.js'

export async function onRequestPost(context) {
  try {
    const body = await context.request.json()
    const rows = Array.isArray(body?.rows) ? body.rows : []
    const latestFiling = await getLatestFiling()
    const results = await enrichRows(rows, latestFiling.process_uuid)

    return Response.json({ results })
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : 'Enrichment failed',
      },
      { status: 500 },
    )
  }
}
