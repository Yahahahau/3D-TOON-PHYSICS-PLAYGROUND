# 3D Toon Physics Playground

A free-play 3D physics sandbox with two squishy blue slime characters. Built with
**Three.js**, **custom GLSL toon shaders**, **cannon-es** physics and **Vite**. It is
designed mobile-first (portrait), and also supports tablets and desktop.

Roll, bounce, jump, slide and crash into things. Every object in the arena has real
collision. The slimes leave glossy goo trails and splash slime everywhere.

## Run

```bash
npm install
npm run dev      # dev server (also on your LAN: open the printed URL on a phone)
npm run build    # production build -> dist/
npm run preview  # serve the production build
```

A browser with **WebGL 2** is required. If WebGL is missing or disabled, the game
shows a friendly explanation screen instead of a blank canvas.

## Controls

| | Character A — Bloop | Character B — Glub |
|---|---|---|
| Keyboard | `W A S D` + `Space` | Arrow keys + `Right Shift` |
| Touch (dual) | left joystick + left **JUMP** | right joystick + right **JUMP** |

* **Single mode** (for small screens): tap the `ควบคุม 2 ตัว / 1 ตัว` pill. One stick plus a big JUMP button control the selected slime. `⇄` swaps characters.
* **Camera:** drag empty space (or the mouse) to orbit, use the wheel or a pinch to zoom, and `Q`/`E` to rotate. Distance and angle are also in Settings.
* **Hotkeys:** `P`/`Esc` pause · `R` respawn · `C` cycle camera focus (both → A → B) · `F3` or `` ` `` toggles the physics debug view.
* Holding jump gives a higher jump, and tapping gives a small hop. Pushing into a low step makes the slime hop up it automatically.

## What's in the arena

| Zone | Contents |
|---|---|
| Centre | spawn, crate pyramid, Jenga-style block tower, cubes, balls, barrels, kicker ramp |
| North | 3 staircases (0.20 m / 0.36 m / 0.55 m steps), landings, high deck |
| East | ramps at 10°, 20° and 32° with top platforms |
| West | trampolines (soft / medium / super bouncy), 2 animated spring pads, bouncy wall |
| South | elevator + high ledge, circular-path platform, slider, spinning turntable |
| NW | raised slime pool with buoyancy, drag and ripples (and beach balls that float) |
| NE | ice rink (frictionless) + icy slope, tilted platform |
| SW | sticky honey floor (high friction, slows you down), see-saw on a hinge |
| SE | rope bridge (hinged planks on suspension hangers), domino run |

## Architecture

```
src/
  main.js                 boot, WebGL detection, fatal error screen
  core/        Game.js (orchestrator) · FixedLoop.js (fixed 60 Hz step + interpolation)
               RenderPipeline.js (renderer, pixel ratio, MSAA/FXAA/GTAO composer) · webgl.js
  physics/     PhysicsWorld.js (cannon-es world, materials, live tuning, interpolation)
               BodyInstances.js (many bodies -> one InstancedMesh)
  scene/       Environment.js (sky, sun, fog, shadow frustum) · Arena.js
               arena/StaticBatcher.js (static level merged per look) · arena/textures.js
  characters/  Slime.js (collider, controller, squash/stretch, eyes, blink) · configs.js
  controls/    Keyboard · Joystick · TouchButton · InputManager
  camera/      CameraRig.js (smooth follow, auto framing, orbit/pinch, portrait offset)
  shaders/     chunks.js (cel lighting core) · toon.js · slime.js · surfaces.js
  materials/   ToonMaterial · SurfaceMaterials · SharedUniforms
  effects/     SlimeMap (floor trail RT) · SlimeDecals · TrailSystem · SplashSystem
               PlanarReflection · ContactShadows
  ui/          HUD · SettingsPanel · DebugOverlay · icons · styles.css
  settings/    Settings (reactive store) · presets · AutoQuality
  debug/       PhysicsDebugger.js (colliders, AABBs, velocities, contacts)
  utils/       math, dispose, storage, device, Emitter
```

### Key techniques

* **Collider vs. visuals:** each slime is a single rigid `CANNON.Sphere` that never deforms. Squash and stretch, lean, wobble and blinking are visual only. They are driven by velocities and contact impulses from the solver, so the slimes never sink into the floor.
* **Fixed timestep + interpolation:** physics runs at a fixed 60 Hz. Every rendered object (characters, props, platforms, camera target) is interpolated between the previous and current step, so motion stays smooth at any refresh rate.
* **Toon shading:** custom `ShaderMaterial`s with three cel bands, tinted shadows, hemispheric ambient light, cel specular, rim light and real shadow-map sampling. The slime shader adds subsurface glow, a glossy highlight, a fresnel sky reflection, a vertex jelly wobble and a painted face. The body has an inverted-hull outline.
* **Slime trails:** on the floor, stamps are drawn into a top-down render target with MAX blending, so strokes merge into one continuous liquid. Subtractive blending dries the trail over the *Slime Lifetime*. The floor shader turns the result into glossy goo, with normals from the height gradient, cel highlights, edge highlights and reflections. Raised surfaces get instanced decals that fade in the shader. Nothing is emitted while airborne.
* **Splashes:** droplets come from a pooled instanced system, in big and small sizes. They stretch along their velocity, shrink as they fade, and leave marks where they land.
* **Reflections:** planar reflection of the floor using an oblique clip plane, rendered at 25 %, 40 % or 60 % resolution depending on quality. With reflections off, a cheap analytic sky reflection is used instead.
* **Performance:** InstancedMesh is used for all props, droplets, decals and blob shadows, and static geometry is merged per material (about 22 draw calls on Low, about 57 on High). The renderer uses object pools, adds no per-frame allocations in hot paths, uses a pixel-ratio cap per quality level, disposes GPU resources on quality changes, and lets sleeping bodies rest.
* **Auto Quality:** measures real FPS. When the game can't hold about 60 FPS, it lowers the render scale first and then the preset. With enough headroom it steps back up, but never above the level you picked.

### Settings (all applied live)

* **Graphics:** preset (Low, Medium, High, Ultra), Auto Quality, shadow quality and resolution, reflection quality, ambient occlusion (off, contact blobs, or GTAO SSAO), particle budget, texture quality (crate texture and slime-map resolution), render resolution, anti-aliasing (off, FXAA, MSAA).
* **Physics:** gravity, bounce strength (scales every restitution), friction (scales every friction), movement speed, slime lifetime.
* **Controls & camera:** dual or single touch mode, camera focus, distance and angle.

Settings are saved in `localStorage` when it is available.
