import { useCallback, useRef, useState } from 'react'

export type UndoCommand = {
  apply: () => Promise<void>
  revert: () => Promise<void>
}

export function useUndoRedo(maxDepth = 50) {
  const undoStack = useRef<UndoCommand[]>([])
  const redoStack = useRef<UndoCommand[]>([])
  const [undoLen, setUndoLen] = useState(0)
  const [redoLen, setRedoLen] = useState(0)

  const push = useCallback(
    async (cmd: UndoCommand) => {
      await cmd.apply()
      undoStack.current.push(cmd)
      if (undoStack.current.length > maxDepth) undoStack.current.shift()
      redoStack.current = []
      setUndoLen(undoStack.current.length)
      setRedoLen(0)
    },
    [maxDepth],
  )

  const undo = useCallback(async () => {
    const cmd = undoStack.current.pop()
    if (!cmd) return
    await cmd.revert()
    redoStack.current.push(cmd)
    setUndoLen(undoStack.current.length)
    setRedoLen(redoStack.current.length)
  }, [])

  const redo = useCallback(async () => {
    const cmd = redoStack.current.pop()
    if (!cmd) return
    await cmd.apply()
    undoStack.current.push(cmd)
    setUndoLen(undoStack.current.length)
    setRedoLen(redoStack.current.length)
  }, [])

  return {
    push,
    undo,
    redo,
    canUndo: undoLen > 0,
    canRedo: redoLen > 0,
  }
}
