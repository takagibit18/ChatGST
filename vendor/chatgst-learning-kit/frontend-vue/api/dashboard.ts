export interface DashboardKpi {
  label: string
  value: string
  delta: string
  trend: string
  barColor: string
  spark: string
  sparkColor: string
}
export interface DashboardPerson {
  initials: string
  name: string
  color: string
}
export interface DashboardPipelineItem {
  version: string
  key: string
  type: string
  typeVariant: string
  steps: string[]
  owner: DashboardPerson
  status: string
  statusVariant: string
  time: string
}
export interface DashboardActivity {
  icon: string
  actor: string
  verb: string
  object: string
  meta: string
}
export interface DashboardQuota {
  label: string
  percent: number
  value: string
  level: string
}
export interface DashboardGateBar {
  height: number
  value: number
  today?: boolean
}
export interface DashboardTeamMember {
  initials: string
  name: string
  color: string
  role: string
  roleVariant: string
  submit: number
  pass: number
}

export interface DashboardData {
  user: { name: string; subtitle: string }
  notice: string
  kpis: DashboardKpi[]
  runningPipelines: {
    title: string
    subtitle: string
    items: DashboardPipelineItem[]
  }
  activities: DashboardActivity[]
  quotas: DashboardQuota[]
  gateStats: {
    title: string
    bars: DashboardGateBar[]
    legend: { color: string; label: string; value: number }[]
  }
  teamTop: {
    title: string
    members: DashboardTeamMember[]
  }
}

export const getDashboard = (): Promise<DashboardData> =>
  import('../mocks/json/dashboard.json').then((m) => m.default as DashboardData)
