"""Generate an atomic-orbital style application icon."""
from PIL import Image, ImageDraw, ImageFilter
import math
import os

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "buildResources")
SIZE = 1024  # render at high res, then downsample for crispness
FINAL = 512

def lerp_color(c1, c2, t):
    return tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(len(c1)))

def make_background(size):
    """Dark navy rounded-square with radial gradient."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    # radial gradient
    grad = Image.new("RGBA", (size, size))
    cx, cy = size / 2, size / 2
    max_r = math.hypot(cx, cy)
    inner = (28, 38, 70)      # deep blue
    outer = (6, 8, 18)        # near black
    px = grad.load()
    for y in range(size):
        for x in range(size):
            r = math.hypot(x - cx, y - cy) / max_r
            r = min(1.0, r)
            c = lerp_color(inner, outer, r ** 1.2)
            px[x, y] = (c[0], c[1], c[2], 255)
    # rounded-square mask
    mask = Image.new("L", (size, size), 0)
    md = ImageDraw.Draw(mask)
    radius = int(size * 0.22)
    md.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    img.paste(grad, (0, 0), mask)
    return img

def draw_glow_ellipse(canvas, bbox, rotation_deg, color, line_width, glow_layers):
    """Draw an elliptical orbit with glow by stacking blurred strokes."""
    size = canvas.size[0]
    # Render the ellipse on an oversized transparent layer, rotate, paste.
    pad = size  # large pad to avoid clipping during rotation
    layer_size = size + pad * 2
    layer = Image.new("RGBA", (layer_size, layer_size), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    x0, y0, x1, y1 = bbox
    shifted = (x0 + pad, y0 + pad, x1 + pad, y1 + pad)

    # outer glow halos (largest/softest first)
    for radius, alpha_scale, blur in glow_layers:
        halo = Image.new("RGBA", (layer_size, layer_size), (0, 0, 0, 0))
        hd = ImageDraw.Draw(halo)
        r, g, b, _ = color
        hd.ellipse(shifted, outline=(r, g, b, int(255 * alpha_scale)), width=radius)
        halo = halo.filter(ImageFilter.GaussianBlur(blur))
        layer = Image.alpha_composite(layer, halo)

    # crisp core stroke
    ld = ImageDraw.Draw(layer)
    ld.ellipse(shifted, outline=color, width=line_width)

    # rotate, crop back to canvas size
    rotated = layer.rotate(rotation_deg, resample=Image.BICUBIC, center=(layer_size / 2, layer_size / 2))
    crop = rotated.crop((pad, pad, pad + size, pad + size))
    return Image.alpha_composite(canvas, crop)

def draw_nucleus(canvas):
    size = canvas.size[0]
    cx, cy = size / 2, size / 2
    # big soft halo
    halo = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    hd = ImageDraw.Draw(halo)
    R = int(size * 0.11)
    hd.ellipse([cx - R, cy - R, cx + R, cy + R], fill=(120, 200, 255, 120))
    halo = halo.filter(ImageFilter.GaussianBlur(int(size * 0.035)))
    canvas = Image.alpha_composite(canvas, halo)
    # mid glow
    mid = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    md = ImageDraw.Draw(mid)
    R2 = int(size * 0.055)
    md.ellipse([cx - R2, cy - R2, cx + R2, cy + R2], fill=(200, 230, 255, 220))
    mid = mid.filter(ImageFilter.GaussianBlur(int(size * 0.012)))
    canvas = Image.alpha_composite(canvas, mid)
    # crisp white core
    core = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    cd = ImageDraw.Draw(core)
    R3 = int(size * 0.032)
    cd.ellipse([cx - R3, cy - R3, cx + R3, cy + R3], fill=(255, 255, 255, 255))
    canvas = Image.alpha_composite(canvas, core)
    return canvas

def build_icon(size):
    img = make_background(size)

    # ellipse geometry: tall thin ellipse centered, rotated three ways
    cx, cy = size / 2, size / 2
    rx = size * 0.40   # half-width of ellipse (along its major axis after rotation)
    ry = size * 0.16   # half-height (minor axis)
    bbox = (cx - rx, cy - ry, cx + rx, cy + ry)

    line_w = max(2, int(size * 0.012))
    blue = (88, 170, 255, 255)
    cyan_glow = (110, 200, 255, 255)

    glow_layers = [
        (int(size * 0.05), 0.55, size * 0.030),  # wide soft halo
        (int(size * 0.022), 0.85, size * 0.012), # tight inner glow
    ]

    for angle in (0, 60, 120):
        img = draw_glow_ellipse(img, bbox, angle, blue, line_w, glow_layers)

    img = draw_nucleus(img)

    # apply rounded-square mask again to clip any glow bleed
    mask = Image.new("L", (size, size), 0)
    md = ImageDraw.Draw(mask)
    radius = int(size * 0.22)
    md.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out

def main():
    print(f"Rendering at {SIZE}x{SIZE}...")
    big = build_icon(SIZE)
    final = big.resize((FINAL, FINAL), Image.LANCZOS)

    png_path = os.path.join(OUT_DIR, "app-icon.png")
    final.save(png_path, "PNG")
    print(f"Saved PNG -> {png_path}")

    # ICO: multiple sizes for Windows
    ico_sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]
    ico_path = os.path.join(OUT_DIR, "icon.ico")
    # build images for each size by resampling from the high-res render
    icons = [big.resize(s, Image.LANCZOS) for s in ico_sizes]
    icons[0].save(ico_path, format="ICO", sizes=ico_sizes, append_images=icons[1:])
    print(f"Saved ICO -> {ico_path}")

if __name__ == "__main__":
    main()
