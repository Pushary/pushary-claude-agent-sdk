import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk'
import type { AskUserQuestionInput } from '@anthropic-ai/claude-agent-sdk/sdk-tools'
import type { collectAnswers } from '../src/clarifying-questions'
import { pusharyCanUseTool } from '../src/index'

type CollectedAnswers = NonNullable<Awaited<ReturnType<typeof collectAnswers>>>

declare const collected: CollectedAnswers

pusharyCanUseTool({ externalId: 'user_1' }) satisfies CanUseTool

collected satisfies NonNullable<AskUserQuestionInput['answers']>
