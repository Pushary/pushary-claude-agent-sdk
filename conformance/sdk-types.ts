import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk'
import type { AskUserQuestionInput } from '@anthropic-ai/claude-agent-sdk/sdk-tools'
import type { CollectedAnswers } from '../src/clarifying-questions'
import { pusharyCanUseTool } from '../src/index'

type Answers = Extract<CollectedAnswers, { readonly answered: true }>['answers']

declare const collected: Answers

pusharyCanUseTool({ externalId: 'user_1' }) satisfies CanUseTool

collected satisfies NonNullable<AskUserQuestionInput['answers']>
