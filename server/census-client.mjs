import { latLngToCell } from 'h3-js'

const CENSUS_BASE_URL =
  'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress'
const CENSUS_GEOGRAPHIES_URL =
  'https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress'

export async function standardizeAddress(row) {
  const query = buildQuery(row)
  if (!query) {
    return null
  }

  const payload = await fetchCensusJson(CENSUS_BASE_URL, query)
  const match = payload.result?.addressMatches?.[0]

  if (!match) {
    return null
  }

  const geographyPayload = await fetchCensusJson(CENSUS_GEOGRAPHIES_URL, query, {
    vintage: 'Current_Current',
  })
  const geographyMatch = geographyPayload.result?.addressMatches?.[0]
  const censusBlock = geographyMatch?.geographies?.['2020 Census Blocks']?.[0]?.GEOID ?? null

  const components = match.addressComponents ?? {}
  const coordinates = match.coordinates
    ? {
        x: match.coordinates.x,
        y: match.coordinates.y,
      }
    : null

  return {
    matchedAddress: match.matchedAddress,
    street: components.streetName
      ? `${components.fromAddress ?? ''} ${components.streetName} ${components.streetSuffix ?? ''}`.replace(/\s+/g, ' ').trim()
      : null,
    city: components.city ?? null,
    state: components.state ?? null,
    zip: components.zip ?? null,
    coordinates,
    censusBlock,
    h3Res8:
      coordinates != null
        ? latLngToCell(coordinates.y, coordinates.x, 8)
        : null,
  }
}

async function fetchCensusJson(baseUrl, query, extraParams = {}) {
  const url = new URL(baseUrl)
  url.searchParams.set('address', query)
  url.searchParams.set('benchmark', 'Public_AR_Current')
  url.searchParams.set('format', 'json')

  for (const [key, value] of Object.entries(extraParams)) {
    url.searchParams.set(key, value)
  }

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'FCC Lookup MVP',
    },
  })

  if (!response.ok) {
    throw new Error(`Census request failed with status ${response.status}`)
  }

  return response.json()
}

function buildQuery(row) {
  return [row.street, row.street2, row.city, row.state, row.zip, row.inputAddress]
    .filter(Boolean)
    .join(', ')
}
