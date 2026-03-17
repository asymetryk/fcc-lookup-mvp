import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const dataDir = path.join(rootDir, 'data')
const cacheMetadataPath = path.join(dataDir, 'fcc-cache-metadata.json')
const cacheMetadataModulePath = path.join(dataDir, 'fcc-cache-metadata.mjs')

const emptyMetadata = {
  localSnapshot: null,
}

export async function readCacheMetadata() {
  try {
    const raw = await fs.readFile(cacheMetadataPath, 'utf8')
    const parsed = JSON.parse(raw)
    return {
      ...emptyMetadata,
      ...parsed,
    }
  } catch (error) {
    if (isMissingFile(error)) {
      await ensureCacheMetadataFile()
      return emptyMetadata
    }

    throw error
  }
}

export async function writeCacheMetadata(metadata) {
  await fs.mkdir(dataDir, { recursive: true })
  await fs.writeFile(
    cacheMetadataPath,
    JSON.stringify(metadata, null, 2),
    'utf8',
  )
  await fs.writeFile(
    cacheMetadataModulePath,
    `export default ${JSON.stringify(metadata, null, 2)}\n`,
    'utf8',
  )
}

async function ensureCacheMetadataFile() {
  await fs.mkdir(dataDir, { recursive: true })
  await fs.writeFile(
    cacheMetadataPath,
    JSON.stringify(emptyMetadata, null, 2),
    'utf8',
  )
  await fs.writeFile(
    cacheMetadataModulePath,
    `export default ${JSON.stringify(emptyMetadata, null, 2)}\n`,
    'utf8',
  )
}

function isMissingFile(error) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
