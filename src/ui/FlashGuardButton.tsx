/** The Output guard: the area flash limiter on the Live output and the Map wall, for every look except Meridian (which has its own). On at every launch; turning it off asks first and shows plainly while it is off. */
export function FlashGuardButton({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  const toggle = () => {
    if (on && !window.confirm('Turn off the Output guard?\n\nFlashing light can trigger seizures in people with photosensitive epilepsy. The guard comes back on the next time the app starts.')) return;
    onChange(!on);
  };
  return <button className={`text-button live-toggle flash-guard ${on ? '' : 'on'}`} aria-pressed={on}
    title={on ? 'Output guard: holds back rapid flashing on the output for every look except Meridian, which has its own Meridian flash guard. A safety aid, not a certified flash test.' : 'The Output guard is off: rapid flashing can reach the audience. Click to turn it back on.'}
    onClick={toggle}>{on ? 'Output guard on' : 'Output guard OFF'}</button>;
}
