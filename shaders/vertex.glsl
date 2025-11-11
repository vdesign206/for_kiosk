attribute vec4 aPosition;
varying vec2 fragCoord;

void main() {
  gl_Position = aPosition;
  fragCoord = (aPosition.xy * 0.5 + 0.5);
}