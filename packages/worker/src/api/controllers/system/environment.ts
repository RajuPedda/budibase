import { env as coreEnv } from "@budibase/backend-core"
import { Ctx, MaintenanceType } from "@budibase/types"
import nodeFetch from "node-fetch"
import env from "../../../environment"

let sqsAvailable: boolean
async function isSqsAvailable() {
  // We cache this value for the duration of the Node process because we don't
  // want every page load to be making this relatively expensive check.
  if (sqsAvailable !== undefined) {
    return sqsAvailable
  }

  try {
    await nodeFetch(coreEnv.COUCH_DB_SQL_URL, {
      timeout: 1000,
    })
    sqsAvailable = true
    return true
  } catch (_e) {
    sqsAvailable = false
    return false
  }
}

async function isSqsMissing() {
  return env.SQS_SEARCH_ENABLE && !(await isSqsAvailable())
}

export const fetch = async (ctx: Ctx) => {
  ctx.body = {
    multiTenancy: !!env.MULTI_TENANCY,
    offlineMode: !!coreEnv.OFFLINE_MODE,
    cloud: !env.SELF_HOSTED,
    accountPortalUrl: env.ACCOUNT_PORTAL_URL,
    disableAccountPortal: env.DISABLE_ACCOUNT_PORTAL,
    baseUrl: env.PLATFORM_URL,
    isDev: env.isDev() && !env.isTest(),
    maintenance: [],
  }

  if (env.SELF_HOSTED) {
    if (await isSqsMissing()) {
      ctx.body.maintenance.push({ type: MaintenanceType.SQS_MISSING })
    }
  }
}
