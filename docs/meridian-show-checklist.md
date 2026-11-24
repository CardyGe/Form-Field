# Meridian show checklist

Print this on one page. Meridian is alpha until party feedback is in.

## Before doors

- [ ] Mac on power, sleep off, notifications off. Open Form & Field and switch to **Map**.
- [ ] Projector connected. In **Projector**, pick it, then press **Open output**. Check the refresh rate is 50 Hz or faster and the lines look sharp at full size. Single display? Choose the **Projector** and save the show first.
- [ ] Map shapes fit the surfaces. Press **Test grid** and **Identify**, then check each corner.
- [ ] Sound: in the **Sound** select of the "Sound and scenes" strip under the stage, choose the DJ input. Play music and watch the meters and light follow. No music yet? Use the test beat. (In Studio the Meridian panel says "Choose a sound input".)
- [ ] **Flash guard** is **on**: the Meridian panel reads "Flash guard on". Leave it. The Map footer warns "Flash guard is off" or "Flash limiter unavailable"; if you see either, fix it before doors. It is not a certified photosensitivity test.
- [ ] Press **Blackout**, then press it again to bring the picture back.
- [ ] Live (if used): aim the camera away from the projection and the lighting rig. Read the Live status line: "Movement only" means people are found from movement alone, so keep the beam and moving lights out of its view. Step in front and check shapes follow you.
- [ ] MIDI controller plugged in and learned (if used). Press each control once.
- [ ] Frame rate: close other apps, then run `caffeinate -i node scripts/soak-meridian.mjs --hours 0.25` on this Mac and read the fps it prints.
- [ ] Optional: turn on Installation mode so autopilot can run the show.

## During the set

- Evolve is calm and never resets. Leave it alone most of the time.
- Moves: **N** Next, **H** Hold, **D** Drop, **C** Collapse (in Live it is called **Gather**), **M** Mutate, **R** Reseed. Burst is a button. Keys **1 to 8** recall seed slots.
- Too busy: lower **Density** or **Speed**, or press **H** to hold the shape.
- Too plain: raise **Heat** or **Weight**, or press **N**.
- Music changes: use **Drop** or **Collapse**.

## If something goes wrong

- **Blackout** first. Breathe. Bring it back when ready.
- Picture frozen: check **Freeze** is not lit. Press it to release. Picture wrong but moving: press **R**.
- Picture slow: close other apps. Quality drops glow first; never line sharpness or Flash guard.
- Wall gone or crashed (it does not reopen by itself): if the output is still open press **Close output**, pick the screen in **Projector**, then press **Open output**.
- No sound response: check the **Sound** select, or use the test beat.
- Live shapes ignore people: check the camera is not covered, then close and reopen the Live output.
- Last resort: quit and reopen the app, restore the saved show, pick the **Projector**, press **Open output**. Faults are written as plain text to `installation-faults.log` in the app's data folder (`~/Library/Application Support`).

## After

- [ ] **Blackout**, **Close output**, quit the app.
- [ ] Save the show if you changed it.
- [ ] Write down what worked and what did not: frame rate, line width, camera position, anything odd.
- [ ] Tell us. Party feedback decides what changes next.
