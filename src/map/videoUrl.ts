/** Stage 6: how the page asks the app for a video file it may play (the main process checks the path). */
export const videoUrl = (path: string) => `formfield-video://file/${encodeURIComponent(path)}`;
