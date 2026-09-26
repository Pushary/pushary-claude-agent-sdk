# Changelog

## 0.3.0

Your site's rules are no longer asked by default. Claude's tools have the same names in your own Claude Code, so a rule written for your own sessions, such as one that allows `Bash`, also allowed your users' calls without asking anyone, and a deny rule denied them. Every gated call now goes to a person unless you pass `policy: true`.

A request Pushary refuses or cannot complete no longer throws out of `canUseTool`. No connected phone under `requireReachable`, the wrong plan, a rate limit, an outage and a network error all deny the call, and Claude is told it could not reach a person and not to retry. `requireReachable` now denies at once, as documented.

A call without a tool use id no longer fails on Node 18, which has no global `crypto` by default.

An `AskUserQuestion` that nobody answers in time is taken off the phone before the call is denied, so it cannot be answered after Claude has moved on. If that fails within five seconds, the reason goes to `console.warn` and the question expires on its own. A replay of the same call then denies at once. Approvals still stay on the phone until they expire.

When agents are stopped in Pushary, `AskUserQuestion` denies with `interrupt: true` and Claude is told to end its turn, instead of being told nobody answered. An approval asked during a stop still reads as unanswered.

## 0.2.0

`AskUserQuestion` now reaches the person as a real question. Each of Claude's questions goes to their phone as a choice between its options, with their descriptions, one at a time, and the answers come back keyed by question text, the way the SDK expects. Before, it arrived as an approval of the raw tool input and Claude got no answers.

The phone takes one choice per question, so a multi-select question says "(choose one)". Each question waits up to `timeoutMs`. Cancelling the run stops before the next question. An unanswered question denies, and Claude is told not to assume an answer. A question too long for the phone is denied with a request to ask it in plain text.

Rules on your site are not asked about questions, including a rule that names `AskUserQuestion`. A tool an MCP server happens to name `AskUserQuestion` still goes through the approval gate.

## 0.1.0

First release. `pusharyCanUseTool()` is a Claude Agent SDK `canUseTool` that sends the permission request to a person's phone and returns allow or deny. `connect()` returns the link that connects a user's phone.

Rules on your site answer first when the key can read them. A denial, an expiry, or nobody answering all deny. Cancelling the run stops the wait and denies at once. A question already on the phone stays there until it expires, and its answer is not used.
