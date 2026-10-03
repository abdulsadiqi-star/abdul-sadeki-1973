import * as THREE from 'three';

/**
 * Physically-based material library.
 * Metals are driven almost entirely by the studio environment map, so their
 * look comes from reflections (strip lights on polished steel) — not flat shading.
 */
export function createMaterials(T) {
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const M = {};

  M.polished = std({ color: 0xe6e9ec, metalness: 1, roughness: 0.075 });
  M.brushed = std({
    color: 0xd5d8dc, metalness: 1, roughness: 0.46,
    roughnessMap: T.brushed, bumpMap: T.brushed, bumpScale: 0.35,
  });
  M.rhodium = std({ color: 0x5b5f66, metalness: 1, roughness: 0.26 });
  M.darkInner = std({ color: 0x26282c, metalness: 0.9, roughness: 0.42 });
  M.brass = std({ color: 0xc79a58, metalness: 1, roughness: 0.3 });
  M.gold = std({ color: 0xe0b878, metalness: 1, roughness: 0.15 });
  M.blued = std({ color: 0x2a4c96, metalness: 0.95, roughness: 0.24 });
  M.black = std({ color: 0x15161a, metalness: 0.25, roughness: 0.62 });
  M.lume = std({ color: 0xcfe9d8, metalness: 0, roughness: 0.6, emissive: 0x6fa98a, emissiveIntensity: 0.25 });

  M.ruby = new THREE.MeshPhysicalMaterial({
    color: 0xb3102c, metalness: 0, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.03,
    emissive: 0x4a0010, emissiveIntensity: 0.7, ior: 1.77, specularIntensity: 1,
  });

  M.dial = std({ map: T.dial, color: 0xffffff, metalness: 0.7, roughness: 0.46 });
  M.chapter = std({ map: T.chapter, metalness: 0.15, roughness: 0.42 });
  M.caseback = std({ map: T.caseback, metalness: 1, roughness: 0.34, roughnessMap: T.brushed });
  M.dateWheel = std({ map: T.dateWheel, metalness: 0, roughness: 0.55 });
  M.datePatch = std({ map: T.datePatch, metalness: 0, roughness: 0.5 });

  M.geneve = std({
    map: T.geneve, color: 0xd9dce0, metalness: 1, roughness: 0.28,
    bumpMap: T.geneve, bumpScale: 1.2,
  });
  M.geneveGold = std({
    map: T.geneve, color: 0xe9bf7c, metalness: 1, roughness: 0.24,
    bumpMap: T.geneve, bumpScale: 1.0,
  });
  M.perlage = std({
    map: T.perlage, color: 0xd7dade, metalness: 1, roughness: 0.34,
    bumpMap: T.perlage, bumpScale: 1.4,
  });

  M.leather = new THREE.MeshPhysicalMaterial({
    map: T.leather, bumpMap: T.leatherBump, bumpScale: 1.4,
    roughness: 0.58, metalness: 0, clearcoat: 0.28, clearcoatRoughness: 0.55,
  });

  /**
   * Sapphire: a *reflection-only* layer. Diffuse is black and blending is
   * (ONE, ONE_MINUS_SRC_ALPHA), so the glass only ADDS studio reflections and
   * barely tints what's behind it — hands, dial and print stay crisp.
   */
  M.glass = new THREE.MeshPhysicalMaterial({
    color: 0x000000, metalness: 0, roughness: 0.02,
    ior: 1.77, specularIntensity: 1.7, specularColor: new THREE.Color(0.86, 0.95, 1.0),
    transparent: true, opacity: 0.06, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendEquation: THREE.AddEquation,
  });

  M.shadow = new THREE.MeshBasicMaterial({ map: T.shadow, transparent: true, depthWrite: false, opacity: 0.9 });
  return M;
}
