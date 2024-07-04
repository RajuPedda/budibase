import { UserCtx } from "@budibase/types"
import { getAppId } from "../context"
import env from "../environment"
import { hasBuilderPermissions, isAdmin, isBuilder } from "../users"

export default async (ctx: UserCtx, next: any) => {
  const appId = getAppId()
  const builderFn =
    env.isWorker() || !appId
      ? hasBuilderPermissions
      : env.isApps()
        ? isBuilder
        : undefined
  if (!builderFn) {
    throw new Error("Service name unknown - middleware inactive.")
  }
  if (!ctx.internal && !builderFn(ctx.user, appId) && !isAdmin(ctx.user)) {
    ctx.throw(403, "Admin/Builder user only endpoint.")
  }
  return next()
}
