import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { useEffect } from 'react'
import Toolbar from './Toolbar'

interface Props {
  content: string
  onChange: (html: string) => void
  editable?: boolean
  placeholder?: string
  // `key` to remount on doc switch — Tiptap's initial `content` is only read once.
}

// Rich-text editor wrapping Tiptap.
// Baseline extensions: headings, bold, italic, strike, lists, code, code block,
// blockquote, history (undo/redo) — all provided by StarterKit.
export default function Editor({
  content,
  onChange,
  editable = true,
  placeholder = 'Start writing…',
}: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Placeholder.configure({ placeholder }),
    ],
    content,
    editable,
    onUpdate({ editor }) {
      onChange(editor.getHTML())
    },
  })

  // Sync external content changes (e.g. version restore) into the editor.
  useEffect(() => {
    if (!editor) return
    const current = editor.getHTML()
    if (content !== current) {
      editor.commands.setContent(content, false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, editor])

  useEffect(() => {
    if (!editor) return
    editor.setEditable(editable)
  }, [editable, editor])

  return (
    <div className="editor">
      <Toolbar editor={editor} disabled={!editable} />
      <EditorContent editor={editor} className="editor-content" />
    </div>
  )
}
