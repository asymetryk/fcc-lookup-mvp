import { refreshLocalCacheSnapshot } from '../server/cache-refresh.mjs'

const snapshot = await refreshLocalCacheSnapshot()

console.log(
  `Refreshed local FCC snapshot: ${snapshot.label} (${snapshot.processUuid}) at ${snapshot.refreshedAt}`,
)
