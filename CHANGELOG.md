# Changelog

## 0.2.0

`AskUserQuestion` now reaches the person as a real question. Each of Claude's questions goes to their phone as a choice between its options, with their descriptions, one at a time, and the answers come back keyed by question text, the way the SDK expects. Before, it arrived as an approval of the raw tool input and Claude got no answers.

The phone takes one choice per question, so a multi-select question says "(choose one)". Each question waits up to `timeoutMs`. Cancelling the run stops before the next question. An unanswered question denies, and Claude is told not to assume an answer. A question too long for the phone is denied with a request to ask it in plain text.

Rules on your site are not asked about questions, including a rule that names `AskUserQuestion`. A tool an MCP server happens to name `AskUserQuestion` still goes through the approval gate.

## 0.1.0

First release. `pusharyCanUseTool()` is a Claude Agent SDK `canUseTool` that sends the permission request to a person's phone and returns allow or deny. `connect()` returns the link that connects a user's phone.

Rules on your site answer first when the key can read them. A denial, an expiry, or nobody answering all deny. Cancelling the run stops the wait and denies at once. A question already on the phone stays there until it expires, and its answer is not used.
