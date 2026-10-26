<script setup lang="ts">
import { computed, useId } from 'vue'
import { PAWNS_PER_CLUSTER } from '../config'
import { photoUrl } from '../services/api'
import type { Result, Student } from '../types/api'
import type { Level } from '../types/stage'
import { MAP_HEIGHT, MAP_WIDTH, checkpointPositions, clusterLayout, trailPath, type Point } from '../utils/mapLayout'
import { groupByCheckpoint, levelMark, levelTitle, outcomeFor, STAGE_MARKS, starsLabel } from '../utils/progress'

interface PawnView {
  student: Student
  at: Point
  size: number
}

interface ClusterView {
  checkpoint: number
  pawns: PawnView[]
  overflow: number
  hidden: Student[]
  overflowAt: Point | null
  overflowSize: number
}

interface MarkerView {
  level: Level
  current: boolean
  title: string
  at: Point
  fill: string
  text: string
  symbol: string
  status: string
  labelY: number
}

const ISLAND_SHAPES: readonly { rx: number; ry: number; tilt: number }[] = [
  { rx: 88, ry: 54, tilt: -8 },
  { rx: 80, ry: 58, tilt: 6 },
  { rx: 92, ry: 50, tilt: -3 },
  { rx: 84, ry: 56, tilt: 10 },
]

const props = defineProps<{
  levels: readonly Level[]
  students: readonly Student[]
  results: readonly Result[]
  classroomSlug: string
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
const clipId = `${ids}-pawn-clip`
const titleId = `${ids}-title`
const wavesId = `${ids}-waves`

const points = computed(() => checkpointPositions(props.levels.length))
const trail = computed(() => trailPath(points.value))
const selectedStudent = computed(() => props.students.find((student) => student.id === props.selectedStudentId) ?? null)

function clustersAbove(point: Point): boolean {
  return point.y < MAP_HEIGHT / 2 + 20
}

const markers = computed<MarkerView[]>(() =>
  props.levels.map((level) => {
    const at = points.value[level.order] as Point
    const labelY = clustersAbove(at) ? at.y + 58 : at.y - 66
    const title = levelTitle(level)
    const current = level.stage !== null && level.stage.slug === props.currentStageSlug
    const selected = selectedStudent.value
    if (selected !== null) {
      const mark = levelMark(level, level.stage === null ? null : outcomeFor(props.results, selected.id, level.stage.slug))
      return { level, current, title, at, fill: mark.fill, text: mark.text, symbol: mark.symbol, status: mark.label, labelY }
    }
    if (level.state !== 'open') {
      const mark = STAGE_MARKS[level.state]
      return { level, current, title, at, fill: mark.fill, text: mark.text, symbol: mark.symbol, status: mark.label, labelY }
    }
    const playing = level.stage?.slug === props.activeStageSlug
    return { level, current, title, at, fill: 'fill-gold', text: 'fill-ink', symbol: String(level.order), status: playing ? 'Playing now' : 'Open', labelY }
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
    const layout = clusterLayout(group.length, PAWNS_PER_CLUSTER, anchor, clustersAbove(anchor))
    const visibleCount = group.length - layout.overflow
    const pawns = group.slice(0, visibleCount).map((student, index) => ({ student, at: layout.slots[index] as Point, size: layout.pawnSize }))
    const overflowAt = layout.overflow > 0 ? (layout.slots[layout.slots.length - 1] ?? null) : null
    return { checkpoint, pawns, overflow: layout.overflow, hidden: group.slice(visibleCount), overflowAt, overflowSize: layout.pawnSize }
  })
})

const hiddenSelected = computed(() => {
  const id = props.selectedStudentId ?? props.turnStudentId ?? null
  if (id === null) {
    return null
  }
  const visible = clusters.value.some((cluster) => cluster.pawns.some((pawn) => pawn.student.id === id))
  return visible ? null : (props.students.find((student) => student.id === id) ?? null)
})

function island(index: number): { rx: number; ry: number; tilt: number } {
  return ISLAND_SHAPES[index % ISLAND_SHAPES.length] as { rx: number; ry: number; tilt: number }
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

function onKey(event: KeyboardEvent, action: () => void): void {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    action()
  }
}
</script>

<template>
  <div class="overflow-x-auto rounded-card">
    <svg
      :viewBox="`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`"
      class="block h-auto w-full min-w-[46rem] rounded-card border-3 border-ink bg-sea select-none lg:min-w-0"
      role="group"
      :aria-labelledby="titleId"
    >
      <title :id="titleId">Adventure map with {{ levels.length }} stages and {{ students.length }} pawns</title>
      <defs>
        <clipPath :id="clipId" clipPathUnits="objectBoundingBox">
          <circle cx="0.5" cy="0.5" r="0.5" />
        </clipPath>
        <pattern :id="wavesId" width="90" height="46" patternUnits="userSpaceOnUse">
          <path d="M5 23 q 10 -9 20 0 t 20 0" class="fill-none stroke-sea-foam" stroke-width="3" stroke-linecap="round" opacity="0.7" />
        </pattern>
      </defs>

      <rect :width="MAP_WIDTH" :height="MAP_HEIGHT" :fill="`url(#${wavesId})`" />

      <g aria-hidden="true">
        <g :transform="`translate(${MAP_WIDTH - 80} 80)`">
          <circle r="44" class="fill-sand stroke-ink" stroke-width="3" />
          <path d="M0 -36 L8 0 L0 36 L-8 0 Z" class="fill-bad stroke-ink" stroke-width="2" />
          <path d="M-36 0 L0 -7 L36 0 L0 7 Z" class="fill-card stroke-ink" stroke-width="2" />
          <text y="-50" text-anchor="middle" class="fill-ink font-display text-[22px] font-extrabold">N</text>
        </g>

        <g v-for="(point, index) in points" :key="`island-${index}`" :transform="`translate(${point.x} ${point.y}) rotate(${island(index).tilt})`">
          <ellipse :rx="island(index).rx + 10" :ry="island(index).ry + 10" class="fill-sea-foam" opacity="0.8" />
          <ellipse :rx="island(index).rx" :ry="island(index).ry" class="fill-sand stroke-sand-deep" stroke-width="4" />
          <ellipse :cx="-island(index).rx * 0.35" :cy="-island(index).ry * 0.25" :rx="island(index).rx * 0.42" :ry="island(index).ry * 0.38" class="fill-jungle" opacity="0.85" />
        </g>

        <path :d="trail" class="fill-none stroke-card" stroke-width="16" stroke-linecap="round" opacity="0.65" />
        <path :d="trail" class="fill-none stroke-trail" stroke-width="7" stroke-linecap="round" stroke-dasharray="2 16" />

        <text v-if="points[0]" :x="points[0].x" :y="points[0].y + 6" text-anchor="middle" class="text-[44px]">⛵</text>
        <text v-if="points[0]" :x="points[0].x" :y="clustersAbove(points[0]) ? points[0].y + 66 : points[0].y - 52" text-anchor="middle" class="map-label fill-ink font-display text-[24px] font-extrabold">
          Start
        </text>
        <g
          v-if="points.length > 1"
          :transform="`translate(${(points[points.length - 1] as Point).x + 70} ${(points[points.length - 1] as Point).y - 4})`"
          class="stroke-ink"
          stroke-width="3"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M -28 -4 V -14 Q -28 -30 0 -30 Q 28 -30 28 -14 V -4 Z" class="fill-[#a8713d]" />
          <rect x="-28" y="-4" width="56" height="30" rx="4" class="fill-trail" />
          <rect x="-28" y="-7" width="56" height="7" class="fill-gold" />
          <path d="M -17 -28 V 26 M 17 -28 V 26" class="stroke-gold-deep" stroke-width="5" fill="none" />
          <rect x="-7" y="-9" width="14" height="15" rx="3" class="fill-gold" />
          <circle cx="0" cy="-3" r="2" class="fill-ink" stroke="none" />
        </g>
      </g>

      <g
        v-for="marker in markers"
        :key="marker.level.order"
        role="button"
        tabindex="0"
        class="cursor-pointer focus:outline-none [&:focus-visible>circle:first-child]:stroke-sea-deep"
        :class="marker.level.state === 'missing' ? 'opacity-70' : ''"
        :aria-label="`Stage ${marker.level.order}: ${marker.title}. ${marker.status}${marker.current ? '. The class is here' : ''}`"
        @click="emit('selectLevel', marker.level.order)"
        @keydown="onKey($event, () => emit('selectLevel', marker.level.order))"
      >
        <circle :cx="marker.at.x" :cy="marker.at.y" r="38" class="fill-transparent stroke-transparent" stroke-width="6" />
        <circle
          v-if="marker.level.stage !== null && marker.level.stage.slug === activeStageSlug"
          :cx="marker.at.x"
          :cy="marker.at.y"
          r="40"
          class="fill-none stroke-gold"
          stroke-width="6"
          stroke-dasharray="10 7"
        />
        <circle
          :cx="marker.at.x"
          :cy="marker.at.y"
          r="30"
          class="stroke-ink"
          :class="marker.fill"
          stroke-width="4"
          :stroke-dasharray="marker.level.state === 'missing' ? '8 6' : undefined"
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
        <text v-if="marker.current" :x="marker.at.x + 30" :y="marker.at.y - 22" class="text-[34px]" aria-hidden="true">🚩</text>
        <text :x="marker.at.x" :y="marker.labelY" text-anchor="middle" class="map-label fill-ink font-display text-[22px] font-extrabold">
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
          <g class="origin-center [transform-box:fill-box]" :class="pawn.student.id === spotlightId ? 'animate-pawn-pulse' : ''">
            <circle
              :r="pawn.size / 2 + (pawn.student.id === selectedStudentId || pawn.student.id === spotlightId || pawn.student.id === turnStudentId ? 4 : 0)"
              class="pawn-ring fill-card"
              :class="pawnRing(pawn.student.id)"
              :stroke-width="pawn.student.id === selectedStudentId || pawn.student.id === spotlightId || pawn.student.id === turnStudentId ? 6 : 3"
            />
            <image
              v-if="pawn.student.photoFile !== null"
              :href="photoUrl(classroomSlug, pawn.student.photoFile)"
              :x="-pawn.size / 2"
              :y="-pawn.size / 2"
              :width="pawn.size"
              :height="pawn.size"
              :clip-path="`url(#${clipId})`"
              preserveAspectRatio="xMidYMid slice"
            />
            <text v-else text-anchor="middle" dominant-baseline="central" :style="{ fontSize: `${pawn.size * 0.62}px` }">{{ pawn.student.emoji }}</text>
          </g>
          <text
            v-if="pawn.student.id === celebrateId"
            :key="`star-${pawn.student.id}`"
            :y="-pawn.size / 2 - 6"
            text-anchor="middle"
            class="animate-star-rise fill-gold stroke-ink text-[30px] [transform-box:fill-box]"
            stroke-width="1.5"
            aria-hidden="true"
          >
            ★
          </text>
        </g>
        <g
          v-if="cluster.overflowAt !== null"
          :transform="`translate(${cluster.overflowAt.x} ${cluster.overflowAt.y})`"
          role="button"
          tabindex="0"
          class="cursor-pointer focus:outline-none"
          :aria-label="`${cluster.overflow} more pawns here. Show them.`"
          @click="emit('showList', cluster.hidden)"
          @keydown="onKey($event, () => emit('showList', cluster.hidden))"
        >
          <circle :r="cluster.overflowSize / 2" class="fill-ink stroke-card" stroke-width="3" />
          <text text-anchor="middle" dominant-baseline="central" class="fill-white font-display text-[16px] font-extrabold">+{{ cluster.overflow }}</text>
        </g>
      </g>

      <g v-if="hiddenSelected !== null" aria-hidden="true">
        <rect x="16" :y="MAP_HEIGHT - 64" width="420" height="48" rx="14" class="fill-card stroke-ink" stroke-width="3" />
        <text x="36" :y="MAP_HEIGHT - 33" class="fill-ink text-[20px] font-bold">{{ hiddenSelected.emoji }} {{ hiddenSelected.name }} is in a group: see the list</text>
      </g>
    </svg>
  </div>
</template>

