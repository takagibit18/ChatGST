import { get, post } from '@/utils/axios'
import type { PipelineData, ReviewProgress } from '@/types/project'

export type AdvancePipelineResult = PipelineData & { nextStep: number }

export const getPipeline = (projectId: string, version?: string) =>
  get<PipelineData>(`/projects/${encodeURIComponent(projectId)}/pipeline`, version ? { version } : undefined)

export const advancePipeline = (projectId: string, fromStep: number, version?: string) =>
  post<AdvancePipelineResult>(`/projects/${encodeURIComponent(projectId)}/pipeline/advance`, {
    fromStep,
    ...(version ? { version } : {}),
  })

// —— 审核流 ——

export interface ReviewRecord {
  id: string
  projectKey: string
  projectName: string
  version: string
  submittedBy: string
  submittedAt: string
  assignedReviewers: { username: string; name: string }[]
  decisions: { username: string; name: string; decision: 'approved' | 'rejected'; comment?: string; decidedAt: string }[]
  status: 'pending' | 'approved' | 'rejected'
  submitComment?: string
  reviewedAt?: string
}

/** 开发人员提交审核（携带选定的审批人，至少2人） */
export const submitForReview = (
  projectId: string,
  reviewers: { username: string; name: string }[],
  comment?: string,
) =>
  post<ReviewRecord>(
    `/projects/${encodeURIComponent(projectId)}/pipeline/submit-review`,
    { reviewers, ...(comment ? { comment } : {}) },
  )

/** 审核人员通过（共识：全票通过才发布归档） */
export const approvePipeline = (projectId: string, comment?: string) =>
  post<{ review: ReviewRecord; pipeline: PipelineData }>(
    `/projects/${encodeURIComponent(projectId)}/pipeline/approve`,
    comment ? { comment } : {},
  )

/** 审核人员驳回（任一驳回即整体驳回，退回 Step3） */
export const rejectPipeline = (projectId: string, comment?: string) =>
  post<{ review: ReviewRecord; pipeline: PipelineData }>(
    `/projects/${encodeURIComponent(projectId)}/pipeline/reject`,
    comment ? { comment } : {},
  )

/** 查询当前版本审核进度（已批 X/N、各审批人决策、我的决策） */
export const getReviewProgress = (projectId: string, version?: string) =>
  get<ReviewProgress | null>(
    `/projects/${encodeURIComponent(projectId)}/review-progress`,
    version ? { version } : undefined,
  )

/** 审核任务统计 */
export interface ReviewStats {
  total: number
  pending: number
  assignedMe: number
  decidedMe: number
  submittedMe: number
  approved: number
  rejected: number
}

/** 审核任务列表 */
export const listReviews = (status?: 'pending' | 'assigned_me' | 'decided_me' | 'approved' | 'rejected') =>
  get<ReviewRecord[]>('/reviews', status ? { status } : undefined)

/** 审核任务统计 */
export const getReviewStats = () =>
  get<ReviewStats>('/reviews/stats')

