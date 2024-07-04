import fs from "fs"
import { Server } from "http"
import { AddressInfo } from "net"
import {
  events,
  cache,
  env as coreEnv,
  installation,
  logging,
  tenancy,
  users,
} from "@budibase/backend-core"
import * as pro from "@budibase/pro"
import Koa from "koa"
import * as api from "../api"
import * as appMigrations from "../appMigrations/queue"
import * as automations from "../automations"
import * as bullboard from "../automations/bullboard"
import env from "../environment"
import { default as eventEmitter, init as eventInit } from "../events"
import { automationsEnabled, printFeatures } from "../features"
import * as jsRunner from "../jsRunner"
import * as migrations from "../migrations"
import sdk from "../sdk"
import * as fileSystem from "../utilities/fileSystem"
import * as redis from "../utilities/redis"
import { generateApiKey, getChecklist } from "../utilities/workerRequests"
import { watch } from "../watch"
import { initialise as initialiseWebsockets } from "../websockets"

let STARTUP_RAN = false

async function initRoutes(app: Koa) {
  if (!env.isTest()) {
    const plugin = await bullboard.init()
    app.use(plugin)
  }

  app.context.eventEmitter = eventEmitter
  app.context.auth = {}

  // api routes
  app.use(api.router.routes())
  app.use(api.router.allowedMethods())
}

async function initPro() {
  await pro.init({
    backups: {
      processing: {
        exportAppFn: sdk.backups.exportApp,
        importAppFn: sdk.backups.importApp,
        statsFn: sdk.backups.calculateBackupStats,
      },
    },
  })
}

function shutdown(server?: Server) {
  if (server) {
    server.close()
    server.destroy()
  }
}

export async function startup(
  opts: { app?: Koa; server?: Server; rerun?: boolean } = {}
) {
  const { app, server, rerun } = opts
  if (STARTUP_RAN && !rerun) {
    return
  }
  printFeatures()
  if (env.BUDIBASE_ENVIRONMENT) {
    console.log(`service running environment: "${env.BUDIBASE_ENVIRONMENT}"`)
  }
  STARTUP_RAN = true
  if (app && server && !env.CLUSTER_MODE) {
    console.log(`Budibase running on ${JSON.stringify(server.address())}`)
    const address = server.address() as AddressInfo
    env._set("PORT", address.port)
  }
  eventEmitter.emitPort(env.PORT)
  fileSystem.init()
  await redis.init()
  cache.docWritethrough.init()
  eventInit()
  if (app && server) {
    initialiseWebsockets(app, server)
  }

  // run migrations on startup if not done via http
  // not recommended in a clustered environment
  if (!env.HTTP_MIGRATIONS && !env.isTest()) {
    try {
      await migrations.migrate()
    } catch (e) {
      logging.logAlert("Error performing migrations. Exiting.", e)
      shutdown(server)
    }
  }

  // monitor plugin directory if required
  if (
    env.SELF_HOSTED &&
    !env.MULTI_TENANCY &&
    env.PLUGINS_DIR &&
    fs.existsSync(env.PLUGINS_DIR)
  ) {
    watch()
  }

  // check for version updates
  await installation.checkInstallVersion()

  // get the references to the queue promises, don't await as
  // they will never end, unless the processing stops
  let queuePromises = []
  // configure events to use the pro audit log write
  // can't integrate directly into backend-core due to cyclic issues
  queuePromises.push(events.processors.init(pro.sdk.auditLogs.write))
  // app migrations and automations on other service
  if (automationsEnabled()) {
    queuePromises.push(automations.init())
    queuePromises.push(appMigrations.init())
  }
  queuePromises.push(initPro())
  if (app) {
    // bring routes online as final step once everything ready
    await initRoutes(app)
  }

  // check and create admin user if required
  // this must be run after the api has been initialised due to
  // the app user sync
  const bbAdminEmail = coreEnv.BB_ADMIN_USER_EMAIL,
    bbAdminPassword = coreEnv.BB_ADMIN_USER_PASSWORD
  if (
    env.SELF_HOSTED &&
    !env.MULTI_TENANCY &&
    bbAdminEmail &&
    bbAdminPassword
  ) {
    const tenantId = tenancy.getTenantId()
    await tenancy.doInTenant(tenantId, async () => {
      const exists = await users.doesUserExist(bbAdminEmail)
      const checklist = await getChecklist()
      if (!checklist?.adminUser?.checked || !exists) {
        try {
          const user = await users.UserDB.createAdminUser(
            bbAdminEmail,
            tenantId,
            {
              password: bbAdminPassword,
              hashPassword: true,
              requirePassword: true,
              skipPasswordValidation: true,
            }
          )
          // Need to set up an API key for automated integration tests
          if (env.isTest()) {
            await generateApiKey(user._id!)
          }

          console.log("Admin account automatically created for", bbAdminEmail)
        } catch (e) {
          logging.logAlert("Error creating initial admin user. Exiting.", e)
          shutdown(server)
        }
      }
    })
  }

  jsRunner.init()
}
