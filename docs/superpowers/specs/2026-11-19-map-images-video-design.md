# Map stage 6: images and video in shapes

19 November 2026. This finishes stage 6 of the projection-mapping design ("Image, Video and Live look sources"). Live is done (Live in Map). Greg: video will be "short loops mostly".

## Intent

A shape can play Greg's own pictures and short video loops next to the effects and Live. The loops will mostly be textures and motion clips he made or found. Each behaves like everything else a shape plays:
- placed with Fit, Pin, Across group or Across stage
- switched in scenes, with crossfades
- shaded by the shape's brightness, tint, edges and Blocker
- driven by ∿ reactions

## Goals

### Images
- An **Image…** tile in the look browser opens a file picker for PNG or JPEG. The shape then plays that picture.
- **Stored in the show file**, as the design decided. The picture travels with the show.
- **Built as Studio's own image layer:** a one-layer composition of the `image` kind. Studio's image fit and its other image options then appear in the Effect tab through Studio's own controls.
  - Edit in Studio works on it as on any effect.
  - "Change all linked shapes", Share with and Make separate behave as for effects.
- **Size:** the same limits as Studio's image layer (16384 px a side, 64 megapixels).
  - A file over **8 MB** is refused with a note, as the room photo is today, so shows stay small enough to send to the projector (my call).

### Video
- A **Video…** tile picks an MP4 or MOV file (and anything else the projector's player can play).
- **Not copied:** the file stays where it is on disk, and the show keeps its path and name.
- **Always looping and always muted** (my call). A video's own sound never plays. Sound in the room comes in through the sound input.
- **One video, played once:** every shape playing the same video shows the same frame (one player). Several videos in a show each have their own player.
- **Speed** (0.1 to 4×, as effects), with ∿, so playback speed can react to sound.
- **Loop with the tempo** (my call):
  - Off, or one loop of the video every 1, 2, 4, 8 or 16 beats.
  - The playback rate is set so the clip's length fits that many beats at the current tempo, and the loop restarts on the beat.
  - Speed is greyed while it is on, as for effects.
- **Picture:** the video fills each shape and crops what overflows, never stretched, as Live does. Placement and the shape's look apply.
- **A missing or unplayable file** never goes black:
  - the shape plays its own colour or grid
  - on Greg's screen, the shape's Effect tab names the file and says why it isn't playing
  - **Find…** lets him point at the file's new place, and updates every shape and scene using that video
- **Scenes:** a video used by both scenes keeps running through the switch, like an effect.
- **Freeze** pauses every video. Blackout and the stage corners apply as everywhere.
- **The operator screen:** with the output closed, it plays the videos itself. With the output open, it shows the projector's picture, as today.

## Calls made after the builder check

My calls, for Greg to check:

1. **"One video" is a video in the show, like an effect's instrument.**
   - Shapes sharing it share one player and never drift.
   - **Make separate** gives a shape its own copy: its own player, its own Speed and Loop with the tempo.
   - **The 16 limit** counts videos in the show.
   - **Find…** updates every video that used the same missing file, and the shapes and scenes using them. Each video reports its own state.
2. **Loop with the tempo when the speed would be unplayable.**
   - The playback rate is kept between 0.1× and 4× (the Speed range).
   - When the chosen beat count needs a rate outside that, the nearest beat count that fits is used, and the Effect tab says so: "Plays as 8 beats: the clip is too long for 1".
   - While tempo looping is on, Speed and its ∿ are greyed, as for effects.
   - The loop restarts on the beat.
3. **Images have a show-wide budget of 32 MB**, on top of the 8 MB a file.
   - Picking a picture over the budget is refused with a note saying how much is used.
   - The same picture picked twice is stored once.
   - An image composition coming back from Edit in Studio over the budget is refused with the same note. Studio keeps the edit open so it can be undone.
4. **Which video files the projector may open.** The main process keeps its own list. It allows:
   - files picked in the Video… dialog or with Find…
   - the video paths in a show opened through the app's Open dialog, or restored from its own autosave

   It opens only files with a video extension (.mp4, .mov, .m4v, .webm). Any other path in a show is never opened. So a saved show plays its videos at once when reopened, but nothing else on disk can be reached through a show.
5. **Scene switches:** a video only the incoming scene uses starts loading at the switch.
   - The shape shows its own fill until the first frame arrives, then crossfades in, as Live does.
   - Only videos on screen are kept open; one used by no shape on screen is closed after the fade.
   - A tempo-looped video starts at the loop position the beat calls for; any other video starts from its beginning.

## Non-goals

- Video sound playback, or using a video's soundtrack as a sound input.
- Trimming, cue points, or play-once clips: loops only.
- Copying videos into the show, or collecting a show's media into one folder.
- Images or video in Studio's export.
- HAP and ProRes playback. The player plays what the browser's video player plays. A file it cannot play gets a note suggesting MP4 (H.264).

## Anti-goals

These would be failures even if everything else worked:

- The projector goes black while a video loads, when a file is missing, or when a video switches.
- Shapes sharing one video drift out of step.
- A show holding images that is too large to send to the projector, or to save.
- The projector reading files the show did not choose. Only paths Greg picked in a file picker, or found with Find…, are ever opened.

## Constraints

- **The camera, sound and MIDI rules stay as they are.** Video needs no new permission.
- **Reading files from disk:** the projector window (and the operator screen) read videos only through the main process. The main process opens only paths Greg has picked in the app's file dialog or with Find…, for this show.
  - The page never gets general file access.
  - The page's content rules allow only this one route to video files.
- **Show file version 7** (images need nothing new; video does). Version 6 files open unchanged.
- **Limits:**
  - at most 16 videos in a show (my call)
  - videos count against the 24 effects playing at once, as Live does not
- **Performance:** with eight effects and two video shapes, the projector stays at the display's rate with the governor at level 0. Video frames are uploaded only when a new frame has arrived.

## Approaches considered

1. **Images as Studio image layers; video as a new kind of thing a shape plays** (chosen).
   - Images reuse a path that already works end to end, and add only a tile and a file picker.
   - Video is added the way Live was: a player in the compositor, uploaded once a frame, cropped to cover.
2. **Video as a Studio layer kind.** Rejected:
   - Studio's preview, export and file format would all have to learn video, including export, which cannot handle it.
   - Map needs none of that.
3. **Copy videos into the show file.** Rejected: short loops can still be tens of megabytes, too large to save and send. The design already chose paths.

## What is left to the builder

- How video sources are kept in the show: a new source kind, or a list of their own. Shapes, scenes, links and Make separate must treat a video like an effect's source.
- How the main process serves a chosen file to the page (for example a private scheme answering only allowed paths), and how the allowed paths persist with the show.
- The tiles' preview art.
- What the Effect tab shows for a video, beyond its name, Speed, Loop with the tempo and Find….
