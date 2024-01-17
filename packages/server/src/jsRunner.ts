import ivm from "isolated-vm"
import env from "./environment"
import { setJSRunner } from "@budibase/string-templates"
import { context } from "@budibase/backend-core"
import tracer from "dd-trace"
import fs from "fs"

export function init() {
  const helpersSource = fs.readFileSync(
    `${require.resolve("@budibase/string-templates/index-helpers")}`,
    "utf8"
  )

  setJSRunner((js: string, ctx: Record<string, any>) => {
    return tracer.trace("runJS", {}, span => {
      const bbCtx = context.getCurrentContext()!
      let { jsContext, jsIsolate } = bbCtx
      // if (!jsIsolate) {
      jsIsolate = new ivm.Isolate({ memoryLimit: 64 })
      jsContext = jsIsolate.createContextSync()
      const helpersModule = jsIsolate.compileModuleSync(helpersSource)

      helpersModule.instantiateSync(jsContext, specifier => {
        throw new Error(`No imports allowed. Required: ${specifier}`)
      })
      // }

      const perRequestLimit = env.JS_PER_REQUEST_TIME_LIMIT_MS
      if (perRequestLimit) {
        const cpuMs = Number(jsIsolate.cpuTime) / 1e6
        if (cpuMs > perRequestLimit) {
          throw new Error(
            `CPU time limit exceeded (${cpuMs}ms > ${perRequestLimit}ms)`
          )
        }
      }

      const global = jsContext!.global

      for (const [key, value] of Object.entries(ctx)) {
        if (key === "helpers") {
          // Can't copy the native helpers into the isolate. We just ignore them as they are handled properly from the helpersSource
          continue
        }
        global.setSync(key, value)
      }

      const script = jsIsolate.compileModuleSync(
        `import helpers from "compiled_module";${js};cb(run());`,
        {}
      )

      script.instantiateSync(jsContext!, specifier => {
        if (specifier === "compiled_module") {
          return helpersModule
        }

        throw new Error(`"${specifier}" import not allowed`)
      })

      let result
      global.setSync(
        "cb",
        new ivm.Callback((value: any) => {
          result = value
        })
      )

      script.evaluateSync({
        timeout: env.JS_PER_EXECUTION_TIME_LIMIT_MS,
      })

      return result
    })
  })
}
