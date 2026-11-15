// Monaco bundled locally: core editor + syntax-only languages. No language services,
// so no TS/JSON workers and no bogus squiggles on files outside their project context.
// Plugins add languages and token colors on top, through the same instance.
// features/register.all is the editor's contributions (diff, find, folding…) without the
// language services and LSP client that editor.main brings.
import 'monaco-editor/features/register.all'
import 'monaco-editor/basic-languages/monaco.contribution'
import * as monaco from 'monaco-editor/editor/editor.api'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import type { Theme } from '../../shared/types'

self.MonacoEnvironment = { getWorker: () => new EditorWorker() }

// ⌘E is Toggle README. Monaco's Find with Selection would swallow it whenever the editor has focus.
monaco.editor.addKeybindingRule({ keybinding: monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyE, command: '-actions.findWithSelection' })

// Token colors come from plugins (addThemeRules); the base themes color the basic languages.
const COLORS: Record<Theme, { base: 'vs' | 'vs-dark'; colors: monaco.editor.IColors }> = {
  light: {
    base: 'vs',
    colors: {
      'editor.background': '#ffffff',
      'editor.lineHighlightBackground': '#f6f8fa',
      'editorLineNumber.foreground': '#8c959f',
      'editorLineNumber.activeForeground': '#1f2328',
      'editorCursor.foreground': '#d97706',
      'diffEditor.insertedTextBackground': '#1a7f3725',
      'diffEditor.removedTextBackground': '#cf222e25',
      'diffEditor.insertedLineBackground': '#dafbe1',
      'diffEditor.removedLineBackground': '#ffebe9',
      'editorGutter.addedBackground': '#1a7f37',
      'editorGutter.modifiedBackground': '#9a6700',
      'editorGutter.deletedBackground': '#cf222e'
    }
  },
  dark: {
    base: 'vs-dark',
    colors: {
      'editor.background': '#0d1117',
      'editor.lineHighlightBackground': '#161b22',
      'editorLineNumber.foreground': '#484f58',
      'editorLineNumber.activeForeground': '#c9d1d9',
      'editorCursor.foreground': '#f0883e',
      'diffEditor.insertedTextBackground': '#2ea04330',
      'diffEditor.removedTextBackground': '#f8514930',
      'diffEditor.insertedLineBackground': '#2ea04318',
      'diffEditor.removedLineBackground': '#f8514918',
      'editorGutter.addedBackground': '#3fb950',
      'editorGutter.modifiedBackground': '#d29922',
      'editorGutter.deletedBackground': '#f85149'
    }
  }
}
const rules: Record<Theme, monaco.editor.ITokenThemeRule[]> = { light: [], dark: [] }
let current: Theme = 'light'

function define(): void {
  for (const t of ['light', 'dark'] as const) {
    monaco.editor.defineTheme(t === 'dark' ? 'cc-dark' : 'cc-light', { base: COLORS[t].base, inherit: true, rules: rules[t], colors: COLORS[t].colors })
  }
}
define()

export function addThemeRules(light: monaco.editor.ITokenThemeRule[], dark: monaco.editor.ITokenThemeRule[]): void {
  rules.light.push(...light)
  rules.dark.push(...dark)
  define()
  setMonacoTheme(current)
}

export function setMonacoTheme(theme: Theme): void {
  current = theme
  monaco.editor.setTheme(theme === 'dark' ? 'cc-dark' : 'cc-light')
}

export { monaco }
