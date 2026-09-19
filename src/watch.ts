import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { Stage } from './stage';

// La montre : chargement, coloris (variantes glTF), aiguilles à l'heure du visiteur, gravure du fond.

export interface Colorway {
  id: string;
  name: string;
  variant: number; // index de la variante dans le fichier glTF (-1 = matériaux par défaut)
  swatch: string;
  price: number;
}

interface VariantExtension {
  mappings: { material: number; variants: number[] }[];
}

export class Watch {
  readonly root = new THREE.Group();
  readonly size = new THREE.Vector3();
  readonly center = new THREE.Vector3();

  private gltf!: GLTF;
  // chaque aiguille est rattachée à un pivot posé au centre du cadran ; rest = angle mesuré au repos
  private hands: { pivot: THREE.Object3D; rest: number; per: number; value: (d: Date) => number }[] = [];
  private engraveCanvas = document.createElement('canvas');
  private engraveTex!: THREE.CanvasTexture;
  private engraving = '';
  private lastSecond = -1;
  private variantMeshes: { mesh: THREE.Mesh; original: THREE.Material; ext: VariantExtension }[] = [];

  constructor(private stage: Stage) {}

  async load(url: string, onProgress: (p: number) => void) {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    this.gltf = await loader.loadAsync(url, (e) => e.total && onProgress(e.loaded / e.total));
    const model = this.gltf.scene;

    // centrée sur le cadran, à l'échelle d'une scène de 3 unités
    const box = new THREE.Box3().setFromObject(model);
    box.getSize(this.size);
    box.getCenter(this.center);
    model.position.sub(this.center);
    this.root.add(model);
    this.stage.scene.add(this.root);

    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const ext = mesh.userData.gltfExtensions?.KHR_materials_variants as VariantExtension | undefined;
      if (ext) this.variantMeshes.push({ mesh, original: mesh.material as THREE.Material, ext });
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (mat.name === 'Glass Face') {
        // verre saphir : reflets de l'environnement sans passe de transmission
        mesh.material = new THREE.MeshPhysicalMaterial({
          color: 0x0b0d10,
          roughness: 0.02,
          metalness: 0,
          transparent: true,
          opacity: 0.16,
          envMapIntensity: 1.6,
          depthWrite: false,
        });
      }
      if (mat.name === 'Backplate') {
        mat.map = this.engraveTexture();
        mat.metalnessMap = null;
        mat.roughnessMap = null;
        mat.metalness = 1;
        mat.roughness = 0.32;
        mat.needsUpdate = true;
      }
    });

    this.setupHands(model);

    // les aiguilles avancent une fois par seconde : une seule image calculée par seconde au repos
    this.stage.each(() => this.setTime(new Date()));
    window.setInterval(() => {
      if (new Date().getSeconds() !== this.lastSecond) this.stage.invalidate(1);
    }, 250);
    this.setTime(new Date());
  }

  // toutes les variantes compilées d'avance : changer de coloris ne fige jamais l'image
  async precompile() {
    const materials = await this.gltf.parser.getDependencies('material');
    const holder = new THREE.Group();
    const geo = new THREE.PlaneGeometry(0.001, 0.001);
    for (const m of materials as THREE.Material[]) holder.add(new THREE.Mesh(geo, m));
    holder.position.copy(this.stage.camera.position);
    this.stage.scene.add(holder);
    await this.stage.renderer.compileAsync(this.stage.scene, this.stage.camera);
    this.stage.scene.remove(holder);
    geo.dispose();
  }

  async setVariant(index: number) {
    const parser = this.gltf.parser;
    await Promise.all(
      this.variantMeshes.map(async ({ mesh, original, ext }) => {
        const mapping = ext.mappings.find((m) => m.variants.includes(index));
        mesh.material = mapping ? ((await parser.getDependency('material', mapping.material)) as THREE.Material) : original;
      })
    );
    this.stage.invalidate();
  }

  // La compression meshopt déplace l'origine des nœuds : on ne se fie pas au pivot du fichier.
  // Chaque aiguille est accrochée à un pivot au centre du cadran (axe Z du modèle, normal au cadran),
  // et son angle de repos est mesuré sur sa géométrie : la pointe est le sommet le plus éloigné du centre.
  private setupHands(model: THREE.Object3D) {
    const hub = new THREE.Vector3(0, 0, 0.9); // centre du cadran, repère du modèle
    const defs: [string, number, (d: Date) => number][] = [
      ['Hand_Hours', 12, (d) => (d.getHours() % 12) + d.getMinutes() / 60 + d.getSeconds() / 3600],
      ['Hand_Minutes', 60, (d) => d.getMinutes() + d.getSeconds() / 60],
      ['Hand_Seconds', 60, (d) => d.getSeconds()],
    ];
    model.updateMatrixWorld(true);
    const toModel = new THREE.Matrix4();
    const v = new THREE.Vector3();
    for (const [name, per, value] of defs) {
      const hand = model.getObjectByName(name);
      if (!hand) continue;
      const pivot = new THREE.Object3D();
      pivot.position.copy(hub);
      model.add(pivot);
      pivot.updateMatrixWorld(true);
      pivot.attach(hand);

      // pointe de l'aiguille, dans le repère du modèle
      toModel.copy(model.matrixWorld).invert();
      let best = -1;
      let rest = 0;
      hand.updateMatrixWorld(true);
      hand.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const pos = mesh.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).applyMatrix4(toModel);
          const d = (v.x - hub.x) ** 2 + (v.y - hub.y) ** 2;
          if (d > best) {
            best = d;
            rest = Math.atan2(v.x - hub.x, v.y - hub.y); // 0 = midi, sens horaire positif
          }
        }
      });
      this.hands.push({ pivot, rest, per, value });
    }
  }

  // Heure réelle du visiteur, recalculée une fois par seconde
  setTime(now: Date) {
    const s = now.getSeconds();
    if (s === this.lastSecond) return;
    this.lastSecond = s;
    for (const h of this.hands) {
      const angle = (h.value(now) / h.per) * Math.PI * 2;
      // rotation autour de Z : le sens horaire vu de face correspond à un angle négatif
      h.pivot.rotation.z = -(angle - h.rest);
    }
  }

  private engraveTexture() {
    this.engraveCanvas.width = 1024;
    this.engraveCanvas.height = 256;
    this.engraveTex = new THREE.CanvasTexture(this.engraveCanvas);
    this.engraveTex.colorSpace = THREE.SRGBColorSpace;
    this.engraveTex.flipY = false;
    this.engraveTex.anisotropy = 8;
    this.engrave('');
    return this.engraveTex;
  }

  // Gravure du fond de boîte : texte du visiteur, puis mentions techniques.
  // Le placage de texture du fond étire l'image en hauteur : les lignes sont écrasées d'autant (SQUASH).
  engrave(text: string) {
    const SQUASH = 0.42;
    this.engraving = text;
    const g = this.engraveCanvas.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#b3b1b3';
    g.fillRect(0, 0, 1024, 256);
    g.fillStyle = '#2f2e30';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const line = (y: number, font: string, value: string) => {
      g.save();
      g.translate(512, y);
      g.scale(1, SQUASH);
      g.font = font;
      g.fillText(value, 0, 0);
      g.restore();
    };
    line(90, '600 82px "Schibsted Grotesk", Arial, sans-serif', this.engraving || 'NÉVÉ ARÊTE');
    line(140, '500 30px "Schibsted Grotesk", Arial, sans-serif', 'ALTIMÈTRE BAROMÉTRIQUE');
    line(160, '500 30px "Schibsted Grotesk", Arial, sans-serif', 'ÉTANCHE 100 M · TITANE');
    line(180, '500 26px "Schibsted Grotesk", Arial, sans-serif', 'N° 0417 / 1200');
    this.engraveTex.needsUpdate = true;
    this.stage.invalidate();
  }

  get engraved() {
    return this.engraving;
  }
}
