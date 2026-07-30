import type { TasksData } from '@/types/task'

/**
 * 旧版待办任务接口（原走 MSW mock，已停用）。
 * 返回空数据兜底，避免 404。
 * 真实审核任务走 /api/v1/reviews（见 api/pipeline.ts）。
 */
export const getTasks = (): Promise<TasksData> =>
  Promise.resolve({
    pills: [
      { label: '待我审批', value: '0', bg: '#FBEAE7', color: '#C8311E', icon: 'urgent' },
      { label: '已审批', value: '0', bg: '#E6F4EB', color: '#1B8F4B', icon: 'check' },
      { label: '我发起的', value: '0', bg: '#E6EEFB', color: '#1B5BD9', icon: 'pipeline' },
    ],
    filters: [
      { label: '全部', count: 0 },
      { label: '待我审批', count: 0 },
      { label: '已审批', count: 0 },
      { label: '我发起的', count: 0 },
    ],
    list: [],
    total: 0,
  })
