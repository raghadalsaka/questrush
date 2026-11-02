import type { ClassroomDetail, NewStudent, Outcome } from '../types/api'
import type { Api } from './api'
import * as rules from './sheetRules'
import type { Change, SheetDb } from './sheetRules'

export type RulesApi = Omit<Api, 'login' | 'logout' | 'me' | 'getPublicClassroom'>

// Every store runs the same rules; a store only decides how the data is read and how a change is kept.
export function rulesApi(read: () => SheetDb | Promise<SheetDb>, change: (apply: (current: SheetDb) => Change) => Promise<ClassroomDetail>): RulesApi {
  return {
    listClassrooms: async () => rules.listClassrooms(await read()),
    createClassroom: (name: string, students: NewStudent[]) => change((current) => rules.createClassroom(current, rules.systemClock, name, students)),
    getClassroom: async (id: string) => rules.getClassroom(await read(), id),

    updateStudent: (id: string, student: NewStudent) => change((current) => rules.updateStudent(current, id, student)),
    deleteStudent: (id: string) => change((current) => rules.deleteStudent(current, id)),

    setCurrentStage: (classroomSlug: string, currentStageSlug: string | null) => change((current) => rules.setCurrentStage(current, classroomSlug, currentStageSlug)),
    openSession: (classroomSlug: string, stageSlug: string) => change((current) => rules.openSession(current, rules.systemClock, classroomSlug, stageSlug)),

    closeSession: (id: string) => change((current) => rules.closeSession(current, rules.systemClock, id)),
    setAbsent: (sessionId: string, studentId: string, absent: boolean) => change((current) => rules.setAbsent(current, rules.systemClock, sessionId, studentId, absent)),
    recordResult: (sessionId: string, studentId: string, questionId: string, outcome: Outcome) =>
      change((current) => rules.recordResult(current, rules.systemClock, sessionId, studentId, questionId, outcome)),
  }
}
