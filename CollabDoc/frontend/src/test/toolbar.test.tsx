import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Editor } from '@tiptap/react'
import Toolbar from '../components/Editor/Toolbar'

function makeEditor(overrides: Partial<Editor> = {}): Editor {
  const run = vi.fn()
  const focus = vi.fn(() => ({ toggleBold: vi.fn(() => ({ run })), toggleItalic: vi.fn(() => ({ run })), toggleStrike: vi.fn(() => ({ run })), toggleHeading: vi.fn(() => ({ run })), toggleBulletList: vi.fn(() => ({ run })), toggleOrderedList: vi.fn(() => ({ run })), toggleCode: vi.fn(() => ({ run })), toggleCodeBlock: vi.fn(() => ({ run })), toggleBlockquote: vi.fn(() => ({ run })), undo: vi.fn(() => ({ run })), redo: vi.fn(() => ({ run })) }))
  const chain = vi.fn(() => ({ focus }))
  const can = vi.fn(() => ({ undo: vi.fn(() => true), redo: vi.fn(() => true) }))

  return {
    isActive: vi.fn(() => false),
    chain,
    can,
    ...overrides,
  } as unknown as Editor
}

describe('Toolbar', () => {
  it('renders all expected toolbar buttons', () => {
    const editor = makeEditor()
    render(<Toolbar editor={editor} />)
    expect(screen.getByRole('button', { name: /bold/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /italic/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /heading 1/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /bullet list/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /code block/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /undo/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /redo/i })).toBeInTheDocument()
  })

  it('calls chain().focus().toggleBold() when Bold is clicked', () => {
    const run = vi.fn()
    const toggleBold = vi.fn(() => ({ run }))
    const focus = vi.fn(() => ({ toggleBold } as unknown as ReturnType<ReturnType<typeof editor.chain>['focus']>))
    const chain = vi.fn(() => ({ focus } as unknown as ReturnType<typeof editor.chain>))
    const editor = makeEditor({ chain })

    render(<Toolbar editor={editor} />)
    fireEvent.click(screen.getByRole('button', { name: /bold/i }))

    expect(chain).toHaveBeenCalled()
    expect(focus).toHaveBeenCalled()
    expect(toggleBold).toHaveBeenCalled()
    expect(run).toHaveBeenCalled()
  })

  it('marks Bold button as active when editor.isActive("bold") is true', () => {
    const editor = makeEditor({ isActive: vi.fn((name: string) => name === 'bold') } as Partial<Editor>)
    render(<Toolbar editor={editor} />)

    const boldBtn = screen.getByRole('button', { name: /bold/i })
    expect(boldBtn).toHaveAttribute('aria-pressed', 'true')
    expect(boldBtn.className).toContain('toolbar-btn-active')
  })

  it('disables all buttons when disabled prop is true', () => {
    const editor = makeEditor()
    render(<Toolbar editor={editor} disabled />)

    const buttons = screen.getAllByRole('button')
    buttons.forEach(btn => expect(btn).toBeDisabled())
  })

  it('renders nothing when editor is null', () => {
    const { container } = render(<Toolbar editor={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})
