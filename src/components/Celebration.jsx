import { useEffect, useMemo } from 'react'

// Girly emoji sets. `win` = sparkles/hearts/flowers, `lost` = teary/wilted.
const SETS = {
  win:  ['✨', '💖', '💕', '🌸', '💗', '⭐', '🦄', '💫', '🌷', '🎀'],
  lost: ['💧', '😢', '🥀', '💔', '☔'],
}
// Glitter dot colours per outcome (pink/lavender/gold for win, cool blues for lost).
const COLORS = {
  win:  ['#FF9EC7', '#FFC2E2', '#F7A8D8', '#E75FA6', '#FFD166', '#C9A7EB', '#FFFFFF'],
  lost: ['#9FB4D4', '#7E93B8', '#C7D2E4', '#FFFFFF'],
}

const rnd = (a, b) => a + Math.random() * (b - a)
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

/**
 * Full-screen, click-through overlay. A soft fill rises like an hourglass while
 * girly glitter twinkles over the whole screen. No text.
 *  kind   'win' | 'lost'
 *  onDone called once the animation window is over so the parent can unmount it.
 */
export default function Celebration({ kind, onDone }) {
  const colors = COLORS[kind] || COLORS.win
  const emojis = SETS[kind] || SETS.win

  const glitter = useMemo(() => (
    Array.from({ length: 140 }, (_, id) => ({
      id,
      left: rnd(0, 100),
      top: rnd(0, 100),
      size: rnd(4, 13),
      color: pick(colors),
      dur: rnd(1.1, 2.4),
      delay: rnd(0, 3.4),
    }))
  ), [kind])

  const sparks = useMemo(() => (
    Array.from({ length: 46 }, (_, id) => ({
      id,
      emoji: pick(emojis),
      left: rnd(0, 100),
      top: rnd(0, 100),
      size: rnd(16, 34),
      dur: rnd(1.3, 2.6),
      delay: rnd(0, 3.6),
    }))
  ), [kind])

  useEffect(() => {
    const t = setTimeout(onDone, 4800)
    return () => clearTimeout(t)
  }, [onDone])

  return (
    <div className={'fx-overlay fx-' + kind} role="presentation" aria-hidden="true">
      <div className={'fx-fill ' + (kind === 'win' ? 'fx-fill-win' : 'fx-fill-lost')} />
      {glitter.map((g) => (
        <span
          key={'g' + g.id}
          className="fx-glit"
          style={{
            left: g.left + '%', top: g.top + '%',
            width: g.size + 'px', height: g.size + 'px',
            '--gc': g.color, '--d': g.dur + 's', '--dl': g.delay + 's',
          }}
        />
      ))}
      {sparks.map((s) => (
        <span
          key={'s' + s.id}
          className="fx-spark"
          style={{
            left: s.left + '%', top: s.top + '%', fontSize: s.size + 'px',
            '--d': s.dur + 's', '--dl': s.delay + 's',
          }}
        >
          {s.emoji}
        </span>
      ))}
    </div>
  )
}
