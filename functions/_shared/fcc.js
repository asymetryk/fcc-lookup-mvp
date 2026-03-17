const FCC_BASE_URL = 'https://broadbandmap.fcc.gov/nbm/map/api'

export async function getLatestFiling() {
  const payload = await fetchJson(`${FCC_BASE_URL}/published/filing`)
  return [...payload.data].sort((left, right) => {
    return (
      new Date(right.filing_subtype).getTime() -
      new Date(left.filing_subtype).getTime()
    )
  })[0]
}

export async function searchFabricAddress(filingId, query) {
  return fetchJson(
    `${FCC_BASE_URL}/fabric/address/${filingId}/${encodeURIComponent(query)}`,
  )
}

export async function getFabricDetail(filingId, locationId) {
  return fetchJson(`${FCC_BASE_URL}/fabric/detail/${filingId}/${locationId}`)
}

export async function getMobileDetail(filingId, latitude, longitude) {
  return fetchJson(`${FCC_BASE_URL}/mobile/detail/${filingId}/${latitude}/${longitude}`)
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Origin: 'https://broadbandmap.fcc.gov',
      Referer: 'https://broadbandmap.fcc.gov/home',
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    },
  })

  if (!response.ok) {
    throw new Error(`FCC request failed with status ${response.status}`)
  }

  return response.json()
}
