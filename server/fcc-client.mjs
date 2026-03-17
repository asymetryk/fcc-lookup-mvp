const FCC_BASE_URL = 'https://broadbandmap.fcc.gov/nbm/map/api'

let filingCache = null

export async function getLatestFiling() {
  if (filingCache) {
    return filingCache
  }

  const payload = await fetchJson(`${FCC_BASE_URL}/published/filing`)
  const latest = [...payload.data].sort((left, right) => {
    return new Date(right.filing_subtype).getTime() - new Date(left.filing_subtype).getTime()
  })[0]

  filingCache = latest
  return filingCache
}

export async function getLatestFilingId() {
  const latest = await getLatestFiling()
  return latest.process_uuid
}

export async function searchFabricAddress(filingId, query) {
  return fetchJson(
    `${FCC_BASE_URL}/fabric/address/${filingId}/${encodeURIComponent(query)}`,
  )
}

export async function getDownloadManifest(filingId) {
  return fetchJsonWithReferer(
    `${FCC_BASE_URL}/national_map_process/nbm_get_data_download/${filingId}/`,
    'https://broadbandmap.fcc.gov/data-download/nationwide-data?version=jun2025&pubDataVer=jun2025',
  )
}

export async function downloadFccFile(fileId) {
  const response = await fetch(
    `${FCC_BASE_URL}/getNBMDataDownloadFile/${fileId}/1`,
    {
      headers: buildHeaders(
        'https://broadbandmap.fcc.gov/data-download/nationwide-data?version=jun2025&pubDataVer=jun2025',
      ),
    },
  )

  if (!response.ok) {
    throw new Error(`FCC download failed with status ${response.status}`)
  }

  return Buffer.from(await response.arrayBuffer())
}

export async function getFabricDetail(filingId, locationId) {
  return fetchJson(`${FCC_BASE_URL}/fabric/detail/${filingId}/${locationId}`)
}

export async function getMobileDetail(filingId, latitude, longitude) {
  return fetchJson(`${FCC_BASE_URL}/mobile/detail/${filingId}/${latitude}/${longitude}`)
}

async function fetchJson(url) {
  return fetchJsonWithReferer(url, 'https://broadbandmap.fcc.gov/home')
}

async function fetchJsonWithReferer(url, referer) {
  const response = await fetch(url, {
    headers: buildHeaders(referer),
  })

  if (!response.ok) {
    throw new Error(`FCC request failed with status ${response.status}`)
  }

  return response.json()
}

function buildHeaders(referer) {
  return {
    Accept: 'application/json',
    Origin: 'https://broadbandmap.fcc.gov',
    Referer: referer,
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  }
}
