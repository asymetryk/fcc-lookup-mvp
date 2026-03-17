import { standardizeAddress } from './census-client.mjs'
import {
  getFabricDetail,
  getMobileDetail,
  searchFabricAddress,
} from './fcc-client.mjs'
import { getFixedProvidersFromCache } from './fixed-cache.mjs'

export async function enrichRows(rows, filingId) {
  const results = []

  for (const row of rows) {
    results.push(await enrichRow(row, filingId))
  }

  return results
}

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
    let fixedProviders = []

    try {
      const detailPayload = await getFabricDetail(filingId, bestMatch.location_id)
      detail = detailPayload.data?.[0] ?? null
    } catch (detailError) {
      fixedNote =
        detailError instanceof Error
          ? `Fixed provider detail is currently blocked by the FCC endpoint: ${detailError.message}`
          : 'Fixed provider detail is currently blocked by the FCC endpoint.'

      fixedProviders = await getFixedProvidersFromCache({
        filingId,
        stateAbbr: bestMatch.state ?? standardized?.state ?? null,
        cacheKey:
          standardized?.censusBlock && standardized?.h3Res8
            ? `geo:${standardized.censusBlock}:${standardized.h3Res8}`
            : String(bestMatch.location_id),
        numericLocationIds: [],
        blockGeoid: standardized?.censusBlock ?? null,
        h3Res8: standardized?.h3Res8 ?? null,
      })

      if (fixedProviders.length) {
        fixedNote =
          fixedProviders.some((provider) => provider.source === 'fcc_download_cache_geography')
            ? 'Fixed provider detail was inferred from the downloaded FCC cache using the matched Census block and H3 cell because the live FCC detail endpoint rejected the request.'
            : 'Fixed provider detail was loaded from the downloaded FCC cache because the live FCC detail endpoint rejected the request.'
      }
    }

    const longitude = detail?.coordinates?.[0] ?? standardized?.coordinates?.x ?? null
    const latitude = detail?.coordinates?.[1] ?? standardized?.coordinates?.y ?? null
    const mobilePayload =
      latitude != null && longitude != null
        ? await getMobileDetail(filingId, latitude, longitude)
        : { data: [] }

    if (!fixedProviders.length) {
      fixedProviders = (detail?.detail ?? []).map((provider) => ({
        brandName: provider.brand_name,
        holdingCompany: provider.holding_company_name,
        technology: provider.technology_code_type,
        maxDown: provider.maxdown,
        maxUp: provider.maxup,
        lowLatency: Boolean(provider.lowlatency),
        source: 'fcc_live_api',
      }))
    }

    const mobileProviders = groupMobileProviders(mobilePayload.data ?? [])
    const addressChanged = needsManualReview(row, bestMatch, standardized)
    const manualReview = addressChanged || (Boolean(fixedNote) && !fixedProviders.length)

    return {
      id: row.id,
      rowNumber: row.rowNumber,
      inputAddress: row.inputAddress,
      standardizedAddress:
        bestMatch.addr_full ?? standardized?.matchedAddress ?? row.inputAddress,
      locationId: bestMatch.location_id,
      latitude: latitude ?? null,
      longitude: longitude ?? null,
      status: 'completed',
      manualReview,
      note: buildSuccessNote({ addressChanged, fixedNote }),
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

function buildSuccessNote({ addressChanged, fixedNote }) {
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
