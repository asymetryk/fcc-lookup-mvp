import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  downloadFccFile,
  getDownloadManifest,
  getLatestFiling,
} from './fcc-client.mjs'
import { writeCacheMetadata } from './cache-store.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const cacheDir = path.join(rootDir, 'data', 'cache')

export async function refreshLocalCacheSnapshot() {
  const latestFiling = await getLatestFiling()
  const manifestPayload = await getDownloadManifest(latestFiling.process_uuid)
  const providerList = manifestPayload.data.find(
    (row) =>
      row.data_category === 'Nationwide' &&
      row.data_type === 'Provider List',
  )

  if (!providerList) {
    throw new Error(
      'The FCC provider list file was not found in the latest download manifest.',
    )
  }

  const snapshotDir = path.join(cacheDir, latestFiling.process_uuid)
  await fs.mkdir(snapshotDir, { recursive: true })

  await fs.writeFile(
    path.join(snapshotDir, 'manifest.json'),
    JSON.stringify(manifestPayload, null, 2),
    'utf8',
  )

  const providerZip = await downloadFccFile(providerList.id)
  await fs.writeFile(
    path.join(snapshotDir, `${providerList.file_name}.zip`),
    providerZip,
  )

  const snapshot = {
    processUuid: latestFiling.process_uuid,
    label: latestFiling.filing_subtype,
    filingType: latestFiling.filing_type,
    refreshedAt: new Date().toISOString(),
    source: 'manifest+provider-list',
  }

  await writeCacheMetadata({
    localSnapshot: snapshot,
  })

  return snapshot
}
