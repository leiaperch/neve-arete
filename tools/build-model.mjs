// Prépare le modèle de la montre pour le web :
// 1. remplace les textures qui portent les logos du modèle d'exemple (cadran, fermoir, fond de boîte)
//    par les versions nettoyées de raw/ ;
// 2. retire l'animation d'exemple (les aiguilles sont pilotées par l'heure réelle dans la page) ;
// 3. compresse la géométrie (meshopt) et les textures (WebP, 2048 px pour le cadran, 1024 ailleurs).
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read('raw/ChronographWatch.glb');
const root = doc.getRoot();

const replace = async (materialName, slot, file) => {
  const mat = root.listMaterials().find((m) => m.getName() === materialName);
  if (!mat) throw new Error(`matériau introuvable : ${materialName}`);
  const tex = slot === 'base' ? mat.getBaseColorTexture() : mat.getMetallicRoughnessTexture();
  if (!tex) throw new Error(`texture ${slot} absente sur ${materialName}`);
  tex.setImage(await readFile(file)).setMimeType('image/png');
};

await replace('Watch Face', 'base', 'raw/face_clean.png');
await replace('Clasp DGG', 'base', 'raw/clasp_clean.png');
await replace('Clasp DGG', 'mr', 'raw/clasp_mr_clean.png');
await replace('Backplate Khronos', 'base', 'raw/back_clean.png');
await replace('Backplate Khronos', 'mr', 'raw/back_mr_clean.png');

for (const m of root.listMaterials()) {
  m.setName(m.getName().replace(' DGG', '').replace(' Khronos', '').replace('Commerce ', '').replace('Khronos ', ''));
}
for (const n of root.listNodes()) n.setName(n.getName().replace(' DGG', '').replace(' Khronos', ''));
for (const a of root.listAnimations()) a.dispose();

await io.write('raw/watch-clean.glb', doc);

execFileSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['gltf-transform', 'optimize', 'raw/watch-clean.glb', 'public/models/arete.glb',
    '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', '2048',
    '--simplify', 'false', '--join', 'false', '--instance', 'false', '--flatten', 'false', '--palette', 'false'],
  { stdio: 'inherit', shell: true }
);
