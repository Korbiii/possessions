"""Generates the PWA icons (no design tool required)."""
from PIL import Image, ImageDraw

BG = (11, 17, 32, 255)
SKY = (56, 189, 248, 255)
ORANGE = (249, 115, 22, 255)
GREEN = (34, 197, 94, 255)
SS = 4  # supersampling factor


def draw_icon(size: int, maskable: bool) -> Image.Image:
    canvas = size * SS
    img = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    if maskable:
        # Maskable icons need a full-bleed background and content inside the
        # safe zone (~80% of the canvas).
        draw.rectangle([0, 0, canvas, canvas], fill=BG)
        inset, radius, scale = 0.24, 0.0, 0.58
    else:
        inset, radius, scale = 0.045, 0.22, 1.0
        draw.rounded_rectangle(
            [canvas * inset, canvas * inset, canvas * (1 - inset), canvas * (1 - inset)],
            radius=canvas * radius,
            fill=BG,
        )

    def bar(y: float, colour) -> None:
        thickness = canvas * 0.085 * scale
        half_width = canvas * 0.26 * scale
        cx, cy = canvas / 2, canvas * (0.5 + (y - 0.5) * scale)
        draw.rounded_rectangle(
            [cx - half_width, cy - thickness / 2, cx + half_width, cy + thickness / 2],
            radius=thickness / 2,
            fill=colour,
        )

    bar(0.34, SKY)
    bar(0.50, ORANGE)
    bar(0.66, GREEN)

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    import os

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    target = os.path.join(root, "public", "icons")
    os.makedirs(target, exist_ok=True)
    outputs = [
        ("icon-192.png", 192, False),
        ("icon-512.png", 512, False),
        ("icon-maskable-512.png", 512, True),
    ]
    for name, size, maskable in outputs:
        path = os.path.join(target, name)
        draw_icon(size, maskable).save(path, "PNG")
        print("wrote", path)


if __name__ == "__main__":
    main()
