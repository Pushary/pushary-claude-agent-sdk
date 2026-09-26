# @pushary/claude-agent-sdk

Phone approvals for Claude Agent SDK agents. Your agent asks, your user taps Approve or Deny.

## What you need

- A Pushary Partner plan, from $99 a month.
- An API key from [Partner onboarding](https://pushary.com/onboarding/partner).
- Your users install the free Pushary app ([iPhone](https://apps.apple.com/us/app/pushary/id6785677563), [Android](https://play.google.com/store/apps/details?id=com.pushary.app)) and open your connect link once. They never sign up or pay.

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
person, or a function to pick one per call:

```ts
pusharyCanUseTool({ externalId: (toolUse) => ownerOf(toolUse.toolName) })
```

Never take the person from the tool input. The model writes the tool input, so a
prompt injection could send the approval to someone else.

## Your rules answer first

If your site has rules, the gate asks them before it asks a person. A rule can
allow a call without paging anyone, or deny it outright. Rules need a server key
from Settings > API keys; with the key from onboarding, every gated call goes to a
person. Set `policy: false` to always ask a person.

## Options

| Option | What it does |
|---|---|
| `externalId` | The person who answers. Required. |
| `question` | Builds the text the person sees. Defaults to the tool name and its input. |
| `sessionId` | Groups one session's calls, so a replayed turn does not ask twice. |
| `timeoutMs` | How long to wait for an answer before denying. |
| `expiresInSeconds` | How long the question stays answerable. |
| `requireReachable` | Deny at once when the person has no connected phone. |
| `policy` | Ask your rules first. Defaults to `true`. |
| `agentName` | Shown on the approval so the person knows which agent is asking. |
| `apiKey` | Defaults to `PUSHARY_API_KEY`. |

## License

MIT
