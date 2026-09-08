import { useCallback, useEffect, useState } from 'react'

/**
 * Neither the file tree nor the Problems panel is virtualized, so a directory
 * with thousands of entries would mount thousands of nodes at once and freeze
 * the UI. Rendering a page at a time keeps the first paint cheap while still
 * letting the user reach everything.
 */
export const LIST_PAGE_SIZE = 200

export type ListPage<T> = {
  visible: T[]
  /** How many items are held back; 0 means everything is on screen. */
  hidden: number
}

/** Returns the same array instance when nothing is truncated, to keep renders cheap. */
export function sliceListPage<T>(items: T[], shown: number): ListPage<T> {
  const limit = Math.max(0, Math.floor(shown))
  if (limit >= items.length) return { visible: items, hidden: 0 }
  return { visible: items.slice(0, limit), hidden: items.length - limit }
}

export function nextPageCount(shown: number, pageSize = LIST_PAGE_SIZE): number {
  const size = pageSize > 0 ? Math.floor(pageSize) : LIST_PAGE_SIZE
  return Math.max(0, Math.floor(shown)) + size
}

export type IncrementalList<T> = ListPage<T> & {
  showMore: () => void
}

export function useIncrementalList<T>(
  items: T[],
  pageSize = LIST_PAGE_SIZE
): IncrementalList<T> {
  const [shown, setShown] = useState(pageSize)

  // A new list (different folder, new diagnostics) starts from the first page.
  useEffect(() => {
    setShown(pageSize)
  }, [items, pageSize])

  const showMore = useCallback(() => {
    setShown((current) => nextPageCount(current, pageSize))
  }, [pageSize])

  const page = sliceListPage(items, shown)
  return { ...page, showMore }
}
