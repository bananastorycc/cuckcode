#!/bin/sh
# $CUCKCODE_NOTIFY: an agent's hooks run this with a message to light up its cuckcode tab and send
# a notification. Hooks often run detached, without /dev/tty, so it writes an OSC 777 to the
# terminal of the nearest ancestor that has one: the agent's.
p=$PPID
i=0
while [ "$i" -lt 8 ] && [ -n "$p" ] && [ "$p" -gt 1 ]; do
  t=$(ps -o tty= -p "$p" 2>/dev/null | tr -d ' ')
  case "$t" in
    '' | '?' | '??') p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ') ;;
    *)
      printf '\033]777;notify;cuckcode;%s\007' "$1" 2>/dev/null >"/dev/$t"
      exit 0
      ;;
  esac
  i=$((i + 1))
done
exit 0
