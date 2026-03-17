import metadata from '../../data/fcc-cache-metadata.mjs'
import { getLatestFiling } from '../_shared/fcc.js'

export async function onRequestGet() {
  try {
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
