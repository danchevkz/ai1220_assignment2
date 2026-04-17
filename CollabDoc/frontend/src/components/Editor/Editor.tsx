import { useEditor, EditorContent, type Extensions } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import { useEffect, useMemo } from 'react'
import * as Y from 'yjs'
import Toolbar from './Toolbar'

// Minimal surface CollaborationCursor needs — we accept this rather than the
// full WebsocketProvider so the prop type is easy to satisfy from tests.
interface AwarenessProviderLike {
  awareness: unknown
}

interface Props {
  // When `ydoc` is provided, the editor binds to Yjs — `content` is ignored
  // for initial load (Y.Doc is the source of truth). When absent, the editor
  // runs in local-only mode with `content` as the initial value.
  ydoc?: Y.Doc
  // When provided together with `ydoc`, renders remote cursors and selections.
  awarenessProvider?: AwarenessProviderLike
  user?: { name: string; color: string }
  content?: string
  onChange?: (html: string) => void
  onActivity?: () => void
  editable?: boolean
  placeholder?: string
}

export default function Editor({
  ydoc,
  awarenessProvider,
  user,
  content = '',
  onChange,
  onActivity,
  editable = true,
  placeholder = 'Start writing…',
}: Props) {
  const isCollab = Boolean(ydoc)
  const showCursors = Boolean(ydoc && awarenessProvider && user)

  const extensions = useMemo(() => {
    // History is managed by Yjs/Collaboration in collab mode. StarterKit's
    // built-in history would fight the CRDT, so we disable it there.
    const baseKit = StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      ...(isCollab ? { history: false } : {}),
    })

    const base: Extensions = [baseKit, Placeholder.configure({ placeholder })]
    if (ydoc) {
      base.push(Collaboration.configure({ document: ydoc }))
    }
    if (showCursors && awarenessProvider && user) {
      base.push(
        CollaborationCursor.configure({
          provider: awarenessProvider,
          user,
        }),
      )
    }
    return base
    // user object identity changes shouldn't rebuild the editor, so we
    // depend on its fields explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ydoc, awarenessProvider, user?.name, user?.color, placeholder, isCollab, showCursors])

  const editor = useEditor(
    {
      extensions,
      content: isCollab ? undefined : content,
      editable,
      onUpdate({ editor }) {
        onChange?.(editor.getHTML())
        onActivity?.()
      },
    },
    // Rebuild the editor if the underlying Y.Doc changes (doc switch).
    [ydoc],
  )

  // Sync external content only in local mode. In collab mode the Y.Doc owns it.
  useEffect(() => {
    if (!editor || isCollab) return
    const current = editor.getHTML()
    if (content !== current) {
      editor.commands.setContent(content, false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, editor, isCollab])

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
