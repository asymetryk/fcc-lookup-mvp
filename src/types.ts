export type ImportedRow = {
  id: string
  rowNumber: number
  inputAddress: string
  street?: string
  street2?: string
  city?: string
  state?: string
  zip?: string
}

export type FixedProvider = {
  brandName: string
  holdingCompany: string
  technology: string
  maxDown: number
  maxUp: number
  lowLatency: boolean
}

export type MobileCoverage = {
  technology: string
  minDown: string
  minUp: string
}

export type MobileProvider = {
  brandName: string
  holdingCompany: string
  coverage: MobileCoverage[]
}

export type ResultRow = {
  id: string
  rowNumber: number
  inputAddress: string
  standardizedAddress: string | null
  locationId: string | null
  latitude: number | null
  longitude: number | null
  status: 'completed' | 'not_found'
  manualReview: boolean
  note: string | null
  fixedProviders: FixedProvider[]
  mobileProviders: MobileProvider[]
  summary: {
    fixed: {
      available: boolean
      providerCount: number
      fastestDown: number | null
      fastestUp: number | null
    }
    mobile: {
      available: boolean
      carrierCount: number
      carriers: string[]
    }
  }
}

export type ParsedDataset = {
  rows: ImportedRow[]
}

export type EnrichmentResponse = {
  results: ResultRow[]
}

export type CacheSnapshot = {
  processUuid: string
  label: string
  filingType: string
  refreshedAt: string
  source?: string | null
} | null

export type CacheStatusResponse = {
  localSnapshot: CacheSnapshot
  remoteSnapshot: {
    processUuid: string
    label: string
    filingType: string
  }
  checkedAt: string
  updateAvailable: boolean
}

export type CacheRefreshResponse = {
  snapshot: Exclude<CacheSnapshot, null>
}
