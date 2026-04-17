import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAutoSave } from '../hooks/useAutoSave'

describe('useAutoSave', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('does not call save immediately on trigger', () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useAutoSave(save, { delay: 500 }))

    act(() => result.current.trigger('hello'))
    expect(save).not.toHaveBeenCalled()
    expect(result.current.status).toBe('idle')
  })

  it('calls save after the debounce delay', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useAutoSave(save, { delay: 500 }))

    act(() => result.current.trigger('hello'))
    await act(async () => { vi.advanceTimersByTime(500) })

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('hello')
  })

  it('debounces — only saves the latest value after rapid triggers', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useAutoSave(save, { delay: 500 }))

    act(() => {
      result.current.trigger('a')
      result.current.trigger('ab')
      result.current.trigger('abc')
    })
    await act(async () => { vi.advanceTimersByTime(500) })

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('abc')
  })

  it('transitions status: idle → saving → saved', async () => {
    let resolveSave!: () => void
    const save = vi.fn().mockImplementation(
      () => new Promise<void>(res => { resolveSave = res })
    )
    const { result } = renderHook(() => useAutoSave(save, { delay: 100 }))

    act(() => result.current.trigger('data'))
    act(() => { vi.advanceTimersByTime(100) })
    expect(result.current.status).toBe('saving')

    await act(async () => { resolveSave() })
    expect(result.current.status).toBe('saved')
  })

  it('sets status to error and stores message on save failure', async () => {
    const save = vi.fn().mockRejectedValue(new Error('Network down'))
    const { result } = renderHook(() => useAutoSave(save, { delay: 100 }))

    act(() => result.current.trigger('data'))
    await act(async () => { vi.advanceTimersByTime(100) })

    expect(result.current.status).toBe('error')
    expect(result.current.error).toBe('Network down')
  })

  it('flush() saves immediately without waiting for the delay', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useAutoSave(save, { delay: 5000 }))

    act(() => result.current.trigger('urgent'))
    await act(async () => { await result.current.flush() })

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('urgent')
  })

  it('flush() is a no-op when there is nothing pending', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useAutoSave(save))

    await act(async () => { await result.current.flush() })
    expect(save).not.toHaveBeenCalled()
  })
})
