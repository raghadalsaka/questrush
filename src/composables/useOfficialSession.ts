import { computed, onScopeDispose, readonly, ref, shallowRef, watch } from 'vue'
import { PICK_ANIMATION_MS, PICK_STEP_MS, STAR_ANIMATION_MS } from '../config'
import { api } from '../services/api'
import { loadStage as fetchStage } from '../services/stageService'
import type { Outcome } from '../types/api'
import type { Question } from '../types/contest'
import type { StageFile, StageLoadResult } from '../types/stage'
import { cryptoRandomInt, pickRandom, type RandomInt } from '../utils/random'
import { eligibleStudents, missingQuestionIds, planPick, questionShortage, unusedQuestions } from '../utils/selection'
import type { TeacherClassroom } from './useTeacherClassroom'

export interface OfficialSessionOptions {
  randomInt?: RandomInt
  pickAnimationMs?: () => number
  loadStage?: (slug: string) => Promise<StageLoadResult>
}

export type SessionPhase = 'idle' | 'picking'

export interface CurrentTurn {
  studentId: string
  questionId: string
}

export interface FinishedTurn {
  turn: CurrentTurn
  outcome: Outcome
  chosenIndex: number | null
}

function defaultPickAnimationMs(): number {
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    return 0
  }
  return PICK_ANIMATION_MS
}

// The browser runs each turn in memory only; the server stores answers and has the final say on every rule.
export function useOfficialSession(teacher: TeacherClassroom, options: OfficialSessionOptions = {}) {
  const randomInt = options.randomInt ?? cryptoRandomInt
  const pickAnimationMs = options.pickAnimationMs ?? defaultPickAnimationMs
  const loadStage = options.loadStage ?? fetchStage

  const deck = shallowRef<StageFile | null>(null)
  const deckError = ref('')
  const deckLoading = ref(false)
  const phase = ref<SessionPhase>('idle')
  const spotlightId = ref<string | null>(null)
  const celebrateId = ref<string | null>(null)
  const chosenIndex = ref<number | null>(null)
  const revealed = computed(() => chosenIndex.value !== null)
  const pendingTurn = shallowRef<CurrentTurn | null>(null)
  const setAsideIds = shallowRef<readonly string[]>([])
  const finished = shallowRef<FinishedTurn | null>(null)
  let timers: ReturnType<typeof setTimeout>[] = []
  let deckRequest = 0

  const session = teacher.activeSession
  const level = teacher.activeLevel
  const stageSlug = computed(() => session.value?.stageSlug ?? null)
  const usedIds = computed(() => (stageSlug.value === null ? [] : (teacher.classroom.value?.usedQuestionIds[stageSlug.value] ?? [])))
  const shownTurn = computed(() => pendingTurn.value ?? finished.value?.turn ?? null)
  const shownStudent = computed(() => {
    const turn = shownTurn.value
    return turn === null ? null : (teacher.classroom.value?.students.find((student) => student.id === turn.studentId) ?? null)
  })
  const shownQuestion = computed(() => {
    const turn = shownTurn.value
    return turn === null || deck.value === null ? null : (deck.value.questions.find((question) => question.id === turn.questionId) ?? null)
  })
  const eligible = computed(() => {
    const classroom = teacher.classroom.value
    if (classroom === null || session.value === null) {
      return []
    }
    const waiting = eligibleStudents(classroom.students, classroom.results, session.value.stageSlug, session.value.absentStudentIds)
    return waiting.filter((student) => student.id !== pendingTurn.value?.studentId)
  })
  const unused = computed(() => (deck.value === null ? [] : unusedQuestions(deck.value.questions, usedIds.value)))
  const missingIds = computed(() => (deck.value === null ? [] : missingQuestionIds(deck.value.questions, usedIds.value)))
  const shortage = computed(() => (deck.value === null ? 0 : questionShortage(unused.value.length, eligible.value.length)))
  // Like Quizrush's Different Card: a set-aside question goes back to the pool, but not to this student's turn.
  const replacements = computed(() => {
    const turn = pendingTurn.value
    return turn === null ? [] : unused.value.filter((question) => question.id !== turn.questionId && !setAsideIds.value.includes(question.id))
  })
  const canSwapQuestion = computed(() => pendingTurn.value !== null && !revealed.value && replacements.value.length > 0)
  const showCard = computed(() => pendingTurn.value !== null || finished.value !== null)
  const pickBlocker = computed<string | null>(() => {
    if (session.value === null) {
      return 'Start a session to pick students.'
    }
    if (level.value?.state !== 'open') {
      return "This stage isn't unlocked in its stage file, so official turns are paused."
    }
    if (deckLoading.value) {
      return 'Loading the questions…'
    }
    if (deck.value === null) {
      return "The questions couldn't be loaded."
    }
    if (pendingTurn.value !== null) {
      return 'Finish the current turn first.'
    }
    if (eligible.value.length === 0) {
      return 'Everyone present has had a turn on this stage.'
    }
    if (unused.value.length === 0) {
      return 'This stage has run out of questions. Add more questions to its stage file before picking again.'
    }
    return null
  })

  async function loadStageDeck(slug: string | null): Promise<void> {
    const request = ++deckRequest
    deck.value = null
    deckError.value = ''
    if (slug === null) {
      deckLoading.value = false
      return
    }
    deckLoading.value = true
    const result = await loadStage(slug)
    if (request !== deckRequest) {
      return
    }
    deckLoading.value = false
    if (result.ok) {
      deck.value = result.stage
      return
    }
    deckError.value = "This stage's questions couldn't be loaded. Check the connection and try again."
  }

  watch(stageSlug, loadStageDeck, { immediate: true })

  function startTurn(turn: CurrentTurn): void {
    pendingTurn.value = turn
    chosenIndex.value = null
  }

  watch(
    () => session.value?.id ?? null,
    () => {
      pendingTurn.value = null
      setAsideIds.value = []
      finished.value = null
    },
  )

  function later(ms: number, callback: () => void): void {
    timers.push(setTimeout(callback, ms))
  }

  function spotlight(candidates: readonly string[], finalId: string): Promise<void> {
    const total = pickAnimationMs()
    if (total <= 0 || candidates.length < 2) {
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      for (let elapsed = 0; elapsed < total; elapsed += PICK_STEP_MS) {
        later(elapsed, () => {
          spotlightId.value = pickRandom(candidates, randomInt)
        })
      }
      later(total, () => {
        spotlightId.value = finalId
      })
      later(total + PICK_STEP_MS * 3, resolve)
    })
  }

  async function pick(): Promise<void> {
    if (phase.value !== 'idle' || teacher.busy.value || pickBlocker.value !== null) {
      return
    }
    const plan = planPick(eligible.value, unused.value, randomInt)
    if (!plan.ok) {
      return
    }
    const candidates = eligible.value.map((student) => student.id)
    phase.value = 'picking'
    teacher.clearError()
    await spotlight(candidates, plan.pick.student.id)
    setAsideIds.value = []
    startTurn({ studentId: plan.pick.student.id, questionId: plan.pick.question.id })
    spotlightId.value = null
    phase.value = 'idle'
  }

  function swapQuestion(): void {
    const turn = pendingTurn.value
    if (turn === null || !canSwapQuestion.value) {
      return
    }
    setAsideIds.value = [...setAsideIds.value, turn.questionId]
    startTurn({ studentId: turn.studentId, questionId: pickRandom(replacements.value, randomInt).id })
  }

  // Back to Map ends an unanswered turn: nothing is saved and its question goes back to the pool.
  function leaveTurn(): void {
    pendingTurn.value = null
    setAsideIds.value = []
    chosenIndex.value = null
  }

  function outcomeOf(question: Question, index: number): Outcome {
    return index === question.correctIndex ? 'correct' : 'incorrect'
  }

  // Tapping an option is the student's final answer: it is shown and saved at once.
  async function answer(index: number): Promise<void> {
    const question = shownQuestion.value
    if (revealed.value || teacher.busy.value || question === null || pendingTurn.value === null) {
      return
    }
    chosenIndex.value = index
    await record(outcomeOf(question, index))
  }

  // A failed save leaves the answer on screen, so the retry records that same answer.
  async function saveAgain(): Promise<void> {
    const question = shownQuestion.value
    const chosen = chosenIndex.value
    if (question === null || chosen === null) {
      return
    }
    await record(outcomeOf(question, chosen))
  }

  async function record(outcome: Outcome): Promise<void> {
    const turn = pendingTurn.value
    const current = session.value
    if (turn === null || current === null || !revealed.value) {
      return
    }
    const chosen = chosenIndex.value
    // Set together, before the classroom is applied, so the card never unmounts between the pending and finished turn.
    await teacher.run(async () => {
      const detail = await api.recordResult(current.id, turn.studentId, turn.questionId, outcome)
      finished.value = { turn, outcome, chosenIndex: chosen }
      pendingTurn.value = null
      return detail
    })
  }

  // The map star waits for the dialog to close so the class actually sees it.
  function dismiss(): void {
    const done = finished.value
    finished.value = null
    if (done === null || done.outcome !== 'correct') {
      return
    }
    const studentId = done.turn.studentId
    celebrateId.value = studentId
    later(STAR_ANIMATION_MS, () => {
      if (celebrateId.value === studentId) {
        celebrateId.value = null
      }
    })
  }

  function pickNext(): Promise<void> {
    dismiss()
    return pick()
  }

  function retryDeck(): Promise<void> {
    return loadStageDeck(stageSlug.value)
  }

  onScopeDispose(() => {
    timers.forEach(clearTimeout)
    timers = []
  })

  return {
    deck,
    deckError: readonly(deckError),
    deckLoading: readonly(deckLoading),
    phase: readonly(phase),
    spotlightId: readonly(spotlightId),
    celebrateId: readonly(celebrateId),
    revealed,
    chosenIndex: readonly(chosenIndex),
    finished: readonly(finished),
    pendingTurn: readonly(pendingTurn),
    shownStudent,
    shownQuestion,
    eligible,
    unused,
    missingIds,
    shortage,
    canSwapQuestion,
    showCard,
    pickBlocker,
    pick,
    answer,
    saveAgain,
    swapQuestion,
    leaveTurn,
    dismiss,
    pickNext,
    retryDeck,
  }
}

export type OfficialSession = ReturnType<typeof useOfficialSession>
