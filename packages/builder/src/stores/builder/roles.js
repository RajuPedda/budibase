import { derived, writable, get } from "svelte/store"
import { API } from "api"
import { RoleUtils } from "@budibase/frontend-core"

export function createRolesStore() {
  const store = writable([])
  const enriched = derived(store, $store => {
    return $store.map(role => ({
      ...role,

      // Ensure we have new metadata for all roles
      uiMetadata: {
        displayName: role.uiMetadata?.displayName || role.name,
        color:
          role.uiMetadata?.color || "var(--spectrum-global-color-magenta-400)",
        description: role.uiMetadata?.description || "Custom role",
      },
    }))
  })

  function setRoles(roles) {
    store.set(
      roles.sort((a, b) => {
        const priorityA = RoleUtils.getRolePriority(a._id)
        const priorityB = RoleUtils.getRolePriority(b._id)
        if (priorityA !== priorityB) {
          return priorityA > priorityB ? -1 : 1
        }
        const nameA = a.uiMetadata?.displayName || a.name
        const nameB = b.uiMetadata?.displayName || b.name
        return nameA < nameB ? -1 : 1
      })
    )
  }

  const actions = {
    fetch: async () => {
      const roles = await API.getRoles()
      setRoles(roles)
    },
    fetchByAppId: async appId => {
      const { roles } = await API.getRolesForApp(appId)
      setRoles(roles)
    },
    delete: async role => {
      await API.deleteRole({
        roleId: role?._id,
        roleRev: role?._rev,
      })
      store.update(state => state.filter(existing => existing._id !== role._id))
    },
    save: async role => {
      const savedRole = await API.saveRole(role)
      await actions.fetch()

      // When saving a role we get back an _id prefixed by role_, but the API does not want this
      // in future requests
      return {
        ...savedRole,
        _id: savedRole._id.replace("role_", ""),
      }
    },
    replace: (roleId, role) => {
      // Remove role_ prefix
      if (roleId?.startsWith("role_")) {
        roleId = roleId.replace("role_", "")
      }
      if (role?._id.startsWith("role_")) {
        role._id = role._id.replace("role_", "")
      }
      console.log("replace", roleId, role)

      // Handles external updates of roles
      if (!roleId) {
        return
      }

      // Handle deletion
      if (!role) {
        store.update(state => state.filter(x => x._id !== roleId))
        return
      }

      // Add new role
      const index = get(store).findIndex(x => x._id === role._id)
      if (index === -1) {
        store.update(state => [...state, role])
      }

      // Update existing role
      else if (role) {
        store.update(state => {
          state[index] = role
          return [...state]
        })
      }
    },
  }

  return {
    subscribe: enriched.subscribe,
    ...actions,
  }
}

export const roles = createRolesStore()
