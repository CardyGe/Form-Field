/** Which signal each physical MIDImix control sends. */
export interface MidimixMap {
  /** False until every control has been captured from the real device. */
  confirmed: boolean;
  /** Three rows of eight knobs. */
  knobs: string[][];
  faders: string[];
  master: string;
  amber: string[];
  red: string[];
  solo: string;
  sendAll: string;
}

/** What Morphogen mode needs to hear. Faders are left out on purpose: they keep their brightness job. */
export const midimixInputs = (map: MidimixMap): string[] => [...map.knobs[0], map.knobs[1][0], ...map.amber, ...map.red, map.solo, map.sendAll, 'tempo.bpm', 'tempo.beat'];

/**
 * PLACEHOLDER. These numbers have not been read from a real MIDImix. Capture every control from the device and set
 * `confirmed` to true before the party go/no-go.
 */
export const MIDIMIX_MAP: MidimixMap = {
  confirmed: false,
  knobs: [0, 1, 2].map(row => Array.from({ length: 8 }, (_, strip) => `midi.cc.1.${16 + row * 8 + strip}`)),
  faders: Array.from({ length: 8 }, (_, strip) => `midi.cc.1.${48 + strip}`),
  master: 'midi.cc.1.56',
  amber: Array.from({ length: 8 }, (_, strip) => `midi.note.1.${strip}`),
  red: Array.from({ length: 8 }, (_, strip) => `midi.note.1.${8 + strip}`),
  solo: 'midi.note.1.16',
  sendAll: 'midi.note.1.17',
};
