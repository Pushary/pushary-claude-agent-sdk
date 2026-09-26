export const ASK_USER_QUESTION = 'AskUserQuestion'

export const QUESTION_UNANSWERED = 'Nobody answered the question in time. Do not assume an answer.'

export const QUESTION_UNREADABLE = 'The question could not be shown to the user. Ask it in plain text instead.'

export const SINGLE_CHOICE_NOTE = ' (choose one)'

const MAX_QUESTION_LENGTH = 500
const MIN_OPTIONS = 2
const MAX_OPTIONS = 20
const MAX_LABEL_LENGTH = 200
const MAX_CONTEXT_LENGTH = 2000

export interface ClarifyingOption {
  readonly label: string
  readonly description?: string
}

export interface ClarifyingQuestion {
  readonly question: string
  readonly options: readonly ClarifyingOption[]
  readonly multiSelect?: boolean
}

export interface PhoneQuestion {
  readonly text: string
  readonly options: readonly string[]
  readonly context?: string
}

export type ClarifyingAnswer =
  | { readonly answered: true; readonly value: string }
  | { readonly answered: false; readonly stopped: boolean }

export type CollectedAnswers =
  | { readonly answered: true; readonly answers: Readonly<Record<string, string>> }
  | { readonly answered: false; readonly stopped: boolean }

export type AskClarifyingQuestion = (question: ClarifyingQuestion, index: number) => Promise<ClarifyingAnswer>

const NOT_ASKED: CollectedAnswers = { answered: false, stopped: false }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

const isOptionalString = (value: unknown): value is string | undefined => value === undefined || typeof value === 'string'

const isClarifyingOption = (value: unknown): value is ClarifyingOption =>
  isRecord(value) &&
  isNonEmptyString(value.label) &&
  value.label.length <= MAX_LABEL_LENGTH &&
  isOptionalString(value.description)

const hasOptionCount = (options: readonly unknown[]): boolean =>
  options.length >= MIN_OPTIONS && options.length <= MAX_OPTIONS

const isClarifyingQuestion = (value: unknown): value is ClarifyingQuestion =>
  isRecord(value) &&
  isNonEmptyString(value.question) &&
  (value.multiSelect === undefined || typeof value.multiSelect === 'boolean') &&
  Array.isArray(value.options) &&
  hasOptionCount(value.options) &&
  value.options.every(isClarifyingOption)

const describedOption = (option: ClarifyingOption): string | null =>
  option.description?.trim() ? `${option.label}: ${option.description.trim()}` : null

export const phoneQuestionOf = (clarifying: ClarifyingQuestion): PhoneQuestion => {
  const text = clarifying.multiSelect ? `${clarifying.question}${SINGLE_CHOICE_NOTE}` : clarifying.question
  const context = clarifying.options
    .map(describedOption)
    .filter((line): line is string => line !== null)
    .join('\n')
    .slice(0, MAX_CONTEXT_LENGTH)
  return { text, options: clarifying.options.map((option) => option.label), ...(context ? { context } : {}) }
}

const fitsOnPhone = (clarifying: ClarifyingQuestion): boolean =>
  phoneQuestionOf(clarifying).text.length <= MAX_QUESTION_LENGTH

export const clarifyingQuestionsOf = (input: Readonly<Record<string, unknown>>): readonly ClarifyingQuestion[] | null => {
  const { questions } = input
  if (!Array.isArray(questions) || questions.length === 0) return null
  if (!questions.every(isClarifyingQuestion)) return null
  return questions.every(fitsOnPhone) ? questions : null
}

export const collectAnswers = async (
  questions: readonly ClarifyingQuestion[],
  ask: AskClarifyingQuestion,
  signal: AbortSignal,
): Promise<CollectedAnswers> => {
  const answers: Record<string, string> = {}
  for (const [index, question] of questions.entries()) {
    if (signal.aborted) return NOT_ASKED
    const answer = await ask(question, index)
    if (!answer.answered) return answer
    answers[question.question] = answer.value
  }
  return { answered: true, answers }
}
