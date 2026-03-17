import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  getMobileDetail,
  getFabricDetail,
  getLatestFiling,
  getLatestFilingId,
  searchFabricAddress,
} from './fcc-client.mjs'
import { standardizeAddress } from './census-client.mjs'
import { readCacheMetadata } from './cache-store.mjs'
import { refreshLocalCacheSnapshot } from './cache-refresh.mjs'

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
    const filingId = await getLatestFilingId()
    const results = []

    for (const row of rows) {
      results.push(await enrichRow(row, filingId))
    }

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

async function enrichRow(row, filingId) {
  try {
    const standardized = await standardizeAddress(row)
    const searchQuery = standardized?.matchedAddress ?? row.inputAddress
    const addressSearch = await searchFabricAddress(filingId, searchQuery)
    const bestMatch = pickBestMatch(addressSearch.data ?? [], standardized)

    if (!bestMatch) {
      return buildMissingResult(
        row,
        standardized?.matchedAddress ?? null,
        standardized
          ? 'Address standardized, but no FCC fabric match was returned.'
          : 'Address could not be standardized or matched.',
      )
    }

    let detail = null
    let fixedNote = null

    try {
      const detailPayload = await getFabricDetail(filingId, bestMatch.location_id)
      detail = detailPayload.data?.[0] ?? null
    } catch (detailError) {
      fixedNote =
        detailError instanceof Error
          ? `Fixed provider detail is currently blocked by the FCC endpoint: ${detailError.message}`
          : 'Fixed provider detail is currently blocked by the FCC endpoint.'
    }

    const longitude = detail?.coordinates?.[0] ?? standardized?.coordinates?.x ?? null
    const latitude = detail?.coordinates?.[1] ?? standardized?.coordinates?.y ?? null
    const mobilePayload =
      latitude != null && longitude != null
        ? await getMobileDetail(filingId, latitude, longitude)
        : { data: [] }

    const fixedProviders = (detail?.detail ?? []).map((provider) => ({
      brandName: provider.brand_name,
      holdingCompany: provider.holding_company_name,
      technology: provider.technology_code_type,
      maxDown: provider.maxdown,
      maxUp: provider.maxup,
      lowLatency: Boolean(provider.lowlatency),
    }))

    const mobileProviders = groupMobileProviders(mobilePayload.data ?? [])
    const manualReview = needsManualReview(row, bestMatch, standardized) || Boolean(fixedNote)

    return {
      id: row.id,
      rowNumber: row.rowNumber,
      inputAddress: row.inputAddress,
      standardizedAddress:
        bestMatch.addr_full ??
        standardized?.matchedAddress ??
        row.inputAddress,
      locationId: bestMatch.location_id,
      latitude: latitude ?? null,
      longitude: longitude ?? null,
      status: 'completed',
      manualReview,
      note: buildSuccessNote({
        addressChanged: needsManualReview(row, bestMatch, standardized),
        fixedNote,
      }),
      fixedProviders,
      mobileProviders,
      summary: {
        fixed: {
          available: fixedProviders.length > 0,
          providerCount: fixedProviders.length,
          fastestDown: fixedProviders.length
            ? Math.max(...fixedProviders.map((provider) => provider.maxDown))
            : null,
          fastestUp: fixedProviders.length
            ? Math.max(...fixedProviders.map((provider) => provider.maxUp))
            : null,
        },
        mobile: {
          available: mobileProviders.length > 0,
          carrierCount: mobileProviders.length,
          carriers: mobileProviders.map((provider) => provider.brandName),
        },
      },
    }
  } catch (error) {
    return buildMissingResult(
      row,
      null,
      error instanceof Error ? error.message : 'Lookup failed.',
    )
  }
}

function pickBestMatch(matches, standardized) {
  if (!matches.length) {
    return null
  }

  if (!standardized) {
    return matches[0]
  }

  return (
    matches.find(
      (match) =>
        match.city === standardized.city &&
        match.state === standardized.state &&
        match.zip_code === standardized.zip,
    ) ?? matches[0]
  )
}

function needsManualReview(row, match, standardized) {
  const normalizedInput = normalizeAddressString(row.inputAddress)
  const normalizedMatch = normalizeAddressString(match.addr_full ?? '')
  const normalizedStandardized = normalizeAddressString(standardized?.matchedAddress ?? '')

  return (
    normalizedInput !== normalizedMatch ||
    (normalizedStandardized && normalizedStandardized !== normalizedMatch)
  )
}

function normalizeAddressString(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function buildSuccessNote({
  addressChanged,
  fixedNote,
}) {
  const notes = []

  if (addressChanged) {
    notes.push(
      'The address was matched, but the standardized result differs from the original enough to merit a human review.',
    )
  }

  if (fixedNote) {
    notes.push(fixedNote)
  }

  return notes.length ? notes.join(' ') : null
}

function buildMissingResult(row, standardizedAddress, note) {
  return {
    id: row.id,
    rowNumber: row.rowNumber,
    inputAddress: row.inputAddress,
    standardizedAddress,
    locationId: null,
    latitude: null,
    longitude: null,
    status: 'not_found',
    manualReview: true,
    note,
    fixedProviders: [],
    mobileProviders: [],
    summary: {
      fixed: {
        available: false,
        providerCount: 0,
        fastestDown: null,
        fastestUp: null,
      },
      mobile: {
        available: false,
        carrierCount: 0,
        carriers: [],
      },
    },
  }
}

function groupMobileProviders(records) {
  const providers = new Map()

  for (const record of records) {
    if (!providers.has(record.brandname)) {
      providers.set(record.brandname, {
        brandName: record.brandname,
        holdingCompany: record.holding_company,
        coverage: [],
      })
    }

    const provider = providers.get(record.brandname)
    const signature = `${record.technology_type}-${record.mindown}-${record.minup}`

    if (!provider.coverage.some((coverage) => coverage.signature === signature)) {
      provider.coverage.push({
        signature,
        technology: record.technology_type,
        minDown: record.mindown,
        minUp: record.minup,
      })
    }
  }

  return [...providers.values()].map((provider) => ({
    brandName: provider.brandName,
    holdingCompany: provider.holdingCompany,
    coverage: provider.coverage.map(({ signature, ...coverage }) => coverage),
  }))
}
