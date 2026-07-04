import { useEffect, useRef, useState } from 'react'
import './ResizeHandle.css'

type Props = {
  direction: 'horizontal' | 'vertical'
  onResize: (delta: number) => void
  title?: string
}

export function ResizeHandle({ direction, onResize, title }: Props) {
  const [dragging, setDragging] = useState(false)
  const lastPos = useRef(0)

  useEffect(() => {
    if (!dragging) return

    const onMove = (event: MouseEvent) => {
      const current = direction === 'horizontal' ? event.clientX : event.clientY
      const delta = current - lastPos.current
      lastPos.current = current
      if (delta !== 0) onResize(delta)
    }

    const onUp = () => setDragging(false)

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    document.body.style.cursor =
      direction === 'horizontal' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'

    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [dragging, direction, onResize])

  return (
    <div
      className={`resize-handle ${direction} ${dragging ? 'dragging' : ''}`}
      title={title}
      onMouseDown={(event) => {
        event.preventDefault()
        lastPos.current =
          direction === 'horizontal' ? event.clientX : event.clientY
        setDragging(true)
      }}
    />
  )
}
