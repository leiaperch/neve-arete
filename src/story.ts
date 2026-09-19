import * as THREE from 'three';
import type { Stage } from './stage';

// Mouvements de caméra pilotés par le défilement, sans le détourner : la position de lecture choisit un
// plan, la caméra le rejoint avec un léger amorti. Remonter la page rejoue les plans à l'envers.

export interface Shot {
  id: string;
  position: [number, number, number];
  target: [number, number, number];
  spin?: number; // rotation de la montre sur elle-même (radians)
  fov?: number; // ouverture de la caméra, 30° par défaut
}

export class Story {
  private anchors: number[] = [];
  private goal = { pos: new THREE.Vector3(), target: new THREE.Vector3(), spin: 0, fov: 30 };
  private current = { pos: new THREE.Vector3(), target: new THREE.Vector3(), spin: 0, fov: 30 };
  private a = new THREE.Spherical();
  private b = new THREE.Spherical();
  private tmp = new THREE.Vector3();
  private reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  onShot?: (id: string) => void;
  // recul : 1 sur grand écran, davantage sur un écran étroit où la montre remplit la largeur
  zoom = 1;
  private lastShot = '';

  constructor(
    private stage: Stage,
    private subject: THREE.Object3D,
    private shots: Shot[],
    private chapters: HTMLElement[]
  ) {
    const measure = () => {
      // ancre de chaque chapitre : le moment où son milieu passe au milieu de l'écran
      this.anchors = this.chapters.map((el) => {
        const r = el.getBoundingClientRect();
        return window.scrollY + r.top + r.height / 2 - window.innerHeight / 2;
      });
      this.update(true);
    };
    new ResizeObserver(measure).observe(document.body);
    window.addEventListener('scroll', () => this.update(), { passive: true });
    measure();

    stage.each((dt) => this.follow(dt));
  }

  private update(snap = false) {
    const y = window.scrollY;
    const n = this.anchors.length;
    let i = 0;
    while (i < n - 1 && y > this.anchors[i + 1]) i++;
    const start = this.anchors[i];
    const end = this.anchors[Math.min(i + 1, n - 1)];
    let t = end > start ? THREE.MathUtils.clamp((y - start) / (end - start), 0, 1) : 0;
    t = t * t * (3 - 2 * t);

    const s0 = this.shots[i];
    const s1 = this.shots[Math.min(i + 1, n - 1)];
    // interpolation autour de la cible : la caméra tourne autour de la montre au lieu de la traverser
    const t0 = new THREE.Vector3(...s0.target);
    const t1 = new THREE.Vector3(...s1.target);
    this.goal.target.lerpVectors(t0, t1, t);
    this.a.setFromVector3(this.tmp.set(...s0.position).sub(t0));
    this.b.setFromVector3(this.tmp.set(...s1.position).sub(t1));
    let dTheta = this.b.theta - this.a.theta;
    if (dTheta > Math.PI) dTheta -= Math.PI * 2;
    if (dTheta < -Math.PI) dTheta += Math.PI * 2;
    const sph = new THREE.Spherical(
      THREE.MathUtils.lerp(this.a.radius, this.b.radius, t),
      THREE.MathUtils.lerp(this.a.phi, this.b.phi, t),
      this.a.theta + dTheta * t
    );
    this.goal.pos.setFromSpherical(sph).add(this.goal.target);
    this.goal.spin = THREE.MathUtils.lerp(s0.spin ?? 0, s1.spin ?? 0, t);
    this.goal.fov = THREE.MathUtils.lerp(s0.fov ?? 30, s1.fov ?? 30, t);

    const shot = t < 0.5 ? s0.id : s1.id;
    if (shot !== this.lastShot) {
      this.lastShot = shot;
      this.onShot?.(shot);
    }

    if (snap || this.reduced) {
      this.current.pos.copy(this.goal.pos);
      this.current.target.copy(this.goal.target);
      this.current.spin = this.goal.spin;
      this.current.fov = this.goal.fov;
    }
    this.stage.invalidate(3);
  }

  // amorti léger vers le plan visé ; le rendu continue tant que la caméra n'est pas arrivée
  private follow(dt: number) {
    const k = 1 - Math.exp(-dt * 7);
    this.current.pos.lerp(this.goal.pos, k);
    this.current.target.lerp(this.goal.target, k);
    this.current.spin += (this.goal.spin - this.current.spin) * k;
    this.current.fov += (this.goal.fov - this.current.fov) * k;
    const cam = this.stage.camera;
    // le recul passe par l'ouverture de l'objectif : la caméra ne sort jamais de la boucle du bracelet
    const fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(this.current.fov) / 2) * this.zoom));
    if (Math.abs(cam.fov - fov) > 1e-3) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    cam.position.copy(this.current.pos);
    cam.lookAt(this.current.target);
    this.subject.rotation.y = this.current.spin;
    if (this.current.pos.distanceToSquared(this.goal.pos) > 1e-6 || Math.abs(this.goal.spin - this.current.spin) > 1e-4 || Math.abs(this.goal.fov - this.current.fov) > 1e-2) {
      this.stage.invalidate(2);
    }
  }
}
