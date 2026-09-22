# Future Issue: Provider Ask Cancel completion race

## Status
Open — deferred from 92041 / 92042 (v0.1.2)

## Scope
- OpenAI Ask
- Gemini Ask
- Claude Ask

## Not in scope
- Cursor Agent Cancel (fixed in 85e610aa / shipped in v0.1.2)

## Symptom
`cancelChatStream` / abort may return success (`cancelOk=true`), but the Ask stream can still terminate as `done` instead of `cancelled`.

## User impact
Usually mild: the UI unlocks on Cancel, but completion classification may look like a normal finish. Does not block Cursor Cloud Cancel.

## Decision for v0.1.2
Do not expand fix scope. Document as Known Issue. Track for a later release.
