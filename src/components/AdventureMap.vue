<script setup lang="ts">
import { computed, useId } from 'vue'
import { PAWNS_PER_CLUSTER } from '../config'
import type { Result, Student } from '../types/api'
import type { Level, LevelState } from '../types/stage'
import { CAST_SHADOW_OFFSET, ISLAND_DEPTH, islandShape, landmarkFor, type FacetTone, type IslandShape, type LandmarkKind } from '../utils/islandArt'
import { MAP_HEIGHT, MAP_WIDTH, checkpointPositions, clusterLayout, trailPath, type Point } from '../utils/mapLayout'
import { finishedStageSlugs, groupByCheckpoint, levelMark, levelTitle, outcomeFor, starsLabel } from '../utils/progress'
import MapLandmark from './MapLandmark.vue'
import TreasureChest from './TreasureChest.vue'

interface PawnView {
  student: Student
  at: Point
  size: number
  above: boolean
}

interface ClusterView {
  checkpoint: number
  pawns: PawnView[]
  hidden: Student[]
  overflowAt: Point | null
  overflowSize: number
}

interface MarkerView {
  level: Level
  current: boolean
  finished: boolean
  title: string
  at: Point
  fill: string
  text: string
  symbol: string
  status: string
  labelY: number
}

interface IslandView {
  index: number
  at: Point
  rx: number
  ry: number
  shape: IslandShape
  state: LevelState | 'start'
  landmark: LandmarkKind | null
}

interface NameTag {
  id: string
  name: string
  x: number
  y: number
  width: number
}

const ISLAND_SIZES: readonly { rx: number; ry: number }[] = [
  { rx: 88, ry: 54 },
  { rx: 82, ry: 58 },
  { rx: 92, ry: 52 },
  { rx: 84, ry: 56 },
]

const SAND_TONES: Record<FacetTone, string> = { lit: 'fill-sand-lit', mid: 'fill-sand', shade: 'fill-sand-shade' }
const GRASS_TONES: Record<FacetTone, string> = { lit: 'fill-leaf-lit', mid: 'fill-jungle', shade: 'fill-leaf-shade' }
const GLINTS: readonly Point[] = [
  { x: 190, y: 110 },
  { x: 620, y: 70 },
  { x: 1010, y: 640 },
  { x: 430, y: 650 },
  { x: 880, y: 190 },
]
const NAME_TAG_MAX_CHARS: number = 18

const props = defineProps<{
  levels: readonly Level[]
  students: readonly Student[]
  results: readonly Result[]
  selectedStudentId: string | null
  activeStageSlug?: string | null
  currentStageSlug?: string | null
  spotlightId?: string | null
  turnStudentId?: string | null
  celebrateId?: string | null
}>()

const emit = defineEmits<{
  selectStudent: [studentId: string]
  selectLevel: [order: number]
  showList: [hidden: Student[]]
}>()

const ids = useId()
const titleId = `${ids}-title`
const wavesId = `${ids}-waves`
const seaId = `${ids}-sea`
const shadowId = `${ids}-shadow`
const glowId = `${ids}-glow`
const lockedId = `${ids}-locked`

const points = computed(() => checkpointPositions(props.levels.length))
const trail = computed(() => trailPath(points.value))
const selectedStudent = computed(() => props.students.find((student) => student.id === props.selectedStudentId) ?? null)
const finished = computed(() => finishedStageSlugs(props.students, props.results))

function clustersAbove(point: Point): boolean {
  return point.y < MAP_HEIGHT / 2 + 20
}

// The last island carries the treasure chest instead of a level landmark; an island still in fog shows none.
const islands = computed<IslandView[]>(() =>
  points.value.map((at, index) => {
    const size = ISLAND_SIZES[index % ISLAND_SIZES.length] as { rx: number; ry: number }
    const level = index === 0 ? null : (props.levels[index - 1] ?? null)
    const landmark = index === 0 || index === points.value.length - 1 || level?.state === 'missing' ? null : landmarkFor(index)
    return { index, at, rx: size.rx, ry: size.ry, shape: islandShape(index, size.rx, size.ry), state: level?.state ?? 'start', landmark }
  }),
)

const markers = computed<MarkerView[]>(() =>
  props.levels.map((level) => {
    const at = points.value[level.order] as Point
    const labelY = clustersAbove(at) ? at.y + 62 : at.y - 70
    const title = levelTitle(level)
    const current = level.stage !== null && level.stage.slug === props.currentStageSlug
    const done = level.stage !== null && finished.value.has(level.stage.slug)
    const selected = selectedStudent.value
    if (selected === null && level.state === 'open') {
      const playing = level.stage?.slug === props.activeStageSlug
      return { level, current, finished: done, title, at, fill: 'fill-gold', text: 'fill-ink', symbol: String(level.order), status: playing ? 'Playing now' : 'Open', labelY }
    }
    const mark = levelMark(level, selected === null || level.stage === null ? null : outcomeFor(props.results, selected.id, level.stage.slug))
    return { level, current, finished: done, title, at, fill: mark.fill, text: mark.text, symbol: mark.symbol, status: mark.label, labelY }
  }),
)

// Kept apart from the highlighted pawns, which change on every tick of the pick animation.
const groups = computed<Student[][]>(() => groupByCheckpoint(props.levels, props.students, props.results))

const clusters = computed<ClusterView[]>(() => {
  const featured = [props.spotlightId, props.turnStudentId, props.selectedStudentId, props.celebrateId].filter((id) => id !== null && id !== undefined)
  return groups.value.map((unordered, checkpoint) => {
    // Highlighted pawns take the first slots so a "+N" bubble never hides the student on turn.
    const group = [...unordered].sort((a, b) => Number(featured.includes(b.id)) - Number(featured.includes(a.id)))
    const anchor = points.value[checkpoint] as Point
    const above = clustersAbove(anchor)
    const layout = clusterLayout(group.length, PAWNS_PER_CLUSTER, anchor, above)
    const visibleCount = group.length - layout.overflow
    const pawns = group.slice(0, visibleCount).map((student, index) => ({ student, at: layout.slots[index] as Point, size: layout.pawnSize, above }))
    const overflowAt = layout.overflow > 0 ? (layout.slots[layout.slots.length - 1] ?? null) : null
    return { checkpoint, pawns, hidden: group.slice(visibleCount), overflowAt, overflowSize: layout.pawnSize }
  })
})

// Highlighted pawns get their name on the map, drawn above every pawn so a neighbour never covers it.
const nameTags = computed<NameTag[]>(() =>
  clusters.value.flatMap((cluster) =>
    cluster.pawns
      .filter((pawn) => highlighted(pawn.student.id))
      .map((pawn) => {
        const name = shortName(pawn.student.name)
        const offset = pawn.size / 2 + 20
        const width = name.length * 10.5 + 24
        const x = Math.min(Math.max(pawn.at.x, width / 2 + 6), MAP_WIDTH - width / 2 - 6)
        return { id: pawn.student.id, name, x, y: pawn.above ? pawn.at.y - offset : pawn.at.y + offset, width }
      }),
  ),
)

const hiddenSelected = computed(() => {
  const id = props.selectedStudentId ?? props.turnStudentId ?? null
  if (id === null) {
    return null
  }
  const visible = clusters.value.some((cluster) => cluster.pawns.some((pawn) => pawn.student.id === id))
  return visible ? null : (props.students.find((student) => student.id === id) ?? null)
})

const chestAt = computed<Point | null>(() => {
  const last = points.value[points.value.length - 1]
  return points.value.length > 1 && last !== undefined ? { x: last.x + 70, y: last.y - 4 } : null
})

function shortName(name: string): string {
  return name.length > NAME_TAG_MAX_CHARS ? `${name.slice(0, NAME_TAG_MAX_CHARS - 1)}…` : name
}

function highlighted(studentId: string): boolean {
  return studentId === props.selectedStudentId || studentId === props.spotlightId || studentId === props.turnStudentId
}

function pawnRing(studentId: string): string {
  if (studentId === props.spotlightId || studentId === props.turnStudentId) {
    return 'stroke-gold'
  }
  if (studentId === props.selectedStudentId) {
    return 'stroke-sea-deep'
  }
  return 'stroke-ink'
}

function pawnLabel(student: Student): string {
  let label = `${student.name}, ${starsLabel(student.points)}`
  if (student.id === props.turnStudentId) {
    label += ', on turn'
  }
  return label
}

function markerLabel(marker: MarkerView): string {
  let label = `Stage ${marker.level.order}: ${marker.title}. ${marker.status}`
  if (marker.finished) {
    label += '. Everyone has played'
  }
  if (marker.current) {
    label += '. The class is here'
  }
  return label
}

function onKey(event: KeyboardEvent, action: () => void): void {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    action()
  }
}
</script>

<template>
  <div class="overflow-x-auto rounded-card shadow-soft">
    <svg
      :viewBox="`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`"
      class="block h-auto w-full min-w-[46rem] rounded-card border-3 border-ink bg-sea select-none lg:min-w-0"
      role="group"
      :aria-labelledby="titleId"
    >
      <title :id="titleId">Adventure map with {{ levels.length }} stages and {{ students.length }} pawns</title>
      <defs>
        <radialGradient :id="seaId" cx="45%" cy="48%" r="75%">
          <stop offset="0%" class="[stop-color:var(--color-sea-shallow)]" />
          <stop offset="45%" class="[stop-color:var(--color-sea)]" />
          <stop offset="100%" class="[stop-color:var(--color-sea-abyss)]" />
        </radialGradient>
        <radialGradient :id="shadowId">
          <stop offset="0%" class="[stop-color:var(--color-shadow-cast)]" stop-opacity="0.45" />
          <stop offset="100%" class="[stop-color:var(--color-shadow-cast)]" stop-opacity="0" />
        </radialGradient>
        <radialGradient :id="glowId">
          <stop offset="0%" class="[stop-color:var(--color-gold-lit)]" stop-opacity="1" />
          <stop offset="60%" class="[stop-color:var(--color-gold)]" stop-opacity="0.55" />
          <stop offset="100%" class="[stop-color:var(--color-gold)]" stop-opacity="0" />
        </radialGradient>
        <pattern :id="wavesId" width="180" height="92" patternUnits="userSpaceOnUse">
          <path d="M10 23 q 10 -9 20 0 t 20 0 M100 69 q 10 -9 20 0 t 20 0" class="fill-none stroke-sea-foam" stroke-width="3" stroke-linecap="round" opacity="0.4" />
        </pattern>
        <filter :id="lockedId">
          <feColorMatrix type="saturate" values="0.2" />
        </filter>
      </defs>

      <g aria-hidden="true">
        <rect :width="MAP_WIDTH" :height="MAP_HEIGHT" :fill="`url(#${seaId})`" />
        <g class="animate-ripple motion-reduce:animate-none">
          <rect :width="MAP_WIDTH + 180" :height="MAP_HEIGHT" :fill="`url(#${wavesId})`" />
        </g>
        <path
          v-for="(glint, index) in GLINTS"
          :key="`glint-${index}`"
          :d="`M${glint.x} ${glint.y - 9} L${glint.x + 2.5} ${glint.y - 2.5} L${glint.x + 9} ${glint.y} L${glint.x + 2.5} ${glint.y + 2.5} L${glint.x} ${glint.y + 9} L${glint.x - 2.5} ${glint.y + 2.5} L${glint.x - 9} ${glint.y} L${glint.x - 2.5} ${glint.y - 2.5} Z`"
          class="map-motion animate-glint fill-light-glint opacity-0 motion-reduce:hidden"
          :style="{ animationDelay: `${index * 0.7}s` }"
        />

        <g :transform="`translate(${MAP_WIDTH - 80} 80)`">
          <circle r="44" class="fill-parchment stroke-ink" stroke-width="3" />
          <circle r="34" class="fill-none stroke-sand-shade" stroke-width="2" stroke-dasharray="3 6" />
          <path d="M0 -36 L8 0 L0 36 L-8 0 Z" class="fill-coral stroke-ink" stroke-width="2" />
          <path d="M-36 0 L0 -7 L36 0 L0 7 Z" class="fill-card stroke-ink" stroke-width="2" />
          <text y="-50" text-anchor="middle" class="map-label fill-ink font-display text-[22px] font-extrabold">N</text>
        </g>

        <g v-for="island in islands" :key="`shallows-${island.index}`" :transform="`translate(${island.at.x} ${island.at.y})`">
          <ellipse
            :cx="CAST_SHADOW_OFFSET.x"
            :cy="ISLAND_DEPTH + CAST_SHADOW_OFFSET.y"
            :rx="island.rx + 18"
            :ry="island.ry + 12"
            :fill="`url(#${shadowId})`"
          />
          <ellipse :rx="island.rx + 26" :ry="island.ry + 22" class="fill-sea-shallow" opacity="0.7" />
          <ellipse :rx="island.rx + 26" :ry="island.ry + 22" class="fill-none stroke-sea-foam" stroke-width="3" stroke-dasharray="14 10" />
        </g>

        <g :transform="`translate(${CAST_SHADOW_OFFSET.x / 3} ${CAST_SHADOW_OFFSET.y / 2})`">
          <path :d="trail" class="fill-none stroke-shadow-cast" stroke-width="22" stroke-linecap="round" opacity="0.22" />
        </g>
        <path :d="trail" class="fill-none stroke-wood-shade" stroke-width="22" stroke-linecap="round" />
        <path :d="trail" class="fill-none stroke-wood-lit" stroke-width="15" stroke-dasharray="9 5" />

        <g
          v-for="island in islands"
          :key="`island-${island.index}`"
          :transform="`translate(${island.at.x} ${island.at.y})`"
          :filter="island.state === 'locked' ? `url(#${lockedId})` : undefined"
        >
          <polygon :points="island.shape.outline" :transform="`translate(0 ${ISLAND_DEPTH})`" class="fill-sand-deep stroke-ink" stroke-width="3" />
          <polygon v-for="(facet, index) in island.shape.sand" :key="`sand-${index}`" :points="facet.points" :class="SAND_TONES[facet.tone]" />
          <polygon v-for="(facet, index) in island.shape.grass" :key="`grass-${index}`" :points="facet.points" :class="GRASS_TONES[facet.tone]" />
          <polygon :points="island.shape.outline" class="fill-none stroke-ink" stroke-width="3" stroke-linejoin="round" />

          <g v-if="island.landmark !== null" :transform="`translate(${island.rx * 0.68} 24)`">
            <MapLandmark :kind="island.landmark" />
          </g>

          <g v-if="island.state === 'start'" class="stroke-ink" stroke-width="2.5" stroke-linejoin="round">
            <rect x="-62" y="10" width="40" height="9" rx="2" class="fill-wood-lit" />
            <path d="M-56 19 v10 M-30 19 v10" class="stroke-wood-shade" stroke-width="4" />
            <g class="map-motion animate-bob motion-reduce:animate-none">
              <path d="M-26 6 L26 6 L18 20 L-18 20 Z" class="fill-trail" />
              <path d="M-26 6 L26 6 L24 10 L-24 10 Z" class="fill-wood-lit" stroke="none" />
              <path d="M0 6 V-34" class="stroke-wood-shade" stroke-width="3.5" />
              <path d="M2 -32 L24 0 L2 0 Z" class="fill-card" />
              <path d="M-2 -26 L-18 0 L-2 0 Z" class="fill-coral" />
            </g>
          </g>

          <g v-if="island.state === 'missing'" class="stroke-rule" stroke-width="2">
            <circle cx="-34" cy="-6" r="30" class="fill-fog" opacity="0.92" />
            <circle cx="30" cy="-10" r="34" class="fill-fog" opacity="0.92" />
            <circle cx="0" cy="14" r="36" class="fill-fog" opacity="0.92" />
            <circle cx="-4" cy="-22" r="26" class="fill-fog" opacity="0.92" />
          </g>
        </g>

        <text
          v-if="points[0]"
          :x="points[0].x"
          :y="clustersAbove(points[0]) ? points[0].y + 70 : points[0].y - 58"
          text-anchor="middle"
          class="map-label fill-ink font-display text-[24px] font-extrabold"
        >
          Start
        </text>

        <g v-if="chestAt !== null" :transform="`translate(${chestAt.x} ${chestAt.y})`" class="stroke-ink" stroke-width="3" stroke-linejoin="round">
          <ellipse cx="6" cy="32" rx="34" ry="9" :fill="`url(#${shadowId})`" stroke="none" />
          <circle r="40" :fill="`url(#${glowId})`" stroke="none" class="map-motion animate-spotlight motion-reduce:animate-none" />
          <TreasureChest />
          <path d="M-36 -38 l4 -8 l4 8 l-4 8 Z M30 -40 l3 -6 l3 6 l-3 6 Z" class="fill-gold-lit" stroke-width="1.5" />
        </g>
      </g>

      <g
        v-for="marker in markers"
        :key="marker.level.order"
        role="button"
        tabindex="0"
        class="cursor-pointer focus:outline-none [&:focus-visible>circle:first-child]:stroke-sea-deep"
        :aria-label="markerLabel(marker)"
        @click="emit('selectLevel', marker.level.order)"
        @keydown="onKey($event, () => emit('selectLevel', marker.level.order))"
      >
        <circle :cx="marker.at.x" :cy="marker.at.y" r="42" class="fill-transparent stroke-transparent" stroke-width="6" />
        <ellipse :cx="marker.at.x + 7" :cy="marker.at.y + 30" rx="30" ry="9" class="fill-shadow-cast" opacity="0.3" />
        <circle
          v-if="marker.level.stage !== null && marker.level.stage.slug === activeStageSlug"
          :cx="marker.at.x"
          :cy="marker.at.y"
          r="42"
          class="map-motion animate-ring-turn fill-none stroke-gold motion-reduce:animate-none"
          stroke-width="6"
          stroke-dasharray="10 7"
        />
        <circle
          :cx="marker.at.x"
          :cy="marker.at.y"
          r="31"
          class="stroke-ink"
          :class="[marker.fill, marker.level.state === 'missing' ? 'opacity-85' : '']"
          stroke-width="5"
          :stroke-dasharray="marker.level.state === 'missing' ? '9 6' : undefined"
        />
        <path
          :d="`M${marker.at.x - 21} ${marker.at.y - 6} A 22 22 0 0 1 ${marker.at.x - 6} ${marker.at.y - 21}`"
          class="fill-none stroke-light-glint"
          stroke-width="4"
          stroke-linecap="round"
          opacity="0.6"
        />
        <text
          :x="marker.at.x"
          :y="marker.at.y + 1"
          text-anchor="middle"
          dominant-baseline="central"
          class="font-display text-[28px] font-extrabold"
          :class="marker.text"
        >
          {{ marker.symbol }}
        </text>
        <g v-if="marker.finished" :transform="`translate(${marker.at.x + 26} ${marker.at.y + 24})`" aria-hidden="true">
          <circle r="14" class="fill-gold stroke-ink" stroke-width="3" />
          <path d="M-6 0 L-1.5 5 L7 -5" class="fill-none stroke-ink" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" />
        </g>
        <g v-if="marker.current" :transform="`translate(${marker.at.x - 38} ${marker.at.y + 14}) scale(-1 1)`" class="class-flag" aria-hidden="true">
          <rect x="-6" y="-52" width="40" height="60" class="fill-transparent" />
          <path d="M0 4 V-44" class="stroke-wood-shade" stroke-width="4.5" stroke-linecap="round" />
          <circle cy="-46" r="4" class="fill-gold stroke-ink" stroke-width="2" />
          <path
            d="M2 -42 Q14 -47 28 -40 Q18 -34 28 -27 Q14 -32 2 -27 Z"
            class="map-motion animate-flag-wave fill-coral stroke-ink [transform-origin:0%_50%] motion-reduce:animate-none"
            stroke-width="2.5"
            stroke-linejoin="round"
          />
        </g>
        <text :x="marker.at.x" :y="marker.labelY" text-anchor="middle" class="map-label fill-ink font-display text-[23px] font-extrabold">
          {{ marker.level.order }}. {{ marker.title }}
        </text>
        <text :x="marker.at.x" :y="marker.labelY + 24" text-anchor="middle" class="map-label fill-ink-soft text-[18px] font-bold">
          {{ marker.status }}
        </text>
      </g>

      <g v-for="cluster in clusters" :key="`cluster-${cluster.checkpoint}`">
        <g
          v-for="pawn in cluster.pawns"
          :key="pawn.student.id"
          :transform="`translate(${pawn.at.x} ${pawn.at.y})`"
          role="button"
          tabindex="0"
          class="cursor-pointer focus:outline-none [&:focus-visible_.pawn-ring]:stroke-sea-deep"
          :aria-label="pawnLabel(pawn.student)"
          :aria-pressed="pawn.student.id === selectedStudentId"
          @click="emit('selectStudent', pawn.student.id)"
          @keydown="onKey($event, () => emit('selectStudent', pawn.student.id))"
        >
          <ellipse cx="3" :cy="pawn.size * 0.44" :rx="pawn.size * 0.42" :ry="pawn.size * 0.13" class="fill-shadow-cast" opacity="0.3" />
          <circle
            v-if="pawn.student.id === spotlightId"
            :r="pawn.size * 0.9"
            :fill="`url(#${glowId})`"
            class="map-motion animate-spotlight motion-reduce:animate-none"
          />
          <g class="origin-center [transform-box:fill-box]" :class="pawn.student.id === spotlightId ? 'animate-pawn-pulse' : ''">
            <circle
              :r="pawn.size / 2 + (highlighted(pawn.student.id) ? 4 : 0)"
              class="pawn-ring fill-card"
              :class="pawnRing(pawn.student.id)"
              :stroke-width="highlighted(pawn.student.id) ? 6 : 3"
            />
            <text text-anchor="middle" dominant-baseline="central" :style="{ fontSize: `${pawn.size * 0.62}px` }">{{ pawn.student.emoji }}</text>
          </g>
          <g v-if="pawn.student.id === celebrateId" :key="`star-${pawn.student.id}`" aria-hidden="true">
            <text
              :y="-pawn.size / 2 - 6"
              text-anchor="middle"
              class="animate-star-rise fill-gold stroke-ink text-[30px] [transform-box:fill-box]"
              stroke-width="1.5"
            >
              ★
            </text>
            <text
              :x="-pawn.size / 2"
              :y="-pawn.size / 2 + 4"
              text-anchor="middle"
              class="animate-star-rise fill-gold-lit stroke-ink text-[18px] [animation-delay:150ms] [transform-box:fill-box] motion-reduce:hidden"
              stroke-width="1"
            >
              ★
            </text>
            <text
              :x="pawn.size / 2"
              :y="-pawn.size / 2 + 2"
              text-anchor="middle"
              class="animate-star-rise fill-gold-lit stroke-ink text-[18px] [animation-delay:300ms] [transform-box:fill-box] motion-reduce:hidden"
              stroke-width="1"
            >
              ★
            </text>
          </g>
        </g>
        <g
          v-if="cluster.overflowAt !== null"
          :transform="`translate(${cluster.overflowAt.x} ${cluster.overflowAt.y})`"
          role="button"
          tabindex="0"
          class="cursor-pointer focus:outline-none [&:focus-visible>circle]:stroke-sea-deep"
          :aria-label="`${cluster.hidden.length} more pawns here. Show them.`"
          @click="emit('showList', cluster.hidden)"
          @keydown="onKey($event, () => emit('showList', cluster.hidden))"
        >
          <ellipse cx="3" :cy="cluster.overflowSize * 0.44" :rx="cluster.overflowSize * 0.42" :ry="cluster.overflowSize * 0.13" class="fill-shadow-cast" opacity="0.3" />
          <circle :r="cluster.overflowSize / 2" class="fill-ink stroke-card" stroke-width="3" />
          <text text-anchor="middle" dominant-baseline="central" class="fill-white font-display text-[16px] font-extrabold">+{{ cluster.hidden.length }}</text>
        </g>
      </g>

      <g aria-hidden="true">
        <g v-for="tag in nameTags" :key="`tag-${tag.id}`" :transform="`translate(${tag.x} ${tag.y})`">
          <rect :x="-tag.width / 2" y="-15" :width="tag.width" height="30" rx="15" class="fill-ink stroke-card" stroke-width="2.5" />
          <text text-anchor="middle" dominant-baseline="central" y="1" class="fill-white text-[18px] font-bold">{{ tag.name }}</text>
        </g>
      </g>

      <g v-if="hiddenSelected !== null" aria-hidden="true">
        <rect x="16" :y="MAP_HEIGHT - 64" width="420" height="48" rx="14" class="fill-card stroke-ink" stroke-width="3" />
        <text x="36" :y="MAP_HEIGHT - 33" class="fill-ink text-[20px] font-bold">{{ hiddenSelected.emoji }} {{ hiddenSelected.name }} is in a group: see the list</text>
      </g>
    </svg>
  </div>
</template>
