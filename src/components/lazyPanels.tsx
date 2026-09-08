import { Suspense, lazy, type ComponentProps } from 'react'

/**
 * Heavy panels that used to sit in the entry chunk regardless of whether the
 * user opened them. Chat is ~2k lines, Settings ~1k, and BottomPanel drags in
 * xterm; none of them are needed to paint the first frame.
 *
 * Each export keeps the original component's name and props so App.tsx only
 * swaps the import path — the JSX at the call sites is unchanged.
 */

const ChatPanelLazy = lazy(() =>
  import('./ChatPanel').then((module) => ({ default: module.ChatPanel }))
)
export function ChatPanel(props: ComponentProps<typeof ChatPanelLazy>) {
  return (
    <Suspense
      fallback={<div className="chat-panel" style={{ width: props.width }} aria-hidden />}
    >
      <ChatPanelLazy {...props} />
    </Suspense>
  )
}

const BottomPanelLazy = lazy(() =>
  import('./BottomPanel').then((module) => ({ default: module.BottomPanel }))
)
export function BottomPanel(props: ComponentProps<typeof BottomPanelLazy>) {
  return (
    <Suspense fallback={null}>
      <BottomPanelLazy {...props} />
    </Suspense>
  )
}

const SettingsPanelLazy = lazy(() =>
  import('./SettingsPanel').then((module) => ({ default: module.SettingsPanel }))
)
export function SettingsPanel(props: ComponentProps<typeof SettingsPanelLazy>) {
  return (
    <Suspense fallback={null}>
      <SettingsPanelLazy {...props} />
    </Suspense>
  )
}

const ComposerPanelLazy = lazy(() =>
  import('./ComposerPanel').then((module) => ({ default: module.ComposerPanel }))
)
export function ComposerPanel(props: ComponentProps<typeof ComposerPanelLazy>) {
  return (
    <Suspense fallback={null}>
      <ComposerPanelLazy {...props} />
    </Suspense>
  )
}

const UsagePanelLazy = lazy(() =>
  import('./UsagePanel').then((module) => ({ default: module.UsagePanel }))
)
export function UsagePanel(props: ComponentProps<typeof UsagePanelLazy>) {
  return (
    <Suspense fallback={null}>
      <UsagePanelLazy {...props} />
    </Suspense>
  )
}

const ApplyDiffDialogLazy = lazy(() =>
  import('./ApplyDiffDialog').then((module) => ({ default: module.ApplyDiffDialog }))
)
export function ApplyDiffDialog(props: ComponentProps<typeof ApplyDiffDialogLazy>) {
  return (
    <Suspense fallback={null}>
      <ApplyDiffDialogLazy {...props} />
    </Suspense>
  )
}

const ScmDiffDialogLazy = lazy(() =>
  import('./ScmDiffDialog').then((module) => ({ default: module.ScmDiffDialog }))
)
export function ScmDiffDialog(props: ComponentProps<typeof ScmDiffDialogLazy>) {
  return (
    <Suspense fallback={null}>
      <ScmDiffDialogLazy {...props} />
    </Suspense>
  )
}
