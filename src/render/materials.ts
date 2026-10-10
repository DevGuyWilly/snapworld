import * as THREE from 'three';

/** 0 = night palette, 1 = day palette. Shared by every map material; driven by Atmosphere. */
export const dayUniform = { value: 0 };

const DAY_VERTEX_HEAD = 'attribute vec3 dayColor;\nuniform float uDay;';
// Day colours arrive as sRGB bytes; convert to linear before blending with the night colour.
const DAY_VERTEX_MIX = '#include <color_vertex>\nvColor.rgb = mix(vColor.rgb, pow(dayColor, vec3(2.2)), uDay);';

/**
 * Buildings: flat navy Lambert surfaces with procedural windows.
 * Walls carry (u = metres along the wall, v = height, seed); a hash per window cell
 * decides whether it is lit, so no textures are needed.
 */
export function createBuildingMaterial(): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uDay = dayUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec3 wall;\nvarying vec3 vWall;\n${DAY_VERTEX_HEAD}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWall = wall;')
      .replace('#include <color_vertex>', DAY_VERTEX_MIX);

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWall;
        uniform float uDay;
        float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float band(float f, float a, float b, float w) { return smoothstep(a - w, a + w, f) * (1.0 - smoothstep(b - w, b + w, f)); }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        if (vWall.x >= 0.0) {
          float floorH = 3.3, bayW = 2.8;
          float fl = floor(vWall.y / floorH);
          vec2 cell = vec2(floor(vWall.x / bayW), fl);
          vec2 f = vec2(fract(vWall.x / bayW), fract(vWall.y / floorH));
          vec2 w = fwidth(vWall.xy / vec2(bayW, floorH)) * 0.8;
          bool shop = fl < 0.5;
          float win = shop
            ? band(f.x, 0.06, 0.94, w.x) * band(f.y, 0.12, 0.72, w.y)
            : band(f.x, 0.24, 0.76, w.x) * band(f.y, 0.32, 0.82, w.y);
          float r = h21(cell + vWall.z * 91.7);
          float lit = step(shop ? 0.45 : 0.66, r);
          vec3 cool = vec3(0.86, 0.86, 1.0);
          vec3 warm = vec3(1.0, 0.86, 0.58);
          vec3 glow = mix(cool, warm, step(0.88, h21(cell.yx + vWall.z * 17.3)));
          // Far away, windows shrink below a pixel: fade to their average so walls don't shimmer.
          float detail = 1.0 - smoothstep(0.25, 0.6, max(w.x, w.y));
          float litAmount = mix(0.18, win * lit, detail) * (1.0 - uDay);
          totalEmissiveRadiance += glow * litAmount * 1.05;
          diffuseColor.rgb *= 1.0 - win * (1.0 - lit) * 0.35 * detail * (1.0 - uDay);
          // Daytime: windows read as cool, slightly reflective glass.
          vec3 glass = vec3(0.32, 0.4, 0.56);
          diffuseColor.rgb = mix(diffuseColor.rgb, glass, win * detail * uDay * 0.75);
        }`,
      );
  };
  return mat;
}

export function createGroundMaterial(): THREE.MeshLambertMaterial {
  // Ground layers are coplanar; they don't write depth and are ordered with renderOrder instead.
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, depthWrite: false });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uDay = dayUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${DAY_VERTEX_HEAD}`)
      .replace('#include <color_vertex>', DAY_VERTEX_MIX);
  };
  return mat;
}
