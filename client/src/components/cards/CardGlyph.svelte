<script lang="ts">
  import type { CardDTO } from '../../types/protocol'
  import { CARD_GLYPH, CARD_GLYPH_INK, SUIT_PAINT } from './cardTheme'
  import { FAN, GLYPH_STROKE, glyphShapes, type GlyphShape } from './cardGlyphs'

  type Props = { kind: CardDTO['kind'] }
  let { kind }: Props = $props()

  const shapes = $derived(glyphShapes(kind))

  /** The stroke a rect carries in its own right, or the pass's. */
  function rectStroke(shape: Extract<GlyphShape, { kind: 'rect' }>, inked: boolean, i: number) {
    if (inked || shape.stroke !== 'suit') return undefined
    return SUIT_PAINT[FAN[i % FAN.length].color].from
  }
</script>

<!--
  Deliberately unsized: the parent (.value / .corner) owns how big a glyph is, the
  same way it owns how big a numeral is.
-->
{#if shapes}
  <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
    <!--
      Drawn twice: an ink pass, then the glyph over it. Same reason the numerals
      carry a text-stroke — a light glyph on the green or yellow suit is otherwise
      about 1.2:1. A stroked icon has no fill to outline, so the outline has to be
      a wider copy underneath.

      Some glyphs carry their own stroke widths (three outlined cards at
      GLYPH_STROKE close into three solid bars), and a child's `stroke-width`
      beats whatever the pass sets on its group. So each shape may name both
      widths and the pass picks one, rather than the pass widening everything.
    -->
    {#each [true, false] as inked (inked)}
      <g
        fill="none"
        stroke={inked ? CARD_GLYPH_INK : CARD_GLYPH}
        stroke-width={inked ? GLYPH_STROKE + 9 : GLYPH_STROKE}
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        {#each shapes as shape, i (i)}
          {#if shape.kind === 'circle'}
            <circle cx={shape.cx} cy={shape.cy} r={shape.r} />
          {:else if shape.kind === 'path'}
            <path
              d={shape.d}
              stroke-width={inked ? shape.inkStrokeWidth : shape.strokeWidth}
              fill={shape.fill === 'glyph' ? (inked ? CARD_GLYPH_INK : CARD_GLYPH) : undefined}
            />
          {:else if shape.kind === 'rect'}
            <rect
              x={shape.x}
              y={shape.y}
              width={shape.width}
              height={shape.height}
              rx={shape.rx}
              transform={shape.transform}
              stroke={rectStroke(shape, inked, i)}
              stroke-width={inked ? shape.inkStrokeWidth : shape.strokeWidth}
            />
          {:else if shape.kind === 'group'}
            <g transform={shape.transform}>
              {#each shape.children as child, j (j)}
                {#if child.kind === 'path'}
                  <path
                    d={child.d}
                    stroke-width={inked ? child.inkStrokeWidth : child.strokeWidth}
                    fill={child.fill === 'glyph'
                      ? inked
                        ? CARD_GLYPH_INK
                        : CARD_GLYPH
                      : undefined}
                  />
                {/if}
              {/each}
            </g>
          {/if}
        {/each}
      </g>
    {/each}
  </svg>
{/if}
