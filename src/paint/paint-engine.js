export const MAX_BITMAP_BYTES = 64 * 1024 * 1024;
export const FRAME_BUDGET_MS = 1000 / 60;

const clampByte = (value) => Math.max(0, Math.min(255, Math.round(value)));
const clampInt = (value, low, high) => Math.max(low, Math.min(high, Math.round(value)));

export function parseColor(value) {
  const hex = String(value).replace("#", "");
  if (!/^[\da-f]{6}([\da-f]{2})?$/i.test(hex)) return [0, 0, 0, 255];
  return [0, 2, 4, 6].map((offset) => offset === 6 && hex.length === 6
    ? 255
    : Number.parseInt(hex.slice(offset, offset + 2), 16));
}

export function fitBitmapSize(width, height, byteLimit = MAX_BITMAP_BYTES) {
  width = Math.max(1, Math.round(width));
  height = Math.max(1, Math.round(height));
  const scale = Math.min(1, Math.sqrt(byteLimit / (width * height * 4)));
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
    scale,
    degraded: scale < 1,
  };
}

export class PixelDocument {
  constructor(width = 1200, height = 800, pixels) {
    const fitted = fitBitmapSize(width, height);
    this.width = fitted.width;
    this.height = fitted.height;
    this.degraded = fitted.degraded;
    this.pixels = pixels instanceof Uint8ClampedArray
      ? pixels.slice(0, this.width * this.height * 4)
      : new Uint8ClampedArray(this.width * this.height * 4);
    if (!pixels) this.clear("#ffffff");
    this.revision = 0;
  }

  clear(color = "#ffffff") {
    const rgba = parseColor(color);
    for (let index = 0; index < this.pixels.length; index += 4) this.pixels.set(rgba, index);
    this.revision += 1;
  }

  pixel(x, y) {
    x = clampInt(x, 0, this.width - 1);
    y = clampInt(y, 0, this.height - 1);
    return Array.from(this.pixels.slice((y * this.width + x) * 4, (y * this.width + x) * 4 + 4));
  }

  blendPixel(x, y, color) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const index = (y * this.width + x) * 4;
    const alpha = color[3] / 255;
    const inverse = 1 - alpha;
    this.pixels[index] = clampByte(color[0] * alpha + this.pixels[index] * inverse);
    this.pixels[index + 1] = clampByte(color[1] * alpha + this.pixels[index + 1] * inverse);
    this.pixels[index + 2] = clampByte(color[2] * alpha + this.pixels[index + 2] * inverse);
    this.pixels[index + 3] = clampByte(color[3] + this.pixels[index + 3] * inverse);
  }

  brushLine(x0, y0, x1, y1, options = {}) {
    const color = parseColor(options.color ?? "#111111");
    const radius = Math.max(.5, Number(options.size ?? 8) / 2);
    const distance = Math.hypot(x1 - x0, y1 - y0);
    if (distance === 0) {
      this.#stamp(x0, y0, radius, color);
      this.revision += 1;
      return;
    }
    const steps = Math.max(1, Math.ceil(distance / Math.max(1, radius * .4)));
    for (let step = 0; step <= steps; step += 1) {
      const amount = step / steps;
      this.#stamp(x0 + (x1 - x0) * amount, y0 + (y1 - y0) * amount, radius, color);
    }
    this.revision += 1;
  }

  #stamp(cx, cy, radius, color) {
    const left = Math.floor(cx - radius);
    const right = Math.ceil(cx + radius);
    const top = Math.floor(cy - radius);
    const bottom = Math.ceil(cy + radius);
    const softEdge = Math.max(.5, Math.min(1, radius));
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        const coverage = Math.min(1, (radius + .5 - Math.hypot(x - cx, y - cy)) / softEdge);
        if (coverage > 0) this.blendPixel(x, y, [color[0], color[1], color[2], color[3] * coverage]);
      }
    }
  }

  rectangle(x0, y0, x1, y1, options = {}) {
    const color = parseColor(options.color ?? "#111111");
    const size = Math.max(1, Math.round(options.size ?? 4));
    const left = Math.min(Math.round(x0), Math.round(x1));
    const right = Math.max(Math.round(x0), Math.round(x1));
    const top = Math.min(Math.round(y0), Math.round(y1));
    const bottom = Math.max(Math.round(y0), Math.round(y1));
    for (let offset = 0; offset < size; offset += 1) {
      for (let x = left; x <= right; x += 1) {
        this.blendPixel(x, top + offset, color);
        this.blendPixel(x, bottom - offset, color);
      }
      for (let y = top; y <= bottom; y += 1) {
        this.blendPixel(left + offset, y, color);
        this.blendPixel(right - offset, y, color);
      }
    }
    this.revision += 1;
  }

  crop(x, y, width, height) {
    x = clampInt(x, 0, this.width - 1);
    y = clampInt(y, 0, this.height - 1);
    width = clampInt(width, 1, this.width - x);
    height = clampInt(height, 1, this.height - y);
    const result = new Uint8ClampedArray(width * height * 4);
    for (let row = 0; row < height; row += 1) {
      const start = ((y + row) * this.width + x) * 4;
      result.set(this.pixels.subarray(start, start + width * 4), row * width * 4);
    }
    this.width = width;
    this.height = height;
    this.pixels = result;
    this.revision += 1;
  }

  resize(width, height) {
    const fitted = fitBitmapSize(width, height);
    const result = new Uint8ClampedArray(fitted.width * fitted.height * 4);
    for (let y = 0; y < fitted.height; y += 1) {
      const sourceY = Math.min(this.height - 1, Math.floor(y * this.height / fitted.height));
      for (let x = 0; x < fitted.width; x += 1) {
        const sourceX = Math.min(this.width - 1, Math.floor(x * this.width / fitted.width));
        const source = (sourceY * this.width + sourceX) * 4;
        result.set(this.pixels.subarray(source, source + 4), (y * fitted.width + x) * 4);
      }
    }
    this.width = fitted.width;
    this.height = fitted.height;
    this.pixels = result;
    this.degraded ||= fitted.degraded;
    this.revision += 1;
  }

  filter(name) {
    for (let index = 0; index < this.pixels.length; index += 4) {
      const red = this.pixels[index];
      const green = this.pixels[index + 1];
      const blue = this.pixels[index + 2];
      if (name === "grayscale") {
        const luminance = clampByte(.2126 * red + .7152 * green + .0722 * blue);
        this.pixels[index] = this.pixels[index + 1] = this.pixels[index + 2] = luminance;
      } else if (name === "invert") {
        this.pixels[index] = 255 - red;
        this.pixels[index + 1] = 255 - green;
        this.pixels[index + 2] = 255 - blue;
      } else if (name === "sepia") {
        this.pixels[index] = clampByte(.393 * red + .769 * green + .189 * blue);
        this.pixels[index + 1] = clampByte(.349 * red + .686 * green + .168 * blue);
        this.pixels[index + 2] = clampByte(.272 * red + .534 * green + .131 * blue);
      }
    }
    this.revision += 1;
  }
}

function shader(gl, type, source) {
  const result = gl.createShader(type);
  gl.shaderSource(result, source);
  gl.compileShader(result);
  if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(result));
  return result;
}

export class WebGLPresenter {
  constructor(canvas, now = () => globalThis.performance?.now?.() ?? 0) {
    this.canvas = canvas;
    this.now = now;
    this.gl = canvas.getContext("webgl", {
      alpha: false, antialias: false, depth: false, stencil: false,
      premultipliedAlpha: true, preserveDrawingBuffer: true,
    });
    if (!this.gl) throw new Error("WebGL is unavailable");
    const gl = this.gl;
    const program = gl.createProgram();
    gl.attachShader(program, shader(gl, gl.VERTEX_SHADER,
      "attribute vec2 p;varying vec2 uv;void main(){uv=vec2((p.x+1.0)*.5,(1.0-p.y)*.5);gl_Position=vec4(p,0,1);}"));
    gl.attachShader(program, shader(gl, gl.FRAGMENT_SHADER,
      "precision mediump float;uniform sampler2D image;varying vec2 uv;void main(){gl_FragColor=texture2D(image,uv);}"));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "p");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    this.uploadedRevision = -1;
  }

  render(document, devicePixelRatio = 1) {
    const start = this.now();
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width * devicePixelRatio));
    const height = Math.max(1, Math.round(rect.height * devicePixelRatio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    const gl = this.gl;
    gl.viewport(0, 0, width, height);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    if (this.uploadedRevision !== document.revision) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, document.width, document.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, document.pixels);
      this.uploadedRevision = document.revision;
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    return this.now() - start;
  }
}
