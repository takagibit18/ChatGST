import { get, post } from '@/utils/axios'
import type { ProjectsData, ProjectVersionsData } from '@/types/project'

export interface CreateProjectBody {
  name: string
  description?: string
  ownerName?: string
  key?: string
}

export interface CreatedProject {
  key: string
  name: string
  description: string
  currentVersion: string
  status: string
}

export interface CreateVersionBody {
  version: string
  changelog?: string
}

export const getProjects = () => get<ProjectsData>('/projects')

export const createProject = (body: CreateProjectBody) =>
  post<CreatedProject>('/projects', body as unknown as Record<string, unknown>)

export const getProjectVersions = (projectKey: string) =>
  get<ProjectVersionsData>('/projects/versions', { project: projectKey })

export const createProjectVersion = (projectKey: string, body: CreateVersionBody) =>
  post(`/projects/${projectKey}/versions`, body as unknown as Record<string, unknown>)

export const deleteProjectVersion = (projectKey: string, versionId: string) =>
  post<unknown>(`/projects/${projectKey}/versions/${encodeURIComponent(versionId)}/delete`)
