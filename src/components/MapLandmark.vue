<script setup lang="ts">
import type { LandmarkKind } from '../utils/islandArt'

defineProps<{
  kind: LandmarkKind
}>()
</script>

<!-- Drawn standing on (0, 0) and rising to about y = -58; lit faces on the left, shade on the right. -->
<template>
  <g class="stroke-ink" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round">
    <template v-if="kind === 'lighthouse'">
      <polygon points="-12,0 0,0 0,-40 -7,-40" class="fill-card" />
      <polygon points="0,0 12,0 7,-40 0,-40" class="fill-rule" />
      <polygon points="-10.5,-10 10.5,-10 9.4,-20 -9.4,-20" class="fill-coral" />
      <polygon points="-8.3,-28 8.3,-28 7.6,-35 -7.6,-35" class="fill-coral" />
      <rect x="-8" y="-50" width="16" height="10" rx="2" class="fill-gold-lit" />
      <polygon points="-11,-50 11,-50 0,-60" class="fill-coral-deep" />
      <path d="M-16 -45 h-10 M16 -45 h10" class="stroke-gold" stroke-width="3" />
    </template>

    <template v-else-if="kind === 'palms'">
      <path d="M-6 0 Q-10 -24 -2 -46" class="fill-none stroke-wood-shade" stroke-width="6" />
      <path d="M-6 0 Q-10 -24 -2 -46" class="fill-none stroke-wood-lit" stroke-width="2.5" />
      <path d="M12 0 Q16 -16 10 -32" class="fill-none stroke-wood-shade" stroke-width="5" />
      <polygon points="-2,-46 -26,-40 -12,-52" class="fill-leaf-lit" />
      <polygon points="-2,-46 -16,-62 -4,-58" class="fill-leaf-lit" />
      <polygon points="-2,-46 14,-60 10,-50" class="fill-jungle" />
      <polygon points="-2,-46 22,-40 10,-38" class="fill-leaf-shade" />
      <polygon points="10,-32 -2,-28 4,-36" class="fill-jungle" />
      <polygon points="10,-32 26,-28 20,-38" class="fill-leaf-shade" />
      <circle cx="0" cy="-43" r="3" class="fill-wood-shade" stroke-width="1.5" />
    </template>

    <template v-else-if="kind === 'volcano'">
      <polygon points="-28,0 0,0 0,-36 -9,-38" class="fill-rock-lit" />
      <polygon points="0,0 28,0 9,-38 0,-36" class="fill-rock-shade" />
      <ellipse cx="0" cy="-37" rx="9" ry="3.5" class="fill-lava" />
      <path d="M-2 -36 L-6 -22 L-3 -16" class="fill-none stroke-lava" stroke-width="3.5" />
      <circle cx="6" cy="-49" r="6" class="fill-rock-lit stroke-rock" stroke-width="2" opacity="0.85" />
      <circle cx="13" cy="-57" r="4.5" class="fill-rock-lit stroke-rock" stroke-width="2" opacity="0.7" />
    </template>

    <template v-else-if="kind === 'arch'">
      <path d="M-26 0 L-22 -34 L-6 -46 L0 -46 L0 -26 Q-12 -26 -12 0 Z" class="fill-rock-lit" />
      <path d="M0 -46 L8 -46 L24 -32 L26 0 L12 0 Q12 -26 0 -26 Z" class="fill-rock-shade" />
      <path d="M-20 -30 L-10 -40" class="fill-none stroke-card" stroke-width="2" opacity="0.7" />
      <polygon points="-14,-46 -4,-54 6,-46" class="fill-jungle" />
    </template>

    <template v-else-if="kind === 'ruins'">
      <rect x="-22" y="-36" width="9" height="36" class="fill-rock-lit" />
      <rect x="-4" y="-44" width="9" height="44" class="fill-rock-lit" />
      <rect x="1" y="-44" width="4" height="44" class="fill-rock" stroke="none" />
      <rect x="14" y="-22" width="9" height="22" class="fill-rock-shade" />
      <polygon points="-26,-44 9,-50 10,-44 -25,-38" class="fill-rock" />
      <polygon points="12,-22 26,-25 26,-20 12,-17" class="fill-rock-shade" />
    </template>

    <template v-else>
      <polygon points="-10,0 -2,0 -6,-36 -14,-22" class="fill-crystal" />
      <polygon points="-2,0 6,0 2,-50 -6,-36" class="fill-crystal" />
      <polygon points="-2,-12 -6,-36 2,-50" class="fill-card" opacity="0.55" stroke="none" />
      <polygon points="6,0 18,0 20,-26 10,-30" class="fill-crystal" />
      <polygon points="10,-30 20,-26 18,0 14,0" class="fill-ink" opacity="0.25" stroke="none" />
    </template>
  </g>
</template>
