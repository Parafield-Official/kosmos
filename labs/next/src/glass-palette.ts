/** Kosmos Next — purple x orange mesh gradient theme. */
export const GLASS_MESH_PALETTE = {
  baseDeep: "10, 8, 18",
  meshPurple: "142, 78, 255",
  meshOrange: "255, 136, 62",
} as const;

/** Two-blob mesh — purple upper-left, orange lower-right, with dark gap between. */
export const GLASS_MESH_GRADIENTS = [
  `radial-gradient(135% 125% at -8% -8%, rgba(${GLASS_MESH_PALETTE.meshPurple}, 1) 0%, rgba(${GLASS_MESH_PALETTE.meshPurple}, 0.85) 10%, rgba(${GLASS_MESH_PALETTE.meshPurple}, 0.52) 24%, rgba(${GLASS_MESH_PALETTE.meshPurple}, 0.18) 36%, transparent 48%)`,
  `radial-gradient(130% 120% at 110% 112%, rgba(${GLASS_MESH_PALETTE.meshOrange}, 1) 0%, rgba(${GLASS_MESH_PALETTE.meshOrange}, 0.84) 10%, rgba(${GLASS_MESH_PALETTE.meshOrange}, 0.48) 24%, rgba(${GLASS_MESH_PALETTE.meshOrange}, 0.16) 36%, transparent 48%)`,
].join(", ");
