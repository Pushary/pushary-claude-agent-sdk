import {
  createAdapterKernel,
  renderApprovalQuestion,
  type ApprovalDecision,
  type PusharyGateConfig,
} from '@pushary/server/adapters'

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
  })
  return Promise.race([permission, cancelled]).finally(stopListening)
}

export const pusharyCanUseTool = (config: PusharyCanUseToolConfig): PusharyCanUseTool => {
  const gate = kernel.createGate(config)
  const buildQuestion = config.question ?? defaultQuestion

  return async (toolName, input, options) => {
    if (options.signal.aborted) return CANCELLED
    const toolUse: GatedToolUse = { toolName, input, toolUseID: toolUseIdOf(options) }
    const configured = typeof config.externalId === 'function' ? config.externalId(toolUse) : config.externalId
    const permission = gate({
      toolName,
      callId: toolUse.toolUseID,
      sessionId: config.sessionId ?? '',
      question: buildQuestion(toolUse),
      externalId: kernel.requireExternalId(configured),
      input,
    }).then(permissionFor(input))
    return denyOnCancel(permission, options.signal)
  }
}

export const connect = kernel.connect
