import './StatusBar.css'

type Props = {
  message: string
  dirty: boolean
}

export function StatusBar({ message, dirty }: Props) {
  return (
    <footer className="status-bar">
      <span className="status-message">{message}</span>
      <span className="status-meta">{dirty ? '未保存' : '保存済み'}</span>
    </footer>
  )
}
