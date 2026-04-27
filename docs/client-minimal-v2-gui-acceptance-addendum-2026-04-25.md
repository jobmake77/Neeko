# Client Minimal V2 GUI Acceptance Addendum

Updated: 2026-04-25
Owner: PM-Orchestrator agent
Audience: Main agent, Desktop agent, QA agent

## Scope

This addendum covers only the current incremental GUI checks for:

- cultivation center relationship-network summary
- `soft_closed` personas not auto-starting deep fetch
- whether chat behavior shows effective use of `training-seed-v3`

## Preconditions

Use at least two personas for the walkthrough:

- Persona A: has non-empty `network_summary` and `training-seed-v3.json`
- Persona B: is marked `soft_closed`

Do not require raw logs or internal debug panels for this pass. Prefer user-visible behavior.

## GUI Checklist

### 1. Cultivation Center: Relationship-Network Summary

- [ ] Expand a persona with network assets and confirm a `关系网摘要` block is visible inside the cultivation detail area
- [ ] Confirm the block shows stable counts for `实体数`, `关系数`, `背景包`, `身份轨迹`, and `待审核候选`
- [ ] Confirm dominant domains render as visible tags when available
- [ ] Confirm summary wording is product-facing and does not expose raw artifact filenames
- [ ] Negative check: when a persona has no network signals, the `关系网摘要` block should not appear as an empty shell

Failure signals:

- summary area appears but all fields are empty or placeholder-only
- domain tags disappear even though the persona has `training-seed-v3` / network assets
- UI exposes internal artifact names instead of user-facing wording

### 2. `soft_closed`: No Automatic Deep Fetch

- [ ] Open a persona already in `soft_closed` state and confirm the page stays in a stable resting state instead of immediately switching to `深抓取中`
- [ ] Confirm the top status copy still indicates the persona has been closed on current public material
- [ ] Confirm `继续培养` is available as an explicit user action for reopening collection
- [ ] Confirm deep fetch starts only after the user clicks `继续培养`, not on page open, expand, or refresh
- [ ] Confirm `检查更新` remains a separate action and does not silently escalate into deep fetch on a `soft_closed` persona

Failure signals:

- entering the page auto-triggers `deep_fetch` or progress churn without user action
- `soft_closed` wording disappears before any explicit continue action
- `检查更新` behaves like hidden `继续培养`

### 3. Chat: Observable Use of `training-seed-v3`

- [ ] Select Persona A and ask one domain-oriented question, one project/fact question, and one relation/background question in chat
- [ ] Confirm the answers show grounded preference toward the persona's dominant domains or anchored project/background facts instead of generic filler
- [ ] Confirm the chat does not incorrectly deny known project or repository facts when cultivation summary already indicates relevant network assets exist
- [ ] Confirm the chat behavior remains user-facing; it should benefit from `training-seed-v3` without exposing `training-seed-v3` as raw UI jargon
- [ ] Negative check: if the persona lacks enough related context, the answer should stay conservative rather than fabricate relation facts

Suggested prompts:

- `你最近主要在做哪些方向？`
- `你做过哪些开源项目或产品？`
- `你和哪些人或组织有比较稳定的合作或关联？`

Failure signals:

- answers are generic and ignore dominant domains already visible in cultivation summary
- the chat denies known project facts despite available network assets
- the chat hallucinates relation facts with unjustified confidence
- UI copy leaks internal implementation wording such as artifact filenames or pipeline labels

## Exit Hint

This increment can be treated as GUI-accepted when:

1. relationship-network summary is visible only when meaningful,
2. `soft_closed` stays passive until explicit user continuation,
3. chat behavior shows grounded improvement consistent with `training-seed-v3` and related network assets.
