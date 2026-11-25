/** The output's flash guard switch. On at every launch; turning it off asks first and shows plainly while it is off. */
export function FlashGuardButton({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  const toggle = () => {
    if (on && !window.confirm('Turn off the flash guard?\n\nFlashing light can trigger seizures in people with photosensitive epilepsy. The guard comes back on the next time the app starts.')) return;
    onChange(!on);
  };
  return <button className={`text-button live-toggle flash-guard ${on ? '' : 'on'}`} aria-pressed={on}
    title={on ? 'Holds back rapid flashing on the output. A safety aid, not a certified flash test.' : 'The flash guard is off: rapid flashing can reach the audience. Click to turn it back on.'}
    onClick={toggle}>{on ? 'Flash guard on' : 'Flash guard OFF'}</button>;
}
