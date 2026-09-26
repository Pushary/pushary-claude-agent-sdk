import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_STOPPED,
  CANCELLED_BEFORE_ANSWER,
  PERSON_UNREACHABLE,
  QUESTION_UNANSWERED,
  QUESTION_UNREADABLE,
  pusharyCanUseTool,
} from './index'

type Responder = () => unknown

interface RecordedCall {
  readonly method: string | undefined
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
  vi.unstubAllGlobals()
})

function installFetch(decisions: readonly Responder[], evaluation: unknown = REQUIRES_HUMAN): RecordedCall[] {
  const calls: RecordedCall[] = []
  let index = 0
  globalThis.fetch = (async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = String(input)
    const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : undefined
    calls.push({ method: init?.method, url, body })
    if (url.endsWith('/authorize')) {
      return { ok: true, status: 200, json: async () => evaluation } as Response
    }
    const json = decisions[Math.min(index, decisions.length - 1)]()
    index += 1
    return { ok: true, status: 200, json: async () => json } as Response
  }) as typeof fetch
  return calls
}

const decisionCalls = (calls: readonly RecordedCall[]) => calls.filter((call) => call.url.endsWith('/decisions'))

const withdrawals = (calls: readonly RecordedCall[]) =>
  calls.filter((call) => call.method === 'DELETE').map((call) => call.url)

const answered = (value: string) => () => ({
  decisionId: 'd1',
  status: 'answered',
  answered: true,
  value,
  type: 'confirm',
})

const chosen = (value: string) => () => ({
  decisionId: 'd1',
  status: 'answered',
  answered: true,
  value,
  type: 'select',
})

const unanswered = () => ({
  decisionId: 'd1',
  status: 'pending',
  answered: false,
  value: null,
  type: 'confirm',
})

const stopped = () => ({
  decisionId: 'd_stop',
  status: 'stopped',
  answered: false,
  type: 'select',
  handoffAction: 'stop',
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

  it('never asks the site rules unless policy is turned on, so a coding-agent rule cannot answer', async () => {
    const calls = installFetch([answered('no')], ALLOWED)
    const result = await pusharyCanUseTool(CONFIG)('Bash', INPUT, options('toolu_1'))
    expect(result).toMatchObject({ behavior: 'deny' })
    expect(calls.some((call) => call.url.endsWith('/authorize'))).toBe(false)
    expect(decisionCalls(calls)).toHaveLength(1)
  })

  it('allows without paging anyone when policy is on and a rule allows the call', async () => {
    const calls = installFetch([answered('no')], ALLOWED)
    const result = await pusharyCanUseTool({ ...CONFIG, policy: true })('Bash', INPUT, options('toolu_1'))
    expect(result).toEqual({ behavior: 'allow', updatedInput: INPUT })
    expect(decisionCalls(calls)).toHaveLength(0)
  })

  it('denies without paging anyone when policy is on and a rule denies the call', async () => {
    const calls = installFetch([answered('yes')], DENIED)
    const result = await pusharyCanUseTool({ ...CONFIG, policy: true })('Bash', INPUT, options('toolu_1'))
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

  it('opens a decision without a tool use id on a runtime with no global crypto', async () => {
    installFetch([answered('yes')])
    vi.stubGlobal('crypto', undefined)
    const result = await pusharyCanUseTool(CONFIG)('Bash', INPUT, options())
    expect(result).toEqual({ behavior: 'allow', updatedInput: INPUT })
  })

  it('refuses to ask when there is nobody to ask', async () => {
    installFetch([answered('yes')])
    const gate = pusharyCanUseTool({ ...CONFIG, externalId: () => undefined })
    await expect(gate('Bash', INPUT, options('toolu_1'))).rejects.toThrow()
  })
})

const CLARIFYING = {
  questions: [
    {
      question: 'How should I format the output?',
      header: 'Format',
      options: [
        { label: 'Summary', description: 'Brief overview' },
        { label: 'Detailed', description: 'Full explanation' },
      ],
      multiSelect: false,
    },
    {
      question: 'Which sections should I include?',
      header: 'Sections',
      options: [
        { label: 'Introduction', description: 'Opening context' },
        { label: 'Conclusion', description: 'Final summary' },
      ],
      multiSelect: true,
    },
  ],
}

describe('pusharyCanUseTool with AskUserQuestion', () => {
  it('asks each question as a choice on the phone and returns the answers keyed by question', async () => {
    const calls = installFetch([chosen('Summary'), chosen('Conclusion')])
    const result = await pusharyCanUseTool(CONFIG)('AskUserQuestion', CLARIFYING, options('toolu_q'))
    expect(result).toEqual({
      behavior: 'allow',
      updatedInput: {
        ...CLARIFYING,
        answers: {
          'How should I format the output?': 'Summary',
          'Which sections should I include?': 'Conclusion',
        },
      },
    })
    const asks = decisionCalls(calls)
    expect(asks).toHaveLength(2)
    expect(asks[0].body).toMatchObject({
      question: 'How should I format the output?',
      type: 'select',
      options: ['Summary', 'Detailed'],
      context: 'Summary: Brief overview\nDetailed: Full explanation',
      externalId: 'user_1',
    })
    expect(asks[0].body?.idempotencyKey).not.toBe(asks[1].body?.idempotencyKey)
  })

  it('tells the person a multi-select question takes one choice, and keys the answer by the original text', async () => {
    const calls = installFetch([chosen('Summary'), chosen('Conclusion')])
    const result = await pusharyCanUseTool(CONFIG)('AskUserQuestion', CLARIFYING, options('toolu_q'))
    expect(decisionCalls(calls)[1].body?.question).toBe('Which sections should I include? (choose one)')
    expect(result.behavior === 'allow' && result.updatedInput.answers).toEqual({
      'How should I format the output?': 'Summary',
      'Which sections should I include?': 'Conclusion',
    })
  })

  it('asks the same decisions again when the SDK replays the same call', async () => {
    const calls = installFetch([chosen('Summary')])
    const gate = pusharyCanUseTool(CONFIG)
    await gate('AskUserQuestion', CLARIFYING, options('toolu_q'))
    await gate('AskUserQuestion', CLARIFYING, options('toolu_q'))
    const keys = decisionCalls(calls).map((call) => call.body?.idempotencyKey)
    expect(keys).toHaveLength(4)
    expect(keys.slice(2)).toEqual(keys.slice(0, 2))
  })

  it('asks no further question once the run is cancelled between questions', async () => {
    const controller = new AbortController()
    const posted: string[] = []
    globalThis.fetch = (async (_input: unknown, init?: { body?: string }) => {
      const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {}
      posted.push(String(body.question))
      controller.abort()
      return { ok: true, status: 200, json: async () => chosen('Summary')() } as Response
    }) as typeof fetch
    const result = await pusharyCanUseTool(CONFIG)('AskUserQuestion', CLARIFYING, {
      signal: controller.signal,
      toolUseID: 'toolu_q',
    })
    expect(result).toEqual({ behavior: 'deny', message: CANCELLED_BEFORE_ANSWER })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(posted).toEqual(['How should I format the output?'])
  })

  it('sends a tool an MCP server named AskUserQuestion through the approval gate', async () => {
    const calls = installFetch([answered('yes')])
    const result = await pusharyCanUseTool({ ...CONFIG, policy: true })('AskUserQuestion', CLARIFYING, {
      ...options('toolu_q'),
      mcpServer: { name: 'other', source: 'user' },
    })
    expect(result).toEqual({ behavior: 'allow', updatedInput: CLARIFYING })
    expect(calls.some((call) => call.url.endsWith('/authorize'))).toBe(true)
    expect(decisionCalls(calls)[0].body).toMatchObject({ type: 'confirm' })
  })

  it('never asks the site rules, because a question is not an action', async () => {
    const calls = installFetch([chosen('Summary'), chosen('Conclusion')], DENIED)
    const result = await pusharyCanUseTool({ ...CONFIG, policy: true })('AskUserQuestion', CLARIFYING, options('toolu_q'))
    expect(result.behavior).toBe('allow')
    expect(calls.some((call) => call.url.endsWith('/authorize'))).toBe(false)
  })

  it('denies and stops asking when a question goes unanswered', async () => {
    const calls = installFetch([unanswered])
    const result = await pusharyCanUseTool(CONFIG)('AskUserQuestion', CLARIFYING, options('toolu_q'))
    expect(result).toEqual({ behavior: 'deny', message: QUESTION_UNANSWERED })
    expect(decisionCalls(calls)).toHaveLength(1)
  })

  it('takes an unanswered question back off the phone', async () => {
    const calls = installFetch([unanswered])
    await pusharyCanUseTool(CONFIG)('AskUserQuestion', CLARIFYING, options('toolu_q'))
    expect(withdrawals(calls)).toEqual(['https://pushary.com/api/v1/server/decisions/d1'])
  })

  it('leaves an answered question where it is', async () => {
    const calls = installFetch([chosen('Summary'), chosen('Conclusion')])
    await pusharyCanUseTool(CONFIG)('AskUserQuestion', CLARIFYING, options('toolu_q'))
    expect(withdrawals(calls)).toEqual([])
  })

  it('finishes taking the question back before it denies', async () => {
    let withdrawn = false
    globalThis.fetch = (async (_input: unknown, init?: { method?: string }) => {
      if (init?.method === 'DELETE') {
        await new Promise((resolve) => setTimeout(resolve, 5))
        withdrawn = true
        return { ok: true, status: 200, json: async () => ({ cancelled: true }) } as Response
      }
      return { ok: true, status: 200, json: async () => unanswered() } as Response
    }) as typeof fetch
    await pusharyCanUseTool(CONFIG)('AskUserQuestion', CLARIFYING, options('toolu_q'))
    expect(withdrawn).toBe(true)
  })

  it('denies the same way when taking the question back fails, and says so', async () => {
    const methods: (string | undefined)[] = []
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    globalThis.fetch = (async (_input: unknown, init?: { method?: string }) => {
      methods.push(init?.method)
      if (init?.method === 'DELETE') throw new TypeError('fetch failed')
      return { ok: true, status: 200, json: async () => unanswered() } as Response
    }) as typeof fetch
    const result = await pusharyCanUseTool(CONFIG)('AskUserQuestion', CLARIFYING, options('toolu_q'))
    expect(result).toEqual({ behavior: 'deny', message: QUESTION_UNANSWERED })
    expect(methods).toEqual(['POST', 'DELETE'])
    expect(warned).toHaveBeenCalledTimes(1)
    warned.mockRestore()
  })

  it('ends the turn instead of reporting no answer when the agent was stopped in Pushary', async () => {
    const calls = installFetch([stopped])
    const result = await pusharyCanUseTool(CONFIG)('AskUserQuestion', CLARIFYING, options('toolu_q'))
    expect(result).toEqual({ behavior: 'deny', message: AGENT_STOPPED, interrupt: true })
    expect(decisionCalls(calls)).toHaveLength(1)
    expect(withdrawals(calls)).toEqual([])
  })

  it('denies without asking anyone when the questions cannot be read', async () => {
    const calls = installFetch([chosen('Summary')])
    const gate = pusharyCanUseTool(CONFIG)
    const twoOptions = [{ label: 'A' }, { label: 'B' }]
    const unreadable = [
      {},
      { questions: [] },
      { questions: 'Pick one?' },
      { questions: [{ question: 'Pick one?', options: [] }] },
      { questions: [{ question: 'Pick one?', options: [{ label: 'Only' }] }] },
      { questions: [{ question: 'Pick one?', options: [{ label: '  ' }, { label: 'B' }] }] },
      { questions: [{ question: 'Pick one?', options: [{ label: 'x'.repeat(201) }, { label: 'B' }] }] },
      { questions: [{ question: 'Pick one?', options: 'A, B' }] },
      { questions: [{ question: 'x'.repeat(501), options: twoOptions }] },
      { questions: [{ question: 'x'.repeat(490), options: twoOptions, multiSelect: true }] },
    ]
    for (const input of unreadable) {
      expect(await gate('AskUserQuestion', input, options('toolu_q'))).toEqual({
        behavior: 'deny',
        message: QUESTION_UNREADABLE,
      })
    }
    expect(calls).toHaveLength(0)
  })

  it('stops waiting and denies when the run is cancelled mid-question', async () => {
    globalThis.fetch = (() => new Promise<Response>(() => undefined)) as typeof fetch
    const controller = new AbortController()
    const pending = pusharyCanUseTool(CONFIG)('AskUserQuestion', CLARIFYING, {
      signal: controller.signal,
      toolUseID: 'toolu_q',
    })
    controller.abort()
    await expect(pending).resolves.toEqual({ behavior: 'deny', message: CANCELLED_BEFORE_ANSWER })
  })
})

const refuseEveryRequest = (failure: number | 'network'): void => {
  globalThis.fetch = (async () => {
    if (failure === 'network') throw new TypeError('fetch failed')
    return { ok: false, status: failure, statusText: '', json: async () => ({ error: 'refused', code: 'refused' }) } as Response
  }) as typeof fetch
}

describe('pusharyCanUseTool when Pushary refuses the ask', () => {
  it.each([409, 403, 429, 503, 'network'] as const)('denies an approval and a question instead of throwing, and says why (%s)', async (failure) => {
    refuseEveryRequest(failure)
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const gate = pusharyCanUseTool({ ...CONFIG, requireReachable: true })
    const unreachable = { behavior: 'deny', message: PERSON_UNREACHABLE }
    await expect(gate('Bash', INPUT, options('toolu_1'))).resolves.toEqual(unreachable)
    await expect(gate('AskUserQuestion', CLARIFYING, options('toolu_q'))).resolves.toEqual(unreachable)
    expect(warned).toHaveBeenCalledTimes(2)
    warned.mockRestore()
  })
})
