# @pushary/claude-agent-sdk

Phone approvals for Claude Agent SDK agents. Your agent asks, your user taps Approve or Deny.

## What you need

- A Pushary Partner plan, from $99 a month. [Start the trial](https://pushary.com/sign-up?from=agent&plan=partner&utm_source=github&utm_medium=oss-adapter&utm_campaign=pushary-claude-agent-sdk&utm_content=partner-start).
- An API key from [Partner onboarding](https://pushary.com/onboarding/partner?utm_source=github&utm_medium=oss-adapter&utm_campaign=pushary-claude-agent-sdk&utm_content=partner-start).
- Your users install the free Pushary app ([iPhone](https://apps.apple.com/us/app/pushary/id6785677563), [Android](https://play.google.com/store/apps/details?id=com.pushary.app)) and open your connect link once. They never sign up or pay.

## What your customer gets

1. They open your connect link once. It shows your product's name and logo and connects their phone.
2. When Claude wants a tool that needs permission, a push notification titled with your product name arrives, such as **Acme needs your approval**. Claude's `AskUserQuestion` questions arrive as choices.
3. They tap Approve or Deny, or pick an answer. Deny, or no answer in time, returns a denial Claude can read, and the tool does not run.

Pushary hosts the phone delivery, the decision record and the [audit log](https://pushary.com/docs/agents/audit-log?utm_source=github&utm_medium=oss-adapter&utm_campaign=pushary-claude-agent-sdk&utm_content=readme). Your app keeps its own sign-in, the Claude Agent SDK session and the tools it runs.

## Install

```bash
npm i @pushary/claude-agent-sdk @anthropic-ai/claude-agent-sdk
export PUSHARY_API_KEY=pk_xxx.sk_xxx
```

## Gate every tool call on a person

```ts
import { query } from '@anthropic-ai/claude-agent-sdk'
import { pusharyCanUseTool } from '@pushary/claude-agent-sdk'

for await (const message of query({
  prompt: 'Refund order 1234',
  options: { canUseTool: pusharyCanUseTool({ externalId: user.id }) },
})) {
  if (message.type === 'result') console.log(message.subtype)
}
```

When the agent wants to run a tool that needs permission, the SDK calls
`canUseTool`. Pushary sends the question to that user's phone and waits. Approve
runs the tool with its input unchanged. Deny, or nobody answering, returns a denial
the model can read, and the tool does not run. Cancelling the run stops the wait and
denies at once.

Tools you already allow with `allowedTools` never reach `canUseTool`, so the person
only sees the calls that need them. See the SDK's own
[permissions guide](https://code.claude.com/docs/en/agent-sdk/permissions).

## Connect a user's phone once

```ts
import { connect } from '@pushary/claude-agent-sdk'

const { universalLink } = await connect({ apiKey: process.env.PUSHARY_API_KEY! }, user.id)
```

Show `universalLink` to the signed-in user as a button or QR code. They open it on
their phone once.

## Who answers

`externalId` is your own id for the user. Pass a string to bind every call to one
person, or a function to pick one per call. The function also runs for
`AskUserQuestion`:

```ts
pusharyCanUseTool({ externalId: (toolUse) => ownerOf(toolUse.toolName) })
```

Never take the person from the tool input. The model writes the tool input, so a
prompt injection could send the approval to someone else.

## Clarifying questions

When Claude calls `AskUserQuestion`, the same `canUseTool` puts each question on the
person's phone as a choice between Claude's options, with each option's description,
one question at a time, and returns their picks as the answers. Each question waits up
to `timeoutMs`. If a question goes unanswered, it is taken off the phone before the call
is denied, and Claude is told not to assume an answer. If Pushary cannot take it back
within five seconds, the reason goes to `console.warn` and the question expires on its
own.

The phone takes one choice per question, so a multi-select question says "(choose
one)" and comes back with the one option the person picked. Your rules are not asked
about questions, including a rule that names `AskUserQuestion`, because a question is
not an action. A question too long for the phone is denied, and Claude is told to ask
it in plain text instead.

## Site rules are off unless you turn them on

Claude's tools have the same names in your own Claude Code: `Bash`, `Read`, `Write`,
`WebFetch`. A rule you wrote for your own Claude Code sessions would also answer your
users' calls, so by default every gated call goes to a person.

Set `policy: true` to ask your site's rules first. A rule can then allow a call
without paging anyone, or deny it outright. Only turn it on for a site whose rules
you wrote for this agent. Rules need a server key from Settings > API keys. With the
key from onboarding, `policy: true` has no effect and every gated call still goes to a
person.

## Options

| Option | What it does |
|---|---|
| `externalId` | The person who answers. Required. |
| `question` | Builds the approval text the person sees. Defaults to the tool name and its input. Not used for `AskUserQuestion`. |
| `sessionId` | Groups one session's calls, so a replayed turn does not ask twice. |
| `timeoutMs` | How long to wait for an answer before denying. Applies to each clarifying question in turn. |
| `expiresInSeconds` | How long the question stays answerable. |
| `requireReachable` | Deny at once when the person has no connected phone. |
| `policy` | Ask your site's rules before a person. Defaults to `false`. |
| `agentName` | Shown on the approval so the person knows which agent is asking. |
| `apiKey` | Defaults to `PUSHARY_API_KEY`. |

## For your own agents

This package asks your users. For Claude agents you run for yourself, you need no package. One `mcpServers` entry connects the SDK to the hosted Pushary MCP server, and the agent's questions reach your own phone. That works on the Agent, Agent Pro or Team plan. The [adapters guide](https://pushary.com/docs/agents/adapters?utm_source=github&utm_medium=oss-adapter&utm_campaign=pushary-claude-agent-sdk&utm_content=readme#claude-agent-sdk) has the snippet, and the plans are on the [pricing page](https://pushary.com/pricing?utm_source=github&utm_medium=oss-adapter&utm_campaign=pushary-claude-agent-sdk&utm_content=readme).

## Links

- [Human in the loop for the Claude Agent SDK](https://pushary.com/human-in-the-loop-claude-agent-sdk?utm_source=github&utm_medium=oss-adapter&utm_campaign=pushary-claude-agent-sdk&utm_content=readme): what your customer sees, with the full example.
- [Claude Agent SDK guide](https://pushary.com/docs/agents/build/claude-agent-sdk?utm_source=github&utm_medium=oss-adapter&utm_campaign=pushary-claude-agent-sdk&utm_content=readme) in the Pushary docs.
- [Partner plan](https://pushary.com/partners?utm_source=github&utm_medium=oss-adapter&utm_campaign=pushary-claude-agent-sdk&utm_content=readme), from $99 a month.
- [Browser demo](https://pushary.com/try?utm_source=github&utm_medium=oss-adapter&utm_campaign=pushary-claude-agent-sdk&utm_content=readme) of one approval.
- Other adapters: [Codex app-server](https://github.com/Pushary/pushary-codex-app-server), [OpenAI Agents SDK](https://github.com/Pushary/pushary-openai-agents), [Vercel AI SDK](https://github.com/Pushary/pushary-ai-sdk).

## License

MIT
