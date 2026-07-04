import { useEffect, useRef, useState } from 'react'
import './ResizeHandle.css'

type Props = {
  direction: 'horizontal'
  onResize: (delta: number) => void
  title?: string
}

export function ResizeHandle({ direction, onResize, title }: Props) {
  const [dragging, setDragging] = useState(false)
  const lastX = useRef(0)

  useEffect(() => {
    if (!dragging) return

    const onMove = (event: MouseEvent) => {
      const delta = event.clientX - lastX.current
      lastX.current = event.clientX
      if (delta !== 0) onResize(delta)
    }

    const onUp = () => setDragging(false)

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [dragging, onResize])

  return (
    <div
      className={`resize-handle ${direction} ${dragging ? 'dragging' : ''}`}
      title={title}
      onMouseDown={(event) => {
        event.preventDefault()
        lastX.current = event.clientX
        setDragging(true)
      }}
    />
  )
}
