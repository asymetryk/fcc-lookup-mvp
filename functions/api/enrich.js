import { getLatestFiling } from '../_shared/fcc.js'
import { enrichRows } from '../_shared/enrich.js'

export async function onRequestPost(context) {
  try {
    const body = await context.request.json()
    const rows = Array.isArray(body?.rows) ? body.rows : []

    if (context.env.PROXY_BASE_URL && context.env.PROXY_SHARED_SECRET) {
      const proxyResponse = await fetch(
        `${context.env.PROXY_BASE_URL}/api/enrich`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-fcc-proxy-secret': context.env.PROXY_SHARED_SECRET,
          },
          body: JSON.stringify({ rows }),
        },
      )

      return new Response(await proxyResponse.text(), {
        status: proxyResponse.status,
        headers: {
          'content-type':
            proxyResponse.headers.get('content-type') ?? 'application/json',
        },
      })
    }

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
