import { describe, it, expect } from 'vitest'
import {
  aiReducer,
  initialAIState,
  acceptedText,
  combinedText,
  outcomeFromChunks,
  isStreaming,
  isTerminal,
} from '../ai/aiState'
import type { AISuggestionState } from '../types'

function streamingState(overrides: Partial<AISuggestionState> = {}): AISuggestionState {
  return {
    action: 'rewrite',
    sourceText: 'src',
    chunks: [],
    status: 'streaming',
    error: null,
    interactionId: null,
    ...overrides,
  }
}

describe('aiReducer', () => {
  it('start switches to streaming and resets chunks', () => {
    const next = aiReducer(initialAIState, {
      type: 'start',
      action: 'summarize',
      sourceText: 'hello',
    })
    expect(next.status).toBe('streaming')
    expect(next.action).toBe('summarize')
    expect(next.sourceText).toBe('hello')
    expect(next.chunks).toEqual([])
    expect(next.interactionId).toBeNull()
  })

  it('chunk event creates a new streaming chunk', () => {
    const next = aiReducer(streamingState(), {
      type: 'event',
      event: { type: 'chunk', id: 'c1', text: 'Hello' },
    })
    expect(next.chunks).toEqual([{ id: 'c1', text: 'Hello', status: 'streaming' }])
  })

  it('repeated chunk events for the same id append to text', () => {
    const a = aiReducer(streamingState(), {
      type: 'event',
      event: { type: 'chunk', id: 'c1', text: 'Hello' },
    })
    const b = aiReducer(a, {
      type: 'event',
      event: { type: 'chunk', id: 'c1', text: ' world' },
    })
    expect(b.chunks).toEqual([{ id: 'c1', text: 'Hello world', status: 'streaming' }])
  })

  it('chunk_end marks the chunk complete', () => {
    const a = aiReducer(streamingState(), {
      type: 'event',
      event: { type: 'chunk', id: 'c1', text: 'x' },
    })
    const b = aiReducer(a, { type: 'event', event: { type: 'chunk_end', id: 'c1' } })
    expect(b.chunks[0].status).toBe('complete')
  })

  it('done finalizes status, sets interactionId, and completes any streaming chunks', () => {
    const a = aiReducer(streamingState(), {
      type: 'event',
      event: { type: 'chunk', id: 'c1', text: 'x' },
    })
    const b = aiReducer(a, {
      type: 'event',
      event: { type: 'done', interaction_id: 'int-9' },
    })
    expect(b.status).toBe('done')
    expect(b.interactionId).toBe('int-9')
    expect(b.chunks[0].status).toBe('complete')
  })

  it('error event flips status to error and stores detail', () => {
    const next = aiReducer(streamingState(), {
      type: 'event',
      event: { type: 'error', detail: 'boom' },
    })
    expect(next.status).toBe('error')
    expect(next.error).toBe('boom')
  })

  it('cancel from streaming sets cancelled and completes streaming chunks', () => {
    const a = aiReducer(streamingState(), {
      type: 'event',
      event: { type: 'chunk', id: 'c1', text: 'x' },
    })
    const b = aiReducer(a, { type: 'cancel' })
    expect(b.status).toBe('cancelled')
    expect(b.chunks[0].status).toBe('complete')
  })

  it('cancel is a noop unless streaming', () => {
    const done = streamingState({ status: 'done' })
    expect(aiReducer(done, { type: 'cancel' })).toBe(done)
  })

  it('set_chunk_status updates a single chunk', () => {
    const start = streamingState({
      chunks: [
        { id: 'c1', text: 'x', status: 'complete' },
        { id: 'c2', text: 'y', status: 'complete' },
      ],
    })
    const next = aiReducer(start, { type: 'set_chunk_status', chunkId: 'c1', status: 'accepted' })
    expect(next.chunks[0].status).toBe('accepted')
    expect(next.chunks[1].status).toBe('complete')
  })

  it('set_all_chunks_status preserves already-decided chunks', () => {
    const start = streamingState({
      chunks: [
        { id: 'c1', text: 'x', status: 'accepted' },
        { id: 'c2', text: 'y', status: 'rejected' },
        { id: 'c3', text: 'z', status: 'complete' },
      ],
    })
    const next = aiReducer(start, { type: 'set_all_chunks_status', status: 'accepted' })
    expect(next.chunks.map(c => c.status)).toEqual(['accepted', 'rejected', 'accepted'])
  })

  it('edit_chunk replaces chunk text', () => {
    const start = streamingState({
      chunks: [{ id: 'c1', text: 'old', status: 'complete' }],
    })
    const next = aiReducer(start, { type: 'edit_chunk', chunkId: 'c1', text: 'new' })
    expect(next.chunks[0].text).toBe('new')
  })

  it('reset returns to initial state', () => {
    const filthy = streamingState({ chunks: [{ id: 'x', text: 'x', status: 'accepted' }] })
    expect(aiReducer(filthy, { type: 'reset' })).toEqual(initialAIState)
  })
})

describe('AI state helpers', () => {
  it('combinedText joins chunk text with double newlines', () => {
    const s = streamingState({
      chunks: [
        { id: 'c1', text: 'one', status: 'complete' },
        { id: 'c2', text: 'two', status: 'complete' },
      ],
    })
    expect(combinedText(s)).toBe('one\n\ntwo')
  })

  it('acceptedText only includes accepted chunks', () => {
    const s = streamingState({
      chunks: [
        { id: 'c1', text: 'one', status: 'accepted' },
        { id: 'c2', text: 'two', status: 'rejected' },
        { id: 'c3', text: 'three', status: 'accepted' },
      ],
    })
    expect(acceptedText(s)).toBe('one\n\nthree')
  })

  it('outcomeFromChunks reports partial when there is a mix', () => {
    expect(outcomeFromChunks([
      { id: 'a', text: '', status: 'accepted' },
      { id: 'b', text: '', status: 'rejected' },
    ])).toBe('partial')
    expect(outcomeFromChunks([
      { id: 'a', text: '', status: 'accepted' },
      { id: 'b', text: '', status: 'accepted' },
    ])).toBe('accepted')
    expect(outcomeFromChunks([
      { id: 'a', text: '', status: 'rejected' },
    ])).toBe('rejected')
    expect(outcomeFromChunks([
      { id: 'a', text: '', status: 'complete' },
    ])).toBe('pending')
    expect(outcomeFromChunks([])).toBe('pending')
  })

  it('isStreaming and isTerminal classify status correctly', () => {
    expect(isStreaming('streaming')).toBe(true)
    expect(isStreaming('done')).toBe(false)
    expect(isTerminal('done')).toBe(true)
    expect(isTerminal('cancelled')).toBe(true)
    expect(isTerminal('error')).toBe(true)
    expect(isTerminal('streaming')).toBe(false)
    expect(isTerminal('idle')).toBe(false)
  })
})
