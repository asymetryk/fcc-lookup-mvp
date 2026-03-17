const CENSUS_BASE_URL =
  'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress'

export async function standardizeAddress(row) {
  const query = buildQuery(row)
  if (!query) {
    return null
  }

  const url = new URL(CENSUS_BASE_URL)
  url.searchParams.set('address', query)
  url.searchParams.set('benchmark', 'Public_AR_Current')
  url.searchParams.set('format', 'json')

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'FCC Lookup MVP',
    },
  })

  if (!response.ok) {
    throw new Error(`Census request failed with status ${response.status}`)
  }

  const payload = await response.json()
  const match = payload.result?.addressMatches?.[0]

  if (!match) {
    return null
  }

  const components = match.addressComponents ?? {}
  return {
    matchedAddress: match.matchedAddress,
    street: components.streetName
      ? `${components.fromAddress ?? ''} ${components.streetName} ${components.streetSuffix ?? ''}`.replace(/\s+/g, ' ').trim()
      : null,
    city: components.city ?? null,
    state: components.state ?? null,
    zip: components.zip ?? null,
    coordinates: match.coordinates
      ? {
          x: match.coordinates.x,
          y: match.coordinates.y,
        }
      : null,
  }
}

function buildQuery(row) {
  return [row.street, row.street2, row.city, row.state, row.zip, row.inputAddress]
    .filter(Boolean)
    .join(', ')
}
