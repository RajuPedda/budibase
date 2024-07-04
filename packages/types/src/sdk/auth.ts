import { Hosting } from "./hosting"
import { BBContext } from "./koa"

export interface AuthToken {
  userId: string
  tenantId: string
  sessionId: string
}

export interface CreateSession {
  sessionId: string
  tenantId: string
  csrfToken?: string
  hosting?: Hosting
}

export interface Session extends CreateSession {
  userId: string
  lastAccessedAt: string
  createdAt: string
  // make optional attributes required
  csrfToken: string
}

export interface SessionKey {
  key: string
}

export interface ScannedSession {
  value: Session
}

export interface PlatformLogoutOpts {
  ctx: BBContext
  userId: string
  keepActiveSession?: boolean
}
