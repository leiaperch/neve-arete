import * as THREE from 'three';

// Scène : studio d'éclairage généré en code et rendu à la demande.
// La page redessine seulement quand le défilement, un choix ou la trotteuse changent quelque chose :
// une image par seconde suffit quand le visiteur lit sans bouger.

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 1, 0.05, 100);
  readonly stats = { frames: 0, idle: 0 };

  private dirty = 2;
  private active = true;
  private animating = 0;
  private onFrame: ((dt: number) => void)[] = [];
  private timer = new THREE.Timer();
  private slowFrames = 0;

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // PBR Neutral : les coloris affichés restent ceux du nuancier
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.setClearColor(0x000000, 0);
    host.appendChild(this.renderer.domElement);

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    new IntersectionObserver(([e]) => {
      this.active = e.isIntersecting;
      if (this.active) this.invalidate();
    }).observe(host);
    document.addEventListener('visibilitychange', () => this.invalidate());
    this.renderer.setAnimationLoop(() => this.tick());
  }

  // Studio : grande boîte à lumière au-dessus, deux découpes latérales qui filent sur la lunette polie,
  // un contre-jour. Converti une fois en éclairage d'environnement, reconstruit au changement de thème.
  buildStudio(dark = false) {
    const room = new THREE.Scene();
    const shell = new THREE.Mesh(
      new THREE.BoxGeometry(30, 16, 30),
      new THREE.MeshBasicMaterial({ color: dark ? 0x141517 : 0x9c9d9f, side: THREE.BackSide })
    );
    room.add(shell);
    const panel = (w: number, h: number, power: number, pos: [number, number, number], rot: [number, number, number]) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(power), side: THREE.DoubleSide })
      );
      m.position.set(...pos);
      m.rotation.set(...rot);
      room.add(m);
    };
    panel(10, 10, dark ? 3 : 4, [0, 7.5, 2], [Math.PI / 2, 0, 0]);
    panel(0.6, 12, 10, [-7, 2, 3], [0, Math.PI / 2, 0]);
    panel(0.6, 12, 7, [7, 1, 3], [0, -Math.PI / 2, 0]);
    panel(12, 3, 1.6, [0, 1, -12], [0, 0, 0]);
    panel(12, 6, dark ? 0.8 : 1.4, [0, 0, 12], [0, Math.PI, 0]);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const previous = this.scene.environment;
    this.scene.environment = pmrem.fromScene(room, 0.02).texture;
    previous?.dispose();
    pmrem.dispose();
    room.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
    this.invalidate();
  }

  invalidate(frames = 2) {
    this.dirty = Math.max(this.dirty, frames);
  }

  hold() {
    this.animating++;
    this.invalidate();
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.animating--;
      this.invalidate();
    };
  }

  each(fn: (dt: number) => void) {
    this.onFrame.push(fn);
  }

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.host;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }

  private tick() {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.1);
    if (!this.active || document.hidden) return;
    if (this.dirty <= 0 && this.animating === 0) {
      this.stats.idle++;
      return;
    }
    this.dirty--;
    for (const fn of this.onFrame) fn(dt);
    this.renderer.render(this.scene, this.camera);
    this.stats.frames++;
    this.adapt(dt);
  }

  // densité de pixels abaissée par paliers si le GPU décroche (portables sans carte graphique dédiée)
  private adapt(dt: number) {
    if (dt > 1 / 40) this.slowFrames++;
    else this.slowFrames = Math.max(0, this.slowFrames - 2);
    if (this.slowFrames > 45) {
      const next = Math.max(1, this.renderer.getPixelRatio() - 0.25);
      if (next < this.renderer.getPixelRatio()) {
        this.renderer.setPixelRatio(next);
        this.resize();
      }
      this.slowFrames = 0;
    }
  }
}
