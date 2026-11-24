import { MIDIMIX_MAP } from './midimix-map';
import { MidimixMode } from './midimix-mode';
import { MorphPerformer } from './performer';

/** What is being performed. It lives apart from the GPU look, so a graphics recovery comes back on the same look and mode. */
export class MorphogenPlay {
  readonly performer = new MorphPerformer();
  readonly mode = new MidimixMode(MIDIMIX_MAP, this.performer);
  cue: { look: number; cue: number; seconds: number; hold: boolean; mutate: number; undo: number; scramble: number } | null = null;
}
