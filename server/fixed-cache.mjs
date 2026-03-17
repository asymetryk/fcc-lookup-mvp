import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import unzipper from 'unzipper'
import { parse } from 'csv-parse'
import { readCacheMetadata } from './cache-store.mjs'
import {
  downloadFccFile,
  getDownloadManifest,
} from './fcc-client.mjs'
import { refreshLocalCacheSnapshot } from './cache-refresh.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const cacheDir = path.join(rootDir, 'data', 'cache')

const stateAbbrToFips = {
  AL: '01', AK: '02', AZ: '04', AR: '05', CA: '06', CO: '08', CT: '09', DE: '10',
  DC: '11', FL: '12', GA: '13', HI: '15', ID: '16', IL: '17', IN: '18', IA: '19',
  KS: '20', KY: '21', LA: '22', ME: '23', MD: '24', MA: '25', MI: '26', MN: '27',
  MS: '28', MO: '29', MT: '30', NE: '31', NV: '32', NH: '33', NJ: '34', NM: '35',
  NY: '36', NC: '37', ND: '38', OH: '39', OK: '40', OR: '41', PA: '42', RI: '44',
  SC: '45', SD: '46', TN: '47', TX: '48', UT: '49', VT: '50', VA: '51', WA: '53',
  WV: '54', WI: '55', WY: '56', PR: '72',
}

const technologyLabels = {
  '10': 'Copper',
  '40': 'Cable',
  '50': 'Fiber to the Premises',
  '60': 'GSO Satellite',
  '61': 'NGSO Satellite',
  '70': 'Unlicensed Fixed Wireless',
  '71': 'Licensed Fixed Wireless',
}

let providerListCache = null
const manifestCache = new Map()

export async function getFixedProvidersFromCache({
  filingId,
  stateAbbr,
  cacheKey,
  numericLocationIds = [],
  blockGeoid = null,
  h3Res8 = null,
}) {
  if (!stateAbbr || !cacheKey) {
    return []
  }

  const stateFips = stateAbbrToFips[stateAbbr.toUpperCase()]
  if (!stateFips) {
    return []
  }

  const snapshot = await ensureLocalSnapshot(filingId)
  const manifest = await readSnapshotManifest(snapshot.processUuid)
  const providerLookup = await readProviderList(snapshot.processUuid)
  const locationCache = await readLocationCache(snapshot.processUuid, stateFips)
  if (!(cacheKey in locationCache)) {
    const providerFiles = manifest.data.filter(
      (row) =>
        row.data_category === 'Provider' &&
        row.data_type === 'Fixed Broadband' &&
        row.state_fips === stateFips &&
        row.download_available === 'Yes',
    )

    const collected = await scanProviderFilesForKey({
      snapshotProcessUuid: snapshot.processUuid,
      providerFiles,
      providerLookup,
      numericLocationIds: new Set(numericLocationIds.map(String)),
      blockGeoid,
      h3Res8,
    })

    locationCache[cacheKey] = collected
    await writeLocationCache(snapshot.processUuid, stateFips, locationCache)
  }

  return locationCache[cacheKey] ?? []
}

async function ensureLocalSnapshot(filingId) {
  const metadata = await readCacheMetadata()
  const localSnapshot = metadata.localSnapshot
  const manifestPath = localSnapshot
    ? path.join(cacheDir, localSnapshot.processUuid, 'manifest.json')
    : null

  if (
    !localSnapshot ||
    localSnapshot.processUuid !== filingId ||
    !(await pathExists(manifestPath))
  ) {
    return refreshLocalCacheSnapshot()
  }

  return localSnapshot
}

async function readSnapshotManifest(processUuid) {
  if (manifestCache.has(processUuid)) {
    return manifestCache.get(processUuid)
  }

  const manifestPath = path.join(cacheDir, processUuid, 'manifest.json')
  if (!(await pathExists(manifestPath))) {
    const manifest = await getDownloadManifest(processUuid)
    await fs.mkdir(path.dirname(manifestPath), { recursive: true })
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
    manifestCache.set(processUuid, manifest)
    return manifest
  }

  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  manifestCache.set(processUuid, manifest)
  return manifest
}

async function readProviderList(processUuid) {
  if (providerListCache?.processUuid === processUuid) {
    return providerListCache.lookup
  }

  const providerZipPath = await ensureProviderListZip(processUuid)
  const lookup = new Map()

  const directory = await unzipper.Open.file(providerZipPath)
  const entry = directory.files[0]
  if (!entry) {
    throw new Error('Provider list ZIP did not contain a CSV file.')
  }

  await new Promise((resolve, reject) => {
    entry
      .stream()
      .pipe(parse({ columns: true, trim: true }))
      .on('data', (row) => {
        lookup.set(String(row.provider_id), row.holding_company ?? null)
      })
      .on('end', resolve)
      .on('error', reject)
  })

  providerListCache = {
    processUuid,
    lookup,
  }

  return lookup
}

async function ensureProviderListZip(processUuid) {
  const manifest = await readSnapshotManifest(processUuid)
  const providerList = manifest.data.find(
    (row) => row.data_category === 'Nationwide' && row.data_type === 'Provider List',
  )

  if (!providerList) {
    throw new Error('The FCC provider list file was not found in the snapshot manifest.')
  }

  return ensureDownloadedFile(processUuid, providerList)
}

async function ensureDownloadedFile(processUuid, manifestRow) {
  const snapshotDir = path.join(cacheDir, processUuid)
  const filePath = path.join(snapshotDir, `${manifestRow.file_name}.zip`)

  if (await pathExists(filePath)) {
    return filePath
  }

  await fs.mkdir(snapshotDir, { recursive: true })
  const fileBuffer = await downloadFccFile(manifestRow.id)
  await fs.writeFile(filePath, fileBuffer)
  return filePath
}

async function scanProviderFilesForKey({
  snapshotProcessUuid,
  providerFiles,
  providerLookup,
  numericLocationIds,
  blockGeoid,
  h3Res8,
}) {
  const collected = []

  for (const providerFile of providerFiles) {
    const zipPath = await ensureDownloadedFile(snapshotProcessUuid, providerFile)
    await scanProviderZip({
      zipPath,
      numericLocationIds,
      blockGeoid,
      h3Res8,
      collected,
      providerLookup,
    })
  }

  collected.sort((left, right) => {
    return (
      String(left.brandName).localeCompare(String(right.brandName)) ||
      Number(right.maxDown ?? 0) - Number(left.maxDown ?? 0) ||
      Number(right.maxUp ?? 0) - Number(left.maxUp ?? 0)
    )
  })

  return collected
}

async function scanProviderZip({
  zipPath,
  numericLocationIds,
  blockGeoid,
  h3Res8,
  collected,
  providerLookup,
}) {
  const directory = await unzipper.Open.file(zipPath)
  const entry = directory.files.find((file) => file.path.endsWith('.csv'))
  if (!entry) {
    return
  }

  const parser = parse({ columns: true, trim: true })
  const stream = entry.stream().pipe(parser)

  for await (const row of stream) {
    const matchesNumericLocation =
      numericLocationIds.size > 0 && numericLocationIds.has(String(row.location_id))
    const matchesGeography =
      blockGeoid &&
      row.block_geoid === blockGeoid &&
      (!h3Res8 || String(row.h3_res8_id).toLowerCase() === String(h3Res8).toLowerCase())

    if (!matchesNumericLocation && !matchesGeography) {
      continue
    }

    const providerRecord = {
      brandName: row.brand_name,
      holdingCompany: providerLookup.get(String(row.provider_id)) ?? null,
      technology: technologyLabels[String(row.technology)] ?? `Technology ${row.technology}`,
      maxDown: toNumber(row.max_advertised_download_speed),
      maxUp: toNumber(row.max_advertised_upload_speed),
      lowLatency: row.low_latency === '1',
      businessResidentialCode: row.business_residential_code || null,
      source: matchesNumericLocation
        ? 'fcc_download_cache'
        : 'fcc_download_cache_geography',
    }

    if (!hasProviderRecord(collected, providerRecord)) {
      collected.push(providerRecord)
    }
  }
}

async function readLocationCache(processUuid, stateFips) {
  const cachePath = getLocationCachePath(processUuid, stateFips)
  if (!(await pathExists(cachePath))) {
    return {}
  }

  return JSON.parse(await fs.readFile(cachePath, 'utf8'))
}

async function writeLocationCache(processUuid, stateFips, payload) {
  const cachePath = getLocationCachePath(processUuid, stateFips)
  await fs.mkdir(path.dirname(cachePath), { recursive: true })
  await fs.writeFile(cachePath, JSON.stringify(payload), 'utf8')
}

function getLocationCachePath(processUuid, stateFips) {
  return path.join(
    cacheDir,
    processUuid,
    'fixed-location-cache',
    `${stateFips}.json`,
  )
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

function toNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function hasProviderRecord(records, candidate) {
  return records.some((record) => {
    return (
      record.brandName === candidate.brandName &&
      record.technology === candidate.technology &&
      record.maxDown === candidate.maxDown &&
      record.maxUp === candidate.maxUp &&
      record.businessResidentialCode === candidate.businessResidentialCode
    )
  })
}
