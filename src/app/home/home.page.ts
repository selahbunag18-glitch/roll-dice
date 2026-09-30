import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButton,
} from '@ionic/angular/standalone';
import { Capacitor, PluginListenerHandle } from '@capacitor/core';
import { Motion } from '@capacitor/motion';

type MotionPermission = 'checking' | 'prompt' | 'granted' | 'denied';

// Face layouts on a 3x3 grid (indexes 0-8, left→right, top→bottom)
const DICE_FACES: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  imports: [IonButton, IonHeader, IonToolbar, IonTitle, IonContent, DecimalPipe],
})
export class HomePage implements OnInit, OnDestroy {
  /**
   * Minimum X-axis acceleration (m/s²) that counts as a shake. Adjust as needed:
   * lower = more sensitive, higher = needs a harder shake.
   */
  private readonly SHAKE_THRESHOLD = 12;
  /** Time (ms) after a roll during which further motion is ignored. */
  private readonly COOLDOWN_MS = 1500;
  /** Length (ms) of the dice animation. Must match the CSS animation duration (0.7s). */
  private readonly ROLL_ANIM_MS = 700;

  readonly cells = [0, 1, 2, 3, 4, 5, 6, 7, 8];

  result = signal<number>(1);
  hasRolled = signal<boolean>(false);
  rolling = signal<boolean>(false);
  permission = signal<MotionPermission>('checking');
  xValue = signal<number>(0);

  activePips = computed(() => DICE_FACES[this.result()]);

  private accelHandle?: PluginListenerHandle;
  private lastGravityX: number | null = null;
  private lastRollTime = 0;
  private animTimer?: ReturnType<typeof setInterval>;
  private rollTimer?: ReturnType<typeof setTimeout>;

  async ngOnInit() {
    // Native Android/iOS apps don't need the browser permission prompt.
    if (Capacitor.isNativePlatform()) {
      this.permission.set('granted');
      await this.startListening();
      return;
    }

    // Browsers: iOS 13+ Safari requires an explicit permission request from a user tap.
    const DME = (window as any).DeviceMotionEvent;
    if (DME && typeof DME.requestPermission === 'function') {
      this.permission.set('prompt');
    } else {
      this.permission.set('granted');
      await this.startListening();
    }
  }

  async requestMotionPermission() {
    const DME = (window as any).DeviceMotionEvent;
    try {
      const response: string = await DME.requestPermission();
      if (response === 'granted') {
        this.permission.set('granted');
        await this.startListening();
      } else {
        this.permission.set('denied');
      }
    } catch {
      this.permission.set('denied');
    }
  }

  private async startListening() {
    if (this.accelHandle) return;

    this.accelHandle = await Motion.addListener('accel', (event) => {
      // X axis ONLY. Y and Z are never read.
      let strength: number;

      const ax = event.acceleration?.x;
      if (typeof ax === 'number') {
        // Gravity-free acceleration along X: a shake shows up directly as a large value.
        strength = Math.abs(ax);
        this.xValue.set(ax);
      } else {
        // Fallback for devices that don't report `acceleration`:
        // use the change in X (with gravity) between two samples.
        const gx = event.accelerationIncludingGravity?.x;
        if (typeof gx !== 'number') return;
        this.xValue.set(gx);
        if (this.lastGravityX === null) {
          this.lastGravityX = gx;
          return;
        }
        strength = Math.abs(gx - this.lastGravityX);
        this.lastGravityX = gx;
      }

      const cooledDown = Date.now() - this.lastRollTime >= this.COOLDOWN_MS;

      if (strength >= this.SHAKE_THRESHOLD && cooledDown && !this.rolling()) {
        this.rollDice();
      }
    });
  }

  private rollDice() {
    if (this.rolling()) return;

    this.lastRollTime = Date.now(); // starts the cooldown
    this.hasRolled.set(true);
    this.rolling.set(true); // adds the .rolling class: the dice element shakes and spins

    const finalResult = Math.floor(Math.random() * 6) + 1;

    // Flicker random faces while the dice tumbles, then settle on the real result.
    this.animTimer = setInterval(() => {
      this.result.set(Math.floor(Math.random() * 6) + 1);
    }, 80);

    this.rollTimer = setTimeout(() => {
      clearInterval(this.animTimer);
      this.result.set(finalResult);
      this.rolling.set(false);
    }, this.ROLL_ANIM_MS);
  }

  isPip(index: number): boolean {
    return this.activePips().includes(index);
  }

  async ngOnDestroy() {
    clearInterval(this.animTimer);
    clearTimeout(this.rollTimer);
    await this.accelHandle?.remove();
    this.accelHandle = undefined;
  }
}