#!/bin/sh
# $CUCKCODE_HOOK: an agent's hook runs this to let a cuckcode plugin answer for it (a permission, a
# question). It sends the hook's stdin and its session ($CUCKCODE_SESSION) to the app's socket
# ($CUCKCODE_SOCKET) and prints the reply. With no app, no plugin listening, or no answer in time, it
# prints nothing and exits 0: a hook's "no decision", so the agent asks in its own terminal.
# One line each, so the app needs no end of input to read them: the session, then stdin in base64.
# -w: the app gives up on a request after 5 minutes; this gives up a little later, should it hang.
[ -n "$CUCKCODE_SESSION" ] && [ -n "$CUCKCODE_SOCKET" ] && [ -S "$CUCKCODE_SOCKET" ] || exit 0
{
  printf '%s\n' "$CUCKCODE_SESSION"
  base64 | tr -d '\n'
  printf '\n'
} | nc -U -w 310 "$CUCKCODE_SOCKET" 2>/dev/null
exit 0
