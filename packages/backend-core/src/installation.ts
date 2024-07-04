import { Database, IdentityType, Installation } from "@budibase/types"
import semver from "semver"
import { CacheKey, TTL, bustCache, withCache } from "./cache/generic"
import * as context from "./context"
import { StaticDatabases, doWithDB } from "./db"
import environment from "./environment"
import * as events from "./events"
import { logAlert } from "./logging"
import { newid } from "./utils"

export const getInstall = async (): Promise<Installation> => {
  return withCache(CacheKey.INSTALLATION, TTL.ONE_DAY, getInstallFromDB, {
    useTenancy: false,
  })
}
async function createInstallDoc(platformDb: Database) {
  const install: Installation = {
    _id: StaticDatabases.PLATFORM_INFO.docs.install,
    installId: newid(),
    version: environment.VERSION,
  }
  try {
    const resp = await platformDb.put(install)
    install._rev = resp.rev
    return install
  } catch (err: any) {
    if (err.status === 409) {
      return getInstallFromDB()
    } else {
      throw err
    }
  }
}

export const getInstallFromDB = async (): Promise<Installation> => {
  return doWithDB(
    StaticDatabases.PLATFORM_INFO.name,
    async (platformDb: any) => {
      let install: Installation
      try {
        install = await platformDb.get(
          StaticDatabases.PLATFORM_INFO.docs.install
        )
      } catch (e: any) {
        if (e.status === 404) {
          install = await createInstallDoc(platformDb)
        } else {
          throw e
        }
      }
      return install
    }
  )
}

const updateVersion = async (version: string): Promise<boolean> => {
  try {
    await doWithDB(
      StaticDatabases.PLATFORM_INFO.name,
      async (platformDb: any) => {
        const install = await getInstall()
        install.version = version
        await platformDb.put(install)
        await bustCache(CacheKey.INSTALLATION)
      }
    )
  } catch (e: any) {
    if (e.status === 409) {
      // do nothing - version has already been updated
      // likely in clustered environment
      return false
    }
    throw e
  }
  return true
}

export const checkInstallVersion = async (): Promise<void> => {
  const install = await getInstall()

  const currentVersion = install.version
  const newVersion = environment.VERSION

  try {
    if (currentVersion !== newVersion) {
      const isUpgrade = semver.gt(newVersion, currentVersion)
      const isDowngrade = semver.lt(newVersion, currentVersion)

      const success = await updateVersion(newVersion)

      if (success) {
        await context.doInIdentityContext(
          {
            _id: install.installId,
            type: IdentityType.INSTALLATION,
          },
          async () => {
            if (isUpgrade) {
              await events.installation.upgraded(currentVersion, newVersion)
            } else if (isDowngrade) {
              await events.installation.downgraded(currentVersion, newVersion)
            }
          }
        )
        await events.identification.identifyInstallationGroup(install.installId)
      }
    }
  } catch (err: any) {
    if (err?.message?.includes("Invalid Version")) {
      logAlert(`Invalid version "${newVersion}" - is it semver?`)
    } else {
      logAlert("Failed to retrieve version", err)
    }
  }
}
