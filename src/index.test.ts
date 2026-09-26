import { afterEach, describe, expect, it, vi } from 'vitest'
import { CANCELLED_BEFORE_ANSWER, pusharyCanUseTool } from './index'

type Responder = () => unknown

interface RecordedCall {
  readonly url: string
  readonly body: Record<string, unknown> | undefined
}

const REQUIRES_HUMAN = {
  verdict: 'requires_human',
  policy: null,
  reason: 'No policy rule names this action, so a person decides.',
  authorizationId: null,
}

const ALLOWED = {
  verdict: 'allow',
  policy: 'Bash',
  reason: 'Allowed by policy rule Bash.',
  authorizationId: 'az_1',
}

const DENIED = {
  verdict: 'deny',
  policy: 'Bash',
  reason: 'Denied by policy rule Bash.',
  authorizationId: 'az_2',
}

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

function installFetch(decisions: readonly Responder[], evaluation: unknown = REQUIRES_HUMAN): RecordedCall[] {
  const calls: RecordedCall[] = []
  let index = 0
  globalThis.fetch = (async (input: unknown, init?: { body?: string }) => {
    const url = String(input)
    const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : undefined
    calls.push({ url, body })
    if (url.endsWith('/authorize')) {
      return { ok: true, status: 200, json: async () => evaluation } as Response
    }
    const json = decisions[Math.min(index, decisions.length - 1)]()
    index += 1
    return { ok: true, status: 200, json: async () => json } as Response
  }) as typeof fetch
  return calls
}

const decisionCalls = (calls: readonly RecordedCall[]) => calls.filter((call) => !call.url.endsWith('/authorize'))

const answered = (value: string) => () => ({
  decisionId: 'd1',
  status: 'answered',
  answered: true,
  value,
  type: 'confirm',
})

const unanswered = () => ({
  decisionId: 'd1',
  status: 'pending',
  answered: false,
  value: null,
  type: 'confirm',
})

const CONFIG = {
  apiKey: 'pk_x.sk_y',
  baseUrl: 'https://pushary.com/api/v1/server',
  timeoutMs: 0,
  externalId: 'user_1',
}

const INPUT = { command: 'git push --force origin main' }

const options = (toolUseID?: string) => ({ signal: new AbortController().signal, toolUseID })

describe('pusharyCanUseTool', () => {
  it('allows the tool with its input unchanged when the person approves', async () => {
    installFetch([answered('yes')])
    const result = await pusharyCanUseTool(CONFIG)('Bash', INPUT, options('toolu_1'))
    expect(result).toEqual({ behavior: 'allow', updatedInput: INPUT })
  })

  it('denies with a reason the model can read when the person says no', async () => {
    installFetch([answered('no')])
    const result = await pusharyCanUseTool(CONFIG)('Bash', INPUT, options('toolu_1'))
    expect(result.behavior).toBe('deny')
  })

  it('denies when nobody answers, and never reads silence as a yes', async () => {
    installFetch([unanswered])
    const result = await pusharyCanUseTool(CONFIG)('Bash', INPUT, options('toolu_1'))
    expect(result.behavior).toBe('deny')
  })

  it('asks the person it was bound to and records the tool use id', async () => {
    const calls = installFetch([answered('yes')])
    await pusharyCanUseTool(CONFIG)('Bash', INPUT, options('toolu_1'))
    const [ask] = decisionCalls(calls)
    expect(ask.body).toMatchObject({ externalId: 'user_1' })
    expect(JSON.stringify(ask.body)).toContain('Bash')
  })

  it('resolves the person per call from the resolver, not from the model input', async () => {
    const calls = installFetch([answered('yes')])
    const gate = pusharyCanUseTool({ ...CONFIG, externalId: (toolUse) => `owner_of_${toolUse.toolName}` })
    await gate('Bash', { ...INPUT, externalId: 'attacker' }, options('toolu_1'))
    expect(decisionCalls(calls)[0].body).toMatchObject({ externalId: 'owner_of_Bash' })
  })

  it('allows without paging anyone when a rule allows the call', async () => {
    const calls = installFetch([answered('no')], ALLOWED)
    const result = await pusharyCanUseTool(CONFIG)('Bash', INPUT, options('toolu_1'))
    expect(result).toEqual({ behavior: 'allow', updatedInput: INPUT })
    expect(decisionCalls(calls)).toHaveLength(0)
  })

  it('denies without paging anyone when a rule denies the call', async () => {
    const calls = installFetch([answered('yes')], DENIED)
    const result = await pusharyCanUseTool(CONFIG)('Bash', INPUT, options('toolu_1'))
    expect(result).toMatchObject({ behavior: 'deny' })
    expect(result.behavior === 'deny' && result.message).toContain('Denied by policy rule Bash.')
    expect(decisionCalls(calls)).toHaveLength(0)
  })

  it('denies at once when the run was already cancelled', async () => {
    const calls = installFetch([answered('yes')])
    const controller = new AbortController()
    controller.abort()
    const result = await pusharyCanUseTool(CONFIG)('Bash', INPUT, { signal: controller.signal, toolUseID: 'toolu_1' })
    expect(result).toEqual({ behavior: 'deny', message: CANCELLED_BEFORE_ANSWER })
    expect(calls).toHaveLength(0)
  })

  it('stops waiting and denies as soon as the run is cancelled mid-ask', async () => {
    globalThis.fetch = (() => new Promise<Response>(() => undefined)) as typeof fetch
    const controller = new AbortController()
    const pending = pusharyCanUseTool({ ...CONFIG, policy: false })('Bash', INPUT, {
      signal: controller.signal,
      toolUseID: 'toolu_1',
    })
    controller.abort()
    await expect(pending).resolves.toEqual({ behavior: 'deny', message: CANCELLED_BEFORE_ANSWER })
  })

  it('stops listening to the run signal once the person has answered', async () => {
    installFetch([answered('yes')])
    const controller = new AbortController()
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener')
    await pusharyCanUseTool(CONFIG)('Bash', INPUT, { signal: controller.signal, toolUseID: 'toolu_1' })
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function))
  })

  it('opens a separate decision for each call when the SDK sends no tool use id', async () => {
    const calls = installFetch([answered('yes')])
    const gate = pusharyCanUseTool({ ...CONFIG, policy: false })
    await gate('Bash', INPUT, options())
    await gate('Bash', INPUT, options())
    const [first, second] = decisionCalls(calls)
    expect(first.body?.idempotencyKey).not.toBe(second.body?.idempotencyKey)
  })

  it('refuses to ask when there is nobody to ask', async () => {
    installFetch([answered('yes')])
    const gate = pusharyCanUseTool({ ...CONFIG, externalId: () => undefined })
    await expect(gate('Bash', INPUT, options('toolu_1'))).rejects.toThrow()
  })
})
