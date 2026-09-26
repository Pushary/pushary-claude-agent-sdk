import {
  createAdapterKernel,
  decisionFingerprint,
  renderApprovalQuestion,
  type ApprovalDecision,
  type PusharyGateConfig,
} from '@pushary/server/adapters'
import {
  ASK_USER_QUESTION,
  QUESTION_UNANSWERED,
  QUESTION_UNREADABLE,
  clarifyingQuestionsOf,
  collectAnswers,
  phoneQuestionOf,
  type AskClarifyingQuestion,
} from './clarifying-questions'

export { ASK_USER_QUESTION, QUESTION_UNANSWERED, QUESTION_UNREADABLE } from './clarifying-questions'

export interface GatedToolUse {
  readonly toolName: string
  readonly input: Record<string, unknown>
  readonly toolUseID: string
}

export type ToolUseResolver<TValue> = (toolUse: GatedToolUse) => TValue

export interface PusharyCanUseToolConfig extends PusharyGateConfig {
  readonly externalId: string | ToolUseResolver<string | undefined>
  readonly question?: ToolUseResolver<string>
  readonly sessionId?: string
}

export interface CanUseToolOptions {
  readonly signal: AbortSignal
  readonly toolUseID?: string
  readonly mcpServer?: { readonly name: string; readonly source: string }
}

export type PusharyPermissionResult =
  | { readonly behavior: 'allow'; readonly updatedInput: Record<string, unknown> }
  | { readonly behavior: 'deny'; readonly message: string }

export type PusharyCanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: CanUseToolOptions,
) => Promise<PusharyPermissionResult>

export const CANCELLED_BEFORE_ANSWER = 'The run was cancelled before anyone answered. Do not retry the same action.'

const kernel = createAdapterKernel('pusharyCanUseTool()')

const defaultQuestion = (toolUse: GatedToolUse): string =>
  renderApprovalQuestion(toolUse.toolName, toolUse.input)

const CANCELLED: PusharyPermissionResult = { behavior: 'deny', message: CANCELLED_BEFORE_ANSWER }

const toolUseIdOf = (options: CanUseToolOptions): string => options.toolUseID ?? crypto.randomUUID()

const permissionFor =
  (input: Record<string, unknown>) =>
  (decision: ApprovalDecision): PusharyPermissionResult =>
    decision.approved ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: decision.reason }

const denyOnCancel = (
  permission: Promise<PusharyPermissionResult>,
  signal: AbortSignal,
): Promise<PusharyPermissionResult> => {
  let stopListening = (): void => undefined
  const cancelled = new Promise<PusharyPermissionResult>((resolve) => {
    const onAbort = () => resolve(CANCELLED)
    signal.addEventListener('abort', onAbort, { once: true })
    stopListening = () => signal.removeEventListener('abort', onAbort)
    if (signal.aborted) onAbort()
  })
  return Promise.race([permission, cancelled]).finally(stopListening)
}

const askOnPhone =
  (config: PusharyCanUseToolConfig, toolUse: GatedToolUse, externalId: string): AskClarifyingQuestion =>
  async (clarifying, index) => {
    const phone = phoneQuestionOf(clarifying)
    const result = await kernel.askExternalUser(config, {
      question: phone.text,
      type: 'select',
      options: phone.options,
      context: phone.context,
      externalId,
      toolName: ASK_USER_QUESTION,
      idempotencyKey: decisionFingerprint({
        sessionId: config.sessionId ?? '',
        callId: toolUse.toolUseID,
        externalId,
        index,
        question: clarifying.question,
      }),
      expiresInSeconds: config.expiresInSeconds,
      requireReachable: config.requireReachable,
    })
    return result.answered && result.value ? result.value : null
  }

const isClarifyingQuestionCall = (toolName: string, options: CanUseToolOptions): boolean =>
  toolName === ASK_USER_QUESTION && options.mcpServer === undefined

const answerClarifyingQuestions = async (
  config: PusharyCanUseToolConfig,
  toolUse: GatedToolUse,
  externalId: string,
  signal: AbortSignal,
): Promise<PusharyPermissionResult> => {
  const questions = clarifyingQuestionsOf(toolUse.input)
  if (!questions) return { behavior: 'deny', message: QUESTION_UNREADABLE }
  const answers = await collectAnswers(questions, askOnPhone(config, toolUse, externalId), signal)
  return answers
    ? { behavior: 'allow', updatedInput: { ...toolUse.input, answers } }
    : { behavior: 'deny', message: QUESTION_UNANSWERED }
}

export const pusharyCanUseTool = (config: PusharyCanUseToolConfig): PusharyCanUseTool => {
  const gate = kernel.createGate(config)
  const buildQuestion = config.question ?? defaultQuestion

  return async (toolName, input, options) => {
    if (options.signal.aborted) return CANCELLED
    const toolUse: GatedToolUse = { toolName, input, toolUseID: toolUseIdOf(options) }
    const configured = typeof config.externalId === 'function' ? config.externalId(toolUse) : config.externalId
    const externalId = kernel.requireExternalId(configured)
    const permission =
      isClarifyingQuestionCall(toolName, options)
        ? answerClarifyingQuestions(config, toolUse, externalId, options.signal)
        : gate({
            toolName,
            callId: toolUse.toolUseID,
            sessionId: config.sessionId ?? '',
            question: buildQuestion(toolUse),
            externalId,
            input,
          }).then(permissionFor(input))
    return denyOnCancel(permission, options.signal)
  }
}

export const connect = kernel.connect
