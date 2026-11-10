<script lang="ts" module>
  import type { MapId, TimeOfDay } from '../components/cards/maps'

  /*
   * The hour each room is shown at here. A room has four, and this is the one
   * its tagline was written for: the still is shot at it, and the sky the page
   * paints behind the table while the still loads is that hour's, from the same
   * rig the renderer lights the scene with. One list with the `room-still-*`
   * scenes in `src/dev/scenes.ts`, pinned by `roomsPage.test.ts`.
   */
  export const SIGNATURE: Record<MapId, TimeOfDay> = {
    neon: 'night',
    rune: 'dusk',
    velvet: 'dusk',
    orbit: 'night',
    sakura: 'day',
    marina: 'dawn',
  }
</script>

<script lang="ts">
  // The six rooms a match is dealt in.
  //
  // Names and taglines come from `t.maps`, the same copy the loading screen
  // shows; the table's materials and the room's accent from `MAPS`, the same
  // registry the board paints from; the hours and skies from the same lists the
  // server draws from. Nothing here describes a room a second time.
  //
  // A content page does not render the diorama the way the board does — that is
  // three.js and seconds of a GPU, for a page somebody came to read. What it
  // shows instead is a photograph of that render: `make rooms`
  // (tools/rooms/shoot.mjs) shoots each room alone at its signature hour into
  // `src/assets/rooms/`. In a room the render is the table — cloth, racetrack,
  // rail, edge and what it stands on — so the still carries the table too and
  // nothing is drawn over it, as on the board. The rest is told: which hours and
  // which skies the server can deal the room under.
  //
  // A room whose still has not been shot yet falls back to its sky and the
  // board's own CSS table on it, in the room's materials: the page must never
  // fail to build over a picture, and `roomsPage.test.ts` is what says the
  // picture is missing.
  //
  // The stills go through `@sveltejs/enhanced-img`, which is what replaced
  // Astro's `<Image />`: three widths, each written out at build time, with the
  // intrinsic size on the element so nothing moves when one arrives.
  import type { Picture } from '@sveltejs/enhanced-img'
  import { MAPS, MAP_IDS, TIMES } from '../components/cards/maps'
  import { lightRig, hexCss } from '../components/scene/sky'
  import { tableCssVars } from '../components/cards/tableSurface'
  import { ui } from './ui'
  import { en } from '../i18n/en'
  import { fr } from '../i18n/fr'
  import type { Lang } from '../seo/meta'

  const { lang }: { lang: Lang } = $props()
  const t = $derived(lang === 'fr' ? fr : en)

  const stills = import.meta.glob<{ default: Picture }>('../assets/rooms/*.webp', {
    eager: true,
    query: { enhanced: true, w: '1600;1120;720', format: 'webp' },
  })
  const stillOf = (id: MapId): Picture | undefined => stills[`../assets/rooms/${id}.webp`]?.default

  function roomVars(id: MapId): string {
    const map = MAPS[id]
    const rig = lightRig(SIGNATURE[id], 'clear', id)
    return [
      `--accent: ${map.accent}`,
      `--sky-top: ${hexCss(rig.sky.top)}`,
      `--sky-horizon: ${hexCss(rig.sky.horizon)}`,
      `--scene-tint: ${rig.tintCss}`,
      `--scene-dark: ${rig.dark.toFixed(2)}`,
      ...tableCssVars(map.table),
    ].join('; ')
  }
</script>

<h1>{ui('tablesH1', lang)}</h1>
<p class="lede">{ui('tablesLede', lang)}</p>

<div class="rooms">
  {#each MAP_IDS as id (id)}
    {@const map = MAPS[id]}
    {@const copy = t.maps[id]}
    {@const still = stillOf(id)}
    <article class="room">
      <div class="roomHead">
        <h2>{copy.name}</h2>
        <span class="roomHour">{t.mapTimes[SIGNATURE[id]]}</span>
      </div>
      <!--
        The room, and its table in it: the still is the render, and in a room
        the render is the table (cloth, racetrack, rail, edge, pedestal), so
        nothing is drawn over it, exactly as on the board. The CSS table is
        what stands in when there is no photograph to show: the same
        materials, the same rim, on the sky of the hour. The two `--tbl-*`
        rulesets in content.css are a transcription of GameBoard.svelte's,
        and move with it.
      -->
      <div class="roomArt" style={roomVars(id)}>
        {#if still}
          <enhanced:img
            class="roomStill"
            src={still}
            alt={copy.tagline}
            sizes="(max-width: 50rem) 100vw, 46rem"
            loading="lazy"
            decoding="async"
          />
        {:else}
          <div class="roomGlow" aria-hidden="true"></div>
          <div class="roomTable" aria-hidden="true"></div>
        {/if}
      </div>
      <p>{copy.tagline}</p>
      <!--
        The two things the lede promises beside the room — an hour, a sky — as
        two named rows rather than one run of ten words. They are a definition
        list because that is what they are: a reader hears "Hours: dawn, day…"
        instead of a list of ten with no shape, and the four hours stop running
        into the six skies when the row wraps on a phone. Nothing here is
        pressable, so nothing here is drawn as a chip.
      -->
      <dl class="roomMoments">
        <dt class="roomMomentsLabel">{ui('tablesHours', lang)}</dt>
        <dd class="roomMomentsRow">
          {#each TIMES as time (time)}
            <span class="roomMoment">{t.mapTimes[time]}</span>
          {/each}
        </dd>
        <dt class="roomMomentsLabel">{ui('tablesSkies', lang)}</dt>
        <dd class="roomMomentsRow">
          {#each map.weathers as w (w)}
            <span class="roomMoment">{t.mapWeathers[w]}</span>
          {/each}
        </dd>
      </dl>
    </article>
  {/each}
</div>

<p>{ui('tablesOutro', lang)}</p>
