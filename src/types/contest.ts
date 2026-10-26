export type AnswerOptions = [string, string, string, string]

export interface Question {
  id: string
  prompt: string
  options: AnswerOptions
  correctIndex: number
  explanation: string
}

export interface ContestSettings {
  secondsPerQuestion: number
  defaultQuestionsPerTeam: number
  allowCrossTeamRepeats: boolean
}

export interface Contest {
  title: string
  slug: string
  settings: ContestSettings
  questions: Question[]
}

export type ContestLoadResult = { ok: true; contest: Contest } | { ok: false; errors: string[] }
