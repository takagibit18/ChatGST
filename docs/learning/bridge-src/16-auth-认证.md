# 认证 — JWT 签发与校验

> 源文件：`bridge/src/auth.ts`

```typescript
import { existsSync, readFileSync } from 'node:fs'

import { dirname, join } from 'node:path'

import { fileURLToPath } from 'node:url'

import { findUser, listUsers as listUsersStore, listUsersBrief, createUser, updateUser, verifyUserPassword, changePassword as changeUserPassword, resetPassword as resetUserPassword, disableUser, enableUser, deleteUser, migrateFromConfig, type UserRecord } from './users-store.js'

import { findRole, listRoles, getPermissions } from './roles-store.js'

import { decrypt, signJwt, verifyJwt, generateRandomPassword, getPublicKeyPem, type JwtPayload } from './crypto.js'



const CONFIG_PATH = process.env.POLICY_BRIDGE_CONFIG ||

  join(dirname(fileURLToPath(import.meta.url)), '..', 'config.json')



interface ConfigAuth {

  username: string

  password: string

  displayName: string

  role: string

  email: string

}



interface ConfigFile {

  auth?: Partial<ConfigAuth>

  ontoPlatform?: unknown

}



function loadConfigFile(): ConfigFile {

  if (!existsSync(CONFIG_PATH)) {

    throw new Error(`config.json not found at ${CONFIG_PATH}`)

  }

  return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as ConfigFile

}



export function getConfigAuth(): Partial<ConfigAuth> {

  return loadConfigFile().auth ?? {}

}



export function initAuth(): void {

  const cfgAuth = getConfigAuth()

  if (cfgAuth.username && cfgAuth.password) {

    migrateFromConfig({

      username: cfgAuth.username,

      password: cfgAuth.password,

      displayName: cfgAuth.displayName,

      email: cfgAuth.email,

    })

  }

}



export interface AuthUser {

  username: string

  name: string

  role: string

  email: string

  status: string

  permissions: string[]

}



export function verifyCredentials(username: string, passwordEncrypted: string): AuthUser | null {

  const user = findUser(username)

  if (!user) return null

  if (user.status === 'disabled') return null



  let plainPassword: string

  try {

    plainPassword = decrypt(passwordEncrypted)

  } catch {

    plainPassword = passwordEncrypted

  }



  if (!verifyUserPassword(username, plainPassword)) return null



  return toAuthUser(user)

}



function toAuthUser(user: UserRecord): AuthUser {

  return {

    username: user.username,

    name: user.name,

    role: user.role,

    email: user.email,

    status: user.status,

    permissions: getPermissions(user.role),

  }

}



export function createToken(user: AuthUser): string {

  return signJwt({

    username: user.username,

    role: user.role,

    permissions: user.permissions,

  })

}



export function verifyToken(token: string): JwtPayload | null {

  return verifyJwt(token)

}



export function getPublicKey(): string {

  return getPublicKeyPem()

}



export function getUserFromPayload(payload: JwtPayload): AuthUser | null {

  const user = findUser(payload.username)

  if (!user || user.status === 'disabled') return null

  return toAuthUser(user)

}



export function changeOwnPassword(username: string, oldPwdEnc: string, newPwdEnc: string): void {

  let oldPlain: string

  let newPlain: string

  try {

    oldPlain = decrypt(oldPwdEnc)

    newPlain = decrypt(newPwdEnc)

  } catch {

    throw new Error('密码解密失败')

  }

  changeUserPassword(username, oldPlain, newPlain)

}



export function resetUserPasswordByAdmin(username: string): string {

  const newPwd = generateRandomPassword(8)

  resetUserPassword(username, newPwd)

  return newPwd

}



export {

  listUsersStore,

  listUsersBrief,

  createUser,

  updateUser,

  disableUser,

  enableUser,

  deleteUser,

  listRoles,

  findRole,

}


```
