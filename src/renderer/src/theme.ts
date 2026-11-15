import type { ITheme } from '@xterm/xterm'
import type { Theme } from '../../shared/types'

export const MONO = 'Menlo, monospace'

export const TERMINAL: Record<Theme, ITheme> = {
  light: {
    background: '#ffffff',
    foreground: '#1f2328',
    cursor: '#d97706',
    cursorAccent: '#ffffff',
    selectionBackground: '#b4d5fe',
    black: '#24292f',
    red: '#cf222e',
    green: '#1a7f37',
    yellow: '#9a6700',
    blue: '#0969da',
    magenta: '#8250df',
    cyan: '#1b7c83',
    white: '#6e7781',
    brightBlack: '#57606a',
    brightRed: '#a40e26',
    brightGreen: '#116329',
    brightYellow: '#633c01',
    brightBlue: '#218bff',
    brightMagenta: '#a475f9',
    brightCyan: '#3192aa',
    brightWhite: '#8c959f'
  },
  dark: {
    background: '#0d1117',
    foreground: '#c9d1d9',
    cursor: '#f0883e',
    cursorAccent: '#0d1117',
    selectionBackground: '#3b5070',
    black: '#484f58',
    red: '#ff7b72',
    green: '#3fb950',
    yellow: '#d29922',
    blue: '#58a6ff',
    magenta: '#bc8cff',
    cyan: '#39c5cf',
    white: '#b1bac4',
    brightBlack: '#6e7681',
    brightRed: '#ffa198',
    brightGreen: '#56d364',
    brightYellow: '#e3b341',
    brightBlue: '#79c0ff',
    brightMagenta: '#d2a8ff',
    brightCyan: '#56d4dd',
    brightWhite: '#f0f6fc'
  }
}
