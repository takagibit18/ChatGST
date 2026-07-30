import { get, post, patch } from '@/utils/axios'
import type { AuthUser, LoginPayload, LoginResult } from '@/types/auth'

/** 登录（密码已 RSA 加密） */
export const login = (payload: LoginPayload) =>
  post<LoginResult>('/auth/login', { ...payload })

/** 登出 */
export const logout = () => post<{ loggedOut: boolean }>('/auth/logout')

/** 获取当前登录用户信息（刷新页面时校验 cookie 有效性） */
export const getMe = () => get<AuthUser>('/auth/me')

/** 修改密码（旧密码、新密码均 RSA 加密） */
export const changePassword = (oldPasswordEnc: string, newPasswordEnc: string) =>
  post<{ changed: boolean }>('/auth/change-password', { oldPasswordEnc, newPasswordEnc })

// —— 用户管理（仅 admin）——

export interface UserListItem {
  username: string
  name: string
  role: string
  email: string
  status: string
}

export const listUsers = () => get<UserListItem[]>('/users')

export const createUser = (input: {
  username: string
  password: string
  name: string
  role: string
  email?: string
}) => post<UserListItem>('/users', input)

export const updateUser = (username: string, data: Partial<Pick<UserListItem, 'name' | 'role' | 'email' | 'status'>>) =>
  patch<UserListItem>(`/users/${username}`, data)

export const resetUserPassword = (username: string) =>
  post<{ password: string }>(`/users/${username}/reset-password`)

export const disableUser = (username: string) =>
  post<{ disabled: boolean }>(`/users/${username}/disable`)

export const enableUser = (username: string) =>
  post<{ enabled: boolean }>(`/users/${username}/enable`)

// —— 角色管理 ——

export interface RoleItem {
  code: string
  name: string
  description: string
  permissions: string[]
}

export const listRoles = () => get<RoleItem[]>('/roles')
