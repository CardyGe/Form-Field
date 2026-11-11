/** CSS layout and GPU pixels are independent: render at the display's density. */
export function previewSize(width: number, height: number, aspect: number, pixelRatio: number) {
  const cssWidth = Math.max(1, Math.min(width, height * aspect));
  const cssHeight = cssWidth / aspect;
  const density = Math.max(1, pixelRatio || 1);
  const factor = Math.min(density, 3840 / Math.max(cssWidth, cssHeight), Math.sqrt(8_294_400 / (cssWidth * cssHeight)));
  return { width: Math.max(2, Math.round(cssWidth * factor)), height: Math.max(2, Math.round(cssHeight * factor)), cssWidth, cssHeight };
}
