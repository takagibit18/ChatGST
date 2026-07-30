import { get } from '@/utils/axios'
import type { UsersData } from '@/types/user'

export const getUsers = () => get<UsersData>('/users')
