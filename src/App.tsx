import { useEffect, useMemo, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import * as XLSX from 'xlsx'
import { cn } from './lib/cn'
import type {
  CacheRefreshResponse,
  CacheStatusResponse,
  EnrichmentResponse,
  ImportedRow,
  ParsedDataset,
  ResultRow,
} from './types'

const acceptedFileTypes = '.csv,.xlsx,.xls'

function App() {
  const canRefreshCache =
    typeof window !== 'undefined' &&
    ['localhost', '127.0.0.1'].includes(window.location.hostname)
  const [dataset, setDataset] = useState<ParsedDataset | null>(null)
  const [pasteValue, setPasteValue] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<ResultRow[]>([])
  const [cacheStatus, setCacheStatus] = useState<CacheStatusResponse | null>(null)
  const [cacheStatusError, setCacheStatusError] = useState<string | null>(null)
  const [isRefreshingCache, setIsRefreshingCache] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function loadCacheStatus() {
      try {
        setCacheStatusError(null)
        const response = await fetch('/api/cache-status')

        if (!response.ok) {
          throw new Error('The FCC cache status could not be loaded.')
        }

        const payload = (await response.json()) as CacheStatusResponse

        if (!cancelled) {
          setCacheStatus(payload)
        }
      } catch (statusError) {
        if (!cancelled) {
          setCacheStatusError(
            statusError instanceof Error
              ? statusError.message
              : 'The FCC cache status could not be loaded.',
          )
        }
      }
    }

    void loadCacheStatus()

    return () => {
      cancelled = true
    }
  }, [])

  async function loadCacheStatus() {
    try {
      setCacheStatusError(null)
      const response = await fetch('/api/cache-status')

      if (!response.ok) {
        throw new Error('The FCC cache status could not be loaded.')
      }

      const payload = (await response.json()) as CacheStatusResponse
      setCacheStatus(payload)
    } catch (statusError) {
      setCacheStatusError(
        statusError instanceof Error
          ? statusError.message
          : 'The FCC cache status could not be loaded.',
      )
    }
  }

  async function refreshCache() {
    try {
      setCacheStatusError(null)
      setIsRefreshingCache(true)
      const response = await fetch('/api/cache-refresh', { method: 'POST' })

      if (!response.ok) {
        throw new Error('The FCC cache refresh failed.')
      }

      const payload = (await response.json()) as CacheRefreshResponse
      setCacheStatus((current) =>
        current
          ? {
              ...current,
              localSnapshot: payload.snapshot,
              checkedAt: new Date().toISOString(),
              updateAvailable:
                payload.snapshot.processUuid !== current.remoteSnapshot.processUuid,
            }
          : current,
      )
      await loadCacheStatus()
    } catch (refreshError) {
      setCacheStatusError(
        refreshError instanceof Error
          ? refreshError.message
          : 'The FCC cache refresh failed.',
      )
    } finally {
      setIsRefreshingCache(false)
    }
  }

  const manualReviewCount = useMemo(
    () => results.filter((row) => row.manualReview).length,
    [results],
  )

  const successfulCount = useMemo(
    () => results.filter((row) => row.status === 'completed').length,
    [results],
  )

  async function handleFileUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      setError(null)
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
        header: 1,
        blankrows: false,
        defval: '',
      })
      const nextDataset = parseMatrix(rows)
      setDataset(nextDataset)
      setResults([])
    } catch (fileError) {
      setError(
        fileError instanceof Error
          ? fileError.message
          : 'The file could not be read.',
      )
    } finally {
      event.target.value = ''
    }
  }

  function handlePasteImport() {
    try {
      setError(null)
      const nextDataset = parseDelimitedText(pasteValue)
      setDataset(nextDataset)
      setResults([])
    } catch (pasteError) {
      setError(
        pasteError instanceof Error
          ? pasteError.message
          : 'The pasted data could not be parsed.',
      )
    }
  }

  async function runLookup() {
    if (!dataset?.rows.length) return

    try {
      setError(null)
      setIsRunning(true)
      const response = await fetch('/api/enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: dataset.rows }),
      })

      if (!response.ok) {
        throw new Error('The lookup request failed.')
      }

      const payload = (await response.json()) as EnrichmentResponse
      setResults(payload.results)
    } catch (lookupError) {
      setError(
        lookupError instanceof Error
          ? lookupError.message
          : 'The lookup request failed.',
      )
    } finally {
      setIsRunning(false)
    }
  }

  function exportSummaryCsv() {
    if (!results.length) return

    const rows = results.map((row) => ({
      source_row: row.rowNumber,
      input_address: row.inputAddress,
      standardized_address: row.standardizedAddress ?? '',
      status: row.status,
      manual_review: row.manualReview ? 'Yes' : 'No',
      note: row.note ?? '',
      location_id: row.locationId ?? '',
      latitude: row.latitude ?? '',
      longitude: row.longitude ?? '',
      fixed_available: row.summary.fixed.available ? 'Yes' : 'No',
      fixed_provider_count: row.summary.fixed.providerCount,
      fastest_fixed_download_mbps: row.summary.fixed.fastestDown ?? '',
      fastest_fixed_upload_mbps: row.summary.fixed.fastestUp ?? '',
      mobile_available: row.summary.mobile.available ? 'Yes' : 'No',
      mobile_carrier_count: row.summary.mobile.carrierCount,
      mobile_carriers: row.summary.mobile.carriers.join('; '),
    }))

    downloadWorksheet(rows, 'fcc-lookup-summary.csv')
  }

  function exportDetailCsv() {
    if (!results.length) return

    const detailRows = results.flatMap((row) => {
      const fixedRows = row.fixedProviders.map((provider) => ({
        source_row: row.rowNumber,
        standardized_address: row.standardizedAddress ?? '',
        service_type: 'fixed',
        provider: provider.brandName,
        holding_company: provider.holdingCompany,
        technology: provider.technology,
        download_mbps: provider.maxDown,
        upload_mbps: provider.maxUp,
        low_latency: provider.lowLatency ? 'Yes' : 'No',
      }))

      const mobileRows = row.mobileProviders.flatMap((provider) =>
        provider.coverage.map((coverage) => ({
          source_row: row.rowNumber,
          standardized_address: row.standardizedAddress ?? '',
          service_type: 'mobile',
          provider: provider.brandName,
          holding_company: provider.holdingCompany,
          technology: coverage.technology,
          download_mbps: coverage.minDown,
          upload_mbps: coverage.minUp,
          low_latency: '',
        })),
      )

      if (!fixedRows.length && !mobileRows.length) {
        return [
          {
            source_row: row.rowNumber,
            standardized_address: row.standardizedAddress ?? '',
            service_type: '',
            provider: '',
            holding_company: '',
            technology: '',
            download_mbps: '',
            upload_mbps: '',
            low_latency: '',
          },
        ]
      }

      return [...fixedRows, ...mobileRows]
    })

    downloadWorksheet(detailRows, 'fcc-lookup-detail.csv')
  }

  return (
    <main className="min-h-dvh bg-stone-100 text-stone-900">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8">
        <section className="overflow-hidden rounded-[2rem] border border-stone-300 bg-stone-950 text-stone-50 shadow-sm">
          <div className="grid gap-8 px-6 py-8 sm:px-8 lg:grid-cols-[1.2fr_0.8fr] lg:px-10 lg:py-10">
            <div className="space-y-5">
              <p className="text-sm font-medium uppercase text-amber-300">
                FCC lookup MVP
              </p>
              <div className="space-y-3">
                <h1 className="max-w-3xl text-balance text-4xl font-semibold leading-tight sm:text-5xl">
                  Standardize messy addresses, confirm broadband coverage, and
                  flag the ones that need a human pass.
                </h1>
                <p className="max-w-2xl text-pretty text-base text-stone-300 sm:text-lg">
                  Upload Excel or CSV, or paste rows directly. The app
                  normalizes addresses, tries to match them to the FCC fabric,
                  and returns both summary and carrier-level detail for fixed
                  and mobile broadband.
                </p>
              </div>
            </div>

            <div className="grid gap-4 rounded-[1.5rem] border border-stone-800 bg-stone-900/70 p-5 text-sm">
              <div className="grid gap-1">
                <p className="font-medium text-stone-200">Built for this MVP</p>
                <p className="text-pretty text-stone-400">
                  No login, no queueing, and no permanent storage. Results stay
                  in the browser so you can review and export quickly.
                </p>
              </div>
              <CacheStatusPanel
                cacheStatus={cacheStatus}
                cacheStatusError={cacheStatusError}
                canRefreshCache={canRefreshCache}
                isRefreshingCache={isRefreshingCache}
                onRefresh={refreshCache}
              />
              <div className="grid grid-cols-2 gap-3 text-stone-200">
                <StatCard label="Imported Rows" value={dataset?.rows.length ?? 0} />
                <StatCard label="Completed" value={successfulCount} />
                <StatCard label="Manual Review" value={manualReviewCount} />
                <StatCard label="Ready To Export" value={results.length} />
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[0.92fr_1.08fr]">
          <div className="rounded-[1.75rem] border border-stone-300 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-balance text-2xl font-semibold">
                  Ingest Data
                </h2>
                <p className="mt-1 text-pretty text-sm text-stone-600">
                  Supports a header row when you have one. The first worksheet
                  is used for Excel uploads.
                </p>
              </div>
              <label className="inline-flex cursor-pointer items-center justify-center rounded-full border border-stone-300 px-4 py-2 text-sm font-medium text-stone-900 transition hover:border-amber-500 hover:bg-amber-50">
                Upload file
                <input
                  className="sr-only"
                  type="file"
                  accept={acceptedFileTypes}
                  onChange={handleFileUpload}
                />
              </label>
            </div>

            <div className="mt-5 space-y-3">
              <label className="block text-sm font-medium text-stone-700" htmlFor="paste-input">
                Paste CSV, TSV, or one address per line
              </label>
              <textarea
                id="paste-input"
                value={pasteValue}
                onChange={(event) => setPasteValue(event.target.value)}
                placeholder="address,city,state,zip&#10;123 Main St,,AZ,85004"
                className="min-h-52 w-full rounded-[1.25rem] border border-stone-300 bg-stone-50 px-4 py-3 text-sm text-stone-900 shadow-inner outline-none transition placeholder:text-stone-400 focus:border-amber-500 focus:bg-white"
              />
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={handlePasteImport}
                  disabled={!pasteValue.trim()}
                  className={buttonClass(
                    !pasteValue.trim() ? 'cursor-not-allowed opacity-50' : undefined,
                  )}
                >
                  Parse pasted data
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPasteValue('')
                    setDataset(null)
                    setResults([])
                    setError(null)
                  }}
                  className="inline-flex items-center justify-center rounded-full border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 transition hover:border-stone-400 hover:bg-stone-100"
                >
                  Reset
                </button>
              </div>
              {error ? (
                <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {error}
                </p>
              ) : null}
            </div>
          </div>

          <div className="rounded-[1.75rem] border border-stone-300 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-balance text-2xl font-semibold">
                  Review Queue
                </h2>
                <p className="mt-1 text-pretty text-sm text-stone-600">
                  Imported rows are shown first, then final lookup results with
                  summary and provider-level detail.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={runLookup}
                  disabled={!dataset?.rows.length || isRunning}
                  className={buttonClass(
                    !dataset?.rows.length || isRunning
                      ? 'cursor-not-allowed opacity-50'
                      : undefined,
                  )}
                >
                  {isRunning ? 'Running lookups...' : 'Run standardize + FCC check'}
                </button>
                <button
                  type="button"
                  onClick={exportSummaryCsv}
                  disabled={!results.length}
                  className="inline-flex items-center justify-center rounded-full border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 transition hover:border-stone-400 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Export summary CSV
                </button>
                <button
                  type="button"
                  onClick={exportDetailCsv}
                  disabled={!results.length}
                  className="inline-flex items-center justify-center rounded-full border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 transition hover:border-stone-400 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Export detail CSV
                </button>
              </div>
            </div>

            <div className="mt-5 max-h-[40rem] overflow-auto rounded-[1.25rem] border border-stone-200">
              {results.length ? (
                <table className="min-w-full border-collapse text-left text-sm">
                  <thead className="sticky top-0 bg-stone-100">
                    <tr className="text-stone-600">
                      <HeaderCell>Row</HeaderCell>
                      <HeaderCell>Status</HeaderCell>
                      <HeaderCell>Address</HeaderCell>
                      <HeaderCell>Fixed Summary</HeaderCell>
                      <HeaderCell>Mobile Summary</HeaderCell>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((row) => (
                      <ResultTableRow key={row.id} row={row} />
                    ))}
                  </tbody>
                </table>
              ) : dataset?.rows.length ? (
                <table className="min-w-full border-collapse text-left text-sm">
                  <thead className="bg-stone-100">
                    <tr className="text-stone-600">
                      <HeaderCell>Row</HeaderCell>
                      <HeaderCell>Detected Address</HeaderCell>
                    </tr>
                  </thead>
                  <tbody>
                    {dataset.rows.map((row) => (
                      <tr key={row.id} className="border-t border-stone-200">
                        <BodyCell className="font-medium tabular-nums text-stone-500">
                          {row.rowNumber}
                        </BodyCell>
                        <BodyCell>{row.inputAddress}</BodyCell>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="grid place-items-center px-6 py-16 text-center">
                  <div className="max-w-md space-y-3">
                    <p className="text-lg font-medium text-stone-900">
                      Nothing imported yet
                    </p>
                    <p className="text-pretty text-sm text-stone-600">
                      Upload a spreadsheet or paste a block of data to start the
                      address standardization and broadband lookup workflow.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}

function ResultTableRow({ row }: { row: ResultRow }) {
  return (
    <tr className="border-t border-stone-200 align-top">
      <BodyCell className="font-medium tabular-nums text-stone-500">
        {row.rowNumber}
      </BodyCell>
      <BodyCell>
        <div className="space-y-2">
          <StatusPill status={row.status} manualReview={row.manualReview} />
          {row.note ? <p className="text-pretty text-xs text-stone-600">{row.note}</p> : null}
        </div>
      </BodyCell>
      <BodyCell>
        <div className="space-y-2">
          <p className="font-medium text-stone-900">{row.standardizedAddress ?? row.inputAddress}</p>
          {row.standardizedAddress && row.standardizedAddress !== row.inputAddress ? (
            <p className="text-pretty text-xs text-stone-500">
              Original: {row.inputAddress}
            </p>
          ) : null}
        </div>
      </BodyCell>
      <BodyCell>
        <div className="space-y-2">
          <p className="font-medium text-stone-900">
            {row.summary.fixed.available
              ? `${row.summary.fixed.providerCount} provider${row.summary.fixed.providerCount === 1 ? '' : 's'}`
              : 'No fixed providers returned'}
          </p>
          {row.summary.fixed.fastestDown ? (
            <p className="text-pretty text-xs text-stone-600">
              Fastest reported tier: {row.summary.fixed.fastestDown}/
              {row.summary.fixed.fastestUp} Mbps
            </p>
          ) : null}
          {row.fixedProviders.length ? (
            <p className="text-pretty text-xs text-stone-500">
              {row.fixedProviders
                .map((provider) => `${provider.brandName} (${provider.technology})`)
                .join('; ')}
            </p>
          ) : null}
        </div>
      </BodyCell>
      <BodyCell>
        <div className="space-y-2">
          <p className="font-medium text-stone-900">
            {row.summary.mobile.available
              ? `${row.summary.mobile.carrierCount} carrier${row.summary.mobile.carrierCount === 1 ? '' : 's'}`
              : 'No mobile carriers returned'}
          </p>
          {row.summary.mobile.carriers.length ? (
            <p className="text-pretty text-xs text-stone-600">
              {row.summary.mobile.carriers.join('; ')}
            </p>
          ) : null}
          {row.mobileProviders.length ? (
            <p className="text-pretty text-xs text-stone-500">
              {row.mobileProviders
                .map(
                  (provider) =>
                    `${provider.brandName}: ${provider.coverage
                      .map((coverage) => `${coverage.technology} ${coverage.minDown}/${coverage.minUp}`)
                      .join(', ')}`,
                )
                .join('; ')}
            </p>
          ) : null}
        </div>
      </BodyCell>
    </tr>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[1.25rem] border border-stone-800 bg-stone-950 px-4 py-3">
      <p className="text-xs uppercase text-stone-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  )
}

function CacheStatusPanel({
  cacheStatus,
  cacheStatusError,
  canRefreshCache,
  isRefreshingCache,
  onRefresh,
}: {
  cacheStatus: CacheStatusResponse | null
  cacheStatusError: string | null
  canRefreshCache: boolean
  isRefreshingCache: boolean
  onRefresh: () => Promise<void>
}) {
  if (cacheStatusError) {
    return (
      <div className="rounded-[1.25rem] border border-rose-900 bg-rose-950/40 px-4 py-3 text-pretty text-xs text-rose-200">
        {cacheStatusError}
      </div>
    )
  }

  if (!cacheStatus) {
    return (
      <div className="rounded-[1.25rem] border border-stone-800 bg-stone-950 px-4 py-3 text-xs text-stone-400">
        Checking FCC cache status...
      </div>
    )
  }

  const pillClass = cacheStatus.updateAvailable
    ? 'bg-amber-200 text-amber-950'
    : 'bg-emerald-200 text-emerald-950'

  return (
    <div className="rounded-[1.25rem] border border-stone-800 bg-stone-950 px-4 py-3 text-xs text-stone-300">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-medium text-stone-100">FCC cache status</p>
        <div className="flex items-center gap-2">
          <span className={cn('rounded-full px-3 py-1 font-medium', pillClass)}>
            {cacheStatus.updateAvailable ? 'Update available' : 'Current'}
          </span>
          {canRefreshCache ? (
            <button
              type="button"
              onClick={() => void onRefresh()}
              disabled={isRefreshingCache}
              className="rounded-full border border-stone-700 px-3 py-1 font-medium text-stone-200 transition hover:border-amber-400 hover:bg-stone-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isRefreshingCache ? 'Refreshing...' : 'Refresh snapshot'}
            </button>
          ) : null}
        </div>
      </div>
      <div className="mt-3 grid gap-1 text-pretty text-stone-400">
        <p>
          Local snapshot:{' '}
          {cacheStatus.localSnapshot
            ? `${cacheStatus.localSnapshot.label} refreshed ${formatDateTime(cacheStatus.localSnapshot.refreshedAt)} (${cacheStatus.localSnapshot.source ?? 'manual'})`
            : 'None yet'}
        </p>
        <p>FCC latest: {cacheStatus.remoteSnapshot.label}</p>
        <p>Checked: {formatDateTime(cacheStatus.checkedAt)}</p>
      </div>
    </div>
  )
}

function StatusPill({
  status,
  manualReview,
}: {
  status: ResultRow['status']
  manualReview: boolean
}) {
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-3 py-1 text-xs font-medium',
        status === 'completed' && !manualReview && 'bg-emerald-100 text-emerald-800',
        status === 'not_found' && 'bg-rose-100 text-rose-700',
        manualReview && 'bg-amber-100 text-amber-800',
      )}
    >
      {manualReview ? 'Manual review' : status === 'completed' ? 'Completed' : 'Not found'}
    </span>
  )
}

function HeaderCell({ children }: { children: ReactNode }) {
  return <th className="px-4 py-3 text-xs font-semibold uppercase">{children}</th>
}

function BodyCell({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <td className={cn('px-4 py-4 text-pretty', className)}>{children}</td>
}

function parseDelimitedText(input: string): ParsedDataset {
  const trimmed = input.trim()
  if (!trimmed) {
    throw new Error('Paste at least one row of data to continue.')
  }

  if (trimmed.includes('\t')) {
    return parseMatrix(trimmed.split(/\r?\n/).map((line) => line.split('\t')))
  }

  if (trimmed.includes(',')) {
    return parseMatrix(trimmed.split(/\r?\n/).map((line) => splitCsvLine(line)))
  }

  return parseMatrix(trimmed.split(/\r?\n/).map((line) => [line]))
}

function splitCsvLine(line: string) {
  const cells: string[] = []
  let current = ''
  let insideQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const nextChar = line[index + 1]

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        current += '"'
        index += 1
      } else {
        insideQuotes = !insideQuotes
      }
      continue
    }

    if (char === ',' && !insideQuotes) {
      cells.push(current)
      current = ''
      continue
    }

    current += char
  }

  cells.push(current)
  return cells
}

function parseMatrix(matrix: (string | number | null)[][]): ParsedDataset {
  const rows = matrix
    .map((row) => row.map((cell) => String(cell ?? '').trim()))
    .filter((row) => row.some(Boolean))

  if (!rows.length) {
    throw new Error('No usable rows were found in that input.')
  }

  const hasHeader = rows[0].some((cell) => /address|street|city|state|zip/i.test(cell))
  const header = hasHeader ? rows[0] : []
  const dataRows = hasHeader ? rows.slice(1) : rows

  const columns = detectColumns(header)
  const parsedRows = dataRows
    .map((row, index) => buildImportedRow(row, index + 1, columns))
    .filter((row): row is ImportedRow => row !== null)

  if (!parsedRows.length) {
    throw new Error('The imported file did not contain any recognizable rows.')
  }

  return { rows: parsedRows }
}

function detectColumns(header: string[]) {
  const findIndex = (matcher: RegExp) => header.findIndex((cell) => matcher.test(cell))

  return {
    full: findIndex(/full\s*address|address$/i),
    street: findIndex(/street|address 1|address1|line 1|line1/i),
    street2: findIndex(/address 2|address2|line 2|line2|unit|suite|apt/i),
    city: findIndex(/city/i),
    state: findIndex(/^state$/i),
    zip: findIndex(/zip|postal/i),
  }
}

function buildImportedRow(
  row: string[],
  rowNumber: number,
  columns: ReturnType<typeof detectColumns>,
): ImportedRow | null {
  const full = pickCell(row, columns.full)
  const street = pickCell(row, columns.street)
  const street2 = pickCell(row, columns.street2)
  const city = pickCell(row, columns.city)
  const state = pickCell(row, columns.state)
  const zip = pickCell(row, columns.zip)

  const inputAddress =
    full ||
    [street, street2, city, state, zip].filter(Boolean).join(', ') ||
    row.filter(Boolean).join(', ')

  if (!inputAddress) {
    return null
  }

  return {
    id: String(crypto.randomUUID()),
    rowNumber,
    inputAddress,
    street,
    street2,
    city,
    state,
    zip,
  }
}

function pickCell(row: string[], index: number) {
  return index >= 0 ? row[index] ?? '' : ''
}

function downloadWorksheet(rows: Record<string, string | number>[], filename: string) {
  const worksheet = XLSX.utils.json_to_sheet(rows)
  const csv = XLSX.utils.sheet_to_csv(worksheet)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function buttonClass(className?: string) {
  return cn(
    'inline-flex items-center justify-center rounded-full bg-amber-400 px-4 py-2 text-sm font-medium text-stone-950 transition hover:bg-amber-300',
    className,
  )
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export default App
