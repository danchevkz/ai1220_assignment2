import type { Editor } from '@tiptap/react'

interface Props {
  editor: Editor | null
  disabled?: boolean
}

// Each button reads editor.isActive(...) reactively via the key the parent
// component passes. The parent re-renders on selection change.
export default function Toolbar({ editor, disabled }: Props) {
  if (!editor) return null

  return (
    <div className="editor-toolbar" role="toolbar" aria-label="Formatting">
      <ToolbarButton
        label="Bold"
        active={editor.isActive('bold')}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <b>B</b>
      </ToolbarButton>

      <ToolbarButton
        label="Italic"
        active={editor.isActive('italic')}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <i>I</i>
      </ToolbarButton>

      <ToolbarButton
        label="Strike"
        active={editor.isActive('strike')}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <s>S</s>
      </ToolbarButton>

      <div className="editor-toolbar-divider" />

      <ToolbarButton
        label="Heading 1"
        active={editor.isActive('heading', { level: 1 })}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      >
        H1
      </ToolbarButton>

      <ToolbarButton
        label="Heading 2"
        active={editor.isActive('heading', { level: 2 })}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        H2
      </ToolbarButton>

      <ToolbarButton
        label="Heading 3"
        active={editor.isActive('heading', { level: 3 })}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        H3
      </ToolbarButton>

      <div className="editor-toolbar-divider" />

      <ToolbarButton
        label="Bullet list"
        active={editor.isActive('bulletList')}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        • List
      </ToolbarButton>

      <ToolbarButton
        label="Ordered list"
        active={editor.isActive('orderedList')}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        1. List
      </ToolbarButton>

      <div className="editor-toolbar-divider" />

      <ToolbarButton
        label="Code"
        active={editor.isActive('code')}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        {'<>'}
      </ToolbarButton>

      <ToolbarButton
        label="Code block"
        active={editor.isActive('codeBlock')}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      >
        {'{ }'}
      </ToolbarButton>

      <ToolbarButton
        label="Blockquote"
        active={editor.isActive('blockquote')}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        ❝
      </ToolbarButton>

      <div className="editor-toolbar-divider" />

      <ToolbarButton
        label="Undo"
        disabled={disabled || !editor.can().undo()}
        onClick={() => editor.chain().focus().undo().run()}
      >
        ↶
      </ToolbarButton>

      <ToolbarButton
        label="Redo"
        disabled={disabled || !editor.can().redo()}
        onClick={() => editor.chain().focus().redo().run()}
      >
        ↷
      </ToolbarButton>
    </div>
  )
}

interface ToolbarButtonProps {
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}

function ToolbarButton({ label, active, disabled, onClick, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`toolbar-btn ${active ? 'toolbar-btn-active' : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  )
}
