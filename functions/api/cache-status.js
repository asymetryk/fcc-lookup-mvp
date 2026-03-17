import metadata from '../../data/fcc-cache-metadata.mjs'
import { getLatestFiling } from '../_shared/fcc.js'

export async function onRequestGet(context) {
  try {
    if (context.env.PROXY_BASE_URL && context.env.PROXY_SHARED_SECRET) {
      const proxyResponse = await fetch(
        `${context.env.PROXY_BASE_URL}/api/cache-status`,
        {
          headers: {
            'x-fcc-proxy-secret': context.env.PROXY_SHARED_SECRET,
          },
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
    const localSnapshot = metadata.localSnapshot ?? null

    return Response.json({
      localSnapshot,
      remoteSnapshot: {
        processUuid: latestFiling.process_uuid,
        label: latestFiling.filing_subtype,
        filingType: latestFiling.filing_type,
      },
      checkedAt: new Date().toISOString(),
      updateAvailable:
        !localSnapshot || localSnapshot.processUuid !== latestFiling.process_uuid,
    })
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : 'Cache status failed',
      },
      { status: 500 },
    )
  }
}
