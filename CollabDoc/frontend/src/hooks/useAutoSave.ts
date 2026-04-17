import { useCallback, useEffect, useRef, useState } from 'react'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

interface Options {
  // Milliseconds to wait after the last change before saving.
  delay?: number
  // Milliseconds after a successful save before the status reverts to 'idle'.
  // Keeps the "Saved" indicator visible briefly.
  savedDisplayMs?: number
}

export interface AutoSaveControls {
  status: SaveStatus
  error: string | null
  // Call with the new value any time the user changes something.
  trigger: (value: unknown) => void
  // Force an immediate save of the current pending value (for tab close, etc.).
  flush: () => Promise<void>
}

// Debounces arbitrary save calls. Tracks status for UI indicators.
// `save` runs with whatever the most-recent value was when the debounce fires.
export function useAutoSave(
  save: (value: unknown) => Promise<void>,
  { delay = 1000, savedDisplayMs = 2000 }: Options = {},
): AutoSaveControls {
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  const pendingValueRef = useRef<unknown>(undefined)
  const hasPendingRef = useRef(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedResetRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveRef = useRef(save)

  // Keep the latest save fn without retriggering the debounce.
  useEffect(() => { saveRef.current = save }, [save])

  const runSave = useCallback(async () => {
    if (!hasPendingRef.current) return
    const value = pendingValueRef.current
    hasPendingRef.current = false

    setStatus('saving')
    setError(null)
    try {
      await saveRef.current(value)
      setStatus('saved')
      if (savedResetRef.current) clearTimeout(savedResetRef.current)
      savedResetRef.current = setTimeout(() => setStatus('idle'), savedDisplayMs)
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Save failed')
    }
  }, [savedDisplayMs])

  const trigger = useCallback(
    (value: unknown) => {
      pendingValueRef.current = value
      hasPendingRef.current = true

      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(() => {
        runSave()
      }, delay)
    },
    [delay, runSave],
  )

  const flush = useCallback(async () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    await runSave()
  }, [runSave])

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      if (savedResetRef.current) clearTimeout(savedResetRef.current)
    }
  }, [])

  return { status, error, trigger, flush }
}
